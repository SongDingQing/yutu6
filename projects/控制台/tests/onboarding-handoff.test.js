#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../../../shared/engine/eventlog');
const Q = require('../../../shared/engine/queue');
const Handoff = require('../onboarding-handoff');
const HR = require('../tools/hr-agent-onboarding');
const QueueAutoMerge = require('../queue-automerge');

const FIXTURE_REF = 'projects/控制台/tests/fixtures/onboarding-handoff/magicmushroom-replay.json';
const TRACE_REF = 'projects/控制台/tests/fixtures/onboarding-handoff/interaction-trace.json';
const TASK_REF = 'projects/控制台/tests/fixtures/onboarding-handoff/engine-tasks/verified-task.json';
const REPAIR_REF = 'projects/控制台/tests/fixtures/onboarding-handoff/repair-tickets/verified-repair-ticket.json';
const ENGINE_EVENT_REF = 'projects/控制台/tests/fixtures/onboarding-handoff/engine-events.jsonl:1';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-handoff-test-'));
  return {
    root,
    stateDir: path.join(root, 'state'),
    queueRoot: path.join(root, 'queue-root'),
    eventlog: new EventLog(path.join(root, 'events.jsonl')),
  };
}

function spec(id, projectId = '控制台') {
  return {
    id,
    name: id,
    role: `${id}_role`,
    ownership: projectId,
    project_id: projectId,
    responsibility_domain: `${projectId} backend delivery`,
    capability: `Implement scoped ${projectId} backend delivery.`,
    does_not: 'Does not publish, expand permissions, or read secrets.',
    runner: 'zhipu-glm',
    read_paths: [`projects/${projectId}/status.md`, `projects/${projectId}/brief.md`],
    writes: [`shared/agents/${id}/`],
    handoff_evidence_refs: [FIXTURE_REF],
  };
}

function evidence(type, projectId, domain, overrides = {}) {
  return Object.assign({
    type,
    ref: type === 'repair_ticket' ? REPAIR_REF : (type === 'engine_event' ? ENGINE_EVENT_REF : (type === 'task' ? TASK_REF : TRACE_REF)),
    project_id: projectId,
    domain,
    direct: true,
    verified: true,
    occurred_at: '2026-07-20T08:00:00.000Z',
  }, overrides);
}

function candidate(id, role, evidenceRows) {
  return { id, role, evidence: evidenceRows };
}

function validReceipt(plan, status = 'pass') {
  return {
    schema: Handoff.RECEIPT_SCHEMA,
    plan_id: plan.plan_id,
    agent_id: plan.agent.id,
    context_digest: 'Responsibilities, project context, rollback, permissions, and task admission gate understood.',
    understood: ['responsibility boundary', 'rollback point', 'approval route'],
    questions: [],
    capability_gaps: [],
    first_smoke: {
      command: 'node projects/控制台/tests/onboarding-handoff.test.js',
      status,
      evidence_refs: [FIXTURE_REF],
    },
  };
}

function prepare(rawSpec, candidates, ws, now = '2026-07-20T08:00:00.000Z', ttlMs = 3600000) {
  return HR.prepareAgent(rawSpec, {
    candidates,
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now,
    ttlMs,
  });
}

function testProjectSupervisorHandoff() {
  const ws = workspace();
  const raw = spec('console-project-supervisor-handoff');
  const domain = raw.responsibility_domain;
  const prepared = prepare(raw, [
    candidate('supervisor-控制台', 'project_supervisor', [
      evidence('interaction_trace', '控制台', domain),
      evidence('task', '控制台', domain),
    ]),
  ], ws);
  assert.strictEqual(prepared.plan.selection.selected_agent, 'supervisor-控制台');
  assert.strictEqual(prepared.plan.selection.verified_provider, true);
  assert.strictEqual(prepared.plan.approval_route.final_approver, 'supervisor-控制台');
  assert.strictEqual(prepared.queue_entry.task.kind, 'onboarding_handoff');
  assert.strictEqual(prepared.queue_entry.task.plan_id, prepared.plan.plan_id);
  assert.strictEqual(prepared.state.lifecycle, 'probationary');
  const types = ws.eventlog.since(0).map(row => row.type);
  assert(types.includes('onboarding.handoff.planned'));
  assert(types.includes('onboarding.handoff.assigned'));
}

