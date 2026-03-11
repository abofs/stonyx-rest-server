import QUnit from "qunit";
import RestServer from "@stonyx/rest-server";
import config from "stonyx/config";
import { setupIntegrationTests } from "stonyx/test-helpers";

const { module, test } = QUnit;
let endpoint;

// Driven by sample requests defined in test/sample-requests
module('[Integration] Rest Server', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    endpoint = `http://localhost:${config.restServer.port}`;
  });

  hooks.after(function() {
    RestServer.close();
  });

  test('Returns 404 when route does not exist', async function(assert) {
    const response = await fetch(`${endpoint}/non-existent-route`);

    assert.equal(response.status, 404);
  });

  module('/public', function(hooks) {
    test('Returns JSON data from a public request with an object response', async function(assert) {
      const response = await fetch(`${endpoint}/public`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'foo');
    });

    test('Returns 200 with default OK body when no response is returned', async function(assert) {
      const response = await fetch(`${endpoint}/public/success`);
      const data = await response.text();

      assert.equal(response.status, 200);
      assert.equal(data, 'OK');
    });

    test('Correctly handles url params', async function(assert) {
      const response = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { x: 'foo', y: 'bar', z: 'baz' });
    });

    test('Correctly handles different params on same call', async function(assert) {
      const response = await fetch(`${endpoint}/public/url-params/1/2/3`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { x: '1', y: '2', z: '3' });
    });

    test('Correctly executes successful validation middleware', async function(assert) {
      const response = await fetch(`${endpoint}/public/foo`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: { newProp: 'bar' } });
    });

    test('Middleware routes work on repeated calls', async function(assert) {
      const response1 = await fetch(`${endpoint}/public/foo`);
      const data1 = await response1.json();

      assert.equal(response1.status, 200, 'First call succeeds');
      assert.deepEqual(data1, { data: { newProp: 'bar' } });

      const response2 = await fetch(`${endpoint}/public/foo`);
      const data2 = await response2.json();

      assert.equal(response2.status, 200, 'Second call succeeds');
      assert.deepEqual(data2, { data: { newProp: 'bar' } });
    });

    test('Correctly executes failed validation middleware', async function(assert) {
      const response = await fetch(`${endpoint}/public/fail`);

      assert.equal(response.status, 504);
    });

    test('Correctly binds call handlers to request class', async function(assert) {
      const response = await fetch(`${endpoint}/public/bind`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: 'stonyx' });
    });

    test('Correctly binds middleware methods to request class', async function(assert) {
      const response = await fetch(`${endpoint}/public/bind-middleware`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: { testProp: 'stonyx' } });
    });
  });

  module('/private', function(hooks) {
    test('Returns JSON data from a private request with an object response', async function(assert) {
      const response = await fetch(`${endpoint}/private/success`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'foo');
    });

    test('Returns error status code from failed auth hook', async function(assert) {
      const response = await fetch(`${endpoint}/private/failure`);

      assert.equal(response.status, 505);
    });

    test('Auth hook has access to request.params from matched route', async function(assert) {
      const response = await fetch(`${endpoint}/private/restricted`);

      assert.equal(response.status, 403, 'Auth can read request.params.id');
    });

    test('Auth hook allows non-restricted param values', async function(assert) {
      const response = await fetch(`${endpoint}/private/allowed`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'param-route');
    });
  });

  module('/health', function(hooks) {
    test('Health check endpoint is configured automatically', async function(assert) {
      const response = await fetch(`${endpoint}/health`);

      assert.equal(response.status, 200);
    });
  });
});
