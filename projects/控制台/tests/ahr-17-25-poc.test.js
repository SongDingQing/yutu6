#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Harness = require('../quality-ops/ahr-17-25/shadow-harness');
const LoopEngineering = require('../../../shared/engine/loop-engineering');

const workspaceRoot = path.resolve(__dirname, '../../..');
const packageRoot = path.join(workspaceRoot, 'projects/控制台/quality-ops/ahr-17-25');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeHarness(root, taskId, overrides = {}) {
  return new Harness.ShadowHarness(Object.assign({
    taskId,
    shadowRoot: path.join(root, 'ahr-17-25-shadow'),
    environment: 'shadow',
    excludeFromHealthScore: true,
    excludeFromQuotaBreaker: true,
    excludeFromProductionEventLedger: true,
    forbiddenRoots: [path.join(root, 'production')],
    budgets: {
      maxSteps: 3,
      maxTimeMs: 1000,
      maxCostUsd: 1,
      maxConsecutiveFormatErrors: 2,
    },
  }, overrides));
}

function checkProductionBaseline() {
  const baseline = JSON.parse(fs.readFileSync(path.join(packageRoot, 'production-baseline.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(baseline.files)) {
    assert.strictEqual(sha256File(path.join(workspaceRoot, relative)), expected, `${relative} drifted from frozen worktree baseline`);
  }
  return baseline;
}

function checkTypedOutcomeCompatibility() {
  const oldUiConsumer = record => record.state || record.status || 'unknown';
  const cases = [
    [{ id: 'done', state: 'done' }, 'success'],
    [{ id: 'failed', status: 'failed' }, 'fail'],
    [{ id: 'paused', state: 'paused' }, 'blocked'],
    [{ id: 'canceled', status: 'canceled' }, 'cancelled'],
    [{ id: 'waiting', state: 'awaiting_human' }, 'waiting'],
  ];
  for (const [legacy, typed] of cases) {
    const before = oldUiConsumer(legacy);
    const appended = Harness.appendTypedOutcome(legacy, typed, 'contract-test', '2026-07-14T00:00:00.000Z');
    assert.strictEqual(oldUiConsumer(appended), before, `legacy consumer changed for ${typed}`);
    assert.strictEqual(Harness.legacyStatus(appended), before);
    assert.strictEqual(appended.typed_outcome.status, typed);
    assert.strictEqual('typed_outcome' in legacy, false, 'append helper must not mutate legacy record');
  }
}

function checkTrajectoryAndAtomicCheckpoint(root) {
  const harness = makeHarness(root, 'ahr-fi-trajectory-contract');
  harness.checkpoint('reason', { summary: 'choose an isolated read-only probe' });
  harness.checkpoint('action', { toolCallId: 'call-1', summary: 'execute probe' });
  harness.checkpoint('observation', { toolCallId: 'call-1', summary: 'probe returned fixture data' });
  harness.checkpoint('decision', { summary: 'accept observation and stop' });
  const state = harness.read();
  assert.deepStrictEqual(state.trajectory.map(item => item.phase), Harness.PHASES);

  const before = fs.readFileSync(harness.file);
  assert.throws(() => harness.checkpoint('reason', { summary: 'injected rename failure' }, {
    beforeRename() { throw new Error('simulated checkpoint rename crash'); },
  }), /simulated checkpoint rename crash/);
  assert.deepStrictEqual(fs.readFileSync(harness.file), before, 'failed atomic checkpoint must retain previous complete state');
  assert.strictEqual(fs.readdirSync(path.dirname(harness.file)).some(file => file.endsWith('.tmp')), false);
  assert.deepStrictEqual(harness.read().trajectory.map(item => item.phase), Harness.PHASES);
}

function checkHardBudgets(root) {
  let now = 1000;
  const steps = makeHarness(root, 'ahr-fi-step-budget', {
    clock: () => now,
    budgets: { maxSteps: 2, maxTimeMs: 1000, maxCostUsd: 1, maxConsecutiveFormatErrors: 2 },
  });
  assert.strictEqual(steps.consumeBudget({ steps: 2, costUsd: 0.2 }).ok, true);
  const stepStop = steps.consumeBudget({ steps: 1 });
  assert.strictEqual(stepStop.ok, false);
  assert.strictEqual(stepStop.reason, 'step_budget_exceeded');
  assert.strictEqual(stepStop.typedOutcome.status, 'fail');

  const time = makeHarness(root, 'ahr-fi-time-budget', {
    clock: () => now,
    budgets: { maxSteps: 10, maxTimeMs: 5, maxCostUsd: 1, maxConsecutiveFormatErrors: 2 },
  });
  now += 6;
  assert.strictEqual(time.consumeBudget({}).reason, 'time_budget_exceeded');

  const cost = makeHarness(root, 'ahr-fi-cost-budget', {
    clock: () => now,
    budgets: { maxSteps: 10, maxTimeMs: 1000, maxCostUsd: 0.25, maxConsecutiveFormatErrors: 2 },
  });
  assert.strictEqual(cost.consumeBudget({ costUsd: 0.2 }).ok, true);
  assert.strictEqual(cost.consumeBudget({ costUsd: 0.06 }).reason, 'cost_budget_exceeded');
}

function checkFormatBudget(root) {
  const harness = makeHarness(root, 'ahr-fi-format-budget');
  assert.strictEqual(harness.recordFormatResult(false, 'bad json').ok, true);
  assert.strictEqual(harness.recordFormatResult(false, 'bad json again').ok, true);
  const stopped = harness.recordFormatResult(false, 'third consecutive error');
  assert.strictEqual(stopped.ok, false);
  assert.strictEqual(stopped.reason, 'format_error_budget_exceeded');
  assert.strictEqual(stopped.typedOutcome.status, 'fail');

  const recovering = makeHarness(root, 'ahr-fi-format-recovery');
  recovering.recordFormatResult(false, 'first error');
  recovering.recordFormatResult(true);
  const afterReset = recovering.recordFormatResult(false, 'new first error');
  assert.strictEqual(afterReset.ok, true);
  assert.strictEqual(afterReset.formatErrors.consecutive, 1);
}

function checkTruncatedToolCallGuard() {
  let executions = 0;
  const execute = call => { executions += 1; return call.arguments.value; };
  assert.throws(() => Harness.executeCompleteToolCall({
    id: 'call-truncated',
    name: 'file.mutate',
    complete: false,
    streamComplete: false,
    arguments: '{"value":',
  }, execute), /incomplete_streamed_tool_call/);
  assert.strictEqual(executions, 0, 'truncated tool call must never reach executor');
  assert.throws(() => Harness.executeCompleteToolCall({
    id: 'call-invalid-args',
    name: 'file.mutate',
    complete: true,
    streamComplete: true,
    arguments: '{"value":',
  }, execute), /incomplete_or_invalid_tool_arguments/);
  assert.strictEqual(executions, 0);
  assert.strictEqual(Harness.executeCompleteToolCall({
    id: 'call-complete',
    name: 'file.read',
    complete: true,
    streamComplete: true,
    arguments: '{"value":42}',
  }, execute), 42);
  assert.strictEqual(executions, 1);
}

function checkSplitMessageFeatureFlag(root) {
  const disabled = makeHarness(root, 'ahr-fi-message-default-off');
  assert.deepStrictEqual(disabled.enqueueMessage('steering', 'do this before next step'), {
    accepted: false,
    reason: 'feature_flag_disabled',
    compatibilityMode: 'legacy_single_steer_queue',
  });
  assert.deepStrictEqual(disabled.read().messages, { steering: [], followUp: [] });

  const enabled = makeHarness(root, 'ahr-fi-message-experiment', { splitMessageQueues: true });
  assert.strictEqual(enabled.enqueueMessage('followUp', 'after the current turn').accepted, true);
  assert.strictEqual(enabled.enqueueMessage('steering', 'before the next step').accepted, true);
  assert.deepStrictEqual(enabled.drainSteeringBeforeNextStep().map(item => item.message), ['before the next step']);
  assert.deepStrictEqual(enabled.read().messages.followUp.map(item => item.message), ['after the current turn']);
  assert.deepStrictEqual(enabled.drainFollowUpAfterTurn().map(item => item.message), ['after the current turn']);

  const noApproval = Harness.productionFeatureDecision('ahr25_split_message_queues', {
    featureFlag: true,
    requiredTaskId: 'cr-1784019175750-d512c3ff',
    requiredRollbackPlan: 'disable splitMessageQueues and retain legacy single steer queue',
    approval: null,
  });
  assert.strictEqual(noApproval.enabled, false);
  assert.strictEqual(noApproval.reason, 'owner_approval_required');
}

function checkOwnerGate() {
  const requiredTaskId = 'cr-1784019175750-d512c3ff';
  const feature = 'ahr21_unified_process_group_termination';
  const rollbackPlan = 'restore current runner termination behavior';
  const defaultProcessGroup = Harness.productionFeatureDecision('ahr21_unified_process_group_termination', {
    featureFlag: false,
    requiredTaskId,
    requiredRollbackPlan: rollbackPlan,
  });
  assert.strictEqual(defaultProcessGroup.enabled, false);
  assert.strictEqual(defaultProcessGroup.reason, 'feature_flag_disabled');
  const approved = {
    status: 'approved',
    taskId: requiredTaskId,
    approvedScope: [feature],
    rollbackPlan,
  };
  assert.strictEqual(Harness.ownerApprovalAllows(feature, approved, requiredTaskId, rollbackPlan), true,
    'positive contract path must require exact task/scope/rollback tuple');
  assert.strictEqual(Harness.ownerApprovalAllows(feature,
    Object.assign({}, approved, { taskId: 'wrong-task' }), requiredTaskId, rollbackPlan), false);
  assert.strictEqual(Harness.ownerApprovalAllows(feature,
    Object.assign({}, approved, { approvedScope: ['different-feature'] }), requiredTaskId, rollbackPlan), false);
  assert.strictEqual(Harness.ownerApprovalAllows(feature,
    Object.assign({}, approved, { rollbackPlan: 'different rollback' }), requiredTaskId, rollbackPlan), false);
  assert.strictEqual(Harness.productionFeatureDecision(feature, {
    featureFlag: true,
    requiredTaskId,
    requiredRollbackPlan: rollbackPlan,
    approval: approved,
  }).enabled, true);
}

function checkFaultInjectionAndRollback(root) {
  const production = path.join(root, 'production');
  fs.mkdirSync(production, { recursive: true });
  const productionLedger = path.join(production, 'engine-events.jsonl');
  const healthLedger = path.join(production, 'health-score.jsonl');
  const breakerState = path.join(production, 'quota-breaker.json');
  fs.writeFileSync(productionLedger, 'production-ledger-sentinel\n');
  fs.writeFileSync(healthLedger, 'health-sentinel\n');
  fs.writeFileSync(breakerState, '{"status":"healthy"}\n');
  const sentinels = [productionLedger, healthLedger, breakerState].map(file => [file, sha256File(file)]);

  const harness = makeHarness(root, 'ahr-fi-fault-matrix');
  harness.checkpoint('reason', { summary: 'establish a good checkpoint before injection' });
  const network = harness.runFaultInjection('network_partition', () => {
    const error = new Error('simulated network partition');
    error.code = 'ENETUNREACH';
    throw error;
  });
  assert.strictEqual(network.injectedError, 'ENETUNREACH');
  assert.strictEqual(network.byteExact, true);

  const processCrashTx = harness.beginFaultInjection('process_crash');
  const child = spawnSync(process.execPath, ['-e', [
    "const fs=require('fs')",
    "fs.writeFileSync(process.argv[1], '{truncated-by-crash')",
    'process.exit(73)',
  ].join(';'), harness.file], { encoding: 'utf8' });
  assert.strictEqual(child.status, 73, child.stderr || 'crash injector did not exit with fixture code');
  assert.throws(() => JSON.parse(fs.readFileSync(harness.file, 'utf8')));
  const processCrash = harness.recoverFaultInjection(processCrashTx);
  processCrash.injectorExitCode = child.status;
  assert.strictEqual(processCrash.byteExact, true);

  const corruption = harness.runFaultInjection('data_corruption', ({ canonicalFile }) => {
    fs.writeFileSync(canonicalFile, '{invalid-json');
  });
  assert.strictEqual(corruption.byteExact, true);
  assert.deepStrictEqual(harness.read().trajectory.map(item => item.phase), ['reason']);

  for (const result of [network, processCrash, corruption]) {
    assert.strictEqual(result.healthScoreExcluded, true);
    assert.strictEqual(result.quotaBreakerExcluded, true);
    assert.strictEqual(result.productionEventLedgerExcluded, true);
  }
  for (const [file, expected] of sentinels) assert.strictEqual(sha256File(file), expected, `${file} was polluted by shadow injection`);
  return [network, processCrash, corruption];
}

function checkLoopEngineeringDegradedRollback(root) {
  const loopWorkspace = path.join(root, 'loop-workspace');
  const rel = 'candidate.txt';
  const target = path.join(loopWorkspace, rel);
  const roundOneDir = path.join(loopWorkspace, 'artifacts/round-1');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'best-known-good\n');
  const bestSnapshots = LoopEngineering._test.snapshotFiles([rel], loopWorkspace, roundOneDir);
  assert.strictEqual(bestSnapshots.length, 1);
  fs.writeFileSync(target, 'degraded-candidate\n');

  const events = [];
  const ctx = {
    projectId: '控制台',
    max_loops: 3,
    acceptance: 'candidate score must reach 0.85',
    implementation: { changed_files: [rel] },
    review: {
      pass: false,
      severity: 'low',
      notes: 'injected regression',
      evaluation: {
        score: 0.3,
        criteria_scores: [{ id: 'S1', score: 0.3, evidence: `${rel} regressed` }],
        gaps: ['regression'],
        improvement_points: ['restore best snapshot'],
      },
    },
    loop_engineering: {
      enabled: true,
      version: 1,
      max_rounds: 3,
      target_score: 0.85,
      min_improvement: 0.03,
      standards: [{ id: 'S1', text: 'candidate quality', weight: 1 }],
      rounds: [{ round: 1, score: 0.8, improved: true, degraded: false }],
      best: { round: 1, score: 0.8, snapshots: bestSnapshots, changed_files: [rel] },
      converged: false,
      stop_reason: null,
    },
  };
  const loop = LoopEngineering.createLoopEngineering({
    workspaceRoot: loopWorkspace,
    artifactsRoot: path.join(loopWorkspace, 'artifacts'),
    skillsRoot: path.join(loopWorkspace, '.agents/skills'),
    taskId: 'ahr-fi-degraded-rollback',
    maxRounds: 3,
    targetScore: 0.85,
    minImprovement: 0.03,
  });
  const result = loop.afterReview(ctx, {
    taskId: 'ahr-fi-degraded-rollback',
    loop: 2,
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
  });
  assert.strictEqual(result.round.degraded, true);
  assert.strictEqual(result.decision, 'blocked_stop');
  assert.strictEqual(ctx.loop_engineering.stop_reason, 'degraded_rollback');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'best-known-good\n');
  assert(events.some(event => event.type === 'loop.rollback' && event.restored.includes(rel)));
  return { stopReason: ctx.loop_engineering.stop_reason, restored: result.round.restored_files };
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ahr-17-25-poc-'));
  const evidence = { suite: 'ahr-17-25-poc', checks: [], faults: [], degradedRollback: null };
  const checked = (name, fn) => {
    const result = fn();
    evidence.checks.push(name);
    return result;
  };
  try {
    checked('production_baseline_frozen', checkProductionBaseline);
    checked('ahr18_existing_done_and_protocol_contracts_are_not_replaced', () => {
      assert(fs.existsSync(path.join(workspaceRoot, 'shared/engine/done-gate.js')));
      assert(fs.existsSync(path.join(workspaceRoot, 'shared/engine/protocol-gate.js')));
    });
    checked('ahr17_explicit_phase_machine_and_atomic_checkpoint', () => checkTrajectoryAndAtomicCheckpoint(root));
    checked('ahr19_typed_outcome_is_additive_for_old_consumers', checkTypedOutcomeCompatibility);
    checked('ahr20_step_time_cost_hard_budgets', () => checkHardBudgets(root));
    checked('ahr21_default_termination_behavior_is_owner_gated', checkOwnerGate);
    checked('ahr22_shadow_checkpoint_survives_atomic_write_failure', () => checkTrajectoryAndAtomicCheckpoint(path.join(root, 'second-checkpoint')));
    checked('ahr23_consecutive_format_error_budget', () => checkFormatBudget(root));
    checked('ahr24_truncated_tool_call_never_executes', checkTruncatedToolCallGuard);
    checked('ahr25_split_queues_default_off_and_ordered_when_experimental', () => checkSplitMessageFeatureFlag(root));
    evidence.faults = checked('isolated_network_process_corruption_faults_roll_back_without_pollution', () => checkFaultInjectionAndRollback(root));
    evidence.degradedRollback = checked('existing_loop_engineering_degraded_rollback_regression', () => checkLoopEngineeringDegradedRollback(root));
    process.stdout.write(`${JSON.stringify(Object.assign({ pass: true }, evidence))}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
