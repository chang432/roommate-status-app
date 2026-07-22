# Book Club data model

## Goal

Give each group a Book Club summary that shows the next meeting, its reading
target, the active book and its recommender, and the snack-duty member. The
model must also support a completed-book history, one rating per member per
book, chapter-separated discussions, and each member's attendance and reading
progress for an upcoming session without redesigning the data later.

## Decisions

- Meetings occur every two weeks on Wednesday at 7:30 PM in
  `America/New_York`.
- Group admins manage the Book Club configuration, sessions, books, and
  assignments. Other group members have read-only access at first.
- Snack duty and book recommendations use separate, admin-configured ordered
  member rotations.
- A book may span multiple sessions. A session's reading target is free text,
  such as `Read through Chapter 8`.
- For each upcoming session, every member can update their own attendance plan
  and the chapter number they have read through. A missing response means the
  member has not responded yet.
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
| `BookIdIndex` GSI | `bookId (S)` + `id (S)` | Retrieves a book's sessions, ratings, and chapter discussion without scanning the group. |

The new table follows the existing on-demand, encrypted, point-in-time
recovery, retained-table settings used by the other group-partitioned tables.
Items without a `bookId` (the configuration item and per-session member
responses) are not present in `BookIdIndex`. Session records do have `bookId`
and intentionally appear in the index as part of a book's history.

### Logical attribute schema

These are the attributes the application writes for each item type; DynamoDB
only declares the primary-key and index attributes in CloudFormation, while
the other attributes remain schemaless. `S`, `N`, and `L of S` mean string,
number, and a list of strings, respectively. Required attributes are always
present; optional attributes are absent when inapplicable.

| Item type / `id` pattern | Required attributes | Optional attributes |
| --- | --- | --- |
| Configuration `config#book-club` | `groupId (S)`, `id (S)`, `timezone (S)`, `frequency (S)`, `weekday (S)`, `localTime (S)`, `nextSessionAt (N)`, `nextSessionId (S)`, `snackRotationUserIds (L of S)`, `snackRotationCursor (N)`, `bookRotationUserIds (L of S)`, `bookRotationCursor (N)`, `createdAt (N)`, `updatedAt (N)` | `activeBookId (S)` |
| Book `book#<bookId>` | `groupId (S)`, `id (S)`, `bookId (S)`, `title (S)`, `author (S)`, `recommendedById (S)`, `recommendedByName (S)`, `status (S)`, `selectedAt (N)`, `createdAt (N)`, `updatedAt (N)` | `completedAt (N)` |
| Session `session#<UTC ISO timestamp>` | `groupId (S)`, `id (S)`, `scheduledAt (N)`, `bookId (S)`, `bookTitle (S)`, `snackDutyUserId (S)`, `snackDutyName (S)`, `status (S)`, `createdAt (N)`, `updatedAt (N)` | `readingTarget (S)`, `completedAt (N)` |
| Session member response `session-member#<UTC ISO timestamp>#<userId>` | `groupId (S)`, `id (S)`, `sessionId (S)`, `userId (S)`, `userName (S)`, `attendanceStatus (S)`, `chaptersReadThrough (N)`, `createdAt (N)`, `updatedAt (N)` | none |
| Rating `rating#<bookId>#<userId>` | `groupId (S)`, `id (S)`, `bookId (S)`, `userId (S)`, `userName (S)`, `rating (N)`, `createdAt (N)`, `updatedAt (N)` | none |
| Chapter post `post#<bookId>#<chapterKey>#<timestamp>#<postId>` | `groupId (S)`, `id (S)`, `bookId (S)`, `chapterKey (S)`, `chapterLabel (S)`, `authorId (S)`, `authorName (S)`, `body (S)`, `createdAt (N)`, `updatedAt (N)` | `parentPostId (S)` for a future reply feature |

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
`completed`, or `cancelled`. Once a scheduled meeting's timestamp passes, the
next summary read completes it, rotates snack duty once, and creates the next
biweekly session. That new session retains the active book and its recommender,
but intentionally omits `readingTarget` until an admin sets the new chapter
goal. Admins may still change the book, author, recommender, or snack duty for
the upcoming session.

#### `session-member#<UTC ISO timestamp>#<userId>`

One response per member and upcoming session. The deterministic ID means an
update replaces only that member's response rather than rewriting an embedded
list shared by the entire group. All responses for a session are read with an
`id` prefix query.

```json
{
  "groupId": "yorkshire",
  "id": "session-member#2026-07-22T23:30:00.000Z#andre",
  "sessionId": "session#2026-07-22T23:30:00.000Z",
  "userId": "andre",
  "userName": "Andre",
  "attendanceStatus": "attending",
  "chaptersReadThrough": 6,
  "createdAt": 1783553400000,
  "updatedAt": 1783553400000
}
```

`attendanceStatus` is exactly `attending`, `maybe`, or `not_attending`.
`chaptersReadThrough` is a non-negative integer, where `0` means none read.
Only the responding member can create or update their response, and only while
the session is scheduled and in the future. The group can see all responses;
admins do not edit another member's response. Deleting no response item is not
needed: the absence of an item communicates `not responded`.

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
- `Book: <title> by <author>`;
- next meeting, chapter goal, and snack duty as separate lines;
- an admin editor that chooses the recommender from the current member list.
- each member's attendance plan and chapters-read-through value, with an
  explicit `not responded` state when their response item is absent.

Admin-only commands create or edit the configuration, rotations, and next
session. All commands
verify group membership and use stable user IDs for assignments. Any group
member may create or replace only their own upcoming-session response. Other
member-facing endpoints list completed books, create or replace a personal
rating, list posts for a book/chapter, and create/edit/delete the caller's
posts.

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
- Each group member can independently record `attending`, `maybe`, or
  `not_attending` plus a non-negative chapter count for a scheduled future
  session; missing responses display as `not responded`.
- Groups cannot read or mutate one another’s records; non-admin members cannot
  administer Book Club data, but they can update their own session response.
- Completed books retain their recommender, sessions, individual ratings, and
  chapter-specific discussions.
