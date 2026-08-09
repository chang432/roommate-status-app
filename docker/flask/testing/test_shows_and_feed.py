"""Show tracker and cross-module feed API tests."""

import module_edits

from testing.support import *  # noqa: F403


def _make_show(client, title="Severance", creator="sheryl"):
    """Create a show and return its projected dict (newest, so first in list)."""
    res = client.post("/api/shows", json={"title": title, "createdById": creator})
    assert res.status_code == 200
    return res.get_json()[0]


def test_create_show_auto_joins_creator_at_s1e1(client):
    show = _make_show(client)
    assert show["title"] == "Severance"
    assert show["createdById"] == "sheryl"
    assert show["isArchived"] is False
    assert show["members"] == [
        {"id": "sheryl", "name": "Sheryl", "season": 1, "episode": 1}
    ]


def test_create_show_requires_title_and_valid_creator(client):
    assert client.post("/api/shows", json={"createdById": "sheryl"}).status_code == 400
    assert client.post("/api/shows", json={"title": "X", "createdById": "ghost"}).status_code == 400


def test_join_is_idempotent_then_leave_removes(client):
    show = _make_show(client)
    show_id = show["id"]

    client.post(f"/api/shows/{show_id}/join", json={"userId": "andre"})
    res = client.post(f"/api/shows/{show_id}/join", json={"userId": "andre"})
    assert res.status_code == 200
    members = res.get_json()[0]["members"]
    assert [m["id"] for m in members].count("andre") == 1

    res = client.post(f"/api/shows/{show_id}/leave", json={"userId": "andre"})
    assert "andre" not in [m["id"] for m in res.get_json()[0]["members"]]


def test_set_season_resets_episode_to_one(client):
    show = _make_show(client)
    show_id = show["id"]

    # Advance the creator's episode a few times, then jump the season.
    client.patch(
        f"/api/shows/{show_id}/watchers/sheryl/episode", json={"delta": 1, "userId": "sheryl"}
    )
    client.put(
        f"/api/shows/{show_id}/watchers/sheryl/episode", json={"value": 8, "userId": "sheryl"}
    )
    res = client.put(
        f"/api/shows/{show_id}/watchers/sheryl/season", json={"value": 3, "userId": "sheryl"}
    )
    member = res.get_json()[0]["members"][0]
    assert member["season"] == 3
    assert member["episode"] == 1


def test_progress_clamps_at_one_and_validates_input(client):
    show = _make_show(client)
    show_id = show["id"]

    res = client.put(
        f"/api/shows/{show_id}/watchers/sheryl/episode", json={"value": 0, "userId": "sheryl"}
    )
    assert res.get_json()[0]["members"][0]["episode"] == 1

    assert client.put(
        f"/api/shows/{show_id}/watchers/sheryl/episode", json={"value": "x", "userId": "sheryl"}
    ).status_code == 400


def test_concurrent_watcher_progress_updates_preserve_both_watchers(client):
    """Progress is stored per watcher rather than as one replaceable members list."""
    show = _make_show(client)
    show_id = show["id"]
    household_shows.join(show_id, "andre", "Andre", TEST_GROUP_ID)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(
            lambda args: household_shows.adjust_progress(*args),
            [
                (show_id, "sheryl", "episode", 2, TEST_GROUP_ID),
                (show_id, "andre", "episode", 3, TEST_GROUP_ID),
            ],
        ))

    assert all(results)
    stored = household_shows.get(show_id, TEST_GROUP_ID, consistent=True)
    assert {member["id"]: member["episode"] for member in stored["members"]} == {
        "sheryl": 3, "andre": 4,
    }
    assert client.patch(
        f"/api/shows/{show_id}/watchers/sheryl/rating", json={"delta": 1, "userId": "sheryl"}
    ).status_code == 400


