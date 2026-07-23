#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../../../shared/engine/eventlog');
const OnboardingHandoff = require('../onboarding-handoff');
const QueueAutoMerge = require('../queue-automerge');

const ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(ROOT, 'shared/agents');
const CONFIG_PATH = path.join(ROOT, 'projects/控制台/config.json');
const MODEL_ROUTING = path.join(ROOT, 'shared/routing/model-routing.yaml');
const ARTIFACTS_ROOT = path.join(ROOT, 'projects/控制台/artifacts');
const EVENTS_PATH = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const MAGIC_MUSHROOM_FIXTURE = path.join(ROOT, 'projects/控制台/tests/fixtures/onboarding-handoff/magicmushroom-replay.json');
const PERMISSION_APPROVAL_SCHEMA = 'hr-agent-permission-approval@1';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function listAgents(agentsDir = AGENTS_DIR) {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync(agentsDir); } catch (_) { return out; }
  for (const id of ids) {
    const file = path.join(agentsDir, id, 'agent.json');
    if (fs.existsSync(file)) {
      const agent = readJson(file);
      if (agent) out.push(agent);
    }
  }
  return out;
}

function normalizeSpec(raw) {
  const spec = Object.assign({}, raw || {});
  spec.id = String(spec.id || '').trim();
  spec.name = String(spec.name || spec.id || '').trim();
  spec.role = String(spec.role || '').trim();
  spec.ownership = String(spec.ownership || spec.owner || spec.department || spec.project_scope || '').trim();
  spec.capability = String(spec.capability || spec.responsibility || spec.description || '').trim();
  spec.runner = String(spec.runner || spec.model || spec.quota_model || '').trim();
  spec.read_paths = Array.isArray(spec.read_paths) ? spec.read_paths : [];
  spec.writes = Array.isArray(spec.writes) ? spec.writes : [];
  spec.triggers = Array.isArray(spec.triggers) ? spec.triggers : [];
  return spec;
}

function fourElementCheck(spec) {
  const missing = [];
  if (!spec.ownership) missing.push('归属');
  if (!spec.capability) missing.push('能力');
  if (!spec.runner) missing.push('额度/模型');
  if (!spec.read_paths.length && !spec.writes.length) missing.push('文件权限');
  return missing;
}

function duplicateCheck(spec, options = {}) {
  const agents = listAgents(options.agentsDir || AGENTS_DIR);
  const config = readJson(CONFIG_PATH, { roleRouting: {} });
  const duplicates = [];
  for (const a of agents) {
    if (options.ignoreAgentId && a.id === options.ignoreAgentId) continue;
    if (a.id === spec.id) duplicates.push(`agent id 已存在: ${a.id}`);
    if (a.role === spec.role) duplicates.push(`role 已存在: ${a.role}`);
    if (spec.name && a.name === spec.name) duplicates.push(`name 已存在: ${a.name}`);
  }
  if (config.roleRouting && config.roleRouting[spec.role]) duplicates.push(`config roleRouting 已存在: ${spec.role}`);
  return duplicates;
}

function pathRisk(p, spec) {
  const s = String(p || '');
  if (!s) return null;
  const ownAgentDir = `shared/agents/${spec.id}/`;
  if (s.startsWith(ownAgentDir) || s === ownAgentDir) return null;
  if (s.startsWith('projects/控制台/artifacts/hr/') || s.startsWith('shared/knowledge/')) return null;
  if (/[<*]/.test(s)) return `通配/占位路径: ${s}`;
  if (/^(shared\/engine|shared\/routing|projects\/控制台\/server\.js|projects\/控制台\/ceo-worker\.js|projects\/控制台\/engine-runner\.js|projects\/控制台\/config\.json|board\/|memory\/|knowledge\/|projects\/[^/]+\/)/.test(s)) return `核心或跨域写路径: ${s}`;
  return null;
}

function riskLevel(spec) {
  const reasons = [];
  if (/codex|claude|privileged|repair/i.test(spec.runner)) reasons.push(`付费/强权限 runner: ${spec.runner}`);
  for (const wp of spec.writes) {
    const risk = pathRisk(wp, spec);
    if (risk) reasons.push(risk);
  }
  const result = {
    level: reasons.length ? 'high' : 'low',
    reasons,
    approval_required: reasons.length > 0,
  };
  result.risk_fingerprint = OnboardingHandoff.fingerprint({
    agent_id: spec.id,
    runner: spec.runner,
    writes: spec.writes,
    reasons,
  });
  return result;
}

