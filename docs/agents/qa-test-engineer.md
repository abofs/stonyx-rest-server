# SME Template: QA Test Engineer — Stonyx REST Server

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/qa-test-engineer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-rest-server`
**Framework:** HTTP server module for the Stonyx ecosystem
**Domain:** Express-based REST server with dynamic routing, CORS, auth hooks, and request middleware

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Test Runner | QUnit (via `stonyx test`) |
| Mocking | Sinon |
| Build (tests) | `tsc -p tsconfig.test.json` (outputs to `dist-test/`) |
| Test Command | `pnpm build && pnpm build:test && stonyx test 'dist-test/test/**/*-test.js'` |
| Test Fixtures | `test/sample/` with sample request classes for route testing |
| Test Config | `test/config/environment.js` with port and directory overrides |

## Architecture Patterns

- **Three test tiers:** `test/unit/` for Request class logic and handler behavior, `test/integration/` for full server lifecycle with HTTP requests, `test/sample/` for fixture request classes
- **Server lifecycle in tests:** Integration tests must start and stop the server (`RestServer.init()` / `RestServer.close()`) — the singleton pattern means tests must reset `RestServer.instance` between runs
- **Port isolation:** Test config should use a non-default port to avoid conflicts with running development servers — the default is `2666`

## Live Knowledge

- The `RestServer.close()` method calls both `server.closeAllConnections()` and `server.close()` — tests that don't call close will leave the port bound, causing subsequent test runs to fail with `EADDRINUSE`
- Handler return value semantics are critical test targets: `undefined` = 200 OK, integer = HTTP status, object = JSON body, non-object truthy value = 500 error — verify all four paths
- The middleware call stack (array handlers) processes left-to-right with short-circuit — test that early middleware returning a value prevents the main handler from executing
- Auth hook tests should verify that `req.params` is populated when `auth()` runs (it executes after route matching) — this is a key architectural guarantee that route-specific auth depends on
- The `redirect` and `pipe` state keys in `Request.getState(req)` trigger special response handling — test that these take priority over normal handler return values
- Request class discovery via `forEachFileImport` depends on the `dir` config and `camelCaseRoutes` flag — test both raw filenames (`my-route` maps to `/my-route`) and camelCase conversion (`myRoute` maps to `/myRoute`)
- The `statusMap` config transforms status code responses — test that a mapped status sends the custom message body instead of Express's default status text
