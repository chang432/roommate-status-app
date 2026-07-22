"""Flask backend for the Yorkshire Roomie Status app.

Implements the endpoints the frontend calls (see frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name", "username",
                                             "groupId", "hasGroup" } }
    POST /api/accounts                 -> create a no-group account
    GET  /api/accounts/<id>            -> re-validate a stored session's account
    DELETE /api/accounts/<id>          -> delete an account after password check
    GET  /api/roommates                -> [ { "id", "name", "status", "statusText",
                                             "statusUpdatedAt" }, ... ]
    PUT  /api/roommates/<id>/status    -> the full, updated household list
    POST /api/roommates/notify         -> { "sent", "pruned", "failed" }
    POST /api/roommates/<id>/poke      -> { "sent", "pruned", "failed" }

Plus the Web Push endpoints:

    GET  /api/push/public-key          -> { "publicKey": <VAPID public key> }
    POST /api/push/subscribe           -> { "ok": true }  (stores a user-owned subscription)

And the proposed-activities feed:

    GET  /api/activities               -> current + expired activity history
    POST /api/activities               -> the updated activity list (and pushes it)
    POST /api/activities/<id>/archive  -> the updated activity list
    POST /api/activities/<id>/restore  -> the updated activity list
    DELETE /api/activities/<id>        -> the updated activity list
    POST /api/activities/<id>/start    -> the updated activity list (and pushes it)
    POST /api/activities/<id>/end      -> the updated activity list (and pushes it)
    POST /api/activities/<id>/join     -> the updated activity list (and pushes it)
    POST /api/activities/<id>/leave    -> the updated activity list
    POST /api/activities/<id>/comments -> the updated activity list (and pushes it)
    PUT/DELETE /api/activities/<id>/comments/<comment_id>/likes
                                        -> the updated activity list

And the shire request feed:

    POST /api/requests                 -> the updated recent request list
    POST /api/requests/<id>/responses  -> the updated recent request list
    POST /api/requests/<id>/archive    -> the updated recent request list
    POST /api/requests/<id>/restore    -> the updated recent request list
    DELETE /api/requests/<id>          -> the updated recent request list
    POST /api/requests/<id>/comments   -> the updated recent request list
    PUT/DELETE /api/requests/<id>/comments/<comment_id>/likes
                                       -> the updated recent request list

And the shire checklist feed:

    POST /api/checklists               -> the updated recent checklist list
    POST /api/checklists/<id>/notify   -> push a checklist reminder to everyone else
    POST /api/checklists/<id>/items    -> the updated recent checklist list
    POST /api/checklists/<id>/items/<item_id>/toggle
                                       -> the updated recent checklist list
    PATCH/DELETE /api/checklists/<id>/items/<item_id>
                                       -> the updated recent checklist list
    POST /api/checklists/<id>/archive  -> the updated recent checklist list
    POST /api/checklists/<id>/restore  -> the updated recent checklist list
    DELETE /api/checklists/<id>        -> the updated recent checklist list

And the shire Spotify Jam widget:

    GET  /api/jam                      -> active Jam link
    POST /api/jam                      -> active Jam link, replacing any prior one
    DELETE /api/jam                    -> remove the active Jam

Roommate data is backed by DynamoDB via db.py; push subscriptions + sending are
in push.py; proposals are in activities.py; requests are in household_requests.py;
checklists are in household_checklists.py; Jam state is in jam.py. Routes stay
storage-agnostic.
"""

from __future__ import annotations

import os
import re
from urllib.parse import quote

from flask import Flask, g, jsonify, request
from flask_cors import CORS

import activities
import book_club
import db
import groups
import household_checklists
import household_requests
import household_shows
import jam
import module_edits
import module_models
import push

# Cap proposal/request/checklist text so a notification body stays sane.
MAX_ACTIVITY_LEN = 280

# Cap comment text the same way proposal text is capped.
MAX_COMMENT_LEN = 280

# Number of available roommates that triggers the "gather" push (PROJECT.md:
# "3 or more"). Override with the AVAILABLE_THRESHOLD env var.
PUSH_THRESHOLD = int(os.environ.get("AVAILABLE_THRESHOLD", "3"))


def mentions_all(text: str) -> bool:
    """Return whether text contains the reserved @all mention token."""
    return re.search(r"(?<![\w@])@all(?=$|[^\w])", text, flags=re.IGNORECASE) is not None


def resolve_mentions(text: str, roommates: list[dict], author_id: str) -> list[dict]:
    """Resolve valid @display-name tokens to canonical household identities."""
    candidates = []
    for roommate in sorted(roommates, key=lambda item: len(item["name"]), reverse=True):
        if roommate["id"] == author_id:
            continue
        # Treat names as mentions only at token boundaries, avoiding accidental
        # matches inside email-like text or longer words.
        pattern = rf"(?<![\w@])@{re.escape(roommate['name'])}(?=$|[^\w])"
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            candidates.append((match.start(), match.end(), roommate))

    # Prefer the longest name when household names overlap at the same text
    # position, then deduplicate repeated mentions while preserving text order.
    candidates.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    resolved = []
    used_ids = set()
    occupied_until = -1
    for start, end, roommate in candidates:
        if start < occupied_until:
            continue
        occupied_until = end
        if roommate["id"] not in used_ids:
            resolved.append({"id": roommate["id"], "name": roommate["name"]})
            used_ids.add(roommate["id"])
    return resolved


def optional_epoch_millis(body: dict, field: str) -> tuple[int | None, str | None]:
    """Parse a nullable epoch-millisecond field without accepting booleans."""
    value = body.get(field)
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, int):
        return None, f"{field} must be an epoch-millisecond timestamp or null."
    parsed = int(value)
    if parsed < 0:
        return None, f"{field} must be an epoch-millisecond timestamp or null."
    return parsed, None


def validate_activity_schedule(body: dict) -> tuple[int | None, int | None, str | None]:
    start_at, error = optional_epoch_millis(body, "startAt")
    if error:
        return None, None, error
    end_at, error = optional_epoch_millis(body, "endAt")
    if error:
        return None, None, error
    if end_at is not None and start_at is None:
        return None, None, "An end time requires a start time."
    if start_at is not None and end_at is not None and end_at <= start_at:
        return None, None, "End time must be later than start time."
    return start_at, end_at, None


def invalid_user_response() -> tuple:
    """400 for a userId that doesn't resolve to a grouped account.

    The machine-readable `code` lets the frontend distinguish a dead session
    (e.g. the local in-memory DB was wiped) from other 400s and auto-logout.
    """
    return jsonify({"error": "A valid roommate is required.", "code": "invalid_user"}), 400


def group_member_from_query() -> tuple[dict | None, tuple | None]:
    user_id = (request.args.get("userId") or "").strip()
    member = db.get_group_member(user_id) if user_id else None
    if member is None:
        return None, invalid_user_response()
    return member, None


def group_user_ids(group_id: str) -> set[str]:
    return set(db.get_group_user_ids(group_id, consistent=True))


def notify_group(
    group_id: str,
    title: str,
    body: str,
    url: str = "/",
    event_type: str | None = None,
    exclude_user_ids: set[str] | None = None,
) -> dict:
    return push.notify_users(
        user_ids=group_user_ids(group_id),
        title=title,
        body=body,
        url=group_url(group_id, url),
        event_type=event_type,
        exclude_user_ids=exclude_user_ids,
    )


