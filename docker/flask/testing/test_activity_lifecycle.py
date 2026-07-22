"""Activity lifecycle, schedule, and feed tests."""

from testing.support import *  # noqa: F403


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
                "url": f"/?module=events&item={res.get_json()[0]['id']}&groupId=yorkshire",
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
            "url": f"/?module=events&item={created['id']}&groupId=yorkshire",
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
            "url": f"/?module=events&item={created['id']}&groupId=yorkshire",
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
        == 200
    )
    assert (
        client.post(
            f"/api/activities/{second['id']}/end",
            json={"requesterId": "kayla"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/activities/nope/start",
            json={"requesterId": "andre"},
        ).status_code
        == 404
    )


def test_concurrent_starts_allow_multiple_live_events(client):
    first = _propose(client, "Dinner", creator_id="andre").get_json()[0]
    second = _propose(client, "Movie", creator_id="kayla").get_json()[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda args: activities.start_owned(*args, TEST_GROUP_ID),
                [(first["id"], "andre"), (second["id"], "kayla")],
            )
        )

    assert results == [activities.LIVE_OK, activities.LIVE_OK]
    feed = activities.list_recent(TEST_GROUP_ID, consistent=True)
    assert sum(item["isLive"] for item in feed) == 2


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
    assert activities.get(created["id"], TEST_GROUP_ID)["isLive"] is True


def test_live_transition_survives_push_failure(client, monkeypatch):
    created = _propose(client, "Dinner").get_json()[0]

    def fail_push(**_kwargs):
        raise RuntimeError("push unavailable")

    monkeypatch.setattr(push, "notify_users", fail_push)
    started = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )

    assert started.status_code == 200
    assert activities.get(created["id"], TEST_GROUP_ID, consistent=True)["isLive"] is True


def test_activity_feed_is_not_capped(client):
    table = activities._get_table()
    for i in range(6):
        table.put_item(
            Item={
                "id": f"owned-{i}",
                "groupId": TEST_GROUP_ID,
                "text": f"activity {i}",
                "proposedBy": "Andre",
                "proposedById": "andre",
                "createdAt": 1000 + i,
            }
        )

    assert activities.start_owned("owned-0", "andre", TEST_GROUP_ID) == activities.LIVE_OK
    feed = activities.list_recent(TEST_GROUP_ID, consistent=True)
    assert len(feed) == 6
    assert any(item["id"] == "owned-0" and item["isLive"] for item in feed)


