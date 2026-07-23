"""Focused round-trip coverage for the Book Club meeting-module migration."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import boto3
from moto import mock_aws

import runner

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
HERE = Path(__file__).resolve().parent


def load(name: str, filename: str):
    path = HERE / "2026-07-22-01-book-club-meeting-modules" / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_preserves_and_reverts_book_club_records():
    migrate = load("book_club_meeting_migrate", "migrate.py")
    revert = load("book_club_meeting_revert", "revert.py")
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        resource.create_table(
            TableName="RoommateStatus-migration-book-club",
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
        ctx = runner.MigrationContext("dev", "RoommateStatus-migration", resource)
        table = ctx.table("book-club")
        session_id = "session#2030-08-07T23:30:00.000Z"
        rows = [
            {
                "groupId": "club", "id": "config#book-club", "activeBookId": "b1",
                "nextSessionId": session_id, "nextSessionAt": 100,
                "bookRotationUserIds": ["andre", "kayla"], "bookRotationCursor": 1,
                "snackRotationUserIds": ["andre", "kayla"], "snackRotationCursor": 0,
                "createdAt": 1, "updatedAt": 1,
            },
            {
                "groupId": "club", "id": "book#b1", "bookId": "b1", "title": "Book",
                "author": "Author", "recommendedById": "kayla", "recommendedByName": "Kayla",
                "status": "active", "selectedAt": 1, "createdAt": 1, "updatedAt": 1,
            },
            {
                "groupId": "club", "id": session_id, "bookId": "b1", "bookTitle": "Book",
                "readingTarget": "Chapter 1", "snackDutyUserId": "andre",
                "snackDutyName": "Andre", "scheduledAt": 100, "status": "scheduled",
                "createdAt": 1, "updatedAt": 1,
            },
            {
                "groupId": "club", "id": "session-member#2030#andre", "sessionId": session_id,
                "userId": "andre", "userName": "Andre", "attendanceStatus": "attending",
                "chaptersReadThrough": 1, "createdAt": 1, "updatedAt": 1,
            },
        ]
        for row in rows:
            table.put_item(Item=row)

        migrate.run(ctx)
        migrate.run(ctx)
        converted = table.scan()["Items"]
        config = next(row for row in converted if row["id"] == "config#book-club")
        meeting = next(row for row in converted if row["id"].startswith("meeting#"))
        response = next(row for row in converted if row["id"].startswith("meeting-member#"))
        assert config["bookOwnerOrderUserIds"] == ["kayla", "andre"]
        assert config["snackOwnerOrderUserIds"] == ["andre", "kayla"]
        assert config["openMeetingId"] == meeting["id"]
        assert (meeting["bookOwnerId"], meeting["snackOwnerId"]) == ("kayla", "andre")
        assert response["meetingId"] == meeting["id"]

        revert.run(ctx)
        restored = {row["id"]: row for row in table.scan()["Items"]}
        assert session_id in restored
        assert restored[session_id]["snackDutyUserId"] == "andre"
        assert "config#book-club" in restored


def test_migration_resumes_after_a_session_was_already_moved():
    migrate = load("book_club_meeting_resume_migrate", "migrate.py")
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        resource.create_table(
            TableName="RoommateStatus-resume-book-club",
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
        ctx = runner.MigrationContext("dev", "RoommateStatus-resume", resource)
        table = ctx.table("book-club")
        session_id = "session#2030-08-07T23:30:00.000Z"
        meeting_id = migrate._meeting_id("club", session_id)
        legacy_session = {
            "groupId": "club", "id": session_id, "bookId": "b1",
            "bookTitle": "Book", "readingTarget": "Chapter 1",
            "snackDutyUserId": "andre", "snackDutyName": "Andre",
            "scheduledAt": 100, "status": "scheduled", "createdAt": 1,
            "updatedAt": 1,
        }
        table.put_item(Item={
            **legacy_session, "id": meeting_id,
            migrate.MARKER: True, migrate.LEGACY: legacy_session,
        })
        table.put_item(Item={
            "groupId": "club", "id": "config#book-club",
            "nextSessionId": session_id, "nextSessionAt": 100,
            "bookRotationUserIds": ["andre"], "bookRotationCursor": 0,
            "snackRotationUserIds": ["andre"], "snackRotationCursor": 0,
            "createdAt": 1, "updatedAt": 1,
        })
        table.put_item(Item={
            "groupId": "club", "id": "session-member#2030#andre",
            "sessionId": session_id, "userId": "andre", "userName": "Andre",
            "attendanceStatus": "attending", "chaptersReadThrough": 1,
            "createdAt": 1, "updatedAt": 1,
        })

        migrate.run(ctx)

        rows = table.scan()["Items"]
        config = next(row for row in rows if row["id"] == "config#book-club")
        response = next(row for row in rows if row["id"].startswith("meeting-member#"))
        assert config["openMeetingId"] == meeting_id
        assert response["meetingId"] == meeting_id
