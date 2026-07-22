"""Household checklist feed for the Roomie Status backend.

Each checklist is one item in its own DynamoDB table
(RoommateStatus-*-checklists-v2), separate from the roommate and activities
tables so every feed's read stays clean — the same "own table per concern"
pattern activities.py and household_shows.py follow. Checklist items (with their
per-roommate check state) are embedded on the checklist item, so a checklist is a
single read/write. The table is keyed ``(groupId HASH, id RANGE)``; see
group_tables.py for why the group is the partition key.

Configuration (env):
    CHECKLISTS_TABLE  - override the table name
                        (default: "${ROOMMATE_TABLE}-checklists-v2")
"""

from __future__ import annotations

import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource
from group_tables import query_group

RECENT_LIMIT = 10

TABLE_NAME = os.environ.get("CHECKLISTS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-checklists-v2"
)

_table = None
_table_lock = threading.Lock()

EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"


def _get_table():
    """Return the cached Checklists Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(checklist_id: str, group_id: str, consistent: bool = True) -> dict | None:
    """Read one checklist by its full key, or None when it isn't in this group.

    The group is half the primary key, so an id from another household simply
    doesn't resolve — no post-read ownership check is needed.
    """
    return _get_table().get_item(
        Key={"groupId": group_id, "id": checklist_id},
        ConsistentRead=consistent,
    ).get("Item")


def _clean_item_texts(item_texts: list[str]) -> list[str]:
    cleaned = []
    for text in item_texts:
        trimmed = (text or "").strip()
        if trimmed:
            cleaned.append(trimmed)
    return cleaned


def _project_item(raw: dict) -> dict:
    checked_names = raw.get("checkedNamesById") or {}
    checked_ids = sorted(set(raw.get("checkedByIds") or []), key=lambda uid: checked_names.get(uid, uid).lower())
    return {
        "id": raw["id"],
        "text": raw.get("text", ""),
        "checkedByIds": checked_ids,
        "checkedBy": [
            {"id": user_id, "name": checked_names.get(user_id, user_id)}
            for user_id in checked_ids
        ],
    }


def _project(item: dict) -> dict:
    archived_at = item.get("archivedAt")
    return {
        "id": item["id"],
        "title": item.get("title", ""),
        "createdBy": item.get("createdBy", "Someone"),
        "createdById": item.get("createdById"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "items": [_project_item(raw) for raw in item.get("items") or []],
        "isArchived": bool(item.get("isArchived", False)),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "archivedBy": item.get("archivedBy"),
        "archivedById": item.get("archivedById"),
    }


def add_checklist(
    title: str,
    created_by_id: str,
    created_by: str,
    group_id: str,
    item_texts: list[str],
) -> dict:
    now_ms = int(time.time() * 1000)
    item = {
        "id": uuid.uuid4().hex,
        "title": title,
        "createdBy": created_by,
        "createdById": created_by_id,
        "groupId": group_id,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "items": [
            {
                "id": uuid.uuid4().hex,
                "text": text,
                "checkedByIds": [],
                "checkedNamesById": {},
            }
            for text in _clean_item_texts(item_texts)
        ],
        "isArchived": False,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(checklist_id: str, group_id: str, consistent: bool = False) -> dict | None:
    item = _fetch(checklist_id, group_id, consistent=consistent)
    return _project(item) if item else None


def edit_title_owned(
    checklist_id: str, creator_id: str, group_id: str, title: str
) -> dict | str:
    table = _get_table()
    item = _fetch(checklist_id, group_id)
    if item is None:
        return EDIT_NOT_FOUND
    if item.get("createdById") != creator_id:
        return EDIT_FORBIDDEN
    if item.get("isArchived", False):
        return EDIT_READ_ONLY
    if item.get("title", "") == title:
        return _project(item)
    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET title = :title, updatedAt = :now",
            ExpressionAttributeValues={
                ":title": title,
                ":now": max(
                    int(time.time() * 1000),
                    int(item.get("updatedAt", item["createdAt"])) + 1,
                ),
                ":creator": creator_id,
                ":false": False,
            },
            ConditionExpression=(
                "attribute_exists(id) AND createdById = :creator AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return EDIT_READ_ONLY
    return _project(response["Attributes"])


def _mutate_items(checklist_id: str, group_id: str, mutate) -> dict | None:
    table = _get_table()
    item = _fetch(checklist_id, group_id)
    if item is None:
        return None
    if item.get("isArchived"):
        return None

    items = list(item.get("items") or [])
    if mutate(items) is False:
        return None

    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET #items = :items, updatedAt = :updated_at",
            ExpressionAttributeNames={"#items": "items"},
            ExpressionAttributeValues={
                ":false": False,
                ":items": items,
                ":updated_at": int(time.time() * 1000),
            },
            ConditionExpression=(
                "attribute_exists(id) AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def add_item(checklist_id: str, group_id: str, text: str) -> dict | None:
    trimmed = (text or "").strip()
    if not trimmed:
        return None

    def mutate(items: list[dict]):
        items.append(
            {
                "id": uuid.uuid4().hex,
                "text": trimmed,
                "checkedByIds": [],
                "checkedNamesById": {},
            }
        )

    return _mutate_items(checklist_id, group_id, mutate)


def toggle_item(checklist_id: str, item_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    def mutate(items: list[dict]):
        for item in items:
            if item.get("id") != item_id:
                continue
            checked_ids = list(item.get("checkedByIds") or [])
            checked_names = dict(item.get("checkedNamesById") or {})
            if user_id in checked_ids:
                checked_ids = [candidate for candidate in checked_ids if candidate != user_id]
                checked_names.pop(user_id, None)
            else:
                checked_ids.append(user_id)
                checked_names[user_id] = name
            item["checkedByIds"] = checked_ids
            item["checkedNamesById"] = checked_names
            return None
        return False

    return _mutate_items(checklist_id, group_id, mutate)


def update_item(checklist_id: str, item_id: str, text: str, group_id: str) -> dict | None:
    trimmed = (text or "").strip()
    if not trimmed:
        return None

    def mutate(items: list[dict]):
        for item in items:
            if item.get("id") == item_id:
                item["text"] = trimmed
                return None
        return False

    return _mutate_items(checklist_id, group_id, mutate)


def delete_item(checklist_id: str, item_id: str, group_id: str) -> dict | None:
    def mutate(items: list[dict]):
        next_items = [item for item in items if item.get("id") != item_id]
        if len(next_items) == len(items):
            return False
        items[:] = next_items
        return None

    return _mutate_items(checklist_id, group_id, mutate)


def archive(checklist_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    archived_at = int(time.time() * 1000)
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression=(
                "SET isArchived = :true, archivedAt = :archived_at, "
                "archivedById = :user_id, archivedBy = :name, updatedAt = :archived_at"
            ),
            ExpressionAttributeValues={
                ":true": True,
                ":archived_at": archived_at,
                ":user_id": user_id,
                ":name": name,
            },
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def restore(checklist_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression=(
                "SET isArchived = :false, restoredById = :user_id, "
                "restoredBy = :name, updatedAt = :updated_at "
                "REMOVE archivedAt, archivedById, archivedBy"
            ),
            ExpressionAttributeValues={
                ":false": False,
                ":user_id": user_id,
                ":name": name,
                ":updated_at": int(time.time() * 1000),
            },
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def delete(checklist_id: str, group_id: str) -> dict | None:
    item = _fetch(checklist_id, group_id)
    if item is None:
        return None
    _get_table().delete_item(Key={"groupId": group_id, "id": checklist_id})
    return _project(item)


def list_recent(group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    checklists = [
        item
        for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item
    ]
    checklists.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [_project(item) for item in checklists[:limit]]
