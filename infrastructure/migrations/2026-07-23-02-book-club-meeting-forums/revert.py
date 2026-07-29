"""Restore legacy book/chapter posts moved into meeting-scoped forums."""

from __future__ import annotations


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    restored = 0
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if not item.get("meetingForumMigrated"):
                continue
            legacy = item.get("meetingForumLegacyRecord")
            if legacy:
                table.put_item(Item=legacy)
            table.delete_item(
                Key={"groupId": item["groupId"], "id": item["id"]}
            )
            restored += 1
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    print(f"Restored {restored} legacy Book Club discussion post(s).")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via infrastructure/migrations/runner.py --env <env> "
        "--revert 2026-07-23-02-book-club-meeting-forums."
    )
