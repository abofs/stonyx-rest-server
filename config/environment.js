const {
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
  // invert this line, and the suite reports 28 pass / 0 fail. A naive pin makes
  // an insecure published default completely invisible to a green suite --
  // quieter and weaker, which is the outcome pinning was supposed to prevent.
  //
  // The cost of leaving it unpinned is that the suite is ambient-sensitive here
  // (`REST_CASE_SENSITIVE_ROUTES=false pnpm test` => 25 pass / 3 fail), but it
  // fails LOUDLY, so there is no false green. Closing #43 for this key needs
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
  // AND invert this line to `=== 'true'`, and the suite reports 31 pass /
  // 0 fail. A naive pin makes an insecure published default completely
  // invisible to a green suite.
  //
  // Unpinned, inverting this line alone turns #50's AC1 and AC2 red (29/2).
  // AC3 stays GREEN under that mutation, because AC3 sets `strictRoutes` on the
  // config object directly and so guards src/route-matching.ts's READ rather
  // than this default -- the two assertions cover different halves and neither
  // subsumes the other.
  //
  // The cost is that the suite is ambient-sensitive here
  // (`REST_STRICT_ROUTES=false pnpm test` => 29 pass / 2 fail), but it fails
  // LOUDLY, so there is no false green. Closing #43 for either key needs
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
  //      EVERY route. This is the larger blast radius: for such a client it is
  //      a total outage, not a partial one. Reverse proxies in normal use
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
  // and now measured for all three: pinning the key in
  // test/config/environment.ts AND inverting this line to `=== 'true'` leaves
  // the suite fully green while an insecure default ships. The pin is quieter
  // AND weaker than no pin, which is the outcome pinning was supposed to
  // prevent.
  //
  // Unpinned, inverting this line alone turns #54's integration AC1 red.
  // AC2 stays GREEN under that mutation, because AC2 sets `canonicalRoutes` on
  // the config object directly and so guards src/route-matching.ts's READ
  // rather than this default -- the two assertions cover different halves and
  // neither subsumes the other.
  //
  // The cost is that the suite is ambient-sensitive here
  // (`REST_CANONICAL_ROUTES=false pnpm test` fails), but it fails LOUDLY, so
  // there is no false green. Closing #43 for any of the three keys needs
  // subprocess-based env isolation this repo does not have; any fix must keep a
  // live assertion on this default.
  canonicalRoutes: REST_CANONICAL_ROUTES !== 'false',

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
