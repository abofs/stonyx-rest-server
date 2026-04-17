// Force-exit hook for qunit runs.
//
// Tracks stonyx#55: when a stonyx module binds a port during init
// (rest-server binds 2666), that server keeps the event loop alive
// after qunit finishes. The framework ships a runEnd hook via
// `stonyx test` CLI, but this repo invokes qunit directly (bypassing
// the CLI) to work around the pnpm .bin/qunit shim issue, so we need
// the hook here.
//
// Named `zz-` so alphabetical test-file order places it last, after
// all real test files have registered with QUnit.
import QUnit from 'qunit';

// @types/qunit is missing `.on`; it exists at runtime.
(QUnit as unknown as { on: (event: string, handler: () => void) => void }).on('runEnd', () => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});
