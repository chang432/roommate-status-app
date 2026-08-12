"""Group-scoped Book Club owner lists, meetings, and book history."""

from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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
REVIEW_NOTE_LIMIT = 1000
BOOK_TAG_LIMIT = 10
BOOK_TAG_LENGTH = 32
_table = None
_table_lock = threading.Lock()


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def table():
    """Expose the shared Book Club table to focused sibling persistence modules."""
    return _get_table()


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
        "tags": list(item.get("tags") or []),
        "completedAt": int(item["completedAt"]) if item.get("completedAt") is not None else None,
    }


def project_book(item: dict | None) -> dict | None:
    return _project_book(item)


def get_book(group_id: str, book_id: str) -> dict | None:
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    return _project_book(_fetch(group_id, f"book#{normalized}"))


def _responses(group_id: str, meeting_id: str) -> dict[str, dict]:
    meeting_key = meeting_id.split("#", 1)[-1]
    response_prefix = f"meeting-member#{meeting_key}#"
    responses = {}
    for item in query_group(_get_table(), group_id, consistent=False):
        response_id = item.get("id", "")
        if not response_id.startswith(response_prefix) or item.get("meetingId") != meeting_id:
            continue
        # Early meeting-response rows encoded the member only in the sort key.
        user_id = item.get("userId") or response_id.removeprefix(response_prefix)
        if user_id:
            responses[user_id] = item
    return responses


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
                "attendanceStatus": responses.get(member["id"], {}).get("attendanceStatus"),
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


def list_rows(group_id: str, consistent: bool = False) -> list[dict]:
    """Load the shared Book Club partition for request-local reuse."""
    return query_group(_get_table(), group_id, consistent=consistent)


def list_meetings(
    group_id: str,
    members: list[dict] | None = None,
    *,
    consistent: bool = True,
    rows: list[dict] | None = None,
) -> list[dict]:
    if rows is None:
        rows = list_rows(group_id, consistent=consistent)
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


def _normalize_book_tags(value) -> tuple[list[str] | None, str | None]:
    if not isinstance(value, list):
        return None, "Book tags must be a list."
    normalized = []
    seen = set()
    for tag in value:
        if not isinstance(tag, str):
            return None, "Every book tag must be text."
        label = " ".join(tag.split())
        if not label:
            return None, "Book tags cannot be empty."
        if len(label) > BOOK_TAG_LENGTH:
            return None, f"Book tags must be at most {BOOK_TAG_LENGTH} characters."
        key = label.casefold()
        if key not in seen:
            seen.add(key)
            normalized.append(label)
    if len(normalized) > BOOK_TAG_LIMIT:
        return None, f"Books can have at most {BOOK_TAG_LIMIT} tags."
    return normalized, None


def _book_values(
    body: dict, members: list[dict], existing: dict | None = None
) -> tuple[dict | None, str | None]:
    member_by_id = {member["id"]: member for member in members}
    title, error = _validate_text(body.get("title"), "Book title")
    if error:
        return None, error
    author, error = _validate_text(body.get("author"), "Book author")
    if error:
        return None, error
    book_owner_id = body.get("bookOwnerId")
    if book_owner_id not in member_by_id:
        return None, "Book owner must be a current group member."
    # Older PATCH callers omit this additive field, so preserve it only when editing.
    tags, error = _normalize_book_tags(
        body.get("tags", list(existing.get("tags") or []) if existing else [])
    )
    if error:
        return None, error
    return {
        "title": title,
        "author": author,
        "bookOwnerId": book_owner_id,
        "bookOwnerName": member_by_id[book_owner_id]["name"],
        "tags": tags,
    }, None


