// Regression test for stonyx-rest-server#37.
//
// The package must publish `config/environment.js` (plain JS) and must NOT
// publish `config/environment.ts`. Node refuses to type-strip inside
// `node_modules`, so if we ship a `.ts` here the stonyx module loader
// dynamic-import of this config will crash consumers at parse time.
//
// This test invokes `npm pack --dry-run --json` and asserts the tarball
// entry list contains `config/environment.js` and does not contain
// `config/environment.ts`.
import QUnit from 'qunit';
import { execFileSync } from 'child_process';
import { once } from 'events';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Request } from '@stonyx/rest-server';
import type { RouteHandlers } from '../../src/request.js';

const { module, test } = QUnit;

module('[Unit] Publish surface', function () {
  // ---------------------------------------------------------------------------
  // #47 AC7 (re-land requirement from the 2026-09-03 reopen) — the fix must be
  // present in the BUILT artifact, not only in src/. The 2026-09-01 revert was
  // invisible because nothing asserted anything about dist/.
  //
  // `@stonyx/rest-server` resolves through this package's own `exports` map to
  // ./dist/main.js (verified: there is no node_modules/@stonyx/rest-server), so
  // the import below is the published entry point, not the TypeScript source.
  // It is driven over a real socket on an ephemeral port -- not by inspecting
  // `app.enabled(...)`.
  // ---------------------------------------------------------------------------
  test('AC7 — the built dist/ artifact mounts case-sensitively', async function (assert) {
    class DistFixture extends Request {
      handlers: RouteHandlers = {
        get: {
          '/success': () => ({ data: 'foo' })
        }
      };
    }

    const entry = import.meta.resolve('@stonyx/rest-server');
    assert.ok(entry.endsWith('/dist/main.js'), `fixture is built from dist (${entry})`);

    const fixture = new DistFixture();
    fixture.registerCalls();

    const server = fixture.expressInstance.listen(0) as Server;
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      const canonical = await fetch(`http://127.0.0.1:${port}/success`);
      await canonical.arrayBuffer();
      assert.equal(canonical.status, 200, 'dist build: GET /success -> 200');

      const varied = await fetch(`http://127.0.0.1:${port}/SUCCESS`);
      await varied.arrayBuffer();
      assert.equal(varied.status, 404, 'dist build: GET /SUCCESS -> 404');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('config/environment.js is published and .ts is not', function (assert) {
    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const report = JSON.parse(stdout);
    const entry = Array.isArray(report) ? report[0] : report;
    const files = (entry.files ?? []).map((f: { path: string }) => f.path);

    assert.ok(
      files.includes('config/environment.js'),
      'published tarball includes config/environment.js'
    );
    assert.notOk(
      files.includes('config/environment.ts'),
      'published tarball does NOT include config/environment.ts'
    );
  });
});
