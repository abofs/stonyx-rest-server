# @stonyx/rest-server

REST server module for the [Stonyx framework](https://github.com/abofs/stonyx), providing dynamic route registration and built-in request handling with optional authentication hooks.

## Running the test suite

```
npm test
```

## RestServer

The `RestServer` class wraps an Express.js instance to provide:

* Singleton REST server instance
* Dynamic route mounting from a directory
* Automatic CORS and JSON body handling
* Authorization hooks per request class

### Usage example

This module is part of the **Stonyx framework**. To use it, first configure the `restServer` key in your `environment.js` file:

```js
export default {
    restServer: {
       origin: REST_CORS_ORIGIN ?? '*',
       dir: REST_REQUEST_PATH ?? './requests',
       port: REST_PORT ?? 2666,
       logColor: 'yellow'
   }
};
```

Then initialize the Stonyx framework, which auto-initializes all of its modules, including `@stonyx/rest-server`:

```js
import Stonyx from 'stonyx';
import config from './config/environment.js';

new Stonyx(config);
```

For further framework initialization instructions, see the [Stonyx repository](https://github.com/abofs/stonyx).

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
|       `dir`       |      **String**     | `undefined` | Directory containing request classes to mount as routes    |
| `camelCaseRoutes` |     **Boolean**     | `true`      | Convert filenames to camelCase when generating route paths |
|       `port`      |      **Number**     | `3000`      | Port to listen on                                          |
|      `origin`     | **String \| Array** | `'*'`       | CORS origin(s) allowed                                     |
|    `statusMap`    |      **Object**     | `{}`        | Optional mapping of HTTP status codes to custom messages   |
|      `debug`      |     **Boolean**     | `false`     | Enable debug logging during route setup                    |

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

Perfect! Here’s a self-contained **“Example Requests”** section with sample `curl` calls:

---

### Example Requests

Assuming you have `public.js` and `private.js` routes mounted, you can test them like this:

```bash
# Public route - should return 200 OK with JSON
curl http://localhost:2666/public/success

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
