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
from contextvars import ContextVar

from botocore.exceptions import ClientError
from werkzeug.security import check_password_hash, generate_password_hash

# The boto3 DynamoDB resource factory lives in aws.py so lighter callers (e.g.
# the migration runner) can reuse it without importing the app's dependencies.
# Re-exported here so existing `from db import resource` / `db.resource()`
# callers (activities, push, groups, household_shows) keep working unchanged.
from aws import resource

# Allowed status values. Mirrors the frontend's STATUS enum (utils/status.js):
# available, busy, sleeping, ooh (out of house). Any status may carry an
# optional supplemental note in `statusText`.
VALID_STATUSES = {"available", "busy", "sleeping", "ooh"}

# Demo password used only to backfill the seeded household's password hashes.
DEMO_PASSWORD = "roomie"

# Existing users belong to the initial household. Newly-created users start
# without a group until the future join-group flow assigns one.
DEFAULT_GROUP_ID = "yorkshire"
DEFAULT_GROUP_NAME = "Yorkshire"

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,31}$")

# Number of available roommates that should trigger a "gather" notification
# (PROJECT.md: "Whenever 3 or more status's are available...").
AVAILABLE_THRESHOLD = 3

# Table name is read from the environment so the same image can point at the
# dev or main table without code changes. Defaults to the production table; the
# dev deployment sets ROOMMATE_TABLE=RoommateStatus-dev.
TABLE_NAME = os.environ.get("ROOMMATE_TABLE", "RoommateStatus-main")
MEMBERSHIPS_TABLE = os.environ.get("MEMBERSHIPS_TABLE") or f"{TABLE_NAME}-memberships"
MEMBERSHIP_USER_INDEX = "UserIdIndex"

# Initial household roster. Used only by seed()/reset(); once seeded, DynamoDB
# is the source of truth and these values are not consulted again.
_SEED = [
    {"id": "andre", "username": "andre", "name": "Andre", "status": "busy", "statusText": ""},
    {
        "id": "sheryl",
        "username": "sheryl",
        "name": "Sheryl",
        "status": "busy",
        "statusText": "",
    },
    {"id": "kayla", "username": "kayla", "name": "Kayla", "status": "busy", "statusText": ""},
    {"id": "ting", "username": "ting", "name": "Ting", "status": "busy", "statusText": ""},
    {
        "id": "isabella",
        "username": "isabella",
        "name": "Isabella",
        "status": "busy",
        "statusText": "",
    },
]

# The boto3 Table resource is created lazily and cached. Lazy creation keeps
# module import side-effect free (so importing db.py needs no AWS config) and
# lets tests activate their DynamoDB mock before the first real call.
_table = None
_table_lock = threading.Lock()
_memberships_table = None
_memberships_table_lock = threading.Lock()
_request_group_id: ContextVar[str | None] = ContextVar("request_group_id", default=None)


def _get_table():
    """Return the cached DynamoDB Table resource, creating it on first use."""
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _get_memberships_table():
    """Return the membership table, which owns group-specific status data."""
    global _memberships_table
    if _memberships_table is None:
        with _memberships_table_lock:
            if _memberships_table is None:
                _memberships_table = resource().Table(MEMBERSHIPS_TABLE)
    return _memberships_table


def set_request_group_id(group_id: str | None):
    """Select a group for the current request without sharing state between workers."""
    return _request_group_id.set((group_id or "").strip() or None)


def reset_request_group_id(token) -> None:
    _request_group_id.reset(token)


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


def _to_account_user(item: dict) -> dict:
    """Project an account to the auth/session shape, excluding credentials."""
    group_ids = get_group_ids(item["id"])
    return {
        "id": item["id"],
        "name": item["name"],
        "username": item.get("username", item["id"]),
        # groupId remains the selected membership for legacy frontend callers.
        "groupId": group_ids[0] if group_ids else None,
        "hasGroup": bool(group_ids),
    }


