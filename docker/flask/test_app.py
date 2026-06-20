"""Tests for the Roomie Status Flask API.

Run with:  python -m pytest   (or: python test_app.py)

Covers the three frontend-facing endpoints plus their error paths, asserting
the exact response shapes the frontend (frontend/src/api/client.js) depends on.
DynamoDB is mocked with moto, so these run hermetically with no real AWS calls.
"""

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
import db
import push
from app import create_app, mentions_all, resolve_mentions


@pytest.fixture(scope="session", autouse=True)
def _dynamodb():
    """Stand up mocked DynamoDB tables for the whole test session.

    Mirrors the infrastructure templates (infrastructure/dynamodb-table-{dev,
    main}.yaml), which provision the roommate, push-subscriptions, and
    activities tables — the modules don't create them. Kept open for the session
    so the modules' cached table resources stay valid.
    """
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        for table_name in (db.TABLE_NAME, push.TABLE_NAME, activities.TABLE_NAME):
            ddb.create_table(
                TableName=table_name,
                KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        yield


@pytest.fixture()
def client():
    db.reset()  # Isolate each test from prior status mutations.
    # Clear mutable tables so each test starts with no activities/subscriptions.
    for table in (activities._get_table(), push._get_table()):
        for item in table.scan().get("Items", []):
            table.delete_item(Key={"id": item["id"]})
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_login_success(client):
    res = client.post("/api/login", json={"name": "Sheryl", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json() == {"user": {"id": "sheryl", "name": "Sheryl"}}


def test_login_is_case_insensitive(client):
    res = client.post("/api/login", json={"name": "  sHeRyL ", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json()["user"]["id"] == "sheryl"


def test_login_bad_password(client):
    res = client.post("/api/login", json={"name": "Sheryl", "password": "nope"})
    assert res.status_code == 401
    assert "error" in res.get_json()


def test_login_unknown_name(client):
    res = client.post("/api/login", json={"name": "Ghost", "password": "roomie"})
    assert res.status_code == 401


def test_get_roommates(client):
    res = client.get("/api/roommates")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 5
    # Shape the frontend relies on.
    assert set(data[0]) == {"id", "name", "status", "statusText", "statusUpdatedAt"}
    assert data[0]["statusUpdatedAt"] is None


def test_update_status_keeps_note(client):
    # Any status may carry a supplemental note that is preserved (trimmed by the
    # route) and shown alongside the status.
    res = client.put(
        "/api/roommates/ting/status",
        json={"status": "busy", "statusText": "  Cooking dinner  "},
    )
    assert res.status_code == 200
    ting = next(r for r in res.get_json() if r["id"] == "ting")
    assert ting["status"] == "busy"
    assert ting["statusText"] == "Cooking dinner"  # trimmed, preserved


def test_update_status_without_note_clears_text(client):
    res = client.put(
        "/api/roommates/sheryl/status",
        json={"status": "available", "statusText": ""},
    )
    assert res.status_code == 200
    sheryl = next(r for r in res.get_json() if r["id"] == "sheryl")
    assert sheryl["status"] == "available"
    assert sheryl["statusText"] == ""


def test_update_status_sets_server_timestamp(client, monkeypatch):
    monkeypatch.setattr(db.time, "time", lambda: 1_750_000_000.123)

    res = client.put(
        "/api/roommates/sheryl/status",
        json={"status": "available", "statusText": ""},
    )

    sheryl = next(r for r in res.get_json() if r["id"] == "sheryl")
    assert sheryl["statusUpdatedAt"] == 1_750_000_000_123


def test_update_status_refreshes_timestamp_on_every_save(client, monkeypatch):
    times = iter([1_750_000_000.123, 1_750_000_060.456])
    monkeypatch.setattr(db.time, "time", lambda: next(times))

    first = client.put(
        "/api/roommates/sheryl/status",
        json={"status": "available", "statusText": ""},
    )
    second = client.put(
        "/api/roommates/sheryl/status",
        json={"status": "available", "statusText": "Still free"},
    )

    first_sheryl = next(r for r in first.get_json() if r["id"] == "sheryl")
    second_sheryl = next(r for r in second.get_json() if r["id"] == "sheryl")
    assert first_sheryl["statusUpdatedAt"] == 1_750_000_000_123
    assert second_sheryl["statusUpdatedAt"] == 1_750_000_060_456


def test_update_status_custom_now_invalid(client):
    # "custom" was removed as a status; it must be rejected.
    res = client.put(
        "/api/roommates/ting/status",
        json={"status": "custom", "statusText": "anything"},
    )
    assert res.status_code == 400


def test_update_status_invalid(client):
    res = client.put("/api/roommates/sheryl/status", json={"status": "napping"})
    assert res.status_code == 400


def test_update_status_unknown_roommate(client):
    res = client.put("/api/roommates/ghost/status", json={"status": "busy"})
    assert res.status_code == 404


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


# --- Web Push (PoC) ---------------------------------------------------------
# VAPID keys are not set in the test env, so push is "not configured": the
# key/test endpoints should 503, while subscribe (pure storage) still works.
def test_push_public_key_unconfigured(client):
    res = client.get("/api/push/public-key")
    assert res.status_code == 503


def test_push_subscribe_stores(client):
    sub = {"endpoint": "https://example.com/ep/abc", "keys": {"p256dh": "x", "auth": "y"}}
    res = client.post(
        "/api/push/subscribe",
        json={"subscription": sub, "userId": "andre"},
    )
    assert res.status_code == 200
    assert res.get_json() == {"ok": True}
    assert any(s["endpoint"] == sub["endpoint"] for s in push.list_subscriptions())
    item = push._get_table().get_item(Key={"id": push._endpoint_id(sub["endpoint"])})["Item"]
    assert item["userId"] == "andre"


def test_push_subscription_moves_with_current_signed_in_roommate(client):
    sub = {"endpoint": "https://example.com/ep/shared", "keys": {}}
    for user_id in ("andre", "kayla"):
        res = client.post(
            "/api/push/subscribe",
            json={"subscription": sub, "userId": user_id},
        )
        assert res.status_code == 200

    item = push._get_table().get_item(Key={"id": push._endpoint_id(sub["endpoint"])})["Item"]
    assert item["userId"] == "kayla"


def test_push_subscribe_rejects_missing_endpoint(client):
    res = client.post(
        "/api/push/subscribe",
        json={"subscription": {"keys": {}}, "userId": "andre"},
    )
    assert res.status_code == 400


def test_push_subscribe_requires_valid_roommate(client):
    sub = {"endpoint": "https://example.com/ep/abc", "keys": {}}
    missing = client.post("/api/push/subscribe", json={"subscription": sub})
    unknown = client.post(
        "/api/push/subscribe",
        json={"subscription": sub, "userId": "ghost"},
    )
    assert missing.status_code == 400
    assert unknown.status_code == 400


def test_status_reminder_unconfigured(client):
    res = client.post("/api/roommates/notify", json={"requesterId": "andre"})

    assert res.status_code == 503


def test_status_reminder_requires_valid_roommate(client):
    missing = client.post("/api/roommates/notify", json={})
    unknown = client.post("/api/roommates/notify", json={"requesterId": "ghost"})

    assert missing.status_code == 400
    assert unknown.status_code == 400


def test_status_reminder_notifies_household_except_requester(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    monkeypatch.setattr(push, "is_configured", lambda: True)

    res = client.post("/api/roommates/notify", json={"requesterId": "kayla"})

    assert res.status_code == 200
    assert calls == [
        (
            "all",
            {
                "title": "Update your status",
                "body": "Kayla wants to know what you're up to 👀",
                "url": "/",
                "exclude_user_ids": {"kayla"},
            },
        )
    ]


def test_poke_roommate_sends_targeted_status_update_notification(client, monkeypatch):
    calls = []

    def fake_notify_users(**kwargs):
        calls.append(("users", kwargs))
        return {"sent": 1, "pruned": 0, "failed": 0}

    monkeypatch.setattr(push, "notify_users", fake_notify_users)
    monkeypatch.setattr(push, "is_configured", lambda: True)

    res = client.post(
        "/api/roommates/sheryl/poke",
        json={"requesterId": "andre"},
    )

    assert res.status_code == 200
    assert calls == [
        (
            "users",
            {
                "user_ids": {"sheryl"},
                "title": "Andre poked you 👋",
                "body": "Update your status so they know what you're up to.",
                "url": "/?updateStatus=1",
            },
        )
    ]


def test_poke_roommate_reports_when_notification_cannot_be_delivered(
    client, monkeypatch
):
    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(
        push,
        "notify_users",
        lambda **_kwargs: {"sent": 0, "pruned": 0, "failed": 0},
    )

    res = client.post(
        "/api/roommates/sheryl/poke",
        json={"requesterId": "andre"},
    )

    assert res.status_code == 409
    assert "may not have notifications enabled" in res.get_json()["error"]


def test_poke_roommate_validates_participants(client, monkeypatch):
    monkeypatch.setattr(push, "is_configured", lambda: True)

    missing_requester = client.post("/api/roommates/sheryl/poke", json={})
    unknown_target = client.post(
        "/api/roommates/ghost/poke",
        json={"requesterId": "andre"},
    )
    self_poke = client.post(
        "/api/roommates/andre/poke",
        json={"requesterId": "andre"},
    )

    assert missing_requester.status_code == 400
    assert unknown_target.status_code == 400
    assert self_poke.status_code == 400


def test_poke_roommate_requires_push_configuration(client):
    res = client.post(
        "/api/roommates/sheryl/poke",
        json={"requesterId": "andre"},
    )

    assert res.status_code == 503


def test_push_targets_selected_users_and_excludes_actor(client, monkeypatch):
    sent_endpoints = []

    def fake_webpush(**kwargs):
        sent_endpoints.append(kwargs["subscription_info"]["endpoint"])

    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(push, "webpush", fake_webpush)
    for user_id in ("andre", "kayla", "ting"):
        push.save_subscription({"endpoint": f"https://push/{user_id}", "keys": {}}, user_id)

    result = push.notify_users(
        {"andre", "kayla"},
        title="Event update",
        body="Changed",
        exclude_user_ids={"kayla"},
    )

    assert result == {"sent": 1, "pruned": 0, "failed": 0}
    assert sent_endpoints == ["https://push/andre"]


def test_user_triggered_broadcast_skips_actor_and_unowned_legacy_subscription(
    client, monkeypatch
):
    sent_endpoints = []

    def fake_webpush(**kwargs):
        sent_endpoints.append(kwargs["subscription_info"]["endpoint"])

    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(push, "webpush", fake_webpush)
    push.save_subscription({"endpoint": "https://push/andre", "keys": {}}, "andre")
    push.save_subscription({"endpoint": "https://push/kayla", "keys": {}}, "kayla")
    legacy = {"endpoint": "https://push/legacy", "keys": {}}
    push._get_table().put_item(
        Item={
            "id": push._endpoint_id(legacy["endpoint"]),
            "subscription": json.dumps(legacy),
        }
    )

    push.notify_all(
        title="Household update",
        body="Changed",
        exclude_user_ids={"andre"},
    )

    assert sent_endpoints == ["https://push/kayla"]


def test_push_test_unconfigured(client):
    res = client.post("/api/push/test")
    assert res.status_code == 503


def test_vapid_private_key_loads_through_pywebpush():
    """gen_vapid's private key must load via pywebpush's own code path.

    Regression guard: webpush() loads the key with Vapid.from_string(), which
    expects the base64url raw scalar — not a PEM. This is exactly the call that
    crashed when push.py handed it a PEM.
    """
    from py_vapid import Vapid01

    import gen_vapid

    public_key, private_key = gen_vapid.generate()
    vapid = Vapid01.from_string(private_key=private_key)  # must not raise

    # The loaded key's public point must match the generated public key, or the
    # browser's subscription (bound to that public key) would reject our pushes.
    from cryptography.hazmat.primitives import serialization

    loaded_public = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    assert _b64url(loaded_public) == public_key
    # And it can actually sign a VAPID header.
    assert "Authorization" in vapid.sign({"aud": "https://example.com", "sub": "mailto:x@y.z"})


def _b64url(raw: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# --- Proposed activities ----------------------------------------------------
def _propose(client, text: str, creator_id: str = "andre"):
    """Create an activity through the public API with a real roommate owner."""
    return client.post(
        "/api/activities",
        json={"text": text, "proposedById": creator_id},
    )


def test_propose_activity_creates_and_returns_list(client):
    res = _propose(client, "  Taco night  ")
    assert res.status_code == 200
    data = res.get_json()
    assert data[0]["text"] == "Taco night"  # trimmed
    assert data[0]["proposedBy"] == "Andre"
    assert data[0]["proposedById"] == "andre"
    assert data[0]["memberIds"] == ["andre"]
    assert isinstance(data[0]["createdAt"], int)
    assert data[0]["isLive"] is False
    assert data[0]["liveStartedAt"] is None
    # The proposer is auto-joined, so membership starts at exactly them.
    assert data[0]["members"] == ["Andre"]


def test_propose_activity_uses_canonical_creator_name(client):
    res = client.post(
        "/api/activities",
        json={"text": "Dinner", "proposedById": "kayla", "proposedBy": "Fake Name"},
    )
    assert res.status_code == 200
    activity = res.get_json()[0]
    assert activity["proposedById"] == "kayla"
    assert activity["proposedBy"] == "Kayla"


def test_join_and_leave_activity(client):
    created = _propose(client, "Board games").get_json()
    activity_id = created[0]["id"]

    joined = client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})
    assert joined.status_code == 200
    assert sorted(joined.get_json()[0]["members"]) == ["Andre", "Kayla"]
    assert sorted(joined.get_json()[0]["memberIds"]) == ["andre", "kayla"]

    # Joining again is idempotent — no duplicate member.
    again = client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})
    assert sorted(again.get_json()[0]["members"]) == ["Andre", "Kayla"]

    left = client.post(f"/api/activities/{activity_id}/leave", json={"userId": "kayla"})
    assert left.status_code == 200
    assert left.get_json()[0]["members"] == ["Andre"]
    assert left.get_json()[0]["memberIds"] == ["andre"]


def test_legacy_activity_without_members_keeps_proposer(client):
    # Simulate an item written before the members attribute existed: it has no
    # `members` set at all. Reads should still credit the proposer, and joining
    # must not drop them.
    table = activities._get_table()
    table.put_item(
        Item={"id": "legacy", "text": "Old plan", "proposedBy": "Isabella", "createdAt": 1}
    )

    feed = client.get("/api/activities").get_json()
    assert feed[0]["members"] == ["Isabella"]

    joined = client.post("/api/activities/legacy/join", json={"userId": "kayla"})
    assert sorted(joined.get_json()[0]["members"]) == ["Isabella", "Kayla"]
    assert joined.get_json()[0]["memberIds"] == ["kayla"]


def test_comment_on_activity(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    # A fresh activity has an empty comments list in the projected shape.
    assert created[0]["comments"] == []

    posted = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "  I'm in!  "},
    )
    assert posted.status_code == 200
    comments = posted.get_json()[0]["comments"]
    assert len(comments) == 1
    assert comments[0]["author"] == "Kayla"
    assert comments[0]["text"] == "I'm in!"  # trimmed
    assert isinstance(comments[0]["createdAt"], int)
    assert comments[0]["mentions"] == []
    assert comments[0]["authorId"] == "kayla"
    assert comments[0]["id"]
    assert comments[0]["likeCount"] == 0
    assert comments[0]["likedByIds"] == []


def test_resolve_mentions_prefers_longest_overlapping_name():
    roommates = [
        {"id": "ann", "name": "Ann"},
        {"id": "ann-marie", "name": "Ann Marie"},
    ]

    assert resolve_mentions("@Ann Marie is here", roommates, "someone-else") == [
        {"id": "ann-marie", "name": "Ann Marie"}
    ]


def test_mentions_all_requires_a_complete_token():
    assert mentions_all("@all please")
    assert mentions_all("Heads up, @ALL!")
    assert not mentions_all("person@example.com")
    assert not mentions_all("@alligator")
    assert not mentions_all("@@all")


def test_comments_return_latest_100_without_capping_storage(client):
    created = _propose(client, "Hike").get_json()
    activity_id = created[0]["id"]

    for i in range(105):
        activities.add_comment(activity_id, "Andre", f"msg {i}")

    feed = client.get("/api/activities").get_json()
    comments = feed[0]["comments"]
    assert [c["text"] for c in comments] == [f"msg {i}" for i in range(5, 105)]

    stored = activities._get_table().get_item(Key={"id": activity_id})["Item"]
    assert len(stored["comments"]) == 105


def test_comment_like_and_unlike_are_idempotent(client):
    created = _propose(client, "Hike").get_json()
    activity_id = created[0]["id"]
    posted = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "Bring water"},
    ).get_json()
    comment_id = posted[0]["comments"][0]["id"]
    url = f"/api/activities/{activity_id}/comments/{comment_id}/likes"

    liked = client.put(url, json={"userId": "andre"})
    liked_again = client.put(url, json={"userId": "andre"})
    assert liked.status_code == 200
    assert liked_again.status_code == 200
    comment = liked_again.get_json()[0]["comments"][0]
    assert comment["likeCount"] == 1
    assert comment["likedByIds"] == ["andre"]

    unliked = client.delete(url, json={"userId": "andre"})
    unliked_again = client.delete(url, json={"userId": "andre"})
    assert unliked.status_code == 200
    assert unliked_again.status_code == 200
    comment = unliked_again.get_json()[0]["comments"][0]
    assert comment["likeCount"] == 0
    assert comment["likedByIds"] == []


