'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AcceptanceContract = require('../../shared/engine/acceptance-contract');
const InteractionTrace = require('../../shared/engine/interaction-trace');
const Queue = require('../../shared/engine/queue');

const CONFIG_SCHEMA = 'acceptance-handoff-config@2';
const REVIEW_SCHEMA = 'acceptance-handoff-review@1';
const ACTIVATION_EVIDENCE_SCHEMA = 'acceptance-handoff-activation-evidence@1';
const OWNER_APPROVAL_SCHEMA = 'acceptance-handoff-owner-approval@1';
const FEATURE_ID = 'orchestrator-acceptance-handoff';
const PROJECT_ID = '控制台';
const OWNER_APPROVAL_PUBLIC_KEY_ENV = 'YUTU6_DIRECT_COMPLETION_OVERRIDE_PUBLIC_KEY_B64';
const DEFAULT_CONFIG_REL = 'projects/控制台/config/acceptance-handoff.json';
const CAPABILITY_EVIDENCE_PATHS = Object.freeze({
  orchestratorContract: 'projects/控制台/engine-runner.js',
  supervisorContract: 'projects/控制台/acceptance-handoff.js',
  doneGateContract: 'shared/engine/done-gate.js',
});
const OWNER_APPROVAL_SIGNED_FIELDS = Object.freeze([
  'schema',
  'receipt_id',
  'feature',
  'project_id',
  'task_id',
  'spec_fingerprint',
  'approved',
  'actor',
  'source',
  'verification',
  'signature_algorithm',
  'authority_id',
  'decision_card_id',
  'approved_at',
  'rollback_plan',
  'decision_action_path',
]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 160) || 'unknown';
}

function defaultConfig() {
  return {
    schema: CONFIG_SCHEMA,
    enabled: false,
    textDiagnostic: false,
    timeoutMs: 100,
    maxRetries: 3,
    exceptionMode: 'manual_review',
    timeoutMode: 'manual_review',
    feature: FEATURE_ID,
    projectId: PROJECT_ID,
    activationTaskId: null,
    activationSpecFingerprint: null,
    prerequisites: {
      orchestratorContract: false,
      supervisorContract: false,
      doneGateContract: false,
      regressionValidated: false,
      performanceValidated: false,
      architectureReviewPassed: false,
      ownerApproved: false,
    },
    prerequisiteEvidence: {},
  };
}

function loadConfig(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const configured = opts.configPath || process.env.ACCEPTANCE_HANDOFF_CONFIG;
  const file = configured
    ? (path.isAbsolute(configured) ? configured : path.join(workspaceRoot, configured))
    : path.join(workspaceRoot, DEFAULT_CONFIG_REL);
  const parsed = readJson(file);
  const base = defaultConfig();
  const config = parsed && typeof parsed === 'object'
    ? Object.assign({}, base, parsed, {
      prerequisites: Object.assign({}, base.prerequisites, parsed.prerequisites || {}),
      prerequisiteEvidence: Object.assign({}, base.prerequisiteEvidence, parsed.prerequisiteEvidence || {}),
    })
    : base;
  return { config, file };
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRelativeEvidenceFile(evidence, opts = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { ok: false, reason: 'evidence_missing' };
  }
  const rel = String(evidence.path || '').trim();
  const expectedHash = String(evidence.sha256 || '').trim().toLowerCase();
  const verdict = String(evidence.verdict || '').trim().toLowerCase();
  if (!rel || path.isAbsolute(rel) || /(^|\/)\.\.(\/|$)/.test(rel)) {
    return { ok: false, reason: 'evidence_path_invalid' };
  }
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return { ok: false, reason: 'evidence_hash_invalid' };
  if (!['pass', 'approved'].includes(verdict)) return { ok: false, reason: 'evidence_verdict_invalid' };
  const workspaceRoot = path.resolve(opts.workspaceRoot || process.cwd());
  const file = path.resolve(workspaceRoot, rel);
  if (file !== workspaceRoot && !file.startsWith(`${workspaceRoot}${path.sep}`)) {
    return { ok: false, reason: 'evidence_outside_workspace' };
  }
  try {
    if (!fs.statSync(file).isFile()) return { ok: false, reason: 'evidence_not_file' };
    const actualHash = fileSha256(file);
    return actualHash === expectedHash
      ? { ok: true, path: rel, file, sha256: actualHash, evidence }
      : { ok: false, reason: 'evidence_hash_mismatch', path: rel, expected: expectedHash, actual: actualHash };
  } catch (_) {
    return { ok: false, reason: 'evidence_unreadable', path: rel };
  }
}

function activationBinding(opts = {}) {
  const config = opts.activationConfig || {};
  return {
    taskId: String(config.activationTaskId || '').trim(),
    specFingerprint: String(config.activationSpecFingerprint || '').trim().toLowerCase(),
  };
}

