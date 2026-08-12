"""Normalized module instances for the household feed.

The persistence modules still own their DynamoDB record shapes. These classes
provide the shared feed contract so every module type can be sorted and filtered
the same way without forcing all storage into one table.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import activities
import book_club
import comment_likes
import household_checklists
import household_counters
import household_forums
import household_polls
import household_requests
import household_shows
import jam


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


class CounterModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "CounterModule":
        value = int(item.get("currentValue", 0))
        subtitle = (
            f"{value} day{'s' if value != 1 else ''}"
            if item.get("mode") == household_counters.AUTOMATIC
            else f"Count: {value}"
        )
        return cls(
            id=item["id"],
            type="counters",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("title", "Counter"),
            subtitle=subtitle,
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


class ForumModule(BaseModule):
    @classmethod
    def from_payload(cls, item: dict[str, Any]) -> "ForumModule":
        return cls(
            id=item["id"],
            type="forums",
            created_at=int(item["createdAt"]),
            updated_at=int(item.get("updatedAt", item["createdAt"])),
            title=item.get("title") or "Forum",
            subtitle=item.get("bookTitle") or "Book forum",
            actor=item.get("createdBy", "Someone"),
            payload=item,
        )

    @property
    def is_archived(self) -> bool:
        return bool(self.payload.get("isArchived"))


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


@dataclass(frozen=True)
class ModuleSource:
    """Everything the unified feed needs to load and normalize one module type."""

    model: type[BaseModule]
    list_payloads: Callable[["FeedReadContext"], Iterable[dict[str, Any]]]


_UNLOADED = object()


@dataclass
class FeedReadContext:
    """Lazily share multi-module partition reads within one feed request."""

    group_id: str
    consistent: bool = False
    _like_rows: object = field(default=_UNLOADED, init=False, repr=False)
    _book_rows: object = field(default=_UNLOADED, init=False, repr=False)

    def likes(self, parent_field: str) -> dict:
        if self._like_rows is _UNLOADED:
            self._like_rows = comment_likes.list_for_group(
                self.group_id, consistent=self.consistent
            )
        return comment_likes.group_by_parent(self._like_rows, parent_field)

    def book_rows(self) -> list[dict]:
        if self._book_rows is _UNLOADED:
            self._book_rows = book_club.list_rows(
                self.group_id, consistent=self.consistent
            )
        return self._book_rows


def _list_jam(context: FeedReadContext) -> Iterable[dict[str, Any]]:
    active_jam = jam.get_active(
        context.group_id, consistent=context.consistent
    )
    return (active_jam,) if active_jam else ()


MODULE_SOURCES = {
    "events": ModuleSource(
        EventModule,
        lambda context: activities.list_recent(
            context.group_id,
            consistent=context.consistent,
            likes_by_activity=context.likes("activityId"),
        ),
    ),
    "requests": ModuleSource(
        RequestModule,
        lambda context: household_requests.list_recent(
            context.group_id,
            consistent=context.consistent,
            likes_by_request=context.likes("requestId"),
        ),
    ),
    "checklists": ModuleSource(
        ChecklistModule,
        lambda context: household_checklists.list_recent(
            context.group_id, consistent=context.consistent
        ),
    ),
    "polls": ModuleSource(
        PollModule,
        lambda context: household_polls.list_recent(
            context.group_id,
            consistent=context.consistent,
            likes_by_poll=context.likes("pollId"),
        ),
    ),
    "counters": ModuleSource(
        CounterModule,
        lambda context: household_counters.list_recent(
            context.group_id, consistent=context.consistent
        ),
    ),
    "tv": ModuleSource(
        TvModule,
        lambda context: household_shows.list_recent(
            context.group_id, consistent=context.consistent
        ),
    ),
    "spotify": ModuleSource(SpotifyModule, _list_jam),
    "book-club": ModuleSource(
        BookClubMeetingModule,
        lambda context: book_club.list_meetings(
            context.group_id,
            consistent=context.consistent,
            rows=context.book_rows(),
        ),
    ),
    "forums": ModuleSource(
        ForumModule,
        lambda context: household_forums.list_recent(
            context.group_id,
            consistent=context.consistent,
            rows=context.book_rows(),
            likes_by_forum=context.likes("forumId"),
        ),
    ),
}

MODULE_TYPES = frozenset(MODULE_SOURCES)


def module_from_payload(module_type: str, payload: dict[str, Any]) -> BaseModule:
    """Normalize one persistence payload using the same registry as the feed."""
    try:
        module_source = MODULE_SOURCES[module_type]
    except KeyError as error:
        raise ValueError(f"Unknown module type: {module_type}") from error
    return module_source.model.from_payload(payload)


def list_feed(
    group_id: str,
    module_types: str | Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    if module_types is None or module_types == "all":
        requested_types = MODULE_TYPES
    elif isinstance(module_types, str):
        requested_types = {module_types}
    else:
        requested_types = set(module_types)
    if not requested_types <= MODULE_TYPES:
        return []

    context = FeedReadContext(group_id)
    modules: list[BaseModule] = []
    for source_type, source in MODULE_SOURCES.items():
        if source_type not in requested_types:
            continue
        modules.extend(
            source.model.from_payload(item)
            for item in source.list_payloads(context)
        )

    modules.sort(key=lambda module: (module.sort_at, module.created_at, module.type, module.id))
    return [module.to_feed_item() for module in modules]
