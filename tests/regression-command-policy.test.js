#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Policy = require('../shared/engine/regression-command-policy');

function allowed(command, reason) {
  assert.deepStrictEqual(Policy.autoExecutionDecision(command), { allowed: true, reason });
}

function sleeping(command, reason) {
  assert.deepStrictEqual(Policy.autoExecutionDecision(command), { allowed: false, reason });
}

function main() {
  allowed('node tests/done-gate.test.js', 'targeted_node_test');
  allowed('node tests/fail.fixture.js', 'targeted_node_test');
  allowed('node tests/run.js --profile smoke', 'explicit_profile');
  allowed('node tests/run.js --profile lean', 'explicit_profile');
  allowed('node tests/run.js --profile full', 'explicit_profile');
  allowed('pytest tests/test_queue.py', 'targeted_pytest');
  allowed('python3 -m pytest tests/test_queue.py -q', 'targeted_pytest');

  sleeping('node tests/run.js', 'unscoped_full_suite');
  sleeping('npm test', 'unscoped_project_suite');
  sleeping('pnpm run test', 'unscoped_project_suite');
  sleeping('node tests/done-gate.test.js && rm -rf /tmp/nope', 'unsafe_shell_syntax');
  sleeping('echo PASS', 'not_whitelisted');

  console.log(JSON.stringify({ pass: true, suite: 'regression-command-policy' }));
}

main();
