"""Proposed-activities feed for the Roomie Status backend.

A small, time-ordered list of "let's do X" proposals. Each proposal also fires a
push notification (handled in app.py); this module just owns persistence.

Stored in its own DynamoDB table — separate from the roommate table so the
household scan in db.py stays clean — provisioned by CloudFormation alongside
the other tables (infrastructure/dynamodb-table-{dev,main}.yaml). The table is
keyed ``(groupId HASH, id RANGE)``, so reading a feed is a Query over one
household's partition and every item address carries its group; see
group_tables.py for why the group is the partition key rather than an index.

Configuration (env):
    ACTIVITIES_TABLE  - override the table name
                        (default: "${ROOMMATE_TABLE}-activities-v2")
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

import comment_likes

# Reuse db's resource builder so all tables sign requests the same way and share
# the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource
from group_tables import query_group

# How many of an activity's most recent comments the feed returns. Storage
# remains unbounded; the frontend initially shows only the latest 10.
COMMENTS_LIMIT = 100

# Results returned by delete(), kept explicit so the route can distinguish
# missing activities from lifecycle conflicts without handling boto3 details.
DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
DELETE_LIVE = "live"

ARCHIVE_OK = "archived"
ARCHIVE_NOT_FOUND = "not_found"
RESTORE_OK = "restored"
RESTORE_NOT_FOUND = "not_found"

LIVE_OK = "ok"
LIVE_NOT_FOUND = "not_found"
LIVE_FORBIDDEN = "forbidden"
LIVE_CONFLICT = "conflict"

EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"
EDIT_CONFLICT = "conflict"

MUTATION_EXPIRED = "expired"

LIKE_OK = "ok"
LIKE_NOT_FOUND = "not_found"
LIKE_SELF_FORBIDDEN = "self_forbidden"

TABLE_NAME = os.environ.get("ACTIVITIES_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-activities-v2"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached Activities Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(activity_id: str, group_id: str, consistent: bool = True) -> dict | None:
    """Read one activity by its full key, or None when it isn't in this group.

    The group is half the primary key, so an id from another household simply
    doesn't resolve — no post-read ownership check is needed.
    """
    return _get_table().get_item(
        Key={"groupId": group_id, "id": activity_id},
        ConsistentRead=consistent,
    ).get("Item")


def _legacy_comment_id(activity_id: str, index: int) -> str:
    """Build a stable id for a pre-id comment from its append-only list position."""
    digest = hashlib.sha256(f"{activity_id}:{index}".encode()).hexdigest()[:24]
    return f"legacy-{digest}"


def _comment_entries(item: dict) -> list[tuple[str, dict]]:
    """Return every raw comment paired with its persisted or legacy-stable id."""
    return [
        (comment.get("id") or _legacy_comment_id(item["id"], index), comment)
        for index, comment in enumerate(item.get("comments") or [])
    ]


def _timestamp(item: dict, field: str) -> int | None:
    value = item.get(field)
    return int(value) if value is not None else None


def _lifecycle(item: dict, now_ms: int | None = None) -> dict:
    """Derive lifecycle from timestamps so no scheduler or background write is needed."""
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    start_at = _timestamp(item, "startAt")
    end_at = _timestamp(item, "endAt")
    ended_at = _timestamp(item, "endedAt")
    is_expired = ended_at is not None or (end_at is not None and end_at <= now_ms)
    is_live = not is_expired and start_at is not None and start_at <= now_ms
    return {
        "startAt": start_at,
        "endAt": end_at,
        "endedAt": ended_at,
        "isLive": is_live,
        "isExpired": is_expired,
        "liveStartedAt": start_at if is_live else None,
        "effectiveEndedAt": (
            ended_at if ended_at is not None else (end_at if is_expired else None)
        ),
    }


def _project(
    item: dict,
    likes_by_comment: dict[str, set[str]] | None = None,
    now_ms: int | None = None,
) -> dict:
    """Shape a raw DynamoDB item to what the frontend expects.

    createdAt is stored as a number (epoch millis) and comes back as a Decimal,
    which isn't JSON-serializable — cast it to int here. `members` and
    `memberIds` are DynamoDB string sets (unordered, and absent once empty); we
    always union the proposer into both when its id exists and present stable,
    sorted lists. Legacy items can still expose display-name membership while
    acquiring stable ids as roommates join them.
    """
    proposer = item.get("proposedBy", "Someone")
    proposer_id = item.get("proposedById")
    members = sorted(set(item.get("members") or set()) | {proposer})
    member_ids = set(item.get("memberIds") or set())
    if proposer_id:
        member_ids.add(proposer_id)
    # Comments are an ordered list (oldest first). Expose only the most recent
    # COMMENTS_LIMIT and merge independently stored likes by stable comment id.
    # createdAt comes back as a Decimal, so cast it like the activity's own.
    likes_by_comment = likes_by_comment or {}
    comments = [
        {
            "id": comment_id,
            "author": c.get("author", "Someone"),
            "authorId": c.get("authorId"),
            "text": c.get("text", ""),
            "createdAt": int(c["createdAt"]),
            "mentions": [
                {"id": mention["id"], "name": mention["name"]}
                for mention in c.get("mentions", [])
                if mention.get("id") and mention.get("name")
            ],
            "mentionsAll": bool(c.get("mentionsAll", False)),
            "likedByIds": sorted(likes_by_comment.get(comment_id, set())),
            "likeCount": len(likes_by_comment.get(comment_id, set())),
        }
        for comment_id, c in _comment_entries(item)[-COMMENTS_LIMIT:]
    ]
    lifecycle = _lifecycle(item, now_ms)
    archived_at = _timestamp(item, "archivedAt")
    return {
        "id": item["id"],
        "groupId": item.get("groupId"),
        "text": item["text"],
        "proposedBy": item.get("proposedBy", "Someone"),
        "proposedById": proposer_id,
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "members": members,
        "memberIds": sorted(member_ids),
        "comments": comments,
        "startAt": lifecycle["startAt"],
        "endAt": lifecycle["endAt"],
        "endedAt": lifecycle["endedAt"],
        "isLive": lifecycle["isLive"],
        "isExpired": lifecycle["isExpired"],
        "liveStartedAt": lifecycle["liveStartedAt"],
        "isArchived": bool(item.get("isArchived", False)),
        "archivedAt": archived_at,
        "archivedBy": item.get("archivedBy"),
        "archivedById": item.get("archivedById"),
    }


def add_activity(
    text: str,
    proposed_by_id: str,
    proposed_by: str,
    group_id: str,
    start_at: int | None = None,
    end_at: int | None = None,
) -> dict:
    """Store a new proposal and return it. Caller is responsible for validation."""
    now_ms = int(time.time() * 1000)
    item = {
        "id": uuid.uuid4().hex,
        "text": text,
        "proposedBy": proposed_by,
        "proposedById": proposed_by_id,
        "groupId": group_id,
        # Epoch millis drives newest-first ordering in list_recent().
        "createdAt": now_ms,
        "updatedAt": now_ms,
        # The proposer joins automatically, so the count starts at 1.
        "members": {proposed_by},
        "memberIds": {proposed_by_id},
    }
    if start_at is not None:
        item["startAt"] = start_at
    if end_at is not None:
        item["endAt"] = end_at
    _get_table().put_item(Item=item)
    return _project(item)


def _set_membership(
    activity_id: str,
    user_id: str,
    name: str,
    group_id: str,
    op: str,
) -> dict | str | None:
    """Add or remove a roommate from an activity; return it, or None.

    `op` is "ADD" (join) or "DELETE" (leave). Both are atomic and idempotent at
    the DynamoDB level — joining twice or leaving when absent is a no-op. None
    means the activity doesn't exist.
    """
    table = _get_table()
    existing = _fetch(activity_id, group_id)
    if existing is None:
        return None
    if _lifecycle(existing)["isExpired"] or existing.get("isArchived", False):
        return MUTATION_EXPIRED
    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression=f"SET updatedAt = :now {op} members :m, memberIds :i",
            ExpressionAttributeValues={
                ":m": {name},
                ":i": {user_id},
                ":false": False,
                ":now": int(time.time() * 1000),
            },
            ConditionExpression=(
                "attribute_exists(id) AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false) AND "
                "attribute_not_exists(endedAt) AND "
                "(attribute_not_exists(endAt) OR endAt > :now)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            current = _fetch(activity_id, group_id)
            if current and (
                _lifecycle(current)["isExpired"] or current.get("isArchived", False)
            ):
                return MUTATION_EXPIRED
            return None
        raise
    return _project(resp["Attributes"])


def join(activity_id: str, user_id: str, name: str, group_id: str) -> dict | str | None:
    """Add a roommate to an activity. None if the activity is unknown."""
    return _set_membership(activity_id, user_id, name, group_id, "ADD")


def leave(activity_id: str, user_id: str, name: str, group_id: str) -> dict | str | None:
    """Remove a roommate from an activity. None if the activity is unknown."""
    return _set_membership(activity_id, user_id, name, group_id, "DELETE")


def add_comment(
    activity_id: str,
    author: str,
    text: str,
    group_id: str,
    mentions: list[dict] | None = None,
    mentions_all: bool = False,
    author_id: str | None = None,
) -> dict | str | None:
    """Append a comment to an activity; return it, or None if unknown.

    Comments are stored as an ordered DynamoDB list of
    {id, author, authorId, text, createdAt, mentions, mentionsAll} maps and
    appended atomically with list_append, so concurrent comments don't clobber
    each other. if_not_exists seeds an empty list for activities (legacy or
    otherwise) that have never been commented on.
    """
    table = _get_table()
    existing = _fetch(activity_id, group_id)
    if existing is None:
        return None
    if _lifecycle(existing)["isExpired"] or existing.get("isArchived", False):
        return MUTATION_EXPIRED
    comment = {
        "id": uuid.uuid4().hex,
        "author": author,
        "authorId": author_id,
        "text": text,
        # Resolved by the server from the canonical household roster. Storing
        # ids alongside names keeps notification targeting and UI highlighting
        # independent from free-form client input.
        "mentions": mentions or [],
        "mentionsAll": mentions_all,
        # Epoch millis, mirroring an activity's createdAt — drives the order the
        # UI shows comments in and powers its relative timestamps.
        "createdAt": int(time.time() * 1000),
    }
    try:
        resp = table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression=(
                "SET comments = list_append(if_not_exists(comments, :empty), :c), "
                "updatedAt = :now"
            ),
            ExpressionAttributeValues={
                ":c": [comment],
                ":empty": [],
                ":false": False,
                ":now": int(time.time() * 1000),
            },
            ConditionExpression=(
                "attribute_exists(id) AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false) AND "
                "attribute_not_exists(endedAt) AND "
                "(attribute_not_exists(endAt) OR endAt > :now)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            current = _fetch(activity_id, group_id)
            if current and (
                _lifecycle(current)["isExpired"] or current.get("isArchived", False)
            ):
                return MUTATION_EXPIRED
            return None
        raise
    return _project(resp["Attributes"])


def _comment_like_id(activity_id: str, comment_id: str, user_id: str) -> str:
    """Return the deterministic key that makes each user's like idempotent."""
    return f"comment-like#{activity_id}#{comment_id}#{user_id}"


