"""Propagate an account display-name change through denormalized snapshots.

User IDs are immutable and remain the authority. Display names are duplicated
beside those IDs for fast feed reads, so profile renames rewrite only snapshots
whose companion ID matches the account being changed.
"""

from __future__ import annotations

from botocore.exceptions import ClientError

import activities
import book_club
import db
import household_checklists
import household_polls
import household_requests
import household_shows
import jam


ID_NAME_PAIRS = (
    ("proposedById", "proposedBy"),
    ("requesterId", "requester"),
    ("createdById", "createdBy"),
    ("createdById", "createdByName"),
    ("authorId", "author"),
    ("archivedById", "archivedBy"),
    ("restoredById", "restoredBy"),
    ("hostId", "hostName"),
    ("bookOwnerId", "bookOwnerName"),
    ("snackOwnerId", "snackOwnerName"),
    ("completedById", "completedByName"),
    ("watchpartyStartedById", "watchpartyStartedBy"),
    ("addedById", "addedBy"),
    ("userId", "userName"),
    ("userId", "name"),
)
NAME_MAP_FIELDS = {
    "checkedNamesById",
    "requestedNamesById",
    "voterNamesById",
    "memberNamesById",
}


def _rewrite(value, user_id: str, old_name: str, new_name: str):
    if isinstance(value, list):
        return [_rewrite(item, user_id, old_name, new_name) for item in value]
    if not isinstance(value, dict):
        return value

    rewritten = {
        key: _rewrite(item, user_id, old_name, new_name)
        for key, item in value.items()
    }
    for id_field, name_field in ID_NAME_PAIRS:
        if rewritten.get(id_field) == user_id and name_field in rewritten:
            rewritten[name_field] = new_name
    # Mentions and other compact person snapshots use the generic id/name pair.
    if rewritten.get("id") == user_id and "name" in rewritten:
        rewritten["name"] = new_name
    for field in NAME_MAP_FIELDS:
        names = rewritten.get(field)
        if isinstance(names, dict) and user_id in names:
            rewritten[field] = {**names, user_id: new_name}

    member_ids = rewritten.get("memberIds")
    members = rewritten.get("members")
    if isinstance(member_ids, (set, list)) and user_id in member_ids and isinstance(members, set):
        # Legacy activities keep a parallel set of names. IDs decide ownership;
        # replacing the old string is safe and remains idempotent on retries.
        rewritten["members"] = (members - {old_name}) | {new_name}
    return rewritten


def _key_for(item: dict, *, range_key: bool = True) -> dict:
    return (
        {"groupId": item["groupId"], "id": item["id"]}
        if range_key
        else {"id": item["id"]}
    )


def _update_item(table, item: dict, user_id: str, old_name: str, new_name: str, *, range_key=True):
    """Conditionally replace only changed top-level attributes.

    Embedded comments/options require read-modify-write. Conditioning on their
    previous value prevents a concurrent mutation from being overwritten; the
    caller rereads and retries that row when the condition loses the race.
    """
    key = _key_for(item, range_key=range_key)
    current = item
    for _ in range(5):
        rewritten = _rewrite(current, user_id, old_name, new_name)
        changed = [field for field in current if rewritten.get(field) != current[field]]
        if not changed:
            return
        names = {f"#f{index}": field for index, field in enumerate(changed)}
        new_values = {f":n{index}": rewritten[field] for index, field in enumerate(changed)}
        old_values = {f":o{index}": current[field] for index, field in enumerate(changed)}
        try:
            table.update_item(
                Key=key,
                UpdateExpression="SET " + ", ".join(
                    f"#f{index} = :n{index}" for index in range(len(changed))
                ),
                ConditionExpression=" AND ".join(
                    f"#f{index} = :o{index}" for index in range(len(changed))
                ),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues={**new_values, **old_values},
            )
            return
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            current = table.get_item(Key=key, ConsistentRead=True).get("Item")
            if not current:
                return
    raise RuntimeError(f"Display-name snapshot stayed busy: {key}")


def _query_group(table, group_id: str) -> list[dict]:
    kwargs = {
        "KeyConditionExpression": "groupId = :groupId",
        "ExpressionAttributeValues": {":groupId": group_id},
        "ConsistentRead": True,
    }
    response = table.query(**kwargs)
    items = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = table.query(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


def _consistent_group_ids(user_id: str) -> list[str]:
    """Scan memberships so a just-created group cannot miss the rename.

    The normal user lookup uses an eventually consistent GSI. Profile changes
    are rare and correctness matters more than scan cost here.
    """
    table = db._get_memberships_table()
    kwargs = {
        "FilterExpression": "#userId = :userId",
        "ExpressionAttributeNames": {"#userId": "userId"},
        "ExpressionAttributeValues": {":userId": user_id},
        "ConsistentRead": True,
    }
    response = table.scan(**kwargs)
    group_ids = [item["groupId"] for item in response.get("Items", [])]
    while response.get("LastEvaluatedKey"):
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        group_ids.extend(item["groupId"] for item in response.get("Items", []))
    return sorted(set(group_ids))


def propagate_display_name(user_id: str, old_name: str, new_name: str) -> None:
    """Rewrite every current denormalized name snapshot for one account."""
    group_ids = _consistent_group_ids(user_id)
    partitioned_tables = (
        activities._get_table(),
        household_requests._get_table(),
        household_checklists._get_table(),
        household_polls._get_table(),
        household_shows._get_table(),
        book_club._get_table(),
    )
    for group_id in group_ids:
        db._get_memberships_table().update_item(
            Key={"groupId": group_id, "userId": user_id},
            UpdateExpression="SET #name = :name",
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={":name": new_name},
            ConditionExpression="attribute_exists(groupId) AND attribute_exists(userId)",
        )
        for table in partitioned_tables:
            for item in _query_group(table, group_id):
                _update_item(table, item, user_id, old_name, new_name)

        active_jam = jam._get_table().get_item(
            Key={"id": f"activeJam#{group_id}"}, ConsistentRead=True
        ).get("Item")
        if active_jam:
            _update_item(
                jam._get_table(), active_jam, user_id, old_name, new_name, range_key=False
            )
