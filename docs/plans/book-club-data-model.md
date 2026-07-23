# Book Club meeting-module data model

## Product behavior

- Groups with Book Club enabled show Book and Snack owner lists above the feed.
  The cards display the open meeting's assigned owners; list heads are the
  defaults when no active assignment is available.
- The current-book card appears above those owner trackers. An open meeting
  exposes its full editor as an explicit admin action alongside reminder and
  completion actions.
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
- An active book may span meetings and is completed separately. Completed books
  retain ratings and chapter discussion.
- Members may update their own attendance and reading progress until the
  meeting is completed, even after its scheduled time.

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
- Ratings and chapter posts retain their existing book-scoped shapes.

All timestamps are server-generated epoch milliseconds except an admin-selected
meeting time. Historical display names remain denormalized while authorization
uses stable member IDs.

## Feed and authorization

Meetings normalize as `type: "book-club"` feed modules and use
`/?module=book-club&item=<id>` deep links. The type is included only when the
group has Book Club enabled. Meeting creation, edits, completion, and book
completion require a group admin; any current member can send a reminder,
update their own response, rate a completed book, and post discussion.

## Migration

`2026-07-22-01-book-club-meeting-modules` converts the former cursor-based
rotations and date-derived session IDs to sticky owner lists and stable meeting
IDs while preserving books, sessions, responses, ratings, and posts. No table
or index change is required. `2026-07-23-01-align-book-owner-order` aligns the
two relative owner cycles once without imposing an ongoing synchronization
rule.
