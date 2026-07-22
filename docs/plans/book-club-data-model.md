# Book Club data model

## Goal

Give each group a Book Club summary that shows the next meeting, its reading
target, the active book and its recommender, and the snack-duty member. The
model must also support a completed-book history, one rating per member per
book, and discussions separated by chapter without redesigning the data later.

## Decisions

- Meetings occur every two weeks on Wednesday at 7:30 PM in
  `America/New_York`.
- Group admins manage the Book Club configuration, sessions, books, and
  assignments. Other group members have read-only access at first.
- Snack duty and book recommendations use separate, admin-configured ordered
  member rotations.
- A book may span multiple sessions. A session's reading target is free text,
  such as `Read through Chapter 8`.
- A completed book can receive one editable integer rating from 1 through 5
  from each group member.
- Discussion is a flat chronological set of posts within a selected chapter;
  it does not add threaded replies in the initial design.

## DynamoDB table

Add a dedicated group-partitioned table named
`RoommateStatus-{dev,main}-book-club`.

| Key or index | Fields | Purpose |
| --- | --- | --- |
| Primary key | `groupId (S)` + `id (S)` | Isolates all Book Club records to one group. |
| `BookIdIndex` GSI | `bookId (S)` + `id (S)` | Retrieves a book's ratings and chapter discussion without scanning the group. |

The new table follows the existing on-demand, encrypted, point-in-time
recovery, retained-table settings used by the other group-partitioned tables.
Items without a `bookId` (the configuration item and sessions) are not present
in `BookIdIndex`.

### Item shapes

All timestamps are server-generated epoch milliseconds. IDs after the type
prefix are UUIDs unless a format is specified below.

#### `config#book-club`

Exactly one per group. This is the authoritative quick lookup for the Book
Club card and for advancing rotations.

```json
{
  "groupId": "yorkshire",
  "id": "config#book-club",
  "timezone": "America/New_York",
  "frequency": "biweekly",
  "weekday": "wednesday",
  "localTime": "19:30",
  "nextSessionAt": 1784763000000,
  "nextSessionId": "session#2026-07-22T23:30:00.000Z",
  "activeBookId": "book-uuid",
  "snackRotationUserIds": ["andre", "sam", "riley"],
  "snackRotationCursor": 1,
  "bookRotationUserIds": ["riley", "andre", "sam"],
  "bookRotationCursor": 2,
  "createdAt": 1783553400000,
  "updatedAt": 1783553400000
}
```

`nextSessionAt` is recalculated in the configured IANA timezone, so daylight
saving transitions preserve a 7:30 PM local meeting time. The cursor points to
the rotation entry assigned to the next newly created session or book. An admin
may edit either rotation to skip unavailable or departed members.

#### `book#<bookId>`

One record per selected book. Its `id` prefix permits a group-local history
query with `begins_with(id, "book#")`; related ratings and posts deliberately
use different prefixes so they are not returned as books.

```json
{
  "groupId": "yorkshire",
  "id": "book#book-uuid",
  "bookId": "book-uuid",
  "title": "The Left Hand of Darkness",
  "author": "Ursula K. Le Guin",
  "recommendedById": "riley",
  "recommendedByName": "Riley",
  "status": "active",
  "selectedAt": 1783553400000,
  "completedAt": null,
  "createdAt": 1783553400000,
  "updatedAt": 1783553400000
}
```

`status` is `active` while the club is reading the book and `completed` after
its final session. `completedAt` is absent until completion rather than stored
as DynamoDB `NULL`. The display name is denormalized as a historical snapshot;
authorization and rotation use the stable user ID.

#### `session#<UTC ISO timestamp>`

One scheduled meeting. The timestamp format makes sessions naturally sort in
meeting order within the group.

```json
{
  "groupId": "yorkshire",
  "id": "session#2026-07-22T23:30:00.000Z",
  "scheduledAt": 1784763000000,
  "bookId": "book-uuid",
  "bookTitle": "The Left Hand of Darkness",
  "readingTarget": "Read through Chapter 8",
  "snackDutyUserId": "sam",
  "snackDutyName": "Sam",
  "status": "scheduled",
  "completedAt": null,
  "createdAt": 1783553400000,
  "updatedAt": 1783553400000
}
```

The title and snack-duty name are display snapshots. `status` is `scheduled`,
`completed`, or `cancelled`. Session completion creates the following scheduled
session, moves the snack cursor exactly once, and updates the configuration's
next-session fields atomically. Completing the book additionally marks the
book complete, clears `activeBookId`, and advances the book-recommender cursor
once; selecting the next book uses that recommender.

#### `rating#<bookId>#<userId>`

One per book and member. The deterministic ID prevents duplicate ratings and
allows an owner to replace their previous rating.

```json
{
  "groupId": "yorkshire",
  "id": "rating#book-uuid#andre",
  "bookId": "book-uuid",
  "userId": "andre",
  "userName": "Andre",
  "rating": 5,
  "createdAt": 1789000000000,
  "updatedAt": 1789000000000
}
```

The completed-books endpoint computes the average and count from these items
until a proven need for a cached aggregate arises. Ratings are only allowed for
completed books.

#### `post#<bookId>#<chapterKey>#<timestamp>#<postId>`

One chapter-scoped discussion post. `chapterKey` is a normalized sortable value
such as `008` or `part-02-chapter-01`; `chapterLabel` retains the member-facing
text such as `Chapter 8`.

```json
{
  "groupId": "yorkshire",
  "id": "post#book-uuid#008#1789000000000#post-uuid",
  "bookId": "book-uuid",
  "chapterKey": "008",
  "chapterLabel": "Chapter 8",
  "authorId": "andre",
  "authorName": "Andre",
  "body": "The ending of this chapter changed how I read the opening.",
  "createdAt": 1789000000000,
  "updatedAt": 1789000000000
}
```

`BookIdIndex` queries all discussion for a book; filtering on `chapterKey`
produces a chapter view. A later reply feature can add an optional
`parentPostId` without changing the key design.

## Read and write contracts

The initial Book Club card should call one summary endpoint that returns the
configuration's next-session data together with the active book. It displays:

- the local next-meeting date and time;
- active book title and author;
- `recommendedByName` from the active book;
- `readingTarget` and `snackDutyName` from the next session.

Admin-only commands create or edit the configuration, rotations, active book,
and next session; complete/cancel a session; and complete a book. All commands
verify group membership and use stable user IDs for assignments. Member-facing
future endpoints list completed books, create or replace a personal rating,
list posts for a book/chapter, and create/edit/delete the caller's posts.

## Implementation notes

- Add the table and `BookIdIndex` to both DynamoDB CloudFormation templates,
  the local DynamoDB table creator, and the dev/prod `infrastructure/db_schema`
  CSVs and overviews when implementation begins.
- Build a Book Club Flask module that follows the existing group-table access
  and group-admin authorization patterns; do not add Book Club fields to the
  existing groups record.
- Add Book Club API client methods and load the summary with the active group
  in `StatusPage`; keep the component's empty state useful until an admin
  configures the club.
- This is a brand-new table with new optional records, so it needs no DynamoDB
  data migration. Existing groups simply receive no Book Club data until setup.

## Acceptance criteria

- A configured group’s Book Club card shows its next meeting in Eastern time,
  reading target, active book and recommender, and snack-duty member.
- A book can remain active across any number of sessions.
- Completing a session advances snack duty once; completing a book advances the
  recommender once, independently.
- Groups cannot read or mutate one another’s records; non-admin members cannot
  administer Book Club data.
- Completed books retain their recommender, sessions, individual ratings, and
  chapter-specific discussions.
