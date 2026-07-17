'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Q = require('../../shared/engine/queue');

const BUS_SCHEMA = 'yutu6.role-receipt-bus.v1';
const STATE_SCHEMA = 'yutu6.role-receipt-bus-state.v2';
const RECEIPT_SCHEMA = 'yutu6.independent-role-receipt.v1';
const PROVENANCE_SCHEMA = 'yutu6.independent-review-provenance.v1';
const TRACE_SCHEMA = 'yutu6-interaction-trace@1';
const ALLOWED_ROLES = new Set(['quality_ops', 'governance']);
const TERMINAL = new Set(['done', 'failed', 'canceled']);
const SHA256_RE = /^[a-f0-9]{64}$/;

function nowIso(opts) {
  return new Date(opts && typeof opts.now === 'function' ? opts.now() : Date.now()).toISOString();
}

function nowMs(opts) {
  const value = opts && typeof opts.now === 'function' ? Number(opts.now()) : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeToken(value) {
  const text = String(value || '').trim();
  return text !== '.' && text !== '..' && /^[\p{L}\p{N}_.-]+$/u.test(text) ? text : '';
}

function busDir(queueRoot, rootTaskId, parentTaskId) {
  return path.join(queueRoot, 'role-receipts', safeToken(rootTaskId), safeToken(parentTaskId));
}

function stateFile(queueRoot, rootTaskId, parentTaskId) {
  return path.join(busDir(queueRoot, rootTaskId, parentTaskId), 'state.json');
}

function receiptFile(queueRoot, rootTaskId, parentTaskId, receiptId) {
  return path.join(busDir(queueRoot, rootTaskId, parentTaskId), 'receipts', `${safeToken(receiptId)}.json`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function workspaceFile(workspaceRoot, ref) {
  const root = path.resolve(workspaceRoot || path.resolve(__dirname, '../..'));
  const rel = String(ref || '').trim();
  if (!rel || path.isAbsolute(rel)) return null;
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  return { root, file, relative: path.relative(root, file) };
}

function fileSha256(workspaceRoot, ref) {
  const resolved = workspaceFile(workspaceRoot, ref);
  if (!resolved) return null;
  try {
    if (fs.lstatSync(resolved.file).isSymbolicLink() || !fs.statSync(resolved.file).isFile()) return null;
    const real = fs.realpathSync(resolved.file);
    const realRoot = fs.realpathSync(resolved.root);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return null;
    return { sha256: sha256(fs.readFileSync(resolved.file)), resolved };
  } catch (_) {
    return null;
  }
}

function interactionTraceFiles(workspaceRoot, taskId) {
  const root = path.resolve(workspaceRoot || path.resolve(__dirname, '../..'));
  const runRoot = path.join(root, 'projects', '控制台', 'artifacts', 'engine-runs', safeToken(taskId));
  let names;
  try {
    if (fs.lstatSync(runRoot).isSymbolicLink()) return [];
    names = fs.readdirSync(runRoot);
  }
  catch (_) { return []; }
  const realRunRoot = fs.realpathSync(runRoot);
  return names.map(name => path.join(runRoot, name, 'interaction-trace.json'))
    .filter(file => {
      try {
        return !fs.lstatSync(file).isSymbolicLink()
          && fs.statSync(file).isFile()
          && fs.realpathSync(file).startsWith(`${realRunRoot}${path.sep}`);
      }
      catch (_) { return false; }
    });
}

function eventLogFiles(workspaceRoot, opts = {}) {
  const root = path.resolve(workspaceRoot || path.resolve(__dirname, '../..'));
  if (opts.eventLogPath) {
    const explicit = path.isAbsolute(opts.eventLogPath)
      ? { file: path.resolve(opts.eventLogPath), relative: path.relative(root, path.resolve(opts.eventLogPath)) }
      : workspaceFile(root, opts.eventLogPath);
    return explicit && explicit.file.startsWith(`${root}${path.sep}`) ? [explicit] : [];
  }
  const artifacts = path.join(root, 'projects', '控制台', 'artifacts');
  let names;
  try { names = fs.readdirSync(artifacts); }
  catch (_) { return []; }
  return names.filter(name => /^engine-events(?:\..+)?\.jsonl$/.test(name))
    .map(name => ({ file: path.join(artifacts, name), relative: path.relative(root, path.join(artifacts, name)) }));
}

function terminalTraceEvent(workspaceRoot, trace, opts = {}) {
  const matches = [];
  for (const candidate of eventLogFiles(workspaceRoot, opts)) {
    let lines;
    try {
      if (fs.lstatSync(candidate.file).isSymbolicLink()) continue;
      lines = fs.readFileSync(candidate.file, 'utf8').split(/\r?\n/);
    }
    catch (_) { continue; }
    for (const line of lines) {
      if (!line || !line.includes(trace.trace_id)) continue;
      let event;
      try { event = JSON.parse(line); }
      catch (_) { continue; }
      if (event.type !== 'interaction.trace.finished'
        || event.task !== trace.task_id
        || event.traceId !== trace.trace_id
        || event.role !== trace.agent_role
        || event.runner !== trace.runner_id
        || event.status !== trace.status
        || !Number.isInteger(event.seq)
        || !Number.isFinite(Date.parse(event.ts || ''))) continue;
      const skewMs = Math.abs(Date.parse(event.ts) - Date.parse(trace.finished_at));
      if (!Number.isFinite(skewMs) || skewMs > 60000) continue;
      matches.push({ event, relative: candidate.relative });
    }
  }
  if (!matches.length) return null;
  const match = matches.sort((a, b) => b.event.seq - a.event.seq)[0];
  return {
    type: match.event.type,
    seq: match.event.seq,
    at: match.event.ts,
    status: match.event.status,
    eventLogPath: match.relative,
  };
}

function traceIdentityReason(trace, expected) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return 'provenance_trace_invalid';
  if (trace.schema !== TRACE_SCHEMA) return 'provenance_trace_schema_mismatch';
  const identity = [
    ['task_id', expected.taskId],
    ['root_task_id', expected.rootTaskId],
    ['queue_agent', expected.role],
    ['queue_id', expected.queueId],
    ['agent_role', expected.role],
  ];
  for (const [key, value] of identity) {
    if (trace[key] !== value) return `provenance_trace_identity_mismatch:${key}`;
  }
  if (!safeToken(trace.trace_id)) return 'provenance_trace_id_invalid';
  if (!safeToken(trace.runner_id) || !safeToken(trace.runner_kind)) return 'provenance_runner_invalid';
  if (trace.status !== 'completed') return 'provenance_trace_not_completed';
  const started = Date.parse(trace.started_at || '');
  const finished = Date.parse(trace.finished_at || '');
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return 'provenance_time_window_invalid';
  if (!trace.prompt || !SHA256_RE.test(String(trace.prompt.sha256 || ''))) return 'provenance_prompt_hash_invalid';
  if (!trace.output || !SHA256_RE.test(String(trace.output.sha256 || ''))) return 'provenance_output_hash_invalid';
  if (trace.observability_status === 'warning'
    || (Array.isArray(trace.observability_warning) && trace.observability_warning.length)
    || (Array.isArray(trace.hook_error) && trace.hook_error.length)) return 'provenance_trace_observability_warning';
  return null;
}

function buildProvenance(spec, review, resultText, opts = {}) {
  const expected = {
    taskId: spec.taskId,
    rootTaskId: spec.rootTaskId,
    queueId: spec.queueId,
    role: spec.role,
  };
  const resultHash = sha256(String(resultText || ''));
  const candidates = [];
  for (const manifestFile of interactionTraceFiles(opts.workspaceRoot, spec.taskId)) {
    const trace = readJson(manifestFile);
    if (!trace || !trace.output || trace.output.sha256 !== resultHash) continue;
    candidates.push({ manifestFile, trace });
  }
  if (!candidates.length) return { ok: false, reason: 'provenance_trace_missing' };
  if (candidates.length !== 1) return { ok: false, reason: 'provenance_trace_ambiguous' };
  const { manifestFile, trace } = candidates[0];
  const identityReason = traceIdentityReason(trace, expected);
  if (identityReason) return { ok: false, reason: identityReason };
  const root = path.resolve(opts.workspaceRoot || path.resolve(__dirname, '../..'));
  const manifestPath = path.relative(root, manifestFile);
  if (trace.manifest_path !== manifestPath) return { ok: false, reason: 'provenance_manifest_path_mismatch' };
  const taskRunRoot = path.join(root, 'projects', '控制台', 'artifacts', 'engine-runs', safeToken(spec.taskId));
  for (const ref of [trace.prompt.raw_path, trace.output.raw_path, trace.manifest_path]) {
    const resolved = workspaceFile(root, ref);
    if (!resolved || (resolved.file !== taskRunRoot && !resolved.file.startsWith(`${taskRunRoot}${path.sep}`))) {
      return { ok: false, reason: 'provenance_artifact_path_invalid' };
    }
  }
  const promptHash = fileSha256(root, trace.prompt.raw_path);
  const outputHash = fileSha256(root, trace.output.raw_path);
  if (!promptHash || promptHash.sha256 !== trace.prompt.sha256) return { ok: false, reason: 'provenance_prompt_hash_mismatch' };
  if (!outputHash || outputHash.sha256 !== trace.output.sha256 || outputHash.sha256 !== resultHash) {
    return { ok: false, reason: 'provenance_output_hash_mismatch' };
  }
  if (Math.abs(Date.parse(review.completedAt) - Date.parse(trace.finished_at)) > 60000) {
    return { ok: false, reason: 'provenance_completed_at_mismatch' };
  }
  const terminalEvent = terminalTraceEvent(root, trace, opts);
  if (!terminalEvent) return { ok: false, reason: 'provenance_terminal_event_missing' };
  const contextBindingSha256 = sha256([
    trace.task_id,
    trace.trace_id,
    trace.agent_role,
    trace.agent_id || '',
    trace.runner_id,
    trace.runner_kind,
    trace.queue_agent,
    trace.queue_id,
  ].join('|'));
  return {
    ok: true,
    provenance: {
      schemaVersion: PROVENANCE_SCHEMA,
      taskId: trace.task_id,
      traceId: trace.trace_id,
      role: trace.agent_role,
      runner: {
        id: trace.runner_id,
        kind: trace.runner_kind,
        agentId: trace.agent_id || null,
        contextBindingSha256,
      },
      prompt: { sha256: trace.prompt.sha256, path: trace.prompt.raw_path },
      output: { sha256: trace.output.sha256, path: trace.output.raw_path },
      timeWindow: {
        startedAt: trace.started_at,
        finishedAt: trace.finished_at,
        durationMs: Date.parse(trace.finished_at) - Date.parse(trace.started_at),
      },
      terminalEvent,
      manifestPath,
    },
  };
}

function validateCommittedRecord(value, expected, opts = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'provenance_record_invalid' };
  if (value.schemaVersion !== PROVENANCE_SCHEMA || !value.review || !value.provenance) {
    return { ok: false, reason: 'provenance_record_missing' };
  }
  if (Object.keys(value).sort().join(',') !== 'provenance,review,schemaVersion') return { ok: false, reason: 'provenance_record_unknown_fields' };
  const checked = validateReceipt(value.review, expected);
  if (!checked.ok) return checked;
  const resultRef = workspaceFile(opts.workspaceRoot, value.provenance.output && value.provenance.output.path);
  if (!resultRef) return { ok: false, reason: 'provenance_output_path_invalid' };
  let resultText;
  try { resultText = fs.readFileSync(resultRef.file, 'utf8'); }
  catch (_) { return { ok: false, reason: 'provenance_output_file_missing' }; }
  const extracted = extractReceipt(resultText);
  if (!extracted.ok || JSON.stringify(extracted.receipt) !== JSON.stringify(value.review)) {
    return { ok: false, reason: 'provenance_review_output_mismatch' };
  }
  const rebuilt = buildProvenance(Object.assign({}, expected, { queueAgent: expected.role }), value.review, resultText, opts);
  if (!rebuilt.ok) return rebuilt;
  if (JSON.stringify(rebuilt.provenance) !== JSON.stringify(value.provenance)) return { ok: false, reason: 'provenance_record_tampered' };
  return { ok: true, review: value.review, provenance: value.provenance, warnings: [] };
}

function withBusLock(queueRoot, rootTaskId, parentTaskId, fn) {
  const lock = path.join(busDir(queueRoot, rootTaskId, parentTaskId), '.state.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  let acquired = false;
  for (let attempt = 0; attempt < 80 && !acquired; attempt++) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      acquired = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lock).mtimeMs;
        if (ageMs > 30000) fs.rmSync(lock, { recursive: true, force: true });
      } catch (_) {}
      if (!acquired) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  if (!acquired) throw new Error('independent receipt state lock timeout');
  try { return fn(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function emit(opts, type, payload) {
  try {
    if (opts && opts.eventlog && typeof opts.eventlog.emit === 'function') opts.eventlog.emit(type, payload);
  } catch (_) {}
}

function normalizedRequirements(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('requiredIndependentReceipts must be an array');
  const seen = new Set();
  const normalized = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`independent receipt requirement ${index} must be an object`);
    const role = String(item.role || '').trim();
    if (!ALLOWED_ROLES.has(role)) throw new Error(`unsupported independent receipt role: ${role || '(empty)'}`);
    if (seen.has(role)) throw new Error(`duplicate independent receipt role: ${role}`);
    seen.add(role);
    const goal = String(item.goal || '').trim();
    const acceptance = String(item.acceptance || '').trim();
    if (!goal || !acceptance) throw new Error(`${role} independent receipt requires goal and acceptance`);
    const timeoutMs = Math.max(50, Math.min(Number(item.timeoutMs || 300000) || 300000, 30 * 60 * 1000));
    const maxAttempts = Math.max(1, Math.min(Number(item.maxAttempts || 2) || 2, 3));
    return { role, goal, acceptance, timeoutMs, maxAttempts };
  });
  if (normalized.length === 1) {
    throw new Error('requiredIndependentReceipts independent mode requires at least 2 distinct roles');
  }
  return normalized;
}

