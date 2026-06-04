# Infrastructure

CloudFormation + a deploy script for the app's AWS resources.

| File                   | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `dynamodb-table.yaml`  | CloudFormation template: a DynamoDB table for roommates  |
| `deploy.py`            | Creates/updates the stack via boto3 and prints outputs   |
| `requirements.txt`     | Python deps (`boto3`)                                     |

## DynamoDB table

One item per roommate, keyed by a string `id` (e.g. `"jordan"`). Other
attributes (`name`, `status`, `statusText`) are schemaless and written by the
app. Configured with on-demand billing, encryption at rest, and point-in-time
recovery. The table is retained on stack deletion (`DeletionPolicy: Retain`).

## Deploy

Assumes AWS credentials are already configured locally (env vars, shared
credentials file, or an SSO/instance profile — whatever boto3 resolves).

```bash
cd infrastructure
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Defaults: stack "roomie-dynamodb", table "RoommateStatus", env "dev"
python deploy.py

# Or customize:
python deploy.py --stack-name roomie-prod --table-name RoommateStatus \
    --environment prod --region us-east-1
```

The script creates the stack if it doesn't exist, updates it otherwise (a no-op
update is reported, not failed), waits for completion, and prints the table
name and ARN.

### Options

| Flag             | Default            | Description                          |
| ---------------- | ------------------ | ------------------------------------ |
| `--stack-name`   | `roomie-dynamodb`  | CloudFormation stack name            |
| `--template`     | `dynamodb-table.yaml` | Template path                     |
| `--table-name`   | `RoommateStatus`   | DynamoDB table name                  |
| `--environment`  | `dev`              | `dev` / `staging` / `prod` tag       |
| `--region`       | from AWS config    | Target AWS region                    |
