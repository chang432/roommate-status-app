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


def main() -> int:
    db.seed()
    groups.ensure_default_group()
    roommates = db.get_all(db.DEFAULT_GROUP_ID)
    print(f"Table '{db.TABLE_NAME}' now has {len(roommates)} roommate(s):")
    for r in roommates:
        print(f"  - {r['id']}: {r['name']} ({r['status']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
