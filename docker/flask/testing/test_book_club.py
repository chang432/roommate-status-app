"""Book Club meeting-module API tests."""

from datetime import datetime, timezone
from urllib.parse import quote

from testing.support import *  # noqa: F403


FUTURE = int(datetime(2030, 8, 7, 23, 30, tzinfo=timezone.utc).timestamp() * 1000)


def enable_book_club():
    groups.set_enabled_modules("andre", TEST_GROUP_ID, ["book-club", "forums"])


def add_book(client, user_id="andre", **overrides):
    enable_book_club()
    body = {
        "title": "The Left Hand of Darkness",
        "author": "Ursula K. Le Guin",
        "bookOwnerId": "andre",
        **overrides,
    }
    response = client.post(
        grouped_path("/api/book-club/books", user_id=user_id), json=body
    )
    assert response.status_code == 201
    return response.get_json()["book"]


def create_meeting(client, **overrides):
    enable_book_club()
    title = overrides.pop("title", "The Left Hand of Darkness")
    author = overrides.pop("author", "Ursula K. Le Guin")
    book_owner_id = overrides.pop("bookOwnerId", "andre")
    overrides.pop("bookId", None)
    if book_club.summary(TEST_GROUP_ID, db.get_all(TEST_GROUP_ID))["activeBook"] is None:
        add_book(
            client, title=title, author=author, bookOwnerId=book_owner_id
        )
    body = {
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
            "readingTarget": "Finish the book",
        },
    )
    assert second.status_code == 201
    next_meeting = second.get_json()["meeting"]
    assert (next_meeting["bookOwnerId"], next_meeting["snackOwnerId"]) == ("kayla", "ting")
    assert next_meeting["scheduledAt"] == book_club.following_meeting_at(FUTURE)


