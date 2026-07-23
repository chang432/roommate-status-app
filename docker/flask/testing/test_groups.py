"""Group membership and group-administration API tests."""

from testing.support import *  # noqa: F403


def test_group_memberships_switch_status_scope_with_request_header(client):
    groups._get_table().put_item(
        Item={
            "groupId": "cedar-house",
            "name": "Cedar House",
            "joinCode": "CEDAR77",
            "createdAt": 1,
        }
    )

    joined = client.post("/api/groups/join", json={"userId": "andre", "code": "CEDAR77"})
    assert joined.status_code == 200
    assert joined.get_json()["group"]["groupId"] == "cedar-house"

    listed = client.get("/api/groups?userId=andre").get_json()["groups"]
    assert [group["groupId"] for group in listed] == ["cedar-house", "yorkshire"]

    cedar_headers = {"X-Roomie-Group-ID": "cedar-house"}
    cedar_roster = client.get("/api/roommates?userId=andre", headers=cedar_headers)
    assert [roommate["id"] for roommate in cedar_roster.get_json()] == ["andre"]

    updated = client.put(
        "/api/roommates/andre/status",
        headers=cedar_headers,
        json={"status": "available", "statusText": "At the cabin"},
    )
    assert updated.status_code == 200
    assert updated.get_json()[0]["statusText"] == "At the cabin"

    yorkshire = client.get(
        "/api/roommates?userId=andre",
        headers={"X-Roomie-Group-ID": "yorkshire"},
    ).get_json()
    assert next(roommate for roommate in yorkshire if roommate["id"] == "andre")["status"] == "busy"


def test_create_group_adds_creator_and_returns_an_invite_code(client):
    created = client.post(
        "/api/groups",
        json={"userId": "andre", "name": "Friday Cabin"},
    )

    assert created.status_code == 201
    payload = created.get_json()
    group = payload["group"]
    assert group["name"] == "Friday Cabin"
    assert group["groupId"].startswith("friday-cabin-")
    assert len(group["joinCode"]) == 8
    assert group["joinCode"].isalnum()
    assert group["showRoster"] is False
    assert group["showFeed"] is False
    assert group["showBookClub"] is False
    assert payload["user"]["groupId"] == group["groupId"]

    roster = client.get(
        "/api/roommates?userId=andre",
        headers={"X-Roomie-Group-ID": group["groupId"]},
    )
    assert roster.get_json() == [
        {
            "id": "andre",
            "name": "Andre",
            "status": "busy",
            "statusText": "",
            "statusUpdatedAt": None,
            # Whoever creates the household administers it.
            "role": "admin",
        }
    ]


def test_create_group_rejects_blank_name(client):
    created = client.post("/api/groups", json={"userId": "andre", "name": "   "})
    assert created.status_code == 400