function verifyCapabilityEvidence(key, base) {
  const expectedPath = CAPABILITY_EVIDENCE_PATHS[key];
  if (!expectedPath) return { ok: false, reason: 'capability_evidence_key_invalid' };
  if (base.evidence.kind !== 'runtime_capability'
    || base.evidence.subject !== key
    || base.path !== expectedPath
    || String(base.evidence.verdict || '').toLowerCase() !== 'pass') {
    return { ok: false, reason: 'capability_evidence_contract_invalid' };
  }
  return { ok: true, path: base.path, sha256: base.sha256, kind: base.evidence.kind };
}

function verifyTestReportEvidence(key, base, opts = {}) {
  if (base.evidence.kind !== 'test_report'
    || !/^projects\/控制台\/artifacts\/acceptance-handoff-[^/]+\/activation-evidence\.json$/.test(base.path)) {
    return { ok: false, reason: 'test_evidence_contract_invalid' };
  }
  const report = readJson(base.file);
  const binding = activationBinding(opts);
  const claim = report && report.claims && report.claims[key];
  if (!report
    || report.schema !== ACTIVATION_EVIDENCE_SCHEMA
    || report.feature !== FEATURE_ID
    || report.project_id !== PROJECT_ID
    || report.task_id !== binding.taskId
    || report.spec_fingerprint !== binding.specFingerprint
    || !claim
    || claim.passed !== true
    || !Array.isArray(claim.commands)
    || !claim.commands.length
    || claim.commands.some(command => !command || command.exit_code !== 0 || !String(command.command || '').trim())) {
    return { ok: false, reason: 'test_evidence_result_invalid' };
  }
  return { ok: true, path: base.path, sha256: base.sha256, kind: base.evidence.kind };
}

function extractFencedJson(text) {
  const source = String(text || '');
  const blocks = Array.from(source.matchAll(/```json\s*([\s\S]*?)```/gi));
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(blocks[index][1]); } catch (_) {}
  }
  return null;
}

function verifyIndependentReviewEvidence(base, opts = {}) {
  if (base.evidence.kind !== 'independent_review'
    || !/^projects\/控制台\/artifacts\/engine-runs\/[^/]+\/review-\d+\/result\.redacted\.md$/.test(base.path)) {
    return { ok: false, reason: 'architecture_review_evidence_contract_invalid' };
  }
  const binding = activationBinding(opts);
  const traceFile = path.join(path.dirname(base.file), 'interaction-trace.json');
  const trace = readJson(traceFile);
  const result = extractFencedJson(fs.readFileSync(base.file, 'utf8'));
  const review = result && result.review;
  const verdict = String(review && review.verification && review.verification.verdict || '').toLowerCase();
  const designPath = String(base.evidence.design_path || '').trim();
  const designHash = String(base.evidence.design_sha256 || '').trim().toLowerCase();
  const checked = review && review.verification && review.verification.checked;
  let actualDesignHash = null;
  try {
    if (!/^projects\/控制台\/artifacts\/architecture\/[^/]+\.md$/.test(designPath)) {
      return { ok: false, reason: 'architecture_review_design_path_invalid' };
    }
    actualDesignHash = fileSha256(path.resolve(opts.workspaceRoot || process.cwd(), designPath));
  } catch (_) {
    return { ok: false, reason: 'architecture_review_design_unreadable' };
  }
  if (!trace
    || trace.schema !== 'yutu6-interaction-trace@1'
    || trace.task_id !== binding.taskId
    || trace.spec_fingerprint !== binding.specFingerprint
    || trace.project_id !== PROJECT_ID
    || trace.node_id !== 'review'
    || trace.agent_role !== 'supervisor'
    || trace.agent_id !== 'supervisor'
    || trace.status !== 'completed'
    || !trace.integrity_check
    || trace.integrity_check.complete !== true
    || trace.observability_status !== 'ok'
    || !trace.output
    || trace.output.redacted_path !== base.path
    || trace.output.sha256 !== base.sha256
    || !review
    || review.pass !== true
    || !['true', 'pass'].includes(verdict)
    || !Array.isArray(checked)
    || !checked.includes(designPath)
    || !/^[a-f0-9]{64}$/.test(designHash)
    || actualDesignHash !== designHash) {
    return { ok: false, reason: 'architecture_review_result_invalid' };
  }
  return { ok: true, path: base.path, sha256: base.sha256, kind: base.evidence.kind };
}

function ownerApprovalSigningPayload(receipt) {
  const signed = {};
  for (const field of OWNER_APPROVAL_SIGNED_FIELDS) {
    signed[field] = receipt && receipt[field] != null ? receipt[field] : null;
  }
  return Buffer.from(JSON.stringify(signed), 'utf8');
}

function ownerApprovalPublicKey(value) {
  if (!value) return null;
  try {
    return value && value.type === 'public'
      ? value
      : crypto.createPublicKey({ key: Buffer.from(String(value), 'base64'), format: 'der', type: 'spki' });
  } catch (_) {
    return null;
  }
}

