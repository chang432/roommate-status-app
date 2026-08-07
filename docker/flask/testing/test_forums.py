"""Standalone book-tagged forum API tests."""

from urllib.parse import quote

from testing.support import *  # noqa: F403


def add_book(client, title="The Left Hand of Darkness"):
    response = client.post(
        grouped_path("/api/book-club/books"),
        json={"title": title, "author": "Ursula K. Le Guin", "bookOwnerId": "andre"},
    )
    assert response.status_code == 201
    return response.get_json()["book"]


def create_forum(client, book, creator="sheryl", title="Ambiguity and loyalty"):
    response = client.post(
        "/api/forums",
        json={"title": title, "bookId": book["id"], "createdById": creator},
    )
    assert response.status_code == 201
    return response.get_json()[0]


def forum_path(forum: dict, suffix: str = "") -> str:
    return f"/api/forums/{quote(forum['id'], safe='')}{suffix}"


def test_forum_create_edit_feed_and_book_validation(client):
    book = add_book(client)
    invalid = client.post(
        "/api/forums",
        json={"title": "Unknown book", "bookId": "missing", "createdById": "andre"},
    )
    assert invalid.status_code == 400

    forum = create_forum(client, book)
    assert forum["bookTitle"] == book["title"]
    feed_item = client.get(grouped_path("/api/feed?type=forums")).get_json()[0]
    assert feed_item["type"] == "forums"
    assert feed_item["payload"]["id"] == forum["id"]

    forbidden = client.patch(
        f"/api/modules/forums/{quote(forum['id'], safe='')}",
        json={
            "editorId": "andre",
            "changes": {"title": "Taken over", "bookId": book["id"]},
        },
    )
    assert forbidden.status_code == 403
    edited = client.patch(
        f"/api/modules/forums/{quote(forum['id'], safe='')}",
        json={
            "editorId": "sheryl",
            "changes": {"title": "A colder loyalty", "bookId": book["id"]},
        },
    )
    assert edited.status_code == 200
    assert edited.get_json()["module"]["title"] == "A colder loyalty"


def test_forum_comments_notify_participants_and_support_likes(client, monkeypatch):
    book = add_book(client)
    calls = _capture_notifications(monkeypatch)
    forum = create_forum(client, book)
    calls.clear()

    commented = client.post(
        forum_path(forum, "/comments"),
        json={"authorId": "andre", "text": "What did @Kayla make of the ending?"},
    )
    assert commented.status_code == 200
    updated = commented.get_json()[0]
    comment = updated["comments"][0]
    audiences = [call[1].get("user_ids") for call in calls if call[0] == "users"]
    assert {"kayla"} in audiences
    assert {"sheryl"} in audiences

    liked = client.put(
        forum_path(forum, f"/comments/{comment['id']}/likes"),
        json={"userId": "kayla"},
    )
    assert liked.status_code == 200
    assert liked.get_json()[0]["comments"][0]["likedByIds"] == ["kayla"]
    self_like = client.put(
        forum_path(forum, f"/comments/{comment['id']}/likes"),
        json={"userId": "andre"},
    )
    assert self_like.status_code == 403


def test_any_member_can_archive_restore_and_delete_forum(client):
    forum = create_forum(client, add_book(client))
    archived = client.post(
        forum_path(forum, "/archive"), json={"userId": "ting"}
    )
    assert archived.status_code == 200
    assert archived.get_json()[0]["isArchived"] is True
    rejected = client.post(
        forum_path(forum, "/comments"),
        json={"authorId": "andre", "text": "Too late"},
    )
    assert rejected.status_code == 409
    restored = client.post(
        forum_path(forum, "/restore"), json={"userId": "kayla"}
    )
    assert restored.status_code == 200
    assert restored.get_json()[0]["isArchived"] is False
    deleted = client.delete(
        forum_path(forum), json={"userId": "andre"}
    )
    assert deleted.status_code == 200
    assert deleted.get_json() == []


def test_forum_data_remains_available_when_its_ui_module_is_disabled(client):
    forum = create_forum(client, add_book(client))
    groups.set_enabled_modules("andre", TEST_GROUP_ID, [])
    feed = client.get(grouped_path("/api/feed?type=forums")).get_json()
    assert feed[0]["id"] == forum["id"]
