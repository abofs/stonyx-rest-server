// ---------------------------------------------------------------------------
// #47 fix round (SME Phase 5 HIGH-1/MED-1/LOW-1, Phase 2 HIGH-1, Phase 3 MEDIUM).
//
// README.md is the ONLY documentation a consumer receives: package.json `files`
// is ["dist", "config", "README.md"], so docs/ is not published. Its worked
// examples are therefore a consumer-facing contract, and this file holds them to
// it -- every example the README prints is executed here and asserted to produce
// the status and body the README claims.
//
// Driven over RAW SOCKETS (`net.connect`, byte-exact request lines) rather than
// `fetch`. The property under test IS the request target, and an HTTP client
// library normalises the very thing being measured -- WHATWG URL parsing would
// silently rewrite a case-varied or absolute-form target before it reached the
// wire, so a green `fetch` assertion would prove nothing about what express saw.
//
// The listener is `RestServer.instance.api.listen(0)` -- the real, fully mounted
// application object, on an EPHEMERAL port. This is deliberately not the fixed
// 2666 the rest of this suite binds (#68): a second listener on the same app
// gives the real product without the shared-port identity problem.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';
import net from 'net';
import { once } from 'events';
import { readFileSync } from 'fs';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import RestServer from '@stonyx/rest-server';

const { module, test } = QUnit;

interface RawResponse {
  status: number;
  headers: string;
  body: string;
}

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

module('[Integration] README worked examples (#47 fix round)', function (hooks) {
  let server: Server;
  let port: number;

  hooks.before(async function () {
    // Real application object, mounted by the stonyx module loader at boot.
    const instance = new RestServer();
    server = instance.api.listen(0) as Server;
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  });

  hooks.after(function () {
    server.closeAllConnections();
    server.close();
  });

  // Writes a byte-exact request line. Nothing between this string and express.
  function raw(requestLine: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      });

      let buffer = '';
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error(`timed out: ${requestLine}`));
      });
      socket.on('data', chunk => { buffer += chunk.toString('latin1'); });
      socket.on('error', reject);
      socket.on('end', () => {
        const separator = buffer.indexOf('\r\n\r\n');
        const headers = buffer.slice(0, separator);
        resolve({
          status: Number(headers.split('\r\n')[0]!.split(' ')[1]),
          headers,
          body: buffer.slice(separator + 4)
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // AC8 -- MED-1. The README's demonstration pair must be a pair the fix
  // actually changes. `GET /private/FAILURE` is NOT: it returns 200 both before
  // and after, because private.ts registers `/:id`, which absorbs the miss (the
  // PR's own AC5 says so). A consumer who runs that probe against a patched
  // server sees the identical 200 the README labels as the vulnerability and
  // concludes the fix did not land.
  // -------------------------------------------------------------------------
  test('AC8 — the README demonstrates a pair the fix actually flips', async function (assert) {
    const absorbed = await raw('GET /private/FAILURE HTTP/1.1');
    assert.equal(absorbed.status, 200, 'measured: GET /private/FAILURE is still 200 after the fix (/:id absorbs it)');

    const mountSegment = await raw('GET /PRIVATE/failure HTTP/1.1');
    assert.equal(mountSegment.status, 404, 'measured: GET /PRIVATE/failure -> 404 (src/main.ts site)');

    const subPath = await raw('GET /public/SUCCESS HTTP/1.1');
    assert.equal(subPath.status, 404, 'measured: GET /public/SUCCESS -> 404 (src/request.ts site)');

    assert.ok(
      /GET \/public\/SUCCESS\s+->\s+404/.test(readme),
      'README demonstrates GET /public/SUCCESS -> 404, a pair the fix flips'
    );
    assert.notOk(
      /GET \/private\/FAILURE\s+->\s+200\s+auth hook never fires/.test(readme),
      'README no longer presents GET /private/FAILURE -> 200 as the unqualified vulnerability signature'
    );
  });

  // -------------------------------------------------------------------------
  // AC9 -- HIGH-1 / LOW-1. The symptom a broken consumer sees. `Cannot GET`,
  // `404` and "no log line" appear nowhere in the README at the review head,
  // though the PR body claims they do. Measured here so the README states the
  // real string, which is the only thing a broken consumer can grep for.
  // -------------------------------------------------------------------------
  test('AC9 — the README names the exact 404 symptom a broken consumer sees', async function (assert) {
    const response = await raw('GET /public/SUCCESS HTTP/1.1');

    assert.equal(response.status, 404, 'measured: case-varied path 404s');
    assert.ok(
      response.body.includes('Cannot GET /public/SUCCESS'),
      `measured: express default 404 body is "Cannot GET <path>" (got: ${response.body.slice(0, 80)})`
    );
    assert.ok(readme.includes('Cannot GET'), 'README names the "Cannot GET" symptom string');
  });

  // -------------------------------------------------------------------------
  // AC10 -- Phase 2 HIGH-1. The `params.id` half of the Scope paragraph is a
  // live, measured, unauthenticated bypass on this head, disclosed at review
  // time in non-bypass language with no tracking issue. It is pre-existing and
  // not a regression from this PR, but the README points consumers at this
  // exact fixture shape. Tracked as #69.
  // -------------------------------------------------------------------------
  test('AC10 — the README discloses the live param-case residual it points consumers at', async function (assert) {
    const canonical = await raw('GET /private/restricted HTTP/1.1');
    assert.equal(canonical.status, 403, 'measured: GET /private/restricted -> 403, the auth hook denies it');

    const varied = await raw('GET /private/RESTRICTED HTTP/1.1');
    assert.equal(varied.status, 200, 'measured: GET /private/RESTRICTED -> 200, the guarded handler runs');
    assert.ok(
      varied.body.includes('param-route'),
      `measured: the /:id handler answers the case-varied id (got: ${varied.body.slice(0, 80)})`
    );

    assert.ok(
      /\/private\/RESTRICTED/.test(readme),
      'README carries the worked example for the param-case residual'
    );
    assert.ok(
      /issues\/69/.test(readme),
      'README links the param-case residual to its tracking issue (#69)'
    );
  });
});
