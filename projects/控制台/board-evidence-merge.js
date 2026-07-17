'use strict';

// Board-only evidence merge contract. The active path is protected by both a
// feature flag and a durable owner approval record. Without both, callers may
// write a shadow contract for audit, but must keep the legacy acceptance rules.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const InteractionTrace = require('../../shared/engine/interaction-trace');

const CONTRACT_SCHEMA = 'yutu6-board-evidence-merge@2';
const APPROVAL_SCHEMA = 'yutu6-board-evidence-merge-approval@1';
const SUGGESTION_APPROVAL_SCHEMA = 'yutu6-board-suggestion-approval@1';
const REPRODUCTION_RECEIPT_SCHEMA = 'yutu6-board-reproduction-receipt@1';
const REPRODUCTION_RECEIPT_ISSUER = 'console-controlled-runner';
const DEFAULT_APPROVAL_FILE = path.join(__dirname, 'config', 'board-evidence-merge.json');
const FEATURE_FLAG = 'YUTU6_BOARD_EVIDENCE_MERGE_ENABLED';
const FEATURE_SCOPE = 'board_context_dedupe_and_evidence_merge_v1';
const EVIDENCE_LEVELS = ['none', 'claim', 'trace', 'reproducible', 'owner_approved'];
const REDLINE_TYPES = ['secret_leak', 'scope_escape', 'deadlock', 'severe_concurrency', 'severe_routing'];
const REPRODUCTION_RECEIPT_FIELDS = [
  'schema', 'receipt_id', 'issuer', 'execution_id', 'task_id', 'suggestion_id',
  'source_role', 'source_trace_ref', 'source_trace_line_sha256',
  'evidence_binding_sha256', 'command_sha256', 'status', 'exit_code',
  'started_at', 'completed_at', 'result_ref', 'result_line_sha256', 'integrity_sha256',
].sort();

