// ---------------------------------------------------------------------------
// #47 fix round -- documentation contract tests.
//
// SME Phase 5 (Doc-Update) returned 2 HIGH / 5 MEDIUM / 2 LOW, all of them
// disclosure defects rather than code defects. Documentation findings get
// regression tests here for the same reason code findings do: every one of
// these was true at review head, is asserted false here, and a future edit that
// reintroduces any of them turns this file red.
//
// The behavioural half of the same review round lives in
// test/integration/readme-examples-test.ts, where each documented example is
// executed over a raw socket.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';
import { readFileSync } from 'fs';

const { module, test } = QUnit;

const read = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

const readme = read('README.md');
const projectStructure = read('docs/project-structure.md');
const securityReviewer = read('docs/agents/security-reviewer.md');
const packageJson = JSON.parse(read('package.json')) as { files: string[] };
const environment = read('config/environment.js');

module('[Unit] Documentation surface (#47 fix round)', function () {
  // -------------------------------------------------------------------------
  // The premise the rest of this module rests on: README.md is the whole
  // published documentation surface. If docs/ ever became publishable this
  // module's severity assumptions would change, so the premise is asserted, not
  // assumed.
  // -------------------------------------------------------------------------
  test('README.md is the only documentation a consumer receives', function (assert) {
    assert.ok(packageJson.files.includes('README.md'), 'package.json files ships README.md');
    assert.notOk(
      packageJson.files.some(entry => entry === 'docs' || entry.startsWith('docs/')),
      'package.json files does NOT ship docs/'
    );
  });

  // -------------------------------------------------------------------------
  // Phase 5 HIGH-1 -- a 200 -> 404 behaviour change was disclosed only under a
  // feature-shaped heading ("Case-Sensitive Route Matching") that a consumer
  // taking a beta bump has no reason to open. docs/release.md carries no
  // changelog, so the README is the only place this can live.
  // -------------------------------------------------------------------------
  test('HIGH-1 — the README carries a Breaking changes section', function (assert) {
    assert.ok(/^#{2,3} Breaking changes/m.test(readme), 'README has a "Breaking changes" heading');

    const section = readme.split(/^#{2,3} Breaking changes/m)[1]?.split(/^#{2,3} /m)[0] ?? '';

    assert.ok(section.length > 0, 'the Breaking changes section is not empty');
    assert.ok(/who breaks|affected|impact/i.test(section), 'it states who is affected');
    assert.ok(section.includes('404'), 'it names the 404 outcome');
    assert.ok(/before you upgrade|before upgrading/i.test(section), 'it gives a pre-upgrade migration step');
  });

  // -------------------------------------------------------------------------
  // Phase 2 WARNING-3 -- the documented escape hatch is a no-op for consumers
  // who install this module into `dependencies`. Measured at
  // stonyx/dist/modules.js:31: `const dependencies = (rootPackage.devDependencies || {})`,
  // so config/environment.js is never merged for them and the env var is never
  // read. src/main.ts:58-59 already documents this loader shape verbatim. The
  // config-object form works in BOTH install shapes, because
  // mergeObject(moduleConfig, userConfig) lets user config win.
  // -------------------------------------------------------------------------
  test('WARNING-3 — the opt-out documents the config-object form, not only the env var', function (assert) {
    assert.ok(readme.includes('REST_CASE_SENSITIVE_ROUTES=false'), 'env-var form is documented');
    assert.ok(/caseSensitiveRoutes:\s*false/.test(readme), 'config-object form is documented');
    assert.ok(
      /devDependencies/.test(readme),
      'the README explains why the env var alone is not enough (loader merges devDependencies only)'
    );
  });

  // -------------------------------------------------------------------------
  // Phase 5 HIGH-2 / Phase 3 MEDIUM / Phase 2 WARNING-1 -- the "Scope"
  // paragraph is an enumerated residual list, which reads as exhaustive. It
  // named #50 only. #54 and #56 are open and were measured live on this head by
  // Phase 3.
  // -------------------------------------------------------------------------
  test('HIGH-2 — the Scope paragraph names every open member of the bypass family', function (assert) {
    for (const issue of [50, 54, 56, 69]) {
      assert.ok(
        readme.includes(`stonyx-rest-server/issues/${issue}`),
        `Scope links the still-open residual #${issue}`
      );
    }
  });

  test('HIGH-2 — the opt-out warning scopes itself to the case axis', function (assert) {
    assert.notOk(
      /re-opens the fail-open above for any authorization that matches on a URL/.test(readme),
      'the opt-out no longer implies the whole URL-matching family is otherwise closed'
    );
    assert.ok(/case-variant fail-open/.test(readme), 'the opt-out names the case-variant fail-open specifically');
  });

  // -------------------------------------------------------------------------
  // Phase 5 MED-2 -- measured against @stonyx/utils/dist/string.js
  // (kebabToCase only ever UPPER-cases; it never lower-cases) and file.js:118:
  //   Users.ts   camelCaseRoutes=true -> /Users   camelCaseRoutes=false -> /Users
  // The review-head sentence attributed capitalised mounts to the non-default
  // setting, so a reader on the default concludes they are unaffected.
  // -------------------------------------------------------------------------
  test('MED-2 — the camelCaseRoutes note is factually correct about capitalised filenames', function (assert) {
    assert.notOk(
      /with it falsy, filenames are used verbatim, so `Users\.ts` mounts at `\/Users`/.test(readme),
      'the false attribution of /Users to the falsy setting is gone'
    );
    assert.ok(
      /`Users\.ts` mounts at `\/Users`[^.]*both/.test(readme),
      'the README states Users.ts mounts at /Users under both settings'
    );
  });

  // -------------------------------------------------------------------------
  // Phase 5 MED-3, re-resolved by Phase 5 re-verification NEW-1.
  //
  // MED-3 named a real contradiction -- the options table claimed
  // `camelCaseRoutes` defaults to `true` while the prose said camelCase applied
  // only "if configured" -- but resolved it toward the WRONG side. The table is
  // the side that was false: `config/environment.js` declares no
  // `camelCaseRoutes` key at all, so `src/main.ts` destructures `undefined` and
  // passes `rawName: !camelCaseRoutes` === `true`. Verbatim filenames is the
  // SHIPPED DEFAULT. Measured over a raw socket against the real mounted app,
  // with a `phone-number.ts` fixture and nothing setting the flag:
  //
  //   camelCaseRoutes unset  ->  GET /phone-number 200,  GET /phoneNumber 404
  //   camelCaseRoutes false  ->  GET /phone-number 200,  GET /phoneNumber 404
  //   camelCaseRoutes true   ->  GET /phone-number 404,  GET /phoneNumber 200
  //   /Users 200 and /users 404 under all three -- kebabToCase only ever
  //   UPPER-cases, so `Users.ts` is unaffected by the setting.
  //
  // The predecessor of this test asserted the literal `\`true\`` default, which
  // meant it could only ever go RED when someone CORRECTED the README. A guard
  // that enforces a false claim converts a doc error into a maintained
  // invariant. So this DERIVES the expected default from `config/environment.js`
  // -- the same technique the publish-surface premise above uses against
  // package.json -- and fails when the doc and the config disagree in EITHER
  // direction: add a `camelCaseRoutes` default to the config without updating
  // the table and it goes red; print a boolean default in the table without one
  // in the config and it goes red.
  // -------------------------------------------------------------------------
  test('MED-3 / NEW-1 — the documented camelCaseRoutes default is derived from config/environment.js', function (assert) {
    const declared = /^\s*camelCaseRoutes:\s*(.+?),?\s*$/m.exec(environment)?.[1];

    const row = readme.split('\n').find(line => /^\|\s*`camelCaseRoutes`\s*\|/.test(line));
    assert.ok(row, 'the README options table has a camelCaseRoutes row');

    const defaultCell = (row ?? '').split('|')[3]?.trim() ?? '';

    if (declared === undefined) {
      assert.notOk(
        /`(true|false)`/.test(defaultCell),
        `config/environment.js declares no camelCaseRoutes, so the table must not print a boolean default (cell: ${defaultCell})`
      );
      assert.ok(
        /unset|none|no default/i.test(defaultCell),
        `the table records that there is no default (cell: ${defaultCell})`
      );
      assert.ok(/used \*\*verbatim\*\*|used verbatim/.test(readme), 'the README states filenames are used verbatim');
    } else {
      assert.ok(
        defaultCell.includes(`\`${declared}\``),
        `the table prints the default config/environment.js actually sets (${declared}; cell: ${defaultCell})`
      );
    }

    // The worked example in Breaking changes has to agree with the same source.
    const camelCaseIsDefault = declared !== undefined && declared !== 'false';
    const documentedMount = /`phone-number\.ts` mounts at `(\/[A-Za-z-]+)`/.exec(readme)?.[1];

    assert.equal(
      documentedMount,
      camelCaseIsDefault ? '/phoneNumber' : '/phone-number',
      'the phone-number.ts worked example names the mount path the config actually produces'
    );
  });

  // -------------------------------------------------------------------------
  // Phase 5 MED-4 / Phase 1 NIT-3 -- both constructor bullets predate this PR's
  // own change, and the fact that the set happens IN THE CONSTRUCTOR is the
  // load-bearing detail the whole fix rests on. An architecture reader has no
  // signal that the ordering matters.
  // -------------------------------------------------------------------------
  test('MED-4 — the architecture bullets describe the constructors as they now are', function (assert) {
    const bullets = projectStructure
      .split('\n')
      .filter(line => /\*\*Constructor\*\*/.test(line));

    assert.equal(bullets.length, 2, 'both RestServer and Request constructor bullets are present');
    for (const bullet of bullets) {
      assert.ok(
        /case sensitive routing/.test(bullet),
        `constructor bullet documents the case-sensitive mount: ${bullet.trim().slice(0, 70)}`
      );
    }

    assert.notOk(/new express\(\)/.test(projectStructure), 'the stale `new express()` description is corrected');
  });

  test('LOW-2 — the config-table cross-reference autolinks', function (assert) {
    assert.notOk(/rest-server#47/.test(projectStructure), 'plain #47 is used, which autolinks in-repo');
  });

  // -------------------------------------------------------------------------
  // Phase 5 MED-5 / Phase 2 WARNING-2 -- docs/agents/security-reviewer.md is
  // the brief every future security review of this repo loads. This PR adds a
  // security-relevant setting whose `false` value restores the #47 fail-open
  // through a single environment variable, and the brief did not learn about
  // it. #54 and #56 both recorded this exact file going stale as the thing that
  // told the next reviewer to stop looking.
  // -------------------------------------------------------------------------
  test('MED-5 — the security-reviewer brief knows about caseSensitiveRoutes', function (assert) {
    const liveKnowledge = securityReviewer.split(/^#+ .*Live Knowledge/m)[1]?.split(/^#+ /m)[0] ?? '';

    assert.ok(liveKnowledge.length > 0, 'the brief has a Live Knowledge section');
    assert.ok(liveKnowledge.includes('caseSensitiveRoutes'), 'Live Knowledge names the setting');
    assert.ok(
      liveKnowledge.includes('REST_CASE_SENSITIVE_ROUTES'), 'Live Knowledge names the env var that disables it'
    );
    assert.ok(/#47/.test(liveKnowledge), 'Live Knowledge links the fail-open the setting closes');
  });
});