def test_comment_likes_support_multiple_users(client):
    created = _propose(client, "Hike").get_json()
    activity_id = created[0]["id"]
    posted = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "Bring water"},
    ).get_json()
    comment_id = posted[0]["comments"][0]["id"]
    url = f"/api/activities/{activity_id}/comments/{comment_id}/likes"

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(
            pool.map(
                lambda user_id: activities.set_comment_like(
                    activity_id,
                    comment_id,
                    user_id,
                    user_id.title(),
                    True,
                ),
                ("andre", "sheryl", "ting"),
            )
        )

    assert results == [activities.LIKE_OK] * 3
    comment = client.get("/api/activities").get_json()[0]["comments"][0]
    assert comment["likeCount"] == 3
    assert comment["likedByIds"] == ["andre", "sheryl", "ting"]


def test_comment_like_rejects_self_invalid_and_unknown_targets(client):
    created = _propose(client, "Hike").get_json()
    activity_id = created[0]["id"]
    posted = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "Bring water"},
    ).get_json()
    comment_id = posted[0]["comments"][0]["id"]
    url = f"/api/activities/{activity_id}/comments/{comment_id}/likes"

    assert client.put(url, json={"userId": "kayla"}).status_code == 403
    assert client.put(url, json={"userId": "ghost"}).status_code == 400
    assert client.put(
        f"/api/activities/{activity_id}/comments/nope/likes",
        json={"userId": "andre"},
    ).status_code == 404
    assert client.put(
        f"/api/activities/nope/comments/{comment_id}/likes",
        json={"userId": "andre"},
    ).status_code == 404


