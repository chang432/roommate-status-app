"""Forward migration — the in-place data change.

Copy this whole folder to ``infrastructure/migrations/YYYY-MM-DD-NN-slug/`` and
fill in ``run``. Keep it **idempotent** (safe to re-run) and **resumable**:
DynamoDB has no multi-item transaction across a big scan, so a run can die
partway — a second run must not double-apply or crash on already-migrated rows.
Page through with ``scan`` + ``LastEvaluatedKey`` and write in batches.

``ctx`` is the runner's MigrationContext:
    ctx.env           "dev" or "prod"
    ctx.table_prefix  "RoommateStatus-dev" / "RoommateStatus-main"
    ctx.table(suffix) boto3 Table, e.g. ctx.table("activities"); no suffix = the
                      base roommate table.
"""

from __future__ import annotations


def run(ctx) -> None:
    # Example — backfill a missing attribute, only touching rows that lack it so
    # re-runs are no-ops. Delete this and write the real change.
    #
    # table = ctx.table("shows")
    # scan_kwargs = {}
    # while True:
    #     resp = table.scan(**scan_kwargs)
    #     with table.batch_writer() as batch:
    #         for item in resp["Items"]:
    #             if "updatedAt" not in item:
    #                 item["updatedAt"] = item.get("createdAt", 0)
    #                 batch.put_item(Item=item)
    #     if "LastEvaluatedKey" not in resp:
    #         break
    #     scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    raise NotImplementedError("Fill in the forward migration in migrate.py::run.")


if __name__ == "__main__":
    # Migrations are meant to run through the runner so the ledger and run-lock
    # stay consistent — never by executing this file directly.
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
