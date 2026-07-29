"""Coverage for deriving Book Club completion from activeBookId."""

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
MIGRATION = "2026-07-29-01-derive-book-completion"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context():
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    prefix = "RoommateStatus-completion-" + uuid.uuid4().hex
    # Use the same generated prefix for the table and context.
    table_name = f"{prefix}-book-club"
    resource.create_table(
        TableName=table_name,
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


def test_completion_is_derived_and_round_trips_idempotently():
    migrate = load("derive_book_completion_migrate", "migrate.py")
    revert = load("derive_book_completion_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context()
        table.put_item(Item={
            "groupId": "club", "id": "config#book-club", "activeBookId": "current",
        })
        table.put_item(Item={
            "groupId": "club", "id": "book#current", "bookId": "current",
            "status": "active", "completedAt": 100,
        })
        table.put_item(Item={
            "groupId": "club", "id": "book#historic", "bookId": "historic",
            "status": "completed", "completedAt": 200,
        })
        table.put_item(Item={
            "groupId": "club", "id": "book#unknown-date", "bookId": "unknown-date",
            "status": "completed",
        })

        migrate.run(ctx)
        migrate.run(ctx)
        current = table.get_item(Key={"groupId": "club", "id": "book#current"})["Item"]
        historic = table.get_item(Key={"groupId": "club", "id": "book#historic"})["Item"]
        unknown = table.get_item(Key={"groupId": "club", "id": "book#unknown-date"})["Item"]
        assert "status" not in current and "completedAt" not in current
        assert historic["completedAt"] == 200
        assert "completedAt" not in unknown
        assert all(migrate.MARKER in item for item in (current, historic, unknown))

        revert.run(ctx)
        revert.run(ctx)
        current = table.get_item(Key={"groupId": "club", "id": "book#current"})["Item"]
        historic = table.get_item(Key={"groupId": "club", "id": "book#historic"})["Item"]
        unknown = table.get_item(Key={"groupId": "club", "id": "book#unknown-date"})["Item"]
        assert (current["status"], current["completedAt"]) == ("active", 100)
        assert (historic["status"], historic["completedAt"]) == ("completed", 200)
        assert unknown["status"] == "completed"
        assert all(migrate.MARKER not in item for item in (current, historic, unknown))


def test_reverse_preserves_completion_written_after_forward_migration():
    migrate = load("derive_book_completion_later_migrate", "migrate.py")
    revert = load("derive_book_completion_later_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context()
        table.put_item(Item={
            "groupId": "club", "id": "config#book-club", "activeBookId": "current",
        })
        table.put_item(Item={
            "groupId": "club", "id": "book#current", "bookId": "current",
            "status": "active", "completedAt": 100,
        })
        migrate.run(ctx)
        table.update_item(
            Key={"groupId": "club", "id": "book#current"},
            UpdateExpression="SET completedAt = :later",
            ExpressionAttributeValues={":later": 300},
        )

        revert.run(ctx)

        current = table.get_item(Key={"groupId": "club", "id": "book#current"})["Item"]
        assert current["status"] == "active"
        assert current["completedAt"] == 300
