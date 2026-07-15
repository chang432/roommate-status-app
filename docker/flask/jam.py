"""Household Spotify Jam link state.

Only one Jam is active for the shire. Sharing a new link overwrites the
fixed active record so the UI never has to resolve competing sessions.

Stored in its own DynamoDB table (RoommateStatus-<env>-spotify-jam): a single
`activeJam#<group>` item per group, so an absent item means no active Jam.

Configuration (env):
    JAM_TABLE  - override the table name
                 (default: "${ROOMMATE_TABLE}-spotify-jam")
"""

from __future__ import annotations

import os
import threading
import time
import urllib.parse

from botocore.exceptions import ClientError

# Reuse db's resource builder so every table signs requests the same way and
# shares the local DynamoDB endpoint override (DYNAMODB_ENDPOINT).
from db import resource

END_NOT_FOUND = "not_found"
END_OK = "ended"
EDIT_NOT_FOUND = "not_found"
EDIT_FORBIDDEN = "forbidden"

TABLE_NAME = os.environ.get("JAM_TABLE") or (
    f"{os.environ.get('ROOMMATE_TABLE', 'RoommateStatus-main')}-spotify-jam"
)

_table = None
_table_lock = threading.Lock()


def _get_table():
    """Return the cached Spotify-Jam Table resource, built lazily (like db.py).

    The table is created by CloudFormation, not here, so it must already exist.
    """
    global _table
    if _table is None:
        with _table_lock:
            if _table is None:
                _table = resource().Table(TABLE_NAME)
    return _table


def _now_ms() -> int:
    return int(time.time() * 1000)


def valid_spotify_link(link: str) -> bool:
    parsed = urllib.parse.urlparse(link)
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    host = parsed.netloc.lower()
    return host == "spotify.link" or host.endswith(".spotify.link") or host == "open.spotify.com"


def _project(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {
        "id": item["id"],
        "groupId": item.get("groupId"),
        "link": item["link"],
        "hostId": item.get("hostId"),
        "hostName": item.get("hostName", "Someone"),
        "createdAt": int(item["createdAt"]),
        "updatedAt": int(item.get("updatedAt", item["createdAt"])),
    }


def _active_jam_id(group_id: str) -> str:
    return f"activeJam#{group_id}"


def get_active(group_id: str) -> dict | None:
    item = _get_table().get_item(Key={"id": _active_jam_id(group_id)}, ConsistentRead=True).get("Item")
    return _project(item)


def share(link: str, host_id: str, host_name: str, group_id: str) -> dict:
    now_ms = _now_ms()
    item = {
        "id": _active_jam_id(group_id),
        "groupId": group_id,
        "link": link,
        "hostId": host_id,
        "hostName": host_name,
        "createdAt": now_ms,
        "updatedAt": now_ms,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def edit_owned(jam_id: str, host_id: str, group_id: str, link: str) -> dict | str:
    """Update the active host's link without turning the edit into a new Jam."""
    table = _get_table()
    item = table.get_item(Key={"id": jam_id}, ConsistentRead=True).get("Item")
    if item is None or item.get("groupId") != group_id or jam_id != _active_jam_id(group_id):
        return EDIT_NOT_FOUND
    if item.get("hostId") != host_id:
        return EDIT_FORBIDDEN
    if item.get("link") == link:
        return _project(item)
    try:
        response = table.update_item(
            Key={"id": jam_id},
            UpdateExpression="SET link = :link, updatedAt = :now",
            ExpressionAttributeValues={
                ":link": link,
                ":now": max(_now_ms(), int(item.get("updatedAt", item["createdAt"])) + 1),
                ":groupId": group_id,
                ":host": host_id,
            },
            ConditionExpression=(
                "attribute_exists(id) AND groupId = :groupId AND hostId = :host"
            ),
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return EDIT_FORBIDDEN
    return _project(response["Attributes"])


def end(host_id: str, group_id: str) -> str:
    table = _get_table()
    item = table.get_item(Key={"id": _active_jam_id(group_id)}, ConsistentRead=True).get("Item")
    if item is None or item.get("groupId") != group_id:
        return END_NOT_FOUND
    try:
        table.delete_item(
            Key={"id": _active_jam_id(group_id)},
            ConditionExpression="attribute_exists(id) AND groupId = :groupId",
            ExpressionAttributeValues={":groupId": group_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": _active_jam_id(group_id)}, ConsistentRead=True).get("Item")
        if current is None or current.get("groupId") != group_id:
            return END_NOT_FOUND
        return END_NOT_FOUND
    return END_OK
