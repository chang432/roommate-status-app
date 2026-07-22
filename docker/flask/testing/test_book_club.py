"""Book Club API tests."""

from testing.support import *  # noqa: F403

def test_book_club_summary_setup_and_member_response(client):
    """A group gets one isolated setup; each member owns only their response."""
    empty = client.get(grouped_path("/api/book-club"))
    assert empty.status_code == 200
    assert empty.get_json() == {"summary": None}

    configured = client.post(
        grouped_path("/api/book-club/config"),
        json={
            "title": "The Left Hand of Darkness",
            "author": "Ursula K. Le Guin",
            "readingTarget": "Read through Chapter 8",
        },
    )
    assert configured.status_code == 201
    summary = configured.get_json()["summary"]
    assert summary["activeBook"]["recommendedById"] == TEST_USER_ID
    assert summary["nextSession"]["snackDutyUserId"] == TEST_USER_ID
    assert summary["configuration"]["snackRotationCursor"] == 0
    assert all(response["attendanceStatus"] is None for response in summary["nextSession"]["responses"])

    session_id = summary["nextSession"]["id"]
    response = client.put(
        grouped_path(f"/api/book-club/sessions/{session_id.replace('#', '%23')}/response"),
        json={"attendanceStatus": "attending", "chaptersReadThrough": 6},
    )
    assert response.status_code == 200
    mine = next(item for item in response.get_json()["summary"]["nextSession"]["responses"] if item["userId"] == TEST_USER_ID)
    assert mine["attendanceStatus"] == "attending"
    assert mine["chaptersReadThrough"] == 6


def test_book_club_rejects_non_admin_configuration(client):
    response = client.post(
        grouped_path("/api/book-club/config", user_id="sheryl"),
        json={"title": "A Book", "author": "An Author", "readingTarget": "Chapter 1"},
    )
    assert response.status_code == 403


def test_book_club_member_can_notify_everyone_about_the_next_meeting(client, monkeypatch):
    configured = client.post(
        grouped_path("/api/book-club/config"),
        json={"title": "A Book", "author": "An Author", "readingTarget": "Chapter 1"},
    )
    session_id = configured.get_json()["summary"]["nextSession"]["id"]
    notifications = []

    monkeypatch.setattr(push, "is_configured", lambda: True)
    monkeypatch.setattr(
        "app.notify_group",
        lambda group_id, **kwargs: notifications.append((group_id, kwargs)) or {
            "sent": 2, "pruned": 0, "failed": 0,
        },
    )

    response = client.post(
        grouped_path(
            f"/api/book-club/sessions/{session_id.replace('#', '%23')}/notify",
            user_id="sheryl",
        ),
    )

    assert response.status_code == 200
    assert response.get_json() == {"sent": 2, "pruned": 0, "failed": 0}
    assert notifications == [(
        TEST_GROUP_ID,
        {
            "title": "Book Club reminder",
            "body": "Sheryl reminded everyone about the next Book Club meeting: A Book",
            "url": "/",
            "event_type": "book-club-reminder",
        },
    )]


def test_book_club_read_advances_due_meeting_to_admin_placeholder(client, monkeypatch):
    now = book_club._now()
    configured = client.post(
        grouped_path("/api/book-club/config"),
        json={
            "title": "A Book",
            "author": "An Author",
            "readingTarget": "Chapter 1",
            "scheduledAt": now + 1_000,
        },
    )
    assert configured.status_code == 201
    first = configured.get_json()["summary"]["nextSession"]

    # The first read after the scheduled time is the scheduler: no background
    # process is required for a local Flask deployment.
    monkeypatch.setattr(book_club, "_now", lambda: now + 2_000)
    advanced = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert advanced["activeBook"]["title"] == "A Book"
    assert advanced["activeBook"]["recommendedById"] == TEST_USER_ID
    assert advanced["nextSession"]["id"] != first["id"]
    assert advanced["nextSession"]["bookId"] == first["bookId"]
    assert advanced["nextSession"]["readingTarget"] == "Chapter 1"
    assert advanced["nextSession"]["snackDutyUserId"] != first["snackDutyUserId"]
    response = client.put(
        grouped_path(f"/api/book-club/sessions/{advanced['nextSession']['id'].replace('#', '%23')}/response"),
        json={"attendanceStatus": "maybe", "chaptersReadThrough": 1},
    )
    assert response.status_code == 200

    edited = client.put(
        grouped_path("/api/book-club/next-session"),
        json={
            "title": "The Next Book",
            "author": "Another Author",
            "readingTarget": "Read Chapter 2",
            "recommendedById": "kayla",
            "snackDutyUserId": "kayla",
            "meetingOffset": 1,
        },
    )
    assert edited.status_code == 200
    next_summary = edited.get_json()["summary"]
    assert next_summary["activeBook"]["title"] == "The Next Book"
    assert next_summary["activeBook"]["recommendedById"] == "kayla"
    assert next_summary["nextSession"]["readingTarget"] == "Read Chapter 2"
    assert next_summary["nextSession"]["snackDutyUserId"] == "kayla"
    assert next_summary["nextSession"]["id"] != advanced["nextSession"]["id"]
    assert next_summary["nextSession"]["scheduledAt"] == book_club._following_session_at(
        advanced["nextSession"]["scheduledAt"]
    )
    assert next(item for item in next_summary["nextSession"]["responses"] if item["userId"] == TEST_USER_ID)["attendanceStatus"] == "maybe"


def test_local_seed_groups_isolate_book_club_component(client):
    seed.seed_local_groups()

    yorkshire = groups.get_group_by_id(db.DEFAULT_GROUP_ID)
    assert (yorkshire["showRoster"], yorkshire["showFeed"], yorkshire["showBookClub"]) == (
        True,
        True,
        False,
    )

    book_club = groups.get_group_by_id(seed.BOOK_CLUB_GROUP_ID)
    assert book_club["name"] == "Book Club"
    assert book_club["joinCode"] == "BOOKCLUB"
    assert (book_club["showRoster"], book_club["showFeed"], book_club["showBookClub"]) == (
        False,
        False,
        True,
    )
    assert db.group_admin_ids(seed.BOOK_CLUB_GROUP_ID) == ["andre"]
    assert [(member["id"], member["role"]) for member in db.get_all(seed.BOOK_CLUB_GROUP_ID)] == [
        ("andre", "admin"),
        ("kayla", "member"),
    ]