const ROLE_ALIASES = new Map([
  ['board_deepseek', 'board_deepseek'],
  ['deepseek_board', 'board_deepseek'],
  ['board_glm52', 'board_glm52'],
  ['glm52_board', 'board_glm52'],
  ['board_claude', 'board_claude'],
  ['claude_board', 'board_claude'],
  ['board_opus48', 'board_final'],
  ['board_final', 'board_final'],
  ['final_director', 'board_final'],
  ['gpt_5_6_sol', 'board_final'],
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeId(value, fallback = 'unknown') {
  return String(value || fallback).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || fallback;
}

function cleanText(value, max = 1200) {
  const text = InteractionTrace.redact(String(value || '')).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function normalizeReproductionClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = cleanText(value.command || value.procedure || '', 500);
  const receiptId = cleanText(value.receipt_id || value.receiptId || '', 160);
  const status = cleanText(value.status || '', 80).toLowerCase();
  const exitCode = value.exit_code == null ? null : Number(value.exit_code);
  if (!command && !receiptId && !status && exitCode == null) return null;
  return {
    command: command || null,
    receipt_id: receiptId || null,
    claimed_status: status || null,
    claimed_exit_code: Number.isFinite(exitCode) ? exitCode : null,
  };
}

function reproductionCommandHash(value) {
  return sha256(cleanText(value, 500));
}

function reproductionReceiptPayload(receipt = {}) {
  return {
    schema: String(receipt.schema || ''),
    receipt_id: String(receipt.receipt_id || ''),
    issuer: String(receipt.issuer || ''),
    execution_id: String(receipt.execution_id || ''),
    task_id: String(receipt.task_id || ''),
    suggestion_id: String(receipt.suggestion_id || ''),
    source_role: String(receipt.source_role || ''),
    source_trace_ref: String(receipt.source_trace_ref || ''),
    source_trace_line_sha256: String(receipt.source_trace_line_sha256 || ''),
    evidence_binding_sha256: String(receipt.evidence_binding_sha256 || ''),
    command_sha256: String(receipt.command_sha256 || ''),
    status: String(receipt.status || ''),
    exit_code: receipt.exit_code == null ? null : Number(receipt.exit_code),
    started_at: String(receipt.started_at || ''),
    completed_at: String(receipt.completed_at || ''),
    result_ref: String(receipt.result_ref || ''),
    result_line_sha256: String(receipt.result_line_sha256 || ''),
  };
}

function reproductionReceiptIntegrity(receipt) {
  return sha256(JSON.stringify(reproductionReceiptPayload(receipt)));
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function approvedRecord(record) {
  return !!(record
    && record.schema === APPROVAL_SCHEMA
    && record.status === 'approved'
    && record.ownerApproved === true
    && record.approvedBy === '主人'
    && record.scope === FEATURE_SCOPE
    && !Number.isNaN(Date.parse(record.approvedAt || ''))
    && cleanText(record.rollback, 500));
}

function activationState(opts = {}) {
  const approvalFile = path.resolve(opts.approvalFile
    || process.env.CONSOLE_BOARD_EVIDENCE_MERGE_APPROVAL_FILE
    || DEFAULT_APPROVAL_FILE);
  const record = opts.record || readJson(approvalFile, {});
  const env = opts.env || process.env;
  const featureFlag = String(env[FEATURE_FLAG] || '').trim() === '1';
  const ownerApproved = approvedRecord(record);
  const active = featureFlag && ownerApproved;
  return {
    schema: 'yutu6-board-evidence-merge-activation@1',
    active,
    feature_flag: featureFlag,
    owner_approved: ownerApproved,
    shadow_enabled: record && record.shadowEnabled === true,
    approval_file: approvalFile,
    approval_record: ownerApproved ? record : null,
    scope: FEATURE_SCOPE,
    reason: active ? 'feature_flag_and_owner_approval_valid'
      : (!featureFlag ? 'feature_flag_disabled' : 'owner_approval_required'),
  };
}

function canonicalRole(value, explicit) {
  const selected = cleanText(explicit || value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ROLE_ALIASES.get(selected) || selected || 'unknown';
}

function normalizeRecord(value, kind, index) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { text: value };
  const text = cleanText(source.text || source.issue || source.risk || source.suggestion
    || source.action || source.summary || source.problem, 1200);
  if (!text) return null;
  const claimKey = cleanText(source.claim_key || source.topic_key || '', 160)
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, '-').replace(/^-+|-+$/g, '');
  const stance = cleanText(source.stance || 'assert', 80).toLowerCase();
  const requested = cleanText(source.classification || source.requested_classification || '', 80).toLowerCase();
  const refs = Array.isArray(source.evidence_refs) ? source.evidence_refs
    : (source.evidence_ref ? [source.evidence_ref] : []);
  return {
    kind,
    index,
    text,
    claim_key: claimKey || null,
    stance: stance || 'assert',
    requested_classification: requested || null,
    evidence_refs: refs,
    evidence_level_claimed: cleanText(source.evidence_level || '', 80).toLowerCase() || null,
    redline_type: normalizeRedlineType(source.redline_type || source.redline, text),
    reproduction: normalizeReproductionClaim(source.reproduction),
    reasoning_source_id: cleanText(source.reasoning_source_id || '', 240) || null,
    canonical_role: cleanText(source.canonical_role || '', 120) || null,
    is_fallback_duplicate: source.is_fallback_duplicate === true,
  };
}

function normalizeProposalRecords(value, kind) {
  const rows = Array.isArray(value) ? value : (value ? [value] : []);
  return rows.map((row, index) => normalizeRecord(row, kind, index)).filter(Boolean);
}

function normalizeRedlineType(value, text) {
  const explicit = cleanText(value, 80).toLowerCase().replace(/[^a-z_]+/g, '_').replace(/^_+|_+$/g, '');
  if (REDLINE_TYPES.includes(explicit)) return explicit;
  const source = String(text || '');
  if (/(密钥|token|cookie|private key|secret).{0,20}(泄漏|暴露|回显|leak|expos)/i.test(source)) return 'secret_leak';
  if (/(越界|scope escape|跨项目写|未授权写)/i.test(source)) return 'scope_escape';
  if (/(死锁|deadlock)/i.test(source)) return 'deadlock';
  if (/(严重并发|数据竞态|重复提交|double commit|race condition)/i.test(source)) return 'severe_concurrency';
  if (/(严重路由|路由事故|错误项目|wrong project|misroute)/i.test(source)) return 'severe_routing';
  return null;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function splitEvidenceRef(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : { ref: value };
  const raw = cleanText(source.ref || source.path || '', 800);
  const match = raw.match(/^(projects\/控制台\/[^:\n]+):(\d+)(?::\d+)?$/);
  return match ? { raw, path: match[1], line: Number(match[2]), kind: cleanText(source.kind || 'substantive', 80) } : null;
}

function verifyEvidenceRef(value, opts = {}) {
  const parsed = splitEvidenceRef(value);
  if (!parsed) return { ref: cleanText(value && value.ref || value, 800), verified: false, reason: 'unparseable_project_path_line' };
  const workspaceRoot = path.resolve(opts.workspaceRoot || path.resolve(__dirname, '../..'));
  const projectRootRaw = path.join(workspaceRoot, 'projects', '控制台');
  let projectRoot;
  try { projectRoot = fs.realpathSync(projectRootRaw); }
  catch (_) { return { ref: parsed.raw, verified: false, reason: 'console_project_root_missing' }; }
  const absolute = path.resolve(workspaceRoot, parsed.path);
  if (!inside(projectRootRaw, absolute)) return { ref: parsed.raw, verified: false, reason: 'outside_console_project' };
  let stat;
  try { stat = fs.lstatSync(absolute); }
  catch (_) { return { ref: parsed.raw, verified: false, reason: 'evidence_missing' }; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { ref: parsed.raw, verified: false, reason: 'evidence_not_regular_file' };
  let real;
  try { real = fs.realpathSync(absolute); }
  catch (_) { return { ref: parsed.raw, verified: false, reason: 'evidence_realpath_failed' }; }
  if (!inside(projectRoot, real)) return { ref: parsed.raw, verified: false, reason: 'evidence_realpath_outside_project' };
  const lines = fs.readFileSync(real, 'utf8').split(/\r?\n/);
  if (parsed.line < 1 || parsed.line > lines.length) return { ref: parsed.raw, verified: false, reason: 'evidence_line_out_of_range' };
  const excerpt = cleanText(lines[parsed.line - 1], 500);
  if (!excerpt) return { ref: parsed.raw, verified: false, reason: 'evidence_line_empty' };
  return {
    ref: parsed.raw,
    path: parsed.path,
    line: parsed.line,
    kind: parsed.kind,
    verified: true,
    line_sha256: sha256(lines[parsed.line - 1]),
    excerpt,
  };
}

function reproductionFailure(claim, reason, receiptId = null) {
  return {
    verified: false,
    reason,
    receipt_id: receiptId || claim && claim.receipt_id || null,
    claim: claim || null,
    receipt: null,
  };
}

function verifyReproductionReceipt(row, opts = {}) {
  const claim = row && row.record && row.record.reproduction;
  if (!claim || !claim.command) return reproductionFailure(claim, 'reproduction_command_missing');
  if (!row.evidence || !row.evidence.verified.length) {
    return reproductionFailure(claim, 'verified_substantive_evidence_missing');
  }
  if (!claim.receipt_id) return reproductionFailure(claim, 'trusted_receipt_id_missing');
  if (opts.reproductionReceiptsTrusted !== true) {
    return reproductionFailure(claim, 'trusted_receipt_channel_disabled');
  }
  const receipts = Array.isArray(opts.reproductionReceipts) ? opts.reproductionReceipts : [];
  const matchingReceipts = receipts.filter(candidate => candidate && candidate.receipt_id === claim.receipt_id);
  if (!matchingReceipts.length) return reproductionFailure(claim, 'trusted_receipt_not_found');
  if (matchingReceipts.length !== 1) return reproductionFailure(claim, 'trusted_receipt_id_ambiguous');
  const receipt = matchingReceipts[0];
  const keys = Object.keys(receipt).sort();
  if (JSON.stringify(keys) !== JSON.stringify(REPRODUCTION_RECEIPT_FIELDS)) {
    return reproductionFailure(claim, 'trusted_receipt_shape_invalid', claim.receipt_id);
  }
  if (receipt.schema !== REPRODUCTION_RECEIPT_SCHEMA
    || receipt.issuer !== REPRODUCTION_RECEIPT_ISSUER
    || !cleanText(receipt.execution_id, 200)
    || receipt.task_id !== opts.taskId
    || row.source_task !== opts.taskId
    || receipt.suggestion_id !== opts.suggestionId
    || receipt.source_role !== row.canonical_role
    || receipt.source_trace_ref !== row.source_trace
    || receipt.evidence_binding_sha256 !== opts.evidenceBinding
    || receipt.command_sha256 !== reproductionCommandHash(claim.command)
    || receipt.status !== 'reproduced'
    || receipt.exit_code !== 0) {
    return reproductionFailure(claim, 'trusted_receipt_binding_invalid', claim.receipt_id);
  }
  const startedAt = Date.parse(receipt.started_at || '');
  const completedAt = Date.parse(receipt.completed_at || '');
  if (Number.isNaN(startedAt) || Number.isNaN(completedAt) || completedAt < startedAt) {
    return reproductionFailure(claim, 'trusted_receipt_time_invalid', claim.receipt_id);
  }
  if (receipt.integrity_sha256 !== reproductionReceiptIntegrity(receipt)) {
    return reproductionFailure(claim, 'trusted_receipt_integrity_invalid', claim.receipt_id);
  }
  const sourceTrace = verifyEvidenceRef(receipt.source_trace_ref, opts);
  if (!sourceTrace.verified || sourceTrace.line_sha256 !== receipt.source_trace_line_sha256) {
    return reproductionFailure(claim, 'trusted_receipt_source_trace_invalid', claim.receipt_id);
  }
  const result = verifyEvidenceRef(receipt.result_ref, opts);
  if (!result.verified || result.line_sha256 !== receipt.result_line_sha256) {
    return reproductionFailure(claim, 'trusted_receipt_result_invalid', claim.receipt_id);
  }
  return {
    verified: true,
    reason: 'trusted_execution_receipt_verified',
    receipt_id: receipt.receipt_id,
    claim,
    receipt: {
      schema: receipt.schema,
      receipt_id: receipt.receipt_id,
      issuer: receipt.issuer,
      execution_id: receipt.execution_id,
      task_id: receipt.task_id,
      suggestion_id: receipt.suggestion_id,
      source_role: receipt.source_role,
      evidence_binding_sha256: receipt.evidence_binding_sha256,
      command_sha256: receipt.command_sha256,
      status: receipt.status,
      exit_code: Number(receipt.exit_code),
      started_at: receipt.started_at,
      completed_at: receipt.completed_at,
      source_trace_ref: receipt.source_trace_ref,
      result_ref: receipt.result_ref,
      result_line_sha256: receipt.result_line_sha256,
      integrity_sha256: receipt.integrity_sha256,
    },
  };
}

function evidenceRank(level) {
  const index = EVIDENCE_LEVELS.indexOf(level);
  return index === -1 ? 0 : index;
}

function evidenceBindingFor(rows) {
  const entries = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const ref of row && row.evidence && row.evidence.verified || []) {
      const entry = `${ref.ref}:${ref.line_sha256}`;
      if (!seen.has(entry)) {
        seen.add(entry);
        entries.push(entry);
      }
    }
  }
  entries.sort();
  return sha256(JSON.stringify(entries));
}

function approvedSuggestionRecord(record, opts = {}) {
  if (!record || record.schema !== SUGGESTION_APPROVAL_SCHEMA
    || record.status !== 'approved'
    || record.ownerApproved !== true
    || record.approvedBy !== '主人'
    || Number.isNaN(Date.parse(record.approvedAt || ''))
    || record.task_id !== opts.taskId
    || record.suggestion_id !== opts.suggestionId
    || record.evidence_binding_sha256 !== opts.evidenceBinding
    || record.promotion_rule !== 'MERGE-R5-OWNER-APPROVED-EVIDENCE') return false;
  const decision = verifyEvidenceRef(record.decision_ref, opts);
  return decision.verified === true;
}

function suggestionApprovalFor(opts, suggestionId, evidenceBinding) {
  const approvals = Array.isArray(opts.suggestionApprovals) ? opts.suggestionApprovals : [];
  const record = approvals.find(row => row && row.suggestion_id === suggestionId) || null;
  return approvedSuggestionRecord(record, {
    taskId: opts.taskId,
    suggestionId,
    evidenceBinding,
    workspaceRoot: opts.workspaceRoot,
  }) ? record : null;
}

function recordEvidence(record, opts) {
  const refs = (record.evidence_refs || []).map(ref => verifyEvidenceRef(ref, opts));
  const verified = refs.filter(ref => ref.verified);
  let level = 'none';
  if (refs.length) level = verified.length ? 'trace' : 'claim';
  return {
    refs,
    verified,
    level,
    reproduction: reproductionFailure(record.reproduction, 'trusted_receipt_not_evaluated'),
  };
}

function proposalRows(opinions, opts) {
  const rows = [];
  for (const opinion of opinions || []) {
    if (!opinion || opinion.absent) continue;
    const records = Array.isArray(opinion.proposal_records)
      ? opinion.proposal_records
      : [
        ...normalizeProposalRecords(opinion.issues || [], 'issue'),
        ...normalizeProposalRecords(opinion.suggestions || [], 'suggestion'),
      ];
    for (const record of records) {
      const proposerRole = cleanText(opinion.proposer_role || opinion.role || opinion.director || 'unknown', 120);
      const canonical = canonicalRole(proposerRole, record.canonical_role || opinion.canonical_role);
      const sourceTask = cleanText(opinion.source_task || opts.taskId || '', 240) || null;
      const sourceTrace = cleanText(opinion.source_trace || '', 800) || null;
      const sourceRunner = cleanText(opinion.source_runner || opinion.model || '', 240) || null;
      const reasoningSource = record.reasoning_source_id || cleanText(opinion.reasoning_source_id || '', 240)
        || sha256([canonical, sourceTask, sourceTrace, sourceRunner].join('\n'));
      const evidence = recordEvidence(record, opts);
      const normalizedText = record.text.toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${record.kind}:${record.claim_key || `text-${sha256(normalizedText)}`}:${record.stance}`;
      rows.push({
        key,
        record,
        proposer_role: proposerRole,
        canonical_role: canonical,
        source_task: sourceTask,
        source_trace: sourceTrace,
        source_runner: sourceRunner,
        reasoning_source_id: reasoningSource,
        is_fallback_duplicate: record.is_fallback_duplicate || opinion.is_fallback_duplicate === true,
        transport_fallback_used: opinion.transport_fallback_used === true,
        evidence,
      });
    }
  }
  return rows;
}

function consensusFor(rows) {
  const seenRoles = new Set();
  const seenReasoning = new Set();
  const ledger = [];
  for (const row of rows) {
    let exclusion = null;
    if (row.is_fallback_duplicate) exclusion = 'fallback_duplicate';
    else if (seenRoles.has(row.canonical_role)) exclusion = 'role_alias_or_duplicate';
    else if (seenReasoning.has(row.reasoning_source_id)) exclusion = 'shared_reasoning_source';
    if (!exclusion) {
      seenRoles.add(row.canonical_role);
      seenReasoning.add(row.reasoning_source_id);
    }
    ledger.push({
      proposer_role: row.proposer_role,
      canonical_role: row.canonical_role,
      reasoning_source_id: row.reasoning_source_id,
      counted: !exclusion,
      exclusion_reason: exclusion,
    });
  }
  return {
    count: ledger.filter(row => row.counted).length,
    roles: ledger.filter(row => row.counted).map(row => row.canonical_role),
    ledger,
  };
}

function classifyMerged(rows, consensus, opts) {
  const redlineRows = rows.filter(row => row.record.redline_type);
  const redlineTypes = [...new Set(redlineRows.map(row => row.record.redline_type))];
  const reproducibleRedlineRows = redlineRows.filter(row => row.evidence.level === 'reproducible');
  const redlineEvidence = redlineRows.reduce((best, row) => evidenceRank(row.evidence.level) > evidenceRank(best)
    ? row.evidence.level : best, 'none');
  const bestEvidence = rows.reduce((best, row) => evidenceRank(row.evidence.level) > evidenceRank(best)
    ? row.evidence.level : best, 'none');
  const hasReproducible = bestEvidence === 'reproducible' || bestEvidence === 'owner_approved';
  const suggestionApproval = suggestionApprovalFor(opts, opts.suggestionId, opts.evidenceBinding);
  if (reproducibleRedlineRows.length) {
    return {
      evidence_level: 'reproducible',
      classification: 'hard_block',
      promotion_rule: 'MERGE-R4-REPRODUCIBLE-REDLINE',
      promotion_reason: '可复现红线绑定可解析证据，不受人数门槛限制。',
      owner_approval: null,
    };
  }
  if (redlineTypes.length) {
    return {
      evidence_level: redlineEvidence,
      classification: 'owner_decision',
      promotion_rule: 'MERGE-R3-UNVERIFIED-REDLINE-ARBITRATION',
      promotion_reason: '红线来源自身缺少可复现证据，仅升级人工仲裁，不得借用同组非红线证据改写硬验收。',
      owner_approval: null,
    };
  }
  if (suggestionApproval && hasReproducible) {
    return {
      evidence_level: 'owner_approved',
      classification: 'acceptance',
      promotion_rule: 'MERGE-R5-OWNER-APPROVED-EVIDENCE',
      promotion_reason: '主人对当前 task/suggestion/evidence hash 的批准合同与可复现证据同时成立。',
      owner_approval: {
        schema: suggestionApproval.schema,
        decision_ref: suggestionApproval.decision_ref,
        approved_at: suggestionApproval.approvedAt,
        evidence_binding_sha256: suggestionApproval.evidence_binding_sha256,
      },
    };
  }
  if (hasReproducible && consensus.count >= 2) {
    return {
      evidence_level: 'reproducible',
      classification: 'acceptance',
      promotion_rule: 'MERGE-R2-INDEPENDENT-EVIDENCED-CONSENSUS',
      promotion_reason: '至少两项独立角色共识且存在可复现证据；共识仅作辅助。',
      owner_approval: null,
    };
  }
  if (hasReproducible) {
    return {
      evidence_level: 'reproducible',
      classification: 'owner_decision',
      promotion_rule: 'MERGE-R6-SINGLE-EVIDENCED-NON-REDLINE',
      promotion_reason: '单一角色虽有可复现证据，但不属于红线，等待主人拍板。',
      owner_approval: null,
    };
  }
  return {
    evidence_level: bestEvidence,
    classification: 'experiment',
    promotion_rule: bestEvidence === 'none' || bestEvidence === 'claim'
      ? 'MERGE-R1-NO-PARSEABLE-EVIDENCE'
      : 'MERGE-R1-NONREPRODUCIBLE-EVIDENCE',
    promotion_reason: consensus.count <= 1
      ? '单一角色提议且无可复现证据，只能保留为 experiment/待拍板。'
      : '共识本身不能升格；缺少可复现证据，仍保留为 experiment。',
    owner_approval: null,
  };
}

function buildMergeContract(opinions, opts = {}) {
  const rows = proposalRows(opinions, opts);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.key)) grouped.set(row.key, []);
    grouped.get(row.key).push(row);
  }
  const items = [];
  for (const [key, group] of grouped.entries()) {
    const suggestionId = `sug_${sha256(key).slice(0, 20)}`;
    const evidenceBinding = evidenceBindingFor(group);
    for (const row of group) {
      row.evidence.reproduction = verifyReproductionReceipt(row, Object.assign({}, opts, {
        suggestionId,
        evidenceBinding: evidenceBindingFor([row]),
      }));
      if (row.evidence.reproduction.verified) row.evidence.level = 'reproducible';
    }
    const consensus = consensusFor(group);
    const classification = classifyMerged(group, consensus, Object.assign({}, opts, {
      suggestionId,
      evidenceBinding,
    }));
    const evidenceRefs = [];
    const evidenceKeys = new Set();
    for (const row of group) {
      for (const ref of row.evidence.refs) {
        const evidenceKey = `${ref.ref}:${ref.verified}:${ref.reason || ''}`;
        if (!evidenceKeys.has(evidenceKey)) {
          evidenceKeys.add(evidenceKey);
          evidenceRefs.push(ref);
        }
      }
    }
    const sources = group.map(row => ({
      proposer_role: row.proposer_role,
      canonical_role: row.canonical_role,
      source_task: row.source_task,
      source_trace: row.source_trace,
      source_runner: row.source_runner,
      reasoning_source_id: row.reasoning_source_id,
      transport_fallback_used: row.transport_fallback_used,
      text: row.record.text,
      stance: row.record.stance,
      redline_type: row.record.redline_type,
      requested_classification: row.record.requested_classification,
      reproduction_claim: row.record.reproduction,
      reproduction_verification: {
        verified: row.evidence.reproduction.verified,
        reason: row.evidence.reproduction.reason,
        receipt_id: row.evidence.reproduction.receipt_id,
      },
      reproduction_receipt: row.evidence.reproduction.receipt,
    }));
    items.push({
      suggestion_id: suggestionId,
      kind: group[0].record.kind,
      text: group[0].record.text,
      claim_key: group[0].record.claim_key,
      stance: group[0].record.stance,
      proposer_role: group[0].proposer_role,
      proposer_roles: [...new Set(group.map(row => row.proposer_role))],
      source_task: group[0].source_task,
      source_trace: group[0].source_trace,
      sources,
      evidence_refs: evidenceRefs,
      evidence_binding_sha256: evidenceBinding,
      evidence_level: classification.evidence_level,
      independent_consensus_roles: consensus.roles,
      independent_consensus_count: consensus.count,
      consensus_ledger: consensus.ledger,
      redline_types: [...new Set(group.map(row => row.record.redline_type).filter(Boolean))],
      classification: classification.classification,
      promotion_rule: classification.promotion_rule,
      promotion_reason: classification.promotion_reason,
      owner_approval: classification.owner_approval,
    });
  }
  items.sort((a, b) => a.suggestion_id.localeCompare(b.suggestion_id));
  return {
    schema: CONTRACT_SCHEMA,
    task_id: opts.taskId || null,
    round: Number(opts.round) || 1,
    mode: opts.active === true ? 'active_owner_approved' : 'shadow_only',
    generated_at: new Date().toISOString(),
    policy: {
      consensus_is_auxiliary: true,
      fallback_alias_shared_reasoning_excluded: true,
      redline_bypass_requires_reproducible_evidence: true,
      model_reproduction_claim_is_not_execution_evidence: true,
      reproducible_requires_trusted_execution_receipt: true,
      unverified_redline_routes_to_owner_decision: true,
      no_evidence_defaults_to_experiment: true,
    },
    item_count: items.length,
    items,
  };
}

function artifactPath(opts = {}) {
  const root = path.resolve(opts.artifactsRoot || path.join(__dirname, 'artifacts'));
  return path.join(root, 'board-opinion-merge', safeId(opts.taskId), `round-${Number(opts.round) || 1}.json`);
}

function writeMergeContract(contract, opts = {}) {
  const file = artifactPath(opts);
  writeJsonAtomic(file, contract);
  return file;
}

function renderActiveRevision(base, contract, round) {
  const safeContract = {
    schema: contract.schema,
    task_id: contract.task_id,
    round: contract.round,
    mode: contract.mode,
    items: contract.items,
  };
  return [
    String(base || '').trim(),
    '',
    `董事会第 ${Number(round) || 1} 轮结构化整合合同（主人批准后 active）:`,
    '```json',
    JSON.stringify(safeContract),
    '```',
  ].filter(Boolean).join('\n');
}

module.exports = {
  CONTRACT_SCHEMA,
  APPROVAL_SCHEMA,
  SUGGESTION_APPROVAL_SCHEMA,
  REPRODUCTION_RECEIPT_SCHEMA,
  REPRODUCTION_RECEIPT_ISSUER,
  DEFAULT_APPROVAL_FILE,
  FEATURE_FLAG,
  FEATURE_SCOPE,
  EVIDENCE_LEVELS,
  REDLINE_TYPES,
  activationState,
  approvedRecord,
  approvedSuggestionRecord,
  canonicalRole,
  normalizeProposalRecords,
  verifyEvidenceRef,
  reproductionCommandHash,
  reproductionReceiptIntegrity,
  verifyReproductionReceipt,
  evidenceBindingFor,
  consensusFor,
  buildMergeContract,
  artifactPath,
  writeMergeContract,
  renderActiveRevision,
};
