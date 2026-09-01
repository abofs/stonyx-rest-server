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
// added to a NEW file is caught too. "Tracked" is the limit and it is real:
// `git grep` does not see an untracked working-tree file, so an author who runs
// `pnpm test` before `git add` on a brand-new doc gets a green. At the merge
// gate everything is tracked, which is the state this test is written for.
//
// SCOPE OF THE BAN -- read before adding a phrasing here. Each pattern below is
// scoped to the specific CLAIM it was written to retire (the #54 mount-root
// edge, and the claim that only an express SETTING could reach it), not to the
// English it happens to be written in. An earlier version banned the bare
// substrings "remains ope" + "n" and "cannot be " + "closed" tree-wide, and
// that turned a guard aimed at an old DISHONEST claim into a guard against a
// new HONEST one: those are the natural words for disclosing the residual in
// abofs/stonyx-rest-server#56 (percent-encoding defeats param-route
// authorization). Assertions 1 and 2 below pin both directions -- the scoped
// patterns still match every claim they retired, and they do not match an
// honest new disclosure.
import QUnit from 'qunit';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { module, test } = QUnit;

// Assembled from fragments on purpose: this file is tracked, so a literal copy
// of any of these phrasings here would match itself and the assertion could
// never be satisfied -- which is exactly the failure mode the phrasings
// describe. Do not "tidy" these into string literals.
const CLOSED = 'cannot be ' + 'closed';
const NEVER_PASS = 'could never ' + 'pass';
const OPEN = 'remains ' + 'open';
const CLOSE_HERE = 'close it here';

// #56's fragments, assembled for the same reason as the four above: this file
// is tracked, so a literal copy of a retired phrasing here would be found by
// the ledger's own grep and assertion 3 could never be satisfied.
const LIVE = '**' + 'live**';
const TRACKED = 'tracked as ' + '#56';
const UNTIL_SHIPS = 'Until ' + '#56 ships';
const TRACKED_LINK = 'Tracked as ' + '[#56]';
const LIVE_RESIDUAL = 'live ' + 'residual';

// ERE for `git grep -E`, and also valid as a JS RegExp source so assertions 1
// and 2 can test the patterns themselves.
const STALE_CLAIM_PATTERNS = [
  `${CLOSED} by an? express|(mount[- ](root|segment)|/public/|this note|[Oo]ne edge).*${CLOSED}`,
  `(/public/|-> 404|→ 404).*${NEVER_PASS}`,
  `([Oo]ne edge|the edge|this edge|that edge).*${OPEN}`,
  `[Dd]o not ${CLOSE_HERE}`,

  // ---- retired by abofs/stonyx-rest-server#56 ------------------------------
  // SCOPED TO THE CLAIM, not to the English, and the scoping is tighter here
  // than it looks. What is banned is the PENDING framing -- "#56 has not
  // shipped yet", "the percent-encoding axis is open/live" -- which is false
  // the moment the fix lands. What is deliberately NOT banned is any statement
  // that a raw-path hook is still a live finding, because after #56 that is
  // TRUE for any id containing a reserved character, and assertion 2 pins that
  // it stays writable. An unscoped ban in this file already forbade a true
  // statement once (see the header); this is the same trap one issue later,
  // approached from the other side.
  `[Uu]ntil #56 ships`,
  `[Tt]racked as \\[?#56`,
  `([Pp]ercent-encod[a-z]*|fourth axis|encoded-path axis|[Tt]his axis) ${OPEN}`,
  `([Pp]ercent-encod[a-z]*|fourth axis)[^.]{0,90}(\\*\\*live\\*\\*|live residual|live bypass)`
];

// The claims the ledger retired, quoted from `origin/dev` @ f5c9a24 -- all 8
// hits the unscoped grep returned, across 5 files. Assertion 1 replays the
// scoped patterns against them, so narrowing the ban cannot silently disarm it.
const RETIRED_CLAIMS = [
  ['docs/agents/security-reviewer.md:25', `One edge ${OPEN} and ${CLOSED} by an express setting`],
  ['README.md:134', `This is the one edge that ${OPEN}, so do not read the section above as`],
  ['docs/project-structure.md:157', `the mount-root trailing slash \`/public/\` ${CLOSED} by an express`],
  ['docs/project-structure.md:160', `\`/public/\` → 404 ${NEVER_PASS}, and #50's integration AC2 asserts it stays`],
  ['src/route-matching.ts:69', `mount-segment trailing slash (\`/public/\`) ${CLOSED} by an express`],
  ['src/route-matching.ts:72', `asserting \`/public/\` -> 404 ${NEVER_PASS}.`],
  ['src/route-matching.ts:81', `close it here, and do not read this note as saying it ${CLOSED}.`],
  ['test/integration/rest-server-test.ts:295', `segment's trailing slash ${CLOSED} by an express setting -- for`]
] as const;

