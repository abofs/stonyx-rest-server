# @stonyx/rest-server — Security Notes

Security-relevant behaviour of the module, for anyone changing `src/` or deploying an app built on it. Each statement below names the source file (and function, where it helps) it was checked against.

## Case-sensitive routing

- `caseSensitiveRoutes` (default `true`) sets express's `case sensitive routing` at both construction sites: the `RestServer` parent (`src/main.ts`) and every `Request` sub-app (`src/request.ts`). It closes #47. With it off, a case-varied URL reaches a handler the canonical URL is denied, because the router matches loosely while every `auth` hook reading `req.path`, `req.baseUrl` or `req.originalUrl` matches exactly.
- Two settings turn it off, and they do not have the same reach. `restServer.caseSensitiveRoutes: false` in consumer config works for every install shape. `REST_CASE_SENSITIVE_ROUTES=false` is read by this module's `config/environment.js`, which the stonyx module loader merges only for `@stonyx/*` packages listed in `devDependencies`; for a `dependencies` install the variable is inert. Treat any change or deployment that sets either one as security-relevant, and check the config object as well as the environment before concluding the setting is on.
- Only an explicit `false` opts out. `null`, `0` and `''` keep matching case-sensitive (`config.restServer?.caseSensitiveRoutes !== false` in both constructors).
- The setting covers the case axis of route matching and nothing else. `src/` does not set express's `strict routing`, and it does nothing about percent-encoding or the case of `:param` values. The README's [Breaking changes](../README.md#breaking-changes) section lists those cases. An `auth` hook that compares URL strings or param values has to do its own normalisation.

## Authorization hook

- `auth(req, state)` runs inside each registered route handler, after express has matched the route, so `req.params`, `req.query` and `req.body` are populated when it runs (`src/request.ts`, `registerCalls()`).
- Any falsy return lets the request through, and any truthy return is sent as the response status (`if (status) return sendStatusResponse(res, status)`). `0`, `null` and `false` therefore **allow** the request, just as `undefined` does. Return a non-zero integer status code to reject.
- `auth` is called without `await`. Make it synchronous; a returned Promise is truthy and is not treated as "allowed".
- The hook only runs for routes declared in that class's `handlers`. A path the class does not declare never reaches it.

## Request handling

- There is no schema validation layer. Handlers receive the raw express `req`, with bodies parsed by `express.json()`; handler code validates its own inputs.
- `state.redirect` is passed to `res.redirect()` unchecked. Validate any redirect target derived from request data, or it is an open redirect. `state.pipe.source` is piped straight to the response, so it must be a trusted stream.
- Response precedence in `registerCalls()`: an integer return is sent as a status first, then `state.redirect`, then `state.pipe`, then the return value (`undefined` → 200, object → JSON, any other type → 500).
- `src/` registers no error-handling middleware. A handler that throws or rejects falls through to express's default error handler.
- Responses still carry `X-Powered-By: Express`. The `Request` constructor calls `api.disable('x-powered-by')` on each sub-app, but the parent `RestServer` app (`src/main.ts`) leaves it enabled, and the parent sets the header before the request reaches the sub-app. Measured with express 5 in this shape (parent default, sub-app disabled): `GET /s/x` → `200`, `x-powered-by: Express`. An app that wants the header gone disables it on `RestServer.instance.api`.

## Configuration

- The default CORS origin is `'*'` (`config/environment.js`). Production deployments should set `restServer.origin` (a string or an array) or `REST_CORS_ORIGIN`.
- `trustProxy` (`REST_TRUST_PROXY=true`) sets express's `trust proxy` to `true`, so `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are trusted from any client. Enable it only behind a proxy that overwrites those headers.
