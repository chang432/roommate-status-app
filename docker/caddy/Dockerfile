# Caddy image that builds the React/Vite frontend and serves the static bundle
# over HTTPS, obtaining/renewing its TLS cert from Let's Encrypt via the
# DNS-01 challenge against Amazon Route 53.
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

# --- Stage 2: build a custom Caddy with the Route 53 DNS module -------------
# The stock caddy image ships no DNS providers, so the DNS-01 challenge needs a
# binary built with the route53 plugin via xcaddy (preinstalled in -builder).
FROM caddy:2.10-builder AS caddybuild

# The route53 plugin requires a newer Go than the builder image pins, and that
# image defaults to GOTOOLCHAIN=local (no auto-upgrade). Allow Go to fetch the
# toolchain the module declares so the build isn't tied to the image's Go.
ENV GOTOOLCHAIN=auto

RUN xcaddy build \
    --with github.com/caddy-dns/route53

# --- Stage 3: runtime ------------------------------------------------------
FROM caddy:2.10-alpine

# Swap in the custom binary (with the route53 module) for the stock one.
COPY --from=caddybuild /usr/bin/caddy /usr/bin/caddy

# Site config: SPA + /api proxy + DNS-01 TLS.
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Static assets produced by the build stage live under /srv (see Caddyfile root).
COPY --from=build /app/dist /srv

# Make every asset world-readable and dirs traversable so the Caddy process can
# open them regardless of the build stage's umask.
RUN chmod -R a+rX /srv

# 80 is kept for the automatic HTTP->HTTPS redirect; 443 serves the site.
EXPOSE 80 443

# The base image's entrypoint runs `caddy run` against /etc/caddy/Caddyfile.
