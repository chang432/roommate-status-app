"""Remove obsolete per-member Book Club reading-progress fields."""

from __future__ import annotations

from botocore.exceptions import ClientError

MARKER = "attendanceOnlyLegacyRecord"
PROGRESS_FIELDS = ("chaptersReadThrough", "readingComplete")


def _legacy_record(response: dict) -> dict:
    """Capture only removed fields so a reversal can restore the exact shape."""
    legacy = {}
    for field in PROGRESS_FIELDS:
        legacy[f"had{field[0].upper()}{field[1:]}"] = field in response
        if field in response:
            legacy[field] = response[field]
    return legacy


def _migrate_response(table, response: dict) -> bool:
    removals = [field for field in PROGRESS_FIELDS if field in response]
    if not removals:
        return False
    names = {"#marker": MARKER}
    remove_names = []
    for index, field in enumerate(removals):
        name = f"#field{index}"
        names[name] = field
        remove_names.append(name)
    table.update_item(
        Key={"groupId": response["groupId"], "id": response["id"]},
        UpdateExpression="SET #marker = :legacy REMOVE " + ", ".join(remove_names),
        ConditionExpression="attribute_not_exists(#marker)",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues={":legacy": _legacy_record(response)},
    )
    return True


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    migrated_count = 0
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            if not item.get("id", "").startswith("meeting-member#") or item.get(MARKER):
                continue
            try:
                migrated_count += int(_migrate_response(table, item))
            except ClientError as error:
                # Another retry may have marked the row after this scan page.
                if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  removed reading progress from {migrated_count} Book Club response(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