function classifyStatePolicy(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { mode: 'blocked', reason: 'state_invalid' };
  }
  // There are no persisted role-receipt states predating this policy. A legacy
  // exemption based on fields inside this same writable file would let a fresh
  // state spoof its schema/time and bypass provenance, so only v2 is trusted.
  if (state.schemaVersion !== STATE_SCHEMA) {
    return { mode: 'blocked', reason: 'state_schema_unsupported' };
  }
  const policy = state.provenancePolicy;
  if (policy != null) {
    const fields = policy && typeof policy === 'object' && !Array.isArray(policy)
      ? Object.keys(policy).sort().join(',')
      : '';
    if (fields !== 'activatedAt,legacyCutover,mode,schemaVersion'
      || policy.schemaVersion !== PROVENANCE_SCHEMA
      || policy.mode !== 'required'
      || policy.legacyCutover !== 'state_schema_boundary'
      || !Number.isFinite(Date.parse(policy.activatedAt || ''))
      || policy.activatedAt !== state.createdAt) {
      return { mode: 'blocked', reason: 'provenance_policy_invalid' };
    }
    return { mode: 'required', reason: null };
  }
  return { mode: 'blocked', reason: 'provenance_policy_missing' };
}

function chainTimeoutMs(requirements, opts = {}) {
  const explicit = Number(opts.timeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(50, explicit);
  const attemptsBudget = Math.max(...requirements.map(item => item.timeoutMs * item.maxAttempts));
  const pollGrace = Math.max(50, Math.min(Number(opts.pollMs || 250) * 2 || 500, 5000));
  return attemptsBudget + pollGrace;
}

function rootIdentity(spec) {
  const rootTaskId = safeToken(spec && (spec.rootTaskId || spec.taskId));
  const parentTaskId = safeToken(spec && spec.taskId);
  if (!rootTaskId || !parentTaskId) throw new Error('independent receipt coordinator requires rootTaskId and taskId');
  return { rootTaskId, parentTaskId };
}

function deterministicId(rootTaskId, parentTaskId, role, attempt) {
  const hash = crypto.createHash('sha256').update([rootTaskId, parentTaskId, role, attempt].join('|')).digest('hex').slice(0, 12);
  return `rr-${role.replace(/_/g, '-')}-${hash}`;
}

function receiptIdFor(rootTaskId, parentTaskId, role) {
  const hash = crypto.createHash('sha256').update([rootTaskId, parentTaskId, role].join('|')).digest('hex').slice(0, 16);
  return `receipt-${role.replace(/_/g, '-')}-${hash}`;
}

function queueEntry(queueRoot, agent, id) {
  const dir = Q.qdir(queueRoot, agent);
  const queued = (() => {
    try { return fs.readdirSync(dir).find(name => name.endsWith(`-${id}.json`)); }
    catch (_) { return null; }
  })();
  const candidates = [
    queued ? { status: 'queued', file: path.join(dir, queued) } : null,
    ...['running', 'paused', 'done', 'failed', 'canceled'].map(status => ({ status, file: path.join(dir, status, `${id}.json`) })),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const entry = readJson(candidate.file);
    if (entry) return { status: entry.status || candidate.status, entry, file: candidate.file };
  }
  return null;
}

function roleSpecificContract(role) {
  if (role === 'quality_ops') {
    return '角色专属字段: qualityScore(0..100 number), checks(非空 string[])。';
  }
  return '角色专属字段: complianceCheckResult(pass|fail|needs_review), findings(string[])。';
}

function assignmentTask(spec, requirement, assignment, attempt) {
  const { rootTaskId, parentTaskId } = rootIdentity(spec);
  const role = requirement.role;
  const common = [
    '你是独立角色执行者，必须实际复核，不得让 worker_code 代写或转述回执。',
    requirement.goal,
    '',
    '最终只输出一个 ```json 代码块，根键必须为 independent_receipt。',
    `公共字段必须精确包含 schemaVersion=${RECEIPT_SCHEMA}、role=${role}、queueId(取本任务头)、taskId(取本任务头)、rootTaskId=${rootTaskId}、verdict(pass|fail|needs_review)、evidence([{path,summary}])、completedAt(ISO-8601)。`,
    roleSpecificContract(role),
    'taskId/traceId/runner/prompt hash/output hash/时间窗/终态事件由控制台从 interaction trace 与事件日志生成 provenance；不得用 reviewer_task_path 或正文自称替代。',
    '不得增加未知字段；JSON 无法解析、身份字段不一致、证据为空或角色专属字段缺失都会由输出门拒绝并重试。',
  ].join('\n');
  return {
    role,
    flowId: 'agent-once',
    projectId: spec.projectId,
    scopedToProject: true,
    goal: common,
    bounds: spec.bounds,
    acceptance: requirement.acceptance,
    useOrchestrator: false,
    autoApproveHuman: true,
    rootQueueAgent: spec.rootQueueAgent || spec.queueAgent,
    rootQueueId: spec.rootQueueId || spec.queueId,
    rootTaskId,
    parentTaskId,
    independentReceipt: {
      schemaVersion: BUS_SCHEMA,
      receiptId: assignment.receiptId,
      role,
      rootTaskId,
      parentTaskId,
      attempt,
    },
  };
}

function initialState(spec, requirements, opts) {
  const { rootTaskId, parentTaskId } = rootIdentity(spec);
  const at = nowIso(opts);
  const deadlineAt = new Date(nowMs(opts) + chainTimeoutMs(requirements, opts)).toISOString();
  const assignments = {};
  for (const requirement of requirements) {
    assignments[requirement.role] = {
      role: requirement.role,
      receiptId: receiptIdFor(rootTaskId, parentTaskId, requirement.role),
      status: 'pending',
      attempts: 0,
      maxAttempts: requirement.maxAttempts,
      timeoutMs: requirement.timeoutMs,
      queueIds: [],
      activeQueueId: null,
      attemptStartedAt: null,
      attemptDeadlineAt: null,
      timedOutQueueIds: [],
      lastError: null,
      verdict: null,
      receiptFile: null,
    };
  }
  return {
    schemaVersion: STATE_SCHEMA,
    rootTaskId,
    parentTaskId,
    projectId: spec.projectId,
    provenancePolicy: {
      schemaVersion: PROVENANCE_SCHEMA,
      mode: 'required',
      activatedAt: at,
      legacyCutover: 'state_schema_boundary',
    },
    observabilityStatus: 'waiting',
    warnings: [],
    requirements: requirements.map(item => Object.assign({}, item)),
    status: 'waiting',
    createdAt: at,
    updatedAt: at,
    deadlineAt,
    escalatedAt: null,
    escalationReason: null,
    assignments,
  };
}

function enqueueAttempt(spec, requirement, state, opts) {
  const assignment = state.assignments[requirement.role];
  const attempt = assignment.attempts + 1;
  if (attempt > assignment.maxAttempts) return assignment;
  const queueId = deterministicId(state.rootTaskId, state.parentTaskId, requirement.role, attempt);
  if (!queueEntry(opts.queueRoot, requirement.role, queueId)) {
    const task = assignmentTask(spec, requirement, assignment, attempt);
    const enqueue = typeof opts.enqueue === 'function'
      ? opts.enqueue
      : (agent, value, enqueueOpts) => Q.enqueue(opts.queueRoot, agent, value, enqueueOpts);
    enqueue(requirement.role, task, {
      id: queueId,
      priority: opts.priority == null ? 40 : opts.priority,
      idem: `independent-receipt:${assignment.receiptId}:${attempt}`,
      source: 'independent-role-receipt',
    });
  }
  assignment.attempts = attempt;
  assignment.status = 'queued';
  assignment.activeQueueId = queueId;
  if (!assignment.queueIds.includes(queueId)) assignment.queueIds.push(queueId);
  const startedAtMs = nowMs(opts);
  assignment.attemptStartedAt = new Date(startedAtMs).toISOString();
  assignment.attemptDeadlineAt = new Date(startedAtMs + requirement.timeoutMs).toISOString();
  assignment.timedOutQueueIds = Array.isArray(assignment.timedOutQueueIds) ? assignment.timedOutQueueIds : [];
  assignment.lastError = null;
  assignment.updatedAt = nowIso(opts);
  state.updatedAt = assignment.updatedAt;
  // 先持久化 assignment identity，再发 queue.enqueued 唤醒 worker；否则极快的
  // mock/本机 runner 可能在 state 落盘前提交回执而被误判为冒名。
  writeJsonAtomic(stateFile(opts.queueRoot, state.rootTaskId, state.parentTaskId), state);
  emit(opts, 'role.receipt.assignment.enqueued', {
    role: requirement.role,
    queueAgent: requirement.role,
    queueId,
    rootTaskId: state.rootTaskId,
    parentTaskId: state.parentTaskId,
    receiptId: assignment.receiptId,
    attempt,
  });
  emit(opts, 'queue.enqueued', {
    queueAgent: requirement.role,
    queueId,
    source: 'independent-role-receipt',
    rootQueueAgent: spec.rootQueueAgent || spec.queueAgent || null,
    rootQueueId: spec.rootQueueId || spec.queueId || null,
    rootTaskId: state.rootTaskId,
    parentTaskId: state.parentTaskId,
    receiptId: assignment.receiptId,
  });
  return assignment;
}

function ensureAssignmentsUnlocked(spec, opts = {}) {
  const requirements = normalizedRequirements(spec && spec.requiredIndependentReceipts);
  if (!requirements.length) return { required: false, requirements, state: null };
  if (!opts.queueRoot) throw new Error('independent receipt coordinator requires queueRoot');
  const identity = rootIdentity(spec);
  const file = stateFile(opts.queueRoot, identity.rootTaskId, identity.parentTaskId);
  let state = readJson(file);
  if (state && (![BUS_SCHEMA, STATE_SCHEMA].includes(state.schemaVersion) || state.parentTaskId !== identity.parentTaskId)) {
    throw new Error('independent receipt state identity conflict');
  }
  if (!state) state = initialState(spec, requirements, opts);
  const policy = classifyStatePolicy(state);
  if (JSON.stringify(state.requirements) !== JSON.stringify(requirements)) {
    throw new Error('independent receipt requirement conflict');
  }
  if (policy.mode === 'blocked') {
    state.observabilityStatus = 'blocked';
    state.warnings = [...new Set([...(state.warnings || []), policy.reason])];
    state.updatedAt = nowIso(opts);
    writeJsonAtomic(file, state);
    return { required: true, requirements, state, file, policy };
  }
  if (!Number.isFinite(Date.parse(state.deadlineAt || ''))) {
    const createdAtMs = Number.isFinite(Date.parse(state.createdAt || '')) ? Date.parse(state.createdAt) : nowMs(opts);
    state.deadlineAt = new Date(createdAtMs + chainTimeoutMs(requirements, opts)).toISOString();
  }
  for (const requirement of requirements) {
    if (!state.assignments[requirement.role]) throw new Error(`independent receipt state missing ${requirement.role}`);
    const assignment = state.assignments[requirement.role];
    const durableReceiptPath = receiptFile(opts.queueRoot, identity.rootTaskId, identity.parentTaskId, assignment.receiptId);
    const existingReceipt = readJson(durableReceiptPath);
    if (existingReceipt) {
      // 各角色回执先落独立文件；state 是可重建索引。并发角色即使最后写 state
      // 覆盖彼此状态，也会在下一次协调时从独立回执恢复一致视图。
      const persistedReview = existingReceipt.review || existingReceipt;
      assignment.status = 'delivered';
      assignment.verdict = persistedReview.verdict;
      assignment.receiptFile = path.relative(opts.queueRoot, durableReceiptPath);
      assignment.completedAt = persistedReview.completedAt;
      assignment.traceId = existingReceipt.provenance && existingReceipt.provenance.traceId || assignment.traceId || null;
      assignment.runnerId = existingReceipt.provenance && existingReceipt.provenance.runner && existingReceipt.provenance.runner.id || assignment.runnerId || null;
      assignment.provenanceStatus = existingReceipt.provenance ? 'verified' : 'legacy_missing';
      continue;
    }
    assignment.timedOutQueueIds = Array.isArray(assignment.timedOutQueueIds) ? assignment.timedOutQueueIds : [];
    let active = assignment.activeQueueId && queueEntry(opts.queueRoot, requirement.role, assignment.activeQueueId);
    if (active && !TERMINAL.has(active.status)) {
      if (!Number.isFinite(Date.parse(assignment.attemptDeadlineAt || ''))) {
        const startedAtMs = Number.isFinite(Date.parse(assignment.attemptStartedAt || assignment.updatedAt || ''))
          ? Date.parse(assignment.attemptStartedAt || assignment.updatedAt)
          : nowMs(opts);
        assignment.attemptStartedAt = new Date(startedAtMs).toISOString();
        assignment.attemptDeadlineAt = new Date(startedAtMs + requirement.timeoutMs).toISOString();
      }
      if (nowMs(opts) >= Date.parse(assignment.attemptDeadlineAt)) {
        const timedOutQueueId = assignment.activeQueueId;
        if (!assignment.timedOutQueueIds.includes(timedOutQueueId)) {
          assignment.timedOutQueueIds.push(timedOutQueueId);
          emit(opts, 'role.receipt.assignment.timeout', {
            role: requirement.role,
            queueAgent: requirement.role,
            queueId: timedOutQueueId,
            rootTaskId: state.rootTaskId,
            parentTaskId: state.parentTaskId,
            attempt: assignment.attempts,
            timeoutMs: requirement.timeoutMs,
          });
        }
        assignment.lastError = `queue_${active.status}_timeout`;
        assignment.status = 'timeout_cancel_requested';
        Q.cancel(opts.queueRoot, requirement.role, timedOutQueueId);
        active = queueEntry(opts.queueRoot, requirement.role, timedOutQueueId);
      }
    }
    if (!active || TERMINAL.has(active.status)) {
      if (active && active.status === 'done') assignment.lastError = 'queue_done_without_valid_receipt';
      else if (active && !assignment.lastError) assignment.lastError = `queue_${active.status}`;
      if (assignment.attempts < assignment.maxAttempts) enqueueAttempt(spec, requirement, state, opts);
      else if (!existingReceipt) assignment.status = 'exhausted';
    }
  }
  state.updatedAt = nowIso(opts);
  writeJsonAtomic(file, state);
  return { required: true, requirements, state, file };
}

function ensureAssignments(spec, opts = {}) {
  const requirements = normalizedRequirements(spec && spec.requiredIndependentReceipts);
  if (!requirements.length) return { required: false, requirements, state: null };
  if (!opts.queueRoot) throw new Error('independent receipt coordinator requires queueRoot');
  const identity = rootIdentity(spec);
  return withBusLock(opts.queueRoot, identity.rootTaskId, identity.parentTaskId, () => ensureAssignmentsUnlocked(spec, opts));
}

function extractReceipt(text) {
  const source = String(text || '');
  const blocks = [];
  const re = /```json\s*([\s\S]*?)```/gi;
  let match;
  while ((match = re.exec(source))) {
    let parsed;
    try { parsed = JSON.parse(match[1].trim()); }
    catch (_) { return { ok: false, reason: 'receipt_json_invalid' }; }
    blocks.push({ parsed, raw: match[0] });
  }
  if (blocks.length !== 1) return { ok: false, reason: blocks.length ? 'multiple_json_blocks' : 'independent_receipt_missing' };
  if (source.replace(blocks[0].raw, '').trim()) return { ok: false, reason: 'receipt_extra_text' };
  const root = blocks[0].parsed;
  if (!root || typeof root !== 'object' || Array.isArray(root)
    || Object.keys(root).length !== 1
    || !Object.prototype.hasOwnProperty.call(root, 'independent_receipt')) {
    return { ok: false, reason: 'receipt_root_invalid' };
  }
  return { ok: true, receipt: root.independent_receipt };
}

function validateEvidence(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).sort().join(',') === 'path,summary'
    && typeof item.path === 'string' && item.path.trim()
    && typeof item.summary === 'string' && item.summary.trim());
}

