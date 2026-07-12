"""Forward migration — move comment-like rows out of the shared activities table.

Likes on activity and request comments used to live in
``RoommateStatus-{env}-activities`` as items discriminated by
``itemType == "commentLike"`` (activity likes) or ``"requestCommentLike"``
(request likes). They now own their own table,
``RoommateStatus-{env}-comment-likes`` (see docker/flask/comment_likes.py),
where the ``itemType`` discriminator is redundant and is dropped — each row
already self-describes its parent via ``activityId`` or ``requestId``.

Each like row is copied into the comment-likes table (minus ``itemType``) and
then deleted from the activities table.

Idempotent / resumable: we copy first and delete second, so a crash between the
two leaves a harmless duplicate — the activity/request feeds already read likes
only from the comment-likes table, and that table keys on the same ``id`` so a
re-run just overwrites it. A row already moved is simply absent on the next scan.
"""

from __future__ import annotations

LIKE_TYPES = {"commentLike", "requestCommentLike"}


def run(ctx) -> None:
    activities = ctx.table("activities")
    comment_likes = ctx.table("comment-likes")

    scan_kwargs = {}
    while True:
        resp = activities.scan(**scan_kwargs)
        rows = [item for item in resp["Items"] if item.get("itemType") in LIKE_TYPES]

        # Copy into the new table first (dropping the now-redundant discriminator)
        # so no like can be lost if the run dies mid-page.
        with comment_likes.batch_writer() as batch:
            for item in rows:
                moved = {key: value for key, value in item.items() if key != "itemType"}
                batch.put_item(Item=moved)

        # Then remove the originals from the activities table.
        with activities.batch_writer() as batch:
            for item in rows:
                batch.delete_item(Key={"id": item["id"]})

        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


if __name__ == "__main__":
    # Migrations are meant to run through the runner so the ledger and run-lock
    # stay consistent — never by executing this file directly.
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
