# Book Club and forum data model

## Product behavior

- Groups with Book Club enabled show a two-by-two Current Book, Library,
  Book, and Snack card grid on the household page. Current Book opens its
  detail, Library opens the complete catalog, and the owner cards open their
  respective orders.
- Meetings expand directly in the household feed for always-visible attendance,
  reminders, editing, and completion. Their linked book tag opens
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
  unknown finish status until their author updates them. Books may also carry
  up to ten reusable household tags; any current member may correct these tags
  alongside the rest of the catalog metadata.
- Members may update their own attendance until the meeting is completed, even
  after its scheduled time.
- Book Club households also have a separate Forums feed category. Any member
  can create a forum with a title and required library-book tag. Its flat
  comments support mentions and likes like event and request comments. The
  creator may edit its title and linked book; any member may archive, restore,
  or delete it.

## DynamoDB records

The existing `RoommateStatus-{dev,main}-book-club` table remains keyed by
`groupId + id`, with `BookIdIndex` on `bookId + id`.

- `config#book-club`: `openMeetingId`, `lastMeetingAt`, optional `activeBookId`,
  and the two ordered owner-ID lists.
- `book#<uuid>`: title, author, current Book owner snapshot, optional custom
  tag list, and optional `completedAt`. It has no status field: current status is derived by comparing
  its `bookId` with `config#book-club.activeBookId`.
- `meeting#<uuid>`: scheduled time, book and owner snapshots, reading target,
  scheduled/completed status, and creator/completer snapshots.
- `meeting-member#<meetingUuid>#<userId>`: one member-owned attendance
  response. Missing attendance is projected as pending.
- `rating#<bookUuid>#<userId>`: member review with rating, finish status,
  optional note, member snapshot, and lifecycle timestamps. The established ID
  prefix remains because existing star ratings are upgraded in place.
- `book-forum#<uuid>`: standalone forum title, required `bookId`, creator
  snapshot, archive state, version, timestamps, and an embedded list of up to
  100 flat comments.
- `migration-backup#remove-meeting-forums#<digest>`: reversible copy of a
  deleted legacy meeting-forum record, written only by the removal migration.

All timestamps are server-generated epoch milliseconds except an admin-selected
meeting time. Historical display names remain denormalized while authorization
uses stable member IDs.

## Feed and authorization

Meetings normalize as compact `type: "book-club"` feed modules and use
`/?module=book-club&item=<id>` deep links that expand the household feed card.
Forums normalize as `type: "forums"` feed modules and use
`/?module=forums&item=<id>` deep links. Their required book tag links to
`/?book=<book-id>`. The type is included only when the group has Book Club
enabled. Book addition, meeting creation,
completion, and book completion require a group admin; any current member can
correct an existing book's metadata and tags,
send a reminder, update their own response, review an active or completed book,
or create a forum. New forum comments notify the creator and prior commenters,
with mention and `@all` recipients deduplicated.

## Migration

`2026-08-01-01-remove-book-club-meeting-forums` removes legacy meeting-scoped
discussion records after preserving each full row in a reversible backup item.
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