function validateEvidenceFiles(value, workspaceRoot) {
  const root = path.resolve(workspaceRoot || path.resolve(__dirname, '../..'));
  let realRoot;
  try { realRoot = fs.realpathSync(root); }
  catch (_) { return { ok: false, reason: 'receipt_evidence_root_missing' }; }
  for (const item of value || []) {
    if (path.isAbsolute(item.path)) return { ok: false, reason: 'receipt_evidence_path_absolute' };
    const file = path.resolve(root, item.path);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return { ok: false, reason: 'receipt_evidence_path_escape' };
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return { ok: false, reason: 'receipt_evidence_path_symlink' };
      const real = fs.realpathSync(file);
      if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return { ok: false, reason: 'receipt_evidence_path_escape' };
      if (!fs.statSync(file).isFile()) return { ok: false, reason: 'receipt_evidence_file_missing' };
    } catch (_) {
      return { ok: false, reason: 'receipt_evidence_file_missing' };
    }
  }
  return { ok: true };
}

function validateReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { ok: false, reason: 'receipt_not_object' };
  const common = ['schemaVersion', 'role', 'queueId', 'taskId', 'rootTaskId', 'verdict', 'evidence', 'completedAt'];
  const specific = expected.role === 'quality_ops' ? ['qualityScore', 'checks'] : ['complianceCheckResult', 'findings'];
  const allowed = new Set(common.concat(specific));
  const unknown = Object.keys(receipt).filter(key => !allowed.has(key));
  if (unknown.length) return { ok: false, reason: `receipt_unknown_fields:${unknown.sort().join(',')}` };
  for (const key of common.concat(specific)) {
    if (!Object.prototype.hasOwnProperty.call(receipt, key)) return { ok: false, reason: `receipt_missing_${key}` };
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) return { ok: false, reason: 'receipt_schema_mismatch' };
  for (const key of ['role', 'queueId', 'taskId', 'rootTaskId']) {
    if (receipt[key] !== expected[key]) return { ok: false, reason: `receipt_identity_mismatch:${key}` };
  }
  if (!new Set(['pass', 'fail', 'needs_review']).has(receipt.verdict)) return { ok: false, reason: 'receipt_verdict_invalid' };
  if (!validateEvidence(receipt.evidence)) return { ok: false, reason: 'receipt_evidence_invalid' };
  if (typeof receipt.completedAt !== 'string' || !Number.isFinite(Date.parse(receipt.completedAt))) return { ok: false, reason: 'receipt_completed_at_invalid' };
  if (expected.role === 'quality_ops') {
    if (typeof receipt.qualityScore !== 'number' || !Number.isFinite(receipt.qualityScore) || receipt.qualityScore < 0 || receipt.qualityScore > 100) {
      return { ok: false, reason: 'receipt_quality_score_invalid' };
    }
    if (!Array.isArray(receipt.checks) || !receipt.checks.length || !receipt.checks.every(item => typeof item === 'string' && item.trim())) {
      return { ok: false, reason: 'receipt_checks_invalid' };
    }
  } else {
    if (!new Set(['pass', 'fail', 'needs_review']).has(receipt.complianceCheckResult)) return { ok: false, reason: 'receipt_compliance_result_invalid' };
    if (!Array.isArray(receipt.findings) || !receipt.findings.every(item => typeof item === 'string' && item.trim())) {
      return { ok: false, reason: 'receipt_findings_invalid' };
    }
  }
  return { ok: true };
}

