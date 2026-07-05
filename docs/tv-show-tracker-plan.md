# TV Show Tracker — Backend

The Shows tab is backed by the Flask server persisting to its **own DynamoDB
table**, following the same "one table per concern" pattern as the activities,
push-subscriptions, and groups tables. (An earlier draft of this doc proposed
sharing the activities table via an `itemType` discriminator; a dedicated table
was chosen instead so shows stay isolated and the activities scan stays clean.)

## Data model

One item per show in the `RoommateStatus-{dev,main}-shows` table, keyed by a
generated `id`. Watchers are embedded on the item (like checklist items), each
tracking their own season and episode, so a show is a single read/write.

```
{
  "id":          "<uuid4 hex>",          # partition key
  "title":       "Severance",
  "createdBy":   "Sam",                  # denormalized display name
  "createdById": "<roommate id>",
  "createdAt":   1720200000000,          # epoch ms
  "completedAt": 1720300000000,          # epoch ms; ABSENT while active
  "members": [
    { "id": "<roommate id>", "name": "Sam", "season": 2, "episode": 5 }
  ]
}
```

`completedAt` is present only while a show is completed; the API projects a
derived `completed` boolean and omits the attribute when active, so
`attribute_not_exists(completedAt)` cleanly means "active".

## Backend module: `docker/flask/household_shows.py`

Modeled on `activities.py` (own-table setup) + `household_checklists.py`
(embedded-list mutations via an optimistic `update_item`):

- `add_show(title, created_by_id, created_by)` — put a new item, auto-joining the
  creator as the first watcher at season 1, episode 1.
- `get` / `list_recent(limit, consistent)` — scan, newest first. The active vs.
  completed split and per-watcher ordering are done in the frontend.
- `join(show_id, user_id, name)` / `leave(show_id, user_id)` — append/remove a
  watcher; both idempotent, rejected on completed shows.
- `adjust_progress` / `set_progress(show_id, member_id, field, value)` — `field`
  is `season` or `episode`, clamped at 1. **Writing a season resets that
  watcher's episode to 1** (a new season starts from episode 1).
- `complete` / `reopen(show_id, requester_id)` — creator-only lifecycle toggle;
  non-creators get a `COMPLETE_FORBIDDEN` sentinel the route maps to 403.

## Routes: `docker/flask/app.py`

| Method & path | Handler |
|---|---|
| `GET  /api/shows` | `list_recent()` |
| `POST /api/shows` | validate title (≤ `MAX_ACTIVITY_LEN`) + creator → `add_show` |
| `POST /api/shows/<id>/join` | validate roommate → `join` |
| `POST /api/shows/<id>/leave` | validate roommate → `leave` |
| `PATCH /api/shows/<id>/watchers/<member_id>/<field>` | integer `delta` → `adjust_progress` |
| `PUT   /api/shows/<id>/watchers/<member_id>/<field>` | integer `value` → `set_progress` |
| `POST /api/shows/<id>/complete` | validate requester → `complete` (creator-only) |
| `POST /api/shows/<id>/reopen` | validate requester → `reopen` (creator-only) |

Progress edits are intentionally open to every roommate (matching the feature's
loose ownership), so they take no per-caller check. The frontend `client.js`
show functions call these endpoints directly; the in-memory mock has been
removed.

## Real-time + notifications (not implemented)

Unlike the other feeds, shows do **not** emit a `shows-changed` push event or
participate in `StatusPage`'s visibility polling. Episode bumps are
high-frequency and low-importance, so this was skipped to avoid notification
spam and service-worker churn. Add a debounced `shows-changed` emit on
join/leave/complete later if live sync becomes desirable.

## Testing

`docker/flask/test_app.py` covers: create auto-joins the creator at S1 E1; join
is idempotent; leave removes; setting a season resets the episode; progress
clamps at 1 and rejects bad input/fields; only the creator can complete/reopen;
completed shows are read-only (409); unknown show/watcher → 404. DynamoDB is
mocked with `moto`.

## Cost estimate

No new paid services. The shows table is on-demand (PAY_PER_REQUEST) like the
others; at household scale it stays comfortably within the DynamoDB free tier —
effectively $0 on top of current usage.

## Manual Setup Required From Owner

- **Provision the table** in each environment before deploying the app that
  reads it: `python infrastructure/deploy.py --dev` and (for production)
  `python infrastructure/deploy.py --main`. This creates
  `RoommateStatus-dev-shows` / `RoommateStatus-main-shows` via CloudFormation.
- **Local dev** needs no action: `infrastructure/create-tables.sh` (run by
  `start.sh`) now creates the `-shows` table in DynamoDB Local automatically.
- The app's IAM role/credentials must allow DynamoDB access to the new table
  (same actions already granted for the activities table).
