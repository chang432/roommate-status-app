"""TV show tracker feed for the Roomie Status backend.

Each show is one item in its own DynamoDB table (RoommateStatus-*-shows),
separate from the roommate and activities tables so the household scan in db.py
and the activity/checklist feed both stay clean — the same "own table per
concern" pattern activities.py follows. Watchers are embedded on the show item
(like checklist items), each tracking their own season and episode, so a show is
a single read/write.

Configuration (env):
    SHOWS_TABLE  - override the table name (default: "${ROOMMATE_TABLE}-shows")
"""

from __future__ import annotations

import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

import db

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

RECENT_LIMIT = 20

# Season and episode are both 1-based; each watcher tracks their own pair.
PROGRESS_FIELDS = ("season", "episode")

# Distinct non-None results from the mutation helpers, so routes can map an
# outcome to an HTTP status without touching boto3 details.
MUTATION_ARCHIVED = "archived"  # edit rejected: the show is archived (read-only)
DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"

TABLE_NAME = os.environ.get("SHOWS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-shows"
)

_table = None
_table_lock = threading.Lock()


def backfill_default_group_records() -> None:
    """Assign the seeded group to legacy shows that predate group isolation."""
    table = _get_table()
    for item in _scan_all(consistent=True):
        if item.get("groupId"):
            continue
        table.update_item(
            Key={"id": item["id"]},
            UpdateExpression="SET groupId = :groupId",
            ExpressionAttributeValues={":groupId": db.DEFAULT_GROUP_ID},
            ConditionExpression="attribute_exists(id) AND attribute_not_exists(groupId)",
        )


def _get_table():
    """Return the cached Shows Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _scan_all(consistent: bool = False) -> list[dict]:
    """Return every show item, paging through the scan. The data set is tiny
    (household scale), so a full scan + in-app sort is the right tool here."""
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


def _project_member(raw: dict) -> dict:
    return {
        "id": raw.get("id"),
        "name": raw.get("name", raw.get("id")),
        "season": int(raw.get("season", 1)),
        "episode": int(raw.get("episode", 1)),
    }


def _project(item: dict) -> dict:
    """Project a raw item to the exact shape the frontend expects."""
    archived_at = item.get("archivedAt")
    return {
        "id": item["id"],
        "title": item.get("title", ""),
        "createdBy": item.get("createdBy", "Someone"),
        "createdById": item.get("createdById"),
        "groupId": item.get("groupId"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "isArchived": bool(item.get("isArchived", False)),
        "archivedBy": item.get("archivedBy"),
        "archivedById": item.get("archivedById"),
        "members": [_project_member(raw) for raw in item.get("members") or []],
    }


def _in_group(item: dict | None, group_id: str | None) -> bool:
    return item is not None and item.get("groupId") == group_id


def add_show(title: str, created_by_id: str, created_by: str, group_id: str) -> dict:
    """Create a show, auto-joining the creator as the first watcher at S1 E1."""
    now_ms = int(time.time() * 1000)
    item = {
        "id": uuid.uuid4().hex,
        "title": title,
        "createdBy": created_by,
        "createdById": created_by_id,
        "groupId": group_id,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "members": [
            {"id": created_by_id, "name": created_by, "season": 1, "episode": 1}
        ],
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(show_id: str, group_id: str, consistent: bool = False) -> dict | None:
    item = _get_table().get_item(
        Key={"id": show_id}, ConsistentRead=consistent
    ).get("Item")
    return _project(item) if _in_group(item, group_id) else None


def edit_title_owned(show_id: str, creator_id: str, group_id: str, title: str) -> dict | str:
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if not _in_group(item, group_id):
        return EDIT_NOT_FOUND
    if item.get("createdById") != creator_id:
        return EDIT_FORBIDDEN
    if item.get("isArchived", False):
        return EDIT_READ_ONLY
    if item.get("title", "") == title:
        return _project(item)
    try:
        response = table.update_item(
            Key={"id": show_id},
            UpdateExpression="SET title = :title, updatedAt = :now",
            ExpressionAttributeValues={
                ":title": title,
                ":now": max(
                    int(time.time() * 1000),
                    int(item.get("updatedAt", item["createdAt"])) + 1,
                ),
                ":groupId": group_id,
                ":creator": creator_id,
                ":false": False,
            },
            ConditionExpression=(
                "attribute_exists(id) AND groupId = :groupId AND createdById = :creator AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return EDIT_READ_ONLY
    return _project(response["Attributes"])


def list_recent(
    group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False
) -> list[dict]:
    """Return the group's recent shows, newest first. Active/completed split and
    per-watcher ordering are done in the frontend, so this stays a recency
    sort scoped to the caller's group."""
    shows = [
        item
        for item in _scan_all(consistent=consistent)
        if (
            "createdAt" in item
            and item.get("groupId") == group_id
        )
    ]
    shows.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [_project(item) for item in shows[:limit]]


