'use strict';

const crypto = require('crypto');

const CONTRACT_SCHEMA = 'acceptance-contract@1';
const RECORD_SCHEMA = 'acceptance-record@1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const ACCEPTANCE_ID_RE = /^acc_[a-f0-9]{24}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

function cleanText(value, label, maxLength = 8000) {
  const text = String(value == null ? '' : value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return text;
}

function normalizeScope(value) {
  const scope = cleanText(value || 'global', 'scope', 240);
  if (/[\u0000-\u001f]/.test(scope)) throw new Error('scope contains control characters');
  return scope;
}

function sourceHashFor({ sourceRef, scope, text }) {
  return sha256(['acceptance-source-v1', cleanText(sourceRef, 'source_ref', 500), normalizeScope(scope), cleanText(text, 'text')].join('\0'));
}

function acceptanceIdFor(sourceHash) {
  const hash = cleanText(sourceHash, 'source_hash', 64).toLowerCase();
  if (!SHA256_RE.test(hash)) throw new Error('source_hash must be sha256 hex');
  return `acc_${hash.slice(0, 24)}`;
}

function createRecord(input = {}, opts = {}) {
  const text = cleanText(input.text || input.point || input.requirement, 'acceptance text');
  const pointPrefix = input.point_prefix == null ? (opts.pointPrefix == null ? '任务验收: ' : opts.pointPrefix) : input.point_prefix;
  const point = cleanText(input.point || `${pointPrefix}${text}`, 'point');
  const scope = normalizeScope(input.scope || opts.scope || 'global');
  const sourceRef = cleanText(input.source_ref || input.sourceRef || opts.sourceRef || 'orchestrator', 'source_ref', 500);
  const expectedSourceHash = sourceHashFor({ sourceRef, scope, text });
  const suppliedSourceHash = input.source_hash || input.sourceHash;
  const sourceHash = String(suppliedSourceHash || expectedSourceHash).toLowerCase();
  const acceptanceId = String(input.acceptance_id || input.acceptanceId || acceptanceIdFor(sourceHash));
  if (!SHA256_RE.test(sourceHash)) throw new Error(`invalid source_hash for ${point}`);
  // `text` is the immutable machine-source atom. Human-facing equivalent wording
  // belongs in `point`; accepting a caller-supplied stale hash here would let a
  // downstream stage replace the requirement while retaining the old identity.
  if (sourceHash !== expectedSourceHash) {
    throw new Error(`source_hash does not match source_ref/scope/text for ${point}`);
  }
  if (!ACCEPTANCE_ID_RE.test(acceptanceId)) throw new Error(`invalid acceptance_id for ${point}`);
  if (acceptanceId !== acceptanceIdFor(sourceHash)) {
    throw new Error(`acceptance_id does not match source_hash for ${point}`);
  }
  return {
    schema: RECORD_SCHEMA,
    acceptance_id: acceptanceId,
    source_hash: sourceHash,
    scope,
    source_ref: sourceRef,
    source_kind: cleanText(input.source_kind || input.sourceKind || opts.sourceKind || 'orchestrator', 'source_kind', 80),
    point,
    text,
    task_status: input.task_status || input.taskStatus || null,
    task_evidence: input.task_evidence || input.taskEvidence || null,
    task_notes: input.task_notes || input.taskNotes || null,
  };
}

function createContract(items, opts = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('acceptance contract requires a non-empty item array');
  const records = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`acceptance item ${index + 1} must be an object; prose/string splitting is forbidden`);
    }
    return createRecord(item, {
      scope: opts.scope,
      sourceRef: opts.sourceRef || 'orchestrator',
      sourceKind: opts.sourceKind || 'orchestrator',
      pointPrefix: opts.pointPrefix,
    });
  });
  const seenIds = new Set();
  const seenHashes = new Set();
  for (const record of records) {
    if (seenIds.has(record.acceptance_id)) throw new Error(`duplicate acceptance_id: ${record.acceptance_id}`);
    if (seenHashes.has(record.source_hash)) throw new Error(`duplicate source_hash: ${record.source_hash}`);
    seenIds.add(record.acceptance_id);
    seenHashes.add(record.source_hash);
  }
  const contractSeed = records
    .map(record => `${record.acceptance_id}:${record.source_hash}:${record.scope}`)
    .sort()
    .join('|');
  return {
    schema: CONTRACT_SCHEMA,
    contract_id: `ac_${sha256(contractSeed).slice(0, 24)}`,
    stage: cleanText(opts.stage || 'orchestrator', 'stage', 80),
    project_id: opts.projectId || opts.project_id || null,
    root_task_id: opts.rootTaskId || opts.root_task_id || null,
    records,
  };
}

function normalizeContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('acceptance contract must be an object');
  if (value.schema !== CONTRACT_SCHEMA) throw new Error(`acceptance contract schema must be ${CONTRACT_SCHEMA}`);
  const records = (value.records || []).map(record => createRecord(record, { pointPrefix: '' }));
  const normalized = createContract(records, {
    stage: value.stage || 'unknown',
    projectId: value.project_id || null,
    rootTaskId: value.root_task_id || null,
    pointPrefix: '',
  });
  if (value.contract_id && value.contract_id !== normalized.contract_id) {
    throw new Error(`acceptance contract_id mismatch: ${value.contract_id}`);
  }
  return normalized;
}

