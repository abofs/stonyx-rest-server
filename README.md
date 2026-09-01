[![CI](https://github.com/abofs/stonyx-rest-server/actions/workflows/ci.yml/badge.svg)](https://github.com/abofs/stonyx-rest-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@stonyx/rest-server.svg)](https://www.npmjs.com/package/@stonyx/rest-server)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# @stonyx/rest-server

REST server module for the [Stonyx framework](https://github.com/abofs/stonyx), providing dynamic route registration and built-in request handling with optional authentication hooks.

## Highlights

* **Zero configuration for routes:** Simply drop your request class files into the configured `requests` directory and the RestServer automatically mounts them.
* **Automatic path generation:** Filenames become route paths (with optional camelCase conversion).
* **Built-in JSON & CORS handling:** No need to manually configure Express middleware.
* **Authorization hooks per request:** Add authentication logic per class with minimal boilerplate.
* **Singleton server:** Only one RestServer instance runs, preventing accidental multiple listeners.
* **Framework integration:** Works seamlessly as part of the Stonyx framework—auto-initialized with the rest of your modules.

## RestServer

The `RestServer` class wraps an Express.js instance to provide:

* Singleton REST server instance
* Dynamic route mounting from a directory
* Automatic CORS and JSON body handling
* Authorization hooks per request class

### Usage example

This module is part of the **Stonyx framework**. To use it, first configure the `restServer` key in your `environment.js` file:

```js
const {
  REST_CORS_ORIGIN,
  REST_PORT,
  REST_REQUEST_PATH
} = process;

export default {
    restServer: {
       origin: REST_CORS_ORIGIN ?? '*',
       dir: REST_REQUEST_PATH ?? './requests',
       port: REST_PORT ?? 2666,
       logColor: 'yellow'
   }
};
```

Then run the application via the Stonyx CLI, which auto-initializes all modules including the REST server:

```bash
stonyx serve
```

For further framework instructions, see the [Stonyx repository](https://github.com/abofs/stonyx).

### Optional Direct Usage

If needed, you can also directly access the `RestServer`:

```js
import RestServer from '@stonyx/rest-server';

const server = new RestServer();
await server.init();

// Close server when needed
RestServer.close();
```

### Configuration Options

Configuration is read from `stonyx/config` under `restServer`:

|       Option      |         Type        | Default     | Description                                                |
| :---------------: | :-----------------: | :---------- | :--------------------------------------------------------- |
|       `dir`       |      **String**     | `'./requests'` | Directory containing request classes to mount as routes    |
| `camelCaseRoutes` |     **Boolean**     | `true`      | Convert filenames to camelCase when generating route paths |
|       `port`      |      **Number**     | `2666`      | Port to listen on                                          |
|      `origin`     | **String \| Array** | `'*'`       | CORS origin(s) allowed                                     |
|    `methods`      | **String**          | `'GET,POST,PATCH,PUT,DELETE'` | CORS allowed methods                              |
| `enableHealthCheck` |   **Boolean**     | `true`      | Register `GET /health` endpoint (disable via `REST_HEALTH_CHECK_DISABLE=true`) |
| `caseSensitiveRoutes` | **Boolean**   | `true`      | Match route paths case-sensitively. Disable via `REST_CASE_SENSITIVE_ROUTES=false`. See [Route Matching Strictness](#route-matching-strictness) — **disabling this re-opens a security hole**. |
| `strictRoutes`    | **Boolean**   | `true`      | Match route paths strictly, so a trailing slash does not match a route registered without one. Disable via `REST_STRICT_ROUTES=false`. See [Route Matching Strictness](#route-matching-strictness) — **disabling this re-opens a security hole**, and note `GET /health/` now 404s. |
| `canonicalRoutes` | **Boolean**   | `true`      | Reject a request whose raw target is not the canonical path express matched, before your `auth` hook runs. Disable via `REST_CANONICAL_ROUTES=false`. See [Route Matching Strictness](#route-matching-strictness) — **disabling this re-opens a security hole**, and note `GET /route/` at a mount root and every absolute-form request target now 404 on the routes this module registers (see the scope limit under [Upgrading](#upgrading-behaviour-changes)). |
| `canonicalEncoding` | **Boolean**   | `true`      | Reject a request whose raw target percent-encodes an RFC 3986 §2.3 *unreserved* character (`A-Z a-z 0-9 - . _ ~`), before your `auth` hook runs. Disable via `REST_CANONICAL_ENCODING=false`. See [Route Matching Strictness](#route-matching-strictness) — **disabling this re-opens a security hole**, and note that a client over-encoding an unreserved character in a path now gets 404 (see [Upgrading](#upgrading-behaviour-changes)). Like `canonicalRoutes` this is a **registration-site** control, not a global one: the check runs in the handlers mounted from your request classes, so a route registered directly on `RestServer.instance.api` gets none of it — measured, `GET /direct/%73ecret` → **200** with `id "secret"` while `GET /enc/%73ecret` → 404. |
|  `trustProxy`   |     **Boolean**     | `false`     | Trust reverse proxy headers (e.g. `X-Forwarded-Proto`). Enable via `REST_TRUST_PROXY=true` when running behind a load balancer such as AWS ALB/ELB to ensure correct protocol detection. |
|    `statusMap`    |      **Object**     | `{}`        | Optional mapping of HTTP status codes to custom messages   |

### Route Matching Strictness

Routes match **case-sensitively, strictly, and only at their canonical target**
by default, and a raw target that percent-encodes an RFC 3986 §2.3 *unreserved*
character is rejected. Four controls, all on.

Note what that does **not** say. It is not "one accepted spelling per id", and
this module cannot give you that: reserved characters, non-ASCII bytes and
control octets all stay encodable, and every one of them whose hex carries a
letter digit aliases by hex-digit case. The residual is stated and measured
below, under [the residual](#the-residual-stated-plainly).

| axis | control | example that no longer matches |
|---|---|---|
| casing | `case sensitive routing` (setting) | `GET /users/Success` -> does not reach `/success` |
| trailing slash | `strict routing` (setting) | `GET /users/success/` -> does not reach `/success` |
| canonical target | `canonicalRoutes` (per-request check) | `GET /users/` and `GET http://host/users` -> do not reach the mounted `/users` class |
| percent-encoding | `canonicalEncoding` (per-request check) | `GET /users/%73ecret` -> does not reach `/users/:id` with `id === "secret"` |

The first two are express settings applied at both construction sites. The last
two are **not settings** — no express setting can express either — they are
per-request checks run ahead of your `auth` hook: one compares the raw request
target against the path express matched, the other rejects a raw target that
percent-encodes a character which never needs encoding. See
[`src/route-matching.ts`](src/route-matching.ts).

Read [What this does not do](#what-this-does-not-do) and
[Upgrading](#upgrading-behaviour-changes) before you rely on that. One thing the
table does not say: "does not reach the handler" is not the same as "404".

This is deliberate and security-relevant. Express matches both case-insensitively
and slash-insensitively by default, which means any authorization written
against the request URL can be walked past by changing the case of the request,
or by appending one character:

```
GET    /owners/angela   -> 404      (correctly filtered)
GET    /OwNeRs/angela   -> 200      (full record)     <- closed by case sensitive routing
GET    /owners/angela/  -> 200      (full record)     <- closed by strict routing
DELETE /ANIMALS/22      -> 204      (record destroyed)
DELETE /animals/22/     -> 204      (record destroyed)
```

The consumer's predicate is stricter than the router that dispatched the
request, so the router hands the handler a request the predicate would have
rejected. Measured against this repo's own fixture, before and after:

```
                          before   after
GET /private/failure        505      505    (auth hook fires, request blocked)
GET /private/failure/       200      404    (auth hook never fired; now a miss)
GET /private/FAILURE        200      200    (absorbed by /:id — see below)
```

For a handler that authorizes on `req.path`, the path it sees can now only ever
be the exact registered spelling, in the exact registered casing, with no
trailing slash. That closes [#47](https://github.com/abofs/stonyx-rest-server/issues/47)
and [#50](https://github.com/abofs/stonyx-rest-server/issues/50).

#### The canonical-target check (`canonicalRoutes`)

**No express *setting* closes the trailing slash on a mount root**, and that has
not changed:

```
GET /public   -> req.path '/'   req.originalUrl '/public'
GET /public/  -> req.path '/'   req.originalUrl '/public/'
```

Express's router applies mount-prefix matching with `strict: false`
unconditionally (`router@2.2.0`; the file-and-line citation is in
[`docs/project-structure.md`](docs/project-structure.md) § *Strict routing
(#50)*), so both forms reach the mounted route class and both arrive with
`req.path === '/'`. A hook authorizing on `req.path` cannot tell them apart, so
for that hook there is no asymmetry to exploit — and there is nothing for
`strict routing` to reject. **A hook comparing `req.originalUrl` sees two
different strings**, and that was a live authorization bypass.

`canonicalRoutes` closes it, as a per-request check rather than a setting
([#54](https://github.com/abofs/stonyx-rest-server/issues/54)). Before your
`auth` hook runs, the raw request target is compared against the path express
matched, and a mismatch is rejected as a plain 404. It closes **two** vectors
against `req.originalUrl` — the field express does not normalize:

```
                                   before   after
GET /admin                           401      401   (hook fires, request blocked)
GET /admin/                          200      404   (hook never fired; now a miss)
GET http://host/admin                200      404   (absolute-form; hook never fired)
GET http://host/admin/settings       200      404   (absolute-form; every route from a request class)
```

The second vector is the one to check first. [RFC 9112
§3.2.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2.2) permits an
**absolute-form** request target, express routes it, and it hands your hook the
whole URI — `req.originalUrl === "http://host/admin"`. Unlike the mount-root
slash, that affects **every route mounted from a request class**, not one edge.
The qualifier is a registration-site limit, not a special case for one URL: the
check runs inside the handlers this module registers, so anything you register
directly on `RestServer.instance.api` is outside it. In this repo that is
`/health` alone, and `GET http://host/health` still returns 200 — measured.

The target is compared **raw**. It is not parsed, normalized or resolved first:
normalizing it would launder exactly the string your hook is exposed to and
re-open the absolute-form vector by construction. Only the query string is
removed before comparison, so `GET /admin?x=1` still reaches your hook — **strip
the query yourself** if your hook compares `req.originalUrl` against a fixed
path, or it will not match (see [Consumer
Contracts](#consumer-contracts)). Rejections are indistinguishable from a
genuine miss by design; see [Upgrading](#upgrading-behaviour-changes).

Routes registered *with* a literal trailing slash are unaffected — their
canonical target carries the slash. So are index-mounted route classes and
query strings on canonical paths.

**Param routes: "unaffected" means "no regression".** `/resource/:id` keeps
matching exactly as it did. `canonicalRoutes` is structurally blind to how a
param value is *spelled* — express decodes only `req.params`, so `target` and
`canonical` are both the same encoded string and this comparison passes the
request through by construction. That axis has its own control, below.

#### The percent-encoding check (`canonicalEncoding`)

Express decodes **`req.params` and nothing else**. `req.path` and
`req.originalUrl` both stay percent-encoded, so an `auth` hook comparing either
of them against a fixed string was walked past by re-spelling the id:

```
                          before   after
GET /enc/secret             401      401   (hook fires, request blocked)
GET /enc/%73ecret           200      404   (hook never fired; handler got id "secret")
GET /enc/%73%65%63%72%65%74 200      404
GET /private/%66ailure      200      404   (guard missed; absorbed by a sibling /:id)
```

`canonicalEncoding` closes it
([#56](https://github.com/abofs/stonyx-rest-server/issues/56)). Before your
`auth` hook runs, the query-stripped raw target is rejected as a plain 404 if it
contains a percent-triplet whose octet is an
[RFC 3986 §2.3](https://www.rfc-editor.org/rfc/rfc3986#section-2.3)
**unreserved** character — `A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`. Those are
exactly the characters a URI generator must **not** encode and a normalizer
**must** decode, so nothing a client is required to send is affected.

**This is not a list of spellings, it is a family.** For an id of *n* bytes
there are `∏(1 + vᵢ) − 1` non-canonical spellings, where a byte whose hex
carries a letter digit has two (`m`, `%6d`, `%6D`). Measured against unfixed
code: **63 of 63** spellings of `secret` returned 200, and **71 of 71** of
`admin`. Enumerating them in your own hook is not a remedy.

**Three things it deliberately does not reject:**

```
GET /enc/sec%2fret   -> 200  id "sec/ret"    %2f is RESERVED — must stay encodable
GET /enc/a%2Bb       -> 200  id "a+b"        %2B is RESERVED
GET /enc/%2573ecret  -> 200  id "%73ecret"   express decodes exactly ONCE
GET /enc/x?name=%61  -> 200  id "x"          the query string is stripped, not scanned
GET /enc/%zz         -> 400                  malformed escapes are the router's 400, unchanged
```

If you were tempted to write `decodeURIComponent(req.path)` in your hook: the
first line is why not. The router **splits then decodes**, so `sec%2fret` is one
segment naming the id `sec/ret`; a hook that decodes then splits sees two
segments and denies a request the router routed somewhere else entirely. And a
hook that decodes *until stable* denies line three, which is a legitimately
distinct id.

#### The residual, stated plainly

**This does not give each id one spelling.** The rule rejects an over-encoded
*unreserved* octet, which means every octet **outside** `A-Za-z0-9-._~` stays
encodable — and any such octet whose hex carries a letter digit therefore has
two accepted spellings, upper- and lower-case hex. **That is every reserved
character, every non-ASCII byte, and every control octet whose hex carries a
letter digit — not only the reserved ones.** It is not the whole complement of
`A-Za-z0-9-._~`: `%21` and `%40` carry no letter hex digit and alias
literal-versus-encoded instead, `%00` and `%09` keep exactly one accepted
spelling and do not alias at all, and `%90` is a 400. Two different raw targets
can still name the same record:

```
GET /enc/a+b                  -> 200  id "a+b"
GET /enc/a%2Bb                -> 200  id "a+b"      <- two accepted spellings, one id
GET /enc/sec%2fret            -> 200  id "sec/ret"
GET /enc/sec%2Fret            -> 200  id "sec/ret"  <- hex-digit case, same id again

GET /i18n/caf%C3%A9           -> 401  hook denies this spelling
GET /i18n/caf%c3%a9           -> 200  id "café"     <- same id, hook walked past
GET /i18n/%E5%8C%97%E4%BA%AC  -> 401
GET /i18n/%e5%8c%97%e4%ba%ac  -> 200  id "北京"
GET /i18n/a%0Db               -> 401
GET /i18n/a%0db               -> 200  id "a\rb"     <- a CONTROL octet, same aliasing
```

The last six lines were measured against this module's shipped predicate on a
deny list holding **no reserved character at all** — the three uppercase-hex
spellings, nothing else. If your ids are i18n text, or anything else that is not
pure `A-Za-z0-9-._~`, the residual applies to you. Reading it as "only affects
ids with a `/` or a `+` in them" is the mistake this paragraph exists to
prevent.

**So a hook comparing a raw path string is still unsound for any id carrying an
octet outside `A-Za-z0-9-._~` that keeps more than one accepted spelling —
reserved characters, non-ASCII bytes and control octets whose hex carries a
letter digit alike — and `req.params` is the sound comparison.** `req.params` is
decoded by express and is populated *before* your `auth` hook runs, by design —
compare that, and none of this applies to you. This module cannot close the
residual for you without 404ing encodings clients are entitled to send; see
[Consumer Contracts](#consumer-contracts).

#### What this does not do

**It does not normalize path *parameter values*.** If your `auth()` hook rejects
`params.id === 'restricted'`, then `GET /private/RESTRICTED` still reaches the
handler — the router matched the route correctly, and `restricted` and
`RESTRICTED` are different values. Record ids are legitimately case-sensitive,
so this is a comparison your application owns. Compare param values with the
same case-handling you use when you look them up.

**A sub-path that misses is not necessarily a 404.** If the route class also
registers a param route such as `/:id`, a mis-cased sub-path is absorbed by it
rather than rejected. `GET /private/FAILURE` misses `/failure` and is dispatched
to `/:id` with `id="FAILURE"` — a different handler, at 200, not a miss; this
repo's AC5 asserts exactly that. A class exposing `/orders/summary` alongside
`/orders/:id` will send `GET /orders/SUMMARY` into the `/:id` handler and its
database lookup. The param route's own `auth()` hook still runs, so this is an
expectation defect rather than a bypass — but plan for a reroute, not a 404.

Note the two axes differ here. A *trailing slash* is not absorbed by `/:id`,
because `/:id` is equally strict: `GET /private/failure/` misses `/failure` and
misses `/:id`, and is a true 404.

**It does not redirect or rewrite** mixed-case or trailing-slash requests to
their canonical form. Whether `/Users` is a typo to forgive or an attack to
reject is an application policy decision, and encoding it here would mint
another variant of the bug above.

#### Upgrading: behaviour changes

All four controls change which requests match, so all four are
consumer-visible.

**A client that over-encodes an unreserved character in a path now gets 404.**
`GET /public/url-params/%61/b/c` returns **404** where it previously returned
200 — measured on this repo's own fixture. `%61` is `a`, and
[RFC 3986 §2.3](https://www.rfc-editor.org/rfc/rfc3986#section-2.3) says a
generator must not encode it, so no correct client emits this. Some do anyway:
over-eager `encodeURIComponent` on an id that never needed it, a URL builder
that percent-encodes everything, or a client library normalizing in the wrong
direction. Reserved characters are **unaffected** — `%2f`, `%2B`, `%25` and
every non-ASCII byte still route, and so does anything in the query string.
Remediation is `REST_CANONICAL_ENCODING=false`, or fix the client. Like the two
below, the rejection is **indistinguishable from a route that was never
registered**, and this module emits no request logging.

**Clients or forward proxies sending absolute-form request targets now get 404
on every route mounted from a request class.** `GET http://host/admin HTTP/1.1`
is a legal request target
([RFC 9112 §3.2.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2.2)), and
express used to route it. It is now rejected on every route this module
registers — for a client that emits it, this is a total outage, not a partial
one, and it is the largest blast radius in this change. The one carve-out is a
**registration site**, not a route: the check lives in the handlers mounted from
your request classes, so anything registered directly on
`RestServer.instance.api` never reaches it. `GET /health` is the only such route
in this repo, and `GET http://host/health` still returns 200 — so do not use it
to confirm the new rejection is live, and do not assume an authorized route you
registered on `api` yourself is covered. Reverse proxies in normal use (nginx,
HAProxy, AWS ALB) send origin-form and are unaffected; **forward** proxies and
hand-rolled HTTP clients are the exposure. Remediation is
`REST_CANONICAL_ROUTES=false`, or fix the client.

**`GET /route/` at a mounted route class's root now returns 404.** Previously
200. If a client appends a trailing slash to a mount root, it stops working.

Both rejections are **indistinguishable from a route that was never
registered** — same status, same `Content-Type`, same headers — which is the
intended security property: a distinguishable rejection is an oracle telling an
attacker the route exists and was merely spelled wrong. Combined with this
module emitting **no request logging**, a broken client shows up as a bare
`Cannot GET …` with nothing at all on the server side. **Check this first if
routes start 404ing after upgrade.**

**`GET /health/` now returns 404.** `GET /health` is unaffected. This is the
change most likely to page someone, and it is an **availability** problem rather
than a 404 you will read about in a log: if a Kubernetes liveness probe, an ELB
target-group health check or an uptime monitor is pointed at the trailing-slash
form, it starts failing and the deployment gets marked unhealthy and cycled.
This module emits no request logging, so the only symptom is the probe going
red. **Check your probe URLs before upgrading.**

Also affected:

- **Param routes.** `/resource/:id/` no longer matches. Any client calling
  `/private/restricted/` gets a 404 where it previously got the param route.
- **Trailing-slash-normalizing proxies.** nginx `try_files`/`rewrite`, Apache
  `DirectorySlash On` and some CDN edge rules append a slash; behind one of
  those, every route stops matching at once.
- **Mount paths from filenames.** With `camelCaseRoutes` truthy, `phone-number.ts`
  mounts at `/phoneNumber`, so `GET /phonenumber` returns 404; with it falsy,
  `Users.ts` mounts at `/Users`, so `GET /users` returns 404.

A request that stops matching returns express's default `404 Cannot GET /x` with
no log line and no stack, so it looks like a deploy that dropped a route.

#### Opting out

Four separate flags, one per axis:

```bash
REST_CASE_SENSITIVE_ROUTES=false   # restores case-insensitive matching (#47)
REST_STRICT_ROUTES=false           # restores trailing-slash tolerance (#50)
REST_CANONICAL_ROUTES=false        # restores non-canonical request targets (#54)
REST_CANONICAL_ENCODING=false      # restores percent-encoded spellings (#56)
```

or equivalently
`restServer: { caseSensitiveRoutes: false, strictRoutes: false, canonicalRoutes: false, canonicalEncoding: false }`.

**They are deliberately separate keys, and none implies the others.** Slash
tolerance is a legitimate need — a health-check URL you cannot change today is
the common case. Casing tolerance almost never is. Folding them into one flag
would force anyone who needs the first to accept the second, which is why a
consumer who took the `#47` opt-out still has to set `REST_STRICT_ROUTES=false`
separately to keep trailing slashes working. `REST_CANONICAL_ROUTES=false` is
separate for the same reason: a consumer who needs mount-root slash tolerance
should not have to re-open `#50`'s sub-path bypass to get it.

`REST_CANONICAL_ROUTES=false` is a **temporary remediation**, not a
configuration to run on. It re-opens both `#54` vectors at once — the mount-root
slash *and* the absolute-form target — against any hook authorizing on
`req.originalUrl`. It is env-only, so restoring service does not need a
redeploy; use it to stop the bleeding, then fix the client and remove it.

**`REST_CANONICAL_ENCODING=false` re-opens the `#56` bypass, and it is the
widest of the four.** With it set, `GET /users/%73ecret` reaches your `/:id`
handler with `id === "secret"` while your hook compared `%73ecret` and did not
match — and it does that against a hook comparing `req.path` **or**
`req.originalUrl`, on every route class with a param segment. The other three
flags each re-open one field's worth of exposure; this one re-opens both. It is
also **independent** of `REST_CANONICAL_ROUTES`: if you have to set that one for
an absolute-form-emitting forward proxy, you keep this one on, which is exactly
why they are separate keys. If you must set it, the mitigation that costs you
nothing is to compare `req.params` in your hook rather than a raw path string —
`req.params` is decoded and was never exposed to this.

**Each flag restores the corresponding vulnerability described above** — the
URL-based authorization in your application becomes bypassable along that axis
again. They exist as one-line remediations for an existing deployment, not as a
configuration to run on. Set the flag to restore service, then fix the client
and remove the flag.

### Consumer Contracts

Three things this module deliberately does **not** do for you. Each is a state
the framework permits, only your own discipline prevents, and that produces **no
error and no log** when that discipline lapses — so they are collected here
rather than left implied by the sections above.

| you must | because | symptom if you don't |
|---|---|---|
| **Strip the query string** before comparing `req.originalUrl` to a fixed path in an `auth` hook | `canonicalRoutes` compares the query-*stripped* target — a query string is a legitimately variable part of a request target, and rejecting on it would 404 every `?`-carrying request | `GET /admin?x=1` reaches your guarded handler **unauthenticated**, 200, no error, no log. Measured identical before and after `canonicalRoutes` |
| **Compare `req.params`, not a raw path string** | express decodes only `req.params`; `req.path` and `req.originalUrl` both stay percent-encoded. `canonicalEncoding` (#56) rejects an over-encoded *unreserved* character, but **reserved** characters must stay encodable, so one decoded id still has more than one accepted spelling: `GET /orders/a+b` and `GET /orders/a%2Bb` both run the handler with `id === "a+b"`, and `sec%2fret` / `sec%2Fret` both give `sec/ret` | your hook compares one spelling, the request arrives in another, and the handler runs **unauthenticated** — 200, no error, no log. Comparing `req.params.id` instead is immune by construction, and it is populated before `auth()` runs |
| **Compare param values with the same casing you look them up with** | param *values* are never case-normalized, and record ids are legitimately case-sensitive | `GET /orders/SECRET` runs the handler with `id === "SECRET"` while your hook compared `secret`. Note that lower-casing the value is **not** the fix: it false-denies a genuinely distinct `SECRET` record and, measured in a sibling module, false-allowed an encoded spelling at the same time |
| **Return `undefined` from `auth()` to mean "authorized"** — never `0` | any integer return is sent as the HTTP status | returning `0` sends a `0` status rather than allowing the request |

`test/sample/requests/admin.ts` in this repo is the worked example of a
correctly-written `originalUrl` hook for the first row.

### Running Behind a Load Balancer

When your application runs behind a reverse proxy or load balancer (e.g. AWS ALB/ELB), the load balancer terminates SSL and forwards requests to your server over HTTP internally. This means Express sees `http` as the protocol even though the original client request used `https`.

To fix this, enable the `trustProxy` option:

```bash
REST_TRUST_PROXY=true
```

This tells Express to trust the `X-Forwarded-Proto` header set by the load balancer, so `request.protocol` correctly returns `https`. This is important for any functionality that generates URLs based on the incoming request protocol, such as JSON:API relationship links.

## Request Class

The `Request` class provides a structured way to define route handlers and authorization hooks. Route classes extend `Request` and define:

* `handlers` — an object mapping HTTP methods to route paths and handler functions
* Optional `auth(request, state)` — authentication middleware returning a status code if unauthorized

### Usage example

```js
import { Request } from '@stonyx/rest-server';

export default class MyRequest extends Request {
  handlers = {
    get: {
      '/': (_req, _state) => ({ message: 'Hello world' }),
      '/error': (_req, _state) => 500
    }
  }

  auth(req, state) {
    if (!req.headers.authorization) return 401;
  }
}
```

### Handler Features

* Middleware support by passing an array of functions for a route
* Automatic binding of `this` for instance methods
* Returns integers as HTTP status codes
* Returns objects as JSON responses
* Undefined responses default to `200 OK`
* Invalid HTTP methods are skipped with a warning

## Example Project Structure

Here’s an example of how to structure your `requests` directory for dynamic route loading:

```
project-root/
├─ config/
│  └─ environment.js       # contains restServer configuration
├─ requests/
│  ├─ public.js            # PublicRequest class
│  └─ private.js           # PrivateRequest class
├─ src/
│  └─ main.js              # Optional direct usage of RestServer
└─ package.json
```

* `public.js` — contains public-facing routes without authentication
* `private.js` — contains routes with authentication via the `auth` hook

The `RestServer` will automatically mount these routes using the filenames as paths (`/public` and `/private` by default, or camelCased if configured).

### Example Requests

Assuming you have `public.js` and `private.js` routes mounted, you can test them like this:

```bash
# Public route - should return 200 OK with JSON
curl http://localhost:2666/public

# Public route with no return - defaults to 200 OK
curl http://localhost:2666/public/success

# Private route - authenticated request
curl http://localhost:2666/private/success -H "Authorization: token"

# Private route - unauthenticated request
curl http://localhost:2666/private/failure
# Returns HTTP 505 as defined by the auth hook
```

**Notes:**

* Public routes can be accessed without authentication.
* Private routes use the `auth` hook defined in the request class.
* Integer returns from handlers are treated as HTTP status codes.
* Objects returned from handlers are sent as JSON responses.

---

## License

Apache — do what you want, just keep attribution.
