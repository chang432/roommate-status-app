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
import household_checklists
import household_requests
import household_shows
import jam


MODULE_TYPES = {"events", "requests", "checklists", "tv", "spotify"}


def module_url(module_type: str, item_id: str | None = None) -> str:
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
            subtitle="Live event" if item.get("isLive") else "Event",
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


def list_feed(group_id: str, module_type: str | None = None) -> list[dict[str, Any]]:
    requested_types = MODULE_TYPES if not module_type or module_type == "all" else {module_type}
    if not requested_types <= MODULE_TYPES:
        return []

    modules: list[BaseModule] = []
    if "events" in requested_types:
        modules.extend(
            EventModule.from_payload(item)
            for item in activities.list_recent(group_id, consistent=True)
        )
    if "requests" in requested_types:
        modules.extend(
            RequestModule.from_payload(item)
            for item in household_requests.list_recent(group_id, consistent=True)
        )
    if "checklists" in requested_types:
        modules.extend(
            ChecklistModule.from_payload(item)
            for item in household_checklists.list_recent(group_id, consistent=True)
        )
    if "tv" in requested_types:
        modules.extend(
            TvModule.from_payload(item)
            for item in household_shows.list_recent(group_id, consistent=True)
        )
    if "spotify" in requested_types:
        active_jam = jam.get_active(group_id)
        if active_jam:
            modules.append(SpotifyModule.from_payload(active_jam))

    modules.sort(key=lambda module: (module.sort_at, module.created_at, module.type, module.id))
    return [module.to_feed_item() for module in modules]
