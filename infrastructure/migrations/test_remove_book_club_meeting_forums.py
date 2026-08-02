"""Coverage for removing meeting-scoped Book Club forums."""

from __future__ import annotations

import importlib.util
import os
import uuid
from pathlib import Path

import boto3
from moto import mock_aws

import runner

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
HERE = Path(__file__).resolve().parent
MIGRATION = "2026-08-01-02-remove-book-club-meeting-forums"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context():
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    prefix = "RoommateStatus-remove-forums-" + uuid.uuid4().hex
    resource.create_table(
        TableName=f"{prefix}-book-club",
        KeySchema=[
            {"AttributeName": "groupId", "KeyType": "HASH"},
            {"AttributeName": "id", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "groupId", "AttributeType": "S"},
            {"AttributeName": "id", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    ctx = runner.MigrationContext("dev", prefix, resource)
    return ctx, ctx.table("book-club")


def test_meeting_forums_are_removed_and_restored_idempotently():
    migrate = load("remove_meeting_forums_migrate", "migrate.py")
    revert = load("remove_meeting_forums_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context()
        legacy = {
            "groupId": "club",
            "id": "forum#meeting-1#100#root",
            "meetingId": "meeting#meeting-1",
            "bookId": "book-1",
            "authorId": "andre",
            "body": "Old discussion",
            "createdAt": 100,
        }
        table.put_item(Item=legacy)
        table.put_item(Item={
            "groupId": "club",
            "id": "book-forum#new",
            "bookId": "book-1",
            "title": "New forum",
            "createdAt": 200,
        })

        migrate.run(ctx)
        migrate.run(ctx)
        assert "Item" not in table.get_item(Key={"groupId": "club", "id": legacy["id"]})
        backup_key = {"groupId": "club", "id": migrate.backup_id(legacy["id"])}
        assert table.get_item(Key=backup_key)["Item"][migrate.SNAPSHOT] == legacy
        assert table.get_item(Key={"groupId": "club", "id": "book-forum#new"})["Item"]

        revert.run(ctx)
        revert.run(ctx)
        assert table.get_item(Key={"groupId": "club", "id": legacy["id"]})["Item"] == legacy
        assert "Item" not in table.get_item(Key=backup_key)
