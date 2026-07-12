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

Configuration (env):
    COMMENT_LIKES_TABLE - override the table name
                          (default: "${ROOMMATE_TABLE}-comment-likes")
"""

from __future__ import annotations

import os
import threading

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

TABLE_NAME = os.environ.get("COMMENT_LIKES_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-comment-likes"
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


def _scan_all(consistent: bool = False) -> list[dict]:
    """Read every comment-like row (both activity and request likes)."""
    table = _get_table()
    resp = table.scan(ConsistentRead=consistent)
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            ExclusiveStartKey=resp["LastEvaluatedKey"],
            ConsistentRead=consistent,
        )
        items.extend(resp.get("Items", []))
    return items
