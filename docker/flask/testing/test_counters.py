from testing.support import *


def _create_counter(client, *, mode="automatic", creator="andre", **changes):
    body = {
        "title": "Days since a spill",
        "mode": mode,
        "createdById": creator,
        "occurredAt": 1_700_000_000_000,
        "note": "Starting point",
    }
    if mode == "manual":
        body.pop("occurredAt")
        body["initialValue"] = 2
    body.update(changes)
    response = client.post("/api/counters", json=body)
    assert response.status_code == 200
    return response.get_json()["counter"]


def test_automatic_counter_tracks_days_and_incident_streaks(client, monkeypatch):
    now = 1_700_000_000
    monkeypatch.setattr(household_counters.time, "time", lambda: now)
    counter = _create_counter(
        client,
        occurredAt=(now - 3 * 24 * 60 * 60) * 1000,
    )
    assert counter["currentValue"] == 3

    second_at = (now - 24 * 60 * 60) * 1000
    response = client.post(
        f"/api/counters/{counter['id']}/entries",
        json={"userId": "kayla", "occurredAt": second_at, "note": "Again"},
    )
    assert response.status_code == 200
    assert response.get_json()["counter"]["currentValue"] == 1

    detail = client.get(f"/api/counters/{counter['id']}?userId=andre").get_json()
    assert [entry["note"] for entry in detail["entries"]] == ["Again", "Starting point"]
    assert detail["entries"][1]["daysUntilNext"] == 2


def test_manual_counter_history_can_be_corrected_without_going_negative(client):
    counter = _create_counter(client, mode="manual")
    for delta in (1, 1, -1):
        response = client.post(
            f"/api/counters/{counter['id']}/entries",
            json={"userId": "kayla", "delta": delta},
        )
        assert response.status_code == 200
    assert response.get_json()["counter"]["currentValue"] == 3

    detail = client.get(f"/api/counters/{counter['id']}?userId=andre").get_json()
    newest = detail["entries"][0]
    corrected = client.patch(
        f"/api/counters/{counter['id']}/entries/{newest['id']}",
        json={"userId": "ting", "changes": {"delta": 1, "note": "Correction"}},
    )
    assert corrected.status_code == 200
    assert corrected.get_json()["counter"]["currentValue"] == 5

    for _ in range(5):
        response = client.post(
            f"/api/counters/{counter['id']}/entries",
            json={"userId": "andre", "delta": -1},
        )
        assert response.status_code == 200
    rejected = client.post(
        f"/api/counters/{counter['id']}/entries",
        json={"userId": "andre", "delta": -1},
    )
    assert rejected.status_code == 400


def test_history_permissions_lifecycle_and_creator_owned_delete(client):
    counter = _create_counter(client, mode="manual")
    archived = client.post(
        f"/api/counters/{counter['id']}/archive", json={"userId": "kayla"}
    )
    assert archived.status_code == 200
    assert archived.get_json()["counter"]["isArchived"] is True
    assert client.post(
        f"/api/counters/{counter['id']}/entries",
        json={"userId": "ting", "delta": 1},
    ).status_code == 409
    assert client.delete(
        f"/api/counters/{counter['id']}", json={"userId": "kayla"}
    ).status_code == 403
    assert client.post(
        f"/api/counters/{counter['id']}/restore", json={"userId": "ting"}
    ).status_code == 200
    assert client.delete(
        f"/api/counters/{counter['id']}", json={"userId": "andre"}
    ).status_code == 200
    assert client.get(
        f"/api/counters/{counter['id']}?userId=andre"
    ).status_code == 404


def test_counters_join_the_feed_and_remain_opt_in(client):
    counter = _create_counter(client, mode="manual")
    feed = client.get("/api/feed?userId=andre&type=counters")
    assert feed.status_code == 200
    assert feed.get_json()[0]["id"] == counter["id"]
    assert feed.get_json()[0]["type"] == "counters"
    assert "counters" in groups.GROUP_MODULE_IDS

    created = groups.create_group("andre", "Counter-free group")[1]
    assert created["enabledModules"] == []


def test_counter_history_is_paginated(client):
    counter = _create_counter(client, mode="manual", initialValue=0)
    for _ in range(22):
        client.post(
            f"/api/counters/{counter['id']}/entries",
            json={"userId": "andre", "delta": 1},
        )
    first = client.get(f"/api/counters/{counter['id']}?userId=andre").get_json()
    assert len(first["entries"]) == 20
    assert first["nextCursor"]
    second = client.get(
        f"/api/counters/{counter['id']}?userId=andre&cursor={first['nextCursor']}"
    ).get_json()
    assert len(second["entries"]) == 3
    assert second["nextCursor"] is None


def test_counter_notifications_and_display_name_history(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    counter = _create_counter(client, mode="manual")
    assert calls[0][1]["title"] == "Counter created"

    added = client.post(
        f"/api/counters/{counter['id']}/entries",
        json={"userId": "kayla", "delta": 1},
    )
    assert added.status_code == 200
    assert len(calls) == 1  # Routine manual adjustments stay quiet.

    entry = client.get(
        f"/api/counters/{counter['id']}?userId=andre"
    ).get_json()["entries"][0]
    edited = client.patch(
        f"/api/counters/{counter['id']}/entries/{entry['id']}",
        json={"userId": "kayla", "changes": {"note": "Corrected"}},
    )
    assert edited.status_code == 200

    renamed = client.patch(
        "/api/accounts/kayla",
        json={"name": "Juniper", "currentPassword": "roomie"},
    )
    assert renamed.status_code == 200
    detail = client.get(
        f"/api/counters/{counter['id']}?userId=andre"
    ).get_json()
    assert detail["entries"][0]["createdBy"] == "Juniper"
    assert detail["entries"][0]["editedBy"] == "Juniper"
