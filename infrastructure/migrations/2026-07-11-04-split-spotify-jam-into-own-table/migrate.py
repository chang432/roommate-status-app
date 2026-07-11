"""Forward migration — move Spotify Jam rows out of the shared activities table.

The active Spotify Jam used to live in ``RoommateStatus-{env}-activities`` as a
singleton item (id ``activeJam#<group>``) discriminated by
``itemType == "spotifyJam"``. It now owns its own table,
``RoommateStatus-{env}-spotify-jam`` (see docker/flask/jam.py), where the
``itemType`` discriminator is redundant and is dropped.

Each Jam row is copied into the spotify-jam table (minus ``itemType``) and then
deleted from the activities table.

Idempotent / resumable: we copy first and delete second, so a crash between the
two leaves a harmless duplicate — jam reads only from the spotify-jam table,
which keys on the same ``id`` so a re-run just overwrites it. A row already moved
is simply absent on the next scan.
"""

from __future__ import annotations

JAM_TYPE = "spotifyJam"


def run(ctx) -> None:
    activities = ctx.table("activities")
    spotify_jam = ctx.table("spotify-jam")

    scan_kwargs = {}
    while True:
        resp = activities.scan(**scan_kwargs)
        rows = [item for item in resp["Items"] if item.get("itemType") == JAM_TYPE]

        # Copy into the new table first (dropping the now-redundant discriminator)
        # so no Jam can be lost if the run dies mid-page.
        with spotify_jam.batch_writer() as batch:
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
