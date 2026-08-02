"""Remove legacy meeting-scoped Book Club forum rows."""

from __future__ import annotations

import hashlib
import time

from botocore.exceptions import ClientError

BACKUP_PREFIX = "migration-backup#remove-meeting-forums#"
SNAPSHOT = "legacyForumRecord"


def backup_id(source_id: str) -> str:
    digest = hashlib.sha256(source_id.encode()).hexdigest()
    return f"{BACKUP_PREFIX}{digest}"


def _remove(table, item: dict) -> bool:
    backup = {
        "groupId": item["groupId"],
        "id": backup_id(item["id"]),
        "sourceId": item["id"],
        SNAPSHOT: item,
        "createdAt": int(time.time() * 1000),
    }
    try:
        table.put_item(Item=backup, ConditionExpression="attribute_not_exists(id)")
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
    try:
        table.delete_item(
            Key={"groupId": item["groupId"], "id": item["id"]},
            ConditionExpression="attribute_exists(id)",
        )
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return False


def run(ctx) -> None:
    table = ctx.table("book-club")
    scan_kwargs = {}
    removed = 0
    while True:
        page = table.scan(**scan_kwargs)
        for item in page.get("Items", []):
            if item.get("id", "").startswith("forum#"):
                removed += int(_remove(table, item))
        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"  removed {removed} legacy meeting forum row(s).")


if __name__ == "__main__":
    raise SystemExit("Run migrations through infrastructure/migrations/runner.py")
