import QUnit from "qunit";
import sinon from "sinon";
import type { AddressInfo } from "net";
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import config from "stonyx/config";
import Request, { type RouteHandlers } from "../../src/request.js";

const { module, test } = QUnit;
const { getState, sendStatusResponse, stateProp } = Request;

// Shared route-matching fixture for the #47 and #50 flag modules.
//
// Deliberately ONE copy: both modules assert on the same predicate in
// src/route-matching.ts, and a second copy of the harness is how the two
// halves drift apart -- the same reasoning that put the predicate itself in
// one function. A fresh instance is constructed per call because the flag is
// read in Request's constructor, so a cached instance would pin whichever
// config value was live when the module loaded.
class RouteMatchingFixtureRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/success': (_request: ExpressRequest, _state: Record<string, unknown>) => {
        return { data: 'ok' };
      }
    }
  };
}

// Boots the fixture's own express instance on port 0, issues one request, and
// always closes the listener. listen(0) so the suite adds no fixed-port bind.
async function statusFor(path: string): Promise<number> {
  const instance = new RouteMatchingFixtureRequest();
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

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#50 — strictRoutes opt-out flag
  //
  // Real HTTP over a real socket on an ephemeral port (listen(0)).
  //
  // This module is NOT redundant with the integration ACs, and that is the
  // whole reason it exists. The shipped default is `true`, so every
  // integration assertion stays green under a fail-open guard
  // (`strictRoutes === true` instead of `!== false`): with the key present and
  // truthy, both spellings agree. AC3 is the only assertion in the repo that
  // can see that mutation. #47 shipped with exactly this gap.
  //
  // Properties are manipulated directly rather than with sinon.stub().value():
  // stub() always creates an OWN property, so it cannot express the
  // own-property-absent state that every existing consumer's shipped config is
  // actually in. That state is the one a `!== false` guard has to survive.
  // ---------------------------------------------------------------------------
  module('strictRoutes config flag (#50)', function(hooks) {
    const { restServer } = config;
    let hadOwnProperty: boolean;
    let originalValue: boolean | undefined;

    hooks.beforeEach(function() {
      hadOwnProperty = Object.prototype.hasOwnProperty.call(restServer, 'strictRoutes');
      originalValue = restServer.strictRoutes;
    });

    hooks.afterEach(function() {
      if (hadOwnProperty) {
        restServer.strictRoutes = originalValue;
      } else {
        delete restServer.strictRoutes;
      }
    });

    test('AC3 — the absent-key default is secure, and the opt-out opts out', async function(assert) {
      // Sanity: the canonical path is reachable regardless of the flag.
      assert.equal(await statusFor('/success'), 200, 'GET /success is 200 with the config untouched');

      // Key PRESENT and undefined.
      restServer.strictRoutes = undefined;
      assert.equal(await statusFor('/success/'), 404, 'defaults to strict when the key is present and undefined');

      // Key ABSENT as an own property -- the state a consumer's config that
      // predates this key is in. #47's AC6 only covered the `undefined` case;
      // this covers the one that actually ships.
      delete restServer.strictRoutes;
      assert.notOk(Object.prototype.hasOwnProperty.call(restServer, 'strictRoutes'), 'precondition: strictRoutes is not an own property');
      assert.equal(await statusFor('/success/'), 404, 'defaults to strict when the key is absent entirely');
      assert.equal(await statusFor('/success'), 200, 'the canonical path still works when the key is absent');

      // Explicit opt-out restores the old, loose matching.
      restServer.strictRoutes = false;
      assert.equal(await statusFor('/success/'), 200, 'strictRoutes=false opts back in to trailing-slash tolerance');
      assert.equal(await statusFor('/success'), 200, 'the canonical path still works when opted out');
    });
  });
});
