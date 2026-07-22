# Repository organization roadmap

## Completed: frontend components

The React component tree is organized by feature, with CSS modules and tests
colocated in frontend/src/components/.

## Completed: Flask tests

The former monolithic docker/flask/test_app.py is now feature-focused test
modules under docker/flask/testing/. A shared conftest.py owns the
Moto-backed DynamoDB fixture and Flask test client; support.py owns reusable
test helpers. Keep test behavior and coverage unchanged.

## Future improvements

1. **Flask routes:** Split docker/flask/app.py route handlers into
   feature-oriented Flask blueprints while preserving create_app() as the
   registration point and retaining its request-scoped group handling.
2. **Frontend API client:** Split frontend/src/api/client.js into domain
   modules that share one request helper; update callers to import their domain
   module directly.
3. **Large UI modules:** Extract feature-local hooks and subcomponents from
   GroupFeed, ShowTrackerFeature, and StatusPage without changing UI behavior.
4. **Reference docs:** Move the PWA proof-of-concept note from mockups/ to
   docs/plans/, leaving mockups/ for visual prototypes only.

## Guardrails

- Treat each future item as a behavior-preserving refactor with its own tests
  and commit.
- Do not couple the route refactor to database-schema or API-contract changes.
- Keep current dev/prod schema documentation and migration practices unchanged.
