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

bp = Blueprint("shows", __name__)

def shows_response(result, group_id):
    """Map a household_shows watcher-mutation result to a JSON response.

    None -> unknown show or watcher, or one in another group (404);
    MUTATION_ARCHIVED -> the show is archived and read-only (409);
    otherwise the group's refreshed show list.
    """
    if result is None:
        return jsonify({"error": "Unknown show or watcher."}), 404
    if result == household_shows.MUTATION_ARCHIVED:
        return jsonify({"error": "Archived shows are read-only."}), 409
    if result == household_shows.WATCHPARTY_EMPTY:
        return jsonify({"error": "Add at least one watcher before starting a watchparty."}), 409
    return jsonify(household_shows.list_recent(group_id, consistent=True))

@bp.get("/api/shows")
def get_shows():
    """Return the caller's group's recent shows, newest first."""
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify(household_shows.list_recent(viewer["groupId"]))

@bp.post("/api/shows")
def create_show():
    """Create a show (auto-joining the creator) and return the refreshed list."""
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    created_by_id = (body.get("createdById") or "").strip()
    if not title:
        return jsonify({"error": "A show title is required."}), 400
    if len(title) > MAX_ACTIVITY_LEN:
        return jsonify({"error": f"Keep the title under {MAX_ACTIVITY_LEN} characters."}), 400
    creator = db.get_group_member(created_by_id) if created_by_id else None
    if creator is None:
        return jsonify({"error": "A valid creator is required."}), 400

    household_shows.add_show(title, creator["id"], creator["name"], creator["groupId"])
    return jsonify(household_shows.list_recent(creator["groupId"], consistent=True))

@bp.post("/api/shows/<show_id>/join")
def join_show(show_id: str):
    """Add the caller as a watcher; the display name comes from their account."""
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return shows_response(
        household_shows.join(show_id, roommate["id"], roommate["name"], roommate["groupId"]),
        roommate["groupId"],
    )

@bp.post("/api/shows/<show_id>/leave")
def leave_show(show_id: str):
    """Remove the caller from a show's watcher list."""
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    roommate = db.get_group_member(user_id) if user_id else None
    if roommate is None:
        return invalid_user_response()
    return shows_response(
        household_shows.leave(show_id, roommate["id"], roommate["groupId"]),
        roommate["groupId"],
    )

@bp.patch("/api/shows/<show_id>/watchers/<member_id>/<field>")
def adjust_show_progress(show_id: str, member_id: str, field: str):
    """Nudge one watcher's season or episode by an integer delta (+1 / -1).

    Episode edits are open to every roommate in the show's group (matching
    the feature's loose ownership), so the caller need only be a valid
    roommate — their group scopes which show they can touch.
    """
    if field not in household_shows.PROGRESS_FIELDS:
        return jsonify({"error": "Progress field must be season or episode."}), 400
    body = request.get_json(silent=True) or {}
    roommate = db.get_group_member((body.get("userId") or "").strip())
    if roommate is None:
        return invalid_user_response()
    delta = body.get("delta")
    if not isinstance(delta, int) or isinstance(delta, bool):
        return jsonify({"error": "A whole-number delta is required."}), 400
    return shows_response(
        household_shows.adjust_progress(
            show_id, member_id, field, delta, roommate["groupId"]
        ),
        roommate["groupId"],
    )

@bp.put("/api/shows/<show_id>/watchers/<member_id>/<field>")
def set_show_progress(show_id: str, member_id: str, field: str):
    """Set one watcher's season or episode to an absolute value."""
    if field not in household_shows.PROGRESS_FIELDS:
        return jsonify({"error": "Progress field must be season or episode."}), 400
    body = request.get_json(silent=True) or {}
    roommate = db.get_group_member((body.get("userId") or "").strip())
    if roommate is None:
        return invalid_user_response()
    value = body.get("value")
    if not isinstance(value, int) or isinstance(value, bool):
        return jsonify({"error": "A whole-number value is required."}), 400
    return shows_response(
        household_shows.set_progress(
            show_id, member_id, field, value, roommate["groupId"]
        ),
        roommate["groupId"],
    )

