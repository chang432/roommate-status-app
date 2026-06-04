"""DynamoDB-backed data access for the Roomie Status backend.

All data access goes through the functions here so the routes in app.py never
touch boto3 directly. Items live in the DynamoDB table created by
infrastructure/dynamodb-table.yaml: one item per roommate, keyed by a stable
string `id` (e.g. "jordan"), with schemaless `name`, `status`, and `statusText`
attributes written by this app.

Configuration (resolved at call time, not import time):
    ROOMMATE_TABLE  - table name (default "RoommateStatus")
    AWS_REGION / standard AWS config chain - region & credentials

The table starts empty after deploy; run seed.py (or call seed()) once to load
the initial household. Seeding is idempotent and never overwrites a roommate
who already exists, so it is safe to re-run.
"""

from __future__ import annotations

import os
import threading

import boto3
from botocore.exceptions import ClientError

# Allowed status values. Mirrors the frontend's STATUS enum (utils/status.js)
# and PROJECT.md: available, busy, or a free-form custom message.
VALID_STATUSES = {"available", "busy", "custom"}

# Demo password shared by every roommate. A real backend would store per-user
# salted password hashes; that work is deferred. Passwords are intentionally
# NOT stored in DynamoDB yet — login only checks that the name exists.
DEMO_PASSWORD = "roomie"

# Number of available roommates that should trigger a "gather" notification
# (PROJECT.md: "Whenever 3 or more status's are available...").
AVAILABLE_THRESHOLD = 3

# Table name is read from the environment so the same image can point at a
# dev/staging/prod table without code changes.
TABLE_NAME = os.environ.get("ROOMMATE_TABLE", "RoommateStatus")

# Initial household roster. Used only by seed()/reset(); once seeded, DynamoDB
# is the source of truth and these values are not consulted again.
_SEED = [
    {"id": "andre", "name": "Andre", "status": "available", "statusText": ""},
    {"id": "sheryl", "name": "Sheryl", "status": "available", "statusText": ""},
    {"id": "kayla", "name": "Kayla", "status": "custom", "statusText": "At the gym till 7"},
    {"id": "ting", "name": "Ting", "status": "busy", "statusText": ""},
    {"id": "isabella", "name": "Isabella", "status": "available", "statusText": ""},
]

# The boto3 Table resource is created lazily and cached. Lazy creation keeps
# module import side-effect free (so importing db.py needs no AWS config) and
# lets tests activate their DynamoDB mock before the first real call.
_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached DynamoDB Table resource, creating it on first use."""
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def _to_roommate(item: dict) -> dict:
    """Project a raw DynamoDB item to the exact shape the frontend expects.

    Guards against extra/missing attributes so the API contract stays stable
    even if the table grows columns later.
    """
    return {
        "id": item["id"],
        "name": item["name"],
        "status": item.get("status", "busy"),
        "statusText": item.get("statusText", ""),
    }


def get_all() -> list[dict]:
    """Return every roommate and their current status, sorted by name.

    Sorting gives the frontend a stable order (DynamoDB scans are unordered).
    The table is tiny (one household), so a scan is the right tool here.
    """
    table = _get_table()
    resp = table.scan()
    items = resp.get("Items", [])
    # Pagination is unlikely at this scale but cheap to handle correctly.
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return sorted((_to_roommate(i) for i in items), key=lambda r: r["name"].lower())


def find_by_name(name: str) -> dict | None:
    """Look up a roommate by name, case-insensitively. Returns a copy or None.

    Names aren't a key, so we match against the full (small) household rather
    than maintaining a secondary index.
    """
    needle = (name or "").strip().lower()
    for r in get_all():
        if r["name"].lower() == needle:
            return r
    return None


def update_status(roommate_id: str, status: str, status_text: str = "") -> list[dict] | None:
    """Update one roommate's status and return the full updated household.

    Custom statuses keep their text; fixed statuses clear it (matching the
    frontend). Returns None if the id is unknown — enforced with a conditional
    write so we don't silently create a roommate that doesn't exist.
    """
    text = status_text if status == "custom" else ""
    try:
        _get_table().update_item(
            Key={"id": roommate_id},
            # `status` is a DynamoDB reserved word, so reference it via a name
            # placeholder.
            UpdateExpression="SET #s = :s, statusText = :t",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":t": text},
            ConditionExpression="attribute_exists(id)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None  # Unknown roommate id.
        raise
    return get_all()


def available_count(roommates: list[dict] | None = None) -> int:
    """Count how many roommates are currently available to hang."""
    source = roommates if roommates is not None else get_all()
    return sum(1 for r in source if r["status"] == "available")


def seed() -> None:
    """Idempotently load the initial household into the table.

    Each roommate is written with a condition that they don't already exist, so
    re-running never clobbers a status someone has since changed.
    """
    table = _get_table()
    for r in _SEED:
        try:
            table.put_item(Item=dict(r), ConditionExpression="attribute_not_exists(id)")
        except ClientError as err:
            if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise  # The roommate already exists — leave their data untouched.


def reset() -> None:
    """Delete all items and restore the seed. Test helper — not for production."""
    table = _get_table()
    for r in get_all():
        table.delete_item(Key={"id": r["id"]})
    seed()
