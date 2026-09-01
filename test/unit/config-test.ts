// Acceptance anchor for abofs/stonyx-rest-server#56, AC7 — the shipped default
// of `canonicalEncoding` stays LIVE, and stays UNPINNED.
//
// This file exists because those are two different properties and only one of
// them is obvious.
//
// The obvious half: the published `config/environment.js` must default the new
// key to the secure direction. Asserting that from the RESOLVED config rather
// than from the source text is the point — a value that is written in the file
// and never reaches `config.restServer` is a value nobody has.
//
// The counterintuitive half, and the reason this is an AC rather than a habit:
// the key must NOT be pinned in `test/config/environment.ts`, even though
// `docs/framework/testing.md` and abofs/stonyx-rest-server#43 both push toward
// pinning every key the config reads. Measured for all three sibling keys and
// re-measured here for this one: pinning the key AND inverting the shipped
// default reports a FULLY GREEN suite, because the pin supplies the secure
// value the suite then observes and the insecure published default becomes
// completely invisible. The pin is quieter AND weaker than no pin.
//
// The cost of leaving it unpinned is that the suite is ambient-sensitive:
// `REST_CANONICAL_ENCODING=false pnpm test` turns assertions red. That is the
// intended trade — it fails LOUDLY, so there is no false green.
import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import config from 'stonyx/config';

const { module, test } = QUnit;

// Anchored at the repository root so every path below is independent of the
// process cwd — the same defect `test/unit/ledger-test.ts` records having
// shipped once with a cwd-relative pathspec.
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

// The four security-relevant route-matching keys, all defaulting on, all
// disable-able. Reviewed as a SET rather than key by key: `docs/framework/testing.md`
// records that a pinned set has to be evaluated together, because a pin that is
// individually reasonable can make a different unpinned value dangerous.
const ROUTE_MATCHING_KEYS = ['caseSensitiveRoutes', 'strictRoutes', 'canonicalRoutes', 'canonicalEncoding'] as const;

module('[Unit] Config', function() {
  test('AC7 — the canonicalEncoding default ships secure and is deliberately unpinned', function(assert) {
    // 1. THE EFFECT, not the source text. This is the assertion that carries
    // the shipped default: invert `config/environment.js` to
    // `REST_CANONICAL_ENCODING === 'true'` and this turns red, and so do the
    // integration ACs. Delete the line entirely and this reads `undefined` and
    // turns red on its own.
    assert.strictEqual(config.restServer.canonicalEncoding, true, '1. the resolved config carries canonicalEncoding === true, so the shipped default reaches consumers');

    // 2. ...and all four route-matching keys resolve to the secure direction
    // together. Asserted as a SET: this is the check that notices a NEW sibling
    // arriving with an insecure default, which a per-key assertion cannot.
    const resolved = ROUTE_MATCHING_KEYS.map(key => [key, config.restServer[key]] as const);
    assert.deepEqual(
      resolved,
      [['caseSensitiveRoutes', true], ['strictRoutes', true], ['canonicalRoutes', true], ['canonicalEncoding', true]],
      '2. all four route-matching keys resolve to the secure direction'
    );

    // 3. The source reads the documented environment variable with the
    // documented polarity. This is NOT redundant with 1: assertion 1 would stay
    // green if the key were hard-coded to `true` with no env read at all, which
    // would silently delete the opt-out the README promises as the remediation
    // for the breaking change.
    const environment = readRepoFile('config/environment.js');
    assert.ok(environment.includes('REST_CANONICAL_ENCODING'), '3. config/environment.js reads REST_CANONICAL_ENCODING');
    assert.ok(
      environment.includes("canonicalEncoding: REST_CANONICAL_ENCODING !== 'false'"),
      "3. and it uses the `!== 'false'` polarity, so the opt-out exists and any other value stays secure"
    );

    // 4. The key is NOT pinned in the test config, matching its three siblings.
    // Evaluated as a set: pinning ANY of the four re-creates the trap for that
    // key, so the assertion is on the whole family rather than on the new one.
    const testEnvironment = readRepoFile('test/config/environment.ts');
    for (const key of ROUTE_MATCHING_KEYS) {
      assert.notOk(testEnvironment.includes(key), `4. ${key} is NOT pinned in test/config/environment.ts — pinning it hides an inverted shipped default (#43)`);
    }

    // 5. POSITIVE CONTROL for assertion 4, and the reason its four `notOk`s are
    // not vacuous. A typo in the path, a moved file, or a `readRepoFile` that
    // silently returned '' would satisfy every assertion above. `dir` IS pinned
    // in that file, so this proves the same read reaches the same content.
    assert.ok(testEnvironment.includes('dir'), '5. positive control: the same read of test/config/environment.ts DOES find the `dir` pin, so the four absences above mean absent and not unread');
  });
});
