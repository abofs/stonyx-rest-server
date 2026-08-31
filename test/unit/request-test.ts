import QUnit from "qunit";
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import config from "stonyx/config";
import Request from "../../src/request.js";

const { module, test, todo } = QUnit;
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
  // Scaffold: TODO stub only, no implementation yet. Binds an ephemeral port
  // via listen(0) so it adds no fixed-port binding to the suite.
  // ---------------------------------------------------------------------------
  module('caseSensitiveRoutes config flag (#47)', function() {
    todo('AC6 — the opt-out actually opts out, and defaults to secure', async function(assert) {
      assert.ok(false, 'TODO: caseSensitiveRoutes=false -> GET /SUCCESS 200; key absent -> GET /SUCCESS 404; via listen(0)');
    });
  });
});
