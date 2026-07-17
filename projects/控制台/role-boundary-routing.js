'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVILEGED_EXECUTORS = new Set(['repair', 'it_engineer']);
const SCOPE_SCHEMA = 'yutu6.scoped-execute.v1';
const PROOF_SCHEMA = 'yutu6.scope-proof.v1';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeToken(value) {
  const text = String(value || '').trim();
  return /^[\p{L}\p{N}_.-]+$/u.test(text) ? text : '';
}

function registeredProjects(projectsDir) {
  try {
    return fs.readdirSync(projectsDir)
      // Keep the bypass predicate aligned with the console's canonical project
      // registry. Underscore-prefixed folders are migration/examples, not
      // routable projects, even though they are physically below projects/.
      .filter(name => !name.startsWith('_'))
      .filter(name => safeToken(name))
      .filter(name => {
        try { return fs.statSync(path.join(projectsDir, name)).isDirectory(); }
        catch (_) { return false; }
      });
  } catch (_) {
    return [];
  }
}

function secretFileFor(queueRoot) {
  return path.join(queueRoot, 'role-boundary', 'scope-signing.key');
}

function ensureSecret(queueRoot) {
  const file = secretFileFor(queueRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch (_) {}
  if (!fs.existsSync(file)) {
    const value = crypto.randomBytes(32).toString('hex') + '\n';
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, value, 'utf8'); }
      finally { fs.closeSync(fd); }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
  }
  try { fs.chmodSync(file, 0o600); } catch (_) {}
  const secret = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('scope signing key is invalid');
  return secret;
}

function readSecret(queueRoot) {
  const file = secretFileFor(queueRoot);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return '';
    const secret = fs.readFileSync(file, 'utf8').trim();
    return /^[a-f0-9]{64}$/i.test(secret) ? secret : '';
  } catch (_) {
    return '';
  }
}

function queueEntry(queueRoot, agent, id) {
  const safeAgent = safeToken(agent);
  const safeId = safeToken(id);
  if (!safeAgent || !safeId) return null;
  const dir = path.join(queueRoot, 'queues', safeAgent);
  let queued = null;
  try { queued = fs.readdirSync(dir).find(name => name.endsWith(`-${safeId}.json`)); }
  catch (_) {}
  const candidates = [
    queued ? { status: 'queued', file: path.join(dir, queued) } : null,
    ...['running', 'paused', 'done', 'failed', 'canceled'].map(status => ({
      status,
      file: path.join(dir, status, `${safeId}.json`),
    })),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const entry = JSON.parse(fs.readFileSync(candidate.file, 'utf8'));
      if (entry && typeof entry === 'object') return { entry, status: entry.status || candidate.status };
    } catch (_) {}
  }
  return null;
}

function repairLeadIssuerRecord(queueRoot, issuerQueueId, issuerTaskId, ticketId, opts = {}) {
  const found = queueEntry(queueRoot, 'repair-lead', issuerQueueId);
  if (!found) return { ok: false, reason: 'issuer_queue_missing' };
  if (opts.requireRunning && found.status !== 'running') return { ok: false, reason: 'issuer_queue_not_running' };
  const entry = found.entry;
  const payload = entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task) ? entry.task : {};
  if (entry.target !== 'repair-lead' || payload.role !== 'repair-lead') return { ok: false, reason: 'issuer_queue_role_mismatch' };
  if (safeToken(entry.taskId || payload.taskId) !== issuerTaskId) return { ok: false, reason: 'issuer_task_mismatch' };
  if (safeToken(payload.repairTicketId) !== ticketId) return { ok: false, reason: 'issuer_ticket_mismatch' };
  return { ok: true, status: found.status };
}

function canonicalScope(task) {
  const proof = task && task.scopeProof && typeof task.scopeProof === 'object' ? task.scopeProof : {};
  const provenance = task && task.scopeProvenance && typeof task.scopeProvenance === 'object' ? task.scopeProvenance : {};
  return JSON.stringify({
    schemaVersion: String(task && task.scopeSchemaVersion || ''),
    projectId: String(task && task.projectId || ''),
    role: String(task && task.role || ''),
    scopedToProject: task && task.scopedToProject === true,
    scopeAction: String(task && task.scopeAction || ''),
    goal: String(task && (task.goal || task.message) || ''),
    bounds: String(task && task.bounds || ''),
    acceptance: String(task && task.acceptance || ''),
    inputs: Array.isArray(task && task.inputs) ? task.inputs.map(value => String(value)) : [],
    repairTicketId: String(task && task.repairTicketId || ''),
    sourceIncidentId: String(task && task.sourceIncidentId || ''),
    rootQueueAgent: String(task && task.rootQueueAgent || ''),
    rootQueueId: String(task && task.rootQueueId || ''),
    rootTaskId: String(task && task.rootTaskId || ''),
    provenance: {
      kind: String(provenance.kind || ''),
      ticketId: String(provenance.ticketId || ''),
      file: String(provenance.file || ''),
      issuerRole: String(provenance.issuerRole || ''),
    },
    proof: {
      schemaVersion: String(proof.schemaVersion || ''),
      issuerRole: String(proof.issuerRole || ''),
      issuerQueueId: String(proof.issuerQueueId || ''),
      issuerTaskId: String(proof.issuerTaskId || ''),
      issuedAt: String(proof.issuedAt || ''),
      nonce: String(proof.nonce || ''),
    },
  });
}

