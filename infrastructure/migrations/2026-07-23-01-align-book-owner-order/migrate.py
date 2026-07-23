"""Align each Book owner cycle with its Snack owner cycle once."""

from __future__ import annotations

from botocore.exceptions import ClientError

CONFIG_ID = "config#book-club"
MARKER = "bookOwnerOrderAlignmentMigrated"
LEGACY = "bookOwnerOrderAlignmentLegacyRecord"
MAX_WRITE_ATTEMPTS = 3


def _rotate_to_owner(order: list[str], owner_id: str | None) -> list[str]:
    """Preserve the Snack cycle while keeping the current Book owner first."""
    aligned = list(order)
    if not aligned or owner_id not in aligned:
        return aligned
    index = aligned.index(owner_id)
    return aligned[index:] + aligned[:index]


def _current_book_owner(table, config: dict) -> str | None:
    open_meeting_id = config.get("openMeetingId")
    if open_meeting_id:
        meeting = table.get_item(
            Key={"groupId": config["groupId"], "id": open_meeting_id},
            ConsistentRead=True,
        ).get("Item")
        if meeting and meeting.get("bookOwnerId"):
            return meeting["bookOwnerId"]

    active_book_id = config.get("activeBookId")
    if active_book_id:
        book = table.get_item(
            Key={"groupId": config["groupId"], "id": f"book#{active_book_id}"},
            ConsistentRead=True,
        ).get("Item")
        if book:
            owner_id = book.get("bookOwnerId")
            if owner_id:
                return owner_id

    book_order = list(config.get("bookOwnerOrderUserIds") or [])
    snack_order = list(config.get("snackOwnerOrderUserIds") or [])
    return (book_order or snack_order or [None])[0]


def _align_config(table, group_id: str) -> bool:
    for _attempt in range(MAX_WRITE_ATTEMPTS):
        config = table.get_item(
            Key={"groupId": group_id, "id": CONFIG_ID},
            ConsistentRead=True,
        ).get("Item")
        if not config or config.get(MARKER):
            return False

        had_book_order = "bookOwnerOrderUserIds" in config
        previous_book_order = list(config.get("bookOwnerOrderUserIds") or [])
        had_snack_order = "snackOwnerOrderUserIds" in config
        snack_order = list(config.get("snackOwnerOrderUserIds") or [])
        aligned_book_order = _rotate_to_owner(
            snack_order,
            _current_book_owner(table, config),
        )
        legacy = {
            "hadBookOwnerOrderUserIds": had_book_order,
            "bookOwnerOrderUserIds": previous_book_order,
            "alignedBookOwnerOrderUserIds": aligned_book_order,
        }

        names = {
            "#bookOrder": "bookOwnerOrderUserIds",
            "#snackOrder": "snackOwnerOrderUserIds",
            "#marker": MARKER,
            "#legacy": LEGACY,
        }
        values = {
            ":aligned": aligned_book_order,
            ":marker": True,
            ":legacy": legacy,
        }
        conditions = ["attribute_not_exists(#marker)"]
        if had_book_order:
            conditions.append("#bookOrder = :previousBookOrder")
            values[":previousBookOrder"] = previous_book_order
        else:
            conditions.append("attribute_not_exists(#bookOrder)")
        if had_snack_order:
            conditions.append("#snackOrder = :snackOrder")
            values[":snackOrder"] = snack_order
        else:
            conditions.append("attribute_not_exists(#snackOrder)")

        try:
            table.update_item(
                Key={"groupId": group_id, "id": CONFIG_ID},
                UpdateExpression=(
                    "SET #bookOrder = :aligned, #marker = :marker, #legacy = :legacy"
                ),
                ConditionExpression=" AND ".join(conditions),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    raise RuntimeError(
        f"Book Club configuration for {group_id!r} kept changing during migration."
    )


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    aligned_count = 0

    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if item.get("id") == CONFIG_ID:
                aligned_count += int(_align_config(table, item["groupId"]))
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    print(f"  aligned Book owner cycles for {aligned_count} group(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
