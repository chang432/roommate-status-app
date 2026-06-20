# Roomie Status — Flask Backend

A small Flask server implementing the API the frontend calls. Data is stored in
DynamoDB (see `../../infrastructure/`); all datastore access is encapsulated in
`db.py` so the routes stay storage-agnostic.

## Endpoints

| Method & path                  | Body                       | Returns                                  |
| ------------------------------ | -------------------------- | ---------------------------------------- |
| `POST /api/login`              | `{ name, password }`       | `{ user: { id, name } }` (401 on bad creds) |
| `GET  /api/roommates`          | —                          | `[ { id, name, status, statusText, statusUpdatedAt } ]` |
| `PUT  /api/roommates/<id>/status` | `{ status, statusText }` | full updated household list              |
| `POST /api/roommates/notify`   | `{ requesterId }`          | `{ sent, pruned, failed }`                  |
| `POST /api/activities`          | `{ text, proposedById }`   | full updated activity list                |
| `DELETE /api/activities/<id>`   | `{ requesterId }`          | full updated activity list                |
| `POST /api/activities/<id>/start` | `{ requesterId }`        | full updated activity list                |
| `POST /api/activities/<id>/end` | `{ requesterId }`          | full updated activity list                |
| `PUT/DELETE /api/activities/<id>/comments/<commentId>/likes` | `{ userId }` | full updated activity list |
| `GET /api/requests`              | —                          | full request list                          |
| `POST /api/requests`             | `{ text, requesterId, requestedIds }` | full updated request list    |
| `POST /api/requests/<id>/responses` | `{ userId, response }`  | full updated request list                  |
| `POST /api/requests/<id>/complete` | `{ userId }`             | full updated request list                  |
| `POST /api/requests/<id>/comments` | `{ authorId, text }`     | full updated request list                  |
| `PUT/DELETE /api/requests/<id>/comments/<commentId>/likes` | `{ userId }` | full updated request list |
| `POST /api/push/subscribe`      | `{ subscription, userId }` | `{ ok: true }`                            |
| `GET  /api/health`             | —                          | `{ status: "ok" }`                       |

`status` is one of `available`, `busy`, `sleeping`, `ooh`. Any status may carry
an optional `statusText` note that is shown alongside it. `statusUpdatedAt` is
the server-generated epoch-millisecond time of the most recent status save, or
`null` for records that have not been updated since this field was introduced.
Every roommate shares the demo password **`roomie`** until real auth is added.
New activities store both the creator's stable roommate id (`proposedById`) and
canonical display name (`proposedBy`). Only that id can delete the activity;
legacy activities without `proposedById` remain visible but cannot be deleted.
Only the creator can start or end an event. One event may be live household-wide
at a time; ending it returns it to proposed status so it can be restarted.
Push subscriptions and activity participants are associated with stable
roommate ids. User-triggered notifications always exclude the actor. New
activity proposals and gather notifications go household-wide; event comments,
joins, deletion, and emphasis go only to that event's participants.
Event start/end notifications go household-wide.
Comments may mention any household member with `@Name`. Mentioned roommates get
a targeted push; unmentioned event participants still get the normal comment
push. The reserved `@all` mention sends one household-wide push excluding the
author. Mention identities are resolved server-side from the household roster.
Comments have stable ids and can be liked once per non-author roommate; likes
are idempotent, can be removed, and do not send push notifications.
Live-event pushes include an activity-change event type so open apps refresh
their banner immediately.
Requests are stored as typed records in the activities table, targeted to
specific roommate ids, and support comments and comment likes. Requested
roommates can accept or deny, any roommate can complete a request, and request
notifications target the requested users or the requester as appropriate.

When 3+ roommates are available the server logs a notification line — the hook
where a real backend would push a notification to everyone (see PROJECT.md).

## Data store

Backed by a per-deployment DynamoDB table — `RoommateStatus-dev` or
`RoommateStatus-main` (see `infrastructure/dynamodb-table-dev.yaml` and
`dynamodb-table-main.yaml`) — one item per roommate, keyed by `id`.
Configuration:

| Env var             | Default               | Purpose                                      |
| ------------------- | --------------------- | -------------------------------------------- |
| `ROOMMATE_TABLE`    | `RoommateStatus-main` | Table name                                   |
| `AWS_REGION`        | —                     | Region (or use your AWS config/SSO)          |
| `DYNAMODB_ENDPOINT` | —                     | Local dev only: point boto3 at a DynamoDB Local instead of real AWS |

The runtime AWS principal must allow `dynamodb:DeleteItem` on the activities
table for creator-owned event deletion and `dynamodb:TransactWriteItems` for
atomic live-event transitions.

Credentials resolve via the standard AWS chain. The deploy script lives in
`infrastructure/`; once the table exists, seed the initial household **once**:

```bash
python seed.py           # idempotent — safe to re-run
```

### No AWS account? Use DynamoDB Local

`./start.sh` (repo root) runs the whole stack against an in-memory **DynamoDB
Local** container — no AWS credentials or deployed tables required. It sets
`DYNAMODB_ENDPOINT` so boto3 targets the local instance, then creates the tables
and seeds the household automatically on every run. Real DynamoDB +
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

- **Give roommates real, unique identities (uuid id + email login).** Today a
  roommate's `id` is derived from their name and login matches by name against a
  shared demo password (`db.DEMO_PASSWORD`), so two roommates with the same name
  would collide — `find_by_name` returns the first match and the second person
  could never sign in. Switch to a surrogate **uuid `id`** (meaningless and
  immutable) with **`email`** as the login credential and **`name`** kept purely
  for display:
  - DynamoDB only enforces uniqueness on a key, so guarantee unique emails with
    a small **email→id lookup item** (`id = <normalized email>`, `userId = …`)
    written alongside the user record in a `TransactWriteItems` whose lookup put
    is conditional on `attribute_not_exists(id)`. That item doubles as the login
    index, so login is two fast `get_item`s (email→id, then id→user) instead of
    today's full-table scan — and a GSI on email would *not* enforce uniqueness,
    so it isn't needed. Keep these lookup items in their own table to keep the
    household scan clean (one additive CloudFormation table).
  - **Normalize emails** (lowercase + trim) at every read/write so case variants
    can't create duplicate accounts.
  - Store **per-user password hashes** (e.g. `werkzeug.security`) instead of the
    shared demo password.
  - Store activity `proposedBy`/`members` as **user ids**, resolving id→name for
    display, so duplicate display names can't collide there either.
  - Migration is gentle: the 5 seeded ids are already stable strings, so just
    backfill `email` + `passwordHash` and create their lookup items; only *new*
    roommates get uuid ids. New IAM action required: `dynamodb:TransactWriteItems`.

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
