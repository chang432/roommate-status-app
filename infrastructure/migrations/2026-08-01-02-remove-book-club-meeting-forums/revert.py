"""Restore legacy meeting forum rows from migration-only snapshots."""

from __future__ import annotations

from botocore.exceptions import ClientError

BACKUP_PREFIX = "migration-backup#remove-meeting-forums#"
SNAPSHOT = "legacyForumRecord"


def _restore(table, backup: dict) -> bool:
    source = backup.get(SNAPSHOT)
    if not source:
        return False
    try:
        table.put_item(Item=source, ConditionExpression="attribute_not_exists(id)")
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
    table.delete_item(Key={"groupId": backup["groupId"], "id": backup["id"]})
    return True


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    restored = 0
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            if item.get("id", "").startswith(BACKUP_PREFIX):
                restored += int(_restore(table, item))
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  restored {restored} legacy meeting forum row(s).")


if __name__ == "__main__":
    raise SystemExit("Run migrations through infrastructure/migrations/runner.py")