function rejectReceipt(opts, spec, role, reason) {
  emit(opts, 'role.receipt.rejected', {
    role,
    queueAgent: spec && spec.queueAgent || null,
    queueId: spec && spec.queueId || null,
    taskId: spec && spec.taskId || null,
    rootTaskId: spec && spec.rootTaskId || null,
    reason,
    gateStatus: 'blocked',
  });
  return { required: true, ok: false, reason, gateStatus: 'blocked' };
}

function commitRunReceiptUnlocked(spec, resultText, opts, contract, role, executingRole, parentTaskId) {
  if (contract.schemaVersion !== BUS_SCHEMA
    || contract.rootTaskId !== spec.rootTaskId
    || !parentTaskId
    || spec.parentTaskId !== parentTaskId
    || !ALLOWED_ROLES.has(role)
    || executingRole !== role
    || spec.role !== role) {
    return rejectReceipt(opts, spec, role, 'producer_queue_role_mismatch');
  }
  const extracted = extractReceipt(resultText);
  if (!extracted.ok) return rejectReceipt(opts, spec, role, extracted.reason);
  const expected = { role, queueId: spec.queueId, taskId: spec.taskId, rootTaskId: spec.rootTaskId };
  const checked = validateReceipt(extracted.receipt, expected);
  if (!checked.ok) return rejectReceipt(opts, spec, role, checked.reason);
  const evidenceChecked = validateEvidenceFiles(extracted.receipt.evidence, opts.workspaceRoot);
  if (!evidenceChecked.ok) return rejectReceipt(opts, spec, role, evidenceChecked.reason);
  const provenanceChecked = buildProvenance(spec, extracted.receipt, resultText, opts);
  if (!provenanceChecked.ok) return rejectReceipt(opts, spec, role, provenanceChecked.reason);
  const statePath = stateFile(opts.queueRoot, spec.rootTaskId, parentTaskId);
  const state = readJson(statePath);
  const statePolicy = classifyStatePolicy(state);
  if (statePolicy.mode === 'blocked') {
    return rejectReceipt(opts, spec, role, `independent_provenance_policy_invalid:${statePolicy.reason}`);
  }
  const assignment = state && state.assignments && state.assignments[role];
  if (!assignment || assignment.receiptId !== contract.receiptId || !assignment.queueIds.includes(spec.queueId)) {
    return rejectReceipt(opts, spec, role, 'receipt_assignment_mismatch');
  }
  const record = {
    schemaVersion: PROVENANCE_SCHEMA,
    review: extracted.receipt,
    provenance: provenanceChecked.provenance,
  };
  const file = receiptFile(opts.queueRoot, spec.rootTaskId, parentTaskId, assignment.receiptId);
  const existing = readJson(file);
  if (existing && JSON.stringify(existing) !== JSON.stringify(record)) return rejectReceipt(opts, spec, role, 'receipt_consistency_conflict');
  if (!existing) writeJsonAtomic(file, record);
  assignment.status = 'delivered';
  assignment.verdict = extracted.receipt.verdict;
  assignment.receiptFile = path.relative(opts.queueRoot, file);
  assignment.traceId = provenanceChecked.provenance.traceId;
  assignment.runnerId = provenanceChecked.provenance.runner.id;
  assignment.provenanceStatus = 'verified';
  assignment.completedAt = extracted.receipt.completedAt;
  assignment.updatedAt = nowIso(opts);
  state.status = Object.values(state.assignments).every(item => item.status === 'delivered') ? 'received' : 'waiting';
  state.updatedAt = nowIso(opts);
  writeJsonAtomic(statePath, state);
  if (!existing) {
    emit(opts, 'role.receipt.delivered', {
      role,
      queueAgent: executingRole,
      queueId: spec.queueId,
      taskId: spec.taskId,
      rootTaskId: spec.rootTaskId,
      receiptId: assignment.receiptId,
      verdict: extracted.receipt.verdict,
      file: path.relative(opts.queueRoot, file),
      traceId: provenanceChecked.provenance.traceId,
      runner: provenanceChecked.provenance.runner.id,
      promptSha256: provenanceChecked.provenance.prompt.sha256,
      outputSha256: provenanceChecked.provenance.output.sha256,
      startedAt: provenanceChecked.provenance.timeWindow.startedAt,
      finishedAt: provenanceChecked.provenance.timeWindow.finishedAt,
      terminalEvent: provenanceChecked.provenance.terminalEvent,
      gateStatus: 'verified',
    });
  }
  return {
    required: true,
    ok: true,
    duplicate: !!existing,
    receipt: extracted.receipt,
    provenance: provenanceChecked.provenance,
    file,
    gateStatus: 'verified',
  };
}

