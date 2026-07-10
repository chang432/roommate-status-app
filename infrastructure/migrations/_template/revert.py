"""Reverse migration — undo what migrate.py did.

The runner calls this automatically if the forward migration raises, and you can
call it by hand via ``runner.py --env <env> --revert <migration-id>``. Because a
forward run may have died partway, revert must tolerate a **partially applied**
state: only undo rows that were actually changed, and be safe to re-run.

PITR is enabled on every table, so a point-in-time restore is the backstop if a
revert can't fully clean up.

``ctx`` is the same MigrationContext described in migrate.py.
"""

from __future__ import annotations


def run(ctx) -> None:
    # Example — reverse of the migrate.py backfill: drop the attribute again,
    # only where present so a partial/re-run is a no-op. Delete and write the
    # real reversal.
    #
    # table = ctx.table("shows")
    # scan_kwargs = {}
    # while True:
    #     resp = table.scan(**scan_kwargs)
    #     for item in resp["Items"]:
    #         if "updatedAt" in item:
    #             table.update_item(
    #                 Key={"id": item["id"]},
    #                 UpdateExpression="REMOVE updatedAt",
    #             )
    #     if "LastEvaluatedKey" not in resp:
    #         break
    #     scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    raise NotImplementedError("Fill in the reverse migration in revert.py::run.")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev --revert <migration-id>"
    )
