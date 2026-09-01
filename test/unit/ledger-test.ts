// Acceptance anchor for abofs/stonyx-rest-server#54 AC3 AND #56 AC8.
//
// Both issues are named because both are anchored here and every AC in this
// repo is meant to be discoverable by test title. #54's AC3 is assertions 0-7;
// #56's AC8 is assertions 1b, 1c, 9 and 10 (8 is the labelled weak half of 9).
// The module and test titles below carry both, so `grep "AC8" test/` finds this
// file.
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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// A WORD BOUNDARY THAT SURVIVES BOTH ENGINES. Do not write `\b` here.
//
// Every pattern in this file is handed to TWO regex engines: JS `RegExp` in
// assertions 1/1b/1c/2, and `git grep -E` in assertions 3/4. Apple git's ERE
// treats a backslash followed by an ALPHANUMERIC as that literal character
// rather than as a Perl class, and it does not error. Measured on git 2.50.1
// (Apple Git-155), each against a fixture file:
//
//   `is safe\b`     matches the line `the hook is safeb`   -- i.e. `\b` -> `b`
//   `is\ssafe`      matches the line `isssafe`             -- i.e. `\s` -> `s`
//   `canonical\w`   matches the line `canonicalw`          -- i.e. `\w` -> `w`
//   `AC\d`          matches the line `ACd`                 -- i.e. `\d` -> `d`
//
// Tree-wide on this branch at fe2a451, `git grep -cE 'is safe\b' -- :/`
// returned 0 files while `git grep -cE 'is safe' -- :/` returned 2. GNU git,
// which is what CI runs, applies the word boundary and returns 1. That single
// difference is why PR #58 accumulated eleven green local runs and a red CI on
// the identical SHA: the one pattern that ended in `\b` was searching for a
// string ending in a literal `b`, found nothing, and the ledger read the zero
// as "the claim is absent". Assertion 0c is the control that now makes that
// disagreement red instead of green.
//
// `[^A-Za-z0-9_]|$` is the portable spelling and is what `\b` means at the END
// of a match: either a non-word character follows, or the line ends. Both
// halves are plain POSIX ERE, supported by JS and by both gits. The `|$` branch
// is the one worth naming: if some engine were to treat `$` inside a group as a
// literal dollar sign, this pattern would degrade to "requires a following
// delimiter" -- NARROWER, not vacuous, which is the safe direction to fail in.
// Measured here anyway, and 0c pins it: the probe corpus carries a line whose
// last characters are the match itself, so a lost `$` reds.
//
// Backslash + PUNCTUATION is fine and is left alone: `\[` (line below), `\*`
// and `\.` were each measured to behave as literal-character escapes under this
// same git -- `req\.path` matches `req.path` and does NOT match `reqXpath`.
// The hazard is specific to backslash + alphanumeric.
const WORD_END = '([^A-Za-z0-9_]|$)';

// ERE for `git grep -E`, and also valid as a JS RegExp source so assertions 1
// and 2 can test the patterns themselves. Every construct used below must be
// expressible in BOTH engines; assertion 0c enforces that rather than trusting
// it.
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
  // TRUE for any id carrying an octet outside `[A-Za-z0-9-._~]` that keeps
  // more than one accepted spelling -- every reserved character, every
  // non-ASCII byte and every control octet whose hex carries a letter digit --
  // and assertion 2 pins that it stays writable. An unscoped ban in this file
  // already forbade a true statement once (see the header); this is the same
  // trap one issue later, approached from the other side.
  `[Uu]ntil #56 ships`,
  `[Tt]racked as \\[?#56`,
  `([Pp]ercent-encod[a-z]*|fourth axis|encoded-path axis|[Tt]his axis) ${OPEN}`,
  `([Pp]ercent-encod[a-z]*|fourth axis)[^.]{0,90}(\\*\\*live\\*\\*|live residual|live bypass)`
];

