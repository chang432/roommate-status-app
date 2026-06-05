"""Flask backend for the York Terrace Roomie Status app.

Implements the endpoints the frontend calls (see frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name" } }
    GET  /api/roommates                -> [ { "id", "name", "status", "statusText" }, ... ]
    PUT  /api/roommates/<id>/status    -> the full, updated household list

Plus the Web Push (PoC) endpoints:

    GET  /api/push/public-key          -> { "publicKey": <VAPID public key> }
    POST /api/push/subscribe           -> { "ok": true }  (stores a subscription)
    POST /api/push/test                -> { "sent", "pruned", "failed" }

Roommate data is backed by DynamoDB via db.py; push subscriptions + sending are
encapsulated in push.py. Routes stay storage-agnostic.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, request
from flask_cors import CORS

import db
import push

# Number of available roommates that triggers the "gather" push. PROJECT.md
# specifies 3; this PoC defaults to 2 (override with AVAILABLE_THRESHOLD) so the
# notification path is easy to exercise with a small household.
PUSH_THRESHOLD = int(os.environ.get("AVAILABLE_THRESHOLD", "2"))


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

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    # Local dev entrypoint: python app.py
    app.run(host="0.0.0.0", port=8000, debug=True)
