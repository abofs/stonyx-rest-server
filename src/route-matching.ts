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
 * The cause is concrete: router@2.2.0 `index.js:400-401` hardcodes
 * `strict: false, end: false` for `Router.prototype.use`, so mount segments
 * are structurally strict-immune. That is the OPPOSITE of `sensitive`, which
 * `use()` does forward (line 399) and which is why #47's parent site closed
 * `/PUBLIC/...`. Both sites still get both settings -- they share this
 * function -- but the justification differs and the tests are built on the
 * measured split, not on the analogy.
 *
 * Consequence worth stating so nobody "fixes" it: the mount-segment trailing
 * slash (`/public/`) can never be closed by this setting, and does not need to
 * be. For both `/public` and `/public/` the mounted sub-app receives
 * `req.path === '/'`, so a `req.path` auth hook sees no difference and there is
 * no asymmetry. A test asserting `/public/` -> 404 could never pass. The
 * residual is `req.originalUrl`, which DOES differ; that is disclosed in the
 * README rather than silently closed over.
 *
 * Both guards are `!== false` for the same reason: these flags default to the
 * truthy direction, so a truthy check fails OPEN for a consumer whose shipped
 * config predates the key.
 */
export default function applyRouteMatching(api: Express): void {
  if (config.restServer?.caseSensitiveRoutes !== false) api.set('case sensitive routing', true);
  if (config.restServer?.strictRoutes !== false) api.set('strict routing', true);
}
