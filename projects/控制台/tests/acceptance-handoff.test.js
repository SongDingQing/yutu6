#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');

const AcceptanceContract = require('../../../shared/engine/acceptance-contract');
const DoneGate = require('../../../shared/engine/done-gate');
const Q = require('../../../shared/engine/queue');
const Handoff = require('../acceptance-handoff');
const EngineRunner = require('../engine-runner')._test;
const CeoWorker = require('../ceo-worker')._test;

const PROJECT_SCOPE = 'project/控制台';
const DESIGN_EVIDENCE = 'projects/控制台/artifacts/architecture/acceptance-handoff-contract-cr-1784215766592-ee4aea5d.md';
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

function fixturePrerequisiteEvidence() {
  const rel = 'projects/控制台/tests/acceptance-handoff.test.js';
  const sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(WORKSPACE_ROOT, rel))).digest('hex');
  return Object.fromEntries(Object.keys(Handoff.defaultConfig().prerequisites).map(key => [key, {
    path: rel,
    sha256,
    verdict: key === 'ownerApproved' ? 'approved' : 'pass',
  }]));
}

function createUpstream(count = 3, options = {}) {
  const items = Array.from({ length: count }, (_, index) => ({
    text: options.texts && options.texts[index] || `验收原子 ${index + 1} 必须保持来源身份`,
    scope: options.scopes && options.scopes[index] || PROJECT_SCOPE,
  }));
  return AcceptanceContract.createContract(items, {
    stage: 'orchestrator',
    projectId: '控制台',
    rootTaskId: 'root-contract-test',
    scope: PROJECT_SCOPE,
    sourceRef: 'orchestrator:root-contract-test',
  });
}

function downstreamFrom(upstream, extras = []) {
  return AcceptanceContract.extendContract(upstream, extras, {
    stage: 'supervisor-requiredRows',
    projectId: '控制台',
    rootTaskId: 'root-contract-test',
  });
}

function systemRecord(point, sourceRef = 'system:delivery') {
  return AcceptanceContract.createRecord({
    text: point,
    point,
    scope: PROJECT_SCOPE,
    source_ref: sourceRef,
    source_kind: 'system',
  }, { pointPrefix: '' });
}

function activeConfig(patch = {}) {
  return Object.assign(Handoff.defaultConfig(), {
    enabled: true,
    activationTaskId: 'activation-fixture-task',
    activationSpecFingerprint: 'a'.repeat(64),
    textDiagnostic: false,
    timeoutMs: 100,
    maxRetries: 3,
    exceptionMode: 'manual_review',
    timeoutMode: 'manual_review',
    prerequisites: {
      orchestratorContract: true,
      supervisorContract: true,
      doneGateContract: true,
      regressionValidated: true,
      performanceValidated: true,
      architectureReviewPassed: true,
      ownerApproved: true,
    },
    prerequisiteEvidence: fixturePrerequisiteEvidence(),
  }, patch);
}

function trustFixtureEvidence() {
  return { ok: true };
}

function assertRejected(result, code) {
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert(result.errors.some(error => error.code === code || (code === 'duplicate' && /duplicate/.test(error.message || error.code))), JSON.stringify(result.errors));
}

