"""Restore legacy Book Club status fields captured by this migration."""

from __future__ import annotations

from botocore.exceptions import ClientError

MARKER = "bookCompletionDerivedLegacyRecord"


def _revert_book(table, book: dict) -> bool:
    legacy = book.get(MARKER)
    if not legacy:
        return False
    names = {"#marker": MARKER}
    values = {":legacy": legacy}
    sets = []
    removals = ["#marker"]
    if legacy.get("hadStatus"):
        names["#status"] = "status"
        values[":status"] = legacy["status"]
        sets.append("#status = :status")
    else:
        names["#status"] = "status"
        removals.append("#status")
    # Do not overwrite a completion date written after the forward migration.
    if legacy.get("hadCompletedAt") and "completedAt" not in book:
        names["#completedAt"] = "completedAt"
        values[":completedAt"] = legacy["completedAt"]
        sets.append("#completedAt = :completedAt")

    update_expression = ""
    if sets:
        update_expression += "SET " + ", ".join(sets) + " "
    update_expression += "REMOVE " + ", ".join(removals)
    table.update_item(
        Key={"groupId": book["groupId"], "id": book["id"]},
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
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if not item.get("id", "").startswith("book#") or not item.get(MARKER):
                continue
            try:
                reverted_count += int(_revert_book(table, item))
            except ClientError as error:
                if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    print(f"  restored legacy completion for {reverted_count} Book Club book(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev "
        "--revert 2026-07-29-01-derive-book-completion"
    )
