#!/usr/bin/env python3
"""Apply in-place DynamoDB data migrations for the dev or prod deployment.

A migration is a dated folder in this directory (``YYYY-MM-DD-NN-slug``) holding
three files:

    migrate.py   defines ``run(ctx)`` — the forward, in-place data change
    revert.py    defines ``run(ctx)`` — undoes the forward change
    status.md    human documentation (NOT the source of truth for run state)

Whether a migration has already run against an environment is tracked in a
DynamoDB table (``RoommateStatus-{dev,main}-migrations``), one ledger item per
migration. That table — not any committed file — is authoritative, so it
survives the pipeline's ``git reset --hard`` and never needs a CI push-back.

This runner is invoked by the deploy pipeline (before the app is redeployed) and
can also be run by hand::

    python runner.py --env dev              # apply all pending migrations
    python runner.py --env prod --status    # list applied vs pending, do nothing
    python runner.py --env dev --dry-run    # like --status; changes nothing
    python runner.py --env dev --revert 2026-07-10-01-backfill-updatedAt

``prod`` maps to the ``RoommateStatus-main`` table set. AWS credentials and
region come from the standard AWS chain (env vars / ~/.aws), the same as
``deploy.py`` and the app.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
import re
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# Reuse the Flask app's shared boto3 factory (aws.resource()) so migrations sign
# requests exactly like the app — same region resolution and DYNAMODB_ENDPOINT
# handling. aws.py depends on boto3 only (no Flask/werkzeug), so the migration CI
# job stays lightweight; it is import-side-effect free, so the client is built
# lazily when we first call resource().
_FLASK_DIR = _HERE.parent.parent / "docker" / "flask"
if str(_FLASK_DIR) not in sys.path:
    sys.path.insert(0, str(_FLASK_DIR))
import aws  # noqa: E402  (path is set up just above)

# prod is the human-facing name for the -main table set.
_ENV_PREFIX = {"dev": "RoommateStatus-dev", "prod": "RoommateStatus-main"}

# Migration folders are named YYYY-MM-DD-NN-slug: an ISO date (so lexical sort =
# chronological order), a two-digit same-day sequence, then a kebab-case slug.
_MIGRATION_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{2}-[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


def _now_ms() -> int:
    return int(time.time() * 1000)


class MigrationContext:
    """Handed to every migration's ``run(ctx)``; the only surface migrations use.

    Keeps migration code environment-agnostic: it asks for tables by suffix and
    the context resolves the ``dev`` vs ``main`` prefix and reuses the app's
    shared boto3 resource.
    """

    def __init__(self, env: str, table_prefix: str, resource):
        self.env = env
        self.table_prefix = table_prefix
        self._resource = resource

    def table(self, suffix: str = ""):
        """Return the boto3 Table for this env, e.g. ``table("activities")``.

        No suffix returns the base roommate table (``RoommateStatus-dev``).
        """
        name = self.table_prefix if not suffix else f"{self.table_prefix}-{suffix}"
        return self._resource.Table(name)


class Tracking:
    """Reads/writes the per-environment migration ledger + run lock."""

    def __init__(self, resource, table_prefix: str):
        self._resource = resource
        self.table_name = f"{table_prefix}-migrations"
        # infix is the env token embedded in the table names (dev / main), used
        # to name the lock item so it reads clearly in the console.
        self._infix = table_prefix.split("-", 1)[1] if "-" in table_prefix else table_prefix
        self._table = resource.Table(self.table_name)

    def ensure_exists(self) -> None:
        """Fail early with a fix-it message if the ledger table isn't provisioned.

        The table is owned by CloudFormation (dynamodb-table-{dev,main}.yaml), so
        provisioning is a one-time ``deploy.py`` step per environment — mirroring
        how every other table is created.
        """
        client = self._resource.meta.client
        try:
            client.describe_table(TableName=self.table_name)
        except client.exceptions.ResourceNotFoundException:
            flag = "--dev" if self._infix == "dev" else "--main"
            raise SystemExit(
                f"Migration ledger table '{self.table_name}' does not exist.\n"
                f"Provision it first:  cd infrastructure && python deploy.py {flag}"
            )

    def applied_ids(self) -> set[str]:
        """Ids of migrations recorded as successfully applied (excludes failed/reverted)."""
        ids: set[str] = set()
        kwargs: dict = {}
        while True:
            resp = self._table.scan(**kwargs)
            for item in resp.get("Items", []):
                if item.get("status") == "applied":
                    ids.add(item["id"])
            if "LastEvaluatedKey" not in resp:
                return ids
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def all_items(self) -> list[dict]:
        items: list[dict] = []
        kwargs: dict = {}
        while True:
            resp = self._table.scan(**kwargs)
            items.extend(resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                return items
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def record(self, migration_id: str, status: str, checksum: str) -> None:
        """Upsert a ledger row, preserving the original appliedAt across re-statuses."""
        now = _now_ms()
        self._table.update_item(
            Key={"id": migration_id},
            UpdateExpression=(
                "SET #s = :s, updatedAt = :u, checksum = :c, "
                "appliedAt = if_not_exists(appliedAt, :u)"
            ),
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":u": now, ":c": checksum},
        )

    def acquire_lock(self) -> None:
        """Take the env's run lock via a conditional write; refuse if already held."""
        lock_id = f"lock#{self._infix}"
        run_id = os.environ.get("GITHUB_RUN_ID") or f"local-{_now_ms()}"
        client = self._resource.meta.client
        try:
            self._table.put_item(
                Item={
                    "id": lock_id,
                    "status": "locked",
                    "lockedAt": _now_ms(),
                    "runId": run_id,
                },
                ConditionExpression="attribute_not_exists(id)",
            )
        except client.exceptions.ConditionalCheckFailedException:
            raise SystemExit(
                f"Another migration run holds the lock ('{lock_id}' exists in "
                f"{self.table_name}). If a previous run crashed, delete that item "
                "to clear the lock, then retry."
            )

    def release_lock(self) -> None:
        self._table.delete_item(Key={"id": f"lock#{self._infix}"})


