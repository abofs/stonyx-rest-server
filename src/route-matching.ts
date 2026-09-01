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
 * All four guards in this file are `!== false` for the same reason: these flags
 * default to the
 * truthy direction, so a truthy check fails OPEN for a consumer whose shipped
 * config predates the key. All are also asserted at the unit tier for BOTH
 * failure shapes -- key present-and-`undefined` and key absent as an own
 * property -- in `test/unit/request-test.ts` (#47's AC6, #50's AC3, #54's AC2,
 * #56's AC6). The integration tier cannot see any of them: with the shipped
 * default `true`, a fail-open guard leaves every integration assertion green.
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
 * Guard polarity is `!== false`, matching its three siblings, for the same measured
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

// RFC 3986 §2.3 UNRESERVED = ALPHA / DIGIT / "-" / "." / "_" / "~".
//
// These are the characters a URI generator MUST NOT percent-encode and that a
// normaliser MUST decode (§6.2.2.2), so an encoded one carries no information
// a client is ever required to send. Everything else -- every RESERVED
// character and every non-ASCII octet -- stays encodable, which is the whole
// reason this is an allowlist of octets rather than a ban on triplets. See
// `shouldRejectEncoding()` below.
const UNRESERVED_OCTET = /^[A-Za-z0-9\-._~]$/;

// A percent-triplet: `%` followed by exactly two hex digits, either case.
//
// A `%` can never be part of ANOTHER triplet's hex digits, because `%` is not a
// hex digit -- so scanning left to right without skipping cannot produce an
// overlapping false match. `%2561` therefore yields exactly one candidate
// (`%25`), which is the property AC4 pins.
//
// Malformed and over-long escapes (`%zz`, `%`, `%6`, `%c1%a1`, `%e0%81%a1`) are
// deliberately NOT this function's business: `router@2.2.0`'s `decodeParam`
// (lib/layer.js:225) answers 400 for them before any handler or hook runs.
// Verified here rather than imported -- measured 400 both before and after this
// change. None of those octets is unreserved, and the first three are not valid
// triplets at all, so the rule does not touch them either way.
const PERCENT_TRIPLET = /%([0-9A-Fa-f]{2})/g;

/**
 * Decides whether a request must be rejected because its RAW request target
 * spells an unreserved character as a percent-triplet
 * (abofs/stonyx-rest-server#56).
 *
 * Closes a live authorization bypass on any route class carrying a `:param`
 * segment. Express decodes `req.params` and NOTHING else -- `req.path` and
 * `req.originalUrl` both stay percent-encoded -- so a consumer hook comparing
 * either of those raw fields was walked past by re-spelling the id:
 *
 *   GET /enc/secret     -> 401  (hook fires)
 *   GET /enc/%73ecret   -> 200  guarded handler, unauthenticated, id "secret"
 *
 * Both hook shapes are affected and neither is safer than the other; there is
 * no spelling that defeats one and not the same-id comparison in the other.
 * A third shape is worse still: a LITERAL guarded route co-registered with a
 * sibling `/:id` (this repo's own `test/sample/requests/private.ts`) has the
 * encoded spelling miss the literal layer and be ABSORBED by the param route,
 * so the guard is walked past without the guarded handler ever running --
 * measured `GET /private/failure` -> 505 vs `GET /private/%66ailure` -> 200.
 *
 * THE RULE IS AN UNRESERVED-OCTET SCAN, NOT A DECODE-AND-COMPARE. Two wrong
 * implementations were built and measured, and each breaks a legitimate
 * request:
 *
 *   1. `decodeURIComponent(target) !== target` -- rejects `/enc/sec%2fret`
 *      (404), which names the DISTINCT id `sec/ret`. The router SPLITS then
 *      DECODES; a whole-target decode decodes then splits, and the two
 *      disagree about `%2f` by construction. Killed by AC3.
 *   2. decode until stable -- rejects `/enc/%2573ecret` (404), which names the
 *      legitimate id `%73ecret`. Express decodes EXACTLY ONCE, so `%2561` is
 *      not a bypass and a loop invents a false deny. Killed by AC4.
 *
 * WHY THIS IS NOT PART OF `shouldRejectTarget()` (#54), and why extending that
 * comparison cannot work: for `GET /enc/%73ecret`, `originalUrl` is
 * `/enc/%73ecret`, `baseUrl` is `/enc` and `path` is `/%73ecret`, so
 * `target === canonical` -- both sides carry the SAME encoded string. The
 * comparison is structurally blind to this axis and no change to it can see it.
 *
 * WHY IT IS A FOURTH KEY AND NOT A REUSE OF `canonicalRoutes`. Measured with
 * the rule implemented correctly but gated on #54's key:
 * `REST_CANONICAL_ROUTES=false` returns `GET /enc/%73ecret` to 200. That flag
 * is exactly what a consumer behind an absolute-form-emitting forward proxy
 * must set, so folding the two would hand precisely those consumers the
 * encoding bypass as the price of staying up. Same argument the block above
 * makes for why #50 is not a rename of #47. Pinned by
 * `test/unit/request-test.ts` AC5, which also asserts -- in that same state --
 * that #54's own vector IS re-opened, so an implementation that simply ignores
 * `canonicalRoutes` cannot pass it vacuously.
 *
 * TIMING CONTRACT: identical to `shouldRejectTarget()` and NOT to the two
 * settings above. Read per request, inside the handler closure in
 * `Request.registerCalls()`; there is no lazy-materialisation hazard, so do not
 * move it into `applyRouteMatching()`. The caller must reject with
 * `next('router')`, and must run this BEFORE `this.auth` as well as outside
 * `if (this.auth)` -- see src/request.ts.
 *
 * Guard polarity is `!== false`, matching all three siblings, for the same
 * measured reason: the secure value is the TRUTHY one, so `=== true` fails OPEN
 * for any consumer whose shipped `restServer` block predates the key. The
 * integration tier CANNOT see that mutation -- with the shipped default `true`
 * every integration assertion stays green -- so it is `test/unit/request-test.ts`
 * AC6 that kills it, probing the key present-and-`undefined` and absent as an
 * own property separately.
 *
 * WHAT THIS DOES NOT CLOSE, stated here rather than left implied. It cannot
 * give each decoded id exactly one accepted spelling, because everything the
 * allowlist above does NOT cover must remain encodable: `/enc/a+b` and
 * `/enc/a%2Bb` both name the id `a+b`, and `/enc/sec%2fret` and
 * `/enc/sec%2Fret` both name `sec/ret`.
 *
 * THE RESIDUAL IS WIDER THAN "RESERVED CHARACTERS" AND MUST NOT BE WRITTEN
 * DOWN THAT WAY. Any octet outside `[A-Za-z0-9-._~]` whose hex carries a letter
 * digit aliases by hex-digit case, which is every reserved character AND every
 * non-ASCII byte AND every control octet. Measured through a real listener
 * against this predicate, on a deny list holding NO reserved character at all:
 *
 *   GET /i18n/caf%C3%A9          -> 401     GET /i18n/caf%c3%a9          -> 200, id "café"
 *   GET /i18n/%E5%8C%97%E4%BA%AC -> 401     GET /i18n/%e5%8c%97%e4%ba%ac -> 200, id "北京"
 *   GET /i18n/a%0Db              -> 401     GET /i18n/a%0db              -> 200, id "a\rb"
 *
 * A consumer whose ids are i18n text reads "any id containing a reserved
 * character" as not applying to them. It does. The three docs that carried the
 * narrow wording (`README.md`, `docs/project-structure.md`,
 * `docs/agents/security-reviewer.md`) were widened to this scope rather than
 * this comment being narrowed to theirs.
 *
 * So a hook comparing a raw path string REMAINS UNSOUND for any id carrying an
 * octet outside `[A-Za-z0-9-._~]`, and `req.params` -- which express decodes,
 * and which is populated before `auth()` runs -- is the sound idiom. That
 * residual is the consumer's comparison to own; the module cannot close it
 * without 404ing encodings clients are required to emit.
 *
 * SCOPE LIMIT, separate from the residual above: this predicate is called from
 * `Request.registerCalls()`, so it covers the routes mounted from request
 * classes and nothing else. A route registered directly on the public
 * `RestServer.instance.api` gets none of it -- measured,
 * `GET /direct/%73ecret` -> 200 with `id "secret"` while `GET /enc/%73ecret`
 * -> 404. Same registration-site limit `canonicalRoutes` (#54) has.
 */
export function shouldRejectEncoding(req: ExpressRequest): boolean {
  // `!== false`, not `=== false` and not a truthy check: the polarity is the
  // load-bearing part and it should read identically to the three guards above.
  const enforced = config.restServer?.canonicalEncoding !== false;
  if (!enforced) return false;

  // Raw, unparsed, and only the query string removed -- by string split, for
  // the same reason #54 gives: parsing would launder the exact string the
  // consumer's hook is exposed to. The query is stripped because a query string
  // is a legitimately variable part of a request target and may carry any
  // encoding at all; `?name=%61` is a normal request and must not 404.
  const target = req.originalUrl.split('?')[0];

  for (const [, hex] of target.matchAll(PERCENT_TRIPLET)) {
    if (UNRESERVED_OCTET.test(String.fromCharCode(parseInt(hex!, 16)))) return true;
  }

  return false;
}
