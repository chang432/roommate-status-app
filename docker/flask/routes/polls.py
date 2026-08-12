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

bp = Blueprint("polls", __name__)

def polls_response(result, group_id):
    if isinstance(result, dict):
        return jsonify(household_polls.list_recent(group_id, consistent=True))
    messages = {
        household_polls.NOT_FOUND: ("Unknown poll or option.", 404),
        household_polls.FORBIDDEN: ("Only the poll creator can edit this.", 403),
        household_polls.READ_ONLY: ("Archived polls are read-only.", 409),
        household_polls.DUPLICATE: ("Poll options must be unique.", 409),
        household_polls.LIMIT_REACHED: ("A poll can have up to 50 options.", 409),
        household_polls.CONFLICT: ("The poll changed. Please try again.", 409),
    }
    message, status = messages.get(result, ("Could not update the poll.", 409))
    return jsonify({"error": message}), status

@bp.post("/api/polls")
def create_poll():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    creator_id = (body.get("createdById") or "").strip()
    raw_options = body.get("options") or []
    creator = db.get_group_member(creator_id) if creator_id else None
    if creator is None:
        return invalid_user_response()
    if not title:
        return jsonify({"error": "A poll title is required."}), 400
    if len(title) > MAX_ACTIVITY_LEN:
        return jsonify({"error": f"Keep the title under {MAX_ACTIVITY_LEN} characters."}), 400
    if not isinstance(raw_options, list):
        return jsonify({"error": "Poll options must be a list."}), 400
    if not all(isinstance(option, str) for option in raw_options):
        return jsonify({"error": "Every poll option must be text."}), 400
    options = [(option or "").strip() for option in raw_options if (option or "").strip()]
    if len(options) > household_polls.MAX_OPTIONS:
        return jsonify({"error": "A poll can have up to 50 options."}), 400
    if any(len(option) > MAX_ACTIVITY_LEN for option in options):
        return jsonify({"error": f"Keep each option under {MAX_ACTIVITY_LEN} characters."}), 400
    if len({option.casefold() for option in options}) != len(options):
        return jsonify({"error": "Poll options must be unique."}), 400
    created = household_polls.add_poll(
        title, creator["id"], creator["name"], creator["groupId"], options
    )
    try:
        notify_group(
            creator["groupId"],
            title="New poll",
            body=f"{creator['name']} posted “{created['title']}”",
            url=module_models.module_url("polls", created["id"]),
            event_type="polls-changed",
            exclude_user_ids={creator["id"]},
        )
    except Exception:  # noqa: BLE001 - creation must remain successful
        current_app.logger.exception("Failed to send poll notification")
    return jsonify(household_polls.list_recent(creator["groupId"], consistent=True))

