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

import boto3
from botocore.exceptions import ClientError

# Reuse db's region resolution so all tables sign requests the same way.
from db import _region

# How many recent proposals the feed returns / the UI shows.
RECENT_LIMIT = 5

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
                _table = boto3.resource("dynamodb", region_name=_region()).Table(TABLE_NAME)
    return _table


def _project(item: dict) -> dict:
    """Shape a raw DynamoDB item to what the frontend expects.

    createdAt is stored as a number (epoch millis) and comes back as a Decimal,
    which isn't JSON-serializable — cast it to int here. `members` is a DynamoDB
    string set (unordered, and absent once empty); we always union the proposer
    into it and present a stable, sorted list. Unioning the proposer means the
    creator is always counted as a member (count >= 1) with no stored-data
    migration: legacy items written before join/leave simply have no members
    attribute, and even after someone joins one the proposer is still included.
    """
    proposer = item.get("proposedBy", "Someone")
    members = sorted(set(item.get("members") or set()) | {proposer})
    return {
        "id": item["id"],
        "text": item["text"],
        "proposedBy": item.get("proposedBy", "Someone"),
        "createdAt": int(item["createdAt"]),
        "members": members,
    }


def add_activity(text: str, proposed_by: str = "Someone") -> dict:
    """Store a new proposal and return it. Caller is responsible for validation."""
    proposer = proposed_by or "Someone"
    item = {
        "id": uuid.uuid4().hex,
        "text": text,
        "proposedBy": proposer,
        # Epoch millis drives newest-first ordering in list_recent().
        "createdAt": int(time.time() * 1000),
        # The proposer joins automatically, so the count starts at 1.
        "members": {proposer},
    }
    _get_table().put_item(Item=item)
    return _project(item)


def _set_membership(activity_id: str, name: str, op: str) -> dict | None:
    """Add or remove `name` from an activity's members; return it, or None.

    `op` is "ADD" (join) or "DELETE" (leave). Both are atomic and idempotent at
    the DynamoDB level — joining twice or leaving when absent is a no-op. None
    means the activity doesn't exist.
    """
    try:
        resp = _get_table().update_item(
            Key={"id": activity_id},
            UpdateExpression=f"{op} members :m",
            ExpressionAttributeValues={":m": {name}},
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None  # Unknown activity id.
        raise
    return _project(resp["Attributes"])


def join(activity_id: str, name: str) -> dict | None:
    """Add `name` to an activity's members. None if the activity is unknown."""
    return _set_membership(activity_id, name, "ADD")


def leave(activity_id: str, name: str) -> dict | None:
    """Remove `name` from an activity's members. None if the activity is unknown."""
    return _set_membership(activity_id, name, "DELETE")


def get(activity_id: str) -> dict | None:
    """Return one proposal by id, or None if it doesn't exist."""
    item = _get_table().get_item(Key={"id": activity_id}).get("Item")
    return _project(item) if item else None


def list_recent(limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    """Return the most recent proposals, newest first.

    Pass consistent=True for the response that follows a write (propose / join /
    leave): DynamoDB scans are eventually consistent by default, so a plain scan
    right after an update can return the pre-write member list, leaving the UI
    showing a stale count. A strongly-consistent read avoids that. The default
    (eventual) read is fine for the plain GET feed.
    """
    table = _get_table()
    resp = table.scan(ConsistentRead=consistent)
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"], ConsistentRead=consistent)
        items.extend(resp.get("Items", []))
    items.sort(key=lambda i: int(i["createdAt"]), reverse=True)
    return [_project(i) for i in items[:limit]]
