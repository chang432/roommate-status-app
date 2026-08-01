"""TV show persistence with independently mutable watcher rows.

Show metadata and watchparty state remain one feed record. Every watcher's
progress lives in a child row in the same group partition, preventing one
watcher's update from replacing the complete watcher collection.
"""

from __future__ import annotations

import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

from db import resource
from group_tables import query_group, query_group_prefix

RECENT_LIMIT = 20
PROGRESS_FIELDS = ("season", "episode")
ROW_STORAGE = "rows"
WATCHER_PREFIX = "show-watcher"

MUTATION_ARCHIVED = "archived"
WATCHPARTY_EMPTY = "empty"
DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"

TABLE_NAME = os.environ.get("SHOWS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-shows-v2"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(show_id: str, group_id: str, consistent: bool = True) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": show_id}, ConsistentRead=consistent
    ).get("Item")


def _watcher_row_id(show_id: str, user_id: str) -> str:
    return f"{WATCHER_PREFIX}#{show_id}#{user_id}"


def _watcher_rows(show: dict, group_id: str, consistent: bool = False) -> list[dict]:
    """Read child rows, falling back to embedded members during deployment."""
    if show.get("membersStorage") != ROW_STORAGE:
        return list(show.get("members") or [])
    rows = query_group_prefix(
        _get_table(), group_id, f"{WATCHER_PREFIX}#{show['id']}#", consistent=consistent
    )
    return sorted(rows, key=lambda row: (int(row.get("sortOrder", 0)), row["id"]))


def _project_member(raw: dict) -> dict:
    return {
        "id": raw.get("userId", raw.get("id")),
        "name": raw.get("name", raw.get("userId", raw.get("id"))),
        "season": int(raw.get("season", 1)),
        "episode": int(raw.get("episode", 1)),
    }


def _project(show: dict, group_id: str, consistent: bool = False) -> dict:
    archived_at = show.get("archivedAt")
    return {
        "id": show["id"],
        "title": show.get("title", ""),
        "createdBy": show.get("createdBy", "Someone"),
        "createdById": show.get("createdById"),
        "groupId": show.get("groupId"),
        "createdAt": int(show["createdAt"]),
        "updatedAt": int(show.get("updatedAt", show["createdAt"])),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "isArchived": bool(show.get("isArchived", False)),
        "archivedBy": show.get("archivedBy"),
        "archivedById": show.get("archivedById"),
        "isWatchpartyLive": show.get("watchpartyStartedAt") is not None,
        "watchpartyStartedAt": int(show["watchpartyStartedAt"]) if show.get("watchpartyStartedAt") is not None else None,
        "watchpartyStartedBy": show.get("watchpartyStartedBy"),
        "watchpartyStartedById": show.get("watchpartyStartedById"),
        "watchpartySeason": int(show["watchpartySeason"]) if show.get("watchpartySeason") is not None else None,
        "watchpartyEpisode": int(show["watchpartyEpisode"]) if show.get("watchpartyEpisode") is not None else None,
        "members": [_project_member(row) for row in _watcher_rows(show, group_id, consistent)],
    }


def _new_watcher_row(show_id: str, user_id: str, name: str, group_id: str, sort_order: int) -> dict:
    return {
        "groupId": group_id,
        "id": _watcher_row_id(show_id, user_id),
        "parentId": show_id,
        "userId": user_id,
        "recordType": "show-watcher",
        "name": name,
        "season": 1,
        "episode": 1,
        "sortOrder": sort_order,
    }


def add_show(title: str, created_by_id: str, created_by: str, group_id: str) -> dict:
    now_ms = int(time.time() * 1000)
    show_id = uuid.uuid4().hex
    show = {
        "id": show_id,
        "title": title,
        "createdBy": created_by,
        "createdById": created_by_id,
        "groupId": group_id,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "membersStorage": ROW_STORAGE,
    }
    table = _get_table()
    table.put_item(Item=show)
    table.put_item(Item=_new_watcher_row(show_id, created_by_id, created_by, group_id, 0))
    return _project(show, group_id, consistent=True)


def get(show_id: str, group_id: str, consistent: bool = False) -> dict | None:
    show = _fetch(show_id, group_id, consistent=consistent)
    return _project(show, group_id, consistent) if show else None


