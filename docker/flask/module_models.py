"""Normalized module instances for the household feed.

The persistence modules still own their DynamoDB record shapes. These classes
provide the shared feed contract so every module type can be sorted and filtered
the same way without forcing all storage into one table.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import activities
import book_club
import household_checklists
import household_polls
import household_requests
import household_shows
import jam


MODULE_TYPES = {"events", "requests", "checklists", "polls", "tv", "spotify", "book-club"}


def module_url(
    module_type: str,
    item_id: str | None = None,
) -> str:
    """Build the canonical frontend destination for a module or module filter."""
    if module_type not in MODULE_TYPES:
        raise ValueError(f"Unknown module type: {module_type}")
    params = {"module": module_type}
    if item_id:
        params["item"] = item_id
    return f"/?{urlencode(params)}"


def book_club_url(
    book_id: str,
    meeting_id: str | None = None,
    thread_id: str | None = None,
) -> str:
    """Open a Book Club title, optionally focused on one discussion thread."""
    params = {"book": book_id}
    if meeting_id:
        params["meeting"] = meeting_id
    if thread_id:
        params["thread"] = thread_id
    return f"/?{urlencode(params)}"


@dataclass(frozen=True)
class BaseModule:
    id: str
    type: str
    created_at: int
    updated_at: int
    title: str
    subtitle: str
    actor: str
    payload: dict[str, Any]

    @property
    def sort_at(self) -> int:
        return self.updated_at or self.created_at

    @property
    def is_hidden(self) -> bool:
        return False

    @property
    def is_archived(self) -> bool:
        return False

    def to_feed_item(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "sortAt": self.sort_at,
            "title": self.title,
            "subtitle": self.subtitle,
            "actor": self.actor,
            "isArchived": self.is_archived,
            "payload": self.payload,
        }


class EventModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "EventModule":
        return cls(
            id=item["id"],
            type="events",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("text", "Event"),
            subtitle="Event",
            actor=item.get("proposedBy", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived") or self.payload.get("isExpired"))


class RequestModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "RequestModule":
        return cls(
            id=item["id"],
            type="requests",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("text", "Request"),
            subtitle="Request",
            actor=item.get("requester", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived"))


class ChecklistModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "ChecklistModule":
        count = len(item.get("items") or [])
        return cls(
            id=item["id"],
            type="checklists",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("title", "Checklist"),
            subtitle=f"{count} item{'s' if count != 1 else ''}",
            actor=item.get("createdBy", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived"))


class PollModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "PollModule":
        count = len(item.get("options") or [])
        return cls(
            id=item["id"],
            type="polls",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("title", "Poll"),
            subtitle=f"{count} option{'s' if count != 1 else ''}",
            actor=item.get("createdBy", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived"))


class TvModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "TvModule":
        count = len(item.get("members") or [])
        return cls(
            id=item["id"],
            type="tv",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("title", "TV show"),
            subtitle=f"{count} watcher{'s' if count != 1 else ''}",
            actor=item.get("createdBy", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived"))


class SpotifyModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "SpotifyModule":
        return cls(
            id=item["id"],
            type="spotify",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=f"{item.get('hostName', 'Someone')}'s Spotify Jam",
            subtitle="Spotify Jam",
            actor=item.get("hostName", "Someone"),
            payload=item,
        )


class BookClubMeetingModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "BookClubMeetingModule":
        return cls(
            id=item["id"],
            type="book-club",
            created_at=int(item.get("createdAt", item["scheduledAt"])),
            updated_at=int(item.get("updatedAt", item.get("createdAt", item["scheduledAt"]))),
            title=item.get("bookTitle") or "Book Club meeting",
            subtitle=book_club.meeting_label(int(item["scheduledAt"])),
            actor=item.get("createdByName", "An admin"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return self.payload.get("status") == book_club.COMPLETED_STATUS


MODULE_CLASS_BY_TYPE = {
    "events": EventModule,
    "requests": RequestModule,
    "checklists": ChecklistModule,
    "polls": PollModule,
    "tv": TvModule,
    "spotify": SpotifyModule,
    "book-club": BookClubMeetingModule,
}


def module_from_payload(module_type: str, payload: dict[str, Any]) -> BaseModule:
    """Normalize one persistence payload using the same registry as the feed."""
    try:
        module_class = MODULE_CLASS_BY_TYPE[module_type]
    except KeyError as error:
        raise ValueError(f"Unknown module type: {module_type}") from error
    return module_class.from_payload(payload)


def list_feed(
    group_id: str,
    module_type: str | None = None,
    *,
    include_book_club: bool = False,
) -> list[dict[str, Any]]:
    requested_types = MODULE_TYPES if not module_type or module_type == "all" else {module_type}
    if not requested_types <= MODULE_TYPES:
        return []

    modules: list[BaseModule] = []
    if "events" in requested_types:
        modules.extend(
            module_from_payload("events", item)
            for item in activities.list_recent(group_id, consistent=True)
        )
    if "requests" in requested_types:
        modules.extend(
            module_from_payload("requests", item)
            for item in household_requests.list_recent(group_id, consistent=True)
        )
    if "checklists" in requested_types:
        modules.extend(
            module_from_payload("checklists", item)
            for item in household_checklists.list_recent(group_id, consistent=True)
        )
    if "polls" in requested_types:
        modules.extend(
            module_from_payload("polls", item)
            for item in household_polls.list_recent(group_id, consistent=True)
        )
    if "tv" in requested_types:
        modules.extend(
            module_from_payload("tv", item)
            for item in household_shows.list_recent(group_id, consistent=True)
        )
    if "spotify" in requested_types:
        active_jam = jam.get_active(group_id)
        if active_jam:
            modules.append(module_from_payload("spotify", active_jam))
    if "book-club" in requested_types and include_book_club:
        modules.extend(
            module_from_payload("book-club", item)
            for item in book_club.list_meetings(group_id)
        )

    modules.sort(key=lambda module: (module.sort_at, module.created_at, module.type, module.id))
    return [module.to_feed_item() for module in modules]
