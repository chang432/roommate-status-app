# Roomie Status — Flask Backend

A small Flask server implementing the API the frontend calls. Data is stored in
DynamoDB (see `../../infrastructure/`); all datastore access is encapsulated in
`db.py` so the routes stay storage-agnostic.

## Endpoints

| Method & path                                                | Body                                       | Returns                                                 |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| `POST /api/login`                                            | `{ username, password }`                   | `{ user: { id, name, username, groupId, hasGroup } }`   |
| `POST /api/accounts`                                         | `{ username, name, password }`             | new no-group `{ user }`                                 |
| `DELETE /api/accounts/<id>`                                  | `{ password }`                             | `{ ok: true }` after password verification              |
| `POST /api/groups/join`                                      | `{ userId, code }`                         | `{ user, group }`                                       |
| `POST /api/groups`                                           | `{ userId, name }`                         | newly created `{ user, group }`                         |
| `GET  /api/groups`                                           | `?userId=<id>`                             | every selectable group                                  |
| `GET  /api/groups/current`                                   | `?userId=<id>`                             | selected group metadata, including `viewerIsAdmin`      |
| `PUT  /api/groups/display`                                   | `?userId=<id>` + `{ showRoster, showFeed }` | updated admin-managed group display settings             |
| `GET  /api/roommates`                                        | `?userId=<id>`                             | `[ { id, name, status, statusText, statusUpdatedAt } ]` |
| `PUT  /api/roommates/<id>/status`                            | `{ status, statusText }`                   | full updated household list                             |
| `POST /api/roommates/notify`                                 | `{ requesterId }`                          | `{ sent, pruned, failed }`                              |
| `POST /api/roommates/<id>/poke`                              | `{ requesterId }`                          | `{ sent, pruned, failed }`                              |
| `GET /api/feed`                                              | `?userId=<id>&type=<type>`                 | active module instances in chronological feed order     |
| `PATCH /api/modules/<type>/<id>`                             | `{ editorId, changes }`                    | normalized updated module                               |
| `GET /api/activities`                                        | `?userId=<id>`                             | active activity list                                    |
| `POST /api/activities`                                       | `{ text, proposedById, startAt?, endAt? }` | full updated activity list                              |
| `POST /api/activities/<id>/archive`                          | `{ requesterId }`                          | full updated activity list                              |
| `POST /api/activities/<id>/restore`                          | `{ requesterId }`                          | full updated activity list                              |
| `DELETE /api/activities/<id>`                                | `{ requesterId }`                          | full updated activity list                              |
| `POST /api/activities/<id>/start`                            | `{ requesterId }`                          | full updated activity list                              |
| `POST /api/activities/<id>/end`                              | `{ requesterId }`                          | full updated activity list                              |
| `PUT/DELETE /api/activities/<id>/comments/<commentId>/likes` | `{ userId }`                               | full updated activity list                              |
| `GET /api/requests`                                          | `?userId=<id>`                             | full request list                                       |
| `POST /api/requests`                                         | `{ text, requesterId, requestedIds }`      | full updated request list                               |
| `POST /api/requests/<id>/responses`                          | `{ userId, response }`                     | full updated request list                               |
| `POST /api/requests/<id>/archive`                            | `{ userId }`                               | full updated request list                               |
| `POST /api/requests/<id>/restore`                            | `{ userId }`                               | full updated request list                               |
| `DELETE /api/requests/<id>`                                  | `{ requesterId }`                          | full updated request list                               |
| `POST /api/requests/<id>/comments`                           | `{ authorId, text }`                       | full updated request list                               |
| `PUT/DELETE /api/requests/<id>/comments/<commentId>/likes`   | `{ userId }`                               | full updated request list                               |
| `GET /api/checklists`                                        | `?userId=<id>`                             | full active checklist list                              |
| `POST /api/checklists`                                       | `{ title, createdById, items }`            | full updated checklist list                             |
| `POST /api/checklists/<id>/notify`                           | `{ requesterId }`                          | `{ sent, pruned, failed }`                              |
| `POST /api/checklists/<id>/items`                            | `{ userId, text }`                         | full updated checklist list                             |
| `POST /api/checklists/<id>/items/<itemId>/toggle`            | `{ userId }`                               | full updated checklist list                             |
| `PATCH /api/checklists/<id>/items/<itemId>`                  | `{ userId, text }`                         | full updated checklist list                             |
| `DELETE /api/checklists/<id>/items/<itemId>`                 | `{ userId }`                               | full updated checklist list                             |
| `POST /api/checklists/<id>/archive`                          | `{ userId }`                               | full updated checklist list                             |
| `POST /api/checklists/<id>/restore`                          | `{ userId }`                               | full updated checklist list                             |
| `DELETE /api/checklists/<id>`                                | `{ userId }`                               | full updated checklist list                             |
| `GET /api/shows`                                             | `?userId=<id>`                             | full show list                                          |
| `POST /api/shows`                                            | `{ title, createdById }`                   | full updated show list                                  |
| `POST /api/shows/<id>/join`                                  | `{ userId }`                               | full updated show list                                  |
| `POST /api/shows/<id>/leave`                                 | `{ userId }`                               | full updated show list                                  |
| `PATCH /api/shows/<id>/watchers/<memberId>/<field>`          | `{ userId, delta }`                        | full updated show list                                  |
| `PUT /api/shows/<id>/watchers/<memberId>/<field>`            | `{ userId, value }`                        | full updated show list                                  |
| `POST /api/shows/<id>/archive`                               | `{ requesterId }`                          | full updated show list                                  |
| `POST /api/shows/<id>/restore`                               | `{ requesterId }`                          | full updated show list                                  |
| `DELETE /api/shows/<id>`                                     | `{ requesterId }`                          | full updated show list                                  |
| `POST /api/shows/<id>/watchparty/start`                      | `{ requesterId, season, episode }`         | full updated show list                                  |
| `POST /api/shows/<id>/watchparty/end`                        | `{ requesterId }`                          | full updated show list                                  |
| `GET /api/jam`                                               | `?userId=<id>`                             | active Spotify Jam or `null`                            |
| `POST /api/jam`                                              | `{ hostId, link }`                         | active Spotify Jam, replacing prior Jam                 |
| `DELETE /api/jam`                                            | `{ hostId }`                               | `null` after any roommate removes active Jam            |
| `POST /api/push/subscribe`                                   | `{ subscription, userId }`                 | `{ ok: true }`                                          |
| `GET  /api/health`                                           | —                                          | `{ status: "ok" }`                                      |