function verifyOwnerApprovalEvidence(base, opts = {}) {
  if (base.evidence.kind !== 'signed_owner_approval'
    || !/^projects\/控制台\/artifacts\/acceptance-handoff-owner-approvals\/[^/]+\.json$/.test(base.path)) {
    return { ok: false, reason: 'owner_approval_evidence_contract_invalid' };
  }
  const receipt = readJson(base.file);
  const binding = activationBinding(opts);
  const publicKey = ownerApprovalPublicKey(opts.ownerApprovalPublicKey || process.env[OWNER_APPROVAL_PUBLIC_KEY_ENV]);
  if (!receipt
    || receipt.schema !== OWNER_APPROVAL_SCHEMA
    || receipt.receipt_id !== base.evidence.receipt_id
    || receipt.feature !== FEATURE_ID
    || receipt.project_id !== PROJECT_ID
    || receipt.task_id !== binding.taskId
    || receipt.spec_fingerprint !== binding.specFingerprint
    || receipt.approved !== true
    || receipt.actor !== 'owner'
    || receipt.source !== 'owner_decision'
    || receipt.verification !== 'hmac-owner-action+ed25519-server-receipt'
    || receipt.signature_algorithm !== 'ed25519'
    || !String(receipt.authority_id || '').trim()
    || !String(receipt.decision_card_id || '').trim()
    || !Number.isFinite(Date.parse(receipt.approved_at || ''))
    || !String(receipt.rollback_plan || '').trim()
    || receipt.decision_action_path !== 'projects/控制台/artifacts/bulletin/decision-actions.json'
    || !String(receipt.signature || '').trim()
    || !publicKey) {
    return { ok: false, reason: 'owner_approval_receipt_invalid' };
  }
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const authorityId = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 24);
  if (receipt.authority_id !== authorityId) return { ok: false, reason: 'owner_approval_authority_mismatch' };
  let signatureOk = false;
  try {
    signatureOk = crypto.verify(null, ownerApprovalSigningPayload(receipt), publicKey, Buffer.from(receipt.signature, 'base64url'));
  } catch (_) {}
  if (!signatureOk) return { ok: false, reason: 'owner_approval_signature_invalid' };
  const actionFile = path.resolve(opts.workspaceRoot || process.cwd(), receipt.decision_action_path);
  const actions = readJson(actionFile);
  const action = actions && typeof actions === 'object' && !Array.isArray(actions)
    ? actions[receipt.decision_card_id]
    : null;
  if (!action
    || action.action !== 'approve'
    || action.decisionKind !== 'acceptance_handoff_activation'
    || action.via !== 'feishu-card'
    || action.verification !== 'hmac-sha256-decision-card'
    || action.receiptId !== receipt.receipt_id
    || action.at !== receipt.approved_at
    || action.receiptAuthorityId !== receipt.authority_id
    || action.receiptSignature !== receipt.signature) {
    return { ok: false, reason: 'owner_approval_action_missing' };
  }
  return { ok: true, path: base.path, sha256: base.sha256, kind: base.evidence.kind };
}

function verifyPrerequisiteEvidence(key, evidence, opts = {}) {
  if (typeof opts.evidenceVerifier === 'function') return opts.evidenceVerifier(key, evidence, opts);
  const base = safeRelativeEvidenceFile(evidence, opts);
  if (!base.ok) return base;
  if (Object.prototype.hasOwnProperty.call(CAPABILITY_EVIDENCE_PATHS, key)) {
    return verifyCapabilityEvidence(key, base);
  }
  if (key === 'regressionValidated' || key === 'performanceValidated') {
    return verifyTestReportEvidence(key, base, opts);
  }
  if (key === 'architectureReviewPassed') return verifyIndependentReviewEvidence(base, opts);
  if (key === 'ownerApproved') return verifyOwnerApprovalEvidence(base, opts);
  return { ok: false, reason: 'evidence_key_unsupported' };
}

function activationDecision(configValue, opts = {}) {
  const config = Object.assign(defaultConfig(), configValue || {});
  config.prerequisites = Object.assign({}, defaultConfig().prerequisites, configValue && configValue.prerequisites || {});
  config.prerequisiteEvidence = Object.assign({}, configValue && configValue.prerequisiteEvidence || {});
  if (config.enabled !== true) return { active: false, blocked: false, reason: 'feature_disabled', missing: [] };
  if (config.schema !== CONFIG_SCHEMA) {
    return { active: false, blocked: true, reason: 'activation_config_invalid', missing: ['configSchema'] };
  }
  if (config.feature !== FEATURE_ID
    || config.projectId !== PROJECT_ID
    || !String(config.activationTaskId || '').trim()
    || !/^[a-f0-9]{64}$/.test(String(config.activationSpecFingerprint || '').toLowerCase())) {
    return { active: false, blocked: true, reason: 'activation_config_invalid', missing: ['activationBinding'] };
  }
  const missing = Object.entries(config.prerequisites).filter(([, value]) => value !== true).map(([key]) => key);
  if (missing.length) return { active: false, blocked: true, reason: 'activation_prerequisites_missing', missing };
  const invalidEvidence = Object.keys(config.prerequisites).map(key => {
    const result = verifyPrerequisiteEvidence(key, config.prerequisiteEvidence[key], Object.assign({}, opts, {
      activationConfig: config,
    }));
    return result && result.ok ? null : { key, reason: result && result.reason || 'evidence_invalid' };
  }).filter(Boolean);
  if (invalidEvidence.length) {
    return {
      active: false,
      blocked: true,
      reason: 'activation_evidence_invalid',
      missing: invalidEvidence.map(item => item.key),
      invalidEvidence,
    };
  }
  return { active: true, blocked: false, reason: null, missing: [], invalidEvidence: [] };
}