@bp.post("/api/polls/<poll_id>/options")
def add_poll_option(poll_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    text = (body.get("text") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    if not text:
        return jsonify({"error": "A poll option is required."}), 400
    if len(text) > MAX_ACTIVITY_LEN:
        return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400
    return polls_response(
        household_polls.add_option(
            poll_id, roommate["id"], roommate["name"], roommate["groupId"], text
        ),
        roommate["groupId"],
    )

@bp.patch("/api/polls/<poll_id>/options/<option_id>")
def edit_poll_option(poll_id: str, option_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    text = (body.get("text") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    if not text:
        return jsonify({"error": "A poll option is required."}), 400
    if len(text) > MAX_ACTIVITY_LEN:
        return jsonify({"error": f"Keep it under {MAX_ACTIVITY_LEN} characters."}), 400
    return polls_response(
        household_polls.edit_option_owned(
            poll_id, option_id, roommate["id"], roommate["groupId"], text
        ),
        roommate["groupId"],
    )

@bp.route("/api/polls/<poll_id>/options/<option_id>/votes", methods=["PUT", "DELETE"])
def update_poll_vote(poll_id: str, option_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return polls_response(
        household_polls.set_vote(
            poll_id,
            option_id,
            roommate["id"],
            roommate["name"],
            roommate["groupId"],
            request.method == "PUT",
        ),
        roommate["groupId"],
    )

@bp.post("/api/polls/<poll_id>/comments")
def comment_on_poll(poll_id: str):
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

    mentions = resolve_mentions(
        text, db.get_all(author["groupId"]), author["id"]
    )
    mentions_everyone = mentions_all(text)
    updated = household_polls.add_comment(
        poll_id,
        author["id"],
        author["name"],
        author["groupId"],
        text,
        mentions,
        mentions_everyone,
    )
    if updated == household_polls.NOT_FOUND:
        return jsonify({"error": f"Unknown poll: {poll_id}"}), 404
    if updated == household_polls.READ_ONLY:
        return jsonify({"error": "Archived polls are read-only."}), 409
    if updated == household_polls.CONFLICT:
        return jsonify({"error": "The poll changed. Please try again."}), 409

    mentioned_ids = {mention["id"] for mention in mentions}
    participant_ids = (
        household_polls.participant_ids(updated)
        - mentioned_ids
        - {author["id"]}
    )

    def notify_poll_users(
        user_ids: set[str], title: str, notification_body: str
    ):
        try:
            push.notify_users(
                user_ids=user_ids,
                title=title,
                body=notification_body,
                url=group_url(
                    author["groupId"],
                    module_models.module_url("polls", updated["id"]),
                ),
                event_type="polls-changed",
            )
        except Exception:  # noqa: BLE001 - push cannot undo the comment
            current_app.logger.exception("Failed to send poll comment notification")

    if mentions_everyone:
        try:
            notify_group(
                author["groupId"],
                title=f"{author['name']} mentioned everyone",
                body=f"On poll “{updated['title']}”: {text}",
                url=module_models.module_url("polls", updated["id"]),
                event_type="polls-changed",
                exclude_user_ids={author["id"]},
            )
        except Exception:  # noqa: BLE001 - push cannot undo the comment
            current_app.logger.exception("Failed to send poll comment @all notification")
    elif mentioned_ids:
        notify_poll_users(
            mentioned_ids,
            f"{author['name']} mentioned you",
            f"On poll “{updated['title']}”: {text}",
        )
    if participant_ids and not mentions_everyone:
        notify_poll_users(
            participant_ids,
            "New poll comment",
            f"{author['name']} on “{updated['title']}”: {text}",
        )
    return jsonify(
        household_polls.list_recent(author["groupId"], consistent=True)
    )

@bp.route(
    "/api/polls/<poll_id>/comments/<comment_id>/likes",
    methods=["PUT", "DELETE"],
)
def update_poll_comment_like(poll_id: str, comment_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    result = household_polls.set_comment_like(
        poll_id,
        comment_id,
        roommate["id"],
        roommate["name"],
        roommate["groupId"],
        request.method == "PUT",
    )
    if result == household_polls.NOT_FOUND:
        return jsonify({"error": "Unknown poll or comment."}), 404
    if result == household_polls.LIKE_SELF_FORBIDDEN:
        return jsonify({"error": "You cannot like your own comment."}), 403
    if result == household_polls.READ_ONLY:
        return jsonify({"error": "Archived polls are read-only."}), 409
    return jsonify(
        household_polls.list_recent(roommate["groupId"], consistent=True)
    )

@bp.post("/api/polls/<poll_id>/archive")
def archive_poll(poll_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return polls_response(
        household_polls.archive(
            poll_id, roommate["id"], roommate["name"], roommate["groupId"]
        ),
        roommate["groupId"],
    )

@bp.post("/api/polls/<poll_id>/restore")
def restore_poll(poll_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return polls_response(
        household_polls.restore(
            poll_id, roommate["id"], roommate["name"], roommate["groupId"]
        ),
        roommate["groupId"],
    )

@bp.delete("/api/polls/<poll_id>")
def delete_poll(poll_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    if household_polls.delete(poll_id, roommate["groupId"]) is None:
        return jsonify({"error": f"Unknown poll: {poll_id}"}), 404
    return jsonify(household_polls.list_recent(roommate["groupId"], consistent=True))

# --- Shows --------------------------------------------------------------

