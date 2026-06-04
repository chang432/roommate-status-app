"""Flask backend for the York Terrace Roomie Status app.

Implements exactly the three endpoints the frontend calls (see
frontend/src/api/client.js):

    POST /api/login                    -> { "user": { "id", "name" } }
    GET  /api/roommates                -> [ { "id", "name", "status", "statusText" }, ... ]
    PUT  /api/roommates/<id>/status    -> the full, updated household list

Data is backed by the in-memory mock in db.py; replace that module with a real
datastore later without touching these routes.
"""

from __future__ import annotations

from flask import Flask, jsonify, request
from flask_cors import CORS

import db


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

        # When enough roommates are free, this is where a real backend would push
        # a notification to everyone (PROJECT.md). For now we just log it.
        free = db.available_count(roommates)
        if free >= db.AVAILABLE_THRESHOLD:
            app.logger.info("Notification: %d roommates are available — time to gather!", free)

        return jsonify(roommates)

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    # Local dev entrypoint: python app.py
    app.run(host="0.0.0.0", port=8000, debug=True)
