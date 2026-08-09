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

bp = Blueprint("forums", __name__)

def forum_result(result, group_id: str):
    if isinstance(result, dict):
        return jsonify(household_forums.list_recent(group_id, consistent=True))
    messages = {
        household_forums.NOT_FOUND: ("Unknown forum.", 404),
        household_forums.FORBIDDEN: ("Only the forum creator can edit it.", 403),
        household_forums.READ_ONLY: ("Archived forums are read-only.", 409),
        household_forums.CONFLICT: ("The forum changed. Please try again.", 409),
    }
    message, status = messages.get(result, ("Could not update the forum.", 409))
    return jsonify({"error": message}), status

@bp.get("/api/forums")
def get_forums():
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify(household_forums.list_recent(viewer["groupId"]))

@bp.post("/api/forums")
def create_forum():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    book_id = (body.get("bookId") or "").strip()
    creator_id = (body.get("createdById") or "").strip()
    creator = db.get_group_member(creator_id) if creator_id else None
    if creator is None:
        return invalid_user_response()
    if not title:
        return jsonify({"error": "A forum title is required."}), 400
    if len(title) > MAX_ACTIVITY_LEN:
        return jsonify({"error": f"Keep the title under {MAX_ACTIVITY_LEN} characters."}), 400
    created = household_forums.add_forum(
        title, book_id, creator["id"], creator["name"], creator["groupId"]
    )
    if created == household_forums.NOT_FOUND:
        return jsonify({"error": "Choose a valid Book Club book."}), 400
    try:
        notify_group(
            creator["groupId"],
            title="New book forum",
            body=f"{creator['name']} posted “{created['title']}”",
            url=module_models.module_url("forums", created["id"]),
            event_type="forums-changed",
            exclude_user_ids={creator["id"]},
        )
    except Exception:  # noqa: BLE001 - creation must remain successful
        current_app.logger.exception("Failed to send forum notification")
    return jsonify(household_forums.list_recent(creator["groupId"], consistent=True)), 201

@bp.post("/api/forums/<forum_id>/comments")
def comment_on_forum(forum_id: str):
    body = request.get_json(silent=True) or {}
    author_id = (body.get("authorId") or "").strip()
    text = (body.get("text") or "").strip()
    author = db.get_group_member(author_id) if author_id else None
    if author is None:
        return invalid_user_response()
    if not text:
        return jsonify({"error": "A comment is required."}), 400
    if len(text) > MAX_COMMENT_LEN:
        return jsonify({"error": f"Keep it under {MAX_COMMENT_LEN} characters."}), 400
    mentions = resolve_mentions(text, db.get_all(author["groupId"]), author["id"])
    mentions_everyone = mentions_all(text)
    updated = household_forums.add_comment(
        forum_id,
        author["id"],
        author["name"],
        author["groupId"],
        text,
        mentions,
        mentions_everyone,
    )
    if not isinstance(updated, dict):
        return forum_result(updated, author["groupId"])

    mentioned_ids = {mention["id"] for mention in mentions}
    participant_ids = (
        household_forums.participant_ids(updated)
        - mentioned_ids
        - {author["id"]}
    )
    forum_url = module_models.module_url("forums", updated["id"])

    def notify_forum_users(user_ids: set[str], title: str, notification_body: str):
        try:
            push.notify_users(
                user_ids=user_ids,
                title=title,
                body=notification_body,
                url=group_url(author["groupId"], forum_url),
                event_type="forums-changed",
            )
        except Exception:  # noqa: BLE001 - push cannot undo a comment
            current_app.logger.exception("Failed to send forum comment notification")

    if mentions_everyone:
        try:
            notify_group(
                author["groupId"],
                title=f"{author['name']} mentioned everyone",
                body=f"On forum “{updated['title']}”: {text}",
                url=forum_url,
                event_type="forums-changed",
                exclude_user_ids={author["id"]},
            )
        except Exception:  # noqa: BLE001 - push cannot undo a comment
            current_app.logger.exception("Failed to send forum @all notification")
    elif mentioned_ids:
        notify_forum_users(
            mentioned_ids,
            f"{author['name']} mentioned you",
            f"On forum “{updated['title']}”: {text}",
        )
    if participant_ids and not mentions_everyone:
        notify_forum_users(
            participant_ids,
            "New forum comment",
            f"{author['name']} on “{updated['title']}”: {text}",
        )
    return jsonify(household_forums.list_recent(author["groupId"], consistent=True))

@bp.route(
    "/api/forums/<forum_id>/comments/<comment_id>/likes",
    methods=["PUT", "DELETE"],
)
def update_forum_comment_like(forum_id: str, comment_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    result = household_forums.set_comment_like(
        forum_id,
        comment_id,
        roommate["id"],
        roommate["name"],
        roommate["groupId"],
        request.method == "PUT",
    )
    if result == household_forums.LIKE_SELF_FORBIDDEN:
        return jsonify({"error": "You cannot like your own comment."}), 403
    if result == "ok":
        result = household_forums.get(forum_id, roommate["groupId"])
    return forum_result(result, roommate["groupId"])

@bp.post("/api/forums/<forum_id>/archive")
def archive_forum(forum_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return forum_result(
        household_forums.archive(forum_id, roommate["id"], roommate["name"], roommate["groupId"]),
        roommate["groupId"],
    )

@bp.post("/api/forums/<forum_id>/restore")
def restore_forum(forum_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return forum_result(
        household_forums.restore(forum_id, roommate["id"], roommate["name"], roommate["groupId"]),
        roommate["groupId"],
    )

@bp.delete("/api/forums/<forum_id>")
def delete_forum(forum_id: str):
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    if household_forums.delete(forum_id, roommate["groupId"]) is None:
        return jsonify({"error": f"Unknown forum: {forum_id}"}), 404
    return jsonify(household_forums.list_recent(roommate["groupId"], consistent=True))

# --- Spotify Jam --------------------------------------------------------

