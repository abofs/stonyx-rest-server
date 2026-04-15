// Test-specific config overrides for Rest Server
// These target the post-standalone-transform shape: { restServer: { ... } }

interface TestConfig {
  restServer: {
    dir: string;
  };
}

const config: TestConfig = {
  restServer: {
    dir: './test/sample/requests'
  }
};

export default config;
