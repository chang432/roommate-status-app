"""Move legacy account-level group/status fields into membership rows."""

from __future__ import annotations

import time

from botocore.exceptions import ClientError


def run(ctx) -> None:
    accounts = ctx.table()
    memberships = ctx.table("memberships")
    scan_kwargs = {}

    while True:
        response = accounts.scan(**scan_kwargs)
        for account in response.get("Items", []):
            group_id = account.get("groupId")
            if group_id:
                membership = {
                    "groupId": group_id,
                    "userId": account["id"],
                    "name": account["name"],
                    "status": account.get("status", "busy"),
                    "statusText": account.get("statusText", ""),
                    "statusUpdatedAt": account.get("statusUpdatedAt"),
                    "joinedAt": int(time.time() * 1000),
                    # Lets revert restore only rows created by this migration.
                    "migratedFromLegacyAccount": True,
                }
                try:
                    memberships.put_item(
                        Item=membership,
                        ConditionExpression="attribute_not_exists(groupId) AND attribute_not_exists(userId)",
                    )
                except ClientError as err:
                    if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                        raise

            # New accounts no longer own any group-specific state. Removal is
            # safe to repeat after an interrupted scan.
            accounts.update_item(
                Key={"id": account["id"]},
                UpdateExpression="REMOVE groupId, #status, statusText, statusUpdatedAt",
                ExpressionAttributeNames={"#status": "status"},
                ConditionExpression="attribute_exists(id)",
            )

        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
