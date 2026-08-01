"""Coverage for removing legacy Book Club forum titles."""

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
MIGRATION = "2026-07-31-01-remove-book-club-forum-titles"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context():
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    prefix = "RoommateStatus-forum-titles-" + uuid.uuid4().hex
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


def test_titles_are_removed_and_round_trip_idempotently():
    migrate = load("remove_forum_titles_migrate", "migrate.py")
    revert = load("remove_forum_titles_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context()
        table.put_item(Item={
            "groupId": "club",
            "id": "forum#meeting#1#root",
            "meetingId": "meeting#1",
            "body": "A legacy message",
            "title": "Legacy title",
        })
        table.put_item(Item={
            "groupId": "club",
            "id": "forum#meeting#1#reply",
            "meetingId": "meeting#1",
            "parentPostId": "forum#meeting#1#root",
            "body": "A reply",
        })
        table.put_item(Item={"groupId": "club", "id": "book#1", "title": "Book"})

        migrate.run(ctx)
        migrate.run(ctx)
        root = table.get_item(Key={"groupId": "club", "id": "forum#meeting#1#root"})["Item"]
        reply = table.get_item(Key={"groupId": "club", "id": "forum#meeting#1#reply"})["Item"]
        assert "title" not in root
        assert root[migrate.MARKER] == {"title": "Legacy title"}
        assert migrate.MARKER not in reply

        revert.run(ctx)
        revert.run(ctx)
        root = table.get_item(Key={"groupId": "club", "id": "forum#meeting#1#root"})["Item"]
        assert root["title"] == "Legacy title"
        assert migrate.MARKER not in root
