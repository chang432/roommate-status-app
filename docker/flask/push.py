"""Web Push (PoC) for the Roomie Status backend.

Sends a browser push notification to every subscribed device when the shire
crosses the "enough roomies are free" threshold. Uses the standard Web Push
protocol + VAPID (works for installed PWAs on iOS 16.4+, Android, and desktop).

Subscriptions are stored in their own DynamoDB table — separate from the
roommate table so the shire scan in db.py stays clean — keyed by a hash of
the push endpoint and associated with a stable roommate id for recipient
selection. The table is provisioned by CloudFormation alongside the roommate
table (infrastructure/dynamodb-table-{dev,main}.yaml), so it must already exist;
this module never creates it.

The endpoint hash stays the partition key so re-subscribing one device upserts
a single row rather than duplicating it; recipients are found through the
UserIdIndex GSI, so sending to a few roommates reads only their devices instead
of every subscription in the table. Unlike the feed tables, push has no
read-your-own-write requirement — delivery is best-effort and already
asynchronous — so the index's eventual consistency costs nothing here.

Configuration (env):
    VAPID_PUBLIC_KEY   - base64url application server public key (sent to browser)
    VAPID_PRIVATE_KEY  - base64url raw EC P-256 private scalar (server-only)
    VAPID_SUBJECT      - contact URI for VAPID claims (default mailto:...)
    PUSH_TABLE         - override the subscriptions table name
                         (default: "${ROOMMATE_TABLE}-pushsubs")

VAPID keys are generated once with gen_vapid.py; see that script.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading

from boto3.dynamodb.conditions import Key
from pywebpush import WebPushException, webpush

# Reuse db's resource builder so push and roommate data sign requests the same
# way (shared region handling + the local DynamoDB endpoint override).
from db import resource

log = logging.getLogger(__name__)

# --- Configuration ----------------------------------------------------------
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:andre888chang@gmail.com").strip()

# Subscriptions live in their own table, derived from the roommate table so the
# dev/main split carries over automatically (RoommateStatus-dev-pushsubs, etc.).
TABLE_NAME = os.environ.get("PUSH_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-pushsubs"
)

# GSI that maps a roommate to their devices, so a notify reads only the
# recipients' rows instead of scanning every stored subscription.
USER_ID_INDEX = "UserIdIndex"

_table = None
_table_lock = threading.Lock()


def is_configured() -> bool:
    """True when both VAPID keys are present so pushes can actually be sent."""
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


# --- Subscription storage (DynamoDB) ----------------------------------------
def _get_table():
    """Return the cached subscriptions Table resource, built lazily.

    Mirrors db._get_table: the boto3 Table resource is lazy, so this issues no
    AWS call. The table is created by CloudFormation (not here) and must already
    exist — a missing table surfaces as ResourceNotFoundException on first use.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _endpoint_id(endpoint: str) -> str:
    """Stable item key for a subscription: a hash of its unique endpoint."""
    return hashlib.sha256(endpoint.encode()).hexdigest()


def save_subscription(subscription: dict, user_id: str) -> None:
    """Upsert a PushSubscription and associate the device with one roommate."""
    endpoint = subscription.get("endpoint")
    if not endpoint:
        raise ValueError("subscription is missing an endpoint")
    if not user_id:
        raise ValueError("subscription is missing a user id")
    _get_table().put_item(
        Item={
            "id": _endpoint_id(endpoint),
            "endpoint": endpoint,
            "userId": user_id,
            # Store the whole subscription JSON so we can send to it verbatim.
            "subscription": json.dumps(subscription),
        }
    )


def _delete_by_id(item_id: str) -> None:
    _get_table().delete_item(Key={"id": item_id})


