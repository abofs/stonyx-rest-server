# @stonyx/rest-server — Architecture

REST server module for the Stonyx framework. It provides dynamic route registration from a
directory of files, built-in CORS/JSON middleware, per-route authorization hooks, and a
structured `Request` base class that route files extend to declare handlers. The module is not
a standalone server process: it is a library that a consuming Node.js application (typically via
the Stonyx CLI, `stonyx serve`) installs and configures. `RestServer` wraps a single Express 5
instance (`src/main.ts`); route files under a configured directory are dynamically imported and
each mounted as its own child Express sub-app via the `Request` base class (`src/request.ts`).

## Areas

- **Route registration and dispatch.** `RestServer.setupRouter()` uses `forEachFileImport` (from
  `@stonyx/utils/file`) to dynamically import every file in `config.restServer.dir` (default
  `./requests`) and mount each exported `Request` subclass at `/<filename>` (or `/` for a file
  named `index`) via `mountRoute()`. A `GET /health` route is registered last unless
  `enableHealthCheck` is `false`. Full behaviour, the `mountRoute()` contract used by
  `@stonyx/orm` and `@stonyx/oauth`, and the case-sensitive-routing subtlety (#47) are in
  [project-structure.md](project-structure.md#restserver-srcmaints).

- **Middleware (CORS/JSON).** `setupGlobalMiddleware()` attaches `cors({ origin, methods })` and
  `express.json()` to the parent Express app before any routes are mounted, so every request is
  CORS-checked and JSON-body-parsed before it reaches a route handler. `trustProxy` is applied
  here too (`this.api.set('trust proxy', true)`) when configured. See
  [security.md](security.md#configuration) for the CORS default (`origin: '*'`) and proxy-trust
  implications, and [project-structure.md](project-structure.md#configuration-reference) for the configuration table.

- **The auth hook mechanism.** Each `Request` subclass may define `auth(req, state)`. It runs
  inside `registerCalls()`'s generated handler, after Express has matched the route (so
  `req.params` is populated), and before any middleware or the main handler. Any truthy integer
  return is sent as the response status and the request is rejected; any falsy return (including
  `0`) allows it through. It is called synchronously — a returned Promise is treated as truthy and
  fails the request with 500. See [security.md](security.md#authorization-hook) for the full
  contract and pitfalls.

- **The `Request` base class.** `src/request.ts` defines the `handlers` map (HTTP method ->
  route path -> handler or handler array), `registerCalls()` (which wires `handlers` onto a child
  Express instance, running auth, middleware, then the main handler, and interpreting the return
  value — integer status, object as JSON, `undefined` as 200, redirect/pipe via `state`), and the
  static helpers `getState()` and `sendStatusResponse()`. Each instance gets its own Express
  sub-app with `x-powered-by` disabled and case-sensitive routing set directly on it (required in
  addition to the parent's setting — see below). Details:
  [project-structure.md](project-structure.md#request-srcrequestts).

- **Configuration (CORS/proxy settings).** All configuration lives under `config.restServer` in
  the consuming app's `environment.js`, with environment-variable overrides defined in this
  module's own `config/environment.js` (`REST_CORS_ORIGIN`, `REST_CORS_METHODS`,
  `REST_TRUST_PROXY`, `REST_CASE_SENSITIVE_ROUTES`, `REST_REQUEST_PATH`, `REST_PORT`,
  `REST_HEALTH_CHECK_DISABLE`). Note from [security.md](security.md#configuration): the env-var
  overrides in `config/environment.js` are only merged by the Stonyx module loader for
  `@stonyx/*` packages listed in the consumer's `devDependencies`; a `dependencies` install must
  set the equivalent keys in its own `config/environment.js` instead. Full option table:
  [project-structure.md](project-structure.md#configuration-reference).

## Build, Run, Test

Prerequisites: Node v24.13.0 (pinned in `.nvmrc`), pnpm 10.23.0.

```bash
pnpm install --frozen-lockfile   # verified: installs clean, no lockfile changes
pnpm build                       # tsc -> dist/
pnpm typecheck                   # tsc -p tsconfig.test.json (src + test + config, strict off)
pnpm test                        # pnpm build && pnpm typecheck, then QUnit over test/**/*-test.ts
```

Verified in this environment on 2026-11-02: `pnpm install --frozen-lockfile` completed with no
lockfile changes (`Lockfile is up to date, resolution step is skipped`). `pnpm test` (which runs
build, typecheck, and the full QUnit suite) passed all 63 assertions with zero failures. There is
no separate `typecheck`-only CI step distinct from what `pnpm test` already runs — `pnpm test`'s
first two steps are `pnpm build && pnpm typecheck`.

There is no `dev`/`watch` script and no standalone "run the server" script in `package.json`; the
module is exercised either through its test suite or by a consuming application that calls
`new RestServer().init()` (see [README.md](../README.md#optional-direct-usage)) or runs
`stonyx serve`.

## Delivery

`@stonyx/rest-server` is published to npm as a library (`files`: `dist`, `config`, `README.md`)
and consumed inside a Node.js backend process — there is no web, iOS, or Android surface, and the
package is not itself a standalone deployed service. A consuming application installs it,
configures `restServer` in its own `environment.js`, and either runs it via the Stonyx CLI
(`stonyx serve`, which auto-initializes all Stonyx modules) or calls `RestServer` directly. The
HTTP routes the module mounts (from the consumer's `requests/` directory) become part of
*that consuming application's* HTTP API surface — `@stonyx/rest-server` only supplies the
registration/dispatch machinery, not an application of its own. Other Stonyx modules (for
example `@stonyx/orm`, `@stonyx/oauth`) call `RestServer.instance.mountRoute(...)` directly to add
their own routes into whatever host application has initialized this module.

## Dependencies

- **`express` (^5.1.0)** — owns HTTP routing/middleware plumbing: the underlying app/router,
  request/response objects, and route matching that `RestServer` and `Request` wrap.
- **`cors` (^2.8.5)** — owns the actual CORS header logic (`Access-Control-*` headers,
  preflight handling); `RestServer` only supplies the `origin`/`methods` configuration to it.
- **`@types/express` (^5.0.6)** — a runtime dependency (not dev) because the published
  `dist/main.d.ts` / `dist/request.d.ts` import Express's types, so a strict TypeScript consumer
  needs them at type-check time.
- **`stonyx` (0.2.3-beta.107, pinned to 0.2.3-beta.61 via `pnpm.overrides`)** — the framework
  core: owns module lifecycle (this module reads `config.restServer` from it and logs through
  `stonyx/log`), not owned by this package.
- **Dev-only:** `@stonyx/utils` (dynamic file import / object helpers used by `setupRouter()` and
  `registerCalls()`), `qunit` + `sinon` (test framework/stubs), `tsx` (runs TypeScript tests
  without a separate build step), `typescript`.
