'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const PROJECT_ROOT = __dirname;
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '../..');
const DEFAULT_STATE_DIR = path.join(PROJECT_ROOT, 'artifacts', 'hr', 'onboarding');
const DEFAULT_AGENT_DIR = path.join(WORKSPACE_ROOT, 'shared', 'agents');
const PLAN_SCHEMA = 'onboarding-handoff-plan@1';
const RECEIPT_SCHEMA = 'onboarding-handoff-receipt@1';
const STATE_SCHEMA = 'onboarding-agent-state@1';
const SELECTION_ALGORITHM = 'evidence-ranked-handoff-provider@1';
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000;
const MAX_REPLANS = 2;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

const EVIDENCE_WEIGHTS = Object.freeze({
  repair_ticket: 100,
  engine_event: 90,
  interaction_trace: 60,
  task: 45,
  project_status: 30,
  project_knowledge: 25,
});

const BLOCKED_EVIDENCE_REF = /(^|[/._-])(\.env|secret|token|cookie|auth|credential|private[-_]?key)([/._-]|$)/i;

function nowIso(now) {
  const date = now == null ? new Date() : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid onboarding timestamp');
  return date.toISOString();
}

function compactStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function safeAgentId(value) {
  const id = String(value || '').trim();
  return /^[\p{L}\p{N}_-]+$/u.test(id) ? id : '';
}

function safeEvidenceRef(value) {
  const ref = String(value || '').trim();
  if (!ref || ref.includes('\n') || BLOCKED_EVIDENCE_REF.test(ref)) return '';
  return ref;
}

function evidenceRefFile(ref) {
  const clean = safeEvidenceRef(ref);
  if (!clean) return '';
  const withoutAnchor = clean.split('#')[0].replace(/:\d+(?::\d+)?$/, '');
  const resolved = path.resolve(WORKSPACE_ROOT, withoutAnchor);
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return resolved;
}

function evidenceRefExists(ref) {
  const file = evidenceRefFile(ref);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const line = evidenceRefLine(ref);
  return !line || readEvidenceLine(file, line) != null;
}

function evidenceRefLine(ref) {
  const clean = safeEvidenceRef(ref);
  const hash = clean.match(/#L(\d+)$/i);
  const colon = clean.split('#')[0].match(/:(\d+)(?::\d+)?$/);
  const value = Number(hash && hash[1] || colon && colon[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readEvidenceLine(file, targetLine) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  let line = 1;
  let pending = '';
  const decoder = new StringDecoder('utf8');
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (!bytes) break;
      offset += bytes;
      const parts = (pending + decoder.write(buffer.subarray(0, bytes))).split('\n');
      pending = parts.pop();
      for (const part of parts) {
        if (line === targetLine) return part;
        line += 1;
      }
      if (line === targetLine && Buffer.byteLength(pending, 'utf8') > MAX_EVIDENCE_BYTES) return null;
    }
    pending += decoder.end();
    return line === targetLine ? pending : null;
  } finally {
    fs.closeSync(fd);
  }
}

function readEvidenceDocument(ref) {
  const file = evidenceRefFile(ref);
  if (!file || !fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) return null;
  const line = evidenceRefLine(ref);
  if (!line && stat.size > MAX_EVIDENCE_BYTES) return null;
  const text = line ? readEvidenceLine(file, line) : fs.readFileSync(file, 'utf8');
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_EVIDENCE_BYTES) return null;
  let json = null;
  if (/\.json$/i.test(file) || line && /\.jsonl$/i.test(file)) {
    try { json = JSON.parse(text); } catch (_) { return null; }
  }
  return {
    file,
    relative_path: path.relative(WORKSPACE_ROOT, file),
    text,
    json,
    line,
  };
}

function trustedCandidateIdentities(candidate) {
  const id = safeAgentId(candidate && (candidate.id || candidate.agent_id));
  if (!id) return [];
  const identities = [id];
  const roster = readJson(path.join(DEFAULT_AGENT_DIR, id, 'agent.json'));
  if (roster && safeAgentId(roster.id) === id) {
    for (const value of [roster.id, roster.role, roster.queueAgent]) {
      if (typeof value === 'string' && safeAgentId(value)) identities.push(value);
    }
  }
  return compactStrings(identities);
}

function stringValues(values) {
  return compactStrings((Array.isArray(values) ? values : [values])
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => typeof value === 'string'));
}

function structuredAgentValues(type, json) {
  if (!json || typeof json !== 'object') return [];
  const common = [json.agent_id, json.agentId, json.assigned_agent, json.executor_agent];
  if (type === 'task') {
    return stringValues([
      ...common,
      json.assigned_agents,
      json.executors,
      json.vars && [json.vars.agent_id, json.vars.agentId, json.vars.assigned_agent, json.vars.worker_agent],
    ]);
  }
  return stringValues(common);
}

function structuredProjectValues(json) {
  if (!json || typeof json !== 'object') return [];
  return stringValues([
    json.project_id,
    json.projectId,
    json.vars && [json.vars.project_id, json.vars.projectId],
  ]);
}

function structuredDomainValues(json) {
  if (!json || typeof json !== 'object') return [];
  return stringValues([json.responsibility_domain, json.domain]);
}

