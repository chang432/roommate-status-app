"""Shared imports and helpers for Flask API feature tests."""

import json
import os
from concurrent.futures import ThreadPoolExecutor

# moto and boto3 need *some* region/credentials present before any client is
# built; these dummy values are never sent anywhere (moto intercepts them).
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")

import boto3
import pytest
from moto import mock_aws

import activities
import book_club
import comment_likes
import db
import groups
import household_checklists
import household_forums
import household_polls
import household_requests
import household_shows
import jam
import module_models
import push
import seed
from app import _activity_status_overrides, create_app, mentions_all, resolve_mentions

TEST_GROUP_ID = db.DEFAULT_GROUP_ID
TEST_USER_ID = "andre"


def grouped_path(path: str, user_id: str = TEST_USER_ID) -> str:
    separator = "&" if "?" in path else "?"
    return f"{path}{separator}userId={user_id}"


def _b64url(raw: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# --- Proposed activities ----------------------------------------------------
def _propose(
    client,
    text: str,
    creator_id: str = "andre",
    start_at: int | None = None,
    end_at: int | None = None,
):
    """Create an activity through the public API with a real roommate owner."""
    return client.post(
        "/api/activities",
        json={
            "text": text,
            "proposedById": creator_id,
            "startAt": start_at,
            "endAt": end_at,
        },
    )


def _make_request(
    client,
    text: str = "Please take out recycling",
    requester_id: str = "andre",
    requested_ids: list[str] | None = None,
):
    return client.post(
        "/api/requests",
        json={
            "text": text,
            "requesterId": requester_id,
            "requestedIds": requested_ids or ["kayla", "ting"],
        },
    )


def _make_checklist(
    client,
    title: str = "Costco Run",
    created_by_id: str = "andre",
    items: list[str] | None = None,
):
    return client.post(
        "/api/checklists",
        json={
            "title": title,
            "createdById": created_by_id,
            "items": ["Vacuum", "Take bins out"] if items is None else items,
        },
    )


def _capture_notifications(monkeypatch):
    """Replace push send functions with recorders; return audience + kwargs.

    This verifies route-level recipient selection without requiring VAPID keys.
    """
    calls = []

    def fake_notify_users(**kwargs):
        all_group_users = set(db.get_group_user_ids(TEST_GROUP_ID, consistent=True))
        if kwargs.get("user_ids") == all_group_users:
            normalized = dict(kwargs)
            normalized.pop("user_ids", None)
            if normalized.get("event_type") is None:
                normalized.pop("event_type", None)
            calls.append(("all", normalized))
        else:
            calls.append(("users", kwargs))
        return {"sent": 0, "pruned": 0, "failed": 0}

    monkeypatch.setattr(push, "notify_users", fake_notify_users)
    return calls

def _make_show(client, title="Severance", creator="sheryl"):
    """Create a show and return its projected dict (newest, so first in list)."""
    res = client.post("/api/shows", json={"title": title, "createdById": creator})
    assert res.status_code == 200
    return res.get_json()[0]


# Feature test modules share this small compatibility surface, including
# underscore-prefixed helper names that Python's default star import omits.
__all__ = [name for name in globals() if not name.startswith("__")]
