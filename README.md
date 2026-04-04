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
|  `trustProxy`   |     **Boolean**     | `false`     | Trust reverse proxy headers (e.g. `X-Forwarded-Proto`). Enable via `REST_TRUST_PROXY=true` when running behind a load balancer such as AWS ALB/ELB to ensure correct protocol detection. |
|    `statusMap`    |      **Object**     | `{}`        | Optional mapping of HTTP status codes to custom messages   |

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
