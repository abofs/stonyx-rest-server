import type { Express } from 'express';
import config from 'stonyx/config';

/**
 * Applies this module's route-matching settings to an express app.
 *
 * Called from BOTH express construction sites (abofs/stonyx-rest-server#47):
 * `RestServer`'s constructor closes the mount segment (`/PUBLIC/...`), and
 * `Request`'s constructor closes sub-paths (`/public/SUCCESS`). Neither alone
 * is sufficient -- settings are inherited on mount, but `mountRoute()` calls
 * `registerCalls()` before `api.use()`, so each child router is already built
 * by the time the parent's setting could reach it.
 *
 * Both callers invoke this from a constructor, and must keep doing so: express
 * materializes a router lazily on first route registration, and a setting
 * applied afterwards is silently ineffective -- no throw, no warning.
 *
 * The guard is `!== false`, not a plain truthy check, and that polarity is
 * load-bearing. `trustProxy` and `enableHealthCheck` default to the falsy
 * direction, so a missing key fails safe for them. This flag defaults to the
 * truthy direction, so `if (config.restServer?.caseSensitiveRoutes)` would
 * silently fail OPEN for a consumer whose shipped config predates the key.
 *
 * It lives here, in one place, rather than being written out at each call
 * site, so that a single test can anchor it. The invariant is duplicated the
 * moment the expression is: `test/unit/request-test.ts` AC6 reaches this
 * function through `Request`, which means the same assertion now also covers
 * the `RestServer` half. Two copies of the predicate left the parent's copy
 * free to drift -- inverting it, or dropping the condition entirely, kept the
 * suite green.
 *
 * Note `express({ caseSensitive: true })` does NOT work: express 5's
 * `createApplication()` takes zero arguments and forwards nothing. The app
 * setting is the only mechanism. The same is true of `strict`.
 *
 * ---
 *
 * `strict routing` (abofs/stonyx-rest-server#50) closes the same class of
 * authorization bypass for a TRAILING SLASH: `GET /private/failure` was denied
 * by a consumer's auth hook while `GET /private/failure/` reached the guarded
 * handler, because the hook compares `req.path` against `/failure`.
 *
 * It is a SEPARATE key from `caseSensitiveRoutes`, not a rename and not a
 * reuse. Coupling them would force any consumer who legitimately needs
 * trailing-slash tolerance -- a load balancer probing `/health/`, a
 * slash-normalizing proxy -- to re-open #47's case bypass to get it. Case
 * insensitivity is almost never intentional; slash tolerance frequently is.
 *
 * The two settings do NOT share the #47 split above, and this is the one thing
 * not to carry across from that fix. For `strict routing`:
 *
 *   - The CHILD site (Request's constructor) closes the entire security
 *     defect on its own. The parent site does nothing for it.
 *   - The PARENT site (RestServer's constructor) closes exactly one thing in
 *     this repo: `/health/`, the only route registered directly on the parent
 *     app. It has no security role here; do not describe it as having one.
 *
 * The cause is concrete: `Router.prototype.use` hardcodes `strict: false` (and
 * `end: false`), so mount segments are structurally strict-immune. That is the
 * OPPOSITE of `sensitive`, which `use()` DOES forward, and which is why #47's
 * parent site closed `/PUBLIC/...`. The version-pinned file-and-line citation
 * for that upstream behaviour is deliberately kept in ONE place --
 * `docs/project-structure.md`, section "Strict routing (#50)" -- so a router
 * upgrade invalidates one line rather than five. Both sites still get both
 * settings (they share this function), but the justification differs and the
 * tests are built on the measured split, not on the analogy.
 *
 * Consequence worth stating so nobody expects this setting to cover it: the
 * mount-segment trailing slash (`/public/`) cannot be closed by an express
 * SETTING. For both `/public` and `/public/` the mounted sub-app receives
 * `req.path === '/'`, so a `req.path` auth hook sees no difference, and a test
 * asserting `/public/` -> 404 could never pass.
 *
 * That is NOT the same as saying the edge is harmless or unclosable.
 * `req.originalUrl` does differ, and a hook authorizing on it is bypassed by
 * one character -- measured: `GET /admin` -> 401, `GET /admin/` -> 200 with the
 * guarded handler running unauthenticated. That is a live bypass of the same
 * class as #47 and #50, and it IS closable by this module: a canonical-path
 * check ahead of the `auth` call in `Request.registerCalls()`, or opt-in
 * normalizing middleware. It is tracked as abofs/stonyx-rest-server#54. Do not
 * close it here, and do not read this note as saying it cannot be closed.
 *
 * Both guards are `!== false` for the same reason: these flags default to the
 * truthy direction, so a truthy check fails OPEN for a consumer whose shipped
 * config predates the key. Both are also asserted at the unit tier for BOTH
 * failure shapes -- key present-and-`undefined` and key absent as an own
 * property -- in `test/unit/request-test.ts` (#47's AC6, #50's AC3). The
 * integration tier cannot see either: with the shipped default `true`, a
 * fail-open guard leaves every integration assertion green.
 */
export default function applyRouteMatching(api: Express): void {
  if (config.restServer?.caseSensitiveRoutes !== false) api.set('case sensitive routing', true);
  if (config.restServer?.strictRoutes !== false) api.set('strict routing', true);
}
