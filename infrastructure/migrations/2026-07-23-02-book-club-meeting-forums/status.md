# Migration: 2026-07-23-02-book-club-meeting-forums

> Documentation only. Applied state is recorded in each environment's
> migrations table.

## What it changes

Moves legacy book/chapter `post#...` records into the meeting-scoped
`forum#<meeting>#...` shape used by the dedicated Book Club page.

## Forward

Each post is assigned to the most recently created meeting for its book that
existed when the post was written, falling back to the earliest meeting.
Deterministic UUIDv5 target IDs and an embedded source snapshot make the pass
idempotent and resumable. Posts with no meeting are retained and reported.

## Reverse

Rows marked by this migration restore their embedded legacy records and remove
the migrated forum copies. The pass tolerates a partial forward run.

## Risk

Low row volume is expected. The deployed application stops writing the old
shape before this migration runs. Point-in-time recovery remains the backstop.