function evidenceTypeMatches(type, document) {
  const relative = String(document && document.relative_path || '').replace(/\\/g, '/');
  const json = document && document.json;
  const marker = String(json && (json.schema || json.type || json.kind) || '').toLowerCase();
  if (type === 'repair_ticket') {
    return /(^|\/)repair-tickets?(\/|$)/i.test(relative)
      && Boolean(json && (/repair[-_]?ticket/.test(marker) || json.ticket_id) && (json.incident || json.summary || json.goal));
  }
  if (type === 'engine_event') {
    return /(^|\/)engine-events?[^/]*\.(json|jsonl)$/i.test(relative)
      && (/event/.test(marker) || /"type"\s*:\s*"[^"]+"/.test(document.text));
  }
  if (type === 'interaction_trace') {
    return /(^|\/)interaction-trace\.json$/i.test(relative)
      && Boolean(json && json.schema === 'yutu6-interaction-trace@1');
  }
  if (type === 'task') {
    return /\/(engine-tasks|queues)\//i.test(`/${relative}`)
      || /\/engine-runs\/[^/]+\/(?:[^/]+\/)?task(?:\.redacted)?\.md$/i.test(`/${relative}`);
  }
  if (type === 'project_status') return /(^|\/)status\.md$/i.test(relative);
  if (type === 'project_knowledge') return /(^|\/)knowledge\//i.test(relative);
  return false;
}