def add_book(group_id: str, members: list[dict], body: dict) -> tuple[dict | None, str | None]:
    values, error = _book_values(body, members)
    if error:
        return None, error
    now = _now()
    book_id = uuid.uuid4().hex
    book = {
        "groupId": group_id,
        "id": f"book#{book_id}",
        "bookId": book_id,
        **values,
        "createdAt": now,
        "updatedAt": now,
    }
    table = _get_table()
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    open_meeting_id = config.get("openMeetingId") if config else None
    if open_meeting_id and _fetch(group_id, open_meeting_id):
        return None, "Complete the open meeting before adding a new book."

    prior_book_id = config.get("activeBookId") if config else None
    book_order = _member_order(config, "bookOwnerOrderUserIds", members)
    if values["bookOwnerId"] in book_order:
        book_order = _move_to_front(book_order, values["bookOwnerId"])
    config_condition = (
        "activeBookId = :priorBookId AND attribute_not_exists(openMeetingId) "
        "AND attribute_not_exists(nextSessionId)"
        if prior_book_id
        else "attribute_not_exists(activeBookId) AND attribute_not_exists(openMeetingId) "
        "AND attribute_not_exists(nextSessionId)"
    )
    config_values = {
        ":bookId": book_id,
        ":bookOrder": book_order,
        ":timezone": TIMEZONE,
        ":now": now,
    }
    if prior_book_id:
        config_values[":priorBookId"] = prior_book_id
    transaction = [
        {"Put": {
            "TableName": TABLE_NAME,
            "Item": book,
            "ConditionExpression": "attribute_not_exists(id)",
        }},
        {"Update": {
            "TableName": TABLE_NAME,
            "Key": {"groupId": group_id, "id": CONFIG_ID},
            # The configuration condition is the single-current lock. It also
            # stops a replacement from racing an open-meeting creation.
            "UpdateExpression": (
                "SET activeBookId = :bookId, bookOwnerOrderUserIds = :bookOrder, "
                "#timezone = if_not_exists(#timezone, :timezone), "
                "createdAt = if_not_exists(createdAt, :now), updatedAt = :now"
            ),
            "ConditionExpression": config_condition,
            "ExpressionAttributeNames": {"#timezone": "timezone"},
            "ExpressionAttributeValues": config_values,
        }},
    ]
    if prior_book_id:
        transaction.append({"Update": {
            "TableName": TABLE_NAME,
            "Key": {"groupId": group_id, "id": f"book#{prior_book_id}"},
            "UpdateExpression": "SET completedAt = :now, updatedAt = :now",
            "ConditionExpression": "attribute_exists(id)",
            "ExpressionAttributeValues": {":now": now},
        }})
    try:
        table.meta.client.transact_write_items(TransactItems=transaction)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {
            "ConditionalCheckFailedException", "TransactionCanceledException"
        }:
            return None, "Complete the open meeting before adding a new book."
        raise
    return _project_book(book), None


def update_book(
    group_id: str, book_id: str, members: list[dict], body: dict
) -> tuple[dict | None, str | None]:
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    book = _fetch(group_id, f"book#{normalized}")
    if book is None:
        return None, "Unknown Book Club book."
    values, error = _book_values(body, members, book)
    if error:
        return None, error
    set_as_current = body.get("setAsCurrent", False)
    if not isinstance(set_as_current, bool):
        return None, "Set as current must be true or false."
    now = _now()
    book.update({**values, "updatedAt": now})
    book.pop("recommendedById", None)
    book.pop("recommendedByName", None)
    table = _get_table()
    config = _fetch(group_id, CONFIG_ID, consistent=True)

    if set_as_current:
        if config is None:
            return None, "Book Club configuration is unavailable."
        # Restoring a completed title must claim the single-current pointer and
        # clear its completion date together, so concurrent book changes cannot
        # leave the library without (or with two) current titles.
        book.pop("completedAt", None)
        book_order = _member_order(config, "bookOwnerOrderUserIds", members)
        try:
            table.meta.client.transact_write_items(TransactItems=[
                {"Put": {
                    "TableName": TABLE_NAME,
                    "Item": book,
                    "ConditionExpression": "attribute_exists(id)",
                }},
                {"Update": {
                    "TableName": TABLE_NAME,
                    "Key": {"groupId": group_id, "id": CONFIG_ID},
                    "UpdateExpression": (
                        "SET activeBookId = :bookId, bookOwnerOrderUserIds = :bookOrder, "
                        "updatedAt = :now"
                    ),
                    "ConditionExpression": (
                        "attribute_not_exists(activeBookId) "
                        "AND attribute_not_exists(openMeetingId) "
                        "AND attribute_not_exists(nextSessionId)"
                    ),
                    "ExpressionAttributeValues": {
                        ":bookId": normalized,
                        ":bookOrder": _move_to_front(book_order, values["bookOwnerId"]),
                        ":now": now,
                    },
                }},
            ])
        except ClientError as exc:
            if exc.response["Error"]["Code"] in {
                "ConditionalCheckFailedException", "TransactionCanceledException"
            }:
                return None, "A current book or open meeting already exists."
            raise
    else:
        table.put_item(Item=book)

    # Meeting rows intentionally keep display snapshots. A catalog correction
    # rewrites all snapshots so history cannot disagree with the canonical book.
    for item in query_group(table, group_id, consistent=True):
        if (
            item.get("id", "").startswith(("meeting#", "session#"))
            and item.get("bookId") == normalized
        ):
            item.update({
                "bookTitle": values["title"],
                "bookAuthor": values["author"],
                "bookOwnerId": values["bookOwnerId"],
                "bookOwnerName": values["bookOwnerName"],
                "updatedAt": now,
            })
            table.put_item(Item=item)

    if not set_as_current and config and config.get("activeBookId") == normalized:
        book_order = _member_order(config, "bookOwnerOrderUserIds", members)
        table.update_item(
            Key={"groupId": group_id, "id": CONFIG_ID},
            UpdateExpression="SET bookOwnerOrderUserIds = :bookOrder, updatedAt = :now",
            ExpressionAttributeValues={
                ":bookOrder": _move_to_front(book_order, values["bookOwnerId"]),
                ":now": now,
            },
        )
    return _project_book(book), None


