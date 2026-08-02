"""Book-tagged household forums stored in the Book Club table."""

from __future__ import annotations

import copy
import time
import uuid

from botocore.exceptions import ClientError

import book_club
import comment_likes
from group_tables import query_group

RECENT_LIMIT = 10
COMMENTS_LIMIT = 100
FORUM_PREFIX = "book-forum#"

NOT_FOUND = "not_found"
FORBIDDEN = "forbidden"
READ_ONLY = "read_only"
CONFLICT = "conflict"
LIKE_SELF_FORBIDDEN = "like_self_forbidden"


def _table():
    return book_club.table()


def _fetch(forum_id: str, group_id: str) -> dict | None:
    item = _table().get_item(
        Key={"groupId": group_id, "id": forum_id}, ConsistentRead=True
    ).get("Item")
    return item if item and item.get("id", "").startswith(FORUM_PREFIX) else None


def _book(group_id: str, book_id: str) -> dict | None:
    return book_club.get_book(group_id, book_id)


def _now_after(item: dict) -> int:
    return max(
        int(time.time() * 1000),
        int(item.get("updatedAt", item.get("createdAt", 0))) + 1,
    )


def _comment_entries(item: dict) -> list[tuple[str, dict]]:
    return [
        (comment.get("id") or f"legacy-forum-comment-{index}", comment)
        for index, comment in enumerate(item.get("comments") or [])
    ]


