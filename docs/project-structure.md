# @stonyx/rest-server — Project Structure

## Overview

REST server module for the Stonyx framework. Provides dynamic route registration from a file directory, built-in CORS/JSON middleware, per-route authorization hooks, and a structured `Request` base class for defining handlers.

- **Package**: `@stonyx/rest-server` (v0.2.1-beta.1)
- **License**: Apache-2.0
- **Entry point**: `src/main.js`
- **Module type**: ESM (`"type": "module"`)
- **Node version**: v24.13.0 (per `.nvmrc`)
- **Package manager**: pnpm

## Architecture

### RestServer (src/main.js)

Singleton class wrapping an Express 5 instance.

- **Constructor** — enforces singleton via `RestServer.instance`; creates the Express app with `express()`
- **`init()`** — calls `setupRouter()`, then starts listening on the configured port
- **`setupRouter()`** — calls `setupGlobalMiddleware()`, then uses `forEachFileImport` (from `@stonyx/utils/file`) to dynamically import all files in the configured `dir` and mount each as a route via `mountRoute()`. Optionally registers a `/health` endpoint.
- **`setupGlobalMiddleware()`** — attaches `cors()` and `express.json()` middleware to the Express app
- **`mountRoute(routeClass, { name, options })`** — instantiates the imported Request subclass, wires up the `authorization` middleware if present, calls `registerCalls()`, and mounts the sub-app at `/<filename>`
- **`RestServer.close()`** — static method to close the server

### Request (src/request.js)

Base class for route definitions. Each file in the requests directory exports a class extending `Request`.

- **Constructor** — creates a child Express instance with `x-powered-by` disabled
- **`handlers`** — instance property: object mapping HTTP methods (`get`, `post`, `put`, `delete`, `patch`) to route-path/handler pairs
- **`auth(req, state)`** — optional hook. Return an integer status code to reject the request; return nothing to allow it through.
- **`authorization(req, res, next)`** — wrapper that calls `auth()` and short-circuits with a status response if it returns a code
- **`registerCalls()`** — iterates `handlers`, registers each route on the child Express instance. Supports:
  - Single handler function or array (last element is the main handler, preceding elements are middleware)
  - Middleware functions are bound to the class instance and executed in order
  - Integer return = status code response (via `sendStatusResponse`)
  - Object return = JSON response
  - `undefined` return = 200 OK
  - Pipe support via `state.pipe` (sets headers and pipes a stream)
- **`Request.getState(req)`** — attaches/retrieves a `__stonyxState` object on the Express request
- **`Request.sendStatusResponse(res, status)`** — sends status with optional custom message from `config.restServer.statusMap`

Valid HTTP methods (enforced): `get`, `post`, `put`, `delete`, `patch`

### applyRouteMatching (src/route-matching.ts)

