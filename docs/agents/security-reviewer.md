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
- **Auth hook execution timing:** Authorization runs AFTER Express route matching, meaning `req.params`, `req.query`, and `req.body` are all populated — auth logic can make decisions based on the full request context. The ordering is a standing hazard as well as a convenience: because the matcher runs first, **any axis on which the matcher is looser than a downstream predicate is a fail-open by construction** — the router dispatches a request the `auth` hook's own comparison would have rejected. That is #47 stated generally, and it is the first thing to check on any change to routing or matching
- **Route-matching strictness (post-#47):** the casing axis is closed — `case sensitive routing` is applied at **both** express construction sites via `applyRouteMatching()` (`src/route-matching.ts`), called from the `RestServer` and `Request` constructors. The trailing-slash axis is **not** closed: express's sibling `strict routing` setting is still off, so `GET /private/failure/` reaches a handler that `GET /private/failure` is blocked from (#50, open). Param *values* are not normalized either, so `/private/RESTRICTED` reaching a handler is expected, and a mis-cased sub-path is absorbed by a sibling `/:id` route rather than 404ing
- **Status code response handling:** Integer returns from handlers and auth hooks are sent as HTTP status codes via `sendStatusResponse` — the `statusMap` config can override response bodies for specific codes
- **Sub-app isolation:** Each Request class mounts as an independent Express app, inheriting global middleware (CORS, JSON) but not each other's route-specific middleware

## Live Knowledge

- The default CORS origin is `'*'` — production deployments must override this to restrict allowed origins; the `origin` config accepts both strings and arrays for multiple origins
- Request handlers receive raw Express `req` objects — any header, cookie, or body parsing happens via Express middleware, and handler code must validate inputs since there is no schema validation layer built in
- The `auth` hook returning `undefined` means "authorized" — returning any integer means "rejected with that status code"; a common mistake is returning `0` (falsy but not undefined), which would send a `0` status
- The `redirect` and `pipe` state keys bypass normal JSON response handling — ensure redirect targets are validated to prevent open redirect vulnerabilities, and pipe sources are trusted streams
- Case-sensitive route matching is a security control, not a style choice. `applyRouteMatching()` must keep being called from **both** constructors, and in each case **before any route is registered on that instance** — express materializes a router lazily on first registration, so a setting applied afterwards is silently ineffective, with no throw and no warning. A parent-only fix passes #47's own `DELETE /ANIMALS/22` reproduction while leaving every sub-path open. Flag any PR that moves, drops, or reorders either call, and treat `caseSensitiveRoutes: false` (`REST_CASE_SENSITIVE_ROUTES=false`) as re-opening the URL-authorization bypass at both sites
- `x-powered-by` is disabled on all sub-apps (`api.disable('x-powered-by')`) — this is set in the Request constructor, reducing server fingerprinting
- The `trustProxy` setting directly controls Express's `trust proxy` behavior — when enabled, `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` headers are trusted, which affects IP resolution and protocol detection
- Error handling in handlers uses a basic pattern: thrown errors propagate to Express's default error handler — there is no global error-catching middleware, so unhandled async rejections in handlers may produce unstructured 500 responses
