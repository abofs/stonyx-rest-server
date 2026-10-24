import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Integration] Sample patterns (stonyx#121 part C)', function() {
  module('version gate + inherited auth via an extended Request', function() {
    test.skip('TODO: missing/old client version -> 426 JSON:API error', function() {});
    test.skip('TODO: inherited sync auth rejects; positive control passes', function() {});
  });

  module('async handler-array middleware', function() {
    test.skip('TODO: awaited state reaches the handler; middleware can stop the request', function() {});
  });

  module('response headers and custom status', function() {
    test.skip('TODO: headers and status set from the sample reach the response', function() {});
  });

  module('auth() contract', function() {
    test.skip('TODO: a Promise-returning auth yields 500', function() {});
  });
});
