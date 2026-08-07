"""Group counters with separately stored, correctable history entries."""

from __future__ import annotations

import base64
import binascii
import copy
import os
import threading
import time
import uuid
from decimal import Decimal

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from db import resource

TABLE_NAME = os.environ.get("COUNTERS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-counters"
)
HISTORY_INDEX = "CounterHistoryIndex"
RECENT_LIMIT = 10
HISTORY_PAGE_SIZE = 20
MAX_TEXT_LENGTH = 280
MAX_SAFE_INTEGER = 9_007_199_254_740_991
DAY_MS = 24 * 60 * 60 * 1000

AUTOMATIC = "automatic"
MANUAL = "manual"
INCIDENT = "incident"
ADJUSTMENT = "adjustment"
BASELINE = "baseline"

NOT_FOUND = "not_found"
FORBIDDEN = "forbidden"
READ_ONLY = "read_only"
INVALID = "invalid"
CONFLICT = "conflict"

_table = None
_table_lock = threading.Lock()


def _get_table():
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _parent_key(group_id: str, counter_id: str) -> dict:
    return {"groupId": group_id, "id": f"counter#{counter_id}"}


def _entry_key(group_id: str, counter_id: str, entry_id: str) -> dict:
    return {"groupId": group_id, "id": f"counter-entry#{counter_id}#{entry_id}"}


def _counter_key(group_id: str, counter_id: str) -> str:
    return f"{group_id}#{counter_id}"


def _entry_sort(occurred_at: int, entry_id: str) -> str:
    return f"{int(occurred_at):013d}#{entry_id}"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _now_after(item: dict) -> int:
    return max(_now_ms(), int(item.get("updatedAt", item.get("createdAt", 0))) + 1)


def _fetch(counter_id: str, group_id: str) -> dict | None:
    return _get_table().get_item(
        Key=_parent_key(group_id, counter_id), ConsistentRead=True
    ).get("Item")


def _raw_entries(counter_id: str, group_id: str) -> list[dict]:
    """Read the complete ledger consistently so derived totals cannot be stale."""
    kwargs = {
        "KeyConditionExpression": Key("groupId").eq(group_id)
        & Key("id").begins_with(f"counter-entry#{counter_id}#"),
        "ConsistentRead": True,
    }
    response = _get_table().query(**kwargs)
    entries = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = _get_table().query(
            ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs
        )
        entries.extend(response.get("Items", []))
    return sorted(
        entries,
        key=_entry_order,
    )


def _entry_order(entry: dict):
    # A baseline is the first state even when an immediate adjustment shares
    # its millisecond timestamp.
    return (
        int(entry["occurredAt"]),
        0 if entry["kind"] == BASELINE else 1,
        entry["entryId"],
    )


def _project_entry(entry: dict) -> dict:
    projected = {
        "id": entry["entryId"],
        "kind": entry["kind"],
        "occurredAt": int(entry["occurredAt"]),
        "createdAt": int(entry["createdAt"]),
        "createdById": entry["createdById"],
        "createdBy": entry.get("createdBy", "Someone"),
        "note": entry.get("note", ""),
    }
    if entry["kind"] == ADJUSTMENT:
        projected["delta"] = int(entry["delta"])
    elif entry["kind"] == BASELINE:
        projected["value"] = int(entry["value"])
    if entry.get("editedAt") is not None:
        projected.update(
            editedAt=int(entry["editedAt"]),
            editedById=entry.get("editedById"),
            editedBy=entry.get("editedBy", "Someone"),
        )
    return projected


