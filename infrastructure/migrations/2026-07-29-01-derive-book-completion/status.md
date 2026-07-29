# Migration: 2026-07-29-01-derive-book-completion

> **Documentation only.** Whether this migration has run is recorded in the
> `RoommateStatus-{dev,main}-migrations` DynamoDB table.

## What it changes

Removes `status` from every Book Club `book#...` record. The configured current
book has no `completedAt`; every non-current book is consequently completed by
the application's derived lifecycle. Existing historical `completedAt` values
are left unchanged.

## Forward and reverse

The forward pass captures only each book's removed fields in
`bookCompletionDerivedLegacyRecord`, then removes `status` and clears
`completedAt` only from the configured current title. The marker makes retries
safe after a partial run. Reversal restores the captured `status` and an absent
legacy completion date, while preserving a completion date written later by the
deployed application.

## Risk

The deployed application reads no book `status`, so rows can be converted one
at a time. A current title's corrupt legacy completion date is cleared only
when it was current during the migration scan; point-in-time recovery remains
the backstop.
