"""Coverage for extracting mutable checklist and show child rows."""

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
MIGRATION = "2026-08-01-01-extract-checklist-items-and-show-watchers"


def load(name: str, filename: str):
    path = HERE / MIGRATION / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_context():
    resource = boto3.resource("dynamodb", region_name="us-east-1")
    prefix = "RoommateStatus-child-rows-" + uuid.uuid4().hex
    for suffix in ("checklists-v2", "shows-v2"):
        resource.create_table(
            TableName=f"{prefix}-{suffix}",
            KeySchema=[{"AttributeName": "groupId", "KeyType": "HASH"}, {"AttributeName": "id", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "groupId", "AttributeType": "S"}, {"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
    return runner.MigrationContext("dev", prefix, resource)


def test_child_rows_round_trip_and_migration_is_idempotent():
    migrate = load("extract_child_rows_migrate", "migrate.py")
    revert = load("extract_child_rows_revert", "revert.py")
    with mock_aws():
        ctx = table_context()
        checklists = ctx.table("checklists-v2")
        shows = ctx.table("shows-v2")
        checklists.put_item(Item={
            "groupId": "home", "id": "checklist", "createdAt": 1,
            "items": [{"id": "milk", "text": "Buy milk", "checkedByIds": ["andre"], "checkedNamesById": {"andre": "Andre"}}],
        })
        shows.put_item(Item={
            "groupId": "home", "id": "show", "createdAt": 1,
            "members": [{"id": "andre", "name": "Andre", "season": 2, "episode": 3}],
        })

        migrate.run(ctx)
        migrate.run(ctx)
        checklist = checklists.get_item(Key={"groupId": "home", "id": "checklist"})["Item"]
        show = shows.get_item(Key={"groupId": "home", "id": "show"})["Item"]
        assert checklist["itemsStorage"] == "rows" and "items" not in checklist
        assert show["membersStorage"] == "rows" and "members" not in show
        assert checklists.get_item(Key={"groupId": "home", "id": "checklist-item#checklist#milk"})["Item"]["checkedByIds"] == {"andre"}
        assert shows.get_item(Key={"groupId": "home", "id": "show-watcher#show#andre"})["Item"]["episode"] == 3

        # A post-migration edit must survive a reverse pass as the live state.
        shows.update_item(
            Key={"groupId": "home", "id": "show-watcher#show#andre"},
            UpdateExpression="SET episode = :episode", ExpressionAttributeValues={":episode": 7},
        )
        revert.run(ctx)
        revert.run(ctx)
        checklist = checklists.get_item(Key={"groupId": "home", "id": "checklist"})["Item"]
        show = shows.get_item(Key={"groupId": "home", "id": "show"})["Item"]
        assert checklist["items"][0]["id"] == "milk"
        assert checklist["items"][0]["checkedByIds"] == ["andre"]
        assert show["members"] == [{"id": "andre", "name": "Andre", "season": 2, "episode": 7}]
        assert not [item for item in checklists.scan()["Items"] if item.get("parentId")]
        assert not [item for item in shows.scan()["Items"] if item.get("parentId")]
