"""Household Spotify Jam link state.

Only one Jam is active for the household. Sharing a new link overwrites the
fixed active record so the UI never has to resolve competing sessions.
"""

from __future__ import annotations

import time
import urllib.parse

from botocore.exceptions import ClientError

import activities
import spotify

JAM_TYPE = "spotifyJam"
ACTIVE_JAM_ID = "activeJam"

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


def _project(item: dict | None, include_playback: bool = True) -> dict | None:
    if item is None or item.get("itemType") != JAM_TYPE:
        return None
    host_id = item.get("hostId")
    playback = None
    playback_status = "not_connected"
    if include_playback and host_id:
        playback, playback_status = spotify.current_playback(host_id)
    return {
        "id": item["id"],
        "link": item["link"],
        "hostId": host_id,
        "hostName": item.get("hostName", "Someone"),
        "createdAt": int(item["createdAt"]),
        "spotifyConfigured": spotify.is_configured(),
        "hostSpotifyConnected": spotify.has_token(host_id) if host_id else False,
        "playbackStatus": playback_status,
        "nowPlaying": playback,
    }


def get_active(include_playback: bool = True) -> dict | None:
    item = _get_table().get_item(Key={"id": ACTIVE_JAM_ID}, ConsistentRead=True).get("Item")
    return _project(item, include_playback=include_playback)


def share(link: str, host_id: str, host_name: str) -> dict:
    item = {
        "id": ACTIVE_JAM_ID,
        "itemType": JAM_TYPE,
        "link": link,
        "hostId": host_id,
        "hostName": host_name,
        "createdAt": _now_ms(),
    }
    _get_table().put_item(Item=item)
    return _project(item)


def end(host_id: str) -> str:
    table = _get_table()
    item = table.get_item(Key={"id": ACTIVE_JAM_ID}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != JAM_TYPE:
        return END_NOT_FOUND
    if item.get("hostId") != host_id:
        return END_FORBIDDEN
    try:
        table.delete_item(
            Key={"id": ACTIVE_JAM_ID},
            ConditionExpression="itemType = :jam AND hostId = :host",
            ExpressionAttributeValues={":jam": JAM_TYPE, ":host": host_id},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        current = table.get_item(Key={"id": ACTIVE_JAM_ID}, ConsistentRead=True).get("Item")
        if current is None or current.get("itemType") != JAM_TYPE:
            return END_NOT_FOUND
        return END_FORBIDDEN
    return END_OK
