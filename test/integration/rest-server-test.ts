import QUnit from "qunit";
import RestServer from "@stonyx/rest-server";
import config from "stonyx/config";
import { setupIntegrationTests } from "stonyx/test-helpers";

const { module, test, todo } = QUnit;
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
  // abofs/stonyx-rest-server#47 — case-sensitive route matching
  //
  // Every AC is executed as a real HTTP request over the server the enclosing
  // module already booted. No new listener, no new fixed-port bind.
  //
  // Inspecting config, or asserting `app.enabled('case sensitive routing')`,
  // satisfies none of these: express 5's `createApplication()` takes zero
  // arguments, so a `caseSensitive: true` constructor option is a silent no-op
  // that would pass every config-shaped check while changing no behaviour.
  // ---------------------------------------------------------------------------
  module('case-sensitive routing (#47)', function() {
    test('AC1 — negative control: correctly-cased routing is untouched', async function(assert) {
      const success = await fetch(`${endpoint}/public/success`);
      assert.equal(success.status, 200, 'GET /public/success still 200');
      assert.equal(await success.text(), 'OK', 'GET /public/success still returns the default OK body');

      const params = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      assert.equal(params.status, 200, 'GET /public/url-params/foo/bar/baz still 200');
      assert.deepEqual(await params.json(), { x: 'foo', y: 'bar', z: 'baz' }, 'params still resolve');

      const health = await fetch(`${endpoint}/health`);
      assert.equal(health.status, 200, 'GET /health still 200');
    });

    test('AC2 — negative control: the auth hook still fires on the canonical path', async function(assert) {
      const failure = await fetch(`${endpoint}/private/failure`);
      assert.equal(failure.status, 505, 'auth hook still rejects GET /private/failure');

      const success = await fetch(`${endpoint}/private/success`);
      assert.equal(success.status, 200, 'GET /private/success still 200');
      assert.deepEqual(await success.json(), { data: 'foo' }, 'the /success handler still runs');
    });

    test('AC3 — mount-segment case is rejected', async function(assert) {
      // Closed by `case sensitive routing` on the parent app (src/main.ts).
      // Measured before the fix: 200 / 505 / 200.
      //
      // The middle value is the one worth reading. A case-varied MOUNT segment
      // still lands in private.ts's sub-app, where `req.path` is the
      // correctly-cased `/failure`, so the auth hook fires and returns 505 even
      // pre-fix. Mount-segment case variation was never the auth bypass; it is
      // a sub-path miss inside an already-mounted app that reaches a handler
      // the hook would have denied. That is why AC5 below has to probe
      // `/private/FAILURE` and not `/PRIVATE/failure`.
      const publicRoute = await fetch(`${endpoint}/PUBLIC/success`);
      assert.equal(publicRoute.status, 404, 'GET /PUBLIC/success does not reach the /public mount');

      const privateRoute = await fetch(`${endpoint}/PRIVATE/failure`);
      assert.equal(privateRoute.status, 404, 'GET /PRIVATE/failure does not reach the /private mount');

      const health = await fetch(`${endpoint}/HEALTH`);
      assert.equal(health.status, 404, 'GET /HEALTH does not reach /health');
    });

    test('AC4 — sub-path case is rejected', async function(assert) {
      // Closed only by `case sensitive routing` on the child app (src/request.ts),
      // set in the constructor before registerCalls() materializes the router.
      // A parent-only fix, or a child set applied after route registration,
      // passes AC3 and returns 200 here. `public.ts` has no bare `/:id`, so a
      // miss is a true 404.
      const success = await fetch(`${endpoint}/public/SUCCESS`);
      assert.equal(success.status, 404, 'GET /public/SUCCESS does not reach the /success handler');

      const bind = await fetch(`${endpoint}/public/BIND`);
      assert.equal(bind.status, 404, 'GET /public/BIND does not reach the /bind handler');
    });

    test('AC5 — a case-varied path cannot reach a handler the auth hook denies', async function(assert) {
      // The security-relevant assertion. Before the fix, GET /private/FAILURE
      // reaches the /failure handler and returns {data:'foo'} with the 505 auth
      // hook never firing. After the fix it misses /failure and is absorbed by
      // private.ts's `/:id` catch-all, so the STATUS is 200 either way — the
      // assertion is on which handler ran, not on the status.
      const response = await fetch(`${endpoint}/private/FAILURE`);
      const body = await response.json();

      assert.notDeepEqual(body, { data: 'foo' }, 'GET /private/FAILURE does not reach the auth-denied /failure handler');
      assert.deepEqual(body, { data: 'param-route' }, 'GET /private/FAILURE falls through to the /:id catch-all');
      assert.equal(response.status, 200, 'status is 200 via /:id — documented, not a regression');
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#50 — strict route matching (trailing slash)
  //
  // SCAFFOLD — stubs only, no implementation yet.
  // Marked `todo` rather than left as passing placeholders so the scaffold
  // cannot report a false green before the assertions exist.
  // ---------------------------------------------------------------------------
  module('strict routing (#50)', function() {
    todo('AC1 — a trailing slash cannot reach a handler the auth hook denies', async function(assert) {
      assert.ok(false, 'TODO: GET /private/failure/ -> 404 and body !== {data:foo}; negative controls');
    });

    todo('AC2 — the parent construction site is independently covered', async function(assert) {
      assert.ok(false, 'TODO: GET /health/ -> 404, GET /health -> 200, GET /public/ -> 200 (documented non-closure)');
    });
  });

  module('/health', function(hooks) {
    test('Health check endpoint is configured automatically', async function(assert) {
      const response = await fetch(`${endpoint}/health`);

      assert.equal(response.status, 200);
    });
  });
});
