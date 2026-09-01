import QUnit from "qunit";
import net from "net";
import RestServer from "@stonyx/rest-server";
import config from "stonyx/config";
import { setupIntegrationTests } from "stonyx/test-helpers";

const { module, test, todo } = QUnit;
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

  // ---------------------------------------------------------------------------
  // abofs/stonyx-rest-server#56 - percent-encoded request target
  //
  // THE INSTRUMENT, AND THE PROPERTY IT WAS CHOSEN FOR. These probes are issued
  // over a raw TCP socket, and -- unlike the #54 module above -- that is NOT
  // because `fetch` would manufacture a green. Measured, and it splits the
  // inherited rule rather than repeating it:
  //
  //   target /enc/%73ecret      fetch -> transmitted VERBATIM   raw -> verbatim
  //   target /enc/./%73ecret    fetch -> server sees "/enc/%73ecret"   raw -> verbatim
  //   target http://HOST/enc/x  fetch -> cannot be emitted at all
  //
  // `fetch` normalises DOT-SEGMENTS and REQUEST-TARGET FORM. It does not touch
  // percent-triplets, so it reproduces this defect at 200 against unfixed code
  // and assertion 0 below is deliberately issued with it. What the raw socket
  // buys here is narrower and is worth naming precisely, because "raw socket
  // per the brief" is how an over-broad rule propagates:
  //
  //   (a) every target in this module reaches the server as the exact byte
  //       sequence written in the source, so a reader can paste it into a
  //       socket and reproduce the measurement; and
  //   (b) assertion 4's deep-equal compares the rejection's header set against
  //       a genuine miss's, and both sides must come from ONE instrument for
  //       the comparison to mean anything.
  //
  // Pre-fix reproduction, measured by raw socket on this branch before the
  // src change, with these same fixtures:
  //
  //   GET /enc/secret        -> 401  (hook fires)
  //   GET /enc/%73ecret      -> 200  {"data":"GUARDED-PARAM-HANDLER-RAN","id":"secret",...}
  //   GET /enco/%73ecret     -> 200  {"data":"GUARDED-PARAM-HANDLER-RAN","id":"secret",...}
  //   GET /private/%66ailure -> 200  {"data":"param-route"}   (guard walked past)
  // ---------------------------------------------------------------------------
  module('percent-encoded request target (#56)', function() {
    // DEFECT TEST. Scaffolded as a QUnit `todo` in the commit before the fix
    // and measured red there: 15 failing assertions, output in the PR body.
    // Flipped to `test` in the fix commit, which is forced rather than
    // remembered -- QUnit reports a `todo` whose assertions all pass as a
    // FAILURE, so the marker cannot survive the fix.
    test('AC1 - the percent-encoding bypass is closed on both hook shapes', async function(assert) {
      const { port } = config.restServer;

      // -- 0. the same defect through an ordinary HTTP client -----------------
      // DEFECT TEST, and the assertion that pins the instrument claim above:
      // `fetch` transmits `%73` verbatim, so this reproduces the bypass at 200
      // pre-fix exactly as the raw socket does. It is here so that nobody reads
      // this module as "raw sockets are required for percent-encoding" -- they
      // are not, and the two-cell experiment that splits the inherited rule is
      // recorded in the header comment.
      const viaFetch = await fetch(`${endpoint}/enc/%73ecret`);
      assert.equal(viaFetch.status, 404, '0. GET /enc/%73ecret is rejected for an ordinary fetch client too');

      // -- 1. shape A: the hook authorizes on req.path ------------------------
      const pathHook = await rawRequest('/enc/%73ecret', port);
      assert.equal(pathHook.status, 404, '1. GET /enc/%73ecret is rejected (hook on req.path)');
      assert.notOk(pathHook.body.includes('GUARDED-PARAM-HANDLER-RAN'), '1. GET /enc/%73ecret does not return the guarded handler body');

      // -- 2. shape B: the hook authorizes on the query-stripped originalUrl --
      const originalUrlHook = await rawRequest('/enco/%73ecret', port);
      assert.equal(originalUrlHook.status, 404, '2. GET /enco/%73ecret is rejected (hook on the query-stripped req.originalUrl)');
      assert.notOk(originalUrlHook.body.includes('GUARDED-PARAM-HANDLER-RAN'), '2. GET /enco/%73ecret does not return the guarded handler body');

      // -- 3. the rule is not character-positional ----------------------------
      // Three SAMPLES, deliberately not an enumeration. The family is
      // `PROD(1 + v_i) - 1` spellings for an id of n bytes, where v_i is 2 when
      // the byte's hex carries a letter digit and 1 otherwise -- measured 63
      // spellings for `secret` and 71 for `admin`, ALL of them 200 pre-fix. An
      // AC enumerating spellings is the wrong shape; these three exist so a fix
      // anchored on a LEADING `%`, on an exact string, or on a single triplet
      // turns red.
      const middle = await rawRequest('/enc/sec%72et', port);
      assert.equal(middle.status, 404, '3. GET /enc/sec%72et is rejected (encoded byte in the MIDDLE)');

      const last = await rawRequest('/enc/secre%74', port);
      assert.equal(last.status, 404, '3. GET /enc/secre%74 is rejected (encoded byte LAST)');

      const all = await rawRequest('/enc/%73%65%63%72%65%74', port);
      assert.equal(all.status, 404, '3. GET /enc/%73%65%63%72%65%74 is rejected (EVERY byte encoded)');
      assert.notOk(all.body.includes('GUARDED-PARAM-HANDLER-RAN'), '3. the fully-encoded spelling does not return the guarded handler body');

      const upperHex = await rawRequest('/enc/%53ecret', port);
      assert.equal(upperHex.status, 404, '3. GET /enc/%53ecret is rejected (uppercase octet -- a DIFFERENT id, still an over-encoded unreserved byte)');

      // -- 4. no oracle -------------------------------------------------------
      // A rejection must be shape-identical to a genuine miss, for the same
      // reason as #54's AC1.5: `res.sendStatus(404)` answers `text/plain` while
      // a real miss answers `text/html` with a CSP header -- a working oracle
      // telling an attacker the route exists but was spelled wrong. This is
      // what pins `next('router')`. Content-Length is excluded because the two
      // bodies echo different targets.
      //
      // `/enc/genuinely/missing` is TWO segments, so it matches neither `/:id`
      // nor anything else in the class and is a true miss.
      const genuineMiss = await rawRequest('/enc/genuinely/missing', port);
      assert.equal(genuineMiss.status, 404, '4. precondition: a genuine miss under /enc is a 404');
      assert.deepEqual(shapeOf(pathHook), shapeOf(genuineMiss), '4. the rejection is indistinguishable from a genuine miss (status, content-type, CSP, nosniff)');
      assert.deepEqual(shapeOf(originalUrlHook), shapeOf(genuineMiss), '4. and so is the originalUrl-shape rejection');

      // -- 5. the third shape, in the SHIPPED fixture -------------------------
      // `private.ts` guards a LITERAL route on `req.path` and co-registers
      // `/:id`. The encoded spelling misses the literal layer and is ABSORBED
      // by the sibling param route, so the guard is walked past without the
      // guarded handler ever being the one that runs. Measured pre-fix:
      // `GET /private/failure` -> 505 while `GET /private/%66ailure` -> 200
      // {"data":"param-route"}. This is the shape most likely to exist in the
      // field, and no fixture written for #56 alone would have caught it.
      const encodedLiteralGuarded = await rawRequest('/private/%66ailure', port);
      assert.equal(encodedLiteralGuarded.status, 404, '5. GET /private/%66ailure is rejected rather than absorbed by the sibling /:id route');
      assert.notOk(encodedLiteralGuarded.body.includes('param-route'), '5. GET /private/%66ailure does not reach the /:id catch-all');

      const encodedLiteralOpen = await rawRequest('/private/%73uccess', port);
      assert.equal(encodedLiteralOpen.status, 404, '5. GET /private/%73uccess is rejected too -- the rule is about the SPELLING, not about which handler it would have reached');
    });

    test('AC2 - negative controls: the fix is not satisfiable by breaking routing', async function(assert) {
      const { port } = config.restServer;

      // GUARD, not a defect test. Killed by mutation D (`shouldRejectEncoding`
      // -> `return true`), measured at 13 pass / 21 fail with every surface
      // below among the failures.

      // 1. the canonical spelling is still denied, on both hook shapes.
      const canonicalPathHook = await rawRequest('/enc/secret', port);
      assert.equal(canonicalPathHook.status, 401, '1. GET /enc/secret still reaches the req.path hook and is denied');

      const canonicalOriginalUrlHook = await rawRequest('/enco/secret', port);
      assert.equal(canonicalOriginalUrlHook.status, 401, '1. GET /enco/secret still reaches the req.originalUrl hook and is denied');

      // 2. an unguarded param still routes, and the handler still receives the
      // DECODED value -- status alone would not show that.
      const unguarded = await rawRequest('/enc/open', port);
      assert.equal(unguarded.status, 200, '2. GET /enc/open still routes to the param handler');
      assert.deepEqual(JSON.parse(unguarded.body).id, 'open', '2. and the handler receives req.params.id === "open"');

      // 3. the shipped hooks are unchanged.
      const privateFailure = await rawRequest('/private/failure', port);
      assert.equal(privateFailure.status, 505, '3. GET /private/failure still answers with the auth hook status');

      const privateRestricted = await rawRequest('/private/restricted', port);
      assert.equal(privateRestricted.status, 403, '3. GET /private/restricted still answers 403 from the req.params.id clause of the same hook');

      // 4. #54's ACs still hold -- this fix is additive, not a replacement.
      const adminRoot = await rawRequest('/admin', port);
      assert.equal(adminRoot.status, 401, '4. GET /admin still reaches the auth hook and is denied');

      const adminSettings = await rawRequest('/admin/settings', port);
      assert.equal(adminSettings.status, 401, '4. GET /admin/settings still reaches the auth hook and is denied');

      const adminLegacy = await rawRequest('/admin/legacy/', port);
      assert.equal(adminLegacy.status, 200, '4. a route registered with a literal trailing slash still matches at its registered spelling');

      const applicationRoot = await rawRequest('/', port);
      assert.equal(applicationRoot.status, 200, '4. GET / still reaches the index-mounted route class');

      // 5. THE BREAKING CHANGE, asserted rather than only documented. This is
      // the fourth entry in the README's behaviour-change list and the only
      // shipped-fixture route whose status this fix moves: an over-encoded
      // unreserved byte in a param value used to route. Measured 200 before,
      // 404 after. It is asserted HERE, among the negative controls, so that
      // the cost of the fix is a committed number rather than a prose claim --
      // and so that anyone who later decides the cost is too high has to edit
      // an assertion rather than quietly relax the rule.
      const overEncodedParam = await rawRequest('/public/url-params/%61/b/c', port);
      assert.equal(overEncodedParam.status, 404, '5. BREAKING: GET /public/url-params/%61/b/c is now rejected (was 200) -- opt out with REST_CANONICAL_ENCODING=false');

      const canonicalParams = await rawRequest('/public/url-params/foo/bar/baz', port);
      assert.equal(canonicalParams.status, 200, '5. and the canonical spelling of the same route is untouched');
    });

    test('AC3 - false-deny control: reserved characters stay encodable', async function(assert) {
      const { port } = config.restServer;

      // GUARD against the fix's own hazard, and the assertion that rejects the
      // obvious wrong implementation. RFC 3986 requires a client to
      // percent-encode a RESERVED character it means literally, so rejecting
      // every triplet -- or comparing `decodeURIComponent(target)` against
      // `target` -- turns a legitimate request into a 404.
      //
      // Killed by mutation A (`decodeURIComponent(target) !== target` in place
      // of the unreserved-octet scan): measured `/enc/sec%2fret` -> 404.
      //
      // The router SPLITS then DECODES, so `sec%2fret` is ONE segment naming
      // the distinct id `sec/ret`. A consumer hook that decodes then splits
      // gets this wrong in the other direction -- that is why the sound
      // comparison is `req.params` and not any decoded path string.
      const encodedSlash = await rawRequest('/enc/sec%2fret', port);
      assert.equal(encodedSlash.status, 200, '1. GET /enc/sec%2fret is allowed -- %2f is a RESERVED character and must stay encodable');
      assert.deepEqual(JSON.parse(encodedSlash.body).id, 'sec/ret', '1. and the handler receives the decoded id "sec/ret"');

      const encodedSlashUpperHex = await rawRequest('/enc/sec%2Fret', port);
      assert.equal(encodedSlashUpperHex.status, 200, '1. GET /enc/sec%2Fret is allowed too -- hex-digit case does not change the octet');
      assert.deepEqual(JSON.parse(encodedSlashUpperHex.body).id, 'sec/ret', '1. and it names the SAME id, which is the residual #56 cannot close');

      const encodedPlus = await rawRequest('/enc/a%2Bb', port);
      assert.equal(encodedPlus.status, 200, '2. GET /enc/a%2Bb is allowed -- %2B is a RESERVED character and must stay encodable');
      assert.deepEqual(JSON.parse(encodedPlus.body).id, 'a+b', '2. and the handler receives the decoded id "a+b"');

      // 3. The QUERY STRING is stripped before the scan, not scanned. A query
      // string is a legitimately variable part of a request target and may
      // carry any encoding at all -- `?name=%61` is an ordinary request and
      // 404ing it would break every consumer that sends one. This is the
      // assertion that kills the `.split('?')[0]` removal; #54's own assertion
      // 2/8 pair cannot, because its targets are non-canonical either way.
      const encodedQuery = await rawRequest('/enc/x?name=%61', port);
      assert.equal(encodedQuery.status, 200, '3. GET /enc/x?name=%61 is allowed -- the query string is stripped before the scan');
      assert.deepEqual(JSON.parse(encodedQuery.body).id, 'x', '3. and the request reaches the param handler with id "x"');

      // 4. Malformed and over-long escapes are NOT this rule's business, and
      // the rule must not change what answers them. `router@2.2.0`'s
      // `decodeParam` (lib/layer.js:225) answers 400 for these DURING matching,
      // before any handler or hook runs -- measured identical before and after
      // this change. A 404 here would mean the rule had started answering for
      // them, which is a behaviour change nobody asked for; a 200 would mean
      // decoding had been weakened.
      const malformed = await rawRequest('/enc/%zz', port);
      assert.equal(malformed.status, 400, '4. GET /enc/%zz still answers 400 from the router decode, not 404 from this rule');

      const truncated = await rawRequest('/enc/%6', port);
      assert.equal(truncated.status, 400, '4. GET /enc/%6 (truncated triplet) still answers 400 from the router decode');

      const overlong = await rawRequest('/enc/%c1%a1', port);
      assert.equal(overlong.status, 400, '4. GET /enc/%c1%a1 (over-long UTF-8) still answers 400 from the router decode');
    });

    test('AC4 - express decodes exactly once, and so does the rule', async function(assert) {
      const { port } = config.restServer;

      // GUARD against the OTHER wrong implementation: decode until stable.
      // `%2573ecret` decodes ONCE to the literal id `%73ecret`, which is a
      // legitimate and DISTINCT record id. A loop-until-stable rule 404s it;
      // measured on a consumer hook written that way, `/loop/%2573ecret` was
      // false-denied at 401 while the router had routed to `%73ecret`.
      //
      // Killed by mutation A as well (whole-target decode): measured 404.
      const doubleEncoded = await rawRequest('/enc/%2573ecret', port);
      assert.equal(doubleEncoded.status, 200, '1. GET /enc/%2573ecret is allowed -- %25 is RESERVED, and one decode yields the distinct id "%73ecret"');
      assert.deepEqual(JSON.parse(doubleEncoded.body).id, '%73ecret', '1. and the handler receives the singly-decoded id "%73ecret", not "secret"');

      // Precondition making assertion 1 non-vacuous: the id it decodes to is
      // genuinely a different record from the guarded one, so allowing it is
      // correct rather than a hole.
      assert.notDeepEqual(JSON.parse(doubleEncoded.body).id, 'secret', '1. precondition: the singly-decoded id is NOT the guarded id, so this is a distinct record and not a bypass');
    });
  });

  module('/health', function(hooks) {
    test('Health check endpoint is configured automatically', async function(assert) {
      const response = await fetch(`${endpoint}/health`);

      assert.equal(response.status, 200);
    });
  });
});
