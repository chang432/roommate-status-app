#!/bin/sh
# Create the app's DynamoDB tables in a local DynamoDB (DynamoDB Local).
#
# Local-dev stand-in for the CloudFormation templates in this folder
# (dynamodb-table-{dev,main}.yaml). Runs inside the amazon/aws-cli container
# wired up by docker-compose.dynamodb-local.yml, reading DYNAMODB_ENDPOINT and
# ROOMMATE_TABLE from the environment. Idempotent — existing tables are left
# as-is. It only ever targets DynamoDB Local: DYNAMODB_ENDPOINT must be set, so
# it can't create tables in real AWS.
set -eu

: "${DYNAMODB_ENDPOINT:?DYNAMODB_ENDPOINT must be set (local-only helper)}"
: "${ROOMMATE_TABLE:?ROOMMATE_TABLE must be set}"

# The app derives these three names from ROOMMATE_TABLE — see
# docker/flask/{db,activities,push}.py. Keep the -activities / -pushsubs
# suffixes in sync with those modules (and with the CloudFormation templates
# here). All three share one trivial schema: a single string hash key `id`,
# on-demand billing — the prod-only knobs in CFN (encryption, PITR, retention)
# don't apply to a throwaway local instance.
for table in \
  "$ROOMMATE_TABLE" \
  "$ROOMMATE_TABLE-activities" \
  "$ROOMMATE_TABLE-pushsubs"
do
  if aws dynamodb describe-table \
      --table-name "$table" \
      --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
    echo "  table '$table' already exists — leaving as-is"
    continue
  fi
  aws dynamodb create-table \
    --table-name "$table" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$table'"
done
