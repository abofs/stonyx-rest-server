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
|  `trustProxy`   |     **Boolean**     | `false`     | Trust reverse proxy headers (e.g. `X-Forwarded-Proto`). Enable via `REST_TRUST_PROXY=true` when running behind a load balancer such as AWS ALB/ELB to ensure correct protocol detection. |
|    `statusMap`    |      **Object**     | `{}`        | Optional mapping of HTTP status codes to custom messages   |

### Route Matching Strictness

Routes match **case-sensitively and strictly by default**. Two settings, both
on, both applied at both express construction sites:

| axis | setting | example that no longer matches |
|---|---|---|
| casing | `case sensitive routing` | `GET /users/Success` -> does not reach `/success` |
| trailing slash | `strict routing` | `GET /users/success/` -> does not reach `/success` |

Read [What this does not do](#what-this-does-not-do) and
[Upgrading](#upgrading-behaviour-changes) before you rely on that. Two things
the table does not say: "does not reach the handler" is not the same as "404",
and one edge of the trailing-slash axis is **not** closed and cannot be.

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

#### What this does not do

**It does not close the trailing slash on a mount root, and no setting can.**
This is the one edge that remains open, so do not read the section above as
closing the class outright:

```
GET /public   -> req.path '/'   req.originalUrl '/public'
GET /public/  -> req.path '/'   req.originalUrl '/public/'
```

Express's router applies mount-prefix matching with `strict: false`
unconditionally (`router@2.2.0`, `index.js:400-401`), so both forms reach the
mounted route class and both arrive with `req.path === '/'`. A hook authorizing
on `req.path` cannot tell them apart, so for that hook there is no asymmetry to
exploit. **A hook comparing `req.originalUrl` still sees two different strings,
and `strictRoutes` does not change that.** If your authorization compares
`req.originalUrl` rather than `req.path`, keep whatever URL normalization you
have.

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

Both settings change which requests match, so both are consumer-visible.

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

Two separate flags, one per axis:

```bash
REST_CASE_SENSITIVE_ROUTES=false   # restores case-insensitive matching (#47)
REST_STRICT_ROUTES=false           # restores trailing-slash tolerance (#50)
```

or equivalently `restServer: { caseSensitiveRoutes: false, strictRoutes: false }`.

**They are deliberately separate keys, and neither implies the other.** Slash
tolerance is a legitimate need — a health-check URL you cannot change today is
the common case. Casing tolerance almost never is. Folding them into one flag
would force anyone who needs the first to accept the second, which is why a
consumer who took the `#47` opt-out still has to set `REST_STRICT_ROUTES=false`
separately to keep trailing slashes working.

**Each flag restores the corresponding vulnerability described above** — the
URL-based authorization in your application becomes bypassable along that axis
again. They exist as one-line remediations for an existing deployment, not as a
configuration to run on. Set the flag to restore service, then fix the client
and remove the flag.

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