def test_scheduled_activity_automatically_starts_and_expires(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(
        client,
        "Scheduled dinner",
        start_at=1_001_000,
        end_at=1_002_000,
    ).get_json()[0]
    assert created["isLive"] is False
    assert created["isExpired"] is False

    monkeypatch.setattr(activities.time, "time", lambda: 1_001.5)
    live = activities.get(created["id"], TEST_GROUP_ID, consistent=True)
    assert live["isLive"] is True
    assert live["liveStartedAt"] == 1_001_000

    monkeypatch.setattr(activities.time, "time", lambda: 1_002)
    expired = activities.get(created["id"], TEST_GROUP_ID, consistent=True)
    assert expired["isLive"] is False
    assert expired["isExpired"] is True


def test_activity_schedule_validation(client):
    assert _propose(client, "Dinner", end_at=2_000).status_code == 400
    assert _propose(
        client,
        "Dinner",
        start_at=2_000,
        end_at=2_000,
    ).status_code == 400
    invalid_type = client.post(
        "/api/activities",
        json={"text": "Dinner", "proposedById": "andre", "startAt": "tomorrow"},
    )
    assert invalid_type.status_code == 400


def test_owner_can_edit_only_pending_schedule(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(client, "Dinner", start_at=2_000_000).get_json()[0]
    url = f"/api/modules/events/{created['id']}"

    denied = client.patch(
        url,
        json={
            "editorId": "kayla",
            "changes": {"startAt": 3_000_000, "endAt": None},
        },
    )
    assert denied.status_code == 403

    updated = client.patch(
        url,
        json={
            "editorId": "andre",
            "changes": {"startAt": 3_000_000, "endAt": 4_000_000},
        },
    )
    assert updated.status_code == 200
    item = updated.get_json()["module"]["payload"]
    assert item["startAt"] == 3_000_000
    assert item["endAt"] == 4_000_000

    monkeypatch.setattr(activities.time, "time", lambda: 3_500)
    conflict = client.patch(
        url,
        json={"editorId": "andre", "changes": {"startAt": None, "endAt": None}},
    )
    assert conflict.status_code == 409

    live_text_edit = client.patch(
        url,
        json={"editorId": "andre", "changes": {"text": "Dinner is live"}},
    )
    assert live_text_edit.status_code == 200
    assert live_text_edit.get_json()["module"]["payload"]["text"] == "Dinner is live"

    monkeypatch.setattr(activities.time, "time", lambda: 4_500)
    expired_text_edit = client.patch(
        url,
        json={"editorId": "andre", "changes": {"text": "Too late"}},
    )
    assert expired_text_edit.status_code == 409


def test_early_start_retains_future_end_and_manual_end_is_terminal(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(
        client,
        "Dinner",
        start_at=2_000_000,
        end_at=3_000_000,
    ).get_json()[0]

    started = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    live = next(entry for entry in started.get_json() if entry["id"] == created["id"])
    assert live["startAt"] == 1_000_000
    assert live["endAt"] == 3_000_000
    assert live["isLive"] is True

    ended = client.post(
        f"/api/activities/{created['id']}/end",
        json={"requesterId": "andre"},
    )
    expired = next(entry for entry in ended.get_json() if entry["id"] == created["id"])
    assert expired["isExpired"] is True
    assert expired["endedAt"] == 1_000_000


def test_expired_activity_is_read_only_but_owner_can_restart_or_delete(
    client,
    monkeypatch,
):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(client, "Dinner").get_json()[0]
    client.post(
        f"/api/activities/{created['id']}/comments",
        json={"authorId": "kayla", "text": "Before it ended"},
    )
    client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    client.post(
        f"/api/activities/{created['id']}/end",
        json={"requesterId": "andre"},
    )
    comment_id = activities.get(created["id"], TEST_GROUP_ID)["comments"][0]["id"]

    assert client.post(
        f"/api/activities/{created['id']}/join",
        json={"userId": "kayla"},
    ).status_code == 409
    assert client.post(
        f"/api/activities/{created['id']}/comments",
        json={"authorId": "kayla", "text": "Too late"},
    ).status_code == 409
    assert client.put(
        f"/api/activities/{created['id']}/comments/{comment_id}/likes",
        json={"userId": "andre"},
    ).status_code == 409
    monkeypatch.setattr(push, "is_configured", lambda: True)
    assert client.post(
        f"/api/activities/{created['id']}/notify",
        json={"emphasizedById": "kayla"},
    ).status_code == 409

    monkeypatch.setattr(activities.time, "time", lambda: 1_100)
    restarted = client.post(
        f"/api/activities/{created['id']}/start",
        json={"requesterId": "andre"},
    )
    live = next(entry for entry in restarted.get_json() if entry["id"] == created["id"])
    assert live["isLive"] is True
    assert live["startAt"] == 1_100_000
    assert live["endAt"] is None
    assert live["endedAt"] is None

    client.post(
        f"/api/activities/{created['id']}/end",
        json={"requesterId": "andre"},
    )
    assert client.delete(
        f"/api/activities/{created['id']}",
        json={"requesterId": "andre"},
    ).status_code == 200


def test_activity_sorting(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 10)
    table = activities._get_table()
    for item in (
        {"id": "unscheduled-old", "groupId": TEST_GROUP_ID, "text": "U1", "proposedBy": "A", "createdAt": 1},
        {"id": "unscheduled-new", "groupId": TEST_GROUP_ID, "text": "U2", "proposedBy": "A", "createdAt": 2},
        {
            "id": "scheduled-later",
            "groupId": TEST_GROUP_ID,
            "text": "S2",
            "proposedBy": "A",
            "createdAt": 4,
            "startAt": 30_000,
        },
        {
            "id": "scheduled-sooner",
            "groupId": TEST_GROUP_ID,
            "text": "S1",
            "proposedBy": "A",
            "createdAt": 3,
            "startAt": 20_000,
        },
        {
            "id": "expired-old",
            "groupId": TEST_GROUP_ID,
            "text": "E1",
            "proposedBy": "A",
            "createdAt": 5,
            "startAt": 1_000,
            "endAt": 8_000,
        },
        {
            "id": "expired-new",
            "groupId": TEST_GROUP_ID,
            "text": "E2",
            "proposedBy": "A",
            "createdAt": 6,
            "startAt": 1_000,
            "endAt": 9_000,
        },
    ):
        table.put_item(Item=item)

    assert [item["id"] for item in activities.list_recent(TEST_GROUP_ID, consistent=True)] == [
        "unscheduled-new",
        "unscheduled-old",
        "scheduled-sooner",
        "scheduled-later",
        "expired-new",
        "expired-old",
    ]
