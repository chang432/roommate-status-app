"""TV show tracker feed for the Roomie Status backend.

Each show is one item in its own DynamoDB table (RoommateStatus-*-shows-v2),
separate from the roommate and activities tables so the household scan in db.py
and the activity/checklist feed both stay clean — the same "own table per
concern" pattern activities.py follows. Watchers are embedded on the show item
(like checklist items), each tracking their own season and episode, so a show is
a single read/write. The table is keyed ``(groupId HASH, id RANGE)``; see
group_tables.py for why the group is the partition key.

Configuration (env):
    SHOWS_TABLE  - override the table name
                   (default: "${ROOMMATE_TABLE}-shows-v2")
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

RECENT_LIMIT = 20

# Season and episode are both 1-based; each watcher tracks their own pair.
PROGRESS_FIELDS = ("season", "episode")

# Distinct non-None results from the mutation helpers, so routes can map an
# outcome to an HTTP status without touching boto3 details.
MUTATION_ARCHIVED = "archived"  # edit rejected: the show is archived (read-only)
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
    """Return the cached Shows Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(show_id: str, group_id: str, consistent: bool = True) -> dict | None:
    """Read one show by its full key, or None when it isn't in this group.

    The group is half the primary key, so an id from another household simply
    doesn't resolve — no post-read ownership check is needed.
    """
    return _get_table().get_item(
        Key={"groupId": group_id, "id": show_id},
        ConsistentRead=consistent,
    ).get("Item")


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
        "isWatchpartyLive": item.get("watchpartyStartedAt") is not None,
        "watchpartyStartedAt": (
            int(item["watchpartyStartedAt"])
            if item.get("watchpartyStartedAt") is not None
            else None
        ),
        "watchpartyStartedBy": item.get("watchpartyStartedBy"),
        "watchpartyStartedById": item.get("watchpartyStartedById"),
        "watchpartySeason": (
            int(item["watchpartySeason"])
            if item.get("watchpartySeason") is not None
            else None
        ),
        "watchpartyEpisode": (
            int(item["watchpartyEpisode"])
            if item.get("watchpartyEpisode") is not None
            else None
        ),
        "members": [_project_member(raw) for raw in item.get("members") or []],
    }


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
    item = _fetch(show_id, group_id, consistent=consistent)
    return _project(item) if item else None


def edit_title_owned(show_id: str, creator_id: str, group_id: str, title: str) -> dict | str:
    table = _get_table()
    item = _fetch(show_id, group_id)
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
            Key={"groupId": group_id, "id": show_id},
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


def list_recent(
    group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False
) -> list[dict]:
    """Return the group's recent shows, newest first. Active/completed split and
    per-watcher ordering are done in the frontend, so this stays a recency
    sort scoped to the caller's group."""
    shows = [
        item
        for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item
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
    item = _fetch(show_id, group_id)
    if item is None:
        return None
    if item.get("isArchived", False):
        return MUTATION_ARCHIVED

    members = [dict(member) for member in (item.get("members") or [])]
    if mutate(members) is False:
        return None

    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": show_id},
            UpdateExpression="SET #members = :members, updatedAt = :updated_at",
            ExpressionAttributeNames={"#members": "members"},
            ExpressionAttributeValues={
                ":members": members,
                ":updated_at": int(time.time() * 1000),
                ":false": False,
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


def set_watchparty(
    show_id: str,
    user_id: str,
    name: str,
    group_id: str,
    live: bool,
    season: int | None = None,
    episode: int | None = None,
):
    """Start or end the show's live watchparty state."""
    table = _get_table()
    item = _fetch(show_id, group_id)
    if item is None:
        return None
    if item.get("isArchived", False):
        return MUTATION_ARCHIVED
    if live and not item.get("members"):
        return WATCHPARTY_EMPTY

    now_ms = int(time.time() * 1000)
    if live:
        season = max(1, int(season or 1))
        episode = max(1, int(episode or 1))
        update = dict(
            UpdateExpression=(
                "SET watchpartyStartedAt = :now, watchpartyStartedById = :user_id, "
                "watchpartyStartedBy = :name, watchpartySeason = :season, "
                "watchpartyEpisode = :episode, updatedAt = :now"
            ),
            ExpressionAttributeValues={
                ":now": now_ms,
                ":user_id": user_id,
                ":name": name,
                ":season": season,
                ":episode": episode,
                ":false": False,
            },
        )
    else:
        update = dict(
            UpdateExpression=(
                "SET updatedAt = :now REMOVE watchpartyStartedAt, "
                "watchpartyStartedById, watchpartyStartedBy, "
                "watchpartySeason, watchpartyEpisode"
            ),
            ExpressionAttributeValues={
                ":now": now_ms,
                ":false": False,
            },
        )

    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": show_id},
            ConditionExpression=(
                "attribute_exists(id) AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
            **update,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def start_watchparty(
    show_id: str,
    user_id: str,
    name: str,
    group_id: str,
    season: int | None = None,
    episode: int | None = None,
):
    return set_watchparty(show_id, user_id, name, group_id, True, season, episode)


def end_watchparty(show_id: str, user_id: str, name: str, group_id: str):
    return set_watchparty(show_id, user_id, name, group_id, False)


def _set_archived(show_id: str, user_id: str, name: str, group_id: str, archived: bool):
    """Archive or restore a show. Any roommate in the group may do this."""
    table = _get_table()
    item = _fetch(show_id, group_id)
    if item is None:
        return None
    if archived:
        update = dict(
            UpdateExpression=(
                "SET isArchived = :true, archivedAt = :ts, archivedById = :user_id, "
                "archivedBy = :name, updatedAt = :ts"
            ),
            ExpressionAttributeValues={
                ":ts": int(time.time() * 1000),
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
                ":false": False,
                ":user_id": user_id,
                ":name": name,
            },
        )

    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": show_id},
            ConditionExpression="attribute_exists(id)",
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
    """Delete a show. The group is half the key, so another household's id
    simply doesn't resolve and reports not-found."""
    table = _get_table()
    if _fetch(show_id, group_id) is None:
        return DELETE_NOT_FOUND
    table.delete_item(Key={"groupId": group_id, "id": show_id})
    return DELETE_OK
