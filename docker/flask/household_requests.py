"""Household request feed for the Roomie Status backend.

Requests live in their own DynamoDB table (RoommateStatus-<env>-requests-v2),
one item per request with its comments embedded. Comment likes are stored
separately in the comment-likes table (see comment_likes.py). The table is keyed
``(groupId HASH, id RANGE)`` — see group_tables.py for why the group is the
partition key; everything beyond the key is written by this module.

Configuration (env):
    REQUESTS_TABLE  - override the table name
                      (default: "${ROOMMATE_TABLE}-requests-v2")
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource
from group_tables import query_group

import activities
import comment_likes

RECENT_LIMIT = 10
COMMENTS_LIMIT = activities.COMMENTS_LIMIT

RESPONSE_ACCEPTED = "accepted"
RESPONSE_DENIED = "denied"
VALID_RESPONSES = {RESPONSE_ACCEPTED, RESPONSE_DENIED}

LIKE_OK = activities.LIKE_OK
LIKE_NOT_FOUND = activities.LIKE_NOT_FOUND
LIKE_SELF_FORBIDDEN = activities.LIKE_SELF_FORBIDDEN

DELETE_OK = "deleted"
DELETE_NOT_FOUND = "not_found"
ARCHIVE_OK = "archived"
ARCHIVE_NOT_FOUND = "not_found"
MUTATION_ARCHIVED = "archived"
EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"
EDIT_CONFLICT = "conflict"

TABLE_NAME = os.environ.get("REQUESTS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-requests-v2"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached Requests Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _fetch(request_id: str, group_id: str, consistent: bool = True) -> dict | None:
    """Read one request by its full key, or None when it isn't in this group.

    The group is half the primary key, so an id from another household simply
    doesn't resolve — no post-read ownership check is needed.
    """
    return _get_table().get_item(
        Key={"groupId": group_id, "id": request_id},
        ConsistentRead=consistent,
    ).get("Item")


def _legacy_comment_id(request_id: str, index: int) -> str:
    digest = hashlib.sha256(f"request:{request_id}:{index}".encode()).hexdigest()[:24]
    return f"legacy-{digest}"


def _comment_entries(item: dict) -> list[tuple[str, dict]]:
    return [
        (comment.get("id") or _legacy_comment_id(item["id"], index), comment)
        for index, comment in enumerate(item.get("comments") or [])
    ]


def _requested_people(item: dict) -> list[dict]:
    names_by_id = item.get("requestedNamesById") or {}
    responses = item.get("responses") or {}
    return [
        {
            "id": user_id,
            "name": names_by_id.get(user_id, user_id),
            "response": responses.get(user_id, "pending"),
        }
        for user_id in sorted(set(item.get("requestedIds") or set()), key=lambda uid: names_by_id.get(uid, uid).lower())
    ]


def _project(item: dict, likes_by_comment: dict[str, set[str]] | None = None) -> dict:
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
    return {
        "id": item["id"],
        "text": item["text"],
        "requester": item.get("requester", "Someone"),
        "requesterId": item.get("requesterId"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "requested": _requested_people(item),
        "requestedIds": sorted(set(item.get("requestedIds") or set())),
        "comments": comments,
        "isArchived": bool(item.get("isArchived", False)),
        "archivedAt": int(item["archivedAt"]) if item.get("archivedAt") is not None else None,
        "archivedBy": item.get("archivedBy"),
        "archivedById": item.get("archivedById"),
    }


def add_request(
    text: str,
    requester_id: str,
    requester_name: str,
    group_id: str,
    requested_roommates: list[dict],
) -> dict:
    now_ms = int(time.time() * 1000)
    names_by_id = {roommate["id"]: roommate["name"] for roommate in requested_roommates}
    item = {
        "id": uuid.uuid4().hex,
        "text": text,
        "requester": requester_name,
        "requesterId": requester_id,
        "groupId": group_id,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "requestedIds": set(names_by_id),
        "requestedNamesById": names_by_id,
        "responses": {},
        "isArchived": False,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(request_id: str, group_id: str, consistent: bool = False) -> dict | None:
    item = _fetch(request_id, group_id, consistent=consistent)
    return _project(item) if item else None


def edit_owned(
    request_id: str,
    requester_id: str,
    group_id: str,
    text: str,
    requested_roommates: list[dict],
) -> dict | str:
    """Edit request definition while preserving responses for retained recipients."""
    table = _get_table()
    item = _fetch(request_id, group_id)
    if item is None:
        return EDIT_NOT_FOUND
    if item.get("requesterId") != requester_id:
        return EDIT_FORBIDDEN
    if item.get("isArchived", False):
        return EDIT_READ_ONLY

    names_by_id = {person["id"]: person["name"] for person in requested_roommates}
    requested_ids = set(names_by_id)
    old_ids = set(item.get("requestedIds") or set())
    old_responses = dict(item.get("responses") or {})
    responses = {
        user_id: response
        for user_id, response in old_responses.items()
        if user_id in requested_ids
    }
    if (
        item.get("text", "") == text
        and old_ids == requested_ids
        and dict(item.get("requestedNamesById") or {}) == names_by_id
    ):
        return _project(item)

    try:
        response = table.update_item(
            Key={"groupId": group_id, "id": request_id},
            UpdateExpression=(
                "SET #text = :text, requestedIds = :requested_ids, "
                "requestedNamesById = :requested_names, responses = :responses, "
                "updatedAt = :now"
            ),
            ExpressionAttributeNames={"#text": "text"},
            ExpressionAttributeValues={
                ":text": text,
                ":requested_ids": requested_ids,
                ":requested_names": names_by_id,
                ":responses": responses,
                ":expected_ids": old_ids,
                ":expected_responses": old_responses,
                ":now": max(
                    int(time.time() * 1000),
                    int(item.get("updatedAt", item["createdAt"])) + 1,
                ),
                ":requester": requester_id,
                ":false": False,
            },
            ConditionExpression=(
                "attribute_exists(id) AND requesterId = :requester AND "
                "requestedIds = :expected_ids AND responses = :expected_responses AND "
                "(attribute_not_exists(isArchived) OR isArchived = :false)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = _fetch(request_id, group_id)
        if current is None:
            return EDIT_NOT_FOUND
        if current.get("requesterId") != requester_id:
            return EDIT_FORBIDDEN
        if current.get("isArchived", False):
            return EDIT_READ_ONLY
        return EDIT_CONFLICT
    return _project(response["Attributes"])


def add_comment(
    request_id: str,
    author: str,
    text: str,
    group_id: str,
    mentions: list[dict] | None = None,
    mentions_all: bool = False,
    author_id: str | None = None,
) -> dict | None:
    comment = {
        "id": uuid.uuid4().hex,
        "author": author,
        "authorId": author_id,
        "text": text,
        "mentions": mentions or [],
        "mentionsAll": mentions_all,
        "createdAt": int(time.time() * 1000),
    }
    if existing := _fetch(request_id, group_id):
        if existing.get("isArchived", False):
            return MUTATION_ARCHIVED
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": request_id},
            UpdateExpression=(
                "SET comments = list_append(if_not_exists(comments, :empty), :c), "
                "updatedAt = :updated_at"
            ),
            ExpressionAttributeValues={
                ":c": [comment],
                ":empty": [],
                ":updated_at": comment["createdAt"],
            },
            ConditionExpression="attribute_exists(id)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def set_response(request_id: str, user_id: str, group_id: str, response: str) -> dict | None:
    item = _fetch(request_id, group_id)
    if item is None:
        return None
    if item.get("isArchived", False):
        return MUTATION_ARCHIVED
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": request_id},
            UpdateExpression="SET responses.#user = :response, updatedAt = :updated_at",
            ExpressionAttributeNames={"#user": user_id},
            ExpressionAttributeValues={
                ":user_id": user_id,
                ":response": response,
                ":updated_at": int(time.time() * 1000),
            },
            ConditionExpression=(
                "attribute_exists(id) AND contains(requestedIds, :user_id)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def archive(request_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    archived_at = int(time.time() * 1000)
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": request_id},
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


def restore(request_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    try:
        resp = _get_table().update_item(
            Key={"groupId": group_id, "id": request_id},
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


def delete(request_id: str, group_id: str) -> str:
    """Delete a request. The group is half the key, so another household's id
    simply doesn't resolve and reports not-found."""
    table = _get_table()
    if _fetch(request_id, group_id) is None:
        return DELETE_NOT_FOUND

    table.delete_item(Key={"groupId": group_id, "id": request_id})

    # A request's comment likes live in the dedicated comment-likes table; drop
    # them alongside the request.
    comment_likes.delete_for_parent(group_id, "requestId", request_id)
    return DELETE_OK


