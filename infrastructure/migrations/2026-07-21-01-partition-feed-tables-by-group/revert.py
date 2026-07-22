"""Empty the group-partitioned tables, returning reads to the id-keyed originals.

The forward pass only ever *copies*: it never writes to or deletes from the
source tables, so every row it produced is a duplicate and the originals are
still intact and authoritative. Reverting therefore means clearing the
destination tables — pair it with rolling the app back to the pre-partition
code, which reads the originals again.

Rows the app wrote to a -v2 table after the migration ran exist only there, so
this reversal drops them. That is the same trade the 2026-07-11 table splits
make, and it is why a revert belongs with an app rollback rather than on its own.
"""

from __future__ import annotations

from botocore.exceptions import ClientError

DEST_SUFFIXES = [
    "activities-v2",
    "requests-v2",
    "checklists-v2",
    "shows-v2",
    "comment-likes-v2",
]


def run(ctx) -> None:
    for suffix in DEST_SUFFIXES:
        table = ctx.table(suffix)
        deleted = 0
        scan_kwargs = {}

        while True:
            try:
                response = table.scan(**scan_kwargs)
            except ClientError as err:
                # A revert can run before the table was ever provisioned (the
                # forward pass died early, or CloudFormation had not caught up).
                # Nothing to clear in that case.
                if err.response["Error"]["Code"] == "ResourceNotFoundException":
                    print(f"  {suffix}: table absent, nothing to clear")
                    break
                raise

            for item in response.get("Items", []):
                # Deleting by full key is idempotent, so a partially-completed
                # revert can simply be run again.
                table.delete_item(Key={"groupId": item["groupId"], "id": item["id"]})
                deleted += 1

            if "LastEvaluatedKey" not in response:
                print(f"  {suffix}: cleared {deleted} row(s)")
                break
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev "
        "--revert 2026-07-21-01-partition-feed-tables-by-group"
    )
