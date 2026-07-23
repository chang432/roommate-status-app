"""Book Club meeting-module API tests."""

from datetime import datetime, timezone
from urllib.parse import quote

from testing.support import *  # noqa: F403


FUTURE = int(datetime(2030, 8, 7, 23, 30, tzinfo=timezone.utc).timestamp() * 1000)


def enable_book_club():
    groups.set_display_options("andre", TEST_GROUP_ID, True, True, True)


def create_meeting(client, **overrides):
    enable_book_club()
    body = {
        "title": "The Left Hand of Darkness",
        "author": "Ursula K. Le Guin",
        "readingTarget": "Read through Chapter 8",
        "scheduledAt": FUTURE,
        **overrides,
    }
    return client.post(grouped_path("/api/book-club/meetings"), json=body)


def meeting_path(meeting_id: str, suffix: str = "") -> str:
    return f"/api/book-club/meetings/{quote(meeting_id, safe='')}{suffix}"


def test_owner_lists_and_meeting_defaults_are_sticky(client):
    enable_book_club()
    empty = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert empty["openMeeting"] is None
    assert empty["configuration"]["bookOwnerOrderUserIds"][0] == "andre"
    assert empty["configuration"]["snackOwnerOrderUserIds"][0] == "andre"

    created = create_meeting(client, bookOwnerId="kayla", snackOwnerId="ting")
    assert created.status_code == 201
    first = created.get_json()["meeting"]
    assert (first["bookOwnerId"], first["snackOwnerId"]) == ("kayla", "ting")

    duplicate = create_meeting(client)
    assert duplicate.status_code == 409

    completed = client.post(grouped_path(meeting_path(first["id"], "/complete")))
    assert completed.status_code == 200
    second = client.post(
        grouped_path("/api/book-club/meetings"),
        json={
            "title": first["bookTitle"],
            "author": first["bookAuthor"],
            "readingTarget": "Finish the book",
        },
    )
    assert second.status_code == 201
    next_meeting = second.get_json()["meeting"]
    assert (next_meeting["bookOwnerId"], next_meeting["snackOwnerId"]) == ("kayla", "ting")
    assert next_meeting["scheduledAt"] == book_club.following_meeting_at(FUTURE)


def test_admin_edit_moves_each_selected_owner_to_front(client):
    meeting = create_meeting(client).get_json()["meeting"]
    edited = client.patch(
        f"/api/modules/book-club/{quote(meeting['id'], safe='')}",
        json={
            "editorId": "andre",
            "changes": {
                "title": meeting["bookTitle"],
                "author": meeting["bookAuthor"],
                "readingTarget": "Chapter 9",
                "scheduledAt": FUTURE - 1000,
                "bookOwnerId": "kayla",
                "snackOwnerId": "sheryl",
            },
        },
    )
    assert edited.status_code == 200
    summary = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert summary["configuration"]["bookOwnerOrderUserIds"][0] == "kayla"
    assert summary["configuration"]["snackOwnerOrderUserIds"][0] == "sheryl"

    forbidden = client.patch(
        f"/api/modules/book-club/{quote(meeting['id'], safe='')}",
        json={"editorId": "sheryl", "changes": {
            "title": meeting["bookTitle"], "author": meeting["bookAuthor"],
            "readingTarget": "Chapter 10", "scheduledAt": FUTURE,
            "bookOwnerId": "sheryl", "snackOwnerId": "sheryl",
        }},
    )
    assert forbidden.status_code == 403


def test_members_can_update_past_open_meetings_and_notify(client, monkeypatch):
    meeting = create_meeting(client).get_json()["meeting"]
    book_club._get_table().update_item(
        Key={"groupId": TEST_GROUP_ID, "id": meeting["id"]},
        UpdateExpression="SET scheduledAt = :past",
        ExpressionAttributeValues={":past": 1},
    )
    response = client.put(
        grouped_path(meeting_path(meeting["id"], "/response"), user_id="sheryl"),
        json={"attendanceStatus": "attending", "chaptersReadThrough": 6},
    )
    assert response.status_code == 200
    mine = next(item for item in response.get_json()["meeting"]["responses"] if item["userId"] == "sheryl")
    assert (mine["attendanceStatus"], mine["chaptersReadThrough"]) == ("attending", 6)

    notifications = []
    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(
        "app.notify_group",
        lambda group_id, **kwargs: notifications.append((group_id, kwargs)) or {"sent": 1, "pruned": 0, "failed": 0},
    )
    notified = client.post(
        grouped_path(meeting_path(meeting["id"], "/notify"), user_id="sheryl")
    )
    assert notified.status_code == 200
    assert notifications[0][1]["url"] == module_models.module_url("book-club", meeting["id"])