function verifyEvidenceSource(raw, candidate, projectId, domain) {
  const evidence = raw && typeof raw === 'object' ? raw : {};
  const type = String(evidence.type || evidence.source || '').trim();
  const ref = safeEvidenceRef(evidence.ref || evidence.path || evidence.evidence_ref);
  if (!Object.prototype.hasOwnProperty.call(EVIDENCE_WEIGHTS, type) || !ref) return null;
  const document = readEvidenceDocument(ref);
  if (!document || !evidenceTypeMatches(type, document)) return null;
  const haystack = document.text.toLowerCase();
  const identities = trustedCandidateIdentities(candidate);
  const structuredAgents = structuredAgentValues(type, document.json);
  const agentIdentity = identities.find(identity => structuredAgents.some(value => value.toLowerCase() === identity.toLowerCase()))
    || (!document.json && ['project_status', 'project_knowledge'].includes(type)
      ? identities.find(identity => haystack.includes(identity.toLowerCase()))
      : null);
  const structuredProjects = structuredProjectValues(document.json);
  const projectBinding = !projectId || (structuredProjects.length
    ? structuredProjects.some(value => value.toLowerCase() === String(projectId).toLowerCase())
    : haystack.includes(String(projectId).toLowerCase()));
  const structuredDomains = structuredDomainValues(document.json);
  const domainBinding = !domain || !['repair_ticket', 'engine_event'].includes(type)
    || (structuredDomains.length
      ? structuredDomains.some(value => value.toLowerCase() === String(domain).toLowerCase())
      : haystack.includes(String(domain).toLowerCase()));
  const agentBinding = Boolean(agentIdentity);
  if (!agentBinding || !projectBinding || !domainBinding) return null;
  const sourceTimestamp = document.json && (
    document.json.occurred_at
    || document.json.finished_at
    || document.json.closed_at
    || document.json.updated_at
    || document.json.created_at
    || document.json.ts
  );
  return {
    type,
    ref,
    project_id: projectId || null,
    domain: domain || null,
    direct: ['repair_ticket', 'engine_event', 'interaction_trace', 'task'].includes(type),
    verified: true,
    occurred_at: Number.isFinite(Date.parse(sourceTimestamp))
      ? new Date(sourceTimestamp).toISOString()
      : null,
    proof: {
      source_path: document.relative_path,
      type_bound: true,
      agent_identity: agentIdentity,
      agent_binding: structuredAgents.length ? 'structured_exact' : 'trusted_roster_identity_text',
      project_bound: projectBinding,
      domain_bound: domainBinding,
    },
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function planFingerprint(plan) {
  const copy = Object.assign({}, plan || {});
  delete copy.plan_fingerprint;
  return fingerprint(copy);
}

function handoffTaskFingerprint(task) {
  const copy = Object.assign({}, task || {});
  delete copy.task_fingerprint;
  return fingerprint(copy);
}

function projectIdOf(spec) {
  return String(spec.project_id || spec.projectId || spec.project_scope || spec.ownership || '').trim();
}

function isCrossProject(spec) {
  const projectId = projectIdOf(spec);
  return spec.cross_project === true || !projectId || /跨项目|cross[-_ ]?project|unknown|未归属/i.test(projectId);
}

function isRepairCandidate(candidate) {
  return /repair|维修/i.test(`${candidate.id || ''} ${candidate.role || ''}`);
}

function candidateTrace(candidate, spec) {
  const projectId = projectIdOf(spec);
  const domain = String(spec.responsibility_domain || spec.role || spec.capability || '').trim();
  const evidence = (Array.isArray(candidate && candidate.evidence) ? candidate.evidence : [])
    .map(item => verifyEvidenceSource(item, candidate, projectId, domain))
    .filter(Boolean);
  const repair = isRepairCandidate(candidate || {});
  const repairDirect = evidence.some(item => item.direct && ['repair_ticket', 'engine_event'].includes(item.type));
  const eligible = evidence.length > 0 && (!repair || repairDirect);
  const score = eligible
    ? evidence.reduce((sum, item) => sum + EVIDENCE_WEIGHTS[item.type] + (item.direct ? 10 : 0), 0)
    : 0;
  const newest = evidence.reduce((best, item) => Math.max(best, Date.parse(item.occurred_at) || 0), 0);
  return {
    agent_id: safeAgentId(candidate && candidate.id),
    role: String(candidate && candidate.role || '').trim() || null,
    eligible,
    score,
    newest_evidence_at: newest ? new Date(newest).toISOString() : null,
    repair_direct_evidence: repair ? repairDirect : null,
    evidence_refs: compactStrings(evidence.map(item => item.ref)),
    evidence,
    rejection_reason: eligible ? null : (repair && !repairDirect
      ? 'repair candidate lacks direct verified repair_ticket/engine_event evidence'
      : 'candidate lacks verified task/trace/status/knowledge evidence'),
  };
}

function selectHandoffProvider(spec, candidates = []) {
  const targetId = safeAgentId(spec && spec.id);
  const considered = (Array.isArray(candidates) ? candidates : [])
    .filter(candidate => safeAgentId(candidate && candidate.id) && safeAgentId(candidate.id) !== targetId)
    .map(candidate => candidateTrace(candidate, spec))
    .sort((a, b) => b.score - a.score
      || (Date.parse(b.newest_evidence_at) || 0) - (Date.parse(a.newest_evidence_at) || 0)
      || a.agent_id.localeCompare(b.agent_id));
  const selected = considered.find(candidate => candidate.eligible);
  if (!selected) {
    return {
      algorithm: SELECTION_ALGORITHM,
      status: 'route_owner_fallback',
      selected_agent: 'ceo',
      selected_role: 'orchestrator',
      score: 0,
      verified_provider: false,
      evidence_refs: [],
      reason: 'no candidate has verified direct experience; CEO must route or re-plan and activation remains fail-closed',
      considered,
    };
  }
  return {
    algorithm: SELECTION_ALGORITHM,
    status: 'selected',
    selected_agent: selected.agent_id,
    selected_role: selected.role,
    score: selected.score,
    verified_provider: true,
    evidence_refs: selected.evidence_refs,
    reason: 'highest deterministic evidence score; ties use newest evidence then agent id',
    considered,
  };
}

function approvalRoute(spec) {
  const projectId = projectIdOf(spec);
  const crossProject = isCrossProject(spec);
  return {
    hr_precheck_owner: 'hr_manager',
    route_owner: crossProject ? 'ceo' : `supervisor-${projectId}`,
    final_approver: crossProject ? 'ceo' : `supervisor-${projectId}`,
    repair_role: 'knowledge provider only when direct repair_ticket/engine_event evidence exists; never final approver by role alone',
    priority: [
      'HR validates four elements and permissions before assignment; HR is not final approver',
      'project supervisor owns project-specific package and final acceptance',
      'CEO owns cross-project, unknown ownership, and no-experience fallback routing',
      'repair lead may transfer knowledge only with direct verified incident evidence',
    ],
  };
}

function handoffPackage(spec, selection) {
  const supplied = spec.handoff_package && typeof spec.handoff_package === 'object'
    ? spec.handoff_package
    : {};
  const projectId = projectIdOf(spec);
  const keyPaths = compactStrings([
    ...(Array.isArray(supplied.code_data_index && supplied.code_data_index.key_paths)
      ? supplied.code_data_index.key_paths : []),
    ...(Array.isArray(spec.read_paths) ? spec.read_paths : []),
    ...(Array.isArray(spec.writes) ? spec.writes : []),
  ]).filter(ref => !BLOCKED_EVIDENCE_REF.test(ref));
  const sourceRefs = compactStrings([
    ...(Array.isArray(supplied.evidence_refs) ? supplied.evidence_refs : []),
    ...(Array.isArray(spec.handoff_evidence_refs) ? spec.handoff_evidence_refs : []),
    ...selection.evidence_refs,
  ]).map(safeEvidenceRef).filter(Boolean);
  const incidents = Array.isArray(supplied.incidents_and_rollback && supplied.incidents_and_rollback.incidents)
    ? supplied.incidents_and_rollback.incidents : [];
  return {
    responsibilities: {
      does: String(supplied.responsibilities && supplied.responsibilities.does || spec.capability || '').trim(),
      does_not: String(supplied.responsibilities && supplied.responsibilities.does_not || spec.does_not || '不越过归属和文件权限；不处理密钥、登录或授权。').trim(),
    },
    project_background: compactStrings(supplied.project_background || [
      projectId ? `${projectId} 项目专属职责交接` : '跨项目或归属待 CEO 确认的职责交接',
    ]),
    code_data_index: {
      project_root: String(supplied.code_data_index && supplied.code_data_index.project_root
        || (projectId ? `projects/${projectId}/` : `shared/agents/${spec.id}/`)).trim(),
      key_paths: keyPaths,
      interfaces: compactStrings(supplied.code_data_index && supplied.code_data_index.interfaces),
    },
    current_status: {
      phase: String(supplied.current_status && supplied.current_status.phase || 'agent-onboarding').trim(),
      last_milestone: String(supplied.current_status && supplied.current_status.last_milestone || 'HR four-element precheck passed').trim(),
      blockers: compactStrings(supplied.current_status && supplied.current_status.blockers || [
        'handoff receipt and final approval pending',
      ]),
    },
    incidents_and_rollback: {
      incident_status: incidents.length ? 'documented' : 'none-recorded',
      incidents,
      rollback_points: compactStrings(supplied.incidents_and_rollback && supplied.incidents_and_rollback.rollback_points || [
        'keep the agent probationary and remove/re-plan only the onboarding state and handoff queue entry',
      ]),
    },
    common_tasks: compactStrings(supplied.common_tasks || [spec.capability]),
    tools_and_permissions: {
      tools: compactStrings(supplied.tools_and_permissions && supplied.tools_and_permissions.tools || spec.tools),
      read_paths: compactStrings(supplied.tools_and_permissions && supplied.tools_and_permissions.read_paths || spec.read_paths),
      write_paths: compactStrings(supplied.tools_and_permissions && supplied.tools_and_permissions.write_paths || spec.writes),
      expansion_forbidden: true,
    },
    prohibited_actions: compactStrings(supplied.prohibited_actions || [
      spec.does_not,
      'do not read or disclose secrets, tokens, cookies, private keys, passwords, or verification codes',
      'do not accept ordinary production work until approved',
    ]),
    acceptance: compactStrings(supplied.acceptance || [
      'submit a valid onboarding-handoff-receipt@1',
      'first smoke result must pass with a durable evidence reference',
      'receive approval from the configured final approver after HR precheck',
    ]),
    evidence_refs: sourceRefs,
  };
}

function validatePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') return ['handoff_package missing'];
  if (!pkg.responsibilities || !pkg.responsibilities.does || !pkg.responsibilities.does_not) errors.push('responsibilities incomplete');
  if (!Array.isArray(pkg.project_background) || !pkg.project_background.length) errors.push('project_background missing');
  if (!pkg.code_data_index || !pkg.code_data_index.project_root || !Array.isArray(pkg.code_data_index.key_paths) || !pkg.code_data_index.key_paths.length) errors.push('code_data_index requires project_root and key_paths');
  if (!pkg.current_status || !pkg.current_status.phase || !pkg.current_status.last_milestone || !Array.isArray(pkg.current_status.blockers)) errors.push('current_status incomplete');
  if (!pkg.incidents_and_rollback || !['documented', 'none-recorded'].includes(pkg.incidents_and_rollback.incident_status) || !Array.isArray(pkg.incidents_and_rollback.incidents) || !Array.isArray(pkg.incidents_and_rollback.rollback_points) || !pkg.incidents_and_rollback.rollback_points.length) errors.push('incidents_and_rollback incomplete');
  if (!Array.isArray(pkg.common_tasks) || !pkg.common_tasks.length) errors.push('common_tasks missing');
  if (!pkg.tools_and_permissions || !Array.isArray(pkg.tools_and_permissions.read_paths) || !Array.isArray(pkg.tools_and_permissions.write_paths) || pkg.tools_and_permissions.expansion_forbidden !== true) errors.push('tools_and_permissions incomplete');
  if (!Array.isArray(pkg.prohibited_actions) || !pkg.prohibited_actions.length) errors.push('prohibited_actions missing');
  if (!Array.isArray(pkg.acceptance) || !pkg.acceptance.length) errors.push('acceptance missing');
  if (!Array.isArray(pkg.evidence_refs)) errors.push('evidence_refs must be an array');
  return errors;
}

function buildPlan(spec, options = {}) {
  const agentId = safeAgentId(spec && spec.id);
  if (!agentId) throw new Error('handoff plan requires a safe agent id');
  const createdAt = nowIso(options.now);
  const ttlMs = Number(options.ttl_ms || options.ttlMs || DEFAULT_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('handoff ttl must be positive');
  const selection = selectHandoffProvider(spec, options.candidates || spec.handoff_candidates || []);
  const route = approvalRoute(spec);
  const planSeed = {
    agent_id: agentId,
    role: spec.role,
    project_id: projectIdOf(spec) || null,
    created_at: createdAt,
    selection,
  };
  const planId = `ohp-${fingerprint(planSeed).slice(0, 16)}`;
  const pkg = handoffPackage(spec, selection);
  const queueTask = {
    schema: 'onboarding-handoff-task@1',
    kind: 'onboarding_handoff',
    plan_id: planId,
    agent_id: agentId,
    projectId: projectIdOf(spec) || null,
    goal: `Complete onboarding handoff ${planId}; submit ${RECEIPT_SCHEMA}; ordinary production work remains blocked.`,
    final_approver: route.final_approver,
    due_at: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
  };
  queueTask.task_fingerprint = handoffTaskFingerprint(queueTask);
  const plan = {
    schema: PLAN_SCHEMA,
    plan_id: planId,
    agent: {
      id: agentId,
      role: String(spec.role || '').trim(),
      ownership: String(spec.ownership || '').trim(),
      project_id: projectIdOf(spec) || null,
      responsibility_domain: String(spec.responsibility_domain || spec.role || spec.capability || '').trim(),
    },
    lifecycle: 'probationary',
    status: 'assigned',
    created_at: createdAt,
    due_at: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
    attempt: Number(options.attempt || 1),
    max_replans: MAX_REPLANS,
    selection,
    approval_route: route,
    handoff_package: pkg,
    receipt_requirements: {
      schema: RECEIPT_SCHEMA,
      fields: ['context_digest', 'understood', 'questions', 'capability_gaps', 'first_smoke'],
      first_smoke_requires: ['command', 'status', 'evidence_refs'],
    },
    queue_task: queueTask,
    timeout_policy: {
      mode: 'event-driven-sweep',
      reminder_only: true,
      activate_on_timeout: false,
      reminder_target: route.route_owner,
      no_resident_process: true,
    },
    required_events: [
      'onboarding.handoff.planned',
      'onboarding.handoff.assigned',
      'onboarding.handoff.received',
      'onboarding.handoff.approved',
      'onboarding.handoff.rejected',
    ],
  };
  plan.plan_fingerprint = planFingerprint(plan);
  return plan;
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { pass: false, errors: ['plan missing'] };
  if (plan.schema !== PLAN_SCHEMA) errors.push(`schema must be ${PLAN_SCHEMA}`);
  if (!plan.plan_id || !safeAgentId(plan.agent && plan.agent.id)) errors.push('plan_id/agent missing');
  if (plan.lifecycle !== 'probationary' || plan.status !== 'assigned') errors.push('new plan must be assigned and probationary');
  if (!Number.isFinite(Date.parse(plan.created_at)) || !Number.isFinite(Date.parse(plan.due_at)) || Date.parse(plan.due_at) <= Date.parse(plan.created_at)) errors.push('created_at/due_at invalid');
  if (!plan.selection || plan.selection.algorithm !== SELECTION_ALGORITHM || !plan.selection.selected_agent || !Array.isArray(plan.selection.evidence_refs) || !Array.isArray(plan.selection.considered)) errors.push('selection trace incomplete');
  if (plan.selection && plan.selection.verified_provider === true) {
    const selected = plan.selection.considered.find(row => row.agent_id === plan.selection.selected_agent);
    const verified = selected && Array.isArray(selected.evidence)
      ? selected.evidence.map(row => verifyEvidenceSource(row, selected, plan.agent.project_id, plan.agent.responsibility_domain)).filter(Boolean)
      : [];
    if (!selected || !verified.length || verified.length !== selected.evidence.length) errors.push('selection evidence source is missing, unbound, or unverifiable');
    if (plan.selection.evidence_refs.some(ref => !verified.some(row => row.ref === ref))) errors.push('selection evidence_refs do not match verified source rows');
  } else if (plan.selection && (plan.selection.status !== 'route_owner_fallback' || plan.selection.evidence_refs.length)) {
    errors.push('unverified provider must use evidence-free CEO fallback');
  }
  if (!plan.approval_route || !plan.approval_route.hr_precheck_owner || !plan.approval_route.final_approver) errors.push('approval route incomplete');
  if (!plan.queue_task
    || plan.queue_task.kind !== 'onboarding_handoff'
    || plan.queue_task.plan_id !== plan.plan_id
    || plan.queue_task.agent_id !== plan.agent.id
    || plan.queue_task.task_fingerprint !== handoffTaskFingerprint(plan.queue_task)) errors.push('queue task mismatch');
  if (!plan.plan_fingerprint || plan.plan_fingerprint !== planFingerprint(plan)) errors.push('plan_fingerprint mismatch');
  errors.push(...validatePackage(plan.handoff_package));
  return { pass: errors.length === 0, errors };
}

function stateFile(stateDir, agentId) {
  const safe = safeAgentId(agentId);
  if (!safe) throw new Error('unsafe onboarding agent id');
  return path.join(stateDir || DEFAULT_STATE_DIR, `${safe}.json`);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value, flags) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    if (flags === 'create' && fs.existsSync(file)) throw Object.assign(new Error(`onboarding state already exists: ${path.basename(file)}`), { code: 'EEXIST' });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw error;
  }
}

