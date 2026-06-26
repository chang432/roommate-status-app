"""Minimal Spotify OAuth + currently-playing helpers.

Spotify does not expose Jam session state through the public Web API, so this
module only reads the host account's current playback while Roomie stores the
Jam invite link separately.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from botocore.exceptions import ClientError

import activities

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_CURRENTLY_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing"
SPOTIFY_SCOPE = "user-read-currently-playing"

TOKEN_TYPE = "spotifyToken"
STATE_TYPE = "spotifyState"
STATE_TTL_MS = 10 * 60 * 1000


def is_configured() -> bool:
    return bool(
        os.environ.get("SPOTIFY_CLIENT_ID")
        and os.environ.get("SPOTIFY_CLIENT_SECRET")
        and os.environ.get("SPOTIFY_REDIRECT_URI")
    )


def _get_table():
    return activities._get_table()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _token_id(user_id: str) -> str:
    return f"spotifyToken#{user_id}"


def _state_id(state: str) -> str:
    return f"spotifyState#{state}"


def _token_auth_header() -> str:
    raw = f"{os.environ['SPOTIFY_CLIENT_ID']}:{os.environ['SPOTIFY_CLIENT_SECRET']}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


def _spotify_token_request(form: dict) -> dict:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        SPOTIFY_TOKEN_URL,
        data=data,
        headers={
            "Authorization": _token_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 - fixed Spotify URL.
        return json.loads(resp.read().decode())


def _spotify_api_get(url: str, access_token: str) -> tuple[int, dict | None]:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 - fixed Spotify URL.
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as err:
        if err.code == 204:
            return 204, None
        raise


def has_token(user_id: str) -> bool:
    item = _get_table().get_item(Key={"id": _token_id(user_id)}).get("Item")
    return bool(item and item.get("itemType") == TOKEN_TYPE and item.get("refreshToken"))


def auth_url(user_id: str) -> str:
    state = secrets.token_urlsafe(24)
    _get_table().put_item(
        Item={
            "id": _state_id(state),
            "itemType": STATE_TYPE,
            "userId": user_id,
            "createdAt": _now_ms(),
        }
    )
    params = urllib.parse.urlencode(
        {
            "client_id": os.environ["SPOTIFY_CLIENT_ID"],
            "response_type": "code",
            "redirect_uri": os.environ["SPOTIFY_REDIRECT_URI"],
            "scope": SPOTIFY_SCOPE,
            "state": state,
        }
    )
    return f"{SPOTIFY_AUTH_URL}?{params}"


def _consume_state(state: str) -> str | None:
    table = _get_table()
    key = {"id": _state_id(state)}
    item = table.get_item(Key=key, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != STATE_TYPE:
        return None
    table.delete_item(Key=key)
    if int(item.get("createdAt", 0)) < _now_ms() - STATE_TTL_MS:
        return None
    return item.get("userId")


def save_authorization_code(code: str, state: str) -> str | None:
    user_id = _consume_state(state)
    if user_id is None:
        return None
    token = _spotify_token_request(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": os.environ["SPOTIFY_REDIRECT_URI"],
        }
    )
    _save_token(user_id, token)
    return user_id


def _save_token(user_id: str, token: dict, existing_refresh_token: str | None = None) -> None:
    refresh_token = token.get("refresh_token") or existing_refresh_token
    if not refresh_token:
        raise ValueError("Spotify did not return a refresh token.")
    _get_table().put_item(
        Item={
            "id": _token_id(user_id),
            "itemType": TOKEN_TYPE,
            "userId": user_id,
            "accessToken": token["access_token"],
            "refreshToken": refresh_token,
            "scope": token.get("scope", SPOTIFY_SCOPE),
            "expiresAt": _now_ms() + max(int(token.get("expires_in", 3600)) - 60, 60) * 1000,
            "updatedAt": _now_ms(),
        }
    )


def _access_token(user_id: str) -> str | None:
    item = _get_table().get_item(Key={"id": _token_id(user_id)}, ConsistentRead=True).get("Item")
    if item is None or item.get("itemType") != TOKEN_TYPE:
        return None
    if int(item.get("expiresAt", 0)) > _now_ms():
        return item.get("accessToken")
    refresh_token = item.get("refreshToken")
    if not refresh_token:
        return None
    token = _spotify_token_request(
        {"grant_type": "refresh_token", "refresh_token": refresh_token}
    )
    _save_token(user_id, token, existing_refresh_token=refresh_token)
    return token.get("access_token")


def disconnect(user_id: str) -> None:
    try:
        _get_table().delete_item(
            Key={"id": _token_id(user_id)},
            ConditionExpression="itemType = :token",
            ExpressionAttributeValues={":token": TOKEN_TYPE},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise


def current_playback(user_id: str) -> tuple[dict | None, str]:
    if not is_configured():
        return None, "spotify_unconfigured"
    access_token = _access_token(user_id)
    if not access_token:
        return None, "not_connected"
    try:
        status, data = _spotify_api_get(SPOTIFY_CURRENTLY_PLAYING_URL, access_token)
    except Exception:  # noqa: BLE001 - callers only need an availability state.
        return None, "spotify_error"
    if status == 204 or not data or not data.get("item"):
        return None, "not_playing"
    item = data["item"]
    artists = [artist.get("name") for artist in item.get("artists", []) if artist.get("name")]
    images = item.get("album", {}).get("images", [])
    image = images[-1]["url"] if images else None
    return (
        {
            "isPlaying": bool(data.get("is_playing")),
            "title": item.get("name", "Unknown track"),
            "artists": artists,
            "album": item.get("album", {}).get("name"),
            "albumImageUrl": image,
            "externalUrl": item.get("external_urls", {}).get("spotify"),
            "progressMs": data.get("progress_ms"),
            "durationMs": item.get("duration_ms"),
            "updatedAt": _now_ms(),
        },
        "connected",
    )
