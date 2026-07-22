"""Activity push-recipient and mention-notification API tests."""

from testing.support import *  # noqa: F403


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
            "url": f"/?module=events&item={activity_id}&groupId=yorkshire",
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
                "url": f"/?module=events&item={activity_id}&groupId=yorkshire",
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
            "groupId": TEST_GROUP_ID,
            "text": "Old event",
            "proposedBy": "Andre",
            "proposedById": "andre",
            "createdAt": 1,
            "comments": [{"author": "Kayla", "text": "hello", "createdAt": 2}],
        }
    )

    comment = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]
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
    comment_id = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]["id"]
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
    assert activities._get_table().get_item(
        Key={"groupId": TEST_GROUP_ID, "id": activity_id}
    ).get("Item") is None
    # The event's comment likes live in the comment-likes table and go with it.
    assert not any(
        like.get("activityId") == activity_id
        for like in comment_likes.list_for_group(TEST_GROUP_ID, consistent=True)
    )
    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "users"
    assert kwargs["user_ids"] == {"andre", "kayla"}
    assert kwargs["exclude_user_ids"] == {"andre"}
    assert kwargs["body"] == "Andre deleted Movie night"


def test_any_roommate_can_archive_activity(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    client.post(f"/api/activities/{activity_id}/join", json={"userId": "kayla"})
    calls = _capture_notifications(monkeypatch)

    monkeypatch.setattr(activities.time, "time", lambda: 1_200)
    archived = client.post(
        f"/api/activities/{activity_id}/archive",
        json={"requesterId": "kayla"},
    )

    assert archived.status_code == 200
    archived_item = next(item for item in archived.get_json() if item["id"] == activity_id)
    assert archived_item["isArchived"] is True
    assert archived_item["archivedById"] == "kayla"
    assert archived_item["archivedBy"] == "Kayla"
    assert isinstance(archived_item["archivedAt"], int)
    assert len(calls) == 1
    audience, kwargs = calls[0]
    assert audience == "users"
    assert kwargs["user_ids"] == {"andre", "kayla"}
    assert kwargs["exclude_user_ids"] == {"kayla"}
    assert kwargs["body"] == "Kayla archived Movie night"


def test_archive_live_activity_flags_it_without_ending(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]
    client.post(
        f"/api/activities/{activity_id}/start",
        json={"requesterId": "andre"},
    )

    monkeypatch.setattr(activities.time, "time", lambda: 1_300)
    archived = client.post(
        f"/api/activities/{activity_id}/archive",
        json={"requesterId": "kayla"},
    )

    assert archived.status_code == 200
    archived_item = next(item for item in archived.get_json() if item["id"] == activity_id)
    assert archived_item["isArchived"] is True
    assert archived_item["isLive"] is True
    assert archived_item["isExpired"] is False
    assert archived_item["endedAt"] is None


def test_archive_activity_requires_requester(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    res = client.post(f"/api/activities/{activity_id}/archive", json={})

    assert res.status_code == 400
    assert activities.get(activity_id, TEST_GROUP_ID)["isExpired"] is False


def test_archive_unknown_activity_404(client):
    res = client.post("/api/activities/nope/archive", json={"requesterId": "andre"})
    assert res.status_code == 404


def test_any_roommate_can_delete_activity(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    deleted = client.delete(
        f"/api/activities/{activity_id}",
        json={"requesterId": "kayla"},
    )

    assert deleted.status_code == 200
    assert activities.get(activity_id, TEST_GROUP_ID) is None


def test_legacy_activity_can_be_deleted(client):
    activities._get_table().put_item(
        Item={
            "id": "legacy-delete",
            "groupId": TEST_GROUP_ID,
            "text": "Old plan",
            "proposedBy": "Andre",
            "createdAt": 1,
        }
    )

    deleted = client.delete(
        "/api/activities/legacy-delete",
        json={"requesterId": "andre"},
    )

    assert deleted.status_code == 200
    assert activities.get("legacy-delete", TEST_GROUP_ID) is None


def test_delete_activity_requires_requester(client):
    created = _propose(client, "Movie night").get_json()
    activity_id = created[0]["id"]

    res = client.delete(f"/api/activities/{activity_id}", json={})

    assert res.status_code == 400
    assert activities.get(activity_id, TEST_GROUP_ID) is not None


def test_delete_unknown_activity_404(client):
    res = client.delete("/api/activities/nope", json={"requesterId": "andre"})
    assert res.status_code == 404


def test_emphasize_unknown_activity_404(client):
    res = client.post("/api/activities/nope/notify", json={"emphasizedById": "andre"})
    assert res.status_code == 404


def test_activities_unscheduled_newest_first_without_cap(client):
    # Insert 6 proposals with controlled, increasing timestamps for determinism.
    table = activities._get_table()
    for i in range(6):
        table.put_item(
            Item={
                "id": f"a{i}",
                "groupId": TEST_GROUP_ID,
                "text": f"activity {i}",
                "proposedBy": "x",
                "createdAt": 1000 + i,
            }
        )
    res = client.get(grouped_path("/api/activities"))
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 6
    assert [d["text"] for d in data] == [f"activity {i}" for i in (5, 4, 3, 2, 1, 0)]
