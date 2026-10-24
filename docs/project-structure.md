# @stonyx/rest-server — Project Structure

## Overview

REST server module for the Stonyx framework. Provides dynamic route registration from a file directory, built-in CORS/JSON middleware, per-route authorization hooks, and a structured `Request` base class for defining handlers.

- **Package**: `@stonyx/rest-server`
- **License**: Apache-2.0
- **Entry point**: `src/main.ts`, built by `tsc` to `dist/main.js` (the only export, `.`)
- **Module type**: ESM (`"type": "module"`)
- **Node version**: v24.13.0 (per `.nvmrc`)
- **Package manager**: pnpm

## Architecture

### RestServer (src/main.ts)

Singleton class wrapping an Express 5 instance.

- **Constructor** — enforces singleton via `RestServer.instance`; creates the Express app with `express()`, then sets `case sensitive routing` from `config.restServer.caseSensitiveRoutes` (default `true`). The set is in the constructor because it is load-bearing there: express materialises the router lazily on first route registration and reads the setting at that moment, so any set after `setupRouter()` is silently ineffective (#47)
- **`init()`** — calls `setupRouter()`, then starts listening on the configured port
- **`setupRouter()`** — calls `setupGlobalMiddleware()`, then uses `forEachFileImport` (from `@stonyx/utils/file`) to dynamically import all files in the configured `dir` and mount each as a route via `mountRoute()`. Registers `GET /health` after all route files unless `enableHealthCheck` is false.
- **`setupGlobalMiddleware()`** — attaches `cors()` and `express.json()` middleware to the Express app
- **`mountRoute(routeClass, { name, options })`** — instantiates the imported Request subclass, calls `registerCalls()`, and mounts the sub-app at `/<filename>` (a file named `index` mounts at `/`). Other modules call it through `RestServer.instance.mountRoute(...)` after init: `@stonyx/orm` (its `setup-rest-server.ts`) and `@stonyx/oauth` (its `main.ts`). Its signature, the `registerCalls()` contract and the `expressInstance` property are therefore public API
- **`RestServer.close()`** — static method; calls `server.closeAllConnections()` then `server.close()`. A test that boots the server and does not call it leaves the port bound, and the next run fails with `EADDRINUSE`

### Request (src/request.ts)

Base class for route definitions. Each file in the requests directory exports a class extending `Request`.

- **Constructor** — creates a child Express instance, sets `case sensitive routing` on it from `config.restServer.caseSensitiveRoutes`, and disables `x-powered-by`. This is the second of the two required sites and the one a partial fix misses: `mountRoute()` calls `registerCalls()` — which materialises this router — before `api.use()` mounts it, so express's mount-time settings inheritance from the parent arrives too late. Parent-only leaves every sub-path case-insensitive (#47)
- **`handlers`** — instance property: object mapping HTTP methods (`get`, `post`, `put`, `delete`, `patch`) to route-path/handler pairs
- **`auth(req, state)`** — optional hook, run inside each route handler after express matches the route, so `req.params` is populated. Return a non-zero integer status code to reject the request; any falsy return allows it. See [security.md](security.md#authorization-hook)
- **`registerCalls()`** — iterates `handlers`, registers each route on the child Express instance. Supports:
  - Single handler function or array (last element is the main handler, preceding elements are middleware)
  - Middleware functions are bound to the class instance and executed in order; the first one to return a value other than `undefined` stops the stack, and that value is used as the response
  - Integer return = status code response (via `sendStatusResponse`)
  - Object return = JSON response
  - `undefined` return = 200 OK
  - Any other non-object return = 500
  - Pipe support via `state.pipe` (sets headers and pipes a stream)
- **`Request.getState(req)`** — attaches/retrieves a `__stonyxState` object on the Express request
- **`Request.sendStatusResponse(res, status)`** — sends status with optional custom message from `config.restServer.statusMap`

Valid HTTP methods (enforced): `get`, `post`, `put`, `delete`, `patch`

## Configuration Reference

From `config/environment.js`. All values are overridable via environment variables.

| Option              | Type              | Default                       | Env Var                    | Description                                                     |
|---------------------|-------------------|-------------------------------|----------------------------|-----------------------------------------------------------------|
| `enableHealthCheck` | **Boolean**       | `true`                        | `REST_HEALTH_CHECK_DISABLE=true` to disable | Registers `GET /health` returning 200                     |
| `caseSensitiveRoutes` | **Boolean**     | `true`                        | `REST_CASE_SENSITIVE_ROUTES=false` to disable | Match route paths case-sensitively. Set at both express construction sites; see the constructor bullets above for why both are required and why placement is load-bearing (#47) |
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

## Test Structure

Tests use **QUnit**. `pnpm test` builds, typechecks, then runs `test/**/*-test.ts` through `tsx` with `NODE_ENV=test`.

### test/config/environment.ts
Overrides `restServer.dir` to `'./test/sample/requests'` so tests load sample request classes.

### test/unit/request-test.ts
Unit tests for `Request` static methods:
- `getState` — creates/returns state object on request
- `sendStatusResponse` — sends status with optional `statusMap` message

### test/integration/rest-server-test.ts
Integration tests that boot the full server and make HTTP requests:
- 404 for non-existent routes
- `/public` — JSON response, 200 OK default, URL params, middleware (success/failure); arrow-function handlers reach `this`, and middleware is bound
- `/private` — authenticated success, auth hook rejection (505)
- `/health` — health check endpoint returns 200

### test/integration/sample-patterns-test.ts
Exercises the consumer patterns in `test/sample/requests/` over HTTP (version gate, inherited `auth`, async middleware, headers/status), and pins the `auth()`-is-sync and unbound-final-handler behaviour.

### test/unit/sample-imports-test.ts
Fails if any file under `test/sample/` imports something other than `@stonyx/rest-server`, an exported subpath, a `node:` built-in, or another sample file that exists under the exact name imported (so a `.js` specifier for a `.ts` file, which tsx loads but `stonyx serve` does not, is rejected).

### test/sample/requests/
Consumer-copyable Request subclasses, mounted by the integration tests. They import only `@stonyx/rest-server`, `node:` built-ins and each other:
- `base/api-request.ts` — base class: async version-gate middleware in the constructor (426 + JSON:API error) and a sync `auth` with a constant-time token compare. Not mounted (discovery does not recurse)
- `accounts.ts` — extends the base; async handler-array middleware
- `widgets.ts` — response headers and a custom status
- `public.ts` — `PublicRequest` with various GET handlers demonstrating middleware, params, binding
- `private.ts` — `PrivateRequest` with `auth()` hook that rejects `/failure` with 505

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
│       ├── publish.yml            # NPM publish — delegates to shared workflow
│       └── security-audit.yml     # Dependency audit
├── docs/
│   ├── index.md                   # Documentation entry point
│   ├── project-structure.md       # This file
│   ├── release.md                 # Release instructions
│   └── security.md                # Security-relevant behaviour
├── config/
│   └── environment.js             # Default config with env var overrides
├── src/
│   ├── main.ts                    # RestServer class (singleton, Express wrapper)
│   ├── request.ts                 # Request base class (handler registration, auth hook)
│   └── types/                     # Ambient declarations for stonyx, @stonyx/utils, @stonyx/logs
├── test/
│   ├── config/
│   │   └── environment.ts         # Test config override (dir → test/sample/requests)
│   ├── integration/
│   │   ├── readme-examples-test.ts  # README examples executed over a raw socket
│   │   ├── rest-server-test.ts    # Integration tests (QUnit)
│   │   └── sample-patterns-test.ts  # Consumer patterns in test/sample, over HTTP
│   ├── sample/
│   │   └── requests/
│   │       ├── base/
│   │       │   └── api-request.ts # Base class: version gate + inherited auth
│   │       ├── accounts.ts        # Async handler-array middleware
│   │       ├── private.ts         # Sample private request with auth hook
│   │       ├── public.ts          # Sample public request with middleware demos
│   │       └── widgets.ts         # Response headers and custom status
│   ├── unit/
│   │   ├── docs-surface-test.ts   # Documentation contract tests
│   │   ├── main-test.ts           # RestServer unit tests
│   │   ├── publish-surface-test.ts  # Published-file surface tests
│   │   ├── request-test.ts        # Request unit tests (QUnit)
│   │   └── sample-imports-test.ts # test/sample imports are consumer-resolvable
│   ├── setup.ts
│   └── zz-exit-test.ts
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
- `@types/express` ^5.0.6 — Express type declarations. A runtime dependency because the published `dist/main.d.ts` and `dist/request.d.ts` import `express` types, so a strict TypeScript consumer needs them to type-check
- `cors` ^2.8.5 — CORS middleware
- `express` ^5.1.0 — HTTP framework
- `stonyx` (local link) — Framework core (config, logging)

### Dev
- `@stonyx/utils` (local link) — Utility functions (file import, object helpers)
- `qunit` ^2.24.1 — Test framework
- `sinon` ^21.0.0 — Test stubs/spies
