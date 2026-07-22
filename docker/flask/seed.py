#!/usr/bin/env python3
"""Populate the DynamoDB table with the initial household roster.

Run once after the table is created (see infrastructure/). Idempotent: existing
roommates are left untouched, so it is safe to re-run.

    python seed.py

Uses the same configuration as the app: ROOMMATE_TABLE for the table name and
the standard AWS config chain for region/credentials.
"""

from __future__ import annotations

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


def main() -> int:
    db.seed()
    seed_local_groups()
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
