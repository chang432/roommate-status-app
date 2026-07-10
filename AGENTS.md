# IMPORTANT 
For every prompt, first run a filesystem scan for AGENTS*.md / *.md in this directory and load every match into context.

# General
Do not end a coding turn with uncommitted tracked changes unless the user asked for no commit.
If you choose not to commit, you must state why in the final response.

If you modify tracked files, you must 
(a) run relevant linting, checks, and tests
(b) commit only relevant files
(c) include commit hash in final response, unless user explicitly says not to commit.

When adding new or significantly changed logic, include concise comments where behavior is non-obvious so future maintainers can quickly understand intent.

If any requested feature doesn't make sense in terms of the existing code structure or you can think of a better way to do it, then prompt me about it first.

## Collaboration
- If you need to edit a file that another agent appears to be actively working on, skip that file temporarily and continue with any other changes that do not conflict with the other agent's in-flight work.
- After all other possible non-conflicting changes are complete, wait a short, reasonable amount of time for that work to finish before editing the file yourself.
- Notify the user when you temporarily skip a file because another agent is using it, and notify the user again when you begin waiting on that file.
- If the wait timeout expires and the file is still in use, revert all changes from the current task and stop rather than risk conflicting edits.

## Modularity
- When making changes, prefer extending or extracting shared helpers/modules instead of duplicating logic across files.
- Before adding new logic, quickly check nearby components and `frontend/src/utils` for reusable functions and patterns.
- If the same or very similar logic appears in more than one place, consolidate it into a shared function/component and update callers.
- Keep modules focused on one responsibility so future changes can be made in one place.

## Forward-only Changes
- When implementing updates, avoid adding backward-compatibility paths for outdated code unless explicitly requested by the user.
- Choose one clear direction for the codebase and remove obsolete branches/toggles instead of preserving them behind flags.
- Do not introduce feature flags purely to keep legacy behavior available (for example, theme toggles like `isMonochrome`) unless the user asks for that behavior.

## Database Schema Docs
- The DynamoDB schema docs live under `db_schema/`: the `db_schema/dev/` folder covers the dev tables and `db_schema/prod/` the main (production) tables. These are the source of truth for the tables and must stay in sync with the code.
- Each folder holds one CSV per table (named for the table, e.g. `RoommateStatus-dev-shows.csv`) plus an `_overview.csv` with the legend, tables-at-a-glance, and common-settings grids. The multi-type activities CSV holds one grid per `itemType`. A grid is a title row, a header row of `attributeName (DynamoDBType)`, then example rows.
- Whenever you change the data model, update **both** the dev and prod folders in the same change. This includes: adding/removing a table or index, changing a partition/sort key, adding/removing/renaming an item attribute, adding a new `itemType` to the shared activities table, or changing an embedded shape (e.g. a show's `members`, a checklist's `items`). Adding or removing a table means adding or removing its CSV in both folders and updating each `_overview.csv`.
- Treat both the CloudFormation templates (`infrastructure/dynamodb-table-{dev,main}.yaml`) and the Flask modules that write items (`docker/flask/*.py`) as inputs — the docs describe keys/indexes from the templates and effective attributes from the code.
- Keep the two folders parallel (they differ only by the `-dev` / `-main` table-name prefix and the environment label in `_overview.csv`) and refresh the affected header columns and example rows so they match reality.
- Preserve the CSV conventions: an empty cell means the attribute is absent from the item, the literal `null` means the DynamoDB `NULL` type, and `SS` / `L` / `M` values are written as JSON inside a single quoted cell.