def test_legacy_comment_has_stable_id_and_can_be_liked(client):
    activities._get_table().put_item(
        Item={
            "id": "legacy-like",
            "text": "Old event",
            "proposedBy": "Andre",
            "proposedById": "andre",
            "createdAt": 1,
            "comments": [{"author": "Kayla", "text": "hello", "createdAt": 2}],
        }
    )

    first = client.get("/api/activities").get_json()[0]["comments"][0]
    second = client.get("/api/activities").get_json()[0]["comments"][0]
    assert first["id"] == second["id"]
    assert first["authorId"] is None

    url = f"/api/activities/legacy-like/comments/{first['id']}/likes"
    assert client.put(url, json={"userId": "andre"}).status_code == 200
    assert client.put(url, json={"userId": "kayla"}).status_code == 403
    liked = client.get("/api/activities").get_json()[0]["comments"][0]
    assert liked["likeCount"] == 1
    assert liked["likedByIds"] == ["andre"]


def test_comment_requires_text_and_author(client):
    created = _propose(client, "Bowling").get_json()
    activity_id = created[0]["id"]
    assert (
        client.post(
            f"/api/activities/{activity_id}/comments",
            json={"authorId": "andre", "text": "  "},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/activities/{activity_id}/comments",
            json={"authorId": "  ", "text": "hi"},
        ).status_code
        == 400
    )