function systemRecord(point, opts = {}) {
  const sourceRef = opts.sourceRef;
  return AcceptanceContract.createRecord({
    text: point,
    point,
    scope: opts.scope,
    source_ref: sourceRef,
    source_kind: 'system',
    task_status: opts.taskStatus || null,
    task_evidence: opts.taskEvidence || null,
    task_notes: opts.taskNotes || null,
  }, { pointPrefix: '' });
}

function buildDownstreamContract(upstreamValue, opts = {}) {
  const upstream = AcceptanceContract.normalizeContract(upstreamValue);
  const scope = opts.scope || `project/${opts.projectId || upstream.project_id || 'unknown'}`;
  // Cross-scope acceptance records remain in the immutable orchestrator
  // contract so validateHandoff can emit an audit warning, but they must not
  // become this supervisor's requiredRows.  Carrying them into the downstream
  // contract would turn the intended warning-only isolation into a done-gate
  // requirement for the wrong project.
  const scopedRecords = upstream.records.filter(record => record.scope === scope);
  if (!scopedRecords.length) {
    throw new Error(`acceptance contract has no records for supervisor scope ${scope}`);
  }
  const scopedUpstream = AcceptanceContract.createContract(scopedRecords, {
    stage: 'supervisor-scope',
    projectId: opts.projectId || upstream.project_id,
    rootTaskId: opts.rootTaskId || upstream.root_task_id,
    pointPrefix: '',
  });
  const extras = [];
  if (opts.deliveryPoint) {
    extras.push(systemRecord(opts.deliveryPoint, {
      scope,
      sourceRef: 'system:delivery',
      taskStatus: '未完成',
    }));
  }
  if (opts.visualPoint) {
    extras.push(systemRecord(opts.visualPoint, {
      scope,
      sourceRef: 'system:visual',
      taskStatus: opts.visualRequired === true ? '未完成' : 'not_applicable',
      taskEvidence: opts.visualRequired === true ? null : 'task-envelope:visual_acceptance',
      taskNotes: opts.visualRequired === true
        ? null
        : `source=${opts.visualSource || 'task_type'}; ${opts.visualReason || 'no positive visual requirement'}`,
    }));
  }
  return AcceptanceContract.extendContract(scopedUpstream, extras, {
    stage: 'supervisor-requiredRows',
    projectId: opts.projectId || upstream.project_id,
    rootTaskId: opts.rootTaskId || upstream.root_task_id,
  });
}

function markdownCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function renderStructuredAcceptanceTable(contractValue, opts = {}) {
  const contract = AcceptanceContract.normalizeContract(contractValue);
  const rows = AcceptanceContract.acceptanceRows(contract);
  const templateRef = opts.templateRef || 'templates/structured-acceptance-table.md';
  return [
    '结构化验收表(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)',
    '验收表协议: structured-acceptance@2',
    `模板: ${templateRef}`,
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
    '|---|---|---|---|',
    ...rows.map(row => `| ${markdownCell(row.point)} | ${markdownCell(row.status || '未完成')} | ${markdownCell(row.evidence || '')} | ${markdownCell(row.notes || '')} |`),
  ].join('\n');
}

function reviewArtifactPath(opts = {}) {
  const artifactsRoot = opts.artifactsRoot || path.join(opts.workspaceRoot || process.cwd(), 'projects/控制台/artifacts');
  return path.join(artifactsRoot, 'acceptance-handoff', `${safeName(opts.taskId)}.json`);
}

function emit(eventlog, type, detail) {
  if (!eventlog || typeof eventlog.emit !== 'function') return;
  try { eventlog.emit(type, detail); } catch (_) {}
}

function redactAuditValue(value) {
  try { return JSON.parse(InteractionTrace.redact(JSON.stringify(value))); } catch (_) { return { redacted: true }; }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tempFile, file);
}

function normalizedContractOrNull(value) {
  try { return AcceptanceContract.normalizeContract(value); } catch (_) { return null; }
}

