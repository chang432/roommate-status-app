"""Focused coverage for the one-time Book owner order alignment."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import boto3
from moto import mock_aws

import runner

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
HERE = Path(__file__).resolve().parent
MIGRATION = "2026-07-23-01-align-book-owner-order"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context(prefix: str):
    resource = boto3.resource("dynamodb", region_name="us-east-1")
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


def test_alignment_preserves_current_owner_and_later_independent_edit():
    migrate = load("align_book_owner_order_migrate", "migrate.py")
    revert = load("align_book_owner_order_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context("RoommateStatus-align")
        table.put_item(Item={
            "groupId": "club", "id": "config#book-club",
            "openMeetingId": "meeting#1",
            "bookOwnerOrderUserIds": ["kayla", "andre", "sheryl"],
            "snackOwnerOrderUserIds": ["andre", "kayla", "sheryl"],
        })
        table.put_item(Item={
            "groupId": "club", "id": "meeting#1", "bookOwnerId": "kayla",
        })

        migrate.run(ctx)
        migrate.run(ctx)
        config = table.get_item(
            Key={"groupId": "club", "id": "config#book-club"}
        )["Item"]
        assert config["bookOwnerOrderUserIds"] == ["kayla", "sheryl", "andre"]
        assert config[migrate.MARKER] is True

        table.update_item(
            Key={"groupId": "club", "id": "config#book-club"},
            UpdateExpression="SET bookOwnerOrderUserIds = :order",
            ExpressionAttributeValues={":order": ["sheryl", "kayla", "andre"]},
        )
        migrate.run(ctx)
        revert.run(ctx)
        config = table.get_item(
            Key={"groupId": "club", "id": "config#book-club"}
        )["Item"]
        assert config["bookOwnerOrderUserIds"] == ["sheryl", "kayla", "andre"]
        assert migrate.MARKER not in config
        assert migrate.LEGACY not in config


def test_alignment_uses_active_book_fallback_and_reverts_exactly():
    migrate = load("align_book_owner_order_fallback_migrate", "migrate.py")
    revert = load("align_book_owner_order_fallback_revert", "revert.py")
    with mock_aws():
        ctx, table = table_context("RoommateStatus-align-fallback")
        original = ["andre", "sheryl", "kayla"]
        table.put_item(Item={
            "groupId": "club", "id": "config#book-club",
            "activeBookId": "book-1",
            "bookOwnerOrderUserIds": original,
            "snackOwnerOrderUserIds": ["andre", "kayla", "sheryl"],
        })
        table.put_item(Item={
            "groupId": "club", "id": "book#book-1", "bookOwnerId": "sheryl",
        })

        migrate.run(ctx)
        config = table.get_item(
            Key={"groupId": "club", "id": "config#book-club"}
        )["Item"]
        assert config["bookOwnerOrderUserIds"] == ["sheryl", "andre", "kayla"]

        revert.run(ctx)
        revert.run(ctx)
        config = table.get_item(
            Key={"groupId": "club", "id": "config#book-club"}
        )["Item"]
        assert config["bookOwnerOrderUserIds"] == original
        assert migrate.MARKER not in config
        assert migrate.LEGACY not in config
