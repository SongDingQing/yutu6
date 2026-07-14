#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HookRegistry } = require('../shared/engine/hook-registry');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');
const HardeningHooks = require('../projects/控制台/hardening-hooks');

const repoRoot = path.resolve(__dirname, '..');

function implementation(changedFiles = []) {
  return {
    done: true,
    summary: 'hardening hook fixture implementation',
    changed_files: changedFiles,
    logic_chain: {
      summary: 'fixture completed with evidence',
      current_status: 'done',
      actions: ['validated hardening hook fixture'],
      evidence: [{ kind: 'test', command: 'node tests/hardening-hooks.test.js', exit_code: 0, summary: 'hardening hook fixture evidence' }],
      tests: [{ command: 'node tests/hardening-hooks.test.js', exit_code: 0, summary: 'hardening hook fixture evidence' }],
      conclusion: 'fixture complete',
    },
  };
}

function implementationWithReceipt(ctx, changedFiles = []) {
  const impl = implementation(changedFiles);
  impl.receipt = {
    taskId: ctx.taskId,
    specFingerprint: ctx.spec_fingerprint,
    changedFiles,
    tests: ['node tests/hardening-hooks.test.js exit 0'],
    artifacts: ['tests/hardening-hooks.test.js'],
    verdict: 'done',
    blocked_required_specs: [],
  };
  return impl;
}

function review(changedFiles = []) {
  return {
    pass: true,
    severity: 'low',
    notes: `hardening review verified ${changedFiles.join(', ')} and node tests/hardening-hooks.test.js exit 0`,
    verification: {
      verdict: 'true',
      checked: ['implementation.logic_chain', 'implementation.changed_files', ...changedFiles],
      evidence: [{ kind: 'test', command: 'node tests/hardening-hooks.test.js', exit_code: 0, summary: 'review verified hardening hook fixture' }],
    },
  };
}

function queueVarsWithHardTests() {
  const impl = implementation(['tests/queue-organizer.test.js']);
  impl.logic_chain.evidence = [
    { kind: 'analysis', summary: 'queue_organize merged_from/reviewChecklist preserved requirements; planned_cancel reduced queued_after; running 只读; repeated apply is 幂等' },
  ];
  impl.logic_chain.tests = [
    { command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'PASS merge integrity and status migration' },
    { command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'PASS CEO queue-control hard path' },
  ];
  const rev = review(['tests/queue-organizer.test.js']);
  rev.verification.checked = [
    'node tests/queue-organizer.test.js',
    'node tests/ceo-queue-control.test.js',
    'queue_organize merged_from/reviewChecklist planned_cancel queued_after',
  ];
  rev.verification.evidence = [
    { kind: 'test', command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'PASS queue_organize, 状态迁移, 幂等, running 只读' },
    { kind: 'test', command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'PASS secretary no direct queue writes' },
  ];
  return {
    projectId: '控制台',
    goal: 'CEO 队列整理: 合并同类任务, 合并后任务数减少且被合并需求全部保留',
    acceptance: '必须跑 queue-organizer/queue-control 硬回归',
    implementation: impl,
    review: rev,
  };
}

function testRegistryOutputFalseCanBlock() {
  const registry = new HookRegistry();
  registry.register('x', {
    id: 'blocking-output-false',
    failureMode: 'block',
    handler() {
      return { ok: false, reason: 'fixture block' };
    },
  });
  const result = registry.runSync('x', {});
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.results[0].ok, false);
  assert.match(result.results[0].reason, /fixture block/);
}

function testEngineStopsOnBlockingHook() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hardening-hook-flow-'));
  const changedFixture = `.hardening-hook-change-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(path.join(repoRoot, changedFixture), 'untracked fixture change\n');
    const events = [];
    const registry = new HookRegistry();
    registry.register('task.true_done', {
      id: 'fixture.block.true_done',
      failureMode: 'block',
      handler() {
        throw new Error('true_done blocked by fixture');
      },
    });
    const flow = {
      id: 'review-loop',
      nodes: [
        { id: 'implement', agent_role: 'worker_code' },
        { id: 'review', agent_role: 'supervisor' },
        { id: 'done', type: 'end' },
      ],
      edges: [
        { from: 'implement', to: 'review' },
        { from: 'review', to: 'done', when: '{{ review.pass == true }}' },
      ],
      guards: { validate_before_run: false, max_loops: 1 },
      acceptance: { require_evidence: false },
    };
    const result = runFlow({
      flow,
      taskId: 'blocking-hook',
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
      workspaceRoot: repoRoot,
      hooks: registry,
      vars: { goal: '修复控制台源码', acceptance: '必须有真实 changed_files 和测试证据' },
      runner(node, ctx) {
        if (node.id === 'implement') return { vars: { implementation: implementationWithReceipt(ctx, [changedFixture]) } };
        return { vars: { review: review([changedFixture]) } };
      },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /hook_gate_failed/);
    assert(events.some(e => e.type === 'hook.blocked' && e.hookId === 'fixture.block.true_done'));
  } finally {
    try { fs.unlinkSync(path.join(repoRoot, changedFixture)); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testHardeningHooksRequireDoneGateMeta() {
  const registry = new HookRegistry();
  HardeningHooks.registerHardeningHooks(registry, { workspaceRoot: repoRoot });
  assert(registry.list('task.true_done').some(hook => hook.id === HardeningHooks.DONE_GATE_META_HOOK_ID));
  assert(registry.list('task.true_done').some(hook => hook.id === HardeningHooks.PROTOCOL_GATE_HOOK_ID));
  assert(registry.list('task.true_done').some(hook => hook.id === HardeningHooks.HARD_REGRESSION_HOOK_ID));
  const result = registry.runSync('task.true_done', {
    flow: 'review-loop',
    ctx: { goal: '只读分析任务', acceptance: '不改任何文件' },
    workspaceRoot: repoRoot,
  });
  assert.strictEqual(result.ok, false);
  assert(result.results.some(item => item.id === HardeningHooks.DONE_GATE_META_HOOK_ID && item.ok === false));
}

function testHardeningHooksRequireQueueMergeRegressionCoverage() {
  const registry = new HookRegistry();
  HardeningHooks.registerHardeningHooks(registry, { workspaceRoot: repoRoot });
  const missing = registry.runSync('task.true_done', {
    flow: 'review-loop',
    gate: { ok: true },
    ctx: {
      goal: 'CEO 队列整理: 合并同类任务, 合并后任务数减少且被合并需求保留',
      acceptance: '必须跑硬回归',
      implementation: implementation(['tests/queue-organizer.test.js']),
      review: review(['tests/queue-organizer.test.js']),
    },
    workspaceRoot: repoRoot,
  });
  assert.strictEqual(missing.ok, false);
  assert(missing.results.some(item => item.id === HardeningHooks.HARD_REGRESSION_HOOK_ID && item.ok === false));

  const passing = registry.runSync('task.true_done', {
    flow: 'review-loop',
    gate: { ok: true },
    ctx: queueVarsWithHardTests(),
    workspaceRoot: repoRoot,
  });
  assert.strictEqual(passing.ok, true, JSON.stringify(passing.results));
}

testRegistryOutputFalseCanBlock();
testEngineStopsOnBlockingHook();
testHardeningHooksRequireDoneGateMeta();
testHardeningHooksRequireQueueMergeRegressionCoverage();

console.log(JSON.stringify({ pass: true, suite: 'hardening-hooks' }));
