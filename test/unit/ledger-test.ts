// Acceptance anchor for abofs/stonyx-rest-server#54, AC3.
//
// #50 shipped `GET /public/` -> 200 as a documented invariant across 16
// artifacts, several of which instruct the reader that the edge is not
// closable. #54 changes that behaviour, so every one of those has to move in
// the same change. Most of them are prose and fail only under review; this test
// turns the prose half into something the suite itself can falsify.
//
// The grep is deliberately the one named in the refinement, run against the
// tracked tree rather than a hand-maintained file list, so a stale phrasing
// added to a NEW file is caught too.
import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { module, test } = QUnit;

// Assembled from fragments on purpose: this file is tracked, so a literal copy
// of any of these phrasings here would match itself and the assertion could
// never pass -- which is exactly the failure mode the phrasings describe.
// Do not "tidy" these into string literals.
const STALE_PHRASINGS = [
  'cannot be ' + 'closed',
  'could never ' + 'pass',
  'remains ' + 'open',
  'Do not ' + 'close it here'
];

// Returns the number of matching lines. `git grep` exits 1 with empty output
// when there are no matches, which execFileSync surfaces as a throw; any other
// non-zero status (bad pattern, not a repository) must propagate rather than be
// swallowed as a zero, or this whole test becomes vacuous.
function gitGrepCount(pattern: string): number {
  try {
    const stdout = execFileSync('git', ['grep', '-nE', pattern, '--', '.'], { encoding: 'utf8' });
    return stdout.split('\n').filter(Boolean).length;
  } catch (error) {
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status === 1 && !stdout) return 0;
    throw error;
  }
}

module('[Acceptance] Tripwire ledger (#54)', function() {
  test('AC3 - no artifact still pins /public/ -> 200 or calls the edge unclosable', function(assert) {
    // 0. POSITIVE CONTROL, and the reason the zeroes below are not vacuous.
    // A mistyped pattern, a wrong cwd, or a `git grep` that cannot see the tree
    // all produce 0 for every pattern. This asserts the same machinery finds
    // something that must exist on this branch, so a zero means "absent", not
    // "the grep did not run".
    assert.ok(gitGrepCount('canonicalRoutes') > 0, '0. positive control: the same git grep finds `canonicalRoutes`, so a zero below means absent and not broken');

    // 1. Each stale phrasing individually, for a readable failure. On
    // `origin/dev` @ f5c9a24 the combined pattern returned 8 hits across 5
    // files: README.md, docs/agents/security-reviewer.md,
    // docs/project-structure.md (x2), src/route-matching.ts (x3),
    // test/integration/rest-server-test.ts.
    for (const phrasing of STALE_PHRASINGS) {
      assert.equal(gitGrepCount(phrasing), 0, `1. no tracked artifact still says "${phrasing}"`);
    }

    // 2. The combined pattern from the refinement, verbatim in behaviour.
    assert.equal(gitGrepCount(STALE_PHRASINGS.join('|')), 0, '2. the refinement ledger grep returns 0 hits (was 8 across 5 files on origin/dev)');

    // 3. The security-reviewer brief is the highest-leverage item in the
    // ledger -- it is what every future security review loads. Left stale it
    // tells the next reviewer this work is still pending.
    const securityBrief = readFileSync('docs/agents/security-reviewer.md', 'utf8');
    assert.ok(securityBrief.includes('canonicalRoutes'), '3. the security-reviewer brief names canonicalRoutes');
    assert.ok(securityBrief.includes('post-#54'), '3. the security-reviewer brief records #54 as shipped, not pending');
    assert.ok(securityBrief.includes("next('router')"), '3. the security-reviewer brief flags a rejection that is not next(\'router\')');
    assert.ok(securityBrief.includes('if (this.auth)'), '3. the security-reviewer brief flags the check being gated on the auth hook');
    assert.ok(securityBrief.includes('REST_CANONICAL_ROUTES=false'), '3. the security-reviewer brief names the opt-out as re-opening the bypass');

    // 4. The README must document BOTH vectors. The absolute-form one is the
    // one a consumer will not anticipate and the one with the larger blast
    // radius, so naming only the trailing slash is a documentation defect.
    const readme = readFileSync('README.md', 'utf8');
    assert.ok(readme.includes('REST_CANONICAL_ROUTES'), '4. the README names the opt-out env var');
    assert.ok(readme.includes('absolute-form'), '4. the README documents the absolute-form request target vector');
    assert.ok(readme.includes('mount root'), '4. the README documents the mount-root trailing slash vector');

    // 5. The mutation-table row must be RE-SCOPED, not deleted. The
    // settings-level fact it records stays true and is still the reason
    // applyRouteMatching() is not the fix site.
    const projectStructure = readFileSync('docs/project-structure.md', 'utf8');
    assert.ok(projectStructure.includes('| `/public/` (mount root) | 200 | 200 | 200 | 200 |'), '5. the #50 mutation-table row is preserved, not deleted');
    assert.ok(projectStructure.includes('scoped to the two SETTINGS'), '5. and it is explicitly re-scoped to the settings rather than left as end-to-end behaviour');
    assert.ok(projectStructure.includes('canonicalRoutes'), '5. docs/project-structure.md documents the new key');
  });
});