def _query_memberships(**kwargs) -> list[dict]:
    table = _get_memberships_table()
    try:
        response = table.query(**kwargs)
    except ClientError as err:
        # The table is owned by CloudFormation; treat "not provisioned yet" as
        # an empty roster rather than a 500 on every request.
        if err.response["Error"]["Code"] == "ResourceNotFoundException":
            return []
        raise
    items = response.get("Items", [])
    while "LastEvaluatedKey" in response:
        response = table.query(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


def _membership_items_for_user(user_id: str) -> list[dict]:
    """Look a user's memberships up through UserIdIndex.

    No consistent-read option: this is a global secondary index, and DynamoDB
    only serves those eventually. Callers that must see their own write read the
    group's partition on the base table instead (_membership_items_for_group).
    """
    if not user_id:
        return []
    return _query_memberships(
        IndexName=MEMBERSHIP_USER_INDEX,
        KeyConditionExpression="userId = :userId",
        ExpressionAttributeValues={":userId": user_id},
    )


def _membership_items_for_group(group_id: str, consistent: bool = False) -> list[dict]:
    """Read one group's membership rows from the base table's partition.

    Pass consistent=True for the read that follows a status write, so the caller
    sees their own change; a base-table query supports it, unlike the index
    above.
    """
    if not group_id:
        return []
    return _query_memberships(
        KeyConditionExpression="groupId = :groupId",
        ExpressionAttributeValues={":groupId": group_id},
        ConsistentRead=consistent,
    )


def get_group_ids(user_id: str) -> list[str]:
    """List every group the account belongs to, from the membership rows."""
    return sorted({item["groupId"] for item in _membership_items_for_user(user_id)})


def get_membership(user_id: str, group_id: str) -> dict | None:
    if not user_id or not group_id:
        return None
    try:
        item = _get_memberships_table().get_item(
            Key={"groupId": group_id, "userId": user_id}, ConsistentRead=True
        ).get("Item")
    except ClientError as err:
        if err.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
        item = None
    return item or None


def create_membership(user_id: str, group_id: str, name: str) -> dict | None:
    """Create one membership with an independent initial status."""
    joined_at = int(time.time() * 1000)
    item = {
        "groupId": group_id,
        "userId": user_id,
        "name": name,
        "status": "busy",
        "statusText": "",
        "statusUpdatedAt": None,
        "joinedAt": joined_at,
    }
    try:
        _get_memberships_table().put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(groupId) AND attribute_not_exists(userId)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] in {
            "ConditionalCheckFailedException",
            "ResourceNotFoundException",
        }:
            return None
        raise
    return item


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def validate_username(username: str) -> bool:
    return bool(USERNAME_RE.match(username))


def get_all(group_id: str, consistent: bool = False) -> list[dict]:
    """Return one group's roommates and their current status, sorted by name.

    The membership table is partitioned by group, so this reads only this
    household's rows. Sorting gives the frontend a stable order, since DynamoDB
    orders a query by sort key (userId) rather than by display name.
    """
    if not group_id:
        return []
    return sorted(
        (
            _to_roommate({**item, "id": item["userId"]})
            for item in _membership_items_for_group(group_id, consistent=consistent)
        ),
        key=lambda r: r["name"].lower(),
    )


def get_account_by_id(user_id: str) -> dict | None:
    """Return one account, including group/session fields but no password hash."""
    if not user_id:
        return None
    item = _get_table().get_item(Key={"id": user_id}, ConsistentRead=True).get("Item")
    return _to_account_user(item) if item else None


def get_group_member(user_id: str, expected_group_id: str | None = None) -> dict | None:
    """Return a grouped account, or None for missing/no-group/wrong-group ids."""
    if not user_id:
        return None
    item = _get_table().get_item(Key={"id": user_id}, ConsistentRead=True).get("Item")
    if not item:
        return None
    group_id = expected_group_id or _request_group_id.get()
    group_ids = get_group_ids(user_id)
    if group_id is None:
        group_id = group_ids[0] if group_ids else None
    if not group_id or group_id not in group_ids:
        return None
    return {**_to_account_user(item), "groupId": group_id}


def get_group_user_ids(group_id: str, consistent: bool = False) -> list[str]:
    """Return every account id that belongs to the given group."""
    if not group_id:
        return []
    return sorted(
        {item["userId"] for item in _membership_items_for_group(group_id, consistent=consistent)}
    )


def authenticate(username: str, password: str) -> dict | None:
    """Verify username/password and return the public session user."""
    normalized = normalize_username(username)
    if not normalized or not password:
        return None
    item = _get_table().get_item(Key={"id": normalized}, ConsistentRead=True).get("Item")
    if not item:
        return None
    password_hash = item.get("passwordHash")
    if not password_hash or not check_password_hash(password_hash, password):
        return None
    return _to_account_user(item)


