"""Replace coarse group display flags with a granular enabled-module list."""

from __future__ import annotations


STANDARD = ("events", "requests", "checklists", "polls", "tv")


def run(ctx) -> None:
    table = ctx.table("groups")
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if "enabledModules" in item:
                continue
            enabled = []
            if item.get("showRoster", True):
                enabled.append("roster")
            if item.get("showFeed", True):
                enabled.extend(STANDARD)
            # Spotify was displayed independently of the legacy flags.
            enabled.append("spotify")
            if item.get("showBookClub", True):
                enabled.extend(("book-club", "forums"))
            table.update_item(
                Key={"groupId": item["groupId"]},
                UpdateExpression=(
                    "SET enabledModules = :enabled "
                    "REMOVE showRoster, showFeed, showBookClub"
                ),
                ExpressionAttributeValues={":enabled": enabled},
                ConditionExpression="attribute_not_exists(enabledModules)",
            )
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


if __name__ == "__main__":
    raise SystemExit("Run this migration through infrastructure/migrations/runner.py.")
