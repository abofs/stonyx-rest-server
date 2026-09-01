# @stonyx/rest-server — Project Structure

## Overview

REST server module for the Stonyx framework. Provides dynamic route registration from a file directory, built-in CORS/JSON middleware, per-route authorization hooks, and a structured `Request` base class for defining handlers.

- **Package**: `@stonyx/rest-server` (v0.2.1-beta.1)
- **License**: Apache-2.0
- **Entry point**: `src/main.ts`
- **Module type**: ESM (`"type": "module"`)
- **Node version**: v24.13.0 (per `.nvmrc`)
- **Package manager**: pnpm

## Architecture

### RestServer (src/main.ts)

Singleton class wrapping an Express 5 instance.

- **Constructor** — enforces singleton via `RestServer.instance`; creates the Express app with `express()`
- **`init()`** — calls `setupRouter()`, then starts listening on the configured port
- **`setupRouter()`** — calls `setupGlobalMiddleware()`, then uses `forEachFileImport` (from `@stonyx/utils/file`) to dynamically import all files in the configured `dir` and mount each as a route via `mountRoute()`. Optionally registers a `/health` endpoint.
- **`setupGlobalMiddleware()`** — attaches `cors()` and `express.json()` middleware to the Express app
- **`mountRoute(routeClass, { name, options })`** — instantiates the imported Request subclass, wires up the `authorization` middleware if present, calls `registerCalls()`, and mounts the sub-app at `/<filename>`
- **`RestServer.close()`** — static method to close the server

### Request (src/request.ts)

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

### src/route-matching.ts