function cloneRecord(record, patch = {}) {
  return createRecord(Object.assign({}, record, patch), { pointPrefix: '' });
}

function extendContract(contract, extraRecords, opts = {}) {
  const upstream = normalizeContract(contract);
  const records = upstream.records.concat((extraRecords || []).map(record => createRecord(record, { pointPrefix: '' })));
  return createContract(records, {
    stage: opts.stage || 'supervisor',
    projectId: opts.projectId || upstream.project_id,
    rootTaskId: opts.rootTaskId || upstream.root_task_id,
    pointPrefix: '',
  });
}

function timeoutError(startedAt, timeoutMs, clock) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  const elapsedMs = clock() - startedAt;
  return elapsedMs > timeoutMs ? { code: 'validation_timeout', elapsed_ms: elapsedMs, timeout_ms: timeoutMs } : null;
}

function duplicateIdentity(records) {
  const byId = new Map();
  const byHash = new Map();
  for (const record of records) {
    if (!byId.has(record.acceptance_id)) byId.set(record.acceptance_id, []);
    if (!byHash.has(record.source_hash)) byHash.set(record.source_hash, []);
    byId.get(record.acceptance_id).push(record);
    byHash.get(record.source_hash).push(record);
  }
  return {
    ids: Array.from(byId.entries()).filter(([, rows]) => rows.length > 1).map(([id]) => id),
    source_hashes: Array.from(byHash.entries()).filter(([, rows]) => rows.length > 1).map(([hash]) => hash),
  };
}

function validateHandoff(upstreamValue, downstreamValue, opts = {}) {
  const clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
  const startedAt = clock();
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 100;
  let upstream;
  let downstream;
  try {
    upstream = normalizeContract(upstreamValue);
    downstream = normalizeContract(downstreamValue);
  } catch (error) {
    return {
      ok: false,
      reason: 'contract_invalid',
      errors: [{ code: 'contract_invalid', message: String(error && error.message || error) }],
      warnings: [],
      elapsed_ms: clock() - startedAt,
    };
  }
  const earlyTimeout = timeoutError(startedAt, timeoutMs, clock);
  if (earlyTimeout) return { ok: false, reason: earlyTimeout.code, errors: [earlyTimeout], warnings: [], elapsed_ms: earlyTimeout.elapsed_ms };

  const expectedScope = opts.scope ? normalizeScope(opts.scope) : null;
  const allowSystemSources = new Set(opts.allowSystemSources || ['system:delivery', 'system:visual', 'system:decision']);
  const textDiagnostic = opts.textDiagnostic === true;
  const errors = [];
  const warnings = [];
  const upstreamDuplicates = duplicateIdentity(upstream.records);
  const downstreamDuplicates = duplicateIdentity(downstream.records);
  for (const id of upstreamDuplicates.ids) errors.push({ code: 'duplicate_upstream_acceptance_id', acceptance_id: id });
  for (const hash of upstreamDuplicates.source_hashes) errors.push({ code: 'duplicate_upstream_source_hash', source_hash: hash });
  for (const id of downstreamDuplicates.ids) errors.push({ code: 'duplicate_downstream_acceptance_id', acceptance_id: id });
  for (const hash of downstreamDuplicates.source_hashes) errors.push({ code: 'duplicate_downstream_source_hash', source_hash: hash });

  const downstreamById = new Map();
  for (const record of downstream.records) {
    if (!downstreamById.has(record.acceptance_id)) downstreamById.set(record.acceptance_id, []);
    downstreamById.get(record.acceptance_id).push(record);
  }
  const upstreamIds = new Set(upstream.records.map(record => record.acceptance_id));
  for (const source of upstream.records) {
    if (expectedScope && source.scope !== expectedScope) {
      warnings.push({ code: 'upstream_cross_scope_ignored', acceptance_id: source.acceptance_id, scope: source.scope });
      continue;
    }
    const matches = downstreamById.get(source.acceptance_id) || [];
    if (!matches.length) {
      errors.push({ code: 'missing_acceptance', acceptance_id: source.acceptance_id, source_hash: source.source_hash, scope: source.scope, point: source.point });
      continue;
    }
    const target = matches[0];
    if (target.source_hash !== source.source_hash) {
      errors.push({ code: 'source_hash_drift', acceptance_id: source.acceptance_id, expected: source.source_hash, actual: target.source_hash });
    }
    if (target.scope !== source.scope) {
      errors.push({ code: 'scope_drift', acceptance_id: source.acceptance_id, expected: source.scope, actual: target.scope });
    }
    if (target.source_ref !== source.source_ref || target.source_kind !== source.source_kind) {
      errors.push({ code: 'source_identity_drift', acceptance_id: source.acceptance_id, expected: `${source.source_kind}:${source.source_ref}`, actual: `${target.source_kind}:${target.source_ref}` });
    }
    if (textDiagnostic && target.point !== source.point) {
      warnings.push({ code: 'text_diagnostic_mismatch', acceptance_id: source.acceptance_id, expected: source.point, actual: target.point });
    }
  }

  for (const target of downstream.records) {
    if (upstreamIds.has(target.acceptance_id)) continue;
    if (expectedScope && target.scope !== expectedScope) {
      warnings.push({ code: 'cross_scope_isolated', acceptance_id: target.acceptance_id, scope: target.scope, point: target.point });
      continue;
    }
    if (target.source_kind === 'system' && allowSystemSources.has(target.source_ref)) continue;
    errors.push({ code: 'same_scope_unattributed', acceptance_id: target.acceptance_id, source_hash: target.source_hash, scope: target.scope, point: target.point });
  }

  const lateTimeout = timeoutError(startedAt, timeoutMs, clock);
  if (lateTimeout) errors.push(lateTimeout);
  const elapsedMs = clock() - startedAt;
  return {
    ok: errors.length === 0,
    reason: errors.length ? errors[0].code : null,
    errors,
    warnings,
    elapsed_ms: elapsedMs,
    upstream_count: upstream.records.length,
    downstream_count: downstream.records.length,
    coverage: upstream.records.length
      ? (upstream.records.length - errors.filter(error => error.code === 'missing_acceptance').length) / upstream.records.length
      : 1,
  };
}

