"""Household checklist persistence with independently mutable item rows.

Checklist metadata remains one feed record in ``*-checklists-v2``. Each
checklist item is a separate row in the same group partition, keyed by a stable
``checklist-item#<checklist>#<item>`` sort key. That lets two roommates update
different items without replacing a shared embedded list.
"""

from __future__ import annotations

import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

from db import resource
from group_tables import query_group, query_group_prefix

RECENT_LIMIT = 10
ROW_STORAGE = "rows"
ITEM_PREFIX = "checklist-item"

TABLE_NAME = os.environ.get("CHECKLISTS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-checklists-v2"
)

_table = None
_table_lock = threading.Lock()

EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(checklist_id: str, group_id: str, consistent: bool = True) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": checklist_id}, ConsistentRead=consistent
    ).get("Item")


def _item_row_id(checklist_id: str, item_id: str) -> str:
    return f"{ITEM_PREFIX}#{checklist_id}#{item_id}"


def _item_rows(checklist: dict, group_id: str, consistent: bool = False) -> list[dict]:
    """Read child rows, falling back to the legacy list until migration runs."""
    if checklist.get("itemsStorage") != ROW_STORAGE:
        return list(checklist.get("items") or [])
    rows = query_group_prefix(
        _get_table(), group_id, f"{ITEM_PREFIX}#{checklist['id']}#", consistent=consistent
    )
    return sorted(
        rows, key=lambda row: (int(row.get("sortOrder", 0)), row["id"])
    )


def _clean_item_texts(item_texts: list[str]) -> list[str]:
    return [trimmed for text in item_texts if (trimmed := (text or "").strip())]


def _project_item(raw: dict) -> dict:
    checked_names = raw.get("checkedNamesById") or {}
    checked_ids = sorted(
        set(raw.get("checkedByIds") or []), key=lambda uid: checked_names.get(uid, uid).lower()
    )
    return {
        "id": raw.get("itemId", raw["id"]),
        "text": raw.get("text", ""),
        "checkedByIds": checked_ids,
        "checkedBy": [
            {"id": user_id, "name": checked_names.get(user_id, user_id)}
            for user_id in checked_ids
        ],
    }


def _project(checklist: dict, group_id: str, consistent: bool = False) -> dict:
    archived_at = checklist.get("archivedAt")
    return {
        "id": checklist["id"],
        "title": checklist.get("title", ""),
        "createdBy": checklist.get("createdBy", "Someone"),
        "createdById": checklist.get("createdById"),
        "createdAt": int(checklist["createdAt"]),
        "updatedAt": int(checklist.get("updatedAt", checklist["createdAt"])),
        "items": [_project_item(row) for row in _item_rows(checklist, group_id, consistent)],
        "isArchived": bool(checklist.get("isArchived", False)),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "archivedBy": checklist.get("archivedBy"),
        "archivedById": checklist.get("archivedById"),
    }


def _new_item_row(
    checklist_id: str, item_id: str, group_id: str, text: str, sort_order: int
) -> dict:
    return {
        "groupId": group_id,
        "id": _item_row_id(checklist_id, item_id),
        "parentId": checklist_id,
        "itemId": item_id,
        "recordType": "checklist-item",
        "text": text,
        "sortOrder": sort_order,
        # Keeping this map present allows a nested name update without a
        # document-path validation error.
        "checkedNamesById": {},
    }


def add_checklist(title: str, created_by_id: str, created_by: str, group_id: str, item_texts: list[str]) -> dict:
    now_ms = int(time.time() * 1000)
    checklist_id = uuid.uuid4().hex
    checklist = {
        "id": checklist_id,
        "title": title,
        "createdBy": created_by,
        "createdById": created_by_id,
        "groupId": group_id,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "itemsStorage": ROW_STORAGE,
        "isArchived": False,
    }
    table = _get_table()
    table.put_item(Item=checklist)
    for index, text in enumerate(_clean_item_texts(item_texts)):
        item_id = uuid.uuid4().hex
        table.put_item(Item=_new_item_row(checklist_id, item_id, group_id, text, index))
    return _project(checklist, group_id, consistent=True)