def _derive(parent: dict, entries: list[dict]) -> tuple[dict, list[dict]]:
    projected = [_project_entry(entry) for entry in entries]
    if parent["mode"] == AUTOMATIC:
        if not entries or any(entry["kind"] != INCIDENT for entry in entries):
            raise ValueError("An automatic counter requires incident entries.")
        for index, entry in enumerate(projected):
            if index + 1 < len(projected):
                entry["daysUntilNext"] = max(
                    0,
                    (projected[index + 1]["occurredAt"] - entry["occurredAt"])
                    // DAY_MS,
                )
        summary = {
            "lastIncidentAt": int(entries[-1]["occurredAt"]),
            "currentValue": max(0, (_now_ms() - int(entries[-1]["occurredAt"])) // DAY_MS),
        }
        return summary, projected

    if not entries or entries[0]["kind"] != BASELINE:
        raise ValueError("A manual counter requires a baseline entry.")
    value = 0
    for raw, entry in zip(entries, projected):
        if raw["kind"] == BASELINE:
            value = int(raw["value"])
        elif raw["kind"] == ADJUSTMENT:
            value += int(raw["delta"])
        else:
            raise ValueError("A manual counter can only contain adjustments.")
        if value < 0 or value > MAX_SAFE_INTEGER:
            raise ValueError("Counter history must stay between zero and the safe integer limit.")
        entry["resultingValue"] = value
    return {"currentValue": value}, projected


def _project(parent: dict) -> dict:
    result = {
        "id": parent["counterId"],
        "title": parent.get("title", "Counter"),
        "mode": parent["mode"],
        "createdById": parent["createdById"],
        "createdBy": parent.get("createdBy", "Someone"),
        "createdAt": int(parent["createdAt"]),
        "updatedAt": int(parent.get("updatedAt", parent["createdAt"])),
        "isArchived": bool(parent.get("isArchived", False)),
        "version": int(parent.get("version", 0)),
    }
    if parent["mode"] == AUTOMATIC:
        last_incident_at = int(parent["lastIncidentAt"])
        result.update(
            lastIncidentAt=last_incident_at,
            currentValue=max(0, (_now_ms() - last_incident_at) // DAY_MS),
        )
    else:
        result["currentValue"] = int(parent.get("currentValue", 0))
    for prefix in ("archived", "restored"):
        timestamp = parent.get(f"{prefix}At")
        if timestamp is not None:
            result[f"{prefix}At"] = int(timestamp)
        if parent.get(f"{prefix}ById"):
            result[f"{prefix}ById"] = parent[f"{prefix}ById"]
            result[f"{prefix}By"] = parent.get(f"{prefix}By", "Someone")
    return result


def _valid_text(value, *, required: bool) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if (required and not cleaned) or len(cleaned) > MAX_TEXT_LENGTH:
        return None
    return cleaned


def _valid_timestamp(value) -> bool:
    is_integer = isinstance(value, int) or (
        isinstance(value, Decimal) and value == value.to_integral_value()
    )
    return (
        is_integer
        and not isinstance(value, bool)
        and value >= 0
        and value <= _now_ms()
    )


def _valid_value(value) -> bool:
    is_integer = isinstance(value, int) or (
        isinstance(value, Decimal) and value == value.to_integral_value()
    )
    return (
        is_integer
        and not isinstance(value, bool)
        and 0 <= value <= MAX_SAFE_INTEGER
    )


def _entry_item(
    parent: dict,
    kind: str,
    actor_id: str,
    actor_name: str,
    occurred_at: int,
    note: str,
    *,
    delta: int | None = None,
    value: int | None = None,
) -> dict:
    entry_id = uuid.uuid4().hex
    item = {
        **_entry_key(parent["groupId"], parent["counterId"], entry_id),
        "itemType": "counterEntry",
        "counterId": parent["counterId"],
        "counterKey": _counter_key(parent["groupId"], parent["counterId"]),
        "entrySort": _entry_sort(occurred_at, entry_id),
        "entryId": entry_id,
        "kind": kind,
        "occurredAt": occurred_at,
        "createdAt": _now_ms(),
        "createdById": actor_id,
        "createdBy": actor_name,
        "note": note,
    }
    if delta is not None:
        item["delta"] = delta
    if value is not None:
        item["value"] = value
    return item


def _commit(parent: dict, old_version: int, *, put_entry=None, delete_entry=None):
    """Atomically commit a parent version and its one history-row mutation."""
    transact_items = [
        {
            "Put": {
                "TableName": TABLE_NAME,
                "Item": parent,
                "ConditionExpression": "attribute_exists(id) AND version = :version",
                "ExpressionAttributeValues": {":version": old_version},
            }
        }
    ]
    if put_entry is not None:
        transact_items.append(
            {"Put": {"TableName": TABLE_NAME, "Item": put_entry}}
        )
    if delete_entry is not None:
        transact_items.append(
            {
                "Delete": {
                    "TableName": TABLE_NAME,
                    "Key": {"groupId": delete_entry["groupId"], "id": delete_entry["id"]},
                }
            }
        )
    try:
        _get_table().meta.client.transact_write_items(TransactItems=transact_items)
    except ClientError as error:
        if error.response["Error"]["Code"] in {
            "ConditionalCheckFailedException",
            "TransactionCanceledException",
        }:
            return False
        raise
    return True


def _commit_new(parent: dict, entry: dict) -> None:
    """Create the summary and required first history row as one unit."""
    _get_table().meta.client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": TABLE_NAME,
                    "Item": parent,
                    "ConditionExpression": "attribute_not_exists(id)",
                }
            },
            {
                "Put": {
                    "TableName": TABLE_NAME,
                    "Item": entry,
                    "ConditionExpression": "attribute_not_exists(id)",
                }
            },
        ]
    )


