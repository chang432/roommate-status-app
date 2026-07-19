"""Creator-owned edit adapters for every module type in the unified feed."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import activities
import db
import household_checklists
import household_requests
import household_shows
import jam

EDIT_OK = "ok"
EDIT_INVALID = "invalid"
EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"
EDIT_READ_ONLY = "read_only"
EDIT_CONFLICT = "conflict"
MAX_TEXT_LENGTH = 280


@dataclass
class EditResult:
    status: str
    module_type: str
    payload: dict[str, Any] | None = None
    error: str | None = None
    notify_user_ids: set[str] = field(default_factory=set)
    notify_group: bool = False
    notification_body: str | None = None


def _invalid(module_type: str, message: str) -> EditResult:
    return EditResult(EDIT_INVALID, module_type, error=message)


def _text(changes: dict, field_name: str, label: str) -> tuple[str | None, str | None]:
    value = changes.get(field_name)
    if not isinstance(value, str) or not value.strip():
        return None, f"{label} is required."
    value = value.strip()
    if len(value) > MAX_TEXT_LENGTH:
        return None, f"Keep {label.lower()} under {MAX_TEXT_LENGTH} characters."
    return value, None


def _map_persistence_result(module_type: str, result: dict | str) -> EditResult:
    if isinstance(result, dict):
        return EditResult(EDIT_OK, module_type, payload=result)
    return EditResult(result, module_type)


def _edit_event(item_id: str, editor: dict, changes: dict) -> EditResult:
    if set(changes) - {"text", "startAt", "endAt"}:
        return _invalid("events", "Unsupported event edit field.")
    current = activities.get(item_id, editor["groupId"], consistent=True)
    if current is None:
        return EditResult(EDIT_NOT_FOUND, "events")
    if "text" in changes:
        text, error = _text(changes, "text", "Event")
        if error:
            return _invalid("events", error)
    else:
        text = current["text"]

    schedule_changed = "startAt" in changes or "endAt" in changes
    start_at = changes.get("startAt", current.get("startAt"))
    end_at = changes.get("endAt", current.get("endAt"))
    for value in (start_at, end_at):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            return _invalid("events", "Event times must be millisecond timestamps or null.")
    if end_at is not None and start_at is None:
        return _invalid("events", "Choose a start time before an end time.")
    if start_at is not None and end_at is not None and end_at <= start_at:
        return _invalid("events", "End time must be later than start time.")

    mapped = _map_persistence_result(
        "events",
        activities.edit_owned(
            item_id,
            editor["id"],
            editor["groupId"],
            text,
            start_at,
            end_at,
            schedule_changed,
        ),
    )
    changed = (
        text != current["text"]
        or start_at != current.get("startAt")
        or end_at != current.get("endAt")
    )
    if mapped.status == EDIT_OK and changed:
        mapped.notify_user_ids = set(current.get("memberIds") or []) - {editor["id"]}
        mapped.notification_body = f"{editor['name']} updated {text}"
    return mapped


def _edit_request(item_id: str, editor: dict, changes: dict) -> EditResult:
    if set(changes) - {"text", "requestedIds"}:
        return _invalid("requests", "Unsupported request edit field.")
    current = household_requests.get(item_id, editor["groupId"], consistent=True)
    if current is None:
        return EditResult(EDIT_NOT_FOUND, "requests")
    if "text" in changes:
        text, error = _text(changes, "text", "Request")
        if error:
            return _invalid("requests", error)
    else:
        text = current["text"]
    requested_values = changes.get("requestedIds", current.get("requestedIds") or [])
    if not isinstance(requested_values, list) or not all(
        isinstance(user_id, str) for user_id in requested_values
    ):
        return _invalid("requests", "Choose at least one roommate to request.")
    requested_ids = {user_id.strip() for user_id in requested_values if user_id.strip()}
    requested_ids.discard(editor["id"])
    if not requested_ids:
        return _invalid("requests", "Choose at least one roommate to request.")
    requested_roommates = []
    for user_id in sorted(requested_ids):
        roommate = db.get_group_member(user_id, editor["groupId"])
        if roommate is None:
            return _invalid("requests", "Every requested roommate must be valid.")
        requested_roommates.append(roommate)

    mapped = _map_persistence_result(
        "requests",
        household_requests.edit_owned(
            item_id, editor["id"], editor["groupId"], text, requested_roommates
        ),
    )
    old_ids = set(current.get("requestedIds") or [])
    if mapped.status == EDIT_OK and (text != current["text"] or requested_ids != old_ids):
        mapped.notify_user_ids = (
            requested_ids if text != current["text"] else requested_ids - old_ids
        ) - {editor["id"]}
        mapped.notification_body = f"{editor['name']} updated a request: {text}"
    return mapped


def _edit_title(
    module_type: str,
    item_id: str,
    editor: dict,
    changes: dict,
    persistence_edit: Callable[[str, str, str, str], dict | str],
) -> EditResult:
    if set(changes) != {"title"}:
        return _invalid(module_type, "Only the title can be edited.")
    title, error = _text(changes, "title", "Title")
    if error:
        return _invalid(module_type, error)
    return _map_persistence_result(
        module_type,
        persistence_edit(item_id, editor["id"], editor["groupId"], title),
    )


def _edit_checklist(item_id: str, editor: dict, changes: dict) -> EditResult:
    return _edit_title(
        "checklists", item_id, editor, changes, household_checklists.edit_title_owned
    )


def _edit_show(item_id: str, editor: dict, changes: dict) -> EditResult:
    return _edit_title("tv", item_id, editor, changes, household_shows.edit_title_owned)


def _edit_jam(item_id: str, editor: dict, changes: dict) -> EditResult:
    if set(changes) != {"link"}:
        return _invalid("spotify", "Only the Spotify Jam link can be edited.")
    link = changes.get("link")
    if not isinstance(link, str) or not jam.valid_spotify_link(link.strip()):
        return _invalid("spotify", "Paste a valid Spotify Jam link.")
    current = jam.get_active(editor["groupId"])
    mapped = _map_persistence_result(
        "spotify", jam.edit_owned(item_id, editor["id"], editor["groupId"], link.strip())
    )
    if (
        mapped.status == EDIT_OK
        and current is not None
        and mapped.payload["link"] != current["link"]
    ):
        mapped.notify_group = True
        mapped.notification_body = f"{editor['name']} updated the active Spotify Jam link."
    return mapped


EDITORS: dict[str, Callable[[str, dict, dict], EditResult]] = {
    "events": _edit_event,
    "requests": _edit_request,
    "checklists": _edit_checklist,
    "tv": _edit_show,
    "spotify": _edit_jam,
}


def edit(module_type: str, item_id: str, editor: dict, changes: dict) -> EditResult:
    """Dispatch an edit through the registered module adapter."""
    adapter = EDITORS.get(module_type)
    if adapter is None:
        return _invalid(module_type, "Unknown module type.")
    if not isinstance(changes, dict) or not changes:
        return _invalid(module_type, "At least one edit is required.")
    return adapter(item_id, editor, changes)