// The claims #56 retired, quoted from `dev` @ 224f3e2. Two of them came from
// this file's OWN honest-disclosure list, and that is the point worth carrying:
// a sentence written as an honest disclosure of an open defect becomes a stale
// claim the moment the defect is closed. A ledger whose fixtures are never
// revisited certifies last quarter's truth.
const RETIRED_CLAIMS_56 = [
  ['docs/agents/security-reviewer.md:25', `a fourth axis (percent-encoding) is ${LIVE}, see the residuals at the end`],
  ['docs/agents/security-reviewer.md:27', `${UNTIL_SHIPS}, treat "authorizes on originalUrl" and "req.path" as live findings`],
  ['docs/agents/security-reviewer.md:27', `${TRACKED_LINK}(https://github.com/abofs/stonyx-rest-server/issues/56) (priority-critical)`],
  ['README.md:204', `${TRACKED} - until it ships, do not read a param-segment route class as covered`],
  ['README.md:334', `while your hook compared %73ecret and did not match - unauthenticated 200. ${TRACKED}`],
  ['docs/project-structure.md:326', `Percent-encoding is not normalized on either side, and this one is a ${LIVE_RESIDUAL}`],
  ['test/unit/ledger-test.ts:69 (own fixture)', `Percent-encoding ${OPEN} on any route class with a param segment (#56).`],
  ['test/unit/ledger-test.ts:70 (own fixture)', `This axis ${OPEN}: express does not decode req.path either, so target === canonical.`],
  ['test/unit/ledger-test.ts:72 (own fixture)', `A residual ${OPEN} and ${CLOSED} without decoding both sides; ${TRACKED}.`]
] as const;

// Honest disclosures that must stay WRITABLE. Re-pointed by #56 at the residual
// that actually remains -- reserved characters, more than one spelling per
// decoded id, `req.params` as the sound comparison -- rather than at the axis
// #56 closed. None of these may match any pattern above.
//
// The second entry is the load-bearing one. It says a raw-path hook is STILL a
// live finding, which is true after #56 for any id containing a reserved
// character, and it is exactly the sentence an over-broad "no more live
// findings about encoding" ban would have eaten.
const HONEST_DISCLOSURES = [
  `The encoded-path axis ${CLOSED} by the raw-target comparison, by construction (#56).`,
  `A raw-path hook is still a live finding for any id containing a reserved character (#56).`,
  `Reserved characters must stay encodable, so one decoded id still has more than one accepted spelling.`,
  `req.params is the sound comparison; req.path and req.originalUrl are raw and always were.`,
  `Closed by canonicalEncoding (#56); the reserved-character residual below is not, and cannot be.`,
  `A residual ${OPEN} on the reserved-character axis and the module ${CLOSED} without 404ing legitimate encodings.`
];

// Anchored at the repository root so every path below is independent of the
// process cwd. `pnpm test` sets cwd to the package root, but nothing about this
// test should depend on that, and the previous version silently did.
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Returns the number of matching lines. `git grep` exits 1 with empty output
// when there are no matches, which execFileSync surfaces as a throw; any other
// non-zero status (bad pattern, not a repository) must propagate rather than be
// swallowed as a zero, or this whole test becomes vacuous.
//
// The pathspec is `:/` -- git's "root of the working tree" magic -- NOT `.`.
// `.` is resolved relative to the process cwd, so from `<repo>/test` the grep
// searched only the test subtree: every pattern below returned 0 while
// README.md, docs/ and src/ were never read, and the positive control still
// passed because 15 of its hits live under test/. Measured. Do not change it
// back to `.`.
function gitGrepCount(pattern: string): number {
  try {
    const stdout = execFileSync('git', ['grep', '-nE', pattern, '--', ':/'], { encoding: 'utf8', cwd: REPO_ROOT });
    return stdout.split('\n').filter(Boolean).length;
  } catch (error) {
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status === 1 && !stdout) return 0;
    throw error;
  }
}

