# DynamoDB Schema — `main` (production) deployment

Table schema for the **production** deployment (CloudFormation stack
`roomie-dynamodb-main`, template [`dynamodb-table-main.yaml`](./dynamodb-table-main.yaml)).
The dev counterpart is documented in [`dynamodb-schema-dev.md`](./dynamodb-schema-dev.md);
the two are identical apart from the `-main` / `-dev` table-name prefix.

> DynamoDB is schemaless — only the **keys** are fixed by CloudFormation. The
> attributes below are the ones the Flask backend (`docker/flask/`) actually
> writes, so treat them as the effective schema. Types use DynamoDB notation:
> `S` string, `N` number, `BOOL` boolean, `SS` string set, `L` list, `M` map,
> `NULL` null.

## Tables at a glance

| Table | Partition key | Index | Written by | Purpose |
|---|---|---|---|---|
| `RoommateStatus-main` | `id` (S) | — | `db.py` | Accounts / roommate status |
| `RoommateStatus-main-pushsubs` | `id` (S) | — | `push.py` | Web Push subscriptions |
| `RoommateStatus-main-activities` | `id` (S) | — | `activities.py`, `household_checklists.py`, `household_requests.py` | Activities, checklists, requests + their comment likes (multi-type) |
| `RoommateStatus-main-shows` | `id` (S) | — | `household_shows.py` | TV show tracker |
| `RoommateStatus-main-groups` | `groupId` (S) | `JoinCodeIndex` (HASH `joinCode`) | `groups.py` | Households / join-by-code groups |

**Common settings** (every table, from the CloudFormation template): on-demand
capacity (`PAY_PER_REQUEST`), encryption at rest with an AWS-owned key,
point-in-time recovery enabled, and `DeletionPolicy: Retain` so the data
survives a stack delete.

---

## `RoommateStatus-main` — accounts & roommate status

One item per user account. `id` is the normalized (lowercase) username. Grouped
users belong to a household via `groupId`; a freshly-created account has
`groupId: null` until it joins one.

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** Normalized username, e.g. `sheryl`. |
| `username` | S | Login handle; lowercase, matches `^[a-z0-9][a-z0-9_-]{2,31}$`. |
| `name` | S | Display name, e.g. `Sheryl`. |
| `passwordHash` | S | Werkzeug password hash. Never leaves the backend. |
| `groupId` | S \| NULL | Household id (e.g. `yorkshire`) or `null` when not yet in a group. |
| `status` | S | One of `available`, `busy`, `sleeping`, `ooh` (out of house). |
| `statusText` | S | Optional free-text note shown with the status. |
| `statusUpdatedAt` | N | Epoch millis of the last status change (absent until first update). |

**Example rows**

```json
{
  "id": "sheryl",
  "username": "sheryl",
  "name": "Sheryl",
  "passwordHash": "scrypt:32768:8:1$Zt9…$b1c4…",
  "groupId": "yorkshire",
  "status": "available",
  "statusText": "in the kitchen",
  "statusUpdatedAt": 1720200000000
}
```

```json
{
  "id": "wanda",
  "username": "wanda",
  "name": "Wanda",
  "passwordHash": "scrypt:32768:8:1$Aa1…$77de…",
  "groupId": null,
  "status": "busy",
  "statusText": ""
}
```

---

## `RoommateStatus-main-pushsubs` — Web Push subscriptions

One item per browser/device subscription, kept out of the roommate table so the
household scan stays clean. Keyed by a hash of the push endpoint (so re-saving
the same device is idempotent).

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** `sha256(endpoint)` hex digest. |
| `endpoint` | S | The push service endpoint URL. |
| `userId` | S | Owning account `id`, used to target/exclude recipients. |
| `subscription` | S | The full PushSubscription JSON, stored verbatim as a string. |

**Example row**

```json
{
  "id": "9f2c8b1a…e1",
  "endpoint": "https://web.push.apple.com/QFx…",
  "userId": "sheryl",
  "subscription": "{\"endpoint\":\"https://web.push.apple.com/QFx…\",\"keys\":{\"p256dh\":\"BOr…\",\"auth\":\"k9d…\"}}"
}
```

---

## `RoommateStatus-main-activities` — activities, checklists & requests

A **multi-type** table: several coordination features share it, discriminated by
an `itemType` attribute (an *activity* is the one type that has **no** `itemType`).
Every content item carries a `groupId` so feeds stay isolated per household.

| `itemType` | Meaning |
|---|---|
| *(absent)* | Proposed activity |
| `commentLike` | A like on an activity comment (separate item) |
| `checklist` | Household checklist |
| `request` | Household request |
| `requestCommentLike` | A like on a request comment (separate item) |

### Activity — no `itemType`

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** uuid4 hex. |
| `groupId` | S | Owning household. |
| `text` | S | The proposal text. |
| `proposedBy` / `proposedById` | S | Creator display name / account id. |
| `createdAt` | N | Epoch millis. |
| `members` | SS | Display names of everyone who joined. |
| `memberIds` | SS | Account ids of everyone who joined. |
| `startAt` / `endAt` | N | Optional schedule (epoch millis). |
| `liveStartedAt` | N | Set while an activity is live. |
| `comments` | L of M | Ordered comments; each `{ id, author, authorId, text, createdAt, mentions[], mentionsAll }`. |

