import QUnit from "qunit";
import { once } from 'events';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import config from "stonyx/config";
import Request from "../../src/request.js";
import type { RequestState, RouteHandlers } from "../../src/request.js";

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

  // ---------------------------------------------------------------------------
  // #47 AC6 — the `caseSensitiveRoutes` opt-out actually opts out, and the
  // absent-key default (the state every existing consumer is in) is secure.
  //
  // Socket-level: the fixture is a real Request subclass mounted on an ephemeral
  // listen(0) port, so no fixed port is bound and concurrent runs cannot collide
  // on 2666 (see #44 / #43).
  //
  // Coverage each half actually provides, per the Phase 4 mutation table -- AC6a
  // does NOT prove the flag is read, because case-insensitive is express's own
  // default, so its 200/200 is satisfied whether the flag is honoured, ignored,
  // or never read:
  //   AC6a  catches only a value hardcoded `true` at BOTH construction sites
  //         (a hardcode at src/main.ts alone leaves the suite green -- see #71)
  //   AC6b  catches an inverted absent-key default
  //   AC6c  catches a reverted read that treats falsy-but-not-false as opt-out
  // AC6b and AC6c are the load-bearing halves; AC6a is the opt-out control.
  // ---------------------------------------------------------------------------
  module('case-sensitive route matching (#47 AC6)', function() {
    class CaseFixture extends Request {
      handlers: RouteHandlers = {
        get: {
          '/success': (_request: ExpressRequest, _state: RequestState) => {
            return { data: 'foo' };
          }
        }
      };
    }

    // Constructs the fixture AFTER the caller has staged config, because the
    // express setting is read in the Request constructor.
    async function probe(paths: string[]): Promise<number[]> {
      const fixture = new CaseFixture();
      fixture.registerCalls();

      const server = fixture.expressInstance.listen(0) as Server;
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;

      try {
        const statuses: number[] = [];
        for (const path of paths) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`);
          await response.arrayBuffer();
          statuses.push(response.status);
        }
        return statuses;
      } finally {
        server.closeAllConnections();
        server.close();
      }
    }

    test('AC6a — caseSensitiveRoutes=false restores case-insensitive matching', async function(assert) {
      const { restServer } = config;
      const original = restServer.caseSensitiveRoutes;

      restServer.caseSensitiveRoutes = false;

      try {
        const [canonical, varied] = await probe(['/success', '/SUCCESS']);

        assert.equal(canonical, 200, 'GET /success -> 200 with the opt-out set');
        assert.equal(varied, 200, 'GET /SUCCESS -> 200, the opt-out really opts out');
      } finally {
        restServer.caseSensitiveRoutes = original;
      }
    });

    // -------------------------------------------------------------------------
    // AC6c (#47 fix round -- SME Phase 1 NIT-1). Only an explicit `false` opts
    // out. The review head read the config with a destructuring default, which
    // fires on `undefined` alone -- so a config carrying `null`, `0` or `''`
    // skipped the default and set the express flag falsy. Measured on the
    // review head, all three restored case-INSENSITIVE matching: a silent
    // fail-open into the exact hole #47 closes, reachable from a config typo.
    //
    // Turns red if the read reverts to a destructuring default, or to any
    // truthiness check.
    // -------------------------------------------------------------------------
    test('AC6c — a falsy-but-not-false config value does not silently disable the fix', async function(assert) {
      const { restServer } = config;
      const had = 'caseSensitiveRoutes' in restServer;
      const original = restServer.caseSensitiveRoutes;

      try {
        for (const value of [null, 0, '', NaN] as unknown[]) {
          (restServer as unknown as Record<string, unknown>).caseSensitiveRoutes = value;

          const [canonical, varied] = await probe(['/success', '/SUCCESS']);

          assert.equal(canonical, 200, `GET /success -> 200 with caseSensitiveRoutes=${String(value)}`);
          assert.equal(varied, 404, `GET /SUCCESS -> 404: ${String(value)} is not an opt-out, only \`false\` is`);
        }
      } finally {
        if (had) restServer.caseSensitiveRoutes = original;
        else delete restServer.caseSensitiveRoutes;
      }
    });

    test('AC6b — absent config key defaults to case-sensitive', async function(assert) {
      const { restServer } = config;
      const had = 'caseSensitiveRoutes' in restServer;
      const original = restServer.caseSensitiveRoutes;

      delete restServer.caseSensitiveRoutes;

      try {
        assert.notOk('caseSensitiveRoutes' in restServer, 'config key really is absent for this probe');

        const [canonical, varied] = await probe(['/success', '/SUCCESS']);

        assert.equal(canonical, 200, 'GET /success -> 200 with the key absent');
        assert.equal(varied, 404, 'GET /SUCCESS -> 404, the absent-key default is secure');
      } finally {
        if (had) restServer.caseSensitiveRoutes = original;
      }
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
});

