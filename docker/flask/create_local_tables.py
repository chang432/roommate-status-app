#!/usr/bin/env python3
"""Create the app's DynamoDB tables in a local DynamoDB (DynamoDB Local).

Local development only. Production tables are provisioned by CloudFormation
(infrastructure/dynamodb-table-*.yaml); this script is the local stand-in for
that step, creating the same three tables in a DynamoDB Local instance so the
app can run with no AWS account.

It refuses to run unless DYNAMODB_ENDPOINT is set, so it can never create tables
in real AWS. Idempotent: a table that already exists is left as-is. Run after
DynamoDB Local is up and before seeding:

    DYNAMODB_ENDPOINT=http://localhost:8001 python create_local_tables.py

The three tables share one trivial schema — a single string hash key `id`,
on-demand billing — mirroring the CloudFormation templates (the extra prod-only
features there, like encryption and PITR, don't apply to a local instance).
"""

from __future__ import annotations

import os

import activities
import db
import push


def main() -> int:
    if not os.environ.get("DYNAMODB_ENDPOINT"):
        raise SystemExit(
            "Refusing to run: DYNAMODB_ENDPOINT is not set. This is a local-only "
            "helper; production tables are created by CloudFormation."
        )

    ddb = db.resource()
    existing = set(ddb.meta.client.list_tables()["TableNames"])

    # Table names come from the modules themselves so they stay in lockstep with
    # the app (and with ROOMMATE_TABLE / its -activities and -pushsubs suffixes).
    for name in (db.TABLE_NAME, activities.TABLE_NAME, push.TABLE_NAME):
        if name in existing:
            print(f"  table '{name}' already exists — leaving as-is")
            continue
        ddb.create_table(
            TableName=name,
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        ).wait_until_exists()
        print(f"  created table '{name}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
