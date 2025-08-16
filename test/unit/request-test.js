import QUnit from "qunit";
import config from "stonyx/config";
import Request from "../../src/request.js";

const { module, test } = QUnit;
const { getState, sendStatusResponse, stateProp } = Request;

module('[Unit] Request', function() {
  module('getState', function() {
    test('creates a new state object in request object if one does not exist', async function(assert) {
      const request = {};
      const state = getState(request);

      assert.ok(state);
      assert.ok(request[stateProp]);
    });

    test('returns the existing state object if one exists', async function(assert) {
      const request = { [stateProp]: { foo: 'bar' } };
      const state = getState(request);

      assert.deepEqual(state, { foo: 'bar' });
      assert.deepEqual(request[stateProp], { foo: 'bar' });
    });
  });

  module('sendStatusResponse', function(hooks) {
    test('sends a response with a message if status code has an entry in the statusMap', async function(assert) {
      const { restServer } = config;
      let status, message;

      restServer.statusMap = { 732: 'foo' };
      sendStatusResponse({
        status: code => {
          status = code;
          return { send: msg => {
            message = msg;
          }}
        }
      }, 732);

      assert.equal(status, 732);
      assert.equal(message, 'foo');

      delete restServer.statusMap;
    });

    test('sends a response code with no message if status code does not have an entry in the statusMap', async function(assert) {
      let status;

      sendStatusResponse({ sendStatus: code => status = code }, 919);
      assert.equal(status, 919);
    });
  });
});

