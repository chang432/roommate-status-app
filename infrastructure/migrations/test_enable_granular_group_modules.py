"""Coverage for the granular group-module migration."""

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
MIGRATION = "2026-08-06-01-enable-granular-group-modules"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_module_flags_round_trip_and_rerun_safely():
    migrate = load("group_modules_migrate", "migrate.py")
    revert = load("group_modules_revert", "revert.py")
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        prefix = "RoommateStatus-modules-" + uuid.uuid4().hex
        table = resource.create_table(
            TableName=f"{prefix}-groups",
            KeySchema=[{"AttributeName": "groupId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "groupId", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        ctx = runner.MigrationContext("dev", prefix, resource)
        table.put_item(Item={
            "groupId": "house", "showRoster": False, "showFeed": True,
            "showBookClub": False,
        })

        migrate.run(ctx)
        migrate.run(ctx)
        item = table.get_item(Key={"groupId": "house"})["Item"]
        assert item["enabledModules"] == [
            "events", "requests", "checklists", "polls", "tv", "spotify",
        ]
        assert all(field not in item for field in ("showRoster", "showFeed", "showBookClub"))

        revert.run(ctx)
        revert.run(ctx)
        item = table.get_item(Key={"groupId": "house"})["Item"]
        assert (item["showRoster"], item["showFeed"], item["showBookClub"]) == (
            False, True, False,
        )
        assert "enabledModules" not in item