def _meeting_values(body: dict, members: list[dict], config: dict | None, *, creating: bool) -> tuple[dict | None, str | None]:
    member_by_id = {member["id"]: member for member in members}
    snack_order = _member_order(config, "snackOwnerOrderUserIds", members)
    if not snack_order:
        return None, "Book Club needs at least one current group member."
    snack_owner_id = body.get("snackOwnerId") or snack_order[0]
    if snack_owner_id not in member_by_id:
        return None, "Snack owner must be a current group member."
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
        "readingTarget": reading_target,
        "snackOwnerId": snack_owner_id,
        "snackOwnerName": member_by_id[snack_owner_id]["name"],
        "snackOrder": _move_to_front(snack_order, snack_owner_id),
    }, None


def create_meeting(group_id: str, members: list[dict], creator: dict, body: dict) -> tuple[dict | None, str | None]:
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    if "bookId" in body:
        return None, "Meetings always use the current book."
    open_id = config.get("openMeetingId", config.get("nextSessionId")) if config else None
    if open_id and _fetch(group_id, open_id):
        return None, "Complete the open meeting before creating another one."
    if any(field in body for field in ("title", "author", "bookOwnerId")):
        return None, "Book details must be managed in the library."
    selected_book_id = config.get("activeBookId") if config else None
    if not selected_book_id:
        return None, "Add a current book before scheduling a meeting."
    book = _fetch(group_id, f"book#{selected_book_id}")
    if book is None:
        return None, "Add a current book before scheduling a meeting."
    values, error = _meeting_values(body, members, config, creating=True)
    if error:
        return None, error
    now = _now()
    table = _get_table()
    book_order = _member_order(config, "bookOwnerOrderUserIds", members)
    selected_owner = book.get("bookOwnerId")
    if selected_owner in book_order:
        book_order = _move_to_front(book_order, selected_owner)
    meeting_id = f"meeting#{uuid.uuid4().hex}"
    meeting = {
        "groupId": group_id,
        "id": meeting_id,
        "scheduledAt": values["scheduledAt"],
        "bookId": selected_book_id,
        "bookTitle": book["title"],
        "bookAuthor": book["author"],
        "readingTarget": values["readingTarget"],
        "bookOwnerId": book.get("bookOwnerId"),
        "bookOwnerName": book.get("bookOwnerName"),
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
        "openMeetingId": meeting_id,
        "lastMeetingAt": values["scheduledAt"],
        "bookOwnerOrderUserIds": book_order,
        "snackOwnerOrderUserIds": values["snackOrder"],
        "updatedAt": now,
    }
    for field in ("nextSessionAt", "nextSessionId", "bookRotationUserIds", "bookRotationCursor", "snackRotationUserIds", "snackRotationCursor", "frequency", "weekday", "localTime"):
        config.pop(field, None)
    try:
        # The config condition is the one-open-meeting lock. Keeping both
        # writes in one transaction avoids an orphaned meeting if two
        # admin requests arrive together.
        table.meta.client.transact_write_items(TransactItems=[
            {"Put": {
                "TableName": TABLE_NAME,
                "Item": meeting,
                "ConditionExpression": "attribute_not_exists(id)",
            }},
            {"Put": {
                "TableName": TABLE_NAME,
                "Item": config,
                "ConditionExpression": (
                    "activeBookId = :bookId AND attribute_not_exists(openMeetingId) "
                    "AND attribute_not_exists(nextSessionId)"
                ),
                "ExpressionAttributeValues": {":bookId": selected_book_id},
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
    if any(field in body for field in ("bookId", "title", "author", "bookOwnerId")):
        return None, "A meeting's book is fixed; edit book details in the library."
    values, error = _meeting_values(body, members, config, creating=False)
    if error:
        return None, error
    now = _now()
    meeting.update({
        "scheduledAt": values["scheduledAt"],
        "readingTarget": values["readingTarget"],
        "snackOwnerId": values["snackOwnerId"],
        "snackOwnerName": values["snackOwnerName"],
        "updatedAt": now,
    })
    for field in ("snackDutyUserId", "snackDutyName"):
        meeting.pop(field, None)
    book = _fetch(group_id, f"book#{meeting['bookId']}")
    _get_table().put_item(Item=meeting)
    _get_table().update_item(
        Key={"groupId": group_id, "id": CONFIG_ID},
        UpdateExpression=(
            "SET lastMeetingAt = :scheduledAt, "
            "snackOwnerOrderUserIds = :snackOrder, updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":scheduledAt": values["scheduledAt"],
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


def set_response(group_id: str, meeting_id: str, member: dict, changes: dict) -> tuple[dict | None, str | None]:
    if not isinstance(changes, dict) or set(changes) != {"attendanceStatus"}:
        return None, "An attendance update is required."
    if changes["attendanceStatus"] not in {"attending", "maybe", "not_attending"}:
        return None, "Attendance must be attending, maybe, or not_attending."
    meeting = _fetch(group_id, meeting_id)
    if meeting is None:
        return None, "Unknown meeting."
    if meeting.get("status") != OPEN_STATUS:
        return None, "Responses are only available until a meeting is completed."
    now = _now()
    meeting_key = meeting_id.split("#", 1)[-1]
    response_id = f"meeting-member#{meeting_key}#{member['id']}"
    # Update only the live attendance contract so reversible migration metadata
    # and not-yet-migrated legacy fields survive the deploy-before-migrate window.
    _get_table().update_item(
        Key={"groupId": group_id, "id": response_id},
        UpdateExpression=(
            "SET meetingId = :meetingId, userId = :userId, userName = :userName, "
            "attendanceStatus = :attendance, createdAt = if_not_exists(createdAt, :now), "
            "updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":meetingId": meeting_id,
            ":userId": member["id"],
            ":userName": member["name"],
            ":attendance": changes["attendanceStatus"],
            ":now": now,
        },
    )
    return get_meeting(group_id, meeting_id), None


def complete_book(group_id: str, book_id: str) -> str | None:
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    book = _fetch(group_id, f"book#{normalized}")
    config = _fetch(group_id, CONFIG_ID, consistent=True)
    if book is None:
        return "Unknown active book."
    if config is None or config.get("activeBookId") != normalized:
        return "Unknown active book."
    open_meeting_id = config.get("openMeetingId", config.get("nextSessionId"))
    open_meeting = _fetch(group_id, open_meeting_id) if open_meeting_id else None
    if open_meeting and open_meeting.get("bookId") == normalized and open_meeting.get("status") == OPEN_STATUS:
        return "Complete the open meeting before completing the current book."
    now = _now()
    try:
        # The config condition prevents a meeting from being created between
        # the read above and clearing the current-book pointer.
        _get_table().meta.client.transact_write_items(TransactItems=[
            {"Update": {
                "TableName": TABLE_NAME,
                "Key": {"groupId": group_id, "id": book["id"]},
                "UpdateExpression": "SET completedAt = :now, updatedAt = :now",
                "ConditionExpression": "attribute_exists(id)",
                "ExpressionAttributeValues": {":now": now},
            }},
            {"Update": {
                "TableName": TABLE_NAME,
                "Key": {"groupId": group_id, "id": CONFIG_ID},
                "UpdateExpression": "REMOVE activeBookId SET updatedAt = :now",
                "ConditionExpression": (
                    "activeBookId = :bookId AND attribute_not_exists(openMeetingId) "
                    "AND attribute_not_exists(nextSessionId)"
                ),
                "ExpressionAttributeValues": {":bookId": normalized, ":now": now},
            }},
        ])
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {
            "ConditionalCheckFailedException", "TransactionCanceledException"
        }:
            refreshed_config = _fetch(group_id, CONFIG_ID, consistent=True)
            refreshed_open_id = (
                refreshed_config.get("openMeetingId", refreshed_config.get("nextSessionId"))
                if refreshed_config else None
            )
            refreshed_meeting = _fetch(group_id, refreshed_open_id) if refreshed_open_id else None
            if refreshed_meeting and refreshed_meeting.get("bookId") == normalized and refreshed_meeting.get("status") == OPEN_STATUS:
                return "Complete the open meeting before completing the current book."
            return "Unknown current book."
        raise
    return None


def list_books(group_id: str, viewer_id: str | None = None) -> list[dict]:
    rows = query_group(_get_table(), group_id)
    config = next((row for row in rows if row.get("id") == CONFIG_ID), None)
    current_book_id = config.get("activeBookId") if config else None
    books = [
        row for row in rows
        if row.get("id", "").startswith("book#")
    ]
    ratings = [row for row in rows if row.get("id", "").startswith("rating#")]
    meetings = [
        row for row in rows
        if row.get("id", "").startswith(("meeting#", "session#"))
    ]
    result = []
    for book in books:
        book_ratings = [
            item for item in ratings if item.get("bookId") == book["bookId"]
        ]
        reviews = [
            {
                "userId": item["userId"],
                "userName": item.get("userName", "Former member"),
                "rating": int(item["rating"]),
                "finished": (
                    bool(item["finished"])
                    if isinstance(item.get("finished"), bool)
                    else None
                ),
                "note": item.get("note", ""),
                "createdAt": int(item["createdAt"]),
                "updatedAt": int(item.get("updatedAt", item["createdAt"])),
            }
            for item in sorted(
                book_ratings,
                key=lambda value: (
                    -int(value.get("updatedAt", value.get("createdAt", 0))),
                    value.get("userName", ""),
                ),
            )
        ]
        values = [review["rating"] for review in reviews]
        viewer_review = next(
            (review for review in reviews if review["userId"] == viewer_id),
            None,
        )
        result.append({
            **_project_book(book),
            "isCurrent": book["bookId"] == current_book_id,
            "reviewCount": len(values),
            "averageRating": sum(values) / len(values) if values else None,
            "finishedCount": sum(review["finished"] is True for review in reviews),
            "unfinishedCount": sum(review["finished"] is False for review in reviews),
            "unknownFinishCount": sum(review["finished"] is None for review in reviews),
            "viewerReview": viewer_review,
            "reviews": reviews,
            "meetings": sorted(
                [
                    _project_meeting(item, book=book)
                    for item in meetings
                    if item.get("bookId") == book["bookId"]
                ],
                key=lambda item: (item["scheduledAt"], item["createdAt"]),
                reverse=True,
            ),
        })
    # The pointer is the only lifecycle state: its title comes first and every
    # other catalog entry is historical, even when old data lacks a date.
    return sorted(
        result,
        key=lambda item: (
            not item["isCurrent"],
            -(item.get("completedAt") or item.get("createdAt", 0)),
        ),
    )


def set_review(
    group_id: str,
    book_id: str,
    member: dict,
    rating,
    finished,
    note,
) -> str | None:
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        return "Rating must be an integer from 1 through 5."
    if not isinstance(finished, bool):
        return "Finished must be true or false."
    if not isinstance(note, str):
        return "Review note must be text."
    note = note.strip()
    if len(note) > REVIEW_NOTE_LIMIT:
        return f"Review note must be at most {REVIEW_NOTE_LIMIT} characters."
    normalized = book_id[5:] if book_id.startswith("book#") else book_id
    book = _fetch(group_id, f"book#{normalized}")
    if book is None:
        return "Unknown Book Club book."
    now = _now()
    item_id = f"rating#{normalized}#{member['id']}"
    existing = _fetch(group_id, item_id)
    item = {
        "groupId": group_id, "id": item_id, "bookId": normalized,
        "userId": member["id"], "userName": member["name"],
        "rating": rating, "finished": finished,
        "createdAt": existing.get("createdAt", now) if existing else now, "updatedAt": now,
    }
    if note:
        item["note"] = note
    _get_table().put_item(Item=item)
    return None