def test_comment_unknown_activity_404(client):
    res = client.post(
        "/api/activities/nope/comments", json={"authorId": "andre", "text": "hi"}
    )
    assert res.status_code == 404


def _capture_notifications(monkeypatch):
    """Replace push send functions with recorders; return audience + kwargs.

    This verifies route-level recipient selection without requiring VAPID keys.
    """
    calls = []

    def fake_notify_all(**kwargs):
        calls.append(("all", kwargs))
        return {"sent": 0, "pruned": 0, "failed": 0}

    def fake_notify_users(**kwargs):
        calls.append(("users", kwargs))
        return {"sent": 0, "pruned": 0, "failed": 0}

    monkeypatch.setattr(push, "notify_all", fake_notify_all)
    monkeypatch.setattr(push, "notify_users", fake_notify_users)
    return calls


def test_new_activity_notifies_household_except_creator(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)

    res = _propose(client, "Picnic")

    assert res.status_code == 200
    assert calls == [
        (
            "all",
            {
                "title": "New activity proposed 🎉",
                "body": "Andre: Picnic",
                "url": "/",
                "exclude_user_ids": {"andre"},
            },
        )
    ]


def test_creator_can_start_end_and_restart_event(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()[0]
    calls = _capture_notifications(monkeypatch)

    started = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    assert started.status_code == 200
    live = next(item for item in started.get_json() if item["id"] == created["id"])
    assert live["isLive"] is True
    assert isinstance(live["liveStartedAt"], int)
    assert calls[-1] == (
        "all",
        {
            "title": "Event started 🔴",
            "body": "Andre started Dinner",
            "url": "/",
            "event_type": "activities-changed",
            "exclude_user_ids": {"andre"},
        },
    )

    ended = client.post(
        f"/api/activities/{created['id']}/end",
        json={"requesterId": "andre"},
    )
    assert ended.status_code == 200
    proposed = next(item for item in ended.get_json() if item["id"] == created["id"])
    assert proposed["isLive"] is False
    assert proposed["liveStartedAt"] is None
    assert calls[-1] == (
        "all",
        {
            "title": "Event ended 🏁",
            "body": "Andre ended Dinner",
            "url": "/",
            "event_type": "activities-changed",
            "exclude_user_ids": {"andre"},
        },
    )

    restarted = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    assert restarted.status_code == 200
    assert restarted.get_json()[0]["isLive"] is True


def test_only_creator_can_change_live_status(client):
    created = _propose(client, "Dinner").get_json()[0]

    denied_start = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "kayla"},
    )
    assert denied_start.status_code == 403

    client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    denied_end = client.post(
        f"/api/activities/{created['id']}/end",
        json={"requesterId": "kayla"},
    )
    assert denied_end.status_code == 403


