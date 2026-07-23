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
    monkeypatch.setattr("app.notify_group", lambda *args, **kwargs: {})
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
    monkeypatch.setattr("app.notify_group", lambda *args, **kwargs: {})
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
    monkeypatch.setattr("app.notify_group", lambda *args, **kwargs: {})
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
    monkeypatch.setattr("app.notify_group", lambda *args, **kwargs: {})
    poll = _make_poll(client).get_json()[0]
    response = client.get("/api/feed?userId=andre&type=polls")
    assert response.status_code == 200
    assert response.get_json()[0]["id"] == poll["id"]
    assert response.get_json()[0]["type"] == "polls"


def test_concurrent_votes_on_one_option_are_not_lost(client, monkeypatch):
    monkeypatch.setattr("app.notify_group", lambda *args, **kwargs: {})
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
