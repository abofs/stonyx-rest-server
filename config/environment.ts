interface RestServerEnvironmentConfig {
  enableHealthCheck: boolean;
  origin: string;
  methods: string;
  dir: string;
  port: string | number;
  trustProxy: boolean;
  logColor: string;
  logMethod: string;
}

const {
  REST_CORS_ORIGIN,
  REST_CORS_METHODS,
  REST_HEALTH_CHECK_DISABLE,
  REST_PORT,
  REST_REQUEST_PATH,
  REST_TRUST_PROXY
} = process.env;

const config: RestServerEnvironmentConfig = {
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
