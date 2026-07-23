"""Move legacy book/chapter discussion posts into meeting-scoped forums."""

from __future__ import annotations

import uuid


MIGRATION_NAMESPACE = uuid.UUID("62c3c9c5-9d81-4cbc-9d9f-3d8b5ec5dddf")


def _meeting_for(post, meetings):
    candidates = [
        meeting
        for meeting in meetings
        if meeting.get("groupId") == post.get("groupId")
        and meeting.get("bookId") == post.get("bookId")
    ]
    if not candidates:
        return None
    created_at = int(post.get("createdAt", 0))
    existing = [
        meeting
        for meeting in candidates
        if int(meeting.get("createdAt", meeting.get("scheduledAt", 0))) <= created_at
    ]
    return max(
        existing,
        key=lambda meeting: int(
            meeting.get("createdAt", meeting.get("scheduledAt", 0))
        ),
        default=min(
            candidates,
            key=lambda meeting: int(
                meeting.get("createdAt", meeting.get("scheduledAt", 0))
            ),
        ),
    )


def _target_id(post, meeting_id):
    meeting_key = meeting_id.split("#", 1)[-1]
    stable = uuid.uuid5(MIGRATION_NAMESPACE, f"{post['groupId']}:{post['id']}").hex
    return f"forum#{meeting_key}#{int(post.get('createdAt', 0)):013d}#{stable}"


def run(ctx) -> None:
    table = ctx.table("book-club")
    rows = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        rows.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    meetings = [
        row
        for row in rows
        if row.get("id", "").startswith(("meeting#", "session#"))
    ]
    posts = [row for row in rows if row.get("id", "").startswith("post#")]
    assignments = {}
    skipped = []
    post_keys = {(post["groupId"], post["id"]) for post in posts}

    # Assign roots first because DynamoDB scans do not guarantee parents appear
    # before replies. Replies must always inherit the parent's meeting.
    roots = [
        post
        for post in posts
        if not post.get("parentPostId")
        or (post["groupId"], post["parentPostId"]) not in post_keys
    ]
    replies = [post for post in posts if post not in roots]
    for post in roots:
        meeting = _meeting_for(post, meetings)
        if meeting is None:
            skipped.append(post["id"])
            continue
        assignments[(post["groupId"], post["id"])] = {
            "meetingId": meeting["id"],
            "targetId": _target_id(post, meeting["id"]),
        }

    pending = replies
    while pending:
        next_pending = []
        progress = False
        for post in pending:
            parent_assignment = assignments.get(
                (post["groupId"], post.get("parentPostId"))
            )
            if parent_assignment is None:
                next_pending.append(post)
                continue
            assignments[(post["groupId"], post["id"])] = {
                "meetingId": parent_assignment["meetingId"],
                "targetId": _target_id(post, parent_assignment["meetingId"]),
            }
            progress = True
        if not progress:
            skipped.extend(post["id"] for post in next_pending)
            break
        pending = next_pending

    last_activity_by_root = {}
    for post in posts:
        parent = assignments.get(
            (post["groupId"], post.get("parentPostId"))
        )
        if parent:
            last_activity_by_root[parent["targetId"]] = max(
                last_activity_by_root.get(parent["targetId"], 0),
                int(post.get("updatedAt", post.get("createdAt", 0))),
            )

    migrated = 0
    for post in posts:
        assignment = assignments.get((post["groupId"], post["id"]))
        if assignment is None:
            continue
        parent = assignments.get(
            (post["groupId"], post.get("parentPostId"))
        )
        now = int(post.get("createdAt", 0))
        item = {
            "groupId": post["groupId"],
            "id": assignment["targetId"],
            "meetingId": assignment["meetingId"],
            "bookId": post.get("bookId"),
            "authorId": post.get("authorId"),
            "authorName": post.get("authorName", "Former member"),
            "body": post.get("body", ""),
            "createdAt": now,
            "updatedAt": int(post.get("updatedAt", now)),
            "lastActivityAt": max(
                int(post.get("updatedAt", now)),
                last_activity_by_root.get(assignment["targetId"], 0),
            ),
            "meetingForumMigrated": True,
            "meetingForumLegacyRecord": post,
        }
        if parent:
            item["parentPostId"] = parent["targetId"]
        else:
            item["title"] = post.get("chapterLabel") or "Book discussion"
        if "Item" not in table.get_item(
            Key={"groupId": post["groupId"], "id": assignment["targetId"]},
            ConsistentRead=True,
        ):
            table.put_item(Item=item)
        table.delete_item(Key={"groupId": post["groupId"], "id": post["id"]})
        migrated += 1

    print(
        f"Migrated {migrated} Book Club discussion post(s); "
        f"left {len(skipped)} orphaned post(s) unchanged."
    )
    if skipped:
        print("WARNING: No meeting was found for: " + ", ".join(sorted(skipped)))


if __name__ == "__main__":
    raise SystemExit(
        "Run migrations via infrastructure/migrations/runner.py --env <env>."
    )