def edit_title_owned(show_id: str, creator_id: str, group_id: str, title: str) -> dict | str:
    table = _get_table()
    show = _fetch(show_id, group_id)
    if show is None:
        return EDIT_NOT_FOUND
    if show.get("createdById") != creator_id:
        return EDIT_FORBIDDEN
    if show.get("isArchived", False):
        return EDIT_READ_ONLY
    if show.get("title", "") == title:
        return _project(show, group_id)
    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": show_id},
            UpdateExpression="SET title = :title, updatedAt = :now",
            ExpressionAttributeValues={
                ":title": title,
                ":now": max(int(time.time() * 1000), int(show.get("updatedAt", show["createdAt"])) + 1),
                ":creator": creator_id,
                ":false": False,
            },
            ConditionExpression="attribute_exists(id) AND createdById = :creator AND (attribute_not_exists(isArchived) OR isArchived = :false)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return EDIT_READ_ONLY
    return _project(response["Attributes"], group_id, consistent=True)


def list_recent(group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    shows = [
        item for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item and not item.get("parentId")
    ]
    shows.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [_project(item, group_id, consistent) for item in shows[:limit]]


def _touch_active(show_id: str, group_id: str) -> bool:
    """Linearize a watcher mutation against the parent archive state."""
    try:
        _get_table().update_item(
            Key={"groupId": group_id, "id": show_id},
            UpdateExpression="SET updatedAt = :now",
            ExpressionAttributeValues={":now": int(time.time() * 1000), ":false": False, ":storage": ROW_STORAGE},
            ConditionExpression="attribute_exists(id) AND membersStorage = :storage AND (attribute_not_exists(isArchived) OR isArchived = :false)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True


def _mutate_embedded_members(show_id: str, group_id: str, mutate):
    """Temporary deploy-window support for legacy rows awaiting migration."""
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("isArchived", False):
        return MUTATION_ARCHIVED
    members = [dict(member) for member in (show.get("members") or [])]
    if mutate(members) is False:
        return None
    try:
        response = _get_table().update_item(
            Key={"groupId": group_id, "id": show_id},
            UpdateExpression="SET #members = :members, updatedAt = :now",
            ExpressionAttributeNames={"#members": "members"},
            ExpressionAttributeValues={":members": members, ":now": int(time.time() * 1000), ":false": False},
            ConditionExpression="attribute_exists(id) AND (attribute_not_exists(isArchived) OR isArchived = :false)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def join(show_id: str, user_id: str, name: str, group_id: str):
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("membersStorage") != ROW_STORAGE:
        def mutate(members):
            if not any(member.get("id") == user_id for member in members):
                members.append({"id": user_id, "name": name, "season": 1, "episode": 1})
        return _mutate_embedded_members(show_id, group_id, mutate)
    if not _touch_active(show_id, group_id):
        return MUTATION_ARCHIVED
    try:
        _get_table().put_item(
            Item=_new_watcher_row(show_id, user_id, name, group_id, int(time.time() * 1000)),
            ConditionExpression="attribute_not_exists(id)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
    return get(show_id, group_id, consistent=True)


def leave(show_id: str, user_id: str, group_id: str):
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("membersStorage") != ROW_STORAGE:
        return _mutate_embedded_members(
            show_id, group_id,
            lambda members: members.__setitem__(slice(None), [member for member in members if member.get("id") != user_id]),
        )
    if not _touch_active(show_id, group_id):
        return MUTATION_ARCHIVED
    _get_table().delete_item(Key={"groupId": group_id, "id": _watcher_row_id(show_id, user_id)})
    return get(show_id, group_id, consistent=True)


def _write_progress(member: dict, field: str, value) -> None:
    member[field] = max(1, int(value))
    if field == "season":
        member["episode"] = 1


def _fetch_watcher(show_id: str, member_id: str, group_id: str) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": _watcher_row_id(show_id, member_id)}, ConsistentRead=True
    ).get("Item")


def set_progress(show_id: str, member_id: str, field: str, value, group_id: str):
    if field not in PROGRESS_FIELDS:
        return None
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("membersStorage") != ROW_STORAGE:
        def mutate(members):
            for member in members:
                if member.get("id") == member_id:
                    _write_progress(member, field, value)
                    return None
            return False
        return _mutate_embedded_members(show_id, group_id, mutate)
    if _fetch_watcher(show_id, member_id, group_id) is None:
        return None
    if not _touch_active(show_id, group_id):
        return MUTATION_ARCHIVED
    expression = "SET #field = :value"
    names = {"#field": field}
    values = {":value": max(1, int(value))}
    if field == "season":
        expression += ", episode = :one"
        values[":one"] = 1
    try:
        _get_table().update_item(
            Key={"groupId": group_id, "id": _watcher_row_id(show_id, member_id)},
            UpdateExpression=expression, ExpressionAttributeNames=names,
            ExpressionAttributeValues=values, ConditionExpression="attribute_exists(id)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return get(show_id, group_id, consistent=True)


def adjust_progress(show_id: str, member_id: str, field: str, delta: int, group_id: str):
    if field not in PROGRESS_FIELDS:
        return None
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("membersStorage") != ROW_STORAGE:
        def mutate(members):
            for member in members:
                if member.get("id") == member_id:
                    _write_progress(member, field, int(member.get(field, 1)) + delta)
                    return None
            return False
        return _mutate_embedded_members(show_id, group_id, mutate)
    if not _touch_active(show_id, group_id):
        return MUTATION_ARCHIVED
    # Compare-and-set retries preserve concurrent increments to one watcher's
    # progress without touching any other watcher row.
    for _ in range(5):
        watcher = _fetch_watcher(show_id, member_id, group_id)
        if watcher is None:
            return None
        current = int(watcher.get(field, 1))
        next_value = max(1, current + delta)
        expression = "SET #field = :next"
        values = {":next": next_value, ":current": current}
        if field == "season":
            expression += ", episode = :one"
            values[":one"] = 1
        try:
            _get_table().update_item(
                Key={"groupId": group_id, "id": watcher["id"]},
                UpdateExpression=expression, ExpressionAttributeNames={"#field": field},
                ExpressionAttributeValues=values,
                ConditionExpression="attribute_exists(id) AND #field = :current",
            )
            return get(show_id, group_id, consistent=True)
        except ClientError as err:
            if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return None


def set_watchparty(show_id: str, user_id: str, name: str, group_id: str, live: bool, season: int | None = None, episode: int | None = None):
    table = _get_table()
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    if show.get("isArchived", False):
        return MUTATION_ARCHIVED
    if live and not _watcher_rows(show, group_id, consistent=True):
        return WATCHPARTY_EMPTY
    now_ms = int(time.time() * 1000)
    if live:
        update = {
            "UpdateExpression": "SET watchpartyStartedAt = :now, watchpartyStartedById = :user, watchpartyStartedBy = :name, watchpartySeason = :season, watchpartyEpisode = :episode, updatedAt = :now",
            "ExpressionAttributeValues": {":now": now_ms, ":user": user_id, ":name": name, ":season": max(1, int(season or 1)), ":episode": max(1, int(episode or 1)), ":false": False},
        }
    else:
        update = {
            "UpdateExpression": "SET updatedAt = :now REMOVE watchpartyStartedAt, watchpartyStartedById, watchpartyStartedBy, watchpartySeason, watchpartyEpisode",
            "ExpressionAttributeValues": {":now": now_ms, ":false": False},
        }
    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": show_id},
            ConditionExpression="attribute_exists(id) AND (attribute_not_exists(isArchived) OR isArchived = :false)",
            ReturnValues="ALL_NEW", **update,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def start_watchparty(show_id: str, user_id: str, name: str, group_id: str, season: int | None = None, episode: int | None = None):
    return set_watchparty(show_id, user_id, name, group_id, True, season, episode)


def end_watchparty(show_id: str, user_id: str, name: str, group_id: str):
    return set_watchparty(show_id, user_id, name, group_id, False)


def _set_archived(show_id: str, user_id: str, name: str, group_id: str, archived: bool):
    show = _fetch(show_id, group_id)
    if show is None:
        return None
    now_ms = int(time.time() * 1000)
    if archived:
        update = {
            "UpdateExpression": "SET isArchived = :true, archivedAt = :now, archivedById = :user, archivedBy = :name, updatedAt = :now",
            "ExpressionAttributeValues": {":true": True, ":now": now_ms, ":user": user_id, ":name": name},
        }
    else:
        update = {
            "UpdateExpression": "SET isArchived = :false, restoredById = :user, restoredBy = :name, updatedAt = :now REMOVE archivedAt, archivedById, archivedBy",
            "ExpressionAttributeValues": {":false": False, ":now": now_ms, ":user": user_id, ":name": name},
        }
    try:
        response = _get_table().update_item(
            Key={"groupId": group_id, "id": show_id}, ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW", **update,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(response["Attributes"], group_id, consistent=True)


def archive(show_id: str, user_id: str, name: str, group_id: str):
    return _set_archived(show_id, user_id, name, group_id, True)


def restore(show_id: str, user_id: str, name: str, group_id: str):
    return _set_archived(show_id, user_id, name, group_id, False)


def delete(show_id: str, group_id: str) -> str:
    show = _fetch(show_id, group_id)
    if show is None:
        return DELETE_NOT_FOUND
    table = _get_table()
    table.delete_item(Key={"groupId": group_id, "id": show_id})
    if show.get("membersStorage") == ROW_STORAGE:
        with table.batch_writer() as batch:
            for row in _watcher_rows(show, group_id, consistent=True):
                batch.delete_item(Key={"groupId": group_id, "id": row["id"]})
    return DELETE_OK
