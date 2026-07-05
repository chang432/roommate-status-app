# TV Show Tracker — Implementation Plan

The Shows tab currently runs against an **in-memory mock** so the feature works
without a backend. This doc describes what a real backend looks like and how to
swap the mock out with no changes to the React components.

## Current state (mock)

- `frontend/src/api/mockShows.js` — in-memory store + async functions that
  return the full, refreshed show list (matching how the real feed endpoints
  behave). State resets on page reload.
- `frontend/src/api/client.js` — the `getShows` / `createShow` / `joinShow` /
  `leaveShow` / `adjustEpisode` exports delegate to the mock. Their signatures
  already match the intended REST contract, so only these bodies change.
- `frontend/src/components/ShowTrackerFeature.jsx` + `ShowCreateForm.jsx` — UI,
  identical in shape to the Checklist feature (expandable rows, create modal).

## Data model

A show is one typed item in the existing single DynamoDB table (same pattern as
`household_checklists.py`, which shares the activities table via an `itemType`
discriminator — no new infrastructure needed).

```
{
  "id":          "<uuid4 hex>",          # partition key
  "itemType":    "show",                 # discriminator for table scans
  "title":       "Severance",
  "createdBy":   "Sam",                  # denormalized display name
  "createdById": "<roommate id>",
  "createdAt":   1720200000000,          # epoch ms
  "members": [                           # watchers, embedded like checklist items
    { "id": "<roommate id>", "name": "Sam", "episode": 5 }
  ],
  "isArchived":  false
}
```

Embedding `members` on the show item (rather than separate rows) mirrors how
checklist items are stored and keeps a show a single read/write. The watcher
count is small (household size), so the item stays well under DynamoDB's 400 KB
limit.

## Backend module: `docker/flask/household_shows.py`

Model it directly on `household_checklists.py`:

- `add_show(title, created_by_id, created_by)` — put a new item; auto-join the
  creator as the first member at episode 1.
- `get(show_id, consistent=False)` / `list_recent(limit, consistent=False)` —
  scan by `itemType == "show"`, newest first, `_project(...)` to the shape above.
- `join(show_id, user_id, name)` — append to `members` if not already present
  (reuse a `_mutate_members` helper analogous to `_mutate_items`, using an
  optimistic `update_item` with a `ConditionExpression` so concurrent joins from
  two roommates don't clobber each other).
- `leave(show_id, user_id)` — remove from `members`.
- `set_episode(show_id, member_id, episode)` — clamp at 0, write the absolute
  value. Prefer sending the absolute target from the client (compute
  `current + delta` in the component) so retries are idempotent; the `/adjust`
  delta endpoint is a mock convenience only.

## Routes: `docker/flask/app.py`

Add alongside the checklist routes, validating a real roommate via
`db.get_by_id(...)` exactly like the existing feeds. Each returns
`household_shows.list_recent(consistent=True)`:

| Method & path | Handler |
|---|---|
| `GET  /api/shows` | `list_recent()` |
| `POST /api/shows` | validate title (≤ `MAX_ACTIVITY_LEN`) + creator → `add_show` |
| `POST /api/shows/<id>/join` | validate roommate → `join` |
| `POST /api/shows/<id>/leave` | validate roommate → `leave` |
| `PATCH /api/shows/<id>/watchers/<member_id>/episode` | validate roommate + integer episode ≥ 0 → `set_episode` |

Then flip the five functions in `client.js` from `mockShows.*` to `request(...)`
calls and delete `mockShows.js`. No component changes.

## Real-time + notifications (optional, to match other feeds)

The other feeds push a service-worker event (`event_type="…-changed"`) so open
apps refresh instantly, and `StatusPage` polls on visibility. For shows:

- Emit a `shows-changed` event on join/leave so watcher lists stay in sync, and
  handle it in `StatusPage`'s `handleServiceWorkerMessage` by calling
  `loadShows`.
- Episode bumps are high-frequency and low-importance — skip push for those, or
  debounce, to avoid notification spam.

## Testing

Add cases to `docker/flask/test_app.py` mirroring the checklist tests: create →
appears in `GET`; join is idempotent; leave removes; episode clamps at 0; a
non-existent show/roommate returns 404/400.

## Cost estimate

No new paid services. Shows reuse the existing DynamoDB table and Flask/Caddy
containers, so incremental cost is a handful of extra small items and requests —
effectively $0 on top of current usage (comfortably within DynamoDB free tier at
household scale).

## Manual Setup Required From Owner

None. The feature reuses the existing table and deployment; no console, secret,
or account changes are required to ship the real backend.