def add_counter(
    title: str,
    mode: str,
    creator_id: str,
    creator_name: str,
    group_id: str,
    *,
    occurred_at: int | None = None,
    initial_value: int | None = None,
    note: str = "",
):
    title = _valid_text(title, required=True)
    note = _valid_text(note, required=False)
    if title is None or note is None or mode not in {AUTOMATIC, MANUAL}:
        return INVALID
    now = _now_ms()
    counter_id = uuid.uuid4().hex
    parent = {
        **_parent_key(group_id, counter_id),
        "itemType": "counter",
        "counterId": counter_id,
        "title": title,
        "mode": mode,
        "createdById": creator_id,
        "createdBy": creator_name,
        "createdAt": now,
        "updatedAt": now,
        "isArchived": False,
        "version": 0,
    }
    if mode == AUTOMATIC:
        if not _valid_timestamp(occurred_at):
            return INVALID
        entry = _entry_item(parent, INCIDENT, creator_id, creator_name, occurred_at, note)
        parent["lastIncidentAt"] = occurred_at
    else:
        if not _valid_value(initial_value):
            return INVALID
        entry = _entry_item(
            parent, BASELINE, creator_id, creator_name, now, note, value=initial_value
        )
        parent["currentValue"] = initial_value
    _commit_new(parent, entry)
    return _project(parent)


def get(counter_id: str, group_id: str) -> dict | None:
    parent = _fetch(counter_id, group_id)
    return _project(parent) if parent else None


def get_detail(counter_id: str, group_id: str, cursor: str | None = None, limit: int = HISTORY_PAGE_SIZE):
    parent = _fetch(counter_id, group_id)
    if parent is None:
        return None
    entries = _raw_entries(counter_id, group_id)
    _, projected = _derive(parent, entries)
    projected.reverse()
    offset = 0
    if cursor:
        try:
            offset = int(base64.urlsafe_b64decode(cursor + "===").decode())
        except (ValueError, UnicodeDecodeError, binascii.Error):
            return INVALID
    if offset < 0 or offset > len(projected):
        return INVALID
    limit = max(1, min(int(limit), 100))
    page = projected[offset : offset + limit]
    next_offset = offset + len(page)
    next_cursor = None
    if next_offset < len(projected):
        next_cursor = base64.urlsafe_b64encode(str(next_offset).encode()).decode().rstrip("=")
    return {"counter": _project(parent), "entries": page, "nextCursor": next_cursor}