// ---------------------------------------------------------------------------
// THE OTHER DIRECTION (#58 fix round, docs/framework/testing.md Rule 5).
//
// Every pattern above bans the PENDING framing -- the "tracked as", "until it
// ships", "still unclosed" family. An author who falsely announces the class
// CLOSED uses the opposite words, so none of those patterns can see them. The
// exact sentences are NOT quoted in this comment: this file is tracked, and a
// literal copy here would be found by the ledger's own grep and assertion 3
// could never be satisfied. They are in FALSE_CLOSURES below, assembled from
// fragments. Measured on this branch before these patterns existed, both at
// 41 pass / 0 fail:
//
//   (a) comment out the honest residual AND replace its heading with a
//       "the axis needs no further care" claim  -> green (FALSE_CLOSURES[0])
//   (b) ADD a false "the residual was dealt with in #56" sentence, removing
//       nothing                                 -> green (FALSE_CLOSURES[1])
//
// Rule 4 (over-reach) is loud when it fires; Rule 5 (under-reach) is silent.
// These patterns are the Rule 5 half.
//
// WHAT THEY ARE, AT THEIR ACTUAL STRENGTH: a TRIPWIRE for the phrasings
// enumerated in FALSE_CLOSURES below, not a ban on the claim. Each pattern is
// scoped to a subject that makes the claim false in this repo by construction
// -- an encoding axis needing no further care, a RAW path string being a
// sufficient comparison, #54/#56's own residual being disposed of -- and that
// scoping is deliberate. But each ALSO requires one of a short list of verbs
// ("fully handled", "is now safe", "RESOLVED in #56"), and plain English has
// many more. MEASURED, against 15 natural rephrasings of those same three
// claim-shapes: 3 caught (the three pinned in FALSE_CLOSURES), 12 escaped --
// including "The encoding axis needs no further care after #56", which is the
// first of the three claim-shapes above written out in ordinary words. An
// author who wants to announce a false closure can do it without tripping this.
//
// It is kept, and it is deliberately NOT widened. Widening it to the bare words
// "closed", "resolved", "handled" or "no longer applies" is the Rule 4
// over-reach this file already committed once (see the header) and declined
// again in the REJECTED note below -- those words appear honestly all over this
// repo. A tripwire on the phrasings a copy-edit would most plausibly reach for
// is worth having on its own terms. Catching the other twelve is REVIEW's job,
// not this test's, and this comment does not claim otherwise. FALSE_CLOSURES is
// the enumeration the tripwire actually holds for, written down so a future
// narrowing has a fixture to fail against.
//
// Both directions are pinned: assertion 1c replays these against the false
// closures below, and assertion 2 replays the WHOLE ban (stale + false-closure)
// against the honest disclosures, so neither half can be disarmed silently.
const FALSE_CLOSURE_PATTERNS = [
  `([Pp]ercent-encod[a-z]*|encoded-path axis|fourth axis|encoding (class|axis))[^.]{0,80}((fully|completely|entirely) (handled|closed|resolved|covered|addressed)|no residual|nothing remains)`,
  `(raw[- ]path hook|raw path string|a hook comparing[^.]{0,40}raw|req\\.path|req\\.originalUrl)[^.]{0,50} (is|are) (now |already )?(safe|sound|sufficient|adequate|reliable)${WORD_END}`,
  `(residual|limitation|finding|bypass)[^.]{0,60}(was |is |now )?(RESOLVED|[Rr]esolved)( in| by)? #5[46]`
];

// REJECTED, and recorded rather than silently omitted: a fourth pattern banning
// `(residual|limitation)[^.]{0,60}no longer (applies|exists|holds)` tree-wide.
// It catches FALSE_CLOSURES[4], but so does the second pattern above, and
// unscoped it is a Rule 4 over-reach waiting to happen -- "this limitation no
// longer applies" is a TRUE sentence to write about some future residual that
// really was closed, and this file has already banned a true statement once
// (see the header). Each pattern that survived names a subject that makes the
// claim false in this repo by construction: an encoding axis needing no further
// care, a RAW path string being a sufficient comparison, or #54/#56's own
// residual being disposed of by #54/#56.

