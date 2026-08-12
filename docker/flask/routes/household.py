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

bp = Blueprint("household", __name__)

@bp.get("/api/health")
def health():
    """Simple liveness probe for Docker / load balancers."""
    return jsonify({"status": "ok"})

@bp.post("/api/login")
def login():
    """Validate a username + password and return the signed-in account."""
    body = request.get_json(silent=True) or {}
    username = body.get("username", "")
    password = body.get("password", "")

    user = db.authenticate(username, password)
    if user is None:
        return jsonify({"error": "That username and password don’t match."}), 401

    return jsonify({"user": db.get_account_profile(user["id"])})

@bp.post("/api/accounts")
def create_account():
    """Create a signed-in account that cannot use household features yet."""
    body = request.get_json(silent=True) or {}
    user, error = db.create_account(
        body.get("username", ""),
        body.get("name", ""),
        body.get("password", ""),
    )
    if error == "invalid_username":
        return (
            jsonify(
                {
                    "error": (
                        "Username must be 3-32 characters: lowercase letters, "
                        "numbers, underscores, or hyphens."
                    )
                }
            ),
            400,
        )
    if error == "invalid_name":
        return jsonify({"error": "A display name is required."}), 400
    if error == "invalid_password":
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if error == "duplicate_username":
        return jsonify({"error": "That username is already taken."}), 409
    return jsonify({"user": user}), 201

@bp.get("/api/accounts/<user_id>")
def get_account(user_id: str):
    """Return one account (grouped or not) so the frontend can re-validate
    a stored session — e.g. after the local in-memory DB was reseeded."""
    account = db.get_account_profile(db.normalize_username(user_id))
    if account is None:
        return jsonify({"error": "That account no longer exists.", "code": "invalid_user"}), 404
    return jsonify({"user": account})

@bp.patch("/api/accounts/<user_id>")
def update_account_profile(user_id: str):
    """Rename an account and every ID-linked historical name snapshot."""
    body = request.get_json(silent=True) or {}
    user, previous_name, error = db.begin_account_name_update(
        user_id, body.get("name", ""), body.get("currentPassword", "")
    )
    if error == "invalid_name":
        return jsonify({"error": "Enter a display name up to 80 characters."}), 400
    if error == "invalid_password":
        return jsonify({"error": "Your current password is incorrect."}), 401
    if error == "sync_pending":
        return jsonify({
            "error": "Finish syncing the pending display name before choosing another.",
            "code": "name_sync_pending",
            "user": user,
        }), 409
    if user is None or previous_name is None:
        return invalid_user_response()
    try:
        profile_names.propagate_display_name(user["id"], previous_name, user["name"])
        user = db.finish_account_name_update(user["id"])
    except Exception:
        current_app.logger.exception("Display-name propagation failed for %s", user_id)
        return jsonify({
            "error": "Your name changed, but some history still needs to sync. Retry the save.",
            "code": "name_sync_incomplete",
            "user": db.get_account_profile(user_id),
        }), 503
    return jsonify({"user": user})

@bp.put("/api/accounts/<user_id>/password")
def update_account_password(user_id: str):
    body = request.get_json(silent=True) or {}
    error = db.change_account_password(
        user_id,
        body.get("currentPassword", ""),
        body.get("newPassword", ""),
    )
    if error == "invalid_current_password":
        return jsonify({"error": "Your current password is incorrect."}), 401
    if error == "invalid_new_password":
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    return jsonify({"ok": True})

@bp.delete("/api/accounts/<user_id>")
def delete_account(user_id: str):
    """Delete an account and its browser push subscriptions."""
    body = request.get_json(silent=True) or {}
    if not db.delete_account(user_id, body.get("password", "")):
        return jsonify({"error": "Could not verify that account and password."}), 401
    push.delete_user_subscriptions(db.normalize_username(user_id))
    return jsonify({"ok": True})

@bp.post("/api/groups/join")
def join_group():
    """Assign a pending account to the household behind a reusable code."""
    body = request.get_json(silent=True) or {}
    user_id = (body.get("userId") or "").strip()
    code = body.get("code", "")
    user, error = groups.join_group(user_id, code)
    if error == "invalid_code":
        return jsonify({"error": "Enter a valid group code."}), 400
    if error == "unknown_code":
        return jsonify({"error": "That group code was not recognized."}), 404
    if error == "already_member":
        return jsonify({"error": "This account already belongs to that group."}), 409
    if error == "unknown_user" or user is None:
        return jsonify({"error": "A valid account is required."}), 400
    group = groups.personalize_group(groups.get_group_by_id(user["groupId"]), user["id"])
    return jsonify({"user": user, "group": group})