function validatePermissionApproval(spec, risk, receipt) {
  if (!risk.approval_required) {
    return { pass: true, status: 'not_required', errors: [], receipt_fingerprint: null };
  }
  const approval = receipt && typeof receipt === 'object' ? receipt : {};
  const errors = [];
  if (approval.schema !== PERMISSION_APPROVAL_SCHEMA) errors.push(`permission approval schema must be ${PERMISSION_APPROVAL_SCHEMA}`);
  if (approval.agent_id !== spec.id) errors.push('permission approval agent_id mismatch');
  if (approval.risk_fingerprint !== risk.risk_fingerprint) errors.push('permission approval risk_fingerprint mismatch');
  if (approval.decision !== 'approved') errors.push('permission approval decision must be approved');
  if (approval.approver !== 'hr_manager') errors.push('permission approval approver must be hr_manager');
  if (!Number.isFinite(Date.parse(approval.approved_at))) errors.push('permission approval approved_at invalid');
  return {
    pass: errors.length === 0,
    status: errors.length ? 'required_missing_or_invalid' : 'approved',
    errors,
    receipt_fingerprint: errors.length ? null : OnboardingHandoff.fingerprint(approval),
  };
}

function renderAgentJson(spec) {
  return {
    id: spec.id,
    name: spec.name,
    schema_version: 1,
    role: spec.role,
    runner: spec.runner,
    tier: spec.tier || (spec.runner === 'zhipu-glm' ? 'standard' : 'strong'),
    context_mode: spec.context_mode || 'explicit',
    queueAgent: spec.queueAgent !== false,
    persistent_worker: false,
    system_external: false,
    owner: spec.ownership,
    lifecycle: 'probationary',
    onboarding_required: true,
    onboarding: {
      required: true,
      state_schema: OnboardingHandoff.STATE_SCHEMA,
      state_ref: `projects/控制台/artifacts/hr/onboarding/${spec.id}.json`,
      production_tasks_before_approval: 'blocked',
    },
    read_paths: spec.read_paths,
    writes: spec.writes,
    tools: spec.tools || [],
    triggers: spec.triggers,
    io: {
      inputs: spec.inputs || ['批准后的任务信封'],
      outputs: spec.outputs || ['执行结果与验证证据'],
    },
    boundary_statement: {
      does: spec.capability,
      does_not: spec.does_not || '不越过归属和文件权限;不处理密钥、登录或授权。',
    },
    decoupling: spec.decoupling || '按归属和最小权限工作;超出边界时退回主管或 HR。',
    validation: spec.validation || '创建后必须通过 agents-check 与任务相关 smoke。',
    prompt: 'prompt.md',
  };
}

function renderPrompt(spec) {
  return [
    `# ${spec.name}`,
    '',
    '## 职责边界声明',
    '',
    `我做什么: ${spec.capability}`,
    `我不做什么: ${spec.does_not || '不越过归属和文件权限;不处理密钥、登录或授权。'}`,
    '',
    '## 知识定位',
    '',
    '- 先读自己的任务信封和 `agent.json.read_paths`。',
    '- 不知道数据在哪时查 `shared/DATA-MAP.md`。',
    '- 部门共享知识区按归属读取;深度检索用 `python knowledge/query.py "<问题>"`。',
    '- 长期记忆由记忆官维护,不要把流水账直接写进 `memory/`。',
    '',
    '## 红线',
    '',
    '- 密钥/token/cookie/验证码不回显、不写入文件。',
    '- 登录、扫码、OAuth、2FA、系统授权交给主人手动。',
    '- 超出权限或审批缺失时停下说明。',
    '',
  ].join('\n');
}

