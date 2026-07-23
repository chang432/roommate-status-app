"""Round-trip coverage for meeting-scoped Book Club forum migration."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import boto3
from moto import mock_aws

import runner

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
HERE = Path(__file__).resolve().parent
MIGRATION = "2026-07-23-02-book-club-meeting-forums"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_posts_follow_their_parent_meeting_and_round_trip():
    migrate = load("book_club_forum_migrate", "migrate.py")
    revert = load("book_club_forum_revert", "revert.py")
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        resource.create_table(
            TableName="RoommateStatus-forum-book-club",
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
        ctx = runner.MigrationContext("dev", "RoommateStatus-forum", resource)
        table = ctx.table("book-club")
        root_id = "post#b1#001#300#root"
        reply_id = "post#b1#001#150#reply"
        rows = [
            {
                "groupId": "club",
                "id": "meeting#early",
                "bookId": "b1",
                "scheduledAt": 100,
                "createdAt": 100,
            },
            {
                "groupId": "club",
                "id": "meeting#late",
                "bookId": "b1",
                "scheduledAt": 250,
                "createdAt": 250,
            },
            {
                "groupId": "club",
                "id": root_id,
                "bookId": "b1",
                "chapterLabel": "Chapter 1",
                "authorId": "andre",
                "authorName": "Andre",
                "body": "Root",
                "createdAt": 300,
                "updatedAt": 300,
            },
            {
                # The reply predates its root to prove scan/order does not
                # independently assign it to the earlier meeting.
                "groupId": "club",
                "id": reply_id,
                "bookId": "b1",
                "parentPostId": root_id,
                "authorId": "kayla",
                "authorName": "Kayla",
                "body": "Reply",
                "createdAt": 150,
                "updatedAt": 350,
            },
        ]
        for row in rows:
            table.put_item(Item=row)

        migrate.run(ctx)
        migrate.run(ctx)
        forum_rows = [
            row
            for row in table.scan()["Items"]
            if row["id"].startswith("forum#")
        ]
        root = next(row for row in forum_rows if not row.get("parentPostId"))
        reply = next(row for row in forum_rows if row.get("parentPostId"))
        assert root["meetingId"] == "meeting#late"
        assert reply["meetingId"] == root["meetingId"]
        assert reply["parentPostId"] == root["id"]
        assert root["lastActivityAt"] == 350

        revert.run(ctx)
        revert.run(ctx)
        restored = {row["id"]: row for row in table.scan()["Items"]}
        assert restored[root_id]["body"] == "Root"
        assert restored[reply_id]["parentPostId"] == root_id