function commitRunReceipt(spec, resultText, opts = {}) {
  const contract = spec && spec.independentReceipt;
  if (!contract) return { required: false, ok: true, gateStatus: 'not_applicable' };
  if (!opts.queueRoot) throw new Error('receipt commit requires queueRoot');
  const role = String(contract.role || '');
  const executingRole = String(spec.queueAgent || '');
  const parentTaskId = safeToken(contract.parentTaskId);
  const rootTaskId = safeToken(spec.rootTaskId);
  if (!rootTaskId || !parentTaskId || contract.rootTaskId !== rootTaskId) {
    return rejectReceipt(opts, spec, role, 'producer_queue_role_mismatch');
  }
  return withBusLock(opts.queueRoot, rootTaskId, parentTaskId, () => (
    commitRunReceiptUnlocked(spec, resultText, opts, contract, role, executingRole, parentTaskId)
  ));
}

function parentTraceWindows(workspaceRoot, taskId) {
  return interactionTraceFiles(workspaceRoot, taskId).map(file => readJson(file)).filter(trace => {
    return trace && trace.status === 'completed'
      && Number.isFinite(Date.parse(trace.started_at || ''))
      && Number.isFinite(Date.parse(trace.finished_at || ''));
  }).map(trace => ({
    traceId: trace.trace_id,
    role: trace.agent_role,
    startedAt: trace.started_at,
    finishedAt: trace.finished_at,
  }));
}

