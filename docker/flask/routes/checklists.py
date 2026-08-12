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

bp = Blueprint("checklists", __name__)

@bp.post("/api/checklists")
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
        current_app.logger.exception("Failed to send checklist notification")
    return jsonify(household_checklists.list_recent(creator["groupId"], consistent=True))

@bp.post("/api/checklists/<checklist_id>/notify")
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

@bp.post("/api/checklists/<checklist_id>/items")
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

@bp.post("/api/checklists/<checklist_id>/items/<item_id>/toggle")
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

@bp.patch("/api/checklists/<checklist_id>/items/<item_id>")
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

@bp.delete("/api/checklists/<checklist_id>/items/<item_id>")
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

@bp.post("/api/checklists/<checklist_id>/archive")
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
        current_app.logger.exception("Failed to send checklist archive notification")
    return jsonify(household_checklists.list_recent(roommate["groupId"], consistent=True))

@bp.post("/api/checklists/<checklist_id>/restore")
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

@bp.delete("/api/checklists/<checklist_id>")
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

# --- Polls --------------------------------------------------------------