function machinePointFor(record) {
  const text = cleanText(record && record.text, 'acceptance text');
  if (record && record.source_kind === 'orchestrator' && !/^任务验收\s*[:：]/i.test(text)) {
    return `任务验收: ${text}`;
  }
  return text;
}

function acceptanceRows(contractValue) {
  return normalizeContract(contractValue).records.map(record => ({
    // Consumer-facing rows are canonicalized from immutable machine text.  A
    // downstream stage may keep an equivalent `point` for its own display, but
    // that wording never becomes the done-gate requirement.
    point: machinePointFor(record),
    display_point: record.point,
    // Keep the immutable machine atom beside the human-facing point.  Consumer
    // stages may reword `point` for display, but must echo `text` exactly so the
    // done gate never has to infer the original requirement from prose.
    text: record.text,
    status: record.task_status || '',
    evidence: record.task_evidence || '',
    notes: record.task_notes || '',
    acceptance_id: record.acceptance_id,
    source_hash: record.source_hash,
    scope: record.scope,
    source_ref: record.source_ref,
    source_kind: record.source_kind,
  }));
}

function validateConsumerRows(contractValue, rows, opts = {}) {
  let contract;
  try {
    contract = normalizeContract(contractValue);
  } catch (error) {
    return { ok: false, reason: 'contract_invalid', errors: [{ code: 'contract_invalid', message: String(error && error.message || error) }], warnings: [] };
  }
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const byId = new Map();
  for (const row of normalizedRows) {
    const id = String(row && (row.acceptance_id || row.acceptanceId) || '');
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row || {});
  }
  const errors = [];
  const warnings = [];
  const requiredIds = new Set(contract.records.map(record => record.acceptance_id));
  for (const record of contract.records) {
    const matches = byId.get(record.acceptance_id) || [];
    if (!matches.length) {
      errors.push({ code: 'consumer_missing_acceptance_id', acceptance_id: record.acceptance_id, point: record.point });
      continue;
    }
    if (matches.length > 1) errors.push({ code: 'consumer_duplicate_acceptance_id', acceptance_id: record.acceptance_id });
    const row = matches[0];
    if (String(row.source_hash || row.sourceHash || '') !== record.source_hash) {
      errors.push({ code: 'consumer_source_hash_drift', acceptance_id: record.acceptance_id });
    }
    if (String(row.scope || '') !== record.scope) errors.push({ code: 'consumer_scope_drift', acceptance_id: record.acceptance_id });
    if (String(row.text == null ? '' : row.text) !== record.text) {
      errors.push({ code: 'consumer_machine_text_drift', acceptance_id: record.acceptance_id });
    }
    const consumerPoint = String(row.point == null ? '' : row.point).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (consumerPoint !== machinePointFor(record)) {
      errors.push({ code: 'consumer_point_drift', acceptance_id: record.acceptance_id });
    }
    if (opts.textDiagnostic === true && cleanText(row.point || '', 'consumer point') !== record.point) {
      warnings.push({ code: 'consumer_text_diagnostic_mismatch', acceptance_id: record.acceptance_id });
    }
  }
  for (const [id, matches] of byId.entries()) {
    if (!requiredIds.has(id)) errors.push({ code: 'consumer_unattributed_row', acceptance_id: id || null, point: matches[0] && matches[0].point || null });
  }
  return { ok: errors.length === 0, reason: errors.length ? errors[0].code : null, errors, warnings };
}

module.exports = {
  CONTRACT_SCHEMA,
  RECORD_SCHEMA,
  sha256,
  normalizeScope,
  sourceHashFor,
  acceptanceIdFor,
  createRecord,
  createContract,
  normalizeContract,
  cloneRecord,
  extendContract,
  validateHandoff,
  machinePointFor,
  acceptanceRows,
  validateConsumerRows,
};
