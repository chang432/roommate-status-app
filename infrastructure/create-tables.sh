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

# Group-partitioned table: groupId partitions, id sorts. Matches the -v2 feed
# tables in the CloudFormation templates.
create_group_table() {
  table=$1

  if aws dynamodb describe-table \
      --table-name "$table" \
      --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
    echo "  table '$table' already exists — leaving as-is"
    return
  fi
  aws dynamodb create-table \
    --table-name "$table" \
    --attribute-definitions \
      AttributeName=groupId,AttributeType=S \
      AttributeName=id,AttributeType=S \
    --key-schema AttributeName=groupId,KeyType=HASH AttributeName=id,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$table'"
}

create_table "$ROOMMATE_TABLE" id
create_table "$ROOMMATE_TABLE-spotify-jam" id
# Data-migration ledger, so the migration runner can be exercised locally.
create_table "$ROOMMATE_TABLE-migrations" id

# The feed tables the app reads, keyed (groupId, id).
create_group_table "$ROOMMATE_TABLE-activities-v2"
create_group_table "$ROOMMATE_TABLE-requests-v2"
create_group_table "$ROOMMATE_TABLE-checklists-v2"
create_group_table "$ROOMMATE_TABLE-polls"
create_group_table "$ROOMMATE_TABLE-shows-v2"
create_group_table "$ROOMMATE_TABLE-comment-likes-v2"

if aws dynamodb describe-table \
    --table-name "$ROOMMATE_TABLE-counters" \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
  echo "  table '$ROOMMATE_TABLE-counters' already exists — leaving as-is"
else
  aws dynamodb create-table \
    --table-name "$ROOMMATE_TABLE-counters" \
    --attribute-definitions \
      AttributeName=groupId,AttributeType=S \
      AttributeName=id,AttributeType=S \
      AttributeName=counterKey,AttributeType=S \
      AttributeName=entrySort,AttributeType=S \
    --key-schema AttributeName=groupId,KeyType=HASH AttributeName=id,KeyType=RANGE \
    --global-secondary-indexes '[
      {
        "IndexName":"CounterHistoryIndex",
        "KeySchema":[
          {"AttributeName":"counterKey","KeyType":"HASH"},
          {"AttributeName":"entrySort","KeyType":"RANGE"}
        ],
        "Projection":{"ProjectionType":"ALL"}
      }
    ]' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$ROOMMATE_TABLE-counters'"
fi

# Book Club is group-partitioned too, with a bookId index for a book's related
# records. Configuration and member-response rows omit bookId; meeting forums
# carry it for historical context but are read by meeting-key prefix.
if aws dynamodb describe-table \
    --table-name "$ROOMMATE_TABLE-book-club" \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
  echo "  table '$ROOMMATE_TABLE-book-club' already exists — leaving as-is"
else
  aws dynamodb create-table \
    --table-name "$ROOMMATE_TABLE-book-club" \
    --attribute-definitions \
      AttributeName=groupId,AttributeType=S \
      AttributeName=id,AttributeType=S \
      AttributeName=bookId,AttributeType=S \
    --key-schema AttributeName=groupId,KeyType=HASH AttributeName=id,KeyType=RANGE \
    --global-secondary-indexes '[
      {
        "IndexName":"BookIdIndex",
        "KeySchema":[
          {"AttributeName":"bookId","KeyType":"HASH"},
          {"AttributeName":"id","KeyType":"RANGE"}
        ],
        "Projection":{"ProjectionType":"ALL"}
      }
    ]' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$ROOMMATE_TABLE-book-club'"
fi

if aws dynamodb describe-table \
    --table-name "$ROOMMATE_TABLE-pushsubs" \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
  echo "  table '$ROOMMATE_TABLE-pushsubs' already exists — leaving as-is"
else
  aws dynamodb create-table \
    --table-name "$ROOMMATE_TABLE-pushsubs" \
    --attribute-definitions \
      AttributeName=id,AttributeType=S \
      AttributeName=userId,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --global-secondary-indexes '[
      {
        "IndexName":"UserIdIndex",
        "KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],
        "Projection":{"ProjectionType":"ALL"}
      }
    ]' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$ROOMMATE_TABLE-pushsubs'"
fi
if aws dynamodb describe-table \
    --table-name "$ROOMMATE_TABLE-groups" \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
  echo "  table '$ROOMMATE_TABLE-groups' already exists — leaving as-is"
else
  aws dynamodb create-table \
    --table-name "$ROOMMATE_TABLE-groups" \
    --attribute-definitions \
      AttributeName=groupId,AttributeType=S \
      AttributeName=joinCode,AttributeType=S \
    --key-schema AttributeName=groupId,KeyType=HASH \
    --global-secondary-indexes '[
      {
        "IndexName":"JoinCodeIndex",
        "KeySchema":[{"AttributeName":"joinCode","KeyType":"HASH"}],
        "Projection":{"ProjectionType":"ALL"}
      }
    ]' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$ROOMMATE_TABLE-groups'"
fi

if aws dynamodb describe-table \
    --table-name "$ROOMMATE_TABLE-memberships" \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null 2>&1; then
  echo "  table '$ROOMMATE_TABLE-memberships' already exists — leaving as-is"
else
  aws dynamodb create-table \
    --table-name "$ROOMMATE_TABLE-memberships" \
    --attribute-definitions \
      AttributeName=groupId,AttributeType=S \
      AttributeName=userId,AttributeType=S \
    --key-schema AttributeName=groupId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
    --global-secondary-indexes '[
      {
        "IndexName":"UserIdIndex",
        "KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],
        "Projection":{"ProjectionType":"ALL"}
      }
    ]' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "$DYNAMODB_ENDPOINT" >/dev/null
  echo "  created table '$ROOMMATE_TABLE-memberships'"
fi
