// Exercises the consumer-copyable samples in test/sample/requests over HTTP
// (abofs/stonyx#121 part C). Each module pins one pattern a consumer reported
// as missing; the sample file named in each module is the reference.
//
// The sample routes are served by the real RestServer application (mounted by
// the stonyx module loader at boot) on a second, ephemeral listener, as in
// readme-examples-test.ts: rest-server-test.ts closes the fixed-port listener.
// The auth-contract fixtures are not samples (they show what NOT to do), so
// they are defined here and served on their own ephemeral port.
import QUnit from 'qunit';
import { once } from 'events';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import RestServer, { Request, type AuthHandler, type RouteHandlers } from '@stonyx/rest-server';
import ApiRequest, { CLIENT_VERSION_HEADER } from '../sample/requests/base/api-request.js';

const { module, test } = QUnit;

const AUTH = { authorization: 'Bearer sample-token' };
const CURRENT = { [CLIENT_VERSION_HEADER]: '3' };

// Mounts a Request subclass the way RestServer does, on an ephemeral port.
async function serve(RequestClass: new () => Request, run: (base: string) => Promise<void>): Promise<void> {
  const instance = new RequestClass();
  instance.registerCalls();

  const server = instance.expressInstance.listen(0) as Server;
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

module('[Integration] Sample patterns (stonyx#121 part C)', function(hooks) {
  let endpoint: string;
  let server: Server;

  hooks.before(async function() {
    server = new RestServer().api.listen(0) as Server;
    await once(server, 'listening');
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(function() {
    server.closeAllConnections();
    server.close();
  });

  // test/sample/requests/base/api-request.ts, inherited by accounts.ts
  module('version gate + inherited auth via an extended Request', function() {
    test('a missing, old or non-numeric client version gets 426 with a JSON:API error body', async function(assert) {
      for (const version of [undefined, '2', 'abc']) {
        const headers: Record<string, string> = { ...AUTH };
        if (version !== undefined) headers[CLIENT_VERSION_HEADER] = version;

        const response = await fetch(`${endpoint}/accounts/1`, { headers });
        const label = `${CLIENT_VERSION_HEADER}: ${version ?? '(absent)'}`;

        assert.equal(response.status, 426, `${label} -> 426`);
        assert.ok(response.headers.get('content-type')?.startsWith('application/vnd.api+json'), `${label}: JSON:API content type`);
        const body = await response.json();
        assert.equal(body.errors?.[0]?.status, '426', `${label}: errors[0].status`);
        assert.equal(body.errors?.[0]?.code, 'client-version', `${label}: errors[0].code`);
      }
    });

    test('the gate runs before auth', async function(assert) {
      const response = await fetch(`${endpoint}/accounts/1`);
      await response.arrayBuffer();

      assert.equal(response.status, 426, 'no version and no token -> 426, not 401');
    });

    test('the inherited sync auth rejects a request that passes the gate', async function(assert) {
      const response = await fetch(`${endpoint}/accounts/1`, { headers: { ...CURRENT } });
      await response.arrayBuffer();

      assert.equal(response.status, 401, 'current version, no token -> 401 from ApiRequest.auth');
    });

    test('a current version with a valid token reaches the handler', async function(assert) {
      const response = await fetch(`${endpoint}/accounts/1`, { headers: { ...CURRENT, ...AUTH } });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: { type: 'accounts', id: '1', attributes: { name: 'Ada' } } });
    });

    // A wrong token of the same length reaches timingSafeEqual; a shorter or
    // longer one must be stopped by the length check, because timingSafeEqual
    // throws on unequal lengths and the request would fail with 500.
    test('a wrong token gets 401 whatever its length', async function(assert) {
      const valid = AUTH.authorization;
      const wrong = {
        'same length': valid.slice(0, -1) + (valid.endsWith('x') ? 'y' : 'x'),
        shorter: valid.slice(0, -1),
        longer: `${valid}x`,
        empty: ''
      };

      for (const [label, authorization] of Object.entries(wrong)) {
        const response = await fetch(`${endpoint}/accounts/1`, { headers: { ...CURRENT, authorization } });
        await response.arrayBuffer();
        assert.equal(response.status, 401, `${label} token -> 401`);
      }
    });

    // The timing property itself is not observable over HTTP in a test, so
    // pin the call: a plain `!==` comparison passes every behavioural test.
    test('the sample compares the token with timingSafeEqual, not !==', function(assert) {
      const source = readFileSync(resolve('test/sample/requests/base/api-request.ts'), 'utf8');

      assert.ok(/\btimingSafeEqual\(given, SAMPLE_TOKEN\)/.test(source), 'tokenMatches calls timingSafeEqual');
      assert.ok(/\bauth: AuthHandler = request => \{\s*if \(!tokenMatches\(request\.get\('authorization'\)\)\) return 401;/.test(source), 'auth decides through tokenMatches');
      assert.notOk(/[!=]==?\s*SAMPLE_TOKEN\b(?!\.length)|authorization'\)\s*[!=]==?/.test(source), 'no direct equality comparison of the header or the token');
    });

    // Inverse of the 401 above: without the inherited auth the same request
    // passes, so the 401 came from the base class and nothing else.
    test('inverse: a subclass that removes auth lets the tokenless request through', async function(assert) {
      class NoAuth extends ApiRequest {
        auth: AuthHandler | undefined = undefined;
        handlers: RouteHandlers = { get: { '/': () => ({ data: 'open' }) } };
      }

      await serve(NoAuth as new () => Request, async base => {
        const response = await fetch(`${base}/`, { headers: { ...CURRENT } });
        assert.equal(response.status, 200, 'no token -> 200 once auth is removed');
        assert.deepEqual(await response.json(), { data: 'open' });

        const gated = await fetch(`${base}/`);
        await gated.arrayBuffer();
        assert.equal(gated.status, 426, 'the constructor gate is still inherited');
      });
    });
  });

  // test/sample/requests/accounts.ts
  module('async handler-array middleware', function() {
    test('state set after an await reaches the final handler', async function(assert) {
      const response = await fetch(`${endpoint}/accounts/1`, { headers: { ...CURRENT, ...AUTH } });
      const body = await response.json();

      // Were the middleware not awaited, the handler would read an undefined
      // state.account and the request would fail with 500.
      assert.equal(response.status, 200);
      assert.equal(body.data.attributes.name, 'Ada', 'handler saw state.account');
    });

    test('the middleware stops the request by returning a status', async function(assert) {
      for (const id of ['2', 'constructor', '__proto__']) {
        const response = await fetch(`${endpoint}/accounts/${id}`, { headers: { ...CURRENT, ...AUTH } });

        assert.equal(response.status, 404, `GET /accounts/${id} -> 404`);
        assert.equal(await response.text(), 'Not Found', `GET /accounts/${id}: the handler did not run`);
      }
    });
  });

  // test/sample/requests/widgets.ts
  module('response headers and custom status', function() {
    test('request.res sets status and headers on one route; constructor middleware sets them on all', async function(assert) {
      const response = await fetch(`${endpoint}/widgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gear' })
      });

      assert.equal(response.status, 201, 'custom status kept alongside a JSON body');
      assert.equal(response.headers.get('location'), '/widgets/7', 'per-route header via request.res');
      assert.equal(response.headers.get('cache-control'), 'no-store', 'class-wide header via expressInstance middleware');
      assert.deepEqual(await response.json(), { data: { type: 'widgets', id: '7', attributes: { name: 'gear' } } });
    });

    test('inverse: the class-wide header does not leak to other request classes', async function(assert) {
      const response = await fetch(`${endpoint}/public/success`);
      await response.arrayBuffer();

      assert.equal(response.status, 200);
      assert.notEqual(response.headers.get('cache-control'), 'no-store');
    });
  });

  // Pins current behaviour so docs can cite it. These fixtures are the
  // anti-patterns; the sample to copy is ApiRequest.auth.
  module('auth() and handler contract (pinned behaviour)', function() {
    test('auth is synchronous: a Promise-returning auth fails with 500, whatever it resolves to', async function(assert) {
      for (const resolved of [undefined, 401]) {
        let handlerRan = false;

        class AsyncAuth extends Request {
          handlers: RouteHandlers = { get: { '/': () => { handlerRan = true; return { data: 'reached' }; } } };
          auth = (async () => resolved) as unknown as AuthHandler;
        }

        await serve(AsyncAuth, async base => {
          const response = await fetch(`${base}/`);
          await response.arrayBuffer();

          assert.equal(response.status, 500, `async auth resolving ${resolved} -> 500`);
          assert.false(handlerRan, `async auth resolving ${resolved}: the handler did not run`);
        });
      }
    });

    test('control: the same fixture with a sync auth returning undefined -> 200', async function(assert) {
      class SyncAuth extends Request {
        handlers: RouteHandlers = { get: { '/': () => ({ data: 'reached' }) } };
        auth: AuthHandler = () => undefined;
      }

      await serve(SyncAuth, async base => {
        const response = await fetch(`${base}/`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: 'reached' });
      });
    });

    test('the final handler is not bound: a method reference loses `this` (500); middleware is bound', async function(assert) {
      class Unbound extends Request {
        testProp = 'stonyx';

        handlers: RouteHandlers = {
          get: {
            '/method': this.readProp,
            '/middleware': [this.readProp, () => ({ data: 'unreachable' })]
          }
        };

        readProp(this: { testProp?: string } | undefined) {
          return { data: this!.testProp };
        }
      }

      await serve(Unbound, async base => {
        const method = await fetch(`${base}/method`);
        await method.arrayBuffer();
        assert.equal(method.status, 500, 'final handler as a method reference -> 500 (this is undefined)');

        const middleware = await fetch(`${base}/middleware`);
        assert.equal(middleware.status, 200, 'the same method as middleware is bound');
        assert.deepEqual(await middleware.json(), { data: 'stonyx' });
      });
    });
  });
});
