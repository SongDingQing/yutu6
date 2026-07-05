#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ProtocolGate = require('../shared/engine/protocol-gate');

function makeTask(overrides = {}) {
  const vars = {
    projectId: '控制台',
    goal: '修复控制台 gate 协议',
    acceptance: '必须带规格指纹和结构化回执',
    bounds: '不碰 Starlaid',
  };
  ProtocolGate.ensureTaskProtocol(vars, { taskId: 'task-protocol-1', flow: 'review-loop', projectId: '控制台' });
  const receipt = {
    taskId: 'task-protocol-1',
    specFingerprint: vars.spec_fingerprint,
    changedFiles: ['shared/engine/protocol-gate.js'],
    tests: ['node tests/protocol-gate.test.js exit 0'],
    artifacts: ['shared/engine/protocol-gate.js:1'],
    verdict: 'done',
    blocked_required_specs: [],
  };
  vars.implementation = Object.assign({
    done: true,
    changed_files: ['shared/engine/protocol-gate.js'],
    receipt,
  }, overrides.implementation || {});
  if (overrides.vars) Object.assign(vars, overrides.vars);
  return Object.assign({
    id: 'task-protocol-1',
    flow: 'review-loop',
    state: 'done',
    vars,
  }, overrides.task || {});
}

function testSpecFingerprintPasses() {
  const task = makeTask();
  const result = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(result.ok, true, result.reason);
}

function testBriefMutationFails() {
  const task = makeTask();
  task.vars.acceptance += '\n新增未登记验收项';
  const result = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /规格指纹不一致/);
}

function testMissingReceiptFailsWhenProtocolPresent() {
  const task = makeTask({ implementation: { receipt: null } });
  delete task.vars.implementation.receipt;
  const result = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /缺少结构化回执/);
}

function testReceiptMustCoverChangedFiles() {
  const task = makeTask();
  task.vars.implementation.changed_files.push('shared/engine/done-gate.js');
  const result = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /changedFiles 未覆盖/);
}

function testBlockedRequiredSpecsNeedOwnerApproval() {
  const task = makeTask();
  task.vars.implementation.receipt.blocked_required_specs = [
    { id: 'must-run-tests', reason: '测试未跑' },
  ];
  const result = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /blocked_required_specs/);
  task.vars.implementation.receipt.blocked_required_specs[0].owner_approved = true;
  const ok = ProtocolGate.validateCompletionProtocol(task, { workspaceRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(ok.ok, true, ok.reason);
}

function testEditLockRejectsConcurrentOwner() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-lock-'));
  try {
    const first = ProtocolGate.acquireEditLock(root, 'gate-upgrade', { owner: 'first', waitMs: 1, leaseMs: 60000 });
    assert.strictEqual(first.ok, true);
    const second = ProtocolGate.acquireEditLock(root, 'gate-upgrade', { owner: 'second', waitMs: 1, leaseMs: 60000 });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'edit_lock_busy');
    first.release();
    const third = ProtocolGate.acquireEditLock(root, 'gate-upgrade', { owner: 'third', waitMs: 1, leaseMs: 60000 });
    assert.strictEqual(third.ok, true);
    third.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRuntimeBaselineDetectsDrift() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-baseline-'));
  try {
    fs.mkdirSync(path.join(root, 'projects/控制台'), { recursive: true });
    fs.writeFileSync(path.join(root, 'VERSION.json'), JSON.stringify({ version: '0.0.0.1' }) + '\n');
    fs.writeFileSync(path.join(root, 'projects/控制台/server.js'), 'server v1\n');
    const files = ['VERSION.json', 'projects/控制台/server.js'];
    const baseline = ProtocolGate.captureRuntimeBaseline(root, { files });
    assert.strictEqual(ProtocolGate.compareRuntimeBaseline(root, baseline, { files }).ok, true);
    fs.writeFileSync(path.join(root, 'projects/控制台/server.js'), 'server v2\n');
    const drift = ProtocolGate.compareRuntimeBaseline(root, baseline, { files });
    assert.strictEqual(drift.ok, false);
    assert(drift.mismatches.includes('projects/控制台/server.js'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testSpecFingerprintPasses();
testBriefMutationFails();
testMissingReceiptFailsWhenProtocolPresent();
testReceiptMustCoverChangedFiles();
testBlockedRequiredSpecsNeedOwnerApproval();
testEditLockRejectsConcurrentOwner();
testRuntimeBaselineDetectsDrift();

console.log(JSON.stringify({ pass: true, suite: 'protocol-gate' }));
