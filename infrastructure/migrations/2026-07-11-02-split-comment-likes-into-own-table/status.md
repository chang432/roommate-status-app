# Migration: 2026-07-11-02-split-comment-likes-into-own-table

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
Moves every comment-like row out of the shared `RoommateStatus-{env}-activities`
table (where it was stored with `itemType == "commentLike"` for activity comments
or `"requestCommentLike"` for request comments) into the new dedicated
`RoommateStatus-{env}-comment-likes` table, dropping the now-redundant `itemType`
attribute. Same `id`, same shape otherwise (`activityId` **or** `requestId`,
`commentId`, `groupId`, `userId`).

## Why
Backs the split of comment likes into their own table so the activity and request
feeds stop scanning-and-discarding like rows on every read (the "own table per
concern" pattern activities/shows/checklists already use). Likes are the
highest-cardinality rows in that feed — one per user per liked comment.
Schema docs: `infrastructure/db_schema/{dev,prod}/RoommateStatus-{dev,main}-comment-likes.csv`
plus the trimmed activities CSV and updated `_overview.csv`.

## Forward (migrate.py)
Pages through the activities table, and for each row whose `itemType` is
`commentLike` or `requestCommentLike` copies it (minus `itemType`) into the
comment-likes table, then deletes the original. Copy-before-delete makes it
resumable: a crash between the two leaves a harmless duplicate (the feeds read
likes only from the comment-likes table, which keys on the same `id`, so a re-run
overwrites it). Already-moved rows are simply absent on the next scan.

## Reverse (revert.py)
Pages through the comment-likes table and moves every row back into the
activities table with `itemType` restored — recovered from the row itself
(`activityId` → `commentLike`, `requestId` → `requestCommentLike`) — then deletes
it from comment-likes. Pairs with rolling the app back to the pre-split code, so
all likes return regardless of when they were created. Same copy-before-delete
idempotency.

## Risk / notes
Small row count at household scale, though likes are the most numerous rows in the
old activities table. Runs well under a second. The app is deployed before
migrations run, so during that brief window the new code reads the still-empty
comment-likes table and existing likes appear absent (like counts read zero) until
this migration completes in the same pipeline job. PITR is enabled on both tables
as the backstop.