def test_live_event_push_reaches_non_participant_subscriptions(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()[0]
    sent = []

    def fake_webpush(**kwargs):
        sent.append(
            (
                kwargs["subscription_info"]["endpoint"],
                json.loads(kwargs["data"]),
            )
        )

    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(push, "webpush", fake_webpush)
    for user_id in ("andre", "sheryl", "kayla", "ting"):
        push.save_subscription(
            {"endpoint": f"https://push/{user_id}", "keys": {}},
            user_id,
        )

    response = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )

    assert response.status_code == 200
    assert {endpoint for endpoint, _payload in sent} == {
        "https://push/sheryl",
        "https://push/kayla",
        "https://push/ting",
    }
    assert all(
        payload["eventType"] == "activities-changed"
        for _endpoint, payload in sent
    )


def test_live_transition_conflicts_and_missing_event(client):
    first = _propose(client, "Dinner", creator_id="andre").get_json()[0]
    second = _propose(client, "Movie", creator_id="kayla").get_json()[0]

    assert (
        client.post(
            f"/api/activities/{first['id']}/start",
            json={"requesterId": "andre"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/activities/{first['id']}/start",
            json={"requesterId": "andre"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/activities/{second['id']}/start",
            json={"requesterId": "kayla"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/activities/{second['id']}/end",
            json={"requesterId": "kayla"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/activities/nope/start",
            json={"requesterId": "andre"},
        ).status_code
        == 404
    )


def test_concurrent_starts_produce_one_live_event(client):
    first = _propose(client, "Dinner", creator_id="andre").get_json()[0]
    second = _propose(client, "Movie", creator_id="kayla").get_json()[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda args: activities.start_owned(*args),
                [(first["id"], "andre"), (second["id"], "kayla")],
            )
        )

    assert sorted(results) == sorted([activities.LIVE_OK, activities.LIVE_CONFLICT])
    feed = activities.list_recent(consistent=True)
    assert sum(item["isLive"] for item in feed) == 1


def test_live_event_cannot_be_deleted(client):
    created = _propose(client, "Dinner").get_json()[0]
    client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )

    deleted = client.delete(
        f"/api/activities/{created['id']}",
        json={"requesterId": "andre"},
    )
    assert deleted.status_code == 409
    assert activities.get(created["id"])["isLive"] is True


def test_live_transition_survives_push_failure(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()[0]

    def fail_push(**_kwargs):
        raise RuntimeError("push unavailable")

    monkeypatch.setattr(push, "notify_all", fail_push)
    started = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )

    assert started.status_code == 200
    assert activities.get(created["id"], consistent=True)["isLive"] is True


def test_older_live_event_remains_in_capped_feed(client):
    table = activities._get_table()
    for i in range(6):
        table.put_item(
            Item={
                "id": f"owned-{i}",
                "text": f"activity {i}",
                "proposedBy": "Andre",
                "proposedById": "andre",
                "createdAt": 1000 + i,
            }
        )

    assert activities.start_owned("owned-0", "andre") == activities.LIVE_OK
    feed = activities.list_recent(consistent=True)
    assert len(feed) == activities.RECENT_LIMIT
    assert any(item["id"] == "owned-0" and item["isLive"] for item in feed)


def test_status_notification_excludes_roommate_who_triggered_it(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    client.put("/api/roommates/andre/status", json={"status": "available"})
    client.put("/api/roommates/sheryl/status", json={"status": "available"})
    client.put("/api/roommates/kayla/status", json={"status": "available"})

    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "all"
    assert kwargs["exclude_user_ids"] == {"kayla"}


def test_join_notifies_only_existing_participants_and_excludes_joiner(client, monkeypatch):
    created = _propose(client, "Picnic").get_json()
    activity_id = created[0]["id"]

    calls = _capture_notifications(monkeypatch)
    res = client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})
    assert res.status_code == 200
    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "users"
    assert kwargs["user_ids"] == {"andre", "kayla"}
    assert kwargs["exclude_user_ids"] == {"kayla"}
    assert "Kayla" in kwargs["body"] and "Picnic" in kwargs["body"]


def test_leave_does_not_notify(client, monkeypatch):
    created = _propose(client, "Picnic").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})

    calls = _capture_notifications(monkeypatch)
    res = client.post(f"/api/activities/{activity_id}/leave", json={"userId": "kayla"})
    assert res.status_code == 200
    assert calls == []  # leaving is intentionally quiet


