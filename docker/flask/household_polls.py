"""Standalone household polls stored as one item per poll."""

from __future__ import annotations

import copy
import os
import threading
import time
import uuid

from botocore.exceptions import ClientError

from db import resource
from group_tables import query_group

RECENT_LIMIT = 10
MAX_OPTIONS = 50
TABLE_NAME = os.environ.get("POLLS_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-polls"
)

NOT_FOUND = "not_found"
FORBIDDEN = "forbidden"
READ_ONLY = "read_only"
DUPLICATE = "duplicate"
LIMIT_REACHED = "limit"
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


def _fetch(poll_id: str, group_id: str) -> dict | None:
    return _get_table().get_item(
        Key={"groupId": group_id, "id": poll_id}, ConsistentRead=True
    ).get("Item")


def _now_after(item: dict) -> int:
    return max(
        int(time.time() * 1000),
        int(item.get("updatedAt", item.get("createdAt", 0))) + 1,
    )


def _option(text: str, user_id: str, name: str, now_ms: int) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "text": text,
        "addedById": user_id,
        "addedBy": name,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "voterIds": [],
        "voterNamesById": {},
    }


def _project_option(raw: dict) -> dict:
    names = raw.get("voterNamesById") or {}
    voter_ids = sorted(
        set(raw.get("voterIds") or []),
        key=lambda user_id: names.get(user_id, user_id).casefold(),
    )
    return {
        "id": raw["id"],
        "text": raw.get("text", ""),
        "addedById": raw.get("addedById"),
        "addedBy": raw.get("addedBy", "Someone"),
        "createdAt": int(raw.get("createdAt", 0)),
        "updatedAt": int(raw.get("updatedAt", raw.get("createdAt", 0))),
        "voterIds": voter_ids,
        "voters": [
            {"id": user_id, "name": names.get(user_id, user_id)}
            for user_id in voter_ids
        ],
    }


def _project(item: dict) -> dict:
    archived_at = item.get("archivedAt")
    return {
        "id": item["id"],
        "title": item.get("title", ""),
        "createdById": item.get("createdById"),
        "createdBy": item.get("createdBy", "Someone"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
        "options": [_project_option(option) for option in item.get("options") or []],
        "isArchived": bool(item.get("isArchived", False)),
        "archivedAt": int(archived_at) if archived_at is not None else None,
        "archivedById": item.get("archivedById"),
        "archivedBy": item.get("archivedBy"),
        "version": int(item.get("version", 0)),
    }


def add_poll(
    title: str,
    created_by_id: str,
    created_by: str,
    group_id: str,
    option_texts: list[str],
) -> dict:
    now_ms = int(time.time() * 1000)
    item = {
        "groupId": group_id,
        "id": uuid.uuid4().hex,
        "title": title,
        "createdById": created_by_id,
        "createdBy": created_by,
        "createdAt": now_ms,
        "updatedAt": now_ms,
        "options": [
            _option(text, created_by_id, created_by, now_ms) for text in option_texts
        ],
        "isArchived": False,
        "version": 0,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def get(poll_id: str, group_id: str) -> dict | None:
    item = _fetch(poll_id, group_id)
    return _project(item) if item else None


def _mutate(poll_id: str, group_id: str, mutate, *, require_active: bool = True):
    """Retry a whole embedded-option update so concurrent votes are not lost."""
    for _ in range(5):
        item = _fetch(poll_id, group_id)
        if item is None:
            return NOT_FOUND
        if require_active and item.get("isArchived"):
            return READ_ONLY
        next_item = copy.deepcopy(item)
        result = mutate(next_item)
        if isinstance(result, str):
            return result
        old_version = int(item.get("version", 0))
        next_item["version"] = old_version + 1
        next_item["updatedAt"] = _now_after(item)
        values = {":version": old_version}
        condition = "attribute_exists(id) AND version = :version"
        if require_active:
            values[":false"] = False
            condition += " AND (attribute_not_exists(isArchived) OR isArchived = :false)"
        try:
            _get_table().put_item(
                Item=next_item,
                ConditionExpression=condition,
                ExpressionAttributeValues=values,
            )
            return _project(next_item)
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return CONFLICT


def edit_title_owned(poll_id: str, user_id: str, group_id: str, title: str):
    def mutate(item):
        if item.get("createdById") != user_id:
            return FORBIDDEN
        item["title"] = title

    return _mutate(poll_id, group_id, mutate)


def add_option(poll_id: str, user_id: str, name: str, group_id: str, text: str):
    def mutate(item):
        options = item.setdefault("options", [])
        if len(options) >= MAX_OPTIONS:
            return LIMIT_REACHED
        if any(option.get("text", "").strip().casefold() == text.casefold() for option in options):
            return DUPLICATE
        options.append(_option(text, user_id, name, _now_after(item)))

    return _mutate(poll_id, group_id, mutate)


def edit_option_owned(
    poll_id: str, option_id: str, user_id: str, group_id: str, text: str
):
    def mutate(item):
        if item.get("createdById") != user_id:
            return FORBIDDEN
        options = item.get("options") or []
        if any(
            option.get("id") != option_id
            and option.get("text", "").strip().casefold() == text.casefold()
            for option in options
        ):
            return DUPLICATE
        for option in options:
            if option.get("id") == option_id:
                option["text"] = text
                option["updatedAt"] = _now_after(item)
                return None
        return NOT_FOUND

    return _mutate(poll_id, group_id, mutate)


def set_vote(
    poll_id: str,
    option_id: str,
    user_id: str,
    name: str,
    group_id: str,
    selected: bool,
):
    def mutate(item):
        for option in item.get("options") or []:
            if option.get("id") != option_id:
                continue
            voter_ids = list(option.get("voterIds") or [])
            names = dict(option.get("voterNamesById") or {})
            if selected and user_id not in voter_ids:
                voter_ids.append(user_id)
                names[user_id] = name
            elif not selected and user_id in voter_ids:
                voter_ids.remove(user_id)
                names.pop(user_id, None)
            option["voterIds"] = voter_ids
            option["voterNamesById"] = names
            return None
        return NOT_FOUND

    return _mutate(poll_id, group_id, mutate)


def archive(poll_id: str, user_id: str, name: str, group_id: str):
    def mutate(item):
        archived_at = _now_after(item)
        item.update(
            isArchived=True,
            archivedAt=archived_at,
            archivedById=user_id,
            archivedBy=name,
        )

    return _mutate(poll_id, group_id, mutate, require_active=False)


def restore(poll_id: str, user_id: str, name: str, group_id: str):
    def mutate(item):
        item["isArchived"] = False
        item["restoredById"] = user_id
        item["restoredBy"] = name
        for field in ("archivedAt", "archivedById", "archivedBy"):
            item.pop(field, None)

    return _mutate(poll_id, group_id, mutate, require_active=False)


def delete(poll_id: str, group_id: str) -> dict | None:
    item = _fetch(poll_id, group_id)
    if item is None:
        return None
    _get_table().delete_item(Key={"groupId": group_id, "id": poll_id})
    return _project(item)


def list_recent(
    group_id: str, limit: int = RECENT_LIMIT, consistent: bool = False
) -> list[dict]:
    polls = [
        item
        for item in query_group(_get_table(), group_id, consistent=consistent)
        if "createdAt" in item
    ]
    polls.sort(
        key=lambda item: int(item.get("updatedAt", item["createdAt"])), reverse=True
    )
    return [_project(item) for item in polls[:limit]]
