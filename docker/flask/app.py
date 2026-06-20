"""Flask backend for the Yorkshire Roomie Status app.

Implements the endpoints the frontend calls (see frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name" } }
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

    GET  /api/activities               -> [ { "id", "text", "proposedBy",
                                             "proposedById", "createdAt", "members",
                                             "memberIds" }, ... ]
    POST /api/activities               -> the updated recent list (and pushes it)
    DELETE /api/activities/<id>        -> the updated recent list
    POST /api/activities/<id>/start    -> the updated recent list (and pushes it)
    POST /api/activities/<id>/end      -> the updated recent list (and pushes it)
    POST /api/activities/<id>/join     -> the updated recent list (and pushes it)
    POST /api/activities/<id>/leave    -> the updated recent list
    POST /api/activities/<id>/comments -> the updated recent list (and pushes it)
    PUT/DELETE /api/activities/<id>/comments/<comment_id>/likes
                                        -> the updated recent list

Roommate data is backed by DynamoDB via db.py; push subscriptions + sending are
in push.py; proposals are in activities.py. Routes stay storage-agnostic.
"""

from __future__ import annotations

import os
import re

from flask import Flask, jsonify, request
from flask_cors import CORS

import activities
import db
import push

# Cap proposal text so a notification body stays sane.
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
        """Validate a name + password and return the signed-in roommate.

        Auth is intentionally trivial for now: every roommate shares the demo
        password (db.DEMO_PASSWORD). Real credential checks land with the real DB.
        """
        body = request.get_json(silent=True) or {}
        name = body.get("name", "")
        password = body.get("password", "")

        roommate = db.find_by_name(name)
        if roommate is None or password != db.DEMO_PASSWORD:
            # Mirror the frontend mock's error copy.
            return (
                jsonify({"error": "That name and password don’t match. (Demo password: roomie)"}),
                401,
            )

        return jsonify({"user": {"id": roommate["id"], "name": roommate["name"]}})

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
        requester = db.get_by_id(requester_id) if requester_id else None
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
        requester = db.get_by_id(requester_id) if requester_id else None
        target = db.get_by_id(roommate_id)
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
        if db.get_by_id(user_id) is None:
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

    # --- Proposed activities ------------------------------------------------
    @app.get("/api/activities")
    def get_activities():
        """Return the most recent proposed activities, newest first."""
        return jsonify(activities.list_recent())

    @app.post("/api/activities")
    def propose_activity():
        """Store a new proposal, push it to everyone, return the recent list."""
        body = request.get_json(silent=True) or {}
        text = (body.get("text") or "").strip()
        proposed_by_id = (body.get("proposedById") or "").strip()

        if not text:
            return jsonify({"error": "An activity is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400
        proposer = db.get_by_id(proposed_by_id) if proposed_by_id else None
        if proposer is None:
            return jsonify({"error": "A valid creator is required."}), 400

        activities.add_activity(text, proposer["id"], proposer["name"])

        # Notify the household except the proposer. Best-effort: a push failure
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
        """Apply a creator-owned live transition and notify the household."""
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
            message = (
                "Another event is already live."
                if action == "start"
                else "This event is not currently live."
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
        """Let an event creator make their event the one live household event."""
        return transition_activity_live(activity_id, "start")

    @app.post("/api/activities/<activity_id>/end")
    def end_activity(activity_id: str):
        """Let an event creator end their live event so another may start."""
        return transition_activity_live(activity_id, "end")

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
        roommate = db.get_by_id(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        activity = activities.join(activity_id, roommate["id"], roommate["name"])
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404

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
        roommate = db.get_by_id(user_id) if user_id else None
        if roommate is None:
            return jsonify({"error": "A valid roommate is required."}), 400
        if activities.leave(activity_id, roommate["id"], roommate["name"]) is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/comments")
    def comment_on_activity(activity_id: str):
        """Append a comment to an activity; return the refreshed recent list."""
        body = request.get_json(silent=True) or {}
        author_id = (body.get("authorId") or "").strip()
        text = (body.get("text") or "").strip()
        author = db.get_by_id(author_id) if author_id else None
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
        roommate = db.get_by_id(user_id) if user_id else None
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
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/notify")
    def emphasize_activity(activity_id: str):
        """Re-push an existing activity as "<user> emphasized <activity>".

        Anyone can emphasize any activity, not just its proposer. The activity
        text comes from the stored item (not the client) so the notification
        always matches a real proposal.
        """
        body = request.get_json(silent=True) or {}
        emphasized_by_id = (body.get("emphasizedById") or "").strip()
        emphasized_by = db.get_by_id(emphasized_by_id) if emphasized_by_id else None
        if emphasized_by is None:
            return jsonify({"error": "A valid roommate is required."}), 400

        activity = activities.get(activity_id)
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
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
