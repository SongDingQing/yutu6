#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../../../shared/engine/queue');
const Receipts = require('../independent-role-receipts');

function jsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify({ independent_receipt: value }, null, 2)}\n\`\`\``;
}

function requirement(role, extra = {}) {
  return Object.assign({
    role,
    goal: `${role} 独立复核本轮实现`,
    acceptance: `${role} 必须给出独立证据与 verdict`,
    timeoutMs: 200,
    maxAttempts: 2,
  }, extra);
}

function baseSpec(taskId = 'parent-task-1') {
  return {
    taskId,
    queueAgent: 'supervisor-控制台',
    queueId: 'parent-q-1',
    rootQueueAgent: 'ceo',
    rootQueueId: 'root-q-1',
    rootTaskId: 'root-task-1',
    projectId: '控制台',
    bounds: '只读复核明确证据；密钥不回显。',
    requiredIndependentReceipts: [requirement('quality_ops'), requirement('governance')],
  };
}

function claimRole(queueRoot, role) {
  const entry = Q.claim(queueRoot, role);
  assert(entry, `${role} assignment must be actually enqueued`);
  assert.strictEqual(entry.task.role, role);
  assert.strictEqual(entry.task.flowId, 'agent-once');
  assert.strictEqual(entry.task.rootQueueAgent, 'ceo');
  assert.strictEqual(entry.task.rootQueueId, 'root-q-1');
  assert.strictEqual(entry.task.rootTaskId, 'root-task-1');
  assert(entry.task.independentReceipt && entry.task.independentReceipt.role === role);
  return entry;
}

function runSpec(entry, role, taskId) {
  return Object.assign({}, entry.task, {
    taskId,
    queueAgent: role,
    queueId: entry.id,
    role,
  });
}

function validReceipt(spec, extra = {}) {
  const common = {
    schemaVersion: Receipts.RECEIPT_SCHEMA,
    role: spec.role,
    queueId: spec.queueId,
    taskId: spec.taskId,
    rootTaskId: spec.rootTaskId,
    verdict: 'pass',
    evidence: [{ path: `projects/控制台/artifacts/${spec.role}-evidence.json`, summary: `${spec.role} 独立复核证据` }],
    completedAt: '2026-07-16T05:30:00.000Z',
  };
  if (spec.role === 'quality_ops') Object.assign(common, { qualityScore: 96, checks: ['schema', 'tests', 'evidence'] });
  else Object.assign(common, { complianceCheckResult: 'pass', findings: [] });
  return Object.assign(common, extra);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function eventLogPath(workspaceRoot) {
  return path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'engine-events.jsonl');
}

function appendTraceEvent(workspaceRoot, trace, extra = {}) {
  const file = eventLogPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length : 0;
  const event = Object.assign({
    seq: existing + 1,
    ts: trace.finished_at,
    type: 'interaction.trace.finished',
    task: trace.task_id,
    rootTaskId: trace.root_task_id,
    chainId: `chain-${trace.task_id}`,
    traceId: trace.trace_id,
    node: trace.node_id,
    role: trace.agent_role,
    runner: trace.runner_id,
    status: trace.status,
    latency_ms: Date.parse(trace.finished_at) - Date.parse(trace.started_at),
  }, extra);
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
  return event;
}

