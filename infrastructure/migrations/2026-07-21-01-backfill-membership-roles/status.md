# Migration: 2026-07-21-01-backfill-membership-roles

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
`RoommateStatus-{dev,main}-memberships`: adds `role (S)` — `admin` or `member` —
to every row that lacks one, setting it to `admin`. Backfilled rows also carry a
`roleBackfilled (BOOL)` marker used only by the reversal.

## Why
Backs the group-admin permission model: admins can remove members and grant or
revoke admin, plain members cannot. See the `role` column in
`infrastructure/db_schema/{dev,prod}/RoommateStatus-*-memberships.csv`.

Existing groups never recorded a creator, so there is no reliable way to pick a
single admin after the fact. Promoting every current member preserves what each
household can do today; groups demote down to the roster they want from the UI.

## Forward (migrate.py)
Pages the memberships table with `scan` + `LastEvaluatedKey` and conditionally
sets `role = "admin"` on rows where the attribute is absent. Rows that already
have a role — from an interrupted earlier run, or written by the live app —
are skipped, so the pass is idempotent and resumable.

## Reverse (revert.py)
Removes `role` and `roleBackfilled` from rows still carrying the marker, so a
partially applied forward run reverts cleanly and roles set by the running app
are left alone. Re-running finds no markers and does nothing.

## Risk / notes
Low: one small table, one row per member per group, single-digit seconds. The
app is deployed before migrations run and reads a missing `role` as `member`
(`db._to_roommate`), so the window between deploy and backfill degrades to
"nobody is an admin" rather than erroring. PITR is the backstop.
