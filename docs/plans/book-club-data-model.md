# Book Club meeting-module data model

## Product behavior

- Groups with Book Club enabled show a two-by-two Current Book, Library,
  Book, and Snack card grid on the household page. Current Book opens its
  detail, Library opens the complete catalog, and the owner cards open their
  respective orders.
- Meetings expand directly in the household feed for collapsible attendance and
  discussion, reminders, editing, and completion. Their View book link opens
  the complete book detail inside the household library modal.
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
- Only admins add books. Adding a title makes it current and atomically
  completes the former current title; it is blocked while a meeting is open.
  When no title is current, an admin can restore a completed title from its
  edit form. This atomically clears its completion date and makes it current.
  Meetings always use the configured current title. Catalog corrections
  propagate to every meeting snapshot for that book.
- `activeBookId` is the only book lifecycle state. A title it references is
  current; every other catalog title is completed. Completing the current book
  requires its open meeting to be completed first, then timestamps the book and
  clears the pointer. Each member can review any book with a 1–5 star rating, required finished/not-finished
  status, and optional note. Legacy star-only ratings remain visible with
  unknown finish status until their author updates them.
- Members may update their own attendance until the meeting is completed, even
  after its scheduled time.
- Every meeting has a threaded message discussion with one reply level.
  Authors may edit or remove their entries, group admins may remove any entry,
  and completion makes the entire forum read-only.

## DynamoDB records

The existing `RoommateStatus-{dev,main}-book-club` table remains keyed by
`groupId + id`, with `BookIdIndex` on `bookId + id`.

- `config#book-club`: `openMeetingId`, `lastMeetingAt`, optional `activeBookId`,
  and the two ordered owner-ID lists.
- `book#<uuid>`: title, author, current Book owner snapshot, and optional
  `completedAt`. It has no status field: current status is derived by comparing
  its `bookId` with `config#book-club.activeBookId`.
- `meeting#<uuid>`: scheduled time, book and owner snapshots, reading target,
  scheduled/completed status, and creator/completer snapshots.
- `meeting-member#<meetingUuid>#<userId>`: one member-owned attendance
  response. Missing attendance is projected as pending.
- `rating#<bookUuid>#<userId>`: member review with rating, finish status,
  optional note, member snapshot, and lifecycle timestamps. The established ID
  prefix remains because existing star ratings are upgraded in place.
- `forum#<meetingUuid>#<timestamp>#<uuid>`: meeting-scoped message or reply.
  Replies include `parentPostId`; root messages are body-only and all entries
  include `lastActivityAt`. Removed entries keep attribution/timestamps but
  omit their body.

All timestamps are server-generated epoch milliseconds except an admin-selected
meeting time. Historical display names remain denormalized while authorization
uses stable member IDs.

## Feed and authorization

Meetings normalize as compact `type: "book-club"` feed modules and use
`/?module=book-club&item=<id>` deep links that expand the household feed card.
Forum notifications use
`/?book=<book-id>&meeting=<meeting-id>&thread=<root-id>` so the household
library modal opens the referenced topic. The type is
included only when the group has Book Club enabled. Book addition, meeting creation, edits,
completion, and book completion require a group admin; any current member can
send a reminder, update their own response, review an active or completed book, create a
forum message, and reply before completion. New messages notify the group except
the author; replies notify thread participants except the author.

## Migration

`2026-07-31-01-remove-book-club-forum-titles` removes legacy root-message
titles after preserving them in reversible migration markers.
`2026-07-29-01-derive-book-completion` removes legacy book `status` fields,
preserving known historical completion dates and clearing an invalid completion
date from the configured current title.
`2026-07-29-02-remove-book-club-progress` removes obsolete per-member chapter
and completion fields while retaining reversible legacy records.
`2026-07-22-01-book-club-meeting-modules` converts the former cursor-based
rotations and date-derived session IDs to sticky owner lists and stable meeting
IDs while preserving books, sessions, responses, ratings, and posts. No table
or index change is required. `2026-07-23-01-align-book-owner-order` aligns the
two relative owner cycles once without imposing an ongoing synchronization
rule. `2026-07-23-02-book-club-meeting-forums` moves legacy chapter posts to
the most likely meeting forum, keeps replies with their root topic, and embeds
the original rows for an idempotent reverse pass.
