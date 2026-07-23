"""Restore the Book Club records captured by the meeting-module migration."""

from __future__ import annotations


MARKER = "meetingModuleMigrated"
LEGACY = "meetingModuleLegacyRecord"


def _scan_all(table) -> list[dict]:
    rows = []
    kwargs = {}
    while True:
        response = table.scan(**kwargs)
        rows.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return rows
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def run(ctx) -> None:
    table = ctx.table("book-club")
    rows = _scan_all(table)
    for row in rows:
        legacy = row.get(LEGACY)
        if not row.get(MARKER) or not isinstance(legacy, dict):
            continue
        table.put_item(Item=legacy)
        if row["id"] != legacy["id"]:
            table.delete_item(Key={"groupId": row["groupId"], "id": row["id"]})


if __name__ == "__main__":
    raise SystemExit("Run this migration through infrastructure/migrations/runner.py")
