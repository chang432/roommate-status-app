# Caddy image that builds the React/Vite frontend and serves the static bundle
# over plain HTTP on :80. TLS is not this image's job — the shared edge proxy
# (docker/edge/) terminates HTTPS for every cluster on the box and forwards
# here over an internal Docker network.
#
# Build context is the repo root (see docker/docker-compose.yml) so this can
# reach both the frontend/ source and this folder's Caddyfile.

# --- Stage 1: build the React app with Vite --------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Install deps first so this layer is cached across source-only changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Build the production bundle into /app/dist.
COPY frontend/ ./
RUN npm run build

# --- Stage 2: runtime ------------------------------------------------------
FROM caddy:2.10-alpine

# Site config: SPA + /api proxy, plain HTTP (see the file's header).
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Static assets produced by the build stage live under /srv (see Caddyfile root).
COPY --from=build /app/dist /srv

# Make every asset world-readable and dirs traversable so the Caddy process can
# open them regardless of the build stage's umask.
RUN chmod -R a+rX /srv

# Only 80: the edge proxy owns the host's 80/443.
EXPOSE 80

# The base image's entrypoint runs `caddy run` against /etc/caddy/Caddyfile.
