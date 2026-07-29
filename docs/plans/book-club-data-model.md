# Book Club meeting-module data model

## Product behavior

- Groups with Book Club enabled show the current book and clickable Book,
  Snack, and Library cards on the household page. The first two open their
  owner orders; Library opens the dedicated `/book-club` review page.
- Meetings expand directly in the household feed for attendance, progress,
  reminders, editing, and completion. Their Forum link opens the focused
  `/book-club/forum?meeting=<id>` discussion page.
- Index zero in each list is the current owner and the default for a new meeting.
  Neither list advances automatically. An admin selection moves that member to
  the front while preserving everyone else's relative order.
- A one-time alignment rotates the Book list onto the Snack list's relative
  cycle while preserving the current Book owner. The lists remain independent
  after that correction.
- Meeting creation and editing use three-row vertical owner wheels that show
  the previous, selected, and next members and loop through the stored order.
- An admin creates, edits, and manually completes one open meeting at a time.
  The first date defaults to the next Wednesday at 7:30 PM Eastern; later dates
  default to two local calendar weeks after the prior meeting.
- An active book may span meetings and is completed separately. Each member can
  review a completed book with a 1–5 star rating, required finished/not-finished
  status, and optional note. Legacy star-only ratings remain visible with
  unknown finish status until their author updates them.
- Members may update their own attendance and reading progress until the
  meeting is completed, even after its scheduled time.
- Every meeting has a forum with titled root topics and one reply level.
  Authors may edit or remove their entries, group admins may remove any entry,
  and completion makes the entire forum read-only.

## DynamoDB records

The existing `RoommateStatus-{dev,main}-book-club` table remains keyed by
`groupId + id`, with `BookIdIndex` on `bookId + id`.

- `config#book-club`: `openMeetingId`, `lastMeetingAt`, optional `activeBookId`,
  and the two ordered owner-ID lists.
- `book#<uuid>`: title, author, current Book owner snapshot, active/completed
  status, and lifecycle timestamps.
- `meeting#<uuid>`: scheduled time, book and owner snapshots, reading target,
  scheduled/completed status, and creator/completer snapshots.
- `meeting-member#<meetingUuid>#<userId>`: one member-owned attendance/progress
  response.
- `rating#<bookUuid>#<userId>`: member review with rating, finish status,
  optional note, member snapshot, and lifecycle timestamps. The established ID
  prefix remains because existing star ratings are upgraded in place.
- `forum#<meetingUuid>#<timestamp>#<uuid>`: meeting-scoped topic or reply.
  Replies include `parentPostId`; topics include `title` and
  `lastActivityAt`. Removed entries keep attribution/timestamps but omit their
  title and body.

All timestamps are server-generated epoch milliseconds except an admin-selected
meeting time. Historical display names remain denormalized while authorization
uses stable member IDs.

## Feed and authorization

Meetings normalize as compact `type: "book-club"` feed modules and use
`/?module=book-club&item=<id>` deep links that expand the household feed card.
Forum notifications use `/book-club/forum?meeting=<id>&thread=<root-id>` so the
focused discussion page scrolls to the referenced topic. The type is
included only when the group has Book Club enabled. Meeting creation, edits,
completion, and book completion require a group admin; any current member can
send a reminder, update their own response, review a completed book, create a
forum topic, and reply before completion. New topics notify the group except
the author; replies notify thread participants except the author.

## Migration

`2026-07-22-01-book-club-meeting-modules` converts the former cursor-based
rotations and date-derived session IDs to sticky owner lists and stable meeting
IDs while preserving books, sessions, responses, ratings, and posts. No table
or index change is required. `2026-07-23-01-align-book-owner-order` aligns the
two relative owner cycles once without imposing an ongoing synchronization
rule. `2026-07-23-02-book-club-meeting-forums` moves legacy chapter posts to
the most likely meeting forum, keeps replies with their root topic, and embeds
the original rows for an idempotent reverse pass.
