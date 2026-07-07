---
name: verify
description: Build, launch, and drive the Roomie Status stack locally to verify a change end-to-end at its HTTP surface.
---

# Verifying changes in this repo

The app is Flask (docker/flask) behind Caddy, which also serves the built
React frontend (frontend/) and proxies /api. Local dev uses two compose
projects joined by the external `roomie-shared` network:

- `roomie-infra` — in-memory DynamoDB Local + table creator
  (infrastructure/docker-compose.dynamodb-local.yml). Data is wiped when
  this project restarts, and reseeded by `./start.sh`.
- `roomie-app` — Flask + Caddy (docker/docker-compose.yml +
  docker-compose.local.yml).

## Launch / redeploy

Full cold start (also creates tables and seeds): `./start.sh` (foreground;
Ctrl+C tears everything down).

If the stack is already running and you changed backend or frontend code,
rebuild just the app project (DB and seeded data survive):

```bash
SITE_DOMAIN=localhost ROOMMATE_TABLE=RoommateStatus-dev \
  docker compose -p roomie-app \
  -f docker/docker-compose.yml -f docker/docker-compose.local.yml \
  up -d --build --force-recreate
```

Gotcha: without `--force-recreate`, compose may report "Running" and keep
the old containers even after a successful build — verify the change is
live before driving it.

## Drive

- App surface (what the browser hits): `http://localhost/api/...`
  (Caddy proxy). Direct backend: `http://localhost:8000/api/...`.
- Seeded logins: users `andre`, `sheryl`, `kayla`, `ting`, `isabella`,
  all with password `roomie` (db.py `DEMO_PASSWORD`), all in group
  `yorkshire`.
- Health: `GET /api/health`.
- Inspect the local DB directly:

```bash
AWS_ACCESS_KEY_ID=dummy AWS_SECRET_ACCESS_KEY=dummy \
  aws dynamodb scan --table-name RoommateStatus-dev \
  --endpoint-url http://localhost:8001 --region us-east-1
```

- The served JS bundle name is in `curl -s http://localhost/ | grep -o
  'assets/index-[^"]*\.js'` — grep it to confirm a frontend change
  actually shipped in the Caddy image.
- If you create accounts/data while probing, clean up via the API
  (e.g. `DELETE /api/accounts/<id>` with the password) — or note that a
  `roomie-infra` restart wipes everything anyway.

Frontend-behavior changes (React state, localStorage session handling)
need a real browser to observe; the API + bundle checks above only prove
the backend contract and that the new code is being served.
