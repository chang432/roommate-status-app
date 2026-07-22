"""Tests for 2026-07-21-01-partition-feed-tables-by-group.

Uses moto to mock DynamoDB, so no AWS account or DynamoDB Local is needed.
Run: cd infrastructure && python -m pytest migrations
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

# Dummy AWS creds/region before any boto3 client is built (matches test_runner.py).
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

import runner  # noqa: E402  (pytest puts this dir on sys.path; env set above)

PREFIX = "RoommateStatus-dev"
MIGRATION = "2026-07-21-01-partition-feed-tables-by-group"
SOURCES = ("activities", "requests", "checklists", "shows", "comment-likes")


def _load(step: str):
    """Import the migration's migrate.py / revert.py the way the runner does."""
    path = Path(__file__).resolve().parent / MIGRATION / f"{step}.py"
    spec = importlib.util.spec_from_file_location(f"{MIGRATION}.{step}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run


@pytest.fixture
def ctx():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        for suffix in SOURCES:
            client.create_table(
                TableName=f"{PREFIX}-{suffix}",
                AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                BillingMode="PAY_PER_REQUEST",
            )
            client.create_table(
                TableName=f"{PREFIX}-{suffix}-v2",
                AttributeDefinitions=[
                    {"AttributeName": "groupId", "AttributeType": "S"},
                    {"AttributeName": "id", "AttributeType": "S"},
                ],
                KeySchema=[
                    {"AttributeName": "groupId", "KeyType": "HASH"},
                    {"AttributeName": "id", "KeyType": "RANGE"},
                ],
                BillingMode="PAY_PER_REQUEST",
            )
        migration_ctx, _ = runner.build_context("dev")
        yield migration_ctx


def _rows(ctx, suffix):
    return ctx.table(suffix).scan().get("Items", [])


def test_copies_rows_into_the_group_partitioned_table(ctx):
    ctx.table("activities").put_item(
        Item={"id": "a1", "groupId": "yorkshire", "text": "Picnic", "createdAt": 1}
    )
    ctx.table("shows").put_item(
        Item={"id": "s1", "groupId": "other-house", "title": "Severance", "createdAt": 2}
    )

    _load("migrate")(ctx)

    assert _rows(ctx, "activities-v2") == [
        {"id": "a1", "groupId": "yorkshire", "text": "Picnic", "createdAt": 1}
    ]
    assert _rows(ctx, "shows-v2") == [
        {"id": "s1", "groupId": "other-house", "title": "Severance", "createdAt": 2}
    ]
    # The source is never mutated, so a failure part-way leaves it authoritative.
    assert len(_rows(ctx, "activities")) == 1


def test_assigns_the_default_group_to_rows_that_predate_group_isolation(ctx):
    ctx.table("activities").put_item(Item={"id": "old", "text": "Legacy", "createdAt": 1})

    _load("migrate")(ctx)

    # groupId is now half the primary key, so it can no longer be absent.
    assert _rows(ctx, "activities-v2") == [
        {"id": "old", "groupId": "yorkshire", "text": "Legacy", "createdAt": 1}
    ]


def test_leaves_pre_split_typed_records_behind(ctx):
    ctx.table("activities").put_item(
        Item={"id": "r1", "itemType": "request", "groupId": "yorkshire", "createdAt": 1}
    )

    _load("migrate")(ctx)

    assert _rows(ctx, "activities-v2") == []
    # Not deleted either — anything unexpected stays recoverable.
    assert len(_rows(ctx, "activities")) == 1


def test_migrate_is_idempotent(ctx):
    ctx.table("checklists").put_item(
        Item={"id": "c1", "groupId": "yorkshire", "title": "Chores", "createdAt": 1}
    )

    _load("migrate")(ctx)
    _load("migrate")(ctx)

    assert len(_rows(ctx, "checklists-v2")) == 1


def test_revert_clears_the_new_tables_and_keeps_the_originals(ctx):
    ctx.table("requests").put_item(
        Item={"id": "q1", "groupId": "yorkshire", "text": "Dishes", "createdAt": 1}
    )
    _load("migrate")(ctx)
    assert len(_rows(ctx, "requests-v2")) == 1

    _load("revert")(ctx)

    assert _rows(ctx, "requests-v2") == []
    assert len(_rows(ctx, "requests")) == 1


def test_revert_tolerates_a_partially_applied_state(ctx):
    _load("revert")(ctx)  # nothing copied yet
    _load("revert")(ctx)  # and is safe to repeat

    assert all(_rows(ctx, f"{suffix}-v2") == [] for suffix in SOURCES)
