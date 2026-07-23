# Migration: 2026-07-23-01-align-book-owner-order

> **Documentation only.** Applied state is recorded in the environment's
> migrations table. Check it with
> `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes

For every `config#book-club` row, the Book owner order is rebuilt from the
Snack owner order and rotated so the current Book owner remains first. This
makes both lists follow the same relative cycle once without creating an
ongoing synchronization rule.

## Forward

The current Book owner comes from the open meeting, then the active book, then
the existing Book-order head. The migration conditionally saves the previous
and aligned lists in `bookOwnerOrderAlignmentLegacyRecord`, sets
`bookOwnerOrderAlignmentMigrated`, and writes the aligned order atomically.
The marker makes interrupted runs resumable and prevents later independent
admin edits from being realigned.

## Reverse

Rows carrying the marker have their original Book order restored only when the
current value is still the aligned value written by the migration. A later
admin edit is preserved. The migration-only metadata is then removed, and the
operation is safe to repeat after a partial run.

## Risk

Low: one small configuration row per Book Club group. Conditional writes avoid
overwriting concurrent meeting edits. The deployed application accepts both
the pre- and post-migration orders, and PITR remains the backstop.
