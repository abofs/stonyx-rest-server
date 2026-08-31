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
- **Route-matching strictness (post-#47, post-#50):** both axes are closed for hooks authorizing on `req.path` — `case sensitive routing` and `strict routing` are applied at **both** express construction sites via `applyRouteMatching()` (`src/route-matching.ts`), called from the `RestServer` and `Request` constructors. The two settings do **not** behave the same per site: for `strict routing` the **child** site closes the whole defect alone and the **parent** site closes only `/health/`, because `router@2.2.0` `index.js:400-401` hardcodes `strict: false` for `Router.prototype.use` and mount segments are therefore structurally strict-immune (the opposite of `sensitive`, which `use()` forwards). **One edge remains open and cannot be closed:** `/public` and `/public/` both reach the sub-app with `req.path === '/'`, so a hook comparing `req.originalUrl` instead of `req.path` still sees two different strings for a mounted route class. Treat "authorizes on `originalUrl`" as a live finding. Param *values* are not normalized either, so `/private/RESTRICTED` reaching a handler is expected, and a mis-cased sub-path is absorbed by a sibling `/:id` route rather than 404ing (a *trailing-slash* miss is not — `/:id` is equally strict, so it is a true 404)
- **Status code response handling:** Integer returns from handlers and auth hooks are sent as HTTP status codes via `sendStatusResponse` — the `statusMap` config can override response bodies for specific codes
- **Sub-app isolation:** Each Request class mounts as an independent Express app, inheriting global middleware (CORS, JSON) but not each other's route-specific middleware

## Live Knowledge

- The default CORS origin is `'*'` — production deployments must override this to restrict allowed origins; the `origin` config accepts both strings and arrays for multiple origins
- Request handlers receive raw Express `req` objects — any header, cookie, or body parsing happens via Express middleware, and handler code must validate inputs since there is no schema validation layer built in
- The `auth` hook returning `undefined` means "authorized" — returning any integer means "rejected with that status code"; a common mistake is returning `0` (falsy but not undefined), which would send a `0` status
- The `redirect` and `pipe` state keys bypass normal JSON response handling — ensure redirect targets are validated to prevent open redirect vulnerabilities, and pipe sources are trusted streams
- Route matching strictness is a security control, not a style choice. `applyRouteMatching()` must keep being called from **both** constructors, and in each case **before any route is registered on that instance** — express materializes a router lazily on first registration, so a setting applied afterwards is silently ineffective, with no throw and no warning. A parent-only fix passes #47's own `DELETE /ANIMALS/22` reproduction while leaving every sub-path open, and does nothing at all for `DELETE /animals/22/`. Flag any PR that moves, drops, or reorders either call, and treat `caseSensitiveRoutes: false` / `strictRoutes: false` (`REST_CASE_SENSITIVE_ROUTES=false`, `REST_STRICT_ROUTES=false`) as re-opening the corresponding URL-authorization bypass. The two flags are separate keys and neither implies the other — that separation is deliberate, so a consumer needing slash tolerance is not forced to re-open the case bypass; flag any proposal to merge or rename them
- Both flags are guarded `!== false`, not by a truthy check, and both default to the truthy direction. A truthy check fails **open** for any consumer whose shipped config predates the key. The integration tier cannot see this: with the shipped default `true`, a `=== true` guard leaves every integration test green. Only `test/unit/request-test.ts` AC3/AC6 can distinguish it, and AC3 additionally covers the own-property-absent case that a `sinon.stub().value()` cannot express. Flag any change that weakens either guard's polarity or deletes those unit assertions
- Neither flag is pinned in `test/config/environment.ts`, deliberately (#43). Pinning them makes an insecure *shipped* default in `config/environment.js` invisible to a green suite — measured for both keys. Flag any PR that pins them as part of #43 test-isolation work
- `x-powered-by` is disabled on all sub-apps (`api.disable('x-powered-by')`) — this is set in the Request constructor, reducing server fingerprinting
- The `trustProxy` setting directly controls Express's `trust proxy` behavior — when enabled, `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` headers are trusted, which affects IP resolution and protocol detection
- Error handling in handlers uses a basic pattern: thrown errors propagate to Express's default error handler — there is no global error-catching middleware, so unhandled async rejections in handlers may produce unstructured 500 responses
