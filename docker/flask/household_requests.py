"""Household request feed for the Roomie Status backend.

Requests share the activities DynamoDB table as typed items. That keeps the
local/dev/prod infrastructure unchanged while allowing the UI to add another
tabbed feed beside proposed activities. Activity scans ignore typed request
items, so the existing activity feed remains unchanged.
"""

from __future__ import annotations

import hashlib
import time
import uuid

from botocore.exceptions import ClientError

import activities

REQUEST_TYPE = "request"
REQUEST_COMMENT_LIKE_TYPE = "requestCommentLike"

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
DELETE_FORBIDDEN = "forbidden"


def _get_table():
    return activities._get_table()


def _scan_all(consistent: bool = False) -> list[dict]:
    return activities._scan_all(consistent=consistent)


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
    completed_at = item.get("completedAt")
    return {
        "id": item["id"],
        "text": item["text"],
        "requester": item.get("requester", "Someone"),
        "requesterId": item.get("requesterId"),
        "createdAt": int(item["createdAt"]),
        "requested": _requested_people(item),
        "requestedIds": sorted(set(item.get("requestedIds") or set())),
        "comments": comments,
        "isCompleted": bool(item.get("isCompleted", False)),
        "completedAt": int(completed_at) if completed_at is not None else None,
        "completedBy": item.get("completedBy"),
        "completedById": item.get("completedById"),
    }


def add_request(
    text: str,
    requester_id: str,
    requester_name: str,
    group_id: str,
    requested_roommates: list[dict],
) -> dict:
    names_by_id = {roommate["id"]: roommate["name"] for roommate in requested_roommates}
    item = {
        "id": uuid.uuid4().hex,
        "itemType": REQUEST_TYPE,
        "text": text,
        "requester": requester_name,
        "requesterId": requester_id,
        "groupId": group_id,
        "createdAt": int(time.time() * 1000),
        "requestedIds": set(names_by_id),
        "requestedNamesById": names_by_id,
        "responses": {},
        "isCompleted": False,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(request_id: str, group_id: str, consistent: bool = False) -> dict | None:
    item = _get_table().get_item(
        Key={"id": request_id},
        ConsistentRead=consistent,
    ).get("Item")
    if not item or item.get("itemType") != REQUEST_TYPE or item.get("groupId") != group_id:
        return None
    return _project(item)


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
    try:
        resp = _get_table().update_item(
            Key={"id": request_id},
            UpdateExpression="SET comments = list_append(if_not_exists(comments, :empty), :c)",
            ExpressionAttributeValues={
                ":request": REQUEST_TYPE,
                ":c": [comment],
                ":empty": [],
                ":groupId": group_id,
            },
            ConditionExpression="attribute_exists(id) AND itemType = :request AND groupId = :groupId",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def set_response(request_id: str, user_id: str, group_id: str, response: str) -> dict | None:
    try:
        resp = _get_table().update_item(
            Key={"id": request_id},
            UpdateExpression="SET responses.#user = :response",
            ExpressionAttributeNames={"#user": user_id},
            ExpressionAttributeValues={
                ":request": REQUEST_TYPE,
                ":user_id": user_id,
                ":response": response,
                ":groupId": group_id,
            },
            ConditionExpression=(
                "attribute_exists(id) AND itemType = :request AND "
                "groupId = :groupId AND "
                "contains(requestedIds, :user_id)"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def complete(request_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    completed_at = int(time.time() * 1000)
    try:
        resp = _get_table().update_item(
            Key={"id": request_id},
            UpdateExpression=(
                "SET isCompleted = :true, completedAt = :completed_at, "
                "completedById = :user_id, completedBy = :name"
            ),
            ExpressionAttributeValues={
                ":request": REQUEST_TYPE,
                ":true": True,
                ":completed_at": completed_at,
                ":user_id": user_id,
                ":name": name,
                ":groupId": group_id,
            },
            ConditionExpression="attribute_exists(id) AND itemType = :request AND groupId = :groupId",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def reopen(request_id: str, user_id: str, name: str, group_id: str) -> dict | None:
    try:
        resp = _get_table().update_item(
            Key={"id": request_id},
            UpdateExpression=(
                "SET isCompleted = :false, reopenedById = :user_id, "
                "reopenedBy = :name REMOVE completedAt, completedById, completedBy"
            ),
            ExpressionAttributeValues={
                ":request": REQUEST_TYPE,
                ":false": False,
                ":user_id": user_id,
                ":name": name,
                ":groupId": group_id,
            },
            ConditionExpression="attribute_exists(id) AND itemType = :request AND groupId = :groupId",
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return _project(resp["Attributes"])


def delete_owned(request_id: str, requester_id: str, group_id: str) -> str:
    table = _get_table()
    item = table.get_item(Key={"id": request_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != REQUEST_TYPE or item.get("groupId") != group_id:
        return DELETE_NOT_FOUND
    if item.get("requesterId") != requester_id:
        return DELETE_FORBIDDEN

    try:
        table.delete_item(
            Key={"id": request_id},
            ConditionExpression="requesterId = :requester AND itemType = :request AND groupId = :groupId",
            ExpressionAttributeValues={
                ":requester": requester_id,
                ":request": REQUEST_TYPE,
                ":groupId": group_id,
            },
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": request_id}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") != REQUEST_TYPE or current.get("groupId") != group_id:
            return DELETE_NOT_FOUND
        return DELETE_FORBIDDEN

    for reaction in _scan_all(consistent=True):
        if (
            reaction.get("itemType") == REQUEST_COMMENT_LIKE_TYPE
            and reaction.get("groupId") == group_id
            and reaction.get("requestId") == request_id
        ):
            table.delete_item(Key={"id": reaction["id"]})
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
    item = table.get_item(Key={"id": request_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != REQUEST_TYPE or item.get("groupId") != group_id:
        return LIKE_NOT_FOUND

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

    key = {"id": _comment_like_id(request_id, comment_id, user_id)}
    if liked:
        table.put_item(
            Item={
                **key,
                "itemType": REQUEST_COMMENT_LIKE_TYPE,
                "requestId": request_id,
                "commentId": comment_id,
                "groupId": group_id,
                "userId": user_id,
            }
        )
    else:
        table.delete_item(Key=key)
    return LIKE_OK


def list_recent(group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False) -> list[dict]:
    items = _scan_all(consistent=consistent)
    likes_by_request: dict[str, dict[str, set[str]]] = {}
    for item in items:
        if item.get("itemType") != REQUEST_COMMENT_LIKE_TYPE or item.get("groupId") != group_id:
            continue
        likes_by_request.setdefault(item["requestId"], {}).setdefault(
            item["commentId"], set()
        ).add(item["userId"])

    requests = [
        item
        for item in items
        if item.get("itemType") == REQUEST_TYPE and "createdAt" in item and item.get("groupId") == group_id
    ]
    requests.sort(key=lambda item: int(item["createdAt"]), reverse=True)
    return [
        _project(item, likes_by_request.get(item["id"]))
        for item in requests[:limit]
    ]
