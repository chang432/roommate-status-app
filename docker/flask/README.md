# Roomie Status — Flask Backend

A small Flask server implementing the API the frontend calls. Data is stored in
DynamoDB (see `../../infrastructure/`); all datastore access is encapsulated in
`db.py` so the routes stay storage-agnostic.

## Endpoints

| Method & path                  | Body                       | Returns                                  |
| ------------------------------ | -------------------------- | ---------------------------------------- |
| `POST /api/login`              | `{ name, password }`       | `{ user: { id, name } }` (401 on bad creds) |
| `GET  /api/roommates`          | —                          | `[ { id, name, status, statusText } ]`   |
| `PUT  /api/roommates/<id>/status` | `{ status, statusText }` | full updated household list              |
| `GET  /api/health`             | —                          | `{ status: "ok" }`                       |

`status` is one of `available`, `busy`, `sleeping`, `ooh`. Any status may carry
an optional `statusText` note that is shown alongside it. Every roommate shares
the demo password **`roomie`** until real auth is added.

When 3+ roommates are available the server logs a notification line — the hook
where a real backend would push a notification to everyone (see PROJECT.md).

## Data store

Backed by a per-deployment DynamoDB table — `RoommateStatus-dev` or
`RoommateStatus-main` (see `infrastructure/dynamodb-table-dev.yaml` and
`dynamodb-table-main.yaml`) — one item per roommate, keyed by `id`.
Configuration:

| Env var          | Default               | Purpose                              |
| ---------------- | --------------------- | ------------------------------------ |
| `ROOMMATE_TABLE` | `RoommateStatus-main` | Table name                           |
| `AWS_REGION`     | —                     | Region (or use your AWS config/SSO)  |

Credentials resolve via the standard AWS chain. The deploy script lives in
`infrastructure/`; once the table exists, seed the initial household **once**:

```bash
python seed.py           # idempotent — safe to re-run
```

## TODO before going public

- **Bound comment storage on proposed activities.** Comments are appended to an
  activity's `comments` list with no cap, so the stored list grows without
  limit even though the API/UI only ever show the most recent few
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
