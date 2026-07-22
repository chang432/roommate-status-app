"""Household request and checklist API tests."""

from testing.support import *  # noqa: F403

def test_create_request_targets_roommates_and_notifies_them(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)

    res = _make_request(client, "  Please grab milk  ", requested_ids=["kayla", "ting"])

    assert res.status_code == 200
    request_item = res.get_json()[0]
    assert request_item["text"] == "Please grab milk"
    assert request_item["requester"] == "Andre"
    assert request_item["requesterId"] == "andre"
    assert request_item["requestedIds"] == ["kayla", "ting"]
    assert request_item["requested"] == [
        {"id": "kayla", "name": "Kayla", "response": "pending"},
        {"id": "ting", "name": "Ting", "response": "pending"},
    ]
    assert request_item["isArchived"] is False
    assert request_item["archivedAt"] is None
    assert client.get(grouped_path("/api/activities")).get_json() == []
    request_url = f"/?module=requests&item={request_item['id']}&groupId=yorkshire"
    assert calls == [
        (
            "users",
            {
                "user_ids": {"kayla", "ting"},
                "title": "New request",
                "body": "Andre requested: Please grab milk",
                "url": request_url,
                "event_type": "requests-changed",
            },
        )
    ]


def test_create_request_rejects_empty_invalid_and_self_only(client):
    assert _make_request(client, "   ").status_code == 400
    assert _make_request(client, requester_id="ghost").status_code == 400
    assert _make_request(client, requested_ids=["ghost"]).status_code == 400
    assert _make_request(client, requested_ids=["andre"]).status_code == 400