def test_meeting_edit_keeps_book_fixed_and_updates_snack_owner(client):
    meeting = create_meeting(client).get_json()["meeting"]
    edited = client.patch(
        f"/api/modules/book-club/{quote(meeting['id'], safe='')}",
        json={
            "editorId": "andre",
            "changes": {
                "readingTarget": "Chapter 9",
                "scheduledAt": FUTURE - 1000,
                "snackOwnerId": "sheryl",
            },
        },
    )
    assert edited.status_code == 200
    summary = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert summary["configuration"]["snackOwnerOrderUserIds"][0] == "sheryl"
    assert summary["configuration"]["snackOwnerOrderUserIds"][1] == "andre"

    fixed = client.patch(
        f"/api/modules/book-club/{quote(meeting['id'], safe='')}",
        json={"editorId": "andre", "changes": {
            "bookOwnerId": "kayla", "readingTarget": "Chapter 10",
            "scheduledAt": FUTURE, "snackOwnerId": "sheryl",
        }},
    )
    assert fixed.status_code == 400
    assert "book is fixed" in fixed.get_json()["error"]

    forbidden = client.patch(
        f"/api/modules/book-club/{quote(meeting['id'], safe='')}",
        json={"editorId": "sheryl", "changes": {
            "readingTarget": "Chapter 10", "scheduledAt": FUTURE,
            "snackOwnerId": "sheryl",
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
        json={"attendanceStatus": "attending"},
    )
    assert response.status_code == 200
    mine = next(item for item in response.get_json()["meeting"]["responses"] if item["userId"] == "sheryl")
    assert mine == {
        "userId": "sheryl",
        "userName": "Sheryl",
        "attendanceStatus": "attending",
    }

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


def test_meeting_responses_are_attendance_only(client):
    meeting = create_meeting(client).get_json()["meeting"]
    path = grouped_path(meeting_path(meeting["id"], "/response"), user_id="sheryl")

    pending = next(
        item for item in meeting["responses"] if item["userId"] == "sheryl"
    )
    assert pending == {
        "userId": "sheryl",
        "userName": "Sheryl",
        "attendanceStatus": None,
    }

    attendance_response = client.put(path, json={"attendanceStatus": "maybe"})
    attendance = next(
        item for item in attendance_response.get_json()["meeting"]["responses"]
        if item["userId"] == "sheryl"
    )
    assert attendance["attendanceStatus"] == "maybe"

    response_id = f"meeting-member#{meeting['id'].split('#', 1)[-1]}#sheryl"
    book_club._get_table().update_item(
        Key={"groupId": TEST_GROUP_ID, "id": response_id},
        UpdateExpression="SET chaptersReadThrough = :chapter, attendanceOnlyLegacyRecord = :legacy",
        ExpressionAttributeValues={
            ":chapter": 7,
            ":legacy": {"hadChaptersReadThrough": True, "chaptersReadThrough": 7},
        },
    )
    refreshed = client.put(path, json={"attendanceStatus": "not_attending"})
    projected = next(
        item for item in refreshed.get_json()["meeting"]["responses"]
        if item["userId"] == "sheryl"
    )
    stored = book_club._fetch(TEST_GROUP_ID, response_id)
    assert projected == {
        "userId": "sheryl",
        "userName": "Sheryl",
        "attendanceStatus": "not_attending",
    }
    assert stored["chaptersReadThrough"] == 7
    assert stored["attendanceOnlyLegacyRecord"]["chaptersReadThrough"] == 7

    assert client.put(path, json={}).status_code == 400
    assert client.put(path, json={"chaptersReadThrough": 7}).status_code == 400
    assert client.put(path, json={"readingComplete": True}).status_code == 400
    assert client.put(path, json={
        "attendanceStatus": "attending", "chaptersReadThrough": 7,
    }).status_code == 400


def test_summary_accepts_legacy_meeting_responses_without_user_id(client):
    meeting = create_meeting(client).get_json()["meeting"]
    meeting_key = meeting["id"].split("#", 1)[-1]
    book_club._get_table().put_item(Item={
        "groupId": TEST_GROUP_ID,
        "id": f"meeting-member#{meeting_key}#sheryl",
        "meetingId": meeting["id"],
        "attendanceStatus": "attending",
        "chaptersReadThrough": 7,
    })

    response = client.get(grouped_path("/api/book-club"))

    assert response.status_code == 200
    responses = response.get_json()["summary"]["openMeeting"]["responses"]
    sheryl = next(item for item in responses if item["userId"] == "sheryl")
    assert sheryl == {
        "userId": "sheryl",
        "userName": "Sheryl",
        "attendanceStatus": "attending",
    }


def test_active_book_collects_member_reviews_and_meeting_history(client):
    meeting = create_meeting(client).get_json()["meeting"]

    reviewed = client.put(
        grouped_path(f"/api/book-club/books/{meeting['bookId']}/review"),
        json={"rating": 5, "finished": True, "note": "A sharp ending."},
    )
    assert reviewed.status_code == 200
    book = reviewed.get_json()["books"][0]
    assert book["averageRating"] == 5
    assert book["finishedCount"] == 1
    assert book["viewerReview"]["note"] == "A sharp ending."
    assert book["isCurrent"] is True
    assert [item["id"] for item in book["meetings"]] == [meeting["id"]]

    client.post(grouped_path(meeting_path(meeting["id"], "/complete")))
    later = create_meeting(
        client, bookId=meeting["bookId"], scheduledAt=FUTURE + 1000
    ).get_json()["meeting"]
    refreshed = client.get(grouped_path("/api/book-club/books")).get_json()["books"][0]
    assert [item["id"] for item in refreshed["meetings"]] == [
        later["id"], meeting["id"]
    ]

    invalid = client.put(
        grouped_path(
            f"/api/book-club/books/{meeting['bookId']}/review",
            user_id="sheryl",
        ),
        json={"rating": 4},
    )
    assert invalid.status_code == 400
    assert invalid.get_json()["error"] == "Finished must be true or false."


def test_legacy_rating_is_visible_until_member_confirms_finish_status(client):
    meeting = create_meeting(client).get_json()["meeting"]
    client.post(grouped_path(f"/api/book-club/books/{meeting['bookId']}/complete"))
    book_club._get_table().put_item(Item={
        "groupId": TEST_GROUP_ID,
        "id": f"rating#{meeting['bookId']}#sheryl",
        "bookId": meeting["bookId"],
        "userId": "sheryl",
        "userName": "Sheryl",
        "rating": 4,
        "createdAt": 1,
        "updatedAt": 1,
    })

    books = client.get(
        grouped_path("/api/book-club/books", user_id="sheryl")
    ).get_json()["books"]

    assert books[0]["viewerReview"]["rating"] == 4
    assert books[0]["viewerReview"]["finished"] is None
    assert books[0]["unknownFinishCount"] == 1


def test_books_list_places_current_before_recently_completed(client):
    first = create_meeting(client).get_json()["meeting"]
    client.post(grouped_path(meeting_path(first["id"], "/complete")))
    client.post(grouped_path(f"/api/book-club/books/{first['bookId']}/complete"))
    add_book(client, title="Kindred", author="Octavia E. Butler")
    second = create_meeting(client, readingTarget="Read through Chapter 5").get_json()["meeting"]

    books = client.get(grouped_path("/api/book-club/books")).get_json()["books"]

    assert [book["id"] for book in books] == [second["bookId"], first["bookId"]]
    assert [book["isCurrent"] for book in books] == [True, False]
    assert books[1]["completedAt"] is not None


def test_admins_add_and_members_correct_books_and_all_meeting_snapshots(client):
    book = add_book(
        client,
        title="Kindred",
        author="Octavia Butler",
        bookOwnerId="kayla",
    )
    assert book["bookOwnerName"] == "Kayla"
    assert client.get(grouped_path("/api/book-club")).get_json()["summary"]["activeBook"]["id"] == book["id"]

    meeting = create_meeting(client, bookId=book["id"]).get_json()["meeting"]
    client.post(grouped_path(meeting_path(meeting["id"], "/complete")))
    client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))

    corrected = client.patch(
        grouped_path(f"/api/book-club/books/{book['id']}", user_id="sheryl"),
        json={
            "title": "Kindred: A Novel",
            "author": "Octavia E. Butler",
            "bookOwnerId": "sheryl",
        },
    )
    assert corrected.status_code == 200
    updated = corrected.get_json()["book"]
    assert (updated["title"], updated["bookOwnerName"]) == (
        "Kindred: A Novel", "Sheryl"
    )
    historical = client.get(grouped_path(meeting_path(meeting["id"]))).get_json()["meeting"]
    assert (historical["bookTitle"], historical["bookAuthor"], historical["bookOwnerId"]) == (
        "Kindred: A Novel", "Octavia E. Butler", "sheryl"
    )


