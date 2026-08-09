"""Feature routes extracted from the application factory."""

from flask import Blueprint, current_app, jsonify, request

import activities
import book_club
import db
import groups
import household_checklists
import household_counters
import household_forums
import household_polls
import household_requests
import household_shows
import jam
import module_edits
import module_models
import profile_names
import push
from route_helpers import *  # noqa: F403
from route_helpers import _activity_status_overrides

bp = Blueprint("feed", __name__)

@bp.get("/api/jam")
def get_jam():
    """Return the one active household Jam, if any."""
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify(jam.get_active(viewer["groupId"]))

@bp.post("/api/jam")
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
        current_app.logger.exception("Failed to send Jam notification")
    return jsonify(active)

@bp.delete("/api/jam")
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
        current_app.logger.exception("Failed to send Jam ended notification")
    return jsonify(jam.get_active(host["groupId"]))

@bp.get("/api/feed")
def get_feed():
    """Return active household module instances in chronological feed order."""
    viewer, error = group_member_from_query()
    if error:
        return error
    module_type = (request.args.get("type") or "all").strip()
    if module_type != "all" and module_type not in module_models.MODULE_TYPES:
        return jsonify({"error": "Unknown module type."}), 400
    return jsonify(module_models.list_feed(viewer["groupId"], module_type))

@bp.patch("/api/modules/<module_type>/<item_id>")
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
        message = (
            "Only a group admin can edit Book Club meetings."
            if module_type == "book-club"
            else "Only the module creator can edit it."
        )
        return jsonify({"error": message}), 403
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
        current_app.logger.exception("Failed to send module edit notification")
    return jsonify({"module": feed_item})

# --- Household counters -------------------------------------------------

