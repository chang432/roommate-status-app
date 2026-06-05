"""Web Push (PoC) for the Roomie Status backend.

Sends a browser push notification to every subscribed device when the household
crosses the "enough roomies are free" threshold. Uses the standard Web Push
protocol + VAPID (works for installed PWAs on iOS 16.4+, Android, and desktop).

Subscriptions are stored in their own DynamoDB table — separate from the
roommate table so the household scan in db.py stays clean — keyed by a hash of
the push endpoint. The table is provisioned by CloudFormation alongside the
roommate table (infrastructure/dynamodb-table-{dev,main}.yaml), so it must
already exist; this module never creates it. The app's IAM only needs item
access on the table (PutItem / DeleteItem / Scan).

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

import boto3
from pywebpush import WebPushException, webpush

# Reuse db's region resolution so push and roommate data sign requests the same
# way (handles a missing/blank/garbled AWS_REGION).
from db import _region

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
                _table = boto3.resource("dynamodb", region_name=_region()).Table(TABLE_NAME)
    return _table


def _endpoint_id(endpoint: str) -> str:
    """Stable item key for a subscription: a hash of its unique endpoint."""
    return hashlib.sha256(endpoint.encode()).hexdigest()


def save_subscription(subscription: dict) -> None:
    """Upsert a PushSubscription. Idempotent — re-subscribing is a no-op write."""
    endpoint = subscription.get("endpoint")
    if not endpoint:
        raise ValueError("subscription is missing an endpoint")
    _get_table().put_item(
        Item={
            "id": _endpoint_id(endpoint),
            "endpoint": endpoint,
            # Store the whole subscription JSON so we can send to it verbatim.
            "subscription": json.dumps(subscription),
        }
    )


def _delete_by_id(item_id: str) -> None:
    _get_table().delete_item(Key={"id": item_id})


def list_subscriptions() -> list[dict]:
    """Return every stored PushSubscription as a dict."""
    table = _get_table()
    resp = table.scan()
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return [json.loads(i["subscription"]) for i in items if "subscription" in i]


# --- Sending ----------------------------------------------------------------
def notify_all(title: str, body: str, url: str = "/") -> dict:
    """Send a notification to every subscription; prune dead ones.

    Returns a small summary {sent, pruned, failed}. Never raises for a single
    bad subscription — one expired endpoint shouldn't stop the others.
    """
    if not is_configured():
        log.warning("Push not configured (VAPID keys missing); skipping notify_all.")
        return {"sent": 0, "pruned": 0, "failed": 0}

    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = pruned = failed = 0

    table = _get_table()
    resp = table.scan()
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))

    for item in items:
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

    log.info("notify_all: sent=%d pruned=%d failed=%d", sent, pruned, failed)
    return {"sent": sent, "pruned": pruned, "failed": failed}
