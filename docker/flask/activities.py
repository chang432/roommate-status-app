"""Proposed-activities feed for the Roomie Status backend.

A small, time-ordered list of "let's do X" proposals. Each proposal also fires a
push notification (handled in app.py); this module just owns persistence.

Stored in its own DynamoDB table — separate from the roommate table so the
household scan in db.py stays clean — provisioned by CloudFormation alongside
the other tables (infrastructure/dynamodb-table-{dev,main}.yaml). the shire
data set is small, so a scan + in-app lifecycle sort is the right tool (mirrors
db.get_all); no secondary index is needed.

Configuration (env):
    ACTIVITIES_TABLE  - override the table name
                        (default: "${ROOMMATE_TABLE}-activities")
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

import db

# Reuse db's resource builder so all tables sign requests the same way and share
# the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

# How many of an activity's most recent comments the feed returns. Storage
# remains unbounded; the frontend initially shows only the latest 10.
COMMENTS_LIMIT = 100

# Results returned by delete_owned(), kept explicit so the route can distinguish
# missing activities from ownership failures without handling boto3 details.
DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
DELETE_FORBIDDEN = "forbidden"
DELETE_LIVE = "live"

ARCHIVE_OK = "archived"
ARCHIVE_NOT_FOUND = "not_found"

LIVE_OK = "ok"
LIVE_NOT_FOUND = "not_found"
LIVE_FORBIDDEN = "forbidden"
LIVE_CONFLICT = "conflict"

SCHEDULE_OK = "ok"
SCHEDULE_NOT_FOUND = "not_found"
SCHEDULE_FORBIDDEN = "forbidden"
SCHEDULE_CONFLICT = "conflict"

MUTATION_EXPIRED = "expired"
COMMENT_LIKE_TYPE = "commentLike"

LIKE_OK = "ok"
LIKE_NOT_FOUND = "not_found"
LIKE_SELF_FORBIDDEN = "self_forbidden"

TABLE_NAME = os.environ.get("ACTIVITIES_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-activities"
)

_table = None
_table_lock = threading.Lock()


def backfill_default_group_records() -> None:
    """Assign the seeded group to legacy records that predate group isolation."""
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
    """Return the cached Activities Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _scan_all(consistent: bool = False) -> list[dict]:
    """Read every activities-table item, including typed coordination records."""
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
    }