@bp.post("/api/shows/<show_id>/archive")
def archive_show(show_id: str):
    """Archive a show so it leaves the active list."""
    return _toggle_show_archive(show_id, household_shows.archive, "archive")

@bp.post("/api/shows/<show_id>/restore")
def restore_show(show_id: str):
    """Restore an archived show back to the active list."""
    return _toggle_show_archive(show_id, household_shows.restore, "restore")

@bp.delete("/api/shows/<show_id>")
def delete_show(show_id: str):
    """Delete a show from the household feed."""
    body = request.get_json(silent=True) or {}
    requester_id = (body.get("requesterId") or "").strip()
    requester = db.get_group_member(requester_id) if requester_id else None
    if requester is None:
        return invalid_user_response()
    result = household_shows.delete(show_id, requester["groupId"])
    if result == household_shows.DELETE_NOT_FOUND:
        return jsonify({"error": f"Unknown show: {show_id}"}), 404
    return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))

def _set_show_watchparty(show_id: str, live: bool):
    body = request.get_json(silent=True) or {}
    requester_id = (body.get("requesterId") or "").strip()
    requester = db.get_group_member(requester_id) if requester_id else None
    if requester is None:
        return invalid_user_response()
    season = body.get("season")
    episode = body.get("episode")
    if live:
        if not isinstance(season, int) or isinstance(season, bool):
            return jsonify({"error": "A whole-number season is required."}), 400
        if not isinstance(episode, int) or isinstance(episode, bool):
            return jsonify({"error": "A whole-number episode is required."}), 400

    show = household_shows.get(show_id, requester["groupId"], consistent=True)
    action = household_shows.start_watchparty if live else household_shows.end_watchparty
    if live:
        result = action(
            show_id,
            requester["id"],
            requester["name"],
            requester["groupId"],
            season,
            episode,
        )
    else:
        result = action(
            show_id,
            requester["id"],
            requester["name"],
            requester["groupId"],
        )
    if result is None:
        return jsonify({"error": f"Unknown show: {show_id}"}), 404
    if result == household_shows.MUTATION_ARCHIVED:
        return jsonify({"error": "Archived shows are read-only."}), 409
    if result == household_shows.WATCHPARTY_EMPTY:
        return jsonify({"error": "Add at least one watcher before starting a watchparty."}), 409

    watcher_ids = {member["id"] for member in show.get("members", []) if member.get("id")} if show else set()
    try:
        push.notify_users(
            user_ids=watcher_ids,
            exclude_user_ids={requester["id"]},
            title="Watchparty started" if live else "Watchparty ended",
            body=(
                f"{requester['name']} started watching {result['title']} "
                f"S{result['watchpartySeason']} E{result['watchpartyEpisode']}"
                if live
                else f"{requester['name']} ended the {result['title']} watchparty"
            ),
            url=group_url(requester["groupId"], module_models.module_url("tv", show_id)),
            event_type="shows-changed",
        )
    except Exception:  # noqa: BLE001 - watchparty state must remain successful
        current_app.logger.exception("Failed to send show watchparty notification")
    return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))

@bp.post("/api/shows/<show_id>/watchparty/start")
def start_show_watchparty(show_id: str):
    """Mark a show's watcher group as actively watching."""
    return _set_show_watchparty(show_id, True)

@bp.post("/api/shows/<show_id>/watchparty/end")
def end_show_watchparty(show_id: str):
    """End the live watchparty state for a show."""
    return _set_show_watchparty(show_id, False)

def _toggle_show_archive(show_id, action, verb):
    body = request.get_json(silent=True) or {}
    requester_id = (body.get("requesterId") or "").strip()
    requester = db.get_group_member(requester_id) if requester_id else None
    if requester is None:
        return invalid_user_response()
    result = action(show_id, requester["id"], requester["name"], requester["groupId"])
    if result is None:
        return jsonify({"error": f"Unknown show: {show_id}"}), 404
    return jsonify(household_shows.list_recent(requester["groupId"], consistent=True))


