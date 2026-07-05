"""Flask backend for the Yorkshire Roomie Status app.

Implements the endpoints the frontend calls (see frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name", "username",
                                             "groupId", "hasGroup" } }
    POST /api/accounts                 -> create a no-group account
    DELETE /api/accounts/<id>          -> delete an account after password check
    GET  /api/roommates                -> [ { "id", "name", "status", "statusText",
                                             "statusUpdatedAt" }, ... ]
    PUT  /api/roommates/<id>/status    -> the full, updated household list
    POST /api/roommates/notify         -> { "sent", "pruned", "failed" }
    POST /api/roommates/<id>/poke      -> { "sent", "pruned", "failed" }

Plus the Web Push (PoC) endpoints:

    GET  /api/push/public-key          -> { "publicKey": <VAPID public key> }
    POST /api/push/subscribe           -> { "ok": true }  (stores a user-owned subscription)
    POST /api/push/test                -> { "sent", "pruned", "failed" }

And the proposed-activities feed:

    GET  /api/activities               -> current + expired activity history
    POST /api/activities               -> the updated activity list (and pushes it)
    PATCH /api/activities/<id>/schedule -> the updated activity list
    POST /api/activities/<id>/archive  -> the updated activity list
    DELETE /api/activities/<id>        -> the updated activity list
    POST /api/activities/<id>/start    -> the updated activity list (and pushes it)
    POST /api/activities/<id>/end      -> the updated activity list (and pushes it)
    POST /api/activities/<id>/join     -> the updated activity list (and pushes it)
    POST /api/activities/<id>/leave    -> the updated activity list
    POST /api/activities/<id>/comments -> the updated activity list (and pushes it)
    PUT/DELETE /api/activities/<id>/comments/<comment_id>/likes
                                        -> the updated activity list

And the shire request feed:

    GET  /api/requests                 -> recent requests
    POST /api/requests                 -> the updated recent request list
    POST /api/requests/<id>/responses  -> the updated recent request list
    POST /api/requests/<id>/complete   -> the updated recent request list
    POST /api/requests/<id>/reopen     -> the updated recent request list
    DELETE /api/requests/<id>          -> the updated recent request list
    POST /api/requests/<id>/comments   -> the updated recent request list
    PUT/DELETE /api/requests/<id>/comments/<comment_id>/likes
                                       -> the updated recent request list

And the shire checklist feed:

    GET  /api/checklists               -> recent active checklists
    POST /api/checklists               -> the updated recent checklist list
    POST /api/checklists/<id>/notify   -> push a checklist reminder to everyone else
    POST /api/checklists/<id>/items    -> the updated recent checklist list
    POST /api/checklists/<id>/items/<item_id>/toggle
                                       -> the updated recent checklist list
    PATCH/DELETE /api/checklists/<id>/items/<item_id>
                                       -> the updated recent checklist list
    POST /api/checklists/<id>/archive  -> the updated recent checklist list

And the shire Spotify Jam widget:

    GET  /api/jam                      -> active Jam link
    POST /api/jam                      -> active Jam link, replacing any prior one
    DELETE /api/jam                    -> end the caller's active Jam

Roommate data is backed by DynamoDB via db.py; push subscriptions + sending are
in push.py; proposals are in activities.py; requests are in household_requests.py;
checklists are in household_checklists.py; Jam state is in jam.py. Routes stay
storage-agnostic.
"""

from __future__ import annotations

import os
import re

from flask import Flask, jsonify, request
from flask_cors import CORS

import activities
import db
import household_checklists
import household_requests
import jam
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


