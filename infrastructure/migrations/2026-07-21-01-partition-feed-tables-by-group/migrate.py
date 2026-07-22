"""Copy the five feed tables into their group-partitioned (groupId, id) twins.

Also folds in the groupId backfill that used to run in the Flask request path
(`activities.backfill_default_group_records` / the household_shows twin): groupId
is the new partition key, so a row that predates group isolation cannot be copied
until it has one. Those rows are assigned the seeded default group, exactly as
the request-path backfill did.
"""

from __future__ import annotations

# Mirrors db.DEFAULT_GROUP_ID. Duplicated rather than imported so a migration
# stays pinned to the value that was correct when it was written, even if the
# app's constant later changes.
DEFAULT_GROUP_ID = "yorkshire"

# (source suffix, destination suffix) for each table gaining a groupId partition.
TABLES = [
    ("activities", "activities-v2"),
    ("requests", "requests-v2"),
    ("checklists", "checklists-v2"),
    ("shows", "shows-v2"),
    ("comment-likes", "comment-likes-v2"),
]


def run(ctx) -> None:
    for source_suffix, dest_suffix in TABLES:
        source = ctx.table(source_suffix)
        dest = ctx.table(dest_suffix)
        copied = skipped = 0
        scan_kwargs = {}

        while True:
            response = source.scan(**scan_kwargs)
            for item in response.get("Items", []):
                # Rows carrying itemType are pre-split coordination records that
                # the 2026-07-11-0{1,2,3,4} migrations already moved into their
                # own tables. Leave them behind rather than polluting the new
                # table; the source table is never written to here, so anything
                # unexpected stays recoverable.
                if item.get("itemType"):
                    skipped += 1
                    continue
                if not item.get("groupId"):
                    item["groupId"] = DEFAULT_GROUP_ID
                # put_item is a blind upsert keyed on (groupId, id), so a re-run
                # after a partial pass simply rewrites the same row.
                dest.put_item(Item=item)
                copied += 1

            if "LastEvaluatedKey" not in response:
                break
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

        note = f" ({skipped} itemType row(s) left in place)" if skipped else ""
        print(f"  {source_suffix} -> {dest_suffix}: copied {copied} row(s){note}")


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
