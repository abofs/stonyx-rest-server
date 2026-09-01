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
from both express constructors above. Holds two settings: `case sensitive
routing` (#47) and `strict routing` (#50). See
[Case-sensitive routing (#47)](#case-sensitive-routing-47) and
[Strict routing (#50)](#strict-routing-50) — the two settings do NOT have the
same per-site behaviour, and the difference matters.

## Configuration Reference

From `config/environment.js`. All values are overridable via environment variables.

| Option              | Type              | Default                       | Env Var                    | Description                                                     |
|---------------------|-------------------|-------------------------------|----------------------------|-----------------------------------------------------------------|
| `enableHealthCheck` | **Boolean**       | `true`                        | `REST_HEALTH_CHECK_DISABLE=true` to disable | Registers `GET /health` returning 200                     |
| `caseSensitiveRoutes` | **Boolean**     | `true`                        | `REST_CASE_SENSITIVE_ROUTES=false` to disable | Match route paths case-sensitively. Applied via `app.set('case sensitive routing', true)` in **both** the `RestServer` constructor and the `Request` constructor -- see below. Disabling re-opens the URL-authorization bypass of #47 |
| `strictRoutes`      | **Boolean**       | `true`                        | `REST_STRICT_ROUTES=false` to disable       | Match route paths strictly -- a trailing slash does not match a route registered without one. Applied via `app.set('strict routing', true)` in the same two constructors. Disabling re-opens the URL-authorization bypass of #50. Separate key from `caseSensitiveRoutes` on purpose -- see below |
| `canonicalRoutes`   | **Boolean**       | `true`                        | `REST_CANONICAL_ROUTES=false` to disable    | Reject a request whose RAW target is not the canonical path express matched, ahead of the consumer's `auth` hook. **Not an express setting** -- a per-request check, `shouldRejectTarget()` in `src/route-matching.ts`, called from the handler closure in `Request.registerCalls()`. Disabling re-opens BOTH `req.originalUrl` bypasses of #54 (mount-root trailing slash, and absolute-form request target on every route). Separate key from the two above on purpose -- see below |
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
- A mis-cased sub-path is not necessarily a 404 — a sibling param route absorbs
  it. AC5 asserts this: `/private/FAILURE` is dispatched to `/:id` at 200.
- It does not cover trailing slashes. That is the sibling `strict routing`
  setting, closed separately in #50 — see below.

### Strict routing (#50)

`strict routing` closes the trailing-slash half of the same defect:
`/private/failure/` reached the guarded handler at 200 while `/private/failure`
was blocked at 505, because the `auth` hook compares `req.path` against
`/failure`. Set in the same `applyRouteMatching()` call, so one predicate covers
both construction sites.

**The per-site split from #47 does NOT transfer, and this is the easiest thing
to get wrong here.** Measured per site:

| probe | neither | parent only | child only | both |
|---|---|---|---|---|
| `/private/failure/` | 200 | 200 | **404** | **404** |
| `/public/success/` | 200 | 200 | **404** | **404** |
| `/health/` | 200 | **404** | 200 | **404** |
| `/public/` (mount root) | 200 | 200 | 200 | 200 |

**This table is scoped to the two SETTINGS and stays true as such** -- it is the
measurement that says `applyRouteMatching()` is not the fix site for the mount
root. It is *not* a statement of end-to-end behaviour: the last row is now 404
in every column, because `canonicalRoutes` (#54, below) decides it and no
combination of these two settings can. Do not delete the row; the settings-level
fact it records is the reason the mount root needed a different mechanism.

- The **child** site (`src/request.ts`) closes the entire security defect alone.
- The **parent** site (`src/main.ts`) closes exactly one thing in this repo:
  `/health/`, the only route registered directly on the parent app. It has no
  security role for #50 — do not describe it as having one.

The cause is concrete: `router@2.2.0` `index.js:400-401` hardcodes
`strict: false, end: false` for `Router.prototype.use`, so **mount segments are
structurally strict-immune.** This is the opposite of `sensitive`, which `use()`
*does* forward (line 399) and which is why #47's parent site closed
`/PUBLIC/...`.

> **This paragraph is the single authoritative citation for that upstream
> behaviour.** The same fact is stated (without file-and-line coordinates) in
> `README.md`, `docs/agents/security-reviewer.md`, `src/route-matching.ts` and
> `test/integration/rest-server-test.ts`, each of which points here. Verified
> against `router@2.2.0`; **re-verify these line numbers when `router` is
> upgraded** — they are pinned in this one place so an upgrade invalidates one
> line rather than five.

That has a consequence worth stating so nobody expects `strictRoutes` to cover
it: **no express setting rejects the mount-root trailing slash `/public/`.**
Both `/public` and `/public/` reach the sub-app with `req.path === '/'`, so a
`req.path` hook sees no difference and there is nothing for `strict routing` to
reject. That statement is still true, and it is still the reason
`applyRouteMatching()` is not the fix site for this edge.

**Unclosable by a setting was never unclosable, and it is now closed.** The
residual is `req.originalUrl`, which *does* differ, and a consumer hook
authorizing on it was bypassed by one character — measured: `GET /admin` → 401,
`GET /admin/` → 200 with the guarded handler running unauthenticated. That was a
live bypass of the same class as #47 and #50, closed *by this module* rather
than by a setting: `shouldRejectTarget()` in `src/route-matching.ts`, called
ahead of the `auth` call in `Request.registerCalls()`. See
[#54](https://github.com/abofs/stonyx-rest-server/issues/54) and § *Canonical
request target (#54)* below. #50's integration AC2 now asserts `/public/` → 404
and names the check, not the setting, as what produced it.

`strictRoutes` is a **separate config key**, not a rename or a reuse of
`caseSensitiveRoutes`. Coupling them would force any consumer who legitimately
needs trailing-slash tolerance — a health-check URL that cannot change today is
the common case — to re-open #47's case bypass to get it. Renaming the key would
also silently no-op for consumers who adopted `caseSensitiveRoutes` in
`0.2.1-beta.90`.

Consumer-visible behaviour change: `GET /health/` goes 200 → 404, and param
routes such as `/resource/:id/` stop matching. See the README's Upgrading
section — the health-check break is an availability incident, not a 404 anyone
will read in a log, because this module emits no request logging.

### Canonical request target (#54)

`canonicalRoutes` closes the two `req.originalUrl` bypasses that no express
setting can reach. It is the third member of the route-matching family and the
only one that is **not** a setting.

```
target    = req.originalUrl.split('?')[0]                                // raw, unparsed
canonical = (req.path === '/' && req.baseUrl) ? req.baseUrl : req.baseUrl + req.path
if (enforced && target !== canonical) return next('router');
```

Measured on a consumer-shaped fixture (`test/sample/requests/admin.ts`, hook
authorizing on `req.originalUrl`), by raw TCP socket, before and after:

| probe | before | after |
|---|---|---|
| `GET /admin` | 401 | 401 |
| `GET /admin/` | **200** (guarded handler, unauthenticated) | **404** |
| `GET http://HOST/admin` | **200** (guarded handler, unauthenticated) | **404** |
| `GET http://HOST/admin/settings` | **200** (guarded handler, unauthenticated) | **404** |
| `GET /public/` | 200 | **404** |
| `GET /admin/legacy/` (registered with the slash) | 200 | 200 |

Four things about this are load-bearing and each has a red-able assertion.

**1. The target is compared raw.** Any implementation reaching for
`new URL(req.originalUrl, base).pathname` to "get the path" re-opens the
absolute-form vector *by construction*: parsing normalizes the exact string the
consumer's hook is exposed to, so the check compares a laundered value while the
hook still sees the raw one. Measured: the narrow `endsWith('/')` form closes the
mount-root slash and leaves the absolute form at 200. Killed by AC1.3/AC1.4.

**2. `req.baseUrl + req.path` is not usable as the left-hand side.** It is
`/admin/` for *both* spellings of the mount root — `originalUrl` is the only
field that differs, which is precisely why the bypass exists. A check built on
`baseUrl + path` cannot see its own defect. Killed by AC1.1/AC1.2.

**3. It runs outside `if (this.auth)`.** Gating it on the hook leaves
`GET /public/` at 200 and makes a security control depend on an unrelated
consumer choice. Killed by AC1.6, which probes a route class with no hook.

**4. It rejects with `next('router')`, not `res.sendStatus(404)`.** Measured:

```
next('router')     /public/                  -> 404 text/html  <pre>Cannot GET /public/</pre>
                   /public/genuinely-missing -> 404 text/html  <pre>Cannot GET ...</pre>

sendStatus(404)    /public/                  -> 404 text/plain "Not Found"      <-- distinguishable
                   /public/genuinely-missing -> 404 text/html  <pre>Cannot GET ...</pre>
```

`sendStatus(404)` builds an **oracle**: an attacker learns "this route exists,
you used the wrong form." `next('router')` exits the sub-app's router into
`finalhandler` and is shape-identical to a genuine miss — same status, same
`Content-Type`, same `Content-Security-Policy` and `X-Content-Type-Options`.
It must also not go through `Request.sendStatusResponse()`, which would route
the body through `config.restServer.statusMap` and re-introduce the oracle for
any consumer who sets a 404 entry. Killed by AC1.5.

**Timing contract — deliberately the opposite of its two siblings.**
`caseSensitiveRoutes` and `strictRoutes` are read once in a **constructor** and
are silently ineffective if applied late, because express materializes a router
lazily on first route registration. `canonicalRoutes` is read **per request**,
inside the handler closure. There is no lazy-materialisation hazard here, so do
not carry that constraint across — and the predicate therefore lives *beside*
`applyRouteMatching()` in `src/route-matching.ts`, deliberately **outside** it:
that function's contract is *apply express settings to an app*, and this is
neither a setting nor constructor-timed.

**Scope limits, stated rather than quietly left open:**

- The check lives in `Request.registerCalls()`, so routes registered directly on
  the parent app — `/health` only, in this repo — are not covered.
  `GET http://HOST/health` still returns 200. `/health` has no `auth` hook, so
  there is nothing to bypass; this is a scope limit, not a residual bypass.
- Only the query string is stripped before comparison, so `GET /admin?x=1`
  reaches the hook. A query string is a legitimately variable part of a request
  target and rejecting on it would 404 every `?`-carrying request. A consumer
  hook that compares `req.originalUrl` against a fixed path without stripping
  the query does not match `/admin?x=1` — measured identical before and after
  the fix, so this is the consumer's comparison to own, and the README says so.
  `test/sample/requests/admin.ts` models the correctly-written hook and AC1.8
  asserts the module still delivers `GET /admin?x=1` to it.

**Not affected** (measured): routes registered with a literal trailing slash,
param routes, index-mounted route classes, query strings on canonical paths, and
`/health`.

Consumer-visible behaviour change, on two axes: `GET /route/` at a mount root
goes 200 → 404, and **every** route goes 200 → 404 for a client emitting an
absolute-form request target. The second has the larger blast radius — for such
a client it is a total outage. Rejections are indistinguishable from a genuine
miss by design and this module emits no request logging, so the only symptom is
a bare `Cannot GET …`.

## Test Structure

Tests use **QUnit** and run via `stonyx test` (the `npm test` script).

### test/config/environment.js
Overrides `restServer.dir` to `'./test/sample/requests'` so tests load sample request classes.

### test/unit/request-test.js
Unit tests for `Request` static methods:
- `getState` — creates/returns state object on request
- `sendStatusResponse` — sends status with optional `statusMap` message
- the three route-matching config flags (`caseSensitiveRoutes` #47, `strictRoutes` #50, `canonicalRoutes` #54), each over real HTTP on `listen(0)`, each probing **both** failure shapes of the `!== false` guard. This is the only tier that can see a fail-open guard: the shipped defaults are all `true`, so `=== true` leaves every integration assertion green

### test/unit/ledger-test.ts
Acceptance anchor for #54's AC3. Runs `git grep -nE` over the tracked tree for
the four stale phrasings that #50 left behind — the ones asserting that the
mount-root edge is unclosable, that a `/public/` -> 404 assertion is
unachievable, that the edge is still open, and the instruction not to close it
in `route-matching.ts` — and asserts **0** hits, so no artifact can go on
telling a reader the edge is unclosable after #54 closed it. The same grep
returned **8 hits across 5 files** on `origin/dev` @ `f5c9a24`. The pattern is
assembled from fragments in the test rather than written out, because a tracked
file containing it would match itself; the test carries a positive control so a
mistyped pattern cannot produce a vacuous zero.

### test/integration/rest-server-test.js
Integration tests that boot the full server and make HTTP requests:
- 404 for non-existent routes
- `/public` — JSON response, 200 OK default, URL params, middleware (success/failure), `this` binding for handlers and middleware
- `/private` — authenticated success, auth hook rejection (505)
- `/health` — health check endpoint returns 200

### test/sample/requests/
Sample Request subclasses used by integration tests:
- `public.ts` — `PublicRequest` with various GET handlers demonstrating middleware, params, binding. No `auth()` hook, which is what makes it the fixture for #54's AC1.6
- `private.ts` — `PrivateRequest` with `auth()` hook that rejects `/failure` with 505
- `admin.ts` — `AdminRequest` with an `auth()` hook authorizing on **`req.originalUrl`**, the field express does not normalize. That shape is the point: rewritten to compare `req.path` the fixture cannot express #54's defect at all, since `req.baseUrl + req.path` is `/admin/` for both spellings of the mount root. Also registers `/legacy/` *with* a literal trailing slash, so an over-broad "target must not end in /" rule turns AC1.10 red

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
│   │       ├── admin.ts           # Sample request with an originalUrl auth hook (#54 fixture)
│   │       ├── private.js         # Sample private request with auth hook
│   │       └── public.js          # Sample public request with middleware demos
│   └── unit/
│       ├── ledger-test.ts         # Tripwire ledger grep (#54 AC3)
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
