# Infrastructure

CloudFormation + a deploy script for the app's AWS resources.

| File                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `dynamodb-table-dev.yaml`  | CloudFormation template: the **dev** tables (`RoommateStatus-dev` + `-pushsubs` + `-activities`)  |
| `dynamodb-table-main.yaml` | CloudFormation template: the **main** tables (`RoommateStatus-main` + `-pushsubs` + `-activities`) |
| `deploy.py`                | Creates/updates a stack via boto3 and prints outputs           |
| `requirements.txt`         | Python deps (`boto3`)                                          |
| `docker-compose.dynamodb-local.yml` | Local-dev only: in-memory DynamoDB Local + a one-off table-creator (the local stand-in for the CloudFormation tables) |
| `create-tables.sh`         | Local-dev only: creates the tables in DynamoDB Local (run by the compose file above) |

## DynamoDB tables

There are two independent deployments, each with its own template and stack so
dev and main can never share data. Each stack provisions **three** tables — the
roommate table, a Web Push subscriptions table, and a proposed-activities table:

| Deployment | Stack                  | Roommate table        | Push subscriptions table       | Activities table                |
| ---------- | ---------------------- | --------------------- | ------------------------------ | ------------------------------- |
| `dev`      | `roomie-dynamodb-dev`  | `RoommateStatus-dev`  | `RoommateStatus-dev-pushsubs`  | `RoommateStatus-dev-activities`  |
| `main`     | `roomie-dynamodb-main` | `RoommateStatus-main` | `RoommateStatus-main-pushsubs` | `RoommateStatus-main-activities` |

The roommate table holds one item per roommate, keyed by a string `id` (e.g.
`"jordan"`); other attributes (`name`, `status`, `statusText`) are schemaless
and written by the app. The push subscriptions table holds one item per browser
Web Push subscription, keyed by a hash of the push endpoint (see
`docker/flask/push.py`). The activities table holds one item per proposed
activity, keyed by a generated id (see `docker/flask/activities.py`). All tables
use on-demand billing, encryption at rest, and point-in-time recovery, and are
retained on stack deletion (`DeletionPolicy: Retain`).

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

## Local development (no AWS account)

`./start.sh` (repo root) runs the whole stack against an **in-memory DynamoDB
Local** instead of real AWS, so contributors need no credentials or deployed
stacks. The wiring lives here next to the templates it stands in for:

- `docker-compose.dynamodb-local.yml` — a `dynamodb-local` service (published on
  host port **8001**) and a one-off `dynamodb-init` service (the `amazon/aws-cli`
  image) that runs `create-tables.sh`. `start.sh` merges this file (`-f`) into
  the app's compose project and also sets `DYNAMODB_ENDPOINT`, which is the only
  switch that points the Flask app at the local DB; without it the app uses real
  DynamoDB unchanged.
- `create-tables.sh` — creates the three tables (same single-`id`-key schema as
  the templates) in DynamoDB Local. Idempotent; refuses to run unless
  `DYNAMODB_ENDPOINT` is set, so it can never touch real AWS.

Because the local instance is in-memory, the tables are recreated and reseeded
on every `start.sh` run. The prod-only template features (encryption, PITR,
retention) don't apply locally and are intentionally omitted.

### Options

| Flag           | Default                  | Description                                  |
| -------------- | ------------------------ | -------------------------------------------- |
| `--dev`        | _(default)_              | Select the dev deployment (template + stack) |
| `--main`       |                          | Select the main deployment (template + stack) |
| `--stack-name` | per deployment           | Override the CloudFormation stack name       |
| `--template`   | per deployment           | Override the template path                   |
| `--region`     | from AWS config          | Target AWS region                            |
