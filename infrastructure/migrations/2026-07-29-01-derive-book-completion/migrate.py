"""Derive Book Club completion from the configuration's current-book pointer."""

from __future__ import annotations

from botocore.exceptions import ClientError

CONFIG_ID = "config#book-club"
MARKER = "bookCompletionDerivedLegacyRecord"


def _legacy_record(book: dict) -> dict:
    """Capture only fields this migration removes, so reversal is exact."""
    record = {
        "hadStatus": "status" in book,
        "hadCompletedAt": "completedAt" in book,
    }
    if "status" in book:
        record["status"] = book["status"]
    if "completedAt" in book:
        record["completedAt"] = book["completedAt"]
    return record


def _migrate_book(table, book: dict, current_book_ids: dict[str, str]) -> bool:
    group_id = book["groupId"]
    book_id = book.get("bookId")
    is_current = current_book_ids.get(group_id) == book_id
    needs_status_removal = "status" in book
    needs_current_cleanup = is_current and "completedAt" in book
    if not needs_status_removal and not needs_current_cleanup:
        return False

    names = {"#marker": MARKER}
    removals = []
    if needs_status_removal:
        names["#status"] = "status"
        removals.append("#status")
    if needs_current_cleanup:
        names["#completedAt"] = "completedAt"
        removals.append("#completedAt")
    table.update_item(
        Key={"groupId": group_id, "id": book["id"]},
        UpdateExpression="SET #marker = :legacy REMOVE " + ", ".join(removals),
        ConditionExpression="attribute_not_exists(#marker)",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues={":legacy": _legacy_record(book)},
    )
    return True


def run(ctx) -> None:
    table = ctx.table("book-club")
    rows = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        rows.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    current_book_ids = {
        item["groupId"]: item["activeBookId"]
        for item in rows
        if item.get("id") == CONFIG_ID and item.get("activeBookId")
    }
    migrated_count = 0
    for item in rows:
        if not item.get("id", "").startswith("book#") or item.get(MARKER):
            continue
        try:
            migrated_count += int(_migrate_book(table, item, current_book_ids))
        except ClientError as error:
            # A concurrent retry may have written the marker after our scan.
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    print(f"  derived completion for {migrated_count} Book Club book(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
