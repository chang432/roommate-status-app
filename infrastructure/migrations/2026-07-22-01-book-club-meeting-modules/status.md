# Migration: 2026-07-22-01-book-club-meeting-modules

> Documentation only. Applied state is recorded in the environment's migrations table.

## What it changes

Converts Book Club configuration rotations into sticky Book/Snack owner orders,
rekeys date-derived sessions and responses to stable meeting IDs, and renames
recommender/snack-duty snapshots to Book/Snack owner snapshots. Books, ratings,
chapter posts, attendance, and reading progress are preserved.

## Forward and reverse

The forward pass uses deterministic UUIDv5 meeting IDs and stores each original
record in a migration-only map before replacing it. Re-running overwrites the
same destination and safely skips already-converted source rows. The reverse
restores those captured records and tolerates a partially completed forward pass.

## Risk

The deployed application can read the legacy shapes during the short
deploy-before-migrate window. No table/index change is involved; PITR remains the
backstop.
