"""Proposed-activities feed for the Roomie Status backend.

A small, time-ordered list of "let's do X" proposals. Each proposal also fires a
push notification (handled in app.py); this module just owns persistence.

Stored in its own DynamoDB table — separate from the roommate table so the
household scan in db.py stays clean — provisioned by CloudFormation alongside
the other tables (infrastructure/dynamodb-table-{dev,main}.yaml). The table is
tiny and the UI only ever shows the most recent few, so a scan + in-app sort is
the right tool (mirrors db.get_all); no secondary index needed.

Configuration (env):
    ACTIVITIES_TABLE  - override the table name
                        (default: "${ROOMMATE_TABLE}-activities")
"""

from __future__ import annotations

import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

# Reuse db's resource builder so all tables sign requests the same way and share
# the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

# How many recent proposals the feed returns / the UI shows.
RECENT_LIMIT = 5

# How many of an activity's most recent comments the feed returns. Storage
# remains unbounded; the frontend initially shows only the latest 10.
COMMENTS_LIMIT = 100

# Results returned by delete_owned(), kept explicit so the route can distinguish
# missing activities from ownership failures without handling boto3 details.
DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
DELETE_FORBIDDEN = "forbidden"
DELETE_LIVE = "live"

LIVE_OK = "ok"
LIVE_NOT_FOUND = "not_found"
LIVE_FORBIDDEN = "forbidden"
LIVE_CONFLICT = "conflict"

# One reserved item coordinates the household-wide single-live-event invariant.
# Keeping it in the activities table lets DynamoDB update the event and lock in
# one transaction without introducing another table or schema migration.
LIVE_CONTROL_ID = "__live_event_control__"
LIVE_CONTROL_TYPE = "liveControl"

