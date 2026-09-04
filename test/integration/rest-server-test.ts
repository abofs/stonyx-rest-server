import QUnit from "qunit";
import RestServer from "@stonyx/rest-server";
import config from "stonyx/config";
import { setupIntegrationTests } from "stonyx/test-helpers";

const { module, test } = QUnit;
let endpoint: string;

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

  // ---------------------------------------------------------------------------
  // #47 — routes mount case-INSENSITIVELY (express default), so any consumer
  // authorization that inspects the request path can be walked past by changing
  // case. Acceptance criteria AC1-AC5 (AC6 lives in test/unit/request-test.ts,
  // AC7 in test/unit/publish-surface-test.ts).
  //
  // Every assertion below is a real HTTP request over a real socket against the
  // real router. Asserting `app.enabled('case sensitive routing')` does NOT
  // satisfy any of these: express 5's `createApplication()` takes no arguments,
  // so an `express({ caseSensitive: true })` that changes no behaviour would
  // pass every config-shaped check.
  //
  // Measured: `fetch` does not normalise case, so it is an adequate client here.
  // ---------------------------------------------------------------------------
  module('case-sensitive route matching (#47)', function() {
    // AC1 — negative control. Without this the story is satisfiable by breaking
    // all routing to buy the 404s below.
    test('AC1 — correctly-cased routing is untouched', async function(assert) {
      const success = await fetch(`${endpoint}/public/success`);
      assert.equal(success.status, 200, 'GET /public/success -> 200');
      assert.equal(await success.text(), 'OK', 'GET /public/success body is OK');

      const params = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      assert.equal(params.status, 200, 'GET /public/url-params/foo/bar/baz -> 200');
      assert.deepEqual(await params.json(), { x: 'foo', y: 'bar', z: 'baz' }, 'url params still bind');

      const health = await fetch(`${endpoint}/health`);
      assert.equal(health.status, 200, 'GET /health -> 200');
    });

    // AC2 — negative control. Turns red if the fix reorders registerCalls()
    // relative to the auth wrapper in src/request.ts.
    test('AC2 — the auth hook still fires on the canonical path', async function(assert) {
      const denied = await fetch(`${endpoint}/private/failure`);
      assert.equal(denied.status, 505, 'GET /private/failure -> 505, auth hook fires');

      const allowed = await fetch(`${endpoint}/private/success`);
      assert.equal(allowed.status, 200, 'GET /private/success -> 200');
      assert.deepEqual(await allowed.json(), { data: 'foo' }, 'GET /private/success body');
    });

    // AC3 — the src/main.ts construction site. Measured on origin/dev: all
    // three return 200.
    test('AC3 — mount-segment case is rejected (src/main.ts site)', async function(assert) {
      const publicMount = await fetch(`${endpoint}/PUBLIC/success`);
      assert.equal(publicMount.status, 404, 'GET /PUBLIC/success -> 404');

      const privateMount = await fetch(`${endpoint}/PRIVATE/failure`);
      assert.equal(privateMount.status, 404, 'GET /PRIVATE/failure -> 404');

      const health = await fetch(`${endpoint}/HEALTH`);
      assert.equal(health.status, 404, 'GET /HEALTH -> 404');
    });

    // AC4 — the src/request.ts construction site, and the one a partial fix
    // misses. A parent-only fix, or a set placed after registerCalls(), passes
    // AC3 and returns 200 here. public.ts is used deliberately: it registers no
    // bare '/:id', so a miss is a true 404.
    test('AC4 — sub-path case is rejected (src/request.ts site)', async function(assert) {
      const success = await fetch(`${endpoint}/public/SUCCESS`);
      assert.equal(success.status, 404, 'GET /public/SUCCESS -> 404');

      const bind = await fetch(`${endpoint}/public/BIND`);
      assert.equal(bind.status, 404, 'GET /public/BIND -> 404');
    });

    // AC5 — the security-relevant assertion. The status stays 200 before AND
    // after the fix, because private.ts registers '/:id' which absorbs the
    // miss; asserting 404 here would be wrong. Assert handler identity instead.
    test('AC5 — a case-varied path cannot reach a handler the auth hook denies', async function(assert) {
      const response = await fetch(`${endpoint}/private/FAILURE`);
      const body = await response.json();

      assert.notDeepEqual(
        body,
        { data: 'foo' },
        'GET /private/FAILURE does not reach the 505-denied /failure handler'
      );
      assert.deepEqual(
        body,
        { data: 'param-route' },
        'GET /private/FAILURE is absorbed by /:id, not by /failure'
      );
    });
  });

  module('/health', function(hooks) {
    test('Health check endpoint is configured automatically', async function(assert) {
      const response = await fetch(`${endpoint}/health`);

      assert.equal(response.status, 200);
    });
  });
});
