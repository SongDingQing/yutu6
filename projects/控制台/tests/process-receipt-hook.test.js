#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const Hook = require('../process-receipt-hook');
const QualityOpsAudit = require('../tools/quality-ops-audit');
const consoleConfig = require('../config.json');
const featureConfig = require('../config/process-receipts.json');
const stableEvidenceRef = 'projects/控制台/config/process-receipts.json';
const stableLineEvidenceRef = `${stableEvidenceRef}:1`;

const approvedConfig = Object.assign({}, featureConfig, {
  enabled: true,
  supervisorReviewed: true,
  ownerApproved: true,
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runnerAction(runner) {
  if (runner.kind === 'openai_http') return 'openai_http';
  if (runner.kind === 'openai_http_tool_harness') return 'tool_harness';
  return path.basename(String(runner.cmd && runner.cmd[0] || '')).replace(/^_+|_+$/g, '');
}

function legacySummary(runnerId, runner, exitCode = 0) {
  return {
    schema: 'yutu6-process-summary-redacted@1',
    command: {
      operation: 'runner.execute',
      runner_id: runnerId,
      runner_kind: runner.kind || 'cli',
      executable: runnerAction(runner),
      arguments_recorded: false,
    },
    exit_code: exitCode,
  };
}

function manifest(runnerId, runner, nodeId = 'execute', attempt = 1) {
  return {
    schema: 'yutu6-interaction-trace@1',
    trace_id: `trace-${runnerId}`,
    task_id: 'task-process-receipt-test',
    node_id: nodeId,
    attempt,
    runner_id: runnerId,
    runner_kind: runner.kind || 'cli',
    status: 'completed',
    evidence_refs: [stableEvidenceRef],
  };
}

function structuredResult(dir, runnerId) {
  return {
    vars: {
      implementation: {
        changed_files: [`projects/控制台/generated/${runnerId}.js`],
        receipt: {
          changedFiles: [`projects/控制台/generated/${runnerId}.js`],
          artifacts: [stableLineEvidenceRef],
        },
        logic_chain: {
          evidence: [{ kind: 'file', path: 'projects/控制台/quality-ops/schemas/process-summary.contract.schema.json#L1' }],
        },
      },
    },
    evidence: { type: 'result', runner: runnerId, path: path.join(dir, 'result.md') },
  };
}

function writeLegacyTrace(runsDir, nodeId, attempt, runnerId, runner) {
  const dir = path.join(runsDir, `${nodeId}-${attempt}-${runnerId}`);
  const trace = manifest(runnerId, runner, nodeId, attempt);
  trace.evidence_refs = [
    path.relative(workspaceRoot, path.join(dir, 'result.redacted.md')).split(path.sep).join('/'),
  ];
  writeJson(path.join(dir, 'interaction-trace.json'), trace);
  writeJson(path.join(dir, 'process-summary.redacted.log'), legacySummary(runnerId, runner));
  fs.writeFileSync(path.join(dir, 'result.md'), '{}\n');
  fs.writeFileSync(path.join(dir, 'result.redacted.md'), '{}\n');
  return dir;
}

async function run() {
  const cases = [];
  const boundary = {};
  assert.strictEqual(Hook.activationDecision(featureConfig).active, false);
  assert.strictEqual(Hook.activationDecision(featureConfig).reason, 'feature_disabled');
  assert.strictEqual(Hook.activationDecision(Object.assign({}, featureConfig, { enabled: true })).reason, 'supervisor_review_missing');
  assert.strictEqual(Hook.activationDecision(Object.assign({}, approvedConfig, { ownerApproved: false })).reason, 'owner_approval_missing');
  assert.strictEqual(Hook.activationDecision(approvedConfig).active, true);
  assert.strictEqual(Hook.activationDecision(approvedConfig, { CONSOLE_PROCESS_RECEIPTS: '0' }).reason, 'environment_kill_switch');
  cases.push('activation-fail-closed');

  for (const [runnerId, runner] of Object.entries(consoleConfig.runners || {})) {
    const dir = path.join(workspaceRoot, 'projects/控制台/artifacts/engine-runs/task-process-receipt-test', `execute-1-${runnerId}`);
    const summary = Hook.buildProcessSummary({
      config: approvedConfig,
      manifest: manifest(runnerId, runner),
      legacySummary: legacySummary(runnerId, runner),
      runner,
      result: structuredResult(dir, runnerId),
      now: '2026-07-17T00:00:00.000Z',
    });
    assert.strictEqual(summary.availability, 'available', `${runnerId} must produce the common contract`);
    assert.strictEqual(summary.actions.length, 1);
    assert.strictEqual(summary.actions[0].exit_code, 0);
    assert(featureConfig.allowedActionNames.includes(summary.actions[0].name), `${runnerId} action must be allowlisted`);
    assert(summary.affected_files.includes(`projects/控制台/generated/${runnerId}.js`));
    assert(summary.evidence_refs.length >= 1);
    assert.strictEqual(summary.security.hidden_chain_of_thought_saved, false);
    assert.strictEqual(summary.security.raw_sensitive_output_saved, false);
    assert(Hook._test.serializedJson(summary).length <= featureConfig.maxSummaryChars);
    assert(Hook.contractShapeValid(summary));
  }
  cases.push(`all-configured-runners-${Object.keys(consoleConfig.runners || {}).length}`);

  const unknown = Hook.buildProcessSummary({
    config: approvedConfig,
    manifest: Object.assign(manifest('unknown', { kind: 'cli' }), {
      evidence_refs: ['projects/控制台/artifacts/unknown/result.redacted.md'],
    }),
    legacySummary: { command: { executable: 'curl-with-secret-argument' }, exit_code: 0 },
    runner: { kind: 'cli', cmd: ['curl-with-secret-argument'] },
  });
  assert.strictEqual(unknown.availability, 'unavailable');
  assert.strictEqual(unknown.unavailable_reason, 'action_not_allowlisted');
  assert.deepStrictEqual(unknown.actions, []);
  assert(!JSON.stringify(unknown).includes('curl-with-secret-argument'));

  const missingExit = Hook.buildProcessSummary({
    config: approvedConfig,
    manifest: Object.assign(manifest('codex', consoleConfig.runners.codex), {
      evidence_refs: ['projects/控制台/artifacts/missing-exit/result.redacted.md'],
    }),
    legacySummary: { command: { executable: 'codex' }, exit_code: null },
    runner: consoleConfig.runners.codex,
  });
  assert.strictEqual(missingExit.availability, 'unavailable');
  assert.strictEqual(missingExit.unavailable_reason, 'exit_code_unavailable');
  cases.push('unavailable-and-action-allowlist');

  const constructedSecret = ['Bearer ', 'fixture-only-credential-12345'].join('');
  const secretSummary = Hook.buildProcessSummary({
    config: approvedConfig,
    manifest: Object.assign(manifest(constructedSecret, consoleConfig.runners.codex), {
      evidence_refs: [
        'projects/控制台/artifacts/probe.json?token=fixture-only-secret-98765',
        '/tmp/private-result.md',
        stableLineEvidenceRef,
      ],
    }),
    legacySummary: legacySummary('codex', consoleConfig.runners.codex),
    runner: consoleConfig.runners.codex,
    result: {
      vars: { implementation: { changed_files: ['../escape.txt', 'projects/控制台/safe.js'] } },
      evidence: { path: 'projects/控制台/safe.js' },
    },
  });
  const secretSerialized = JSON.stringify(secretSummary);
  assert(!secretSerialized.includes('fixture-only-credential-12345'));
  assert(!secretSerialized.includes('fixture-only-secret-98765'));
  assert(!secretSerialized.includes('/tmp/private-result.md'));
  assert(!secretSerialized.includes('../escape.txt'));
  assert(secretSummary.affected_files.includes('projects/控制台/safe.js'));
  assert(secretSummary.evidence_refs.includes(stableLineEvidenceRef));
  cases.push('redaction-and-path-boundary');

  const tempRoot = path.join(workspaceRoot, 'projects/控制台/artifacts');
  fs.mkdirSync(tempRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tempRoot, 'process-receipt-hook-test-'));
  try {
    const runsDir = path.join(temp, 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const syncDir = writeLegacyTrace(runsDir, 'execute', 1, 'codex', consoleConfig.runners.codex);
    const asyncDir = writeLegacyTrace(runsDir, 'review', 2, 'codex-privileged', consoleConfig.runners['codex-privileged']);
    const boardDir = writeLegacyTrace(runsDir, 'board', 3, 'deepseek-board-direct', consoleConfig.runners['deepseek-board-direct']);
    const base = function base(node, _ctx, attempt) {
      return structuredResult(syncDir, 'codex');
    };
    base.runNodeAsync = async () => structuredResult(asyncDir, 'codex-privileged');
    base.runBoardNodeAsync = async () => structuredResult(boardDir, 'deepseek-board-direct');
    const disabled = Hook.makeProcessReceiptRunner(base, {
      config: featureConfig,
      workspaceRoot,
      runsDir,
      runners: consoleConfig.runners,
    });
    assert.strictEqual(disabled, base, 'disabled production config must return the unchanged runner');

    const wrapped = Hook.makeProcessReceiptRunner(base, {
      config: approvedConfig,
      workspaceRoot,
      runsDir,
      runners: consoleConfig.runners,
      roleMap: { worker_code: 'codex' },
    });
    wrapped({ id: 'execute', agent_role: 'worker_code' }, {}, 1);
    await wrapped.runNodeAsync({ id: 'review', agent_role: 'supervisor' }, {}, 2);
    await wrapped.runBoardNodeAsync({ id: 'board', agent_role: 'board_deepseek' }, {}, 3);
    for (const dir of [syncDir, asyncDir, boardDir]) {
      const file = path.join(dir, Hook.SUMMARY_FILE);
      assert(fs.existsSync(file));
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.strictEqual(value.availability, 'available');
      assert.strictEqual(value.actions[0].exit_code, 0);
    }

    const unavailable = Hook.finalizeRunnerSummaries({
      config: approvedConfig,
      activation: Hook.activationDecision(approvedConfig),
      runsDir,
      runners: consoleConfig.runners,
      node: { id: 'missing', agent_role: 'worker_code' },
      attempt: 9,
      result: { fail: 'runner did not expose trace' },
    });
    assert.strictEqual(unavailable.files.length, 1);
    const unavailableValue = JSON.parse(fs.readFileSync(unavailable.files[0], 'utf8'));
    assert.strictEqual(unavailableValue.availability, 'unavailable');
    assert.strictEqual(unavailableValue.unavailable_reason, 'runner_trace_unavailable');
    const throwRuns = path.join(temp, 'throw-runs');
    fs.mkdirSync(throwRuns, { recursive: true });
    const throwingRunner = Hook.makeProcessReceiptRunner(() => { throw new Error('fixture runner failure'); }, {
      config: approvedConfig,
      workspaceRoot,
      runsDir: throwRuns,
      runners: consoleConfig.runners,
      roleMap: { worker_code: 'codex' },
    });
    assert.throws(() => throwingRunner({ id: 'throwing', agent_role: 'worker_code' }, {}, 1), /fixture runner failure/);
    const throwSummaryFile = path.join(throwRuns, 'process-summary-unavailable', 'throwing-1', Hook.SUMMARY_FILE);
    assert(fs.existsSync(throwSummaryFile));
    assert.strictEqual(JSON.parse(fs.readFileSync(throwSummaryFile, 'utf8')).unavailable_reason, 'runner_trace_unavailable');
    cases.push('sync-async-board-and-unavailable-sidecars');

    const qopsEvidenceDir = path.join(temp, 'quality-ops-evidence');
    const qopsEvidenceFiles = ['batch.json', 'findings.json', 'result.json'].map(name => path.join(qopsEvidenceDir, name));
    qopsEvidenceFiles.forEach((file, index) => writeJson(file, { fixture: index }));
    const qopsEvidenceRefs = qopsEvidenceFiles.map(file => path.relative(workspaceRoot, file).split(path.sep).join('/'));

    const receiptResult = QualityOpsAudit.recordIngestReceipt({
      actionId: 'audit-fixture:batch-01',
      taskId: 'quality-ops-fixture',
      exitCode: 0,
      finalState: 'completed',
      affectedFiles: [
        'projects/控制台/artifacts/quality-ops/audits/fixture/results/batch-01.json',
        'projects/控制台/artifacts/quality-ops/review-ledger.json',
      ],
      evidenceRefs: qopsEvidenceRefs,
    }, {
      config: approvedConfig,
      activation: Hook.activationDecision(approvedConfig),
      receiptsRoot: path.join(temp, 'receipts'),
    });
    assert.strictEqual(receiptResult.active, true);
    assert(fs.existsSync(receiptResult.file));
    const receipt = JSON.parse(fs.readFileSync(receiptResult.file, 'utf8'));
    assert.strictEqual(receipt.schema, Hook.RECEIPT_SCHEMA);
    assert.strictEqual(receipt.action.name, 'quality_ops_ingest');
    assert.strictEqual(receipt.action.exit_code, 0);
    assert.strictEqual(receipt.security.hidden_chain_of_thought_saved, false);
    assert.strictEqual(receipt.security.raw_sensitive_output_saved, false);
    assert(Hook._test.serializedJson(receipt).length <= featureConfig.maxSummaryChars);
    assert(Hook.contractShapeValid(receipt, 'receipt'));
    for (const actionName of ['quality_ops_schedule', 'quality_ops_weekly']) {
      const adjacent = QualityOpsAudit.recordQualityOpsReceipt(actionName, {
        actionId: `${actionName}:fixture`,
        taskId: `${actionName}-fixture`,
        exitCode: 0,
        finalState: 'completed',
        affectedFiles: [`projects/控制台/artifacts/quality-ops/${actionName}.json`],
        evidenceRefs: [qopsEvidenceRefs[0]],
      }, {
        config: approvedConfig,
        activation: Hook.activationDecision(approvedConfig),
        receiptsRoot: path.join(temp, 'receipts'),
      });
      assert.strictEqual(adjacent.active, true);
      const adjacentReceipt = JSON.parse(fs.readFileSync(adjacent.file, 'utf8'));
      assert.strictEqual(adjacentReceipt.action.name, actionName);
      assert.strictEqual(adjacentReceipt.action.exit_code, 0);
      assert(Hook.contractShapeValid(adjacentReceipt, 'receipt'));
    }
    const failedIngest = QualityOpsAudit.recordIngestReceipt({
      actionId: 'audit-fixture:batch-02:failed',
      taskId: 'quality-ops-fixture-failed',
      exitCode: 1,
      finalState: 'failed',
      affectedFiles: [],
      evidenceRefs: [qopsEvidenceRefs[1]],
    }, {
      config: approvedConfig,
      activation: Hook.activationDecision(approvedConfig),
      receiptsRoot: path.join(temp, 'receipts'),
    });
    const failedReceipt = JSON.parse(fs.readFileSync(failedIngest.file, 'utf8'));
    assert.strictEqual(failedReceipt.action.exit_code, 1);
    assert.strictEqual(failedReceipt.final_state, 'failed');
    cases.push('quality-ops-independent-critical-action-receipts');

    const missingRef = path.relative(workspaceRoot, path.join(temp, 'definitely-missing-evidence.json')).split(path.sep).join('/');
    const phantom = Hook.buildProcessSummary({
      config: approvedConfig,
      manifest: Object.assign(manifest('codex', consoleConfig.runners.codex), { evidence_refs: [missingRef] }),
      legacySummary: legacySummary('codex', consoleConfig.runners.codex),
      runner: consoleConfig.runners.codex,
      now: '2026-07-17T00:00:00.000Z',
    });
    assert.strictEqual(phantom.availability, 'unavailable');
    assert.strictEqual(phantom.unavailable_reason, 'evidence_unavailable');
    assert.deepStrictEqual(phantom.evidence_refs, []);
    assert(Hook.contractShapeValid(phantom));
    boundary.phantom_availability = phantom.availability;
    boundary.phantom_contract_valid = Hook.contractShapeValid(phantom);

    const lineRef = `${qopsEvidenceRefs[0]}:1`;
    const hashLineRef = `${qopsEvidenceRefs[1]}#L1`;
    const lineSummary = Hook.buildProcessSummary({
      config: approvedConfig,
      manifest: Object.assign(manifest('codex', consoleConfig.runners.codex), { evidence_refs: [lineRef, hashLineRef] }),
      legacySummary: legacySummary('codex', consoleConfig.runners.codex),
      runner: consoleConfig.runners.codex,
      now: '2026-07-17T00:00:00.000Z',
    });
    assert.deepStrictEqual(lineSummary.evidence_refs, [lineRef, hashLineRef]);
    assert(Hook.contractShapeValid(lineSummary));

    const outOfRangeLine = Hook.buildProcessSummary({
      config: approvedConfig,
      manifest: Object.assign(manifest('codex', consoleConfig.runners.codex), { evidence_refs: [`${qopsEvidenceRefs[0]}#L999999`] }),
      legacySummary: legacySummary('codex', consoleConfig.runners.codex),
      runner: consoleConfig.runners.codex,
      now: '2026-07-17T00:00:00.000Z',
    });
    assert.strictEqual(outOfRangeLine.availability, 'unavailable');
    assert.strictEqual(outOfRangeLine.unavailable_reason, 'evidence_unavailable');
    cases.push('evidence-existence-and-line-reference-boundaries');

    const longEvidenceDir = path.join(temp, 'long-evidence');
    const longEvidenceRefs = [];
    for (let index = 0; index < 32; index += 1) {
      const file = path.join(longEvidenceDir, `${String(index).padStart(2, '0')}-${'r'.repeat(180)}.json`);
      writeJson(file, { index });
      longEvidenceRefs.push(path.relative(workspaceRoot, file).split(path.sep).join('/'));
    }
    const longAffectedFiles = Array.from({ length: 32 }, (_, index) => (
      `projects/控制台/generated/${String(index).padStart(2, '0')}-${'f'.repeat(240)}.js`
    ));
    const longSummary = Hook.buildProcessSummary({
      config: approvedConfig,
      manifest: Object.assign(manifest('codex', consoleConfig.runners.codex), { evidence_refs: longEvidenceRefs }),
      legacySummary: legacySummary('codex', consoleConfig.runners.codex),
      runner: consoleConfig.runners.codex,
      result: { vars: { implementation: { changed_files: longAffectedFiles } } },
      now: '2026-07-17T00:00:00.000Z',
    });
    const longReceipt = Hook.buildCriticalActionReceipt({
      config: approvedConfig,
      actionName: 'quality_ops_ingest',
      actionKind: 'tool',
      actionId: 'long-fixture',
      taskId: 'long-fixture',
      exitCode: 0,
      finalState: 'completed',
      affectedFiles: longAffectedFiles,
      evidenceRefs: longEvidenceRefs,
      now: '2026-07-17T00:00:00.000Z',
    });
    const longSummaryFile = path.join(temp, 'long-summary.json');
    const longReceiptFile = path.join(temp, 'long-receipt.json');
    Hook._test.atomicWriteJson(longSummaryFile, longSummary);
    Hook._test.atomicWriteJson(longReceiptFile, longReceipt);
    for (const [value, file, kind] of [
      [longSummary, longSummaryFile, 'process'],
      [longReceipt, longReceiptFile, 'receipt'],
    ]) {
      assert.strictEqual(value.availability, 'available');
      assert(value.evidence_refs.length >= 1, `${kind} compaction must retain evidence while available`);
      assert(fs.readFileSync(file, 'utf8').length <= approvedConfig.maxSummaryChars, `${kind} final persisted text must honor limit`);
      assert(Hook.contractShapeValid(value, kind));
      boundary[`${kind}_persisted_chars`] = fs.readFileSync(file, 'utf8').length;
      boundary[`${kind}_evidence_count`] = value.evidence_refs.length;
    }
    cases.push('final-persisted-length-and-long-list-compaction');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const processSchema = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'projects/控制台/quality-ops/schemas/process-summary.contract.schema.json'), 'utf8'));
  const receiptSchema = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'projects/控制台/quality-ops/schemas/critical-action-receipt.schema.json'), 'utf8'));
  assert.strictEqual(processSchema.$id, Hook.PROCESS_SCHEMA);
  assert.strictEqual(receiptSchema.$id, Hook.RECEIPT_SCHEMA);
  assert.strictEqual(processSchema.additionalProperties, false);
  assert.strictEqual(receiptSchema.additionalProperties, false);
  const validSummary = Hook.buildProcessSummary({
    config: approvedConfig,
    manifest: manifest('codex', consoleConfig.runners.codex),
    legacySummary: legacySummary('codex', consoleConfig.runners.codex),
    runner: consoleConfig.runners.codex,
    now: '2026-07-17T00:00:00.000Z',
  });
  const validReceipt = Hook.buildCriticalActionReceipt({
    config: approvedConfig,
    actionName: 'quality_ops_ingest',
    actionKind: 'tool',
    actionId: 'schema-positive',
    taskId: 'schema-positive',
    exitCode: 0,
    finalState: 'completed',
    affectedFiles: ['projects/控制台/status.md'],
    evidenceRefs: [stableLineEvidenceRef],
    now: '2026-07-17T00:00:00.000Z',
  });
  assert.deepStrictEqual(Hook.contractValidationErrors(validSummary), []);
  assert.deepStrictEqual(Hook.contractValidationErrors(validReceipt, 'receipt'), []);

  const summaryWithoutEvidence = JSON.parse(JSON.stringify(validSummary));
  summaryWithoutEvidence.evidence_refs = [];
  assert(Hook.contractValidationErrors(summaryWithoutEvidence).some(error => error.keyword === 'minItems'));
  const compactedSummaryWithoutEvidence = Hook._test.compactToLimit(summaryWithoutEvidence, approvedConfig, 'process', { workspaceRoot });
  assert.strictEqual(compactedSummaryWithoutEvidence.availability, 'unavailable');
  assert.strictEqual(compactedSummaryWithoutEvidence.unavailable_reason, 'summary_length_limit');
  const summaryWithoutLimits = JSON.parse(JSON.stringify(validSummary));
  delete summaryWithoutLimits.limits;
  assert(Hook.contractValidationErrors(summaryWithoutLimits).some(error => error.keyword === 'required'));
  const summaryWithRawOutput = JSON.parse(JSON.stringify(validSummary));
  summaryWithRawOutput.raw_output = 'forbidden';
  assert(Hook.contractValidationErrors(summaryWithRawOutput).some(error => error.keyword === 'additionalProperties'));
  const summaryWithExpandedLimit = JSON.parse(JSON.stringify(validSummary));
  summaryWithExpandedLimit.limits.max_summary_chars = 32768;
  assert(Hook.contractValidationErrors(summaryWithExpandedLimit).some(error => error.keyword === 'configured_length'));
  const receiptWithoutEvidence = JSON.parse(JSON.stringify(validReceipt));
  receiptWithoutEvidence.evidence_refs = [];
  assert(Hook.contractValidationErrors(receiptWithoutEvidence, 'receipt').some(error => error.keyword === 'minItems'));
  const compactedReceiptWithoutEvidence = Hook._test.compactToLimit(receiptWithoutEvidence, approvedConfig, 'receipt', { workspaceRoot });
  assert.strictEqual(compactedReceiptWithoutEvidence.availability, 'unavailable');
  assert.strictEqual(compactedReceiptWithoutEvidence.unavailable_reason, 'summary_length_limit');
  const receiptWithBadExit = JSON.parse(JSON.stringify(validReceipt));
  receiptWithBadExit.action.exit_code = '0';
  assert(Hook.contractValidationErrors(receiptWithBadExit, 'receipt').some(error => error.keyword === 'type'));
  const forgedEvidence = JSON.parse(JSON.stringify(validSummary));
  forgedEvidence.evidence_refs = ['projects/控制台/artifacts/definitely-missing-contract-evidence.json'];
  assert(Hook.contractValidationErrors(forgedEvidence).some(error => error.keyword === 'evidence_exists'));
  assert.strictEqual(Hook.contractShapeValid(forgedEvidence), false);
  cases.push('complete-json-schema-positive-and-negative-validation');

  process.stdout.write(`${JSON.stringify({ ok: true, cases, configured_runners: Object.keys(consoleConfig.runners || {}).length, boundary })}\n`);
}

run().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exit(1);
});
