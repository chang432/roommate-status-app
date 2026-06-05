# Infrastructure

CloudFormation + a deploy script for the app's AWS resources.

| File                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `dynamodb-table-dev.yaml`  | CloudFormation template: the **dev** table (`RoommateStatus-dev`)  |
| `dynamodb-table-main.yaml` | CloudFormation template: the **main** table (`RoommateStatus-main`) |
| `deploy.py`                | Creates/updates a stack via boto3 and prints outputs           |
| `requirements.txt`         | Python deps (`boto3`)                                          |

## DynamoDB tables

There are two independent deployments, each with its own template and its own
table so dev and main can never share data:

| Deployment | Template                   | Stack                  | Table                 |
| ---------- | -------------------------- | ---------------------- | --------------------- |
| `dev`      | `dynamodb-table-dev.yaml`  | `roomie-dynamodb-dev`  | `RoommateStatus-dev`  |
| `main`     | `dynamodb-table-main.yaml` | `roomie-dynamodb-main` | `RoommateStatus-main` |

Each table holds one item per roommate, keyed by a string `id` (e.g.
`"jordan"`). Other attributes (`name`, `status`, `statusText`) are schemaless
and written by the app. Both are configured with on-demand billing, encryption
at rest, and point-in-time recovery, and are retained on stack deletion
(`DeletionPolicy: Retain`).

## Deploy

Assumes AWS credentials are already configured locally (env vars, shared
credentials file, or an SSO/instance profile — whatever boto3 resolves).

```bash
cd infrastructure
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Pick the deployment — this selects the template, stack name, and table.
python deploy.py --deployment dev
python deploy.py --deployment main

# Optionally override the region or stack name:
python deploy.py --deployment main --region us-east-1
```

The script creates the stack if it doesn't exist, updates it otherwise (a no-op
update is reported, not failed), waits for completion, and prints the table
name and ARN.

### Options

| Flag           | Default                  | Description                                  |
| -------------- | ------------------------ | -------------------------------------------- |
| `--deployment` | _(required)_             | `dev` or `main` — selects template + stack   |
| `--stack-name` | per deployment           | Override the CloudFormation stack name       |
| `--template`   | per deployment           | Override the template path                   |
| `--region`     | from AWS config          | Target AWS region                            |