def get(checklist_id: str, group_id: str, consistent: bool = False) -> dict | None:
    checklist = _fetch(checklist_id, group_id, consistent=consistent)
    return _project(checklist, group_id, consistent) if checklist else None


def edit_title_owned(checklist_id: str, creator_id: str, group_id: str, title: str) -> dict | str:
    table = _get_table()
    checklist = _fetch(checklist_id, group_id)
    if checklist is None:
        return EDIT_NOT_FOUND
    if checklist.get("createdById") != creator_id:
        return EDIT_FORBIDDEN
    if checklist.get("isArchived", False):
        return EDIT_READ_ONLY
    if checklist.get("title", "") == title:
        return _project(checklist, group_id)
    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET title = :title, updatedAt = :now",
            ExpressionAttributeValues={
                ":title": title,
                ":now": max(int(time.time() * 1000), int(checklist.get("updatedAt", checklist["createdAt"])) + 1),
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
    return _project(response["Attributes"], group_id, consistent=True)


def _touch_active(checklist_id: str, group_id: str) -> bool:
    """Linearize a child mutation against archive/restore state on its parent."""
    try:
        _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET updatedAt = :now",
            ConditionExpression=(
                "attribute_exists(id) AND itemsStorage = :storage AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ExpressionAttributeValues={
                ":now": int(time.time() * 1000), ":false": False, ":storage": ROW_STORAGE
            },
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True


def _mutate_embedded_items(checklist_id: str, group_id: str, mutate) -> dict | None:
    """Temporary deploy-window support for rows awaiting the data migration."""
    checklist = _fetch(checklist_id, group_id)
    if checklist is None or checklist.get("isArchived"):
        return None
    items = list(checklist.get("items") or [])
    if mutate(items) is False:
        return None
    try:
        response = _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET #items = :items, updatedAt = :now",
            ExpressionAttributeNames={"#items": "items"},
            ExpressionAttributeValues={":items": items, ":now": int(time.time() * 1000), ":false": False},
            ConditionExpression="attribute_exists(id) AND (attribute_not_exists(isArchived) OR isArchived = :false)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def add_item(checklist_id: str, group_id: str, text: str) -> dict | None:
    trimmed = (text or "").strip()
    checklist = _fetch(checklist_id, group_id)
    if not trimmed or checklist is None:
        return None
    if checklist.get("itemsStorage") != ROW_STORAGE:
        return _mutate_embedded_items(
            checklist_id, group_id,
            lambda items: items.append({"id": uuid.uuid4().hex, "text": trimmed, "checkedByIds": [], "checkedNamesById": {}}),
        )
    if not _touch_active(checklist_id, group_id):
        return None
    item_id = uuid.uuid4().hex
    _get_table().put_item(
        Item=_new_item_row(checklist_id, item_id, group_id, trimmed, int(time.time() * 1000)),
        ConditionExpression="attribute_not_exists(id)",
    )
    return get(checklist_id, group_id, consistent=True)


def _fetch_row_item(checklist_id: str, item_id: str, group_id: str) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": _item_row_id(checklist_id, item_id)}, ConsistentRead=True
    ).get("Item")


