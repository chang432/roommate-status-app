#!/usr/bin/env bash
#
# start.sh — one command to run the whole stack for local development.
#
#   1. Deploys the DynamoDB CloudFormation stack via the infrastructure venv.
#   2. Builds & starts the full app via docker compose (Flask backend + Caddy
#      serving the React frontend, proxying /api to Flask, and terminating TLS).
#   3. Waits for the backend to become healthy.
#   4. Tails the stack logs in the foreground.
#
# Caddy issues a real Let's Encrypt cert via DNS-01/Route 53, so SITE_DOMAIN
# must be set to a public hostname whose Route 53 zone the mounted AWS creds can
# write to. For domainless UI-only work, run the Vite dev server instead
# (cd frontend && npm run dev), which proxies /api to the backend.
#
# The whole stack is torn down automatically when you quit (Ctrl+C).
# Run from anywhere: `./start.sh`.

set -euo pipefail

# Resolve the project root from this script's location so paths are stable
# regardless of the current working directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Config -----------------------------------------------------------------
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
BACKEND_PORT="8000"
HEALTH_URL="http://localhost:${BACKEND_PORT}/api/health"
APP_URL="https://${SITE_DOMAIN:-<set SITE_DOMAIN>}"

# docker compose is run with an explicit -f so it works from any directory;
# relative build contexts in the compose file resolve against the file's dir.
COMPOSE=(docker compose -f "$COMPOSE_FILE")

# Local dev targets the "dev" deployment: the RoommateStatus-dev DynamoDB table
# (infrastructure/dynamodb-table-dev.yaml). Exporting ROOMMATE_TABLE points the
# Flask container at the dev table regardless of the compose default.
DEPLOYMENT="dev"
export ROOMMATE_TABLE="RoommateStatus-dev"

# --- Pretty logging ---------------------------------------------------------
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Prerequisite checks ----------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker and retry."
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available. Update Docker Desktop / the compose plugin."
# Caddy can't provision a TLS cert without a real, Route 53-managed hostname.
[ -n "${SITE_DOMAIN:-}" ] || die "SITE_DOMAIN is not set. Export the public hostname Caddy should issue a cert for, e.g. SITE_DOMAIN=dev.example.com ./start.sh"

# --- Cleanup: tear the whole stack down when this script exits --------------
cleanup() {
  log "Stopping the stack…"
  "${COMPOSE[@]}" down >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- 1. Deploy the DynamoDB CloudFormation stack ----------------------------
# The backend reads/writes the RoommateStatus-dev table, so ensure it exists
# first by deploying the dev stack.
INFRA_DIR="$ROOT_DIR/infrastructure"
INFRA_PYTHON="$INFRA_DIR/.venv/bin/python"
[ -x "$INFRA_PYTHON" ] || die "Infrastructure venv not found at $INFRA_PYTHON. Create it: cd infrastructure && python -m venv .venv && .venv/bin/pip install -r requirements.txt"

log "Deploying DynamoDB CloudFormation stack (${DEPLOYMENT})…"
( cd "$INFRA_DIR" && "$INFRA_PYTHON" deploy.py --deployment "$DEPLOYMENT" )

# --- 2. Build & start the full stack ----------------------------------------
# Detached so we can health-check below, then we tail logs in the foreground.
log "Building & starting the stack (Flask + Caddy/React)…"
"${COMPOSE[@]}" up --build -d

# --- 3. Wait for the backend to be healthy ----------------------------------
log "Waiting for backend to be ready…"
for attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Backend is up."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    "${COMPOSE[@]}" logs || true
    die "Backend did not become healthy in time."
  fi
  sleep 1
done

log "App is ready at ${APP_URL} (Ctrl+C to stop everything)."

# --- 4. Tail the stack logs in the foreground -------------------------------
# Quitting (Ctrl+C) triggers the cleanup trap above, which tears the stack down.
"${COMPOSE[@]}" logs -f