def test_comment_notifies_unmentioned_participants(client, monkeypatch):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})

    calls = _capture_notifications(monkeypatch)
    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "Count me in"},
    )
    assert res.status_code == 200
    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "users"
    assert kwargs["user_ids"] == {"andre"}
    body = kwargs["body"]
    assert "Kayla" in body and "Count me in" in body and "Movie night" in body


def test_mentions_notify_household_members_and_store_canonical_metadata(
    client, monkeypatch
):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    calls = _capture_notifications(monkeypatch)

    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={
            "authorId": "kayla",
            "text": "@sheryl, can you ask @Ting? @SHERYL",
        },
    )

    assert res.status_code == 200
    comment = res.get_json()[0]["comments"][0]
    assert comment["mentions"] == [
        {"id": "sheryl", "name": "Sheryl"},
        {"id": "ting", "name": "Ting"},
    ]
    assert len(calls) == 2
    mention_call, participant_call = calls
    assert mention_call == (
        "users",
        {
            "user_ids": {"sheryl", "ting"},
            "title": "Kayla mentioned you",
            "body": "On “Movie night”: @sheryl, can you ask @Ting? @SHERYL",
            "url": "/",
        },
    )
    assert participant_call[0] == "users"
    assert participant_call[1]["user_ids"] == {"andre"}
    assert participant_call[1]["title"] == "New comment 💬"