@bp.post("/api/groups")
def create_group():
    """Create a group and make its creator the first member."""
    body = request.get_json(silent=True) or {}
    user, group, error = groups.create_group(
        (body.get("userId") or "").strip(),
        body.get("name", ""),
    )
    if error == "invalid_name":
        return jsonify({"error": "Enter a group name up to 80 characters."}), 400
    if error == "unknown_user":
        return invalid_user_response()
    if error or user is None or group is None:
        return jsonify({"error": "Could not create that group. Try again."}), 500
    return jsonify({"user": user, "group": groups.personalize_group(group, user["id"])}), 201

@bp.get("/api/groups")
def get_groups():
    """Return every group the account can select in the home drawer."""
    user_id = (request.args.get("userId") or "").strip()
    if db.get_account_by_id(user_id) is None:
        return invalid_user_response()
    return jsonify({"groups": groups.list_groups_for_user(user_id)})

@bp.get("/api/groups/current")
def get_current_group():
    """Return the signed-in user's current group metadata."""
    user_id = (request.args.get("userId") or "").strip()
    user = db.get_group_member(user_id) if user_id else None
    if user is None:
        return invalid_user_response()
    group = groups.get_group_by_id(user["groupId"])
    if group is None:
        return jsonify({"error": "That group no longer exists."}), 404
    return jsonify({"group": groups.personalize_group(group, user["id"])})

@bp.patch("/api/groups/current")
def rename_current_group():
    actor, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    group, error = groups.rename_group(actor["id"], actor["groupId"], body.get("name", ""))
    if error == "forbidden":
        return jsonify({"error": "Only a group admin can rename this group."}), 403
    if error == "invalid_name":
        return jsonify({"error": "Enter a group name up to 80 characters."}), 400
    if error == "unknown_group" or group is None:
        return jsonify({"error": "That group no longer exists."}), 404
    return jsonify({"group": groups.personalize_group(group, actor["id"])})

@bp.put("/api/groups/modules")
def update_group_modules():
    actor, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    group, error = groups.set_enabled_modules(
        actor["id"], actor["groupId"], body.get("enabledModules")
    )
    if error == "forbidden":
        return jsonify({"error": "Only a group admin can change enabled modules."}), 403
    if error == "invalid_modules":
        return jsonify({"error": "Enabled modules contain an unknown module."}), 400
    if error == "unknown_group" or group is None:
        return jsonify({"error": "That group no longer exists."}), 404
    return jsonify({"group": groups.personalize_group(group, actor["id"])})

@bp.put("/api/groups/theme")
def update_group_theme():
    actor, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    theme, error = groups.set_member_theme(actor["id"], actor["groupId"], body.get("theme", ""))
    if error == "invalid_theme":
        return jsonify({"error": "Choose a valid theme."}), 400
    if error:
        return jsonify({"error": "That membership no longer exists."}), 404
    return jsonify({"groupId": actor["groupId"], "theme": theme})

# Admin-only member administration. Both routes resolve the actor from the
# request's group scope, so an admin of one household gains nothing in
# another. Each returns the updated roster the caller already renders.
MEMBER_ADMIN_ERRORS = {
    "forbidden": ("Only a group admin can manage members.", 403),
    "unknown_member": ("That roommate is not in this group.", 404),
    "self_removal": ("You cannot remove yourself from the group.", 400),
    "admin_target": ("Remove admin from that roommate before removing them.", 409),
    "last_admin": ("Promote another admin before stepping down.", 409),
    "invalid_role": (f"Role must be one of {sorted(db.VALID_ROLES)}.", 400),
}

def member_admin_response(error: str | None, group_id: str):
    if error:
        message, status = MEMBER_ADMIN_ERRORS.get(
            error, ("Could not update that member.", 400)
        )
        return jsonify({"error": message}), status
    return jsonify(db.get_all(group_id, consistent=True))

@bp.delete("/api/groups/members/<user_id>")
def remove_group_member(user_id: str):
    """Remove another roommate from the actor's current group."""
    actor, error = group_member_from_query()
    if error:
        return error
    return member_admin_response(
        groups.remove_member(actor["id"], actor["groupId"], user_id),
        actor["groupId"],
    )

@bp.put("/api/groups/members/<user_id>/role")
def update_group_member_role(user_id: str):
    """Grant or revoke admin on another roommate in the actor's group."""
    actor, error = group_member_from_query()
    if error:
        return error
    body = request.get_json(silent=True) or {}
    return member_admin_response(
        groups.set_member_role(
            actor["id"], actor["groupId"], user_id, body.get("role", "")
        ),
        actor["groupId"],
    )

