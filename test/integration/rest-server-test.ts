import QUnit from "qunit";
import net from "net";
import RestServer from "@stonyx/rest-server";
import config from "stonyx/config";
import { setupIntegrationTests } from "stonyx/test-helpers";

const { module, test } = QUnit;
let endpoint: string;

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Issues one HTTP/1.1 request with the request target written VERBATIM onto the
// wire, and returns the parsed status line, headers and body.
//
// This exists because `fetch` cannot express the targets abofs/stonyx-rest-server#54
// is about. Measured: `fetch` normalises dot-segments (`/admin/.` -> `/admin/`)
// and has no API at all for an absolute-form request target
// (`GET http://host/admin HTTP/1.1`, RFC 9112 3.2.2). Both are exactly the
// strings the fix has to reject, so a `fetch`-based probe of them passes on
// unfixed code. Do not "simplify" this helper back to `fetch`.
//
// `Connection: close` so the server ends the socket and the body is complete on
// 'end' without needing chunked/Content-Length handling.
function rawRequest(target: string, port: number | string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });

    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { raw += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      const separator = raw.indexOf('\r\n\r\n');
      const head = raw.slice(0, separator === -1 ? raw.length : separator);
      const body = separator === -1 ? '' : raw.slice(separator + 4);
      const [statusLine, ...headerLines] = head.split('\r\n');

      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const index = line.indexOf(':');
        if (index === -1) continue;
        headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }

      resolve({ status: Number(statusLine!.split(' ')[1]), headers, body });
    });
  });
}

// The observable shape of a 404, minus the fields that legitimately differ
// between two different targets (date, content-length -- the bodies echo the
// target). Used to assert a #54 rejection is indistinguishable from a genuine
// miss; `res.sendStatus(404)` answers `text/plain` here and turns that red.
function shapeOf({ status, headers }: RawResponse) {
  return {
    status,
    contentType: headers['content-type'],
    csp: headers['content-security-policy'],
    nosniff: headers['x-content-type-options']
  };
}

