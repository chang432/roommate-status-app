"""Restore Book Club reading-progress fields captured by the forward pass."""

from __future__ import annotations

from botocore.exceptions import ClientError

MARKER = "attendanceOnlyLegacyRecord"
PROGRESS_FIELDS = ("chaptersReadThrough", "readingComplete")


def _revert_response(table, response: dict) -> bool:
    legacy = response.get(MARKER)
    if not legacy:
        return False
    names = {"#marker": MARKER}
    values = {":legacy": legacy}
    sets = []
    for index, field in enumerate(PROGRESS_FIELDS):
        presence_key = f"had{field[0].upper()}{field[1:]}"
        # A value written after the migration wins over the archived value.
        if legacy.get(presence_key) and field not in response:
            name = f"#field{index}"
            value = f":field{index}"
            names[name] = field
            values[value] = legacy[field]
            sets.append(f"{name} = {value}")
    update_expression = ""
    if sets:
        update_expression = "SET " + ", ".join(sets) + " "
    update_expression += "REMOVE #marker"
    table.update_item(
        Key={"groupId": response["groupId"], "id": response["id"]},
        UpdateExpression=update_expression,
        ConditionExpression="#marker = :legacy",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return True


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    reverted_count = 0
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            if not item.get("id", "").startswith("meeting-member#") or not item.get(MARKER):
                continue
            try:
                reverted_count += int(_revert_response(table, item))
            except ClientError as error:
                if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  restored reading progress for {reverted_count} Book Club response(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev "
        "--revert 2026-07-29-02-remove-book-club-progress"
    )
