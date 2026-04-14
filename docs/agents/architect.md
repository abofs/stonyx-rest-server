# SME Template: Architect — Stonyx REST Server

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/architect.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-rest-server`
**Framework:** HTTP server module for the Stonyx ecosystem
**Domain:** Express-based REST server with dynamic route registration from file-system discovery, built-in CORS/JSON middleware, per-request authorization hooks, and request state management

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| HTTP Framework | Express 5 |
| CORS | `cors` npm package |
| Framework Integration | Stonyx (auto-discovered as `@stonyx/rest-server` module) |
| Testing | QUnit + Sinon |
| Build | `tsc` with dual configs (src and test) |

## Architecture Patterns

- **Singleton server:** `RestServer` class enforces a single instance; other modules (ORM, OAuth) access it via `RestServer.instance` to mount additional routes after initialization
- **File-based route discovery:** `forEachFileImport` scans the configured `requests` directory, instantiates each exported `Request` subclass, and mounts it as an Express sub-app at `/{filename}` (with optional camelCase conversion)
- **Request class abstraction:** Each route file exports a class extending `Request` with a `handlers` object mapping HTTP methods to route paths and handler functions — handlers return integers for status codes, objects for JSON responses, or `undefined` for 200 OK
- **Middleware call stack:** Handler values can be arrays of functions; the stack processes left-to-right, short-circuiting if any middleware returns a non-undefined value — the last function is the main handler
- **Per-request auth hook:** The optional `auth(req, state)` method on Request subclasses runs after Express route matching (so `req.params` is populated) but before any handler — returning a status code blocks the request
- **Request state bag:** `Request.getState(req)` attaches a `__stonyxState` object to the Express request; handlers share state through this object, and special keys (`redirect`, `pipe`) trigger response behaviors
- **Mount-point architecture:** Each Request class creates its own Express app (`express()`) that gets mounted as sub-middleware — this isolates route namespaces and allows independent route registration

## Live Knowledge

- The `mountRoute` method is public and used by other modules (ORM mounts `orm-request`, OAuth mounts `auth-request`) — any changes to its signature or behavior break downstream module integration
- Express 5 is used (not Express 4) — this affects error handling, path matching, and middleware behavior; review Express 5 migration notes for any pattern changes
- The `statusMap` config option maps status codes to custom message strings — if a mapped status is returned from a handler, the response body changes from Express's default to the custom message
- `trustProxy` must be enabled (`REST_TRUST_PROXY=true`) when running behind a load balancer (AWS ALB/ELB) for correct `req.protocol` detection — this affects any code that builds URLs from the request protocol
- The health check endpoint (`GET /health`) is registered last, after all route files — it can be disabled via `REST_HEALTH_CHECK_DISABLE=true` environment variable
- The `pipe` state key enables streaming responses (e.g., file downloads) by piping a readable source directly to the Express response with optional custom headers
