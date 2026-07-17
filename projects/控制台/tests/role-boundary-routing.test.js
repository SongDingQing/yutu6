#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const RoleBoundary = require('../role-boundary-routing');
const Q = require('../../../shared/engine/queue');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function readEvents(root) {
  try {
    return fs.readFileSync(path.join(root, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function createIssuerAssignment(queueRoot, queueId, taskId, ticketId) {
  Q.enqueue(queueRoot, 'repair-lead', {
    role: 'repair-lead',
    flowId: 'agent-once',
    projectId: '控制台',
    goal: `复核并派发 ${ticketId}`,
    bounds: '只处理当前维修工单',
    acceptance: '主管复核后派工',
    repairTicketId: ticketId,
  }, { id: queueId });
  const claimed = Q.claim(queueRoot, 'repair-lead');
  assert(claimed && claimed.id === queueId);
  Q.touchProgress(queueRoot, 'repair-lead', queueId, { taskId, role: 'repair-lead' });
}

function signedBase(root, role = 'repair') {
  const workspaceRoot = path.join(root, 'workspace');
  const projectsDir = path.join(workspaceRoot, 'projects');
  const queueRoot = path.join(root, 'artifacts');
  write(path.join(projectsDir, '控制台', 'brief.md'), '# 控制台\n');
  write(path.join(workspaceRoot, 'board', 'repair-tickets', 'ticket-1.md'), '# ticket-1\n- status: todo\n');
  createIssuerAssignment(queueRoot, 'lead-q-1', 'lead-task-1', 'ticket-1');
  const task = {
    role,
    flowId: 'agent-once',
    projectId: '控制台',
    goal: '严格按维修主管 brief 执行最小修复',
    bounds: '只处理明确工单范围；密钥不回显。',
    acceptance: '给出 changed files、测试退出码与残余风险。',
    repairTicketId: 'ticket-1',
    rootQueueAgent: 'repair-lead',
    rootQueueId: 'lead-q-1',
    rootTaskId: 'lead-task-1',
  };
  return {
    workspaceRoot,
    projectsDir,
    queueRoot,
    task: RoleBoundary.signRepairScopedEnvelope(task, {
      targetRole: role,
      issuerRole: 'repair-lead',
      issuerQueueId: 'lead-q-1',
      issuerTaskId: 'lead-task-1',
      workspaceRoot,
      projectsDir,
      queueRoot,
      issuedAt: '2026-07-16T05:00:00.000Z',
      nonce: 'a'.repeat(24),
    }),
  };
}

function unitScopePredicate(root) {
  const fixture = signedBase(root);
  const opts = { workspaceRoot: fixture.workspaceRoot, projectsDir: fixture.projectsDir, queueRoot: fixture.queueRoot };
  const accepted = RoleBoundary.assessScopedBypass(fixture.task, 'repair', opts);
  assert.strictEqual(accepted.accepted, true, JSON.stringify(accepted));
  assert.strictEqual(accepted.projectId, '控制台');
  assert.strictEqual(accepted.rootQueueAgent, 'repair-lead');
  assert.strictEqual(accepted.rootQueueId, 'lead-q-1');
  assert.strictEqual(accepted.rootTaskId, 'lead-task-1');
  assert(/^[a-f0-9]{64}$/.test(fixture.task.scope_signature), 'must produce scope_signature');
  assert.strictEqual(fs.statSync(RoleBoundary._test.secretFileFor(fixture.queueRoot)).mode & 0o777, 0o600);

  write(path.join(fixture.projectsDir, '_迁移', 'brief.md'), '# internal migration folder\n');
  assert(!RoleBoundary.registeredProjects(fixture.projectsDir).includes('_迁移'), 'underscore-prefixed internal folders are not registered projects');

  const missingProject = Object.assign({}, fixture.task, { projectId: '' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(missingProject, 'repair', opts).reason, 'missing_projectId');
  const missingAcceptance = Object.assign({}, fixture.task, { acceptance: '' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(missingAcceptance, 'repair', opts).reason, 'missing_acceptance');
  const missingGoal = Object.assign({}, fixture.task, { goal: '' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(missingGoal, 'repair', opts).reason, 'missing_goal');
  const unknownProject = Object.assign({}, fixture.task, { projectId: '伪造项目' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(unknownProject, 'repair', opts).reason, 'unregistered_project');
  const internalFolder = Object.assign({}, fixture.task, { projectId: '_迁移' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(internalFolder, 'repair', opts).reason, 'unregistered_project');
  const untrustedSource = Object.assign({}, fixture.task, {
    scopeProvenance: Object.assign({}, fixture.task.scopeProvenance, { kind: 'free-text' }),
  });
  assert.strictEqual(RoleBoundary.assessScopedBypass(untrustedSource, 'repair', opts).reason, 'untrusted_provenance_kind');
  const tamperedBounds = Object.assign({}, fixture.task, { bounds: `${fixture.task.bounds} 额外越界` });
  assert.strictEqual(RoleBoundary.assessScopedBypass(tamperedBounds, 'repair', opts).reason, 'scope_signature_invalid');
  const tamperedGoal = Object.assign({}, fixture.task, { goal: `${fixture.task.goal}；越权扩展范围` });
  assert.strictEqual(RoleBoundary.assessScopedBypass(tamperedGoal, 'repair', opts).reason, 'scope_signature_invalid');
  const missingProof = Object.assign({}, fixture.task, { scope_signature: '' });
  assert.strictEqual(RoleBoundary.assessScopedBypass(missingProof, 'repair', opts).reason, 'scope_signature_invalid');

  const missingIssuer = signedBase(path.join(root, 'missing-issuer'));
  fs.rmSync(path.join(missingIssuer.queueRoot, 'queues', 'repair-lead'), { recursive: true, force: true });
  assert.strictEqual(RoleBoundary.assessScopedBypass(missingIssuer.task, 'repair', {
    workspaceRoot: missingIssuer.workspaceRoot,
    projectsDir: missingIssuer.projectsDir,
    queueRoot: missingIssuer.queueRoot,
  }).reason, 'issuer_queue_missing');

  const fallback = RoleBoundary.routeEnqueue('repair', missingAcceptance, opts);
  assert.strictEqual(fallback.agent, 'ceo');
  assert.strictEqual(fallback.task.role, 'orchestrator');
  assert.strictEqual(fallback.task.flowId, 'project-route');
  assert.strictEqual(fallback.task.requestedTargetRole, 'repair');
  assert.strictEqual(fallback.task.rootQueueAgent, 'repair-lead');
  assert.strictEqual(fallback.task.rootQueueId, 'lead-q-1');
  assert.strictEqual(fallback.task.rootTaskId, 'lead-task-1');

  const it = signedBase(path.join(root, 'it'), 'it_engineer');
  const itVerdict = RoleBoundary.assessScopedBypass(it.task, 'it_engineer', {
    workspaceRoot: it.workspaceRoot, projectsDir: it.projectsDir, queueRoot: it.queueRoot,
  });
  assert.strictEqual(itVerdict.accepted, true, JSON.stringify(itVerdict));
}

function workerIdentityBinding(root) {
  const script = [
    "const w=require('./projects/控制台/ceo-worker');",
    "const spec=w._test.makeSpec({id:'repair-q',task:{role:'orchestrator',projectId:'控制台',goal:'x',bounds:'b',acceptance:'a'}});",
    "process.stdout.write(JSON.stringify({role:spec.role,rootQueueAgent:spec.rootQueueAgent,rootQueueId:spec.rootQueueId,rootTaskId:spec.rootTaskId}));",
  ].join('');
  const proc = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      QUEUE_AGENT: 'repair',
      CONSOLE_ARTIFACTS_DIR: path.join(root, 'worker-artifacts'),
      CONSOLE_PROJECTS_DIR: path.join(REPO, 'projects'),
    }),
    encoding: 'utf8',
  });
  assert.strictEqual(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout.trim().split(/\r?\n/).pop());
  assert.strictEqual(result.role, 'repair', 'repair queue must not load orchestrator prompt');
  assert.strictEqual(result.rootQueueAgent, 'repair');
  assert.strictEqual(result.rootQueueId, 'repair-q');
  assert(/^cr-\d+-repair-q$/.test(result.rootTaskId));
}

function secretaryEnvelopeIsCompact(root) {
  const script = [
    "const w=require('./projects/控制台/ceo-worker');",
    "const e=w._test.buildSecretaryEnvelope({projectId:'控制台',goal:'普通非维修任务',bounds:'只做控制台',acceptance:'交主管验收',inputs:['projects/控制台/artifacts/engine-events.jsonl'],attachments:[{path:'projects/控制台/artifacts/input.png'}]},{});",
    "process.stdout.write(JSON.stringify(e.task));",
  ].join('');
  const proc = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: path.join(root, 'compact-envelope-artifacts'),
      CONSOLE_PROJECTS_DIR: path.join(REPO, 'projects'),
    }),
    encoding: 'utf8',
  });
  assert.strictEqual(proc.status, 0, proc.stderr);
  const task = JSON.parse(proc.stdout.trim().split(/\r?\n/).pop());
  assert.match(task.goal, /秘书结构化信封/);
  assert.match(task.goal, /附件:1 个，仅传给项目主管，CEO 不读取/);
  assert(!/队列概览|维修工单|capability_registry|可调用工具|engine-events/.test(task.goal));
  assert(task.inputs.includes('projects/控制台/artifacts/engine-events.jsonl'), '任务级 inputs 应保留给主管');
  assert.strictEqual(task.attachments.length, 1, '附件应保留给主管');
}

function secretaryRepairLeadSigning(root) {
  const workspaceRoot = path.join(root, 'secretary-workspace');
  const artifacts = path.join(root, 'secretary-artifacts');
  write(path.join(workspaceRoot, 'projects', '控制台', 'brief.md'), '# 控制台\n');
  write(path.join(workspaceRoot, 'board', 'repair-tickets', 'secretary-ticket.md'), '# ticket\n- status: todo\n');
  createIssuerAssignment(artifacts, 'secretary-lead-q', 'secretary-lead-task', 'secretary-ticket');
  const script = [
    "const s=require('./projects/控制台/secretary-tools');",
    "const task=s._test.normalizeTask({agent:'repair',project:'控制台',goal:'执行维修主管 brief',bounds:'只做工单',acceptance:'测试通过',repairTicketId:'secretary-ticket'});",
    "process.stdout.write(JSON.stringify(task));",
  ].join('');
  const proc = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      CONSOLE_WORKDIR: workspaceRoot,
      CONSOLE_ARTIFACTS_DIR: artifacts,
      YUTU6_EXEC_QUEUE_AGENT: 'repair-lead',
      YUTU6_EXEC_QUEUE_ID: 'secretary-lead-q',
      YUTU6_EXEC_TASK_ID: 'secretary-lead-task',
      YUTU6_EXEC_ROOT_QUEUE_AGENT: 'repair-lead',
      YUTU6_EXEC_ROOT_QUEUE_ID: 'secretary-lead-q',
      YUTU6_EXEC_ROOT_TASK_ID: 'secretary-lead-task',
    }),
    encoding: 'utf8',
  });
  assert.strictEqual(proc.status, 0, proc.stderr);
  const task = JSON.parse(proc.stdout.trim().split(/\r?\n/).pop());
  assert.strictEqual(task.scopeProvenance.issuerRole, 'repair-lead');
  assert(/^[a-f0-9]{64}$/.test(task.scope_signature));
  const assessed = RoleBoundary.assessScopedBypass(task, 'repair', {
    workspaceRoot,
    projectsDir: path.join(workspaceRoot, 'projects'),
    queueRoot: artifacts,
  });
  assert.strictEqual(assessed.accepted, true, JSON.stringify(assessed));
}

