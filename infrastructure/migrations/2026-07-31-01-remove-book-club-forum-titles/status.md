# Migration: 2026-07-31-01-remove-book-club-forum-titles

> **Documentation only.** Whether this migration has run is recorded in the
> `RoommateStatus-{dev,main}-migrations` DynamoDB table.

## What it changes

Removes `title` from existing root Book Club forum messages. Messages keep
their author, body, timestamps, and reply relationships; replies were already
body-only.

## Forward and reverse

The forward pass stores each removed title in
`forumTitleRemovedLegacyRecord` before removing the live field. Conditional
writes make the scan idempotent and safe to resume. The reverse restores a
captured title only when no later title exists, then removes the marker.

## Risk

The deployed app accepts body-only messages before this migration runs and can
still project legacy titles during the deploy-before-migrate window. No table
or index changes are required.