def group_url(group_id: str, url: str = "/") -> str:
    """Keep notification deep links in the household that generated them."""
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}groupId={quote(group_id)}"


def _activity_status_overrides(group_id: str, consistent: bool = False) -> dict[str, dict]:
    """Return the latest live activity-driven status per participant."""
    overrides: dict[str, dict] = {}
    for activity in activities.list_recent(group_id, consistent=consistent):
        member_ids = activity.get("memberIds") or []
        if activity.get("isLive"):
            timestamp = activity.get("liveStartedAt") or activity.get("startAt") or 0
            for user_id in member_ids:
                current = overrides.get(user_id)
                if current is None or current["kind"] != "live" or timestamp > current["timestamp"]:
                    overrides[user_id] = {"kind": "live", "timestamp": timestamp}
    return overrides


def effective_available_count(group_id: str, roommates: list[dict]) -> int:
    """Count available roommates after applying activity-driven status overlays."""
    overrides = _activity_status_overrides(group_id, consistent=True)
    available = 0
    for roommate in roommates:
        if roommate["status"] != "available":
            continue
        override = overrides.get(roommate["id"])
        if override is None:
            available += 1
    return available


def create_app() -> Flask:
    """Application factory so tests can build isolated app instances."""
    app = Flask(__name__)

    # Allow the Vite dev server (and any other origin) to call the API directly.
    # In production the frontend is served behind the same proxy, but permissive
    # CORS keeps local development friction-free.
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.before_request
    def ensure_group_state():
        """Scope this request to the caller's selected household.

        One-time data setup deliberately does not live here: the seeded group is
        created on demand by groups.get_group_by_id/get_group_by_code and by
        seed.py, and backfilling rows that predate a schema change is the
        migration runner's job (infrastructure/migrations/), not something every
        request should re-check.
        """
        if request.path.startswith("/api/"):
            g.request_group_token = db.set_request_group_id(
                request.headers.get("X-Roomie-Group-ID")
            )

    @app.teardown_request
    def clear_request_group_state(_error):
        token = getattr(g, "request_group_token", None)
        if token is not None:
            db.reset_request_group_id(token)

    @app.get("/api/health")
    def health():
        """Simple liveness probe for Docker / load balancers."""
        return jsonify({"status": "ok"})

    @app.post("/api/login")
    def login():
        """Validate a username + password and return the signed-in account."""
        body = request.get_json(silent=True) or {}
        username = body.get("username", "")
        password = body.get("password", "")

        user = db.authenticate(username, password)
        if user is None:
            return jsonify({"error": "That username and password don’t match."}), 401

        return jsonify({"user": user})

    @app.post("/api/accounts")
    def create_account():
        """Create a signed-in account that cannot use household features yet."""
        body = request.get_json(silent=True) or {}
        user, error = db.create_account(
            body.get("username", ""),
            body.get("name", ""),
            body.get("password", ""),
        )
        if error == "invalid_username":
            return (
                jsonify(
                    {
                        "error": (
                            "Username must be 3-32 characters: lowercase letters, "
                            "numbers, underscores, or hyphens."
                        )
                    }
                ),
                400,
            )
        if error == "invalid_name":
            return jsonify({"error": "A display name is required."}), 400
        if error == "invalid_password":
            return jsonify({"error": "Password must be at least 6 characters."}), 400
        if error == "duplicate_username":
            return jsonify({"error": "That username is already taken."}), 409
        return jsonify({"user": user}), 201

    @app.get("/api/accounts/<user_id>")
    def get_account(user_id: str):
        """Return one account (grouped or not) so the frontend can re-validate
        a stored session — e.g. after the local in-memory DB was reseeded."""
        account = db.get_account_by_id(db.normalize_username(user_id))
        if account is None:
            return jsonify({"error": "That account no longer exists.", "code": "invalid_user"}), 404
        return jsonify({"user": account})

    @app.delete("/api/accounts/<user_id>")
    def delete_account(user_id: str):
        """Delete an account and its browser push subscriptions."""
        body = request.get_json(silent=True) or {}
        if not db.delete_account(user_id, body.get("password", "")):
            return jsonify({"error": "Could not verify that account and password."}), 401
        push.delete_user_subscriptions(db.normalize_username(user_id))
        return jsonify({"ok": True})

    @app.post("/api/groups/join")
    def join_group():
        """Assign a pending account to the household behind a reusable code."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        code = body.get("code", "")
        user, error = groups.join_group(user_id, code)
        if error == "invalid_code":
            return jsonify({"error": "Enter a valid group code."}), 400
        if error == "unknown_code":
            return jsonify({"error": "That group code was not recognized."}), 404
        if error == "already_member":
            return jsonify({"error": "This account already belongs to that group."}), 409
        if error == "unknown_user" or user is None:
            return jsonify({"error": "A valid account is required."}), 400
        group = groups.get_group_by_id(user["groupId"])
        return jsonify({"user": user, "group": group})

    @app.post("/api/groups")
    def create_group():
        """Create a group and make its creator the first member."""
        body = request.get_json(silent=True) or {}
        user, group, error = groups.create_group(
            (body.get("userId") or "").strip(),
            body.get("name", ""),
        )
        if error == "invalid_name":
            return jsonify({"error": "Enter a group name up to 80 characters."}), 400
        if error == "unknown_user":
            return invalid_user_response()
        if error or user is None or group is None:
            return jsonify({"error": "Could not create that group. Try again."}), 500
        return jsonify({"user": user, "group": group}), 201

    @app.get("/api/groups")
    def get_groups():
        """Return every group the account can select in the home drawer."""
        user_id = (request.args.get("userId") or "").strip()
        if db.get_account_by_id(user_id) is None:
            return invalid_user_response()
        return jsonify({"groups": groups.list_groups_for_user(user_id)})

    @app.get("/api/groups/current")
    def get_current_group():
        """Return the signed-in user's current group metadata."""
        user_id = (request.args.get("userId") or "").strip()
        user = db.get_group_member(user_id) if user_id else None
        if user is None:
            return invalid_user_response()
        group = groups.get_group_by_id(user["groupId"])
        if group is None:
            return jsonify({"error": "That group no longer exists."}), 404
        # This permission belongs to the selected membership, not the account.
        # Returning it with the selected group lets profile controls render
        # correctly even while the separate roster request is still in flight.
        return jsonify(
            {
                "group": {
                    **group,
                    "viewerIsAdmin": db.is_group_admin(user["id"], user["groupId"]),
                }
            }
        )

    @app.put("/api/groups/display")
    def update_group_display():
        """Let any admin choose which shared sections their group sees."""
        actor, error = group_member_from_query()
        if error:
            return error
        body = request.get_json(silent=True) or {}
        show_roster = body.get("showRoster")
        show_feed = body.get("showFeed")
        show_book_club = body.get("showBookClub")
        if not all(
            isinstance(value, bool)
            for value in (show_roster, show_feed, show_book_club)
        ):
            return jsonify({"error": "Display settings must be true or false."}), 400
        group, error = groups.set_display_options(
            actor["id"],
            actor["groupId"],
            show_roster,
            show_feed,
            show_book_club,
        )
        if error == "forbidden":
            return jsonify({"error": "Only a group admin can change display settings."}), 403
        if error == "unknown_group" or group is None:
            return jsonify({"error": "That group no longer exists."}), 404
        return jsonify({"group": {**group, "viewerIsAdmin": True}})

    # Admin-only member administration. Both routes resolve the actor from the
    # request's group scope, so an admin of one household gains nothing in
    # another. Each returns the updated roster the caller already renders.
    MEMBER_ADMIN_ERRORS = {
        "forbidden": ("Only a group admin can manage members.", 403),
        "unknown_member": ("That roommate is not in this group.", 404),
        "self_removal": ("You cannot remove yourself from the group.", 400),
        "admin_target": ("Remove admin from that roommate before removing them.", 409),
        "last_admin": ("Promote another admin before stepping down.", 409),
        "invalid_role": (f"Role must be one of {sorted(db.VALID_ROLES)}.", 400),
    }

    def member_admin_response(error: str | None, group_id: str):
        if error:
            message, status = MEMBER_ADMIN_ERRORS.get(
                error, ("Could not update that member.", 400)
            )
            return jsonify({"error": message}), status
        return jsonify(db.get_all(group_id, consistent=True))

    @app.delete("/api/groups/members/<user_id>")
    def remove_group_member(user_id: str):
        """Remove another roommate from the actor's current group."""
        actor, error = group_member_from_query()
        if error:
            return error
        return member_admin_response(
            groups.remove_member(actor["id"], actor["groupId"], user_id),
            actor["groupId"],
        )

    @app.put("/api/groups/members/<user_id>/role")
    def update_group_member_role(user_id: str):
        """Grant or revoke admin on another roommate in the actor's group."""
        actor, error = group_member_from_query()
        if error:
            return error
        body = request.get_json(silent=True) or {}
        return member_admin_response(
            groups.set_member_role(
                actor["id"], actor["groupId"], user_id, body.get("role", "")
            ),
            actor["groupId"],
        )

    @app.get("/api/roommates")
    def get_roommates():
        """Return the whole household with their current statuses."""
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify(db.get_all(viewer["groupId"]))

    @app.put("/api/roommates/<roommate_id>/status")
    def update_status(roommate_id: str):
        """Update one roommate's status and return the updated household."""
        body = request.get_json(silent=True) or {}
        status = body.get("status")
        status_text = (body.get("statusText") or "").strip()

        if status not in db.VALID_STATUSES:
            return (
                jsonify({"error": f"Invalid status. Expected one of {sorted(db.VALID_STATUSES)}."}),
                400,
            )

        roommate = db.get_group_member(roommate_id)
        if roommate is None:
            return jsonify({"error": f"Unknown roommate: {roommate_id}"}), 404

        roommates = db.update_status(roommate_id, roommate["groupId"], status, status_text)
        if roommates is None:
            return jsonify({"error": f"Unknown roommate: {roommate_id}"}), 404

        # When enough roommates are free, push a "gather!" notification to every
        # subscribed device. Sending is best-effort: a push failure must not
        # fail the status update the user just made.
        free = effective_available_count(roommate["groupId"], roommates)
        if free >= PUSH_THRESHOLD:
            app.logger.info("Notification: %d roommates are available — time to gather!", free)
            try:
                notify_group(
                    roommate["groupId"],
                    title="Roomies are free!",
                    body=f"{free} roomies are free! LETS HANG 🎉!",
                    url="/",
                    exclude_user_ids={roommate_id},
                )
            except Exception:  # noqa: BLE001 - never let push break the request
                app.logger.exception("Failed to send gather notification")

        return jsonify(roommates)

    @app.post("/api/roommates/notify")
    def notify_roommates_to_update_status():
        """Push a household reminder to update statuses, excluding the requester."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return invalid_user_response()
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = notify_group(
            requester["groupId"],
            title="Update your status",
            body=f"{requester['name']} wants to know what you're up to 👀",
            url="/",
            exclude_user_ids={requester["id"]},
        )
        return jsonify(result)

    @app.post("/api/roommates/<roommate_id>/poke")
    def poke_roommate(roommate_id: str):
        """Send one roommate a targeted reminder that opens their status editor."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        target = db.get_group_member(roommate_id, requester["groupId"]) if requester else None
        if requester is None or target is None:
            return jsonify({"error": "Valid requester and roommate are required."}), 400
        if requester["id"] == target["id"]:
            return jsonify({"error": "You cannot poke yourself."}), 400
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = push.notify_users(
            user_ids={target["id"]},
            title=f"{requester['name']} poked you 👋",
            body="Update your status so they know what you're up to.",
            url=f"/?updateStatus=1&groupId={quote(requester['groupId'])}",
        )
        if result["sent"] == 0:
            return (
                jsonify(
                    {
                        "error": (
                            f"Could not deliver the poke to {target['name']}. "
                            "They may not have notifications enabled."
                        )
                    }
                ),
                409,
            )
        return jsonify(result)

    # --- Web Push (PoC) -----------------------------------------------------
    @app.get("/api/push/public-key")
    def push_public_key():
        """Hand the browser the VAPID public key it needs to subscribe."""
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503
        return jsonify({"publicKey": push.VAPID_PUBLIC_KEY})

    @app.post("/api/push/subscribe")
    def push_subscribe():
        """Store a browser PushSubscription so we can notify this device."""
        body = request.get_json(silent=True) or {}
        subscription = body.get("subscription") or {}
        user_id = (body.get("userId") or "").strip()
        if not subscription.get("endpoint"):
            return jsonify({"error": "Invalid subscription (no endpoint)."}), 400
        if db.get_group_member(user_id) is None:
            return invalid_user_response()
        push.save_subscription(subscription, user_id)
        return jsonify({"ok": True})

    # --- Book Club ----------------------------------------------------------
    # Book Club is deliberately outside the module feed: its dedicated table
    # keeps long-lived reading history and discussion separate from ephemeral
    # household activity cards.
    @app.get("/api/book-club")
    def get_book_club():
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify({"summary": book_club.summary(
            viewer["groupId"], db.get_all(viewer["groupId"])
        )})

    @app.post("/api/book-club/config")
    def configure_book_club():
        viewer, error = group_member_from_query()
        if error:
            return error
        if not db.is_group_admin(viewer["id"], viewer["groupId"]):
            return jsonify({"error": "Only a group admin can configure Book Club."}), 403
        summary, error = book_club.configure(
            viewer["groupId"], db.get_all(viewer["groupId"]), request.get_json(silent=True) or {}
        )
        if error:
            return jsonify({"error": error}), 409 if error == "Book Club is already configured." else 400
        return jsonify({"summary": summary}), 201

    @app.put("/api/book-club/sessions/<session_id>/response")
    def update_book_club_response(session_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        body = request.get_json(silent=True) or {}
        _session, error = book_club.set_response(
            viewer["groupId"], session_id, viewer,
            body.get("attendanceStatus"), body.get("chaptersReadThrough"),
        )
        if error:
            return jsonify({"error": error}), 404 if error == "Unknown session." else 400
        return jsonify({"summary": book_club.summary(
            viewer["groupId"], db.get_all(viewer["groupId"])
        )})

    @app.put("/api/book-club/next-session")
    def update_book_club_next_session():
        """Let an admin fill or revise the upcoming meeting placeholder."""
        viewer, error = group_member_from_query()
        if error:
            return error
        if not db.is_group_admin(viewer["id"], viewer["groupId"]):
            return jsonify({"error": "Only a group admin can edit the next meeting."}), 403
        summary, error = book_club.update_next_session(
            viewer["groupId"], db.get_all(viewer["groupId"]), request.get_json(silent=True) or {}
        )
        if error:
            return jsonify({"error": error}), 409 if error.startswith("This meeting") else 400
        return jsonify({"summary": summary})

    @app.post("/api/book-club/sessions/<session_id>/complete")
    def complete_book_club_session(session_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        if not db.is_group_admin(viewer["id"], viewer["groupId"]):
            return jsonify({"error": "Only a group admin can complete sessions."}), 403
        summary, error = book_club.complete_session(
            viewer["groupId"], db.get_all(viewer["groupId"]), session_id
        )
        if error:
            return jsonify({"error": error}), 404 if error.startswith("Unknown") else 409
        return jsonify({"summary": summary})

    @app.post("/api/book-club/sessions/<session_id>/complete-book")
    def complete_book_club_book(session_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        if not db.is_group_admin(viewer["id"], viewer["groupId"]):
            return jsonify({"error": "Only a group admin can complete books."}), 403
        error = book_club.complete_book(viewer["groupId"], session_id)
        if error:
            return jsonify({"error": error}), 404
        return jsonify({"summary": book_club.summary(
            viewer["groupId"], db.get_all(viewer["groupId"])
        )})

    @app.get("/api/book-club/books/completed")
    def list_completed_book_club_books():
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify({"books": book_club.list_completed(viewer["groupId"])})

    @app.put("/api/book-club/books/<book_id>/rating")
    def rate_book_club_book(book_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        error = book_club.set_rating(
            viewer["groupId"], book_id, viewer, (request.get_json(silent=True) or {}).get("rating")
        )
        if error:
            return jsonify({"error": error}), 400
        return jsonify({"books": book_club.list_completed(viewer["groupId"])})

    @app.get("/api/book-club/books/<book_id>/posts")
    def list_book_club_posts(book_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify({"posts": book_club.list_posts(
            viewer["groupId"], book_id, request.args.get("chapterKey")
        )})

    @app.post("/api/book-club/books/<book_id>/posts")
    def create_book_club_post(book_id: str):
        viewer, error = group_member_from_query()
        if error:
            return error
        body = request.get_json(silent=True) or {}
        post, error = book_club.create_post(
            viewer["groupId"], viewer, book_id, body.get("chapterKey"),
            body.get("chapterLabel"), body.get("body"),
        )
        if error:
            return jsonify({"error": error}), 404 if error == "Unknown book." else 400
        return jsonify({"post": post}), 201

    # --- Spotify Jam --------------------------------------------------------
    @app.get("/api/jam")
    def get_jam():
        """Return the one active household Jam, if any."""
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify(jam.get_active(viewer["groupId"]))

    @app.post("/api/jam")
    def share_jam():
        """Replace the active household Jam link with the caller's link."""
        body = request.get_json(silent=True) or {}
        host_id = (body.get("hostId") or "").strip()
        link = (body.get("link") or "").strip()
        host = db.get_group_member(host_id) if host_id else None
        if host is None:
            return invalid_user_response()
        if not jam.valid_spotify_link(link):
            return jsonify({"error": "Paste a valid Spotify Jam link."}), 400

        active = jam.share(link, host["id"], host["name"], host["groupId"])
        try:
            notify_group(
                host["groupId"],
                title="Spotify Jam is live",
                body=f"{host['name']} shared a Jam. Tap to join.",
                url=module_models.module_url("spotify", active["id"]),
                event_type="jam-changed",
                exclude_user_ids={host["id"]},
            )
        except Exception:  # noqa: BLE001 - sharing the link must remain successful
            app.logger.exception("Failed to send Jam notification")
        return jsonify(active)

    @app.delete("/api/jam")
    def end_jam():
        """Remove the active Jam link."""
        body = request.get_json(silent=True) or {}
        host_id = (body.get("hostId") or "").strip()
        host = db.get_group_member(host_id) if host_id else None
        if host is None:
            return invalid_user_response()
        result = jam.end(host["id"], host["groupId"])
        if result == jam.END_NOT_FOUND:
            return jsonify({"error": "No active Jam to remove."}), 404
        try:
            notify_group(
                host["groupId"],
                title="Spotify Jam removed",
                body=f"{host['name']} removed the active Jam.",
                url=module_models.module_url("spotify"),
                event_type="jam-changed",
                exclude_user_ids={host["id"]},
            )
        except Exception:  # noqa: BLE001 - ending the Jam must remain successful
            app.logger.exception("Failed to send Jam ended notification")
        return jsonify(jam.get_active(host["groupId"]))

    @app.get("/api/feed")
    def get_feed():
        """Return active household module instances in chronological feed order."""
        viewer, error = group_member_from_query()
        if error:
            return error
        module_type = (request.args.get("type") or "all").strip()
        if module_type != "all" and module_type not in module_models.MODULE_TYPES:
            return jsonify({"error": "Unknown module type."}), 400
        return jsonify(module_models.list_feed(viewer["groupId"], module_type))

    @app.patch("/api/modules/<module_type>/<item_id>")
    def edit_module(module_type: str, item_id: str):
        """Apply a creator-owned edit through the registered module adapter."""
        body = request.get_json(silent=True) or {}
        editor_id = (body.get("editorId") or "").strip()
        editor = db.get_group_member(editor_id) if editor_id else None
        if editor is None:
            return invalid_user_response()

        result = module_edits.edit(module_type, item_id, editor, body.get("changes"))
        if result.status == module_edits.EDIT_INVALID:
            return jsonify({"error": result.error}), 400
        if result.status == module_edits.EDIT_NOT_FOUND:
            return jsonify({"error": "That module was not found."}), 404
        if result.status == module_edits.EDIT_FORBIDDEN:
            return jsonify({"error": "Only the module creator can edit it."}), 403
        if result.status == module_edits.EDIT_READ_ONLY:
            return jsonify({"error": "Archived or completed modules are read-only."}), 409
        if result.status == module_edits.EDIT_CONFLICT:
            return jsonify({"error": "The module changed while you were editing it."}), 409

        feed_item = module_models.module_from_payload(
            module_type, result.payload
        ).to_feed_item()
        module_url = module_models.module_url(module_type, item_id)
        try:
            if result.notify_group:
                notify_group(
                    editor["groupId"],
                    title="Module updated",
                    body=result.notification_body,
                    url=module_url,
                    event_type=f"{module_type}-changed",
                    exclude_user_ids={editor["id"]},
                )
            elif result.notify_user_ids:
                push.notify_users(
                    user_ids=result.notify_user_ids,
                    title="Module updated",
                    body=result.notification_body,
                    url=module_url,
                    event_type=f"{module_type}-changed",
                )
        except Exception:  # noqa: BLE001 - notification failure cannot undo an edit
            app.logger.exception("Failed to send module edit notification")
        return jsonify({"module": feed_item})

    # --- Proposed activities ------------------------------------------------
    @app.get("/api/activities")
    def get_activities():
        """Return current activities followed by expired activity history."""
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify(activities.list_recent(viewer["groupId"]))

    @app.post("/api/activities")
    def propose_activity():
        """Store a new proposal, push it to everyone, return the activity list."""
        body = request.get_json(silent=True) or {}
        text = (body.get("text") or "").strip()
        proposed_by_id = (body.get("proposedById") or "").strip()

        if not text:
            return jsonify({"error": "An activity is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400
        proposer = db.get_group_member(proposed_by_id) if proposed_by_id else None
        if proposer is None:
            return jsonify({"error": "A valid creator is required."}), 400
        start_at, end_at, schedule_error = validate_activity_schedule(body)
        if schedule_error:
            return jsonify({"error": schedule_error}), 400

        created = activities.add_activity(
            text,
            proposer["id"],
            proposer["name"],
            proposer["groupId"],
            start_at,
            end_at,
        )

        # Notify the shire except the proposer. Best-effort: a push failure
        # must not fail the proposal the user just made.
        try:
            notify_group(
                proposer["groupId"],
                title="New activity proposed 🎉",
                body=f"{proposer['name']}: {text}",
                url=module_models.module_url("events", created["id"]),
                exclude_user_ids={proposer["id"]},
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send activity notification")

        # Return the refreshed list so the UI updates in one round-trip.
        # Consistent read so the just-created proposal is always included.
        return jsonify(activities.list_recent(proposer["groupId"], consistent=True))

    def transition_activity_live(activity_id: str, action: str):
        """Apply a creator-owned live transition and notify the shire."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400

        activity = activities.get(activity_id, requester["groupId"], consistent=True)
        transition = activities.start_owned if action == "start" else activities.end_owned
        result = transition(activity_id, requester_id, requester["groupId"])
        if result == activities.LIVE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.LIVE_FORBIDDEN:
            return jsonify({"error": "Only the event creator can change its live status."}), 403
        if result == activities.LIVE_CONFLICT:
            message = "This event is already live." if action == "start" else (
                "This event is not currently live."
            )
            return jsonify({"error": message}), 409

        # Live transitions are household-wide events. Push remains best-effort
        # so notification configuration or delivery cannot undo persisted state.
        try:
            push_result = notify_group(
                requester["groupId"],
                title=f"Event {action}ed {'🔴' if action == 'start' else '🏁'}",
                body=(
                    f"{activity['proposedBy']} started {activity['text']}"
                    if action == "start"
                    else f"{activity['proposedBy']} ended {activity['text']}"
                ),
                url=module_models.module_url("events", activity_id),
                event_type="activities-changed",
                exclude_user_ids={requester_id},
            )
            app.logger.info("Event %s push result: %s", action, push_result)
        except Exception:  # noqa: BLE001 - transition must remain successful
            app.logger.exception("Failed to send event %s notification", action)

        return jsonify(activities.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/start")
    def start_activity(activity_id: str):
        """Let an event creator start or restart their event immediately."""
        return transition_activity_live(activity_id, "start")

    @app.post("/api/activities/<activity_id>/end")
    def end_activity(activity_id: str):
        """Let an event creator permanently end their live event."""
        return transition_activity_live(activity_id, "end")

    @app.post("/api/activities/<activity_id>/archive")
    def archive_activity(activity_id: str):
        """Archive an activity so it moves out of the active section."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400

        activity = activities.get(activity_id, requester["groupId"], consistent=True)
        result = activities.archive(
            activity_id,
            requester_id,
            requester["groupId"],
            requester["name"],
        )
        if result == activities.ARCHIVE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404

        actor_name = requester["name"]
        try:
            push.notify_users(
                user_ids=set(activity["memberIds"]),
                exclude_user_ids={requester_id},
                title="Activity archived",
                body=f"{actor_name} archived {activity['text']}",
                url=group_url(requester["groupId"], module_models.module_url("events", activity_id)),
            )
        except Exception:  # noqa: BLE001 - archiving must remain successful
            app.logger.exception("Failed to send activity archive notification")

        return jsonify(activities.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/restore")
    def restore_activity(activity_id: str):
        """Restore an archived or expired activity to the active section."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400

        result = activities.restore(activity_id, requester["groupId"])
        if result == activities.RESTORE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        return jsonify(activities.list_recent(requester["groupId"], consistent=True))

    @app.delete("/api/activities/<activity_id>")
    def delete_activity(activity_id: str):
        """Delete an activity from the household feed."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400

        activity = activities.get(activity_id, requester["groupId"], consistent=True)
        result = activities.delete(activity_id, requester["groupId"])
        if result == activities.DELETE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.DELETE_LIVE:
            return jsonify({"error": "End the live event before deleting it."}), 409

        try:
            push.notify_users(
                user_ids=set(activity["memberIds"]),
                exclude_user_ids={requester_id},
                title="Activity deleted",
                body=f"{activity['proposedBy']} deleted {activity['text']}",
                url=group_url(requester["groupId"], module_models.module_url("events")),
            )
        except Exception:  # noqa: BLE001 - deletion must remain successful
            app.logger.exception("Failed to send activity deletion notification")

        return jsonify(activities.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/join")
    def join_activity(activity_id: str):
        """Add the caller to an activity's members; return the refreshed list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        activity = activities.join(activity_id, roommate["id"], roommate["name"], roommate["groupId"])
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if activity == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409

        # Notify the other participants that someone joined. Best-effort: a push
        # failure must not fail the join. Leaving remains intentionally quiet.
        try:
            push.notify_users(
                user_ids=set(activity["memberIds"]),
                exclude_user_ids={roommate["id"]},
                title="Someone joined an activity 🙌",
                body=f"{roommate['name']} joined {activity['text']}",
                url=group_url(roommate["groupId"], module_models.module_url("events", activity_id)),
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send join notification")

        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/leave")
    def leave_activity(activity_id: str):
        """Remove the caller from an activity's members; return the refreshed list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        result = activities.leave(activity_id, roommate["id"], roommate["name"], roommate["groupId"])
        if result is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409
        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/comments")
    def comment_on_activity(activity_id: str):
        """Append a comment to an activity; return the refreshed activity list."""
        body = request.get_json(silent=True) or {}
        author_id = (body.get("authorId") or "").strip()
        text = (body.get("text") or "").strip()
        author = db.get_group_member(author_id) if author_id else None
        if author is None:
            return jsonify({"error": "A valid author is required."}), 400
        if not text:
            return jsonify({"error": "A comment is required."}), 400
        if len(text) > MAX_COMMENT_LEN:
            return jsonify({"error": f"Keep it under {MAX_COMMENT_LEN} characters."}), 400
        mentions = resolve_mentions(text, db.get_all(author["groupId"]), author["id"])
        mentions_everyone = mentions_all(text)
        activity = activities.add_comment(
            activity_id,
            author["name"],
            text,
            author["groupId"],
            mentions,
            mentions_everyone,
            author["id"],
        )
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if activity == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409

        # @all takes precedence over named and participant audiences so each
        # recipient gets at most one push for the comment.
        mentioned_ids = {mention["id"] for mention in mentions}
        participant_ids = set(activity["memberIds"]) - mentioned_ids - {author["id"]}

        def notify_comment_users(user_ids: set[str], title: str, notification_body: str):
            """Keep each comment audience best-effort and independent."""
            try:
                result = push.notify_users(
                    user_ids=user_ids,
                    title=title,
                    body=notification_body,
                    url=group_url(author["groupId"], module_models.module_url("events", activity_id)),
                )
                app.logger.info(
                    "Comment push result for %d recipient(s): %s",
                    len(user_ids),
                    result,
                )
            except Exception:  # noqa: BLE001 - never let push break the request
                app.logger.exception("Failed to send comment notification")

        if mentions_everyone:
            try:
                result = notify_group(
                    author["groupId"],
                    title=f"{author['name']} mentioned everyone",
                    body=f"On “{activity['text']}”: {text}",
                    url=module_models.module_url("events", activity_id),
                    exclude_user_ids={author["id"]},
                )
                app.logger.info("Comment @all push result: %s", result)
            except Exception:  # noqa: BLE001 - never let push break the request
                app.logger.exception("Failed to send comment @all notification")
        elif mentioned_ids:
            notify_comment_users(
                mentioned_ids,
                f"{author['name']} mentioned you",
                f"On “{activity['text']}”: {text}",
            )
        if participant_ids and not mentions_everyone:
            notify_comment_users(
                participant_ids,
                "New comment 💬",
                f"{author['name']} on “{activity['text']}”: {text}",
            )

        # Consistent read so the new comment is reflected immediately.
        return jsonify(activities.list_recent(author["groupId"], consistent=True))

    @app.route(
        "/api/activities/<activity_id>/comments/<comment_id>/likes",
        methods=["PUT", "DELETE"],
    )
    def update_comment_like(activity_id: str, comment_id: str):
        """Idempotently like or unlike one comment for a valid roommate."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        result = activities.set_comment_like(
            activity_id,
            comment_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
            request.method == "PUT",
        )
        if result == activities.LIKE_NOT_FOUND:
            return jsonify({"error": "Unknown activity or comment."}), 404
        if result == activities.LIKE_SELF_FORBIDDEN:
            return jsonify({"error": "You cannot like your own comment."}), 403
        if result == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409
        return jsonify(activities.list_recent(roommate["groupId"], consistent=True))

    # --- Requests -----------------------------------------------------------
    @app.post("/api/requests")
    def create_request():
        """Create a targeted request and notify the requested roommates."""
        body = request.get_json(silent=True) or {}
        text = (body.get("text") or "").strip()
        requester_id = (body.get("requesterId") or "").strip()
        requested_ids = {
            (user_id or "").strip()
            for user_id in (body.get("requestedIds") or [])
            if (user_id or "").strip()
        }

        if not text:
            return jsonify({"error": "A request is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400
        requested_ids.discard(requester["id"])
        if not requested_ids:
            return jsonify({"error": "Choose at least one roommate to request."}), 400

        requested_roommates = []
        for user_id in sorted(requested_ids):
            roommate = db.get_group_member(user_id, requester["groupId"])
            if roommate is None:
                return jsonify({"error": "Every requested roommate must be valid."}), 400
            requested_roommates.append(roommate)

        created = household_requests.add_request(
            text,
            requester["id"],
            requester["name"],
            requester["groupId"],
            requested_roommates,
        )
        request_url = module_models.module_url("requests", created["id"])
        try:
            push.notify_users(
                user_ids={roommate["id"] for roommate in requested_roommates},
                title="New request",
                body=f"{requester['name']} requested: {text}",
                url=group_url(requester["groupId"], request_url),
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - never let push break request creation
            app.logger.exception("Failed to send request notification")
        return jsonify(household_requests.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/requests/<request_id>/responses")
    def respond_to_request(request_id: str):
        """Let a requested roommate accept or deny a request."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        response = (body.get("response") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        if response not in household_requests.VALID_RESPONSES:
            return jsonify({"error": "Response must be accepted or denied."}), 400

        updated = household_requests.set_response(
            request_id,
            roommate["id"],
            roommate["groupId"],
            response,
        )
        if updated is None:
            return jsonify({"error": "Unknown request or roommate."}), 404
        if updated == household_requests.MUTATION_ARCHIVED:
            return jsonify({"error": "Archived requests are read-only."}), 409

        request_url = module_models.module_url("requests", updated["id"])
        try:
            push.notify_users(
                user_ids={updated["requesterId"]},
                exclude_user_ids={roommate["id"]},
                title="Request response",
                body=f"{roommate['name']} {response} “{updated['text']}”",
                url=group_url(roommate["groupId"], request_url),
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - response must remain successful
            app.logger.exception("Failed to send request response notification")
        return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/requests/<request_id>/archive")
    def archive_request(request_id: str):
        """Archive a request so it leaves the active module list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_requests.archive(
            request_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

        request_url = module_models.module_url("requests", updated["id"])
        try:
            push.notify_users(
                user_ids={updated["requesterId"], *updated["requestedIds"]},
                exclude_user_ids={roommate["id"]},
                title="Request archived",
                body=f"{roommate['name']} archived “{updated['text']}”",
                url=group_url(roommate["groupId"], request_url),
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - archive must remain successful
            app.logger.exception("Failed to send request archive notification")
        return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/requests/<request_id>/restore")
    def restore_request(request_id: str):
        """Restore an archived request back to the active module list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_requests.restore(
            request_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

        request_url = module_models.module_url("requests", updated["id"])
        try:
            push.notify_users(
                user_ids={updated["requesterId"], *updated["requestedIds"]},
                exclude_user_ids={roommate["id"]},
                title="Request restored",
                body=f"{roommate['name']} restored “{updated['text']}”",
                url=group_url(roommate["groupId"], request_url),
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - restore must remain successful
            app.logger.exception("Failed to send request restore notification")
        return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

    @app.delete("/api/requests/<request_id>")
    def delete_request(request_id: str):
        """Delete a request from the household feed."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return jsonify({"error": "A valid requester is required."}), 400

        request_item = household_requests.get(request_id, requester["groupId"], consistent=True)
        result = household_requests.delete(request_id, requester["groupId"])
        if result == household_requests.DELETE_NOT_FOUND:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

        try:
            push.notify_users(
                user_ids={request_item["requesterId"], *request_item["requestedIds"]},
                exclude_user_ids={requester_id},
                title="Request deleted",
                body=f"{request_item['requester']} deleted “{request_item['text']}”",
                url=group_url(requester["groupId"], module_models.module_url("requests")),
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - deletion must remain successful
            app.logger.exception("Failed to send request deletion notification")
        return jsonify(household_requests.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/requests/<request_id>/comments")
    def comment_on_request(request_id: str):
        """Append a comment to a request and notify the request participants."""
        body = request.get_json(silent=True) or {}
        author_id = (body.get("authorId") or "").strip()
        text = (body.get("text") or "").strip()
        author = db.get_group_member(author_id) if author_id else None
        if author is None:
            return jsonify({"error": "A valid author is required."}), 400
        if not text:
            return jsonify({"error": "A comment is required."}), 400
        if len(text) > MAX_COMMENT_LEN:
            return jsonify({"error": f"Keep it under {MAX_COMMENT_LEN} characters."}), 400

        mentions = resolve_mentions(text, db.get_all(author["groupId"]), author["id"])
        mentions_everyone = mentions_all(text)
        updated = household_requests.add_comment(
            request_id,
            author["name"],
            text,
            author["groupId"],
            mentions,
            mentions_everyone,
            author["id"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404
        if updated == household_requests.MUTATION_ARCHIVED:
            return jsonify({"error": "Archived requests are read-only."}), 409

        mentioned_ids = {mention["id"] for mention in mentions}
        participant_ids = (
            {updated["requesterId"], *updated["requestedIds"]}
            - mentioned_ids
            - {author["id"]}
        )

        def notify_request_users(user_ids: set[str], title: str, notification_body: str):
            try:
                push.notify_users(
                    user_ids=user_ids,
                    title=title,
                    body=notification_body,
                    url=group_url(author["groupId"], module_models.module_url("requests", updated["id"])),
                    event_type="requests-changed",
                )
            except Exception:  # noqa: BLE001 - never let push break the comment
                app.logger.exception("Failed to send request comment notification")

        if mentions_everyone:
            try:
                notify_group(
                    author["groupId"],
                    title=f"{author['name']} mentioned everyone",
                    body=f"On request “{updated['text']}”: {text}",
                    url=module_models.module_url("requests", updated["id"]),
                    event_type="requests-changed",
                    exclude_user_ids={author["id"]},
                )
            except Exception:  # noqa: BLE001
                app.logger.exception("Failed to send request comment @all notification")
        elif mentioned_ids:
            notify_request_users(
                mentioned_ids,
                f"{author['name']} mentioned you",
                f"On request “{updated['text']}”: {text}",
            )
        if participant_ids and not mentions_everyone:
            notify_request_users(
                participant_ids,
                "New request comment",
                f"{author['name']} on “{updated['text']}”: {text}",
            )
        return jsonify(household_requests.list_recent(author["groupId"], consistent=True))

    @app.route(
        "/api/requests/<request_id>/comments/<comment_id>/likes",
        methods=["PUT", "DELETE"],
    )
    def update_request_comment_like(request_id: str, comment_id: str):
        """Idempotently like or unlike one request comment."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        result = household_requests.set_comment_like(
            request_id,
            comment_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
            request.method == "PUT",
        )
        if result == household_requests.LIKE_NOT_FOUND:
            return jsonify({"error": "Unknown request or comment."}), 404
        if result == household_requests.LIKE_SELF_FORBIDDEN:
            return jsonify({"error": "You cannot like your own comment."}), 403
        if result == household_requests.MUTATION_ARCHIVED:
            return jsonify({"error": "Archived requests are read-only."}), 409
        return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

    # --- Checklists ---------------------------------------------------------
    @app.post("/api/checklists")
    def create_checklist():
        """Create a household checklist and return the refreshed list."""
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        created_by_id = (body.get("createdById") or "").strip()
        item_texts = body.get("items") or []

        if not title:
            return jsonify({"error": "A checklist title is required."}), 400
        if len(title) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep the title under {MAX_ACTIVITY_LEN} characters."}), 400
        creator = db.get_group_member(created_by_id) if created_by_id else None
        if creator is None:
            return jsonify({"error": "A valid creator is required."}), 400
        if not isinstance(item_texts, list):
            return jsonify({"error": "Checklist items must be a list."}), 400

        cleaned_items = [
            (text or "").strip()
            for text in item_texts
            if (text or "").strip()
        ]
        if not cleaned_items:
            return jsonify({"error": "Add at least one checklist item."}), 400
        if any(len(text) > MAX_ACTIVITY_LEN for text in cleaned_items):
            return jsonify({"error": f"Keep each item under {MAX_ACTIVITY_LEN} characters."}), 400

        created = household_checklists.add_checklist(
            title,
            creator["id"],
            creator["name"],
            creator["groupId"],
            cleaned_items,
        )
        try:
            notify_group(
                creator["groupId"],
                title="New checklist",
                body=f"{creator['name']} posted “{created['title']}”",
                url=module_models.module_url("checklists", created["id"]),
                event_type="checklists-changed",
                exclude_user_ids={creator["id"]},
            )
        except Exception:  # noqa: BLE001 - creation must remain successful
            app.logger.exception("Failed to send checklist notification")
        return jsonify(household_checklists.list_recent(creator["groupId"], consistent=True))

    @app.post("/api/checklists/<checklist_id>/notify")
    def notify_checklist(checklist_id: str):
        """Push a checklist reminder to every roommate except the requester."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return invalid_user_response()
        checklist = household_checklists.get(checklist_id, requester["groupId"], consistent=True)
        if checklist is None or checklist["isArchived"]:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = notify_group(
            requester["groupId"],
            title="Checklist reminder",
            body=f"{requester['name']} reminded everyone to update “{checklist['title']}”",
            url=module_models.module_url("checklists", checklist["id"]),
            event_type="checklists-changed",
            exclude_user_ids={requester["id"]},
        )
        return jsonify(result)

    @app.post("/api/checklists/<checklist_id>/items")
    def add_checklist_item(checklist_id: str):
        """Add one item to an active checklist."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        text = (body.get("text") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        if not text:
            return jsonify({"error": "A checklist item is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400

        updated = household_checklists.add_item(checklist_id, roommate["groupId"], text)
        if updated is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/checklists/<checklist_id>/items/<item_id>/toggle")
    def toggle_checklist_item(checklist_id: str, item_id: str):
        """Toggle the caller's check state for one checklist item."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_checklists.toggle_item(
            checklist_id,
            item_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
        )
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.patch("/api/checklists/<checklist_id>/items/<item_id>")
    def update_checklist_item(checklist_id: str, item_id: str):
        """Edit one item in an active checklist."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        text = (body.get("text") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        if not text:
            return jsonify({"error": "A checklist item is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400

        updated = household_checklists.update_item(checklist_id, item_id, text, roommate["groupId"])
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.delete("/api/checklists/<checklist_id>/items/<item_id>")
    def delete_checklist_item(checklist_id: str, item_id: str):
        """Delete one item from an active checklist."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_checklists.delete_item(checklist_id, item_id, roommate["groupId"])
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/checklists/<checklist_id>/archive")
    def archive_checklist(checklist_id: str):
        """Archive a checklist; any valid roommate may do this."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_checklists.archive(
            checklist_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        try:
            notify_group(
                roommate["groupId"],
                title="Checklist archived",
                body=f"{roommate['name']} archived “{updated['title']}”",
                url=module_models.module_url("checklists", updated["id"]),
                event_type="checklists-changed",
                exclude_user_ids={roommate["id"]},
            )
        except Exception:  # noqa: BLE001 - archive must remain successful
            app.logger.exception("Failed to send checklist archive notification")
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.post("/api/checklists/<checklist_id>/restore")
    def restore_checklist(checklist_id: str):
        """Restore an archived checklist to the active module list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        updated = household_checklists.restore(
            checklist_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    @app.delete("/api/checklists/<checklist_id>")
    def delete_checklist(checklist_id: str):
        """Delete a checklist from the household feed."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()

        deleted = household_checklists.delete(checklist_id, roommate["groupId"])
        if deleted is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

    # --- Shows --------------------------------------------------------------
    def shows_response(result, group_id):
        """Map a household_shows watcher-mutation result to a JSON response.

        None -> unknown show or watcher, or one in another group (404);
        MUTATION_ARCHIVED -> the show is archived and read-only (409);
        otherwise the group's refreshed show list.
        """
        if result is None:
            return jsonify({"error": "Unknown show or watcher."}), 404
        if result == household_shows.MUTATION_ARCHIVED:
            return jsonify({"error": "Archived shows are read-only."}), 409
        if result == household_shows.WATCHPARTY_EMPTY:
            return jsonify({"error": "Add at least one watcher before starting a watchparty."}), 409
        return jsonify(household_shows.list_recent(group_id, consistent=True))

    @app.get("/api/shows")
    def get_shows():
        """Return the caller's group's recent shows, newest first."""
        viewer, error = group_member_from_query()
        if error:
            return error
        return jsonify(household_shows.list_recent(viewer["groupId"]))

    @app.post("/api/shows")
    def create_show():
        """Create a show (auto-joining the creator) and return the refreshed list."""
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        created_by_id = (body.get("createdById") or "").strip()
        if not title:
            return jsonify({"error": "A show title is required."}), 400
        if len(title) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep the title under {MAX_ACTIVITY_LEN} characters."}), 400
        creator = db.get_group_member(created_by_id) if created_by_id else None
        if creator is None:
            return jsonify({"error": "A valid creator is required."}), 400

        household_shows.add_show(title, creator["id"], creator["name"], creator["groupId"])
        return jsonify(household_shows.list_recent(creator["groupId"], consistent=True))

    @app.post("/api/shows/<show_id>/join")
    def join_show(show_id: str):
        """Add the caller as a watcher; the display name comes from their account."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        return shows_response(
            household_shows.join(show_id, roommate["id"], roommate["name"], roommate["groupId"]),
            roommate["groupId"],
        )

    @app.post("/api/shows/<show_id>/leave")
    def leave_show(show_id: str):
        """Remove the caller from a show's watcher list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return invalid_user_response()
        return shows_response(
            household_shows.leave(show_id, roommate["id"], roommate["groupId"]),
            roommate["groupId"],
        )

    @app.patch("/api/shows/<show_id>/watchers/<member_id>/<field>")
    def adjust_show_progress(show_id: str, member_id: str, field: str):
        """Nudge one watcher's season or episode by an integer delta (+1 / -1).

        Episode edits are open to every roommate in the show's group (matching
        the feature's loose ownership), so the caller need only be a valid
        roommate — their group scopes which show they can touch.
        """
        if field not in household_shows.PROGRESS_FIELDS:
            return jsonify({"error": "Progress field must be season or episode."}), 400
        body = request.get_json(silent=True) or {}
        roommate = db.get_group_member((body.get("userId") or "").strip())
        if roommate is None:
            return invalid_user_response()
        delta = body.get("delta")
        if not isinstance(delta, int) or isinstance(delta, bool):
            return jsonify({"error": "A whole-number delta is required."}), 400
        return shows_response(
            household_shows.adjust_progress(
                show_id, member_id, field, delta, roommate["groupId"]
            ),
            roommate["groupId"],
        )

    @app.put("/api/shows/<show_id>/watchers/<member_id>/<field>")
    def set_show_progress(show_id: str, member_id: str, field: str):
        """Set one watcher's season or episode to an absolute value."""
        if field not in household_shows.PROGRESS_FIELDS:
            return jsonify({"error": "Progress field must be season or episode."}), 400
        body = request.get_json(silent=True) or {}
        roommate = db.get_group_member((body.get("userId") or "").strip())
        if roommate is None:
            return invalid_user_response()
        value = body.get("value")
        if not isinstance(value, int) or isinstance(value, bool):
            return jsonify({"error": "A whole-number value is required."}), 400
        return shows_response(
            household_shows.set_progress(
                show_id, member_id, field, value, roommate["groupId"]
            ),
            roommate["groupId"],
        )

    @app.post("/api/shows/<show_id>/archive")
    def archive_show(show_id: str):
        """Archive a show so it leaves the active list."""
        return _toggle_show_archive(show_id, household_shows.archive, "archive")

    @app.post("/api/shows/<show_id>/restore")
    def restore_show(show_id: str):
        """Restore an archived show back to the active list."""
        return _toggle_show_archive(show_id, household_shows.restore, "restore")

    @app.delete("/api/shows/<show_id>")
    def delete_show(show_id: str):
        """Delete a show from the household feed."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return invalid_user_response()
        result = household_shows.delete(show_id, requester["groupId"])
        if result == household_shows.DELETE_NOT_FOUND:
            return jsonify({"error": f"Unknown show: {show_id}"}), 404
        return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))

    def _set_show_watchparty(show_id: str, live: bool):
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return invalid_user_response()
        season = body.get("season")
        episode = body.get("episode")
        if live:
            if not isinstance(season, int) or isinstance(season, bool):
                return jsonify({"error": "A whole-number season is required."}), 400
            if not isinstance(episode, int) or isinstance(episode, bool):
                return jsonify({"error": "A whole-number episode is required."}), 400

        show = household_shows.get(show_id, requester["groupId"], consistent=True)
        action = household_shows.start_watchparty if live else household_shows.end_watchparty
        if live:
            result = action(
                show_id,
                requester["id"],
                requester["name"],
                requester["groupId"],
                season,
                episode,
            )
        else:
            result = action(
                show_id,
                requester["id"],
                requester["name"],
                requester["groupId"],
            )
        if result is None:
            return jsonify({"error": f"Unknown show: {show_id}"}), 404
        if result == household_shows.MUTATION_ARCHIVED:
            return jsonify({"error": "Archived shows are read-only."}), 409
        if result == household_shows.WATCHPARTY_EMPTY:
            return jsonify({"error": "Add at least one watcher before starting a watchparty."}), 409

        watcher_ids = {member["id"] for member in show.get("members", []) if member.get("id")} if show else set()
        try:
            push.notify_users(
                user_ids=watcher_ids,
                exclude_user_ids={requester["id"]},
                title="Watchparty started" if live else "Watchparty ended",
                body=(
                    f"{requester['name']} started watching {result['title']} "
                    f"S{result['watchpartySeason']} E{result['watchpartyEpisode']}"
                    if live
                    else f"{requester['name']} ended the {result['title']} watchparty"
                ),
                url=group_url(requester["groupId"], module_models.module_url("tv", show_id)),
                event_type="shows-changed",
            )
        except Exception:  # noqa: BLE001 - watchparty state must remain successful
            app.logger.exception("Failed to send show watchparty notification")
        return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/shows/<show_id>/watchparty/start")
    def start_show_watchparty(show_id: str):
        """Mark a show's watcher group as actively watching."""
        return _set_show_watchparty(show_id, True)

    @app.post("/api/shows/<show_id>/watchparty/end")
    def end_show_watchparty(show_id: str):
        """End the live watchparty state for a show."""
        return _set_show_watchparty(show_id, False)

    def _toggle_show_archive(show_id, action, verb):
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        if requester is None:
            return invalid_user_response()
        result = action(show_id, requester["id"], requester["name"], requester["groupId"])
        if result is None:
            return jsonify({"error": f"Unknown show: {show_id}"}), 404
        return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))

    @app.post("/api/activities/<activity_id>/notify")
    def emphasize_activity(activity_id: str):
        """Re-push an existing activity as "<user> emphasized <activity>".

        Anyone can emphasize any activity, not just its proposer. The activity
        text comes from the stored item (not the client) so the notification
        always matches a real proposal.
        """
        body = request.get_json(silent=True) or {}
        emphasized_by_id = (body.get("emphasizedById") or "").strip()
        emphasized_by = db.get_group_member(emphasized_by_id) if emphasized_by_id else None
        if emphasized_by is None:
            return invalid_user_response()

        activity = activities.get(activity_id, emphasized_by["groupId"])
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if activity["isExpired"]:
            return jsonify({"error": "Expired activities are read-only."}), 409
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = push.notify_users(
            user_ids=set(activity["memberIds"]),
            exclude_user_ids={emphasized_by["id"]},
            title="Activity emphasized 👀",
            body=f"{emphasized_by['name']} emphasized {activity['text']}",
            url=group_url(emphasized_by["groupId"], module_models.module_url("events", activity_id)),
        )
        return jsonify(result)

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    # Local dev entrypoint: python app.py
    app.run(host="0.0.0.0", port=8000, debug=True)
