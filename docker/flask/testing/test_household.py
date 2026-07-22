"""Household roster, status, and health API tests."""

from testing.support import *  # noqa: F403


def test_get_roommates(client):
    res = client.get(grouped_path("/api/roommates"))
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 5
    # Shape the frontend relies on.
    assert set(data[0]) == {"id", "name", "status", "statusText", "statusUpdatedAt", "role"}
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
    # Status saves now also read the activities feed to suppress gather pushes
    # for live/just-finished participants, so each request consumes one time
    # value for the save and one for the activity overlay projection.
    times = iter([
        1_750_000_000.123,
        1_750_000_000.123,
        1_750_000_060.456,
        1_750_000_060.456,
    ])
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


def test_gather_push_ignores_live_activity_participants(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    client.put("/api/roommates/sheryl/status", json={"status": "available", "statusText": ""})
    client.put("/api/roommates/kayla/status", json={"status": "available", "statusText": ""})

    created = _propose(client, "Dinner").get_json()[0]
    client.post(f"/api/activities/{created['id']}/start", json={"requesterId": "andre"})
    calls.clear()

    updated = client.put(
        "/api/roommates/andre/status",
        json={"status": "available", "statusText": ""},
    )

    assert updated.status_code == 200
    assert calls == []


def test_scheduled_activity_does_not_create_a_finished_status_override(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(
        client,
        "Future dinner",
        start_at=1_001_000,
        end_at=1_002_000,
    ).get_json()[0]

    assert created["isLive"] is False
    assert created["isExpired"] is False
    assert _activity_status_overrides(TEST_GROUP_ID, consistent=True) == {}


def test_gather_push_counts_participants_again_once_their_activity_ends(client, monkeypatch):
    """A live activity suppresses its participants; ending it releases them.

    Ending used to leave a lingering "finished an activity" status that kept
    suppressing a participant until they saved a fresh one. That concept was
    removed from the product (the frontend's STATUS.ACTIVITY_ENDED went with
    it), so an ended activity now stops mattering the moment it ends.
    """
    calls = _capture_notifications(monkeypatch)
    client.put("/api/roommates/andre/status", json={"status": "available", "statusText": ""})
    client.put("/api/roommates/kayla/status", json={"status": "available", "statusText": ""})
    client.put("/api/roommates/ting/status", json={"status": "available", "statusText": ""})

    created = _propose(client, "Dinner").get_json()[0]
    client.post(f"/api/activities/{created['id']}/start", json={"requesterId": "andre"})
    calls.clear()

    # andre is in the live activity, so only two roomies really count as free.
    suppressed = client.put(
        "/api/roommates/kayla/status",
        json={"status": "available", "statusText": "Still free"},
    )
    assert suppressed.status_code == 200
    assert calls == []

    client.post(f"/api/activities/{created['id']}/end", json={"requesterId": "andre"})
    calls.clear()  # the end transition pushes its own household notification

    # andre needs no new status of their own: ending the activity is enough.
    resumed = client.put(
        "/api/roommates/kayla/status",
        json={"status": "available", "statusText": "Still free"},
    )
    assert resumed.status_code == 200
    assert calls == [
        (
            "all",
            {
                "title": "Roomies are free!",
                "body": "3 roomies are free! LETS HANG 🎉!",
                "url": "/?groupId=yorkshire",
                "exclude_user_ids": {"kayla"},
            },
        )
    ]


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


# --- Web Push (PoC) ---------------------------------------------------------
# VAPID keys are not set in the test env, so push is "not configured": the