function testRepairLeadRequiresDirectIncidentEvidence() {
  const raw = spec('console-repair-evidence-handoff');
  const domain = raw.responsibility_domain;
  const invalidRepair = Handoff.selectHandoffProvider(raw, [
    candidate('repair-lead', 'repair_lead', [evidence('task', '控制台', domain)]),
  ]);
  assert.strictEqual(invalidRepair.selected_agent, 'ceo');
  assert.strictEqual(invalidRepair.verified_provider, false);
  assert.strictEqual(invalidRepair.considered[0].repair_direct_evidence, false);
  const forgedRepair = Handoff.selectHandoffProvider(raw, [
    candidate('repair-lead', '维修主管', [evidence('repair_ticket', '控制台', domain, {
      ref: 'projects/控制台/status.md',
    })]),
  ]);
  assert.strictEqual(forgedRepair.selected_agent, 'ceo');
  assert.strictEqual(forgedRepair.verified_provider, false);

  const selected = Handoff.selectHandoffProvider(raw, [
    candidate('repair-lead', 'repair_lead', [evidence('repair_ticket', '控制台', domain)]),
    candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', domain)]),
  ]);
  assert.strictEqual(selected.selected_agent, 'repair-lead');
  assert.strictEqual(selected.verified_provider, true);
  assert(selected.evidence_refs.includes(REPAIR_REF));
  const repairTrace = selected.considered.find(row => row.agent_id === 'repair-lead');
  assert.strictEqual(repairTrace.repair_direct_evidence, true);
  const selectedFromEvent = Handoff.selectHandoffProvider(raw, [
    candidate('repair-lead', '维修主管', [evidence('engine_event', '控制台', domain)]),
  ]);
  assert.strictEqual(selectedFromEvent.selected_agent, 'repair-lead');
  assert(selectedFromEvent.evidence_refs.includes(ENGINE_EVENT_REF));
}