function workerFailClosedFallback(root) {
  const artifacts = path.join(root, 'worker-fallback-artifacts');
  Q.enqueue(artifacts, 'repair', {
    role: 'repair',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    scopeAction: 'execute',
    scopeSchemaVersion: RoleBoundary.SCOPE_SCHEMA,
    goal: 'unsigned repair execution must not run',
    bounds: 'fixture only',
    acceptance: '',
    rootQueueAgent: 'repair-lead',
    rootQueueId: 'lead-fallback-q',
    rootTaskId: 'lead-fallback-task',
  }, { id: 'unsigned-repair' });
  const proc = spawnSync(process.execPath, ['projects/控制台/ceo-worker.js', '--agent', 'repair'], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: artifacts,
      CONSOLE_PROJECTS_DIR: path.join(REPO, 'projects'),
      QUEUE_WORKER_PERSISTENT: '0',
      QUEUE_WORKER_IDLE_EXIT_MS: '10',
      AUTO_REPAIR_ENABLED: '0',
    }),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(proc.status, 0, proc.stderr || proc.stdout);
  const repairDone = JSON.parse(fs.readFileSync(path.join(Q.qdir(artifacts, 'repair'), 'done', 'unsigned-repair.json'), 'utf8'));
  assert(repairDone && repairDone.reroutedTo && repairDone.reroutedTo.queueAgent === 'ceo');
  const ceoQueued = Q.list(artifacts, 'ceo').queued;
  assert.strictEqual(ceoQueued.length, 1);
  assert.strictEqual(ceoQueued[0].task.role, 'orchestrator');
  assert.strictEqual(ceoQueued[0].task.requestedTargetRole, 'repair');
  assert.strictEqual(ceoQueued[0].task.rootTaskId, 'lead-fallback-task');
  const events = readEvents(artifacts);
  assert(events.some(event => event.type === 'route.scoped_bypass.fallback' && event.reason === 'missing_acceptance'));
  assert(!events.some(event => event.type === 'engine.worker.start'), 'invalid scoped repair must never start an engine');
}