def test_admin_updates_group_display_for_every_member(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")

    updated = client.put(
        "/api/groups/display?userId=andre",
        headers=headers,
        json={"showRoster": False, "showFeed": False, "showBookClub": False},
    )

    assert updated.status_code == 200
    assert updated.get_json()["group"] == {
        "groupId": group_id,
        "name": "Admin House",
        "joinCode": updated.get_json()["group"]["joinCode"],
        "createdAt": updated.get_json()["group"]["createdAt"],
        "showRoster": False,
        "showFeed": False,
        "showBookClub": False,
        "viewerIsAdmin": True,
    }
    member_view = client.get(
        "/api/groups/current?userId=sheryl", headers=headers
    ).get_json()["group"]
    assert member_view["showRoster"] is False
    assert member_view["showFeed"] is False
    assert member_view["showBookClub"] is False
    assert member_view["viewerIsAdmin"] is False

    admin_view = client.get(
        "/api/groups/current?userId=andre", headers=headers
    ).get_json()["group"]
    assert admin_view["viewerIsAdmin"] is True


def test_plain_member_cannot_change_group_display(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")

    updated = client.put(
        "/api/groups/display?userId=sheryl",
        headers=headers,
        json={"showRoster": False, "showFeed": True, "showBookClub": True},
    )

    assert updated.status_code == 403
    assert "Only a group admin" in updated.get_json()["error"]
    assert groups.get_group_by_id(group_id)["showRoster"] is False


def test_existing_group_defaults_display_sections_to_visible(client):
    groups._get_table().put_item(
        Item={
            "groupId": "legacy-house",
            "name": "Legacy House",
            "joinCode": "LEGACY77",
            "createdAt": 1,
        }
    )

    group = groups.get_group_by_id("legacy-house")

    assert group["showRoster"] is True
    assert group["showFeed"] is True
    assert group["showBookClub"] is True


def admin_group(client, creator="andre", name="Admin House"):
    """Create a group (creator becomes its admin) and return (group_id, headers)."""
    group_id = client.post(
        "/api/groups", json={"userId": creator, "name": name}
    ).get_json()["group"]["groupId"]
    return group_id, {"X-Roomie-Group-ID": group_id}


def join_as(client, group_id, user_id):
    """Add an existing seeded account to a group through its invite code."""
    code = groups.get_group_by_id(group_id)["joinCode"]
    assert client.post("/api/groups/join", json={"userId": user_id, "code": code}).status_code == 200


def role_of(client, group_id, headers, user_id, viewer="andre"):
    roster = client.get(f"/api/roommates?userId={viewer}", headers=headers).get_json()
    return next((r["role"] for r in roster if r["id"] == user_id), None)


def test_seeded_household_gives_andre_sole_admin(client):
    """Mirrors migration 2026-07-21-01, so a fresh DB matches a migrated one."""
    roster = client.get(grouped_path("/api/roommates")).get_json()

    assert {r["id"] for r in roster if r["role"] == "admin"} == {"andre"}
    assert len(roster) == 5


def test_joining_a_group_makes_a_plain_member(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")

    assert role_of(client, group_id, headers, "andre") == "admin"
    assert role_of(client, group_id, headers, "sheryl") == "member"


def test_joining_an_existing_book_club_appends_both_owner_lists(client):
    group_id, headers = admin_group(client)
    groups.set_display_options("andre", group_id, False, False, True)
    configured = client.post(
        "/api/book-club/meetings?userId=andre",
        headers=headers,
        json={
            "title": "A Book", "author": "An Author", "readingTarget": "Chapter 1",
            "scheduledAt": book_club.next_wednesday_evening(),
        },
    )
    assert configured.status_code == 201

    join_as(client, group_id, "sheryl")

    summary = client.get("/api/book-club?userId=andre", headers=headers).get_json()["summary"]
    assert summary["configuration"]["bookOwnerOrderUserIds"] == ["andre", "sheryl"]
    assert summary["configuration"]["snackOwnerOrderUserIds"] == ["andre", "sheryl"]
    assert summary["openMeeting"]["snackOwnerId"] == "andre"


def test_admin_removes_a_member_and_gets_the_new_roster(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")

    removed = client.delete("/api/groups/members/sheryl?userId=andre", headers=headers)

    assert removed.status_code == 200
    assert [r["id"] for r in removed.get_json()] == ["andre"]
    # Only the membership goes; the account and its other groups survive.
    assert client.get("/api/accounts/sheryl").status_code == 200
    assert "yorkshire" in db.get_group_ids("sheryl")


def test_plain_member_cannot_remove_or_promote_anyone(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")
    join_as(client, group_id, "kayla")

    removed = client.delete("/api/groups/members/kayla?userId=sheryl", headers=headers)
    promoted = client.put(
        "/api/groups/members/kayla/role?userId=sheryl", headers=headers, json={"role": "admin"}
    )

    assert removed.status_code == 403
    assert promoted.status_code == 403
    assert role_of(client, group_id, headers, "kayla") == "member"


def test_admin_promotes_a_member_who_can_then_administer(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")
    join_as(client, group_id, "kayla")

    promoted = client.put(
        "/api/groups/members/sheryl/role?userId=andre", headers=headers, json={"role": "admin"}
    )
    assert promoted.status_code == 200
    assert role_of(client, group_id, headers, "sheryl") == "admin"

    # The freshly promoted admin can now act on the group themselves.
    removed = client.delete("/api/groups/members/kayla?userId=sheryl", headers=headers)
    assert removed.status_code == 200
    assert [r["id"] for r in removed.get_json()] == ["andre", "sheryl"]


def test_admins_cannot_remove_each_other_or_themselves(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")
    client.put(
        "/api/groups/members/sheryl/role?userId=andre", headers=headers, json={"role": "admin"}
    )

    peer = client.delete("/api/groups/members/sheryl?userId=andre", headers=headers)
    own = client.delete("/api/groups/members/andre?userId=andre", headers=headers)

    assert peer.status_code == 409
    assert own.status_code == 400
    assert [r["id"] for r in client.get(
        "/api/roommates?userId=andre", headers=headers
    ).get_json()] == ["andre", "sheryl"]


def test_last_admin_cannot_step_down(client):
    group_id, headers = admin_group(client)
    join_as(client, group_id, "sheryl")

    demoted = client.put(
        "/api/groups/members/andre/role?userId=andre", headers=headers, json={"role": "member"}
    )

    assert demoted.status_code == 409
    assert role_of(client, group_id, headers, "andre") == "admin"

    # With a successor in place the same demotion is allowed.
    client.put(
        "/api/groups/members/sheryl/role?userId=andre", headers=headers, json={"role": "admin"}
    )
    stepped_down = client.put(
        "/api/groups/members/andre/role?userId=andre", headers=headers, json={"role": "member"}
    )
    assert stepped_down.status_code == 200
    assert role_of(client, group_id, headers, "andre") == "member"


def test_admin_rights_do_not_cross_groups(client):
    """Admin is per-membership: administering one household grants nothing elsewhere."""
    _, other_headers = admin_group(client, creator="sheryl", name="Cedar House")

    # andre administers the seeded household but is a stranger to the Cedar
    # House group sheryl just created.
    assert db.is_group_admin("andre", db.DEFAULT_GROUP_ID)
    res = client.delete("/api/groups/members/sheryl?userId=andre", headers=other_headers)

    assert res.status_code == 400
    assert res.get_json()["code"] == "invalid_user"


def test_member_admin_routes_reject_unknown_targets_and_roles(client):
    group_id, headers = admin_group(client)

    missing = client.delete("/api/groups/members/ghost?userId=andre", headers=headers)
    bad_role = client.put(
        "/api/groups/members/andre/role?userId=andre", headers=headers, json={"role": "owner"}
    )

    assert missing.status_code == 404
    assert bad_role.status_code == 400