`status` is one of `available`, `busy`, `sleeping`, `ooh`. Any status may carry
an optional `statusText` note that is shown alongside it. `statusUpdatedAt` is
the server-generated epoch-millisecond time of the most recent status save, or
`null` for records that have not been updated since this field was introduced.
Accounts use unique usernames and per-user salted password hashes stored on the
roommate item as `passwordHash`; plaintext passwords are never stored or
returned. The seeded Yorkshire roommates are backfilled with username equal to
their stable id (for example `andre`) and demo password **`roomie`**. Newly
created accounts are valid sign-in accounts but have `groupId = null`, so they
cannot see or use household features until they join a group with a reusable
invite code. The current seeded household uses `groupId = "yorkshire"`.
The module feed (`/api/feed`) normalizes events, requests, checklists,
TV shows, and the singleton Spotify Jam into `{ id, type, createdAt, updatedAt,
sortAt, title, subtitle, actor, isArchived, payload }` records sorted oldest-to-newest by
`updatedAt` (falling back to `createdAt` for legacy rows). The frontend keeps
Spotify outside the module filter and renders it beside the household notify
button. New activities store
both the creator's stable roommate id (`proposedById`) and
canonical display name (`proposedBy`). Any roommate can archive or delete an activity.
Archiving sets `isArchived` metadata without removing the row, and restoring an
expired activity restarts it immediately. Only the creator can edit its schedule,
start it early, end it, or restart it after expiration. Activities may overlap. A
scheduled activity is live once its `startAt` passes and expires when its
optional `endAt` passes. Manual end is terminal; restart starts immediately and
clears the old end. Lifecycle is
derived from server time, so visible apps pick up automatic changes through
their five-second activity polling without scheduler infrastructure.
Push subscriptions and activity participants are associated with stable
roommate ids. User-triggered notifications always exclude the actor. Every
household feature is scoped by `groupId`, including roster reads, activities,
requests, checklists, mentions, Jam state, and push fanout.
Roommate pokes target one roommate and open that recipient's status editor when
the notification is selected.
Event start/end notifications go household-wide.
Comments may mention any household member with `@Name`. Mentioned roommates get
a targeted push; unmentioned event participants still get the normal comment
push. The reserved `@all` mention sends one household-wide push excluding the
author. Mention identities are resolved server-side from the shire roster.
Comments have stable ids and can be liked once per non-author roommate; likes
are idempotent, can be removed, and do not send push notifications.
Live-event pushes include an activity-change event type so open apps refresh
their banner immediately.
Requests are stored as typed records in the activities table, targeted to
specific roommate ids, and support comments and comment likes. Requested
roommates can accept or deny, any roommate can archive, restore, or delete a request, and request
notifications target the requested users or the requester as appropriate.
Archived requests leave the active section but remain visible in the feed's archived
section. Module notifications use the canonical `/?module=<type>&item=<id>`
deep link so tapping one selects its feed filter, reveals archived targets, and
expands modules that have detail panels. Removed items link to their module filter.
Checklists are stored as typed records in the activities table. Active
checklists can be expanded from the Checklists tab, added to by any roommate,
checked off by multiple roommates per item, edited or pruned item-by-item, and
archived, restored, or deleted by anyone. Checklist reminders are household-wide pushes that exclude
the requester and open the expanded checklist card through the shared module link.
Only one Spotify Jam link is active for the shire at a time. Sharing a new
Jam replaces the previous link, and any roommate can remove the active Jam. The Jam
widget is hidden until someone shares a link; once active, roommates can join
from the widget or replace it with a newer Jam link.

