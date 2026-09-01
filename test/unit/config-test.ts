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

// Strips comments so assertion 4 asserts about CODE rather than about prose.
//
// This is the fix for a measured false red, not a tidy-up. Assertion 4
// substring-matched the whole file, and `config/environment.js` invites a
// back-pointer comment into `test/config/environment.ts` FOUR times ("do not
// 'fix' this as part of #43", once per key). Measured on the #56 branch head:
// appending the single line
//
//   // canonicalEncoding is deliberately NOT pinned here -- see config/environment.js
//
// to `test/config/environment.ts` reported 40 pass / 1 fail, the failure being
// AC7 assertion 4 claiming a pin that does not exist. A guard that reds when
// someone writes down WHY a key is unpinned is a guard that teaches people not
// to write it down. `docs/framework/testing.md`: "a guard that reads raw source
// must normalise before asserting".
//
// Block comments first, then whole-line `//`, then trailing `//`. The trailing
// case requires whitespace before the `//` so a `//` that is glued to the
// character before it -- inside a path literal, a string, a `://` -- is left
// alone. The file legitimately contains path literals.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/[ \t]+\/\/.*$/gm, '');
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
    //
    // Asserted against the COMMENT-STRIPPED source. A pin is code; a
    // back-pointer explaining why the key is unpinned is prose, and
    // `config/environment.js` asks for exactly that prose four times. See
    // stripComments() above for the measurement that forced this.
    const testEnvironmentRaw = readRepoFile('test/config/environment.ts');
    const testEnvironment = stripComments(testEnvironmentRaw);
    for (const key of ROUTE_MATCHING_KEYS) {
      assert.notOk(testEnvironment.includes(key), `4. ${key} is NOT pinned in test/config/environment.ts — pinning it hides an inverted shipped default (#43)`);
    }

    // 4b. POSITIVE CONTROL FOR THE NORMALISATION ITSELF, and the reason 4 is
    // not now vacuous in the other direction. A stripComments() that returned
    // '' -- or that ate the code as well as the comments -- would satisfy every
    // `notOk` above for the wrong reason. This probe carries a pin and a
    // back-pointer naming the same key in all three comment shapes, and asserts
    // the two are told apart.
    //
    // The `marker: 'a//b'` value is the probe for the trailing-comment rule. It
    // is deliberately NOT a URL: `js/incomplete-url-substring-sanitization`
    // reads a `.includes()` of a URL-shaped literal as an incomplete host
    // check and reports it at high severity, and a red CodeQL run on a test
    // fixture is a red CodeQL run. The property under test is only that a `//`
    // with no whitespace before it survives stripping, and `a//b` carries that
    // exactly as well as a URL did. Do not put a URL back here.
    const NORMALISATION_PROBE = [
      '/* canonicalRoutes lives in config/environment.js */',
      '// canonicalEncoding is deliberately NOT pinned here -- see config/environment.js',
      "const config = { restServer: { dir: './test/sample/requests', marker: 'a//b' } }; // strictRoutes stays unpinned too",
      '// caseSensitiveRoutes likewise'
    ].join('\n');
    const normalisedProbe = stripComments(NORMALISATION_PROBE);
    for (const key of ROUTE_MATCHING_KEYS) {
      assert.notOk(normalisedProbe.includes(key), `4b. normalisation control: a COMMENT naming ${key} is stripped, so assertion 4 cannot false-red on a back-pointer`);
    }
    assert.ok(normalisedProbe.includes('dir'), '4b. normalisation control: the CODE survives stripping, so assertion 4 would still see a real pin');
    assert.ok(normalisedProbe.includes("'a//b'"), '4b. normalisation control: a `//` inside a string literal is not eaten as a trailing comment (the trailing rule requires whitespace before the `//`)');
    assert.ok(stripComments('const canonicalEncoding = true;').includes('canonicalEncoding'), '4b. normalisation control: a bare pin with no comment at all is untouched');

    // 5. POSITIVE CONTROL for assertion 4, and the reason its four `notOk`s are
    // not vacuous. A typo in the path, a moved file, or a `readRepoFile` that
    // silently returned '' would satisfy every assertion above. `dir` IS pinned
    // in that file, so this proves the same read reaches the same content --
    // asserted on the STRIPPED text, so it also proves stripping did not empty
    // the real file.
    assert.ok(testEnvironment.includes('dir'), '5. positive control: the same read of test/config/environment.ts DOES find the `dir` pin, so the four absences above mean absent and not unread');
    assert.ok(testEnvironmentRaw.length > testEnvironment.length, '5. positive control: test/config/environment.ts does carry comments, so stripComments() had something to do and the assertions above are about its code');
  });
});