def _checksum(migration_dir: Path) -> str:
    """sha256 of migrate.py, so a post-apply edit to a migration is detectable."""
    digest = hashlib.sha256((migration_dir / "migrate.py").read_bytes()).hexdigest()
    return f"sha256:{digest}"


def discover(migrations_dir: Path) -> list[Path]:
    """Return migration folders in apply order, validating names and contents.

    Non-directories (``runner.py``, ``README.md``) and folders starting with
    ``_`` (``_template``, ``__pycache__``) or ``.`` (``.pytest_cache``) are
    ignored, so only real migrations are returned.
    """
    found: list[Path] = []
    for path in sorted(migrations_dir.iterdir()):
        if not path.is_dir() or path.name.startswith(("_", ".")):
            continue
        if not _MIGRATION_RE.match(path.name):
            raise SystemExit(
                f"Invalid migration folder name '{path.name}'. "
                "Expected YYYY-MM-DD-NN-slug (e.g. 2026-07-10-01-backfill-updatedAt)."
            )
        for required in ("migrate.py", "revert.py"):
            if not (path / required).is_file():
                raise SystemExit(f"Migration '{path.name}' is missing {required}.")
        found.append(path)
    return found


def _load_step(migration_dir: Path, step: str):
    """Import migrate.py / revert.py by path and return its ``run`` callable."""
    file = migration_dir / f"{step}.py"
    spec = importlib.util.spec_from_file_location(f"migration.{migration_dir.name}.{step}", file)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    if not hasattr(module, "run"):
        raise SystemExit(f"{file} must define run(ctx).")
    return module.run


