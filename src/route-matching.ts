import type { Express, Request as ExpressRequest } from 'express';
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
 * Consequence worth stating so nobody expects this SETTING to cover it: no
 * express setting rejects the mount-segment trailing slash (`/public/`). For
 * both `/public` and `/public/` the mounted sub-app receives `req.path === '/'`,
 * so a `req.path` auth hook sees no difference and there is nothing for the
 * setting to reject. That statement is still true, and it is still the reason
 * `applyRouteMatching()` is not the fix site for that edge.
 *
 * The edge itself is CLOSED, by `shouldRejectTarget()` below rather than by a
 * setting (abofs/stonyx-rest-server#54). `req.originalUrl` does differ between
 * the two spellings, and a hook authorizing on it was bypassed by one
 * character -- measured: `GET /admin` -> 401, `GET /admin/` -> 200 with the
 * guarded handler running unauthenticated. `GET /public/` now returns 404, and
 * the integration AC asserts exactly that.
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

/**
 * Decides whether a request must be rejected because its RAW request target is
 * not the canonical path express matched (abofs/stonyx-rest-server#54).
 *
 * Closes two live authorization bypasses against a consumer hook that
 * authorizes on `req.originalUrl` -- the field express does NOT normalize:
 *
 *   1. mount-root trailing slash    GET /admin/                  -> was 200
 *   2. absolute-form request target GET http://host/admin        -> was 200
 *      (RFC 9112 3.2.2; hits EVERY route, not just the mount root)
 *
 * Both were measured reaching the guarded handler unauthenticated while
 * `GET /admin` was denied 401.
 *
 * COMPARE THE RAW TARGET; DO NOT PARSE IT. Any implementation reaching for
 * `new URL(req.originalUrl, base).pathname` to "get the path" re-opens vector 2
 * BY CONSTRUCTION: parsing normalizes the exact string the consumer's hook is
 * exposed to, so the check would compare a laundered value while the hook still
 * sees the raw one. Measured: the narrow `endsWith('/')` form closes 1 and
 * leaves 2 at 200.
 *
 * `req.baseUrl + req.path` is likewise NOT usable as the left-hand side. It is
 * `/admin/` for BOTH spellings of vector 1 -- `originalUrl` is the only field
 * that differs, which is precisely why the bypass exists. A check built on
 * `baseUrl + path` cannot see its own defect.
 *
 * TIMING CONTRACT -- DELIBERATELY DIFFERENT FROM ITS TWO SIBLINGS. This lives
 * beside `applyRouteMatching()` for the same "one place anchors it" reason, but
 * deliberately OUTSIDE it: that function's contract is *apply express settings
 * to an app*, it is called from two constructors, and this is neither a setting
 * nor constructor-timed. `caseSensitiveRoutes`/`strictRoutes` are read once in a
 * constructor and are silently ineffective if applied late; this flag is read
 * PER REQUEST, inside the handler closure. There is no lazy-materialisation
 * hazard here, so do not carry that constraint across.
 *
 * The caller must reject with `next('router')`, NOT `res.sendStatus(404)`, and
 * must run this BEFORE `this.auth` as well as outside `if (this.auth)` -- those
 * are two separate properties with two separate assertions (AC1.11 and AC1.6);
 * see src/request.ts.
 *
 * Guard polarity is `!== false`, matching both siblings, for the same measured
 * reason: the secure value is the TRUTHY one, so a plain truthy check fails
 * OPEN for any consumer whose shipped `restServer` block predates the key --
 * the state every existing consumer is in, and reachable in practice because
 * the stonyx loader only merges a module's `config/environment.js` for modules
 * in devDependencies. `trustProxy` deliberately differs (`=== 'true'`): its safe
 * default is FALSY, so a truthy check already fails closed for it. The rule is
 * "the guard must fail toward the safe value", not "all guards look alike" --
 * preserve the asymmetry.
 *
 * The integration tier cannot see a fail-open guard here: with the shipped
 * default `true`, `=== true` leaves every integration assertion green. Only
 * `test/unit/request-test.ts` AC2 can, and it probes BOTH failure shapes --
 * key present-and-`undefined` and key absent as an own property.
 */
export function shouldRejectTarget(req: ExpressRequest): boolean {
  // Written as `!== false` rather than `=== false` on purpose: the polarity is
  // the load-bearing part and it should read identically to the two guards in
  // applyRouteMatching() above.
  const enforced = config.restServer?.canonicalRoutes !== false;
  if (!enforced) return false;

  // Raw, unparsed. Only the query string is removed, by string split.
  const target = req.originalUrl.split('?')[0];

  // At a mount root express reports `req.path === '/'` while the canonical
  // target is the bare mount segment, so the two are not simply concatenated.
  //
  // `&& req.baseUrl` is load-bearing and is NOT a redundant truthiness guard.
  // A route class named `index` mounts at '/' (src/main.ts `mountRoute()`),
  // and that is the one mount shape where `req.baseUrl` is ''. Without the
  // conjunct, `GET /` compares the raw target '/' against a canonical of '' and
  // the APPLICATION ROOT is rejected. Measured before it had a guard: shipped
  // `GET /` -> 200, conjunct dropped -> 404, suite 34 pass / 0 fail BOTH ways.
  // Killed now by AC1.12, against `test/sample/requests/index.ts`.
  const canonical = req.path === '/' && req.baseUrl ? req.baseUrl : req.baseUrl + req.path;

  return target !== canonical;
}