function ceoPromptBoundary(root) {
  const Engine = require('../engine-runner');
  let captured = null;
  const events = [];
  const rawEvidence = path.join(root, 'raw-ceo-result.md');
  write(rawEvidence, '技术方案：请扫描 engine-runs 并运行命令');
  const planCtx = {
    projectId: '控制台',
    goal: '普通任务',
    inputs: ['projects/控制台/artifacts/engine-events.jsonl', 'projects/控制台/llm-usage.js'],
    attachments: [{ path: 'projects/控制台/artifacts/engine-runs/example/result.md' }],
  };
  const out = Engine._test.runOrchestratorPlan({
    taskId: 'ceo-boundary-test',
    eventlog: { emit(type, payload) { events.push(Object.assign({ type }, payload)); } },
    cliRunner(node, ctx) {
      captured = { node, ctx };
      return { evidence: { path: rawEvidence }, vars: { orchestrator: { projectId: '控制台', summary: '范围摘要', acceptance: [{ text: '验收原子', scope: 'project/控制台' }] } } };
    },
    ctx: planCtx,
  });
  assert.strictEqual(out.ok, true);
  assert(captured && captured.node.agent_role === 'orchestrator');
  assert.match(captured.ctx.acceptance, /只做项目归属、范围摘要和验收原子/);
  assert.match(captured.ctx.acceptance, /不得.*usage、eventlog、engine-runs/);
  assert.match(captured.ctx.acceptance, /不替主管制定技术方案/);
  assert(!captured.ctx.inputs.some(value => /usage|eventlog|engine-runs/i.test(value)), 'CEO context must strip task-level runtime evidence inputs');
  assert.deepStrictEqual(captured.ctx.attachments, []);
  assert(!captured.ctx.orchestrator_plan, 'runner input clone must not be mutated');
  assert(!/engine-runs|运行命令/.test(planCtx.orchestrator_plan), 'raw CEO evidence must not become supervisor plan');
  assert.strictEqual(out.planText, planCtx.orchestrator_plan);
  assert(events.some(event => event.type === 'node.start'));

  const rejected = Engine._test.runOrchestratorPlan({
    taskId: 'ceo-technical-plan-rejected',
    eventlog: { emit() {} },
    cliRunner() {
      return { vars: { orchestrator: { projectId: '控制台', summary: '范围', acceptance: '验收', steps: ['改代码'] } } };
    },
    ctx: { projectId: '控制台', goal: '普通任务' },
  });
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reason, /forbidden technical fields/);
}