def _comment_like_id(request_id: str, comment_id: str, user_id: str) -> str:
    return f"request-comment-like#{request_id}#{comment_id}#{user_id}"


def set_comment_like(
    request_id: str,
    comment_id: str,
    user_id: str,
    user_name: str,
    group_id: str,
    liked: bool,
) -> str:
    table = _get_table()
    item = _fetch(request_id, group_id)
    if item is None:
        return LIKE_NOT_FOUND
    if item.get("isArchived", False):
        return MUTATION_ARCHIVED

    comment = next(
        (raw for candidate_id, raw in _comment_entries(item) if candidate_id == comment_id),
        None,
    )
    if comment is None:
        return LIKE_NOT_FOUND
    if comment.get("authorId") == user_id or (
        not comment.get("authorId")
        and comment.get("author", "").strip().casefold() == user_name.strip().casefold()
    ):
        return LIKE_SELF_FORBIDDEN

    # The request is validated against the activities table above; the like row
    # itself lives in the dedicated comment-likes table.
    likes_table = comment_likes._get_table()
    key = {"groupId": group_id, "id": _comment_like_id(request_id, comment_id, user_id)}
    if liked:
        likes_table.put_item(
            Item={
                **key,
                "requestId": request_id,
                "commentId": comment_id,
                "userId": user_id,
            }
        )
    else:
        likes_table.delete_item(Key=key)
    return LIKE_OK


def list_recent(
    group_id: str,
    limit: int = RECENT_LIMIT,
    consistent: bool = False,
    *,
    likes_by_request: dict | None = None,
) -> list[dict]:
    if likes_by_request is None:
        likes_by_request = comment_likes.likes_by_parent(
            group_id, "requestId", consistent=consistent
        )
    requests = [
        item
        for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item
    ]
    requests.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [
        _project(item, likes_by_request.get(item["id"]))
        for item in requests[:limit]
    ]
