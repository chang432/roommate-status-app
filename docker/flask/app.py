"""Flask application factory for the Roomie Status API."""

from __future__ import annotations

from flask import Flask, g, request
from flask_cors import CORS

import db
from routes import BLUEPRINTS


def create_app() -> Flask:
    """Build the API and register its feature-owned blueprints."""
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.before_request
    def ensure_group_state():
        """Scope API datastore reads to the caller's selected household."""
        if request.path.startswith("/api/"):
            g.request_group_token = db.set_request_group_id(
                request.headers.get("X-Roomie-Group-ID")
            )

    @app.teardown_request
    def clear_request_group_state(_error):
        token = getattr(g, "request_group_token", None)
        if token is not None:
            db.reset_request_group_id(token)

    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)

    return app


# Module-level app for `flask run` and Gunicorn (`app:app`).
app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
