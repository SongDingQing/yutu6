#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SchemaValidator = require('./process-receipt-schema-validator');

const STEER_SCHEMA = 'repair-closeout-noop-steer@1';
const RECEIPT_SCHEMA = 'repair-claim-noop-receipt@1';
const PROVENANCE_SCHEMA = 'repair-claim-noop-steer-provenance@1';
const STEER_KIND = 'repair_closeout_noop';
const STEER_ACTION = 'complete_without_runner_if_verified';
const RECEIPT_ACTION = 'complete_without_runner';
const RECEIPT_REASON = 'verified_completed_repair_ticket';
const ALLOWED_STEER_SOURCES = new Set(['repair-closeout', 'repair-lead']);
const TRUSTED_STEER_ISSUERS = new Map([
  ['console-server:repair-closeout-noop', 'repair-closeout'],
  ['repair-lead:closeout', 'repair-lead'],
]);
const RECEIPT_SCHEMA_FILE = path.join(__dirname, 'config', 'repair-claim-noop-receipt.schema.json');
const PROVENANCE_SCHEMA_FILE = path.join(__dirname, 'config', 'repair-claim-noop-steer-provenance.schema.json');
const ALLOWED_STEER_KEYS = new Set([
  'schema',
  'kind',
  'source',
  'action',
  'queue_agent',
  'queue_id',
  'ticket_id',
  'ticket_sha256',
  'report_path',
  'report_sha256',
  'completion_fingerprint',
  'issued_at',
  'summary',
  'force_review',
]);

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value == null ? '' : value).trim());
}

function safeId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : '';
}

function safeSha256(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readSnapshot(file) {
  try {
    const raw = fs.readFileSync(file);
    return { ok: true, raw, text: raw.toString('utf8'), sha256: sha256(raw) };
  } catch (error) {
    return { ok: false, error: error && error.code || 'read_failed' };
  }
}

function parseJson(text) {
  try { return JSON.parse(text); }
  catch (_) { return null; }
}

function relativePath(root, file) {
  const rel = path.relative(root, file);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  return file;
}

function resolveFeatureEnabled(options) {
  if (options.enabled != null) return options.enabled === true;
  return truthy(process.env.REPAIR_CLAIM_NOOP_ENABLED);
}

function resolveForceReview(options) {
  if (options.forceReview != null) return options.forceReview === true;
  if (!Object.prototype.hasOwnProperty.call(process.env, 'REPAIR_CLAIM_NOOP_FORCE_REVIEW')) return true;
  return truthy(process.env.REPAIR_CLAIM_NOOP_FORCE_REVIEW);
}

function completionFingerprint(input) {
  const ticketId = safeId(input.ticketId || input.ticket_id);
  const ticketHash = safeSha256(input.ticketSha256 || input.ticket_sha256);
  const reportPath = String(input.reportPath || input.report_path || '').trim().split(path.sep).join('/');
  const reportHash = safeSha256(input.reportSha256 || input.report_sha256);
  if (!ticketId || !ticketHash || !reportPath || !reportHash) return '';
  return sha256([
    'repair-completion-fingerprint@1',
    ticketId,
    ticketHash,
    reportPath,
    reportHash,
  ].join('\n'));
}

function buildStructuredSteer(input = {}) {
  const marker = {
    schema: STEER_SCHEMA,
    kind: STEER_KIND,
    source: String(input.source || 'repair-lead'),
    action: STEER_ACTION,
    queue_agent: safeId(input.queueAgent || input.queue_agent),
    queue_id: safeId(input.queueId || input.queue_id),
    ticket_id: safeId(input.ticketId || input.ticket_id),
    ticket_sha256: safeSha256(input.ticketSha256 || input.ticket_sha256),
    report_path: String(input.reportPath || input.report_path || '').trim().split(path.sep).join('/'),
    report_sha256: safeSha256(input.reportSha256 || input.report_sha256),
    completion_fingerprint: safeSha256(input.completionFingerprint || input.completion_fingerprint),
    issued_at: String(input.issuedAt || input.issued_at || new Date().toISOString()),
    summary: 'verified repair closeout; return a read-only no-op receipt',
  };
  if (input.forceReview === true || input.force_review === true) marker.force_review = true;
  return JSON.stringify(marker);
}

function advertisesStructuredSteer(value) {
  const text = String(value || '');
  return text.includes(STEER_SCHEMA) || text.includes(STEER_KIND);
}

function validateMarkerObject(marker, context) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return 'structured_steer_not_object';
  const unknown = Object.keys(marker).filter(key => !ALLOWED_STEER_KEYS.has(key));
  if (unknown.length) return 'structured_steer_unknown_fields';
  if (marker.schema !== STEER_SCHEMA || marker.kind !== STEER_KIND || marker.action !== STEER_ACTION) {
    return 'structured_steer_contract_mismatch';
  }
  if (!ALLOWED_STEER_SOURCES.has(marker.source)) return 'structured_steer_source_untrusted';
  if (safeId(marker.queue_agent) !== context.queueAgent || safeId(marker.queue_id) !== context.queueId) {
    return 'structured_steer_queue_binding_mismatch';
  }
  if (!safeId(marker.ticket_id)) return 'structured_steer_ticket_id_invalid';
  if (!safeSha256(marker.ticket_sha256) || !safeSha256(marker.report_sha256) || !safeSha256(marker.completion_fingerprint)) {
    return 'structured_steer_hash_invalid';
  }
  if (!String(marker.report_path || '').trim()) return 'structured_steer_report_path_missing';
  if (marker.force_review === true) return 'structured_steer_force_review';
  return null;
}

