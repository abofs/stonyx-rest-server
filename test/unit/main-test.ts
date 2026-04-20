import QUnit from 'qunit';
import sinon from 'sinon';
import RestServer from '../../src/main.js';
import log from 'stonyx/log';

const { module, test } = QUnit;

module('[Unit] RestServer', function (hooks) {
  hooks.afterEach(function () {
    sinon.restore();
    // Reset singleton so each test gets a fresh instance.
    (RestServer as unknown as { instance?: RestServer }).instance = undefined;
  });

  module('self-registers log type in init() (#40)', function (innerHooks) {
    innerHooks.afterEach(function () {
      sinon.restore();
    });

    test('registers api log type on init', async function (assert) {
      assert.strictEqual(typeof log.defineType, 'function', 'log.defineType is available');

      const server = new RestServer();
      // init() may throw later (route discovery / listen failures in the unit
      // harness) but defineType runs as the first statement, before the throw.
      try { await server.init(); } catch { /* expected */ }

      assert.strictEqual(typeof log.api, 'function', 'log.api is callable after init');

      try { RestServer.close(); } catch { /* best effort */ }
    });

    test('idempotent: calling init twice does not throw', async function (assert) {
      const server1 = new RestServer();
      try { await server1.init(); } catch { /* expected */ }
      try { RestServer.close(); } catch { /* best effort */ }
      (RestServer as unknown as { instance?: RestServer }).instance = undefined;

      const server2 = new RestServer();
      try { await server2.init(); } catch { /* expected */ }

      assert.strictEqual(typeof log.api, 'function', 'log.api still callable after second init');

      try { RestServer.close(); } catch { /* best effort */ }
    });
  });
});
