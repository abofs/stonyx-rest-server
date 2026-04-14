# SME Template: Validation Loop Team — Stonyx REST Server

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/validation-loop-team.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-rest-server`
**Framework:** HTTP server module for the Stonyx ecosystem
**Domain:** Dynamic Express-based REST server powering HTTP endpoints for all Stonyx applications — the transport layer that ORM and OAuth modules mount their routes onto

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| HTTP Framework | Express 5 |
| CORS | `cors` npm package |
| CI | GitHub Actions (`ci.yml`) |
| Testing | QUnit + Sinon |

## Architecture Patterns

- **Module mount point:** Other Stonyx modules call `RestServer.instance.mountRoute(RequestClass, { name, options })` to register their routes — this is the primary integration contract
- **Handler dispatch pipeline:** Route matching -> auth hook -> middleware stack -> main handler -> response serialization (status code, JSON object, redirect, or pipe) — each stage can short-circuit
- **Global middleware first:** CORS and JSON body parsing are applied to the root Express app before any routes mount — all sub-apps inherit these

## Live Knowledge

- The `mountRoute` public API is consumed by `@stonyx/orm` (for ORM request routes) and `@stonyx/oauth` (for auth routes) — changes to `mountRoute` signature, the `registerCalls()` contract, or the `expressInstance` property pattern break these consumers
- Express 5 uses different path matching rules than Express 4 — parameter patterns, regex routes, and trailing slash handling may behave differently; validate route patterns against Express 5 documentation
- The server only has three source files (`main.ts`, `request.ts`, `types/`) — the small surface area means most changes have outsized impact; even minor refactors to `Request.registerCalls()` affect every downstream route
- The `makeArray` utility from `@stonyx/utils/object` normalizes handler values (single function or array) — validation should confirm that both forms produce identical execution behavior
- Published package includes only `dist/`, `config/`, and `README.md` — verify no source maps or test artifacts are included in the npm package
- The health check endpoint (`GET /health`) returning 200 is the standard liveness probe — disabling it via `REST_HEALTH_CHECK_DISABLE` affects deployment readiness checks in production
