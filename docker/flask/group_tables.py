"""Shared access helpers for the group-partitioned feed tables.

The activity, request, checklist, show, and comment-like tables are all keyed
``(groupId HASH, id RANGE)``: every feed read is "give me one group's rows", so
the group is the partition and a Query replaces what used to be a whole-table
Scan. Two things follow from that key choice, and both are why the modules share
this helper rather than each rolling their own:

* **Tenant isolation is structural.** A caller can only ever address rows inside
  the group it names, so the modules no longer filter by ``groupId`` in Python
  and no longer carry ``groupId = :groupId`` condition expressions — a missed
  check can't leak another household's rows.
* **Strong consistency stays available.** A base-table Query supports
  ``ConsistentRead``; a global secondary index does not. The routes re-read the
  feed right after a write so the caller sees their own change immediately, so
  querying the base table (not an index) is what keeps that guarantee.

Configuration and the boto3 Table objects stay with each owning module; this
file only owns the paging query shared between them.
"""

from __future__ import annotations

from boto3.dynamodb.conditions import Key


def query_group(table, group_id: str, consistent: bool = False) -> list[dict]:
    """Return every row in one group's partition, following pagination.

    Pass ``consistent=True`` for the read that follows a write (the response a
    mutation route returns), so the caller always sees their own change; the
    plain GET feed is fine on the cheaper eventually-consistent default.
    """
    if not group_id:
        return []
    kwargs = {
        "KeyConditionExpression": Key("groupId").eq(group_id),
        "ConsistentRead": consistent,
    }
    items: list[dict] = []
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key


def query_group_prefix(
    table, group_id: str, id_prefix: str, consistent: bool = False
) -> list[dict]:
    """Return rows belonging to one parent record within a group partition.

    Child records use a stable, parent-prefixed sort key. Keeping the lookup as
    a Query means a checklist or show never has to read unrelated child rows
    just to render its own members.
    """
    if not group_id:
        return []
    kwargs = {
        "KeyConditionExpression": Key("groupId").eq(group_id) & Key("id").begins_with(id_prefix),
        "ConsistentRead": consistent,
    }
    items: list[dict] = []
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key