def cmd_status(migrations_dir: Path, tracking: Tracking) -> int:
    items = {i["id"]: i for i in tracking.all_items()}
    migrations = discover(migrations_dir)
    folder_names = {p.name for p in migrations}
    print(f"Ledger table: {tracking.table_name}\n")
    for path in migrations:
        item = items.get(path.name)
        state = item["status"] if item else "pending"
        print(f"  [{state:>8}] {path.name}")
    # Ledger rows with no matching folder (a migration renamed/deleted after it
    # ran); the transient lock item is not a migration, so skip it.
    orphans = [i for i in items if i not in folder_names and not i.startswith("lock#")]
    if orphans:
        print("\n  Ledger rows with no matching folder (renamed/deleted?):")
        for i in sorted(orphans):
            print(f"    {i} -> {items[i].get('status')}")
    return 0


def cmd_apply(ctx: MigrationContext, migrations_dir: Path, tracking: Tracking) -> int:
    applied = tracking.applied_ids()
    pending = [p for p in discover(migrations_dir) if p.name not in applied]
    if not pending:
        print("No pending migrations — nothing to do.")
        return 0

    print(f"{len(pending)} pending migration(s) for env '{ctx.env}':")
    for p in pending:
        print(f"  - {p.name}")

    tracking.acquire_lock()
    try:
        for path in pending:
            print(f"\nApplying {path.name} …")
            try:
                _load_step(path, "migrate")(ctx)
            except Exception as err:  # noqa: BLE001 — any failure triggers rollback
                print(f"  FAILED: {err!r}\n  Reverting {path.name} …", file=sys.stderr)
                try:
                    _load_step(path, "revert")(ctx)
                except Exception as revert_err:  # noqa: BLE001
                    tracking.record(path.name, "failed", _checksum(path))
                    raise SystemExit(
                        f"Migration {path.name} failed AND its revert failed: {revert_err!r}. "
                        "Manual intervention required (see PITR restore)."
                    )
                tracking.record(path.name, "failed", _checksum(path))
                raise SystemExit(f"Migration {path.name} failed and was reverted: {err!r}")
            tracking.record(path.name, "applied", _checksum(path))
            print(f"  applied {path.name}.")
    finally:
        tracking.release_lock()

    print("\nAll pending migrations applied.")
    return 0


def cmd_revert(ctx: MigrationContext, migrations_dir: Path, tracking: Tracking, migration_id: str) -> int:
    path = migrations_dir / migration_id
    if not path.is_dir() or not (path / "revert.py").is_file():
        raise SystemExit(f"No migration '{migration_id}' with a revert.py under {migrations_dir}.")
    tracking.acquire_lock()
    try:
        print(f"Reverting {migration_id} …")
        _load_step(path, "revert")(ctx)
        tracking.record(migration_id, "reverted", _checksum(path))
    finally:
        tracking.release_lock()
    print(f"Reverted {migration_id}.")
    return 0


def build_context(env: str) -> tuple[MigrationContext, Tracking]:
    """Wire up the boto3 resource, context, and tracking for an environment."""
    prefix = _ENV_PREFIX[env]
    resource = aws.resource()
    ctx = MigrationContext(env, prefix, resource)
    tracking = Tracking(resource, prefix)
    return ctx, tracking


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply DynamoDB data migrations.")
    parser.add_argument(
        "--env",
        required=True,
        choices=("dev", "prod"),
        help="Which deployment to migrate. 'prod' targets the RoommateStatus-main tables.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="List applied vs pending; change nothing.")
    mode.add_argument("--status", action="store_true", help="Alias for --dry-run.")
    mode.add_argument("--revert", metavar="MIGRATION_ID", help="Run one migration's revert.py by folder name.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ctx, tracking = build_context(args.env)
    tracking.ensure_exists()

    migrations_dir = _HERE
    if args.dry_run or args.status:
        return cmd_status(migrations_dir, tracking)
    if args.revert:
        return cmd_revert(ctx, migrations_dir, tracking, args.revert)
    return cmd_apply(ctx, migrations_dir, tracking)


if __name__ == "__main__":
    raise SystemExit(main())
