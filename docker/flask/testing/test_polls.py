"""Poll API, permissions, voting, and feed integration."""

from testing.support import *


def _make_poll(client, title="Dinner?", creator="andre", options=None):
    return client.post(
        "/api/polls",
        json={
            "title": title,
            "createdById": creator,
            "options": ["Thai", "Pizza"] if options is None else options,
        },
    )


def test_poll_supports_options_multiselect_votes_and_live_voter_names(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    created_response = _make_poll(client)
    assert created_response.status_code == 200
    poll = created_response.get_json()[0]
    assert poll["title"] == "Dinner?"
    assert [option["text"] for option in poll["options"]] == ["Thai", "Pizza"]

    added = client.post(
        f"/api/polls/{poll['id']}/options",
        json={"userId": "kayla", "text": "Tacos"},
    )
    assert added.status_code == 200
    poll = added.get_json()[0]
    assert poll["options"][-1]["addedById"] == "kayla"

    for option in poll["options"][:2]:
        voted = client.put(
            f"/api/polls/{poll['id']}/options/{option['id']}/votes",
            json={"userId": "kayla"},
        )
        assert voted.status_code == 200
    poll = voted.get_json()[0]
    assert all("kayla" in option["voterIds"] for option in poll["options"][:2])
    assert poll["options"][0]["voters"] == [{"id": "kayla", "name": "Kayla"}]


def test_only_creator_edits_poll_text_but_any_member_manages_lifecycle(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    option = poll["options"][0]

    forbidden = client.patch(
        f"/api/polls/{poll['id']}/options/{option['id']}",
        json={"userId": "kayla", "text": "Sushi"},
    )
    assert forbidden.status_code == 403
    edited = client.patch(
        f"/api/polls/{poll['id']}/options/{option['id']}",
        json={"userId": "andre", "text": "Sushi"},
    )
    assert edited.status_code == 200

    title_edit = client.patch(
        f"/api/modules/polls/{poll['id']}",
        json={"editorId": "andre", "changes": {"title": "Dinner location?"}},
    )
    assert title_edit.status_code == 200
    assert title_edit.get_json()["module"]["payload"]["title"] == "Dinner location?"

    archived = client.post(
        f"/api/polls/{poll['id']}/archive", json={"userId": "kayla"}
    )
    assert archived.status_code == 200
    assert archived.get_json()[0]["isArchived"] is True
    read_only = client.put(
        f"/api/polls/{poll['id']}/options/{option['id']}/votes",
        json={"userId": "andre"},
    )
    assert read_only.status_code == 409
    assert client.post(
        f"/api/polls/{poll['id']}/restore", json={"userId": "ting"}
    ).status_code == 200
    assert client.delete(
        f"/api/polls/{poll['id']}", json={"userId": "sheryl"}
    ).status_code == 200


def test_poll_allows_title_only_and_rejects_duplicate_options(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    empty = _make_poll(client, options=[])
    assert empty.status_code == 200
    poll = empty.get_json()[0]
    assert poll["options"] == []

    duplicate = _make_poll(client, options=["Thai", " thai "])
    assert duplicate.status_code == 400
    first = client.post(
        f"/api/polls/{poll['id']}/options",
        json={"userId": "kayla", "text": "Thai"},
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/polls/{poll['id']}/options",
        json={"userId": "ting", "text": " THAI "},
    )
    assert second.status_code == 409


def test_polls_are_returned_in_the_unified_feed(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    response = client.get("/api/feed?userId=andre&type=polls")
    assert response.status_code == 200
    assert response.get_json()[0]["id"] == poll["id"]
    assert response.get_json()[0]["type"] == "polls"


def test_concurrent_votes_on_one_option_are_not_lost(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    option_id = poll["options"][0]["id"]
    voters = [("andre", "Andre"), ("kayla", "Kayla"), ("ting", "Ting")]

    with ThreadPoolExecutor(max_workers=len(voters)) as executor:
        results = list(
            executor.map(
                lambda voter: household_polls.set_vote(
                    poll["id"],
                    option_id,
                    voter[0],
                    voter[1],
                    TEST_GROUP_ID,
                    True,
                ),
                voters,
            )
        )

    assert all(isinstance(result, dict) for result in results)
    stored = household_polls.get(poll["id"], TEST_GROUP_ID)
    assert set(stored["options"][0]["voterIds"]) == {voter[0] for voter in voters}


def test_poll_comments_notify_creator_and_voters_but_not_option_adders(
    client, monkeypatch
):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    option_id = poll["options"][0]["id"]
    client.put(
        f"/api/polls/{poll['id']}/options/{option_id}/votes",
        json={"userId": "kayla"},
    )
    client.post(
        f"/api/polls/{poll['id']}/options",
        json={"userId": "ting", "text": "Burgers"},
    )
    calls = _capture_notifications(monkeypatch)

    response = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={"authorId": "sheryl", "text": "@Kayla what do you think?"},
    )

    assert response.status_code == 200
    comment = response.get_json()[0]["comments"][0]
    assert comment["authorId"] == "sheryl"
    assert comment["mentions"] == [{"id": "kayla", "name": "Kayla"}]
    assert calls[0][0] == "users"
    assert calls[0][1]["user_ids"] == {"kayla"}
    assert calls[0][1]["title"] == "Sheryl mentioned you"
    assert calls[1][0] == "users"
    assert calls[1][1]["user_ids"] == {"andre"}
    assert calls[1][1]["title"] == "New poll comment"
    assert all(
        call[1]["url"]
        == f"/?module=polls&item={poll['id']}&groupId={TEST_GROUP_ID}"
        and call[1]["event_type"] == "polls-changed"
        for call in calls
    )
    assert all("ting" not in call[1].get("user_ids", set()) for call in calls)


def test_poll_comment_validation_and_archived_read_only_state(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    comment_url = f"/api/polls/{poll['id']}/comments"
    assert poll["comments"] == []

    assert client.post(
        comment_url, json={"authorId": "nobody", "text": "hello"}
    ).status_code == 400
    assert client.post(
        comment_url, json={"authorId": "andre", "text": "   "}
    ).status_code == 400
    too_long = client.post(
        comment_url, json={"authorId": "andre", "text": "x" * 281}
    )
    assert too_long.status_code == 400
    assert "under 280" in too_long.get_json()["error"]
    assert client.post(
        "/api/polls/missing/comments",
        json={"authorId": "andre", "text": "hello"},
    ).status_code == 404

    posted = client.post(
        comment_url, json={"authorId": "andre", "text": "Before archive"}
    )
    assert posted.status_code == 200
    client.post(f"/api/polls/{poll['id']}/archive", json={"userId": "kayla"})
    archived = client.post(
        comment_url, json={"authorId": "ting", "text": "Too late"}
    )
    assert archived.status_code == 409
    visible = client.get("/api/feed?userId=andre&type=polls").get_json()[0]["payload"]
    assert [comment["text"] for comment in visible["comments"]] == ["Before archive"]


def test_poll_comment_likes_are_idempotent_read_only_when_archived_and_deleted(
    client, monkeypatch
):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    comment_response = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={"authorId": "andre", "text": "My vote is Thai"},
    )
    comment_id = comment_response.get_json()[0]["comments"][0]["id"]

    own_like = client.put(
        f"/api/polls/{poll['id']}/comments/{comment_id}/likes",
        json={"userId": "andre"},
    )
    assert own_like.status_code == 403
    for _ in range(2):
        liked = client.put(
            f"/api/polls/{poll['id']}/comments/{comment_id}/likes",
            json={"userId": "kayla"},
        )
        assert liked.status_code == 200
    comment = liked.get_json()[0]["comments"][0]
    assert comment["likedByIds"] == ["kayla"]
    assert comment["likeCount"] == 1

    for _ in range(2):
        unliked = client.delete(
            f"/api/polls/{poll['id']}/comments/{comment_id}/likes",
            json={"userId": "kayla"},
        )
        assert unliked.status_code == 200
    assert unliked.get_json()[0]["comments"][0]["likedByIds"] == []

    client.put(
        f"/api/polls/{poll['id']}/comments/{comment_id}/likes",
        json={"userId": "kayla"},
    )
    client.post(f"/api/polls/{poll['id']}/archive", json={"userId": "ting"})
    archived_like = client.delete(
        f"/api/polls/{poll['id']}/comments/{comment_id}/likes",
        json={"userId": "kayla"},
    )
    assert archived_like.status_code == 409
    client.delete(f"/api/polls/{poll['id']}", json={"userId": "sheryl"})
    remaining = comment_likes.likes_by_parent(
        TEST_GROUP_ID, "pollId", consistent=True
    )
    assert poll["id"] not in remaining


def test_poll_comment_all_mentions_the_group(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    calls = []

    def fake_notify_group(group_id, **kwargs):
        calls.append((group_id, kwargs))
        return {"sent": 0, "pruned": 0, "failed": 0}

    monkeypatch.setattr("routes.polls.notify_group", fake_notify_group)
    response = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={"authorId": "kayla", "text": "@all please vote"},
    )

    assert response.status_code == 200
    assert calls == [
        (
            TEST_GROUP_ID,
            {
                "title": "Kayla mentioned everyone",
                "body": "On poll “Dinner?”: @all please vote",
                "url": f"/?module=polls&item={poll['id']}",
                "event_type": "polls-changed",
                "exclude_user_ids": {"kayla"},
            },
        )
    ]


def test_concurrent_poll_comment_and_vote_are_both_preserved(client, monkeypatch):
    monkeypatch.setattr("routes.polls.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    option_id = poll["options"][0]["id"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            executor.submit(
                household_polls.add_comment,
                poll["id"],
                "ting",
                "Ting",
                TEST_GROUP_ID,
                "Thai sounds good",
            ),
            executor.submit(
                household_polls.set_vote,
                poll["id"],
                option_id,
                "kayla",
                "Kayla",
                TEST_GROUP_ID,
                True,
            ),
        ]
        assert all(isinstance(result.result(), dict) for result in results)

    stored = household_polls.get(poll["id"], TEST_GROUP_ID)
    assert stored["comments"][0]["text"] == "Thai sounds good"
    assert stored["options"][0]["voterIds"] == ["kayla"]
