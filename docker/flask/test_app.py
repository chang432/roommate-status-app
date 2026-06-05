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
from app import create_app


@pytest.fixture(scope="session", autouse=True)
def _dynamodb():
    """Stand up a mocked DynamoDB table for the whole test session.

    Mirrors the key schema in the infrastructure templates
    (infrastructure/dynamodb-table-{dev,main}.yaml). Kept open for the session
    so db.py's cached table resource stays valid across tests.
    """
    with mock_aws():
        boto3.resource("dynamodb").create_table(
            TableName=db.TABLE_NAME,
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


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
