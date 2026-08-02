#!/usr/bin/env python3
"""Populate the DynamoDB table with the initial household roster.

Run once after the table is created (see infrastructure/). Idempotent: existing
roommates are left untouched, so it is safe to re-run.

    python seed.py

Uses the same configuration as the app: ROOMMATE_TABLE for the table name and
the standard AWS config chain for region/credentials.
"""

from __future__ import annotations

import os
import book_club
import db
import groups

BOOK_CLUB_GROUP_ID = "book-club"
BOOK_CLUB_GROUP_NAME = "Book Club"
BOOK_CLUB_GROUP_JOIN_CODE = "BOOKCLUB"


def seed_local_groups() -> None:
    """Seed the two local households used to exercise component visibility.

    Yorkshire remains the broad household example, while Book Club isolates the
    new card. Accounts are shared deliberately: Andre can switch between the
    groups, and Kayla demonstrates a non-admin Book Club member.
    """
    groups.ensure_default_group()
    groups.set_display_options(
        "andre", db.DEFAULT_GROUP_ID, show_roster=True, show_feed=True, show_book_club=False
    )
    groups.ensure_seed_group(
        BOOK_CLUB_GROUP_ID,
        BOOK_CLUB_GROUP_NAME,
        BOOK_CLUB_GROUP_JOIN_CODE,
        show_roster=False,
        show_feed=False,
        show_book_club=True,
    )
    for user_id, role in (("andre", db.ROLE_ADMIN), ("kayla", db.ROLE_MEMBER)):
        account = db.get_account_by_id(user_id)
        if account is None:
            raise RuntimeError(f"Seed account {user_id!r} is missing.")
        db.create_membership(user_id, BOOK_CLUB_GROUP_ID, account["name"], role=role)
        # create_membership intentionally leaves existing rows alone, so force
        # the fixture roles on reruns (Andre must remain the sole admin).
        db.set_membership_role(user_id, BOOK_CLUB_GROUP_ID, role)


def seed_local_book_club() -> None:
    """Create a local meeting, current title, and completed title for UI coverage."""
    if not os.environ.get("DYNAMODB_ENDPOINT"):
        return

    members = db.get_all(BOOK_CLUB_GROUP_ID)
    creator = next(member for member in members if member["id"] == "andre")
    seed_book = next(
        (
            book
            for book in book_club.list_books(BOOK_CLUB_GROUP_ID)
            if book["title"] == "The Fifth Season"
            and book["author"] == "N. K. Jemisin"
        ),
        None,
    )
    if seed_book is None:
        seed_book, error = book_club.add_book(
            BOOK_CLUB_GROUP_ID,
            members,
            {
                "title": "The Fifth Season",
                "author": "N. K. Jemisin",
                "bookOwnerId": "kayla",
            },
        )
        if error:
            raise RuntimeError(f"Could not seed Book Club book: {error}")

    meeting, error = book_club.create_meeting(
        BOOK_CLUB_GROUP_ID,
        members,
        creator,
        {
            "readingTarget": "Read through Chapter 9",
            "snackOwnerId": "andre",
            "scheduledAt": book_club.next_wednesday_evening(),
        },
    )
    if error and not error.startswith("Complete the open meeting"):
        raise RuntimeError(f"Could not seed Book Club: {error}")
    if meeting is None:
        meeting = book_club.summary(BOOK_CLUB_GROUP_ID, members)["openMeeting"]

    # The active book above plus this completed title make the local library
    # useful immediately, while stable ids keep repeated seeds safe.
    book_club._get_table().put_item(Item={
        "groupId": BOOK_CLUB_GROUP_ID,
        "id": "book#a-psalm-for-the-wild-built",
        "bookId": "a-psalm-for-the-wild-built",
        "title": "A Psalm for the Wild-Built",
        "author": "Becky Chambers",
        "bookOwnerId": "andre",
        "bookOwnerName": "Andre",
        "completedAt": book_club._now() - 14 * 24 * 60 * 60 * 1000,
        "createdAt": book_club._now() - 28 * 24 * 60 * 60 * 1000,
        "updatedAt": book_club._now() - 14 * 24 * 60 * 60 * 1000,
    })
    completed_book_id = "a-psalm-for-the-wild-built"
    book_club.set_review(
        BOOK_CLUB_GROUP_ID,
        completed_book_id,
        creator,
        5,
        True,
        "Hopeful, compact, and perfect for a group conversation.",
    )


def main() -> int:
    db.seed()
    seed_local_groups()
    seed_local_book_club()
    roommates = db.get_all(db.DEFAULT_GROUP_ID)
    print(f"Table '{db.TABLE_NAME}' now has {len(roommates)} roommate(s):")
    for r in roommates:
        print(f"  - {r['id']}: {r['name']} ({r['status']})")
    book_club_members = db.get_all(BOOK_CLUB_GROUP_ID)
    print(
        f"Seeded group '{BOOK_CLUB_GROUP_ID}' now has "
        f"{len(book_club_members)} member(s):"
    )
    for member in book_club_members:
        print(f"  - {member['id']}: {member['name']} ({member['role']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