function evaluateIndependence(state, provenances, opts) {
  const uniqueFields = [
    ['taskId', item => item.taskId],
    ['traceId', item => item.traceId],
    ['role', item => item.role],
    ['manifestPath', item => item.manifestPath],
  ];
  for (const [field, get] of uniqueFields) {
    const values = provenances.map(get);
    if (new Set(values).size !== values.length) {
      return { ok: false, reason: `independent_provenance_duplicate_${field}`, gateStatus: 'blocked', warnings: [] };
    }
  }
  const parents = parentTraceWindows(opts.workspaceRoot, state.parentTaskId);
  for (const provenance of provenances) {
    const start = Date.parse(provenance.timeWindow.startedAt);
    const finish = Date.parse(provenance.timeWindow.finishedAt);
    const containing = parents.find(parent => Date.parse(parent.startedAt) <= start && Date.parse(parent.finishedAt) >= finish);
    if (containing) {
      return {
        ok: false,
        reason: `independent_provenance_contained_by_parent:${containing.traceId}`,
        gateStatus: 'blocked',
        warnings: [],
      };
    }
  }
  const warnings = [];
  const runnerGroups = new Map();
  for (const provenance of provenances) {
    const runner = provenance.runner.id;
    if (!runnerGroups.has(runner)) runnerGroups.set(runner, []);
    runnerGroups.get(runner).push(provenance.role);
  }
  for (const [runner, roles] of runnerGroups.entries()) {
    if (roles.length > 1) warnings.push(`shared_runner:${runner}:${roles.sort().join(',')}`);
  }
  for (let i = 0; i < provenances.length; i++) {
    for (let j = i + 1; j < provenances.length; j++) {
      const left = provenances[i];
      const right = provenances[j];
      const leftStart = Date.parse(left.timeWindow.startedAt);
      const leftFinish = Date.parse(left.timeWindow.finishedAt);
      const rightStart = Date.parse(right.timeWindow.startedAt);
      const rightFinish = Date.parse(right.timeWindow.finishedAt);
      if ((leftStart <= rightStart && leftFinish >= rightFinish)
        || (rightStart <= leftStart && rightFinish >= leftFinish)) {
        warnings.push(`review_window_containment:${left.role}:${right.role}`);
      }
      if (left.output.sha256 === right.output.sha256) warnings.push(`duplicate_output_hash:${left.role}:${right.role}`);
    }
  }
  const distinctRunners = new Set(provenances.map(item => item.runner.id)).size;
  return {
    ok: true,
    gateStatus: warnings.length ? 'warning' : 'pass',
    warnings,
    independenceStrength: distinctRunners === provenances.length ? 'strong' : 'weak',
  };
}

