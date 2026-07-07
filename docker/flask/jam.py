"""Household Spotify Jam link state.

Only one Jam is active for the shire. Sharing a new link overwrites the
fixed active record so the UI never has to resolve competing sessions.
"""

from __future__ import annotations

import time
import urllib.parse

from botocore.exceptions import ClientError

import activities

JAM_TYPE = "spotifyJam"

END_NOT_FOUND = "not_found"
END_FORBIDDEN = "forbidden"
END_OK = "ended"


def _get_table():
    return activities._get_table()


def _now_ms() -> int:
    return int(time.time() * 1000)


def valid_spotify_link(link: str) -> bool:
    parsed = urllib.parse.urlparse(link)
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    host = parsed.netloc.lower()
    return host == "spotify.link" or host.endswith(".spotify.link") or host == "open.spotify.com"


def _project(item: dict | None) -> dict | None:
    if item is None or item.get("itemType") != JAM_TYPE:
        return None
    return {
        "id": item["id"],
        "groupId": item.get("groupId"),
        "link": item["link"],
        "hostId": item.get("hostId"),
        "hostName": item.get("hostName", "Someone"),
        "createdAt": int(item["createdAt"]),
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
        "itemType": JAM_TYPE,
        "groupId": group_id,
        "link": link,
        "hostId": host_id,
        "hostName": host_name,
        "createdAt": now_ms,
        "updatedAt": now_ms,
    }
    _get_table().put_item(Item=item)
    return _project(item)


def end(host_id: str, group_id: str) -> str:
    table = _get_table()
    item = table.get_item(Key={"id": _active_jam_id(group_id)}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != JAM_TYPE:
        return END_NOT_FOUND
    if item.get("hostId") != host_id:
        return END_FORBIDDEN
    try:
        table.delete_item(
            Key={"id": _active_jam_id(group_id)},
            ConditionExpression="itemType = :jam AND hostId = :host AND groupId = :groupId",
            ExpressionAttributeValues={":jam": JAM_TYPE, ":host": host_id, ":groupId": group_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": _active_jam_id(group_id)}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") != JAM_TYPE:
            return END_NOT_FOUND
        return END_FORBIDDEN
    return END_OK
