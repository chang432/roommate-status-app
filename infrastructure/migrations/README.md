# DynamoDB data migrations

In-place data changes to **existing** rows in the app's DynamoDB tables —
backfilling a newly-required attribute, renaming/reshaping an attribute,
transforming an embedded shape, splitting/merging items. Table *structure*
(keys, indexes) is provisioned separately by CloudFormation
(`../dynamodb-table-{dev,main}.yaml` via `../deploy.py`); this system handles the
*data*.

Purely additive, optional attributes written only going forward do **not** need
a migration — only changes that must touch rows already in the table do.

## Layout

```
migrations/
  runner.py            # applies pending migrations / --status / --dry-run / --revert
  _template/           # copy this to author a migration (ignored by the runner)
    migrate.py         # def run(ctx): forward, in-place change
    revert.py          # def run(ctx): undo it
    status.md          # human docs (NOT the source of truth for run state)
  YYYY-MM-DD-NN-slug/  # each migration, e.g. 2026-07-10-01-backfill-updatedAt
```

Folders/files starting with `_` are ignored, so `_template/` never runs. Dated
`YYYY-MM-DD-NN` prefixes sort into apply order; `NN` disambiguates same-day
migrations.

## Authoring

1. `cp -r _template <YYYY-MM-DD-NN-slug>` and fill in `migrate.py::run`,
   `revert.py::run`, and `status.md`.
2. `ctx` (a `MigrationContext`) is the only surface migrations use:
   - `ctx.env` → `"dev"` / `"prod"`
   - `ctx.table_prefix` → `"RoommateStatus-dev"` / `"RoommateStatus-main"`
   - `ctx.table(suffix="")` → boto3 `Table`; e.g. `ctx.table("activities")`, or
     no suffix for the base roommate table.
3. Make `migrate.py` **idempotent and resumable** (page with `scan` +
   `LastEvaluatedKey`, only touch rows that still need it) — a run can die
   partway and must be safe to re-run. `revert.py` must tolerate a
   partially-applied state. PITR is enabled on every table as the backstop.
4. Update the schema docs (`../db_schema/{dev,prod}/`) in the **same change**.

## Run state (source of truth)

Whether a migration has run on an environment is recorded in the
`RoommateStatus-{dev,main}-migrations` DynamoDB table — one ledger item per
migration, plus a transient `lock#<env>` item held during a run. This table,
**not** `status.md` and not any committed file, is authoritative: it survives the
pipeline's `git reset --hard` and needs no CI push-back. It is owned by
CloudFormation; provision it once per environment with
`cd infrastructure && python deploy.py --dev` (or `--main`) before the first
migration.

## Running

Credentials/region come from the standard AWS chain (env vars / `~/.aws`), like
`deploy.py`. The runner only needs `boto3` (`../requirements.txt`); it reuses the
app's `docker/flask/aws.py` factory.

```bash
python runner.py --env dev              # apply all pending, in order
python runner.py --env prod --status    # list applied vs pending; change nothing
python runner.py --env dev --dry-run    # alias for --status
python runner.py --env dev --revert 2026-07-10-01-backfill-updatedAt
```

On apply, each pending migration runs in order; on **any** exception the runner
runs that migration's `revert.py`, records it `failed`, and exits non-zero.
Already-applied earlier migrations are left in place.

## Pipeline

`.github/workflows/on_merge_{dev,main}.yml` run the runner in a `migrate-db` job
that the deploy job `needs:`, so migrations apply **before** the app is
redeployed and a failure blocks the deploy. The runner is a no-op when nothing is
pending, so it always runs — you never wire a migration into CI by hand.

## Tests

```bash
cd infrastructure/migrations
../../docker/flask/.venv/bin/python -m pytest   # moto-mocked; no AWS needed
```
