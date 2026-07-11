# Migration: 2026-07-11-04-split-spotify-jam-into-own-table

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
Moves the active Spotify Jam item out of the shared
`RoommateStatus-{env}-activities` table (where it was stored as the singleton
`activeJam#<group>` with `itemType == "spotifyJam"`) into the new dedicated
`RoommateStatus-{env}-spotify-jam` table, dropping the now-redundant `itemType`
attribute. Same `id`, same shape otherwise (`groupId`, `link`, `hostId`,
`hostName`, `createdAt`, `updatedAt`).

## Why
Backs the split of the Spotify Jam into its own table so each feed's DynamoDB
scan stays clean (the "own table per concern" pattern activities/shows/checklists
already use). Schema docs:
`infrastructure/db_schema/{dev,prod}/RoommateStatus-{dev,main}-spotify-jam.csv`
plus the trimmed activities CSV and updated `_overview.csv`.

## Forward (migrate.py)
Pages through the activities table, and for each `itemType == "spotifyJam"` row
copies it (minus `itemType`) into the spotify-jam table, then deletes the
original. Copy-before-delete makes it resumable: a crash between the two leaves a
harmless duplicate (jam reads only from the spotify-jam table, which keys on the
same `id`, so a re-run overwrites it). Already-moved rows are simply absent on
the next scan.

## Reverse (revert.py)
Pages through the spotify-jam table and moves every row back into the activities
table with `itemType == "spotifyJam"` restored, then deletes it from spotify-jam.
Pairs with rolling the app back to the pre-split code, so the Jam returns
regardless of when it was created. Same copy-before-delete idempotency.

## Risk / notes
At most one Jam row per group, so effectively a no-op-sized migration. Runs well
under a second. The app is deployed before migrations run, so during that brief
window the new code reads the still-empty spotify-jam table and an active Jam
appears absent until this migration completes (same pipeline job). PITR is
enabled on both tables as the backstop.
