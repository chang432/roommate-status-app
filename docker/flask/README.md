# Roomie Status — Flask Backend

A small Flask server implementing the API the frontend calls. Data is a simple
in-memory mock (`db.py`) for now; swap that module for a real database later
without touching the routes.

## Endpoints

| Method & path                  | Body                       | Returns                                  |
| ------------------------------ | -------------------------- | ---------------------------------------- |
| `POST /api/login`              | `{ name, password }`       | `{ user: { id, name } }` (401 on bad creds) |
| `GET  /api/roommates`          | —                          | `[ { id, name, status, statusText } ]`   |
| `PUT  /api/roommates/<id>/status` | `{ status, statusText }` | full updated household list              |
| `GET  /api/health`             | —                          | `{ status: "ok" }`                       |

`status` is one of `available`, `busy`, `custom`. Every roommate shares the demo
password **`roomie`** until real auth is added.

When 3+ roommates are available the server logs a notification line — the hook
where a real backend would push a notification to everyone (see PROJECT.md).

## Run locally

```bash
cd docker/flask
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
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

```bash
cd docker/flask
pip install pytest
python -m pytest -v
```