def test_completed_book_keeps_ratings_and_chapter_discussion(client):
    meeting = create_meeting(client).get_json()["meeting"]
    completed = client.post(grouped_path(f"/api/book-club/books/{meeting['bookId']}/complete"))
    assert completed.status_code == 200

    rated = client.put(
        grouped_path(f"/api/book-club/books/{meeting['bookId']}/rating"), json={"rating": 5}
    )
    assert rated.status_code == 200
    assert rated.get_json()["books"][0]["viewerRating"] == 5

    posted = client.post(
        grouped_path(f"/api/book-club/books/{meeting['bookId']}/posts"),
        json={"chapterKey": "008", "chapterLabel": "Chapter 8", "body": "A sharp ending."},
    )
    assert posted.status_code == 201
    posts = client.get(grouped_path(f"/api/book-club/books/{meeting['bookId']}/posts"))
    assert posts.get_json()["posts"][0]["body"] == "A sharp ending."


def test_feed_exposes_meetings_only_when_book_club_is_enabled(client):
    meeting = create_meeting(client).get_json()["meeting"]
    feed = client.get(grouped_path("/api/feed?type=book-club"))
    assert feed.status_code == 200
    assert feed.get_json()[0]["id"] == meeting["id"]
    assert feed.get_json()[0]["type"] == "book-club"

    groups.set_display_options("andre", TEST_GROUP_ID, True, True, False)
    assert client.get(grouped_path("/api/feed?type=book-club")).get_json() == []


def test_non_admin_cannot_create_or_complete_meetings(client):
    meeting = create_meeting(client).get_json()["meeting"]
    create = client.post(
        grouped_path("/api/book-club/meetings", user_id="sheryl"),
        json={"title": "A", "author": "B", "readingTarget": "C", "scheduledAt": FUTURE},
    )
    complete = client.post(
        grouped_path(meeting_path(meeting["id"], "/complete"), user_id="sheryl")
    )
    assert create.status_code == 403
    assert complete.status_code == 403


def test_legacy_open_session_can_be_completed_before_migration(client):
    enable_book_club()
    session_id = "session#2030-08-07T23:30:00.000Z"
    table = book_club._get_table()
    table.put_item(Item={
        "groupId": TEST_GROUP_ID, "id": session_id, "bookId": "legacy",
        "bookTitle": "Legacy Book", "bookAuthor": "Legacy Author",
        "readingTarget": "Chapter 4", "snackDutyUserId": "kayla",
        "snackDutyName": "Kayla", "scheduledAt": FUTURE,
        "status": "scheduled", "createdAt": 1, "updatedAt": 1,
    })
    table.put_item(Item={
        "groupId": TEST_GROUP_ID, "id": book_club.CONFIG_ID,
        "nextSessionId": session_id, "nextSessionAt": FUTURE,
        "bookRotationUserIds": ["andre", "kayla"], "bookRotationCursor": 0,
        "snackRotationUserIds": ["kayla", "andre"], "snackRotationCursor": 0,
        "createdAt": 1, "updatedAt": 1,
    })

    completed = client.post(grouped_path(meeting_path(session_id, "/complete")))

    assert completed.status_code == 200
    config = table.get_item(
        Key={"groupId": TEST_GROUP_ID, "id": book_club.CONFIG_ID}
    )["Item"]
    assert "nextSessionId" not in config


def test_local_seed_group_remains_book_club_only(client):
    seed.seed_local_groups()
    group = groups.get_group_by_id(seed.BOOK_CLUB_GROUP_ID)
    assert (group["showRoster"], group["showFeed"], group["showBookClub"]) == (False, False, True)