function emit(eventlog, type, data) {
  if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data);
}

function withStateLock(file, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (error) {
    const busy = new Error(`onboarding state is locked: ${path.basename(file)}`);
    busy.code = 'ONBOARDING_STATE_LOCKED';
    throw busy;
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(lock); } catch (_) {}
  }
}

function createState(plan, options = {}) {
  const validation = validatePlan(plan);
  if (!validation.pass) throw new Error(`invalid handoff plan: ${validation.errors.join('; ')}`);
  const file = stateFile(options.stateDir, plan.agent.id);
  return withStateLock(file, () => {
    const existing = readJson(file);
    if (existing) {
      if (existing.plan && existing.plan.plan_fingerprint === plan.plan_fingerprint) {
        return { created: false, file, state: existing };
      }
      throw new Error(`active onboarding state exists for ${plan.agent.id}`);
    }
    const state = {
      schema: STATE_SCHEMA,
      agent_id: plan.agent.id,
      lifecycle: 'probationary',
      status: 'planned',
      revision: 1,
      created_at: plan.created_at,
      updated_at: plan.created_at,
      plan,
      hr_precheck: {
        status: 'passed',
        owner: plan.approval_route.hr_precheck_owner,
        evidence: 'HR four-element, duplicate, risk, and permission-boundary checks passed before plan creation',
        ...(options.hrPrecheck || {}),
      },
      queue: { status: 'pending', queue_agent: plan.agent.id, queue_id: null },
      receipt: null,
      approval: null,
      reminders: [],
    };
    writeJsonAtomic(file, state, 'create');
    emit(options.eventlog, 'onboarding.handoff.planned', {
      agentId: state.agent_id,
      planId: plan.plan_id,
      provider: plan.selection.selected_agent,
      providerEvidence: plan.selection.evidence_refs,
      selectionAlgorithm: plan.selection.algorithm,
      finalApprover: plan.approval_route.final_approver,
    });
    return { created: true, file, state };
  });
}