def test_all_mention_notifies_household_once_and_excludes_author(client, monkeypatch):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "sheryl"})
    calls = _capture_notifications(monkeypatch)

    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={
            "authorId": "kayla",
            "text": "@ALL please join us, especially @Sheryl",
        },
    )

    assert res.status_code == 200
    comment = res.get_json()[0]["comments"][0]
    assert comment["mentionsAll"] is True
    assert comment["mentions"] == [{"id": "sheryl", "name": "Sheryl"}]
    assert calls == [
        (
            "all",
            {
                "title": "Kayla mentioned everyone",
                "body": "On “Movie night”: @ALL please join us, especially @Sheryl",
                "url": "/",
                "exclude_user_ids": {"kayla"},
            },
        )
    ]


def test_mentioned_non_participant_subscription_receives_push(client, monkeypatch):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    sent = []

    def fake_webpush(**kwargs):
        sent.append(
            (
                kwargs["subscription_info"]["endpoint"],
                json.loads(kwargs["data"]),
            )
        )

    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(push, "webpush", fake_webpush)
    for user_id in ("andre", "sheryl", "kayla"):
        push.save_subscription(
            {"endpoint": f"https://push/{user_id}", "keys": {}},
            user_id,
        )

    response = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "@Sheryl can you join us?"},
    )

    assert response.status_code == 200
    sent_by_endpoint = {endpoint: payload for endpoint, payload in sent}
    assert set(sent_by_endpoint) == {
        "https://push/andre",
        "https://push/sheryl",
    }
    assert sent_by_endpoint["https://push/sheryl"]["title"] == "Kayla mentioned you"
    assert sent_by_endpoint["https://push/andre"]["title"] == "New comment 💬"


def test_mentioned_participant_gets_only_mention_push(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "sheryl"})
    calls = _capture_notifications(monkeypatch)

    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "@Andre are you bringing drinks?"},
    )

    assert res.status_code == 200
    assert len(calls) == 2
    assert calls[0][1]["user_ids"] == {"andre"}
    assert calls[0][1]["title"] == "Kayla mentioned you"
    assert calls[1][1]["user_ids"] == {"sheryl"}
    assert calls[1][1]["title"] == "New comment 💬"


def test_mention_push_failure_does_not_skip_participant_push(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "sheryl"})
    calls = []

    def fail_first_push(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise RuntimeError("mention push unavailable")
        return {"sent": 0, "pruned": 0, "failed": 0}

    monkeypatch.setattr(push, "notify_users", fail_first_push)
    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "@Andre heads up"},
    )

    assert res.status_code == 200
    assert len(calls) == 2
    assert calls[0]["user_ids"] == {"andre"}
    assert calls[1]["user_ids"] == {"sheryl"}