When 3+ roommates are available the server logs a notification line — the hook
where a real backend would push a notification to everyone (see PROJECT.md).

## Data store

Backed by a per-deployment DynamoDB table — `RoommateStatus-dev` or
`RoommateStatus-main` (see `infrastructure/dynamodb-table-dev.yaml` and
`dynamodb-table-main.yaml`) — one item per roommate, keyed by `id`.
For accounts, `id` is the normalized username. Grouped users are included in
their household roster; no-group users remain hidden from household reads and
are rejected by mutating household routes. Groups live in a companion
`<ROOMMATE_TABLE>-groups` table keyed by `groupId`, with a reusable `joinCode`
GSI used by `/api/groups/join`.
Configuration:

| Env var             | Default               | Purpose                                                             |
| ------------------- | --------------------- | ------------------------------------------------------------------- |
| `ROOMMATE_TABLE`    | `RoommateStatus-main` | Table name                                                          |
| `AWS_REGION`        | —                     | Region (or use your AWS config/SSO)                                 |
| `DYNAMODB_ENDPOINT` | —                     | Local dev only: point boto3 at a DynamoDB Local instead of real AWS |

The runtime AWS principal must allow `dynamodb:DeleteItem` on the activities
table for creator-owned event deletion.

Credentials resolve via the standard AWS chain. The deploy script lives in
`infrastructure/`; once the table exists, seed the initial household **once**:

```bash
python seed.py           # idempotent — safe to re-run
```

### No AWS account? Use DynamoDB Local

`./start.sh` (repo root) runs the whole stack against an in-memory **DynamoDB
Local** container — no AWS credentials or deployed tables required. It sets
`DYNAMODB_ENDPOINT` so boto3 targets the local instance, then creates the tables
and seeds the shire automatically on every run. Real DynamoDB +
CloudFormation are only used by the production deploy.

The local-DynamoDB wiring lives in `infrastructure/` (next to the CloudFormation
templates it stands in for) as its own standalone compose project — see
`infrastructure/README.md`. The app connects to it over the shared `roomie-shared`
network; the only app-side pieces are the `DYNAMODB_ENDPOINT` hook in
`db.resource()` and the connection config in `docker/docker-compose.local.yml`.

## TODO before going public

- **Bound comment storage on proposed activities.** Comments are appended to an
  activity's `comments` list with no cap, so the stored list grows without
  limit even though the API/UI only ever return the most recent 100
  (`activities.COMMENTS_LIMIT`). Within a single household this is fine, but if
  the app is opened to the public it's an unbounded-growth risk (item size,
  cost, and eventually DynamoDB's 400 KB item limit). Cap the stored list —
  e.g. trim to the newest `COMMENTS_LIMIT` on write, or move comments to their
  own table keyed by activity id with pagination.

- **Add real group joining and server-side sessions.** Accounts can now be
  created without a group and are blocked from household features, but the app
  still trusts user ids in request bodies for feature actions. The next auth
  hardening step should add a real session/token layer and a join/invite flow
  that assigns `groupId`.

## Run locally

```bash
cd docker/flask
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python seed.py           # one-time, after the table is deployed
python app.py            # serves on http://localhost:8000
```

This matches the frontend's Vite proxy target (`http://localhost:8000`). To make
the frontend use it instead of its built-in mock:

```bash
cd ../../frontend
VITE_USE_MOCK=false npm run dev
```

## Run with Docker

```bash
cd docker/flask
docker build -t roomie-backend .
docker run -p 8000:8000 roomie-backend   # Gunicorn on :8000
```

## Tests

DynamoDB is mocked with `moto`, so tests need no AWS access:

```bash
cd docker/flask
pip install -r requirements-dev.txt
python -m pytest -v
```