def _in_group(item: dict | None, group_id: str | None) -> bool:
    return item is not None and item.get("groupId") == group_id


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
    existing = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if existing is None or existing.get("itemType") or not _in_group(existing, group_id):
        return None
    if _lifecycle(existing)["isExpired"]:
        return MUTATION_EXPIRED
    try:
        resp = table.update_item(
            Key={"id": activity_id},
            UpdateExpression=f"SET updatedAt = :now {op} members :m, memberIds :i",
            ExpressionAttributeValues={
                ":m": {name},
                ":i": {user_id},
                ":now": int(time.time() * 1000),
                ":groupId": group_id,
            },
            ConditionExpression=(
                "attribute_exists(id) AND attribute_not_exists(itemType) AND "
                "groupId = :groupId AND "
                "attribute_not_exists(endedAt) AND "
                "(attribute_not_exists(endAt) OR endAt > :now)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
            if current and not current.get("itemType") and _in_group(current, group_id) and _lifecycle(current)["isExpired"]:
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
    existing = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if existing is None or existing.get("itemType") or not _in_group(existing, group_id):
        return None
    if _lifecycle(existing)["isExpired"]:
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
            Key={"id": activity_id},
            UpdateExpression=(
                "SET comments = list_append(if_not_exists(comments, :empty), :c), "
                "updatedAt = :now"
            ),
            ExpressionAttributeValues={
                ":c": [comment],
                ":empty": [],
                ":now": int(time.time() * 1000),
                ":groupId": group_id,
            },
            ConditionExpression=(
                "attribute_exists(id) AND attribute_not_exists(itemType) AND "
                "groupId = :groupId AND "
                "attribute_not_exists(endedAt) AND "
                "(attribute_not_exists(endAt) OR endAt > :now)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
            if current and not current.get("itemType") and _in_group(current, group_id) and _lifecycle(current)["isExpired"]:
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
    table = _get_table()
    activity = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if activity is None or activity.get("itemType") or not _in_group(activity, group_id):
        return LIKE_NOT_FOUND
    if _lifecycle(activity)["isExpired"]:
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

    key = {"id": _comment_like_id(activity_id, comment_id, user_id)}
    if liked:
        table.put_item(
            Item={
                **key,
                "itemType": COMMENT_LIKE_TYPE,
                "activityId": activity_id,
                "commentId": comment_id,
                "groupId": group_id,
                "userId": user_id,
            }
        )
    else:
        table.delete_item(Key=key)
    return LIKE_OK


def get(activity_id: str, group_id: str, consistent: bool = False) -> dict | None:
    """Return one proposal by id, or None if it doesn't exist."""
    item = _get_table().get_item(
        Key={"id": activity_id},
        ConsistentRead=consistent,
    ).get("Item")
    return _project(item) if item and not item.get("itemType") and _in_group(item, group_id) else None


def start_owned(activity_id: str, requester_id: str, group_id: str) -> str:
    """Start an owned activity now; expired activities restart without an end."""
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") or not _in_group(item, group_id):
        return LIVE_NOT_FOUND
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
        condition = (
            "proposedById = :requester AND attribute_not_exists(itemType)"
        )
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
            Key={"id": activity_id},
            UpdateExpression=f"SET startAt = :started, updatedAt = :started{remove_fields}",
            ConditionExpression=condition,
            ExpressionAttributeValues=values,
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") or not _in_group(current, group_id):
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def end_owned(activity_id: str, requester_id: str, group_id: str) -> str:
    """End a live owned activity permanently."""
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") or not _in_group(item, group_id):
        return LIVE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return LIVE_FORBIDDEN
    if not _lifecycle(item)["isLive"]:
        return LIVE_CONFLICT

    ended_at = int(time.time() * 1000)
    try:
        table.update_item(
            Key={"id": activity_id},
            UpdateExpression="SET endedAt = :ended, updatedAt = :ended REMOVE isLive, liveStartedAt",
            ConditionExpression=(
                "proposedById = :requester AND attribute_not_exists(itemType) AND "
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
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") or not _in_group(current, group_id):
            return LIVE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return LIVE_FORBIDDEN
        return LIVE_CONFLICT
    return LIVE_OK


def update_schedule_owned(
    activity_id: str,
    requester_id: str,
    group_id: str,
    start_at: int | None,
    end_at: int | None,
) -> str:
    """Replace an owned pending activity's schedule."""
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") or not _in_group(item, group_id):
        return SCHEDULE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return SCHEDULE_FORBIDDEN
    lifecycle = _lifecycle(item)
    if lifecycle["isLive"] or lifecycle["isExpired"]:
        return SCHEDULE_CONFLICT

    if start_at is None:
        expression = "SET updatedAt = :now REMOVE startAt, endAt, endedAt, isLive, liveStartedAt"
        values = {":requester": requester_id}
    elif end_at is None:
        expression = "SET startAt = :start, updatedAt = :now REMOVE endAt, endedAt, isLive, liveStartedAt"
        values = {":requester": requester_id, ":start": start_at}
    else:
        expression = (
            "SET startAt = :start, endAt = :end, updatedAt = :now "
            "REMOVE endedAt, isLive, liveStartedAt"
        )
        values = {
            ":requester": requester_id,
            ":start": start_at,
            ":end": end_at,
        }
    try:
        now_ms = int(time.time() * 1000)
        table.update_item(
            Key={"id": activity_id},
            UpdateExpression=expression,
            ConditionExpression=(
                "proposedById = :requester AND attribute_not_exists(itemType) AND "
                "attribute_not_exists(endedAt) AND "
                "(attribute_not_exists(startAt) OR startAt > :now)"
            ),
            ExpressionAttributeValues={**values, ":now": now_ms},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") or not _in_group(current, group_id):
            return SCHEDULE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return SCHEDULE_FORBIDDEN
        return SCHEDULE_CONFLICT
    return SCHEDULE_OK


def archive(activity_id: str, _requester_id: str, group_id: str) -> str:
    """Move an activity into the expired section without deleting it.

    Archiving is a shared-household action rather than an owner-only one. We
    persist `endedAt` so the normal lifecycle projection treats the event as
    expired everywhere without introducing a second archive-specific state.
    """
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") or not _in_group(item, group_id):
        return ARCHIVE_NOT_FOUND
    if _lifecycle(item)["isExpired"]:
        return ARCHIVE_OK

    try:
        table.update_item(
            Key={"id": activity_id},
            UpdateExpression="SET endedAt = :ended, updatedAt = :ended REMOVE isLive, liveStartedAt",
            ConditionExpression=(
                "attribute_not_exists(itemType) AND attribute_not_exists(endedAt)"
            ),
            ExpressionAttributeValues={":ended": int(time.time() * 1000)},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") or not _in_group(current, group_id):
            return ARCHIVE_NOT_FOUND
        return ARCHIVE_OK
    return ARCHIVE_OK


def delete_owned(activity_id: str, requester_id: str, group_id: str) -> str:
    """Delete an activity only when requester_id is its stored creator.

    The initial consistent read gives the route a useful 404 vs. 403 result.
    The conditional delete then enforces that same ownership at write time, so
    a concurrent change cannot turn the check into an unauthorized deletion.
    Legacy activities have no proposedById and are therefore always forbidden.
    """
    table = _get_table()
    item = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
    if item is None or not _in_group(item, group_id):
        return DELETE_NOT_FOUND
    if item.get("proposedById") != requester_id:
        return DELETE_FORBIDDEN
    if _lifecycle(item)["isLive"]:
        return DELETE_LIVE

    try:
        table.delete_item(
            Key={"id": activity_id},
            ConditionExpression=(
                "proposedById = :requester AND attribute_not_exists(itemType)"
            ),
            ExpressionAttributeValues={":requester": requester_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Resolve the rare race into the same stable API outcomes.
        current = table.get_item(Key={"id": activity_id}, ConsistentRead=True).get("Item")
        if current is None or not _in_group(current, group_id):
            return DELETE_NOT_FOUND
        if current.get("proposedById") != requester_id:
            return DELETE_FORBIDDEN
        return DELETE_LIVE if _lifecycle(current)["isLive"] else DELETE_FORBIDDEN

    # Likes are separate idempotent records so concurrent reactions cannot
    # clobber the embedded comment list. Remove them with their parent event.
    for reaction in _scan_all(consistent=True):
        if (
            reaction.get("itemType") == COMMENT_LIKE_TYPE
            and reaction.get("groupId") == group_id
            and reaction.get("activityId") == activity_id
        ):
            table.delete_item(Key={"id": reaction["id"]})
    return DELETE_OK


def list_recent(group_id: str, limit: int | None = None, consistent: bool = False) -> list[dict]:
    """Return all activities in active-then-expired display order.

    Pass consistent=True for the response that follows a write (propose / join /
    leave / delete): DynamoDB scans are eventually consistent by default, so a
    plain scan right after an update can return stale data. A strongly-consistent
    read avoids that. The default (eventual) read is fine for the plain GET feed.
    """
    items = _scan_all(consistent=consistent)
    likes_by_activity: dict[str, dict[str, set[str]]] = {}
    for item in items:
        if item.get("itemType") != COMMENT_LIKE_TYPE or item.get("groupId") != group_id:
            continue
        likes_by_activity.setdefault(item["activityId"], {}).setdefault(
            item["commentId"], set()
        ).add(item["userId"])

    items = [
        item
        for item in items
        if not item.get("itemType") and "createdAt" in item and item.get("groupId") == group_id
    ]
    now_ms = int(time.time() * 1000)
    active = []
    expired = []
    for item in items:
        lifecycle = _lifecycle(item, now_ms)
        (expired if lifecycle["isExpired"] else active).append((item, lifecycle))

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
