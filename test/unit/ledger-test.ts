// Acceptance anchor for abofs/stonyx-rest-server#54, AC3.
//
// SCAFFOLD ONLY. Stubbed with QUnit `todo`, not a passing placeholder: a `todo`
// that passes is reported as a FAILURE, so this stub cannot survive into the
// finished fix unnoticed.
//
// #50 shipped `GET /public/` -> 200 as a documented invariant across 16
// artifacts, several of which instruct the reader that the edge is not
// closable. #54 changes that behaviour, so every one of those has to move in
// the same change. Most of them are prose and fail only under review; this test
// turns the prose half into something the suite itself can falsify.
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Acceptance] Tripwire ledger (#54)', function() {
  test.todo('AC3 - no artifact still pins /public/ -> 200 or calls the edge unclosable', function(assert) {
    assert.ok(false, 'AC3 not implemented: git grep for the stale phrasings must return 0 hits');
  });
});
