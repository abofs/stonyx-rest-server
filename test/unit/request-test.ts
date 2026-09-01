import QUnit from "qunit";
import type { AddressInfo } from "net";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import config from "stonyx/config";
import Request, { type RouteHandlers } from "../../src/request.js";
import applyRouteMatching from "../../src/route-matching.js";

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
      // The mount-ROOT handler, needed by #54's AC2 and by nothing else. At a
      // mount root express reports req.path === '/' for both `/fixture` and
      // `/fixture/`, so this is the only registration under which the
      // canonical-target check has anything to decide. Adding it does not
      // disturb the #47/#50 probes: `/SUCCESS` and `/success/` match neither
      // `/success` nor `/`.
      '/': (_request: ExpressRequest, _state: Record<string, unknown>) => {
        return { data: 'root' };
      },

      '/success': (_request: ExpressRequest, _state: Record<string, unknown>) => {
        return { data: 'ok' };
      }
    }
  };
}

// SECOND fixture, for abofs/stonyx-rest-server#56 only, and the one place this
// file deliberately does NOT share a harness.
//
// It carries a `/:id` route, and that route is exactly why it cannot be folded
// into RouteMatchingFixtureRequest above. The percent-encoding bypass is
// exclusive to route classes with a `:param` segment -- express matches a
// LITERAL route against the raw, still-encoded path, so `/fixture/%73uccess`
// misses `/success` and 404s with or without the fix, and a literal-only
// fixture cannot express the defect at all. But adding `/:id` to the shared
// fixture ABSORBS the #47 and #50 probes: `/SUCCESS` and `/success/` would
// match `/:id` at 200 where those ACs assert 404. Measured, by adding `/:id`
// to RouteMatchingFixtureRequest: #47's AC6 and #50's AC3 both turn red.
//
// So the two fixtures are separate for a measured, stated reason rather than by
// drift, and the thing they must not do -- keep two copies of the same probe --
// they do not: this class is probed only by the #56 module below.
class EncodingFixtureRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      // The mount ROOT, needed so AC5 can assert -- in the same config state --
      // that #54's own vector is genuinely re-opened. Without it, an
      // implementation that ignores `canonicalRoutes` entirely passes AC5
      // vacuously.
      '/': (_request: ExpressRequest, _state: Record<string, unknown>) => {
        return { data: 'root' };
      },

      '/:id': (_request: ExpressRequest, _state: Record<string, unknown>) => {
        return { data: 'param' };
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

// Same as statusFor(), but MOUNTED -- the fixture's express instance is
// attached to a parent app at `/fixture`, exactly as RestServer.mountRoute()
// does it (registerCalls() first, then api.use(route, expressInstance), with
// applyRouteMatching() applied to the parent in its constructor).
//
// #54's AC2 needs this and statusFor() cannot substitute. Unmounted, req.baseUrl
// is '' and there is no mount root: `GET /success/` is rejected by strict
// routing before the canonical-target check ever sees it, so the flag has no
// observable effect. Mounted, `GET /fixture/` reaches the '/' handler with
// req.path === '/' and req.originalUrl === '/fixture/' -- the exact asymmetry
// the flag governs.
//
// `fetch` is adequate here and raw sockets are not required: a single trailing
// slash survives fetch's normalisation unchanged (what fetch cannot express is
// dot-segments and absolute-form targets, which is why the INTEGRATION probes
// use a socket). Verified by this AC's own opted-out assertion: with
// canonicalRoutes=false the same fetch call returns 200, so the slash is
// demonstrably reaching the server.
async function mountedStatusFor(path: string, Fixture: new () => Request = RouteMatchingFixtureRequest): Promise<number> {
  const instance = new Fixture();
  instance.registerCalls();

  const parent = express();
  applyRouteMatching(parent);
  parent.use('/fixture', instance.expressInstance);

  const server = parent.listen(0);
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
function ownStateTracker(key: 'caseSensitiveRoutes' | 'strictRoutes' | 'canonicalRoutes' | 'canonicalEncoding') {
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
  // Real HTTP over a real socket on an ephemeral port (listen(0)), against a
  // MOUNTED fixture -- see mountedStatusFor() above for why the unmounted
  // helper cannot express this.
  //
  // This module is NOT redundant with the integration AC, for the same measured
  // reason #50's AC3 is not: the shipped default is `true`, so a fail-open
  // guard (`=== true` instead of `!== false`) leaves every integration
  // assertion green. This is the only tier that can see that mutant.
  //
  // Both failure shapes are mandatory and neither subsumes the other. Measured
  // previously for the two sibling keys: a guard failing open ONLY on
  // absent-own-property survived a present-and-`undefined`-only assertion at
  // 31 pass / 0 fail. sinon cannot reach the absent shape at all -- see
  // ownStateTracker().
  //
  // The two halves of #54's coverage are also disjoint. This AC guards the
  // READ in src/route-matching.ts (it sets `canonicalRoutes` on the config
  // object directly, so the shipped default is out of the picture). The
  // integration AC guards the shipped DEFAULT in config/environment.js, which
  // is deliberately not pinned in test/config/environment.ts (#43). Inverting
  // that default to `=== 'true'` turns AC1 red and leaves this AC green.
  // ---------------------------------------------------------------------------
  module('canonicalRoutes config flag (#54)', function(hooks) {
    const { restServer } = config;
    const tracker = ownStateTracker('canonicalRoutes');

    hooks.beforeEach(tracker.capture);
    hooks.afterEach(tracker.restore);

    test('AC2 - the absent-key default is secure, and the opt-out opts out', async function(assert) {
      // 1. Sanity: the canonical target is reachable with the config untouched.
      assert.equal(await mountedStatusFor('/fixture'), 200, '1. GET /fixture is 200 with the config untouched');

      // 2. Key PRESENT and `undefined`.
      restServer.canonicalRoutes = undefined;
      assert.equal(await mountedStatusFor('/fixture/'), 404, '2. defaults to rejecting the mount-root slash when the key is present and undefined');

      // 3/4. Key ABSENT as an own property -- the state a consumer whose
      // shipped restServer block predates the key is in, and reachable in
      // practice because the stonyx loader only merges a module's
      // config/environment.js for modules in devDependencies. Strictly stronger
      // than 2: a guard failing open only on this shape survives 2.
      delete restServer.canonicalRoutes;
      assert.notOk(Object.prototype.hasOwnProperty.call(restServer, 'canonicalRoutes'), '3. precondition: canonicalRoutes is not an own property');
      assert.equal(await mountedStatusFor('/fixture/'), 404, '4. defaults to rejecting the mount-root slash when the key is absent entirely');

      // 5. and the canonical target still works in that state.
      assert.equal(await mountedStatusFor('/fixture'), 200, '5. the canonical target still works when the key is absent');

      // 6/7. Explicit opt-out genuinely re-opens the bypass. This assertion is
      // also what proves assertions 2 and 4 are not vacuous: the same fetch
      // call returns 200 here, so `/fixture/` is demonstrably reaching the
      // server rather than being swallowed by the client.
      restServer.canonicalRoutes = false;
      assert.equal(await mountedStatusFor('/fixture/'), 200, '6. canonicalRoutes=false re-opens the mount-root slash');
      assert.equal(await mountedStatusFor('/fixture'), 200, '7. the canonical target still works when opted out');
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#56 - canonicalEncoding opt-out flag
  //
  // Real HTTP over a real socket on an ephemeral port (listen(0)), against the
  // MOUNTED EncodingFixtureRequest -- see that class for why the shared fixture
  // cannot carry the `/:id` route these probes need.
  //
  // INSTRUMENT: `fetch`, deliberately and sufficiently. Measured, and this is
  // the cell that splits the rule six briefs inherited: `fetch` transmits
  // percent-triplets VERBATIM (`fetch('/enc/%73ecret')` reproduced the bypass
  // at 200 against unfixed code, exactly as a raw socket did). What `fetch`
  // normalises is DOT-SEGMENTS and REQUEST-TARGET FORM -- `fetch('/enc/./%73ecret')`
  // arrives as `/enc/%73ecret` while a raw socket delivers the dot-segment, and
  // an absolute-form target cannot be emitted through it at all. Neither
  // appears in this module, so adding a raw-socket harness here would be
  // ritual, not rigour.
  //
  // This module is NOT redundant with the integration ACs, for the same
  // measured reason #54's AC2 is not: the shipped default is `true`, so a
  // fail-open guard (`=== true` instead of `!== false`) leaves every
  // integration assertion green. This is the only tier that can see that
  // mutant, and AC6 below probes BOTH failure shapes because a guard failing
  // open only on absent-own-property survives a present-and-`undefined`
  // assertion -- measured for the sibling keys at 31 pass / 0 fail.
  // ---------------------------------------------------------------------------
  module('canonicalEncoding config flag (#56)', function(hooks) {
    const { restServer } = config;
    const encodingTracker = ownStateTracker('canonicalEncoding');
    const canonicalTracker = ownStateTracker('canonicalRoutes');

    hooks.beforeEach(function() {
      encodingTracker.capture();
      canonicalTracker.capture();
    });

    hooks.afterEach(function() {
      encodingTracker.restore();
      canonicalTracker.restore();
    });

    test('AC5 - the key is independent of canonicalRoutes (#54)', async function(assert) {
      // GUARD. Killed by mutation C -- the rule implemented correctly but read
      // through `config.restServer?.canonicalRoutes` instead of its own key.
      // Measured under that mutation: assertion 1 below returns 200.
      //
      // The independence is not a tidiness preference. A consumer behind an
      // absolute-form-emitting forward proxy MUST set
      // `REST_CANONICAL_ROUTES=false` to stay up; folding the two keys would
      // hand exactly those consumers the encoding bypass as the price.
      restServer.canonicalRoutes = false;

      assert.equal(await mountedStatusFor('/fixture/%73ecret', EncodingFixtureRequest), 404, '1. the encoded spelling is STILL rejected with canonicalRoutes=false');

      // 2. ...and in that SAME state, #54's own vector is genuinely re-opened.
      // Without this assertion, an implementation that ignores
      // `canonicalRoutes` entirely -- or a test harness whose flag write never
      // reached the server -- also passes assertion 1, and assertion 1 is then
      // vacuous. This is the precondition that makes the independence claim
      // mean something.
      assert.equal(await mountedStatusFor('/fixture/', EncodingFixtureRequest), 200, '2. precondition: canonicalRoutes=false DID take effect -- the #54 mount-root vector is re-opened in this same state');

      // 3. and the canonical spelling still routes, so assertion 1 is a
      // rejection of the SPELLING rather than of the route.
      assert.equal(await mountedStatusFor('/fixture/secret', EncodingFixtureRequest), 200, '3. the canonical spelling still routes with canonicalRoutes=false');
    });

    test('AC6 - the absent-key default is secure, and the opt-out opts out', async function(assert) {
      // GUARD. Killed by weakening the read in src/route-matching.ts from
      // `!== false` to `=== true`: measured 38 pass / 1 fail with THIS test as
      // the only failure, which is also the evidence that the integration tier
      // cannot see it.

      // 1. Sanity: the canonical spelling is reachable with the config
      // untouched, and the encoded one is not.
      assert.equal(await mountedStatusFor('/fixture/secret', EncodingFixtureRequest), 200, '1. GET /fixture/secret is 200 with the config untouched');
      assert.equal(await mountedStatusFor('/fixture/%73ecret', EncodingFixtureRequest), 404, '1. GET /fixture/%73ecret is rejected with the config untouched');

      // 2. Key PRESENT and `undefined`.
      restServer.canonicalEncoding = undefined;
      assert.equal(await mountedStatusFor('/fixture/%73ecret', EncodingFixtureRequest), 404, '2. defaults to rejecting the encoded spelling when the key is present and undefined');

      // 3/4. Key ABSENT as an own property -- the state every consumer whose
      // shipped `restServer` block predates this key is in, and reachable in
      // practice because the stonyx loader only merges a module's
      // config/environment.js for modules in devDependencies. Strictly stronger
      // than 2: a guard failing open only on this shape survives 2.
      delete restServer.canonicalEncoding;
      assert.notOk(Object.prototype.hasOwnProperty.call(restServer, 'canonicalEncoding'), '3. precondition: canonicalEncoding is not an own property');
      assert.equal(await mountedStatusFor('/fixture/%73ecret', EncodingFixtureRequest), 404, '4. defaults to rejecting the encoded spelling when the key is absent entirely');
      assert.equal(await mountedStatusFor('/fixture/secret', EncodingFixtureRequest), 200, '4. and the canonical spelling still routes in that state');

      // 5/6. Explicit opt-out genuinely re-opens the bypass. This is also what
      // proves 2 and 4 are not vacuous: the same fetch call returns 200 here,
      // so `%73ecret` is demonstrably reaching the server rather than being
      // swallowed or normalised by the client.
      restServer.canonicalEncoding = false;
      assert.equal(await mountedStatusFor('/fixture/%73ecret', EncodingFixtureRequest), 200, '5. canonicalEncoding=false re-opens the percent-encoding bypass');
      assert.equal(await mountedStatusFor('/fixture/secret', EncodingFixtureRequest), 200, '6. the canonical spelling still routes when opted out');
    });
  });
});