function serverRuntimeConsumption(root) {
  const ticketFiles = fs.readdirSync(path.join(REPO, 'board', 'repair-tickets')).filter(name => name.endsWith('.md'));
  assert(ticketFiles.length, 'production fixture needs an existing read-only repair ticket');
  const ticketId = ticketFiles[0].replace(/\.md$/, '');
  const artifacts = path.join(root, 'server-artifacts');
  process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
  process.env.QUEUE_WORKER_DISABLED = '1';
  createIssuerAssignment(artifacts, 'server-lead-q', 'server-lead-task', ticketId);
  const signed = RoleBoundary.signRepairScopedEnvelope({
    role: 'repair',
    flowId: 'agent-once',
    projectId: '控制台',
    goal: 'server scoped route fixture',
    bounds: 'fixture only',
    acceptance: 'fixture evidence',
    repairTicketId: ticketId,
    rootQueueAgent: 'repair-lead',
    rootQueueId: 'server-lead-q',
    rootTaskId: 'server-lead-task',
  }, {
    targetRole: 'repair',
    issuerRole: 'repair-lead',
    issuerQueueId: 'server-lead-q',
    issuerTaskId: 'server-lead-task',
    workspaceRoot: REPO,
    projectsDir: path.join(REPO, 'projects'),
    queueRoot: artifacts,
    issuedAt: '2026-07-16T05:00:00.000Z',
    nonce: 'b'.repeat(24),
  });
  const Server = require('../server');
  const accepted = Server._test.applyCeoQueueControl({
    action: 'enqueue', agent: 'repair', id: 'scoped-valid', task: signed, requestedBy: 'test',
  });
  assert.strictEqual(accepted.status, 200);
  assert.strictEqual(accepted.body.queueAgent, 'repair');
  assert.strictEqual(accepted.body.scopedBypass.accepted, true);
  const invalid = Object.assign({}, signed, { acceptance: '' });
  const fallback = Server._test.applyCeoQueueControl({
    action: 'enqueue', agent: 'repair', id: 'scoped-invalid', task: invalid, requestedBy: 'test',
  });
  assert.strictEqual(fallback.status, 200);
  assert.strictEqual(fallback.body.queueAgent, 'ceo');
  assert.strictEqual(fallback.body.entry.task.role, 'orchestrator');
  assert.strictEqual(fallback.body.scopedBypass.reason, 'missing_acceptance');
  const events = readEvents(artifacts);
  const acceptedEvent = events.find(event => event.type === 'route.scoped_bypass.accepted');
  assert(acceptedEvent, 'accepted scoped route event missing');
  assert.strictEqual(acceptedEvent.rootQueueAgent, 'repair-lead');
  assert.strictEqual(acceptedEvent.rootQueueId, 'server-lead-q');
  assert.strictEqual(acceptedEvent.rootTaskId, 'server-lead-task');
  assert(events.some(event => event.type === 'edge.take' && event.from === 'repair-lead' && event.to === 'repair'));
  assert(events.some(event => event.type === 'route.scoped_bypass.fallback' && event.reason === 'missing_acceptance'));
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-boundary-routing-'));
  try {
    unitScopePredicate(root);
    workerIdentityBinding(root);
    secretaryEnvelopeIsCompact(root);
    secretaryRepairLeadSigning(root);
    workerFailClosedFallback(root);
    ceoPromptBoundary(root);
    serverRuntimeConsumption(root);
    const config = JSON.parse(fs.readFileSync(path.join(REPO, 'projects', '控制台', 'config.json'), 'utf8'));
    assert.deepStrictEqual(config.frontDoorPolicy.normalTaskRoute.slice(0, 4), ['chairman', 'secretary', 'ceo', 'supervisor']);
    console.log(JSON.stringify({ pass: true, suite: 'role-boundary-routing', cases: 39 }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