function signCanonical(secret, task) {
  return crypto.createHmac('sha256', secret).update(canonicalScope(task)).digest('hex');
}

function secureEqualHex(expected, actual) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || ''))) return false;
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ticketPath(workspaceRoot, ticketId) {
  return path.join(workspaceRoot, 'board', 'repair-tickets', `${ticketId}.md`);
}

function signRepairScopedEnvelope(task, opts = {}) {
  const source = task && typeof task === 'object' && !Array.isArray(task) ? task : {};
  const issuerRole = String(opts.issuerRole || '').trim();
  const issuerQueueId = safeToken(opts.issuerQueueId);
  const issuerTaskId = safeToken(opts.issuerTaskId);
  const targetRole = String(opts.targetRole || source.role || '').trim();
  const ticketId = safeToken(source.repairTicketId || opts.repairTicketId);
  const workspaceRoot = path.resolve(opts.workspaceRoot || path.resolve(__dirname, '../..'));
  const projectsDir = path.resolve(opts.projectsDir || path.join(workspaceRoot, 'projects'));
  const queueRoot = path.resolve(opts.queueRoot || path.join(__dirname, 'artifacts'));
  if (issuerRole !== 'repair-lead') throw new Error('scope signer requires repair-lead issuer');
  if (!issuerQueueId || !issuerTaskId) throw new Error('scope signer requires issuer queue/task identity');
  if (!PRIVILEGED_EXECUTORS.has(targetRole)) throw new Error('scope signer target must be repair or it_engineer');
  if (!ticketId || !fs.existsSync(ticketPath(workspaceRoot, ticketId))) throw new Error('scope signer requires existing repair ticket');
  if (!registeredProjects(projectsDir).includes(String(source.projectId || ''))) throw new Error('scope signer requires registered project');
  if (!nonEmptyString(source.goal || source.message)) throw new Error('scope signer requires goal');
  for (const field of ['bounds', 'acceptance', 'rootQueueAgent', 'rootQueueId', 'rootTaskId']) {
    if (!nonEmptyString(source[field])) throw new Error(`scope signer requires ${field}`);
  }
  for (const field of ['rootQueueAgent', 'rootQueueId', 'rootTaskId']) {
    if (!safeToken(source[field])) throw new Error(`scope signer requires safe ${field}`);
  }
  const issuerRecord = repairLeadIssuerRecord(queueRoot, issuerQueueId, issuerTaskId, ticketId, { requireRunning: true });
  if (!issuerRecord.ok) throw new Error(`scope signer requires live repair-lead assignment: ${issuerRecord.reason}`);
  const out = Object.assign({}, source, {
    role: targetRole,
    scopedToProject: true,
    scopeAction: 'execute',
    scopeSchemaVersion: SCOPE_SCHEMA,
    repairTicketId: ticketId,
    scopeProvenance: {
      kind: 'repair-ticket-brief',
      ticketId,
      file: `board/repair-tickets/${ticketId}.md`,
      issuerRole: 'repair-lead',
    },
    scopeProof: {
      schemaVersion: PROOF_SCHEMA,
      issuerRole: 'repair-lead',
      issuerQueueId,
      issuerTaskId,
      issuedAt: opts.issuedAt || new Date().toISOString(),
      nonce: opts.nonce || crypto.randomBytes(12).toString('hex'),
    },
  });
  out.scope_signature = signCanonical(ensureSecret(queueRoot), out);
  return out;
}