TABLE_NAME = os.environ.get("ACTIVITIES_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-activities"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached Activities Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _project(item: dict) -> dict:
    """Shape a raw DynamoDB item to what the frontend expects.

    createdAt is stored as a number (epoch millis) and comes back as a Decimal,
    which isn't JSON-serializable — cast it to int here. `members` and
    `memberIds` are DynamoDB string sets (unordered, and absent once empty); we
    always union the proposer into both when its id exists and present stable,
    sorted lists. Legacy items can still expose display-name membership while
    acquiring stable ids as roommates join them.
    """
    proposer = item.get("proposedBy", "Someone")
    proposer_id = item.get("proposedById")
    members = sorted(set(item.get("members") or set()) | {proposer})
    member_ids = set(item.get("memberIds") or set())
    if proposer_id:
        member_ids.add(proposer_id)
    # Comments are an ordered list of {author, text, createdAt} maps (oldest
    # first). Expose only the most recent COMMENTS_LIMIT, still oldest-first so
    # the UI can render them top-to-bottom with the newest nearest the input.
    # createdAt comes back as a Decimal, so cast it like the activity's own.
    comments = [
        {
            "author": c.get("author", "Someone"),
            "text": c.get("text", ""),
            "createdAt": int(c["createdAt"]),
            "mentions": [
                {"id": mention["id"], "name": mention["name"]}
                for mention in c.get("mentions", [])
                if mention.get("id") and mention.get("name")
            ],
            "mentionsAll": bool(c.get("mentionsAll", False)),
        }
        for c in (item.get("comments") or [])[-COMMENTS_LIMIT:]
    ]
    return {
        "id": item["id"],
        "text": item["text"],
        "proposedBy": item.get("proposedBy", "Someone"),
        "proposedById": proposer_id,
        "createdAt": int(item["createdAt"]),
        "members": members,
        "memberIds": sorted(member_ids),
        "comments": comments,
        "isLive": bool(item.get("isLive", False)),
        "liveStartedAt": (
            int(item["liveStartedAt"]) if item.get("liveStartedAt") is not None else None
        ),
    }


def add_activity(text: str, proposed_by_id: str, proposed_by: str) -> dict:
    """Store a new proposal and return it. Caller is responsible for validation."""
    item = {
        "id": uuid.uuid4().hex,
        "text": text,
        "proposedBy": proposed_by,
        "proposedById": proposed_by_id,
        # Epoch millis drives newest-first ordering in list_recent().
        "createdAt": int(time.time() * 1000),
        # The proposer joins automatically, so the count starts at 1.
        "members": {proposed_by},
        "memberIds": {proposed_by_id},
    }
    _get_table().put_item(Item=item)
    return _project(item)


def _set_membership(activity_id: str, user_id: str, name: str, op: str) -> dict | None:
    """Add or remove a roommate from an activity; return it, or None.

    `op` is "ADD" (join) or "DELETE" (leave). Both are atomic and idempotent at
    the DynamoDB level — joining twice or leaving when absent is a no-op. None
    means the activity doesn't exist.
    """
    try:
        resp = _get_table().update_item(
            Key={"id": activity_id},
            UpdateExpression=f"{op} members :m, memberIds :i",
            ExpressionAttributeValues={":m": {name}, ":i": {user_id}},
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None  # Unknown activity id.
        raise
    return _project(resp["Attributes"])


def join(activity_id: str, user_id: str, name: str) -> dict | None:
    """Add a roommate to an activity. None if the activity is unknown."""
    return _set_membership(activity_id, user_id, name, "ADD")


def leave(activity_id: str, user_id: str, name: str) -> dict | None:
    """Remove a roommate from an activity. None if the activity is unknown."""
    return _set_membership(activity_id, user_id, name, "DELETE")


def add_comment(
    activity_id: str,
    author: str,
    text: str,
    mentions: list[dict] | None = None,
    mentions_all: bool = False,
) -> dict | None:
    """Append a comment to an activity; return it, or None if unknown.

    Comments are stored as an ordered DynamoDB list of
    {author, text, createdAt, mentions, mentionsAll} maps and appended
    atomically with list_append, so concurrent comments don't clobber each
    other. if_not_exists seeds an empty list for activities (legacy or
    otherwise) that have never been commented on.
    """
    comment = {
        "author": author,
        "text": text,
        # Resolved by the server from the canonical household roster. Storing
        # ids alongside names keeps notification targeting and UI highlighting
        # independent from free-form client input.
        "mentions": mentions or [],
        "mentionsAll": mentions_all,
        # Epoch millis, mirroring an activity's createdAt — drives the order the
        # UI shows comments in and powers its relative timestamps.
        "createdAt": int(time.time() * 1000),
    }
    try:
        resp = _get_table().update_item(
            Key={"id": activity_id},
            UpdateExpression="SET comments = list_append(if_not_exists(comments, :empty), :c)",
            ExpressionAttributeValues={":c": [comment], ":empty": []},
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None  # Unknown activity id.
        raise
    return _project(resp["Attributes"])


def get(activity_id: str, consistent: bool = False) -> dict | None:
    """Return one proposal by id, or None if it doesn't exist."""
    if activity_id == LIVE_CONTROL_ID:
        return None
    item = _get_table().get_item(
        Key={"id": activity_id},
        ConsistentRead=consistent,
    ).get("Item")
    return _project(item) if item and item.get("itemType") != LIVE_CONTROL_TYPE else None


def _live_control(consistent: bool = True) -> dict:
    """Return the singleton live-event coordination item, or an empty dict."""
    return (
        _get_table()
        .get_item(Key={"id": LIVE_CONTROL_ID}, ConsistentRead=consistent)
        .get("Item", {})
    )


def start_owned(activity_id: str, requester_id: str) -> str:
    """Atomically make an owned event the household's only live event."""
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") == LIVE_CONTROL_TYPE:
        return LIVE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return LIVE_FORBIDDEN
    if item.get("isLive"):
        return LIVE_CONFLICT
    if _live_control().get("liveActivityId"):
        return LIVE_CONFLICT

    started_at = int(time.time() * 1000)
    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"id": activity_id},
                        "UpdateExpression": "SET isLive = :true, liveStartedAt = :started",
                        "ConditionExpression": (
                            "proposedById = :requester AND "
                            "(attribute_not_exists(isLive) OR isLive = :false)"
                        ),
                        "ExpressionAttributeValues": {
                            ":true": True,
                            ":false": False,
                            ":started": started_at,
                            ":requester": requester_id,
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"id": LIVE_CONTROL_ID},
                        "UpdateExpression": (
                            "SET itemType = :type, liveActivityId = :activity"
                        ),
                        "ConditionExpression": "attribute_not_exists(liveActivityId)",
                        "ExpressionAttributeValues": {
                            ":type": LIVE_CONTROL_TYPE,
                            ":activity": activity_id,
                        },
                    }
                },
            ]
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None:
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def end_owned(activity_id: str, requester_id: str) -> str:
    """Atomically end a live owned event and release the household live lock."""
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") == LIVE_CONTROL_TYPE:
        return LIVE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return LIVE_FORBIDDEN
    if not item.get("isLive"):
        return LIVE_CONFLICT

    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"id": activity_id},
                        "UpdateExpression": "SET isLive = :false REMOVE liveStartedAt",
                        "ConditionExpression": (
                            "proposedById = :requester AND isLive = :true"
                        ),
                        "ExpressionAttributeValues": {
                            ":false": False,
                            ":true": True,
                            ":requester": requester_id,
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": TABLE_NAME,
                        "Key": {"id": LIVE_CONTROL_ID},
                        "UpdateExpression": "REMOVE liveActivityId",
                        "ConditionExpression": "liveActivityId = :activity",
                        "ExpressionAttributeValues": {":activity": activity_id},
                    }
                },
            ]
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None:
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def delete_owned(activity_id: str, requester_id: str) -> str:
    """Delete an activity only when requester_id is its stored creator.

    The initial consistent read gives the route a useful 404 vs. 403 result.
    The conditional delete then enforces that same ownership at write time, so
    a concurrent change cannot turn the check into an unauthorized deletion.
    Legacy activities have no proposedById and are therefore always forbidden.
    """
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None:
        return DELETE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return DELETE_FORBIDDEN
    if item.get("isLive"):
        return DELETE_LIVE

    try:
        table.delete_item(
            Key={"id": activity_id},
            ConditionExpression=(
                "proposedById = :requester AND "
                "(attribute_not_exists(isLive) OR isLive = :false)"
            ),
            ExpressionAttributeValues={":requester": requester_id, ":false": False},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Resolve the rare race into the same stable API outcomes.
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None:
            return DELETE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return DELETE_FORBIDDEN
        return DELETE_LIVE
    return DELETE_OK


def list_recent(limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    """Return the most recent proposals, newest first.

    Pass consistent=True for the response that follows a write (propose / join /
    leave / delete): DynamoDB scans are eventually consistent by default, so a
    plain scan right after an update can return stale data. A strongly-consistent
    read avoids that. The default (eventual) read is fine for the plain GET feed.
    """
    table = _get_table()
    resp = table.scan(ConsistentRead=consistent)
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"], ConsistentRead=consistent)
        items.extend(resp.get("Items", []))
    items = [
        item
        for item in items
        if item.get("itemType") != LIVE_CONTROL_TYPE and "createdAt" in item
    ]
    items.sort(key=lambda i: int(i["createdAt"]), reverse=True)
    selected = items[:limit]

    # An older live event must remain in the feed because its card contains the
    # creator's End control. Replace the oldest selected proposal if necessary.
    live_item = next((item for item in items if item.get("isLive")), None)
    if live_item and live_item not in selected and limit > 0:
        selected[-1] = live_item
        selected.sort(key=lambda i: int(i["createdAt"]), reverse=True)
    return [_project(i) for i in selected]