function contractDigest(value) {
  const contract = AcceptanceContract.normalizeContract(value);
  return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

function safeContractSnapshot(value) {
  if (!value) return null;
  const snapshot = redactAuditValue(value);
  return normalizedContractOrNull(snapshot);
}

function persistReview(validation, opts = {}) {
  const file = reviewArtifactPath(opts);
  const previous = readJson(file);
  const retryCount = Math.max(
    0,
    Number(opts.retryCount || 0),
    Number(previous && previous.retry_count || 0),
  );
  const maxRetries = Math.max(0, Number(opts.maxRetries || previous && previous.max_retries || 3));
  const exhausted = retryCount >= maxRetries;
  const recordedAt = new Date().toISOString();
  const attempt = {
    attempt_kind: 'enqueue_validation',
    recorded_at: recordedAt,
    retry_count: retryCount,
    validation: redactAuditValue(validation),
  };
  const previousAttempts = previous && Array.isArray(previous.attempts) ? previous.attempts : [];
  const suppliedUpstreamSnapshot = safeContractSnapshot(opts.upstreamContract);
  const upstreamSnapshot = previous && safeContractSnapshot(previous.upstream_contract)
    || suppliedUpstreamSnapshot;
  const downstreamSnapshot = safeContractSnapshot(opts.downstreamContract);
  const upstreamDigest = upstreamSnapshot ? contractDigest(upstreamSnapshot) : null;
  const suppliedUpstreamDigest = suppliedUpstreamSnapshot ? contractDigest(suppliedUpstreamSnapshot) : null;
  const upstreamBindingMismatch = !!(previous && previous.upstream_contract_sha256
    && suppliedUpstreamDigest
    && suppliedUpstreamDigest !== previous.upstream_contract_sha256);
  const review = {
    schema: REVIEW_SCHEMA,
    task_id: opts.taskId || null,
    project_id: opts.projectId || null,
    scope: opts.scope || null,
    queue_agent: opts.queueAgent || previous && previous.queue_agent || null,
    queue_id: opts.queueId || previous && previous.queue_id || null,
    state: exhausted ? 'awaiting_human_review_retry_exhausted' : 'awaiting_human_review',
    recoverable: true,
    retry_count: retryCount,
    max_retries: maxRetries,
    next_action: exhausted ? 'owner_review_required' : 'correct_contract_then_retry',
    created_at: previous && previous.created_at || recordedAt,
    updated_at: recordedAt,
    validation: attempt.validation,
    attempts: previousAttempts.concat(attempt).slice(-(maxRetries + 1)),
    upstream_contract_id: upstreamSnapshot && upstreamSnapshot.contract_id || null,
    upstream_contract_sha256: upstreamDigest,
    rejected_downstream_contract_id: downstreamSnapshot && downstreamSnapshot.contract_id || null,
    upstream_contract: upstreamSnapshot,
    rejected_downstream_contract: downstreamSnapshot,
    upstream_binding_mismatch: upstreamBindingMismatch,
    contract_snapshot_redacted_or_invalid: !!((opts.upstreamContract && !suppliedUpstreamSnapshot)
      || (opts.downstreamContract && !downstreamSnapshot)),
  };
  atomicWriteJson(file, review);
  return { file, review };
}

function reviewUpstreamContract(review) {
  try {
    const upstream = AcceptanceContract.normalizeContract(review && review.upstream_contract);
    const digest = contractDigest(upstream);
    if (!review.upstream_contract_id
      || upstream.contract_id !== review.upstream_contract_id
      || (review.upstream_contract_sha256 && digest !== review.upstream_contract_sha256)) {
      return { ok: false, reason: 'review_upstream_contract_invalid' };
    }
    return { ok: true, contract: upstream, digest };
  } catch (_) {
    return { ok: false, reason: 'review_upstream_contract_invalid' };
  }
}

function recordRecoveryFailure(review, reviewFile, reason, validation, opts = {}) {
  const retryCount = Math.max(0, Number(review.retry_count || 0)) + 1;
  const maxRetries = Math.max(0, Number(review.max_retries || 3));
  const exhausted = retryCount >= maxRetries;
  const recordedAt = new Date().toISOString();
  const attempt = {
    attempt_kind: 'manual_correction',
    recorded_at: recordedAt,
    retry_count: retryCount,
    outcome: reason,
    validation: redactAuditValue(validation || { ok: false, reason }),
  };
  const updated = Object.assign({}, review, {
    state: exhausted ? 'awaiting_human_review_retry_exhausted' : 'awaiting_human_review',
    retry_count: retryCount,
    next_action: exhausted ? 'owner_review_required' : 'correct_contract_then_retry',
    updated_at: recordedAt,
    validation: attempt.validation,
    attempts: (Array.isArray(review.attempts) ? review.attempts : []).concat(attempt),
    exhausted_override_used: review.exhausted_override_used === true || opts.exhaustedOverride === true,
  });
  if (reviewFile) atomicWriteJson(reviewFile, updated);
  return { ok: false, reason, validation, review: updated };
}

function evaluateBeforeEnqueue(opts = {}) {
  const loaded = opts.config
    ? { config: opts.config, file: opts.configPath || null }
    : loadConfig(opts);
  const activation = activationDecision(loaded.config, {
    workspaceRoot: opts.workspaceRoot,
    evidenceVerifier: opts.evidenceVerifier,
    ownerApprovalPublicKey: opts.ownerApprovalPublicKey,
  });
  if (!activation.active) {
    if (activation.blocked) {
      emit(opts.eventlog, 'acceptance.handoff.activation_blocked', {
        task: opts.taskId || null,
        projectId: opts.projectId || null,
        missing: activation.missing,
        config: loaded.file,
      });
    }
    return { ok: true, skipped: true, activation, config: loaded.file };
  }

  let validation;
  let validationUpstream = opts.upstreamContract;
  const existingReviewFile = reviewArtifactPath(opts);
  const existingReview = readJson(existingReviewFile);
  if (existingReview
    && existingReview.schema === REVIEW_SCHEMA
    && String(existingReview.task_id || '') === String(opts.taskId || '')) {
    const frozen = reviewUpstreamContract(existingReview);
    let suppliedDigest = null;
    try { suppliedDigest = contractDigest(opts.upstreamContract); } catch (_) {}
    if (!frozen.ok || suppliedDigest !== frozen.digest) {
      validation = {
        ok: false,
        reason: 'upstream_contract_binding_mismatch',
        errors: [{ code: 'upstream_contract_binding_mismatch' }],
        warnings: [],
      };
    } else {
      validationUpstream = frozen.contract;
    }
  }
  try {
    const validator = opts.validator || AcceptanceContract.validateHandoff;
    if (!validation) validation = validator(validationUpstream, opts.downstreamContract, {
      scope: opts.scope,
      timeoutMs: loaded.config.timeoutMs,
      textDiagnostic: loaded.config.textDiagnostic === true,
      clock: opts.clock,
    });
  } catch (error) {
    validation = {
      ok: false,
      reason: 'validator_exception',
      errors: [{ code: 'validator_exception', message: String(error && error.message || error) }],
      warnings: [],
    };
  }
  if (validation.ok) {
    emit(opts.eventlog, 'acceptance.handoff.passed', {
      task: opts.taskId || null,
      projectId: opts.projectId || null,
      upstreamCount: validation.upstream_count,
      downstreamCount: validation.downstream_count,
      elapsedMs: validation.elapsed_ms,
      warnings: redactAuditValue(validation.warnings),
    });
    return { ok: true, skipped: false, validation, activation, config: loaded.file };
  }

  const timeout = validation.reason === 'validation_timeout';
  const mode = timeout ? loaded.config.timeoutMode : loaded.config.exceptionMode;
  // Contract differences and malformed contracts are business rejections and must
  // always fail closed. Only validator infrastructure failure/timeout may follow
  // the explicitly configured fail-open fallback.
  const contractViolation = !['validation_timeout', 'validator_exception'].includes(validation.reason);
  if (!contractViolation && mode === 'fail_open') {
    emit(opts.eventlog, 'acceptance.handoff.fail_open', {
      task: opts.taskId || null,
      projectId: opts.projectId || null,
      reason: validation.reason,
      errors: redactAuditValue(validation.errors),
    });
    return { ok: true, skipped: false, failOpen: true, validation, activation, config: loaded.file };
  }

  const persisted = persistReview(validation, {
    workspaceRoot: opts.workspaceRoot,
    artifactsRoot: opts.artifactsRoot,
    taskId: opts.taskId,
    projectId: opts.projectId,
    retryCount: opts.retryCount,
    maxRetries: loaded.config.maxRetries,
    queueAgent: opts.queueAgent,
    queueId: opts.queueId,
    scope: opts.scope,
    upstreamContract: opts.upstreamContract,
    downstreamContract: opts.downstreamContract,
  });
  const detail = {
    task: opts.taskId || null,
    projectId: opts.projectId || null,
    reason: validation.reason,
    reviewState: persisted.review.state,
    reviewFile: path.relative(opts.workspaceRoot || process.cwd(), persisted.file).split(path.sep).join('/'),
    retryCount: persisted.review.retry_count,
    maxRetries: persisted.review.max_retries,
    errors: redactAuditValue(validation.errors),
    warnings: redactAuditValue(validation.warnings),
  };
  emit(opts.eventlog, 'acceptance.handoff.rejected', detail);
  emit(opts.eventlog, 'acceptance.handoff.alert', Object.assign({}, detail, { severity: 'high', audience: 'owner/admin' }));
  return {
    ok: false,
    paused: true,
    reason: `acceptance_handoff_rejected:${validation.reason}`,
    validation,
    review: persisted.review,
    reviewFile: persisted.file,
    activation,
    config: loaded.file,
  };
}

function recoverManualReview(opts = {}) {
  const review = opts.review || readJson(opts.reviewFile);
  if (!review || review.schema !== REVIEW_SCHEMA || review.recoverable !== true) {
    return { ok: false, reason: 'review_state_invalid' };
  }
  if (!['awaiting_human_review', 'awaiting_human_review_retry_exhausted'].includes(review.state)) {
    return { ok: false, reason: 'review_not_awaiting_confirmation' };
  }
  const confirmation = opts.confirmation || {};
  const exhausted = Math.max(0, Number(review.retry_count || 0)) >= Math.max(0, Number(review.max_retries || 3));
  const normalDecision = confirmation.decision === 'approve_corrected_contract';
  const exhaustedDecision = confirmation.decision === 'approve_corrected_contract_after_retry_exhausted'
    && confirmation.retry_exhausted_acknowledged === true;
  if ((!normalDecision && !exhaustedDecision)
    || String(confirmation.task_id || '') !== String(review.task_id || '')
    || !String(confirmation.reviewed_by || '').trim()) {
    return { ok: false, reason: 'manual_confirmation_invalid' };
  }
  if (exhausted && !exhaustedDecision) return { ok: false, reason: 'manual_recovery_retries_exhausted', review };
  if (exhaustedDecision && review.exhausted_override_used === true) {
    return { ok: false, reason: 'manual_recovery_exhausted_override_already_used', review };
  }
  const frozenUpstream = reviewUpstreamContract(review);
  if (!frozenUpstream.ok) return recordRecoveryFailure(
    review,
    opts.reviewFile,
    frozenUpstream.reason,
    frozenUpstream,
    { exhaustedOverride: exhaustedDecision },
  );
  if (opts.upstreamContract) {
    let suppliedDigest = null;
    try { suppliedDigest = contractDigest(opts.upstreamContract); } catch (_) {}
    if (suppliedDigest !== frozenUpstream.digest) {
      return recordRecoveryFailure(
        review,
        opts.reviewFile,
        'upstream_contract_binding_mismatch',
        { ok: false, reason: 'upstream_contract_binding_mismatch' },
        { exhaustedOverride: exhaustedDecision },
      );
    }
  }
  const validation = AcceptanceContract.validateHandoff(frozenUpstream.contract, opts.correctedDownstreamContract, {
    scope: opts.scope,
    timeoutMs: opts.timeoutMs || 100,
    textDiagnostic: false,
  });
  if (!validation.ok) return recordRecoveryFailure(
    review,
    opts.reviewFile,
    'corrected_contract_invalid',
    validation,
    { exhaustedOverride: exhaustedDecision },
  );
  const recoveredAt = new Date().toISOString();
  const recoveryAttempt = {
    attempt_kind: 'manual_correction',
    recorded_at: recoveredAt,
    retry_count: Math.max(0, Number(review.retry_count || 0)),
    outcome: 'recovered',
    validation: redactAuditValue(validation),
  };
  const recovered = Object.assign({}, review, {
    state: 'recovered',
    recovered_at: recoveredAt,
    recovered_by: redactAuditValue(String(confirmation.reviewed_by)),
    recovered_contract_id: AcceptanceContract.normalizeContract(opts.correctedDownstreamContract).contract_id,
    recovered_contract_sha256: contractDigest(opts.correctedDownstreamContract),
    recovered_upstream_contract_id: frozenUpstream.contract.contract_id,
    recovered_upstream_contract_sha256: frozenUpstream.digest,
    recovery_validation: redactAuditValue(validation),
    attempts: (Array.isArray(review.attempts) ? review.attempts : []).concat(recoveryAttempt),
    exhausted_override_used: review.exhausted_override_used === true || exhaustedDecision,
  });
  if (opts.reviewFile) atomicWriteJson(opts.reviewFile, recovered);
  if (opts.emitRecovery !== false) emit(opts.eventlog, 'acceptance.handoff.recovered', {
    task: review.task_id || null,
    projectId: review.project_id || null,
    reviewedBy: redactAuditValue(String(confirmation.reviewed_by)),
    contractId: recovered.recovered_contract_id,
    reviewFile: opts.reviewFile
      ? path.relative(opts.workspaceRoot || process.cwd(), opts.reviewFile).split(path.sep).join('/')
      : null,
  });
  return { ok: true, state: 'recovered', review: recovered, validation };
}

function safeQueueIdentity(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : null;
}

function recoverPausedQueueReview(opts = {}) {
  const queueAgent = safeQueueIdentity(opts.queueAgent);
  const queueId = safeQueueIdentity(opts.queueId);
  const taskId = String(opts.taskId || opts.confirmation && opts.confirmation.task_id || '').trim();
  if (!queueAgent || !queueId || !taskId) return { ok: false, reason: 'queue_recovery_identity_invalid' };
  const reviewFile = opts.reviewFile || reviewArtifactPath({
    workspaceRoot: opts.workspaceRoot,
    artifactsRoot: opts.artifactsRoot,
    taskId,
  });
  const review = readJson(reviewFile);
  if (!review || review.schema !== REVIEW_SCHEMA) return { ok: false, reason: 'review_state_invalid' };
  if (String(review.task_id || '') !== taskId
    || String(review.queue_agent || '') !== queueAgent
    || String(review.queue_id || '') !== queueId) {
    return { ok: false, reason: 'review_queue_binding_mismatch' };
  }
  const queueRoot = opts.queueRoot || opts.artifactsRoot;
  if (!queueRoot) return { ok: false, reason: 'queue_root_missing' };
  const pausedFile = path.join(Queue.qdir(queueRoot, queueAgent), 'paused', `${queueId}.json`);
  const pausedEntry = readJson(pausedFile);
  if (!pausedEntry) return { ok: false, reason: 'paused_queue_entry_missing' };
  const entryTaskId = String(pausedEntry.taskId || pausedEntry.task && pausedEntry.task.taskId || '');
  if (entryTaskId !== taskId) return { ok: false, reason: 'paused_task_binding_mismatch' };
  const upstreamContract = review.upstream_contract;
  const correctedDownstreamContract = opts.correctedDownstreamContract;
  const recovery = recoverManualReview({
    review,
    reviewFile,
    upstreamContract,
    correctedDownstreamContract,
    scope: opts.scope || review.scope,
    timeoutMs: opts.timeoutMs,
    confirmation: opts.confirmation,
    emitRecovery: false,
  });
  if (!recovery.ok) return recovery;

  const originalEntry = JSON.parse(JSON.stringify(pausedEntry));
  const corrected = AcceptanceContract.normalizeContract(correctedDownstreamContract);
  const upstream = AcceptanceContract.normalizeContract(upstreamContract);
  const recoveredAt = new Date().toISOString();
  pausedEntry.task = Object.assign({}, pausedEntry.task || {}, {
    acceptance_contract: upstream,
    acceptance_handoff_corrected_contract: corrected,
    acceptance_handoff_retry_count: Math.max(0, Number(review.retry_count || 0)) + 1,
    acceptance_handoff_recovery: {
      schema: 'acceptance-handoff-recovery@1',
      task_id: taskId,
      review_file: path.relative(opts.workspaceRoot || process.cwd(), reviewFile).split(path.sep).join('/'),
      upstream_contract_id: upstream.contract_id,
      corrected_contract_id: corrected.contract_id,
      corrected_contract_sha256: contractDigest(corrected),
      recovered_at: recoveredAt,
    },
    resumeTask: true,
  });
  pausedEntry.acceptance_handoff_recovered_at = recoveredAt;
  const recoveredReview = Object.assign({}, recovery.review, {
    queue_agent: queueAgent,
    queue_id: queueId,
    queue_resumed_at: recoveredAt,
  });
  try {
    atomicWriteJson(pausedFile, pausedEntry);
    atomicWriteJson(reviewFile, recoveredReview);
    const resumed = Queue.resume(queueRoot, queueAgent, queueId);
    if (!resumed) throw new Error('paused queue resume failed');
    emit(opts.eventlog, 'acceptance.handoff.recovered', {
      task: taskId,
      projectId: review.project_id || null,
      queueAgent,
      queueId,
      contractId: corrected.contract_id,
      reviewFile: path.relative(opts.workspaceRoot || process.cwd(), reviewFile).split(path.sep).join('/'),
    });
    return { ok: true, state: 'recovered', queueState: 'queued', review: recoveredReview, entry: resumed };
  } catch (error) {
    // The item is paused before this action, so restoring both records is safe and
    // keeps the operator-visible recovery state retriable when any write fails.
    try { atomicWriteJson(pausedFile, originalEntry); } catch (_) {}
    try { atomicWriteJson(reviewFile, review); } catch (_) {}
    return { ok: false, reason: 'queue_recovery_commit_failed', error: String(error && error.message || error) };
  }
}

function resolveRecoveredDownstreamContract(opts = {}) {
  const receipt = opts.receipt;
  if (!receipt || receipt.schema !== 'acceptance-handoff-recovery@1') return { ok: false, reason: 'recovery_receipt_missing' };
  const taskId = String(opts.taskId || '');
  const queueAgent = String(opts.queueAgent || '');
  const queueId = String(opts.queueId || '');
  if (String(receipt.task_id || '') !== taskId) return { ok: false, reason: 'recovery_task_mismatch' };
  const reviewFile = reviewArtifactPath({ workspaceRoot: opts.workspaceRoot, artifactsRoot: opts.artifactsRoot, taskId });
  const review = readJson(reviewFile);
  if (!review || review.state !== 'recovered'
    || String(review.queue_agent || '') !== queueAgent
    || String(review.queue_id || '') !== queueId) {
    return { ok: false, reason: 'recovery_review_binding_invalid' };
  }
  try {
    const upstream = AcceptanceContract.normalizeContract(opts.upstreamContract);
    const corrected = AcceptanceContract.normalizeContract(opts.correctedDownstreamContract);
    const digest = contractDigest(corrected);
    if (upstream.contract_id !== review.recovered_upstream_contract_id
      || corrected.contract_id !== review.recovered_contract_id
      || digest !== review.recovered_contract_sha256
      || digest !== receipt.corrected_contract_sha256) {
      return { ok: false, reason: 'recovery_contract_binding_invalid' };
    }
    return { ok: true, contract: corrected, reviewFile };
  } catch (error) {
    return { ok: false, reason: 'recovery_contract_invalid', error: String(error && error.message || error) };
  }
}

module.exports = {
  CONFIG_SCHEMA,
  REVIEW_SCHEMA,
  ACTIVATION_EVIDENCE_SCHEMA,
  OWNER_APPROVAL_SCHEMA,
  FEATURE_ID,
  PROJECT_ID,
  OWNER_APPROVAL_PUBLIC_KEY_ENV,
  DEFAULT_CONFIG_REL,
  defaultConfig,
  loadConfig,
  activationDecision,
  buildDownstreamContract,
  renderStructuredAcceptanceTable,
  reviewArtifactPath,
  persistReview,
  evaluateBeforeEnqueue,
  recoverManualReview,
  recoverPausedQueueReview,
  resolveRecoveredDownstreamContract,
  verifyPrerequisiteEvidence,
  contractDigest,
  ownerApprovalSigningPayload,
};