function updateState(agentId, options, updater) {
  const file = stateFile(options && options.stateDir, agentId);
  return withStateLock(file, () => {
    const state = readJson(file);
    if (!state || state.schema !== STATE_SCHEMA) throw new Error(`onboarding state missing for ${agentId}`);
    const next = updater(state) || state;
    next.revision = Number(state.revision || 0) + 1;
    next.updated_at = nowIso(options && options.now);
    writeJsonAtomic(file, next);
    return { file, state: next };
  });
}

function markAssigned(agentId, queueEntry, options = {}) {
  const result = updateState(agentId, options, state => {
    state.status = 'assigned';
    state.queue = {
      status: 'queued',
      queue_agent: queueEntry.target,
      queue_id: queueEntry.id,
      enqueued_at: queueEntry.enqueued_at,
    };
    return state;
  });
  emit(options.eventlog, 'onboarding.handoff.assigned', {
    agentId,
    planId: result.state.plan.plan_id,
    queueAgent: queueEntry.target,
    queueId: queueEntry.id,
    provider: result.state.plan.selection.selected_agent,
    evidenceRefs: result.state.plan.selection.evidence_refs,
  });
  return result;
}

function validateReceipt(receipt, plan) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') return { pass: false, errors: ['receipt missing'] };
  if (receipt.schema !== RECEIPT_SCHEMA) errors.push(`schema must be ${RECEIPT_SCHEMA}`);
  if (!plan || receipt.plan_id !== plan.plan_id || receipt.agent_id !== plan.agent.id) errors.push('receipt plan_id/agent_id mismatch');
  if (String(receipt.context_digest || '').trim().length < 16) errors.push('context_digest must contain at least 16 characters');
  if (!Array.isArray(receipt.understood) || !receipt.understood.length) errors.push('understood must be non-empty');
  if (!Array.isArray(receipt.questions)) errors.push('questions must be an array');
  if (!Array.isArray(receipt.capability_gaps)) errors.push('capability_gaps must be an array');
  if (!receipt.first_smoke || !String(receipt.first_smoke.command || '').trim() || !['pass', 'fail'].includes(receipt.first_smoke.status) || !Array.isArray(receipt.first_smoke.evidence_refs) || !receipt.first_smoke.evidence_refs.length) {
    errors.push('first_smoke requires command, pass/fail status, and durable evidence_refs');
  } else if (receipt.first_smoke.evidence_refs.some(ref => !safeEvidenceRef(ref) || !evidenceRefExists(ref))) {
    errors.push('first_smoke evidence_ref missing or unsafe');
  }
  return { pass: errors.length === 0, errors };
}