function assessScopedBypass(task, requestedAgent, opts = {}) {
  const agent = String(requestedAgent || '').trim();
  if (!PRIVILEGED_EXECUTORS.has(agent)) return { applies: false, accepted: false, reason: 'not_privileged_executor' };
  const source = task && typeof task === 'object' && !Array.isArray(task) ? task : {};
  const fail = reason => ({ applies: true, accepted: false, reason, requestedAgent: agent });
  if (source.role !== agent) return fail('role_mismatch');
  if (source.scopedToProject !== true) return fail('missing_scoped_to_project');
  if (source.scopeAction !== 'execute') return fail('invalid_scope_action');
  if (source.scopeSchemaVersion !== SCOPE_SCHEMA) return fail('invalid_scope_schema');
  if (!nonEmptyString(source.goal || source.message)) return fail('missing_goal');
  for (const field of ['projectId', 'bounds', 'acceptance', 'rootQueueAgent', 'rootQueueId', 'rootTaskId']) {
    if (!nonEmptyString(source[field])) return fail(`missing_${field}`);
  }
  for (const field of ['projectId', 'rootQueueAgent', 'rootQueueId', 'rootTaskId']) {
    if (!safeToken(source[field])) return fail(`invalid_${field}`);
  }
  const workspaceRoot = path.resolve(opts.workspaceRoot || path.resolve(__dirname, '../..'));
  const projectsDir = path.resolve(opts.projectsDir || path.join(workspaceRoot, 'projects'));
  const queueRoot = path.resolve(opts.queueRoot || path.join(__dirname, 'artifacts'));
  if (!registeredProjects(projectsDir).includes(source.projectId)) return fail('unregistered_project');
  const ticketId = safeToken(source.repairTicketId);
  const provenance = source.scopeProvenance && typeof source.scopeProvenance === 'object' ? source.scopeProvenance : {};
  if (!ticketId) return fail('missing_repair_ticket');
  if (provenance.kind !== 'repair-ticket-brief') return fail('untrusted_provenance_kind');
  if (provenance.ticketId !== ticketId) return fail('provenance_ticket_mismatch');
  if (provenance.file !== `board/repair-tickets/${ticketId}.md`) return fail('provenance_file_mismatch');
  if (provenance.issuerRole !== 'repair-lead') return fail('untrusted_provenance_issuer');
  const expectedTicket = ticketPath(workspaceRoot, ticketId);
  try { if (!fs.statSync(expectedTicket).isFile()) return fail('repair_ticket_missing'); }
  catch (_) { return fail('repair_ticket_missing'); }
  const proof = source.scopeProof && typeof source.scopeProof === 'object' ? source.scopeProof : {};
  if (proof.schemaVersion !== PROOF_SCHEMA || proof.issuerRole !== 'repair-lead') return fail('invalid_scope_proof');
  if (!safeToken(proof.issuerQueueId) || !safeToken(proof.issuerTaskId)) return fail('missing_issuer_identity');
  if (!nonEmptyString(proof.issuedAt) || !Number.isFinite(Date.parse(proof.issuedAt))) return fail('invalid_issued_at');
  if (!/^[a-f0-9]{24}$/i.test(String(proof.nonce || ''))) return fail('invalid_scope_nonce');
  const secret = readSecret(queueRoot);
  if (!secret) return fail('scope_signing_key_unavailable');
  if (!secureEqualHex(signCanonical(secret, source), source.scope_signature)) return fail('scope_signature_invalid');
  const issuerRecord = repairLeadIssuerRecord(queueRoot, proof.issuerQueueId, proof.issuerTaskId, ticketId);
  if (!issuerRecord.ok) return fail(issuerRecord.reason);
  return {
    applies: true,
    accepted: true,
    reason: 'trusted_repair_ticket_scope',
    requestedAgent: agent,
    projectId: source.projectId,
    rootQueueAgent: source.rootQueueAgent,
    rootQueueId: source.rootQueueId,
    rootTaskId: source.rootTaskId,
    ticketId,
    issuerRole: proof.issuerRole,
    issuerQueueId: proof.issuerQueueId,
    issuerTaskId: proof.issuerTaskId,
  };
}

function ceoFallbackTask(task, requestedAgent, assessment) {
  const source = task && typeof task === 'object' && !Array.isArray(task) ? task : { goal: String(task || '') };
  const fallback = {
    role: 'orchestrator',
    flowId: 'project-route',
    projectId: nonEmptyString(source.projectId) ? source.projectId : undefined,
    goal: String(source.goal || source.message || source.task || '').trim(),
    originalGoal: String(source.originalGoal || source.goal || source.message || source.task || '').trim(),
    bounds: nonEmptyString(source.bounds) ? source.bounds : undefined,
    acceptance: nonEmptyString(source.acceptance) ? source.acceptance : undefined,
    requestedTargetRole: requestedAgent,
    scopedBypassRejected: true,
    scopedBypassRejectReason: assessment && assessment.reason || 'untrusted_scope',
    useOrchestrator: true,
    autoApproveHuman: source.autoApproveHuman !== false,
  };
  for (const key of ['rootQueueAgent', 'rootQueueId', 'rootTaskId', 'parentTaskId', 'inputs', 'attachments']) {
    if (source[key] != null) fallback[key] = source[key];
  }
  return fallback;
}

function routeEnqueue(requestedAgent, task, opts = {}) {
  const assessment = assessScopedBypass(task, requestedAgent, opts);
  if (!assessment.applies || assessment.accepted) {
    return { agent: requestedAgent, task, assessment };
  }
  return {
    agent: 'ceo',
    task: ceoFallbackTask(task, requestedAgent, assessment),
    assessment,
  };
}

function enforcedRoleForQueue(agent, requestedRole) {
  const queueAgent = String(agent || '');
  const identityBound = new Set(['repair-lead', 'repair', 'it_engineer', 'quality_ops', 'governance']);
  if (identityBound.has(queueAgent)) return queueAgent;
  return requestedRole;
}

module.exports = {
  PRIVILEGED_EXECUTORS,
  SCOPE_SCHEMA,
  PROOF_SCHEMA,
  assessScopedBypass,
  ceoFallbackTask,
  enforcedRoleForQueue,
  registeredProjects,
  routeEnqueue,
  signRepairScopedEnvelope,
  _test: {
    canonicalScope,
    readSecret,
    secretFileFor,
    signCanonical,
    queueEntry,
    repairLeadIssuerRecord,
  },
};
