# Infrastructure

CloudFormation + a deploy script for the app's AWS resources.

| File                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `dynamodb-table-dev.yaml`  | CloudFormation template: the **dev** tables (`RoommateStatus-dev` + `-pushsubs` + `-activities` + `-shows` + `-groups` + `-migrations`)  |
| `dynamodb-table-main.yaml` | CloudFormation template: the **main** tables (`RoommateStatus-main` + `-pushsubs` + `-activities` + `-shows` + `-groups` + `-migrations`) |
| `deploy.py`                | Creates/updates a stack via boto3 and prints outputs           |
| `requirements.txt`         | Python deps (`boto3`) — used by `deploy.py` and `migrations/runner.py` |
| `migrations/`              | In-place DynamoDB **data** migrations + the runner (see `migrations/README.md`) |
| `db_schema/`               | Human-readable per-table schema CSVs for the dev and prod tables |
| `docker-compose.dynamodb-local.yml` | Local-dev only: in-memory DynamoDB Local + a one-off table-creator (the local stand-in for the CloudFormation tables) |
| `create-tables.sh`         | Local-dev only: creates the tables in DynamoDB Local (run by the compose file above) |

## DynamoDB tables

There are two independent deployments, each with its own template and stack so
dev and main can never share data. Each stack provisions **six** tables — the
roommate table, a groups table, a Web Push subscriptions table, a
proposed-activities table, a TV-show tracker table, and a data-migration ledger
(`-migrations`, written by `migrations/runner.py`, not the app):

| Deployment | Stack                  | Roommate table        | Groups table              | Push subscriptions table       | Activities table                | Shows table                | Migrations ledger              |
| ---------- | ---------------------- | --------------------- | ------------------------- | ------------------------------ | ------------------------------- | -------------------------- | ------------------------------ |
| `dev`      | `roomie-dynamodb-dev`  | `RoommateStatus-dev`  | `RoommateStatus-dev-groups`  | `RoommateStatus-dev-pushsubs`  | `RoommateStatus-dev-activities`  | `RoommateStatus-dev-shows`  | `RoommateStatus-dev-migrations`  |
| `main`     | `roomie-dynamodb-main` | `RoommateStatus-main` | `RoommateStatus-main-groups` | `RoommateStatus-main-pushsubs` | `RoommateStatus-main-activities` | `RoommateStatus-main-shows` | `RoommateStatus-main-migrations` |

Per-table keys, attributes, and example rows are documented under
[`db_schema/`](./db_schema): [`db_schema/dev/`](./db_schema/dev) for the dev
tables and [`db_schema/prod/`](./db_schema/prod) for the main tables. Each
folder holds one CSV per table (named for the table) plus an `_overview.csv`
with the legend, a tables-at-a-glance grid, and the common settings. Within a
CSV, a grid is a title row, a header row of `attributeName (DynamoDBType)`, then
example rows; the multi-type activities CSV has one grid per `itemType`. Open
them in a spreadsheet, or read them as text.

The roommate table holds one item per account, keyed by a string `id` (the
normalized username). Grouped accounts also appear as roommates; account and
status attributes (`username`, `name`, `passwordHash`, `groupId`, `status`,
`statusText`, `statusUpdatedAt`) are schemaless and written by the app. The groups table
holds one item per household, keyed by `groupId`, with a `joinCode` global
secondary index for reusable invite-code lookup. The push subscriptions
table holds one item per browser Web Push subscription, keyed by a hash of the
push endpoint and associated with a roommate `userId` (see
`docker/flask/push.py`). The activities table is multi-type: it holds activity
records plus typed checklist, household-request, and comment-like records, all
discriminated by an `itemType` attribute and scoped per group by `groupId`. The
shows table holds one item per tracked TV show, with watchers (and their season
/ episode) embedded on the item. Activity schedules and lifecycle timestamps are
schemaless attributes needing no secondary index or coordination record. The
migrations ledger records which in-place data migrations have run per
environment (see [Data migrations](#data-migrations) below). All tables use
on-demand billing, encryption at rest, and point-in-time recovery, and are
retained on stack deletion (`DeletionPolicy: Retain`).

## Data migrations

Table *structure* (keys, indexes) is provisioned by the CloudFormation templates
above. Changes that need *in-place updates to existing rows* — backfilling a new
attribute, reshaping an embedded field, splitting items — are handled separately
by the migration system in [`migrations/`](./migrations). Author a dated
migration folder (forward + reverse scripts) and, after redeploying the app, the
pipeline runs `deploy.py` to provision the tables and then applies any pending
migrations against the environment's tables. A failed migration is auto-reverted
and fails the job (but does not roll back the already-live deploy), so write
migrations backward-compatibly. Whether a migration has run is tracked in the
`-migrations` DynamoDB table, not a committed file. See
[`migrations/README.md`](./migrations/README.md) for the full workflow.

## Deploy

Assumes AWS credentials are already configured locally (env vars, shared
credentials file, or an SSO/instance profile — whatever boto3 resolves).

```bash
cd infrastructure
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Pick the deployment — this selects the template, stack name, and table.
# Defaults to dev when no flag is given.
python deploy.py          # same as --dev
python deploy.py --main

# Optionally override the region or stack name:
python deploy.py --main --region us-east-1
```

The script creates the stack if it doesn't exist, updates it otherwise (a no-op
update is reported, not failed), waits for completion, and prints the table
name and ARN.

### Options

| Flag           | Default                  | Description                                  |
| -------------- | ------------------------ | -------------------------------------------- |
| `--dev`        | _(default)_              | Select the dev deployment (template + stack) |
| `--main`       |                          | Select the main deployment (template + stack) |
| `--stack-name` | per deployment           | Override the CloudFormation stack name       |
| `--template`   | per deployment           | Override the template path                   |
| `--region`     | from AWS config          | Target AWS region                            |

## Local development (no AWS account)

For local dev the app runs against an **in-memory DynamoDB Local** instead of
real AWS, so contributors need no credentials or deployed stacks. It's a
**standalone compose project** (`roomie-infra`) that can be run and reused
independently of the app; the two are joined only by a shared network and the
table-name / key-schema contract.

| File | Purpose |
| ---- | ------- |
| `docker-compose.dynamodb-local.yml` | `dynamodb-local` (in-memory, host port **8001**) + a one-off `dynamodb-init` service (`amazon/aws-cli`) that runs `create-tables.sh`. Both attach to the external `roomie-shared` network. |
| `create-tables.sh` | Creates the three tables (same single-`id`-key schema as the templates) in DynamoDB Local. Idempotent; refuses to run unless `DYNAMODB_ENDPOINT` is set, so it can never touch real AWS. |

`./start.sh` (repo root) drives both projects for you. To run just this module:

```bash
docker network create roomie-shared        # once; shared with the app
docker compose -p roomie-infra -f infrastructure/docker-compose.dynamodb-local.yml up -d
docker compose -p roomie-infra -f infrastructure/docker-compose.dynamodb-local.yml \
    --profile init run --rm dynamodb-init   # create the tables
```

The app reaches it on the shared network at `dynamodb-local:8000`; setting
`DYNAMODB_ENDPOINT` (in `docker/docker-compose.local.yml`) is the only switch
that points the app at the local DB — without it the app uses real DynamoDB,
unchanged. The instance is in-memory, so tables are recreated and reseeded on
every run; the prod-only template features (encryption, PITR, retention) don't
apply locally and are intentionally omitted.
