"""Group metadata and join-code lookup for the Roomie Status backend."""

from __future__ import annotations

import os
import re
import secrets
import threading
import time

from botocore.exceptions import ClientError

import db

GROUPS_TABLE = os.environ.get("GROUPS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-groups"
)
JOIN_CODE_INDEX = "JoinCodeIndex"
DEFAULT_GROUP_JOIN_CODE = os.environ.get("DEFAULT_GROUP_JOIN_CODE", "YORKSHIRE")
JOIN_CODE_RE = re.compile(r"^[A-Z0-9]{6,16}$")
GROUP_SLUG_RE = re.compile(r"[^a-z0-9]+")
GROUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_table = None
_table_lock = threading.Lock()


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = db.resource().Table(GROUPS_TABLE)
    return _table


def normalize_join_code(code: str) -> str:
    """Canonicalize invite codes so the UI can accept friendly formatting."""
    return re.sub(r"[^A-Z0-9]", "", (code or "").strip().upper())


def valid_join_code(code: str) -> bool:
    return bool(JOIN_CODE_RE.match(code))


def _project_group(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {
        "groupId": item["groupId"],
        "name": item.get("name", item["groupId"]),
        "joinCode": item["joinCode"],
        "createdAt": int(item["createdAt"]) if item.get("createdAt") is not None else None,
    }


def ensure_default_group() -> dict:
    """Create or backfill the seeded Yorkshire group record."""
    join_code = normalize_join_code(DEFAULT_GROUP_JOIN_CODE)
    if not valid_join_code(join_code):
        raise ValueError("DEFAULT_GROUP_JOIN_CODE must normalize to 6-16 alphanumeric chars.")

    table = _get_table()
    created_at = int(time.time() * 1000)
    try:
        table.put_item(
            Item={
                "groupId": db.DEFAULT_GROUP_ID,
                "name": db.DEFAULT_GROUP_NAME,
                "joinCode": join_code,
                "createdAt": created_at,
            },
            ConditionExpression="attribute_not_exists(groupId)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        table.update_item(
            Key={"groupId": db.DEFAULT_GROUP_ID},
            UpdateExpression=(
                "SET #name = if_not_exists(#name, :name), "
                "joinCode = if_not_exists(joinCode, :joinCode), "
                "createdAt = if_not_exists(createdAt, :createdAt)"
            ),
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={
                ":name": db.DEFAULT_GROUP_NAME,
                ":joinCode": join_code,
                ":createdAt": created_at,
            },
            ConditionExpression="attribute_exists(groupId)",
        )
    item = table.get_item(Key={"groupId": db.DEFAULT_GROUP_ID}, ConsistentRead=True).get("Item")
    return _project_group(item)


def get_group_by_id(group_id: str) -> dict | None:
    if not group_id:
        return None
    if group_id == db.DEFAULT_GROUP_ID:
        ensure_default_group()
    item = _get_table().get_item(Key={"groupId": group_id}, ConsistentRead=True).get("Item")
    return _project_group(item)


def get_group_by_code(code: str) -> dict | None:
    normalized = normalize_join_code(code)
    if not valid_join_code(normalized):
        return None
    ensure_default_group()
    resp = _get_table().query(
        IndexName=JOIN_CODE_INDEX,
        KeyConditionExpression="joinCode = :joinCode",
        ExpressionAttributeValues={":joinCode": normalized},
        Limit=1,
        ConsistentRead=False,
    )
    items = resp.get("Items") or []
    return _project_group(items[0]) if items else None


def list_groups_for_user(user_id: str) -> list[dict]:
    """Return the metadata for every group an account belongs to."""
    return [
        group
        for group_id in db.get_group_ids(user_id)
        if (group := get_group_by_id(group_id)) is not None
    ]


def create_group(user_id: str, name: str) -> tuple[dict | None, dict | None, str | None]:
    """Create a household with a unique invite code and add its creator."""
    account = db.get_account_by_id(db.normalize_username(user_id))
    display_name = (name or "").strip()
    if account is None:
        return None, None, "unknown_user"
    if not display_name or len(display_name) > 80:
        return None, None, "invalid_name"

    slug = GROUP_SLUG_RE.sub("-", display_name.lower()).strip("-") or "group"
    table = _get_table()
    for _ in range(8):
        group_id = f"{slug[:48]}-{secrets.token_hex(3)}"
        join_code = "".join(secrets.choice(GROUP_CODE_ALPHABET) for _ in range(8))
        group_item = {
            "groupId": group_id,
            "name": display_name,
            "joinCode": join_code,
            "createdAt": int(time.time() * 1000),
        }
        try:
            table.put_item(
                Item=group_item,
                ConditionExpression="attribute_not_exists(groupId)",
            )
        except ClientError as err:
            if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
                continue
            raise

        membership = db.create_membership(account["id"], group_id, account["name"])
        if membership is not None:
            return {**account, "groupId": group_id, "hasGroup": True}, _project_group(group_item), None

        # A group without its creator is unusable; clean up the rare failed write.
        table.delete_item(Key={"groupId": group_id})
        return None, None, "membership_failed"
    return None, None, "creation_failed"


def join_group(user_id: str, code: str) -> tuple[dict | None, str | None]:
    """Add an account to the group that owns the invite code."""
    normalized_code = normalize_join_code(code)
    if not valid_join_code(normalized_code):
        return None, "invalid_code"

    group = get_group_by_code(normalized_code)
    if group is None:
        return None, "unknown_code"

    account = db.get_account_by_id(db.normalize_username(user_id))
    if account is None:
        return None, "unknown_user"
    if db.get_membership(account["id"], group["groupId"]):
        return None, "already_member"
    if db.create_membership(account["id"], group["groupId"], account["name"]) is None:
        return None, "already_member"
    # The client switches to the group it just joined, even if lexical group
    # ordering would make a different membership appear first on the account.
    return {**db.get_account_by_id(account["id"]), "groupId": group["groupId"]}, None