function structuredMarker(entry, context) {
  const steer = Array.isArray(entry && entry.steer) ? entry.steer : [];
  const candidates = [];
  let invalidReason = null;
  for (const row of steer) {
    const msg = String(row && row.msg || '').trim();
    if (!msg) continue;
    const parsed = msg.startsWith('{') && msg.endsWith('}') ? parseJson(msg) : null;
    const advertisesContract = advertisesStructuredSteer(msg);
    if (!parsed) {
      if (advertisesContract) invalidReason = invalidReason || 'structured_steer_malformed';
      continue;
    }
    if (parsed.kind !== STEER_KIND && parsed.schema !== STEER_SCHEMA) continue;
    const reason = validateMarkerObject(parsed, context);
    if (reason) {
      invalidReason = invalidReason || reason;
      continue;
    }
    candidates.push({ marker: parsed, msg, at: row && row.at || null });
  }
  if (invalidReason) return { candidate: true, ok: false, reason: invalidReason };
  if (!candidates.length) return { candidate: false, ok: false, reason: 'trusted_structured_steer_missing' };
  if (candidates.length !== 1) return { candidate: true, ok: false, reason: 'structured_steer_ambiguous' };
  return { candidate: true, ok: true, value: candidates[0] };
}

function taskTicketIds(entry, spec) {
  const task = entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)
    ? entry.task
    : {};
  const ids = [];
  let invalidExplicit = false;
  for (const value of [task.repairTicketId, task.parentRepairTicketId, task.ticketId, spec && spec.repairTicketId]) {
    if (value == null || String(value).trim() === '') continue;
    const id = safeId(value);
    if (!id) invalidExplicit = true;
    else ids.push(id);
  }
  const goal = String(task.goal || task.message || task.task || '');
  const re = /board\/repair-tickets\/([A-Za-z0-9._-]+)\.md/g;
  let match;
  while ((match = re.exec(goal))) ids.push(match[1]);
  return { ids: Array.from(new Set(ids)), invalidExplicit };
}