function recordReceipt(agentId, receipt, options = {}) {
  const result = updateState(agentId, options, state => {
    if (state.lifecycle !== 'probationary' || !['assigned', 'received'].includes(state.status)) throw new Error(`receipt not allowed in state ${state.status}`);
    const validation = validateReceipt(receipt, state.plan);
    if (!validation.pass) throw new Error(`invalid handoff receipt: ${validation.errors.join('; ')}`);
    state.status = 'received';
    state.receipt = Object.assign({}, receipt, { received_at: nowIso(options.now) });
    return state;
  });
  emit(options.eventlog, 'onboarding.handoff.received', {
    agentId,
    planId: result.state.plan.plan_id,
    smokeStatus: result.state.receipt.first_smoke.status,
    evidenceRefs: result.state.receipt.first_smoke.evidence_refs,
  });
  return result;
}

function approvalBlockers(state, approver, now) {
  const blockers = [];
  const planValidation = validatePlan(state && state.plan);
  if (!planValidation.pass) blockers.push(...planValidation.errors.map(error => `invalid-plan:${error}`));
  if (!state || state.lifecycle !== 'probationary') blockers.push('agent-not-probationary');
  if (!state || state.status !== 'received') blockers.push('handoff-receipt-not-received');
  if (!state || !state.hr_precheck || state.hr_precheck.status !== 'passed') blockers.push('hr-precheck-missing');
  if (!state || !state.plan || !state.plan.selection || state.plan.selection.verified_provider !== true || !Array.isArray(state.plan.selection.evidence_refs) || !state.plan.selection.evidence_refs.length) blockers.push('handoff-provider-lacks-verified-evidence');
  const receiptValidation = validateReceipt(state && state.receipt, state && state.plan);
  if (!receiptValidation.pass) blockers.push(...receiptValidation.errors.map(error => `invalid-receipt:${error}`));
  if (state && state.receipt && state.receipt.first_smoke && state.receipt.first_smoke.status !== 'pass') blockers.push('first-smoke-not-passed');
  if (!state || !state.plan || approver !== state.plan.approval_route.final_approver) blockers.push('wrong-final-approver');
  if (!state || !state.plan || Date.parse(nowIso(now)) > Date.parse(state.plan.due_at)) blockers.push('handoff-timeout');
  return [...new Set(blockers)];
}