function receivedResult(state, opts) {
  const receipts = [];
  const provenances = [];
  const warnings = [];
  const statePolicy = classifyStatePolicy(state);
  if (statePolicy.mode === 'blocked') {
    return {
      ok: false,
      paused: false,
      reason: `independent_provenance_policy_invalid:${statePolicy.reason}`,
      receipts,
      provenances,
      warnings: [statePolicy.reason],
      gateStatus: 'blocked',
    };
  }
  for (const assignment of Object.values(state.assignments || {})) {
    if (!assignment.receiptFile) return null;
    const record = readJson(path.join(opts.queueRoot, assignment.receiptFile));
    if (!record) return null;
    const candidateReview = record.review || record;
    if (!assignment.queueIds.includes(candidateReview.queueId)) {
      return { ok: false, paused: false, reason: `independent_receipt_${assignment.role}_assignment_mismatch`, receipts, provenances, gateStatus: 'blocked' };
    }
    const queue = queueEntry(opts.queueRoot, assignment.role, candidateReview.queueId);
    if (!queue || !TERMINAL.has(queue.status)) return null;
    if (queue.status !== 'done') {
      return { ok: false, paused: false, reason: `independent_receipt_${assignment.role}_queue_${queue.status}`, receipts, provenances, gateStatus: 'blocked' };
    }
    const expected = {
      role: assignment.role,
      queueId: candidateReview.queueId,
      taskId: queue.entry && queue.entry.taskId,
      rootTaskId: state.rootTaskId,
    };
    const recordChecked = validateCommittedRecord(record, expected, opts);
    const evidenceChecked = recordChecked.ok ? validateEvidenceFiles(recordChecked.review.evidence, opts.workspaceRoot) : recordChecked;
    if (!recordChecked.ok || !evidenceChecked.ok) {
      return {
        ok: false,
        paused: false,
        reason: `independent_receipt_${assignment.role}_invalid:${recordChecked.ok ? evidenceChecked.reason : recordChecked.reason}`,
        receipts,
        provenances,
        gateStatus: 'blocked',
      };
    }
    for (const queueId of assignment.queueIds || []) {
      if (queueId === candidateReview.queueId) continue;
      const redundant = queueEntry(opts.queueRoot, assignment.role, queueId);
      if (!redundant || TERMINAL.has(redundant.status)) continue;
      Q.cancel(opts.queueRoot, assignment.role, queueId);
      const after = queueEntry(opts.queueRoot, assignment.role, queueId);
      if (after && !TERMINAL.has(after.status)) return null;
    }
    receipts.push(recordChecked.review);
    if (recordChecked.provenance) provenances.push(recordChecked.provenance);
    warnings.push(...(recordChecked.warnings || []));
  }
  const blocking = receipts.find(receipt => receipt.verdict !== 'pass');
  if (blocking) {
    return { ok: false, paused: false, reason: `independent_receipt_${blocking.role}_${blocking.verdict}`, receipts, provenances, warnings, gateStatus: 'blocked' };
  }
  if (provenances.length !== receipts.length) {
    return { ok: false, paused: false, reason: 'independent_provenance_receipt_missing', receipts, provenances, warnings, gateStatus: 'blocked' };
  }
  const independence = evaluateIndependence(state, provenances, opts);
  if (!independence.ok) return Object.assign({ paused: false, receipts, provenances }, independence);
  warnings.push(...independence.warnings);
  return {
    ok: true,
    paused: false,
    receipts,
    provenances,
    warnings: [...new Set(warnings)],
    gateStatus: warnings.length ? 'warning' : independence.gateStatus,
    independenceStrength: independence.independenceStrength,
  };
}

