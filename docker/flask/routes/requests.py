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

bp = Blueprint("requests", __name__)

@bp.post("/api/requests")
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
        current_app.logger.exception("Failed to send request notification")
    return jsonify(household_requests.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/requests/<request_id>/responses")
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
        current_app.logger.exception("Failed to send request response notification")
    return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

@bp.post("/api/requests/<request_id>/archive")
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
        current_app.logger.exception("Failed to send request archive notification")
    return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

@bp.post("/api/requests/<request_id>/restore")
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
        current_app.logger.exception("Failed to send request restore notification")
    return jsonify(household_requests.list_recent(roommate["groupId"], consistent=True))

@bp.delete("/api/requests/<request_id>")
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
        current_app.logger.exception("Failed to send request deletion notification")
    return jsonify(household_requests.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/requests/<request_id>/comments")
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
            current_app.logger.exception("Failed to send request comment notification")

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
            current_app.logger.exception("Failed to send request comment @all notification")
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

@bp.route(
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

