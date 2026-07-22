"""Group-scoped Book Club records and mutations.

The Book Club has its own table because its history (books, meetings, ratings,
and chapter posts) should not inflate the group metadata item or the feed.
Rows are keyed by ``(groupId, id)``; this module never accepts a group id from
the client, so the route layer supplies the caller's selected membership.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
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


def _session_id(scheduled_at: int) -> str:
    stamp = datetime.fromtimestamp(scheduled_at / 1000, timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    return f"session#{stamp}"


def next_wednesday_evening(now: int | None = None) -> int:
    """Return the next 7:30 PM Wednesday in the club's IANA timezone.

    Calculating in local time rather than adding milliseconds is what preserves
    the meeting's wall-clock time across daylight-saving changes.
    """
    current = datetime.fromtimestamp((now or _now()) / 1000, ZoneInfo(TIMEZONE))
    days = (2 - current.weekday()) % 7  # Wednesday == 2
    candidate = current.replace(hour=19, minute=30, second=0, microsecond=0) + timedelta(days=days)
    if candidate <= current:
        candidate += timedelta(days=7)
    return int(candidate.timestamp() * 1000)


def _following_session_at(scheduled_at: int) -> int:
    local = datetime.fromtimestamp(scheduled_at / 1000, ZoneInfo(TIMEZONE))
    return int((local + timedelta(days=14)).timestamp() * 1000)


def _shift_session_at(scheduled_at: int, two_week_steps: int) -> int:
    """Move a meeting by calendar fortnights in Eastern time, preserving 7:30 PM."""
    local = datetime.fromtimestamp(scheduled_at / 1000, ZoneInfo(TIMEZONE))
    return int((local + timedelta(days=14 * two_week_steps)).timestamp() * 1000)


def _fetch(group_id: str, item_id: str, consistent: bool = True) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": item_id}, ConsistentRead=consistent
    ).get("Item")


def _book_id(raw: str) -> str:
    return raw[5:] if raw.startswith("book#") else raw


def _project_book(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {
        "id": item["bookId"], "title": item["title"], "author": item["author"],
        "recommendedById": item["recommendedById"], "recommendedByName": item["recommendedByName"],
        "status": item["status"], "selectedAt": int(item["selectedAt"]),
        "completedAt": int(item["completedAt"]) if item.get("completedAt") is not None else None,
    }


def _project_session(item: dict | None, members: list[dict] | None = None) -> dict | None:
    if item is None:
        return None
    projected = {
        "id": item["id"], "scheduledAt": int(item["scheduledAt"]), "bookId": item.get("bookId"),
        "bookTitle": item.get("bookTitle"), "readingTarget": item.get("readingTarget"),
        "snackDutyUserId": item["snackDutyUserId"], "snackDutyName": item["snackDutyName"],
        "status": item["status"],
        "completedAt": int(item["completedAt"]) if item.get("completedAt") is not None else None,
    }
    if members is not None:
        session_id = item["id"]
        responses = {
            response["userId"]: response
            for response in query_group(_get_table(), item.get("groupId", ""), consistent=False)
            if response.get("sessionId") == session_id
        }
        projected["responses"] = [
            {
                "userId": member["id"], "userName": member["name"],
                "attendanceStatus": responses.get(member["id"], {}).get("attendanceStatus"),
                "chaptersReadThrough": (
                    int(responses[member["id"]]["chaptersReadThrough"])
                    if member["id"] in responses else None
                ),
            }
            for member in members
        ]
    return projected


def _valid_rotations(rotations: list[str], member_ids: set[str]) -> bool:
    return bool(rotations) and all(isinstance(user_id, str) and user_id in member_ids for user_id in rotations)


def _validate_text(value, label: str, maximum: int = 160) -> tuple[str | None, str | None]:
    text = (value or "").strip() if isinstance(value, str) else ""
    if not text or len(text) > maximum:
        return None, f"{label} is required and must be at most {maximum} characters."
    return text, None


def configure(group_id: str, members: list[dict], body: dict) -> tuple[dict | None, str | None]:
    """Create the initial configuration, active book, and first meeting."""
    title, error = _validate_text(body.get("title"), "Book title")
    if error:
        return None, error
    author, error = _validate_text(body.get("author"), "Book author")
    if error:
        return None, error
    reading_target, error = _validate_text(body.get("readingTarget"), "Reading target")
    if error:
        return None, error
    member_ids = {member["id"] for member in members}
    snack_rotation = body.get("snackRotationUserIds") or [member["id"] for member in members]
    book_rotation = body.get("bookRotationUserIds") or [member["id"] for member in members]
    if not _valid_rotations(snack_rotation, member_ids) or not _valid_rotations(book_rotation, member_ids):
        return None, "Rotations must contain current group members."
    scheduled_at = body.get("scheduledAt", next_wednesday_evening())
    if isinstance(scheduled_at, bool) or not isinstance(scheduled_at, int) or scheduled_at <= _now():
        return None, "The next meeting must be a future epoch-millisecond timestamp."
    if _fetch(group_id, CONFIG_ID):
        return None, "Book Club is already configured."

    member_by_id = {member["id"]: member for member in members}
    book_id = uuid.uuid4().hex
    session_id = _session_id(scheduled_at)
    now = _now()
    recommender = member_by_id[book_rotation[0]]
    snack_member = member_by_id[snack_rotation[0]]
    config = {
        "groupId": group_id, "id": CONFIG_ID, "timezone": TIMEZONE, "frequency": "biweekly",
        "weekday": "wednesday", "localTime": "19:30", "nextSessionAt": scheduled_at,
        "nextSessionId": session_id, "activeBookId": book_id,
        "snackRotationUserIds": snack_rotation, "snackRotationCursor": 0,
        "bookRotationUserIds": book_rotation, "bookRotationCursor": 0,
        "createdAt": now, "updatedAt": now,
    }
    book = {
        "groupId": group_id, "id": f"book#{book_id}", "bookId": book_id, "title": title,
        "author": author, "recommendedById": recommender["id"], "recommendedByName": recommender["name"],
        "status": "active", "selectedAt": now, "createdAt": now, "updatedAt": now,
    }
    session = {
        "groupId": group_id, "id": session_id, "scheduledAt": scheduled_at, "bookId": book_id,
        "bookTitle": title, "readingTarget": reading_target, "snackDutyUserId": snack_member["id"],
        "snackDutyName": snack_member["name"], "status": "scheduled", "createdAt": now, "updatedAt": now,
    }
    table = _get_table()
    try:
        # The config condition makes setup idempotent from the UI's perspective:
        # a double submit cannot create two competing first sessions.
        table.put_item(Item=config, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None, "Book Club is already configured."
        raise
    table.put_item(Item=book)
    table.put_item(Item=session)
    return summary(group_id, members), None


def summary(group_id: str, members: list[dict]) -> dict | None:
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    if config is None:
        return None
    # DynamoDB has no scheduler. Reading the card is the durable trigger that
    # advances an overdue meeting, whether it happens on the exact minute or
    # when the first member opens the app afterwards.
    if _advance_if_due(group_id, members, config):
        config = _fetch(group_id, CONFIG_ID, consistent=True)
    book = _fetch(group_id, f"book#{config['activeBookId']}", consistent=True) if config.get("activeBookId") else None
    session = _fetch(group_id, config.get("nextSessionId", ""), consistent=True)
    return {
        "configuration": {
            "timezone": config["timezone"], "frequency": config["frequency"], "weekday": config["weekday"],
            "localTime": config["localTime"], "nextSessionAt": int(config["nextSessionAt"]),
            "snackRotationUserIds": list(config["snackRotationUserIds"]),
            "snackRotationCursor": int(config["snackRotationCursor"]),
            "bookRotationUserIds": list(config["bookRotationUserIds"]),
        },
        "activeBook": _project_book(book),
        "nextSession": _project_session(session, members),
    }


def set_response(group_id: str, session_id: str, member: dict, attendance: str, chapters) -> tuple[dict | None, str | None]:
    if attendance not in {"attending", "maybe", "not_attending"}:
        return None, "Attendance must be attending, maybe, or not_attending."
    if isinstance(chapters, bool) or not isinstance(chapters, int) or chapters < 0:
        return None, "Chapters read through must be a non-negative integer."
    session = _fetch(group_id, session_id)
    if session is None:
        return None, "Unknown session."
    if session.get("status") != "scheduled" or int(session["scheduledAt"]) <= _now():
        return None, "Responses are only available for scheduled future sessions."
    now = _now()
    response_id = f"session-member#{session_id[8:]}#{member['id']}"
    existing = _fetch(group_id, response_id)
    item = {
        "groupId": group_id, "id": response_id, "sessionId": session_id, "userId": member["id"],
        "userName": member["name"], "attendanceStatus": attendance, "chaptersReadThrough": chapters,
        "createdAt": existing.get("createdAt", now) if existing else now, "updatedAt": now,
    }
    _get_table().put_item(Item=item)
    return _project_session(session), None


def _advance_if_due(group_id: str, members: list[dict], config: dict) -> bool:
    """Advance the configured meeting after its scheduled instant has passed."""
    session = _fetch(group_id, config.get("nextSessionId", ""), consistent=True)
    if session is None or session.get("status") != "scheduled":
        return False
    if int(session["scheduledAt"]) > _now():
        return False
    _advance_session(group_id, members, config, session)
    return True


def _advance_session(group_id: str, members: list[dict], config: dict, session: dict) -> None:
    """Finish one meeting and carry its active plan into the next session.

    Book selection and its recommender remain stable across sessions, allowing
    a group to keep reading the same book. Snack duty advances independently,
    while the existing chapter goal continues until an admin changes it.
    """
    member_by_id = {member["id"]: member for member in members}
    snacks = config["snackRotationUserIds"]
    next_cursor = (int(config["snackRotationCursor"]) + 1) % len(snacks)
    if snacks[next_cursor] not in member_by_id:
        return None, "Snack rotation includes a former group member. Update the rotation first."
    next_at = _following_session_at(int(session["scheduledAt"]))
    next_id = _session_id(next_at)
    now = _now()
    next_session = {
        "groupId": group_id, "id": next_id, "scheduledAt": next_at,
        "bookId": session.get("bookId", config.get("activeBookId")),
        "bookTitle": session.get("bookTitle"),
        "readingTarget": session.get("readingTarget"),
        "snackDutyUserId": snacks[next_cursor], "snackDutyName": member_by_id[snacks[next_cursor]]["name"],
        "status": "scheduled", "createdAt": now, "updatedAt": now,
    }
    table = _get_table()
    table.update_item(Key={"groupId": group_id, "id": session["id"]}, UpdateExpression="SET #status = :completed, completedAt = :now, updatedAt = :now", ExpressionAttributeNames={"#status": "status"}, ExpressionAttributeValues={":completed": "completed", ":now": now})
    table.put_item(Item=next_session, ConditionExpression="attribute_not_exists(id)")
    table.update_item(
        Key={"groupId": group_id, "id": CONFIG_ID},
        UpdateExpression=(
            "SET nextSessionAt = :nextAt, nextSessionId = :nextId, "
            "snackRotationCursor = :cursor, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":nextAt": next_at, ":nextId": next_id, ":cursor": next_cursor, ":now": now,
        },
    )


def update_next_session(group_id: str, members: list[dict], body: dict) -> tuple[dict | None, str | None]:
    """Let an admin edit the next meeting, including its calendar fortnight."""
    title, error = _validate_text(body.get("title"), "Book title")
    if error:
        return None, error
    author, error = _validate_text(body.get("author"), "Book author")
    if error:
        return None, error
    reading_target, error = _validate_text(body.get("readingTarget"), "Chapter goal")
    if error:
        return None, error
    recommender_id = body.get("recommendedById")
    member_by_id = {member["id"]: member for member in members}
    if recommender_id not in member_by_id:
        return None, "Choose a current group member as the recommender."
    config = _fetch(group_id, CONFIG_ID)
    session = _fetch(group_id, config.get("nextSessionId", "")) if config else None
    if config is None or session is None or session.get("status") != "scheduled":
        return None, "No scheduled next session exists."
    meeting_offset = body.get("meetingOffset", 0)
    if isinstance(meeting_offset, bool) or not isinstance(meeting_offset, int) or abs(meeting_offset) > 26:
        return None, "Meeting time can move by up to 26 two-week increments."
    scheduled_at = _shift_session_at(int(session["scheduledAt"]), meeting_offset)
    if scheduled_at <= _now():
        return None, "This meeting has already started. Refresh to advance it."
    snack_duty_user_id = body.get("snackDutyUserId", session.get("snackDutyUserId"))
    if snack_duty_user_id not in member_by_id:
        return None, "Choose a current group member for snack duty."
    now = _now()
    book_id = config.get("activeBookId") or uuid.uuid4().hex
    book = _fetch(group_id, f"book#{book_id}")
    recommender = member_by_id[recommender_id]
    book_item = {
        "groupId": group_id, "id": f"book#{book_id}", "bookId": book_id, "title": title,
        "author": author, "recommendedById": recommender_id, "recommendedByName": recommender["name"],
        "status": "active", "selectedAt": book.get("selectedAt", now) if book else now,
        "createdAt": book.get("createdAt", now) if book else now, "updatedAt": now,
    }
    table = _get_table()
    table.put_item(Item=book_item)
    session_values = {
        "bookId": book_id, "bookTitle": title, "readingTarget": reading_target,
        "snackDutyUserId": snack_duty_user_id,
        "snackDutyName": member_by_id[snack_duty_user_id]["name"], "updatedAt": now,
    }
    next_session_id = session["id"]
    if meeting_offset:
        # The session id embeds its UTC time. Re-key the session (and the
        # deterministic response rows) instead of letting its id lie after a
        # calendar edit; prior attendance plans follow the rescheduled meeting.
        next_session_id = _session_id(scheduled_at)
        moved_session = {**session, **session_values, "id": next_session_id, "scheduledAt": scheduled_at}
        table.put_item(Item=moved_session, ConditionExpression="attribute_not_exists(id)")
        for response in query_group(table, group_id, consistent=True):
            if response.get("sessionId") != session["id"]:
                continue
            moved_response = {
                **response,
                "id": f"session-member#{next_session_id[8:]}#{response['userId']}",
                "sessionId": next_session_id,
                "updatedAt": now,
            }
            table.put_item(Item=moved_response)
            table.delete_item(Key={"groupId": group_id, "id": response["id"]})
        table.delete_item(Key={"groupId": group_id, "id": session["id"]})
    else:
        table.update_item(
            Key={"groupId": group_id, "id": session["id"]},
            UpdateExpression=(
                "SET bookId = :bookId, bookTitle = :title, readingTarget = :target, "
                "snackDutyUserId = :snackDutyUserId, snackDutyName = :snackDutyName, updatedAt = :now"
            ),
            ExpressionAttributeValues={
                ":bookId": book_id, ":title": title, ":target": reading_target,
                ":snackDutyUserId": snack_duty_user_id,
                ":snackDutyName": member_by_id[snack_duty_user_id]["name"], ":now": now,
            },
        )
    config_values = {":bookId": book_id, ":now": now, ":nextAt": scheduled_at, ":nextId": next_session_id}
    config_update = "SET activeBookId = :bookId, nextSessionAt = :nextAt, nextSessionId = :nextId, updatedAt = :now"
    if snack_duty_user_id in config["snackRotationUserIds"]:
        config_values[":snackCursor"] = config["snackRotationUserIds"].index(snack_duty_user_id)
        config_update = "SET activeBookId = :bookId, nextSessionAt = :nextAt, nextSessionId = :nextId, snackRotationCursor = :snackCursor, updatedAt = :now"
    table.update_item(Key={"groupId": group_id, "id": CONFIG_ID}, UpdateExpression=config_update, ExpressionAttributeValues=config_values)
    return summary(group_id, members), None


def complete_book(group_id: str, session_id: str) -> str | None:
    config = _fetch(group_id, CONFIG_ID)
    session = _fetch(group_id, session_id)
    if config is None or session is None or session.get("bookId") != config.get("activeBookId"):
        return "Unknown active book session."
    now = _now()
    book = _fetch(group_id, f"book#{session['bookId']}")
    if book is None:
        return "Unknown active book."
    cursor = (int(config["bookRotationCursor"]) + 1) % len(config["bookRotationUserIds"])
    _get_table().update_item(Key={"groupId": group_id, "id": book["id"]}, UpdateExpression="SET #status = :completed, completedAt = :now, updatedAt = :now", ExpressionAttributeNames={"#status": "status"}, ExpressionAttributeValues={":completed": "completed", ":now": now})
    _get_table().update_item(Key={"groupId": group_id, "id": CONFIG_ID}, UpdateExpression="REMOVE activeBookId SET bookRotationCursor = :cursor, updatedAt = :now", ExpressionAttributeValues={":cursor": cursor, ":now": now})
    return None


def list_completed(group_id: str) -> list[dict]:
    books = [item for item in query_group(_get_table(), group_id) if item.get("id", "").startswith("book#") and item.get("status") == "completed"]
    ratings = [item for item in query_group(_get_table(), group_id) if item.get("id", "").startswith("rating#")]
    result = []
    for book in books:
        values = [int(item["rating"]) for item in ratings if item.get("bookId") == book["bookId"]]
        result.append({**_project_book(book), "ratingCount": len(values), "averageRating": sum(values) / len(values) if values else None})
    return sorted(result, key=lambda book: book.get("completedAt") or 0, reverse=True)


def set_rating(group_id: str, book_id: str, member: dict, rating) -> str | None:
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        return "Rating must be an integer from 1 through 5."
    book = _fetch(group_id, f"book#{_book_id(book_id)}")
    if book is None or book.get("status") != "completed":
        return "Ratings are only available for completed books."
    now = _now()
    item_id = f"rating#{book['bookId']}#{member['id']}"
    existing = _fetch(group_id, item_id)
    _get_table().put_item(Item={"groupId": group_id, "id": item_id, "bookId": book["bookId"], "userId": member["id"], "userName": member["name"], "rating": rating, "createdAt": existing.get("createdAt", now) if existing else now, "updatedAt": now})
    return None


def list_posts(group_id: str, book_id: str, chapter_key: str | None = None) -> list[dict]:
    kwargs = {"IndexName": BOOK_ID_INDEX, "KeyConditionExpression": Key("bookId").eq(_book_id(book_id))}
    rows = []
    while True:
        response = _get_table().query(**kwargs)
        rows.extend(response.get("Items", []))
        if not response.get("LastEvaluatedKey"):
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return [
        {key: row[key] for key in ("id", "bookId", "chapterKey", "chapterLabel", "authorId", "authorName", "body", "createdAt", "updatedAt")}
        for row in sorted(rows, key=lambda row: int(row.get("createdAt", 0)))
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
    book = _fetch(group_id, f"book#{_book_id(book_id)}")
    if book is None:
        return None, "Unknown book."
    now = _now()
    post_id = uuid.uuid4().hex
    item = {"groupId": group_id, "id": f"post#{book['bookId']}#{chapter_key}#{now}#{post_id}", "bookId": book["bookId"], "chapterKey": chapter_key, "chapterLabel": chapter_label, "authorId": member["id"], "authorName": member["name"], "body": body, "createdAt": now, "updatedAt": now}
    _get_table().put_item(Item=item)
    return {key: item[key] for key in ("id", "bookId", "chapterKey", "chapterLabel", "authorId", "authorName", "body", "createdAt", "updatedAt")}, None
