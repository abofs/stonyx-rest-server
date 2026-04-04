# Improvement Opportunities

## 1. `new express()` in RestServer constructor

**File**: `src/main.js`, line 30

```js
this.api = new express();
```

Express 5 (which this project targets via `"express": "^5.1.0"`) documents calling `express()` as a plain function, not as a constructor with `new`. While `new express()` works in practice because the function returns a new object regardless, it is unconventional and may break if Express ever enforces non-constructor semantics. Consider changing to:

```js
this.api = express();
```

Note: The `Request` class in `src/request.js` line 26 already uses the correct pattern (`const api = express();` without `new`).

## 2. `setupGlobalMiddleware` is `async` but contains no awaits

**File**: `src/main.js`, lines 63-70

```js
async setupGlobalMiddleware() {
  const { origin, methods } = config.restServer;

  this.api.use([
    cors({ origin, methods }),
    express.json()
  ]);
}
```

The `async` keyword is unnecessary here since the method body contains no `await` expressions and `app.use()` is synchronous. The `async` keyword causes the method to return a `Promise` wrapping `undefined`, but the caller (`setupRouter`) does not `await` it either — it calls `this.setupGlobalMiddleware()` without `await` on line 52. Removing `async` would make the intent clearer.

## 3. `logMethod` config option is not used in rest-server source

**File**: `config/environment.js`, line 16

```js
logMethod: 'api'
```

The `logMethod` property is defined in the default config but is never referenced anywhere in `src/main.js` or `src/request.js`. It is likely consumed by the Stonyx framework core (`stonyx/log`) for registering a named log method, but this should be verified. If it is indeed framework-level plumbing, consider documenting that it is a Stonyx convention rather than a rest-server feature. If it is unused, consider removing it to reduce config surface area.