def test_books_support_normalized_member_editable_tags(client):
    book = add_book(
        client,
        tags=["Science   Fiction", "Bechdel Pass", "science fiction"],
    )
    assert book["tags"] == ["Science Fiction", "Bechdel Pass"]

    edited = client.patch(
        grouped_path(f"/api/book-club/books/{book['id']}", user_id="sheryl"),
        json={
            "title": book["title"],
            "author": book["author"],
            "bookOwnerId": "andre",
            "tags": ["Classic", "Feminist"],
        },
    )
    assert edited.status_code == 200
    assert edited.get_json()["book"]["tags"] == ["Classic", "Feminist"]

    # Omitting the additive field preserves it for callers updating other metadata.
    preserved = client.patch(
        grouped_path(f"/api/book-club/books/{book['id']}", user_id="kayla"),
        json={
            "title": book["title"],
            "author": book["author"],
            "bookOwnerId": "andre",
        },
    )
    assert preserved.status_code == 200
    assert preserved.get_json()["book"]["tags"] == ["Classic", "Feminist"]


def test_book_tags_validate_shape_length_and_count(client):
    invalid_values = [
        ("Classic", "Book tags must be a list."),
        ([""], "Book tags cannot be empty."),
        (["x" * (book_club.BOOK_TAG_LENGTH + 1)], "Book tags must be at most"),
        ([str(index) for index in range(book_club.BOOK_TAG_LIMIT + 1)], "Books can have at most"),
    ]
    for tags, message in invalid_values:
        response = client.post(grouped_path("/api/book-club/books"), json={
            "title": "A Book",
            "author": "An Author",
            "bookOwnerId": "andre",
            "tags": tags,
        })
        assert response.status_code == 400
        assert message in response.get_json()["error"]


