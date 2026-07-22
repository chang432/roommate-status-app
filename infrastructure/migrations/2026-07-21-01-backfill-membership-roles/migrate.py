"""Backfill a `role` on every membership row that predates group admins.

Existing households have no recorded creator, so promoting one member by guess
would silently strip administration from everyone else. Instead every current
member becomes an admin and each group can demote its way down to the roster it
wants.
"""

from __future__ import annotations

from botocore.exceptions import ClientError


def run(ctx) -> None:
    memberships = ctx.table("memberships")
    scan_kwargs = {}

    while True:
        response = memberships.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if "role" in item:
                # Either already backfilled by an interrupted run, or written by
                # the deployed app after this migration started. Leave both be.
                continue
            try:
                memberships.update_item(
                    Key={"groupId": item["groupId"], "userId": item["userId"]},
                    # `role` is a DynamoDB reserved word.
                    UpdateExpression="SET #role = :role, roleBackfilled = :marker",
                    ExpressionAttributeNames={"#role": "role"},
                    ExpressionAttributeValues={":role": "admin", ":marker": True},
                    # The marker lets revert touch only rows this migration
                    # wrote; the condition keeps a re-run from clobbering a role
                    # the live app set between scan pages.
                    ConditionExpression="attribute_not_exists(#role)",
                )
            except ClientError as err:
                if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise

        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


if __name__ == "__main__":
    # Migrations are meant to run through the runner so the ledger and run-lock
    # stay consistent — never by executing this file directly.
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
