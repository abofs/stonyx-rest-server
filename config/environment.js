const {
  REST_CANONICAL_ENCODING,
  REST_CANONICAL_ROUTES,
  REST_CASE_SENSITIVE_ROUTES,
  REST_CORS_ORIGIN,
  REST_CORS_METHODS,
  REST_HEALTH_CHECK_DISABLE,
  REST_PORT,
  REST_REQUEST_PATH,
  REST_STRICT_ROUTES,
  REST_TRUST_PROXY
} = process.env;

const config = {
  // Secure by default: routes match case-sensitively so a consumer's
  // URL-based authorization cannot be walked past by changing case
  // (abofs/stonyx-rest-server#47). Opt out with REST_CASE_SENSITIVE_ROUTES=false
  // only as a temporary remediation for a client that relies on loose casing.
  //
  // DELIBERATELY NOT PINNED in test/config/environment.ts -- do not "fix" this
  // as part of abofs/stonyx-rest-server#43. This line is the only thing the
  // suite still checks about the SHIPPED default. Inverting it to
  // `=== 'true'` turns AC3, AC4 and AC5 red; AC6 stays GREEN, because AC6
  // stubs `caseSensitiveRoutes` to `undefined` and src/route-matching.ts reads
  // `!== false`, so AC6 guards the source's read and not this default.
  // Measured: pin `caseSensitiveRoutes: true` in test/config/environment.ts AND
  // invert this line, and the suite reports 34 pass / 0 fail. A naive pin makes
  // an insecure published default completely invisible to a green suite --
  // quieter and weaker, which is the outcome pinning was supposed to prevent.
  // Inverting this line ALONE, unpinned, reports 31 pass / 3 fail (#47's AC3,
  // AC4 and AC5; AC6 green).
  //
  // The cost of leaving it unpinned is that the suite is ambient-sensitive here
  // (`REST_CASE_SENSITIVE_ROUTES=false pnpm test` => 31 pass / 3 fail), but it
  // fails LOUDLY, so there is no false green.
  //
  // Every count in this block was re-measured against the 34-test suite at
  // #54's head. PASS totals here move whenever a test is ADDED anywhere in the
  // repo -- the FAIL counts are the load-bearing half. Re-measure, do not
  // adjust by arithmetic, when this block next looks stale. Closing #43 for this key needs
  // the subprocess-based env isolation this repo does not yet have; any fix
  // must keep a live assertion on this default.
  caseSensitiveRoutes: REST_CASE_SENSITIVE_ROUTES !== 'false',

  // Secure by default, same polarity and same reasoning as caseSensitiveRoutes
  // above: routes match strictly, so a trailing slash cannot walk past a
  // consumer's URL-based authorization (abofs/stonyx-rest-server#50).
  //
  // BEHAVIOUR CHANGE for consumers upgrading: `/health/` now returns 404, and
  // param routes like `/resource/:id/` no longer match. Opt out with
  // REST_STRICT_ROUTES=false only as a temporary remediation. It is a separate
  // key from REST_CASE_SENSITIVE_ROUTES on purpose -- opting out of slash
  // strictness must not silently re-open #47's case bypass.
  //
  // DELIBERATELY NOT PINNED in test/config/environment.ts -- do not "fix" this
  // as part of abofs/stonyx-rest-server#43. Same trap as the key above, and now
  // measured for both: pin `strictRoutes: true` in test/config/environment.ts
  // AND invert this line to `=== 'true'`, and the suite reports 34 pass /
  // 0 fail. A naive pin makes an insecure published default completely
  // invisible to a green suite.
  //
  // Unpinned, inverting this line alone turns #50's AC1 and AC2 red (32/2).
  // AC3 stays GREEN under that mutation, because AC3 sets `strictRoutes` on the
  // config object directly and so guards src/route-matching.ts's READ rather
  // than this default -- the two assertions cover different halves and neither
  // subsumes the other.
  //
  // The cost is that the suite is ambient-sensitive here
  // (`REST_STRICT_ROUTES=false pnpm test` => 32 pass / 2 fail), but it fails
  // LOUDLY, so there is no false green. All counts in this block re-measured
  // against the 34-test suite at #54's head; the FAIL count is the load-bearing
  // half, since PASS totals move whenever a test is added anywhere. Closing #43 for either key needs
  // subprocess-based env isolation this repo does not have; any fix must keep a
  // live assertion on this default.
  strictRoutes: REST_STRICT_ROUTES !== 'false',

  // Secure by default, same polarity and same reasoning as the two keys above:
  // a request whose RAW target is not the canonical path express matched is
  // rejected with a plain 404 before the consumer's `auth` hook runs
  // (abofs/stonyx-rest-server#54). This is NOT an express setting -- it is a
  // per-request check in src/route-matching.ts (`shouldRejectTarget`), called
  // from the handler closure in src/request.ts.
  //
  // BEHAVIOUR CHANGE for consumers upgrading, on TWO axes:
  //   1. `GET /route/` at a mounted route class's ROOT now returns 404.
  //   2. Clients or forward proxies emitting an ABSOLUTE-FORM request target
  //      (`GET http://host/admin HTTP/1.1`, RFC 9112 3.2.2) now receive 404 on
  //      every route registered through Request.registerCalls(). That is a
  //      REGISTRATION-SITE limit, not a carve-out for one URL: /health is
  //      registered directly on the parent app (src/main.ts) and still answers
  //      200 to an absolute-form target -- and so would any route a consumer
  //      registers on the public RestServer.instance.api itself. This is the
  //      larger blast radius: for such a client it is a total outage, not a
  //      partial one. Reverse proxies in normal use
  //      (nginx, HAProxy, ALB) send origin-form and are unaffected.
  // This module emits no request log, so both look like a dropped route.
  //
  // Opt out with REST_CANONICAL_ROUTES=false only as a temporary remediation --
  // it RE-OPENS the bypass. Separate key from REST_STRICT_ROUTES and
  // REST_CASE_SENSITIVE_ROUTES on purpose: coupling it to strictness would
  // force a consumer who needs mount-root slash tolerance to also re-open #50's
  // sub-path bypass.
  //
  // Note trustProxy below deliberately uses `=== 'true'` instead. That is not
  // an inconsistency to "fix": its safe default is FALSY, so a truthy check
  // already fails closed for it. The rule is "the guard must fail toward the
  // safe value", not "all guards look alike".
  //
  // DELIBERATELY NOT PINNED in test/config/environment.ts -- do not "fix" this
  // as part of abofs/stonyx-rest-server#43. Same trap as the two keys above,
  // and now measured for all three: pin `canonicalRoutes: true` in
  // test/config/environment.ts AND invert this line to `=== 'true'`, and the
  // suite reports 34 pass / 0 fail while an insecure default ships. The pin is
  // quieter AND weaker than no pin, which is the outcome pinning was supposed
  // to prevent.
  //
  // Unpinned, inverting this line alone reports 32 pass / 2 fail: #54's
  // integration AC1 and #50's AC2. AC2 (unit) stays GREEN under that mutation,
  // because it sets `canonicalRoutes` on the config object directly and so
  // guards src/route-matching.ts's READ rather than this default -- the two
  // assertions cover different halves and neither subsumes the other.
  // Conversely, weakening the READ to `=== true` reports 33 pass / 1 fail with
  // AC2 as the only failure and AC1 fully green. All four counts in this block
  // were re-measured on the #54 branch head after the AC1.11/AC1.12 assertions
  // were added; the suite is 34 tests, and the FAIL count is the load-bearing
  // half.
  //
  // The cost is that the suite is ambient-sensitive here
  // (`REST_CANONICAL_ROUTES=false pnpm test` => 32 pass / 2 fail), but it fails
  // LOUDLY, so there is no false green. Closing #43 for any of the three keys
  // needs subprocess-based env isolation this repo does not have; any fix must
  // keep a live assertion on this default.
  canonicalRoutes: REST_CANONICAL_ROUTES !== 'false',

  // Secure by default, same polarity and same reasoning as the three keys
  // above: a request whose RAW target percent-encodes an RFC 3986 2.3
  // UNRESERVED character (ALPHA / DIGIT / "-" / "." / "_" / "~") is rejected
  // with a plain 404 before the consumer's `auth` hook runs
  // (abofs/stonyx-rest-server#56). Like canonicalRoutes this is NOT an express
  // setting -- it is a per-request check in src/route-matching.ts
  // (`shouldRejectEncoding`), called from the handler closure in
  // src/request.ts.
  //
  // What it closes: express decodes `req.params` and NOTHING else, so a
  // consumer hook comparing `req.path` OR `req.originalUrl` was walked past by
  // re-spelling an id -- `GET /enc/secret` -> 401 while
  // `GET /enc/%73ecret` -> 200 with the guarded handler running
  // unauthenticated and `req.params.id === 'secret'`. The spelling family is
  // PROD(1 + v_i) - 1 per id, measured at 63 spellings for `secret` and 71 for
  // `admin`, ALL of them 200 before this key existed. It is EXCLUSIVE to route
  // classes carrying a `:param` segment; literal routes and mount segments
  // match raw and were never reachable this way.
  //
  // BEHAVIOUR CHANGE for consumers upgrading, on a FOURTH axis:
  //   Any client that over-encodes an unreserved character in a path now gets
  //   404. Measured on this repo's own fixture:
  //   `GET /public/url-params/%61/b/c` -> 404 (was 200). Over-encoding an
  //   unreserved character is never required by RFC 3986 -- a normaliser MUST
  //   decode these (6.2.2.2) -- so the blast radius is smaller than #54's,
  //   whose absolute-form vector hits a real deployment shape. It is still a
  //   breaking change and it is documented as one in the README.
  //
  // Opt out with REST_CANONICAL_ENCODING=false only as a temporary remediation
  // -- it RE-OPENS the bypass. SEPARATE key from REST_CANONICAL_ROUTES on
  // purpose, and this one is not a symmetry argument but a measurement: with
  // the rule gated on `canonicalRoutes` instead of its own key,
  // `REST_CANONICAL_ROUTES=false` returns `GET /enc/%73ecret` to 200 -- and
  // that flag is exactly what a consumer behind an absolute-form-emitting
  // forward proxy must set to stay up. Folding the two would hand precisely
  // those consumers the encoding bypass as the price. Killed by
  // test/unit/request-test.ts AC5.
  //
  // DELIBERATELY NOT PINNED in test/config/environment.ts -- do not "fix" this
  // as part of abofs/stonyx-rest-server#43. Both halves RE-MEASURED for this
  // key rather than inferred from the three above, against the 41-test suite
  // at #56's head:
  //   (a) invert this line to `=== 'true'` ALONE, unpinned:
  //       36 pass / 5 fail -- #56's integration AC1 and AC2, unit AC5 and AC6,
  //       and [Unit] Config AC7. It fails LOUDLY, so there is no false green.
  //   (b) pin `canonicalEncoding: true` in test/config/environment.ts AND
  //       invert this line: 40 pass / 1 fail, and the ONE failure is
  //       [Unit] Config AC7 -- every behavioural assertion goes green because
  //       the pin supplies the secure value the suite then observes. Measured
  //       again with test/unit/config-test.ts removed: 40 pass / 0 fail, a
  //       fully green suite shipping an insecure default. That is the trap, and
  //       AC7 is the only thing standing between this key and it.
  //
  // Conversely, weakening the READ in src/route-matching.ts to `=== true`
  // reports 40 pass / 1 fail with unit AC6 as the only failure and every
  // integration assertion green -- the two guard different halves and neither
  // subsumes the other. Closing #43 for any of the four keys needs the
  // subprocess-based env isolation this repo does not have; any fix must keep a
  // live assertion on this default.
  //
  // FOUR security-relevant keys now, all defaulting on, all disable-able, none
  // pinned. Per docs/framework/testing.md the pinned set has to be evaluated as
  // a SET rather than key by key; [Unit] Config AC7 asserts all four together
  // for that reason. Whoever takes #43 inherits four keys and this paragraph as
  // the reason they are unpinned, rather than finding four and assuming
  // neglect.
  canonicalEncoding: REST_CANONICAL_ENCODING !== 'false',

  enableHealthCheck: REST_HEALTH_CHECK_DISABLE !== 'true',
  origin: REST_CORS_ORIGIN ?? '*',
  methods: REST_CORS_METHODS ?? 'GET,POST,PATCH,PUT,DELETE',
  dir: REST_REQUEST_PATH ?? './requests',
  port: REST_PORT ?? 2666,
  trustProxy: REST_TRUST_PROXY === 'true',
  logColor: 'yellow',
  logMethod: 'api'
};

export default config;