@bp.get("/api/roommates")
def get_roommates():
    """Return the whole household with their current statuses."""
    viewer, error = group_member_from_query()
    if error:
        return error
    return jsonify(db.get_all(viewer["groupId"]))

@bp.put("/api/roommates/<roommate_id>/status")
def update_status(roommate_id: str):
    """Update one roommate's status and return the updated household."""
    body = request.get_json(silent=True) or {}
    status = body.get("status")
    status_text = (body.get("statusText") or "").strip()

    if status not in db.VALID_STATUSES:
        return (
            jsonify({"error": f"Invalid status. Expected one of {sorted(db.VALID_STATUSES)}."}),
            400,
        )

    roommate = db.get_group_member(roommate_id)
    if roommate is None:
        return jsonify({"error": f"Unknown roommate: {roommate_id}"}), 404

    roommates = db.update_status(roommate_id, roommate["groupId"], status, status_text)
    if roommates is None:
        return jsonify({"error": f"Unknown roommate: {roommate_id}"}), 404

    # When enough roommates are free, push a "gather!" notification to every
    # subscribed device. Sending is best-effort: a push failure must not
    # fail the status update the user just made.
    free = effective_available_count(roommate["groupId"], roommates)
    if free >= PUSH_THRESHOLD:
        current_app.logger.info("Notification: %d roommates are available — time to gather!", free)
        try:
            notify_group(
                roommate["groupId"],
                title="Roomies are free!",
                body=f"{free} roomies are free! LETS HANG 🎉!",
                url="/",
                exclude_user_ids={roommate_id},
            )
        except Exception:  # noqa: BLE001 - never let push break the request
            current_app.logger.exception("Failed to send gather notification")

    return jsonify(roommates)

@bp.post("/api/roommates/notify")
def notify_roommates_to_update_status():
    """Push a household reminder to update statuses, excluding the requester."""
    body = request.get_json(silent=True) or {}
    requester_id = (body.get("requesterId") or "").strip()
    requester = db.get_group_member(requester_id) if requester_id else None
    if requester is None:
        return invalid_user_response()
    if not push.is_configured():
        return jsonify({"error": "Push is not configured on the server."}), 503

    result = notify_group(
        requester["groupId"],
        title="Update your status",
        body=f"{requester['name']} wants to know what you're up to 👀",
        url="/",
        exclude_user_ids={requester["id"]},
    )
    return jsonify(result)

@bp.post("/api/roommates/<roommate_id>/poke")
def poke_roommate(roommate_id: str):
    """Send one roommate a targeted reminder that opens their status editor."""
    body = request.get_json(silent=True) or {}
    requester_id = (body.get("requesterId") or "").strip()
    requester = db.get_group_member(requester_id) if requester_id else None
    target = db.get_group_member(roommate_id, requester["groupId"]) if requester else None
    if requester is None or target is None:
        return jsonify({"error": "Valid requester and roommate are required."}), 400
    if requester["id"] == target["id"]:
        return jsonify({"error": "You cannot poke yourself."}), 400
    if not push.is_configured():
        return jsonify({"error": "Push is not configured on the server."}), 503

    result = push.notify_users(
        user_ids={target["id"]},
        title=f"{requester['name']} poked you 👋",
        body="Update your status so they know what you're up to.",
        url=f"/?updateStatus=1&groupId={quote(requester['groupId'])}",
    )
    if result["sent"] == 0:
        return (
            jsonify(
                {
                    "error": (
                        f"Could not deliver the poke to {target['name']}. "
                        "They may not have notifications enabled."
                    )
                }
            ),
            409,
        )
    return jsonify(result)

# --- Web Push (PoC) -----------------------------------------------------
@bp.get("/api/push/public-key")
def push_public_key():
    """Hand the browser the VAPID public key it needs to subscribe."""
    if not push.is_configured():
        return jsonify({"error": "Push is not configured on the server."}), 503
    return jsonify({"publicKey": push.VAPID_PUBLIC_KEY})

@bp.post("/api/push/subscribe")
def push_subscribe():
    """Store a browser PushSubscription so we can notify this device."""
    body = request.get_json(silent=True) or {}
    subscription = body.get("subscription") or {}
    user_id = (body.get("userId") or "").strip()
    if not subscription.get("endpoint"):
        return jsonify({"error": "Invalid subscription (no endpoint)."}), 400
    if db.get_group_member(user_id) is None:
        return invalid_user_response()
    push.save_subscription(subscription, user_id)
    return jsonify({"ok": True})

# --- Book Club ----------------------------------------------------------

