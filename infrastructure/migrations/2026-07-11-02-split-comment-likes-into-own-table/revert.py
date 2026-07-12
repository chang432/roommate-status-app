"""Reverse migration — move comment likes back into the shared activities table.

Undoes migrate.py: every row in ``RoommateStatus-{env}-comment-likes`` is copied
back into ``RoommateStatus-{env}-activities`` with its ``itemType`` discriminator
restored, then deleted from the comment-likes table. The discriminator is
recovered from the row itself — a row with an ``activityId`` is a ``commentLike``,
one with a ``requestId`` is a ``requestCommentLike``. This pairs with rolling the
app code back to the pre-split version, which reads likes from the activities
table, so *all* likes move regardless of when they were made.

Tolerates a partially-applied state: copy-then-delete on the same ``id`` means a
crash leaves at most a harmless duplicate, and a re-run overwrites and re-deletes.
"""

from __future__ import annotations


def _item_type(row: dict) -> str:
    if row.get("activityId"):
        return "commentLike"
    if row.get("requestId"):
        return "requestCommentLike"
    # Shouldn't happen — every like row carries exactly one parent id — but fall
    # back to the activity type so a malformed row still round-trips.
    return "commentLike"


def run(ctx) -> None:
    activities = ctx.table("activities")
    comment_likes = ctx.table("comment-likes")

    scan_kwargs = {}
    while True:
        resp = comment_likes.scan(**scan_kwargs)
        rows = resp["Items"]

        # Restore into the activities table first (re-adding the discriminator)
        # so nothing is lost if the run dies mid-page.
        with activities.batch_writer() as batch:
            for item in rows:
                batch.put_item(Item={**item, "itemType": _item_type(item)})

        with comment_likes.batch_writer() as batch:
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