def _rows_for_user(user_id: str) -> list[dict]:
    """Return one roommate's stored subscription rows via UserIdIndex."""
    if not user_id:
        return []
    table = _get_table()
    kwargs = {
        "IndexName": USER_ID_INDEX,
        "KeyConditionExpression": Key("userId").eq(user_id),
    }
    rows: list[dict] = []
    while True:
        response = table.query(**kwargs)
        rows.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return rows
        kwargs["ExclusiveStartKey"] = last_key


def _rows_for_users(user_ids: set[str]) -> list[dict]:
    """Return the subscription rows owned by any of the given roommates.

    Deduplicated by row id: one roommate can have several devices, and a device
    that somehow appears under two queries must still only be sent to once.
    """
    by_id: dict[str, dict] = {}
    for user_id in user_ids:
        for row in _rows_for_user(user_id):
            by_id[row["id"]] = row
    return list(by_id.values())


def delete_user_subscriptions(user_id: str) -> int:
    """Remove all stored browser subscriptions owned by a deleted account."""
    deleted = 0
    for row in _rows_for_user(user_id):
        _delete_by_id(row["id"])
        deleted += 1
    return deleted


def list_user_subscriptions(user_id: str) -> list[dict]:
    """Return one roommate's stored PushSubscriptions as dicts."""
    return [
        json.loads(row["subscription"])
        for row in _rows_for_user(user_id)
        if "subscription" in row
    ]


# --- Sending ----------------------------------------------------------------
def _notify(
    title: str,
    body: str,
    url: str = "/",
    event_type: str | None = None,
    user_ids: set[str] | None = None,
    exclude_user_ids: set[str] | None = None,
) -> dict:
    """Send to selected roommate devices and prune dead subscriptions.

    Returns a small summary {sent, pruned, failed}. Never raises for a single
    bad subscription — one expired endpoint shouldn't stop the others.
    """
    if not is_configured():
        log.warning("Push not configured (VAPID keys missing); skipping notify.")
        return {"sent": 0, "pruned": 0, "failed": 0}

    payload = {"title": title, "body": body, "url": url}
    if event_type:
        payload["eventType"] = event_type
    payload = json.dumps(payload)
    sent = pruned = failed = 0

    # Recipients are resolved through UserIdIndex, so excluded roommates are
    # never fetched and a subscription with no owner is unreachable by design —
    # it can't prove it isn't the actor, and now it can't be queried either.
    recipients = (user_ids or set()) - (exclude_user_ids or set())
    for item in _rows_for_users(recipients):
        raw = item.get("subscription")
        if not raw:
            continue
        try:
            webpush(
                subscription_info=json.loads(raw),
                data=payload,
                # VAPID_PRIVATE_KEY is the base64url raw P-256 scalar from
                # gen_vapid.py; pywebpush's Vapid.from_string loads it directly.
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
                timeout=10,
            )
            sent += 1
        except WebPushException as err:
            # 404/410 mean the push service has dropped the subscription — the
            # user uninstalled or revoked it, so remove our stale copy.
            status = getattr(err.response, "status_code", None)
            if status in (404, 410):
                _delete_by_id(item["id"])
                pruned += 1
            else:
                failed += 1
                log.warning("Push send failed (%s): %s", status, err)
        except Exception as err:  # noqa: BLE001 - one bad sub must not stop the batch
            # Network errors, encryption issues, etc. Count and move on so a
            # single bad subscription never fails the whole notify (or the
            # request that triggered it).
            failed += 1
            log.warning("Push send error: %s", err)

    log.info("notify: sent=%d pruned=%d failed=%d", sent, pruned, failed)
    return {"sent": sent, "pruned": pruned, "failed": failed}


def notify_users(
    user_ids: set[str],
    title: str,
    body: str,
    url: str = "/",
    event_type: str | None = None,
    exclude_user_ids: set[str] | None = None,
) -> dict:
    """Send only to devices owned by the selected roommate ids."""
    return _notify(
        title,
        body,
        url,
        event_type=event_type,
        user_ids=user_ids,
        exclude_user_ids=exclude_user_ids,
    )
