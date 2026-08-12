"""Restore the legacy group display flags from the granular module list."""

from __future__ import annotations


STANDARD = {"events", "requests", "checklists", "polls", "tv"}


def run(ctx) -> None:
    table = ctx.table("groups")
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if "enabledModules" not in item:
                continue
            enabled = set(item.get("enabledModules") or [])
            table.update_item(
                Key={"groupId": item["groupId"]},
                UpdateExpression=(
                    "SET showRoster = :roster, showFeed = :feed, "
                    "showBookClub = :book REMOVE enabledModules"
                ),
                ExpressionAttributeValues={
                    ":roster": "roster" in enabled,
                    ":feed": bool(enabled & STANDARD),
                    ":book": bool(enabled & {"book-club", "forums"}),
                },
                ConditionExpression="attribute_exists(enabledModules)",
            )
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


if __name__ == "__main__":
    raise SystemExit("Run this migration through infrastructure/migrations/runner.py.")
