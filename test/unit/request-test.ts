import QUnit from "qunit";
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

// Captures and restores the OWN-property state of one `config.restServer` key.
//
// Deliberately ONE copy, shared by the #47 and #50 flag modules, for the same
// reason `statusFor()` is: both modules assert on the same predicate in
// src/route-matching.ts, and both have to reach the same two states.
//
// sinon cannot express those states. `sinon.stub(obj, key).value(...)` always
// materializes an OWN property, and stubbing a key that is not present at all
// throws `Cannot stub non-existent property`. So the absent-own-property case
// -- the one a `!== false` guard has to survive -- is unreachable through
// sinon, and the restore has to put back the prior own-property state rather
// than a value.
function ownStateTracker(key: 'caseSensitiveRoutes' | 'strictRoutes') {
  const { restServer } = config;
  let hadOwnProperty = false;
  let originalValue: boolean | undefined;

  return {
    capture() {
      hadOwnProperty = Object.prototype.hasOwnProperty.call(restServer, key);
      originalValue = restServer[key];
    },
    restore() {
      if (hadOwnProperty) restServer[key] = originalValue;
      else delete restServer[key];
    }
  };
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
  //
  // Both failure shapes of the `!== false` guard are covered here, matching
  // #50's AC3 below. Covering only the key-present-and-`undefined` shape is not
  // enough, and that was measurable rather than theoretical: with AC6 stubbing
  // only `undefined`, a guard that fails open ONLY when the key is absent as an
  // own property (`hasOwn(restServer,'caseSensitiveRoutes') && ... !== false`)
  // left the suite at 31 pass / 0 fail. The same mutant on the `strictRoutes`
  // line was killed by AC3 at 30/1. This module closes that asymmetry, which
  // the source comment in src/route-matching.ts asserts.
  // ---------------------------------------------------------------------------
  module('caseSensitiveRoutes config flag (#47)', function(hooks) {
    const tracker = ownStateTracker('caseSensitiveRoutes');

    hooks.beforeEach(tracker.capture);
    hooks.afterEach(tracker.restore);

    test('AC6 — the opt-out actually opts out, and defaults to secure', async function(assert) {
      const { restServer } = config;

      // Sanity: the canonical path is reachable regardless of the flag.
      assert.equal(await statusFor('/success'), 200, 'GET /success is 200 with the config untouched');

      // Default must be secure — a mixed-case path must miss. Key PRESENT and
      // `undefined`; this is the shape the previous version of this AC covered.
      restServer.caseSensitiveRoutes = undefined;
      assert.equal(await statusFor('/SUCCESS'), 404, 'defaults to case-sensitive when the key is present and undefined');

      // Key ABSENT as an own property. Strictly stronger than the assertion
      // above: a guard failing open only on this shape survives that one.
      delete restServer.caseSensitiveRoutes;
      assert.notOk(Object.prototype.hasOwnProperty.call(restServer, 'caseSensitiveRoutes'), 'precondition: caseSensitiveRoutes is not an own property');
      assert.equal(await statusFor('/SUCCESS'), 404, 'defaults to case-sensitive when the key is absent entirely');
      assert.equal(await statusFor('/success'), 200, 'the canonical path still works when the key is absent');

      // Explicit opt-out restores the old, loose matching.
      restServer.caseSensitiveRoutes = false;
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
  // own-property-absent state -- see ownStateTracker() above.
  //
  // That state is NOT what a consumer of this repo's own config sees: when
  // config/environment.js is merged, `strictRoutes` IS an own property. It is
  // reachable for a consumer whose merged config never included this module's
  // defaults -- the stonyx loader only merges a module's config/environment.js
  // for modules in devDependencies (see the self-registration note in
  // RestServer.init()), so a consumer carrying @stonyx/rest-server in
  // `dependencies` reads a `config.restServer` these defaults never reached.
  // A hand-written restServer block that predates the key lands in the same
  // state. That is the state a `!== false` guard has to survive.
  // ---------------------------------------------------------------------------
  module('strictRoutes config flag (#50)', function(hooks) {
    const { restServer } = config;
    const tracker = ownStateTracker('strictRoutes');

    hooks.beforeEach(tracker.capture);
    hooks.afterEach(tracker.restore);

    test('AC3 — the absent-key default is secure, and the opt-out opts out', async function(assert) {
      // Sanity: the canonical path is reachable regardless of the flag.
      assert.equal(await statusFor('/success'), 200, 'GET /success is 200 with the config untouched');

      // Key PRESENT and undefined.
      restServer.strictRoutes = undefined;
      assert.equal(await statusFor('/success/'), 404, 'defaults to strict when the key is present and undefined');

      // Key ABSENT as an own property -- the state a consumer whose config
      // never had this module's defaults merged is in. #47's AC6 now covers
      // the same two shapes; it originally covered only `undefined`, and a
      // guard failing open on absent-own-property survived at 31/0 because of
      // it.
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

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#54 - canonicalRoutes opt-out flag
  //
  // SCAFFOLD ONLY. Stubbed with QUnit `todo`, not a passing placeholder: a
  // `todo` that passes is reported as a FAILURE, so this stub cannot survive
  // into the finished fix unnoticed.
  //
  // This module is NOT redundant with the integration AC, for the same measured
  // reason #50's AC3 is not: the shipped default is `true`, so a fail-open
  // guard (`=== true` instead of `!== false`) leaves every integration
  // assertion green. This is the only tier that can see that mutant.
  // ---------------------------------------------------------------------------
  module('canonicalRoutes config flag (#54)', function() {
    test.todo('AC2 - the absent-key default is secure, and the opt-out opts out', function(assert) {
      assert.ok(false, 'AC2 not implemented: both failure shapes of the `!== false` guard against a mounted fixture');
    });
  });
});
