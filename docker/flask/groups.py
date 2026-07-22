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
        # Older group rows predate display controls. Treat absent values as
        # visible so deploying this change never hides a household by default.
        "showRoster": item.get("showRoster", True),
        "showFeed": item.get("showFeed", True),
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
                "showRoster": True,
                "showFeed": True,
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
            "showRoster": True,
            "showFeed": True,
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

        # Whoever creates the household administers it until they promote others.
        membership = db.create_membership(
            account["id"], group_id, account["name"], role=db.ROLE_ADMIN
        )
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


def set_display_options(
    actor_id: str, group_id: str, show_roster: bool, show_feed: bool
) -> tuple[dict | None, str | None]:
    """Update one household's shared section visibility for a group admin."""
    if not db.is_group_admin(actor_id, group_id):
        return None, "forbidden"
    try:
        _get_table().update_item(
            Key={"groupId": group_id},
            UpdateExpression="SET showRoster = :showRoster, showFeed = :showFeed",
            ExpressionAttributeValues={
                ":showRoster": show_roster,
                ":showFeed": show_feed,
            },
            ConditionExpression="attribute_exists(groupId)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "unknown_group"
        raise
    return get_group_by_id(group_id), None


def _authorize_admin_action(
    actor_id: str, group_id: str, target_id: str
) -> tuple[str | None, str | None]:
    """Shared guard for the admin-only member actions.

    Returns (target_role, error). Both actor and target must belong to the
    group, and only an admin may act.
    """
    if not db.is_group_admin(actor_id, group_id):
        return None, "forbidden"
    target_role = db.get_membership_role(target_id, group_id)
    if target_role is None:
        return None, "unknown_member"
    return target_role, None


def remove_member(actor_id: str, group_id: str, target_id: str) -> str | None:
    """Drop another member from the group. Returns an error code or None.

    Admins are peers, so one cannot remove another; demote them first. That also
    means the group can never lose its last admin through a removal.
    """
    target_role, error = _authorize_admin_action(actor_id, group_id, target_id)
    if error:
        return error
    if actor_id == target_id:
        return "self_removal"
    if target_role == db.ROLE_ADMIN:
        return "admin_target"
    return None if db.delete_membership(target_id, group_id) else "unknown_member"


def set_member_role(actor_id: str, group_id: str, target_id: str, role: str) -> str | None:
    """Grant or revoke admin on another member. Returns an error code or None."""
    if role not in db.VALID_ROLES:
        return "invalid_role"
    target_role, error = _authorize_admin_action(actor_id, group_id, target_id)
    if error:
        return error
    if target_role == role:
        return None
    # Demoting the only admin would leave the household with nobody able to
    # administer it, so the last admin must promote a successor first.
    if role == db.ROLE_MEMBER and db.group_admin_ids(group_id) == [target_id]:
        return "last_admin"
    return None if db.set_membership_role(target_id, group_id, role) else "unknown_member"