function activateAgentRecord(agentId, state, options = {}) {
  const file = path.join(options.agentDir || DEFAULT_AGENT_DIR, agentId, 'agent.json');
  if (!fs.existsSync(file)) {
    const error = new Error(`onboarding approval blocked: agent-record-missing for ${agentId}`);
    error.code = 'ONBOARDING_APPROVAL_BLOCKED';
    error.blockers = ['agent-record-missing'];
    throw error;
  }
  const record = readJson(file);
  if (!record || safeAgentId(record.id) !== agentId) throw new Error(`agent record identity mismatch for ${agentId}`);
  record.lifecycle = 'active';
  record.onboarding_required = false;
  record.onboarding = Object.assign({}, record.onboarding || {}, {
    required: false,
    approved_plan_id: state.plan.plan_id,
    approved_at: nowIso(options.now),
    final_approver: state.plan.approval_route.final_approver,
    production_tasks_before_approval: 'blocked',
  });
  writeJsonAtomic(file, record);
  return { updated: true, file };
}

function approve(agentId, approver, options = {}) {
  const result = updateState(agentId, options, state => {
    const blockers = approvalBlockers(state, approver, options.now);
    if (blockers.length) {
      const error = new Error(`onboarding approval blocked: ${blockers.join(', ')}`);
      error.code = 'ONBOARDING_APPROVAL_BLOCKED';
      error.blockers = blockers;
      throw error;
    }
    activateAgentRecord(agentId, state, options);
    state.lifecycle = 'active';
    state.status = 'approved';
    state.approval = {
      status: 'approved',
      approver,
      approved_at: nowIso(options.now),
      plan_id: state.plan.plan_id,
      receipt_fingerprint: fingerprint(state.receipt),
    };
    return state;
  });
  emit(options.eventlog, 'onboarding.handoff.approved', {
    agentId,
    planId: result.state.plan.plan_id,
    approver,
    receiptFingerprint: result.state.approval.receipt_fingerprint,
  });
  return result;
}

function reject(agentId, approver, reason, options = {}) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('rejection reason required');
  const result = updateState(agentId, options, state => {
    if (approver !== state.plan.approval_route.final_approver && approver !== 'hr_manager') throw new Error('rejector is outside approval route');
    state.lifecycle = 'probationary';
    state.status = 'rejected';
    state.approval = { status: 'rejected', approver, rejected_at: nowIso(options.now), reason: cleanReason };
    return state;
  });
  emit(options.eventlog, 'onboarding.handoff.rejected', {
    agentId,
    planId: result.state.plan.plan_id,
    approver,
    reason: cleanReason,
  });
  return result;
}

function replan(agentId, spec, options = {}) {
  const file = stateFile(options.stateDir, agentId);
  const result = withStateLock(file, () => {
    const state = readJson(file);
    if (!state || state.schema !== STATE_SCHEMA) throw new Error(`onboarding state missing for ${agentId}`);
    if (!['rejected', 'timed_out'].includes(state.status)) throw new Error(`re-plan not allowed in state ${state.status}`);
    const attempt = Number(state.plan && state.plan.attempt || 1) + 1;
    if (attempt > Number(state.plan && state.plan.max_replans || MAX_REPLANS) + 1) {
      const error = new Error(`onboarding re-plan limit exceeded for ${agentId}`);
      error.code = 'ONBOARDING_REPLAN_LIMIT';
      throw error;
    }
    const plan = buildPlan(spec, {
      candidates: options.candidates || spec.handoff_candidates || [],
      now: options.now,
      ttlMs: options.ttlMs,
      attempt,
    });
    if (plan.agent.id !== state.agent_id) throw new Error('re-plan agent id mismatch');
    const history = Array.isArray(state.plan_history) ? state.plan_history : [];
    history.push({
      plan_id: state.plan.plan_id,
      attempt: state.plan.attempt,
      status: state.status,
      closed_at: nowIso(options.now),
      approval: state.approval,
    });
    state.lifecycle = 'probationary';
    state.status = 'planned';
    state.plan = plan;
    state.plan_history = history;
    state.queue = { status: 'pending', queue_agent: state.agent_id, queue_id: null };
    state.receipt = null;
    state.approval = null;
    state.reminders = [];
    state.revision = Number(state.revision || 0) + 1;
    state.updated_at = nowIso(options.now);
    writeJsonAtomic(file, state);
    return { file, state };
  });
  emit(options.eventlog, 'onboarding.handoff.planned', {
    agentId,
    planId: result.state.plan.plan_id,
    attempt: result.state.plan.attempt,
    reason: 'replan-after-rejected-or-timeout',
    provider: result.state.plan.selection.selected_agent,
    providerEvidence: result.state.plan.selection.evidence_refs,
    finalApprover: result.state.plan.approval_route.final_approver,
  });
  return result;
}