// Driven by sample requests defined in test/sample-requests
module('[Integration] Rest Server', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    endpoint = `http://localhost:${config.restServer.port}`;
  });

  hooks.after(function() {
    RestServer.close();
  });

  test('Returns 404 when route does not exist', async function(assert) {
    const response = await fetch(`${endpoint}/non-existent-route`);

    assert.equal(response.status, 404);
  });

  module('/public', function(hooks) {
    test('Returns JSON data from a public request with an object response', async function(assert) {
      const response = await fetch(`${endpoint}/public`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'foo');
    });

    test('Returns 200 with default OK body when no response is returned', async function(assert) {
      const response = await fetch(`${endpoint}/public/success`);
      const data = await response.text();

      assert.equal(response.status, 200);
      assert.equal(data, 'OK');
    });

    test('Correctly handles url params', async function(assert) {
      const response = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { x: 'foo', y: 'bar', z: 'baz' });
    });

    test('Correctly handles different params on same call', async function(assert) {
      const response = await fetch(`${endpoint}/public/url-params/1/2/3`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { x: '1', y: '2', z: '3' });
    });

    test('Correctly executes successful validation middleware', async function(assert) {
      const response = await fetch(`${endpoint}/public/foo`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: { newProp: 'bar' } });
    });

    test('Middleware routes work on repeated calls', async function(assert) {
      const response1 = await fetch(`${endpoint}/public/foo`);
      const data1 = await response1.json();

      assert.equal(response1.status, 200, 'First call succeeds');
      assert.deepEqual(data1, { data: { newProp: 'bar' } });

      const response2 = await fetch(`${endpoint}/public/foo`);
      const data2 = await response2.json();

      assert.equal(response2.status, 200, 'Second call succeeds');
      assert.deepEqual(data2, { data: { newProp: 'bar' } });
    });

    test('Correctly executes failed validation middleware', async function(assert) {
      const response = await fetch(`${endpoint}/public/fail`);

      assert.equal(response.status, 504);
    });

    test('Correctly binds call handlers to request class', async function(assert) {
      const response = await fetch(`${endpoint}/public/bind`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: 'stonyx' });
    });

    test('Correctly binds middleware methods to request class', async function(assert) {
      const response = await fetch(`${endpoint}/public/bind-middleware`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { data: { testProp: 'stonyx' } });
    });
  });

  module('/private', function(hooks) {
    test('Returns JSON data from a private request with an object response', async function(assert) {
      const response = await fetch(`${endpoint}/private/success`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'foo');
    });

    test('Returns error status code from failed auth hook', async function(assert) {
      const response = await fetch(`${endpoint}/private/failure`);

      assert.equal(response.status, 505);
    });

    test('Auth hook has access to request.params from matched route', async function(assert) {
      const response = await fetch(`${endpoint}/private/restricted`);

      assert.equal(response.status, 403, 'Auth can read request.params.id');
    });

    test('Auth hook allows non-restricted param values', async function(assert) {
      const response = await fetch(`${endpoint}/private/allowed`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.data, 'param-route');
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#47 — case-sensitive route matching
  //
  // Every AC is executed as a real HTTP request over the server the enclosing
  // module already booted. No new listener, no new fixed-port bind.
  //
  // Inspecting config, or asserting `app.enabled('case sensitive routing')`,
  // satisfies none of these: express 5's `createApplication()` takes zero
  // arguments, so a `caseSensitive: true` constructor option is a silent no-op
  // that would pass every config-shaped check while changing no behaviour.
  // ---------------------------------------------------------------------------
  module('case-sensitive routing (#47)', function() {
    test('AC1 — negative control: correctly-cased routing is untouched', async function(assert) {
      const success = await fetch(`${endpoint}/public/success`);
      assert.equal(success.status, 200, 'GET /public/success still 200');
      assert.equal(await success.text(), 'OK', 'GET /public/success still returns the default OK body');

      const params = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      assert.equal(params.status, 200, 'GET /public/url-params/foo/bar/baz still 200');
      assert.deepEqual(await params.json(), { x: 'foo', y: 'bar', z: 'baz' }, 'params still resolve');

      const health = await fetch(`${endpoint}/health`);
      assert.equal(health.status, 200, 'GET /health still 200');
    });

    test('AC2 — negative control: the auth hook still fires on the canonical path', async function(assert) {
      const failure = await fetch(`${endpoint}/private/failure`);
      assert.equal(failure.status, 505, 'auth hook still rejects GET /private/failure');

      const success = await fetch(`${endpoint}/private/success`);
      assert.equal(success.status, 200, 'GET /private/success still 200');
      assert.deepEqual(await success.json(), { data: 'foo' }, 'the /success handler still runs');
    });

    test('AC3 — mount-segment case is rejected', async function(assert) {
      // Closed by `case sensitive routing` on the parent app (src/main.ts).
      // Measured before the fix: 200 / 505 / 200.
      //
      // The middle value is the one worth reading. A case-varied MOUNT segment
      // still lands in private.ts's sub-app, where `req.path` is the
      // correctly-cased `/failure`, so the auth hook fires and returns 505 even
      // pre-fix. Mount-segment case variation was never the auth bypass; it is
      // a sub-path miss inside an already-mounted app that reaches a handler
      // the hook would have denied. That is why AC5 below has to probe
      // `/private/FAILURE` and not `/PRIVATE/failure`.
      const publicRoute = await fetch(`${endpoint}/PUBLIC/success`);
      assert.equal(publicRoute.status, 404, 'GET /PUBLIC/success does not reach the /public mount');

      const privateRoute = await fetch(`${endpoint}/PRIVATE/failure`);
      assert.equal(privateRoute.status, 404, 'GET /PRIVATE/failure does not reach the /private mount');

      const health = await fetch(`${endpoint}/HEALTH`);
      assert.equal(health.status, 404, 'GET /HEALTH does not reach /health');
    });

    test('AC4 — sub-path case is rejected', async function(assert) {
      // Closed only by `case sensitive routing` on the child app (src/request.ts),
      // set in the constructor before registerCalls() materializes the router.
      // A parent-only fix, or a child set applied after route registration,
      // passes AC3 and returns 200 here. `public.ts` has no bare `/:id`, so a
      // miss is a true 404.
      const success = await fetch(`${endpoint}/public/SUCCESS`);
      assert.equal(success.status, 404, 'GET /public/SUCCESS does not reach the /success handler');

      const bind = await fetch(`${endpoint}/public/BIND`);
      assert.equal(bind.status, 404, 'GET /public/BIND does not reach the /bind handler');
    });

    test('AC5 — a case-varied path cannot reach a handler the auth hook denies', async function(assert) {
      // The security-relevant assertion. Before the fix, GET /private/FAILURE
      // reaches the /failure handler and returns {data:'foo'} with the 505 auth
      // hook never firing. After the fix it misses /failure and is absorbed by
      // private.ts's `/:id` catch-all, so the STATUS is 200 either way — the
      // assertion is on which handler ran, not on the status.
      const response = await fetch(`${endpoint}/private/FAILURE`);
      const body = await response.json();

      assert.notDeepEqual(body, { data: 'foo' }, 'GET /private/FAILURE does not reach the auth-denied /failure handler');
      assert.deepEqual(body, { data: 'param-route' }, 'GET /private/FAILURE falls through to the /:id catch-all');
      assert.equal(response.status, 200, 'status is 200 via /:id — documented, not a regression');
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#50 — strict route matching (trailing slash)
  //
  // Every AC is executed as a real HTTP request over the server the enclosing
  // module already booted. No new listener, no new fixed-port bind.
  //
  // As with #47, inspecting config or asserting `app.enabled('strict routing')`
  // satisfies none of these: express 5's `createApplication()` takes zero
  // arguments, so a `strict: true` constructor option is a silent no-op that
  // would pass every config-shaped check while changing no behaviour.
  //
  // The two ACs below are killed by DIFFERENT mutations -- AC1 by removing the
  // call in src/request.ts, AC2 by removing the call in src/main.ts -- which is
  // what makes the parent site independently covered rather than incidentally
  // green. See the mutation table in the PR body.
  // ---------------------------------------------------------------------------
  module('strict routing (#50)', function() {
    test('AC1 — a trailing slash cannot reach a handler the auth hook denies', async function(assert) {
      // The security-relevant assertion, and the reproduction from #50.
      // Measured before the fix: 200 with body {"data":"foo"} -- the /failure
      // handler runs and the 505 auth hook never fires, because `req.path` is
      // `/failure/` and the hook compares against `/failure`.
      //
      // Closed by `strict routing` on the CHILD app (src/request.ts) alone.
      // The parent site does nothing for this: Router.prototype.use hardcodes
      // `strict: false`, so mount segments are structurally strict-immune.
      // This is the opposite of #47, where use() does forward `sensitive` --
      // do not carry the #47 shape across. (Version-pinned citation for the
      // upstream line: docs/project-structure.md, "Strict routing (#50)".)
      //
      // Unlike #47's AC5 there is no /:id fallthrough to absorb this: `/:id`
      // is equally strict, so `/failure/` misses it too and the status is a
      // true 404. Both halves are asserted -- the status, and that the
      // auth-denied handler's body is not what came back.
      const failure = await fetch(`${endpoint}/private/failure/`);
      assert.equal(failure.status, 404, 'GET /private/failure/ does not reach the auth-denied /failure handler');
      assert.notEqual(await failure.text(), '{"data":"foo"}', 'GET /private/failure/ does not return the guarded handler body');

      // Sub-path trailing slash on an unguarded route misses too.
      const publicSuccess = await fetch(`${endpoint}/public/success/`);
      assert.equal(publicSuccess.status, 404, 'GET /public/success/ does not reach the /success handler');

      // Negative controls: canonical paths are untouched.
      const canonicalFailure = await fetch(`${endpoint}/private/failure`);
      assert.equal(canonicalFailure.status, 505, 'auth hook still rejects GET /private/failure');

      const success = await fetch(`${endpoint}/private/success`);
      assert.equal(success.status, 200, 'GET /private/success still 200');
      assert.deepEqual(await success.json(), { data: 'foo' }, 'the /success handler still runs');

      const publicOk = await fetch(`${endpoint}/public/success`);
      assert.equal(publicOk.status, 200, 'GET /public/success still 200');
      assert.equal(await publicOk.text(), 'OK', 'GET /public/success still returns the default OK body');

      const params = await fetch(`${endpoint}/public/url-params/foo/bar/baz`);
      assert.equal(params.status, 200, 'GET /public/url-params/foo/bar/baz still 200');
      assert.deepEqual(await params.json(), { x: 'foo', y: 'bar', z: 'baz' }, 'params still resolve');
    });

    test('AC2 — the parent construction site is independently covered', async function(assert) {
      // `/health` is the ONLY route registered directly on the parent app
      // (`this.api.get('/health', ...)` in setupRouter()); every route class is
      // attached with `api.use(route, expressInstance)`. So this is the only
      // probe in the repo that the parent's `strict routing` can change, and
      // removing applyRouteMatching(this.api) from src/main.ts turns exactly
      // this assertion red while AC1 stays green.
      //
      // Scope note: the parent site closes /health/ and nothing else. It has
      // no security role here -- do not describe it as closing the bypass.
      const healthSlash = await fetch(`${endpoint}/health/`);
      assert.equal(healthSlash.status, 404, 'GET /health/ no longer matches the health check');

      const health = await fetch(`${endpoint}/health`);
      assert.equal(health.status, 200, 'GET /health still 200');

      // Documented invariant of the SETTING, and a regression guard rather
      // than evidence: no mutation of #50's fix can turn it red. For both
      // /public and /public/ the mounted sub-app receives req.path === '/', so
      // a req.path-based auth hook sees no difference and there is nothing for
      // `strict routing` to reject. Measured 200 under all four combinations of
      // the two SETTINGS, and that is still true -- it is still the reason
      // applyRouteMatching() is not the fix site for this edge.
      //
      // WHAT CHANGED, and why this assertion moved from 200 to 404
      // (abofs/stonyx-rest-server#54): the outcome is no longer decided by the
      // settings at all. `shouldRejectTarget()` in src/route-matching.ts runs
      // per request, ahead of the auth hook, and rejects a raw target that is
      // not the canonical path express matched. The residual the earlier
      // version of this comment described -- req.originalUrl DOES differ, and
      // an originalUrl hook was bypassed by one character -- is closed there.
      //
      // The previous instruction here was "do not 'fix' it by changing this
      // assertion", and that was correct for as long as the only mechanism on
      // the table was an express setting. It is superseded by #54, deliberately
      // and in the same change that closes the edge. It still stands as
      // written for the SETTINGS: do not change this line back on the theory
      // that `strict routing` should have covered it. It never could. The
      // module-level check is what covers it, and the assertion that this 404
      // is produced by the CHECK and not by the settings lives in
      // 'canonical request target (#54)' AC1.6 below, on a route class with no
      // auth hook.
      const mountRoot = await fetch(`${endpoint}/public/`);
      assert.equal(mountRoot.status, 404, 'GET /public/ is rejected by the canonical-target check (#54) — not by strict routing, which cannot see it');
    });
  });

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#54 - canonical request target
  //
  // Every probe in this module is issued over a RAW TCP SOCKET, never `fetch`.
  // That is a measured requirement, not a style preference:
  //
  //   target /admin/.            fetch -> server sees "/admin/"   raw -> "/admin/."
  //   target http://HOST/admin   fetch -> cannot be emitted at all
  //
  // `fetch` normalises dot-segments and has no way to put an absolute-form
  // request target on the wire, so assertions 3 and 4 below are structurally
  // invisible to it -- written with `fetch` they would pass on unfixed code.
  //
  // Pre-fix reproduction, measured by raw socket on `origin/dev` @ f5c9a24 with
  // this same fixture, all four unauthenticated 200s with the guarded handler
  // body:
  //
  //   GET /admin                        -> 401  (hook fires)
  //   GET /admin/                       -> 200  {"data":"GUARDED-ROOT-HANDLER-RAN"}
  //   GET http://HOST/admin             -> 200  {"data":"GUARDED-ROOT-HANDLER-RAN"}
  //   GET http://HOST/admin/settings    -> 200  {"data":"GUARDED-SETTINGS-HANDLER-RAN"}
  // ---------------------------------------------------------------------------
  module('canonical request target (#54)', function() {
    test('AC1 - the originalUrl bypass is closed on both vectors, and routing is not broken', async function(assert) {
      const { port } = config.restServer;

      // -- vector 1: the mount-root trailing slash -----------------------------
      const mountRootSlash = await rawRequest('/admin/', port);
      assert.equal(mountRootSlash.status, 404, '1. GET /admin/ is rejected');
      assert.notOk(mountRootSlash.body.includes('GUARDED-ROOT-HANDLER-RAN'), '1. GET /admin/ does not return the guarded handler body');

      // This assertion does NOT show that the query is stripped rather than
      // compared: `/admin/` is non-canonical either way, so removing
      // `.split('?')[0]` from src/route-matching.ts leaves it green (measured).
      // The stripping claim is carried by assertion 8 (`GET /admin?x=1` -> 401),
      // which that mutation turns red. Do not delete 8 as redundant with this.
      const mountRootSlashQuery = await rawRequest('/admin/?x=1', port);
      assert.equal(mountRootSlashQuery.status, 404, '2. GET /admin/?x=1 is rejected - a query string does not exempt a non-canonical target');

      // -- vector 2: the absolute-form request target (RFC 9112 3.2.2) ---------
      // Hits EVERY route, not just the mount root, which is why 4 probes a
      // sub-path. An implementation built on `new URL(originalUrl).pathname`
      // passes 1 and 2 and fails exactly these two.
      const absoluteRoot = await rawRequest(`http://127.0.0.1:${port}/admin`, port);
      assert.equal(absoluteRoot.status, 404, '3. GET http://HOST/admin (absolute-form) is rejected');
      assert.notOk(absoluteRoot.body.includes('GUARDED-ROOT-HANDLER-RAN'), '3. the absolute-form target does not return the guarded handler body');

      const absoluteSubPath = await rawRequest(`http://127.0.0.1:${port}/admin/settings`, port);
      assert.equal(absoluteSubPath.status, 404, '4. GET http://HOST/admin/settings (absolute-form, sub-path) is rejected');
      assert.notOk(absoluteSubPath.body.includes('GUARDED-SETTINGS-HANDLER-RAN'), '4. the absolute-form sub-path does not return the guarded handler body');

      // -- no oracle ----------------------------------------------------------
      // A rejection must be shape-identical to a genuine miss. Measured:
      // res.sendStatus(404) answers `text/plain "Not Found"` while finalhandler
      // answers `text/html <pre>Cannot GET ...</pre>` with a CSP header -- a
      // working oracle telling an attacker the route exists but was spelled
      // wrong. next('router') produces the second shape. Content-Length is
      // excluded because the two bodies echo different targets.
      const genuineMiss = await rawRequest('/admin/genuinely-missing', port);
      assert.equal(genuineMiss.status, 404, '5. precondition: a genuine miss under /admin is a 404');
      assert.deepEqual(
        shapeOf(mountRootSlash),
        shapeOf(genuineMiss),
        '5. the rejection is indistinguishable from a genuine miss (status, content-type, CSP, nosniff)'
      );
      assert.deepEqual(shapeOf(absoluteRoot), shapeOf(genuineMiss), '5. the absolute-form rejection is indistinguishable too');

      // -- not gated on `this.auth` -------------------------------------------
      // public.ts has NO auth hook. Gating the check inside `if (this.auth)`
      // leaves this at 200 while every assertion above stays green, which is
      // the whole reason this probe is separate. This assertion is also the
      // deliberate reversal of #50's documented `/public/` -> 200 invariant.
      const unguardedMountRoot = await rawRequest('/public/', port);
      assert.equal(unguardedMountRoot.status, 404, '6. GET /public/ is rejected on a route class with no auth hook');
      assert.notOk(unguardedMountRoot.body.includes('"data":"foo"'), '6. GET /public/ does not return the index handler body');

      // -- negative controls: the hook still fires on canonical targets --------
      const canonicalRoot = await rawRequest('/admin', port);
      assert.equal(canonicalRoot.status, 401, '7. GET /admin still reaches the auth hook and is denied');

      const canonicalSubPath = await rawRequest('/admin/settings', port);
      assert.equal(canonicalSubPath.status, 401, '8. GET /admin/settings still reaches the auth hook and is denied');

      // A query string on a CANONICAL path is permitted through to the hook.
      // This is the other half of assertion 2: the predicate strips the query
      // rather than rejecting on it, and that must not turn into a bypass.
      const canonicalRootQuery = await rawRequest('/admin?x=1', port);
      assert.equal(canonicalRootQuery.status, 401, '8. GET /admin?x=1 still reaches the auth hook and is denied');

      const canonicalSubPathQuery = await rawRequest('/admin/settings?y=2', port);
      assert.equal(canonicalSubPathQuery.status, 401, '8. GET /admin/settings?y=2 still reaches the auth hook and is denied');

      // -- negative controls: routing is not broken ---------------------------
      const publicIndex = await rawRequest('/public', port);
      assert.equal(publicIndex.status, 200, '9. GET /public still 200');
      assert.equal(publicIndex.body, '{"data":"foo"}', '9. GET /public still returns the index handler body');

      const publicSuccess = await rawRequest('/public/success', port);
      assert.equal(publicSuccess.status, 200, '9. GET /public/success still 200');
      assert.equal(publicSuccess.body, 'OK', '9. GET /public/success still returns the default OK body');

      const publicParams = await rawRequest('/public/url-params/foo/bar/baz', port);
      assert.equal(publicParams.status, 200, '9. GET /public/url-params/foo/bar/baz still 200');
      assert.deepEqual(JSON.parse(publicParams.body), { x: 'foo', y: 'bar', z: 'baz' }, '9. params still resolve');

      const privateSuccess = await rawRequest('/private/success', port);
      assert.equal(privateSuccess.status, 200, '9. GET /private/success still 200');

      const privateFailure = await rawRequest('/private/failure', port);
      assert.equal(privateFailure.status, 505, '9. the /private auth hook still rejects GET /private/failure');

      const health = await rawRequest('/health', port);
      assert.equal(health.status, 200, '9. GET /health still 200');

      // -- negative control: a legitimately-registered trailing slash survives --
      // admin.ts registers '/legacy/' WITH the slash, so its canonical target
      // carries one. A blanket `target.endsWith('/')` rule 404s this consumer.
      const legacy = await rawRequest('/admin/legacy/', port);
      assert.equal(legacy.status, 200, '10. a route registered with a literal trailing slash still matches at its registered spelling');
      assert.equal(legacy.body, '{"data":"LEGACY-HANDLER-RAN"}', '10. and it reaches its own handler');

      // -- the check runs BEFORE the auth hook, not merely outside it ----------
      // Assertion 6 covers only the `outside if (this.auth)` half of that
      // property: it probes a class with NO hook, so it stays green if the
      // check is merely moved BELOW the hook rather than gated on it. Measured
      // on this branch before this assertion existed: move
      // `if (shouldRejectTarget(req)) return next('router')` to just after the
      // `if (this.auth)` block and the suite stays 34 pass / 0 fail, while
      // `GET http://HOST/private/failure` answers 505 instead of 404.
      //
      // Two things break under that move, and this probe sees both:
      //   - the ORACLE assertion 5 exists to prevent comes back by another
      //     route -- an attacker sending an absolute-form target learns that
      //     /private/failure exists and is guarded, because the hook's own
      //     status is what answers;
      //   - the consumer's `auth` hook RUNS on a request the module is about to
      //     reject, so any hook with side effects (audit write, rate-limit
      //     counter, session refresh, a decision stashed in `state`) fires on a
      //     rejected request.
      // private.ts's hook returns 505 for req.path === '/failure', which is
      // what makes the difference observable from here.
      const absGuarded = await rawRequest(`http://127.0.0.1:${port}/private/failure`, port);
      assert.equal(absGuarded.status, 404, '11. the check runs BEFORE the auth hook - a guarded route does not answer with its hook status on a non-canonical target');
      assert.deepEqual(shapeOf(absGuarded), shapeOf(genuineMiss), '11. and that rejection is still shape-identical to a genuine miss');

      const canonicalGuarded = await rawRequest('/private/failure', port);
      assert.equal(canonicalGuarded.status, 505, '11. precondition: the same hook still answers 505 on the CANONICAL target, so 404 above is the check and not a dead route');

      // -- negative control: the index-mounted route class ---------------------
      // `src/main.ts` maps a class named `index` to mount path '/', the one
      // mount shape where `req.baseUrl` is ''. The `&& req.baseUrl` conjunct in
      // shouldRejectTarget()'s canonical expression exists solely for it: drop
      // the conjunct and `canonical` is '' while the raw target is '/', so the
      // APPLICATION ROOT 404s. Measured before this assertion existed: shipped
      // 200, conjunct dropped 404, suite 34 pass / 0 fail both ways.
      const indexRoot = await rawRequest('/', port);
      assert.equal(indexRoot.status, 200, '12. GET / still reaches the index-mounted route class, where req.baseUrl is the empty string');
      assert.equal(indexRoot.body, '{"data":"INDEX-ROOT-RAN"}', '12. and it reaches its own handler');
    });
  });

  module('/health', function(hooks) {
    test('Health check endpoint is configured automatically', async function(assert) {
      const response = await fetch(`${endpoint}/health`);

      assert.equal(response.status, 200);
    });
  });
});