function testNoExperienceFallsBackToCeoAndCannotActivate() {
  const ws = workspace();
  const raw = spec('console-no-experience-fallback');
  const prepared = prepare(raw, [
    candidate('worker_without_trace', 'worker_code', []),
  ], ws);
  assert.strictEqual(prepared.plan.selection.selected_agent, 'ceo');
  assert.strictEqual(prepared.plan.selection.status, 'route_owner_fallback');
  assert.strictEqual(prepared.plan.selection.verified_provider, false);
  Handoff.recordReceipt(raw.id, validReceipt(prepared.plan), {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  assert.throws(() => Handoff.approve(raw.id, 'supervisor-控制台', {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  }), error => error && error.code === 'ONBOARDING_APPROVAL_BLOCKED'
    && error.blockers.includes('handoff-provider-lacks-verified-evidence'));
  const state = Handoff.readJson(Handoff.stateFile(ws.stateDir, raw.id));
  assert.strictEqual(state.lifecycle, 'probationary');
}

function testRoleOnlyIdentityCannotClaimAnotherAgentsTrace() {
  const raw = spec('console-role-only-evidence-claim');
  const selected = Handoff.selectHandoffProvider(raw, [
    candidate('unrelated-agent-id', 'worker_code', [
      evidence('interaction_trace', '控制台', raw.responsibility_domain),
    ]),
  ]);
  assert.strictEqual(selected.selected_agent, 'ceo');
  assert.strictEqual(selected.verified_provider, false);
  assert.strictEqual(selected.considered[0].agent_id, 'unrelated-agent-id');
  assert.strictEqual(selected.considered[0].eligible, false);
  assert.strictEqual(selected.considered[0].evidence.length, 0);
  return {
    selected_agent: selected.selected_agent,
    verified_provider: selected.verified_provider,
    unrelated_candidate_eligible: selected.considered[0].eligible,
  };
}

function testTimeoutRemindsAndNeverActivates() {
  const ws = workspace();
  const raw = spec('console-timeout-handoff');
  const domain = raw.responsibility_domain;
  const prepared = prepare(raw, [
    candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', domain)]),
  ], ws, '2026-07-20T08:00:00.000Z', 1000);
  Handoff.recordReceipt(raw.id, validReceipt(prepared.plan), {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:00.500Z',
  });
  const enqueued = [];
  const reminders = Handoff.sweepTimeouts({
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:02.000Z',
    enqueueReminder(target, reminder) {
      enqueued.push({ target, reminder });
      return { id: 'reminder-probe', target };
    },
  });
  assert.strictEqual(reminders.length, 1);
  assert.strictEqual(enqueued.length, 1);
  const state = Handoff.readJson(Handoff.stateFile(ws.stateDir, raw.id));
  assert.strictEqual(state.status, 'timed_out');
  assert.strictEqual(state.lifecycle, 'probationary');
  assert.throws(() => Handoff.approve(raw.id, 'supervisor-控制台', {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:03.000Z',
  }), error => error && error.code === 'ONBOARDING_APPROVAL_BLOCKED');
}

function testApprovalActivatesAndQueueGateFailsClosed() {
  const ws = workspace();
  const agentsDir = path.join(ws.root, 'agents');
  const raw = spec('console-approval-handoff');
  const domain = raw.responsibility_domain;
  const prepared = HR.createAgent(raw, {
    agentsDir,
    candidates: [candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', domain)])],
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:00.000Z',
    ttlMs: 3600000,
  });
  const missingState = Handoff.evaluateAdmission({
    agentId: 'brand-new-probationary-agent',
    task: { kind: 'production' },
    stateDir: ws.stateDir,
    agentRecord: { lifecycle: 'probationary', onboarding: { required: true } },
  });
  assert.strictEqual(missingState.allowed, false);
  assert(missingState.blockers.includes('handoff-plan-missing'));
  assert.throws(() => QueueAutoMerge.enqueue(ws.queueRoot, raw.id, { kind: 'production', goal: 'must block' }, {
    onboardingStateDir: ws.stateDir,
    onboardingAgentDir: agentsDir,
    eventlog: ws.eventlog,
  }), error => error && error.code === 'ONBOARDING_PROBATIONARY');
  Q.enqueue(ws.queueRoot, raw.id, { kind: 'production', goal: 'raw queue bypass probe' }, { id: 'raw-bypass-probe' });
  const rawClaim = QueueAutoMerge.claim(ws.queueRoot, raw.id, {
    onboardingStateDir: ws.stateDir,
    onboardingAgentDir: agentsDir,
    eventlog: ws.eventlog,
    match: entry => entry.id === 'raw-bypass-probe',
  });
  assert.strictEqual(rawClaim, null, 'production worker claim gate must reject raw shared-queue bypass');
  const rawQueueState = Q.list(ws.queueRoot, raw.id);
  assert(rawQueueState.queued.some(entry => entry.id === 'raw-bypass-probe'));
  assert.strictEqual(rawQueueState.running.length, 0);
  const disguised = Object.assign({}, prepared.plan.queue_task, {
    goal: 'ORDINARY PRODUCTION: modify unrelated implementation files',
  });
  disguised.task_fingerprint = Handoff.handoffTaskFingerprint(disguised);
  assert.throws(() => QueueAutoMerge.enqueue(ws.queueRoot, raw.id, disguised, {
    onboardingStateDir: ws.stateDir,
    onboardingAgentDir: agentsDir,
    eventlog: ws.eventlog,
  }), error => error && error.code === 'ONBOARDING_PROBATIONARY'
    && error.admission.blockers.includes('onboarding-task-plan-mismatch'));
  Q.enqueue(ws.queueRoot, raw.id, disguised, { id: 'disguised-handoff-bypass-probe' });
  const disguisedClaim = QueueAutoMerge.claim(ws.queueRoot, raw.id, {
    onboardingStateDir: ws.stateDir,
    onboardingAgentDir: agentsDir,
    eventlog: ws.eventlog,
    match: entry => entry.id === 'disguised-handoff-bypass-probe',
  });
  assert.strictEqual(disguisedClaim, null, 'modified handoff task must fail exact plan task binding at claim');
  assert.throws(() => Handoff.approve(raw.id, 'supervisor-控制台', {
    stateDir: ws.stateDir,
    agentDir: agentsDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:05:00.000Z',
  }), error => error && error.blockers.includes('handoff-receipt-not-received'));
  Handoff.recordReceipt(raw.id, validReceipt(prepared.plan), {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  const missingEvidenceReceipt = validReceipt(prepared.plan);
  missingEvidenceReceipt.first_smoke.evidence_refs = ['projects/控制台/tests/fixtures/onboarding-handoff/does-not-exist.json'];
  const missingEvidenceWs = workspace();
  const missingPrepared = prepare(spec('console-missing-smoke-evidence'), [
    candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', 'control backend delivery')]),
  ], missingEvidenceWs);
  missingEvidenceReceipt.plan_id = missingPrepared.plan.plan_id;
  missingEvidenceReceipt.agent_id = missingPrepared.plan.agent.id;
  assert.throws(() => Handoff.recordReceipt(missingPrepared.plan.agent.id, missingEvidenceReceipt, {
    stateDir: missingEvidenceWs.stateDir,
    eventlog: missingEvidenceWs.eventlog,
    now: '2026-07-20T08:12:00.000Z',
  }), /first_smoke evidence_ref missing or unsafe/);
  assert.throws(() => Handoff.approve(raw.id, 'ceo', {
    stateDir: ws.stateDir,
    agentDir: agentsDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:15:00.000Z',
  }), error => error && error.blockers.includes('wrong-final-approver'));
  const approved = Handoff.approve(raw.id, 'supervisor-控制台', {
    stateDir: ws.stateDir,
    agentDir: agentsDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  });
  assert.strictEqual(approved.state.lifecycle, 'active');
  const entry = QueueAutoMerge.enqueue(ws.queueRoot, raw.id, { kind: 'production', goal: 'allowed after approval' }, {
    onboardingStateDir: ws.stateDir,
    onboardingAgentDir: agentsDir,
    eventlog: ws.eventlog,
  });
  assert.strictEqual(entry.onboardingAdmission.allowed, true);
  assert.strictEqual(entry.onboardingAdmission.reason, 'approved-onboarding');
  return {
    disguised_enqueue_blocked: true,
    disguised_claimed: Boolean(disguisedClaim),
    pre_approval_lifecycle: 'probationary',
    post_approval_lifecycle: approved.state.lifecycle,
  };
}

function testMissingAgentRecordFailsClosedAtApprovalAndAdmission() {
  const missingRecordWs = workspace();
  const missingAgentsDir = path.join(missingRecordWs.root, 'agents');
  const missingRaw = spec('console-missing-agent-record');
  const missingPrepared = prepare(missingRaw, [
    candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', missingRaw.responsibility_domain)]),
  ], missingRecordWs);
  Handoff.recordReceipt(missingRaw.id, validReceipt(missingPrepared.plan), {
    stateDir: missingRecordWs.stateDir,
    eventlog: missingRecordWs.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  assert.throws(() => Handoff.approve(missingRaw.id, 'supervisor-控制台', {
    stateDir: missingRecordWs.stateDir,
    agentDir: missingAgentsDir,
    eventlog: missingRecordWs.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  }), error => error && error.code === 'ONBOARDING_APPROVAL_BLOCKED'
    && error.blockers.includes('agent-record-missing'));
  const stateAfterBlockedApproval = Handoff.readJson(Handoff.stateFile(missingRecordWs.stateDir, missingRaw.id));
  assert.strictEqual(stateAfterBlockedApproval.lifecycle, 'probationary');
  assert.strictEqual(stateAfterBlockedApproval.status, 'received');
  assert.strictEqual(stateAfterBlockedApproval.approval, null);
  const probationaryAdmission = Handoff.evaluateAdmission({
    agentId: missingRaw.id,
    task: { kind: 'production', goal: 'missing record before approval must remain blocked' },
    stateDir: missingRecordWs.stateDir,
    agentDir: missingAgentsDir,
  });
  assert.strictEqual(probationaryAdmission.allowed, false);
  assert(probationaryAdmission.blockers.includes('agent-record-missing'));

  const activeWs = workspace();
  const activeAgentsDir = path.join(activeWs.root, 'agents');
  const activeRaw = spec('console-agent-record-admission');
  const created = HR.createAgent(activeRaw, {
    agentsDir: activeAgentsDir,
    candidates: [candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', activeRaw.responsibility_domain)])],
    stateDir: activeWs.stateDir,
    queueRoot: activeWs.queueRoot,
    eventlog: activeWs.eventlog,
    now: '2026-07-20T08:00:00.000Z',
    ttlMs: 3600000,
  });
  Handoff.recordReceipt(activeRaw.id, validReceipt(created.plan), {
    stateDir: activeWs.stateDir,
    eventlog: activeWs.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  const approved = Handoff.approve(activeRaw.id, 'supervisor-控制台', {
    stateDir: activeWs.stateDir,
    agentDir: activeAgentsDir,
    eventlog: activeWs.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  });
  assert.strictEqual(approved.state.lifecycle, 'active');
  const admitted = Handoff.evaluateAdmission({
    agentId: activeRaw.id,
    task: { kind: 'production', goal: 'record present positive admission control' },
    stateDir: activeWs.stateDir,
    agentDir: activeAgentsDir,
  });
  assert.strictEqual(admitted.allowed, true);
  const missingAfterApproval = Handoff.evaluateAdmission({
    agentId: activeRaw.id,
    task: { kind: 'production', goal: 'approved state cannot substitute for a missing roster record' },
    stateDir: activeWs.stateDir,
    agentDir: path.join(activeWs.root, 'missing-agents'),
  });
  assert.strictEqual(missingAfterApproval.allowed, false);
  assert.strictEqual(missingAfterApproval.reason, 'approved-state-integrity-failed');
  assert(missingAfterApproval.blockers.includes('agent-record-missing'));
  return {
    missing_record_approval_blocked: true,
    blocked_state_lifecycle: stateAfterBlockedApproval.lifecycle,
    record_present_admission_allowed: admitted.allowed,
    approved_state_missing_record_admission_allowed: missingAfterApproval.allowed,
    approved_state_missing_record_blockers: missingAfterApproval.blockers,
  };
}

function permissionApproval(raw, risk) {
  return {
    schema: HR.PERMISSION_APPROVAL_SCHEMA,
    agent_id: raw.id,
    risk_fingerprint: risk.risk_fingerprint,
    decision: 'approved',
    approver: 'hr_manager',
    approved_at: '2026-07-20T07:50:00.000Z',
  };
}

function testHighRiskCreateRequiresBoundPermissionApproval() {
  const ws = workspace();
  const agentsDir = path.join(ws.root, 'agents');
  const raw = spec('console-high-risk-created-agent');
  raw.runner = 'codex';
  raw.writes = ['projects/控制台/server.js'];
  const risk = HR.riskLevel(HR.normalizeSpec(raw));
  assert.strictEqual(risk.level, 'high');
  assert.strictEqual(risk.approval_required, true);
  assert.throws(() => HR.createAgent(raw, {
    agentsDir,
    candidates: [candidate('worker_code', 'worker_code', [
      evidence('interaction_trace', '控制台', raw.responsibility_domain),
    ])],
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:00.000Z',
  }), error => error && error.code === 'ONBOARDING_PRECHECK_FAILED'
    && /permission approval/.test(error.message));
  assert.strictEqual(fs.existsSync(path.join(agentsDir, raw.id)), false, 'missing approval must fail before agent persistence');

  const mismatched = permissionApproval(raw, risk);
  mismatched.risk_fingerprint = '0'.repeat(64);
  assert.strictEqual(HR.validateSpec(raw, { agentsDir, permissionApproval: mismatched }).pass, false);

  const created = HR.createAgent(raw, {
    agentsDir,
    permissionApproval: permissionApproval(raw, risk),
    candidates: [candidate('worker_code', 'worker_code', [
      evidence('interaction_trace', '控制台', raw.responsibility_domain),
    ])],
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:00.000Z',
  });
  assert.strictEqual(created.validation.permission_approval.status, 'approved');
  assert.strictEqual(created.state.hr_precheck.permission_approval_status, 'approved');
  assert(created.state.hr_precheck.permission_approval_receipt_fingerprint);
  return {
    risk_level: risk.level,
    approval_required: risk.approval_required,
    missing_approval_create_blocked: true,
    mismatched_approval_blocked: true,
    bound_approval_create_succeeded: created.created,
  };
}

function testRealCreateOperationPersistsAgentAndHandoffTask() {
  const ws = workspace();
  const agentsDir = path.join(ws.root, 'agents');
  const raw = spec('console-created-agent');
  const created = HR.createAgent(raw, {
    agentsDir,
    candidates: [candidate('worker_code', 'worker_code', [
      evidence('interaction_trace', '控制台', raw.responsibility_domain),
    ])],
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:00:00.000Z',
    ttlMs: 3600000,
  });
  const agentRecord = JSON.parse(fs.readFileSync(path.join(agentsDir, raw.id, 'agent.json'), 'utf8'));
  assert.strictEqual(agentRecord.lifecycle, 'probationary');
  assert.strictEqual(agentRecord.onboarding.required, true);
  assert(fs.existsSync(path.join(agentsDir, raw.id, 'prompt.md')));
  assert.strictEqual(created.handoff_task.kind, 'onboarding_handoff');
  assert.strictEqual(created.handoff_task.agent_id, raw.id);
  assert.strictEqual(created.queue_entry.task.plan_id, created.plan.plan_id);
  Handoff.recordReceipt(raw.id, validReceipt(created.plan), {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  const approved = Handoff.approve(raw.id, 'supervisor-控制台', {
    stateDir: ws.stateDir,
    agentDir: agentsDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  });
  assert.strictEqual(approved.state.lifecycle, 'active');
  const activeAgentRecord = JSON.parse(fs.readFileSync(path.join(agentsDir, raw.id, 'agent.json'), 'utf8'));
  assert.strictEqual(activeAgentRecord.lifecycle, 'active');
  assert.strictEqual(activeAgentRecord.onboarding_required, false);
  assert.strictEqual(activeAgentRecord.onboarding.required, false);
  assert.strictEqual(activeAgentRecord.onboarding.approved_plan_id, created.plan.plan_id);
  const activeAdmission = Handoff.evaluateAdmission({
    agentId: raw.id,
    task: { kind: 'production', goal: 'post-approval lifecycle consistency probe' },
    stateDir: ws.stateDir,
    agentDir: agentsDir,
  });
  assert.strictEqual(activeAdmission.allowed, true);
  return {
    state_lifecycle: approved.state.lifecycle,
    agent_record_lifecycle: activeAgentRecord.lifecycle,
    onboarding_required: activeAgentRecord.onboarding.required,
    production_admission_allowed: activeAdmission.allowed,
  };
}

function testProductionWorkerUsesClaimAdmissionGate() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ceo-worker.js'), 'utf8');
  assert(!/\bQ\.claim\s*\(/.test(source), 'generic production worker must not claim through raw shared queue');
  assert((source.match(/QueueAutoMerge\.claim\s*\(/g) || []).length >= 4);
}

function testRejectedEventStaysProbationary() {
  const ws = workspace();
  const raw = spec('console-rejected-handoff');
  const domain = raw.responsibility_domain;
  const prepared = prepare(raw, [
    candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', domain)]),
  ], ws);
  Handoff.recordReceipt(raw.id, validReceipt(prepared.plan, 'fail'), {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:10:00.000Z',
  });
  const rejected = Handoff.reject(raw.id, 'supervisor-控制台', 'first smoke failed; re-plan required', {
    stateDir: ws.stateDir,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:20:00.000Z',
  });
  assert.strictEqual(rejected.state.lifecycle, 'probationary');
  assert.strictEqual(rejected.state.status, 'rejected');
  assert(ws.eventlog.since(0).some(row => row.type === 'onboarding.handoff.rejected'));
  const replanned = HR.replanAgent(raw, {
    candidates: [candidate('worker_code', 'worker_code', [evidence('interaction_trace', '控制台', domain)])],
    stateDir: ws.stateDir,
    queueRoot: ws.queueRoot,
    eventlog: ws.eventlog,
    now: '2026-07-20T08:30:00.000Z',
    ttlMs: 3600000,
  });
  assert.strictEqual(replanned.plan.attempt, 2);
  assert.strictEqual(replanned.state.lifecycle, 'probationary');
  assert.strictEqual(replanned.state.status, 'assigned');
  assert.strictEqual(replanned.queue_entry.task.kind, 'onboarding_handoff');
  assert.strictEqual(ws.eventlog.since(0).filter(row => row.type === 'onboarding.handoff.planned').length, 2);
}

function main() {
  testProjectSupervisorHandoff();
  testRepairLeadRequiresDirectIncidentEvidence();
  testNoExperienceFallsBackToCeoAndCannotActivate();
  const roleOnlyCounterexample = testRoleOnlyIdentityCannotClaimAnotherAgentsTrace();
  testTimeoutRemindsAndNeverActivates();
  const admissionCounterexample = testApprovalActivatesAndQueueGateFailsClosed();
  testRejectedEventStaysProbationary();
  const lifecycleCounterexample = testRealCreateOperationPersistsAgentAndHandoffTask();
  const missingRecordCounterexample = testMissingAgentRecordFailsClosedAtApprovalAndAdmission();
  const highRiskCounterexample = testHighRiskCreateRequiresBoundPermissionApproval();
  testProductionWorkerUsesClaimAdmissionGate();
  const smoke = HR.handoffSmoke();
  assert.strictEqual(smoke.pass, true, JSON.stringify(smoke, null, 2));
  console.log(JSON.stringify({
    pass: true,
    suite: 'onboarding-handoff',
    scenarios: [
      'project-supervisor-handoff',
      'repair-lead-with-direct-evidence',
      'no-experience-fallback-ceo',
      'role-only-identity-cannot-claim-another-agent-trace',
      'timeout-remains-probationary',
      'approval-activates',
      'rejection-remains-probationary-and-replans',
      'real-create-operation-persists-agent-and-handoff-task',
      'missing-agent-record-approval-and-admission-fail-closed',
      'high-risk-create-requires-bound-permission-approval',
      'production-worker-claim-gate-blocks-raw-queue-bypass',
      'disguised-handoff-task-blocked-by-exact-task-fingerprint',
      'forged-and-missing-evidence-fail-closed',
      'magicmushroom-repeatable-smoke'
    ],
    review_counterexamples: {
      disguised_handoff_task: admissionCounterexample,
      role_only_trace_claim: roleOnlyCounterexample,
      high_risk_permission: highRiskCounterexample,
      approved_lifecycle_sync: lifecycleCounterexample,
      missing_agent_record_fail_closed: missingRecordCounterexample,
    }
  }));
}

main();