def _mutate_members(show_id: str, group_id: str, mutate):
    """Load a show, run `mutate(members)`, and persist with an optimistic write.

    `mutate` edits the members list in place; returning False means "no change"
    (e.g. member not found) so the caller gets None. A show in another group is
    invisible here (returns None). Completed shows are read-only and yield
    MUTATION_COMPLETED. The conditional update also re-checks the group and the
    archived flag to guard against a concurrent change between read and write.
    """
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if not _in_group(item, group_id):
        return None
    if item.get("isArchived", False):
        return MUTATION_ARCHIVED

    members = [dict(member) for member in (item.get("members") or [])]
    if mutate(members) is False:
        return None

    try:
        resp = table.update_item(
            Key={"id": show_id},
            UpdateExpression="SET #members = :members, updatedAt = :updated_at",
            ExpressionAttributeNames={"#members": "members"},
            ExpressionAttributeValues={
                ":members": members,
                ":updated_at": int(time.time() * 1000),
                ":false": False,
                ":groupId": group_id,
            },
            ConditionExpression=(
                "attribute_exists(id) AND groupId = :groupId AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def join(show_id: str, user_id: str, name: str, group_id: str):
    """Add a watcher if not already present (idempotent); returns the snapshot."""

    def mutate(members: list[dict]):
        if not any(member.get("id") == user_id for member in members):
            members.append({"id": user_id, "name": name, "season": 1, "episode": 1})
        # Return None (not False) even when already present so a repeat join
        # still resolves with the current show rather than a 404.
        return None

    return _mutate_members(show_id, group_id, mutate)


def leave(show_id: str, user_id: str, group_id: str):
    """Remove a watcher; returns the snapshot whether or not they were present."""

    def mutate(members: list[dict]):
        members[:] = [member for member in members if member.get("id") != user_id]
        return None

    return _mutate_members(show_id, group_id, mutate)


def _write_progress(member: dict, field: str, value) -> None:
    """Write a clamped, 1-based season/episode. Changing the season restarts the
    episode at 1, since a new season begins from its first episode."""
    member[field] = max(1, int(value))
    if field == "season":
        member["episode"] = 1


def set_progress(show_id: str, member_id: str, field: str, value, group_id: str):
    """Set one watcher's season or episode to an absolute value."""
    if field not in PROGRESS_FIELDS:
        return None

    def mutate(members: list[dict]):
        for member in members:
            if member.get("id") == member_id:
                _write_progress(member, field, value)
                return None
        return False

    return _mutate_members(show_id, group_id, mutate)


def adjust_progress(show_id: str, member_id: str, field: str, delta: int, group_id: str):
    """Nudge one watcher's season or episode by delta (+1 / -1)."""
    if field not in PROGRESS_FIELDS:
        return None

    def mutate(members: list[dict]):
        for member in members:
            if member.get("id") == member_id:
                _write_progress(member, field, int(member.get(field, 1)) + delta)
                return None
        return False

    return _mutate_members(show_id, group_id, mutate)


def _set_archived(show_id: str, user_id: str, name: str, group_id: str, archived: bool):
    """Archive or restore a show. Any roommate in the group may do this."""
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if not _in_group(item, group_id):
        return None
    if archived:
        update = dict(
            UpdateExpression=(
                "SET isArchived = :true, archivedAt = :ts, archivedById = :user_id, "
                "archivedBy = :name, updatedAt = :ts"
            ),
            ExpressionAttributeValues={
                ":ts": int(time.time() * 1000),
                ":groupId": group_id,
                ":true": True,
                ":user_id": user_id,
                ":name": name,
            },
        )
    else:
        update = dict(
            UpdateExpression=(
                "SET isArchived = :false, restoredById = :user_id, restoredBy = :name, updatedAt = :ts "
                "REMOVE archivedAt, archivedById, archivedBy"
            ),
            ExpressionAttributeValues={
                ":ts": int(time.time() * 1000),
                ":groupId": group_id,
                ":false": False,
                ":user_id": user_id,
                ":name": name,
            },
        )

    try:
        resp = table.update_item(
            Key={"id": show_id},
            ConditionExpression="attribute_exists(id) AND groupId = :groupId",
            ReturnValues="ALL_NEW",
            **update,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def archive(show_id: str, user_id: str, name: str, group_id: str):
    """Archive a show so it drops out of the active list."""
    return _set_archived(show_id, user_id, name, group_id, archived=True)


def restore(show_id: str, user_id: str, name: str, group_id: str):
    """Restore a previously archived show to the active list."""
    return _set_archived(show_id, user_id, name, group_id, archived=False)


def delete(show_id: str, group_id: str) -> str:
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if not _in_group(item, group_id):
        return DELETE_NOT_FOUND
    try:
        table.delete_item(
            Key={"id": show_id},
            ConditionExpression="attribute_exists(id) AND groupId = :groupId",
            ExpressionAttributeValues={":groupId": group_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
        if not _in_group(current, group_id):
            return DELETE_NOT_FOUND
        return DELETE_NOT_FOUND
    return DELETE_OK
