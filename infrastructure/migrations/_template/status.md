# Migration: <YYYY-MM-DD-NN-slug>

> **Documentation only.** Whether this migration has actually run on dev/prod is
> tracked in the `RoommateStatus-{dev,main}-migrations` DynamoDB table, not here.
> Check real state with `python infrastructure/migrations/runner.py --env <env> --status`.

## What it changes
<!-- Which table(s) and attribute(s); the before → after shape. -->

## Why
<!-- The data-model change this backs, and a link to the schema-doc update. -->

## Forward (migrate.py)
<!-- What the forward pass does; why it is idempotent/resumable. -->

## Reverse (revert.py)
<!-- What the reversal does; how it tolerates a partially-applied state. -->

## Risk / notes
<!-- Row-count estimate, runtime, whether the running app tolerates both shapes
     (expand/contract), and any manual step. PITR is the backstop. -->