```json
{
  "id": "3f9a1c2b8d…",
  "groupId": "yorkshire",
  "text": "Movie night in the lounge 🍿",
  "proposedBy": "Sheryl",
  "proposedById": "sheryl",
  "createdAt": 1720200000000,
  "members": ["Sheryl", "Andre"],
  "memberIds": ["sheryl", "andre"],
  "startAt": 1720230000000,
  "endAt": 1720237200000,
  "comments": [
    {
      "id": "7d2e5f…",
      "author": "Andre",
      "authorId": "andre",
      "text": "I'm in!",
      "createdAt": 1720201000000,
      "mentions": [],
      "mentionsAll": false
    }
  ]
}
```

### Checklist — `itemType: "checklist"`

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** uuid4 hex. |
| `itemType` | S | `checklist`. |
| `title` | S | Checklist title. |
| `createdBy` / `createdById` | S | Creator display name / account id. |
| `groupId` | S | Owning household. |
| `createdAt` | N | Epoch millis. |
| `items` | L of M | Each `{ id, text, checkedByIds[], checkedNamesById{} }`. |
| `isArchived` | BOOL | Hidden from the active feed when `true`. |

```json
{
  "id": "a1b2c3d4…",
  "itemType": "checklist",
  "title": "Weekend chores",
  "createdBy": "Andre",
  "createdById": "andre",
  "groupId": "yorkshire",
  "createdAt": 1720200000000,
  "items": [
    { "id": "c1…", "text": "Take out trash", "checkedByIds": ["sheryl"], "checkedNamesById": { "sheryl": "Sheryl" } },
    { "id": "c2…", "text": "Vacuum lounge", "checkedByIds": [], "checkedNamesById": {} }
  ],
  "isArchived": false
}
```

### Request — `itemType: "request"`

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** uuid4 hex. |
| `itemType` | S | `request`. |
| `text` | S | What's being asked. |
| `requester` / `requesterId` | S | Requester display name / account id. |
| `groupId` | S | Owning household. |
| `createdAt` | N | Epoch millis. |
| `requestedIds` | SS | Account ids the request targets. |
| `requestedNamesById` | M | `id → display name` for the targets. |
| `responses` | M | `id → response` (e.g. `yes` / `no` / `maybe`). |
| `isCompleted` | BOOL | Marks the request done. |

```json
{
  "id": "d4e5f6a7…",
  "itemType": "request",
  "text": "Can someone grab oat milk?",
  "requester": "Sheryl",
  "requesterId": "sheryl",
  "groupId": "yorkshire",
  "createdAt": 1720200000000,
  "requestedIds": ["andre", "kayla"],
  "requestedNamesById": { "andre": "Andre", "kayla": "Kayla" },
  "responses": { "andre": "yes" },
  "isCompleted": false
}
```

### Comment likes — `itemType: "commentLike"` / `"requestCommentLike"`

Likes on activity/request comments are stored as their own small items (so a like
is a single conditional write) rather than embedded in the parent.

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** Deterministic `parentId:commentId:userId`. |
| `itemType` | S | `commentLike` or `requestCommentLike`. |
| `activityId` / `requestId` | S | Parent item id. |
| `commentId` | S | Liked comment id. |
| `groupId` | S | Owning household. |
| `userId` | S | Who liked it. |

```json
{
  "id": "3f9a1c2b8d…:7d2e5f…:andre",
  "itemType": "commentLike",
  "activityId": "3f9a1c2b8d…",
  "commentId": "7d2e5f…",
  "groupId": "yorkshire",
  "userId": "andre"
}
```

---

## `RoommateStatus-main-shows` — TV show tracker

One item per tracked show, with watchers embedded. Scoped per household by
`groupId`.

| Attribute | Type | Notes |
|---|---|---|
| `id` | S | **Partition key.** uuid4 hex. |
| `title` | S | Show title. |
| `createdBy` / `createdById` | S | Creator display name / account id. |
| `groupId` | S | Owning household. |
| `createdAt` | N | Epoch millis. |
| `completedAt` | N | Epoch millis when completed. **Absent while active** (its absence is what "active" means). |
| `members` | L of M | Watchers; each `{ id, name, season, episode }` (season & episode are 1-based). |

**Example rows**

```json
{
  "id": "5670fa3c1e…",
  "title": "Severance",
  "createdBy": "Sheryl",
  "createdById": "sheryl",
  "groupId": "yorkshire",
  "createdAt": 1720200000000,
  "members": [
    { "id": "sheryl", "name": "Sheryl", "season": 2, "episode": 5 },
    { "id": "andre", "name": "Andre", "season": 1, "episode": 3 }
  ]
}
```

```json
{
  "id": "8c1d2e3f4a…",
  "title": "The Bear",
  "createdBy": "Andre",
  "createdById": "andre",
  "groupId": "yorkshire",
  "createdAt": 1720100000000,
  "completedAt": 1720300000000,
  "members": [
    { "id": "andre", "name": "Andre", "season": 3, "episode": 10 }
  ]
}
```

---

## `RoommateStatus-main-groups` — households / groups

One item per household. The `JoinCodeIndex` global secondary index (partition key
`joinCode`, `ProjectionType: ALL`) powers join-by-code lookups. The seeded
default group is `yorkshire` with join code `YORKSHIRE`.

| Attribute | Type | Notes |
|---|---|---|
| `groupId` | S | **Partition key.** Stable household id, e.g. `yorkshire`. |
| `joinCode` | S | **`JoinCodeIndex` key.** Normalized invite code, e.g. `YORKSHIRE`. |
| `name` | S | Household display name, e.g. `Yorkshire`. |
| `createdAt` | N | Epoch millis. |

**Example row**

```json
{
  "groupId": "yorkshire",
  "name": "Yorkshire",
  "joinCode": "YORKSHIRE",
  "createdAt": 1720200000000
}
```
