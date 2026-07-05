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

# The prod-only CFN knobs (encryption, PITR, retention) don't apply to a
# throwaway local instance.
create_table() {
  table=$1
  partition_key=$2

  if aws dynamodb describe-table \
      --table-name "$table" \
      --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
    echo "  table '$table' already exists — leaving as-is"
    return
  fi
  aws dynamodb create-table \
    --table-name "$table" \
    --attribute-definitions AttributeName="$partition_key",AttributeType=S \
    --key-schema AttributeName="$partition_key",KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$table'"
}

create_table "$ROOMMATE_TABLE" id
create_table "$ROOMMATE_TABLE-activities" id
create_table "$ROOMMATE_TABLE-shows" id
create_table "$ROOMMATE_TABLE-pushsubs" id
create_table "$ROOMMATE_TABLE-groups" groupId
