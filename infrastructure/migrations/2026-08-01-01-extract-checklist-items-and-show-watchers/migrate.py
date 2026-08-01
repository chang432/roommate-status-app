"""Move checklist items and show watchers out of embedded parent lists."""

from __future__ import annotations

import time

from botocore.exceptions import ClientError

CHECKLIST_STORAGE = "itemsStorage"
SHOW_STORAGE = "membersStorage"
CHECKLIST_MARKER = "itemRowsMigratedAt"
SHOW_MARKER = "watcherRowsMigratedAt"
ROW_STORAGE = "rows"
MIGRATION_MARKER = "2026-08-01-01"


def _scan(table):
    kwargs = {}
    while True:
        page = table.scan(**kwargs)
        yield from page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _put_checklist_rows(table, parent: dict) -> None:
    for index, item in enumerate(parent.get("items") or []):
        item_id = item.get("id")
        if not item_id:
            continue
        checked_ids = set(item.get("checkedByIds") or [])
        row = {
            "groupId": parent["groupId"],
            "id": f"checklist-item#{parent['id']}#{item_id}",
            "parentId": parent["id"],
            "itemId": item_id,
            "recordType": "checklist-item",
            "text": item.get("text", ""),
            "sortOrder": index,
            "checkedNamesById": dict(item.get("checkedNamesById") or {}),
            "rowMigration": MIGRATION_MARKER,
        }
        if checked_ids:
            row["checkedByIds"] = checked_ids
        # This overwrite is intentional until the parent switch succeeds: a
        # concurrent legacy-list edit is picked up on the next resumable pass.
        table.put_item(Item=row)


def _put_watcher_rows(table, parent: dict) -> None:
    for index, member in enumerate(parent.get("members") or []):
        user_id = member.get("id")
        if not user_id:
            continue
        table.put_item(Item={
            "groupId": parent["groupId"],
            "id": f"show-watcher#{parent['id']}#{user_id}",
            "parentId": parent["id"],
            "userId": user_id,
            "recordType": "show-watcher",
            "name": member.get("name", user_id),
            "season": max(1, int(member.get("season", 1))),
            "episode": max(1, int(member.get("episode", 1))),
            "sortOrder": index,
            "rowMigration": MIGRATION_MARKER,
        })


def _switch_parent(table, parent: dict, storage: str, marker: str, legacy_field: str) -> bool:
    names = {"#storage": storage, "#marker": marker, "#legacy": legacy_field}
    values = {":rows": ROW_STORAGE, ":migrated": int(time.time() * 1000)}
    condition = "attribute_not_exists(#marker)"
    if legacy_field in parent:
        values[":legacy"] = parent[legacy_field]
        condition += " AND #legacy = :legacy"
    else:
        condition += " AND attribute_not_exists(#legacy)"
    try:
        table.update_item(
            Key={"groupId": parent["groupId"], "id": parent["id"]},
            UpdateExpression="SET #storage = :rows, #marker = :migrated REMOVE #legacy",
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True


def _migrate_table(table, storage: str, marker: str, legacy_field: str, write_rows) -> int:
    migrated = 0
    for parent in _scan(table):
        if "createdAt" not in parent or parent.get("parentId"):
            continue
        if parent.get(storage) == ROW_STORAGE or parent.get(marker):
            continue
        write_rows(table, parent)
        migrated += int(_switch_parent(table, parent, storage, marker, legacy_field))
    return migrated


def run(ctx) -> None:
    checklists = _migrate_table(
        ctx.table("checklists-v2"), CHECKLIST_STORAGE, CHECKLIST_MARKER, "items", _put_checklist_rows
    )
    shows = _migrate_table(
        ctx.table("shows-v2"), SHOW_STORAGE, SHOW_MARKER, "members", _put_watcher_rows
    )
    print(f"  extracted child rows for {checklists} checklist(s) and {shows} show(s).")
