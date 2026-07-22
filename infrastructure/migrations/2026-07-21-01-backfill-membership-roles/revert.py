"""Strip the backfilled `role` from the membership rows this migration wrote.

Only rows still carrying the `roleBackfilled` marker are touched, so a partially
applied forward run reverts cleanly and roles set by the live app survive. The
app reads a missing `role` as a plain member, so a reverted group simply has no
admins until the migration runs again.
"""

from __future__ import annotations

from botocore.exceptions import ClientError


def run(ctx) -> None:
    memberships = ctx.table("memberships")
    scan_kwargs = {}

    while True:
        response = memberships.scan(**scan_kwargs)
        for item in response.get("Items", []):
            if not item.get("roleBackfilled"):
                continue
            try:
                memberships.update_item(
                    Key={"groupId": item["groupId"], "userId": item["userId"]},
                    UpdateExpression="REMOVE #role, roleBackfilled",
                    ExpressionAttributeNames={"#role": "role"},
                    # Re-running finds no marker and is a no-op.
                    ConditionExpression="attribute_exists(roleBackfilled)",
                )
            except ClientError as err:
                if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise

        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev --revert <migration-id>"
    )
