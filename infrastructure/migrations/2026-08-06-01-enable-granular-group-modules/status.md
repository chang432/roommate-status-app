# Migration: 2026-08-06-01-enable-granular-group-modules

> Documentation only. Applied state is recorded in each environment's
> `RoommateStatus-{dev,main}-migrations` table.

## What it changes

Replaces group-level `showRoster`, `showFeed`, and `showBookClub` flags with an
`enabledModules` list containing independently configurable UI module IDs.

## Forward and reverse

Forward maps each legacy flag to its corresponding modules, enables Spotify
because it was previously independent of all three flags, and removes the old
attributes. Rows already carrying `enabledModules` are skipped, making retries
and partial runs safe. Reverse restores the closest representable legacy flags
from the granular list and removes it; partial reversals are safe to repeat.

## Risk

Low row volume is expected: one item per group. The deployed application reads
the legacy flags when `enabledModules` is absent, so the deploy-before-migrate
window preserves current visibility. Reversal necessarily collapses partial
module selections back to the old coarse feed/Book Club booleans.
