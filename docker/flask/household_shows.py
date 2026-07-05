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

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

RECENT_LIMIT = 20

# Season and episode are both 1-based; each watcher tracks their own pair.
PROGRESS_FIELDS = ("season", "episode")

# Distinct non-None results from the mutation helpers, so routes can map an
# outcome to an HTTP status without touching boto3 details.
MUTATION_COMPLETED = "completed"  # edit rejected: the show is completed (read-only)
COMPLETE_FORBIDDEN = "forbidden"  # only the creator may complete/reopen a show

TABLE_NAME = os.environ.get("SHOWS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-shows"
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
    """Project a raw item to the exact shape the frontend expects. `completed`
    is a convenience flag derived from `completedAt` (absent while active)."""
    completed_at = item.get("completedAt")
    return {
        "id": item["id"],
        "title": item.get("title", ""),
        "createdBy": item.get("createdBy", "Someone"),
        "createdById": item.get("createdById"),
        "createdAt": int(item["createdAt"]),
        "completedAt": int(completed_at) if completed_at is not None else None,
        "completed": completed_at is not None,
        "members": [_project_member(raw) for raw in item.get("members") or []],
    }


def add_show(title: str, created_by_id: str, created_by: str) -> dict:
    """Create a show, auto-joining the creator as the first watcher at S1 E1."""
    item = {
        "id": uuid.uuid4().hex,
        "title": title,
        "createdBy": created_by,
        "createdById": created_by_id,
        "createdAt": int(time.time() * 1000),
        "members": [
            {"id": created_by_id, "name": created_by, "season": 1, "episode": 1}
        ],
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(show_id: str, consistent: bool = False) -> dict | None:
    item = _get_table().get_item(
        Key={"id": show_id}, ConsistentRead=consistent
    ).get("Item")
    return _project(item) if item else None


def list_recent(limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    """Return recent shows, newest first. Active/completed split and per-watcher
    ordering are done in the frontend, so this stays a plain recency sort."""
    shows = [item for item in _scan_all(consistent=consistent) if "createdAt" in item]
    shows.sort(key=lambda item: int(item["createdAt"]), reverse=True)
    return [_project(item) for item in shows[:limit]]


def _mutate_members(show_id: str, mutate):
    """Load a show, run `mutate(members)`, and persist with an optimistic write.

    `mutate` edits the members list in place; returning False means "no change"
    (e.g. member not found) so the caller gets None. Completed shows are
    read-only and yield MUTATION_COMPLETED. The conditional update guards against
    a concurrent completion between the read and the write.
    """
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if item is None:
        return None
    if item.get("completedAt") is not None:
        return MUTATION_COMPLETED

    members = [dict(member) for member in (item.get("members") or [])]
    if mutate(members) is False:
        return None

    try:
        resp = table.update_item(
            Key={"id": show_id},
            UpdateExpression="SET #members = :members",
            ExpressionAttributeNames={"#members": "members"},
            ExpressionAttributeValues={":members": members},
            ConditionExpression=(
                "attribute_exists(id) AND attribute_not_exists(completedAt)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def join(show_id: str, user_id: str, name: str):
    """Add a watcher if not already present (idempotent); returns the snapshot."""

    def mutate(members: list[dict]):
        if not any(member.get("id") == user_id for member in members):
            members.append({"id": user_id, "name": name, "season": 1, "episode": 1})
        # Return None (not False) even when already present so a repeat join
        # still resolves with the current show rather than a 404.
        return None

    return _mutate_members(show_id, mutate)


def leave(show_id: str, user_id: str):
    """Remove a watcher; returns the snapshot whether or not they were present."""

    def mutate(members: list[dict]):
        members[:] = [member for member in members if member.get("id") != user_id]
        return None

    return _mutate_members(show_id, mutate)


def _write_progress(member: dict, field: str, value) -> None:
    """Write a clamped, 1-based season/episode. Changing the season restarts the
    episode at 1, since a new season begins from its first episode."""
    member[field] = max(1, int(value))
    if field == "season":
        member["episode"] = 1


def set_progress(show_id: str, member_id: str, field: str, value):
    """Set one watcher's season or episode to an absolute value."""
    if field not in PROGRESS_FIELDS:
        return None

    def mutate(members: list[dict]):
        for member in members:
            if member.get("id") == member_id:
                _write_progress(member, field, value)
                return None
        return False

    return _mutate_members(show_id, mutate)


def adjust_progress(show_id: str, member_id: str, field: str, delta: int):
    """Nudge one watcher's season or episode by delta (+1 / -1)."""
    if field not in PROGRESS_FIELDS:
        return None

    def mutate(members: list[dict]):
        for member in members:
            if member.get("id") == member_id:
                _write_progress(member, field, int(member.get(field, 1)) + delta)
                return None
        return False

    return _mutate_members(show_id, mutate)


def _set_completed(show_id: str, requester_id: str, completed: bool):
    """Creator-only lifecycle toggle backing complete()/reopen()."""
    table = _get_table()
    item = table.get_item(Key={"id": show_id}, ConsistentRead=True).get("Item")
    if item is None:
        return None
    if item.get("createdById") != requester_id:
        return COMPLETE_FORBIDDEN

    # Store completedAt only while completed; reopening removes the attribute so
    # `attribute_not_exists(completedAt)` cleanly means "active".
    if completed:
        update = dict(
            UpdateExpression="SET completedAt = :ts",
            ExpressionAttributeValues={":ts": int(time.time() * 1000)},
        )
    else:
        update = dict(UpdateExpression="REMOVE completedAt")

    try:
        resp = table.update_item(
            Key={"id": show_id},
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
            **update,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def complete(show_id: str, requester_id: str):
    """Mark a show completed so it drops out of the active list (creator-only)."""
    return _set_completed(show_id, requester_id, completed=True)


def reopen(show_id: str, requester_id: str):
    """Move a completed show back to the active list (creator-only)."""
    return _set_completed(show_id, requester_id, completed=False)