def test_self_invalid_and_email_like_mentions_do_not_notify(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()
    activity_id = created[0]["id"]
    calls = _capture_notifications(monkeypatch)

    res = client.post(
        f"/api/activities/{activity_id}/comments",
        json={
            "authorId": "kayla",
            "text": "@Kayla @Ghost andre@example.com @Shery",
        },
    )

    assert res.status_code == 200
    assert res.get_json()[0]["comments"][0]["mentions"] == []
    assert len(calls) == 1
    assert calls[0][1]["user_ids"] == {"andre"}
    assert calls[0][1]["title"] == "New comment 💬"


def test_legacy_comment_projects_empty_mentions(client):
    activities._get_table().put_item(
        Item={
            "id": "legacy-comment",
            "text": "Old event",
            "proposedBy": "Andre",
            "proposedById": "andre",
            "createdAt": 1,
            "comments": [{"author": "Kayla", "text": "hello", "createdAt": 2}],
        }
    )

    comment = client.get("/api/activities").get_json()[0]["comments"][0]
    assert comment["mentions"] == []
    assert comment["mentionsAll"] is False


def test_join_requires_valid_roommate(client):
    created = _propose(client, "Hike").get_json()
    missing = client.post(f"/api/activities/{created[0]['id']}/join", json={})
    unknown = client.post(
        f"/api/activities/{created[0]['id']}/join",
        json={"userId": "ghost"},
    )
    assert missing.status_code == 400
    assert unknown.status_code == 400


def test_join_unknown_activity_404(client):
    res = client.post("/api/activities/nope/join", json={"userId": "andre"})
    assert res.status_code == 404


def test_propose_activity_rejects_empty(client):
    res = _propose(client, "   ")
    assert res.status_code == 400


def test_propose_activity_rejects_too_long(client):
    res = _propose(client, "x" * 281)
    assert res.status_code == 400


def test_propose_activity_requires_valid_creator(client):
    missing = client.post("/api/activities", json={"text": "Dinner"})
    unknown = _propose(client, "Dinner", creator_id="ghost")
    assert missing.status_code == 400
    assert unknown.status_code == 400


def test_creator_can_delete_activity_and_all_embedded_data(client, monkeypatch):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})
    client.post(
        f"/api/activities/{activity_id}/comments",
        json={"authorId": "kayla", "text": "I'm in"},
    )
    comment_id = client.get("/api/activities").get_json()[0]["comments"][0]["id"]
    client.put(
        f"/api/activities/{activity_id}/comments/{comment_id}/likes",
        json={"userId": "andre"},
    )
    calls = _capture_notifications(monkeypatch)

    deleted = client.delete(
        f"/api/activities/{activity_id}",
        json={"requesterId": "andre"},
    )

    assert deleted.status_code == 200
    assert all(item["id"] != activity_id for item in deleted.get_json())
    assert activities._get_table().get_item(Key={"id": activity_id}).get("Item") is None
    assert not any(
        item.get("activityId") == activity_id
        for item in activities._get_table().scan().get("Items", [])
    )
    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "users"
    assert kwargs["user_ids"] == {"andre", "kayla"}
    assert kwargs["exclude_user_ids"] == {"andre"}
    assert kwargs["body"] == "Andre deleted Movie night"


def test_non_creator_cannot_delete_activity(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    denied = client.delete(
        f"/api/activities/{activity_id}",
        json={"requesterId": "kayla"},
    )

    assert denied.status_code == 403
    assert activities.get(activity_id) is not None


def test_legacy_activity_cannot_be_deleted(client):
    activities._get_table().put_item(
        Item={
            "id": "legacy-delete",
            "text": "Old plan",
            "proposedBy": "Andre",
            "createdAt": 1,
        }
    )

    denied = client.delete(
        "/api/activities/legacy-delete",
        json={"requesterId": "andre"},
    )

    assert denied.status_code == 403
    assert activities.get("legacy-delete") is not None


def test_delete_activity_requires_requester(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    res = client.delete(f"/api/activities/{activity_id}", json={})

    assert res.status_code == 400
    assert activities.get(activity_id) is not None


def test_delete_unknown_activity_404(client):
    res = client.delete("/api/activities/nope", json={"requesterId": "andre"})
    assert res.status_code == 404


def test_emphasize_unknown_activity_404(client):
    res = client.post("/api/activities/nope/notify", json={"emphasizedById": "andre"})
    assert res.status_code == 404


def test_activities_recent_newest_first_capped(client):
    # Insert 6 proposals with controlled, increasing timestamps for determinism.
    table = activities._get_table()
    for i in range(6):
        table.put_item(
            Item={"id": f"a{i}", "text": f"activity {i}", "proposedBy": "x", "createdAt": 1000 + i}
        )
    res = client.get("/api/activities")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 5  # capped at RECENT_LIMIT
    # Newest (highest createdAt) first; oldest ("activity 0") dropped.
    assert [d["text"] for d in data] == [f"activity {i}" for i in (5, 4, 3, 2, 1)]


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