function fieldRows(lines, start, end) {
  const out = new Map();
  for (let i = start; i < end; i++) {
    const match = String(lines[i] || '').match(/^-\s+([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(match[2]);
  }
  return out;
}

function exactlyOne(fields, key) {
  const values = fields.get(key) || [];
  return values.length === 1 ? values[0] : null;
}

function parseTicket(text) {
  const lines = String(text || '').split(/\r?\n/);
  const firstSection = lines.findIndex((line, index) => index > 0 && /^##\s+/.test(line));
  const topEnd = firstSection < 0 ? lines.length : firstSection;
  const topFields = fieldRows(lines, 1, topEnd);
  const topStatus = exactlyOne(topFields, 'status');
  if (topStatus !== 'done') return { ok: false, reason: 'ticket_status_not_done' };

  const completionHeadings = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s+完成记录(?:\s|$)/.test(lines[i])) completionHeadings.push(i);
  }
  if (!completionHeadings.length) return { ok: false, reason: 'ticket_completion_record_missing' };
  const start = completionHeadings[completionHeadings.length - 1];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { end = i; break; }
  }
  const completionFields = fieldRows(lines, start + 1, end);
  const completionStatus = exactlyOne(completionFields, 'status');
  const reportPath = exactlyOne(completionFields, 'report');
  const reportSha256 = safeSha256(exactlyOne(completionFields, 'report_sha256'));
  if (completionStatus !== 'done') return { ok: false, reason: 'latest_completion_status_not_done' };
  if (!reportPath) return { ok: false, reason: 'completion_report_missing' };
  if (!reportSha256) return { ok: false, reason: 'completion_report_hash_missing_or_invalid' };

  const allStatuses = fieldRows(lines, 0, lines.length).get('status') || [];
  if (!allStatuses.length || allStatuses[allStatuses.length - 1] !== 'done') {
    return { ok: false, reason: 'ticket_latest_status_signal_not_done' };
  }
  const tail = lines.slice(start + 1);
  if (tail.some(line => /^#{1,6}\s+.*(?:重开|重新打开|故障更新|reopened)/i.test(line))) {
    return { ok: false, reason: 'ticket_reopened_or_updated_failure' };
  }
  const tailFields = fieldRows(tail, 0, tail.length);
  for (const key of ['reopened', 'force_review', 'forceRepairReview']) {
    const values = tailFields.get(key) || [];
    if (values.some(truthy)) return { ok: false, reason: key === 'reopened' ? 'ticket_reopened' : 'ticket_force_review' };
  }
  if ((tailFields.get('updated_failure') || []).some(value => String(value).trim())) {
    return { ok: false, reason: 'ticket_updated_failure' };
  }
  return {
    ok: true,
    topStatus,
    completionStatus,
    completionHeadingLine: start + 1,
    reportPath: String(reportPath).trim().split(path.sep).join('/'),
    reportSha256,
  };
}

function allowedReportFile(workdir, ticketId, reportPath) {
  const portable = String(reportPath || '').trim().split(path.sep).join('/');
  if (portable !== `projects/控制台/artifacts/repair-reports/${ticketId}.html`) return null;
  const allowedRoot = path.resolve(workdir, 'projects/控制台/artifacts/repair-reports');
  const file = path.resolve(workdir, portable);
  const rel = path.relative(allowedRoot, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.extname(file) !== '.html') return null;
  return file;
}

function validateTypeLock(file, context) {
  if (!file || !fs.existsSync(file)) return { ok: false, reason: 'privileged_runner_lock_missing' };
  const snapshot = readSnapshot(file);
  const record = snapshot.ok ? parseJson(snapshot.text) : null;
  if (!record
    || record.agent !== context.queueAgent
    || record.queueId !== context.queueId
    || record.runnerType !== context.runnerType
    || Number(record.ownerPid) !== process.pid) {
    return { ok: false, reason: 'privileged_runner_lock_binding_mismatch' };
  }
  return { ok: true, snapshot, record };
}

function receiptHash(receipt) {
  const copy = Object.assign({}, receipt);
  delete copy.receipt_hash;
  return sha256(JSON.stringify(copy));
}

function provenanceHash(record) {
  const copy = Object.assign({}, record);
  delete copy.record_hash;
  return sha256(JSON.stringify(copy));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function provenanceFileFor(artifactsRoot, queueAgent, queueId, markerHash) {
  return path.join(
    artifactsRoot,
    'repair-claim-noop-steer-provenance',
    `${safeId(queueAgent)}-${safeId(queueId)}-${safeSha256(markerHash)}.json`,
  );
}

function activeQueueEntry(queueRoot, queueAgent, queueId) {
  const queueDir = path.join(queueRoot, 'queues', queueAgent);
  const running = path.join(queueDir, 'running', `${queueId}.json`);
  const runningSnapshot = readSnapshot(running);
  if (runningSnapshot.ok) return { file: running, snapshot: runningSnapshot, entry: parseJson(runningSnapshot.text) };
  let queued = [];
  try {
    queued = fs.readdirSync(queueDir)
      .filter(file => file.endsWith(`-${queueId}.json`))
      .sort();
  } catch (_) {}
  if (queued.length !== 1) return null;
  const file = path.join(queueDir, queued[0]);
  const snapshot = readSnapshot(file);
  return snapshot.ok ? { file, snapshot, entry: parseJson(snapshot.text) } : null;
}

function validateProvenanceRecord(record, expected = {}) {
  const errors = SchemaValidator.validate(record, PROVENANCE_SCHEMA_FILE);
  if (errors.length) return { ok: false, reason: 'structured_steer_provenance_schema_invalid', errors };
  if (TRUSTED_STEER_ISSUERS.get(record.issuer) !== record.source) {
    return { ok: false, reason: 'structured_steer_provenance_issuer_mismatch' };
  }
  if (record.record_hash !== provenanceHash(record)) {
    return { ok: false, reason: 'structured_steer_provenance_hash_invalid' };
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value != null && record[key] !== value) {
      return { ok: false, reason: 'structured_steer_provenance_binding_mismatch', field: key };
    }
  }
  return { ok: true };
}

function issueStructuredSteer(options = {}) {
  const workdir = path.resolve(options.workdir || path.join(__dirname, '../..'));
  const artifactsRoot = path.resolve(options.artifactsRoot || path.join(__dirname, 'artifacts'));
  const queueRoot = path.resolve(options.queueRoot || artifactsRoot);
  const queueAgent = safeId(options.queueAgent);
  const queueId = safeId(options.queueId);
  const ticketId = safeId(options.ticketId || options.ticket_id);
  const issuer = String(options.issuer || '');
  const source = TRUSTED_STEER_ISSUERS.get(issuer);
  if (queueAgent !== 'repair' || !queueId || !ticketId) return { ok: false, reason: 'steer_issue_binding_invalid' };
  if (!source) return { ok: false, reason: 'steer_issue_issuer_untrusted' };

  const active = activeQueueEntry(queueRoot, queueAgent, queueId);
  if (!active || !active.entry || !['queued', 'running'].includes(active.entry.status)) {
    return { ok: false, reason: 'steer_issue_queue_not_active' };
  }
  const tickets = taskTicketIds(active.entry, {});
  if (tickets.invalidExplicit || tickets.ids.length !== 1 || tickets.ids[0] !== ticketId) {
    return { ok: false, reason: 'steer_issue_ticket_binding_mismatch' };
  }

  const ticketFile = path.join(workdir, 'board', 'repair-tickets', `${ticketId}.md`);
  const ticketSnapshot = readSnapshot(ticketFile);
  if (!ticketSnapshot.ok) return { ok: false, reason: 'steer_issue_ticket_missing' };
  const ticket = parseTicket(ticketSnapshot.text);
  if (!ticket.ok) return { ok: false, reason: `steer_issue_${ticket.reason}` };
  const reportFile = allowedReportFile(workdir, ticketId, ticket.reportPath);
  if (!reportFile) return { ok: false, reason: 'steer_issue_report_path_invalid' };
  const reportSnapshot = readSnapshot(reportFile);
  if (!reportSnapshot.ok || reportSnapshot.sha256 !== ticket.reportSha256) {
    return { ok: false, reason: 'steer_issue_report_hash_mismatch' };
  }
  const fingerprint = completionFingerprint({
    ticketId,
    ticketSha256: ticketSnapshot.sha256,
    reportPath: ticket.reportPath,
    reportSha256: reportSnapshot.sha256,
  });
  const issuedAt = String(options.now ? options.now() : new Date().toISOString());
  const markerText = buildStructuredSteer({
    source,
    queueAgent,
    queueId,
    ticketId,
    ticketSha256: ticketSnapshot.sha256,
    reportPath: ticket.reportPath,
    reportSha256: reportSnapshot.sha256,
    completionFingerprint: fingerprint,
    issuedAt,
  });
  const markerHash = sha256(markerText);
  const provenanceFile = provenanceFileFor(artifactsRoot, queueAgent, queueId, markerHash);
  const provenance = {
    schema: PROVENANCE_SCHEMA,
    issuer,
    source,
    queue_agent: queueAgent,
    queue_id: queueId,
    ticket_id: ticketId,
    steer_sha256: markerHash,
    ticket_sha256: ticketSnapshot.sha256,
    report_path: ticket.reportPath,
    report_sha256: reportSnapshot.sha256,
    completion_fingerprint: fingerprint,
    issued_at: issuedAt,
  };
  provenance.record_hash = provenanceHash(provenance);
  const provenanceValidation = validateProvenanceRecord(provenance);
  if (!provenanceValidation.ok) return { ok: false, reason: provenanceValidation.reason };

  let provenanceReused = false;
  if (fs.existsSync(provenanceFile)) {
    const existing = parseJson(fs.readFileSync(provenanceFile, 'utf8'));
    const valid = validateProvenanceRecord(existing, provenance);
    if (!valid.ok) return { ok: false, reason: 'steer_issue_provenance_conflict' };
    provenanceReused = true;
  } else {
    writeJsonAtomic(provenanceFile, provenance);
  }
  const steerQueue = typeof options.steerQueue === 'function'
    ? options.steerQueue
    : ((root, agent, id, msg) => require('../../shared/engine/queue').steer(root, agent, id, msg));
  const steered = steerQueue(queueRoot, queueAgent, queueId, markerText);
  if (!steered) {
    if (!provenanceReused) {
      try { fs.unlinkSync(provenanceFile); } catch (_) {}
    }
    return { ok: false, reason: 'steer_issue_queue_not_active' };
  }
  if (typeof options.emit === 'function') {
    options.emit('repair.claim_noop.steer_issued', {
      queueAgent,
      queueId,
      ticketId,
      issuer,
      source,
      provenance: relativePath(workdir, provenanceFile),
      provenanceSha256: provenance.record_hash,
      steerSha256: markerHash,
      completionFingerprint: fingerprint,
    });
  }
  return {
    ok: true,
    queueAgent,
    queueId,
    ticketId,
    steerSha256: markerHash,
    completionFingerprint: fingerprint,
    provenanceFile,
    provenancePath: relativePath(workdir, provenanceFile),
    provenanceSha256: provenance.record_hash,
    provenanceReused,
  };
}

function sameReceiptBinding(existing, expected) {
  const schemaErrors = SchemaValidator.validate(existing, RECEIPT_SCHEMA_FILE);
  return !!(!schemaErrors.length
    && existing.schema === RECEIPT_SCHEMA
    && existing.receipt_hash === receiptHash(existing)
    && existing.queue_agent === expected.queue_agent
    && existing.queue_id === expected.queue_id
    && existing.task_id === expected.task_id
    && existing.ticket_id === expected.ticket_id
    && existing.ticket && existing.ticket.path === expected.ticket.path
    && existing.ticket.sha256 === expected.ticket.sha256
    && existing.completion_report && existing.completion_report.path === expected.completion_report.path
    && existing.completion_report.sha256 === expected.completion_report.sha256
    && existing.steer && canonicalJson(existing.steer) === canonicalJson(expected.steer)
    && existing.provenance && existing.provenance.path === expected.provenance.path
    && existing.provenance.schema === expected.provenance.schema
    && existing.provenance.issuer === expected.provenance.issuer
    && existing.provenance.record_sha256 === expected.provenance.record_sha256
    && existing.lock && canonicalJson(existing.lock) === canonicalJson(expected.lock)
    && existing.hash === expected.hash);
}

function prepare(options = {}) {
  const workdir = path.resolve(options.workdir || path.join(__dirname, '../..'));
  const artifactsRoot = path.resolve(options.artifactsRoot || path.join(__dirname, 'artifacts'));
  const queueRoot = path.resolve(options.queueRoot || artifactsRoot);
  const queueAgent = safeId(options.queueAgent);
  const queueId = safeId(options.queueId);
  const runnerType = String(options.runnerType || '');
  const spec = options.spec && typeof options.spec === 'object' ? options.spec : {};
  const taskId = safeId(spec.taskId || options.taskId);
  const context = { queueAgent, queueId, runnerType };
  if (!resolveFeatureEnabled(options)) return { handled: false, candidate: false, reason: 'feature_disabled' };
  if (queueAgent !== 'repair' || runnerType !== 'codex-privileged' || !queueId || !taskId) {
    return { handled: false, candidate: false, reason: 'queue_or_runner_not_eligible' };
  }

  const lock = validateTypeLock(options.typeLockFile, context);
  if (!lock.ok) return { handled: false, candidate: false, reason: lock.reason };
  const runningEntryFile = path.join(queueRoot, 'queues', queueAgent, 'running', `${queueId}.json`);
  const entryBefore = readSnapshot(runningEntryFile);
  if (!entryBefore.ok) return { handled: false, candidate: false, reason: 'running_entry_missing' };
  const runningEntry = parseJson(entryBefore.text);
  if (!runningEntry) return { handled: false, candidate: false, reason: 'running_entry_invalid' };
  if (safeId(runningEntry.id) !== queueId
    || safeId(runningEntry.target) !== queueAgent
    || runningEntry.status !== 'running'
    || safeId(runningEntry.taskId) !== taskId) {
    return { handled: false, candidate: false, reason: 'running_entry_binding_mismatch' };
  }

  const markerResult = structuredMarker(runningEntry, context);
  if (!markerResult.ok) return {
    handled: false,
    candidate: markerResult.candidate,
    reason: markerResult.reason,
  };
  const marker = markerResult.value.marker;
  const markerHash = sha256(markerResult.value.msg);
  const provenanceFile = provenanceFileFor(artifactsRoot, queueAgent, queueId, markerHash);
  const provenanceSnapshot = readSnapshot(provenanceFile);
  if (!provenanceSnapshot.ok) {
    return { handled: false, candidate: true, ticketId: marker.ticket_id, reason: 'structured_steer_provenance_missing' };
  }
  const provenance = parseJson(provenanceSnapshot.text);
  const provenanceValidation = validateProvenanceRecord(provenance, {
    source: marker.source,
    queue_agent: queueAgent,
    queue_id: queueId,
    ticket_id: marker.ticket_id,
    steer_sha256: markerHash,
    ticket_sha256: marker.ticket_sha256,
    report_path: marker.report_path,
    report_sha256: marker.report_sha256,
    completion_fingerprint: marker.completion_fingerprint,
  });
  if (!provenanceValidation.ok) {
    return { handled: false, candidate: true, ticketId: marker.ticket_id, reason: provenanceValidation.reason };
  }
  if (resolveForceReview(options)) return { handled: false, candidate: true, ticketId: marker.ticket_id, reason: 'global_force_review' };
  const task = runningEntry.task && typeof runningEntry.task === 'object' ? runningEntry.task : {};
  if (task.forceRepairReview === true || task.force_repair_review === true || spec.forceRepairReview === true) {
    return { handled: false, candidate: true, ticketId: marker.ticket_id, reason: 'task_force_review' };
  }

  const tickets = taskTicketIds(runningEntry, spec);
  if (tickets.invalidExplicit || tickets.ids.length !== 1) {
    return { handled: false, candidate: true, ticketId: marker.ticket_id, reason: 'task_ticket_binding_ambiguous' };
  }
  const ticketId = tickets.ids[0];
  if (ticketId !== marker.ticket_id) {
    return { handled: false, candidate: true, ticketId, reason: 'task_steer_ticket_mismatch' };
  }

  const ticketFile = path.join(workdir, 'board', 'repair-tickets', `${ticketId}.md`);
  const ticketBefore = readSnapshot(ticketFile);
  if (!ticketBefore.ok) return { handled: false, candidate: true, ticketId, reason: 'ticket_file_missing' };
  const ticket = parseTicket(ticketBefore.text);
  if (!ticket.ok) return { handled: false, candidate: true, ticketId, reason: ticket.reason };
  if (marker.ticket_sha256 !== ticketBefore.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'ticket_hash_mismatch' };
  }

  const reportFile = allowedReportFile(workdir, ticketId, ticket.reportPath);
  if (!reportFile) return { handled: false, candidate: true, ticketId, reason: 'completion_report_path_outside_allowlist' };
  if (marker.report_path !== ticket.reportPath) {
    return { handled: false, candidate: true, ticketId, reason: 'steer_completion_report_path_mismatch' };
  }
  const reportBefore = readSnapshot(reportFile);
  if (!reportBefore.ok) return { handled: false, candidate: true, ticketId, reason: 'completion_report_file_missing' };
  if (ticket.reportSha256 !== reportBefore.sha256 || marker.report_sha256 !== reportBefore.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'completion_report_hash_mismatch' };
  }
  const fingerprint = completionFingerprint({
    ticketId,
    ticketSha256: ticketBefore.sha256,
    reportPath: ticket.reportPath,
    reportSha256: reportBefore.sha256,
  });
  if (!fingerprint || marker.completion_fingerprint !== fingerprint) {
    return { handled: false, candidate: true, ticketId, reason: 'completion_fingerprint_mismatch' };
  }
  const taskFingerprint = safeSha256(task.repairCompletionFingerprint || task.repair_completion_fingerprint || '');
  if ((task.repairCompletionFingerprint || task.repair_completion_fingerprint) && taskFingerprint !== fingerprint) {
    return { handled: false, candidate: true, ticketId, reason: 'task_completion_fingerprint_mismatch' };
  }

  if (typeof options.beforeFinalRead === 'function') options.beforeFinalRead({ ticketFile, reportFile, runningEntryFile });
  const entryAfter = readSnapshot(runningEntryFile);
  const ticketAfter = readSnapshot(ticketFile);
  const reportAfter = readSnapshot(reportFile);
  const lockAfter = readSnapshot(options.typeLockFile);
  if (!lockAfter.ok || lockAfter.sha256 !== lock.snapshot.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'privileged_runner_lock_changed_during_validation' };
  }
  if (!entryAfter.ok || entryAfter.sha256 !== entryBefore.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'queue_entry_changed_during_locked_validation' };
  }
  if (!ticketAfter.ok || ticketAfter.sha256 !== ticketBefore.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'ticket_changed_during_locked_validation' };
  }
  if (!reportAfter.ok || reportAfter.sha256 !== reportBefore.sha256) {
    return { handled: false, candidate: true, ticketId, reason: 'completion_report_changed_during_locked_validation' };
  }

  const receiptDir = path.join(artifactsRoot, 'repair-claim-noop');
  const receiptFile = path.join(receiptDir, `${queueAgent}-${queueId}.json`);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    task_id: taskId,
    queue_agent: queueAgent,
    queue_id: queueId,
    ticket_id: ticketId,
    status: 'done',
    action: RECEIPT_ACTION,
    reason: RECEIPT_REASON,
    hash: fingerprint,
    ticket: {
      path: relativePath(workdir, ticketFile),
      sha256: ticketBefore.sha256,
    },
    completion_report: {
      path: ticket.reportPath,
      sha256: reportBefore.sha256,
    },
    steer: {
      schema: STEER_SCHEMA,
      kind: STEER_KIND,
      source: marker.source,
      sha256: markerHash,
      summary: 'trusted structured repair closeout no-op',
    },
    provenance: {
      schema: PROVENANCE_SCHEMA,
      issuer: provenance.issuer,
      path: relativePath(workdir, provenanceFile),
      record_sha256: provenance.record_hash,
    },
    lock: {
      kind: 'privileged_runner_type_singleflight',
      runner_type: runnerType,
      path: relativePath(workdir, options.typeLockFile),
      record_sha256: lock.snapshot.sha256,
    },
    created_at: String(options.now ? options.now() : new Date().toISOString()),
  };
  receipt.receipt_hash = receiptHash(receipt);
  const receiptSchemaErrors = SchemaValidator.validate(receipt, RECEIPT_SCHEMA_FILE);
  if (receiptSchemaErrors.length) {
    return { handled: false, candidate: true, ticketId, reason: 'noop_receipt_schema_invalid' };
  }

  let receiptReused = false;
  if (fs.existsSync(receiptFile)) {
    const existing = parseJson(fs.readFileSync(receiptFile, 'utf8'));
    if (!sameReceiptBinding(existing, receipt)) {
      return { handled: false, candidate: true, ticketId, reason: 'noop_receipt_conflict', receiptFile };
    }
    receiptReused = true;
    Object.assign(receipt, existing);
  } else {
    writeJsonAtomic(receiptFile, receipt);
  }
  return {
    handled: true,
    candidate: true,
    prepared: true,
    ticketId,
    fingerprint,
    receipt,
    receiptFile,
    receiptPath: relativePath(workdir, receiptFile),
    receiptReused,
    guard: {
      workdir,
      queueRoot,
      queueAgent,
      queueId,
      runningEntryFile,
      doneEntryFile: path.join(queueRoot, 'queues', queueAgent, 'done', `${queueId}.json`),
      entry: runningEntry,
      entrySha256: entryBefore.sha256,
      ticketFile,
      ticketSha256: ticketBefore.sha256,
      reportFile,
      reportSha256: reportBefore.sha256,
      lockFile: options.typeLockFile,
      lockSha256: lock.snapshot.sha256,
      provenanceFile,
      provenanceSha256: provenanceSnapshot.sha256,
    },
  };
}

