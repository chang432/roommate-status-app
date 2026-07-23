"""Restore Book owner orders aligned by this migration when still untouched."""

from __future__ import annotations

from botocore.exceptions import ClientError

CONFIG_ID = "config#book-club"
MARKER = "bookOwnerOrderAlignmentMigrated"
LEGACY = "bookOwnerOrderAlignmentLegacyRecord"
MAX_WRITE_ATTEMPTS = 3


def _revert_config(table, group_id: str) -> bool:
    for _attempt in range(MAX_WRITE_ATTEMPTS):
        config = table.get_item(
            Key={"groupId": group_id, "id": CONFIG_ID},
            ConsistentRead=True,
        ).get("Item")
        if not config or not config.get(MARKER) or not config.get(LEGACY):
            return False

        legacy = config[LEGACY]
        current_order = list(config.get("bookOwnerOrderUserIds") or [])
        aligned_order = list(legacy.get("alignedBookOwnerOrderUserIds") or [])
        restore_order = current_order == aligned_order

        names = {
            "#bookOrder": "bookOwnerOrderUserIds",
            "#marker": MARKER,
            "#legacy": LEGACY,
        }
        values = {
            ":marker": True,
            ":currentOrder": current_order,
        }
        if restore_order and legacy.get("hadBookOwnerOrderUserIds"):
            update_expression = (
                "SET #bookOrder = :previousBookOrder REMOVE #marker, #legacy"
            )
            values[":previousBookOrder"] = list(
                legacy.get("bookOwnerOrderUserIds") or []
            )
        elif restore_order:
            update_expression = "REMOVE #bookOrder, #marker, #legacy"
        else:
            # A later admin edit is newer than this one-time correction.
            update_expression = "REMOVE #marker, #legacy"

        try:
            table.update_item(
                Key={"groupId": group_id, "id": CONFIG_ID},
                UpdateExpression=update_expression,
                ConditionExpression="#marker = :marker AND #bookOrder = :currentOrder",
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    raise RuntimeError(
        f"Book Club configuration for {group_id!r} kept changing during revert."
    )


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    reverted_count = 0

    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if item.get("id") == CONFIG_ID and item.get(MARKER):
                reverted_count += int(_revert_config(table, item["groupId"]))
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    print(f"  reverted Book owner cycle alignment for {reverted_count} group(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev "
        "--revert 2026-07-23-01-align-book-owner-order"
    )
