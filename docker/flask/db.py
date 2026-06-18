"""DynamoDB-backed data access for the Roomie Status backend.

All data access goes through the functions here so the routes in app.py never
touch boto3 directly. Items live in the DynamoDB table created by
infrastructure/dynamodb-table.yaml: one item per roommate, keyed by a stable
string `id` (e.g. "jordan"), with schemaless `name`, `status`, and `statusText`
attributes written by this app.

Configuration (resolved at call time, not import time):
    ROOMMATE_TABLE     - table name (default "RoommateStatus-main")
    AWS_REGION / standard AWS config chain - region & credentials
    DYNAMODB_ENDPOINT  - local-dev only: point boto3 at a DynamoDB Local instead
                         of real AWS (unset in production -> real DynamoDB)

The table starts empty after deploy; run seed.py (or call seed()) once to load
the initial household. Seeding is idempotent and never overwrites a roommate
who already exists, so it is safe to re-run.
"""

from __future__ import annotations

import os
import re
import threading
import time

import boto3
from botocore.exceptions import ClientError

# Allowed status values. Mirrors the frontend's STATUS enum (utils/status.js):
# available, busy, sleeping, ooh (out of house). Any status may carry an
# optional supplemental note in `statusText`.
VALID_STATUSES = {"available", "busy", "sleeping", "ooh"}

# Demo password shared by every roommate. A real backend would store per-user
# salted password hashes; that work is deferred. Passwords are intentionally
# NOT stored in DynamoDB yet — login only checks that the name exists.
DEMO_PASSWORD = "roomie"

# Number of available roommates that should trigger a "gather" notification
# (PROJECT.md: "Whenever 3 or more status's are available...").
AVAILABLE_THRESHOLD = 3

# Table name is read from the environment so the same image can point at the
# dev or main table without code changes. Defaults to the production table; the
# dev deployment sets ROOMMATE_TABLE=RoommateStatus-dev.
TABLE_NAME = os.environ.get("ROOMMATE_TABLE", "RoommateStatus-main")

# Initial household roster. Used only by seed()/reset(); once seeded, DynamoDB
# is the source of truth and these values are not consulted again.
_SEED = [
    {"id": "andre", "name": "Andre", "status": "busy", "statusText": ""},
    {"id": "sheryl", "name": "Sheryl", "status": "busy", "statusText": ""},
    {"id": "kayla", "name": "Kayla", "status": "busy", "statusText": ""},
    {"id": "ting", "name": "Ting", "status": "busy", "statusText": ""},
    {"id": "isabella", "name": "Isabella", "status": "busy", "statusText": ""},
]

# The boto3 Table resource is created lazily and cached. Lazy creation keeps
# module import side-effect free (so importing db.py needs no AWS config) and
# lets tests activate their DynamoDB mock before the first real call.
_table = None
_table_lock = threading.Lock()

# Region the DynamoDB table lives in. Falls back to us-east-1 when the standard
# AWS region vars are unset/blank so a missing/empty AWS_REGION can't leave
# boto3 with an empty signing region (which fails as InvalidSignatureException:
# "Credential should be scoped to a valid region").
DEFAULT_REGION = "us-east-1"

# AWS region identifiers look like "us-east-1" / "eu-central-1". Anything that
# doesn't match this shape (blank, accidental quotes, internal whitespace, a
# typo) is treated as unset so we fall back to DEFAULT_REGION rather than sign
# requests with a bad region — which AWS rejects as InvalidSignatureException:
# "Credential should be scoped to a valid region".
_REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-\d+$")


def _region() -> str:
    """Resolve the AWS region, defaulting to us-east-1 when none is valid."""
    region = (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "").strip()
    return region if _REGION_RE.match(region) else DEFAULT_REGION


def _endpoint() -> str | None:
    """Optional DynamoDB endpoint override for local development.

    When DYNAMODB_ENDPOINT is set (e.g. a DynamoDB Local container), boto3 talks
    to it instead of real AWS — so local runs need no AWS account. Unset in
    production, where None means "use the real DynamoDB endpoint" and behavior
    is unchanged.
    """
    return os.environ.get("DYNAMODB_ENDPOINT") or None


def resource():
    """Build a DynamoDB resource honoring the region and local-endpoint override.

    Shared by db, activities, and push so all three sign requests the same way
    and pick up DYNAMODB_ENDPOINT together. endpoint_url=None is the boto3
    default (real AWS), so production is unaffected.
    """
    return boto3.resource("dynamodb", region_name=_region(), endpoint_url=_endpoint())


def _get_table():
    """Return the cached DynamoDB Table resource, creating it on first use."""
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
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
        "statusUpdatedAt": (
            int(item["statusUpdatedAt"]) if item.get("statusUpdatedAt") is not None else None
        ),
    }


def get_all(consistent: bool = False) -> list[dict]:
    """Return every roommate and their current status, sorted by name.

    Sorting gives the frontend a stable order (DynamoDB scans are unordered).
    The table is tiny (one household), so a scan is the right tool here. Pass
    consistent=True immediately after a write so the response includes it.
    """
    table = _get_table()
    resp = table.scan(ConsistentRead=consistent)
    items = resp.get("Items", [])
    # Pagination is unlikely at this scale but cheap to handle correctly.
    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            ExclusiveStartKey=resp["LastEvaluatedKey"],
            ConsistentRead=consistent,
        )
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


def get_by_id(roommate_id: str) -> dict | None:
    """Return one roommate by stable id, or None when it does not exist."""
    item = _get_table().get_item(Key={"id": roommate_id}, ConsistentRead=True).get("Item")
    return _to_roommate(item) if item else None


def update_status(roommate_id: str, status: str, status_text: str = "") -> list[dict] | None:
    """Update one roommate's status and return the full updated household.

    Any status may carry a supplemental note (`status_text`); it is stored as-is
    so everyone sees it alongside the status. Returns None if the id is unknown
    — enforced with a conditional write so we don't silently create a roommate
    that doesn't exist.
    """
    try:
        updated_at = int(time.time() * 1000)
        _get_table().update_item(
            Key={"id": roommate_id},
            # `status` is a DynamoDB reserved word, so reference it via a name
            # placeholder.
            UpdateExpression="SET #s = :s, statusText = :t, statusUpdatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":t": status_text, ":u": updated_at},
            ConditionExpression="attribute_exists(id)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None  # Unknown roommate id.
        raise
    return get_all(consistent=True)


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
