"""Tests for the Roomie Status Flask API.

Run with:  python -m pytest   (or: python test_app.py)

Covers the three frontend-facing endpoints plus their error paths, asserting
the exact response shapes the frontend (frontend/src/api/client.js) depends on.
DynamoDB is mocked with moto, so these run hermetically with no real AWS calls.
"""

import os

# moto and boto3 need *some* region/credentials present before any client is
# built; these dummy values are never sent anywhere (moto intercepts them).
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")

import boto3
import pytest
from moto import mock_aws

import db
import push
from app import create_app


@pytest.fixture(scope="session", autouse=True)
def _dynamodb():
    """Stand up mocked DynamoDB tables for the whole test session.

    Mirrors the infrastructure templates (infrastructure/dynamodb-table-{dev,
    main}.yaml), which provision both the roommate table and the push
    subscriptions table — push.py no longer creates the latter itself. Kept open
    for the session so the modules' cached table resources stay valid.
    """
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        for table_name in (db.TABLE_NAME, push.TABLE_NAME):
            ddb.create_table(
                TableName=table_name,
                KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        yield


@pytest.fixture()
def client():
    db.reset()  # Isolate each test from prior status mutations.
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_login_success(client):
    res = client.post("/api/login", json={"name": "Sheryl", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json() == {"user": {"id": "sheryl", "name": "Sheryl"}}


def test_login_is_case_insensitive(client):
    res = client.post("/api/login", json={"name": "  sHeRyL ", "password": "roomie"})
    assert res.status_code == 200
    assert res.get_json()["user"]["id"] == "sheryl"


def test_login_bad_password(client):
    res = client.post("/api/login", json={"name": "Sheryl", "password": "nope"})
    assert res.status_code == 401
    assert "error" in res.get_json()


def test_login_unknown_name(client):
    res = client.post("/api/login", json={"name": "Ghost", "password": "roomie"})
    assert res.status_code == 401


def test_get_roommates(client):
    res = client.get("/api/roommates")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 5
    # Shape the frontend relies on.
    assert set(data[0]) == {"id", "name", "status", "statusText"}


def test_update_status_to_busy_clears_text(client):
    res = client.put(
        "/api/roommates/sheryl/status",
        json={"status": "busy", "statusText": "ignored"},
    )
    assert res.status_code == 200
    sheryl = next(r for r in res.get_json() if r["id"] == "sheryl")
    assert sheryl["status"] == "busy"
    assert sheryl["statusText"] == ""  # fixed statuses drop custom text


def test_update_status_custom_keeps_text(client):
    res = client.put(
        "/api/roommates/ting/status",
        json={"status": "custom", "statusText": "  Cooking dinner  "},
    )
    assert res.status_code == 200
    ting = next(r for r in res.get_json() if r["id"] == "ting")
    assert ting["status"] == "custom"
    assert ting["statusText"] == "Cooking dinner"  # trimmed, preserved


def test_update_status_invalid(client):
    res = client.put("/api/roommates/sheryl/status", json={"status": "napping"})
    assert res.status_code == 400


def test_update_status_unknown_roommate(client):
    res = client.put("/api/roommates/ghost/status", json={"status": "busy"})
    assert res.status_code == 404


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


# --- Web Push (PoC) ---------------------------------------------------------
# VAPID keys are not set in the test env, so push is "not configured": the
# key/test endpoints should 503, while subscribe (pure storage) still works.
def test_push_public_key_unconfigured(client):
    res = client.get("/api/push/public-key")
    assert res.status_code == 503


def test_push_subscribe_stores(client):
    sub = {"endpoint": "https://example.com/ep/abc", "keys": {"p256dh": "x", "auth": "y"}}
    res = client.post("/api/push/subscribe", json=sub)
    assert res.status_code == 200
    assert res.get_json() == {"ok": True}

    import push

    assert any(s["endpoint"] == sub["endpoint"] for s in push.list_subscriptions())


def test_push_subscribe_rejects_missing_endpoint(client):
    res = client.post("/api/push/subscribe", json={"keys": {}})
    assert res.status_code == 400


def test_push_test_unconfigured(client):
    res = client.post("/api/push/test")
    assert res.status_code == 503


def test_vapid_private_key_loads_through_pywebpush():
    """gen_vapid's private key must load via pywebpush's own code path.

    Regression guard: webpush() loads the key with Vapid.from_string(), which
    expects the base64url raw scalar — not a PEM. This is exactly the call that
    crashed when push.py handed it a PEM.
    """
    from py_vapid import Vapid01

    import gen_vapid

    public_key, private_key = gen_vapid.generate()
    vapid = Vapid01.from_string(private_key=private_key)  # must not raise

    # The loaded key's public point must match the generated public key, or the
    # browser's subscription (bound to that public key) would reject our pushes.
    from cryptography.hazmat.primitives import serialization

    loaded_public = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    assert _b64url(loaded_public) == public_key
    # And it can actually sign a VAPID header.
    assert "Authorization" in vapid.sign({"aud": "https://example.com", "sub": "mailto:x@y.z"})


def _b64url(raw: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
