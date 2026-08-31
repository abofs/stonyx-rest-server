import QUnit from "qunit";
import sinon from "sinon";
import type { AddressInfo } from "net";
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import config from "stonyx/config";
import Request, { type RouteHandlers } from "../../src/request.js";

const { module, test } = QUnit;
const { getState, sendStatusResponse, stateProp } = Request;

module('[Unit] Request', function() {
  module('getState', function() {
    test('creates a new state object in request object if one does not exist', async function(assert) {
      const request = {} as ExpressRequest;
      const state = getState(request);

      assert.ok(state);
      assert.ok((request as unknown as Record<string, unknown>)[stateProp]);
    });

    test('returns the existing state object if one exists', async function(assert) {
      const request = { [stateProp]: { foo: 'bar' } } as unknown as ExpressRequest;
      const state = getState(request);

      assert.deepEqual(state, { foo: 'bar' });
      assert.deepEqual((request as unknown as Record<string, unknown>)[stateProp], { foo: 'bar' });
    });
  });

  module('sendStatusResponse', function() {
    test('sends a response with a message if status code has an entry in the statusMap', async function(assert) {
      const { restServer } = config;
      let status: number | undefined;
      let message: string | undefined;

      restServer.statusMap = { 732: 'foo' };
      sendStatusResponse({
        status: (code: number) => {
          status = code;
          return { send: (msg: string) => {
            message = msg;
          }};
        }
      } as unknown as ExpressResponse, 732);

      assert.equal(status, 732);
      assert.equal(message, 'foo');

      delete restServer.statusMap;
    });

    test('sends a response code with no message if status code does not have an entry in the statusMap', async function(assert) {
      let status: number | undefined;

      sendStatusResponse({ sendStatus: (code: number) => { status = code; } } as unknown as ExpressResponse, 919);
      assert.equal(status, 919);
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#47 — caseSensitiveRoutes opt-out flag
  //
  // Real HTTP over a real socket on an ephemeral port (listen(0)), so this adds
  // no fixed-port binding to the suite. Asserting that the config key exists,
  // or that `app.enabled('case sensitive routing')` is true, would not
  // distinguish a working fix from express's silent no-op constructor option.
  // ---------------------------------------------------------------------------
  module('caseSensitiveRoutes config flag (#47)', function(hooks) {
    hooks.afterEach(function() {
      sinon.restore();
    });

    class CaseFixtureRequest extends Request {
      handlers: RouteHandlers = {
        get: {
          '/success': (_request: ExpressRequest, _state: Record<string, unknown>) => {
            return { data: 'ok' };
          }
        }
      };
    }

    // Boots the fixture's own express instance on port 0, issues one request,
    // and always closes the listener.
    async function statusFor(path: string): Promise<number> {
      const instance = new CaseFixtureRequest();
      instance.registerCalls();

      const server = instance.expressInstance.listen(0);
      await new Promise<void>(resolve => server.once('listening', () => resolve()));
      const { port } = server.address() as AddressInfo;

      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        return response.status;
      } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }

    test('AC6 — the opt-out actually opts out, and defaults to secure', async function(assert) {
      // Sanity: the canonical path is reachable regardless of the flag.
      assert.equal(await statusFor('/success'), 200, 'GET /success is 200 with the config untouched');

      // Default must be secure — a mixed-case path must miss. Note the stub
      // leaves the key PRESENT and `undefined`; it does not remove it. That is
      // equivalent under the source's `!== false` guard, but say what is
      // actually being asserted: this covers the `undefined` case, not the
      // own-property-absent case.
      sinon.stub(config.restServer, 'caseSensitiveRoutes').value(undefined);
      assert.equal(await statusFor('/SUCCESS'), 404, 'defaults to case-sensitive when the key is unset');

      // Explicit opt-out restores the old, loose matching.
      sinon.stub(config.restServer, 'caseSensitiveRoutes').value(false);
      assert.equal(await statusFor('/SUCCESS'), 200, 'caseSensitiveRoutes=false opts back in to case-insensitive matching');
      assert.equal(await statusFor('/success'), 200, 'the canonical path still works when opted out');
    });
  });
});
