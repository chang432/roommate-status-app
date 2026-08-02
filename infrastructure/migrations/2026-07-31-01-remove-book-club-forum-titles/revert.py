"""Restore Book Club root forum titles captured by the forward migration."""

from __future__ import annotations

from botocore.exceptions import ClientError

MARKER = "forumTitleRemovedLegacyRecord"


def _revert_entry(table, entry: dict) -> bool:
    legacy = entry.get(MARKER)
    if not legacy:
        return False
    values = {":legacy": legacy}
    names = {"#marker": MARKER}
    expression = "REMOVE #marker"
    if "title" not in entry and "title" in legacy:
        names["#title"] = "title"
        values[":title"] = legacy["title"]
        expression = "SET #title = :title REMOVE #marker"
    table.update_item(
        Key={"groupId": entry["groupId"], "id": entry["id"]},
        UpdateExpression=expression,
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
            if not item.get("id", "").startswith("forum#") or not item.get(MARKER):
                continue
            try:
                reverted_count += int(_revert_entry(table, item))
            except ClientError as error:
                if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  restored titles for {reverted_count} Book Club forum message(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev --revert "
        "2026-07-31-01-remove-book-club-forum-titles"
    )
