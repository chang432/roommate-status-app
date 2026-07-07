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

## Design Docs
- Any design or research doc requested by the user must be created as a concise Markdown file in the root `docs` directory.
- If a design doc researches, recommends, or depends on any external paid service, include a cost estimate section.
- If the proposed solution depends on external console setup, secret management, approvals, account access, or other manual actions the agent cannot complete, include a `Manual Setup Required From Owner` section.
- That section should list the concrete owner tasks still needed, such as cloud/OAuth console configuration, domain/redirect setup, secret provisioning, account verification/publishing steps, policy decisions, or real-browser consent/testing.

## Database Schema Docs
- The DynamoDB schema docs `infrastructure/dynamodb-schema-dev.md` and `infrastructure/dynamodb-schema-main.md` are the source of truth for the tables and must stay in sync with the code.
- Whenever you change the data model, update **both** schema docs in the same change. This includes: adding/removing a table or index, changing a partition/sort key, adding/removing/renaming an item attribute, adding a new `itemType` to the shared activities table, or changing an embedded shape (e.g. a show's `members`, a checklist's `items`).
- Treat both the CloudFormation templates (`dynamodb-table-{dev,main}.yaml`) and the Flask modules that write items (`docker/flask/*.py`) as inputs — the docs describe keys/indexes from the templates and effective attributes from the code.
- Keep the two docs parallel (they differ only by the `-dev` / `-main` table-name prefix) and refresh the affected attribute tables and example rows so they match reality.