function evaluateAdmission(input = {}) {
  const agentId = safeAgentId(input.agentId || input.agent);
  if (!agentId) return { allowed: false, reason: 'unsafe-agent-id', blockers: ['unsafe-agent-id'] };
  const state = input.state || readJson(stateFile(input.stateDir, agentId));
  const agentRecord = input.agentRecord || readJson(path.join(input.agentDir || DEFAULT_AGENT_DIR, agentId, 'agent.json'));
  if (!state) {
    const onboardingRequired = Boolean(agentRecord && (
      agentRecord.lifecycle === 'probationary'
      || agentRecord.onboarding_required === true
      || agentRecord.onboarding && agentRecord.onboarding.required === true
    ));
    return onboardingRequired
      ? {
        allowed: false,
        reason: 'probationary-agent-missing-handoff-state',
        blockers: ['handoff-plan-missing', 'onboarding-state-missing'],
        lifecycle: 'probationary',
      }
      : { allowed: true, reason: 'legacy-agent-without-onboarding-record', blockers: [] };
  }
  const task = input.task && typeof input.task === 'object' ? input.task : {};
  if (task.kind === 'onboarding_handoff') {
    const expectedTask = state.plan && state.plan.queue_task;
    const allowed = task.schema === 'onboarding-handoff-task@1'
      && task.plan_id === state.plan.plan_id
      && task.agent_id === state.agent_id
      && expectedTask
      && expectedTask.task_fingerprint === handoffTaskFingerprint(expectedTask)
      && task.task_fingerprint === handoffTaskFingerprint(task)
      && fingerprint(task) === fingerprint(expectedTask);
    return {
      allowed,
      reason: allowed ? 'matching-onboarding-handoff-task' : 'onboarding-task-plan-mismatch',
      blockers: allowed ? [] : ['onboarding-task-plan-mismatch'],
      lifecycle: state.lifecycle,
      plan_id: state.plan.plan_id,
    };
  }
  if (state.lifecycle !== 'active' || state.status !== 'approved') {
    const blockers = ['agent-not-approved'];
    if (!agentRecord) blockers.push('agent-record-missing');
    return {
      allowed: false,
      reason: 'probationary-agent-production-task-blocked',
      blockers,
      lifecycle: state.lifecycle,
      status: state.status,
      plan_id: state.plan && state.plan.plan_id,
    };
  }
  const blockers = approvalBlockers(Object.assign({}, state, { lifecycle: 'probationary', status: 'received' }), state.approval && state.approval.approver, state.approval && state.approval.approved_at);
  if (!state.approval || state.approval.plan_id !== state.plan.plan_id) blockers.push('approval-plan-mismatch');
  if (!state.approval || state.approval.receipt_fingerprint !== fingerprint(state.receipt)) blockers.push('approval-receipt-fingerprint-mismatch');
  if (!agentRecord) blockers.push('agent-record-missing');
  else if (
    agentRecord.lifecycle !== 'active'
    || agentRecord.onboarding_required === true
    || !agentRecord.onboarding
    || agentRecord.onboarding.required !== false
    || agentRecord.onboarding.approved_plan_id !== state.plan.plan_id
  ) blockers.push('agent-record-lifecycle-mismatch');
  return {
    allowed: blockers.length === 0,
    reason: blockers.length ? 'approved-state-integrity-failed' : 'approved-onboarding',
    blockers,
    lifecycle: state.lifecycle,
    status: state.status,
    plan_id: state.plan.plan_id,
  };
}

function sweepTimeouts(options = {}) {
  const stateDir = options.stateDir || DEFAULT_STATE_DIR;
  const current = Date.parse(nowIso(options.now));
  let names = [];
  try { names = fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).sort(); }
  catch (_) { return []; }
  const reminders = [];
  for (const name of names) {
    const file = path.join(stateDir, name);
    const state = readJson(file);
    if (!state || state.lifecycle !== 'probationary' || !state.plan || current <= Date.parse(state.plan.due_at)) continue;
    const already = Array.isArray(state.reminders) && state.reminders.some(item => item.due_at === state.plan.due_at);
    if (already) continue;
    const reminder = {
      schema: 'onboarding-handoff-reminder@1',
      kind: 'onboarding_handoff_reminder',
      agent_id: state.agent_id,
      plan_id: state.plan.plan_id,
      due_at: state.plan.due_at,
      target: state.plan.timeout_policy.reminder_target,
      action: 'remind only; keep probationary; re-plan or reject explicitly',
    };
    const updated = updateState(state.agent_id, options, currentState => {
      currentState.status = 'timed_out';
      currentState.lifecycle = 'probationary';
      currentState.reminders = Array.isArray(currentState.reminders) ? currentState.reminders : [];
      currentState.reminders.push({ due_at: currentState.plan.due_at, reminded_at: nowIso(options.now), target: reminder.target });
      return currentState;
    });
    if (typeof options.enqueueReminder === 'function') reminder.queue_entry = options.enqueueReminder(reminder.target, reminder);
    emit(options.eventlog, 'onboarding.handoff.timeout_reminded', {
      agentId: state.agent_id,
      planId: state.plan.plan_id,
      target: reminder.target,
      lifecycle: updated.state.lifecycle,
    });
    reminders.push(reminder);
  }
  return reminders;
}

module.exports = {
  DEFAULT_STATE_DIR,
  DEFAULT_AGENT_DIR,
  PLAN_SCHEMA,
  RECEIPT_SCHEMA,
  STATE_SCHEMA,
  SELECTION_ALGORITHM,
  EVIDENCE_WEIGHTS,
  buildPlan,
  selectHandoffProvider,
  validatePlan,
  validateReceipt,
  createState,
  markAssigned,
  recordReceipt,
  approve,
  reject,
  replan,
  evaluateAdmission,
  sweepTimeouts,
  stateFile,
  readJson,
  fingerprint,
  handoffTaskFingerprint,
  _test: {
    approvalBlockers,
    candidateTrace,
    handoffPackage,
    safeEvidenceRef,
    evidenceRefExists,
    evidenceRefLine,
    verifyEvidenceSource,
    evidenceTypeMatches,
    trustedCandidateIdentities,
    structuredAgentValues,
    activateAgentRecord,
  },
};
