"""Tests for the migration runner. Run: cd infrastructure && python -m pytest migrations

Uses moto to mock DynamoDB, so no AWS account or DynamoDB Local is needed.
"""

from __future__ import annotations

import os
import textwrap
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

# Dummy AWS creds/region before any boto3 client is built (matches the app's test_app.py).
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

import runner  # noqa: E402  (pytest puts this dir on sys.path; env set above)

PREFIX = "RoommateStatus-dev"


def _make_migration(root: Path, name: str, migrate_body: str, revert_body: str) -> None:
    d = root / name
    d.mkdir()
    (d / "migrate.py").write_text(f"def run(ctx):\n{textwrap.indent(textwrap.dedent(migrate_body), '    ')}\n")
    (d / "revert.py").write_text(f"def run(ctx):\n{textwrap.indent(textwrap.dedent(revert_body), '    ')}\n")


@pytest.fixture
def aws():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        # The migration ledger + a data table (shows) for migrations to act on.
        for table in (f"{PREFIX}-migrations", f"{PREFIX}-shows"):
            client.create_table(
                TableName=table,
                AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                BillingMode="PAY_PER_REQUEST",
            )
        yield


@pytest.fixture
def ctx_tracking(aws):
    ctx, tracking = runner.build_context("dev")
    tracking.ensure_exists()
    return ctx, tracking


def _seed_show(ctx, **attrs):
    ctx.table("shows").put_item(Item={"id": attrs.pop("id"), **attrs})


def test_ensure_exists_missing_table_is_fatal(aws):
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.delete_table(TableName=f"{PREFIX}-migrations")
    _, tracking = runner.build_context("dev")
    with pytest.raises(SystemExit, match="does not exist"):
        tracking.ensure_exists()


def test_discover_orders_and_skips_underscore_and_dot(tmp_path):
    (tmp_path / "_template").mkdir()
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / ".pytest_cache").mkdir()  # dot-dirs must not trip discovery
    (tmp_path / "README.md").write_text("x")
    for name in ("2026-07-10-02-b", "2026-07-10-01-a"):
        _make_migration(tmp_path, name, "pass", "pass")
    found = [p.name for p in runner.discover(tmp_path)]
    assert found == ["2026-07-10-01-a", "2026-07-10-02-b"]  # sorted; _/. dirs excluded


def test_discover_rejects_bad_name(tmp_path):
    _make_migration(tmp_path, "not-a-date-slug", "pass", "pass")
    with pytest.raises(SystemExit, match="Invalid migration folder name"):
        runner.discover(tmp_path)


def test_apply_runs_pending_and_records_applied(ctx_tracking, tmp_path, monkeypatch):
    ctx, tracking = ctx_tracking
    _seed_show(ctx, id="s1", createdAt=100)
    _make_migration(
        tmp_path,
        "2026-07-10-01-backfill",
        """
        t = ctx.table("shows")
        for item in t.scan()["Items"]:
            if "updatedAt" not in item:
                t.update_item(Key={"id": item["id"]},
                              UpdateExpression="SET updatedAt = :v",
                              ExpressionAttributeValues={":v": item["createdAt"]})
        """,
        "pass",
    )
    monkeypatch.setattr(runner, "_HERE", tmp_path)
    assert runner.main(["--env", "dev"]) == 0

    assert ctx.table("shows").get_item(Key={"id": "s1"})["Item"]["updatedAt"] == 100
    assert tracking.applied_ids() == {"2026-07-10-01-backfill"}

    # Re-running is a no-op: the applied migration is skipped.
    assert runner.main(["--env", "dev"]) == 0


def test_failure_triggers_revert_and_marks_failed(ctx_tracking, tmp_path, monkeypatch):
    ctx, tracking = ctx_tracking
    _seed_show(ctx, id="s1", createdAt=100)
    _make_migration(
        tmp_path,
        "2026-07-10-01-boom",
        """
        ctx.table("shows").update_item(Key={"id": "s1"},
            UpdateExpression="SET touched = :v", ExpressionAttributeValues={":v": 1})
        raise RuntimeError("boom")
        """,
        """
        ctx.table("shows").update_item(Key={"id": "s1"}, UpdateExpression="REMOVE touched")
        """,
    )
    monkeypatch.setattr(runner, "_HERE", tmp_path)
    with pytest.raises(SystemExit, match="failed and was reverted"):
        runner.main(["--env", "dev"])

    item = ctx.table("shows").get_item(Key={"id": "s1"})["Item"]
    assert "touched" not in item  # revert cleaned up the partial change
    assert tracking.applied_ids() == set()  # not counted as applied
    statuses = {i["id"]: i["status"] for i in tracking.all_items()}
    assert statuses.get("2026-07-10-01-boom") == "failed"
    assert not any(k.startswith("lock#") for k in statuses)  # lock released


def test_lock_blocks_concurrent_run(ctx_tracking, tmp_path, monkeypatch):
    ctx, tracking = ctx_tracking
    _make_migration(tmp_path, "2026-07-10-01-noop", "pass", "pass")
    monkeypatch.setattr(runner, "_HERE", tmp_path)
    tracking.acquire_lock()  # simulate a run already in progress
    try:
        with pytest.raises(SystemExit, match="holds the lock"):
            runner.main(["--env", "dev"])
    finally:
        tracking.release_lock()


def test_dry_run_changes_nothing(ctx_tracking, tmp_path, monkeypatch, capsys):
    ctx, tracking = ctx_tracking
    _make_migration(tmp_path, "2026-07-10-01-noop", "raise AssertionError('should not run')", "pass")
    monkeypatch.setattr(runner, "_HERE", tmp_path)
    assert runner.main(["--env", "dev", "--dry-run"]) == 0
    assert tracking.applied_ids() == set()
    assert "pending" in capsys.readouterr().out


def test_manual_revert(ctx_tracking, tmp_path, monkeypatch):
    ctx, tracking = ctx_tracking
    _seed_show(ctx, id="s1", flag=1)
    _make_migration(
        tmp_path,
        "2026-07-10-01-flag",
        "pass",
        """ctx.table("shows").update_item(Key={"id": "s1"}, UpdateExpression="REMOVE flag")""",
    )
    monkeypatch.setattr(runner, "_HERE", tmp_path)
    assert runner.main(["--env", "dev", "--revert", "2026-07-10-01-flag"]) == 0
    assert "flag" not in ctx.table("shows").get_item(Key={"id": "s1"})["Item"]
    statuses = {i["id"]: i["status"] for i in tracking.all_items()}
    assert statuses["2026-07-10-01-flag"] == "reverted"