function writeInteractionTrace(workspaceRoot, spec, resultText, extra = {}) {
  const finishedAt = extra.finishedAt || JSON.parse(resultText.match(/```json\s*([\s\S]*?)```/)[1]).independent_receipt.completedAt;
  const startedAt = extra.startedAt || new Date(Date.parse(finishedAt) - 30000).toISOString();
  const nodeDir = path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'engine-runs', spec.taskId, `execute-1-${spec.role}`);
  fs.mkdirSync(nodeDir, { recursive: true });
  const taskText = `independent review prompt for ${spec.role} ${spec.taskId}\n`;
  const taskFile = path.join(nodeDir, 'task.md');
  const resultFile = path.join(nodeDir, 'result.md');
  fs.writeFileSync(taskFile, taskText);
  fs.writeFileSync(resultFile, resultText);
  const rel = file => path.relative(workspaceRoot, file);
  const manifestFile = path.join(nodeDir, 'interaction-trace.json');
  const trace = {
    schema: 'yutu6-interaction-trace@1',
    chain_id: `chain-${spec.taskId}`,
    trace_id: extra.traceId || `trace-${sha256(`${spec.taskId}|${spec.role}`).slice(0, 24)}`,
    root_task_id: spec.rootTaskId,
    task_id: spec.taskId,
    node_id: 'execute',
    agent_role: spec.role,
    agent_id: spec.role,
    runner_id: extra.runnerId || 'codex',
    runner_kind: extra.runnerKind || 'cli',
    queue_agent: spec.queueAgent,
    queue_id: spec.queueId,
    started_at: startedAt,
    finished_at: finishedAt,
    status: 'completed',
    hidden_chain_of_thought_saved: false,
    prompt: {
      raw_path: rel(taskFile),
      redacted_path: rel(taskFile),
      sha256: extra.promptSha256 || sha256(taskText),
      chars: taskText.length,
    },
    output: {
      raw_path: rel(resultFile),
      redacted_path: rel(resultFile),
      sha256: extra.outputSha256 || sha256(resultText),
      chars: resultText.length,
    },
    evidence_refs: [rel(taskFile), rel(resultFile)],
    manifest_path: rel(manifestFile),
  };
  fs.writeFileSync(manifestFile, JSON.stringify(trace, null, 2) + '\n');
  if (extra.writeEvent !== false) appendTraceEvent(workspaceRoot, trace, extra.event || {});
  return trace;
}

function writeParentTraceWindow(workspaceRoot, taskId, startedAt, finishedAt) {
  const nodeDir = path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'engine-runs', taskId, 'implement-1');
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, 'interaction-trace.json'), JSON.stringify({
    schema: 'yutu6-interaction-trace@1',
    trace_id: `trace-parent-${sha256(taskId).slice(0, 12)}`,
    task_id: taskId,
    agent_role: 'worker_code',
    status: 'completed',
    started_at: startedAt,
    finished_at: finishedAt,
  }, null, 2) + '\n');
}

