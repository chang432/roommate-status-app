# Migration: 2026-07-29-02-remove-book-club-progress

> **Documentation only.** Whether this migration has run is recorded in the
> `RoommateStatus-{dev,main}-migrations` DynamoDB table.

## What it changes

Removes `chaptersReadThrough` and `readingComplete` from Book Club
`meeting-member#...` responses. Attendance remains the response's only
member-owned meeting state.

## Forward and reverse

The forward pass captures only the removed fields in
`attendanceOnlyLegacyRecord`, then removes the live progress attributes.
Conditional markers make retries and interrupted scans safe. Reversal restores
captured values only when no later value occupies that field, removes the
marker, and tolerates a partially applied pass.

## Risk

The deployed application ignores legacy progress fields and projects missing
ones nowhere, so rows can be converted independently. Attendance writes made
before or after the migration update the response in place, preserving both
not-yet-migrated fields and reversal metadata. No table or index changes are
required; point-in-time recovery remains the backstop.
