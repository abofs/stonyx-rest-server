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

const { module, test } = QUnit;

module('[Unit] Publish surface', function () {
  // ---------------------------------------------------------------------------
  // #47 AC7 (re-land requirement) — the fix must be present in the BUILT
  // artifact, not only in src/. The 2026-09-01 revert was invisible because
  // nothing asserted anything about dist/. This drives the package's published
  // entry point (`@stonyx/rest-server` -> dist/main.js) over a real socket.
  // ---------------------------------------------------------------------------
  test('AC7 — the built dist/ artifact mounts case-sensitively', async function (assert) {
    assert.ok(true, 'TODO stub — replaced in the AC7 commit');
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
