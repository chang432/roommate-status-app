"""Account authentication and session API tests."""

from testing.support import *  # noqa: F403

def test_module_url_builds_canonical_encoded_destinations():
    assert module_models.module_url("requests", "request 1") == (
        "/?module=requests&item=request+1"
    )
    assert module_models.module_url("spotify", "activeJam#shire") == (
        "/?module=spotify&item=activeJam%23shire"
    )
    assert module_models.module_url("tv") == "/?module=tv"
    assert module_models.module_url(
        "book-club", "meeting#1", "forum#meeting-1#topic"
    ) == (
        "/book-club?meeting=meeting%231&thread=forum%23meeting-1%23topic"
    )
    with pytest.raises(ValueError, match="Unknown module type"):
        module_models.module_url("unknown", "item")


def test_login_success(client):
    res = client.post("/api/login", json={"username": "sheryl", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json() == {
        "user": {
            "id": "sheryl",
            "name": "Sheryl",
            "username": "sheryl",
            "groupId": db.DEFAULT_GROUP_ID,
            "hasGroup": True,
        }
    }


def test_login_normalizes_username(client):
    res = client.post("/api/login", json={"username": "  sHeRyL ", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json()["user"]["id"] == "sheryl"


def test_login_bad_password(client):
    res = client.post("/api/login", json={"username": "sheryl", "password": "nope"})
    assert res.status_code == 401
    assert "error" in res.get_json()


def test_login_unknown_username(client):
    res = client.post("/api/login", json={"username": "ghost", "password": "roomie"})
    assert res.status_code == 401



def test_create_account_stores_password_hash_and_waits_for_group(client):
    res = client.post(
        "/api/accounts",
        json={"username": " New_User ", "name": "New User", "password": "secret123"},
    )
    assert res.status_code == 201
    assert res.get_json() == {
        "user": {
            "id": "new_user",
            "name": "New User",
            "username": "new_user",
            "groupId": None,
            "hasGroup": False,
        }
    }

    raw = db._get_table().get_item(Key={"id": "new_user"}, ConsistentRead=True)["Item"]
    assert raw["passwordHash"] != "secret123"
    assert "passwordHash" not in res.get_json()["user"]

    roommates = client.get(grouped_path("/api/roommates")).get_json()
    assert all(roommate["id"] != "new_user" for roommate in roommates)


def test_create_account_rejects_duplicate_username(client):
    res = client.post(
        "/api/accounts",
        json={"username": "Andre", "name": "Other Andre", "password": "secret123"},
    )
    assert res.status_code == 409


def test_no_group_account_cannot_use_household_features(client):
    client.post(
        "/api/accounts",
        json={"username": "pending", "name": "Pending User", "password": "secret123"},
    )

    status = client.put(
        "/api/roommates/pending/status",
        json={"status": "available", "statusText": ""},
    )
    activity = client.post(
        "/api/activities",
        json={"text": "Sneak in", "proposedById": "pending"},
    )
    request = client.post(
        "/api/requests",
        json={"text": "Help", "requesterId": "pending", "requestedIds": ["andre"]},
    )

    assert status.status_code == 404
    assert activity.status_code == 400
    assert request.status_code == 400


def test_get_account_validates_stored_session(client):
    res = client.get("/api/accounts/andre")
    assert res.status_code == 200
    assert res.get_json()["user"] == {
        "id": "andre",
        "name": "Andre",
        "username": "andre",
        "groupId": db.DEFAULT_GROUP_ID,
        "hasGroup": True,
    }


def test_get_account_includes_pending_no_group_accounts(client):
    # Unlike /api/groups/current, session validation must accept accounts that
    # haven't joined a group yet, or a fresh signup would be logged out on load.
    client.post(
        "/api/accounts",
        json={"username": "pending", "name": "Pending User", "password": "secret123"},
    )
    res = client.get("/api/accounts/pending")
    assert res.status_code == 200
    assert res.get_json()["user"]["hasGroup"] is False


def test_get_account_unknown_user_flags_invalid_user(client):
    res = client.get("/api/accounts/ghost")
    assert res.status_code == 404
    assert res.get_json()["code"] == "invalid_user"


def test_stale_session_reads_carry_invalid_user_code(client):
    # The frontend auto-logs-out on this code (frontend/src/api/client.js).
    for path in ("/api/roommates", "/api/activities"):
        res = client.get(grouped_path(path, user_id="ghost"))
        assert res.status_code == 400
        assert res.get_json()["code"] == "invalid_user"


def test_delete_account_removes_roommate_and_push_subscriptions(client):
    push._get_table().put_item(
        Item={
            "id": "sub-delete-me",
            "endpoint": "https://example.test/delete-me",
            "userId": "andre",
            "subscription": json.dumps({"endpoint": "https://example.test/delete-me"}),
        }
    )

    denied = client.delete("/api/accounts/andre", json={"password": "nope"})
    deleted = client.delete("/api/accounts/andre", json={"password": "roomie"})

    assert denied.status_code == 401
    assert deleted.status_code == 200
    assert deleted.get_json() == {"ok": True}
    assert db.get_account_by_id("andre") is None
    assert push._get_table().get_item(Key={"id": "sub-delete-me"}).get("Item") is None