function validateSpec(raw, options = {}) {
  const spec = normalizeSpec(raw);
  const missing = fourElementCheck(spec);
  const duplicates = duplicateCheck(spec, options);
  const risk = riskLevel(spec);
  const permissionApproval = validatePermissionApproval(spec, risk, options.permissionApproval || options.permission_approval);
  let handoffPreview = null;
  let handoffErrors = [];
  if (!missing.length) {
    try {
      handoffPreview = OnboardingHandoff.buildPlan(spec, {
        candidates: spec.handoff_candidates || [],
        now: '2000-01-01T00:00:00.000Z',
      });
      handoffErrors = OnboardingHandoff.validatePlan(handoffPreview).errors;
    } catch (error) {
      handoffErrors = [String(error && error.message || error)];
    }
  }
  return {
    pass: missing.length === 0 && duplicates.length === 0 && handoffErrors.length === 0 && permissionApproval.pass,
    spec,
    four_elements: {
      pass: missing.length === 0,
      missing,
    },
    duplicate_check: {
      pass: duplicates.length === 0,
      duplicates,
    },
    risk,
    permission_approval: permissionApproval,
    onboarding_handoff: {
      pass: handoffErrors.length === 0,
      errors: handoffErrors,
      preview: handoffPreview,
      activation_policy: 'probationary until valid receipt, verified provider evidence, HR precheck, and final approval',
    },
    rendered: {
      agent_json: renderAgentJson(spec),
      prompt_md: renderPrompt(spec),
    },
  };
}

function runtimeOptions(options = {}) {
  return {
    stateDir: options.stateDir || OnboardingHandoff.DEFAULT_STATE_DIR,
    queueRoot: options.queueRoot || ARTIFACTS_ROOT,
    eventlog: options.eventlog || new EventLog(options.eventsFile || EVENTS_PATH),
    now: options.now,
    ttlMs: options.ttlMs,
  };
}

function enqueuePlan(plan, runtime) {
  const queueEntry = QueueAutoMerge.enqueue(runtime.queueRoot, plan.agent.id, plan.queue_task, {
    id: `oh-${OnboardingHandoff.fingerprint(plan.plan_id).slice(0, 12)}`,
    priority: 0,
    idem: `onboarding-handoff:${plan.plan_id}`,
    source: 'hr-agent-onboarding',
    projectId: plan.agent.project_id,
    eventlog: runtime.eventlog,
    onboardingStateDir: runtime.stateDir,
  });
  const assigned = OnboardingHandoff.markAssigned(plan.agent.id, queueEntry, {
    stateDir: runtime.stateDir,
    eventlog: runtime.eventlog,
    now: runtime.now,
  });
  return { queueEntry, assigned };
}

function prepareAgent(raw, options = {}) {
  const validation = validateSpec(raw, options);
  if (!validation.pass) {
    const error = new Error(`agent onboarding precheck failed: ${[
      ...validation.four_elements.missing,
      ...validation.duplicate_check.duplicates,
      ...validation.onboarding_handoff.errors,
      ...validation.permission_approval.errors,
    ].join('; ')}`);
    error.code = 'ONBOARDING_PRECHECK_FAILED';
    throw error;
  }
  const runtime = runtimeOptions(options);
  const plan = OnboardingHandoff.buildPlan(validation.spec, {
    candidates: options.candidates || validation.spec.handoff_candidates || [],
    now: runtime.now,
    ttlMs: runtime.ttlMs,
  });
  const prepared = OnboardingHandoff.createState(plan, {
    stateDir: runtime.stateDir,
    eventlog: runtime.eventlog,
    now: runtime.now,
    hrPrecheck: {
      risk_level: validation.risk.level,
      risk_fingerprint: validation.risk.risk_fingerprint,
      permission_approval_status: validation.permission_approval.status,
      permission_approval_receipt_fingerprint: validation.permission_approval.receipt_fingerprint,
    },
  });
  if (!prepared.created && prepared.state.queue && prepared.state.queue.status === 'queued') {
    return { validation, plan: prepared.state.plan, state: prepared.state, state_file: prepared.file, queue_entry: null, reused: true };
  }
  const { queueEntry, assigned } = enqueuePlan(plan, runtime);
  return {
    validation,
    plan,
    state: assigned.state,
    state_file: assigned.file,
    queue_entry: queueEntry,
    reused: false,
  };
}

