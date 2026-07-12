# Migration: 2026-07-11-03-split-requests-into-own-table

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
Moves every household-request item out of the shared
`RoommateStatus-{env}-activities` table (where it was stored with
`itemType == "request"`) into the new dedicated `RoommateStatus-{env}-requests`
table, dropping the now-redundant `itemType` attribute. Same `id`, same shape
otherwise (`text`, `requester`, `requesterId`, `groupId`, `createdAt`,
`updatedAt`, `requestedIds`, `requestedNamesById`, `responses`, embedded
`comments`, `isArchived`, and any archive metadata). Comment likes are already in
the `-comment-likes` table and are untouched.

## Why
Backs the split of requests into their own table so each feed's DynamoDB scan
stays clean (the "own table per concern" pattern activities/shows/checklists
already use). Schema docs:
`infrastructure/db_schema/{dev,prod}/RoommateStatus-{dev,main}-requests.csv`
plus the trimmed activities CSV and updated `_overview.csv`.

## Forward (migrate.py)
Pages through the activities table, and for each `itemType == "request"` row
copies it (minus `itemType`) into the requests table, then deletes the original.
Copy-before-delete makes it resumable: a crash between the two leaves a harmless
duplicate (the requests feed reads only from the requests table, which keys on
the same `id`, so a re-run overwrites it). Already-moved rows are simply absent
on the next scan.

## Reverse (revert.py)
Pages through the requests table and moves every row back into the activities
table with `itemType == "request"` restored, then deletes it from requests.
Pairs with rolling the app back to the pre-split code, so all requests return
regardless of when they were created. Same copy-before-delete idempotency.

## Risk / notes
Small row count at household scale. Runs well under a second. The app is deployed
before migrations run, so during that brief window the new code reads the still-
empty requests table and requests appear absent until this migration completes
(same pipeline job). PITR is enabled on both tables as the backstop.
