#!/usr/bin/env bash
#
# start.sh — one command to run the whole stack for local development.
#
#   1. Ensures the shared network, then starts the local DynamoDB module
#      (a separate compose project) and creates its tables.
#   2. Builds the app, seeds the shire, and starts it (Flask backend + Caddy
#      serving the React frontend and proxying /api to Flask).
#   3. Waits for the backend to become healthy.
#   4. Tails the app logs in the foreground.
#
# No AWS account is needed for local dev: the app talks to the local DynamoDB
# (DYNAMODB_ENDPOINT, set in docker/docker-compose.local.yml), which is in-memory
# and reseeded fresh on every run. Real DynamoDB + CloudFormation are only used
# by the production deploy.
#
# Two independent compose projects, joined only by a shared network and the
# table-name contract:
#   - roomie-infra : infrastructure/docker-compose.dynamodb-local.yml — the
#     in-memory DynamoDB Local + a one-off table-creator. Can be run on its own.
#   - roomie-app   : docker/docker-compose.yml + docker-compose.local.yml — the
#     app (plain-HTTP Caddy locally), pointed at the DB via DYNAMODB_ENDPOINT and
#     attached to the shared network.
# http://localhost is still a browser secure context, so service workers / the
# push API work locally; the real iPhone push test needs the VPS deploy.
#
# Both projects are torn down automatically when you quit (Ctrl+C); the shared
# network is left in place (it's external, owned by neither project).
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

# Shared network both projects join (external — owned by neither), and the two
# project names so their containers/networks stay distinct and predictable.
SHARED_NETWORK="roomie-shared"
APP_PROJECT="roomie-app"
INFRA_PROJECT="roomie-infra"

# Absolute path to infrastructure/, consumed by its compose file to mount the
# table-creator script regardless of the compose project directory.
export INFRA_DIR="$ROOT_DIR/infrastructure"

# The base compose file requires SITE_DOMAIN (for the VPS's TLS cert). Locally
# the override serves plain HTTP and ignores it, but the variable still has to
# be set so the base file's interpolation guard passes — give it a placeholder.
export SITE_DOMAIN="${SITE_DOMAIN:-localhost}"

# Table name the local tables are created under (plus the -activities and
# -pushsubs suffixes the app derives). Exported so the infra table-creator, the
# app, and seeding all agree — this name is the contract between the two modules.
export ROOMMATE_TABLE="RoommateStatus-dev"

# The two compose projects. Explicit -p names + -f files so each runs from any
# directory and stays isolated; relative build contexts resolve against the
# first -f file's dir.
INFRA=(docker compose -p "$INFRA_PROJECT" -f "$COMPOSE_DDB_FILE")
APP=(docker compose -p "$APP_PROJECT" -f "$COMPOSE_FILE" -f "$COMPOSE_LOCAL_FILE")

# --- Pretty logging ---------------------------------------------------------
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

log "Starting up local app deployment..."

# --- Prerequisite checks ----------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker and retry."
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available. Update Docker Desktop / the compose plugin."

# --- Cleanup: tear both projects down when this script exits ----------------
# App first (so it leaves the shared network), then the DB. The shared network
# is external, so neither `down` removes it — it's left for the next run / reuse.
cleanup() {
  log "Stopping the stack…"
  "${APP[@]}" down >/dev/null 2>&1 || true
  "${INFRA[@]}" down >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- 1. Shared network + local DynamoDB module ------------------------------
# Create the shared network once (idempotent); both projects attach to it.
log "Ensuring shared network '${SHARED_NETWORK}' exists…"
docker network create "$SHARED_NETWORK" >/dev/null 2>&1 || true

log "Starting local DynamoDB module (in-memory)…"
"${INFRA[@]}" up -d dynamodb-local

log "Waiting for DynamoDB Local to accept connections…"
for attempt in $(seq 1 30); do
  # Once up, DynamoDB Local answers GET / with HTTP 400; any response at all
  # (curl exit 0 without -f) means the port is ready. Connection-refused before
  # then is a non-zero exit, so the loop keeps waiting.
  if curl -s -o /dev/null "$DDB_LOCAL_URL"; then break; fi
  [ "$attempt" -eq 30 ] && die "DynamoDB Local did not become ready in time."
  sleep 1
done

# Create the tables — the infra table-creator (aws-cli) is the local stand-in
# for CloudFormation. --profile init activates the one-off service.
log "Creating tables…"
"${INFRA[@]}" --profile init run --rm dynamodb-init

# --- 2. Build, seed, and start the app --------------------------------------
# Build the backend image first so the seed step runs current code (otherwise
# `compose run flask` could reuse a stale image predating the DYNAMODB_ENDPOINT
# support and silently hit real AWS).
log "Building the app backend image…"
"${APP[@]}" build flask

# Seed the shire via the app image (seed.py + the roster live with the app).
# The run container joins the shared network, so it reaches DynamoDB Local.
log "Seeding the shire…"
"${APP[@]}" run --rm flask python seed.py

log "Building & starting the app (Flask + Caddy/React)…"
"${APP[@]}" up --build -d

# --- 3. Wait for the backend to be healthy ----------------------------------
log "Waiting for backend to be ready…"
for attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Backend is up."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    "${APP[@]}" logs || true
    die "Backend did not become healthy in time."
  fi
  sleep 1
done

log "App is ready at ${APP_URL} (Ctrl+C to stop everything)."

# --- 4. Tail the app logs in the foreground ---------------------------------
# Quitting (Ctrl+C) triggers the cleanup trap above, which tears both down.
"${APP[@]}" logs -f