def list_recent(group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False):
    response = _get_table().query(
        KeyConditionExpression=Key("groupId").eq(group_id) & Key("id").begins_with("counter#"),
        ConsistentRead=consistent,
    )
    parents = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = _get_table().query(
            KeyConditionExpression=Key("groupId").eq(group_id)
            & Key("id").begins_with("counter#"),
            ConsistentRead=consistent,
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        parents.extend(response.get("Items", []))
    parents.sort(key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True)
    return [_project(parent) for parent in parents[:limit]]


def _mutate_entries(counter_id: str, actor: dict, mutate):
    for _ in range(5):
        parent = _fetch(counter_id, actor["groupId"])
        if parent is None:
            return NOT_FOUND
        if parent.get("isArchived"):
            return READ_ONLY
        entries = _raw_entries(counter_id, actor["groupId"])
        next_parent = copy.deepcopy(parent)
        result = mutate(next_parent, entries)
        if isinstance(result, str):
            return result
        put_entry, delete_entry = result
        try:
            summary, _ = _derive(next_parent, entries)
        except ValueError:
            return INVALID
        next_parent.update(summary)
        old_version = int(parent.get("version", 0))
        next_parent["version"] = old_version + 1
        next_parent["updatedAt"] = _now_after(parent)
        if _commit(
            next_parent,
            old_version,
            put_entry=put_entry,
            delete_entry=delete_entry,
        ):
            return _project(next_parent)
    return CONFLICT


def add_entry(counter_id: str, actor: dict, payload: dict):
    note = _valid_text(payload.get("note", ""), required=False)
    occurred_at = payload.get("occurredAt", _now_ms())
    if note is None or not _valid_timestamp(occurred_at):
        return INVALID

    def mutate(parent, entries):
        if parent["mode"] == AUTOMATIC:
            entry = _entry_item(parent, INCIDENT, actor["id"], actor["name"], occurred_at, note)
        else:
            delta = payload.get("delta")
            if delta not in {-1, 1} or isinstance(delta, bool):
                return INVALID
            entry = _entry_item(
                parent, ADJUSTMENT, actor["id"], actor["name"], occurred_at, note, delta=delta
            )
        entries.append(entry)
        if parent["mode"] == MANUAL and occurred_at < int(parent["createdAt"]):
            return INVALID
        entries.sort(key=_entry_order)
        return entry, None

    return _mutate_entries(counter_id, actor, mutate)


def edit_entry(counter_id: str, entry_id: str, actor: dict, changes: dict):
    if not isinstance(changes, dict) or not changes:
        return INVALID

    def mutate(parent, entries):
        entry = next((item for item in entries if item["entryId"] == entry_id), None)
        if entry is None:
            return NOT_FOUND
        allowed = {"note", "occurredAt"}
        if entry["kind"] == ADJUSTMENT:
            allowed.add("delta")
        if entry["kind"] == BASELINE:
            allowed = {"note", "value"}
        if set(changes) - allowed:
            return INVALID
        note = _valid_text(changes.get("note", entry.get("note", "")), required=False)
        occurred_at = changes.get("occurredAt", entry["occurredAt"])
        if note is None or not _valid_timestamp(occurred_at):
            return INVALID
        if parent["mode"] == MANUAL and occurred_at < int(parent["createdAt"]):
            return INVALID
        if entry["kind"] == ADJUSTMENT:
            delta = changes.get("delta", entry["delta"])
            if delta not in {-1, 1} or isinstance(delta, bool):
                return INVALID
            entry["delta"] = delta
        elif entry["kind"] == BASELINE:
            value = changes.get("value", entry["value"])
            if not _valid_value(value):
                return INVALID
            entry["value"] = value
        entry.update(
            note=note,
            occurredAt=occurred_at,
            entrySort=_entry_sort(occurred_at, entry_id),
            editedAt=_now_ms(),
            editedById=actor["id"],
            editedBy=actor["name"],
        )
        entries.sort(key=_entry_order)
        return entry, None

    return _mutate_entries(counter_id, actor, mutate)


def delete_entry(counter_id: str, entry_id: str, actor: dict):
    def mutate(parent, entries):
        entry = next((item for item in entries if item["entryId"] == entry_id), None)
        if entry is None:
            return NOT_FOUND
        if entry["kind"] == BASELINE or (parent["mode"] == AUTOMATIC and len(entries) == 1):
            return INVALID
        entries.remove(entry)
        return None, entry

    return _mutate_entries(counter_id, actor, mutate)


def edit_title_owned(counter_id: str, user_id: str, group_id: str, title: str):
    title = _valid_text(title, required=True)
    if title is None:
        return INVALID
    for _ in range(5):
        parent = _fetch(counter_id, group_id)
        if parent is None:
            return NOT_FOUND
        if parent.get("isArchived"):
            return READ_ONLY
        if parent.get("createdById") != user_id:
            return FORBIDDEN
        next_parent = copy.deepcopy(parent)
        next_parent["title"] = title
        next_parent["updatedAt"] = _now_after(parent)
        old_version = int(parent.get("version", 0))
        next_parent["version"] = old_version + 1
        if _commit(next_parent, old_version):
            return _project(next_parent)
    return CONFLICT


def _set_archived(counter_id: str, actor: dict, archived: bool):
    for _ in range(5):
        parent = _fetch(counter_id, actor["groupId"])
        if parent is None:
            return NOT_FOUND
        next_parent = copy.deepcopy(parent)
        now = _now_after(parent)
        if archived:
            next_parent.update(
                isArchived=True,
                archivedAt=now,
                archivedById=actor["id"],
                archivedBy=actor["name"],
            )
        else:
            next_parent.update(
                isArchived=False,
                restoredAt=now,
                restoredById=actor["id"],
                restoredBy=actor["name"],
            )
            for field in ("archivedAt", "archivedById", "archivedBy"):
                next_parent.pop(field, None)
        next_parent["updatedAt"] = now
        old_version = int(parent.get("version", 0))
        next_parent["version"] = old_version + 1
        if _commit(next_parent, old_version):
            return _project(next_parent)
    return CONFLICT


def archive(counter_id: str, actor: dict):
    return _set_archived(counter_id, actor, True)


def restore(counter_id: str, actor: dict):
    return _set_archived(counter_id, actor, False)


def delete_owned(counter_id: str, actor: dict):
    parent = _fetch(counter_id, actor["groupId"])
    if parent is None:
        return NOT_FOUND
    if parent.get("createdById") != actor["id"]:
        return FORBIDDEN
    with _get_table().batch_writer() as batch:
        for entry in _raw_entries(counter_id, actor["groupId"]):
            batch.delete_item(Key={"groupId": entry["groupId"], "id": entry["id"]})
        batch.delete_item(Key=_parent_key(actor["groupId"], counter_id))
    return _project(parent)
