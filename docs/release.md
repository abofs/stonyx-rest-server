# Release Process

This package is released through the shared Stonyx pipeline in
[`abofs/stonyx-workflows`](https://github.com/abofs/stonyx-workflows). The three workflow files
in this repo (`.github/workflows/ci.yml`, `publish.yml`, `security-audit.yml`) are thin
`workflow_call` wrappers — they contain no release logic of their own, only triggers and inputs.
Everything below is verified against the shared workflow files
(`ci.yml`, `npm-publish.yml`, `security-audit.yml` at `abofs/stonyx-workflows@main`, fetched and
read directly for this document) and against this repo's own `package.json`, not copied from
`stonyx-workflows/docs/release.md` unread.

**npm package:** `@stonyx/rest-server`

## What actually runs

### CI (`.github/workflows/ci.yml` -> `stonyx-workflows/ci.yml@main`)

Triggers on **pull requests into `dev`, `main`, or `fix/**`**. Steps, as defined in the shared
workflow:

1. Checkout (`persist-credentials: false`).
2. `pnpm install --frozen-lockfile`.
3. `pnpm test` (this repo's script: `pnpm build && pnpm typecheck && NODE_ENV=test node --import tsx/esm --import ./test/setup.ts node_modules/qunit/bin/qunit.js 'test/**/*-test.ts'`).
4. `pnpm run --if-present build` again (a second build, specifically so the docs-import check below sees a built `dist/`).
5. A docs-import check: checks out `stonyx-workflows` at the pinned commit SHA that triggered the job, installs its own pinned TypeScript, and verifies every `@stonyx/*` import that appears in this repo's README/docs resolves against real published (or locally-built) exports — i.e. a code sample in the docs that imports something that doesn't exist fails CI.

This is verified directly: running the equivalent steps locally (`pnpm install --frozen-lockfile`, `pnpm test`) succeeded — see "Build, Run, Test" in [index.md](index.md). The docs-import check step itself was not run locally (it depends on a `stonyx-workflows` checkout and a temp npm registry) and is not independently verified here.

### Publish (`.github/workflows/publish.yml` -> `stonyx-workflows/npm-publish.yml@main`)

Triggers on: `repository_dispatch` (`cascade-publish`, from a dependency's own publish), manual `workflow_dispatch` (version-type patch/minor/major, or a custom version), pull requests into `dev`/`main` (opened/synchronize/reopened), and pushes to `dev`/`main`.

Channel selection (from the shared workflow's `Determine version bump type` step, in order):

| Condition | Channel | npm dist-tag |
|---|---|---|
| `cascade-source` set (a cascade dispatch) | beta | `beta` |
| `pull_request` event | alpha | `alpha` |
| `push` to `refs/heads/main` | stable | `latest` |
| `push` to any other branch (i.e. `dev`) | beta | `beta` |
| `workflow_dispatch` with `version-type` | patch/minor/major | `latest` |

After version bump, the workflow runs `pnpm install` (frozen unless cascade), `pnpm test` again, then **packs the release artifact and runs `prepublishOnly` explicitly** (`pnpm pkg get scripts.prepublishOnly`; this repo declares `"prepublishOnly": "npm test"`, so a publish runs the full build+typecheck+QUnit suite a third time via `npm test`, not `pnpm test` — same script, different runner). The packed tarball is then scanned for any `.git/` entries (hard-fails the publish if found — no bypass) before `pnpm publish --tag <alpha|beta|stable> --access public --no-git-checks`. Beta/stable publishes also commit the version bump, tag it, push, and create a GitHub Release.

**Verified:** this repo's `files` field (`["dist", "config", "README.md"]`) matches the narrow-allowlist shape the shared workflow's own docs identify as the one that stops the `.git`-leak class entirely — confirmed by reading `package.json` directly, not assumed. **Not verified / out of scope:** actually triggering a publish (would push a real version and touch npm/GitHub Release infrastructure — explicitly out of bounds for this doc).

### Security audit (`.github/workflows/security-audit.yml` -> `stonyx-workflows/security-audit.yml@main`)

Triggers on a daily cron (`0 8 * * *`) and manual `workflow_dispatch`. Steps: `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level moderate` with **`continue-on-error: true`** — a moderate-or-higher advisory is logged but does **not** fail the job or block anything. This is informational-only as currently wired; there is no gate anywhere in this pipeline that fails CI or blocks a publish on an audit finding.

## Discrepancies / things that don't match a naive reading, or can't be verified here

- **pnpm version pin mismatch.** The shared `ci.yml`/`npm-publish.yml`/`security-audit.yml` all default their `pnpm-version` workflow-call input to `'9'`. None of this repo's three workflow files (`ci.yml`, `publish.yml`, `security-audit.yml`) pass an override, and `package.json` declares no `packageManager` field pinning a version either. So CI/publish/audit run on **pnpm 9** by default, while the toolchain specified for local work in this environment is **pnpm 10.23.0**. Locally, `pnpm install --frozen-lockfile` and `pnpm test` both succeeded under 10.23.0 with no lockfile changes, so there is no *known* incompatibility — but the CI pin is not the same pnpm major version as local, and that gap is not resolved by anything in this repo.
- **The docs-import check (CI step 5 above) could not be verified locally.** It depends on checking out `stonyx-workflows` at the triggering commit SHA and standing up a temporary npm registry install; neither was exercised in this pass.
- **Publish and the version-bump commit/tag/push were not exercised**, per the task boundary excluding infrastructure, secrets, and branch protection. The channel-selection table above is read directly off the shared workflow's conditional logic, not observed from a live run.
- **`prepublishOnly` runs `npm test`, not `pnpm test`**, even though every other script and this doc's own "Build, Run, Test" section uses pnpm. Both invoke the same `test` script in `package.json`, so the behavior is identical, but a reader grepping for "pnpm" in the publish path would miss this one site.
- The previous version of this file pointed only to `stonyx-workflows/docs/release.md` with no repo-specific detail. That external doc is still the canonical cross-package reference (versioning scheme, cascade publishing, the `.git`-leak guard, OIDC provenance) and is accurate as far as this review could tell by reading the shared workflow source directly; this file adds what's specific to `@stonyx/rest-server` and what was independently checked rather than taken on trust.