def test_requested_roommate_can_accept_or_deny(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla", "ting"]).get_json()[0]
    calls = _capture_notifications(monkeypatch)

    accepted = client.post(
        f"/api/requests/{request_item['id']}/responses",
        json={"userId": "kayla", "response": "accepted"},
    )

    assert accepted.status_code == 200
    updated = accepted.get_json()[0]
    assert next(person for person in updated["requested"] if person["id"] == "kayla")[
        "response"
    ] == "accepted"
    assert calls[-1] == (
        "users",
        {
            "user_ids": {"andre"},
            "exclude_user_ids": {"kayla"},
            "title": "Request response",
            "body": "Kayla accepted “Please take out recycling”",
            "url": f"/?module=requests&item={request_item['id']}&groupId=yorkshire",
            "event_type": "requests-changed",
        },
    )

    denied = client.post(
        f"/api/requests/{request_item['id']}/responses",
        json={"userId": "ting", "response": "denied"},
    )
    assert denied.status_code == 200
    assert next(person for person in denied.get_json()[0]["requested"] if person["id"] == "ting")[
        "response"
    ] == "denied"


def test_request_response_requires_requested_roommate(client):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    not_requested = client.post(
        f"/api/requests/{request_item['id']}/responses",
        json={"userId": "ting", "response": "accepted"},
    )
    invalid_response = client.post(
        f"/api/requests/{request_item['id']}/responses",
        json={"userId": "kayla", "response": "maybe"},
    )
    assert not_requested.status_code == 404
    assert invalid_response.status_code == 400


def test_any_roommate_can_archive_request_and_notify_requester(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    calls = _capture_notifications(monkeypatch)

    completed = client.post(
        f"/api/requests/{request_item['id']}/archive",
        json={"userId": "ting"},
    )

    assert completed.status_code == 200
    updated = completed.get_json()[0]
    assert updated["isArchived"] is True
    assert updated["archivedById"] == "ting"
    assert updated["archivedBy"] == "Ting"
    assert isinstance(updated["archivedAt"], int)
    assert calls == [
        (
            "users",
            {
                "user_ids": {"andre", "kayla"},
                "exclude_user_ids": {"ting"},
                "title": "Request archived",
                "body": "Ting archived “Please take out recycling”",
                "url": f"/?module=requests&item={request_item['id']}&groupId=yorkshire",
                "event_type": "requests-changed",
            },
        )
    ]


def test_any_roommate_can_restore_archived_request(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    client.post(
        f"/api/requests/{request_item['id']}/archive",
        json={"userId": "kayla"},
    )
    calls = _capture_notifications(monkeypatch)

    reopened = client.post(
        f"/api/requests/{request_item['id']}/restore",
        json={"userId": "ting"},
    )

    assert reopened.status_code == 200
    updated = reopened.get_json()[0]
    assert updated["isArchived"] is False
    assert updated["archivedAt"] is None
    assert updated["archivedBy"] is None
    assert updated["archivedById"] is None
    assert calls == [
        (
            "users",
            {
                "user_ids": {"andre", "kayla"},
                "exclude_user_ids": {"ting"},
                "title": "Request restored",
                "body": "Ting restored “Please take out recycling”",
                "url": f"/?module=requests&item={request_item['id']}&groupId=yorkshire",
                "event_type": "requests-changed",
            },
        )
    ]


def test_requester_can_delete_request_and_comment_likes(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    posted = client.post(
        f"/api/requests/{request_item['id']}/comments",
        json={"authorId": "kayla", "text": "Sure"},
    )
    comment_id = posted.get_json()[0]["comments"][0]["id"]
    client.put(
        f"/api/requests/{request_item['id']}/comments/{comment_id}/likes",
        json={"userId": "andre"},
    )
    calls = _capture_notifications(monkeypatch)

    deleted = client.delete(
        f"/api/requests/{request_item['id']}",
        json={"requesterId": "andre"},
    )

    assert deleted.status_code == 200
    assert deleted.get_json() == []
    assert household_requests.get(request_item["id"], TEST_GROUP_ID, consistent=True) is None
    assert not [
        like
        for like in comment_likes.list_for_group(TEST_GROUP_ID, consistent=True)
        if like.get("requestId") == request_item["id"]
    ]
    assert calls == [
        (
            "users",
            {
                "user_ids": {"andre", "kayla"},
                "exclude_user_ids": {"andre"},
                "title": "Request deleted",
                "body": "Andre deleted “Please take out recycling”",
                "url": "/?module=requests&groupId=yorkshire",
                "event_type": "requests-changed",
            },
        )
    ]


def test_any_roommate_can_delete_request(client):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]

    deleted = client.delete(
        f"/api/requests/{request_item['id']}",
        json={"requesterId": "kayla"},
    )

    assert deleted.status_code == 200
    assert household_requests.get(request_item["id"], TEST_GROUP_ID, consistent=True) is None


def test_request_comments_and_likes_match_activity_shape(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    calls = _capture_notifications(monkeypatch)

    posted = client.post(
        f"/api/requests/{request_item['id']}/comments",
        json={"authorId": "kayla", "text": "I can do this"},
    )

    assert posted.status_code == 200
    comment = posted.get_json()[0]["comments"][0]
    assert comment["author"] == "Kayla"
    assert comment["authorId"] == "kayla"
    assert comment["text"] == "I can do this"
    assert comment["likeCount"] == 0
    assert calls[-1] == (
        "users",
        {
            "user_ids": {"andre"},
            "title": "New request comment",
            "body": "Kayla on “Please take out recycling”: I can do this",
            "url": f"/?module=requests&item={request_item['id']}&groupId=yorkshire",
            "event_type": "requests-changed",
        },
    )

    liked = client.put(
        f"/api/requests/{request_item['id']}/comments/{comment['id']}/likes",
        json={"userId": "andre"},
    )
    assert liked.status_code == 200
    assert liked.get_json()[0]["comments"][0]["likedByIds"] == ["andre"]


def test_request_comment_mentions_target_named_users(client, monkeypatch):
    request_item = _make_request(client, requested_ids=["kayla"]).get_json()[0]
    calls = _capture_notifications(monkeypatch)

    posted = client.post(
        f"/api/requests/{request_item['id']}/comments",
        json={"authorId": "kayla", "text": "@Ting can you help?"},
    )

    assert posted.status_code == 200
    assert posted.get_json()[0]["comments"][0]["mentions"] == [
        {"id": "ting", "name": "Ting"}
    ]
    assert calls[0] == (
        "users",
        {
            "user_ids": {"ting"},
            "title": "Kayla mentioned you",
            "body": "On request “Please take out recycling”: @Ting can you help?",
            "url": f"/?module=requests&item={request_item['id']}&groupId=yorkshire",
            "event_type": "requests-changed",
        },
    )
    assert calls[1][1]["user_ids"] == {"andre"}


def test_create_checklist_returns_active_list_and_notifies_household(client, monkeypatch):
    calls = _capture_notifications(monkeypatch)

    res = _make_checklist(client, title="  Kitchen reset  ", items=[" Counters ", "", "Trash"])

    assert res.status_code == 200
    checklist = res.get_json()[0]
    assert checklist["title"] == "Kitchen reset"
    assert checklist["createdBy"] == "Andre"
    assert checklist["createdById"] == "andre"
    assert [item["text"] for item in checklist["items"]] == ["Counters", "Trash"]
    assert checklist["items"][0]["checkedBy"] == []
    assert checklist["isArchived"] is False
    assert client.get(grouped_path("/api/activities")).get_json() == []
    assert calls == [
        (
            "all",
            {
                "title": "New checklist",
                "body": "Andre posted “Kitchen reset”",
                "url": f"/?module=checklists&item={checklist['id']}&groupId=yorkshire",
                "event_type": "checklists-changed",
                "exclude_user_ids": {"andre"},
            },
        )
    ]


def test_create_checklist_rejects_invalid_payloads(client):
    assert _make_checklist(client, title="   ").status_code == 400
    assert _make_checklist(client, created_by_id="ghost").status_code == 400
    assert _make_checklist(client, items=[]).status_code == 400
    assert _make_checklist(client, items="not-a-list").status_code == 400


def test_checklist_items_can_be_checked_by_multiple_roommates(client):
    checklist = _make_checklist(client).get_json()[0]
    item_id = checklist["items"][0]["id"]

    kayla = client.post(
        f"/api/checklists/{checklist['id']}/items/{item_id}/toggle",
        json={"userId": "kayla"},
    )
    ting = client.post(
        f"/api/checklists/{checklist['id']}/items/{item_id}/toggle",
        json={"userId": "ting"},
    )

    assert kayla.status_code == 200
    assert ting.status_code == 200
    checked_item = ting.get_json()[0]["items"][0]
    assert checked_item["checkedByIds"] == ["kayla", "ting"]
    assert checked_item["checkedBy"] == [
        {"id": "kayla", "name": "Kayla"},
        {"id": "ting", "name": "Ting"},
    ]

    unchecked = client.post(
        f"/api/checklists/{checklist['id']}/items/{item_id}/toggle",
        json={"userId": "kayla"},
    )
    assert unchecked.get_json()[0]["items"][0]["checkedByIds"] == ["ting"]


def test_checklist_items_can_be_added_edited_and_deleted(client):
    checklist = _make_checklist(client).get_json()[0]

    added = client.post(
        f"/api/checklists/{checklist['id']}/items",
        json={"userId": "kayla", "text": "  Mop  "},
    )
    added_item = added.get_json()[0]["items"][-1]
    assert added.status_code == 200
    assert added_item["text"] == "Mop"

    edited = client.patch(
        f"/api/checklists/{checklist['id']}/items/{added_item['id']}",
        json={"userId": "ting", "text": "Mop kitchen"},
    )
    assert edited.status_code == 200
    assert edited.get_json()[0]["items"][-1]["text"] == "Mop kitchen"

    deleted = client.delete(
        f"/api/checklists/{checklist['id']}/items/{added_item['id']}",
        json={"userId": "andre"},
    )
    assert deleted.status_code == 200
    assert [item["text"] for item in deleted.get_json()[0]["items"]] == [
        "Vacuum",
        "Take bins out",
    ]


def test_checklist_notify_all_excludes_requester(client, monkeypatch):
    checklist = _make_checklist(client).get_json()[0]
    calls = _capture_notifications(monkeypatch)
    monkeypatch.setattr(push, "is_configured", lambda: True)

    res = client.post(
        f"/api/checklists/{checklist['id']}/notify",
        json={"requesterId": "kayla"},
    )

    assert res.status_code == 200
    assert calls == [
        (
            "all",
            {
                "title": "Checklist reminder",
                "body": "Kayla reminded everyone to update “Costco Run”",
                "url": f"/?module=checklists&item={checklist['id']}&groupId=yorkshire",
                "event_type": "checklists-changed",
                "exclude_user_ids": {"kayla"},
            },
        )
    ]


def test_archive_checklist_flags_it_but_keeps_it_in_feed(client, monkeypatch):
    checklist = _make_checklist(client).get_json()[0]
    calls = _capture_notifications(monkeypatch)

    archived = client.post(
        f"/api/checklists/{checklist['id']}/archive",
        json={"userId": "ting"},
    )

    assert archived.status_code == 200
    returned = archived.get_json()
    assert [item["id"] for item in returned] == [checklist["id"]]
    assert returned[0]["isArchived"] is True
    stored = household_checklists.get(checklist["id"], TEST_GROUP_ID, consistent=True)
    assert stored["isArchived"] is True
    assert stored["archivedBy"] == "Ting"
    assert calls == [
        (
            "all",
            {
                "title": "Checklist archived",
                "body": "Ting archived “Costco Run”",
                "url": f"/?module=checklists&item={checklist['id']}&groupId=yorkshire",
                "event_type": "checklists-changed",
                "exclude_user_ids": {"ting"},
            },
        )
    ]