const FINISH_PATCH_KEYS = [
  'engine_code',
  'engine_signal',
  'error',
  'reason',
  'repair_claim_noop',
];

function normalizedFinishedEntry(entry, baseline) {
  const copy = JSON.parse(JSON.stringify(entry || {}));
  for (const key of FINISH_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(baseline, key)) copy[key] = baseline[key];
    else delete copy[key];
  }
  for (const key of ['status', 'finished_at']) {
    if (Object.prototype.hasOwnProperty.call(baseline, key)) copy[key] = baseline[key];
    else delete copy[key];
  }
  return copy;
}

function verifyPreparedState(prepared, phase) {
  const guard = prepared && prepared.guard;
  if (!guard) return { ok: false, reason: 'queue_commit_guard_missing' };
  const suffix = phase === 'done' ? 'during_queue_commit' : 'before_queue_commit';
  const lock = readSnapshot(guard.lockFile);
  if (!lock.ok || lock.sha256 !== guard.lockSha256) {
    return { ok: false, reason: `privileged_runner_lock_changed_${suffix}` };
  }
  const ticket = readSnapshot(guard.ticketFile);
  if (!ticket.ok || ticket.sha256 !== guard.ticketSha256) {
    return { ok: false, reason: `ticket_changed_${suffix}` };
  }
  const report = readSnapshot(guard.reportFile);
  if (!report.ok || report.sha256 !== guard.reportSha256) {
    return { ok: false, reason: `completion_report_changed_${suffix}` };
  }
  const provenance = readSnapshot(guard.provenanceFile);
  if (!provenance.ok || provenance.sha256 !== guard.provenanceSha256) {
    return { ok: false, reason: `structured_steer_provenance_changed_${suffix}` };
  }
  if (phase !== 'done') {
    const running = readSnapshot(guard.runningEntryFile);
    if (!running.ok || running.sha256 !== guard.entrySha256) {
      return { ok: false, reason: 'queue_entry_changed_before_queue_commit' };
    }
    return { ok: true };
  }
  if (fs.existsSync(guard.runningEntryFile)) {
    return { ok: false, reason: 'queue_finish_not_committed' };
  }
  const done = readSnapshot(guard.doneEntryFile);
  const doneEntry = done.ok ? parseJson(done.text) : null;
  if (!doneEntry
    || canonicalJson(normalizedFinishedEntry(doneEntry, guard.entry)) !== canonicalJson(guard.entry)
    || doneEntry.status !== 'done'
    || !doneEntry.repair_claim_noop
    || doneEntry.repair_claim_noop.receipt_hash !== prepared.receipt.receipt_hash) {
    return { ok: false, reason: 'queue_entry_changed_during_queue_commit' };
  }
  return { ok: true, doneEntry };
}