def test_legacy_books_project_an_empty_tag_list(client):
    book = add_book(client)
    stored = book_club._fetch(TEST_GROUP_ID, f"book#{book['id']}")
    stored.pop("tags", None)
    book_club._get_table().put_item(Item=stored)

    projected = client.get(grouped_path("/api/book-club/books")).get_json()["books"][0]
    assert projected["tags"] == []


def test_adding_a_replacement_completes_the_prior_current_book(client):
    first = add_book(client, title="First", author="Writer One")
    second = add_book(client, title="Second", author="Writer Two", bookOwnerId="kayla")
    books = client.get(grouped_path("/api/book-club/books")).get_json()["books"]
    assert [book["id"] for book in books[:2]] == [second["id"], first["id"]]
    assert [book["isCurrent"] for book in books[:2]] == [True, False]
    assert books[1]["completedAt"] is not None

    second_meeting = create_meeting(client, scheduledAt=FUTURE + 1000).get_json()["meeting"]
    assert second_meeting["bookTitle"] == "Second"
    corrected = client.patch(
        grouped_path(f"/api/book-club/books/{second['id']}", user_id="sheryl"),
        json={
            "title": "Second Edition",
            "author": "Writer Two",
            "bookOwnerId": "sheryl",
        },
    )
    assert corrected.status_code == 200
    summary = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert summary["activeBook"]["title"] == "Second Edition"
    assert summary["configuration"]["bookOwnerOrderUserIds"][0] == "sheryl"
    corrected_meeting = client.get(
        grouped_path(meeting_path(second_meeting["id"]))
    ).get_json()["meeting"]
    assert corrected_meeting["bookTitle"] == "Second Edition"

    rejected = client.post(grouped_path("/api/book-club/meetings"), json={
        "bookId": first["id"], "readingTarget": "Again", "scheduledAt": FUTURE + 2000,
    })
    assert rejected.status_code == 400
    assert rejected.get_json()["error"] == "Meetings always use the current book."


def test_replacement_is_rejected_without_changing_the_current_book_when_meeting_is_open(client):
    first = add_book(client, title="First", author="Writer One")
    create_meeting(client)

    rejected = client.post(grouped_path("/api/book-club/books"), json={
        "title": "Second", "author": "Writer Two", "bookOwnerId": "kayla",
    })

    assert rejected.status_code == 409
    assert rejected.get_json()["error"] == "Complete the open meeting before adding a new book."
    summary = client.get(grouped_path("/api/book-club")).get_json()["summary"]
    assert summary["activeBook"]["id"] == first["id"]
    assert len(client.get(grouped_path("/api/book-club/books")).get_json()["books"]) == 1


def test_completing_current_book_clears_pointer_and_blocks_new_meetings(client):
    book = add_book(client)
    completed = client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))

    assert completed.status_code == 200
    assert completed.get_json()["summary"]["activeBook"] is None
    stored = book_club._fetch(TEST_GROUP_ID, f"book#{book['id']}")
    assert stored["completedAt"] is not None
    assert "status" not in stored
    rejected = client.post(grouped_path("/api/book-club/meetings"), json={
        "readingTarget": "Chapter 1", "scheduledAt": FUTURE,
    })
    assert rejected.status_code == 400
    assert rejected.get_json()["error"] == "Add a current book before scheduling a meeting."


def test_completing_current_book_requires_its_open_meeting_to_finish_first(client):
    book = add_book(client)
    meeting = create_meeting(client).get_json()["meeting"]

    rejected = client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))

    assert rejected.status_code == 409
    assert rejected.get_json()["error"] == "Complete the open meeting before completing the current book."
    assert client.get(grouped_path("/api/book-club")).get_json()["summary"]["activeBook"]["id"] == book["id"]
    assert book_club._fetch(TEST_GROUP_ID, f"book#{book['id']}").get("completedAt") is None

    client.post(grouped_path(meeting_path(meeting["id"], "/complete")))
    completed = client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))
    assert completed.status_code == 200