def set_comment_like(
    activity_id: str,
    comment_id: str,
    user_id: str,
    user_name: str,
    group_id: str,
    liked: bool,
) -> str:
    """Like or unlike a comment, returning a stable route-level result."""
    activity = _fetch(activity_id, group_id)
    if activity is None:
        return LIKE_NOT_FOUND
    if _lifecycle(activity)["isExpired"] or activity.get("isArchived", False):
        return MUTATION_EXPIRED

    comment = next(
        (raw for candidate_id, raw in _comment_entries(activity) if candidate_id == comment_id),
        None,
    )
    if comment is None:
        return LIKE_NOT_FOUND
    if comment.get("authorId") == user_id or (
        not comment.get("authorId")
        and comment.get("author", "").strip().casefold() == user_name.strip().casefold()
    ):
        return LIKE_SELF_FORBIDDEN

    # The activity is validated against the activities table above; the like row
    # itself lives in the dedicated comment-likes table.
    likes_table = comment_likes._get_table()
    key = {"groupId": group_id, "id": _comment_like_id(activity_id, comment_id, user_id)}
    if liked:
        likes_table.put_item(
            Item={
                **key,
                "activityId": activity_id,
                "commentId": comment_id,
                "userId": user_id,
            }
        )
    else:
        likes_table.delete_item(Key=key)
    return LIKE_OK


