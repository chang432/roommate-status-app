"""Comment-like records for the Roomie Status backend.

Likes on activity and request comments used to live inside the shared
activities table as typed rows (``itemType`` ``commentLike`` /
``requestCommentLike``). They now own their own table so the activity and
request feeds no longer scan-and-discard like rows on every read. Likes are
the highest-cardinality, fastest-growing rows in that feed (one per user per
liked comment), so giving them a dedicated table keeps each feed scan lean.

Each row still self-describes which parent it belongs to — activity likes
carry ``activityId``, request likes carry ``requestId`` — so a single table
holds both kinds; the ``itemType`` discriminator is redundant here and dropped.
The deterministic ids the two modules generate are prefixed differently
(``comment-like#…`` vs ``request-comment-like#…``), so they never collide.

This module owns only the table plumbing; the per-parent id, validation, and
row shape stay with activities.py / household_requests.py, which just target
this table instead of the activities table.

The table is keyed ``(groupId HASH, id RANGE)`` so a feed reads only its own
household's likes — see group_tables.py for why the feed tables partition on
the group rather than indexing it.

Configuration (env):
    COMMENT_LIKES_TABLE - override the table name
                          (default: "${ROOMMATE_TABLE}-comment-likes-v2")
"""

from __future__ import annotations

import os
import threading

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource
from group_tables import query_group

TABLE_NAME = os.environ.get("COMMENT_LIKES_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-comment-likes-v2"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached Comment-Likes Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def list_for_group(group_id: str, consistent: bool = False) -> list[dict]:
    """Read one group's comment-like rows (both activity and request likes)."""
    return query_group(_get_table(), group_id, consistent=consistent)


def likes_by_parent(group_id: str, parent_field: str, consistent: bool = False) -> dict:
    """Group a household's likes into ``{parent_id: {comment_id: {user_id}}}``.

    ``parent_field`` selects which kind of like to keep — ``"activityId"`` or
    ``"requestId"`` — since both share this table and each row names its parent.
    """
    grouped: dict[str, dict[str, set[str]]] = {}
    for like in list_for_group(group_id, consistent=consistent):
        parent_id = like.get(parent_field)
        if not parent_id:
            continue
        grouped.setdefault(parent_id, {}).setdefault(like["commentId"], set()).add(
            like["userId"]
        )
    return grouped


def delete_for_parent(group_id: str, parent_field: str, parent_id: str) -> None:
    """Drop every like belonging to one deleted activity or request."""
    table = _get_table()
    for like in list_for_group(group_id, consistent=True):
        if like.get(parent_field) == parent_id:
            table.delete_item(Key={"groupId": group_id, "id": like["id"]})
