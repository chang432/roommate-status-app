"""Restore embedded checklist items and show watchers from child rows."""

from __future__ import annotations

from botocore.exceptions import ClientError

CHECKLIST_STORAGE = "itemsStorage"
SHOW_STORAGE = "membersStorage"
CHECKLIST_MARKER = "itemRowsMigratedAt"
SHOW_MARKER = "watcherRowsMigratedAt"
MIGRATION_MARKER = "2026-08-01-01"


def _scan(table):
    kwargs = {}
    while True:
        page = table.scan(**kwargs)
        yield from page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _children(table, group_id: str, parent_id: str, record_type: str) -> list[dict]:
    rows = [
        row for row in _scan(table)
        if row.get("groupId") == group_id and row.get("parentId") == parent_id
        and row.get("recordType") == record_type
    ]
    return sorted(rows, key=lambda row: (int(row.get("sortOrder", 0)), row["id"]))


def _restore_parent(table, parent: dict, storage: str, marker: str, field: str, values: list[dict]) -> bool:
    try:
        table.update_item(
            Key={"groupId": parent["groupId"], "id": parent["id"]},
            UpdateExpression="SET #field = :values REMOVE #storage, #marker",
            ConditionExpression="#marker = :migrated",
            ExpressionAttributeNames={"#field": field, "#storage": storage, "#marker": marker},
            ExpressionAttributeValues={":values": values, ":migrated": parent[marker]},
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True


def _delete_rows(table, rows: list[dict]) -> None:
    with table.batch_writer() as batch:
        for row in rows:
            batch.delete_item(Key={"groupId": row["groupId"], "id": row["id"]})


def _restore_checklists(table) -> int:
    reverted = 0
    for parent in _scan(table):
        if not parent.get(CHECKLIST_MARKER):
            continue
        rows = _children(table, parent["groupId"], parent["id"], "checklist-item")
        items = [
            {
                "id": row["itemId"], "text": row.get("text", ""),
                "checkedByIds": list(row.get("checkedByIds") or []),
                "checkedNamesById": dict(row.get("checkedNamesById") or {}),
            }
            for row in rows
        ]
        if _restore_parent(table, parent, CHECKLIST_STORAGE, CHECKLIST_MARKER, "items", items):
            _delete_rows(table, rows)
            reverted += 1
    return reverted


def _restore_shows(table) -> int:
    reverted = 0
    for parent in _scan(table):
        if not parent.get(SHOW_MARKER):
            continue
        rows = _children(table, parent["groupId"], parent["id"], "show-watcher")
        members = [
            {"id": row["userId"], "name": row.get("name", row["userId"]), "season": row.get("season", 1), "episode": row.get("episode", 1)}
            for row in rows
        ]
        if _restore_parent(table, parent, SHOW_STORAGE, SHOW_MARKER, "members", members):
            _delete_rows(table, rows)
            reverted += 1
    return reverted


def _remove_partial_rows(table) -> None:
    # If forward failed after child writes but before switching a parent, only
    # rows tagged by this migration are safe to remove.
    _delete_rows(table, [row for row in _scan(table) if row.get("rowMigration") == MIGRATION_MARKER])


def run(ctx) -> None:
    checklists_table = ctx.table("checklists-v2")
    shows_table = ctx.table("shows-v2")
    checklists = _restore_checklists(checklists_table)
    shows = _restore_shows(shows_table)
    _remove_partial_rows(checklists_table)
    _remove_partial_rows(shows_table)
    print(f"  restored embedded rows for {checklists} checklist(s) and {shows} show(s).")