async function waitForReceipts(spec, opts = {}) {
  const first = ensureAssignments(spec, opts);
  if (!first.required) return { required: false, ok: true, receipts: [], provenances: [], gateStatus: 'not_applicable' };
  const pollMs = Math.max(5, Number(opts.pollMs || 250) || 250);
  const deadline = Date.parse(first.state.deadlineAt);
  while (Date.now() <= deadline) {
    const current = ensureAssignments(spec, opts);
    const result = receivedResult(current.state, opts);
    if (result) {
      current.state.status = result.ok ? 'completed' : 'rejected';
      current.state.observabilityStatus = result.gateStatus;
      current.state.warnings = result.warnings || [];
      current.state.independenceStrength = result.independenceStrength || null;
      current.state.updatedAt = nowIso(opts);
      writeJsonAtomic(current.file, current.state);
      emit(opts, result.ok ? 'role.receipt.chain.completed' : 'role.receipt.chain.rejected', {
        rootTaskId: current.state.rootTaskId,
        parentTaskId: current.state.parentTaskId,
        roles: result.receipts.map(receipt => receipt.role),
        taskIds: (result.provenances || []).map(item => item.taskId),
        traceIds: (result.provenances || []).map(item => item.traceId),
        runners: (result.provenances || []).map(item => item.runner.id),
        gateStatus: result.gateStatus,
        warnings: result.warnings || [],
        independenceStrength: result.independenceStrength || null,
        reason: result.reason || null,
      });
      if (result.warnings && result.warnings.length) {
        emit(opts, 'role.receipt.chain.warning', {
          rootTaskId: current.state.rootTaskId,
          parentTaskId: current.state.parentTaskId,
          warnings: result.warnings,
          gateStatus: result.gateStatus,
          independenceStrength: result.independenceStrength || null,
        });
      }
      return Object.assign({ required: true }, result);
    }
    await sleep(pollMs);
  }
  const current = ensureAssignments(spec, opts);
  current.state.status = 'escalated';
  current.state.escalatedAt = nowIso(opts);
  current.state.escalationReason = 'independent_receipt_timeout';
  current.state.observabilityStatus = 'blocked';
  current.state.warnings = [...new Set([...(current.state.warnings || []), current.state.escalationReason])];
  current.state.updatedAt = current.state.escalatedAt;
  writeJsonAtomic(current.file, current.state);
  emit(opts, 'role.receipt.chain.escalated', {
    rootTaskId: current.state.rootTaskId,
    parentTaskId: current.state.parentTaskId,
    reason: current.state.escalationReason,
    gateStatus: 'blocked',
    assignments: Object.values(current.state.assignments).map(item => ({ role: item.role, attempts: item.attempts, status: item.status, activeQueueId: item.activeQueueId })),
  });
  return { required: true, ok: false, paused: true, reason: current.state.escalationReason, receipts: [], provenances: [], warnings: current.state.warnings, gateStatus: 'blocked' };
}

module.exports = {
  ALLOWED_ROLES,
  BUS_SCHEMA,
  STATE_SCHEMA,
  PROVENANCE_SCHEMA,
  RECEIPT_SCHEMA,
  commitRunReceipt,
  ensureAssignments,
  normalizedRequirements,
  validateEvidenceFiles,
  validateReceipt,
  waitForReceipts,
  _test: {
    assignmentTask,
    buildProvenance,
    classifyStatePolicy,
    deterministicId,
    evaluateIndependence,
    extractReceipt,
    interactionTraceFiles,
    queueEntry,
    receiptFile,
    receiptIdFor,
    stateFile,
    terminalTraceEvent,
    validateCommittedRecord,
  },
};
