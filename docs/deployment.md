# Deployment

Both deployments — `dev` and `prod` — run on **one** OVH VPS as three
independent Docker Compose projects ("clusters"). Nothing but the edge proxy is
reachable from the internet, and nothing but the external `roomie-edge` network
is shared between the clusters.

```
                internet
                   │  :80 / :443
        ┌──────────▼───────────────────────────────┐
        │ roomie-edge   docker/edge/               │  TLS (Let's Encrypt),
        │ container: roomie-edge                   │  routes by Host
        └───────┬──────────────────────┬───────────┘
   DEV_SITE_DOMAIN             MAIN_SITE_DOMAIN
                │                      │          ← network: roomie-edge
   ┌────────────▼──────────┐ ┌─────────▼───────────┐
   │ roomie-dev            │ │ roomie-prod         │
   │ roomie-dev-frontend   │ │ roomie-prod-frontend│  Caddy: SPA + /api
   │ roomie-dev-backend    │ │ roomie-prod-backend │  Flask (gunicorn)
   │ 127.0.0.1:8001        │ │ 127.0.0.1:8000      │  loopback only
   │ RoommateStatus-dev*   │ │ RoommateStatus-main*│  DynamoDB tables
   └───────────────────────┘ └─────────────────────┘
```

| Cluster       | Compose files                                             | Project       | Checkout                 | Branch |
| ------------- | --------------------------------------------------------- | ------------- | ------------------------ | ------ |
| `roomie-edge` | `docker/edge/docker-compose.yml`                          | `roomie-edge` | either (config only)     | —      |
| `roomie-dev`  | `docker/docker-compose.yml` + `docker-compose.deploy.yml` | `roomie-dev`  | `/opt/<repo>-dev`        | `dev`  |
| `roomie-prod` | `docker/docker-compose.yml` + `docker-compose.deploy.yml` | `roomie-prod` | `/opt/<repo>-prod`       | `main` |

## How the two stay out of each other's way

Everything that is global to a Docker host is keyed by the environment, so the
two clusters never contend for the same resource:

- **Host ports.** Only the edge binds `80`/`443`. An app cluster's Caddy listens
  on `80` *inside* its own network and publishes nothing; the edge reaches it by
  the `roomie-<env>-frontend` alias registered in `docker-compose.deploy.yml`.
  Flask is published on `127.0.0.1` only, on a per-environment port, purely so a
  deploy can health-check it.
- **Compose project name** (`-p roomie-dev` / `-p roomie-prod`), which scopes
  the networks and volumes, so `docker compose down` during a dev deploy cannot
  touch prod's containers.
- **Image tags and container names** — `roomie-backend:${DEPLOY_ENV}`,
  `roomie-<env>-backend`. Without this a dev build would move the tag whose
  image the prod containers were created from.
- **Checkout directory**, because the two clusters track different branches.
- **DynamoDB tables** — `RoommateStatus-dev*` vs `RoommateStatus-main*`, from
  separate CloudFormation stacks (see [`../infrastructure/README.md`](../infrastructure/README.md)).

The edge is deliberately only ever brought `up`, never `down`, and its Caddyfile
is a bind mount that the deploy *reloads* in place. A dev deploy therefore can't
drop prod's TLS listener, and certificates for both sites live in one volume
(one ACME account, no duplicate issuance).

## Pipeline

`.github/workflows/on_merge_dev.yml` (push to `dev`) and `on_merge_main.yml`
(push to `main`) are thin callers of the shared
[`deploy_vps.yml`](../.github/workflows/deploy_vps.yml), which runs
`provision` → `deploy` → `migrate`: CloudFormation first so new tables/indexes
exist before the code that reads them, then the cluster, then in-place data
migrations against the now-live app. The `deploy` job holds a VPS-wide
`concurrency` lock, so a dev and a prod merge landing together are serialized
rather than driving apt/docker on the box at once.

The first run on a box that previously hosted the single pre-split stack removes
it (`/opt/<repo>`, containers `roomie-backend` / `roomie-frontend`); otherwise it
would still hold `80`/`443` and the edge could not start.

### Required repository configuration

Settings → Secrets and variables → Actions:

| Variable           | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `OVH_VPS_IP`       | Public IPv4 of the one VPS both clusters run on          |
| `DEV_SITE_DOMAIN`  | Public hostname of the dev cluster                       |
| `MAIN_SITE_DOMAIN` | Public hostname of the prod cluster                      |
| `VAPID_SUBJECT`    | `mailto:` contact for Web Push                           |

Both hostnames are required on **every** deploy: the edge configures both sites
from one Caddyfile, and Caddy cannot parse an empty site address. Point both
hostnames' DNS at `OVH_VPS_IP` — the certs are issued over HTTP-01, so issuance
only succeeds once DNS resolves to the box.

While the move to one VPS is still in progress, [`../ACTIONS_NEEDED.txt`](../ACTIONS_NEEDED.txt)
is the checklist of the outside-the-repo steps (variables, DNS, firewall,
decommissioning the second box); delete it once it is all done.

| Secret                                            | Purpose                             |
| ------------------------------------------------- | ----------------------------------- |
| `OVH_SSH_PASSWORD`                                | Password for the VPS `ubuntu` user  |
| `GH_PAT_REPO_READ`                                | Read-only PAT used to clone         |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | DynamoDB access            |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`           | Web Push; empty disables push       |

## Operating the box by hand

```bash
# What's running, and which cluster each container belongs to
sudo docker ps --format '{{.Names}}\t{{.Ports}}'

# Logs for one cluster (prod shown; dev is roomie-dev + -dev)
cd /opt/roommate-status-app-prod
sudo -H docker compose -p roomie-prod --env-file docker/deploy.env \
  -f docker/docker-compose.yml -f docker/docker-compose.deploy.yml logs -f

# Edge: routing / TLS problems
sudo -H docker compose -p roomie-edge --env-file docker/edge/deploy.env \
  -f docker/edge/docker-compose.yml logs -f

# Reload edge routing after editing docker/edge/Caddyfile (no downtime)
sudo -H docker compose -p roomie-edge --env-file docker/edge/deploy.env \
  -f docker/edge/docker-compose.yml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`docker/deploy.env` and `docker/edge/deploy.env` are written by the deploy
(mode 600, untracked) because `sudo` strips the variables compose would
otherwise interpolate from its own environment.

## Local development

Local dev runs the same cluster definition with `docker-compose.local.yml`
instead of the deploy overlay: it publishes `:80` and `:8000` on the host and
points the app at DynamoDB Local. There is no edge proxy and no TLS —
`http://localhost` is a browser secure context, so service workers and the push
API still work. See [`../start.sh`](../start.sh).
