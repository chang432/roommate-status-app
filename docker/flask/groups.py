"""Group metadata and join-code lookup for the Roomie Status backend."""

from __future__ import annotations

import os
import re
import secrets
import threading
import time

from botocore.exceptions import ClientError

import db
import book_club

GROUPS_TABLE = os.environ.get("GROUPS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-groups"
)
JOIN_CODE_INDEX = "JoinCodeIndex"
DEFAULT_GROUP_JOIN_CODE = os.environ.get("DEFAULT_GROUP_JOIN_CODE", "YORKSHIRE")
JOIN_CODE_RE = re.compile(r"^[A-Z0-9]{6,16}$")
GROUP_SLUG_RE = re.compile(r"[^a-z0-9]+")
GROUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
GROUP_MODULE_IDS = (
    "roster",
    "events",
    "requests",
    "checklists",
    "polls",
    "counters",
    "tv",
    "spotify",
    "book-club",
    "forums",
)
VALID_GROUP_MODULES = set(GROUP_MODULE_IDS)
# Counters are deliberately opt-in even for the broad default household.
DEFAULT_GROUP_MODULE_IDS = tuple(
    module_id for module_id in GROUP_MODULE_IDS if module_id != "counters"
)
VALID_THEMES = {"system", "light", "dark", "forest"}

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
    if "enabledModules" in item:
        enabled_modules = [
            module_id for module_id in GROUP_MODULE_IDS if module_id in item["enabledModules"]
        ]
    else:
        # The deploy runs before the migration. This projection preserves the
        # legacy visibility during that short expand/contract window.
        enabled_modules = []
        if item.get("showRoster", True):
            enabled_modules.append("roster")
        if item.get("showFeed", True):
            enabled_modules.extend(("events", "requests", "checklists", "polls", "tv"))
        enabled_modules.append("spotify")
        if item.get("showBookClub", True):
            enabled_modules.extend(("book-club", "forums"))
    return {
        "groupId": item["groupId"],
        "name": item.get("name", item["groupId"]),
        "joinCode": item["joinCode"],
        "createdAt": int(item["createdAt"]) if item.get("createdAt") is not None else None,
        "enabledModules": enabled_modules,
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
                "enabledModules": list(DEFAULT_GROUP_MODULE_IDS),
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


def ensure_seed_group(
    group_id: str,
    name: str,
    join_code: str,
    *,
    enabled_modules: list[str],
) -> dict:
    """Create or refresh a named development seed group.

    Seed groups use stable ids and join codes so repeated local starts converge
    on the same data instead of accumulating a new random household each time.
    This helper is called only by ``seed.py``; user-created groups still keep
    their independently chosen display settings.
    """
    code = normalize_join_code(join_code)
    if not valid_join_code(code):
        raise ValueError("Seed group join codes must be 6-16 alphanumeric characters.")
    table = _get_table()
    now = int(time.time() * 1000)
    item = {
        "groupId": group_id,
        "name": name,
        "joinCode": code,
        "createdAt": now,
        "enabledModules": [
            module_id for module_id in GROUP_MODULE_IDS if module_id in enabled_modules
        ],
    }
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(groupId)")
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Local seeds are a known fixture, so their selected sections should be
        # restored on every restart without changing their original createdAt.
        table.update_item(
            Key={"groupId": group_id},
            UpdateExpression=(
                "SET #name = :name, joinCode = :joinCode, "
                "enabledModules = :enabledModules"
            ),
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={
                ":name": name,
                ":joinCode": code,
                ":enabledModules": item["enabledModules"],
            },
            ConditionExpression="attribute_exists(groupId)",
        )
    return get_group_by_id(group_id)


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
        personalize_group(group, user_id)
        for group_id in db.get_group_ids(user_id)
        if (group := get_group_by_id(group_id)) is not None
    ]


def personalize_group(group: dict, user_id: str) -> dict:
    membership = db.get_membership(user_id, group["groupId"])
    return {
        **group,
        "viewerIsAdmin": bool(
            membership and membership.get("role", db.ROLE_MEMBER) == db.ROLE_ADMIN
        ),
        "theme": membership.get("theme", "system") if membership else "system",
    }


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
            # New households start with no shared modules visible. An admin
            # explicitly enables the surfaces they want from group settings.
            "enabledModules": [],
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
    # Existing clubs keep both current owners; joiners become later choices.
    book_club.add_member_to_owner_lists(group["groupId"], account["id"])
    # The client switches to the group it just joined, even if lexical group
    # ordering would make a different membership appear first on the account.
    return {**db.get_account_by_id(account["id"]), "groupId": group["groupId"]}, None


def set_enabled_modules(
    actor_id: str, group_id: str, enabled_modules: list[str]
) -> tuple[dict | None, str | None]:
    """Update one household's enabled UI surfaces for a group admin."""
    if not db.is_group_admin(actor_id, group_id):
        return None, "forbidden"
    if not isinstance(enabled_modules, list) or any(
        not isinstance(module_id, str) or module_id not in VALID_GROUP_MODULES
        for module_id in enabled_modules
    ):
        return None, "invalid_modules"
    normalized = [module_id for module_id in GROUP_MODULE_IDS if module_id in enabled_modules]
    try:
        _get_table().update_item(
            Key={"groupId": group_id},
            UpdateExpression="SET enabledModules = :enabledModules",
            ExpressionAttributeValues={":enabledModules": normalized},
            ConditionExpression="attribute_exists(groupId)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "unknown_group"
        raise
    return get_group_by_id(group_id), None


def rename_group(actor_id: str, group_id: str, name: str) -> tuple[dict | None, str | None]:
    if not db.is_group_admin(actor_id, group_id):
        return None, "forbidden"
    display_name = (name or "").strip()
    if not display_name or len(display_name) > 80:
        return None, "invalid_name"
    try:
        _get_table().update_item(
            Key={"groupId": group_id},
            UpdateExpression="SET #name = :name",
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={":name": display_name},
            ConditionExpression="attribute_exists(groupId)",
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "unknown_group"
        raise
    return get_group_by_id(group_id), None


def set_member_theme(user_id: str, group_id: str, theme: str) -> tuple[str | None, str | None]:
    if theme not in VALID_THEMES:
        return None, "invalid_theme"
    try:
        db._get_memberships_table().update_item(
            Key={"groupId": group_id, "userId": user_id},
            UpdateExpression="SET theme = :theme",
            ExpressionAttributeValues={":theme": theme},
            ConditionExpression="attribute_exists(groupId) AND attribute_exists(userId)",
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "unknown_member"
        raise
    return theme, None


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
    if not db.delete_membership(target_id, group_id):
        return "unknown_member"
    book_club.remove_member_from_owner_lists(group_id, target_id)
    return None


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
