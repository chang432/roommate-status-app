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

bp = Blueprint("book_club", __name__)

@bp.get("/api/book-club")
def get_book_club():
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify({"summary": book_club.summary(
        viewer["groupId"], db.get_all(viewer["groupId"])
    )})

@bp.post("/api/book-club/meetings")
def create_book_club_meeting():
    viewer, error = group_member_from_query()
    if error:
        return error
    if not db.is_group_admin(viewer["id"], viewer["groupId"]):
        return jsonify({"error": "Only a group admin can create meetings."}), 403
    body = request.get_json(silent=True) or {}
    if body.get("scheduledAt") is None:
        current = book_club.summary(viewer["groupId"], db.get_all(viewer["groupId"]))
        last_at = current["configuration"].get("lastMeetingAt")
        body["scheduledAt"] = (
            book_club.following_meeting_at(last_at)
            if last_at else book_club.next_wednesday_evening()
        )
    meeting, error = book_club.create_meeting(
        viewer["groupId"], db.get_all(viewer["groupId"]), viewer, body
    )
    if error:
        status = 409 if error.startswith("Complete the open") else 400
        return jsonify({"error": error}), status
    return jsonify({"meeting": meeting}), 201

@bp.get("/api/book-club/meetings")
def list_book_club_meetings():
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify({
        "meetings": book_club.list_meetings(
            viewer["groupId"], db.get_all(viewer["groupId"])
        )
    })

@bp.get("/api/book-club/meetings/<meeting_id>")
def get_book_club_meeting(meeting_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    meeting = book_club.get_meeting(
        viewer["groupId"], meeting_id, db.get_all(viewer["groupId"])
    )
    if meeting is None:
        return jsonify({"error": "Unknown meeting."}), 404
    return jsonify({"meeting": meeting})

@bp.put("/api/book-club/meetings/<meeting_id>/response")
def update_book_club_response(meeting_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    _meeting, error = book_club.set_response(
        viewer["groupId"], meeting_id, viewer, body,
    )
    if error:
        return jsonify({"error": error}), 404 if error == "Unknown meeting." else 400
    return jsonify({"meeting": book_club.get_meeting(
        viewer["groupId"], meeting_id, db.get_all(viewer["groupId"])
    )})

@bp.post("/api/book-club/meetings/<meeting_id>/complete")
def complete_book_club_meeting(meeting_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    if not db.is_group_admin(viewer["id"], viewer["groupId"]):
        return jsonify({"error": "Only a group admin can complete meetings."}), 403
    meeting, error = book_club.complete_meeting(viewer["groupId"], meeting_id, viewer)
    if error:
        return jsonify({"error": error}), 404 if error == "Unknown meeting." else 409
    return jsonify({"meeting": meeting})

@bp.post("/api/book-club/books/<book_id>/complete")
def complete_book_club_book(book_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    if not db.is_group_admin(viewer["id"], viewer["groupId"]):
        return jsonify({"error": "Only a group admin can complete books."}), 403
    error = book_club.complete_book(viewer["groupId"], book_id)
    if error:
        status = 409 if error == "Complete the open meeting before completing the current book." else 404
        return jsonify({"error": error}), status
    return jsonify({"summary": book_club.summary(
        viewer["groupId"], db.get_all(viewer["groupId"])
    )})

@bp.post("/api/book-club/meetings/<meeting_id>/notify")
def notify_book_club_meeting(meeting_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    meeting = book_club.get_meeting(
        viewer["groupId"], meeting_id, db.get_all(viewer["groupId"])
    )
    if meeting is None or meeting.get("status") != book_club.OPEN_STATUS:
        return jsonify({"error": "Unknown open Book Club meeting."}), 404
    if not push.is_configured():
        return jsonify({"error": "Push is not configured on the server."}), 503
    result = notify_group(
        viewer["groupId"],
        title="Book Club reminder",
        body=(
            f"{book_club.meeting_label(meeting['scheduledAt'])} · "
            f"{meeting.get('bookTitle') or 'Current book'}\n"
            f"Goal: {meeting.get('readingTarget') or 'To be set'} · "
            f"Snacks: {meeting.get('snackOwnerName') or 'To be assigned'}"
        ),
        url=module_models.module_url("book-club", meeting_id),
        event_type="book-club-changed",
    )
    return jsonify(result)

@bp.get("/api/book-club/books")
def list_book_club_books():
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify({"books": book_club.list_books(viewer["groupId"], viewer["id"])})

@bp.post("/api/book-club/books")
def add_book_club_book():
    viewer, error = group_member_from_query()
    if error:
        return error
    if not db.is_group_admin(viewer["id"], viewer["groupId"]):
        return jsonify({"error": "Only a group admin can add books."}), 403
    book, error = book_club.add_book(
        viewer["groupId"], db.get_all(viewer["groupId"]),
        request.get_json(silent=True) or {},
    )
    if error:
        status = 409 if error.startswith("Complete the open meeting") else 400
        return jsonify({"error": error}), status
    return jsonify({
        "book": book,
        "books": book_club.list_books(viewer["groupId"], viewer["id"]),
    }), 201

@bp.patch("/api/book-club/books/<book_id>")
def update_book_club_book(book_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    if body.get("setAsCurrent") is True and not db.is_group_admin(
        viewer["id"], viewer["groupId"]
    ):
        return jsonify({"error": "Only a group admin can set the current book."}), 403
    book, error = book_club.update_book(
        viewer["groupId"], book_id, db.get_all(viewer["groupId"]),
        body,
    )
    if error:
        status = 404 if error == "Unknown Book Club book." else (
            409 if error == "A current book or open meeting already exists." else 400
        )
        return jsonify({"error": error}), status
    return jsonify({
        "book": book,
        "books": book_club.list_books(viewer["groupId"], viewer["id"]),
        "summary": book_club.summary(viewer["groupId"], db.get_all(viewer["groupId"])),
    })

@bp.put("/api/book-club/books/<book_id>/review")
def review_book_club_book(book_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    error = book_club.set_review(
        viewer["groupId"],
        book_id,
        viewer,
        body.get("rating"),
        body.get("finished"),
        body.get("note", ""),
    )
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"books": book_club.list_books(viewer["groupId"], viewer["id"])})

# --- Book-tagged forums ------------------------------------------------

