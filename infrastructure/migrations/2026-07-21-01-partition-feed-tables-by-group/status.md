# Migration: 2026-07-21-01-partition-feed-tables-by-group

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
Copies every row from the five feed tables into new twins keyed
`(groupId HASH, id RANGE)` instead of `(id HASH)`:

| from | to |
| --- | --- |
| `RoommateStatus-{env}-activities` | `RoommateStatus-{env}-activities-v2` |
| `RoommateStatus-{env}-requests` | `RoommateStatus-{env}-requests-v2` |
| `RoommateStatus-{env}-checklists` | `RoommateStatus-{env}-checklists-v2` |
| `RoommateStatus-{env}-shows` | `RoommateStatus-{env}-shows-v2` |
| `RoommateStatus-{env}-comment-likes` | `RoommateStatus-{env}-comment-likes-v2` |

Item shape is otherwise unchanged. Two things are folded in:

* Rows with no `groupId` are assigned the seeded default group (`yorkshire`) —
  `groupId` is now half the primary key, so it can no longer be absent. This
  replaces `activities.backfill_default_group_records()` and its
  `household_shows` twin, which used to run on the first API request in every
  Flask worker process.
* Rows carrying `itemType` are **not** copied. Those are pre-split coordination
  records that the 2026-07-11-0{1,2,3,4} migrations already relocated; the count
  is printed, and since the source tables are never modified here, anything
  unexpected stays where it is.

## Why
Every feed read is "give me one group's rows", but the tables were keyed only by
`id`, so each read Scanned the whole table (across all households) and filtered
in Python — `GET /api/feed?type=all` fanned out to six such scans, at a 5-second
poll interval. Partitioning on `groupId` turns each into a Query over one
household's partition, and makes tenant isolation structural rather than a
filter someone can forget.

A global secondary index would have avoided new tables, but a GSI cannot serve a
strongly-consistent read, and the mutation routes re-read the feed immediately
after writing so the caller sees their own change. A base-table Query keeps that
guarantee; a key schema cannot be altered in place, hence new tables.

Schema docs: `infrastructure/db_schema/{dev,prod}/RoommateStatus-{dev,main}-*-v2.csv`
plus the updated `_overview.csv` in both folders.

## Forward (migrate.py)
Pages each source table with `scan` + `LastEvaluatedKey` and `put_item`s each row
into the destination. Idempotent and resumable: `put_item` is a blind upsert on
`(groupId, id)`, so re-running after a partial pass rewrites the same rows, and
the source is never mutated, so a crash leaves the old table fully authoritative.

## Reverse (revert.py)
Clears the five destination tables. Safe because the forward pass only copies —
the originals are untouched and still complete. Tolerates a partially-applied
state (deleting by full key is idempotent) and a destination table that does not
exist yet. Pair it with rolling the app back to the pre-partition code, which
reads the originals again; rows the new app wrote to a `-v2` table after the
migration exist only there and are dropped by the reversal.

## Risk / notes
Household-scale row counts (tens of rows per table), so it runs in well under a
second. The pipeline now provisions CloudFormation **before** redeploying the app
(`.github/workflows/on_merge_{dev,main}.yml`), so the `-v2` tables exist by the
time the new code goes live; between that deploy and this migration finishing,
feeds read the still-empty new tables and appear empty — the same brief window
the 2026-07-11 table splits accept. PITR is enabled on every table as the
backstop.

The superseded id-keyed tables are intentionally **left defined and Retained** in
the CloudFormation templates so this revert has somewhere to fall back to. Once
this migration is confirmed applied on both dev and prod, a follow-up change
should drop those five resources and their outputs.
