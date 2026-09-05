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
| `camelCaseRoutes` |     **Boolean**     | *(unset — `config/environment.js` sets no default)* | When explicitly `true`, converts hyphenated filenames to camelCase when generating route paths. Unset, so filenames are used **verbatim** |
|       `port`      |      **Number**     | `2666`      | Port to listen on                                          |
|      `origin`     | **String \| Array** | `'*'`       | CORS origin(s) allowed                                     |
|    `methods`      | **String**          | `'GET,POST,PATCH,PUT,DELETE'` | CORS allowed methods                              |
| `enableHealthCheck` |   **Boolean**     | `true`      | Register `GET /health` endpoint (disable via `REST_HEALTH_CHECK_DISABLE=true`) |
| `caseSensitiveRoutes` |  **Boolean**  | `true`      | Match route paths case-sensitively. Opt out with `restServer.caseSensitiveRoutes: false` (or `REST_CASE_SENSITIVE_ROUTES=false`, devDependencies installs only) — read [Breaking changes](#breaking-changes) before you do |
|  `trustProxy`   |     **Boolean**     | `false`     | Trust reverse proxy headers (e.g. `X-Forwarded-Proto`). Enable via `REST_TRUST_PROXY=true` when running behind a load balancer such as AWS ALB/ELB to ensure correct protocol detection. |
|    `statusMap`    |      **Object**     | `{}`        | Optional mapping of HTTP status codes to custom messages   |

### Case-Sensitive Route Matching

Routes match **case-sensitively**. `GET /Users` does not reach a route mounted at `/users`; it returns 404.

This is deliberate and is a security property, not a style choice. Express matches case-insensitively by default, but `request.path`, `request.baseUrl` and `request.originalUrl` all preserve the caller's casing — so an `auth` hook written against the path is case-sensitive while the router that dispatched to it is not. A caller who changes the case of a URL then reaches a handler the canonical URL is denied.

Measured against this repo's own sample requests, **before this change**:

```
GET /public/SUCCESS   ->  200   the /success handler runs
GET /PRIVATE/failure  ->  505   the auth hook fires on a path it was never written for
```

**After this change:**

```
GET /public/SUCCESS   ->  404
GET /PRIVATE/failure  ->  404
GET /public/success   ->  200   canonical paths are untouched
GET /private/failure  ->  505   canonical paths are untouched
```

A router that matches more loosely than every downstream matcher is a fail-open by construction, so the default is the strict one.

> **Why not `GET /private/FAILURE` as the probe?** It returns `200` both before and after, because the sample `private.ts` also registers `/:id`, which absorbs the miss. What changes is *which handler ran* — before, the case-varied URL reached the `/failure` handler that `auth` denies with `505`; after, it can only reach the `/:id` handler. Status alone is not a reliable signal that the fix landed; use `GET /public/SUCCESS` for that.

### Breaking changes

Case-sensitive matching is a **behaviour change**. Requests that previously reached a route now return 404.

**Who is affected:**

* Any client sending a URL whose case does not exactly match the mounted path — hand-written links, bookmarked or cached URLs, third-party callers, anything that upper-cases path segments.
* Any app with a capitalised or hyphenated request filename. Mount paths come from filenames, and `camelCaseRoutes` never lower-cases anything: it only upper-cases the letter following a `-`. So `Users.ts` mounts at `/Users` under **both** `camelCaseRoutes` settings, including the default. `phone-number.ts` mounts at `/phone-number` by default — `config/environment.js` declares no `camelCaseRoutes` key, so filenames are used verbatim — and at `/phoneNumber` only if you have explicitly set `camelCaseRoutes: true`. Clients that hardcode `/users` or `/phonenumber` start 404ing.
* Anything matching the URL downstream of the router — reverse proxies, WAF path rules, analytics path grouping, `originalUrl`-based routing.
* `GET /HEALTH` no longer answers. Only `GET /health` does.

**The symptom.** Express's default 404, with **no log line and no stack** — `RestServer` registers no 404 handler, so nothing is emitted server-side:

```
HTTP/1.1 404 Not Found
Content-Type: text/html; charset=utf-8

<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head>
<body><pre>Cannot GET /public/SUCCESS</pre></body></html>
```

If routes appear to have vanished after upgrading, `Cannot GET` in the response body is the only string to grep for. Silence in the logs is expected here and is not evidence of a dropped route or a bad build.

**Before you upgrade,** list your actual mount paths and compare them against the URLs your clients send:

```bash
ls requests/    # every filename becomes a mount path
```

Any filename that is not already all-lowercase produces a mixed-case mount that now requires exact casing from callers. Hyphenated filenames are **not** affected by default, because `camelCaseRoutes` is unset and filenames are used verbatim; they are only at risk if you have explicitly set `camelCaseRoutes: true`, which mounts `phone-number.ts` at `/phoneNumber`.

**Opting out (temporary).** Two forms, and they are **not** interchangeable:

```js
// config/environment.js in YOUR app — works for every install shape
export default {
  restServer: { caseSensitiveRoutes: false }
};
```

```bash
# environment variable — only effective when @stonyx/rest-server is in your devDependencies
REST_CASE_SENSITIVE_ROUTES=false
```

The environment variable is read by this module's own `config/environment.js`, and the Stonyx module loader merges that file only for `@stonyx/*` packages listed in your **`devDependencies`**. If you install `@stonyx/rest-server` into `dependencies`, the file is never loaded and the variable is inert. The config-object form wins in both install shapes, so prefer it.

Either form restores Express's default case-insensitive matching. It also re-opens the **case-variant fail-open** described above for any authorization that matches on a URL, so treat it as a temporary measure while you fix client casing, not as a setting to leave on. It has no effect on the other residuals below, which are open either way.

**Scope.** This makes *route matching* exact on the **case axis only**. It closes [#47](https://github.com/abofs/stonyx-rest-server/issues/47) and nothing else. The following are known-open members of the same loose-matching family. None is closed by this setting, and this list is the residual risk that is currently *tracked* — not a statement that URL matching is otherwise exact.

* **Path parameter values — [#69](https://github.com/abofs/stonyx-rest-server/issues/69).** Route matching is exact, but the router will deliver a `:param` value in any casing, and a hook comparing `request.params.id` is doing its own case-sensitive comparison against it. This is a **bypass**, not a normalisation nicety. Measured against this repo's sample `private.ts`, whose hook is `if (request.params?.id === 'restricted') return 403`:

  ```
  GET /private/restricted   ->  403 Forbidden
  GET /private/RESTRICTED   ->  200 {"data":"param-route"}   guarded handler runs
  ```

* **Trailing slashes — [#50](https://github.com/abofs/stonyx-rest-server/issues/50).** Express's `strict routing` is a separate setting and is still off, so `GET /private/failure/` still matches `/failure` and still bypasses a path-matching `auth` hook.
* **Mount-root trailing slash and absolute-form request targets — [#54](https://github.com/abofs/stonyx-rest-server/issues/54).** Both are seen by an `originalUrl`-matching hook as a different string from the canonical URL.
* **Percent-encoding — [#56](https://github.com/abofs/stonyx-rest-server/issues/56).** `GET /enc/%73ecret` reaches the handler that `GET /enc/secret` is denied, defeating hooks written against `req.path` and against `originalUrl` alike.

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

The `RestServer` will automatically mount these routes using the filenames as paths (`/public` and `/private` by default, or camelCased if `camelCaseRoutes` is enabled).

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
