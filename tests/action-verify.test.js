#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EngineRunner = require('../projects/控制台/engine-runner')._test;

const repoRoot = path.resolve(__dirname, '..');

function withEnv(key, value, fn) {
  const old = process.env[key];
  if (value == null) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (old == null) delete process.env[key];
    else process.env[key] = old;
  }
}

function makeFakePeekaboo(root) {
  const file = path.join(root, 'fake-peekaboo.js');
  fs.writeFileSync(file, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const out = process.argv[process.argv.indexOf('--path') + 1];",
    "if (process.env.FAKE_PEEKABOO_MODE === 'fail') {",
    "  process.stderr.write('screen capture permission denied');",
    '  process.exit(7);',
    '}',
    "fs.mkdirSync(path.dirname(out), { recursive: true });",
    "const content = /after-heal\\.png$/.test(out) ? 'healed screenshot\\n' : 'unchanged screenshot\\n';",
    'fs.writeFileSync(out, content);',
    'process.exit(0);',
    '',
  ].join('\n'), { mode: 0o755 });
  return file;
}

function runActionVerify(mode) {
  const root = fs.mkdtempSync(path.join(repoRoot, '.tmp-action-verify-'));
  const fakePeekaboo = makeFakePeekaboo(root);
  const calls = [];
  const events = [];
  const baseRunner = (node, ctx, attempt) => {
    calls.push({
      node: node.id,
      attempt,
      goal: ctx.goal,
      previous: ctx.previous_computer_use_action_verify || null,
    });
    return {
      vars: { baseAttempt: attempt },
      evidence: { type: 'mock', attempt },
    };
  };
  const runner = EngineRunner.makeActionVerifyingRunner(baseRunner, {
    config: { runners: { peekaboo: {} } },
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
    runsDir: root,
    taskId: `action-verify-${mode}`,
  });
  const node = { id: 'execute', agent_role: 'gui_desktop_control' };
  const ctx = {
    goal: 'Click the target button',
    acceptance: 'computer-use click smoke',
    projectId: '控制台',
  };
  const result = withEnv('CONSOLE_PEEKABOO_IMAGE_BIN', fakePeekaboo, () => (
    withEnv('FAKE_PEEKABOO_MODE', mode, () => runner(node, ctx, 1))
  ));
  return { root, calls, events, result };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function testRetryHealAfterIdenticalScreenshots() {
  const fixture = runActionVerify('heal');
  try {
    const { root, calls, events, result } = fixture;
    assert.strictEqual(calls.length, 2, 'unlanded action must retry exactly once');
    assert.strictEqual(calls[1].attempt, '1-heal');
    assert(calls[1].goal.includes('不要静默继续做后续步骤'), 'heal prompt must forbid silent continuation');
    assert.strictEqual(calls[1].previous.landed, false, 'heal prompt must receive failed first verdict');
    assert.deepStrictEqual(events.map(e => e.type), ['action.verify', 'action.heal', 'action.evidence']);
    assert.strictEqual(events[0].landed, false, 'first verify should detect identical screenshots');
    assert.strictEqual(events[1].correction.type, 'retry');
    assert.strictEqual(events[2].finalLanded, true, 'after-heal screenshot should make final verdict land');
    assert.strictEqual(result.fail, undefined);
    assert.strictEqual(result.evidence.type, 'computer_use_action_verify');
    assert.strictEqual(result.evidence.landed, true);
    assert(result.evidence.beforeScreenshot && result.evidence.afterScreenshot, 'successful captures must have image refs');
    assert(result.evidence.correction.afterScreenshot, 'self-heal must record after-heal screenshot');
    assert(fs.existsSync(path.resolve(repoRoot, result.evidence.beforeScreenshot)), 'before screenshot evidence must exist');
    assert(fs.existsSync(path.resolve(repoRoot, result.evidence.afterScreenshot)), 'after screenshot evidence must exist');
    assert(fs.existsSync(path.resolve(repoRoot, result.evidence.correction.afterScreenshot)), 'after-heal screenshot evidence must exist');
    assert(root.startsWith(path.join(repoRoot, '.tmp-action-verify-')));
  } finally {
    cleanup(fixture.root);
  }
}

function testScreenshotFailureDoesNotCreateFakeImageEvidence() {
  const fixture = runActionVerify('fail');
  try {
    const { calls, events, result } = fixture;
    assert.strictEqual(calls.length, 1, 'screenshot failure should report, not blind retry');
    assert.deepStrictEqual(events.map(e => e.type), ['action.verify', 'action.heal', 'action.evidence']);
    assert.strictEqual(events[0].beforeScreenshot, null);
    assert.strictEqual(events[0].afterScreenshot, null);
    assert(events[0].beforeScreenshotFailure.reason.includes('screen capture permission denied'));
    assert.strictEqual(events[1].correction.type, 'report');
    assert.strictEqual(events[2].finalLanded, false);
    assert(result.fail.includes('could not be verified'));
    assert.strictEqual(result.evidence.beforeScreenshot, null);
    assert.strictEqual(result.evidence.afterScreenshot, null);
    assert(result.vars.computer_use_action_verify.beforeScreenshotFailure.path.endsWith('/before.png'));
  } finally {
    cleanup(fixture.root);
  }
}

testRetryHealAfterIdenticalScreenshots();
testScreenshotFailureDoesNotCreateFakeImageEvidence();

console.log(JSON.stringify({ pass: true, suite: 'action-verify' }));
