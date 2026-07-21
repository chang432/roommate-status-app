"""Restore account-level fields for membership rows created by this migration."""

from __future__ import annotations


def run(ctx) -> None:
    accounts = ctx.table()
    memberships = ctx.table("memberships")
    scan_kwargs = {}

    while True:
        response = memberships.scan(**scan_kwargs)
        for membership in response.get("Items", []):
            if not membership.get("migratedFromLegacyAccount"):
                continue
            accounts.update_item(
                Key={"id": membership["userId"]},
                UpdateExpression=(
                    "SET groupId = :groupId, #status = :status, statusText = :statusText, "
                    "statusUpdatedAt = :statusUpdatedAt"
                ),
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":groupId": membership["groupId"],
                    ":status": membership.get("status", "busy"),
                    ":statusText": membership.get("statusText", ""),
                    ":statusUpdatedAt": membership.get("statusUpdatedAt"),
                },
                ConditionExpression="attribute_exists(id)",
            )
            memberships.delete_item(
                Key={"groupId": membership["groupId"], "userId": membership["userId"]}
            )

        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
