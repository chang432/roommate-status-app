"""Activity creation, membership, comment, and archive API tests."""

from testing.support import *  # noqa: F403


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
    assert data[0]["isExpired"] is False
    assert data[0]["startAt"] is None
    assert data[0]["endAt"] is None
    assert data[0]["endedAt"] is None
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
        Item={
            "id": "legacy",
            "groupId": TEST_GROUP_ID,
            "text": "Old plan",
            "proposedBy": "Isabella",
            "createdAt": 1,
        }
    )

    feed = client.get(grouped_path("/api/activities")).get_json()
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
        activities.add_comment(activity_id, "Andre", f"msg {i}", TEST_GROUP_ID)

    feed = client.get(grouped_path("/api/activities")).get_json()
    comments = feed[0]["comments"]
    assert [c["text"] for c in comments] == [f"msg {i}" for i in range(5, 105)]

    stored = activities._get_table().get_item(
        Key={"groupId": TEST_GROUP_ID, "id": activity_id}
    )["Item"]
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
                    TEST_GROUP_ID,
                    True,
                ),
                ("andre", "sheryl", "ting"),
            )
        )

    assert results == [activities.LIKE_OK] * 3
    comment = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]
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
            "groupId": TEST_GROUP_ID,
            "text": "Old event",
            "proposedBy": "Andre",
            "proposedById": "andre",
            "createdAt": 1,
            "comments": [{"author": "Kayla", "text": "hello", "createdAt": 2}],
        }
    )

    first = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]
    second = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]
    assert first["id"] == second["id"]
    assert first["authorId"] is None

    url = f"/api/activities/legacy-like/comments/{first['id']}/likes"
    assert client.put(url, json={"userId": "andre"}).status_code == 200
    assert client.put(url, json={"userId": "kayla"}).status_code == 403
    liked = client.get(grouped_path("/api/activities")).get_json()[0]["comments"][0]
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
