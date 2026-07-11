"""Reverse migration — move Spotify Jam back into the shared activities table.

Undoes migrate.py: every row in ``RoommateStatus-{env}-spotify-jam`` is copied
back into ``RoommateStatus-{env}-activities`` with ``itemType == "spotifyJam"``
restored, then deleted from the spotify-jam table. This pairs with rolling the
app code back to the pre-split version, which reads the Jam from the activities
table, so *all* Jam rows move regardless of when they were made.

Tolerates a partially-applied state: copy-then-delete on the same ``id`` means a
crash leaves at most a harmless duplicate, and a re-run overwrites and re-deletes.
"""

from __future__ import annotations

JAM_TYPE = "spotifyJam"


def run(ctx) -> None:
    activities = ctx.table("activities")
    spotify_jam = ctx.table("spotify-jam")

    scan_kwargs = {}
    while True:
        resp = spotify_jam.scan(**scan_kwargs)
        rows = resp["Items"]

        # Restore into the activities table first (re-adding the discriminator)
        # so nothing is lost if the run dies mid-page.
        with activities.batch_writer() as batch:
            for item in rows:
                batch.put_item(Item={**item, "itemType": JAM_TYPE})

        with spotify_jam.batch_writer() as batch:
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