def test_admin_can_restore_a_completed_book_as_current_when_none_is_selected(client):
    book = add_book(client)
    client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))

    restored = client.patch(
        grouped_path(f"/api/book-club/books/{book['id']}"),
        json={
            "title": "The Left Hand of Darkness",
            "author": "Ursula K. Le Guin",
            "bookOwnerId": "kayla",
            "setAsCurrent": True,
        },
    )

    assert restored.status_code == 200
    assert restored.get_json()["book"]["id"] == book["id"]
    assert restored.get_json()["summary"]["activeBook"]["id"] == book["id"]
    stored = book_club._fetch(TEST_GROUP_ID, f"book#{book['id']}")
    assert "completedAt" not in stored
    assert book_club._fetch(TEST_GROUP_ID, book_club.CONFIG_ID)["activeBookId"] == book["id"]


def test_restoring_a_completed_book_requires_an_admin_and_no_current_book(client):
    book = add_book(client)
    client.post(grouped_path(f"/api/book-club/books/{book['id']}/complete"))
    body = {
        "title": book["title"],
        "author": book["author"],
        "bookOwnerId": "andre",
        "setAsCurrent": True,
    }

    forbidden = client.patch(
        grouped_path(f"/api/book-club/books/{book['id']}", user_id="sheryl"), json=body,
    )
    assert forbidden.status_code == 403

    add_book(client, title="Replacement", author="Another Writer")
    rejected = client.patch(grouped_path(f"/api/book-club/books/{book['id']}"), json=body)
    assert rejected.status_code == 409
    assert rejected.get_json()["error"] == "A current book or open meeting already exists."


def test_only_admins_can_add_current_books(client):
    rejected = client.post(grouped_path("/api/book-club/books", user_id="sheryl"), json={
        "title": "A Book", "author": "An Author", "bookOwnerId": "sheryl",
    })
    assert rejected.status_code == 403


def test_feed_preserves_meetings_when_book_club_ui_is_disabled(client):
    meeting = create_meeting(client).get_json()["meeting"]
    feed = client.get(grouped_path("/api/feed?type=book-club"))
    assert feed.status_code == 200
    assert feed.get_json()[0]["id"] == meeting["id"]
    assert feed.get_json()[0]["type"] == "book-club"

    groups.set_enabled_modules("andre", TEST_GROUP_ID, [])
    preserved = client.get(grouped_path("/api/feed?type=book-club")).get_json()
    assert preserved[0]["id"] == meeting["id"]


def test_non_admin_cannot_create_or_complete_meetings(client):
    meeting = create_meeting(client).get_json()["meeting"]
    create = client.post(
        grouped_path("/api/book-club/meetings", user_id="sheryl"),
        json={"readingTarget": "C", "scheduledAt": FUTURE},
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
    assert group["enabledModules"] == ["spotify", "book-club", "forums"]


def test_local_book_club_seed_uses_catalog_book_and_is_idempotent(
    client, monkeypatch
):
    monkeypatch.setenv("DYNAMODB_ENDPOINT", "http://dynamodb-local:8000")
    seed.seed_local_groups()

    seed.seed_local_book_club()
    seed.seed_local_book_club()

    members = db.get_all(seed.BOOK_CLUB_GROUP_ID)
    summary = book_club.summary(seed.BOOK_CLUB_GROUP_ID, members)
    books = book_club.list_books(seed.BOOK_CLUB_GROUP_ID)
    seeded_books = [book for book in books if book["title"] == "The Fifth Season"]
    assert len(seeded_books) == 1
    assert summary["activeBook"]["id"] == seeded_books[0]["id"]
    assert summary["openMeeting"]["bookId"] == seeded_books[0]["id"]
    assert summary["openMeeting"]["bookOwnerId"] == "kayla"