The config-read site for the **route-matching family** — the four keys
`caseSensitiveRoutes` (#47), `strictRoutes` (#50), `canonicalRoutes` (#54) and
`canonicalEncoding` (#56). Three exports, with deliberately different lifetimes:

| export | kind | lifetime | reads |
|---|---|---|---|
| `applyRouteMatching(api)` (default) | applies express **settings** | called from **both** express constructors, and must stay constructor-timed — express materializes a router lazily on first route registration, so a setting applied later is silently ineffective | `caseSensitiveRoutes`, `strictRoutes` |
| `shouldRejectTarget(req)` (named) | a **per-request predicate**, not a setting | called from the handler closure in `Request.registerCalls()`, once per request | `canonicalRoutes` |
| `shouldRejectEncoding(req)` (named) | a **per-request predicate**, not a setting | called from the same closure, once per request, on its own line and independently of `shouldRejectTarget()` | `canonicalEncoding` |

**Admission rule for this file** — it exists so a reviewer does not have to
re-derive the judgement each time something route-shaped needs a home. What
belongs here is *a config read for the route-matching family, and the code that
directly consumes it*. That is what makes one file the right shape despite the
two lifetimes: all four keys share one guard-polarity rule (`!== false`, fail
toward the safe value), and there is one place where that rule sits beside every
instance of it. What does **not** belong: anything that is neither a member of
this family nor its consumer.

> **The documented split trigger fired, and the split was deliberately not
> taken. Recording that rather than editing the rule out.** The previous version
> of this paragraph said *"Three is the documented family size; a fourth is the
> point at which to split by lifetime (settings vs per-request checks) rather
> than growing this file again."* #56 is that fourth member, and it was added
> here anyway, on the #56 refinement's explicit instruction (accepted by the CTO
> without amendment): the new predicate is a **sibling** of
> `shouldRejectTarget()` and the argument for the two of them living together —
> one guard-polarity rule, one timing contract, one call site — is the same
> argument that put `shouldRejectTarget()` here. Splitting in the same change
> that adds a security control would have moved #54's comment block and its
> upstream citations for no behavioural gain, on the day the file was being
> reviewed for something else.
>
> **The trigger is not withdrawn, it is deferred, and it is now overdue.** A
> *fifth* member splits this file by lifetime — `applyRouteMatching()` and the
> two settings in one module, the per-request predicates in another — and
> whoever adds it should not have to re-argue this. The cost of the deferral is
> stated plainly: this file is now ~300 lines of which most is prose, and a
> reader looking for the settings has to scroll past two predicates.

See [Case-sensitive routing (#47)](#case-sensitive-routing-47),
[Strict routing (#50)](#strict-routing-50) and
[Canonical request target (#54)](#canonical-request-target-54) — the two
settings do NOT have the same per-site behaviour, and the difference matters.

## Configuration Reference

From `config/environment.js`. All values are overridable via environment variables.

| Option              | Type              | Default                       | Env Var                    | Description                                                     |
|---------------------|-------------------|-------------------------------|----------------------------|-----------------------------------------------------------------|
| `enableHealthCheck` | **Boolean**       | `true`                        | `REST_HEALTH_CHECK_DISABLE=true` to disable | Registers `GET /health` returning 200                     |
| `caseSensitiveRoutes` | **Boolean**     | `true`                        | `REST_CASE_SENSITIVE_ROUTES=false` to disable | Match route paths case-sensitively. Applied via `app.set('case sensitive routing', true)` in **both** the `RestServer` constructor and the `Request` constructor -- see below. Disabling re-opens the URL-authorization bypass of #47 |
| `strictRoutes`      | **Boolean**       | `true`                        | `REST_STRICT_ROUTES=false` to disable       | Match route paths strictly -- a trailing slash does not match a route registered without one. Applied via `app.set('strict routing', true)` in the same two constructors. Disabling re-opens the URL-authorization bypass of #50. Separate key from `caseSensitiveRoutes` on purpose -- see below |
| `canonicalRoutes`   | **Boolean**       | `true`                        | `REST_CANONICAL_ROUTES=false` to disable    | Reject a request whose RAW target is not the canonical path express matched, ahead of the consumer's `auth` hook. **Not an express setting** -- a per-request check, `shouldRejectTarget()` in `src/route-matching.ts`, called from the handler closure in `Request.registerCalls()`. Disabling re-opens BOTH `req.originalUrl` bypasses of #54 (mount-root trailing slash, and absolute-form request target on every route registered through `Request.registerCalls()`). Separate key from the two above on purpose -- see below |
| `canonicalEncoding` | **Boolean**       | `true`                        | `REST_CANONICAL_ENCODING=false` to disable  | Reject a request whose RAW target percent-encodes an RFC 3986 §2.3 **unreserved** character (`ALPHA / DIGIT / "-" / "." / "_" / "~"`), ahead of the consumer's `auth` hook. **Not an express setting** -- a per-request check, `shouldRejectEncoding()` in `src/route-matching.ts`, called from the handler closure in `Request.registerCalls()`. Disabling re-opens the #56 bypass against a hook comparing `req.path` **or** `req.originalUrl` on any route class with a `:param` segment. Separate key from `canonicalRoutes` on purpose -- see below |
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

Reproduction note: written as `return res.sendStatus(404)` this mutant does not
compile — TS2345, the handler closure is typed `Promise<void>`. Write it
`{ res.sendStatus(404); return; }`. A build failure here is the mutant being
mis-written, not the mutant being unbuildable.

**5. It runs BEFORE the `auth` block, which is a separate property from running
outside it.** AC1.6 probes a route class with *no* hook, so it stays green if
the call is merely moved *below* `if (this.auth)` rather than gated on it.
Measured with it moved: the suite stayed **34 pass / 0 fail** while
`GET http://HOST/private/failure` answered **505** — the consumer hook's own
status, which is the same oracle class property 4 exists to prevent, and the
hook itself ran on a request the module was about to reject (so any hook with
side effects — audit write, rate-limit counter, session refresh — fires on a
rejected request). Killed by AC1.11.

**6. `&& req.baseUrl` in the canonical expression is load-bearing, not a
redundant truthiness guard.** A route class named `index` mounts at `/`
(`mountRoute()` in `src/main.ts`), the one mount shape where `req.baseUrl` is
`''`. Without the conjunct, `GET /` compares the raw target `'/'` against a
canonical of `''` and the **application root** is rejected. Measured before it
had a guard: shipped `GET /` → 200, conjunct dropped → 404, suite
**34 pass / 0 fail both ways**. Killed by AC1.12, against
`test/sample/requests/index.ts`.

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

- The check lives in `Request.registerCalls()`, so the limit is a **registration
  site**, not a particular route: anything registered directly on the parent app
  is not covered. `/health` is the only such route in this repo
  (`src/main.ts:85`) and `GET http://HOST/health` still returns 200 — measured —
  but `RestServer.instance.api` is a public property, so a consumer registering
  an authorized route on it directly is equally outside this control. `/health`
  itself has no `auth` hook, so there is nothing to bypass there; state the limit
  as the registration site rather than as "`/health` is special".
- Only the query string is stripped before comparison, so `GET /admin?x=1`
  reaches the hook. A query string is a legitimately variable part of a request
  target and rejecting on it would 404 every `?`-carrying request. A consumer
  hook that compares `req.originalUrl` against a fixed path without stripping
  the query does not match `/admin?x=1` — measured identical before and after
  the fix, so this is the consumer's comparison to own, and the README says so.
  `test/sample/requests/admin.ts` models the correctly-written hook and AC1.8
  asserts the module still delivers `GET /admin?x=1` to it.
- **`shouldRejectTarget()` is structurally blind to percent-encoding, and that
  has not changed — it is a fourth control that closes it, not this one.**
  Express decodes only `req.params`, so for `GET /enc/%73ecret` both `target`
  and `canonical` are the same encoded string and this comparison passes the
  request through *by construction*. No change to it can see that axis: the
  disagreement is between the matched target and the *decoded* value the handler
  acts on. `canonicalEncoding` (#56) is what rejects it, on its own line, from
  its own key — see § *Percent-encoded request target (#56)* below.

**No regression** (measured): routes registered with a literal trailing slash,
param routes, index-mounted route classes, query strings on canonical paths, and
`/health`. **"No regression" is not "no residual"** — for param routes the two
differ, see § *Percent-encoded request target (#56)* below, and for `/health`
the reason is that it is outside the check entirely.

Consumer-visible behaviour change, on two axes: `GET /route/` at a mount root
goes 200 → 404, and every route **registered through `Request.registerCalls()`**
goes 200 → 404 for a client emitting an absolute-form request target — routes
registered directly on the parent app, `/health` included, do not, per the scope
limits above. The second has the larger blast radius — for such
a client it is a total outage. Rejections are indistinguishable from a genuine
miss by design and this module emits no request logging, so the only symptom is
a bare `Cannot GET …`.

### Percent-encoded request target (#56)

`canonicalEncoding` closes the fourth axis: an ordinary id, spelled oddly. It is
the second member of the family that is **not** a setting, and the second
per-request predicate.

```
target = req.originalUrl.split('?')[0]                                  // raw, unparsed
if (enforced && target has a %XX whose octet is RFC 3986 §2.3 UNRESERVED)
  return next('router');
```

Express decodes `req.params` and **nothing else** — `req.path` and
`req.originalUrl` both stay percent-encoded — so a consumer hook comparing
either raw field was walked past by re-spelling the id. Measured by raw TCP
socket on `dev` @ `224f3e2`, before and after:

| probe | before | after |
|---|---|---|
| `GET /enc/secret` (hook on `req.path`) | 401 | 401 |
| `GET /enc/%73ecret` | **200** (guarded handler, unauthenticated, `id === "secret"`) | **404** |
| `GET /enco/%73ecret` (hook on `req.originalUrl`) | **200** (guarded handler, unauthenticated) | **404** |
| `GET /enc/%73%65%63%72%65%74` | **200** | **404** |
| `GET /private/%66ailure` (literal guard, sibling `/:id`) | **200** `{"data":"param-route"}` | **404** |
| `GET /private/restricted` | 403 | 403 |
| `GET /enc/open` | 200 `id "open"` | 200 `id "open"` |
| `GET /enc/sec%2fret` | 200 `id "sec/ret"` | 200 `id "sec/ret"` |
| `GET /enc/%2573ecret` | 200 `id "%73ecret"` | 200 `id "%73ecret"` |
| `GET /public/url-params/%61/b/c` | 200 | **404** (breaking) |

**Both hook shapes are equally exposed, and that is a structural fact rather
than an oversight.** There is no spelling that defeats a `req.path` hook and not
an `req.originalUrl` one: both fields are raw. The `req.path` shape is the more
likely to exist in the field, because it is the shape this repo's own #47/#50
work steered consumers toward and the one `test/sample/requests/private.ts`
uses.

**A third shape is worse than either, and it is in the shipped fixture.**
`private.ts` guards a **literal** route on `req.path` and co-registers `/:id`.
The encoded spelling misses the literal layer and is **absorbed by the sibling
param route**, so the guard is walked past without the guarded handler ever
being the one that runs. The `req.params?.id === 'restricted'` clause of that
*same hook object* still holds while its `req.path === '/failure'` clause does
not — one hook, two clauses, and the difference is only which field each reads.

**It is a family, not a list of spellings.** Enumerated over a raw socket
against unfixed `dev`, every subset of byte positions crossed with hex-digit
case: **63/63 spellings of `secret` returned 200**, and **71/71 of `admin`**.
The count is `∏(1 + vᵢ) − 1`, where `vᵢ` is the number of percent-spellings of
byte *i* — 2 when its hex carries a letter digit (`m` = `0x6d` → `m`, `%6d`,
`%6D`), 1 otherwise, and ≥2 for every byte of a multi-byte character, so a
non-ASCII id is unbounded for practical purposes. The ACs therefore assert **the
rule**, and sample four positions (first, middle, last, all) only to show it is
not character-positional.

**The bypass is exclusive to route classes with a `:param` segment.** Literal
routes and mount segments match **raw**, so they were never reachable this way —
measured: `GET /admin/%73ettings` → 404 and `GET /%65nc/secret` → 404, both
before and after.

Four things about this are load-bearing and each has a red-able assertion.

**1. The rule is an unreserved-octet scan, not a decode-and-compare.** Two wrong
implementations were built and measured, and each breaks a legitimate request:

| mutation | closes `%73ecret`? | collateral |
|---|---|---|
| `decodeURIComponent(target) !== target` | yes | `GET /enc/sec%2fret` → **404**, but the router routed it to the *distinct* id `sec/ret`. It decodes-then-splits; the router splits-then-decodes |
| decode until stable | yes | `GET /enc/%2573ecret` → **404**, but that names the legitimately distinct id `%73ecret` |

Killed by AC3 and AC4 respectively. Express decodes **exactly once**, so `%2561`
is not a bypass and a loop invents a false deny.

**2. Reserved characters must stay encodable, so the allowlist is over octets
and not over triplets.** RFC 3986 §2.3 names `ALPHA / DIGIT / "-" / "." / "_" /
"~"` as the characters a URI generator must **not** encode and a normaliser
**must** decode (§6.2.2.2), so rejecting them removes the entire "an ordinary
id, spelled oddly" family without touching a single encoding a client is
required to emit. `%2f`, `%2B` and `%25` all still route. Killed by AC3.

**3. It is a fourth key, not a reuse of `canonicalRoutes`.** Measured with the
rule implemented correctly but read through #54's key:
`REST_CANONICAL_ROUTES=false` returns `GET /enc/%73ecret` to **200**. That flag
is exactly what a consumer behind an absolute-form-emitting forward proxy must
set, so folding the two would hand precisely those consumers the encoding bypass
as the price of staying up — the same argument #50 makes for not being a rename
of #47. Killed by unit AC5, which also asserts *in that same state* that #54's
own vector **is** re-opened, so an implementation that ignores `canonicalRoutes`
entirely cannot pass it vacuously.

**4. Same three call-site properties as #54, and they are not re-derived.** It
runs **outside** `if (this.auth)`, **before** it, and rejects with
`next('router')`. The ordering half has its own oracle here and it is a
different one from #54's: `GET /private/restricte%64` answers **404**, because
`private.ts`'s hook reads `req.params.id` — which express decodes — in its
second clause. Move the call below the `auth` block and it answers **403**, the
consumer's own hook status on a request the module was about to reject. Killed
by AC1.6; the `next('router')` half is killed by AC1.4's `shapeOf()`
deep-equal against a genuine miss.

**Malformed and over-long escapes are not this rule's business.** `%zz`, `%`,
`%6`, `%c1%a1` and `%e0%81%a1` all answer **400** from `decodeParam` in
`router@2.2.0` `lib/layer.js:225`, during matching and before any handler or
hook runs — measured identical before and after. None of those octets is
unreserved and the first three are not valid triplets, so the rule does not
touch them either way. Pinned by AC3.4 so that a change which started answering
404 for them would be visible.

**Timing contract:** identical to `shouldRejectTarget()`, opposite to the two
settings. Read **per request**, inside the handler closure; no
lazy-materialisation hazard, so do not move it into `applyRouteMatching()`.

**Scope limit — and this one is the residual the fix cannot close.** The rule
cannot give each decoded id exactly one accepted spelling, because reserved
characters must remain encodable. Measured **after** the fix:

```
GET /enc/a+b        -> 200  id "a+b"
GET /enc/a%2Bb      -> 200  id "a+b"        <- two accepted spellings, ONE id
GET /enc/sec%2fret  -> 200  id "sec/ret"
GET /enc/sec%2Fret  -> 200  id "sec/ret"    <- hex-digit case, same id again
```

So **a hook comparing a raw path string remains unsound for any id containing a
reserved character, and `req.params` is the sound idiom.** `req.params` is
decoded by express and is populated *before* `auth()` runs, by deliberate design
(`src/request.ts`, *"Run auth after route matching so request.params is
populated"*), and the existing integration test *Auth hook has access to
request.params from matched route* pins that. This is the direct analogue of
#54's `?x=1` residual: the consumer's comparison to own, and the module cannot
close it without 404ing encodings clients are required to emit. It gets a ledger
assertion rather than an issue, because it needs no code.

Consumer-visible behaviour change: any client that **over-encodes an unreserved
character** in a path now gets 404 — `GET /public/url-params/%61/b/c` goes
200 → 404, measured on this repo's own fixture. The blast radius is smaller than
#54's, because over-encoding an unreserved character is never required, whereas
absolute-form-emitting forward proxies are a real deployment shape. The opt-out
is `REST_CANONICAL_ENCODING=false` and it **re-opens the bypass**.

## Test Structure

Tests use **QUnit** and run via `stonyx test` (the `npm test` script).

### test/config/environment.ts
Overrides `restServer.dir` to `'./test/sample/requests'` so tests load sample request classes.

### test/unit/request-test.ts
Unit tests for `Request` static methods:
- `getState` — creates/returns state object on request
- `sendStatusResponse` — sends status with optional `statusMap` message
- the four route-matching config flags (`caseSensitiveRoutes` #47, `strictRoutes` #50, `canonicalRoutes` #54, `canonicalEncoding` #56), each over real HTTP on `listen(0)`, each probing **both** failure shapes of the `!== false` guard. This is the only tier that can see a fail-open guard: the shipped defaults are all `true`, so `=== true` leaves every integration assertion green — measured for #56, weakening its read to `=== true` reports 40 pass / 1 fail with the unit AC as the only failure
- #56's AC5, which pins that `canonicalEncoding` is **independent** of `canonicalRoutes` — and asserts, in the same config state, that #54's own vector is genuinely re-opened, so the independence claim cannot pass vacuously
- two fixture classes, not one. `EncodingFixtureRequest` carries the `/:id` route #56 needs and `RouteMatchingFixtureRequest` must not have: measured, adding `/:id` to the shared fixture reds #47's AC6 (`/SUCCESS` is absorbed by the param route at 200). #50's AC3 stays green under that same edit, because `/:id` is equally strict

### test/unit/config-test.ts
Acceptance anchor for #56's AC7 — the shipped default of `canonicalEncoding`
stays **live** and stays **unpinned**, which are two different properties.

- It asserts the **effect**: `config.restServer.canonicalEncoding === true` in
  the resolved config, so inverting or deleting the line in
  `config/environment.js` turns it red. A source-text assertion alone would not.
- It asserts the **set**, not the key: all four route-matching keys resolve to
  the secure direction together, which is what notices a *new* sibling arriving
  with an insecure default.
- It asserts the key is **not pinned** in `test/config/environment.ts`, for all
  four keys, with a positive control (`dir` *is* pinned) so the four absences
  mean absent rather than unread.

The counterintuitive half is the last one, and it is measured rather than
argued: pinning `canonicalEncoding` **and** inverting the shipped default
reports **40 pass / 0 fail** with this file removed — a completely green suite
shipping an insecure default. With this file present the same state reports
**40 pass / 1 fail**. See the comment block on the key in `config/environment.js`
for the full (a)/(b) numbers.

### test/unit/ledger-test.ts
Acceptance anchor for #54's AC3 **and #56's AC8**. Runs `git grep -nE` over the tracked tree for
the four stale claims that #50 left behind — that the mount-root edge is
unclosable by anything, that a `/public/` -> 404 assertion is unachievable, that
the edge is still open, and the instruction not to close it in
`route-matching.ts` — and asserts **0** hits, so no artifact can go on telling a
reader the edge is unclosable after #54 closed it. The same grep returned **8
hits across 5 files** on `origin/dev` @ `f5c9a24`. The patterns are assembled
from fragments in the test rather than written out, because a tracked file
containing them would match itself.

Three properties of it are load-bearing:

- **The patterns are scoped to the CLAIMS, not to the English.** An earlier
  version banned the bare substrings for "the edge is still open" and "it cannot
  be shut" anywhere in the tree — which is the exact wording needed to disclose
  #56's residual honestly, so a guard against an old *dishonest* claim became a
  guard against a new *honest* one. Each pattern now requires the #54 subject
  (the mount root, `/public/`, or "by an express setting") on the same line. The
  test pins both directions: assertion 1 replays the scoped patterns against all
  8 retired claims quoted from `origin/dev`, so narrowing cannot disarm the ban;
  assertion 2 asserts four honest disclosures are *not* matched.

  **#56 turned that principle back on this file.** Two of the four "honest
  disclosures" it carried were honest only while #56 was *open*: a sentence
  saying the percent-encoding axis is unclosed on a param-segment route class is
  a stale claim the moment the fix ships. (Not quoted here — quoting it would
  plant the very string the ledger greps for.) They were **retired into the
  claim list rather than deleted**, and the honest-disclosure list was
  re-pointed at the residual that
  actually remains (reserved characters, multiple spellings, `req.params` as the
  sound comparison). A ledger whose honest-disclosure fixtures are never revisited
  becomes a ledger that certifies last quarter's truth.
- **Assertion 8 was a guard that could not fail, and #56 fixed it rather than
  inheriting it.** It asserted the three artifacts contain the substring `#56` —
  which they still do after the fix, because `#56` appears in the
  behaviour-change list. So it stayed green whether the residual was honestly
  disclosed **or** falsely announced closed, and it could only red under total
  deletion: the `AC10` comment-out shape from `docs/framework/testing.md`. It now
  additionally requires the residual's own markers (the `a%2Bb` measurement and
  `req.params`) in each artifact, and the substring check is kept and labelled
  as the weak half rather than presented as coverage.
- **The grep is repo-root-anchored (`:/`), not cwd-relative (`.`).** With `.`,
  running from `<repo>/test` searched only the test subtree — every pattern
  returned 0 while `README.md`, `docs/` and `src/` were never read, and the old
  positive control still passed because 15 of its hits lived under `test/`. The
  cwd guard was incidental (a `readFileSync` ENOENT 17 lines further down) and
  would have vanished the moment those reads were made dirname-relative. The
  positive control now asserts the grep matches **outside** `test/`, so it
  proves scope rather than mere execution.
- **Only exit 1 with empty output is treated as "no matches";** any other status
  rethrows, so a bad pattern or a non-repository cannot be swallowed as a zero.

Limit worth stating: `git grep` sees **tracked** files only, so a stale phrasing
in a brand-new file that has not been `git add`ed yet is not caught locally. At
the merge gate everything is tracked.

### test/integration/rest-server-test.ts
Integration tests that boot the full server and make HTTP requests:
- 404 for non-existent routes
- `/public` — JSON response, 200 OK default, URL params, middleware (success/failure), `this` binding for handlers and middleware
- `/private` — authenticated success, auth hook rejection (505)
- `/health` — health check endpoint returns 200

### test/sample/requests/
Sample Request subclasses used by integration tests:
- `public.ts` — `PublicRequest` with various GET handlers demonstrating middleware, params, binding. No `auth()` hook, which is what makes it the fixture for #54's AC1.6
- `private.ts` — `PrivateRequest` with `auth()` hook that rejects `/failure` with 505
- `index.ts` — `IndexRequest`, mounted at `/` because of its filename. The only mount shape where `req.baseUrl` is `''`, which is what gives the `&& req.baseUrl` conjunct in `shouldRejectTarget()` a regression guard (#54 AC1.12): without the conjunct `GET /` 404s and, before this fixture existed, the suite stayed 34/0 either way
- `admin.ts` — `AdminRequest` with an `auth()` hook authorizing on **`req.originalUrl`**, the field express does not normalize. That shape is the point: rewritten to compare `req.path` the fixture cannot express #54's defect at all, since `req.baseUrl + req.path` is `/admin/` for both spellings of the mount root. Also registers `/legacy/` *with* a literal trailing slash, so an over-broad "target must not end in /" rule turns AC1.10 red
- `enc.ts` — `EncRequest`, #56 shape A: a `/:id` route guarded by a hook comparing **`req.path`**. The param segment is load-bearing — literal routes match raw, so a literal-only fixture cannot express the defect. Its handler echoes `id`, `path` and `originalUrl` so the ACs can assert *which value the handler received*, which is the asymmetry the defect is made of
- `enco.ts` — `EncoRequest`, #56 shape B: the same route guarded by a hook comparing the query-stripped **`req.originalUrl`**, modelled on `admin.ts`. Both shapes are needed and neither subsumes the other: no spelling defeats one and not the other, because both fields are raw

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
│   ├── main.ts                    # RestServer class (singleton, Express wrapper)
│   ├── request.ts                 # Request base class (handler registration, auth hook)
│   └── route-matching.ts          # Route-matching family: settings (#47/#50) + canonical-target check (#54) + encoding check (#56)
├── test/
│   ├── config/
│   │   └── environment.ts         # Test config override (dir → test/sample/requests)
│   ├── integration/
│   │   └── rest-server-test.ts    # Integration tests (QUnit)
│   ├── sample/
│   │   └── requests/
│   │       ├── admin.ts           # Sample request with an originalUrl auth hook (#54 fixture)
│   │       ├── enc.ts             # /:id guarded on req.path (#56 shape A fixture)
│   │       ├── enco.ts            # /:id guarded on req.originalUrl (#56 shape B fixture)
│   │       ├── index.ts           # Index-mounted class (baseUrl ''), #54 AC1.12 fixture
│   │       ├── private.ts         # Sample private request with auth hook
│   │       └── public.ts          # Sample public request with middleware demos
│   └── unit/
│       ├── config-test.ts         # Shipped-default + unpinned-key anchor (#56 AC7)
│       ├── ledger-test.ts         # Tripwire ledger grep (#54 AC3, #56 AC8)
│       └── request-test.ts        # Unit tests for Request statics (QUnit)
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
