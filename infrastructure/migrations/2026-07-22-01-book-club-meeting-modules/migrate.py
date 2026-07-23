"""Convert automatic Book Club sessions into manually completed meeting modules."""

from __future__ import annotations

import uuid


MARKER = "meetingModuleMigrated"
LEGACY = "meetingModuleLegacyRecord"


def _meeting_id(group_id: str, session_id: str) -> str:
    stable = uuid.uuid5(uuid.NAMESPACE_URL, f"roomie:{group_id}:{session_id}").hex
    return f"meeting#{stable}"


def _rotate(values, cursor) -> list[str]:
    order = list(values or [])
    if not order:
        return []
    index = int(cursor or 0) % len(order)
    return order[index:] + order[:index]


def _scan_all(table) -> list[dict]:
    rows = []
    kwargs = {}
    while True:
        response = table.scan(**kwargs)
        rows.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return rows
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def run(ctx) -> None:
    table = ctx.table("book-club")
    rows = _scan_all(table)
    books = {row.get("bookId"): row for row in rows if row.get("id", "").startswith("book#")}
    session_ids = {
        row["id"]: _meeting_id(row["groupId"], row["id"])
        for row in rows if row.get("id", "").startswith("session#")
    }
    # A previous run may have moved a session before it reached its config or
    # responses. Recover the old-to-new mapping from the preserved snapshot so
    # a rerun can finish the remaining records.
    for row in rows:
        legacy = row.get(LEGACY)
        if (
            row.get("id", "").startswith("meeting#")
            and isinstance(legacy, dict)
            and legacy.get("id", "").startswith("session#")
        ):
            session_ids[legacy["id"]] = row["id"]

    for row in rows:
        item_id = row.get("id", "")
        if item_id.startswith("book#") and not row.get(MARKER):
            updated = {**row, MARKER: True, LEGACY: row}
            updated["bookOwnerId"] = row.get("bookOwnerId", row.get("recommendedById"))
            updated["bookOwnerName"] = row.get("bookOwnerName", row.get("recommendedByName"))
            updated.pop("recommendedById", None)
            updated.pop("recommendedByName", None)
            table.put_item(Item=updated)
        elif item_id.startswith("session#"):
            book = books.get(row.get("bookId"), {})
            meeting_id = session_ids[item_id]
            updated = {
                **row,
                "id": meeting_id,
                "bookAuthor": row.get("bookAuthor", book.get("author", "Unknown author")),
                "bookOwnerId": row.get("bookOwnerId", book.get("bookOwnerId", book.get("recommendedById"))),
                "bookOwnerName": row.get("bookOwnerName", book.get("bookOwnerName", book.get("recommendedByName", "Former member"))),
                "snackOwnerId": row.get("snackOwnerId", row.get("snackDutyUserId")),
                "snackOwnerName": row.get("snackOwnerName", row.get("snackDutyName")),
                "createdByName": row.get("createdByName", "Migrated meeting"),
                MARKER: True,
                LEGACY: row,
            }
            updated.pop("snackDutyUserId", None)
            updated.pop("snackDutyName", None)
            table.put_item(Item=updated)
            table.delete_item(Key={"groupId": row["groupId"], "id": item_id})
        elif item_id.startswith("session-member#"):
            old_meeting_id = row.get("sessionId")
            if old_meeting_id not in session_ids:
                continue
            meeting_id = session_ids[old_meeting_id]
            meeting_key = meeting_id.split("#", 1)[1]
            updated = {
                **row,
                "id": f"meeting-member#{meeting_key}#{row['userId']}",
                "meetingId": meeting_id,
                MARKER: True,
                LEGACY: row,
            }
            updated.pop("sessionId", None)
            table.put_item(Item=updated)
            table.delete_item(Key={"groupId": row["groupId"], "id": item_id})

    for row in rows:
        if row.get("id") != "config#book-club" or row.get(MARKER):
            continue
        next_session_id = row.get("nextSessionId")
        updated = {
            "groupId": row["groupId"],
            "id": row["id"],
            "timezone": row.get("timezone", "America/New_York"),
            "bookOwnerOrderUserIds": _rotate(row.get("bookRotationUserIds"), row.get("bookRotationCursor")),
            "snackOwnerOrderUserIds": _rotate(row.get("snackRotationUserIds"), row.get("snackRotationCursor")),
            "lastMeetingAt": row.get("nextSessionAt"),
            "createdAt": row.get("createdAt"),
            "updatedAt": row.get("updatedAt"),
            MARKER: True,
            LEGACY: row,
        }
        if row.get("activeBookId"):
            updated["activeBookId"] = row["activeBookId"]
        if next_session_id and next_session_id in session_ids:
            updated["openMeetingId"] = session_ids[next_session_id]
        table.put_item(Item={key: value for key, value in updated.items() if value is not None})


if __name__ == "__main__":
    raise SystemExit("Run this migration through infrastructure/migrations/runner.py")