def create_app() -> Flask:
    """Application factory so tests can build isolated app instances."""
    app = Flask(__name__)

    # Allow the Vite dev server (and any other origin) to call the API directly.
    # In production the frontend is served behind the same proxy, but permissive
    # CORS keeps local development friction-free.
    CORS(app, resources={r"/api/*": {"origins": "*"}})

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

    @app.delete("/api/accounts/<user_id>")
    def delete_account(user_id: str):
        """Delete an account and its browser push subscriptions."""
        body = request.get_json(silent=True) or {}
        if not db.delete_account(user_id, body.get("password", "")):
            return jsonify({"error": "Could not verify that account and password."}), 401
        push.delete_user_subscriptions(db.normalize_username(user_id))
        return jsonify({"ok": True})

    @app.get("/api/roommates")
    def get_roommates():
        """Return the whole household with their current statuses."""
        return jsonify(db.get_all())

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

        roommates = db.update_status(roommate_id, status, status_text)
        if roommates is None:
            return jsonify({"error": f"Unknown roommate: {roommate_id}"}), 404

        # When enough roommates are free, push a "gather!" notification to every
        # subscribed device. Sending is best-effort: a push failure must not
        # fail the status update the user just made.
        free = db.available_count(roommates)
        if free >= PUSH_THRESHOLD:
            app.logger.info("Notification: %d roommates are available — time to gather!", free)
            try:
                push.notify_all(
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
            return jsonify({"error": "A valid roommate is required."}), 400
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = push.notify_all(
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
        target = db.get_group_member(roommate_id)
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
            url="/?updateStatus=1",
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
            return jsonify({"error": "A valid roommate is required."}), 400
        push.save_subscription(subscription, user_id)
        return jsonify({"ok": True})

    @app.post("/api/push/test")
    def push_test():
        """Send a test notification to every subscribed device (PoC helper)."""
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503
        result = push.notify_all(
            title="Roomie Status test",
            body="If you can see this, push notifications work 🎉",
            url="/",
        )
        return jsonify(result)

    # --- Spotify Jam --------------------------------------------------------
    @app.get("/api/jam")
    def get_jam():
        """Return the one active household Jam, if any."""
        return jsonify(jam.get_active())

    @app.post("/api/jam")
    def share_jam():
        """Replace the active household Jam link with the caller's link."""
        body = request.get_json(silent=True) or {}
        host_id = (body.get("hostId") or "").strip()
        link = (body.get("link") or "").strip()
        host = db.get_group_member(host_id) if host_id else None
        if host is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        if not jam.valid_spotify_link(link):
            return jsonify({"error": "Paste a valid Spotify Jam link."}), 400

        active = jam.share(link, host["id"], host["name"])
        try:
            push.notify_all(
                title="Spotify Jam is live",
                body=f"{host['name']} shared a Jam. Tap to join.",
                url="/",
                event_type="jam-changed",
                exclude_user_ids={host["id"]},
            )
        except Exception:  # noqa: BLE001 - sharing the link must remain successful
            app.logger.exception("Failed to send Jam notification")
        return jsonify(active)

    @app.delete("/api/jam")
    def end_jam():
        """End the caller's active Jam link."""
        body = request.get_json(silent=True) or {}
        host_id = (body.get("hostId") or "").strip()
        host = db.get_group_member(host_id) if host_id else None
        if host is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        result = jam.end(host["id"])
        if result == jam.END_NOT_FOUND:
            return jsonify({"error": "No active Jam to end."}), 404
        if result == jam.END_FORBIDDEN:
            return jsonify({"error": "Only the Jam host can end it."}), 403
        try:
            push.notify_all(
                title="Spotify Jam ended",
                body=f"{host['name']} ended the active Jam.",
                url="/",
                event_type="jam-changed",
                exclude_user_ids={host["id"]},
            )
        except Exception:  # noqa: BLE001 - ending the Jam must remain successful
            app.logger.exception("Failed to send Jam ended notification")
        return jsonify(jam.get_active())

    # --- Proposed activities ------------------------------------------------
    @app.get("/api/activities")
    def get_activities():
        """Return current activities followed by expired activity history."""
        return jsonify(activities.list_recent())

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

        activities.add_activity(
            text,
            proposer["id"],
            proposer["name"],
            start_at,
            end_at,
        )

        # Notify the shire except the proposer. Best-effort: a push failure
        # must not fail the proposal the user just made.
        try:
            push.notify_all(
                title="New activity proposed 🎉",
                body=f"{proposer['name']}: {text}",
                url="/",
                exclude_user_ids={proposer["id"]},
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send activity notification")

        # Return the refreshed list so the UI updates in one round-trip.
        # Consistent read so the just-created proposal is always included.
        return jsonify(activities.list_recent(consistent=True))

    def transition_activity_live(activity_id: str, action: str):
        """Apply a creator-owned live transition and notify the shire."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        activity = activities.get(activity_id, consistent=True)
        transition = activities.start_owned if action == "start" else activities.end_owned
        result = transition(activity_id, requester_id)
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
            push_result = push.notify_all(
                title=f"Event {action}ed {'🔴' if action == 'start' else '🏁'}",
                body=(
                    f"{activity['proposedBy']} started {activity['text']}"
                    if action == "start"
                    else f"{activity['proposedBy']} ended {activity['text']}"
                ),
                url="/",
                event_type="activities-changed",
                exclude_user_ids={requester_id},
            )
            app.logger.info("Event %s push result: %s", action, push_result)
        except Exception:  # noqa: BLE001 - transition must remain successful
            app.logger.exception("Failed to send event %s notification", action)

        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/start")
    def start_activity(activity_id: str):
        """Let an event creator start or restart their event immediately."""
        return transition_activity_live(activity_id, "start")

    @app.post("/api/activities/<activity_id>/end")
    def end_activity(activity_id: str):
        """Let an event creator permanently end their live event."""
        return transition_activity_live(activity_id, "end")

    @app.patch("/api/activities/<activity_id>/schedule")
    def update_activity_schedule(activity_id: str):
        """Replace a pending activity's optional owner-controlled schedule."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400
        start_at, end_at, schedule_error = validate_activity_schedule(body)
        if schedule_error:
            return jsonify({"error": schedule_error}), 400

        result = activities.update_schedule_owned(
            activity_id,
            requester_id,
            start_at,
            end_at,
        )
        if result == activities.SCHEDULE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.SCHEDULE_FORBIDDEN:
            return jsonify({"error": "Only the event creator can edit its schedule."}), 403
        if result == activities.SCHEDULE_CONFLICT:
            return jsonify({"error": "Only pending events can be rescheduled."}), 409
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/archive")
    def archive_activity(activity_id: str):
        """Archive an activity so it moves into the expired section."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        activity = activities.get(activity_id, consistent=True)
        result = activities.archive(activity_id, requester_id)
        if result == activities.ARCHIVE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404

        requester = db.get_group_member(requester_id)
        actor_name = requester["name"] if requester else requester_id
        try:
            push.notify_users(
                user_ids=set(activity["memberIds"]),
                exclude_user_ids={requester_id},
                title="Activity archived",
                body=f"{actor_name} archived {activity['text']}",
                url="/",
            )
        except Exception:  # noqa: BLE001 - archiving must remain successful
            app.logger.exception("Failed to send activity archive notification")

        return jsonify(activities.list_recent(consistent=True))

    @app.delete("/api/activities/<activity_id>")
    def delete_activity(activity_id: str):
        """Delete an activity only when requested by its stored creator."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        activity = activities.get(activity_id, consistent=True)
        result = activities.delete_owned(activity_id, requester_id)
        if result == activities.DELETE_NOT_FOUND:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.DELETE_FORBIDDEN:
            return jsonify({"error": "Only the event creator can delete it."}), 403
        if result == activities.DELETE_LIVE:
            return jsonify({"error": "End the live event before deleting it."}), 409

        try:
            push.notify_users(
                user_ids=set(activity["memberIds"]),
                exclude_user_ids={requester_id},
                title="Activity deleted",
                body=f"{activity['proposedBy']} deleted {activity['text']}",
                url="/",
            )
        except Exception:  # noqa: BLE001 - deletion must remain successful
            app.logger.exception("Failed to send activity deletion notification")

        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/join")
    def join_activity(activity_id: str):
        """Add the caller to an activity's members; return the refreshed list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        activity = activities.join(activity_id, roommate["id"], roommate["name"])
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
                url="/",
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send join notification")

        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/leave")
    def leave_activity(activity_id: str):
        """Remove the caller from an activity's members; return the refreshed list."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        result = activities.leave(activity_id, roommate["id"], roommate["name"])
        if result is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if result == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409
        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(consistent=True))

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
        mentions = resolve_mentions(text, db.get_all(), author["id"])
        mentions_everyone = mentions_all(text)
        activity = activities.add_comment(
            activity_id,
            author["name"],
            text,
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
                    url="/",
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
                result = push.notify_all(
                    title=f"{author['name']} mentioned everyone",
                    body=f"On “{activity['text']}”: {text}",
                    url="/",
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
        return jsonify(activities.list_recent(consistent=True))

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
            return jsonify({"error": "A valid roommate is required."}), 400

        result = activities.set_comment_like(
            activity_id,
            comment_id,
            roommate["id"],
            roommate["name"],
            request.method == "PUT",
        )
        if result == activities.LIKE_NOT_FOUND:
            return jsonify({"error": "Unknown activity or comment."}), 404
        if result == activities.LIKE_SELF_FORBIDDEN:
            return jsonify({"error": "You cannot like your own comment."}), 403
        if result == activities.MUTATION_EXPIRED:
            return jsonify({"error": "Expired activities are read-only."}), 409
        return jsonify(activities.list_recent(consistent=True))

    # --- Requests -----------------------------------------------------------
    @app.get("/api/requests")
    def get_requests():
        """Return recent household requests, newest first."""
        return jsonify(household_requests.list_recent())

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
            roommate = db.get_group_member(user_id)
            if roommate is None:
                return jsonify({"error": "Every requested roommate must be valid."}), 400
            requested_roommates.append(roommate)

        created = household_requests.add_request(
            text,
            requester["id"],
            requester["name"],
            requested_roommates,
        )
        request_url = f"/?request={created['id']}"
        try:
            push.notify_users(
                user_ids={roommate["id"] for roommate in requested_roommates},
                title="New request",
                body=f"{requester['name']} requested: {text}",
                url=request_url,
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - never let push break request creation
            app.logger.exception("Failed to send request notification")
        return jsonify(household_requests.list_recent(consistent=True))

    @app.post("/api/requests/<request_id>/responses")
    def respond_to_request(request_id: str):
        """Let a requested roommate accept or deny a request."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        response = (body.get("response") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        if response not in household_requests.VALID_RESPONSES:
            return jsonify({"error": "Response must be accepted or denied."}), 400

        updated = household_requests.set_response(request_id, roommate["id"], response)
        if updated is None:
            return jsonify({"error": "Unknown request or roommate."}), 404

        request_url = f"/?request={updated['id']}"
        try:
            push.notify_users(
                user_ids={updated["requesterId"]},
                exclude_user_ids={roommate["id"]},
                title="Request response",
                body=f"{roommate['name']} {response} “{updated['text']}”",
                url=request_url,
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - response must remain successful
            app.logger.exception("Failed to send request response notification")
        return jsonify(household_requests.list_recent(consistent=True))

    @app.post("/api/requests/<request_id>/complete")
    def complete_request(request_id: str):
        """Mark a request complete; any valid roommate may do this."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        updated = household_requests.complete(request_id, roommate["id"], roommate["name"])
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

        request_url = f"/?request={updated['id']}"
        try:
            push.notify_users(
                user_ids={updated["requesterId"]},
                exclude_user_ids={roommate["id"]},
                title="Request completed",
                body=f"{roommate['name']} completed “{updated['text']}”",
                url=request_url,
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - completion must remain successful
            app.logger.exception("Failed to send request completion notification")
        return jsonify(household_requests.list_recent(consistent=True))

    @app.post("/api/requests/<request_id>/reopen")
    def reopen_request(request_id: str):
        """Reopen a completed request; any valid roommate may do this."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        updated = household_requests.reopen(request_id, roommate["id"], roommate["name"])
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

        request_url = f"/?request={updated['id']}"
        try:
            push.notify_users(
                user_ids={updated["requesterId"], *updated["requestedIds"]},
                exclude_user_ids={roommate["id"]},
                title="Request reopened",
                body=f"{roommate['name']} reopened “{updated['text']}”",
                url=request_url,
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - reopen must remain successful
            app.logger.exception("Failed to send request reopen notification")
        return jsonify(household_requests.list_recent(consistent=True))

    @app.delete("/api/requests/<request_id>")
    def delete_request(request_id: str):
        """Delete a request only when requested by its creator."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        if not requester_id:
            return jsonify({"error": "A requester id is required."}), 400

        request_item = household_requests.get(request_id, consistent=True)
        result = household_requests.delete_owned(request_id, requester_id)
        if result == household_requests.DELETE_NOT_FOUND:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404
        if result == household_requests.DELETE_FORBIDDEN:
            return jsonify({"error": "Only the requester can delete it."}), 403

        try:
            push.notify_users(
                user_ids={request_item["requesterId"], *request_item["requestedIds"]},
                exclude_user_ids={requester_id},
                title="Request deleted",
                body=f"{request_item['requester']} deleted “{request_item['text']}”",
                url=f"/?request={request_item['id']}",
                event_type="requests-changed",
            )
        except Exception:  # noqa: BLE001 - deletion must remain successful
            app.logger.exception("Failed to send request deletion notification")
        return jsonify(household_requests.list_recent(consistent=True))

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

        mentions = resolve_mentions(text, db.get_all(), author["id"])
        mentions_everyone = mentions_all(text)
        updated = household_requests.add_comment(
            request_id,
            author["name"],
            text,
            mentions,
            mentions_everyone,
            author["id"],
        )
        if updated is None:
            return jsonify({"error": f"Unknown request: {request_id}"}), 404

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
                    url=f"/?request={updated['id']}",
                    event_type="requests-changed",
                )
            except Exception:  # noqa: BLE001 - never let push break the comment
                app.logger.exception("Failed to send request comment notification")

        if mentions_everyone:
            try:
                push.notify_all(
                    title=f"{author['name']} mentioned everyone",
                    body=f"On request “{updated['text']}”: {text}",
                    url=f"/?request={updated['id']}",
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
        return jsonify(household_requests.list_recent(consistent=True))

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
            return jsonify({"error": "A valid roommate is required."}), 400

        result = household_requests.set_comment_like(
            request_id,
            comment_id,
            roommate["id"],
            roommate["name"],
            request.method == "PUT",
        )
        if result == household_requests.LIKE_NOT_FOUND:
            return jsonify({"error": "Unknown request or comment."}), 404
        if result == household_requests.LIKE_SELF_FORBIDDEN:
            return jsonify({"error": "You cannot like your own comment."}), 403
        return jsonify(household_requests.list_recent(consistent=True))

    # --- Checklists ---------------------------------------------------------
    @app.get("/api/checklists")
    def get_checklists():
        """Return recent active household checklists, newest first."""
        return jsonify(household_checklists.list_recent())

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
            cleaned_items,
        )
        try:
            push.notify_all(
                title="New checklist",
                body=f"{creator['name']} posted “{created['title']}”",
                url=f"/?checklist={created['id']}",
                event_type="checklists-changed",
                exclude_user_ids={creator["id"]},
            )
        except Exception:  # noqa: BLE001 - creation must remain successful
            app.logger.exception("Failed to send checklist notification")
        return jsonify(household_checklists.list_recent(consistent=True))

    @app.post("/api/checklists/<checklist_id>/notify")
    def notify_checklist(checklist_id: str):
        """Push a checklist reminder to every roommate except the requester."""
        body = request.get_json(silent=True) or {}
        requester_id = (body.get("requesterId") or "").strip()
        requester = db.get_group_member(requester_id) if requester_id else None
        checklist = household_checklists.get(checklist_id, consistent=True)
        if requester is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        if checklist is None or checklist["isArchived"]:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = push.notify_all(
            title="Checklist reminder",
            body=f"{requester['name']} reminded everyone to update “{checklist['title']}”",
            url=f"/?checklist={checklist['id']}",
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
            return jsonify({"error": "A valid roommate is required."}), 400
        if not text:
            return jsonify({"error": "A checklist item is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400

        updated = household_checklists.add_item(checklist_id, text)
        if updated is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        return jsonify(household_checklists.list_recent(consistent=True))

    @app.post("/api/checklists/<checklist_id>/items/<item_id>/toggle")
    def toggle_checklist_item(checklist_id: str, item_id: str):
        """Toggle the caller's check state for one checklist item."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        updated = household_checklists.toggle_item(
            checklist_id,
            item_id,
            roommate["id"],
            roommate["name"],
        )
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(consistent=True))

    @app.patch("/api/checklists/<checklist_id>/items/<item_id>")
    def update_checklist_item(checklist_id: str, item_id: str):
        """Edit one item in an active checklist."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        text = (body.get("text") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        if not text:
            return jsonify({"error": "A checklist item is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400

        updated = household_checklists.update_item(checklist_id, item_id, text)
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(consistent=True))

    @app.delete("/api/checklists/<checklist_id>/items/<item_id>")
    def delete_checklist_item(checklist_id: str, item_id: str):
        """Delete one item from an active checklist."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        updated = household_checklists.delete_item(checklist_id, item_id)
        if updated is None:
            return jsonify({"error": "Unknown checklist or item."}), 404
        return jsonify(household_checklists.list_recent(consistent=True))

    @app.post("/api/checklists/<checklist_id>/archive")
    def archive_checklist(checklist_id: str):
        """Archive a checklist; any valid roommate may do this."""
        body = request.get_json(silent=True) or {}
        user_id = (body.get("userId") or "").strip()
        roommate = db.get_group_member(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        updated = household_checklists.archive(checklist_id, roommate["id"], roommate["name"])
        if updated is None:
            return jsonify({"error": f"Unknown checklist: {checklist_id}"}), 404
        try:
            push.notify_all(
                title="Checklist archived",
                body=f"{roommate['name']} archived “{updated['title']}”",
                url="/",
                event_type="checklists-changed",
                exclude_user_ids={roommate["id"]},
            )
        except Exception:  # noqa: BLE001 - archive must remain successful
            app.logger.exception("Failed to send checklist archive notification")
        return jsonify(household_checklists.list_recent(consistent=True))

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
            return jsonify({"error": "A valid roommate is required."}), 400

        activity = activities.get(activity_id)
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
            url="/",
        )
        return jsonify(result)

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    # Local dev entrypoint: python app.py
    app.run(host="0.0.0.0", port=8000, debug=True)
