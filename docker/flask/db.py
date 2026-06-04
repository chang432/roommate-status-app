"""In-memory mock "database" for the Roomie Status backend.

This stands in for a real datastore so the API is fully functional today. All
data access goes through the functions here, so swapping in a real database
later means editing only this module (the routes in app.py stay unchanged).

State lives in module scope and is guarded by a lock because Flask may serve
requests on multiple threads.
"""

from __future__ import annotations

import threading

# Allowed status values. Mirrors the frontend's STATUS enum (utils/status.js)
# and PROJECT.md: available, busy, or a free-form custom message.
VALID_STATUSES = {"available", "busy", "custom"}

# Demo password shared by every roommate. A real backend would store per-user
# salted password hashes; that work is deferred until a real DB is added.
DEMO_PASSWORD = "roomie"

# Number of available roommates that should trigger a "gather" notification
# (PROJECT.md: "Whenever 3 or more status's are available...").
AVAILABLE_THRESHOLD = 3

# Seed household. Matches the frontend mock seed so behavior is identical
# whether the UI talks to this server or its built-in fallback.
_SEED = [
    {"id": "andre", "name": "Andre", "status": "available", "statusText": ""},
    {"id": "jordan", "name": "Jordan", "status": "available", "statusText": ""},
    {"id": "maya", "name": "Maya", "status": "custom", "statusText": "At the gym till 7"},
    {"id": "sam", "name": "Sam", "status": "busy", "statusText": ""},
    {"id": "priya", "name": "Priya", "status": "available", "statusText": ""},
    {"id": "leo", "name": "Leo", "status": "busy", "statusText": ""},
]

_lock = threading.Lock()
# Deep-ish copy of the seed so mutations never touch the constant template.
_roommates: list[dict] = [dict(r) for r in _SEED]


def reset() -> None:
    """Restore the seed state. Used by tests."""
    global _roommates
    with _lock:
        _roommates = [dict(r) for r in _SEED]


def get_all() -> list[dict]:
    """Return a copy of every roommate and their current status."""
    with _lock:
        return [dict(r) for r in _roommates]


def find_by_name(name: str) -> dict | None:
    """Look up a roommate by name, case-insensitively. Returns a copy or None."""
    needle = (name or "").strip().lower()
    with _lock:
        for r in _roommates:
            if r["name"].lower() == needle:
                return dict(r)
    return None


def update_status(roommate_id: str, status: str, status_text: str = "") -> list[dict] | None:
    """Update one roommate's status.

    Custom statuses keep their text; fixed statuses clear it (matching the
    frontend). Returns the full updated household, or None if the id is unknown.
    """
    with _lock:
        for r in _roommates:
            if r["id"] == roommate_id:
                r["status"] = status
                r["statusText"] = status_text if status == "custom" else ""
                return [dict(x) for x in _roommates]
    return None


def available_count(roommates: list[dict] | None = None) -> int:
    """Count how many roommates are currently available to hang."""
    source = roommates if roommates is not None else get_all()
    return sum(1 for r in source if r["status"] == "available")