function functionalMatrix() {
  const upstream = createUpstream();
  const complete = downstreamFrom(upstream, [systemRecord('任务验收: 交付行')]);
  const passed = AcceptanceContract.validateHandoff(upstream, complete, { scope: PROJECT_SCOPE, timeoutMs: 100 });
  assert.strictEqual(passed.ok, true);
  assert.strictEqual(passed.coverage, 1);

  const rewrittenRecords = complete.records.map((record, index) => index === 0
    ? AcceptanceContract.cloneRecord(record, { point: '任务验收: 等价改写但身份不变' })
    : record);
  const rewritten = AcceptanceContract.createContract(rewrittenRecords, {
    stage: complete.stage,
    projectId: complete.project_id,
    rootTaskId: complete.root_task_id,
    pointPrefix: '',
  });
  assert.strictEqual(AcceptanceContract.validateHandoff(upstream, rewritten, { scope: PROJECT_SCOPE, textDiagnostic: false }).ok, true);
  const diagnostic = AcceptanceContract.validateHandoff(upstream, rewritten, { scope: PROJECT_SCOPE, textDiagnostic: true });
  assert.strictEqual(diagnostic.ok, true);
  assert(diagnostic.warnings.some(warning => warning.code === 'text_diagnostic_mismatch'));
  const rewrittenRows = AcceptanceContract.acceptanceRows(rewritten);
  assert(rewrittenRows.every(row => row.text));
  assert.strictEqual(rewrittenRows[0].point, AcceptanceContract.machinePointFor(upstream.records[0]));
  assert.strictEqual(rewrittenRows[0].display_point, '任务验收: 等价改写但身份不变');
  assert.strictEqual(AcceptanceContract.validateConsumerRows(rewritten, rewrittenRows).ok, true);
  const missingMachineText = rewrittenRows.map(row => Object.assign({}, row));
  delete missingMachineText[0].text;
  assert.strictEqual(AcceptanceContract.validateConsumerRows(rewritten, missingMachineText).reason, 'consumer_machine_text_drift');

  assert.throws(
    () => AcceptanceContract.cloneRecord(complete.records[0], {
      point: '任务验收: 可以删除原要求',
      text: '可以删除原要求',
    }),
    /source_hash does not match/,
  );
  const oppositeMeaning = JSON.parse(JSON.stringify(complete));
  oppositeMeaning.records[0].point = '任务验收: 可以删除原要求';
  oppositeMeaning.records[0].text = '可以删除原要求';
  oppositeMeaning.contract_id = null;
  assertRejected(
    AcceptanceContract.validateHandoff(upstream, oppositeMeaning, { scope: PROJECT_SCOPE, textDiagnostic: false }),
    'contract_invalid',
  );

  const missing = AcceptanceContract.createContract(complete.records.slice(1), {
    stage: 'supervisor-requiredRows', projectId: '控制台', rootTaskId: 'root-contract-test', pointPrefix: '',
  });
  assertRejected(AcceptanceContract.validateHandoff(upstream, missing, { scope: PROJECT_SCOPE }), 'missing_acceptance');

  const generic = AcceptanceContract.createRecord({
    text: '任务验收: 全部做好', point: '任务验收: 全部做好', scope: PROJECT_SCOPE,
    source_ref: 'unattributed:generic-merge', source_kind: 'unattributed',
  }, { pointPrefix: '' });
  const generalized = AcceptanceContract.createContract([complete.records[0], generic], {
    stage: 'supervisor-requiredRows', projectId: '控制台', rootTaskId: 'root-contract-test', pointPrefix: '',
  });
  const generalizedResult = AcceptanceContract.validateHandoff(upstream, generalized, { scope: PROJECT_SCOPE });
  assertRejected(generalizedResult, 'missing_acceptance');
  assert(generalizedResult.errors.some(error => error.code === 'same_scope_unattributed'));

  const duplicate = JSON.parse(JSON.stringify(complete));
  duplicate.records.push(JSON.parse(JSON.stringify(duplicate.records[0])));
  duplicate.contract_id = null;
  assertRejected(AcceptanceContract.validateHandoff(upstream, duplicate, { scope: PROJECT_SCOPE }), 'duplicate');

  const polluted = downstreamFrom(upstream, [AcceptanceContract.createRecord({
    text: '任务验收: 同作用域旁支污染', point: '任务验收: 同作用域旁支污染', scope: PROJECT_SCOPE,
    source_ref: 'orchestrator:unknown-branch', source_kind: 'orchestrator',
  }, { pointPrefix: '' })]);
  assertRejected(AcceptanceContract.validateHandoff(upstream, polluted, { scope: PROJECT_SCOPE }), 'same_scope_unattributed');

  const crossScope = downstreamFrom(upstream, [AcceptanceContract.createRecord({
    text: '任务验收: 其他项目旁支', point: '任务验收: 其他项目旁支', scope: 'project/Simulaid',
    source_ref: 'orchestrator:other-project', source_kind: 'orchestrator',
  }, { pointPrefix: '' })]);
  const isolated = AcceptanceContract.validateHandoff(upstream, crossScope, { scope: PROJECT_SCOPE });
  assert.strictEqual(isolated.ok, true);
  assert(isolated.warnings.some(warning => warning.code === 'cross_scope_isolated'));

  const upstreamWithCrossScope = createUpstream(2, {
    texts: ['当前项目合法验收项', '其他项目旁支验收项'],
    scopes: [PROJECT_SCOPE, 'project/Simulaid'],
  });
  const scopedDownstream = Handoff.buildDownstreamContract(upstreamWithCrossScope, {
    scope: PROJECT_SCOPE,
    projectId: '控制台',
    rootTaskId: 'root-contract-test',
  });
  const scopedRows = AcceptanceContract.acceptanceRows(scopedDownstream);
  assert.deepStrictEqual(scopedRows.map(row => row.scope), [PROJECT_SCOPE]);
  assert.strictEqual(scopedRows[0].text, '当前项目合法验收项');
  const scopedValidation = AcceptanceContract.validateHandoff(upstreamWithCrossScope, scopedDownstream, {
    scope: PROJECT_SCOPE,
  });
  assert.strictEqual(scopedValidation.ok, true, JSON.stringify(scopedValidation));
  assert(scopedValidation.warnings.some(warning => warning.code === 'upstream_cross_scope_ignored'));
  assert.throws(
    () => Handoff.buildDownstreamContract(createUpstream(1, {
      texts: ['仅有其他项目旁支'],
      scopes: ['project/Simulaid'],
    }), { scope: PROJECT_SCOPE, projectId: '控制台' }),
    /no records for supervisor scope/,
  );

  const drifted = JSON.parse(JSON.stringify(complete));
  drifted.records[0].source_hash = 'f'.repeat(64);
  drifted.contract_id = null;
  assertRejected(AcceptanceContract.validateHandoff(upstream, drifted, { scope: PROJECT_SCOPE }), 'contract_invalid');

  let tick = 0;
  const timedOut = AcceptanceContract.validateHandoff(upstream, complete, {
    scope: PROJECT_SCOPE,
    timeoutMs: 100,
    clock: () => { const current = tick; tick += 60; return current; },
  });
  assertRejected(timedOut, 'validation_timeout');
}

function lifecycleMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-handoff-review-'));
  try {
    const upstream = createUpstream();
    const complete = downstreamFrom(upstream, [systemRecord('任务验收: 交付行')]);
    const missing = AcceptanceContract.createContract(complete.records.slice(1), {
      stage: 'supervisor-requiredRows', projectId: '控制台', rootTaskId: 'root-contract-test', pointPrefix: '',
    });
    const events = [];
    const rejected = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'manual-review-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      retryCount: 3,
      queueAgent: 'ceo',
      queueId: 'manual-review-q',
      upstreamContract: upstream,
      downstreamContract: missing,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
      eventlog: { emit(type, detail) { events.push({ type, detail }); } },
    });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.paused, true);
    assert.strictEqual(rejected.review.state, 'awaiting_human_review_retry_exhausted');
    assert(fs.existsSync(rejected.reviewFile));
    assert(events.some(event => event.type === 'acceptance.handoff.rejected'));
    assert(events.some(event => event.type === 'acceptance.handoff.alert'));
    assert.strictEqual(rejected.review.attempts.length, 1);

    const retried = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'manual-review-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      retryCount: 4,
      queueAgent: 'ceo',
      queueId: 'manual-review-q',
      upstreamContract: upstream,
      downstreamContract: missing,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
      eventlog: { emit(type, detail) { events.push({ type, detail }); } },
    });
    assert.strictEqual(retried.ok, false);
    assert.strictEqual(retried.review.state, 'awaiting_human_review_retry_exhausted');
    assert.strictEqual(retried.review.attempts.length, 2);
    assert.strictEqual(retried.review.created_at, rejected.review.created_at);

    const confirmationCredential = 'token=constructed_confirmation_value_1234567890';
    const badConfirmation = Handoff.recoverManualReview({
      reviewFile: rejected.reviewFile,
      upstreamContract: upstream,
      correctedDownstreamContract: complete,
      scope: PROJECT_SCOPE,
      confirmation: { decision: 'approve_corrected_contract', task_id: 'wrong-task', reviewed_by: 'owner' },
    });
    assert.strictEqual(badConfirmation.ok, false);
    Q.enqueue(root, 'ceo', { goal: '人工审核恢复夹具' }, { id: 'manual-review-q' });
    assert(Q.claim(root, 'ceo'));
    Q.finish(root, 'ceo', 'manual-review-q', 'paused', { taskId: 'manual-review-task' });
    const recoveredEvents = [];
    const recovered = Handoff.recoverPausedQueueReview({
      reviewFile: rejected.reviewFile,
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      queueRoot: root,
      queueAgent: 'ceo',
      queueId: 'manual-review-q',
      taskId: 'manual-review-task',
      upstreamContract: upstream,
      correctedDownstreamContract: complete,
      scope: PROJECT_SCOPE,
      confirmation: {
        decision: 'approve_corrected_contract_after_retry_exhausted',
        retry_exhausted_acknowledged: true,
        task_id: 'manual-review-task',
        reviewed_by: `owner ${confirmationCredential}`,
      },
      eventlog: { emit(type, detail) { recoveredEvents.push({ type, detail }); } },
    });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.queueState, 'queued');
    assert.strictEqual(JSON.parse(fs.readFileSync(rejected.reviewFile, 'utf8')).state, 'recovered');
    assert(recovered.review.recovered_contract_id);
    assert(recoveredEvents.some(event => event.type === 'acceptance.handoff.recovered'));
    assert(!fs.readFileSync(rejected.reviewFile, 'utf8').includes(confirmationCredential));
    assert(!JSON.stringify(recoveredEvents).includes(confirmationCredential));
    const queuedAfterRecovery = Q.list(root, 'ceo').queued.find(entry => entry.id === 'manual-review-q');
    assert(queuedAfterRecovery && queuedAfterRecovery.task.acceptance_handoff_recovery);
    assert.strictEqual(queuedAfterRecovery.task.acceptance_handoff_retry_count, 5);
    const resumedSpec = CeoWorker.makeSpec(queuedAfterRecovery);
    assert.strictEqual(resumedSpec.taskId, 'manual-review-task');
    assert.strictEqual(resumedSpec.acceptance_handoff_recovery.corrected_contract_id, complete.contract_id);
    assert.strictEqual(resumedSpec.acceptance_handoff_corrected_contract.contract_id, complete.contract_id);
    const resolvedRecovery = Handoff.resolveRecoveredDownstreamContract({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'manual-review-task',
      queueAgent: 'ceo',
      queueId: 'manual-review-q',
      receipt: queuedAfterRecovery.task.acceptance_handoff_recovery,
      upstreamContract: queuedAfterRecovery.task.acceptance_contract,
      correctedDownstreamContract: queuedAfterRecovery.task.acceptance_handoff_corrected_contract,
    });
    assert.strictEqual(resolvedRecovery.ok, true);
    const tamperedRecovery = JSON.parse(JSON.stringify(queuedAfterRecovery.task.acceptance_handoff_corrected_contract));
    tamperedRecovery.records[0].point = '任务验收: 伪造恢复合同';
    tamperedRecovery.contract_id = null;
    assert.strictEqual(Handoff.resolveRecoveredDownstreamContract({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'manual-review-task',
      queueAgent: 'ceo',
      queueId: 'manual-review-q',
      receipt: queuedAfterRecovery.task.acceptance_handoff_recovery,
      upstreamContract: queuedAfterRecovery.task.acceptance_contract,
      correctedDownstreamContract: tamperedRecovery,
    }).ok, false);
    const replayedConfirmation = Handoff.recoverManualReview({
      reviewFile: rejected.reviewFile,
      upstreamContract: upstream,
      correctedDownstreamContract: complete,
      scope: PROJECT_SCOPE,
      confirmation: { decision: 'approve_corrected_contract', task_id: 'manual-review-task', reviewed_by: 'owner' },
    });
    assert.strictEqual(replayedConfirmation.reason, 'review_not_awaiting_confirmation');

    const exceptionReview = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'exception-review-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      upstreamContract: null,
      downstreamContract: null,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(exceptionReview.ok, false);
    assert.strictEqual(exceptionReview.validation.reason, 'contract_invalid');
    const failOpen = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'exception-fail-open-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      upstreamContract: upstream,
      downstreamContract: complete,
      config: activeConfig({ exceptionMode: 'fail_open' }),
      evidenceVerifier: trustFixtureEvidence,
      validator() { throw new Error('simulated validator infrastructure failure'); },
    });
    assert.strictEqual(failOpen.ok, true);
    assert.strictEqual(failOpen.failOpen, true);

    const constructedCredential = 'token=constructed_test_value_1234567890';
    const sensitivePollution = downstreamFrom(upstream, [AcceptanceContract.createRecord({
      text: `任务验收: 同作用域污染 ${constructedCredential}`,
      point: `任务验收: 同作用域污染 ${constructedCredential}`,
      scope: PROJECT_SCOPE,
      source_ref: 'orchestrator:unknown-sensitive-branch',
      source_kind: 'orchestrator',
    }, { pointPrefix: '' })]);
    const redactedReview = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'redacted-review-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      upstreamContract: upstream,
      downstreamContract: sensitivePollution,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(redactedReview.ok, false);
    const reviewText = fs.readFileSync(redactedReview.reviewFile, 'utf8');
    assert(!reviewText.includes(constructedCredential));
    assert(reviewText.includes('[REDACTED]'));

    assert.deepStrictEqual(Handoff.activationDecision(Handoff.defaultConfig()), {
      active: false, blocked: false, reason: 'feature_disabled', missing: [],
    });
    const missingPrereq = activeConfig();
    missingPrereq.prerequisites.ownerApproved = false;
    const blockedActivation = Handoff.activationDecision(missingPrereq);
    assert.strictEqual(blockedActivation.active, false);
    assert.strictEqual(blockedActivation.blocked, true);
    assert(blockedActivation.missing.includes('ownerApproved'));
    const missingEvidence = activeConfig();
    delete missingEvidence.prerequisiteEvidence.performanceValidated;
    assert.strictEqual(Handoff.activationDecision(missingEvidence, { workspaceRoot: WORKSPACE_ROOT }).reason, 'activation_evidence_invalid');
    const invalidSchema = activeConfig({ schema: 'acceptance-handoff-config@0' });
    assert.strictEqual(Handoff.activationDecision(invalidSchema).reason, 'activation_config_invalid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function recoveryGuardMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-handoff-recovery-guard-'));
  try {
    const upstream = createUpstream(1, { texts: ['必须保留冻结的上游验收合同'] });
    const complete = downstreamFrom(upstream);
    const missing = AcceptanceContract.createContract([systemRecord('任务验收: 缺少原验收项')], {
      stage: 'supervisor-requiredRows', projectId: '控制台', rootTaskId: 'root-contract-test', pointPrefix: '',
    });
    const rejected = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'recovery-guard-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      retryCount: 0,
      upstreamContract: upstream,
      downstreamContract: missing,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.review.retry_count, 0);
    assert(rejected.review.upstream_contract_sha256);

    const replacement = createUpstream(1, { texts: ['可以删除原冻结验收合同'] });
    const replacementDownstream = downstreamFrom(replacement);
    const automaticRejected = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'automatic-anchor-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      retryCount: 0,
      upstreamContract: upstream,
      downstreamContract: missing,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    const automaticReplacement = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'artifacts'),
      taskId: 'automatic-anchor-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      retryCount: 1,
      upstreamContract: replacement,
      downstreamContract: replacementDownstream,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(automaticReplacement.ok, false);
    assert.strictEqual(automaticReplacement.validation.reason, 'upstream_contract_binding_mismatch');
    assert.strictEqual(automaticReplacement.review.upstream_contract_id, automaticRejected.review.upstream_contract_id);

    const replaced = Handoff.recoverManualReview({
      reviewFile: rejected.reviewFile,
      upstreamContract: replacement,
      correctedDownstreamContract: replacementDownstream,
      scope: PROJECT_SCOPE,
      confirmation: { decision: 'approve_corrected_contract', task_id: 'recovery-guard-task', reviewed_by: 'owner-fixture' },
    });
    assert.strictEqual(replaced.reason, 'upstream_contract_binding_mismatch');
    assert.strictEqual(replaced.review.retry_count, 1);
    assert.strictEqual(replaced.review.upstream_contract_id, upstream.contract_id);

    for (const expectedRetry of [2, 3]) {
      const invalid = Handoff.recoverManualReview({
        reviewFile: rejected.reviewFile,
        correctedDownstreamContract: missing,
        scope: PROJECT_SCOPE,
        confirmation: { decision: 'approve_corrected_contract', task_id: 'recovery-guard-task', reviewed_by: 'owner-fixture' },
      });
      assert.strictEqual(invalid.reason, 'corrected_contract_invalid');
      assert.strictEqual(invalid.review.retry_count, expectedRetry);
    }
    const exhaustedReview = readJsonFile(rejected.reviewFile);
    assert.strictEqual(exhaustedReview.state, 'awaiting_human_review_retry_exhausted');
    assert.strictEqual(exhaustedReview.retry_count, 3);
    assert.strictEqual(exhaustedReview.attempts.length, 4);

    for (let index = 0; index < 2; index += 1) {
      const blocked = Handoff.recoverManualReview({
        reviewFile: rejected.reviewFile,
        correctedDownstreamContract: missing,
        scope: PROJECT_SCOPE,
        confirmation: { decision: 'approve_corrected_contract', task_id: 'recovery-guard-task', reviewed_by: 'owner-fixture' },
      });
      assert.strictEqual(blocked.reason, 'manual_recovery_retries_exhausted');
    }
    const unchanged = readJsonFile(rejected.reviewFile);
    assert.strictEqual(unchanged.retry_count, 3);
    assert.strictEqual(unchanged.attempts.length, 4);

    const recovered = Handoff.recoverManualReview({
      reviewFile: rejected.reviewFile,
      correctedDownstreamContract: complete,
      scope: PROJECT_SCOPE,
      confirmation: {
        decision: 'approve_corrected_contract_after_retry_exhausted',
        retry_exhausted_acknowledged: true,
        task_id: 'recovery-guard-task',
        reviewed_by: 'owner-fixture',
      },
    });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.review.recovered_upstream_contract_id, upstream.contract_id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function orchestratorOutputContractMatrix() {
  let capturedTask = null;
  const validCtx = { projectId: '控制台', rootTaskId: 'root-orchestrator-contract' };
  const valid = EngineRunner.runOrchestratorPlan({
    taskId: 'orchestrator-contract-prompt',
    eventlog: { emit() {} },
    ctx: validCtx,
    cliRunner(_node, task) {
      capturedTask = task;
      return {
        vars: {
          orchestrator: {
            projectId: '控制台',
            summary: '只保留项目级范围与验收原子。',
            acceptance: [{ text: '逐项身份必须贯穿交接链', scope: PROJECT_SCOPE }],
          },
        },
      };
    },
  });
  assert.strictEqual(valid.ok, true);
  assert(capturedTask && /acceptance 必须是非空逐项对象数组/.test(capturedTask.acceptance));
  assert(/禁止散文字符串/.test(capturedTask.acceptance));
  assert.strictEqual(validCtx.orchestrator_acceptance_contract.records.length, 1);

  const prose = EngineRunner.runOrchestratorPlan({
    taskId: 'orchestrator-contract-prose-rejected',
    eventlog: { emit() {} },
    ctx: { projectId: '控制台' },
    cliRunner() {
      return { vars: { orchestrator: { projectId: '控制台', summary: '项目摘要', acceptance: '1. 泛化散文验收' } } };
    },
  });
  assert.strictEqual(prose.ok, false);
  assert.match(prose.reason, /non-empty machine item array/);
}

