"""Push notification, VAPID, and Spotify Jam API tests."""

from testing.support import *  # noqa: F403

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
    assert any(
        s["endpoint"] == sub["endpoint"]
        for s in push.list_user_subscriptions("andre")
    )
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
                "url": "/?groupId=yorkshire",
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
                "url": "/?updateStatus=1&groupId=yorkshire",
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

    # What app.notify_group does: address the household explicitly, minus the
    # actor. The unowned legacy row has no userId, so UserIdIndex cannot return
    # it for any recipient — it is unreachable rather than filtered.
    push.notify_users(
        user_ids=set(db.get_group_user_ids(TEST_GROUP_ID, consistent=True)),
        title="Household update",
        body="Changed",
        exclude_user_ids={"andre"},
    )

    assert sent_endpoints == ["https://push/kayla"]


def test_share_jam_replaces_active_link_and_notifies(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)

    first = client.post(
        "/api/jam",
        json={"hostId": "andre", "link": "https://spotify.link/first"},
    )
    second = client.post(
        "/api/jam",
        json={"hostId": "kayla", "link": "https://spotify.link/second"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    data = second.get_json()
    assert data == {
        "id": jam._active_jam_id(TEST_GROUP_ID),
        "groupId": TEST_GROUP_ID,
        "link": "https://spotify.link/second",
        "hostId": "kayla",
        "hostName": "Kayla",
        "createdAt": data["createdAt"],
        "updatedAt": data["updatedAt"],
    }
    assert client.get(grouped_path("/api/jam")).get_json()["link"] == "https://spotify.link/second"
    stored = jam._get_table().get_item(Key={"id": jam._active_jam_id(TEST_GROUP_ID)})["Item"]
    assert stored["hostId"] == "kayla"
    assert calls[-1] == (
        "all",
        {
            "title": "Spotify Jam is live",
            "body": "Kayla shared a Jam. Tap to join.",
            "url": "/?module=spotify&item=activeJam%23yorkshire&groupId=yorkshire",
            "event_type": "jam-changed",
            "exclude_user_ids": {"kayla"},
        },
    )


def test_share_jam_validates_link_and_roommate(client):
    missing_user = client.post(
        "/api/jam",
        json={"hostId": "ghost", "link": "https://spotify.link/first"},
    )
    bad_link = client.post(
        "/api/jam",
        json={"hostId": "andre", "link": "https://example.com/not-spotify"},
    )

    assert missing_user.status_code == 400
    assert bad_link.status_code == 400


def test_any_roommate_can_remove_jam(client):
    client.post("/api/jam", json={"hostId": "andre", "link": "https://spotify.link/first"})

    ended = client.delete("/api/jam", json={"hostId": "kayla"})

    assert ended.status_code == 200
    assert ended.get_json() is None


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