def test_start_watchparty_records_episode_for_banner(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    show = _make_show(client)
    show_id = show["id"]

    res = client.post(
        f"/api/shows/{show_id}/watchparty/start",
        json={"requesterId": "sheryl", "season": 2, "episode": 5},
    )

    assert res.status_code == 200
    updated = res.get_json()[0]
    assert updated["isWatchpartyLive"] is True
    assert updated["watchpartySeason"] == 2
    assert updated["watchpartyEpisode"] == 5
    assert calls[-1][1]["body"] == "Sheryl started watching Severance S2 E5"

    ended = client.post(
        f"/api/shows/{show_id}/watchparty/end", json={"requesterId": "sheryl"}
    ).get_json()[0]
    assert ended["isWatchpartyLive"] is False
    assert ended["watchpartySeason"] is None
    assert ended["watchpartyEpisode"] is None


def test_start_watchparty_requires_episode_numbers(client):
    show = _make_show(client)
    show_id = show["id"]

    assert client.post(
        f"/api/shows/{show_id}/watchparty/start",
        json={"requesterId": "sheryl", "season": "2", "episode": 5},
    ).status_code == 400
    assert client.post(
        f"/api/shows/{show_id}/watchparty/start",
        json={"requesterId": "sheryl", "season": 2},
    ).status_code == 400


def test_any_roommate_can_archive_and_restore_show(client):
    show = _make_show(client, creator="sheryl")
    show_id = show["id"]

    res = client.post(f"/api/shows/{show_id}/archive", json={"requesterId": "andre"})
    assert res.get_json()[0]["isArchived"] is True

    res = client.post(f"/api/shows/{show_id}/restore", json={"requesterId": "sheryl"})
    assert res.get_json()[0]["isArchived"] is False


def test_archived_show_is_read_only(client):
    show = _make_show(client)
    show_id = show["id"]
    client.post(f"/api/shows/{show_id}/archive", json={"requesterId": "sheryl"})

    assert client.post(
        f"/api/shows/{show_id}/join", json={"userId": "andre"}
    ).status_code == 409
    assert client.patch(
        f"/api/shows/{show_id}/watchers/sheryl/episode", json={"delta": 1, "userId": "sheryl"}
    ).status_code == 409


def test_show_and_watcher_mutations_404(client):
    assert client.post("/api/shows/ghost/join", json={"userId": "andre"}).status_code == 404
    show = _make_show(client)
    # Unknown watcher on a real show is also a 404.
    assert client.put(
        f"/api/shows/{show['id']}/watchers/nobody/episode", json={"value": 2, "userId": "sheryl"}
    ).status_code == 404


def test_shows_are_scoped_by_group(client):
    """household_shows isolates every read and mutation by group id."""
    show_a = household_shows.add_show("Group A show", "sheryl", "Sheryl", "group-a")
    household_shows.add_show("Group B show", "andre", "Andre", "group-b")

    # Each group's feed sees only its own shows.
    assert [s["title"] for s in household_shows.list_recent("group-a")] == ["Group A show"]
    assert [s["title"] for s in household_shows.list_recent("group-b")] == ["Group B show"]

    # A cross-group read and every cross-group mutation see nothing.
    assert household_shows.get(show_a["id"], "group-b") is None
    assert household_shows.join(show_a["id"], "andre", "Andre", "group-b") is None
    assert household_shows.set_progress(show_a["id"], "sheryl", "episode", 5, "group-b") is None
    assert household_shows.archive(show_a["id"], "sheryl", "Sheryl", "group-b") is None

    # Same-group access still works.
    joined = household_shows.join(show_a["id"], "andre", "Andre", "group-a")
    assert "andre" in [m["id"] for m in joined["members"]]


def test_creators_can_edit_every_module_definition(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    event = _propose(client, "Dinner").get_json()[0]
    request_item = _make_request(client, requested_ids=["kayla", "ting"]).get_json()[0]
    client.post(
        f"/api/requests/{request_item['id']}/responses",
        json={"userId": "kayla", "response": "accepted"},
    )
    checklist = _make_checklist(client).get_json()[0]
    show = _make_show(client, creator="sheryl")
    jam_item = client.post(
        "/api/jam", json={"hostId": "andre", "link": "https://spotify.link/old"}
    ).get_json()
    calls.clear()

    edits = [
        (
            "events",
            event["id"],
            "andre",
            {"text": "Late dinner", "startAt": 9_000_000_000_000, "endAt": None},
            "text",
            "Late dinner",
        ),
        (
            "requests",
            request_item["id"],
            "andre",
            {"text": "Please grab milk", "requestedIds": ["kayla", "sheryl"]},
            "text",
            "Please grab milk",
        ),
        ("checklists", checklist["id"], "andre", {"title": "Weekly shop"}, "title", "Weekly shop"),
        ("tv", show["id"], "sheryl", {"title": "Severance S2"}, "title", "Severance S2"),
        (
            "spotify",
            jam_item["id"],
            "andre",
            {"link": "https://spotify.link/new"},
            "link",
            "https://spotify.link/new",
        ),
    ]
    for module_type, item_id, editor_id, changes, field, expected in edits:
        encoded_item_id = item_id.replace("#", "%23")
        response = client.patch(
            f"/api/modules/{module_type}/{encoded_item_id}",
            json={"editorId": editor_id, "changes": changes},
        )
        assert response.status_code == 200, (module_type, response.get_json())
        module = response.get_json()["module"]
        assert module["type"] == module_type
        assert module["payload"][field] == expected

    updated_request = household_requests.get(request_item["id"], TEST_GROUP_ID)
    assert updated_request["requestedIds"] == ["kayla", "sheryl"]
    assert next(person for person in updated_request["requested"] if person["id"] == "kayla")[
        "response"
    ] == "accepted"
    assert jam.get_active(TEST_GROUP_ID)["createdAt"] == jam_item["createdAt"]
    assert any(call[0] == "users" and call[1]["user_ids"] == {"kayla", "sheryl"} for call in calls)
    assert any(call[0] == "all" and call[1]["event_type"] == "spotify-changed" for call in calls)


def test_module_edits_enforce_creator_lifecycle_and_validation(client):
    checklist = _make_checklist(client).get_json()[0]
    url = f"/api/modules/checklists/{checklist['id']}"

    assert client.patch(
        url, json={"editorId": "kayla", "changes": {"title": "Nope"}}
    ).status_code == 403
    client.post(f"/api/checklists/{checklist['id']}/archive", json={"userId": "andre"})
    assert client.patch(
        url, json={"editorId": "andre", "changes": {"title": "Nope"}}
    ).status_code == 409
    assert client.patch(
        "/api/modules/ghost/one",
        json={"editorId": "andre", "changes": {"title": "Nope"}},
    ).status_code == 400
    assert client.patch(
        "/api/modules/tv/missing",
        json={"editorId": "andre", "changes": {"title": "Nope"}},
    ).status_code == 404


def test_noop_module_edit_preserves_timestamp_and_sends_no_notification(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)
    checklist = _make_checklist(client, title="Same title").get_json()[0]
    calls.clear()

    response = client.patch(
        f"/api/modules/checklists/{checklist['id']}",
        json={"editorId": "andre", "changes": {"title": "  Same title  "}},
    )

    assert response.status_code == 200
    assert response.get_json()["module"]["updatedAt"] == checklist["updatedAt"]
    assert calls == []


def test_module_feed_sorts_active_instances_and_exposes_archived_modules(client, monkeypatch):
    monkeypatch.setattr(activities.time, "time", lambda: 1_000)
    event = _propose(client, "Dinner").get_json()[0]
    monkeypatch.setattr(household_requests.time, "time", lambda: 1_001)
    request_item = _make_request(client, text="Grab oat milk").get_json()[0]
    monkeypatch.setattr(household_checklists.time, "time", lambda: 1_002)
    checklist = _make_checklist(client, title="Kitchen reset").get_json()[0]
    monkeypatch.setattr(household_shows.time, "time", lambda: 1_003)
    show = _make_show(client, title="Severance", creator="sheryl")
    monkeypatch.setattr(jam.time, "time", lambda: 1_004)
    client.post("/api/jam", json={"hostId": "andre", "link": "https://spotify.link/feed"})

    feed = client.get(grouped_path("/api/feed")).get_json()
    assert [item["type"] for item in feed] == [
        "events",
        "requests",
        "checklists",
        "tv",
        "spotify",
    ]
    assert [item["sortAt"] for item in feed] == sorted(item["sortAt"] for item in feed)
    assert feed[0]["payload"]["id"] == event["id"]
    assert client.get(grouped_path("/api/feed?type=tv")).get_json()[0]["id"] == show["id"]
    assert client.get(grouped_path("/api/feed?type=ghost")).status_code == 400

    client.post(f"/api/activities/{event['id']}/archive", json={"requesterId": "andre"})
    client.post(f"/api/requests/{request_item['id']}/archive", json={"userId": "andre"})
    client.post(f"/api/checklists/{checklist['id']}/archive", json={"userId": "andre"})
    client.post(f"/api/shows/{show['id']}/archive", json={"requesterId": "sheryl"})
    client.delete("/api/jam", json={"hostId": "kayla"})

    archived_feed = client.get(grouped_path("/api/feed")).get_json()
    assert [item["type"] for item in archived_feed] == [
        "events",
        "requests",
        "checklists",
        "tv",
    ]
    assert all(item["isArchived"] is True for item in archived_feed)


def test_feed_accepts_multiple_types_and_rejects_mixed_all(client):
    _propose(client, "Dinner")
    _make_show(client)

    response = client.get(
        grouped_path("/api/feed?type=events&type=tv")
    )

    assert response.status_code == 200
    assert {item["type"] for item in response.get_json()} == {"events", "tv"}
    assert client.get(
        grouped_path("/api/feed?type=all&type=events")
    ).status_code == 400


def test_feed_reuses_shared_likes_and_book_club_partition_reads(client, monkeypatch):
    calls = {"likes": 0, "books": 0}
    original_likes = comment_likes.list_for_group
    original_books = book_club.list_rows

    def list_likes(group_id, consistent=False):
        calls["likes"] += 1
        assert consistent is False
        return original_likes(group_id, consistent=consistent)

    def list_books(group_id, consistent=False):
        calls["books"] += 1
        assert consistent is False
        return original_books(group_id, consistent=consistent)

    monkeypatch.setattr(comment_likes, "list_for_group", list_likes)
    monkeypatch.setattr(book_club, "list_rows", list_books)

    response = client.get(
        grouped_path(
            "/api/feed?type=events&type=requests&type=polls&type=forums&type=book-club"
        )
    )

    assert response.status_code == 200
    assert calls == {"likes": 1, "books": 1}


def test_feed_reads_are_eventual_but_mutation_responses_remain_strong(client, monkeypatch):
    consistency = []
    original_query = activities.query_group

    def query(table, group_id, consistent=False):
        consistency.append(consistent)
        return original_query(table, group_id, consistent=consistent)

    monkeypatch.setattr(activities, "query_group", query)

    assert _propose(client, "Dinner").status_code == 200
    assert True in consistency
    consistency.clear()

    assert client.get(grouped_path("/api/feed?type=events")).status_code == 200
    assert consistency == [False]


def test_every_feed_module_has_a_registered_editor():
    assert set(module_models.MODULE_SOURCES) == set(module_edits.EDITORS)  # noqa: F405