function archiveReceipt(prepared, reason) {
  if (!prepared || !prepared.receiptFile || !fs.existsSync(prepared.receiptFile)) return null;
  const suffix = safeId(reason) || 'commit-aborted';
  const archived = `${prepared.receiptFile}.aborted-${Date.now()}-${suffix}.json`;
  try {
    fs.renameSync(prepared.receiptFile, archived);
    return archived;
  } catch (_) {
    return null;
  }
}

function restoreRunningForFallback(prepared) {
  const guard = prepared && prepared.guard;
  if (!guard || fs.existsSync(guard.runningEntryFile)) return false;
  const done = readSnapshot(guard.doneEntryFile);
  const doneEntry = done.ok ? parseJson(done.text) : null;
  if (!doneEntry) return false;
  const restored = JSON.parse(JSON.stringify(doneEntry));
  for (const key of FINISH_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(guard.entry, key)) restored[key] = guard.entry[key];
    else delete restored[key];
  }
  restored.status = 'running';
  if (Object.prototype.hasOwnProperty.call(guard.entry, 'finished_at')) restored.finished_at = guard.entry.finished_at;
  else delete restored.finished_at;
  try {
    writeJsonAtomic(guard.runningEntryFile, restored);
    try {
      fs.unlinkSync(guard.doneEntryFile);
    } catch (error) {
      try { fs.unlinkSync(guard.runningEntryFile); } catch (_) {}
      throw error;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function emitFallback(emit, prepared, options, extra = {}) {
  const result = Object.assign({}, prepared, extra, { handled: false, candidate: true });
  emit('repair.claim_noop.fallback', {
    task: options.spec && options.spec.taskId || null,
    queueAgent: options.queueAgent || null,
    queueId: options.queueId || null,
    ticketId: result.ticketId || null,
    reason: result.reason,
    receiptAborted: result.receiptAborted || null,
    commitRolledBack: result.commitRolledBack === true,
  });
  return result;
}

function completeIfEligible(options = {}) {
  const prepared = prepare(options);
  const emit = typeof options.emit === 'function' ? options.emit : () => {};
  if (!prepared.handled) {
    if (prepared.candidate) {
      emit('repair.claim_noop.fallback', {
        task: options.spec && options.spec.taskId || null,
        queueAgent: options.queueAgent || null,
        queueId: options.queueId || null,
        ticketId: prepared.ticketId || null,
        reason: prepared.reason,
      });
    }
    return prepared;
  }
  if (typeof options.afterReceipt === 'function') options.afterReceipt(prepared);
  const beforeCommit = verifyPreparedState(prepared, 'running');
  if (!beforeCommit.ok) {
    const receiptAborted = archiveReceipt(prepared, beforeCommit.reason);
    return emitFallback(emit, prepared, options, { reason: beforeCommit.reason, receiptAborted });
  }
  if (typeof options.finishQueue !== 'function') throw new Error('repair claim no-op requires finishQueue callback');
  const finished = options.finishQueue({
    status: 'done',
    patch: {
      engine_code: null,
      engine_signal: null,
      error: null,
      reason: RECEIPT_REASON,
      repair_claim_noop: {
        schema: RECEIPT_SCHEMA,
        receipt: prepared.receiptPath,
        receipt_hash: prepared.receipt.receipt_hash,
        ticket_id: prepared.ticketId,
        completion_fingerprint: prepared.fingerprint,
      },
    },
  });
  if (typeof options.afterFinish === 'function') options.afterFinish(prepared, finished);
  const afterCommit = verifyPreparedState(prepared, 'done');
  if (!afterCommit.ok) {
    const commitRolledBack = restoreRunningForFallback(prepared);
    const receiptAborted = archiveReceipt(prepared, afterCommit.reason);
    if (!commitRolledBack) {
      const error = new Error(`repair claim no-op conditional commit rollback failed: ${afterCommit.reason}`);
      error.code = 'REPAIR_CLAIM_NOOP_COMMIT_ROLLBACK_FAILED';
      emit('repair.claim_noop.commit_rollback_failed', {
        task: options.spec && options.spec.taskId || null,
        queueAgent: options.queueAgent || null,
        queueId: options.queueId || null,
        ticketId: prepared.ticketId || null,
        reason: afterCommit.reason,
        receiptAborted,
      });
      throw error;
    }
    return emitFallback(emit, prepared, options, {
      reason: afterCommit.reason,
      receiptAborted,
      commitRolledBack: true,
    });
  }
  const eventDetail = {
    task: options.spec && options.spec.taskId || null,
    queueAgent: options.queueAgent,
    queueId: options.queueId,
    rootQueueAgent: options.spec && options.spec.rootQueueAgent || null,
    rootQueueId: options.spec && options.spec.rootQueueId || null,
    rootTaskId: options.spec && options.spec.rootTaskId || null,
    ticketId: prepared.ticketId,
    receipt: prepared.receiptPath,
    receiptSha256: prepared.receipt.receipt_hash,
    completionFingerprint: prepared.fingerprint,
    provenance: prepared.receipt.provenance.path,
    provenanceSha256: prepared.receipt.provenance.record_sha256,
    lockType: 'privileged_runner_type_singleflight',
    noop: true,
  };
  emit('repair.claim_noop.completed', eventDetail);
  emit('queue.completed', Object.assign({}, eventDetail, {
    ok: true,
    status: 'done',
    code: null,
    signal: null,
    reason: RECEIPT_REASON,
  }));
  return Object.assign({}, prepared, { finished });
}

module.exports = {
  STEER_SCHEMA,
  RECEIPT_SCHEMA,
  PROVENANCE_SCHEMA,
  STEER_KIND,
  STEER_ACTION,
  RECEIPT_ACTION,
  RECEIPT_REASON,
  completionFingerprint,
  buildStructuredSteer,
  advertisesStructuredSteer,
  issueStructuredSteer,
  parseTicket,
  prepare,
  completeIfEligible,
};