def get(activity_id: str, group_id: str, consistent: bool = False) -> dict | None:
    """Return one proposal by id, or None if it doesn't exist."""
    item = _fetch(activity_id, group_id, consistent=consistent)
    return _project(item) if item else None


def edit_owned(
    activity_id: str,
    requester_id: str,
    group_id: str,
    text: str,
    start_at: int | None,
    end_at: int | None,
    schedule_changed: bool,
) -> dict | str:
    """Atomically edit an active event without allowing ownership or lifecycle drift."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return EDIT_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return EDIT_FORBIDDEN
    lifecycle = _lifecycle(item)
    if item.get("isArchived", False) or lifecycle["isExpired"]:
        return EDIT_READ_ONLY
    if schedule_changed and lifecycle["isLive"]:
        return EDIT_READ_ONLY

    old_start = _timestamp(item, "startAt")
    old_end = _timestamp(item, "endAt")
    if item.get("text", "") == text and old_start == start_at and old_end == end_at:
        return _project(item)

    names = {"#text": "text"}
    values = {
        ":text": text,
        ":now": max(int(time.time() * 1000), int(item.get("updatedAt", item["createdAt"])) + 1),
        ":requester": requester_id,
        ":false": False,
    }
    set_parts = ["#text = :text", "updatedAt = :now"]
    remove_parts = []
    if schedule_changed:
        if start_at is None:
            remove_parts.extend(["startAt", "endAt"])
        else:
            set_parts.append("startAt = :start")
            values[":start"] = start_at
            if end_at is None:
                remove_parts.append("endAt")
            else:
                set_parts.append("endAt = :end")
                values[":end"] = end_at

    expression = f"SET {', '.join(set_parts)}"
    if remove_parts:
        expression += f" REMOVE {', '.join(remove_parts)}"
    condition = (
        "attribute_exists(id) AND proposedById = :requester AND "
        "(attribute_not_exists(isArchived) OR isArchived = :false)"
    )
    if schedule_changed:
        # Re-check pending state at write time so a scheduled event cannot begin
        # between the initial read and the schedule update.
        condition += (
            " AND attribute_not_exists(endedAt) AND "
            "(attribute_not_exists(startAt) OR startAt > :now)"
        )
    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression=condition,
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = _fetch(activity_id, group_id)
        if current is None:
            return EDIT_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return EDIT_FORBIDDEN
        return EDIT_CONFLICT
    return _project(response["Attributes"])


def start_owned(activity_id: str, requester_id: str, group_id: str) -> str:
    """Start an owned activity now; expired activities restart without an end."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return LIVE_NOT_FOUND
    if item.get("isArchived", False):
        return LIVE_CONFLICT
    if item.get("proposedById") != requester_id:
        return LIVE_FORBIDDEN
    lifecycle = _lifecycle(item)
    if lifecycle["isLive"]:
        return LIVE_CONFLICT

    started_at = int(time.time() * 1000)
    try:
        remove_fields = " REMOVE endedAt, isLive, liveStartedAt"
        if lifecycle["isExpired"]:
            remove_fields += ", endAt"
        condition = "proposedById = :requester"
        values = {
            ":started": started_at,
            ":requester": requester_id,
        }
        if lifecycle["endedAt"] is not None:
            condition += " AND endedAt = :expected_ended"
            values[":expected_ended"] = lifecycle["endedAt"]
        elif lifecycle["isExpired"]:
            condition += (
                " AND attribute_not_exists(endedAt) AND endAt = :expected_end"
            )
            values[":expected_end"] = lifecycle["endAt"]
        elif lifecycle["startAt"] is None:
            condition += (
                " AND attribute_not_exists(startAt) AND attribute_not_exists(endedAt)"
            )
        else:
            condition += (
                " AND startAt = :expected_start AND attribute_not_exists(endedAt)"
            )
            values[":expected_start"] = lifecycle["startAt"]
        table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression=f"SET startAt = :started, updatedAt = :started{remove_fields}",
            ConditionExpression=condition,
            ExpressionAttributeValues=values,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = _fetch(activity_id, group_id)
        if current is None:
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def end_owned(activity_id: str, requester_id: str, group_id: str) -> str:
    """End a live owned activity permanently."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return LIVE_NOT_FOUND
    if item.get("isArchived", False):
        return LIVE_CONFLICT
    if item.get("proposedById") != requester_id:
        return LIVE_FORBIDDEN
    if not _lifecycle(item)["isLive"]:
        return LIVE_CONFLICT

    ended_at = int(time.time() * 1000)
    try:
        table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression="SET endedAt = :ended, updatedAt = :ended REMOVE isLive, liveStartedAt",
            ConditionExpression=(
                "proposedById = :requester AND "
                "startAt = :expected_start AND attribute_not_exists(endedAt)"
            ),
            ExpressionAttributeValues={
                ":ended": ended_at,
                ":requester": requester_id,
                ":expected_start": _timestamp(item, "startAt"),
            },
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = _fetch(activity_id, group_id)
        if current is None:
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def archive(activity_id: str, requester_id: str, group_id: str, requester_name: str | None = None) -> str:
    """Hide an activity from the active section without deleting it."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return ARCHIVE_NOT_FOUND
    if item.get("isArchived", False):
        return ARCHIVE_OK

    try:
        table.update_item(
            Key={"groupId": group_id, "id": activity_id},
            UpdateExpression=(
                "SET isArchived = :true, archivedAt = :archived, archivedById = :requester_id, "
                "archivedBy = :requester_name, updatedAt = :archived"
            ),
            ConditionExpression=(
                "attribute_not_exists(isArchived) OR isArchived = :false"
            ),
            ExpressionAttributeValues={
                ":archived": int(time.time() * 1000),
                ":false": False,
                ":requester_id": requester_id,
                ":requester_name": requester_name,
                ":true": True,
            },
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = _fetch(activity_id, group_id)
        if current is None:
            return ARCHIVE_NOT_FOUND
        return ARCHIVE_OK
    return ARCHIVE_OK


def restore(activity_id: str, group_id: str) -> str:
    """Restore an archived or expired activity back into the active section."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return RESTORE_NOT_FOUND

    now_ms = int(time.time() * 1000)
    lifecycle = _lifecycle(item)
    if item.get("isArchived", False) and not lifecycle["isExpired"]:
        update_expression = (
            "SET isArchived = :false, updatedAt = :now REMOVE archivedAt, archivedBy, archivedById"
        )
        values = {":false": False, ":now": now_ms}
    else:
        update_expression = (
            "SET startAt = :now, updatedAt = :now REMOVE isArchived, archivedAt, archivedBy, "
            "archivedById, endedAt, endAt, isLive, liveStartedAt"
        )
        values = {":now": now_ms}

    table.update_item(
        Key={"groupId": group_id, "id": activity_id},
        UpdateExpression=update_expression,
        ConditionExpression="attribute_exists(id)",
        ExpressionAttributeValues=values,
    )
    return RESTORE_OK


def delete(activity_id: str, group_id: str) -> str:
    """Delete an activity from the household feed."""
    table = _get_table()
    item = _fetch(activity_id, group_id)
    if item is None:
        return DELETE_NOT_FOUND
    if _lifecycle(item)["isLive"]:
        return DELETE_LIVE

    table.delete_item(Key={"groupId": group_id, "id": activity_id})

    # Likes are separate idempotent records (now in their own table) so
    # concurrent reactions cannot clobber the embedded comment list. Remove
    # this event's likes alongside it.
    comment_likes.delete_for_parent(group_id, "activityId", activity_id)
    return DELETE_OK


def list_recent(group_id: str, limit: int | None = None, consistent: bool = False) -> list[dict]:
    """Return all activities in active-then-expired display order.

    Pass consistent=True for the response that follows a write (propose / join /
    leave / delete): DynamoDB reads are eventually consistent by default, so a
    plain read right after an update can return stale data. A strongly-consistent
    read avoids that. The default (eventual) read is fine for the plain GET feed.
    """
    items = query_group(_get_table(), group_id, consistent=consistent)
    likes_by_activity = comment_likes.likes_by_parent(
        group_id, "activityId", consistent=consistent
    )

    items = [item for item in items if "createdAt" in item]
    now_ms = int(time.time() * 1000)
    active = []
    expired = []
    for item in items:
        lifecycle = _lifecycle(item, now_ms)
        (expired if item.get("isArchived", False) or lifecycle["isExpired"] else active).append((item, lifecycle))

    # Unscheduled proposals stay at the top; scheduled entries follow by start.
    active.sort(
        key=lambda pair: (
            0 if pair[1]["startAt"] is None else 1,
            -int(pair[0]["createdAt"])
            if pair[1]["startAt"] is None
            else pair[1]["startAt"],
            -int(pair[0]["createdAt"]),
        )
    )
    expired.sort(
        key=lambda pair: (
            -(pair[1]["effectiveEndedAt"] or 0),
            -int(pair[0]["createdAt"]),
        )
    )
    ordered = active + expired
    if limit is not None:
        ordered = ordered[:limit]
    return [
        _project(item, likes_by_activity.get(item["id"]), now_ms)
        for item, _lifecycle_data in ordered
    ]
