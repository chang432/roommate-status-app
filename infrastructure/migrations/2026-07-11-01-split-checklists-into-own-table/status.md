# Migration: 2026-07-11-01-split-checklists-into-own-table

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
Moves every checklist item out of the shared `RoommateStatus-{env}-activities`
table (where it was stored with `itemType == "checklist"`) into the new
dedicated `RoommateStatus-{env}-checklists` table, dropping the now-redundant
`itemType` attribute. Same `id`, same shape otherwise (`title`, `createdBy`,
`createdById`, `groupId`, `createdAt`, `updatedAt`, embedded `items`,
`isArchived`, and any archive metadata).

## Why
Backs the split of checklists into their own table so each feed's DynamoDB scan
stays clean (the "own table per concern" pattern activities/shows already use).
Schema docs: `infrastructure/db_schema/{dev,prod}/RoommateStatus-{dev,main}-checklists.csv`
plus the trimmed activities CSV and updated `_overview.csv`.

## Forward (migrate.py)
Pages through the activities table, and for each `itemType == "checklist"` row
copies it (minus `itemType`) into the checklists table, then deletes the
original. Copy-before-delete makes it resumable: a crash between the two leaves a
harmless duplicate (the activities feed ignores any item with an `itemType`, and
the checklists row keys on the same `id`, so a re-run overwrites it). Already-moved
rows are simply absent on the next scan.

## Reverse (revert.py)
Pages through the checklists table and moves every row back into the activities
table with `itemType == "checklist"` restored, then deletes it from checklists.
Pairs with rolling the app back to the pre-split code, so all checklists return
regardless of when they were created. Same copy-before-delete idempotency.

## Risk / notes
Tiny row count (household scale — a handful of checklists per group). Runs in well
under a second. The app is deployed before migrations run, so during that brief
window the new code reads the still-empty checklists table and checklists appear
absent until this migration completes (same pipeline job). PITR is enabled on
both tables as the backstop.
