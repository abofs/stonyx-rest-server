# SME Template: Security Reviewer — Stonyx REST Server

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/security-reviewer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-rest-server`
**Framework:** HTTP server module for the Stonyx ecosystem
**Domain:** Express-based REST server handling HTTP routing, CORS, JSON body parsing, authorization hooks, and request middleware for all Stonyx web-facing applications

## Tech Stack

| Layer | Technology |
|-------|-----------|
| HTTP Framework | Express 5 |
| CORS | `cors` npm package (configurable origin and methods) |
| Body Parsing | `express.json()` (built-in) |
| Auth Model | Per-request-class `auth(req, state)` hooks |

## Architecture Patterns

- **CORS configuration surface:** Origins and methods are configurable via `config.restServer.origin` and `config.restServer.methods` — default is `origin: '*'` (wide open) and all standard methods
- **Auth hook execution timing:** Authorization runs AFTER Express route matching, meaning `req.params`, `req.query`, and `req.body` are all populated — auth logic can make decisions based on the full request context
- **Status code response handling:** Integer returns from handlers and auth hooks are sent as HTTP status codes via `sendStatusResponse` — the `statusMap` config can override response bodies for specific codes
- **Sub-app isolation:** Each Request class mounts as an independent Express app, inheriting global middleware (CORS, JSON) but not each other's route-specific middleware

## Live Knowledge

- The default CORS origin is `'*'` — production deployments must override this to restrict allowed origins; the `origin` config accepts both strings and arrays for multiple origins
- Request handlers receive raw Express `req` objects — any header, cookie, or body parsing happens via Express middleware, and handler code must validate inputs since there is no schema validation layer built in
- The `auth` hook returning `undefined` means "authorized" — returning any integer means "rejected with that status code"; a common mistake is returning `0` (falsy but not undefined), which would send a `0` status
- The `redirect` and `pipe` state keys bypass normal JSON response handling — ensure redirect targets are validated to prevent open redirect vulnerabilities, and pipe sources are trusted streams
- `x-powered-by` is disabled on all sub-apps (`api.disable('x-powered-by')`) — this is set in the Request constructor, reducing server fingerprinting
- `caseSensitiveRoutes` (default `true`) sets express's `case sensitive routing` at BOTH construction sites — the `RestServer` parent (`src/main.ts`) and every `Request` sub-app (`src/request.ts`). It closes #47: with it off, a case-varied URL reaches a handler the canonical URL is denied, because the router matches loosely while every `auth` hook reading `req.path`/`req.baseUrl`/`req.originalUrl` matches exactly. **Two settings re-open that fail-open**, and they do not have the same reach: `restServer.caseSensitiveRoutes: false` in consumer config works for every install shape, while `REST_CASE_SENSITIVE_ROUTES=false` is effective only for **`devDependencies`** installs — the stonyx module loader merges a module's `config/environment.js` only for `@stonyx/*` packages listed in `devDependencies` (`stonyx/dist/modules.js:31`), so for a `dependencies` install the variable is inert. Treat any PR or deployment that sets either as security-relevant, and do not clear an env-var finding on install shape alone without checking the config object too.
- Route matching is exact on the **case axis only**. The rest of the loose-matching family is open and each member is a live bypass of URL-based authorization: #50 (trailing slash), #54 (mount-root trailing slash and absolute-form request target, against `originalUrl`), #56 (percent-encoding, against `req.path` and `originalUrl`), #69 (param-value case). Do not treat #47 being closed as evidence that any of these is. Verify the current state of this list before relying on it — see #66.
- The `trustProxy` setting directly controls Express's `trust proxy` behavior — when enabled, `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` headers are trusted, which affects IP resolution and protocol detection
- Error handling in handlers uses a basic pattern: thrown errors propagate to Express's default error handler — there is no global error-catching middleware, so unhandled async rejections in handlers may produce unstructured 500 responses