function writeEvidence(workspaceRoot, role) {
  const file = path.join(workspaceRoot, 'projects', '控制台', 'artifacts', `${role}-evidence.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    role,
    independent: true,
    reviewer_task_path: `/self-claimed/${role}`,
  }) + '\n');
}

async function reliableChain(root) {
  const queueRoot = path.join(root, 'artifacts');
  const workspaceRoot = path.join(root, 'workspace');
  writeEvidence(workspaceRoot, 'quality_ops');
  writeEvidence(workspaceRoot, 'governance');
  writeParentTraceWindow(workspaceRoot, 'parent-task-1', '2026-07-16T04:00:00.000Z', '2026-07-16T05:00:00.000Z');
  const events = [];
  const opts = {
    queueRoot,
    workspaceRoot,
    eventlog: { emit(type, payload) { events.push(Object.assign({ type }, payload || {})); } },
  };
  const spec = baseSpec();

  assert.throws(
    () => Receipts.normalizedRequirements([requirement('quality_ops')]),
    /at least 2 distinct roles/,
    'independent mode must not accept a single reviewer role'
  );

  // 覆盖证据文本出现角色名不得自激触发；只有 structured field 才触发。
  const noTrigger = Receipts.ensureAssignments(Object.assign({}, spec, {
    taskId: 'no-trigger', rootTaskId: 'no-trigger-root', requiredIndependentReceipts: null,
    goal: 'quality_ops governance evidence should not trigger from text',
    acceptance: '等待独立回执字样也不能触发',
  }), opts);
  assert.strictEqual(noTrigger.required, false);

  const first = Receipts.ensureAssignments(spec, opts);
  assert.strictEqual(first.required, true);
  assert.strictEqual(first.state.schemaVersion, Receipts.STATE_SCHEMA);
  assert.strictEqual(Object.keys(first.state.assignments).length, 2);
  assert.strictEqual(events.filter(event => event.type === 'queue.enqueued').length, 2);
  assert(events.every(event => event.type !== 'queue.enqueued' || event.rootTaskId === 'root-task-1'));
  Receipts.ensureAssignments(spec, opts);
  assert.strictEqual(Q.list(queueRoot, 'quality_ops').queued.length, 1, 'repeated coordinator call must not duplicate quality_ops');
  assert.strictEqual(Q.list(queueRoot, 'governance').queued.length, 1, 'repeated coordinator call must not duplicate governance');
  assert.throws(() => Receipts.ensureAssignments(Object.assign({}, spec, {
    requiredIndependentReceipts: [requirement('quality_ops', { acceptance: '被篡改的验收' }), requirement('governance')],
  }), opts), /requirement conflict/, '已持久化回执要求不得在恢复时漂移');

  const qopsEntry = claimRole(queueRoot, 'quality_ops');
  const governanceEntry = claimRole(queueRoot, 'governance');
  const qopsSpec = runSpec(qopsEntry, 'quality_ops', 'quality-task-1');
  const governanceSpec = runSpec(governanceEntry, 'governance', 'governance-task-1');

  // worker_code 不能拿 quality_ops assignment metadata 冒名提交。
  const impersonated = Receipts.commitRunReceipt(Object.assign({}, qopsSpec, {
    queueAgent: 'worker_code', role: 'worker_code',
  }), jsonBlock(validReceipt(qopsSpec)), opts);
  assert.strictEqual(impersonated.ok, false);
  assert.strictEqual(impersonated.reason, 'producer_queue_role_mismatch');
  assert.strictEqual(Receipts._test.extractReceipt(`前缀\n${jsonBlock(validReceipt(qopsSpec))}`).reason, 'receipt_extra_text');
  assert.strictEqual(Receipts._test.extractReceipt(`${jsonBlock(validReceipt(qopsSpec))}\n\`\`\`json\n{}\n\`\`\``).reason, 'multiple_json_blocks');
  assert.strictEqual(Receipts._test.extractReceipt('```json\n{"wrong":{}}\n```').reason, 'receipt_root_invalid');

  const selfClaimedOnly = Receipts.commitRunReceipt(qopsSpec, jsonBlock(validReceipt(qopsSpec)), opts);
  assert.strictEqual(selfClaimedOnly.ok, false, 'an evidence file self-claim cannot replace a system trace');
  assert.strictEqual(selfClaimedOnly.reason, 'provenance_trace_missing');

  const qopsText = jsonBlock(validReceipt(qopsSpec));
  writeInteractionTrace(workspaceRoot, qopsSpec, qopsText, {
    promptSha256: '0'.repeat(64),
    writeEvent: false,
  });
  const badPromptHash = Receipts.commitRunReceipt(qopsSpec, qopsText, opts);
  assert.strictEqual(badPromptHash.ok, false);
  assert.strictEqual(badPromptHash.reason, 'provenance_prompt_hash_mismatch');

  const qopsTrace = writeInteractionTrace(workspaceRoot, qopsSpec, qopsText, { writeEvent: false });
  const missingTerminal = Receipts.commitRunReceipt(qopsSpec, qopsText, opts);
  assert.strictEqual(missingTerminal.ok, false);
  assert.strictEqual(missingTerminal.reason, 'provenance_terminal_event_missing');
  appendTraceEvent(workspaceRoot, qopsTrace);

  const qopsCommit = Receipts.commitRunReceipt(qopsSpec, qopsText, opts);
  assert.strictEqual(qopsCommit.ok, true, JSON.stringify(qopsCommit));
  assert.strictEqual(qopsCommit.gateStatus, 'verified');
  assert.strictEqual(qopsCommit.provenance.taskId, qopsSpec.taskId);
  assert.strictEqual(qopsCommit.provenance.traceId, qopsTrace.trace_id);
  assert.strictEqual(qopsCommit.provenance.runner.id, 'codex');
  assert.strictEqual(qopsCommit.provenance.prompt.sha256, qopsTrace.prompt.sha256);
  assert.strictEqual(qopsCommit.provenance.output.sha256, qopsTrace.output.sha256);
  assert.strictEqual(qopsCommit.provenance.terminalEvent.type, 'interaction.trace.finished');
  assert.strictEqual(Receipts.commitRunReceipt(qopsSpec, qopsText, opts).duplicate, true, 'same provenance receipt must be idempotent');
  Q.finish(queueRoot, 'quality_ops', qopsEntry.id, 'done', { taskId: qopsSpec.taskId });

  // 严格 schema:未知字段会让本次角色任务失败；协调器随后投递 attempt 2。
  const invalidGovernance = validReceipt(governanceSpec, { workerCodeSummary: '冒名补写' });
  const badCommit = Receipts.commitRunReceipt(governanceSpec, jsonBlock(invalidGovernance), opts);
  assert.strictEqual(badCommit.ok, false);
  assert.match(badCommit.reason, /receipt_unknown_fields/);
  Q.finish(queueRoot, 'governance', governanceEntry.id, 'failed', { taskId: governanceSpec.taskId });

  const retried = Receipts.ensureAssignments(spec, opts);
  assert.strictEqual(retried.state.assignments.governance.attempts, 2);
  const governanceRetry = claimRole(queueRoot, 'governance');
  assert.notStrictEqual(governanceRetry.id, governanceEntry.id);
  const governanceRetrySpec = runSpec(governanceRetry, 'governance', 'governance-task-2');
  const governanceReceipt = validReceipt(governanceRetrySpec, { completedAt: '2026-07-16T05:31:00.000Z' });
  const governanceText = jsonBlock(governanceReceipt);
  writeInteractionTrace(workspaceRoot, governanceRetrySpec, governanceText, {
    runnerId: 'claude-fable-5',
    finishedAt: governanceReceipt.completedAt,
  });
  const govCommit = Receipts.commitRunReceipt(governanceRetrySpec, governanceText, opts);
  assert.strictEqual(govCommit.ok, true, JSON.stringify(govCommit));
  Q.finish(queueRoot, 'governance', governanceRetry.id, 'done', { taskId: governanceRetrySpec.taskId });

  const completed = await Receipts.waitForReceipts(spec, Object.assign({}, opts, { timeoutMs: 100, pollMs: 5 }));
  assert.strictEqual(completed.ok, true, JSON.stringify(completed));
  assert.strictEqual(completed.gateStatus, 'pass');
  assert.strictEqual(completed.independenceStrength, 'strong');
  assert.deepStrictEqual(completed.warnings, []);
  assert.deepStrictEqual(completed.receipts.map(receipt => receipt.role).sort(), ['governance', 'quality_ops']);
  assert.strictEqual(completed.provenances.length, 2);
  assert.strictEqual(new Set(completed.provenances.map(item => item.taskId)).size, 2);
  assert.strictEqual(new Set(completed.provenances.map(item => item.traceId)).size, 2);
  const state = JSON.parse(fs.readFileSync(Receipts._test.stateFile(queueRoot, 'root-task-1', 'parent-task-1'), 'utf8'));
  assert.strictEqual(state.status, 'completed');
  assert.strictEqual(state.assignments.quality_ops.status, 'delivered');
  assert.strictEqual(state.assignments.governance.status, 'delivered');
  for (const assignment of Object.values(state.assignments)) {
    const file = path.join(queueRoot, assignment.receiptFile);
    assert(fs.existsSync(file));
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(record.schemaVersion, Receipts.PROVENANCE_SCHEMA);
    assert(record.review && record.provenance);
    assert.strictEqual(record.provenance.role, assignment.role);
  }
  const qopsRecordFile = path.join(queueRoot, state.assignments.quality_ops.receiptFile);
  const qopsRecord = JSON.parse(fs.readFileSync(qopsRecordFile, 'utf8'));
  const tamperedRecord = JSON.parse(JSON.stringify(qopsRecord));
  tamperedRecord.provenance.prompt.sha256 = 'f'.repeat(64);
  const tamperedChecked = Receipts._test.validateCommittedRecord(
    tamperedRecord,
    { role: qopsSpec.role, queueId: qopsSpec.queueId, taskId: qopsSpec.taskId, rootTaskId: qopsSpec.rootTaskId },
    opts,
    'required'
  );
  assert.strictEqual(tamperedChecked.ok, false);
  assert.strictEqual(tamperedChecked.reason, 'provenance_record_tampered');
  assert(events.some(event => event.type === 'role.receipt.rejected' && event.reason === 'producer_queue_role_mismatch'));
  assert(events.some(event => event.type === 'role.receipt.chain.completed'));
  assert(events.some(event => event.type === 'role.receipt.delivered' && event.traceId && event.promptSha256 && event.outputSha256));

  const duplicateTrace = Receipts._test.evaluateIndependence({ parentTaskId: 'no-parent' }, [
    completed.provenances[0],
    Object.assign({}, completed.provenances[1], { traceId: completed.provenances[0].traceId }),
  ], opts);
  assert.strictEqual(duplicateTrace.ok, false);
  assert.strictEqual(duplicateTrace.gateStatus, 'blocked');
  assert.strictEqual(duplicateTrace.reason, 'independent_provenance_duplicate_traceId');

  const sharedRunner = Receipts._test.evaluateIndependence({ parentTaskId: 'no-parent' }, [
    completed.provenances[0],
    Object.assign({}, completed.provenances[1], {
      runner: Object.assign({}, completed.provenances[1].runner, { id: completed.provenances[0].runner.id }),
    }),
  ], opts);
  assert.strictEqual(sharedRunner.ok, true);
  assert.strictEqual(sharedRunner.gateStatus, 'warning');
  assert.strictEqual(sharedRunner.independenceStrength, 'weak');
  assert(sharedRunner.warnings.some(item => item.startsWith('shared_runner:codex:')));

  writeParentTraceWindow(workspaceRoot, 'containing-parent', '2026-07-16T05:00:00.000Z', '2026-07-16T06:00:00.000Z');
  const contained = Receipts._test.evaluateIndependence({ parentTaskId: 'containing-parent' }, [completed.provenances[0]], opts);
  assert.strictEqual(contained.ok, false);
  assert.match(contained.reason, /^independent_provenance_contained_by_parent:/);

  const bareReceipt = Receipts._test.validateCommittedRecord(
    validReceipt(qopsSpec),
    { role: qopsSpec.role, queueId: qopsSpec.queueId, taskId: qopsSpec.taskId, rootTaskId: qopsSpec.rootTaskId },
    opts
  );
  assert.strictEqual(bareReceipt.ok, false, 'a receipt without system provenance must never be accepted');
  assert.strictEqual(bareReceipt.reason, 'provenance_record_missing');

  const symlinkEvidence = path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'symlink-evidence.json');
  fs.symlinkSync(path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'quality_ops-evidence.json'), symlinkEvidence);
  const symlinkChecked = Receipts.validateEvidenceFiles([
    { path: path.relative(workspaceRoot, symlinkEvidence), summary: '符号链接不得充当独立证据' },
  ], workspaceRoot);
  assert.strictEqual(symlinkChecked.ok, false);
  assert.strictEqual(symlinkChecked.reason, 'receipt_evidence_path_symlink');

  const symlinkTraceDir = path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'engine-runs', 'symlink-task', 'execute-1');
  fs.mkdirSync(symlinkTraceDir, { recursive: true });
  fs.symlinkSync(
    path.join(workspaceRoot, qopsTrace.manifest_path),
    path.join(symlinkTraceDir, 'interaction-trace.json')
  );
  assert.deepStrictEqual(Receipts._test.interactionTraceFiles(workspaceRoot, 'symlink-task'), []);

  // 同一 CEO 根任务下的两个父任务必须使用独立状态目录，不能互相覆盖或报 identity conflict。
  const sibling = Object.assign({}, baseSpec('parent-task-2'), {
    queueId: 'parent-q-2',
    requiredIndependentReceipts: [requirement('quality_ops'), requirement('governance')],
  });
  const siblingResult = Receipts.ensureAssignments(sibling, opts);
  assert.strictEqual(siblingResult.required, true);
  assert.strictEqual(siblingResult.state.parentTaskId, 'parent-task-2');
  assert(fs.existsSync(Receipts._test.stateFile(queueRoot, 'root-task-1', 'parent-task-2')));
  assert.notStrictEqual(
    Receipts._test.stateFile(queueRoot, 'root-task-1', 'parent-task-1'),
    Receipts._test.stateFile(queueRoot, 'root-task-1', 'parent-task-2')
  );
}

