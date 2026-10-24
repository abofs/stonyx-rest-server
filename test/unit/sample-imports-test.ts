// The README promises that test/sample/ is copyable into a consumer app as-is,
// in TypeScript or JavaScript. A consumer can resolve only this package's
// public entry points, so a sample may import only @stonyx/rest-server (or a
// package.json#exports subpath of it) and other files inside test/sample/.
// Inside this repo `../../../src/...` and `express` both resolve, so the
// suite cannot catch such an import by loading the samples; only this scan
// does. Pattern from abofs/stonyx-discord test/unit/sample-imports-test.ts,
// extended to backtick specifiers and require().
import QUnit from 'qunit';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';

const { module, test } = QUnit;

const SAMPLE_ROOT = resolve('test/sample');
const PACKAGE = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));

function sampleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sampleFiles(path);
    return /\.[cm]?[jt]s$/.test(entry.name) ? [path] : [];
  });
}

// `from '...'`, `import '...'`, `import('...')` and `require('...')`, with
// single, double or backtick quotes.
function specifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
  for (const match of source.matchAll(pattern)) found.push(match[2]);
  return found;
}

// A relative import is allowed only if it stays inside test/sample/. A bare
// import must be the package itself or one of its package.json#exports keys.
function allowed(file: string, spec: string): boolean {
  if (spec.startsWith('.')) return !relative(SAMPLE_ROOT, resolve(dirname(file), spec)).startsWith('..');
  if (spec === PACKAGE.name) return '.' in PACKAGE.exports;
  if (spec.startsWith(`${PACKAGE.name}/`)) return `./${spec.slice(PACKAGE.name.length + 1)}` in PACKAGE.exports;
  return false;
}

module('[Unit] Sample imports', function() {
  test('every test/sample import is @stonyx/rest-server, an exported subpath, or a sibling sample', function(assert) {
    const files = sampleFiles(SAMPLE_ROOT);
    const all = files.flatMap(file => specifiers(readFileSync(file, 'utf8')).map(spec => ({ file, spec })));

    // Non-vacuity: the scan reaches the samples and recognises a package import.
    assert.ok(files.length > 0, 'the scan finds sample files');
    assert.ok(all.some(({ spec }) => spec === PACKAGE.name), 'the scan sees @stonyx/rest-server imports');

    const flagged = all
      .filter(({ file, spec }) => !allowed(file, spec))
      .map(({ file, spec }) => `${relative(process.cwd(), file)}: ${spec}`);

    assert.deepEqual(flagged, [], 'no sample imports src/, express, an unexported subpath, or a path outside test/sample/');
  });

  // Red fixture: the scan and the rule each reject what they exist to reject.
  test('the scan finds, and the rule rejects, the imports it guards against', function(assert) {
    const file = join(SAMPLE_ROOT, 'requests', 'fixture.ts');
    const source = [
      "import type { RouteHandlers } from '../../../src/request.js';",
      'import type { Request } from "express";',
      'const lazy = await import(`@stonyx/rest-server/request`);',
      "const cjs = require('stonyx/config');",
      "import './side-effect.js';"
    ].join('\n');

    const found = specifiers(source);
    assert.deepEqual(found, ['../../../src/request.js', 'express', '@stonyx/rest-server/request', 'stonyx/config', './side-effect.js']);
    assert.deepEqual(found.map(spec => allowed(file, spec)), [false, false, false, false, true]);
    assert.true(allowed(file, PACKAGE.name), 'the package root is allowed');
  });
});
