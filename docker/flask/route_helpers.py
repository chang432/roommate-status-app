import os
import re
from urllib.parse import quote

from flask import jsonify, request

import activities
import db
import module_models
import push

# Cap proposal/request/checklist text so a notification body stays sane.
MAX_ACTIVITY_LEN = 280

# Cap comment text the same way proposal text is capped.
MAX_COMMENT_LEN = 280

# Number of available roommates that triggers the "gather" push (PROJECT.md:
# "3 or more"). Override with the AVAILABLE_THRESHOLD env var.
PUSH_THRESHOLD = int(os.environ.get("AVAILABLE_THRESHOLD", "3"))


def mentions_all(text: str) -> bool:
    """Return whether text contains the reserved @all mention token."""
    return re.search(r"(?<![\w@])@all(?=$|[^\w])", text, flags=re.IGNORECASE) is not None


def resolve_mentions(text: str, roommates: list[dict], author_id: str) -> list[dict]:
    """Resolve valid @display-name tokens to canonical household identities."""
    candidates = []
    for roommate in sorted(roommates, key=lambda item: len(item["name"]), reverse=True):
        if roommate["id"] == author_id:
            continue
        # Treat names as mentions only at token boundaries, avoiding accidental
        # matches inside email-like text or longer words.
        pattern = rf"(?<![\w@])@{re.escape(roommate['name'])}(?=$|[^\w])"
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            candidates.append((match.start(), match.end(), roommate))

    # Prefer the longest name when household names overlap at the same text
    # position, then deduplicate repeated mentions while preserving text order.
    candidates.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    resolved = []
    used_ids = set()
    occupied_until = -1
    for start, end, roommate in candidates:
        if start < occupied_until:
            continue
        occupied_until = end
        if roommate["id"] not in used_ids:
            resolved.append({"id": roommate["id"], "name": roommate["name"]})
            used_ids.add(roommate["id"])
    return resolved


def optional_epoch_millis(body: dict, field: str) -> tuple[int | None, str | None]:
    """Parse a nullable epoch-millisecond field without accepting booleans."""
    value = body.get(field)
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, int):
        return None, f"{field} must be an epoch-millisecond timestamp or null."
    parsed = int(value)
    if parsed < 0:
        return None, f"{field} must be an epoch-millisecond timestamp or null."
    return parsed, None


def validate_activity_schedule(body: dict) -> tuple[int | None, int | None, str | None]:
    start_at, error = optional_epoch_millis(body, "startAt")
    if error:
        return None, None, error
    end_at, error = optional_epoch_millis(body, "endAt")
    if error:
        return None, None, error
    if end_at is not None and start_at is None:
        return None, None, "An end time requires a start time."
    if start_at is not None and end_at is not None and end_at <= start_at:
        return None, None, "End time must be later than start time."
    return start_at, end_at, None


def invalid_user_response() -> tuple:
    """400 for a userId that doesn't resolve to a grouped account.

    The machine-readable `code` lets the frontend distinguish a dead session
    (e.g. the local in-memory DB was wiped) from other 400s and auto-logout.
    """
    return jsonify({"error": "A valid roommate is required.", "code": "invalid_user"}), 400


def group_member_from_query() -> tuple[dict | None, tuple | None]:
    user_id = (request.args.get("userId") or "").strip()
    member = db.get_group_member(user_id) if user_id else None
    if member is None:
        return None, invalid_user_response()
    return member, None


def group_user_ids(group_id: str) -> set[str]:
    return set(db.get_group_user_ids(group_id, consistent=True))


def notify_group(
    group_id: str,
    title: str,
    body: str,
    url: str = "/",
    event_type: str | None = None,
    exclude_user_ids: set[str] | None = None,
) -> dict:
    return push.notify_users(
        user_ids=group_user_ids(group_id),
        title=title,
        body=body,
        url=group_url(group_id, url),
        event_type=event_type,
        exclude_user_ids=exclude_user_ids,
    )


def group_url(group_id: str, url: str = "/") -> str:
    """Keep notification deep links in the household that generated them."""
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}groupId={quote(group_id)}"


def _activity_status_overrides(group_id: str, consistent: bool = False) -> dict[str, dict]:
    """Return the latest live activity-driven status per participant."""
    overrides: dict[str, dict] = {}
    for activity in activities.list_recent(group_id, consistent=consistent):
        member_ids = activity.get("memberIds") or []
        if activity.get("isLive"):
            timestamp = activity.get("liveStartedAt") or activity.get("startAt") or 0
            for user_id in member_ids:
                current = overrides.get(user_id)
                if current is None or current["kind"] != "live" or timestamp > current["timestamp"]:
                    overrides[user_id] = {"kind": "live", "timestamp": timestamp}
    return overrides


def effective_available_count(group_id: str, roommates: list[dict]) -> int:
    """Count available roommates after applying activity-driven status overlays."""
    overrides = _activity_status_overrides(group_id, consistent=True)
    available = 0
    for roommate in roommates:
        if roommate["status"] != "available":
            continue
        override = overrides.get(roommate["id"])
        if override is None:
            available += 1
    return available


