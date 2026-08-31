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
 * setting is the only mechanism.
 */
export default function applyRouteMatching(api: Express): void {
  if (config.restServer?.caseSensitiveRoutes !== false) api.set('case sensitive routing', true);
}
