"""Coverage for removing per-member Book Club reading progress."""

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
MIGRATION = "2026-07-29-02-remove-book-club-progress"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context():
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    prefix = "RoommateStatus-attendance-" + uuid.uuid4().hex
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


def response(response_id: str, **fields) -> dict:
    return {
        "groupId": "club",
        "id": f"meeting-member#meeting#{response_id}",
        "meetingId": "meeting#meeting",
        "userId": response_id,
        "userName": response_id.title(),
        "attendanceStatus": "attending",
        **fields,
    }


def test_progress_is_removed_and_round_trips_idempotently():
    migrate = load("remove_book_club_progress_migrate", "migrate.py")
    revert = load("remove_book_club_progress_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context()
        table.put_item(Item=response(
            "andre", chaptersReadThrough=6, readingComplete=True,
        ))
        table.put_item(Item=response("kayla", chaptersReadThrough=4))
        table.put_item(Item=response("ting"))
        table.put_item(Item={
            "groupId": "club", "id": "book#book", "chaptersReadThrough": 99,
        })

        migrate.run(ctx)
        migrate.run(ctx)
        andre = table.get_item(Key={
            "groupId": "club", "id": "meeting-member#meeting#andre",
        })["Item"]
        kayla = table.get_item(Key={
            "groupId": "club", "id": "meeting-member#meeting#kayla",
        })["Item"]
        ting = table.get_item(Key={
            "groupId": "club", "id": "meeting-member#meeting#ting",
        })["Item"]
        book = table.get_item(Key={"groupId": "club", "id": "book#book"})["Item"]
        assert "chaptersReadThrough" not in andre and "readingComplete" not in andre
        assert "chaptersReadThrough" not in kayla
        assert migrate.MARKER in andre and migrate.MARKER in kayla
        assert migrate.MARKER not in ting
        assert book["chaptersReadThrough"] == 99

        table.update_item(
            Key={"groupId": "club", "id": "meeting-member#meeting#andre"},
            UpdateExpression="SET readingComplete = :later",
            ExpressionAttributeValues={":later": False},
        )
        revert.run(ctx)
        revert.run(ctx)
        andre = table.get_item(Key={
            "groupId": "club", "id": "meeting-member#meeting#andre",
        })["Item"]
        kayla = table.get_item(Key={
            "groupId": "club", "id": "meeting-member#meeting#kayla",
        })["Item"]
        assert andre["chaptersReadThrough"] == 6
        assert andre["readingComplete"] is False
        assert kayla["chaptersReadThrough"] == 4
        assert migrate.MARKER not in andre and migrate.MARKER not in kayla