Single-function module holding this package's route-matching settings, called
from both express constructors above. See [Case-sensitive routing (#47)](#case-sensitive-routing-47).

## Configuration Reference

From `config/environment.js`. All values are overridable via environment variables.

| Option              | Type              | Default                       | Env Var                    | Description                                                     |
|---------------------|-------------------|-------------------------------|----------------------------|-----------------------------------------------------------------|
| `enableHealthCheck` | **Boolean**       | `true`                        | `REST_HEALTH_CHECK_DISABLE=true` to disable | Registers `GET /health` returning 200                     |
| `caseSensitiveRoutes` | **Boolean**     | `true`                        | `REST_CASE_SENSITIVE_ROUTES=false` to disable | Match route paths case-sensitively. Applied via `app.set('case sensitive routing', true)` in **both** the `RestServer` constructor and the `Request` constructor -- see below. Disabling re-opens the URL-authorization bypass of #47 |
| `trustProxy`        | **Boolean**       | `false`                       | `REST_TRUST_PROXY=true` to enable           | Trust reverse proxy headers (`X-Forwarded-Proto`) for correct protocol detection behind load balancers |
| `origin`            | **String**        | `'*'`                         | `REST_CORS_ORIGIN`         | CORS allowed origin(s)                                          |
| `methods`           | **String**        | `'GET,POST,PATCH,PUT,DELETE'` | `REST_CORS_METHODS`        | CORS allowed methods                                            |
| `dir`               | **String**        | `'./requests'`                | `REST_REQUEST_PATH`        | Directory containing Request class files to mount as routes     |
| `port`              | **Number/String** | `2666`                        | `REST_PORT`                | Port the REST server listens on                                 |
| `logColor`          | **String**        | `'yellow'`                    | —                          | Console log color for this module (Stonyx logging integration)  |
| `logMethod`         | **String**        | `'api'`                       | —                          | Log method name (Stonyx logging integration)                    |

Additional config used (not rest-server-specific):
- `config.debug` (top-level Stonyx config) — if truthy, logs errors during route setup
- `config.restServer.statusMap` (optional, no default in environment.js) — maps status codes to custom message strings
- `config.restServer.camelCaseRoutes` (optional, no default in environment.js) — when falsy, passes `rawName: true` to `forEachFileImport` so filenames are used as-is for route paths

### Case-sensitive routing (#47)

Both express construction sites call `applyRouteMatching()` from
`src/route-matching.ts`, and each must call it **before any route is registered
on that instance**:

- `RestServer` constructor (`src/main.ts`) — closes the mount segment (`/PUBLIC/...`)
- `Request` constructor (`src/request.ts`) — closes sub-paths (`/public/SUCCESS`)

Neither alone is sufficient. Express inherits settings on mount, but the child
router is materialized lazily on first route registration and `mountRoute()`
calls `registerCalls()` before `api.use()`, so the parent's setting never
reaches the child. Setting it after route registration is silently ineffective —
no throw, no warning.

The predicate lives in `src/route-matching.ts` rather than being written out at
each call site so that one test can anchor it. `test/unit/request-test.ts` AC6
reaches it through `Request`, which covers the `RestServer` half too. While the
expression was duplicated, both of these mutations of the `src/main.ts` copy
kept the suite green at 28/0: `!== false` → `=== true`, and dropping the
condition entirely.

The guard is `!== false`, not a truthy check, and that polarity is load-bearing.
`trustProxy` and `enableHealthCheck` default falsy, so a missing key fails safe
for them; this flag defaults truthy, so a truthy check would fail **open** for a
consumer whose shipped config predates the key.

Note that `express({ caseSensitive: true })` does **not** work: express 5's
`createApplication()` takes zero arguments and forwards nothing. The app setting
is the only mechanism. `@types/express` declares zero parameters, so TypeScript
catches the mistake — plain-JS consumers get a silent no-op.

Scope limits — this closes the casing half of the defect and no more:

- It does not normalize path *parameter values*. `/private/RESTRICTED` reaches
  the handler before and after.
- It does not cover trailing slashes. `strict routing` is the sibling express
  setting and is still off, so `/private/failure/` reaches the guarded handler
  at 200 while `/private/failure` is blocked at 505. Tracked as #50; not fixed
  here.
- A mis-cased sub-path is not necessarily a 404 — a sibling param route absorbs
  it. AC5 asserts this: `/private/FAILURE` is dispatched to `/:id` at 200.

## Test Structure

Tests use **QUnit** and run via `stonyx test` (the `npm test` script).

### test/config/environment.js
Overrides `restServer.dir` to `'./test/sample/requests'` so tests load sample request classes.

### test/unit/request-test.js
Unit tests for `Request` static methods:
- `getState` — creates/returns state object on request
- `sendStatusResponse` — sends status with optional `statusMap` message

### test/integration/rest-server-test.js
Integration tests that boot the full server and make HTTP requests:
- 404 for non-existent routes
- `/public` — JSON response, 200 OK default, URL params, middleware (success/failure), `this` binding for handlers and middleware
- `/private` — authenticated success, auth hook rejection (505)
- `/health` — health check endpoint returns 200

### test/sample/requests/
Sample Request subclasses used by integration tests:
- `public.js` — `PublicRequest` with various GET handlers demonstrating middleware, params, binding
- `private.js` — `PrivateRequest` with `auth()` hook that rejects `/failure` with 505

## CI/CD

### .github/workflows/ci.yml
Runs on pull requests to `dev` and `main`. Delegates to shared workflow at `abofs/stonyx-workflows`.

### .github/workflows/publish.yml
Publishes to NPM. Triggered by:
- `workflow_dispatch` with version-type selection (patch/minor/major) or custom version
- Pull requests to `main`/`dev`
- Pushes to `main`

Delegates to `abofs/stonyx-workflows/.github/workflows/npm-publish.yml@main`.

## File Structure

```
stonyx-rest-server/
├── .claude/
│   └── CLAUDE.md                  # Agent entry point
├── .github/
│   └── workflows/
│       ├── ci.yml                 # PR CI — delegates to shared workflow
│       └── publish.yml            # NPM publish — delegates to shared workflow
├── docs/
│   ├── improvements.md            # Known improvement opportunities
│   ├── index.md                   # Documentation entry point
│   ├── project-structure.md       # This file
│   └── release.md                 # Release instructions
├── config/
│   └── environment.js             # Default config with env var overrides
├── src/
│   ├── main.js                    # RestServer class (singleton, Express wrapper)
│   └── request.js                 # Request base class (handler registration, auth hook)
├── test/
│   ├── config/
│   │   └── environment.js         # Test config override (dir → test/sample/requests)
│   ├── integration/
│   │   └── rest-server-test.js    # Integration tests (QUnit)
│   ├── sample/
│   │   └── requests/
│   │       ├── private.js         # Sample private request with auth hook
│   │       └── public.js          # Sample public request with middleware demos
│   └── unit/
│       └── request-test.js        # Unit tests for Request statics (QUnit)
├── .gitignore
├── .npmignore
├── .nvmrc                         # Node v24.13.0
├── LICENSE.md                     # Apache 2.0
├── package.json
├── pnpm-lock.yaml
└── README.md
```

## Dependencies

### Runtime
- `cors` ^2.8.5 — CORS middleware
- `express` ^5.1.0 — HTTP framework
- `stonyx` (local link) — Framework core (config, logging)

### Dev
- `@stonyx/utils` (local link) — Utility functions (file import, object helpers)
- `qunit` ^2.24.1 — Test framework
- `sinon` ^21.0.0 — Test stubs/spies
