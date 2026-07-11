"""Reverse migration — move checklists back into the shared activities table.

Undoes migrate.py: every row in ``RoommateStatus-{env}-checklists`` is copied
back into ``RoommateStatus-{env}-activities`` with the ``itemType == "checklist"``
discriminator restored, then deleted from the checklists table. This pairs with
rolling the app code back to the pre-split version, which reads checklists from
the activities table, so *all* checklists move regardless of when they were made.

Tolerates a partially-applied state: copy-then-delete on the same ``id`` means a
crash leaves at most a harmless duplicate, and a re-run overwrites and re-deletes.
"""

from __future__ import annotations

CHECKLIST_TYPE = "checklist"


def run(ctx) -> None:
    activities = ctx.table("activities")
    checklists = ctx.table("checklists")

    scan_kwargs = {}
    while True:
        resp = checklists.scan(**scan_kwargs)
        rows = resp["Items"]

        # Restore into the activities table first (re-adding the discriminator)
        # so nothing is lost if the run dies mid-page.
        with activities.batch_writer() as batch:
            for item in rows:
                batch.put_item(Item={**item, "itemType": CHECKLIST_TYPE})

        with checklists.batch_writer() as batch:
            for item in rows:
                batch.delete_item(Key={"id": item["id"]})

        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev --revert <migration-id>"
    )
