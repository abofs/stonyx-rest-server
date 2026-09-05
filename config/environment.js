const {
  REST_CASE_SENSITIVE_ROUTES,
  REST_CORS_ORIGIN,
  REST_CORS_METHODS,
  REST_HEALTH_CHECK_DISABLE,
  REST_PORT,
  REST_REQUEST_PATH,
  REST_TRUST_PROXY
} = process.env;

const config = {
  // Secure by default. Opt out with REST_CASE_SENSITIVE_ROUTES=false, which
  // restores express's default case-INSENSITIVE matching -- and, with it, the
  // fail-open that abofs/stonyx-rest-server#47 closes: any authorization hook
  // that matches on the request path is case-sensitive, so a case-varied URL
  // reaches a handler the canonical URL is denied.
  caseSensitiveRoutes: REST_CASE_SENSITIVE_ROUTES !== 'false',
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
