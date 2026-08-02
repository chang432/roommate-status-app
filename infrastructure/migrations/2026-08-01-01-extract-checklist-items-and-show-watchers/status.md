# Migration: 2026-08-01-01-extract-checklist-items-and-show-watchers

> **Documentation only.** Applied state is recorded in each environment's
> `RoommateStatus-{dev,main}-migrations` table.

## What it changes

Moves each checklist's embedded `items` list into `checklist-item#...` rows in
the existing `-checklists-v2` table, and each show's embedded `members` list
into `show-watcher#...` rows in the existing `-shows-v2` table. Parent records
gain their respective `itemsStorage` / `membersStorage` marker set to `rows`.

## Forward and reverse

Forward writes deterministic child keys, then conditionally switches the parent
only when its embedded list still matches the scanned source. A retry rewrites
children from the newest legacy list before attempting the switch again, making
the pass safe beside the deployed app during the deploy-before-migrate window.
Reverse rebuilds each migrated parent from its current child rows, removes the
storage marker, and deletes those child rows. Child rows written before a failed
parent switch carry a migration marker and are also cleaned up.

## Risk

No CloudFormation key/index change is required: the existing `(groupId, id)`
keys address both parents and deterministic children. The deployed app accepts
embedded rows until their parent is switched, then reads child rows. The row
split prevents concurrent updates to different checklist items or watchers from
overwriting each other.
