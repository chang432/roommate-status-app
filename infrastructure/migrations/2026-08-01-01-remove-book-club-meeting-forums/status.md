# Migration: 2026-08-01-01-remove-book-club-meeting-forums

> Documentation only. Applied state is recorded in each environment's
> `RoommateStatus-{dev,main}-migrations` table.

## What it changes

Removes the legacy `forum#...` rows that attached threaded discussions to Book
Club meetings. Standalone `book-forum#...` modules are new records and are not
created from the old discussions.

## Forward and reverse

The forward pass first writes a deterministic migration-only backup row holding
the complete source item, then deletes the live forum row. A retry completes any
backup/delete pair interrupted between those operations. The reverse restores
missing source rows without overwriting an existing row and removes each backup,
so it also tolerates partial execution.

## Risk

The deployed application no longer reads or writes the old prefix before this
migration runs. Backups remain outside every application query shape and exist
only to make rollback safe. No table or index changes are required.
