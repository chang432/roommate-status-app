# Migration: 2026-07-13-01-add-group-memberships

Moves the legacy account-level `groupId`, `status`, `statusText`, and
`statusUpdatedAt` fields into `RoommateStatus-{dev,main}-memberships` rows.
Each membership is keyed by `groupId` and `userId`, so one account can have an
independent status in multiple groups.

The migration is resumable: existing membership rows are retained and account
fields are removed idempotently. Its reverse restores only membership rows this
migration created. Real apply state is in the migrations DynamoDB ledger.