def _project(
    item: dict,
    book: dict | None,
    likes_by_comment: dict[str, set[str]] | None = None,
) -> dict:
    likes_by_comment = likes_by_comment or {}
    archived_at = item.get("archivedAt")
    return {
        "id": item["id"],
        "title": item.get("title", ""),
        "bookId": item.get("bookId"),
        "bookTitle": book.get("title", "Unavailable book") if book else "Unavailable book",
        "bookAuthor": book.get("author", "") if book else "",
        "createdById": item.get("createdById"),
        "createdBy": item.get("createdBy", "Someone"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "comments": [
            {
                "id": comment_id,
                "author": comment.get("author", "Someone"),
                "authorId": comment.get("authorId"),
                "text": comment.get("text", ""),
                "createdAt": int(comment["createdAt"]),
                "mentions": [
                    {"id": mention["id"], "name": mention["name"]}
                    for mention in comment.get("mentions") or []
                    if mention.get("id") and mention.get("name")
                ],
                "mentionsAll": bool(comment.get("mentionsAll", False)),
                "likedByIds": sorted(likes_by_comment.get(comment_id, set())),
                "likeCount": len(likes_by_comment.get(comment_id, set())),
            }
            for comment_id, comment in _comment_entries(item)[-COMMENTS_LIMIT:]
        ],
        "isArchived": bool(item.get("isArchived", False)),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "archivedById": item.get("archivedById"),
        "archivedBy": item.get("archivedBy"),
        "version": int(item.get("version", 0)),
    }


def add_forum(
    title: str, book_id: str, created_by_id: str, created_by: str, group_id: str
) -> dict | str:
    book = _book(group_id, book_id)
    if book is None:
        return NOT_FOUND
    now_ms = int(time.time() * 1000)
    item = {
        "groupId": group_id,
        "id": f"{FORUM_PREFIX}{uuid.uuid4().hex}",
        "title": title,
        "bookId": book_id,
        "createdById": created_by_id,
        "createdBy": created_by,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "comments": [],
        "isArchived": False,
        "version": 0,
    }
    _table().put_item(Item=item)
    return _project(item, book)


def get(forum_id: str, group_id: str) -> dict | None:
    item = _fetch(forum_id, group_id)
    if item is None:
        return None
    likes = comment_likes.likes_by_parent(group_id, "forumId", consistent=True)
    return _project(item, _book(group_id, item.get("bookId", "")), likes.get(forum_id))


def _mutate(forum_id: str, group_id: str, mutate, *, require_active: bool = True):
    """Retry whole-item writes so embedded comments cannot overwrite each other."""
    for _ in range(5):
        item = _fetch(forum_id, group_id)
        if item is None:
            return NOT_FOUND
        if require_active and item.get("isArchived"):
            return READ_ONLY
        next_item = copy.deepcopy(item)
        result = mutate(next_item)
        if isinstance(result, str):
            return result
        old_version = int(item.get("version", 0))
        next_item["version"] = old_version + 1
        next_item["updatedAt"] = _now_after(item)
        values = {":version": old_version}
        condition = "attribute_exists(id) AND version = :version"
        if require_active:
            values[":false"] = False
            condition += " AND (attribute_not_exists(isArchived) OR isArchived = :false)"
        try:
            _table().put_item(
                Item=next_item,
                ConditionExpression=condition,
                ExpressionAttributeValues=values,
            )
            return get(forum_id, group_id)
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return CONFLICT


def edit_owned(
    forum_id: str, user_id: str, group_id: str, title: str, book_id: str
):
    book = _book(group_id, book_id)
    if book is None:
        return NOT_FOUND

    def mutate(item):
        if item.get("createdById") != user_id:
            return FORBIDDEN
        item["title"] = title
        item["bookId"] = book_id

    return _mutate(forum_id, group_id, mutate)


def add_comment(
    forum_id: str,
    author_id: str,
    author: str,
    group_id: str,
    text: str,
    mentions: list[dict] | None = None,
    mentions_all: bool = False,
):
    comment = {
        "id": uuid.uuid4().hex,
        "authorId": author_id,
        "author": author,
        "text": text,
        "mentions": mentions or [],
        "mentionsAll": mentions_all,
        "createdAt": int(time.time() * 1000),
    }

    def mutate(item):
        comments = item.setdefault("comments", [])
        comments.append(comment)
        # Match the feed contract while preventing a new unbounded item shape.
        item["comments"] = comments[-COMMENTS_LIMIT:]

    return _mutate(forum_id, group_id, mutate)


def participant_ids(item: dict) -> set[str]:
    participants = {item.get("createdById")}
    participants.update(
        comment.get("authorId") for comment in item.get("comments") or []
    )
    participants.discard(None)
    return participants


def set_comment_like(
    forum_id: str,
    comment_id: str,
    user_id: str,
    user_name: str,
    group_id: str,
    liked: bool,
) -> str:
    item = _fetch(forum_id, group_id)
    if item is None:
        return NOT_FOUND
    if item.get("isArchived"):
        return READ_ONLY
    comment = next(
        (raw for candidate_id, raw in _comment_entries(item) if candidate_id == comment_id),
        None,
    )
    if comment is None:
        return NOT_FOUND
    if comment.get("authorId") == user_id or (
        not comment.get("authorId")
        and comment.get("author", "").strip().casefold() == user_name.strip().casefold()
    ):
        return LIKE_SELF_FORBIDDEN

    key = {
        "groupId": group_id,
        "id": f"forum-comment-like#{forum_id}#{comment_id}#{user_id}",
    }
    if liked:
        comment_likes._get_table().put_item(
            Item={
                **key,
                "forumId": forum_id,
                "commentId": comment_id,
                "userId": user_id,
            }
        )
    else:
        comment_likes._get_table().delete_item(Key=key)
    return "ok"


def archive(forum_id: str, user_id: str, name: str, group_id: str):
    def mutate(item):
        item.update(
            isArchived=True,
            archivedAt=_now_after(item),
            archivedById=user_id,
            archivedBy=name,
        )

    return _mutate(forum_id, group_id, mutate, require_active=False)


def restore(forum_id: str, user_id: str, name: str, group_id: str):
    def mutate(item):
        item["isArchived"] = False
        item["restoredById"] = user_id
        item["restoredBy"] = name
        for field in ("archivedAt", "archivedById", "archivedBy"):
            item.pop(field, None)

    return _mutate(forum_id, group_id, mutate, require_active=False)


def delete(forum_id: str, group_id: str) -> dict | None:
    item = _fetch(forum_id, group_id)
    if item is None:
        return None
    _table().delete_item(Key={"groupId": group_id, "id": forum_id})
    comment_likes.delete_for_parent(group_id, "forumId", forum_id)
    return _project(item, _book(group_id, item.get("bookId", "")))


def list_recent(
    group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False
) -> list[dict]:
    rows = query_group(_table(), group_id, consistent=consistent)
    likes_by_forum = comment_likes.likes_by_parent(
        group_id, "forumId", consistent=consistent
    )
    books = {
        row["bookId"]: book_club.project_book(row)
        for row in rows
        if row.get("id", "").startswith("book#") and row.get("bookId")
    }
    forums = [
        row for row in rows if row.get("id", "").startswith(FORUM_PREFIX)
    ]
    forums.sort(
        key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True
    )
    return [
        _project(item, books.get(item.get("bookId")), likes_by_forum.get(item["id"]))
        for item in forums[:limit]
    ]
