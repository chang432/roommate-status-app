"""Remove legacy titles from Book Club root forum messages."""

from __future__ import annotations

from botocore.exceptions import ClientError

MARKER = "forumTitleRemovedLegacyRecord"


def _migrate_entry(table, entry: dict) -> bool:
    if entry.get("parentPostId") or "title" not in entry or entry.get(MARKER):
        return False
    table.update_item(
        Key={"groupId": entry["groupId"], "id": entry["id"]},
        UpdateExpression="SET #marker = :legacy REMOVE #title",
        ConditionExpression="attribute_exists(#title) AND attribute_not_exists(#marker)",
        ExpressionAttributeNames={"#marker": MARKER, "#title": "title"},
        ExpressionAttributeValues={":legacy": {"title": entry["title"]}},
    )
    return True


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    migrated_count = 0
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            if not item.get("id", "").startswith("forum#"):
                continue
            try:
                migrated_count += int(_migrate_entry(table, item))
            except ClientError as error:
                # A retry may have marked the row after this scan page.
                if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  removed titles from {migrated_count} Book Club forum message(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