def create_account(username: str, name: str, password: str) -> tuple[dict | None, str | None]:
    """Create a no-group account. Returns (user, error_code)."""
    normalized = normalize_username(username)
    display_name = (name or "").strip()
    if not validate_username(normalized):
        return None, "invalid_username"
    if not display_name:
        return None, "invalid_name"
    if len(display_name) > 80:
        return None, "invalid_name"
    if not password or len(password) < 6:
        return None, "invalid_password"

    item = {
        "id": normalized,
        "username": normalized,
        "name": display_name,
        "passwordHash": generate_password_hash(password),
    }
    try:
        _get_table().put_item(Item=item, ConditionExpression="attribute_not_exists(id)")
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "duplicate_username"
        raise
    return _to_account_user(item), None


def delete_account(user_id: str, password: str) -> bool:
    """Delete an account after password verification."""
    normalized = normalize_username(user_id)
    if not normalized or not password:
        return False
    table = _get_table()
    item = table.get_item(Key={"id": normalized}, ConsistentRead=True).get("Item")
    if not item:
        return False
    password_hash = item.get("passwordHash")
    if not password_hash or not check_password_hash(password_hash, password):
        return False
    for membership in _membership_items_for_user(normalized):
        _get_memberships_table().delete_item(
            Key={"groupId": membership["groupId"], "userId": normalized}
        )
    table.delete_item(Key={"id": normalized})
    return True


def update_status(
    roommate_id: str,
    group_id: str,
    status: str,
    status_text: str = "",
) -> list[dict] | None:
    """Update one roommate's status and return the full updated household.

    Any status may carry a supplemental note (`status_text`); it is stored as-is
    so everyone sees it alongside the status. Returns None if the id is unknown
    — enforced with a conditional write so we don't silently create a roommate
    that doesn't exist.
    """
    updated_at = int(time.time() * 1000)
    try:
        _get_memberships_table().update_item(
            Key={"groupId": group_id, "userId": roommate_id},
            # `status` is a DynamoDB reserved word, so reference it via a name
            # placeholder.
            UpdateExpression="SET #s = :s, statusText = :t, statusUpdatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": status,
                ":t": status_text,
                ":u": updated_at,
            },
            ConditionExpression="attribute_exists(groupId) AND attribute_exists(userId)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # No membership row for this roommate in this group.
            return None
        raise
    return get_all(group_id, consistent=True)


def available_count(group_id: str, roommates: list[dict] | None = None) -> int:
    """Count how many roommates are currently available to hang."""
    source = roommates if roommates is not None else get_all(group_id)
    return sum(1 for r in source if r["status"] == "available")


def seed() -> None:
    """Idempotently load the initial household into the table.

    Each roommate is written with a condition that they don't already exist, so
    re-running never clobbers a status someone has since changed.
    """
    table = _get_table()
    for r in _SEED:
        seeded = {
            "id": r["id"],
            "username": r["username"],
            "name": r["name"],
            "passwordHash": generate_password_hash(DEMO_PASSWORD),
        }
        try:
            table.put_item(Item=seeded, ConditionExpression="attribute_not_exists(id)")
        except ClientError as err:
            if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
                # Backfill credentials without overwriting live account data.
                table.update_item(
                    Key={"id": r["id"]},
                    UpdateExpression=(
                        "SET username = if_not_exists(username, :username), "
                        "passwordHash = if_not_exists(passwordHash, :passwordHash)"
                    ),
                    ExpressionAttributeValues={
                        ":username": r["username"],
                        ":passwordHash": generate_password_hash(DEMO_PASSWORD),
                    },
                    ConditionExpression="attribute_exists(id)",
                )
            else:
                raise  # The roommate already exists — leave their data untouched.
        create_membership(r["id"], DEFAULT_GROUP_ID, r["name"])


def _scan_items(consistent: bool = False) -> list[dict]:
    """Return every account item. Only reset() needs a whole-table read; the
    request paths all address accounts by id or query memberships by group."""
    table = _get_table()
    resp = table.scan(ConsistentRead=consistent)
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            ExclusiveStartKey=resp["LastEvaluatedKey"],
            ConsistentRead=consistent,
        )
        items.extend(resp.get("Items", []))
    return items


def reset() -> None:
    """Delete all items and restore the seed. Test helper — not for production."""
    table = _get_table()
    for item in _scan_items():
        table.delete_item(Key={"id": item["id"]})
    memberships = _get_memberships_table()
    response = memberships.scan()
    items = response.get("Items", [])
    while "LastEvaluatedKey" in response:
        response = memberships.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        items.extend(response.get("Items", []))
    for item in items:
        memberships.delete_item(Key={"groupId": item["groupId"], "userId": item["userId"]})
    seed()
