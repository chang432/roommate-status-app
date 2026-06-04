#!/usr/bin/env bash
#
# start.sh — one command to run the whole stack for local development.
#
#   1. Builds the Flask backend Docker image and runs it in the background.
#   2. Waits for the backend to become healthy.
#   3. Installs frontend deps (if needed) and starts the React dev server.
#
# The backend container is stopped automatically when you quit the dev server
# (Ctrl+C). Run from anywhere: `./start.sh`.

set -euo pipefail

# Resolve the project root from this script's location so paths are stable
# regardless of the current working directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Config -----------------------------------------------------------------
IMAGE_NAME="roomie-backend"
CONTAINER_NAME="roomie-backend"
BACKEND_PORT="8000"
HEALTH_URL="http://localhost:${BACKEND_PORT}/api/health"

# --- Pretty logging ---------------------------------------------------------
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Prerequisite checks ----------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker and retry."
command -v npm >/dev/null 2>&1 || die "npm is not installed or not on PATH."

# --- Cleanup: stop the backend container when this script exits -------------
cleanup() {
  log "Stopping backend container…"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- 1. Build & run the Flask backend ---------------------------------------
log "Building backend image ($IMAGE_NAME)…"
docker build -t "$IMAGE_NAME" "$ROOT_DIR/docker/flask"

# Remove any leftover container from a previous run before starting a new one.
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

log "Starting backend on http://localhost:${BACKEND_PORT}…"
docker run -d --name "$CONTAINER_NAME" -p "${BACKEND_PORT}:8000" "$IMAGE_NAME" >/dev/null

# --- 2. Wait for the backend to be healthy ----------------------------------
log "Waiting for backend to be ready…"
for attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Backend is up."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    docker logs "$CONTAINER_NAME" || true
    die "Backend did not become healthy in time."
  fi
  sleep 1
done

# --- 3. Install deps & run the frontend dev server --------------------------
cd "$ROOT_DIR/frontend"

if [ ! -d node_modules ]; then
  log "Installing frontend dependencies…"
  npm install
else
  log "Frontend dependencies already installed — skipping npm install."
fi

log "Starting frontend dev server (Ctrl+C to stop everything)…"
# Runs in the foreground; quitting it triggers the cleanup trap above.
npm run dev
