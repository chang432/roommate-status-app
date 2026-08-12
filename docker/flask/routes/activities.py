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

bp = Blueprint("activities", __name__)

@bp.get("/api/activities")
def get_activities():
    """Return current activities followed by expired activity history."""
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify(activities.list_recent(viewer["groupId"]))

@bp.post("/api/activities")
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
        current_app.logger.exception("Failed to send activity notification")

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
        current_app.logger.info("Event %s push result: %s", action, push_result)
    except Exception:  # noqa: BLE001 - transition must remain successful
        current_app.logger.exception("Failed to send event %s notification", action)

    return jsonify(activities.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/activities/<activity_id>/start")
def start_activity(activity_id: str):
    """Let an event creator start or restart their event immediately."""
    return transition_activity_live(activity_id, "start")

@bp.post("/api/activities/<activity_id>/end")
def end_activity(activity_id: str):
    """Let an event creator permanently end their live event."""
    return transition_activity_live(activity_id, "end")

@bp.post("/api/activities/<activity_id>/archive")
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
        current_app.logger.exception("Failed to send activity archive notification")

    return jsonify(activities.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/activities/<activity_id>/restore")
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

@bp.delete("/api/activities/<activity_id>")
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
        current_app.logger.exception("Failed to send activity deletion notification")

    return jsonify(activities.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/activities/<activity_id>/join")
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
        current_app.logger.exception("Failed to send join notification")

    # Consistent read so the updated member list is reflected immediately.
    return jsonify(activities.list_recent(roommate["groupId"], consistent=True))

@bp.post("/api/activities/<activity_id>/leave")
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

@bp.post("/api/activities/<activity_id>/comments")
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
            current_app.logger.info(
                "Comment push result for %d recipient(s): %s",
                len(user_ids),
                result,
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            current_app.logger.exception("Failed to send comment notification")

    if mentions_everyone:
        try:
            result = notify_group(
                author["groupId"],
                title=f"{author['name']} mentioned everyone",
                body=f"On “{activity['text']}”: {text}",
                url=module_models.module_url("events", activity_id),
                exclude_user_ids={author["id"]},
            )
            current_app.logger.info("Comment @all push result: %s", result)
        except Exception:  # noqa: BLE001 - never let push break the request
            current_app.logger.exception("Failed to send comment @all notification")
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

@bp.route(
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
@bp.post("/api/activities/<activity_id>/notify")
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


