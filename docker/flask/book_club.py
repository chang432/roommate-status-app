"""Group-scoped Book Club owner lists, meetings, and book history."""

from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from db import resource
from group_tables import query_group

TABLE_NAME = os.environ.get("BOOK_CLUB_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-book-club"
)
BOOK_ID_INDEX = "BookIdIndex"
CONFIG_ID = "config#book-club"
TIMEZONE = "America/New_York"
OPEN_STATUS = "scheduled"
COMPLETED_STATUS = "completed"
_table = None
_table_lock = threading.Lock()


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _now() -> int:
    return int(time.time() * 1000)


def _fetch(group_id: str, item_id: str, consistent: bool = True) -> dict | None:
    if not item_id:
        return None
    return _get_table().get_item(
        Key={"groupId": group_id, "id": item_id}, ConsistentRead=consistent
    ).get("Item")


def _validate_text(value, label: str, maximum: int = 160) -> tuple[str | None, str | None]:
    text = (value or "").strip() if isinstance(value, str) else ""
    if not text or len(text) > maximum:
        return None, f"{label} is required and must be at most {maximum} characters."
    return text, None


def next_wednesday_evening(now: int | None = None) -> int:
    current = datetime.fromtimestamp((now or _now()) / 1000, ZoneInfo(TIMEZONE))
    days = (2 - current.weekday()) % 7
    candidate = current.replace(hour=19, minute=30, second=0, microsecond=0) + timedelta(days=days)
    if candidate <= current:
        candidate += timedelta(days=7)
    return int(candidate.timestamp() * 1000)


def following_meeting_at(scheduled_at: int) -> int:
    """Advance by local calendar weeks so 7:30 stays 7:30 across DST."""
    local = datetime.fromtimestamp(scheduled_at / 1000, ZoneInfo(TIMEZONE))
    return int((local + timedelta(days=14)).timestamp() * 1000)


def meeting_label(scheduled_at: int) -> str:
    local = datetime.fromtimestamp(scheduled_at / 1000, ZoneInfo(TIMEZONE))
    hour = local.strftime("%I").lstrip("0") or "0"
    return f"{local:%a}, {local:%b} {local.day}, {hour}:{local:%M %p} ET"


def _member_order(config: dict | None, field: str, members: list[dict]) -> list[str]:
    member_ids = [member["id"] for member in members]
    if config:
        order = list(config.get(field) or [])
        # This fallback exists only for the deploy-before-migrate window.
        if not order:
            legacy_field = "bookRotationUserIds" if field.startswith("book") else "snackRotationUserIds"
            order = list(config.get(legacy_field) or [])
            cursor_field = "bookRotationCursor" if field.startswith("book") else "snackRotationCursor"
            if order:
                cursor = int(config.get(cursor_field, 0)) % len(order)
                order = order[cursor:] + order[:cursor]
    else:
        order = []
    current = [user_id for user_id in order if user_id in member_ids]
    current.extend(user_id for user_id in member_ids if user_id not in current)
    return current


def _move_to_front(order: list[str], selected_id: str) -> list[str]:
    """Make an admin selection sticky without disturbing everyone else's order."""
    return [selected_id, *(user_id for user_id in order if user_id != selected_id)]


def add_member_to_owner_lists(group_id: str, user_id: str) -> None:
    config = _fetch(group_id, CONFIG_ID)
    if config is None:
        return
    updates = []
    values = {":now": _now()}
    for field, token in (("bookOwnerOrderUserIds", "book"), ("snackOwnerOrderUserIds", "snack")):
        order = list(config.get(field) or [])
        if user_id not in order:
            order.append(user_id)
            updates.append(f"{field} = :{token}Order")
            values[f":{token}Order"] = order
    if updates:
        _get_table().update_item(
            Key={"groupId": group_id, "id": CONFIG_ID},
            UpdateExpression="SET " + ", ".join([*updates, "updatedAt = :now"]),
            ExpressionAttributeValues=values,
        )


