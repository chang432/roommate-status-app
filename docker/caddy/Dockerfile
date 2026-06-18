# Caddy image that builds the React/Vite frontend and serves the static bundle
# over HTTPS. Caddy obtains/renews its TLS cert with the default HTTP-01
# challenge, so the VPS must publish port 80 as well as 443.
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

# Site config: SPA + /api proxy + automatic HTTPS.
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Static assets produced by the build stage live under /srv (see Caddyfile root).
COPY --from=build /app/dist /srv

# Make every asset world-readable and dirs traversable so the Caddy process can
# open them regardless of the build stage's umask.
RUN chmod -R a+rX /srv

# 80 is kept for the automatic HTTP->HTTPS redirect; 443 serves the site.
EXPOSE 80 443

# The base image's entrypoint runs `caddy run` against /etc/caddy/Caddyfile.
