"""Backfill a `role` on every membership row that predates group admins.

Existing households never recorded a creator, so the admin is assigned by hand:
the `andre` account administers every group it belongs to and everyone else
becomes a plain member. Any group `andre` is not a member of therefore ends up
with **no** admin — the run prints those so they can be granted one deliberately.
"""

from __future__ import annotations

from botocore.exceptions import ClientError

# The account that administers every pre-existing group.
ADMIN_USER_ID = "andre"


def run(ctx) -> None:
    memberships = ctx.table("memberships")
    scan_kwargs = {}
    # Groups seen, and those that end up with an admin — including rows the live
    # app already wrote, so the warning reflects the table's real end state.
    seen_groups: set[str] = set()
    groups_with_admin: set[str] = set()

    while True:
        response = memberships.scan(**scan_kwargs)
        for item in response.get("Items", []):
            group_id, user_id = item["groupId"], item["userId"]
            seen_groups.add(group_id)

            if "role" in item:
                # Either already backfilled by an interrupted run, or written by
                # the deployed app after this migration started. Leave both be.
                if item["role"] == "admin":
                    groups_with_admin.add(group_id)
                continue

            role = "admin" if user_id == ADMIN_USER_ID else "member"
            try:
                memberships.update_item(
                    Key={"groupId": group_id, "userId": user_id},
                    # `role` is a DynamoDB reserved word.
                    UpdateExpression="SET #role = :role, roleBackfilled = :marker",
                    ExpressionAttributeNames={"#role": "role"},
                    ExpressionAttributeValues={":role": role, ":marker": True},
                    # The marker lets revert touch only rows this migration
                    # wrote; the condition keeps a re-run from clobbering a role
                    # the live app set between scan pages.
                    ConditionExpression="attribute_not_exists(#role)",
                )
            except ClientError as err:
                if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
                continue
            if role == "admin":
                groups_with_admin.add(group_id)

        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    orphaned = sorted(seen_groups - groups_with_admin)
    print(f"  roles backfilled across {len(seen_groups)} group(s); admin = {ADMIN_USER_ID!r}.")
    if orphaned:
        # Not fatal: nobody loses access, but these groups cannot remove members
        # or grant admin until someone is promoted out of band.
        print(f"  WARNING: {len(orphaned)} group(s) have no admin: {', '.join(orphaned)}")


if __name__ == "__main__":
    # Migrations are meant to run through the runner so the ledger and run-lock
    # stay consistent — never by executing this file directly.
    raise SystemExit(
        "Run migrations via the runner, e.g.:\n"
        "    python infrastructure/migrations/runner.py --env dev"
    )
