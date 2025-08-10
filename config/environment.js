const {
  REST_CORS_ORIGIN,
  REST_PORT,
  REST_REQUEST_PATH
} = process;

export default {
  origin: REST_CORS_ORIGIN ?? '*',
  dir: REST_REQUEST_PATH ?? './requests',
  port: REST_PORT ?? 2666,
  logColor: 'yellow'
};
