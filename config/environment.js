const {
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