function productionActivationMatrix() {
  const production = Handoff.loadConfig({ workspaceRoot: WORKSPACE_ROOT }).config;
  assert.strictEqual(production.enabled, false);
  assert.strictEqual(production.textDiagnostic, false);
  assert.strictEqual(production.prerequisites.ownerApproved, false);
  assert.strictEqual(production.prerequisiteEvidence.ownerApproved, undefined);
  const booleanOnlyOwnerFlip = JSON.parse(JSON.stringify(production));
  booleanOnlyOwnerFlip.enabled = true;
  booleanOnlyOwnerFlip.prerequisites.ownerApproved = true;
  const blocked = Handoff.activationDecision(booleanOnlyOwnerFlip, { workspaceRoot: WORKSPACE_ROOT });
  assert.strictEqual(blocked.active, false);
  assert.strictEqual(blocked.reason, 'activation_prerequisites_missing');
  assert(blocked.missing.includes('architectureReviewPassed'));

  const genericSelfClaim = activeConfig();
  const forged = Handoff.activationDecision(genericSelfClaim, { workspaceRoot: WORKSPACE_ROOT });
  assert.strictEqual(forged.active, false);
  assert.strictEqual(forged.reason, 'activation_evidence_invalid');
  assert(forged.invalidEvidence.some(item => item.key === 'ownerApproved'));
}

function activationEvidenceMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-handoff-activation-'));
  const config = activeConfig();
  try {
    const designPath = 'projects/控制台/artifacts/architecture/acceptance-handoff-design.md';
    const resultPath = 'projects/控制台/artifacts/engine-runs/activation-fixture-task/review-1/result.redacted.md';
    const tracePath = path.join(path.dirname(resultPath), 'interaction-trace.json');
    fs.mkdirSync(path.dirname(path.join(root, designPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, resultPath)), { recursive: true });
    fs.writeFileSync(path.join(root, designPath), '# reviewed design\n');
    const result = {
      review: {
        pass: true,
        verification: {
          verdict: 'true',
          checked: [designPath],
          acceptance_table: [],
          evidence: [],
        },
      },
    };
    fs.writeFileSync(path.join(root, resultPath), `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
    const resultHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, resultPath))).digest('hex');
    fs.writeFileSync(path.join(root, tracePath), JSON.stringify({
      schema: 'yutu6-interaction-trace@1',
      task_id: config.activationTaskId,
      spec_fingerprint: config.activationSpecFingerprint,
      project_id: '控制台',
      node_id: 'review',
      agent_role: 'supervisor',
      agent_id: 'supervisor',
      status: 'completed',
      observability_status: 'ok',
      integrity_check: { complete: true },
      output: { redacted_path: resultPath, sha256: resultHash },
    }, null, 2));
    const independent = Handoff.verifyPrerequisiteEvidence('architectureReviewPassed', {
      kind: 'independent_review',
      path: resultPath,
      sha256: resultHash,
      verdict: 'approved',
      design_path: designPath,
      design_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, designPath))).digest('hex'),
    }, { workspaceRoot: root, activationConfig: config });
    assert.strictEqual(independent.ok, true, JSON.stringify(independent));

    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicDer = keyPair.publicKey.export({ format: 'der', type: 'spki' });
    const authorityId = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 24);
    const receiptPath = 'projects/控制台/artifacts/acceptance-handoff-owner-approvals/activation-owner.json';
    const actionPath = 'projects/控制台/artifacts/bulletin/decision-actions.json';
    const receipt = {
      schema: Handoff.OWNER_APPROVAL_SCHEMA,
      receipt_id: 'activation-owner',
      feature: Handoff.FEATURE_ID,
      project_id: '控制台',
      task_id: config.activationTaskId,
      spec_fingerprint: config.activationSpecFingerprint,
      approved: true,
      actor: 'owner',
      source: 'owner_decision',
      verification: 'hmac-owner-action+ed25519-server-receipt',
      signature_algorithm: 'ed25519',
      authority_id: authorityId,
      decision_card_id: 'activation-card-1',
      approved_at: '2026-07-17T00:00:00.000Z',
      rollback_plan: 'Set enabled=false and restart the queue worker.',
      decision_action_path: actionPath,
    };
    receipt.signature = crypto.sign(null, Handoff.ownerApprovalSigningPayload(receipt), keyPair.privateKey).toString('base64url');
    fs.mkdirSync(path.dirname(path.join(root, receiptPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, actionPath)), { recursive: true });
    fs.writeFileSync(path.join(root, receiptPath), JSON.stringify(receipt, null, 2));
    fs.writeFileSync(path.join(root, actionPath), JSON.stringify({
      [receipt.decision_card_id]: {
        action: 'approve',
        decisionKind: 'acceptance_handoff_activation',
        via: 'feishu-card',
        verification: 'hmac-sha256-decision-card',
        receiptId: receipt.receipt_id,
        at: receipt.approved_at,
        receiptAuthorityId: receipt.authority_id,
        receiptSignature: receipt.signature,
      },
    }, null, 2));
    const receiptHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, receiptPath))).digest('hex');
    const signedOwner = Handoff.verifyPrerequisiteEvidence('ownerApproved', {
      kind: 'signed_owner_approval',
      path: receiptPath,
      sha256: receiptHash,
      verdict: 'approved',
      receipt_id: receipt.receipt_id,
    }, {
      workspaceRoot: root,
      activationConfig: config,
      ownerApprovalPublicKey: publicDer.toString('base64'),
    });
    assert.strictEqual(signedOwner.ok, true, JSON.stringify(signedOwner));

    const genericPath = 'projects/控制台/tests/acceptance-handoff.test.js';
    fs.mkdirSync(path.dirname(path.join(root, genericPath)), { recursive: true });
    fs.writeFileSync(path.join(root, genericPath), 'ordinary test file\n');
    const genericHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, genericPath))).digest('hex');
    const genericOwner = Handoff.verifyPrerequisiteEvidence('ownerApproved', {
      kind: 'signed_owner_approval',
      path: genericPath,
      sha256: genericHash,
      verdict: 'approved',
      receipt_id: 'fake',
    }, { workspaceRoot: root, activationConfig: config, ownerApprovalPublicKey: publicDer.toString('base64') });
    assert.strictEqual(genericOwner.ok, false);
    assert.strictEqual(genericOwner.reason, 'owner_approval_evidence_contract_invalid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function doneGateIdentityMatrix() {
  const upstream = createUpstream(2, { texts: ['完整交接保持机器身份', '等价改写不依赖文字'] });
  const visual = systemRecord('视觉/UI证据: not_applicable', 'system:visual');
  visual.task_status = 'not_applicable';
  visual.task_evidence = 'task-envelope:visual_acceptance';
  visual.task_notes = 'source=task_type; no positive visual requirement';
  const contract = downstreamFrom(upstream, [visual]);
  const table = [
    '结构化验收表(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)',
    '验收表协议: structured-acceptance@2',
    '模板: templates/structured-acceptance-table.md',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
    '|---|---|---|---|',
    ...contract.records.map(record => record.source_ref === 'system:visual'
      ? `| ${record.point} | not_applicable | task-envelope:visual_acceptance | source=task_type; no positive visual requirement |`
      : `| ${record.point} | 未完成 |  |  |`),
  ].join('\n');
  const filled = contract.records.map((record, index) => ({
    point: AcceptanceContract.machinePointFor(record),
    text: record.text,
    acceptance_id: record.acceptance_id,
    source_hash: record.source_hash,
    scope: record.scope,
    status: record.source_ref === 'system:visual' ? 'not_applicable' : '完成',
    evidence: record.source_ref === 'system:visual' ? 'task-envelope:visual_acceptance' : `${DESIGN_EVIDENCE}:9`,
    notes: record.source_ref === 'system:visual'
      ? 'source=task_type; no positive visual requirement'
      : `${record.text} 已由 acceptance_id/source_hash 专项验证。`,
  }));
  const vars = {
    goal: '纯引擎合同身份回归，无视觉改动。',
    acceptance: table,
    acceptance_contract: contract,
    visual_acceptance: {
      schema: 'visual-acceptance@1', acceptance_protocol: 'structured-acceptance@2', state: 'not_applicable',
      required: false, source: 'task_type', priority: 4, explicit_visual_requirement: false,
      human_gate_forced: false, path_matches: [], task_type_positive: false,
      reason: 'no positive visual requirement after explicit/human-gate/path/task-type evaluation',
    },
    implementation: { acceptance_table: filled },
    review: { pass: true, verification: { acceptance_table: filled } },
  };
  const gate = DoneGate.validateStructuredAcceptanceTable(vars, { workspaceRoot: path.resolve(__dirname, '../../..') });
  assert.strictEqual(gate.ok, true, gate.reason);
  const tampered = JSON.parse(JSON.stringify(vars));
  tampered.implementation.acceptance_table[0].acceptance_id = 'acc_000000000000000000000000';
  const rejected = DoneGate.validateStructuredAcceptanceTable(tampered, { workspaceRoot: path.resolve(__dirname, '../../..') });
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reason, /机器验收身份不一致/);
  const pointTampered = JSON.parse(JSON.stringify(vars));
  pointTampered.implementation.acceptance_table[0].point = '任务验收: 可以删除原验收项';
  const pointRejected = DoneGate.validateStructuredAcceptanceTable(pointTampered, { workspaceRoot: path.resolve(__dirname, '../../..') });
  assert.strictEqual(pointRejected.ok, false);
  assert.match(pointRejected.reason, /consumer_point_drift/);
  const textTampered = JSON.parse(JSON.stringify(vars));
  textTampered.review.verification.acceptance_table[0].text = '可以删除原验收项';
  const textRejected = DoneGate.validateStructuredAcceptanceTable(textTampered, { workspaceRoot: path.resolve(__dirname, '../../..') });
  assert.strictEqual(textRejected.ok, false);
  assert.match(textRejected.reason, /consumer_machine_text_drift/);
}

function routeIntegrationMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-handoff-route-'));
  const artifacts = path.join(root, 'artifacts');
  const projects = path.join(root, 'projects');
  const configFile = path.join(root, 'config.json');
  const gateConfig = path.join(root, 'acceptance-handoff.json');
  const runner = path.resolve(__dirname, '../engine-runner.js');
  fs.mkdirSync(path.join(projects, '控制台'), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ runners: {}, roleRouting: {} }));
  fs.writeFileSync(gateConfig, JSON.stringify(Handoff.defaultConfig()));
  const env = Object.assign({}, process.env, {
    CONSOLE_CONFIG_PATH: configFile,
    CONSOLE_ARTIFACTS_DIR: artifacts,
    CONSOLE_PROJECTS_DIR: projects,
    ACCEPTANCE_HANDOFF_CONFIG: gateConfig,
    YUTU6_CEO_ELASTIC: '1',
    CONSOLE_CAPABILITY_PREFLIGHT: '0',
  });
  try {
    const activated = Handoff.activationDecision(activeConfig(), {
      workspaceRoot: WORKSPACE_ROOT,
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(activated.active, true);
    const simpleWithoutContract = EngineRunner.directSupervisorContractDecision({
      projectId: '控制台', goal: '普通记录整理', useOrchestrator: false,
    }, activated);
    assert.strictEqual(simpleWithoutContract.allowed, false);
    assert.match(simpleWithoutContract.reason, /requires orchestrator machine contract/);

    const exactAtomicText = '完整交接保持机器身份；分号内仍属同一验收原子';
    const upstream = AcceptanceContract.createContract([{ text: exactAtomicText, scope: PROJECT_SCOPE }], {
      stage: 'orchestrator', projectId: '控制台', rootTaskId: 'route-contract-valid',
      scope: PROJECT_SCOPE, sourceRef: 'orchestrator:route-contract-valid',
    });
    assert.strictEqual(EngineRunner.directSupervisorContractDecision({ acceptance_contract: upstream }, activated).allowed, true);
    const validSpecFile = path.join(root, 'valid-spec.json');
    fs.writeFileSync(validSpecFile, JSON.stringify({
      taskId: 'route-contract-valid', queueAgent: 'ceo', queueId: 'valid', flowId: 'project-route',
      projectId: '控制台', goal: '普通记录整理', acceptance: exactAtomicText,
      acceptance_contract: upstream, useOrchestrator: false,
    }));
    const valid = spawnSync(process.execPath, [runner, '--spec', validSpecFile], { cwd: path.resolve(__dirname, '../../..'), env, encoding: 'utf8' });
    assert.strictEqual(valid.status, 0, valid.stderr || valid.stdout);
    const validEvents = fs.readFileSync(path.join(artifacts, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(event => event.task === 'route-contract-valid');
    const routed = validEvents.find(event => event.type === 'project.routed');
    assert(routed && routed.queueId);
    assert(!validEvents.some(event => event.type === 'acceptance.handoff.rejected'));
    const child = Q.list(artifacts, 'supervisor-控制台').queued.find(entry => entry.id === routed.queueId);
    assert(child && child.task.acceptance_contract && child.task.acceptance_contract.schema === 'acceptance-contract@1');
    assert(Array.isArray(child.task.requiredRows) && child.task.requiredRows.every(row => row.text && row.acceptance_id && row.source_hash && row.scope));
    assert.strictEqual(child.task.requiredRows.length, 3, 'one upstream atom plus delivery and visual rows must remain three machine rows');
    assert(child.task.requiredRows.some(row => row.point === `任务验收: ${exactAtomicText}`), 'semicolon-bearing atom must not be split or rewritten');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function postJson(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.end(payload);
  });
}

async function serverRecoveryApiMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-handoff-api-'));
  const previous = {
    artifacts: process.env.CONSOLE_ARTIFACTS_DIR,
    disabled: process.env.QUEUE_WORKER_DISABLED,
    port: process.env.PORT,
    aliases: process.env.CONSOLE_ALIAS_PORTS,
  };
  let server = null;
  try {
    process.env.CONSOLE_ARTIFACTS_DIR = root;
    process.env.QUEUE_WORKER_DISABLED = '1';
    process.env.PORT = '0';
    process.env.CONSOLE_ALIAS_PORTS = '';
    const serverPath = require.resolve('../server');
    delete require.cache[serverPath];
    const ConsoleServer = require('../server');
    const upstream = createUpstream(2);
    const complete = downstreamFrom(upstream, [systemRecord('任务验收: API 恢复交付行')]);
    const missing = AcceptanceContract.createContract(complete.records.slice(1), {
      stage: 'supervisor-requiredRows', projectId: '控制台', rootTaskId: 'root-contract-test', pointPrefix: '',
    });
    const rejected = Handoff.evaluateBeforeEnqueue({
      workspaceRoot: WORKSPACE_ROOT,
      artifactsRoot: root,
      taskId: 'api-recovery-task',
      projectId: '控制台',
      scope: PROJECT_SCOPE,
      queueAgent: 'ceo',
      queueId: 'api-recovery-q',
      upstreamContract: upstream,
      downstreamContract: missing,
      config: activeConfig(),
      evidenceVerifier: trustFixtureEvidence,
    });
    assert.strictEqual(rejected.ok, false);
    Q.enqueue(root, 'ceo', { goal: 'API 恢复夹具' }, { id: 'api-recovery-q' });
    assert(Q.claim(root, 'ceo'));
    Q.finish(root, 'ceo', 'api-recovery-q', 'paused', { taskId: 'api-recovery-task' });

    server = http.createServer(ConsoleServer.handler);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    const replacementUpstream = createUpstream(2, { texts: ['可以替换原上游一', '可以替换原上游二'] });
    const replacementDownstream = downstreamFrom(replacementUpstream, [systemRecord('任务验收: 伪造替换交付行')]);
    const replacementAttempt = await postJson(port, '/api/queue/ceo/api-recovery-q/acceptance-handoff-recover', {
      taskId: 'api-recovery-task',
      upstreamContract: replacementUpstream,
      correctedDownstreamContract: replacementDownstream,
      confirmation: {
        decision: 'approve_corrected_contract',
        task_id: 'api-recovery-task',
        reviewed_by: 'owner-api-fixture',
      },
    });
    assert.strictEqual(replacementAttempt.status, 409);
    assert.strictEqual(replacementAttempt.body.error, 'corrected_contract_invalid');
    assert.strictEqual(readJsonFile(rejected.reviewFile).upstream_contract_id, upstream.contract_id);
    assert.strictEqual(readJsonFile(rejected.reviewFile).retry_count, 1);

    const response = await postJson(port, '/api/queue/ceo/api-recovery-q/acceptance-handoff-recover', {
      taskId: 'api-recovery-task',
      correctedDownstreamContract: complete,
      confirmation: {
        decision: 'approve_corrected_contract',
        task_id: 'api-recovery-task',
        reviewed_by: 'owner-api-fixture',
      },
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(Q.list(root, 'ceo').queued.filter(entry => entry.id === 'api-recovery-q').length, 1);
    assert.strictEqual(readJsonFile(rejected.reviewFile).state, 'recovered');

    const duplicate = await postJson(port, '/api/queue/ceo/api-recovery-q/acceptance-handoff-recover', {
      taskId: 'api-recovery-task',
      correctedDownstreamContract: complete,
      confirmation: {
        decision: 'approve_corrected_contract',
        task_id: 'api-recovery-task',
        reviewed_by: 'owner-api-fixture',
      },
    });
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(Q.list(root, 'ceo').queued.filter(entry => entry.id === 'api-recovery-q').length, 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previous.artifacts == null) delete process.env.CONSOLE_ARTIFACTS_DIR; else process.env.CONSOLE_ARTIFACTS_DIR = previous.artifacts;
    if (previous.disabled == null) delete process.env.QUEUE_WORKER_DISABLED; else process.env.QUEUE_WORKER_DISABLED = previous.disabled;
    if (previous.port == null) delete process.env.PORT; else process.env.PORT = previous.port;
    if (previous.aliases == null) delete process.env.CONSOLE_ALIAS_PORTS; else process.env.CONSOLE_ALIAS_PORTS = previous.aliases;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runConcurrentValidationWorker(workerData) {
  const source = `
    const { parentPort, workerData } = require('worker_threads');
    const { performance } = require('perf_hooks');
    const AcceptanceContract = require(workerData.modulePath);
    const latencies = [];
    for (let index = 0; index < workerData.iterations; index += 1) {
      const started = performance.now();
      const result = AcceptanceContract.validateHandoff(workerData.upstream, workerData.downstream, {
        scope: workerData.scope,
        timeoutMs: 100,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      latencies.push(performance.now() - started);
    }
    parentPort.postMessage(latencies);
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`validation worker exited ${code}`)); });
  });
}

