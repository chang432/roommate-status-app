#!/usr/bin/env bash
#
# start.sh — one command to run the whole stack for local development.
#
#   1. Starts a local, in-memory DynamoDB, then creates & seeds its tables.
#   2. Builds & starts the full app via docker compose (Flask backend + Caddy
#      serving the React frontend and proxying /api to Flask).
#   3. Waits for the backend to become healthy.
#   4. Tails the stack logs in the foreground.
#
# No AWS account is needed for local dev: the app talks to the local DynamoDB
# (DYNAMODB_ENDPOINT, set in docker-compose.local.yml), which is in-memory and
# reseeded fresh on every run. Real DynamoDB + CloudFormation are only used by
# the production deploy (the base docker-compose.yml / infrastructure/).
#
# Local dev layers two override files onto the base docker-compose.yml:
#   - docker/docker-compose.local.yml          — Caddy serves plain HTTP on
#     http://localhost (never contacts Let's Encrypt / Route 53; no domain or
#     cert needed).
#   - infrastructure/docker-compose.dynamodb-local.yml — an in-memory DynamoDB
#     Local plus a one-off table-creator, and the DYNAMODB_ENDPOINT that points
#     Flask at it. This is what removes the AWS-account requirement; all of the
#     local-DynamoDB wiring lives in infrastructure/ next to the CloudFormation
#     templates it stands in for.
# http://localhost is still a browser secure context, so service workers / the
# push API work locally; the real iPhone push test needs the VPS deploy.
#
# The whole stack is torn down automatically when you quit (Ctrl+C).
# Run from anywhere: `./start.sh`.

set -euo pipefail

# Resolve the project root from this script's location so paths are stable
# regardless of the current working directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Config -----------------------------------------------------------------
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
COMPOSE_LOCAL_FILE="$ROOT_DIR/docker/docker-compose.local.yml"
COMPOSE_DDB_FILE="$ROOT_DIR/infrastructure/docker-compose.dynamodb-local.yml"
BACKEND_PORT="8000"
HEALTH_URL="http://localhost:${BACKEND_PORT}/api/health"
APP_URL="http://localhost"
# DynamoDB Local, host-published on 8001 (see the infrastructure compose file).
DDB_LOCAL_URL="http://localhost:8001"

# Absolute path to infrastructure/, consumed by its compose file to mount the
# table-creator script regardless of the compose project directory.
export INFRA_DIR="$ROOT_DIR/infrastructure"

# The base compose file requires SITE_DOMAIN (for the VPS's TLS cert). Locally
# the override serves plain HTTP and ignores it, but the variable still has to
# be set so the base file's interpolation guard passes — give it a placeholder.
export SITE_DOMAIN="${SITE_DOMAIN:-localhost}"

# docker compose is run with explicit -f files so it works from any directory;
# relative build contexts resolve against the first file's dir. Overrides are
# layered after the base so their settings win: the plain-HTTP Caddy override,
# then the local-DynamoDB file from infrastructure/.
COMPOSE=(docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_LOCAL_FILE" -f "$COMPOSE_DDB_FILE")

# Table name the local DynamoDB tables are created under (plus the -activities
# and -pushsubs suffixes the app derives). Exporting ROOMMATE_TABLE keeps the
# Flask container, the create-tables step, and seeding all pointed at the same
# names. The value is just a label here — locally it's a DynamoDB Local table,
# not the deployed RoommateStatus-dev one.
export ROOMMATE_TABLE="RoommateStatus-dev"

# --- Pretty logging ---------------------------------------------------------
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Prerequisite checks ----------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker and retry."
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available. Update Docker Desktop / the compose plugin."

# --- Cleanup: tear the whole stack down when this script exits --------------
cleanup() {
  log "Stopping the stack…"
  "${COMPOSE[@]}" down >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- 1. Start local DynamoDB, then create & seed its tables -----------------
# Build the backend image up front so the seed step below runs the current code
# (otherwise `compose run flask` could reuse a stale image that predates the
# DYNAMODB_ENDPOINT support and silently hit real AWS).
log "Building the backend image…"
"${COMPOSE[@]}" build flask

# Bring up only DynamoDB Local first so the tables exist before the app serves
# traffic. It's in-memory, so this runs every start.
log "Starting local DynamoDB (in-memory)…"
"${COMPOSE[@]}" up -d dynamodb-local

log "Waiting for DynamoDB Local to accept connections…"
for attempt in $(seq 1 30); do
  # Once up, DynamoDB Local answers GET / with HTTP 400; any response at all
  # (curl exit 0 without -f) means the port is ready. Connection-refused before
  # then is a non-zero exit, so the loop keeps waiting.
  if curl -s -o /dev/null "$DDB_LOCAL_URL"; then break; fi
  [ "$attempt" -eq 30 ] && die "DynamoDB Local did not become ready in time."
  sleep 1
done

# Create the tables — the infrastructure/ table-creator (aws-cli) is the local
# stand-in for CloudFormation. --profile init activates the one-off service.
log "Creating tables…"
"${COMPOSE[@]}" --profile init run --rm dynamodb-init

# Seed the household via the app image (seed.py + the roster live with the app).
# --no-deps since DynamoDB Local is already up.
log "Seeding the household…"
"${COMPOSE[@]}" run --rm --no-deps flask python seed.py

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