// Same grep, reporting the FILES that matched, so the positive control can
// assert scope rather than mere execution.
function gitGrepFiles(pattern: string): string[] {
  try {
    const stdout = execFileSync('git', ['grep', '-lE', pattern, '--', ':/'], { encoding: 'utf8', cwd: REPO_ROOT });
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    const { status, stdout } = error as { status?: number; stdout?: string };
    if (status === 1 && !stdout) return [];
    throw error;
  }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

module('[Acceptance] Tripwire ledger (#54)', function() {
  test('AC3 - no artifact still pins /public/ -> 200 or calls the #54 edge unclosable', function(assert) {
    // 0. POSITIVE CONTROL, and the reason the zeroes below are not vacuous.
    // A mistyped pattern or a `git grep` that cannot see the tree produces 0
    // for every pattern. This asserts the same machinery finds something that
    // must exist on this branch, so a zero means "absent", not "did not run".
    // It is deliberately anchored OUTSIDE test/: the earlier control matched
    // `canonicalRoutes` anywhere, and 15 of its 35 hits were inside the very
    // subtree a wrong cwd would have confined the grep to, so it proved
    // execution but not scope. `:/` in gitGrepCount() is what makes the scope
    // cwd-independent; this asserts the scope rather than assuming it.
    assert.ok(gitGrepCount('canonicalRoutes') > 0, '0. positive control: the same git grep finds `canonicalRoutes`, so a zero below means absent and not broken');
    const controlFiles = gitGrepFiles('canonicalRoutes');
    assert.ok(controlFiles.some(file => !file.startsWith('test/')), `0. positive control: the same grep matches OUTSIDE test/ (${controlFiles.filter(file => !file.startsWith('test/')).join(', ')}), so it proves the grep's SCOPE and not merely that it ran`);

    // 1. The ban is scoped to the claims it retired, and the scoping did not
    // disarm it: every one of the 8 hits the unscoped grep returned on
    // origin/dev @ f5c9a24 is still matched by one of the scoped patterns.
    for (const [origin, claim] of RETIRED_CLAIMS) {
      const matched = STALE_CLAIM_PATTERNS.some(pattern => new RegExp(pattern).test(claim));
      assert.ok(matched, `1. the scoped patterns still catch the retired claim from ${origin}`);
    }

    // 1b. Same for the claims #56 retired, including the three this file
    // carried as its OWN honest-disclosure fixtures until #56 shipped.
    for (const [origin, claim] of RETIRED_CLAIMS_56) {
      const matched = STALE_CLAIM_PATTERNS.some(pattern => new RegExp(pattern).test(claim));
      assert.ok(matched, `1b. the scoped patterns catch the claim #56 retired, from ${origin}`);
    }

    // 2. ...and the scoping achieved what it was narrowed for: an honest
    // disclosure of the residual that ACTUALLY remains is writable without
    // tripping the ledger. This is the assertion that keeps a future engineer
    // from softening a real limitation to get a green suite -- and after #56 it
    // has teeth in the opposite direction too: entry 2 asserts that calling a
    // raw-path hook a live finding stays writable, because for an id containing
    // a reserved character that is still TRUE.
    for (const disclosure of HONEST_DISCLOSURES) {
      const matched = STALE_CLAIM_PATTERNS.filter(pattern => new RegExp(pattern).test(disclosure));
      assert.deepEqual(matched, [], `2. an honest #56 disclosure is not banned: "${disclosure}"`);
    }

    // 3. Each retired claim's pattern individually, for a readable failure. On
    // `origin/dev` @ f5c9a24 the unscoped combined pattern returned 8 hits
    // across 5 files: README.md, docs/agents/security-reviewer.md,
    // docs/project-structure.md (x2), src/route-matching.ts (x3),
    // test/integration/rest-server-test.ts.
    for (const pattern of STALE_CLAIM_PATTERNS) {
      assert.equal(gitGrepCount(pattern), 0, `3. no tracked artifact still makes the retired claim /${pattern}/`);
    }

    // 4. The combined pattern, as one grep.
    assert.equal(gitGrepCount(STALE_CLAIM_PATTERNS.join('|')), 0, '4. the ledger grep returns 0 hits (was 8 across 5 files on origin/dev)');

    // 5. The security-reviewer brief is the highest-leverage item in the
    // ledger -- it is what every future security review loads. Left stale it
    // tells the next reviewer this work is still pending.
    const securityBrief = readRepoFile('docs/agents/security-reviewer.md');
    assert.ok(securityBrief.includes('canonicalRoutes'), '5. the security-reviewer brief names canonicalRoutes');
    assert.ok(securityBrief.includes('post-#54'), '5. the security-reviewer brief records #54 as shipped, not pending');
    assert.ok(securityBrief.includes("next('router')"), '5. the security-reviewer brief flags a rejection that is not next(\'router\')');
    assert.ok(securityBrief.includes('if (this.auth)'), '5. the security-reviewer brief flags the check being gated on the auth hook');
    assert.ok(securityBrief.includes('REST_CANONICAL_ROUTES=false'), '5. the security-reviewer brief names the opt-out as re-opening the bypass');

    // 6. The README must document BOTH vectors. The absolute-form one is the
    // one a consumer will not anticipate and the one with the larger blast
    // radius, so naming only the trailing slash is a documentation defect.
    const readme = readRepoFile('README.md');
    assert.ok(readme.includes('REST_CANONICAL_ROUTES'), '6. the README names the opt-out env var');
    assert.ok(readme.includes('absolute-form'), '6. the README documents the absolute-form request target vector');
    assert.ok(readme.includes('mount root'), '6. the README documents the mount-root trailing slash vector');

    // 7. The mutation-table row must be RE-SCOPED, not deleted. The
    // settings-level fact it records stays true and is still the reason
    // applyRouteMatching() is not the fix site.
    const projectStructure = readRepoFile('docs/project-structure.md');
    assert.ok(projectStructure.includes('| `/public/` (mount root) | 200 | 200 | 200 | 200 |'), '7. the #50 mutation-table row is preserved, not deleted');
    assert.ok(projectStructure.includes('scoped to the two SETTINGS'), '7. and it is explicitly re-scoped to the settings rather than left as end-to-end behaviour');
    assert.ok(projectStructure.includes('canonicalRoutes'), '7. docs/project-structure.md documents the new key');

    // 8. THE WEAK HALF, KEPT AND LABELLED RATHER THAN PRESENTED AS COVERAGE.
    //
    // These three assert the substring `#56` is present. Written before #56
    // shipped, they were meant to guarantee the residual stayed disclosed. They
    // cannot: `#56` still appears in all three artifacts after the fix, in the
    // behaviour-change list and the config table, so they stay green whether
    // the residual is honestly disclosed OR falsely announced closed. They red
    // only under total deletion of every mention -- the `AC10` comment-out
    // shape from docs/framework/testing.md, one file over.
    //
    // They are kept because a total deletion IS worth catching and nothing else
    // catches it. What they are not is evidence about the residual; assertion 9
    // is. Do not read this block as covering what 9 covers.
    assert.ok(securityBrief.includes('#56'), '8. the security-reviewer brief mentions #56 at all (weak: true both before and after the fix)');
    assert.ok(readme.includes('#56'), '8. the README mentions #56 at all (weak: true both before and after the fix)');
    assert.ok(projectStructure.includes('#56'), '8. docs/project-structure.md mentions #56 at all (weak: true both before and after the fix)');

    // 9. THE ASSERTION THAT CAN ACTUALLY FAIL. #56's residual is not the
    // percent-encoding axis -- that is closed -- it is that RESERVED characters
    // must stay encodable, so one decoded id still has more than one accepted
    // spelling and a raw-path comparison remains unsound for it.
    //
    // Each artifact must carry BOTH halves: the measurement (`a%2Bb`, the two
    // spellings of the id `a+b`) and the remedy (`req.params`). An artifact
    // that quietly announces the class closed loses the first; one that states
    // the limitation without the fix loses the second. `#56` alone loses
    // neither and that is exactly why assertion 8 cannot see either.
    const RESIDUAL_ARTIFACTS = [
      ['README.md', readme],
      ['docs/project-structure.md', projectStructure],
      ['docs/agents/security-reviewer.md', securityBrief]
    ] as const;

    for (const [name, contents] of RESIDUAL_ARTIFACTS) {
      assert.ok(contents.includes('a%2Bb'), `9. ${name} carries the measured two-spellings-one-id example (a+b / a%2Bb) rather than announcing the class closed`);
      assert.ok(contents.includes('req.params'), `9. ${name} names req.params as the sound comparison, not just the limitation`);
      assert.ok(contents.includes('reserved'), `9. ${name} names RESERVED characters as what keeps the residual open`);
    }

    // 10. The opt-out must be LOUD, not inherited silently -- stonyx#95's
    // defect. `REST_CANONICAL_ENCODING=false` re-opens a security hole, so the
    // two artifacts a consumer and a reviewer actually read must both name it.
    assert.ok(readme.includes('REST_CANONICAL_ENCODING=false'), '10. the README names REST_CANONICAL_ENCODING=false as re-opening the bypass');
    assert.ok(securityBrief.includes('REST_CANONICAL_ENCODING=false'), '10. the security-reviewer brief names REST_CANONICAL_ENCODING=false as re-opening the bypass');
    assert.ok(projectStructure.includes('REST_CANONICAL_ENCODING=false'), '10. docs/project-structure.md names the opt-out env var');
    assert.ok(securityBrief.includes('post-#56'), '10. the security-reviewer brief records #56 as SHIPPED, not pending');
    assert.ok(securityBrief.includes('shouldRejectEncoding()'), '10. and names the predicate, so a reviewer can find the control it is reviewing');
  });
});