function persistAgentFiles(validation, options = {}) {
  const agentsDir = options.agentsDir || AGENTS_DIR;
  const target = path.join(agentsDir, validation.spec.id);
  if (fs.existsSync(target)) {
    const error = new Error(`agent directory already exists: ${validation.spec.id}`);
    error.code = 'AGENT_ALREADY_EXISTS';
    throw error;
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  const temp = path.join(agentsDir, `.${validation.spec.id}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  fs.mkdirSync(temp);
  try {
    fs.writeFileSync(path.join(temp, 'agent.json'), JSON.stringify(validation.rendered.agent_json, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(temp, 'prompt.md'), validation.rendered.prompt_md, { flag: 'wx' });
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { recursive: true }); } catch (_) {}
    throw error;
  }
  return {
    directory: target,
    agent_json: path.join(target, 'agent.json'),
    prompt_md: path.join(target, 'prompt.md'),
  };
}

function createAgent(raw, options = {}) {
  const agentsDir = options.agentsDir || AGENTS_DIR;
  const validation = validateSpec(raw, {
    agentsDir,
    permissionApproval: options.permissionApproval || options.permission_approval,
  });
  if (!validation.pass) {
    const error = new Error(`agent create precheck failed: ${[
      ...validation.four_elements.missing,
      ...validation.duplicate_check.duplicates,
      ...validation.onboarding_handoff.errors,
      ...validation.permission_approval.errors,
    ].join('; ')}`);
    error.code = 'ONBOARDING_PRECHECK_FAILED';
    throw error;
  }
  const agentFiles = persistAgentFiles(validation, { agentsDir });
  try {
    const prepared = prepareAgent(raw, Object.assign({}, options, {
      agentsDir,
      ignoreAgentId: validation.spec.id,
    }));
    return Object.assign({}, prepared, {
      created: true,
      agent_files: agentFiles,
      handoff_task: prepared.queue_entry && prepared.queue_entry.task,
    });
  } catch (error) {
    error.code = error.code || 'AGENT_CREATED_PROBATIONARY_HANDOFF_FAILED';
    error.agent_files = agentFiles;
    error.fail_closed = true;
    throw error;
  }
}

function replanAgent(raw, options = {}) {
  const normalized = normalizeSpec(raw);
  const missing = fourElementCheck(normalized);
  if (missing.length) throw new Error(`agent onboarding re-plan precheck failed: ${missing.join('; ')}`);
  const runtime = runtimeOptions(options);
  const replanned = OnboardingHandoff.replan(normalized.id, normalized, {
    stateDir: runtime.stateDir,
    eventlog: runtime.eventlog,
    now: runtime.now,
    ttlMs: runtime.ttlMs,
    candidates: options.candidates || normalized.handoff_candidates || [],
  });
  const { queueEntry, assigned } = enqueuePlan(replanned.state.plan, runtime);
  return {
    plan: assigned.state.plan,
    state: assigned.state,
    state_file: assigned.file,
    queue_entry: queueEntry,
  };
}

function handoffSmoke() {
  const fixture = readJson(MAGIC_MUSHROOM_FIXTURE);
  if (!fixture) throw new Error(`MagicMushroom smoke fixture missing: ${MAGIC_MUSHROOM_FIXTURE}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magicmushroom-onboarding-handoff-'));
  const agentsDir = path.join(tmp, 'agents');
  const stateDir = path.join(tmp, 'state');
  const queueRoot = path.join(tmp, 'queue-root');
  const eventsFile = path.join(tmp, 'events.jsonl');
  const eventlog = new EventLog(eventsFile);
  const created = createAgent(fixture.spec, {
    agentsDir,
    candidates: fixture.candidates,
    stateDir,
    queueRoot,
    eventlog,
    now: fixture.now,
    ttlMs: fixture.ttl_ms,
  });
  let preApprovalBlocked = false;
  let preApprovalReason = null;
  try {
    QueueAutoMerge.enqueue(queueRoot, fixture.spec.id, fixture.production_task, {
      onboardingStateDir: stateDir,
      onboardingAgentDir: agentsDir,
      eventlog,
      source: 'magicmushroom-handoff-smoke',
    });
  } catch (error) {
    preApprovalBlocked = error && error.code === 'ONBOARDING_PROBATIONARY';
    preApprovalReason = error && error.admission && error.admission.reason || String(error && error.message || error);
  }
  const receipt = Object.assign({}, fixture.receipt, {
    plan_id: created.plan.plan_id,
    agent_id: fixture.spec.id,
  });
  OnboardingHandoff.recordReceipt(fixture.spec.id, receipt, {
    stateDir,
    eventlog,
    now: fixture.received_at,
  });
  const approved = OnboardingHandoff.approve(fixture.spec.id, created.plan.approval_route.final_approver, {
    stateDir,
    agentDir: agentsDir,
    eventlog,
    now: fixture.approved_at,
  });
  const productionEntry = QueueAutoMerge.enqueue(queueRoot, fixture.spec.id, fixture.production_task, {
    onboardingStateDir: stateDir,
    onboardingAgentDir: agentsDir,
    eventlog,
    source: 'magicmushroom-handoff-smoke',
  });
  const activeAgentRecord = readJson(path.join(agentsDir, fixture.spec.id, 'agent.json'));
  const eventTypes = eventlog.since(0).map(event => event.type);
  const requiredObserved = [
    'onboarding.handoff.planned',
    'onboarding.handoff.assigned',
    'onboarding.handoff.received',
    'onboarding.handoff.approved',
  ].every(type => eventTypes.includes(type));
  const pass = created.created === true
    && created.plan.selection.selected_agent === fixture.expected.selected_agent
    && created.plan.approval_route.final_approver === fixture.expected.final_approver
    && preApprovalBlocked
    && approved.state.lifecycle === 'active'
    && activeAgentRecord
    && activeAgentRecord.lifecycle === 'active'
    && activeAgentRecord.onboarding.required === false
    && productionEntry.onboardingAdmission.allowed === true
    && requiredObserved;
  return {
    schema: 'magicmushroom-onboarding-handoff-smoke@1',
    pass,
    fixture: path.relative(ROOT, MAGIC_MUSHROOM_FIXTURE),
    selected_agent: created.plan.selection.selected_agent,
    selection_algorithm: created.plan.selection.algorithm,
    selection_evidence_refs: created.plan.selection.evidence_refs,
    final_approver: created.plan.approval_route.final_approver,
    pre_approval: { blocked: preApprovalBlocked, reason: preApprovalReason },
    post_approval: {
      lifecycle: approved.state.lifecycle,
      agent_record_lifecycle: activeAgentRecord && activeAgentRecord.lifecycle,
      production_queue_id: productionEntry.id,
      production_admission_allowed: productionEntry.onboardingAdmission.allowed,
    },
    event_types: eventTypes.filter(type => type.startsWith('onboarding.')),
    temp_root: tmp,
  };
}

function smoke() {
  const required = ['hr-manager', 'hr-specialist'];
  const agents = listAgents();
  const ids = new Set(agents.map(a => a.id));
  const config = readJson(CONFIG_PATH, { roleRouting: {} });
  const routingText = fs.readFileSync(MODEL_ROUTING, 'utf8');
  const sample = {
    id: `hr-smoke-agent-${Date.now()}`,
    name: 'HR Smoke Agent',
    role: `hr_smoke_agent_${Math.random().toString(16).slice(2, 8)}`,
    ownership: 'HR',
    capability: '只用于验证 HR 入职流程模板渲染。',
    runner: 'zhipu-glm',
    read_paths: ['shared/DATA-MAP.md', 'shared/knowledge/hr/'],
    writes: [`shared/agents/hr-smoke-agent/`],
    triggers: ['HR smoke'],
  };
  const validation = validateSpec(sample);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-onboarding-smoke-'));
  fs.writeFileSync(path.join(tmp, 'agent.json'), JSON.stringify(validation.rendered.agent_json, null, 2) + '\n');
  fs.writeFileSync(path.join(tmp, 'prompt.md'), validation.rendered.prompt_md);
  return {
    pass: required.every(id => ids.has(id))
      && Boolean(config.roleRouting && config.roleRouting.hr_manager && config.roleRouting.hr_specialist)
      && /hr_manager:/.test(routingText)
      && /hr_specialist:/.test(routingText)
      && validation.pass,
    required_agents: required.map(id => ({ id, present: ids.has(id) })),
    routing: {
      config_hr_manager: Boolean(config.roleRouting && config.roleRouting.hr_manager),
      config_hr_specialist: Boolean(config.roleRouting && config.roleRouting.hr_specialist),
      model_hr_manager: /hr_manager:/.test(routingText),
      model_hr_specialist: /hr_specialist:/.test(routingText),
    },
    flow: ['四要素校验', '查重', '分级审批', '填模板', '注册校验', 'smoke校验', '花名册'],
    sample_validation: validation,
    rendered_tmp: tmp,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0] || 'help';
  if (cmd === 'validate') {
    if (!args.spec) throw new Error('validate requires --spec <file>');
    const result = validateSpec(readJson(path.resolve(args.spec), {}), {
      permissionApproval: args['permission-approval'] ? readJson(path.resolve(args['permission-approval']), {}) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 2);
  }
  if (cmd === 'smoke') {
    const result = smoke();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }
  if (cmd === 'prepare') {
    if (!args.spec) throw new Error('prepare requires --spec <file>');
    const result = prepareAgent(readJson(path.resolve(args.spec), {}), {
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      queueRoot: args['queue-root'] ? path.resolve(args['queue-root']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
      ttlMs: args['ttl-ms'] ? Number(args['ttl-ms']) : undefined,
      permissionApproval: args['permission-approval'] ? readJson(path.resolve(args['permission-approval']), {}) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'create') {
    if (!args.spec) throw new Error('create requires --spec <file>');
    const result = createAgent(readJson(path.resolve(args.spec), {}), {
      agentsDir: args['agents-dir'] ? path.resolve(args['agents-dir']) : undefined,
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      queueRoot: args['queue-root'] ? path.resolve(args['queue-root']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
      ttlMs: args['ttl-ms'] ? Number(args['ttl-ms']) : undefined,
      permissionApproval: args['permission-approval'] ? readJson(path.resolve(args['permission-approval']), {}) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'receive') {
    if (!args.agent || !args.receipt) throw new Error('receive requires --agent <id> --receipt <file>');
    const runtime = runtimeOptions({
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
    });
    const result = OnboardingHandoff.recordReceipt(args.agent, readJson(path.resolve(args.receipt), {}), runtime);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'replan') {
    if (!args.spec) throw new Error('replan requires --spec <file>');
    const result = replanAgent(readJson(path.resolve(args.spec), {}), {
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      queueRoot: args['queue-root'] ? path.resolve(args['queue-root']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
      ttlMs: args['ttl-ms'] ? Number(args['ttl-ms']) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'approve') {
    if (!args.agent || !args.approver) throw new Error('approve requires --agent <id> --approver <id>');
    const runtime = runtimeOptions({
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
    });
    const result = OnboardingHandoff.approve(args.agent, args.approver, Object.assign({}, runtime, {
      agentDir: args['agents-dir'] ? path.resolve(args['agents-dir']) : undefined,
    }));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'reject') {
    if (!args.agent || !args.approver || !args.reason) throw new Error('reject requires --agent <id> --approver <id> --reason <text>');
    const runtime = runtimeOptions({
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
    });
    const result = OnboardingHandoff.reject(args.agent, args.approver, args.reason, runtime);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (cmd === 'sweep') {
    const runtime = runtimeOptions({
      stateDir: args['state-dir'] ? path.resolve(args['state-dir']) : undefined,
      queueRoot: args['queue-root'] ? path.resolve(args['queue-root']) : undefined,
      eventsFile: args.events ? path.resolve(args.events) : undefined,
    });
    const reminders = OnboardingHandoff.sweepTimeouts({
      stateDir: runtime.stateDir,
      eventlog: runtime.eventlog,
      enqueueReminder(target, reminder) {
        return QueueAutoMerge.enqueue(runtime.queueRoot, target, reminder, {
          eventlog: runtime.eventlog,
          onboardingStateDir: runtime.stateDir,
          idem: `onboarding-reminder:${reminder.plan_id}:${reminder.due_at}`,
          source: 'hr-agent-onboarding-sweep',
        });
      },
    });
    console.log(JSON.stringify({ pass: true, reminders }, null, 2));
    process.exit(0);
  }
  if (cmd === 'handoff-smoke') {
    const result = handoffSmoke();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }
  console.log('Usage: node projects/控制台/tools/hr-agent-onboarding.js validate --spec <spec.json>');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js smoke');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js prepare --spec <spec.json> [--state-dir <dir> --queue-root <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js create --spec <spec.json> [--permission-approval <receipt.json> --agents-dir <dir> --state-dir <dir> --queue-root <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js receive --agent <id> --receipt <file> [--state-dir <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js replan --spec <spec.json> [--state-dir <dir> --queue-root <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js approve --agent <id> --approver <id> [--agents-dir <dir> --state-dir <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js reject --agent <id> --approver <id> --reason <text> [--state-dir <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js sweep [--state-dir <dir> --queue-root <dir>]');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js handoff-smoke');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    console.error(e && e.stack || e);
    process.exit(1);
  }
}

module.exports = {
  normalizeSpec,
  fourElementCheck,
  duplicateCheck,
  riskLevel,
  validatePermissionApproval,
  PERMISSION_APPROVAL_SCHEMA,
  validateSpec,
  prepareAgent,
  createAgent,
  persistAgentFiles,
  replanAgent,
  smoke,
  handoffSmoke,
};
