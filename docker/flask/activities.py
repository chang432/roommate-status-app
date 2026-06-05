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
    which isn't JSON-serializable — cast it to int here.
    """
    return {
        "id": item["id"],
        "text": item["text"],
        "proposedBy": item.get("proposedBy", "Someone"),
        "createdAt": int(item["createdAt"]),
    }


def add_activity(text: str, proposed_by: str = "Someone") -> dict:
    """Store a new proposal and return it. Caller is responsible for validation."""
    item = {
        "id": uuid.uuid4().hex,
        "text": text,
        "proposedBy": proposed_by or "Someone",
        # Epoch millis drives newest-first ordering in list_recent().
        "createdAt": int(time.time() * 1000),
    }
    _get_table().put_item(Item=item)
    return _project(item)


def list_recent(limit: int = RECENT_LIMIT) -> list[dict]:
    """Return the most recent proposals, newest first."""
    table = _get_table()
    resp = table.scan()
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    items.sort(key=lambda i: int(i["createdAt"]), reverse=True)
    return [_project(i) for i in items[:limit]]