def toggle_item(checklist_id: str, item_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    checklist = _fetch(checklist_id, group_id)
    if checklist is None:
        return None
    if checklist.get("itemsStorage") != ROW_STORAGE:
        def mutate(items):
            for item in items:
                if item.get("id") == item_id:
                    checked = list(item.get("checkedByIds") or [])
                    names = dict(item.get("checkedNamesById") or {})
                    if user_id in checked:
                        checked.remove(user_id)
                        names.pop(user_id, None)
                    else:
                        checked.append(user_id)
                        names[user_id] = name
                    item["checkedByIds"] = checked
                    item["checkedNamesById"] = names
                    return None
            return False
        return _mutate_embedded_items(checklist_id, group_id, mutate)
    row = _fetch_row_item(checklist_id, item_id, group_id)
    if row is None or not _touch_active(checklist_id, group_id):
        return None
    try:
        if user_id in set(row.get("checkedByIds") or []):
            _get_table().update_item(
                Key={"groupId": group_id, "id": row["id"]},
                UpdateExpression="DELETE checkedByIds :user_ids REMOVE checkedNamesById.#user",
                ExpressionAttributeNames={"#user": user_id},
                ExpressionAttributeValues={":user_ids": {user_id}},
                ConditionExpression="attribute_exists(id)",
            )
        else:
            _get_table().update_item(
                Key={"groupId": group_id, "id": row["id"]},
                UpdateExpression="ADD checkedByIds :user_ids SET checkedNamesById.#user = :name",
                ExpressionAttributeNames={"#user": user_id},
                ExpressionAttributeValues={":user_ids": {user_id}, ":name": name},
                ConditionExpression="attribute_exists(id)",
            )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return get(checklist_id, group_id, consistent=True)


def update_item(checklist_id: str, item_id: str, text: str, group_id: str) -> dict | None:
    trimmed = (text or "").strip()
    checklist = _fetch(checklist_id, group_id)
    if not trimmed or checklist is None:
        return None
    if checklist.get("itemsStorage") != ROW_STORAGE:
        def mutate(items):
            for item in items:
                if item.get("id") == item_id:
                    item["text"] = trimmed
                    return None
            return False
        return _mutate_embedded_items(checklist_id, group_id, mutate)
    if not _touch_active(checklist_id, group_id):
        return None
    try:
        _get_table().update_item(
            Key={"groupId": group_id, "id": _item_row_id(checklist_id, item_id)},
            UpdateExpression="SET #text = :text",
            ExpressionAttributeNames={"#text": "text"},
            ExpressionAttributeValues={":text": trimmed},
            ConditionExpression="attribute_exists(id)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return get(checklist_id, group_id, consistent=True)


def delete_item(checklist_id: str, item_id: str, group_id: str) -> dict | None:
    checklist = _fetch(checklist_id, group_id)
    if checklist is None:
        return None
    if checklist.get("itemsStorage") != ROW_STORAGE:
        def mutate(items):
            remaining = [item for item in items if item.get("id") != item_id]
            if len(remaining) == len(items):
                return False
            items[:] = remaining

        return _mutate_embedded_items(checklist_id, group_id, mutate)
    if _fetch_row_item(checklist_id, item_id, group_id) is None or not _touch_active(checklist_id, group_id):
        return None
    _get_table().delete_item(Key={"groupId": group_id, "id": _item_row_id(checklist_id, item_id)})
    return get(checklist_id, group_id, consistent=True)


def archive(checklist_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    try:
        response = _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET isArchived = :true, archivedAt = :now, archivedById = :user, archivedBy = :name, updatedAt = :now",
            ExpressionAttributeValues={":true": True, ":now": int(time.time() * 1000), ":user": user_id, ":name": name},
            ConditionExpression="attribute_exists(id)", ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def restore(checklist_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    try:
        response = _get_table().update_item(
            Key={"groupId": group_id, "id": checklist_id},
            UpdateExpression="SET isArchived = :false, restoredById = :user, restoredBy = :name, updatedAt = :now REMOVE archivedAt, archivedById, archivedBy",
            ExpressionAttributeValues={":false": False, ":user": user_id, ":name": name, ":now": int(time.time() * 1000)},
            ConditionExpression="attribute_exists(id)", ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def delete(checklist_id: str, group_id: str) -> dict | None:
    checklist = _fetch(checklist_id, group_id)
    if checklist is None:
        return None
    table = _get_table()
    table.delete_item(Key={"groupId": group_id, "id": checklist_id})
    if checklist.get("itemsStorage") == ROW_STORAGE:
        with table.batch_writer() as batch:
            for row in _item_rows(checklist, group_id, consistent=True):
                batch.delete_item(Key={"groupId": group_id, "id": row["id"]})
    return _project(checklist, group_id)


def list_recent(group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    checklists = [
        item for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item and not item.get("parentId")
    ]
    checklists.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [_project(item, group_id, consistent) for item in checklists[:limit]]