// Everything the ledger greps for, in one place. Assertion 2 uses this rather
// than STALE_CLAIM_PATTERNS alone, so an honest disclosure has to survive BOTH
// halves of the ban -- which is the pair of failure modes Rule 4 and Rule 5
// describe, and testing only one is how a guard ends up with a comment more
// confident than its coverage.
const BANNED_PATTERNS = [...STALE_CLAIM_PATTERNS, ...FALSE_CLOSURE_PATTERNS];

// Fragments again, and for the same reason as every other fragment in this
// file: a literal copy of a false-closure sentence here would be found by the
// ledger's own grep and assertion 3 could never be satisfied.
const FULLY_HANDLED = 'fully ' + 'handled';
const HOOK_IS_SAFE = 'hook is ' + 'safe';
const HOOK_IS_SOUND = 'hook is ' + 'sound';
const RESOLVED_IN_56 = 'RESOLVED in ' + '#56';
const NOTHING_REMAINS = 'nothing ' + 'remains';
const NOW_SAFE = 'is now ' + 'safe';
const NO_LONGER_APPLIES = 'no longer ' + 'applies';

// The false closures the tripwire holds for -- the enumeration, not the claim
// (12 of 15 natural rephrasings escape; see the FALSE_CLOSURE_PATTERNS
// comment). Written down explicitly rather than left to the patterns, so a
// future narrowing of the patterns has a fixture to fail against -- the exact
// service RETIRED_CLAIMS does for the stale-claim half. The first two are the
// tampers measured green above.
const FALSE_CLOSURES = [
  `Percent-encoding is ${FULLY_HANDLED}; a raw-path ${HOOK_IS_SAFE}.`,
  `The reserved-character residual was ${RESOLVED_IN_56}, so ${NOTHING_REMAINS}.`,
  `#56 closes the encoding class and ${NOTHING_REMAINS} on this axis.`,
  `After #56 a raw-path ${HOOK_IS_SOUND} on every route class.`,
  `req.path ${NOW_SAFE} to compare, so this limitation ${NO_LONGER_APPLIES}.`
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

// The claims #56 retired, quoted from `dev` @ 224f3e2. Three of them came from
// this file's OWN honest-disclosure list -- three of the four it carried there
// -- and that is the point worth carrying:
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
// that actually remains -- every octet outside `A-Za-z0-9-._~` keeps at least
// one encoded spelling, so more than one raw target names one decoded id, and
// `req.params` is the sound comparison -- rather than at the axis #56 closed.
// None of these may match any pattern in BANNED_PATTERNS.
//
// The second entry is the load-bearing one. It says a raw-path hook is STILL a
// live finding, which is true after #56, and it is exactly the sentence an
// over-broad "no more live findings about encoding" ban would have eaten.
//
// SCOPE CORRECTED IN #58's FIX ROUND. Entry 2 used to read "for any id
// containing a reserved character". Measured false, and narrower than
// `src/route-matching.ts` -- which already says "every non-ASCII octet" and is
// the copy that was right. An octet outside `[A-Za-z0-9-._~]` keeps more than
// one accepted spelling when its hex carries a letter digit or when a client
// may also send it literally, so the class is every reserved character AND
// every non-ASCII byte AND every control octet whose hex carries a letter
// digit. NOT the whole complement of the unreserved set, and the second fix
// round narrowed it back to this: `%21`/`%40` alias literal-versus-encoded and
// not by hex case, `%00`/`%09` have exactly one accepted spelling, and `%90` is
// a 400. Measured through a real listener on a deny list holding no reserved
// character at all:
// `GET /i18n/caf%C3%A9` -> 401 while `GET /i18n/caf%c3%a9` -> 200 id "café";
// `GET /i18n/%E5%8C%97%E4%BA%AC` -> 401 while the lowercase-hex spelling
// -> 200; `GET /i18n/a%0Db` -> 401 while `GET /i18n/a%0db` -> 200. A consumer
// with i18n ids reads the old wording as not applying to them. It does.
const HONEST_DISCLOSURES = [
  `The encoded-path axis ${CLOSED} by the raw-target comparison, by construction (#56).`,
  `A raw-path hook is still a live finding for any id carrying an octet outside A-Za-z0-9-._~ (#56).`,
  `Non-ASCII and control octets stay encodable too, so /i18n/caf%C3%A9 and /i18n/caf%c3%a9 name one id.`,
  `Reserved characters must stay encodable, so one decoded id still has more than one accepted spelling.`,
  `req.params is the sound comparison; req.path and req.originalUrl are raw and always were.`,
  `Closed by canonicalEncoding (#56); the octet-aliasing residual below is not, and cannot be.`,
  `A residual ${OPEN} on the non-unreserved-octet axis and the module ${CLOSED} without 404ing legitimate encodings.`
];

// ---------------------------------------------------------------------------
// THE PROBE CORPUS, for assertion 0c/0d -- the EXPRESSIVENESS control.
//
// Assertion 0's original two checks grep for `canonicalRoutes`: a bare literal
// with no alternation, no interval and no escape. They prove the grep RAN and
// that its SCOPE reaches outside test/. They cannot prove the third thing the
// zeroes in assertion 3 depend on, which is that git's ERE compiler can EXPRESS
// the patterns it is being asked to certify. A control written in a simpler
// regex than the patterns it validates is evidence about execution only.
//
// That gap is not hypothetical; it is the defect this fix round exists for. One
// pattern ended in `\b`, Apple git compiled that to a literal `b`, the tree-wide
// count came back 0, and every local run reported the ledger clean while CI --
// the only environment where those patterns had ever actually executed --
// reported the hit. Eleven green local runs, one red CI, identical SHA. The
// measurement is recorded at WORD_END above.
//
// So the control is now differential rather than existential. Every banned
// pattern is run over the SAME corpus by BOTH engines and the matched lines
// must agree line-for-line. A construct the local git cannot express produces a
// different match set than JS, and that reds -- for `\b`, and equally for `\d`,
// `\s`, `\w`, a lookaround, a backreference or a non-greedy quantifier, none of
// which are POSIX ERE. The control is derived from BANNED_PATTERNS, so a
// pattern added later is covered without anyone remembering to extend it.
//
// The corpus is the fixtures this file already maintains -- every claim #54 and
// #56 retired, every false closure, every honest disclosure -- which means it
// carries both positives and near-misses. Three probes are added because the
// existing fixtures leave gaps:
//
//   - CLOSE_HERE_PROBE: STALE_CLAIM_PATTERNS[3] is the one pattern with no
//     positive among RETIRED_CLAIMS (the real hit read "close it here, and do
//     not read this note as..." -- the words in the other order). Without it,
//     that pattern's differential check compares two empty sets and passes for
//     any pattern whatsoever. 0c asserts the gap does not reopen.
//   - BOUNDARY_PROBE_HIT ends AT the match, with nothing after it, which is the
//     only line in the corpus that exercises the `|$` branch of WORD_END.
//   - BOUNDARY_PROBE_MISS is the same sentence with the match extended by one
//     word character. It is what `src/route-matching.ts` genuinely says ("is
//     safer than"), and it must NOT match -- the boundary has to still refuse a
//     longer word, or the portable spelling has bought a false positive in
//     exchange for the false negative it fixed.
//
// Assembled from fragments and written to a scratch directory under the OS temp
// dir, never into the repo: a tracked file containing these lines would be
// found by the ledger's own grep and assertion 3 could never be satisfied.
const CLOSE_HERE_PROBE = `Do not ${CLOSE_HERE}, the note said.`;
const BOUNDARY_PROBE_HIT = `A raw-path ${HOOK_IS_SAFE}`;
const BOUNDARY_PROBE_MISS = `A raw-path ${HOOK_IS_SAFE}r than an originalUrl one.`;

const PROBE_CORPUS: string[] = [
  ...RETIRED_CLAIMS.map(([, claim]) => claim),
  ...RETIRED_CLAIMS_56.map(([, claim]) => claim),
  ...FALSE_CLOSURES,
  ...HONEST_DISCLOSURES,
  CLOSE_HERE_PROBE,
  BOUNDARY_PROBE_HIT,
  BOUNDARY_PROBE_MISS
];

const PROBE_FILE = 'corpus.txt';

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

// The SAME `git grep` binary and the SAME `-E` flag as gitGrepCount(), pointed
// with `--no-index` at a scratch corpus outside any repository. `--no-index`
// changes WHAT is searched, not HOW: the pattern is still compiled by git's own
// ERE engine, which is the thing under test. Verified on git 2.50.1 (Apple
// Git-155) that `--no-index` reproduces the `\b` -> literal-`b` behaviour
// exactly, so the control measures the same compiler the ledger's real greps
// use. Returns matching lines, in file order, so the comparison can be made
// line-for-line rather than by count.
//
// `-P` is deliberately NOT used as an escape hatch here or anywhere in this
// file: git's PCRE support is a build-time option (`USE_LIBPCRE`), so `-P` is
// not guaranteed on either the developer's machine or CI, and swapping engines
// to get `\b` back would trade a silent wrong answer for a hard failure on some
// third machine. POSIX ERE is the intersection both gits are guaranteed to
// have; the patterns are written to stay inside it.
function gitGrepLinesNoIndex(pattern: string, cwd: string, file: string): string[] {
  try {
    const stdout = execFileSync('git', ['grep', '--no-index', '-hE', pattern, '--', file], { encoding: 'utf8', cwd });
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

module('[Acceptance] Tripwire ledger (#54 AC3, #56 AC8)', function() {
  test("AC3 (#54) / AC8 (#56) - no artifact still makes a retired claim, falsely announces #56 closed, or drops #56's residual", function(assert) {
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

    // 0c/0d. EXPRESSIVENESS CONTROL -- the third thing the zeroes depend on.
    //
    // The two assertions above prove the grep ran and that it reached outside
    // test/. Both use the bare literal `canonicalRoutes`: no alternation, no
    // interval, no escape. Neither can say anything about whether git's ERE
    // compiler can EXPRESS the patterns whose zeroes assertion 3 reads as
    // "absent" -- and it could not. One pattern ended in `\b`, Apple git
    // compiled that to a literal `b`, and the ledger certified a claim that was
    // sitting in a tracked file. See WORD_END and the PROBE_CORPUS comment.
    //
    // So: run every banned pattern over one corpus with BOTH engines and
    // require the matched lines to agree. A construct JS honours and this git
    // does not (or the reverse) produces different match sets and reds here,
    // BEFORE assertion 3 turns the difference into a false clean bill.
    const probeDir = mkdtempSync(join(tmpdir(), 'stonyx-ledger-ere-'));
    const patternsWithoutFixture: string[] = [];
    const engineDisagreements: string[] = [];
    try {
      writeFileSync(join(probeDir, PROBE_FILE), `${PROBE_CORPUS.join('\n')}\n`);
      for (const pattern of BANNED_PATTERNS) {
        const byJs = PROBE_CORPUS.filter(line => new RegExp(pattern).test(line));
        if (byJs.length === 0) patternsWithoutFixture.push(pattern);

        const byGit = gitGrepLinesNoIndex(pattern, probeDir, PROBE_FILE);
        if (byJs.join('\n') !== byGit.join('\n')) {
          engineDisagreements.push(`/${pattern}/ -- JS RegExp matched ${byJs.length} probe line(s), \`git grep -E\` matched ${byGit.length}`);
        }
      }
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }

    assert.deepEqual(patternsWithoutFixture, [], '0c. every banned pattern has at least one positive fixture in the probe corpus, so 0d compares real match sets rather than two empty ones (a pattern with no fixture passes 0d no matter how broken it is)');
    assert.deepEqual(engineDisagreements, [], '0d. `git grep -E` and the JS RegExp engine agree line-for-line on every banned pattern over the probe corpus. A red here means the local git cannot express a construct this file relies on -- `\\b`, `\\d`, `\\s`, `\\w`, a lookaround, a backreference, a non-greedy quantifier -- and therefore that a zero from assertion 3 no longer means "absent"');

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

    // 1c. THE OTHER DIRECTION, and the reason assertion 9's comment can now
    // claim what it claims. Every pattern in 1/1b bans the PENDING framing; a
    // false announcement of CLOSURE uses the opposite words and was measured
    // green against them (see the FALSE_CLOSURE_PATTERNS comment). These are
    // the phrasings the tripwire holds for -- not the whole claim, which is not
    // reachable by regex; 12 of 15 natural rephrasings escape it, measured.
    for (const closure of FALSE_CLOSURES) {
      const matched = FALSE_CLOSURE_PATTERNS.some(pattern => new RegExp(pattern).test(closure));
      assert.ok(matched, `1c. the false-closure patterns catch: "${closure}"`);
    }

    // 2. ...and the scoping achieved what it was narrowed for: an honest
    // disclosure of the residual that ACTUALLY remains is writable without
    // tripping the ledger. This is the assertion that keeps a future engineer
    // from softening a real limitation to get a green suite -- and after #56 it
    // has teeth in the opposite direction too: entry 2 asserts that calling a
    // raw-path hook a live finding stays writable, because for an id carrying
    // an octet outside `[A-Za-z0-9-._~]` that is still TRUE.
    //
    // Replayed against BANNED_PATTERNS, not STALE_CLAIM_PATTERNS: an honest
    // disclosure has to survive the false-closure half too. That half bans the
    // reassurance phrasings enumerated in FALSE_CLOSURES -- a raw-path hook
    // paired with one of the verbs listed in FALSE_CLOSURE_PATTERNS[1] -- while
    // entry 2 below says a raw-path hook is a live finding. Adjacent sentences
    // with opposite truth values, which is exactly where an over-broad Rule-5
    // pattern would do its damage.
    //
    // THE BANNED SENTENCE IS DELIBERATELY NOT QUOTED HERE, and that omission is
    // PR #58's CI failure written down. The previous version of this comment
    // quoted it verbatim in order to explain the ban. The ban is a plain grep
    // over TRACKED files and this file is tracked, so the documentation tripped
    // the guard it was documenting: CI red at assertion 3, 40 pass / 1 fail,
    // while every local run was green for the unrelated reason recorded at
    // WORD_END. Every banned phrasing elsewhere in this file is assembled from
    // fragments for precisely this reason (CLOSED, OPEN, HOOK_IS_SAFE and the
    // rest); a comment is not exempt from that rule, and prose that needs to
    // name a banned phrasing must point at the fixture instead of restating it.
    //
    // An exclusion for this path was considered and REJECTED. This file is
    // where the honest-disclosure and false-closure FIXTURES live, so excluding
    // it from the ban would blind the ban to its own fixtures -- the one place
    // a wrong phrasing is guaranteed to be checked in.
    for (const disclosure of HONEST_DISCLOSURES) {
      const matched = BANNED_PATTERNS.filter(pattern => new RegExp(pattern).test(disclosure));
      assert.deepEqual(matched, [], `2. an honest #56 disclosure is not banned: "${disclosure}"`);
    }

    // 3. Each retired claim's pattern individually, for a readable failure. On
    // `origin/dev` @ f5c9a24 the unscoped combined pattern returned 8 hits
    // across 5 files: README.md, docs/agents/security-reviewer.md,
    // docs/project-structure.md (x2), src/route-matching.ts (x3),
    // test/integration/rest-server-test.ts.
    for (const pattern of BANNED_PATTERNS) {
      assert.equal(gitGrepCount(pattern), 0, `3. no tracked artifact still makes the banned claim /${pattern}/`);
    }

    // 4. The combined pattern, as one grep.
    assert.equal(gitGrepCount(BANNED_PATTERNS.join('|')), 0, '4. the ledger grep returns 0 hits (was 8 across 5 files on origin/dev)');

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

    // 9. THE ASSERTION THAT CAN ACTUALLY FAIL, AND EXACTLY WHAT IT COVERS.
    //
    // #56's residual is not the percent-encoding axis -- that is closed. It is
    // that every octet OUTSIDE `[A-Za-z0-9-._~]` must stay encodable, so one
    // decoded id still has more than one accepted spelling and a raw-path
    // comparison remains unsound for it. That class is every reserved
    // character, every non-ASCII byte and every control octet whose hex carries
    // a letter digit; the narrow "reserved characters" wording was corrected in
    // #58's fix round, and the over-broad "every control octet" reading of the
    // correction was narrowed back in its second round.
    //
    // KILLABILITY IS MEASURED PER ARTIFACT, AND AT THE RIGHT BASELINE. Each
    // marker below names the revision it is killable against, and the revision
    // differs by marker because the markers guard different claims. A marker
    // that guards "the residual is disclosed AT ALL" is killed against
    // `origin/dev`, where it was not disclosed. A marker that guards "the
    // disclosure states the WIDER class" cannot be killed against `origin/dev`
    // -- the narrow disclosure it exists to reject did not exist there either.
    // Its baseline is `ee2a2f7`, THIS BRANCH's head before its first fix round,
    // which is exactly the narrow wording the review rejected. See
    // docs/framework/testing.md, "The baseline for 'is this marker killable' is
    // the PR head, not the merge base": an earlier version of the wider-class
    // marker was the bare substring `non-ASCII`, measured 0/0/0 on `origin/dev`
    // and concluded killable -- but README.md and docs/project-structure.md had
    // each already gained one `non-ASCII` from an UNRELATED paragraph added
    // earlier in this same PR, so it was vacuous for two of the three
    // artifacts. Reverting all three files together still reds, which is why
    // the whole-set revert is not the measurement to trust; the proof below is
    // one file at a time.
    //
    // WHAT THIS BLOCK COVERS, stated so nobody reads more into it than it does.
    // It is a PRESENCE check on four markers, and it fails when a marker is
    // removed:
    //
    //   - `a%2Bb` -- the measurement. Guards that the residual is disclosed at
    //     all; baseline `origin/dev`, 0 hits in all three artifacts, so
    //     deleting it reds this. Measured: renaming this marker reds assertion
    //     9 while assertion 8 stays green, which is the whole AC8
    //     demonstration.
    //   - `req.params` NAMED AS THE SOUND comparison -- a REGEX, not a
    //     substring. The bare substring `req.params` cannot fail here: it
    //     already appeared 2/1/2 times in README.md,
    //     docs/project-structure.md and docs/agents/security-reviewer.md on
    //     `origin/dev`, BEFORE #56 existed, so deleting #56's remedy sentence
    //     left this at 1 pass / 0 fail. Corrected in #58's fix round to require
    //     `req.params` and the word "sound" in one sentence, which is 0 hits on
    //     `origin/dev` and therefore killable. Same claim, same baseline, as
    //     `a%2Bb`.
    //   - `reserved` -- same claim and baseline again; 0 hits on `origin/dev`.
    //   - THE WIDER CLASS -- `non-ASCII` and `control octet` in ONE SENTENCE, a
    //     regex and not the bare substring `non-ASCII`, for the reason above.
    //     Different claim, so a different baseline: measured at `ee2a2f7` it is
    //     0 hits in all three of README.md, docs/project-structure.md and
    //     docs/agents/security-reviewer.md, where the bare substring was
    //     1/1/0. It is therefore killable in each artifact independently, and
    //     the three single-file reverts that prove it are recorded on PR #58.
    //     `control octet` is the discriminator: it is 0 at `ee2a2f7` in every
    //     one of the three, and the narrow wording cannot produce it.
    //
    // WHAT IT DOES NOT COVER, and this is the half whose earlier wording
    // over-claimed. A presence check cannot see a false ANNOUNCEMENT of
    // closure, because a false announcement ADDS words rather than removing
    // any. Measured on this branch, both at 41 pass / 0 fail before #58:
    // commenting out the honest residual and replacing its heading with a
    // "fully handled" claim, and adding a false "resolved" sentence while
    // removing nothing. Those two shapes are now tripped by
    // FALSE_CLOSURE_PATTERNS and assertion 1c -- by the BAN, not by this block,
    // and as a tripwire on enumerated phrasings rather than as coverage of the
    // claim (12 of 15 rephrasings still escape it; see that comment). Do not
    // restore the claim that this block catches a false closure; it never did.
    //
    // Nor can it see a NARROW RESTATEMENT SOMEWHERE ELSE IN THE SAME FILE. Every
    // marker here is a WHOLE-FILE presence check: it reads the artifact as one
    // string and asks whether the wider class appears anywhere in it. So a row
    // in a table, or a paragraph in a later section, that re-scopes the residual
    // back to "reserved characters" satisfies this block unchanged -- the file
    // still contains the wider-class sentence elsewhere, so the regex still
    // matches and nothing reds. That is exactly what happened: PR #58 shipped a
    // second round with README.md's Consumer Contracts row still scoped to
    // reserved characters, and this block was green throughout. It was found by
    // reading, not by a check. Making the markers row-aware (per table row, per
    // section) is a real improvement and deliberately NOT made here -- it is a
    // larger and unmeasured change than the fix round it would have ridden in
    // on. Until then: this block guards that the wider class is stated in each
    // artifact, NOT that it is stated consistently everywhere within one.
    const RESIDUAL_ARTIFACTS = [
      ['README.md', readme],
      ['docs/project-structure.md', projectStructure],
      ['docs/agents/security-reviewer.md', securityBrief]
    ] as const;

    // THESE TWO KEEP `\b` AND `\s+`, AND THE EXCEPTION IS LOAD-BEARING RATHER
    // THAN AN OVERSIGHT. Everything in BANNED_PATTERNS is a STRING, because it
    // is compiled by both JS and `git grep -E`, and must therefore stay inside
    // POSIX ERE (see WORD_END). The two below are RegExp LITERALS that only
    // ever reach `.test()` on a file's contents -- no git grep, one engine, so
    // `\b` and `\s+` mean what they say. `\s+` in particular has no spelling
    // usable in both engines: the portable ERE form is `[[:space:]]`, which git
    // reads as the POSIX space class and JS parses as the character class
    // `[[:space:]` followed by a LITERAL `]` -- measured, `/^[[:space:]]$/`
    // matches the two-character string `s]` and does not match a tab. So a
    // single shared spelling does not exist, and "fixing" these would break
    // them. The type system is the guard that keeps the exception honest --
    // `gitGrepCount(pattern: string)` will not accept a RegExp, so neither of
    // these can drift into the grep path without a `pnpm typecheck` failure,
    // and typecheck runs as part of `pnpm test`.
    //
    // `req.params` and "sound" inside one sentence (`[^.]` stops at the
    // sentence-ending period, and also at the dot in `req.params` itself, hence
    // both orderings).
    const NAMES_THE_REMEDY = /req\.params[^.]{0,160}\bsound\b|\bsound\b[^.]{0,160}req\.params/;

    // The wider-class marker. `non-ASCII` and `control octet` inside one
    // sentence, `[^.]` stopping at the sentence-ending period as above, and
    // `\s+` because both docs wrap the phrase across a line break. The bare
    // substring `non-ASCII` is what this replaces: 1/1/0 at `ee2a2f7` from
    // unrelated paragraphs, 0/0/0 for this regex at the same commit.
    const NAMES_THE_WIDER_CLASS = /non-ASCII[^.]{0,140}control\s+octets?|control\s+octets?[^.]{0,140}non-ASCII/;

    for (const [name, contents] of RESIDUAL_ARTIFACTS) {
      assert.ok(contents.includes('a%2Bb'), `9. ${name} carries the measured two-spellings-one-id example (a+b / a%2Bb) rather than dropping the measurement`);
      assert.ok(NAMES_THE_REMEDY.test(contents), `9. ${name} names req.params as the SOUND comparison, not just the limitation (a bare "req.params" mention cannot fail -- it predates #56 in all three artifacts)`);
      assert.ok(contents.includes('reserved'), `9. ${name} names reserved characters among what keeps the residual open`);
      assert.ok(NAMES_THE_WIDER_CLASS.test(contents), `9. ${name} states the residual's WIDER class -- non-ASCII bytes AND control octets in one sentence, not only reserved characters (a bare "non-ASCII" mention cannot fail: README.md and docs/project-structure.md each already carried one at ee2a2f7, from a paragraph unrelated to the residual)`);
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