def remove_member_from_owner_lists(group_id: str, user_id: str) -> None:
    config = _fetch(group_id, CONFIG_ID)
    if config is None:
        return
    book_order = [value for value in config.get("bookOwnerOrderUserIds", []) if value != user_id]
    snack_order = [value for value in config.get("snackOwnerOrderUserIds", []) if value != user_id]
    _get_table().update_item(
        Key={"groupId": group_id, "id": CONFIG_ID},
        UpdateExpression=(
            "SET bookOwnerOrderUserIds = :bookOrder, "
            "snackOwnerOrderUserIds = :snackOrder, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":bookOrder": book_order, ":snackOrder": snack_order, ":now": _now()
        },
    )


def _project_book(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {
        "id": item["bookId"],
        "title": item["title"],
        "author": item["author"],
        "bookOwnerId": item.get("bookOwnerId", item.get("recommendedById")),
        "bookOwnerName": item.get("bookOwnerName", item.get("recommendedByName")),
        "status": item["status"],
        "selectedAt": int(item["selectedAt"]),
        "completedAt": int(item["completedAt"]) if item.get("completedAt") is not None else None,
    }


def _responses(group_id: str, meeting_id: str) -> dict[str, dict]:
    return {
        item["userId"]: item
        for item in query_group(_get_table(), group_id, consistent=False)
        if item.get("meetingId", item.get("sessionId")) == meeting_id
    }


def _project_meeting(item: dict | None, members: list[dict] | None = None, book: dict | None = None) -> dict | None:
    if item is None:
        return None
    book_owner_id = item.get("bookOwnerId")
    book_owner_name = item.get("bookOwnerName")
    if not book_owner_id and book:
        book_owner_id = book.get("bookOwnerId", book.get("recommendedById"))
        book_owner_name = book.get("bookOwnerName", book.get("recommendedByName"))
    projected = {
        "id": item["id"],
        "scheduledAt": int(item["scheduledAt"]),
        "bookId": item.get("bookId"),
        "bookTitle": item.get("bookTitle"),
        "bookAuthor": item.get("bookAuthor", book.get("author") if book else None),
        "readingTarget": item.get("readingTarget", ""),
        "bookOwnerId": book_owner_id,
        "bookOwnerName": book_owner_name,
        "snackOwnerId": item.get("snackOwnerId", item.get("snackDutyUserId")),
        "snackOwnerName": item.get("snackOwnerName", item.get("snackDutyName")),
        "status": item.get("status", OPEN_STATUS),
        "createdById": item.get("createdById"),
        "createdByName": item.get("createdByName", "An admin"),
        "completedAt": int(item["completedAt"]) if item.get("completedAt") is not None else None,
        "createdAt": int(item.get("createdAt", item["scheduledAt"])),
        "updatedAt": int(item.get("updatedAt", item.get("createdAt", item["scheduledAt"]))),
    }
    if members is not None:
        responses = _responses(item["groupId"], item["id"])
        projected["responses"] = [
            {
                "userId": member["id"],
                "userName": member["name"],
                "attendanceStatus": responses.get(member["id"], {}).get("attendanceStatus", "not_attending"),
                "chaptersReadThrough": int(responses.get(member["id"], {}).get("chaptersReadThrough", 0)),
            }
            for member in members
        ]
    return projected


def summary(group_id: str, members: list[dict]) -> dict:
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    book_order = _member_order(config, "bookOwnerOrderUserIds", members)
    snack_order = _member_order(config, "snackOwnerOrderUserIds", members)
    active_book_id = config.get("activeBookId") if config else None
    active_book = _fetch(group_id, f"book#{active_book_id}") if active_book_id else None
    open_meeting_id = None
    if config:
        open_meeting_id = config.get("openMeetingId", config.get("nextSessionId"))
    open_meeting = _fetch(group_id, open_meeting_id) if open_meeting_id else None
    last_meeting_at = (
        int(config.get("lastMeetingAt", config.get("nextSessionAt")))
        if config and (config.get("lastMeetingAt") is not None or config.get("nextSessionAt") is not None)
        else None
    )
    return {
        "configuration": {
            "timezone": TIMEZONE,
            "bookOwnerOrderUserIds": book_order,
            "snackOwnerOrderUserIds": snack_order,
            "openMeetingId": open_meeting_id,
            "lastMeetingAt": last_meeting_at,
            "suggestedMeetingAt": (
                following_meeting_at(last_meeting_at)
                if last_meeting_at else next_wednesday_evening()
            ),
        },
        "activeBook": _project_book(active_book),
        "openMeeting": _project_meeting(open_meeting, members, active_book),
    }


def list_meetings(group_id: str, members: list[dict] | None = None) -> list[dict]:
    rows = query_group(_get_table(), group_id, consistent=True)
    books = {row.get("bookId"): row for row in rows if row.get("id", "").startswith("book#")}
    meetings = [
        _project_meeting(row, members, books.get(row.get("bookId")))
        for row in rows
        if row.get("id", "").startswith(("meeting#", "session#"))
    ]
    return sorted(meetings, key=lambda item: (item["scheduledAt"], item["createdAt"]))


def get_meeting(group_id: str, meeting_id: str, members: list[dict] | None = None) -> dict | None:
    item = _fetch(group_id, meeting_id)
    if item is None or not item.get("id", "").startswith(("meeting#", "session#")):
        return None
    book = _fetch(group_id, f"book#{item['bookId']}") if item.get("bookId") else None
    return _project_meeting(item, members, book)


def _meeting_values(body: dict, members: list[dict], config: dict | None, *, creating: bool) -> tuple[dict | None, str | None]:
    member_by_id = {member["id"]: member for member in members}
    book_order = _member_order(config, "bookOwnerOrderUserIds", members)
    snack_order = _member_order(config, "snackOwnerOrderUserIds", members)
    if not book_order or not snack_order:
        return None, "Book Club needs at least one current group member."
    book_owner_id = body.get("bookOwnerId") or book_order[0]
    snack_owner_id = body.get("snackOwnerId") or snack_order[0]
    if book_owner_id not in member_by_id or snack_owner_id not in member_by_id:
        return None, "Book and Snack owners must be current group members."
    title, error = _validate_text(body.get("title"), "Book title")
    if error:
        return None, error
    author, error = _validate_text(body.get("author"), "Book author")
    if error:
        return None, error
    reading_target, error = _validate_text(body.get("readingTarget"), "Reading target")
    if error:
        return None, error
    scheduled_at = body.get("scheduledAt")
    if isinstance(scheduled_at, bool) or not isinstance(scheduled_at, int) or scheduled_at < 0:
        return None, "Meeting time must be an epoch-millisecond timestamp."
    if creating and scheduled_at <= _now():
        return None, "A new meeting must be scheduled in the future."
    return {
        "scheduledAt": scheduled_at,
        "title": title,
        "author": author,
        "readingTarget": reading_target,
        "bookOwnerId": book_owner_id,
        "bookOwnerName": member_by_id[book_owner_id]["name"],
        "snackOwnerId": snack_owner_id,
        "snackOwnerName": member_by_id[snack_owner_id]["name"],
        "bookOrder": _move_to_front(book_order, book_owner_id),
        "snackOrder": _move_to_front(snack_order, snack_owner_id),
    }, None


def create_meeting(group_id: str, members: list[dict], creator: dict, body: dict) -> tuple[dict | None, str | None]:
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    open_id = config.get("openMeetingId", config.get("nextSessionId")) if config else None
    if open_id and _fetch(group_id, open_id):
        return None, "Complete the open meeting before creating another one."
    values, error = _meeting_values(body, members, config, creating=True)
    if error:
        return None, error
    now = _now()
    table = _get_table()
    active_book_id = config.get("activeBookId") if config else None
    book = _fetch(group_id, f"book#{active_book_id}") if active_book_id else None
    if book is None or book.get("status") != "active":
        active_book_id = uuid.uuid4().hex
        book = {
            "groupId": group_id,
            "id": f"book#{active_book_id}",
            "bookId": active_book_id,
            "title": values["title"],
            "author": values["author"],
            "bookOwnerId": values["bookOwnerId"],
            "bookOwnerName": values["bookOwnerName"],
            "status": "active",
            "selectedAt": now,
            "createdAt": now,
            "updatedAt": now,
        }
    else:
        book = {
            **book,
            "title": values["title"],
            "author": values["author"],
            "bookOwnerId": values["bookOwnerId"],
            "bookOwnerName": values["bookOwnerName"],
            "updatedAt": now,
        }
        book.pop("recommendedById", None)
        book.pop("recommendedByName", None)
    meeting_id = f"meeting#{uuid.uuid4().hex}"
    meeting = {
        "groupId": group_id,
        "id": meeting_id,
        "scheduledAt": values["scheduledAt"],
        "bookId": active_book_id,
        "bookTitle": values["title"],
        "bookAuthor": values["author"],
        "readingTarget": values["readingTarget"],
        "bookOwnerId": values["bookOwnerId"],
        "bookOwnerName": values["bookOwnerName"],
        "snackOwnerId": values["snackOwnerId"],
        "snackOwnerName": values["snackOwnerName"],
        "status": OPEN_STATUS,
        "createdById": creator["id"],
        "createdByName": creator["name"],
        "createdAt": now,
        "updatedAt": now,
    }
    if config is None:
        config = {
            "groupId": group_id,
            "id": CONFIG_ID,
            "timezone": TIMEZONE,
            "createdAt": now,
        }
    config = {
        **config,
        "activeBookId": active_book_id,
        "openMeetingId": meeting_id,
        "lastMeetingAt": values["scheduledAt"],
        "bookOwnerOrderUserIds": values["bookOrder"],
        "snackOwnerOrderUserIds": values["snackOrder"],
        "updatedAt": now,
    }
    for field in ("nextSessionAt", "nextSessionId", "bookRotationUserIds", "bookRotationCursor", "snackRotationUserIds", "snackRotationCursor", "frequency", "weekday", "localTime"):
        config.pop(field, None)
    try:
        # The config condition is the one-open-meeting lock. Keeping all three
        # writes in one transaction avoids orphaned books or meetings if two
        # admin requests arrive together.
        table.meta.client.transact_write_items(TransactItems=[
            {"Put": {
                "TableName": TABLE_NAME,
                "Item": meeting,
                "ConditionExpression": "attribute_not_exists(id)",
            }},
            {"Put": {"TableName": TABLE_NAME, "Item": book}},
            {"Put": {
                "TableName": TABLE_NAME,
                "Item": config,
                "ConditionExpression": (
                    "attribute_not_exists(openMeetingId) AND "
                    "attribute_not_exists(nextSessionId)"
                ),
            }},
        ])
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {
            "ConditionalCheckFailedException", "TransactionCanceledException"
        }:
            return None, "Complete the open meeting before creating another one."
        raise
    return _project_meeting(meeting, members, book), None


def update_meeting(group_id: str, meeting_id: str, members: list[dict], body: dict) -> tuple[dict | None, str | None]:
    meeting = _fetch(group_id, meeting_id)
    config = _fetch(group_id, CONFIG_ID)
    if meeting is None:
        return None, "Unknown meeting."
    if meeting.get("status") != OPEN_STATUS:
        return None, "Completed meetings are read-only."
    values, error = _meeting_values(body, members, config, creating=False)
    if error:
        return None, error
    now = _now()
    meeting.update({
        "scheduledAt": values["scheduledAt"],
        "bookTitle": values["title"],
        "bookAuthor": values["author"],
        "readingTarget": values["readingTarget"],
        "bookOwnerId": values["bookOwnerId"],
        "bookOwnerName": values["bookOwnerName"],
        "snackOwnerId": values["snackOwnerId"],
        "snackOwnerName": values["snackOwnerName"],
        "updatedAt": now,
    })
    for field in ("snackDutyUserId", "snackDutyName"):
        meeting.pop(field, None)
    book = _fetch(group_id, f"book#{meeting['bookId']}")
    if book and book.get("status") == "active":
        book.update({
            "title": values["title"], "author": values["author"],
            "bookOwnerId": values["bookOwnerId"], "bookOwnerName": values["bookOwnerName"],
            "updatedAt": now,
        })
        book.pop("recommendedById", None)
        book.pop("recommendedByName", None)
        _get_table().put_item(Item=book)
    _get_table().put_item(Item=meeting)
    _get_table().update_item(
        Key={"groupId": group_id, "id": CONFIG_ID},
        UpdateExpression=(
            "SET lastMeetingAt = :scheduledAt, bookOwnerOrderUserIds = :bookOrder, "
            "snackOwnerOrderUserIds = :snackOrder, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":scheduledAt": values["scheduledAt"], ":bookOrder": values["bookOrder"],
            ":snackOrder": values["snackOrder"], ":now": now,
        },
    )
    return _project_meeting(meeting, members, book), None


def complete_meeting(group_id: str, meeting_id: str, completer: dict) -> tuple[dict | None, str | None]:
    meeting = _fetch(group_id, meeting_id)
    if meeting is None:
        return None, "Unknown meeting."
    if meeting.get("status") != OPEN_STATUS:
        return None, "The meeting is already completed."
    now = _now()
    meeting.update({
        "status": COMPLETED_STATUS,
        "completedAt": now,
        "completedById": completer["id"],
        "completedByName": completer["name"],
        "updatedAt": now,
    })
    _get_table().put_item(Item=meeting)
    try:
        _get_table().update_item(
            Key={"groupId": group_id, "id": CONFIG_ID},
            # Remove both shapes so the app remains safe during the brief
            # deploy-before-migration window.
            UpdateExpression="REMOVE openMeetingId, nextSessionId SET updatedAt = :now",
            ConditionExpression="openMeetingId = :meetingId OR nextSessionId = :meetingId",
            ExpressionAttributeValues={":meetingId": meeting_id, ":now": now},
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
    return _project_meeting(meeting), None


def set_response(group_id: str, meeting_id: str, member: dict, attendance: str, chapters) -> tuple[dict | None, str | None]:
    if attendance not in {"attending", "maybe", "not_attending"}:
        return None, "Attendance must be attending, maybe, or not_attending."
    if isinstance(chapters, bool) or not isinstance(chapters, int) or chapters < 0:
        return None, "Chapters read through must be a non-negative integer."
    meeting = _fetch(group_id, meeting_id)
    if meeting is None:
        return None, "Unknown meeting."
    if meeting.get("status") != OPEN_STATUS:
        return None, "Responses are only available until a meeting is completed."
    now = _now()
    meeting_key = meeting_id.split("#", 1)[-1]
    response_id = f"meeting-member#{meeting_key}#{member['id']}"
    existing = _fetch(group_id, response_id)
    _get_table().put_item(Item={
        "groupId": group_id,
        "id": response_id,
        "meetingId": meeting_id,
        "userId": member["id"],
        "userName": member["name"],
        "attendanceStatus": attendance,
        "chaptersReadThrough": chapters,
        "createdAt": existing.get("createdAt", now) if existing else now,
        "updatedAt": now,
    })
    return get_meeting(group_id, meeting_id), None


def complete_book(group_id: str, book_id: str) -> str | None:
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    book = _fetch(group_id, f"book#{normalized}")
    config = _fetch(group_id, CONFIG_ID)
    if book is None or book.get("status") != "active":
        return "Unknown active book."
    if config is None or config.get("activeBookId") != normalized:
        return "Unknown active book."
    now = _now()
    _get_table().update_item(
        Key={"groupId": group_id, "id": book["id"]},
        UpdateExpression="SET #status = :completed, completedAt = :now, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":completed": "completed", ":now": now},
    )
    _get_table().update_item(
        Key={"groupId": group_id, "id": CONFIG_ID},
        UpdateExpression="REMOVE activeBookId SET updatedAt = :now",
        ExpressionAttributeValues={":now": now},
    )
    return None


def list_completed(group_id: str, viewer_id: str | None = None) -> list[dict]:
    rows = query_group(_get_table(), group_id)
    books = [row for row in rows if row.get("id", "").startswith("book#") and row.get("status") == "completed"]
    ratings = [row for row in rows if row.get("id", "").startswith("rating#")]
    result = []
    for book in books:
        values = [int(item["rating"]) for item in ratings if item.get("bookId") == book["bookId"]]
        result.append({
            **_project_book(book),
            "ratingCount": len(values),
            "averageRating": sum(values) / len(values) if values else None,
            "viewerRating": next(
                (int(item["rating"]) for item in ratings
                 if item.get("bookId") == book["bookId"] and item.get("userId") == viewer_id),
                None,
            ),
        })
    return sorted(result, key=lambda item: item.get("completedAt") or 0, reverse=True)


def set_rating(group_id: str, book_id: str, member: dict, rating) -> str | None:
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        return "Rating must be an integer from 1 through 5."
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    book = _fetch(group_id, f"book#{normalized}")
    if book is None or book.get("status") != "completed":
        return "Ratings are only available for completed books."
    now = _now()
    item_id = f"rating#{normalized}#{member['id']}"
    existing = _fetch(group_id, item_id)
    _get_table().put_item(Item={
        "groupId": group_id, "id": item_id, "bookId": normalized,
        "userId": member["id"], "userName": member["name"], "rating": rating,
        "createdAt": existing.get("createdAt", now) if existing else now, "updatedAt": now,
    })
    return None


def list_posts(group_id: str, book_id: str, chapter_key: str | None = None) -> list[dict]:
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    kwargs = {"IndexName": BOOK_ID_INDEX, "KeyConditionExpression": Key("bookId").eq(normalized)}
    rows = []
    while True:
        response = _get_table().query(**kwargs)
        rows.extend(response.get("Items", []))
        if not response.get("LastEvaluatedKey"):
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    keys = ("id", "bookId", "chapterKey", "chapterLabel", "authorId", "authorName", "body", "createdAt", "updatedAt")
    return [
        {key: row[key] for key in keys}
        for row in sorted(rows, key=lambda value: int(value.get("createdAt", 0)))
        if row.get("groupId") == group_id
        and row.get("id", "").startswith("post#")
        and (chapter_key is None or row.get("chapterKey") == chapter_key)
    ]


def create_post(group_id: str, member: dict, book_id: str, chapter_key, chapter_label, body) -> tuple[dict | None, str | None]:
    chapter_key, error = _validate_text(chapter_key, "Chapter key", 80)
    if error:
        return None, error
    chapter_label, error = _validate_text(chapter_label, "Chapter label", 120)
    if error:
        return None, error
    body, error = _validate_text(body, "Post", 1000)
    if error:
        return None, error
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    if _fetch(group_id, f"book#{normalized}") is None:
        return None, "Unknown book."
    now = _now()
    post_id = uuid.uuid4().hex
    item = {
        "groupId": group_id, "id": f"post#{normalized}#{chapter_key}#{now}#{post_id}",
        "bookId": normalized, "chapterKey": chapter_key, "chapterLabel": chapter_label,
        "authorId": member["id"], "authorName": member["name"], "body": body,
        "createdAt": now, "updatedAt": now,
    }
    _get_table().put_item(Item=item)
    keys = ("id", "bookId", "chapterKey", "chapterLabel", "authorId", "authorName", "body", "createdAt", "updatedAt")
    return {key: item[key] for key in keys}, None