async function performanceMatrix() {
  const large = createUpstream(10000);
  const largeDownstream = downstreamFrom(large);
  const largeStart = performance.now();
  const largeResult = AcceptanceContract.validateHandoff(large, largeDownstream, { scope: PROJECT_SCOPE, timeoutMs: 500 });
  const largeMs = performance.now() - largeStart;
  assert.strictEqual(largeResult.ok, true, JSON.stringify(largeResult.errors));
  assert(largeMs <= 500, `10k validation exceeded 500ms: ${largeMs.toFixed(3)}ms`);

  const batch = createUpstream(200);
  const batchDownstream = downstreamFrom(batch);
  const workerCount = 8;
  const totalBatches = 100;
  const batchStart = performance.now();
  const workerRuns = await Promise.all(Array.from({ length: workerCount }, (_, index) => runConcurrentValidationWorker({
    modulePath: require.resolve('../../../shared/engine/acceptance-contract'),
    upstream: batch,
    downstream: batchDownstream,
    scope: PROJECT_SCOPE,
    iterations: Math.floor(totalBatches / workerCount) + (index < totalBatches % workerCount ? 1 : 0),
  })));
  const totalMs = performance.now() - batchStart;
  const latencies = workerRuns.flat();
  assert.strictEqual(latencies.length, totalBatches);
  latencies.sort((a, b) => a - b);
  const p95Ms = latencies[Math.ceil(latencies.length * 0.95) - 1];
  assert(totalMs <= 1000, `8-worker 100x200 validation exceeded 1000ms: ${totalMs.toFixed(3)}ms`);
  assert(p95Ms <= 20, `100x200 P95 exceeded 20ms: ${p95Ms.toFixed(3)}ms`);
  return { large_records: 10000, large_ms: Number(largeMs.toFixed(3)), workers: workerCount, batches: totalBatches, records_per_batch: 200, total_ms: Number(totalMs.toFixed(3)), p95_ms: Number(p95Ms.toFixed(3)) };
}

async function main() {
  functionalMatrix();
  lifecycleMatrix();
  recoveryGuardMatrix();
  orchestratorOutputContractMatrix();
  productionActivationMatrix();
  activationEvidenceMatrix();
  doneGateIdentityMatrix();
  routeIntegrationMatrix();
  await serverRecoveryApiMatrix();
  const performance = await performanceMatrix();
  console.log(JSON.stringify({ pass: true, suite: 'acceptance-handoff', scenarios: 44, performance }));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