async function policyBoundaryRegression(root) {
  const queueRoot = path.join(root, 'policy-boundary-artifacts');
  const workspaceRoot = path.join(root, 'policy-boundary-workspace');
  const spec = Object.assign({}, baseSpec('policy-boundary-parent'), {
    queueId: 'policy-boundary-parent-q',
    rootTaskId: 'policy-boundary-root',
  });
  const opts = { queueRoot, workspaceRoot };
  const first = Receipts.ensureAssignments(spec, opts);
  const file = Receipts._test.stateFile(queueRoot, spec.rootTaskId, spec.taskId);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(state.schemaVersion, Receipts.STATE_SCHEMA);
  delete state.provenancePolicy;
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');

  const blocked = await Receipts.waitForReceipts(spec, Object.assign({}, opts, { timeoutMs: 100, pollMs: 5 }));
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.gateStatus, 'blocked');
  assert.strictEqual(blocked.reason, 'independent_provenance_policy_invalid:provenance_policy_missing');
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(persisted.provenancePolicy, undefined, 'missing policy must not be rewritten as a legacy exemption');
  assert.strictEqual(persisted.observabilityStatus, 'blocked');
  assert(persisted.warnings.includes('provenance_policy_missing'));
  assert.strictEqual(first.state.assignments.quality_ops.attempts, 1);

  const downgradedV1 = Object.assign({}, persisted, {
    schemaVersion: Receipts.BUS_SCHEMA,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.deepStrictEqual(Receipts._test.classifyStatePolicy(downgradedV1), {
    mode: 'blocked',
    reason: 'state_schema_unsupported',
  });
}

async function legacySpoofRegression(root) {
  const queueRoot = path.join(root, 'legacy-spoof-artifacts');
  const workspaceRoot = path.join(root, 'legacy-spoof-workspace');
  writeEvidence(workspaceRoot, 'quality_ops');
  writeEvidence(workspaceRoot, 'governance');
  const spec = Object.assign({}, baseSpec('legacy-spoof-parent'), {
    queueId: 'legacy-spoof-parent-q',
  });
  const opts = { queueRoot, workspaceRoot };
  const created = Receipts.ensureAssignments(spec, opts);
  const stateFile = Receipts._test.stateFile(queueRoot, spec.rootTaskId, spec.taskId);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  for (const role of ['quality_ops', 'governance']) {
    const entry = claimRole(queueRoot, role);
    const childSpec = runSpec(entry, role, `legacy-spoof-${role}-task`);
    const receipt = validReceipt(childSpec);
    const file = Receipts._test.receiptFile(
      queueRoot,
      spec.rootTaskId,
      spec.taskId,
      created.state.assignments[role].receiptId
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    Q.finish(queueRoot, role, entry.id, 'done', { taskId: childSpec.taskId });
  }

  state.schemaVersion = Receipts.BUS_SCHEMA;
  state.createdAt = '2026-01-01T00:00:00.000Z';
  delete state.provenancePolicy;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  assert.deepStrictEqual(Receipts._test.classifyStatePolicy(state), {
    mode: 'blocked',
    reason: 'state_schema_unsupported',
  });

  const result = await Receipts.waitForReceipts(spec, Object.assign({}, opts, { timeoutMs: 100, pollMs: 5 }));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.gateStatus, 'blocked');
  assert.strictEqual(result.reason, 'independent_provenance_policy_invalid:state_schema_unsupported');
  assert.strictEqual(result.provenances.length, 0);
  assert.strictEqual(result.receipts.length, 0);
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(persisted.observabilityStatus, 'blocked');
  assert(persisted.warnings.includes('state_schema_unsupported'));
}

async function timeoutEscalation(root) {
  const queueRoot = path.join(root, 'timeout-artifacts');
  const workspaceRoot = path.join(root, 'timeout-workspace');
  const events = [];
  const spec = {
    taskId: 'timeout-parent',
    queueAgent: 'supervisor-控制台',
    queueId: 'timeout-parent-q',
    rootQueueAgent: 'ceo',
    rootQueueId: 'timeout-root-q',
    rootTaskId: 'timeout-root-task',
    projectId: '控制台',
    bounds: '只读',
    requiredIndependentReceipts: [
      requirement('quality_ops', { timeoutMs: 50, maxAttempts: 1 }),
      requirement('governance', { timeoutMs: 50, maxAttempts: 1 }),
    ],
  };
  const result = await Receipts.waitForReceipts(spec, {
    queueRoot,
    workspaceRoot,
    timeoutMs: 35,
    pollMs: 5,
    eventlog: { emit(type, payload) { events.push(Object.assign({ type }, payload || {})); } },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.paused, true);
  assert.strictEqual(result.reason, 'independent_receipt_timeout');
  assert.strictEqual(result.gateStatus, 'blocked');
  const state = JSON.parse(fs.readFileSync(Receipts._test.stateFile(queueRoot, 'timeout-root-task', 'timeout-parent'), 'utf8'));
  assert.strictEqual(state.status, 'escalated');
  assert.strictEqual(state.observabilityStatus, 'blocked');
  assert.strictEqual(state.assignments.quality_ops.attempts, 1);
  assert.strictEqual(state.assignments.governance.attempts, 1);
  assert(events.some(event => event.type === 'role.receipt.chain.escalated'));
}

async function attemptTimeoutRetry(root) {
  const queueRoot = path.join(root, 'attempt-timeout-artifacts');
  const workspaceRoot = path.join(root, 'attempt-timeout-workspace');
  const events = [];
  const spec = {
    taskId: 'attempt-timeout-parent',
    queueAgent: 'supervisor-控制台',
    queueId: 'attempt-timeout-parent-q',
    rootQueueAgent: 'ceo',
    rootQueueId: 'attempt-timeout-root-q',
    rootTaskId: 'attempt-timeout-root-task',
    projectId: '控制台',
    bounds: '只读',
    requiredIndependentReceipts: [
      requirement('quality_ops', { timeoutMs: 50, maxAttempts: 2 }),
      requirement('governance', { timeoutMs: 50, maxAttempts: 2 }),
    ],
  };
  const result = await Receipts.waitForReceipts(spec, {
    queueRoot,
    workspaceRoot,
    // 两个 50ms attempt 还要经过取消落终态与轮询；给足预算，避免并行测试负载
    // 把“第二次尚未取消”误判成生产状态机失败。
    timeoutMs: 300,
    pollMs: 5,
    eventlog: { emit(type, payload) { events.push(Object.assign({ type }, payload || {})); } },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.paused, true);
  const state = JSON.parse(fs.readFileSync(Receipts._test.stateFile(queueRoot, spec.rootTaskId, spec.taskId), 'utf8'));
  assert.strictEqual(state.assignments.quality_ops.attempts, 2, 'a timed-out queued assignment must retry up to maxAttempts');
  assert.strictEqual(state.assignments.quality_ops.queueIds.length, 2);
  assert.strictEqual(state.assignments.governance.attempts, 2);
  assert.strictEqual(state.assignments.governance.queueIds.length, 2);
  assert.strictEqual(Q.list(queueRoot, 'quality_ops').canceled, 2, 'each timed-out queued attempt must reach a terminal state');
  assert.strictEqual(Q.list(queueRoot, 'governance').canceled, 2, 'each reviewer role must independently reach a terminal state');
  assert.strictEqual(events.filter(event => event.type === 'role.receipt.assignment.timeout').length, 4);
}

function runningTimeoutWaitsForTerminal(root) {
  const queueRoot = path.join(root, 'running-timeout-artifacts');
  const workspaceRoot = path.join(root, 'running-timeout-workspace');
  let clock = Date.parse('2026-07-16T06:00:00.000Z');
  const opts = { queueRoot, workspaceRoot, now: () => clock };
  const spec = {
    taskId: 'running-timeout-parent',
    queueAgent: 'supervisor-控制台',
    queueId: 'running-timeout-parent-q',
    rootQueueAgent: 'ceo',
    rootQueueId: 'running-timeout-root-q',
    rootTaskId: 'running-timeout-root-task',
    projectId: '控制台',
    bounds: '只读',
    requiredIndependentReceipts: [
      requirement('quality_ops', { timeoutMs: 50, maxAttempts: 2 }),
      requirement('governance', { timeoutMs: 50, maxAttempts: 2 }),
    ],
  };
  const first = Receipts.ensureAssignments(spec, opts);
  const firstQueueId = first.state.assignments.quality_ops.activeQueueId;
  assert(Q.claim(queueRoot, 'quality_ops'));
  clock += 60;
  const cancelRequested = Receipts.ensureAssignments(spec, opts);
  assert.strictEqual(cancelRequested.state.assignments.quality_ops.attempts, 1, 'a still-running timed-out assignment must not race a duplicate retry');
  assert.strictEqual(Receipts._test.queueEntry(queueRoot, 'quality_ops', firstQueueId).status, 'canceling');
  Q.finish(queueRoot, 'quality_ops', firstQueueId, 'canceled', { taskId: 'timed-out-role-task' });
  clock += 1;
  const retried = Receipts.ensureAssignments(spec, opts);
  assert.strictEqual(retried.state.assignments.quality_ops.attempts, 2, 'retry starts only after the prior attempt is terminal');
  assert.notStrictEqual(retried.state.assignments.quality_ops.activeQueueId, firstQueueId);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-role-receipts-'));
  try {
    await reliableChain(root);
    await policyBoundaryRegression(root);
    await legacySpoofRegression(root);
    await timeoutEscalation(root);
    await attemptTimeoutRetry(root);
    runningTimeoutWaitsForTerminal(root);
    console.log(JSON.stringify({ pass: true, suite: 'independent-role-receipts', cases: 61 }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
