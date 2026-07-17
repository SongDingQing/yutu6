#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Audit = require('../shared/engine/quality-ops-audit');

function tracePair(chain, route, index) {
  const base = {
    chain_id: chain,
    trace_id: `trace-${chain}`,
    root_task_id: `task-${chain}`,
    task_id: `task-${chain}`,
    node_id: 'execute',
    agent_role: route,
    runner_id: route === 'rare' ? 'codex' : 'zhipu-glm-tools',
    route_key: `queue>${route}>runner`,
    project_id: '控制台',
  };
  return [
    { ...base, event: 'interaction.started', at: `2026-07-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`, manifest_path: `${chain}/interaction-trace.json` },
    { ...base, event: 'interaction.finished', at: `2026-07-${String(index + 1).padStart(2, '0')}T01:01:00.000Z`, status: 'completed', content_hash: `hash-${chain}`, output_redacted_path: `${chain}/result.redacted.md`, evidence_refs: [`${chain}/result.redacted.md`] },
  ];
}

function main() {
  const events = [];
  for (let i = 0; i < 5; i++) events.push(...tracePair(`common-${i}`, 'common', i));
  events.push(...tracePair('rare-1', 'rare', 6));
  events.push(...tracePair('cold-1', 'cold', 7));
  const chains = Audit.buildChains(events);
  assert.strictEqual(chains.length, 7);

  const failoverBase = {
    chain_id: 'it-failover',
    root_task_id: 'task-it-failover',
    task_id: 'task-it-failover',
    node_id: 'execute',
    agent_role: 'it_engineer',
    project_id: '控制台',
  };
  const failoverTraces = [
    { ...failoverBase, event: 'interaction.started', trace_id: 'trace-it-primary', runner_id: 'zhipu-glm-tools', at: '2026-07-14T06:51:07.119Z' },
    { ...failoverBase, event: 'interaction.finished', trace_id: 'trace-it-primary', runner_id: 'zhipu-glm-tools', at: '2026-07-14T06:51:07.163Z', status: 'failed', content_hash: 'primary-failed' },
    { ...failoverBase, event: 'interaction.started', trace_id: 'trace-it-fallback', runner_id: 'codex', at: '2026-07-14T06:51:07.164Z' },
    { ...failoverBase, event: 'interaction.finished', trace_id: 'trace-it-fallback', runner_id: 'codex', at: '2026-07-14T07:00:49.228Z', status: 'completed', content_hash: 'fallback-ok' },
  ];
  const failoverTerminal = [
    { seq: 10, ts: '2026-07-14T07:00:49.292Z', type: 'task.done', task: 'task-it-failover' },
    { seq: 11, ts: '2026-07-14T07:00:49.370Z', type: 'queue.completed', task: 'task-it-failover', ok: true, status: 'done' },
  ];
  const failoverChain = Audit.buildChains(failoverTraces, failoverTerminal)[0];
  assert.strictEqual(failoverChain.status, 'completed', 'IT failover 中途 runner 失败不得污染整链终态');
  assert.deepStrictEqual(failoverChain.span_failures, ['trace-it-primary']);
  assert.strictEqual(failoverChain.terminal.source, 'task+queue');

  const fallbackSuccess = Audit.reduceChainTerminal('task-fallback-success', [
    { seq: 20, type: 'task.failed', task: 'task-fallback-success' },
    { seq: 21, type: 'queue.completed', task: 'task-fallback-success', ok: false },
    { seq: 22, type: 'task.done', task: 'task-fallback-success' },
    { seq: 23, type: 'queue.completed', task: 'task-fallback-success', ok: true },
  ]);
  assert.strictEqual(fallbackSuccess.status, 'completed', 'fallback-success 必须以最后 task/queue 终态为准');
  assert.deepStrictEqual(fallbackSuccess.conflicts, []);

  const terminalConflict = Audit.reduceChainTerminal('task-conflict', [
    { seq: 30, type: 'task.done', task: 'task-conflict' },
    { seq: 31, type: 'queue.completed', task: 'task-conflict', ok: false },
  ]);
  assert.strictEqual(terminalConflict.status, 'failed');
  assert.deepStrictEqual(terminalConflict.conflicts, ['task.done_vs_queue.completed.ok=false']);

  const policy = Audit.createPolicy(new Date('2026-07-10T00:00:00.000Z'));
  policy.steady_sample_size = 3;
  const firstWeek = Audit.selectChains({ chains, ledger: null, policy, now: new Date('2026-07-12T00:00:00.000Z') });
  assert.strictEqual(firstWeek.strategy, 'first_week_full');
  assert.strictEqual(firstWeek.selected.length, 7, 'first week must cover every unreviewed chain');

  const reviewedChain = chains.find(x => x.chain_id === 'common-0');
  const ledger = {
    reviews: [{ chain_id: reviewedChain.chain_id, content_hash: reviewedChain.content_hash, route_key: reviewedChain.route_key, reviewed_at: '2026-07-11T00:00:00.000Z' }],
    reservations: [],
  };
  const firstWeekDeduped = Audit.selectChains({ chains, ledger, policy, now: new Date('2026-07-12T00:00:00.000Z') });
  assert.strictEqual(firstWeekDeduped.selected.length, 6);
  assert(!firstWeekDeduped.selected.some(x => x.chain_id === reviewedChain.chain_id));

  const steady = Audit.selectChains({ chains, ledger, policy, now: new Date('2026-07-20T00:00:00.000Z'), seed: 'fixed' });
  assert.strictEqual(steady.strategy, 'steady_weighted_random');
  assert.strictEqual(steady.selected.length, 3);
  assert(steady.selected.some(x => /rare@/.test(x.route_key)), 'rare route must receive priority');
  assert(steady.selected.some(x => /cold@/.test(x.route_key)), 'cold route must receive priority');

  const plan = Audit.makePlan({ strategy: 'first_week_full', candidates: 1, selected: [chains[0]] }, {
    now: new Date('2026-07-12T00:00:00.000Z'), auditId: 'audit-test', batchSize: 1,
  });
  const reservedLedger = Audit.reservePlan(null, plan, new Date('2026-07-12T00:00:00.000Z'));
  const reservationSelection = Audit.selectChains({ chains: [chains[0]], ledger: reservedLedger, policy, now: new Date('2026-07-12T01:00:00.000Z') });
  assert.strictEqual(reservationSelection.selected.length, 0, 'active reservation prevents duplicate attention');

  const batch = plan.batches[0];
  assert.throws(() => Audit.validateFindings(batch, {
    schema: Audit.FINDINGS_SCHEMA, chain_reviews: [], proposals: [],
  }), /not reviewed/);
  const findings = {
    schema: Audit.FINDINGS_SCHEMA,
    audit_id: plan.audit_id,
    batch_id: batch.batch_id,
    chain_reviews: [{ chain_id: chains[0].chain_id, chain_summary: '秘书到执行完整', verdict: 'warning', evidence_refs: ['trace/result.redacted.md'], findings: ['重复上下文'] }],
    proposals: [{ title: '把重复检查固化为脚本', desc: '三次重复', category: 'script', benefit: '降低 token', risk: '低', project: '控制台', evidence_refs: ['trace/result.redacted.md'] }],
  };
  assert(Audit.validateFindings(batch, findings));
  const warningEvents = tracePair('observability-warning', 'common', 8);
  warningEvents[1].observability_status = 'warning';
  warningEvents[1].observability_warning = [{
    code: 'process_summary_exit_code_missing',
    artifact: 'process_summary_redacted',
    audit_effect: 'quality_audit_no_pass',
  }];
  warningEvents[1].done_gate = { ok: true };
  warningEvents[1].warnings = ['unrelated warning that must not override audit-gate'];
  const warningChain = Audit.buildChains(warningEvents)[0];
  const warningPlan = Audit.makePlan({ strategy: 'first_week_full', candidates: 1, selected: [warningChain] }, {
    now: new Date('2026-07-12T00:00:00.000Z'), auditId: 'audit-warning-test', batchSize: 1,
  });
  const warningBatch = warningPlan.batches[0];
  assert.strictEqual(warningBatch.chains[0].trace_refs[0].observability_warning.length, 1);
  assert.strictEqual(warningBatch.chains[0].audit_gate.observability_warning_forbids_pass, true);
  const warningReview = {
    schema: Audit.FINDINGS_SCHEMA,
    chain_reviews: [{
      chain_id: warningChain.chain_id,
      chain_summary: '业务完成但过程证据不完整',
      verdict: 'pass',
      evidence_refs: ['trace/interaction-trace.json'],
      findings: [],
    }],
    proposals: [],
  };
  assert.throws(
    () => Audit.validateFindings(warningBatch, warningReview),
    /audit-gate observability_warning forbids pass/,
    'completed/done-gate state must not override observability warning',
  );
  warningReview.chain_reviews[0].verdict = 'warning';
  assert(Audit.validateFindings(warningBatch, warningReview));

  const hookErrorEvents = tracePair('hook-error', 'common', 9);
  hookErrorEvents[1].hook_error = [{
    schema: 'yutu6-trace-hook-error@1',
    phase: 'trace_completion_integrity',
    error: 'forced integrity hook error',
  }];
  hookErrorEvents[1].observability_status = 'hook_error';
  hookErrorEvents[1].done_gate = { ok: true };
  const hookErrorChain = Audit.buildChains(hookErrorEvents)[0];
  const hookErrorPlan = Audit.makePlan({ strategy: 'first_week_full', candidates: 1, selected: [hookErrorChain] }, {
    now: new Date('2026-07-12T00:00:00.000Z'), auditId: 'audit-hook-error-test', batchSize: 1,
  });
  const hookErrorBatch = hookErrorPlan.batches[0];
  assert(hookErrorBatch.chains[0].audit_gate.observability_warnings.some(item => item.code === 'trace_integrity_hook_error'));
  const hookErrorReview = {
    schema: Audit.FINDINGS_SCHEMA,
    audit_id: hookErrorPlan.audit_id,
    batch_id: hookErrorBatch.batch_id,
    chain_reviews: [{
      chain_id: hookErrorChain.chain_id,
      chain_summary: '业务完成但完整性 hook 异常',
      verdict: 'pass',
      evidence_refs: ['trace/trace-hook-errors.jsonl'],
      findings: [],
    }],
    proposals: [],
  };
  assert.throws(
    () => Audit.validateFindings(hookErrorBatch, hookErrorReview),
    /trace_integrity_hook_error/,
    'hook_error must independently forbid audit pass',
  );
  const completed = Audit.completeBatch(reservedLedger, plan, batch, findings, new Date('2026-07-12T02:00:00.000Z'));
  assert.strictEqual(completed.reviews.length, 1);
  assert.strictEqual(completed.reservations[0].status, 'completed');
  assert.strictEqual(Audit.proposalFingerprint(findings.proposals[0]), Audit.proposalFingerprint({ ...findings.proposals[0] }));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qops-ingest-test-'));
  try {
    const auditDir = path.join(temp, 'quality-ops', 'audits', '2026-07-12', plan.audit_id);
    const planFile = path.join(auditDir, 'plan.json');
    const batchFile = path.join(auditDir, `${batch.batch_id}.json`);
    const findingsFile = path.join(auditDir, 'drafts', `${batch.batch_id}.json`);
    Audit.atomicWriteJson(planFile, plan);
    Audit.atomicWriteJson(batchFile, { schema: Audit.PLAN_SCHEMA, audit_id: plan.audit_id, plan_path: planFile, batch_id: batch.batch_id, chains: batch.chains });
    Audit.atomicWriteJson(findingsFile, findings);
    const tool = path.join(__dirname, '../projects/控制台/tools/quality-ops-audit.js');
    const run = spawnSync(process.execPath, [tool, 'ingest', '--batch-file', batchFile, '--findings-file', findingsFile], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, CONSOLE_ARTIFACTS_DIR: temp },
    });
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    const cards = JSON.parse(fs.readFileSync(path.join(temp, 'bulletin', 'cards.json'), 'utf8'));
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].source, '质量运营');
    assert.strictEqual(cards[0].status, 'todo');
    assert(!cards[0].enabled_at);
    const replay = spawnSync(process.execPath, [tool, 'ingest', '--batch-file', batchFile, '--findings-file', findingsFile], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, CONSOLE_ARTIFACTS_DIR: temp },
    });
    assert.strictEqual(replay.status, 0, replay.stderr || replay.stdout);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(temp, 'bulletin', 'cards.json'), 'utf8')).length, 1, 'proposal replay must deduplicate');

    const hookAuditDir = path.join(temp, 'quality-ops', 'audits', '2026-07-12', hookErrorPlan.audit_id);
    const hookPlanFile = path.join(hookAuditDir, 'plan.json');
    const hookBatchFile = path.join(hookAuditDir, `${hookErrorBatch.batch_id}.json`);
    const hookFindingsFile = path.join(hookAuditDir, 'drafts', `${hookErrorBatch.batch_id}.json`);
    Audit.atomicWriteJson(hookPlanFile, hookErrorPlan);
    Audit.atomicWriteJson(hookBatchFile, {
      schema: Audit.PLAN_SCHEMA,
      audit_id: hookErrorPlan.audit_id,
      plan_path: hookPlanFile,
      batch_id: hookErrorBatch.batch_id,
      chains: hookErrorBatch.chains,
    });
    Audit.atomicWriteJson(hookFindingsFile, hookErrorReview);
    const rejectedHookPass = spawnSync(process.execPath, [tool, 'ingest', '--batch-file', hookBatchFile, '--findings-file', hookFindingsFile], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, CONSOLE_ARTIFACTS_DIR: temp },
    });
    assert.notStrictEqual(rejectedHookPass.status, 0, 'ingest must reject completed + hook_error + pass');
    assert.match(`${rejectedHookPass.stderr}\n${rejectedHookPass.stdout}`, /trace_integrity_hook_error/);
    assert(!fs.existsSync(path.join(hookAuditDir, 'results', `${hookErrorBatch.batch_id}.json`)));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ pass: true, suite: 'quality-ops-audit', chains: chains.length }));
}

main();
