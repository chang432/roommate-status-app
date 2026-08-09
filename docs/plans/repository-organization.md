# Repository organization roadmap

## Completed: frontend components

The React component tree is organized by feature, with CSS modules and tests
colocated in frontend/src/components/.

## Completed: Flask tests

The former monolithic docker/flask/test_app.py is now feature-focused test
modules under docker/flask/testing/. A shared conftest.py owns the
Moto-backed DynamoDB fixture and Flask test client; support.py owns reusable
test helpers. Keep test behavior and coverage unchanged.

## Completed: frontend API client

The former `frontend/src/api/client.js` has been split into domain modules in
`frontend/src/api/`. They share `request.js` for API base paths, active-group
scoping, JSON error handling, and invalid-session handling; callers import the
specific domain module they use.

## Completed: Flask routes

`docker/flask/app.py` now owns only application assembly and request-scoped
group handling. Feature routes live in blueprints under `docker/flask/routes/`,
with shared route validation and notification behavior in `route_helpers.py`.

## Future improvements

1. **Large UI modules:** Extract feature-local hooks and subcomponents from
   GroupFeed, ShowTrackerFeature, and StatusPage without changing UI behavior.
2. **Reference docs:** Move the PWA proof-of-concept note from mockups/ to
   docs/plans/, leaving mockups/ for visual prototypes only.

## Guardrails

- Treat each future item as a behavior-preserving refactor with its own tests
  and commit.
- Do not couple the route refactor to database-schema or API-contract changes.
- Keep current dev/prod schema documentation and migration practices unchanged.
