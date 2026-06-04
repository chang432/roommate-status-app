# Nginx image that builds the React/Vite frontend and serves the static bundle.
#
# Build context is the repo root (see docker/docker-compose.yml) so this can
# reach both the frontend/ source and this folder's nginx.conf.

# --- Stage 1: build the React app with Vite --------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Install deps first so this layer is cached across source-only changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Build the production bundle into /app/dist.
COPY frontend/ ./
RUN npm run build

# --- Stage 2: serve the static bundle with nginx ---------------------------
FROM nginx:1.27-alpine

# SPA + /api proxy config.
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Static assets produced by the build stage.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
