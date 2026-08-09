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

bp = Blueprint("counters", __name__)

def counter_actor(body: dict, field: str = "userId"):
    actor_id = body.get(field)
    return (
        db.get_group_member(actor_id.strip())
        if isinstance(actor_id, str) and actor_id.strip()
        else None
    )

def counter_result(result):
    if isinstance(result, dict):
        return jsonify({"counter": result})
    responses = {
        household_counters.NOT_FOUND: (
            "That counter or history entry was not found.",
            404,
        ),
        household_counters.FORBIDDEN: (
            "Only the counter creator can do that.",
            403,
        ),
        household_counters.READ_ONLY: ("Archived counters are read-only.", 409),
        household_counters.INVALID: ("That counter update is invalid.", 400),
        household_counters.CONFLICT: ("The counter changed. Please try again.", 409),
    }
    message, status = responses.get(result, ("Could not update the counter.", 400))
    return jsonify({"error": message}), status

@bp.post("/api/counters")
def create_counter():
    body = request.get_json(silent=True) or {}
    creator = counter_actor(body, "createdById")
    if creator is None:
        return invalid_user_response()
    created = household_counters.add_counter(
        body.get("title"),
        body.get("mode"),
        creator["id"],
        creator["name"],
        creator["groupId"],
        occurred_date=body.get("occurredDate"),
        time_zone=body.get("timeZone"),
        initial_value=body.get("initialValue"),
        note=body.get("note", ""),
    )
    if not isinstance(created, dict):
        return counter_result(created)
    try:
        notify_group(
            creator["groupId"],
            title="Counter created",
            body=f"{creator['name']} created {created['title']}.",
            url=module_models.module_url("counters", created["id"]),
            event_type="counters-changed",
            exclude_user_ids={creator["id"]},
        )
    except Exception:  # noqa: BLE001 - creation remains successful
        current_app.logger.exception("Failed to send counter creation notification")
    return jsonify({"counter": created})

@bp.get("/api/counters/<counter_id>")
def get_counter(counter_id: str):
    viewer, error = group_member_from_query()
    if error:
        return error
    try:
        limit = int(request.args.get("limit", household_counters.HISTORY_PAGE_SIZE))
    except (TypeError, ValueError):
        return jsonify({"error": "History limit must be a number."}), 400
    detail = household_counters.get_detail(
        counter_id,
        viewer["groupId"],
        request.args.get("cursor"),
        limit,
    )
    if detail is None:
        return jsonify({"error": "That counter was not found."}), 404
    if detail == household_counters.INVALID:
        return jsonify({"error": "That history cursor is invalid."}), 400
    return jsonify(detail)

@bp.post("/api/counters/<counter_id>/entries")
def create_counter_entry(counter_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    result = household_counters.add_entry(counter_id, actor, body)
    if isinstance(result, dict) and result["mode"] == household_counters.AUTOMATIC:
        try:
            notify_group(
                actor["groupId"],
                title="Incident logged",
                body=f"{actor['name']} logged an incident for {result['title']}.",
                url=module_models.module_url("counters", counter_id),
                event_type="counters-changed",
                exclude_user_ids={actor["id"]},
            )
        except Exception:  # noqa: BLE001 - entry remains successful
            current_app.logger.exception("Failed to send counter incident notification")
    return counter_result(result)

@bp.patch("/api/counters/<counter_id>/entries/<entry_id>")
def update_counter_entry(counter_id: str, entry_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    return counter_result(
        household_counters.edit_entry(
            counter_id,
            entry_id,
            actor,
            body.get("changes"),
        )
    )

@bp.delete("/api/counters/<counter_id>/entries/<entry_id>")
def remove_counter_entry(counter_id: str, entry_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    return counter_result(household_counters.delete_entry(counter_id, entry_id, actor))

@bp.post("/api/counters/<counter_id>/archive")
def archive_counter(counter_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    return counter_result(household_counters.archive(counter_id, actor))

@bp.post("/api/counters/<counter_id>/restore")
def restore_counter(counter_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    return counter_result(household_counters.restore(counter_id, actor))

@bp.delete("/api/counters/<counter_id>")
def delete_counter(counter_id: str):
    body = request.get_json(silent=True) or {}
    actor = counter_actor(body)
    if actor is None:
        return invalid_user_response()
    return counter_result(household_counters.delete_owned(counter_id, actor))

# --- Proposed activities ------------------------------------------------

