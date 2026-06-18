"""Flask backend for the York Terrace Roomie Status app.

Implements the endpoints the frontend calls (see frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name" } }
    GET  /api/roommates                -> [ { "id", "name", "status", "statusText",
                                             "statusUpdatedAt" }, ... ]
    PUT  /api/roommates/<id>/status    -> the full, updated household list

Plus the Web Push (PoC) endpoints:

    GET  /api/push/public-key          -> { "publicKey": <VAPID public key> }
    POST /api/push/subscribe           -> { "ok": true }  (stores a subscription)
    POST /api/push/test                -> { "sent", "pruned", "failed" }

And the proposed-activities feed:

    GET  /api/activities               -> [ { "id", "text", "proposedBy", "createdAt", "members" }, ... ]
    POST /api/activities               -> the updated recent list (and pushes it)
    POST /api/activities/<id>/join     -> the updated recent list (and pushes it)
    POST /api/activities/<id>/leave    -> the updated recent list
    POST /api/activities/<id>/comments -> the updated recent list (and pushes it)

Roommate data is backed by DynamoDB via db.py; push subscriptions + sending are
in push.py; proposals are in activities.py. Routes stay storage-agnostic.
"""

from __future__ import annotations

import os

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
                    body=f"{free} roomies are around right now — perfect time to gather.",
                    url="/",
                )
            except Exception:  # noqa: BLE001 - never let push break the request
                app.logger.exception("Failed to send gather notification")

        return jsonify(roommates)

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
        subscription = request.get_json(silent=True) or {}
        if not subscription.get("endpoint"):
            return jsonify({"error": "Invalid subscription (no endpoint)."}), 400
        push.save_subscription(subscription)
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
        proposed_by = (body.get("proposedBy") or "Someone").strip() or "Someone"

        if not text:
            return jsonify({"error": "An activity is required."}), 400
        if len(text) > MAX_ACTIVITY_LEN:
            return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400

        activities.add_activity(text, proposed_by)

        # Notify every subscribed device. Best-effort: a push failure must not
        # fail the proposal the user just made.
        try:
            push.notify_all(
                title="New activity proposed 🎉",
                body=f"{proposed_by}: {text}",
                url="/",
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send activity notification")

        # Return the refreshed list so the UI updates in one round-trip.
        # Consistent read so the just-created proposal is always included.
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/join")
    def join_activity(activity_id: str):
        """Add the caller to an activity's members; return the refreshed list."""
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "A name is required."}), 400
        activity = activities.join(activity_id, name)
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404

        # Let everyone know someone's in. Best-effort: a push failure must not
        # fail the join. (Leaving is intentionally quiet — no notification.)
        try:
            push.notify_all(
                title="Someone joined an activity 🙌",
                body=f"{name} joined {activity['text']}",
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
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "A name is required."}), 400
        if activities.leave(activity_id, name) is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        # Consistent read so the updated member list is reflected immediately.
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/comments")
    def comment_on_activity(activity_id: str):
        """Append a comment to an activity; return the refreshed recent list."""
        body = request.get_json(silent=True) or {}
        author = (body.get("author") or "").strip()
        text = (body.get("text") or "").strip()
        if not author:
            return jsonify({"error": "A name is required."}), 400
        if not text:
            return jsonify({"error": "A comment is required."}), 400
        if len(text) > MAX_COMMENT_LEN:
            return jsonify({"error": f"Keep it under {MAX_COMMENT_LEN} characters."}), 400
        activity = activities.add_comment(activity_id, author, text)
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404

        # Notify everyone of the new comment. Best-effort: a push failure must
        # not fail the comment the user just posted.
        try:
            push.notify_all(
                title="New comment 💬",
                body=f"{author} on “{activity['text']}”: {text}",
                url="/",
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            app.logger.exception("Failed to send comment notification")

        # Consistent read so the new comment is reflected immediately.
        return jsonify(activities.list_recent(consistent=True))

    @app.post("/api/activities/<activity_id>/notify")
    def emphasize_activity(activity_id: str):
        """Re-push an existing activity as "<user> emphasized <activity>".

        Anyone can emphasize any activity, not just its proposer. The activity
        text comes from the stored item (not the client) so the notification
        always matches a real proposal.
        """
        body = request.get_json(silent=True) or {}
        emphasized_by = (body.get("emphasizedBy") or "Someone").strip() or "Someone"

        activity = activities.get(activity_id)
        if activity is None:
            return jsonify({"error": f"Unknown activity: {activity_id}"}), 404
        if not push.is_configured():
            return jsonify({"error": "Push is not configured on the server."}), 503

        result = push.notify_all(
            title="Activity emphasized 👀",
            body=f"{emphasized_by} emphasized {activity['text']}",
            url="/",
        )
        return jsonify(result)

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    # Local dev entrypoint: python app.py
    app.run(host="0.0.0.0", port=8000, debug=True)
