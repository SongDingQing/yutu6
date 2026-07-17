'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AcceptanceContract = require('../../shared/engine/acceptance-contract');
const InteractionTrace = require('../../shared/engine/interaction-trace');

const STATE_SCHEMA = 'console-review-delta-state@1';
const HISTORY_SCHEMA = 'console-review-history-redacted@1';
const AUDIT_SCHEMA = 'console-review-delta-audit@1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const PASS_STATUSES = new Set(['完成', 'not_applicable']);
const ELIGIBLE_NODES = new Set(['implement', 'review']);

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value == null ? '' : value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function appendAudit(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try { fs.writeSync(fd, `${JSON.stringify(entry)}\n`); }
  finally { fs.closeSync(fd); }
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function relativeWithin(root, file) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(file);
  const rel = path.relative(absoluteRoot, absolute);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function safeExistingFile(file, boundaryRoot) {
  const rel = relativeWithin(boundaryRoot, file);
  if (!rel) return { ok: false, reason: 'path_outside_boundary' };
  let lst;
  let stat;
  let real;
  let realBoundary;
  try {
    lst = fs.lstatSync(file);
    stat = fs.statSync(file);
    real = fs.realpathSync(file);
    realBoundary = fs.realpathSync(boundaryRoot);
  } catch (_) {
    return { ok: false, reason: 'artifact_missing' };
  }
  if (lst.isSymbolicLink()) return { ok: false, reason: 'artifact_symlink_forbidden' };
  if (!stat.isFile()) return { ok: false, reason: 'artifact_not_file' };
  if (!relativeWithin(realBoundary, real)) return { ok: false, reason: 'artifact_realpath_outside_boundary' };
  return { ok: true, rel, absolute: path.resolve(file), stat };
}

function artifactSnapshot(file, kind, opts) {
  const checked = safeExistingFile(file, opts.projectRoot);
  if (!checked.ok) throw new Error(`${kind}:${checked.reason}`);
  const bytes = fs.readFileSync(checked.absolute);
  return {
    bytes,
    ref: {
      kind,
      path: relativeWithin(opts.workspaceRoot, checked.absolute),
      sha256: sha256(bytes),
    },
  };
}

function artifactRef(file, kind, opts) {
  return artifactSnapshot(file, kind, opts).ref;
}

function validateArtifactRef(ref, opts) {
  if (!ref || typeof ref !== 'object') return { ok: false, reason: 'artifact_ref_invalid' };
  if (!SHA256_RE.test(String(ref.sha256 || ''))) return { ok: false, reason: 'artifact_ref_sha256_invalid' };
  const requireVersion = opts.requireVersion === true;
  if (requireVersion && !SHA256_RE.test(String(ref.version_sha256 || ''))) {
    return { ok: false, reason: 'artifact_version_sha256_missing_or_invalid' };
  }
  if (ref.version_sha256 && !SHA256_RE.test(String(ref.version_sha256))) {
    return { ok: false, reason: 'artifact_version_sha256_invalid' };
  }
  const file = path.resolve(opts.workspaceRoot, String(ref.path || ''));
  const checked = safeExistingFile(file, opts.projectRoot);
  if (!checked.ok) return checked;
  const bytes = fs.readFileSync(checked.absolute);
  const actual = sha256(bytes);
  if (actual !== ref.sha256) return { ok: false, reason: 'artifact_hash_mismatch', expected: ref.sha256, actual };
  if (requireVersion && !SHA256_RE.test(String(opts.versionSha256 || ''))) {
    return { ok: false, reason: 'artifact_expected_version_sha256_missing_or_invalid' };
  }
  if (ref.version_sha256 && opts.versionSha256 && ref.version_sha256 !== opts.versionSha256) {
    return { ok: false, reason: 'artifact_version_mismatch' };
  }
  return { ok: true, file: checked.absolute, rel: checked.rel, bytes, actual };
}

function goalHash(ctx) {
  return sha256(String(ctx && ctx.goal || ''));
}

function immutableIdentity(ctx) {
  return {
    goal_sha256: goalHash(ctx),
    spec_fingerprint: normalizeText(ctx && ctx.spec_fingerprint),
  };
}

function canonicalRequiredRows(ctx) {
  const contract = ctx && ctx.acceptance_contract;
  if (!contract || contract.schema !== 'acceptance-contract@1') {
    return { ok: false, reason: 'structured_acceptance_contract_missing', rows: [] };
  }
  let rows;
  try { rows = AcceptanceContract.acceptanceRows(contract); }
  catch (error) {
    return { ok: false, reason: `structured_acceptance_contract_invalid:${normalizeText(error && error.message)}`, rows: [] };
  }
  if (!Array.isArray(ctx.requiredRows) || !ctx.requiredRows.length) {
    return { ok: false, reason: 'required_rows_missing', rows: [] };
  }
  const validation = AcceptanceContract.validateConsumerRows(contract, ctx.requiredRows, { textDiagnostic: false });
  if (!validation.ok) return { ok: false, reason: `required_rows_invalid:${validation.reason}`, rows: [] };
  return {
    ok: true,
    rows: rows.map(row => ({
      point: row.point,
      text: row.text,
      acceptance_id: row.acceptance_id,
      source_hash: row.source_hash,
      scope: row.scope,
    })),
  };
}

function rowsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index] || {};
    return row.acceptance_id === other.acceptance_id
      && row.source_hash === other.source_hash
      && row.text === other.text
      && row.scope === other.scope;
  });
}

function failedRowsFromReview(review) {
  const table = review && review.verification && review.verification.acceptance_table;
  if (!Array.isArray(table)) return [];
  return table
    .filter(row => !PASS_STATUSES.has(String(row && row.status || '')))
    .map(row => ({
      point: String(row.point || ''),
      text: String(row.text || ''),
      acceptance_id: String(row.acceptance_id || ''),
      source_hash: String(row.source_hash || ''),
      scope: String(row.scope || ''),
      status: String(row.status || ''),
    }));
}

function reviewImprovementPoints(review) {
  return normalizeStringList(review && review.evaluation && review.evaluation.improvement_points);
}

function reviewConclusionCorpus(review) {
  const evaluation = review && review.evaluation || {};
  return normalizeText(JSON.stringify({
    notes: review && review.notes,
    critique: review && review.critique,
    feedback: review && review.feedback,
    gaps: evaluation.gaps,
  }));
}

function validateImprovementConsistency(review) {
  const failedRows = failedRowsFromReview(review);
  const points = reviewImprovementPoints(review);
  if (failedRows.length && !points.length) {
    return { ok: false, reason: 'failed_rows_without_improvement_points', failedRows, points };
  }
  const corpus = reviewConclusionCorpus(review);
  const missing = points.filter(point => !corpus.includes(normalizeText(point)));
  if (missing.length) {
    return { ok: false, reason: 'improvement_point_not_mirrored_in_conclusion', failedRows, points, missing };
  }
  const structuredGaps = normalizeStringList(review && review.evaluation && review.evaluation.gaps);
  const omittedGaps = structuredGaps.filter(gap => !points.includes(gap));
  if (omittedGaps.length) {
    return { ok: false, reason: 'structured_gap_missing_from_improvement_points', failedRows, points, omittedGaps };
  }
  return {
    ok: true,
    failedRows,
    points,
    consistency_sha256: sha256(JSON.stringify({ failedRows, points, structuredGaps, corpus })),
  };
}

function extractJsonFence(text) {
  const matches = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(String(text || '')))) matches.push(match[1]);
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(matches[index].trim()); } catch (_) {}
  }
  return null;
}

function activationState(config = {}, env = process.env) {
  if (env && env.CONSOLE_REVIEW_DELTA_CONTEXT === '0') {
    return { mode: 'off', active: false, shadow: false, reason: 'environment_kill_switch' };
  }
  const promotion = config.promotionApproval || {};
  if (config.enabled === true) {
    if (promotion.supervisorReviewed !== true || promotion.ownerApproved !== true || promotion.status !== 'approved') {
      return { mode: 'off', active: false, shadow: false, reason: 'owner_approval_required' };
    }
    return { mode: 'active', active: true, shadow: false, reason: 'approved_feature_flag' };
  }
  if (config.shadowEnabled === true) {
    return { mode: 'shadow', active: false, shadow: true, reason: 'shadow_only' };
  }
  return { mode: 'off', active: false, shadow: false, reason: 'feature_flag_disabled' };
}

function changedFilesWithHashes(implementation, opts) {
  const files = implementation && Array.isArray(implementation.changed_files)
    ? implementation.changed_files : [];
  const out = [];
  for (const raw of files) {
    const rel = String(raw || '').split(path.sep).join('/');
    const file = path.resolve(opts.workspaceRoot, rel);
    const checked = safeExistingFile(file, opts.workspaceRoot);
    if (!checked.ok) throw new Error(`changed_file:${rel}:${checked.reason}`);
    out.push({ path: relativeWithin(opts.workspaceRoot, checked.absolute), sha256: sha256(fs.readFileSync(checked.absolute)) });
  }
  return out;
}

function validateChangedFiles(files, opts) {
  for (const ref of Array.isArray(files) ? files : []) {
    const checked = safeExistingFile(path.resolve(opts.workspaceRoot, String(ref.path || '')), opts.workspaceRoot);
    if (!checked.ok) return { ok: false, reason: `changed_file_${checked.reason}` };
    if (sha256(fs.readFileSync(checked.absolute)) !== ref.sha256) {
      return { ok: false, reason: 'changed_file_hash_mismatch' };
    }
  }
  return { ok: true };
}

function create(opts = {}) {
  const workspaceRoot = path.resolve(opts.workspaceRoot || process.cwd());
  const projectRoot = path.resolve(opts.projectRoot || path.join(workspaceRoot, 'projects/控制台'));
  const runsDir = path.resolve(opts.runsDir || path.join(projectRoot, 'artifacts/engine-runs', opts.taskId || 'unknown'));
  const auditFile = path.join(runsDir, 'review-delta', 'audit.jsonl');
  const config = opts.config || {};
  const requestedActivation = activationState(config, opts.env || process.env);
  const projectId = String(opts.projectId || '控制台');
  const flowId = String(opts.flowId || 'review-loop');
  const projectAllowlist = Array.isArray(config.projectAllowlist) && config.projectAllowlist.length
    ? config.projectAllowlist.map(String) : ['控制台'];
  const flowAllowlist = Array.isArray(config.flowAllowlist) && config.flowAllowlist.length
    ? config.flowAllowlist.map(String) : ['review-loop'];
  const projectEligible = projectAllowlist.includes(projectId);
  const flowEligible = flowAllowlist.includes(flowId);
  const activation = projectEligible && flowEligible
    ? requestedActivation
    : {
      mode: 'off',
      active: false,
      shadow: false,
      reason: projectEligible ? 'flow_not_eligible' : 'project_not_eligible',
    };
  const eventlog = opts.eventlog || null;

  function audit(type, data = {}) {
    const entry = Object.assign({
      schema: AUDIT_SCHEMA,
      at: new Date().toISOString(),
      type,
      task_id: opts.taskId || null,
      project_id: opts.projectId || '控制台',
      mode: activation.mode,
    }, data);
    try { appendAudit(auditFile, entry); } catch (_) {}
    try { if (eventlog) eventlog.emit(type, entry); } catch (_) {}
    return entry;
  }

  function loadHistory(state) {
    if (!state || !state.history_ref) return { schema: HISTORY_SCHEMA, identity: state && state.identity || null, entries: [] };
    const checked = validateArtifactRef(state.history_ref, {
      workspaceRoot,
      projectRoot,
      versionSha256: state.source_version_sha256,
      requireVersion: true,
    });
    if (!checked.ok) throw new Error(`review_history_${checked.reason}`);
    const parsed = JSON.parse(checked.bytes.toString('utf8'));
    if (!parsed || parsed.schema !== HISTORY_SCHEMA || !Array.isArray(parsed.entries)) {
      throw new Error('review_history_schema_invalid');
    }
    return parsed;
  }

  function writeHistory(history, identity) {
    const normalized = {
      schema: HISTORY_SCHEMA,
      identity,
      entries: history.entries,
    };
    const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    const digest = sha256(bytes);
    const file = path.join(runsDir, 'review-delta', 'history', `review-history-${history.entries.length}-${digest}.redacted.json`);
    atomicWrite(file, bytes);
    return artifactRef(file, 'review_history_redacted', { workspaceRoot, projectRoot });
  }

  function publishRedactedSnapshot(sourceSnapshot, kind) {
    const digest = sha256(sourceSnapshot.bytes);
    const file = path.join(runsDir, 'review-delta', 'refs', `${kind}-${digest}.redacted.md`);
    if (fs.existsSync(file)) {
      const existing = artifactSnapshot(file, kind, { workspaceRoot, projectRoot });
      if (existing.ref.sha256 !== digest) throw new Error(`${kind}:content_address_collision`);
      return existing;
    }
    atomicWrite(file, sourceSnapshot.bytes);
    const published = artifactSnapshot(file, kind, { workspaceRoot, projectRoot });
    if (published.ref.sha256 !== digest) throw new Error(`${kind}:snapshot_write_mismatch`);
    return published;
  }

  function fallbackDecision(state, identity, requiredRows, reason, node, attempt) {
    const checked = validateArtifactRef(state && state.fallback_ref, {
      workspaceRoot,
      projectRoot,
    });
    if (!checked.ok) {
      audit('review.delta.blocked', { node: node.id, attempt, reason, fallback_reason: checked.reason });
      throw new Error(`review_delta_fallback_unavailable:${reason}:${checked.reason}`);
    }
    const canonicalVersionSha256 = checked.actual;
    const declaredVersionSha256 = state && state.fallback_ref && state.fallback_ref.version_sha256;
    const content = checked.bytes.toString('utf8');
    const fallbackRows = Array.isArray(requiredRows) && requiredRows.length
      ? requiredRows
      : (Array.isArray(state && state.required_rows) ? state.required_rows : []);
    audit('review.delta.fallback', {
      node: node.id,
      attempt,
      reason,
      source_ref: state.fallback_ref.path,
      source_sha256: state.fallback_ref.sha256,
      source_version_sha256: canonicalVersionSha256,
      declared_source_version_sha256: state && state.source_version_sha256 || null,
      declared_fallback_version_sha256: declaredVersionSha256 || null,
    });
    return {
      mode: 'fallback',
      value: {
        goal_sha256: identity.goal_sha256,
        spec_fingerprint: identity.spec_fingerprint,
        requiredRows: fallbackRows,
        fallback_full_result: {
          artifact_ref: Object.assign({}, state.fallback_ref, { version_sha256: canonicalVersionSha256 }),
          source_version_sha256: canonicalVersionSha256,
          content,
        },
      },
    };
  }

  function validatePreviousReview(state) {
    const previous = state && state.previous_review;
    if (!previous) return { ok: true };
    const checked = validateArtifactRef(previous.full_result_ref, {
      workspaceRoot,
      projectRoot,
      versionSha256: state.source_version_sha256,
      requireVersion: true,
    });
    if (!checked.ok) return { ok: false, reason: `previous_review_${checked.reason}` };
    const parsed = extractJsonFence(checked.bytes.toString('utf8'));
    const review = parsed && parsed.review;
    if (!review) return { ok: false, reason: 'previous_review_result_unparseable' };
    const consistency = validateImprovementConsistency(review);
    if (!consistency.ok) return consistency;
    if (JSON.stringify(consistency.failedRows) !== JSON.stringify(previous.failed_rows)
      || JSON.stringify(consistency.points) !== JSON.stringify(previous.improvement_points)
      || consistency.consistency_sha256 !== previous.consistency_sha256) {
      return { ok: false, reason: 'previous_review_consistency_drift' };
    }
    return { ok: true };
  }

  function prepareEnvelope({ node = {}, ctx = {}, attempt = 0 } = {}) {
    if (!ELIGIBLE_NODES.has(String(node.id || ''))) return { mode: 'legacy' };
    if (activation.mode === 'off') return { mode: 'legacy' };
    const state = ctx.review_delta_state;
    if (!state || state.schema !== STATE_SCHEMA) {
      audit('review.delta.initial_legacy', { node: node.id || null, attempt, reason: 'no_previous_version' });
      return { mode: 'legacy' };
    }
    const identity = immutableIdentity(ctx);
    const required = canonicalRequiredRows(ctx);
    const fail = reason => {
      try {
        const fallback = fallbackDecision(state, identity, required.rows, reason, node, attempt);
        return activation.mode === 'shadow'
          ? { mode: 'legacy', shadowFallback: fallback.value, shadowReason: reason }
          : fallback;
      } catch (error) {
        if (activation.mode !== 'shadow') throw error;
        audit('review.delta.shadow_invalid', {
          node: node.id || null,
          attempt,
          reason,
          fallback_error: normalizeText(error && error.message),
        });
        return { mode: 'legacy', shadowReason: reason };
      }
    };
    if (!identity.spec_fingerprint) return fail('spec_fingerprint_missing');
    if (!state.identity || identity.goal_sha256 !== state.identity.goal_sha256
      || identity.spec_fingerprint !== state.identity.spec_fingerprint) return fail('immutable_identity_mismatch');
    if (!SHA256_RE.test(String(state.source_version_sha256 || ''))
      || !state.fallback_ref
      || state.fallback_ref.sha256 !== state.source_version_sha256
      || state.fallback_ref.version_sha256 !== state.source_version_sha256) return fail('source_version_anchor_mismatch');
    if (!required.ok || !required.rows.length) return fail(required.reason || 'required_rows_empty');
    if (!rowsEqual(required.rows, state.required_rows)) return fail('required_row_identity_or_content_drift');
    if (!Array.isArray(state.artifact_refs) || !state.artifact_refs.length) return fail('artifact_refs_empty');
    for (const ref of state.artifact_refs) {
      const checked = validateArtifactRef(ref, {
        workspaceRoot,
        projectRoot,
        versionSha256: state.source_version_sha256,
        requireVersion: true,
      });
      if (!checked.ok) return fail(`artifact_ref_${checked.reason}`);
    }
    const changed = validateChangedFiles(state.changed_files, { workspaceRoot });
    if (!changed.ok) return fail(changed.reason);
    const previous = state.previous_review;
    if (previous && previous.failed_rows.length && !previous.improvement_points.length) {
      return fail('failed_rows_without_improvement_points');
    }
    if (previous) {
      for (const failed of previous.failed_rows) {
        const current = required.rows.find(row => row.acceptance_id === failed.acceptance_id);
        if (!current || current.source_hash !== failed.source_hash || current.text !== failed.text) {
          return fail('failed_row_identity_or_content_drift');
        }
      }
    }
    const consistency = validatePreviousReview(state);
    if (!consistency.ok) return fail(consistency.reason);
    const value = {
      goal_sha256: identity.goal_sha256,
      spec_fingerprint: identity.spec_fingerprint,
      requiredRows: required.rows,
      previous_failed_rows: previous ? previous.failed_rows : [],
      improvement_points: previous ? previous.improvement_points : [],
      changed_files: state.changed_files || [],
      artifact_refs: state.artifact_refs || [],
    };
    if (activation.mode === 'shadow') {
      audit('review.delta.shadow', {
        node: node.id || null,
        attempt,
        delta_chars: JSON.stringify(value).length,
        required_row_count: required.rows.length,
      });
      return { mode: 'legacy', shadowValue: value };
    }
    audit('review.delta.preflight_ok', {
      node: node.id || null,
      attempt,
      source_version_sha256: state.source_version_sha256,
      required_row_count: required.rows.length,
      failed_row_count: value.previous_failed_rows.length,
      artifact_ref_count: value.artifact_refs.length,
    });
    return { mode: 'delta', value };
  }

  function validateReviewResult(review, ctx, redactedReview) {
    const identity = immutableIdentity(ctx);
    const reported = review && review.verification && review.verification.immutable_context;
    if (!reported || reported.verified !== true
      || reported.goal_sha256 !== identity.goal_sha256
      || reported.spec_fingerprint !== identity.spec_fingerprint) {
      return { ok: false, reason: 'review_immutable_identity_unverified' };
    }
    const rows = review && review.verification && review.verification.acceptance_table;
    const coverage = AcceptanceContract.validateConsumerRows(ctx.acceptance_contract, rows, { textDiagnostic: false });
    if (!coverage.ok) return { ok: false, reason: `review_required_rows_incomplete:${coverage.reason}` };
    const redactedCoverage = AcceptanceContract.validateConsumerRows(
      ctx.acceptance_contract,
      redactedReview && redactedReview.verification && redactedReview.verification.acceptance_table,
      { textDiagnostic: false },
    );
    if (!redactedCoverage.ok) return { ok: false, reason: `redacted_review_required_rows_incomplete:${redactedCoverage.reason}` };
    const direct = validateImprovementConsistency(review);
    const independent = validateImprovementConsistency(redactedReview);
    if (!direct.ok) return direct;
    if (!independent.ok) return { ok: false, reason: `redacted_${independent.reason}` };
    if (JSON.stringify(direct.failedRows) !== JSON.stringify(independent.failedRows)
      || JSON.stringify(direct.points) !== JSON.stringify(independent.points)) {
      return { ok: false, reason: 'review_redacted_consistency_mismatch' };
    }
    return Object.assign({ ok: true }, independent);
  }

  function captureResult({ node = {}, ctx = {}, attempt = 0, result = {}, dir } = {}) {
    if (!ELIGIBLE_NODES.has(String(node.id || ''))) return { ok: true, skipped: true };
    if (activation.mode === 'off') return { ok: true, skipped: true };
    try {
      const identity = immutableIdentity(ctx);
      if (!identity.spec_fingerprint) throw new Error('spec_fingerprint_missing');
      const required = canonicalRequiredRows(ctx);
      if (!required.ok || !required.rows.length) throw new Error(required.reason || 'required_rows_empty');
      const taskSourceSnapshot = artifactSnapshot(path.join(dir, 'task.redacted.md'), 'task_redacted', { workspaceRoot, projectRoot });
      const resultSourceSnapshot = artifactSnapshot(path.join(dir, 'result.redacted.md'), 'result_redacted', { workspaceRoot, projectRoot });
      const taskSnapshot = publishRedactedSnapshot(taskSourceSnapshot, 'task_redacted');
      const resultSnapshot = publishRedactedSnapshot(resultSourceSnapshot, 'result_redacted');
      const taskRef = taskSnapshot.ref;
      const resultRef = resultSnapshot.ref;
      const parsedRedacted = extractJsonFence(resultSnapshot.bytes.toString('utf8'));
      if (!parsedRedacted) throw new Error('redacted_result_unparseable');
      const prior = ctx.review_delta_state && ctx.review_delta_state.schema === STATE_SCHEMA
        ? ctx.review_delta_state : null;
      let previousReview = prior && prior.previous_review || null;
      let historyRef = prior && prior.history_ref || null;
      let history = loadHistory(prior);

      if (node.id === 'review') {
        const review = result.vars && result.vars.review;
        const redactedReview = parsedRedacted.review;
        const validation = validateReviewResult(review, ctx, redactedReview);
        if (!validation.ok) throw new Error(validation.reason);
        const fullReviewSha256 = sha256(JSON.stringify(redactedReview));
        history.entries.push({
          round: history.entries.length + 1,
          node: node.id,
          attempt,
          result_sha256: resultRef.sha256,
          full_review_sha256: fullReviewSha256,
          review: redactedReview,
        });
        historyRef = writeHistory(history, identity);
        previousReview = {
          failed_rows: validation.failedRows,
          improvement_points: validation.points,
          consistency_sha256: validation.consistency_sha256,
          full_result_ref: resultRef,
          full_review_sha256: fullReviewSha256,
        };
      }

      const implementation = node.id === 'implement' ? result.vars && result.vars.implementation : null;
      const changedFiles = implementation
        ? changedFilesWithHashes(implementation, { workspaceRoot })
        : (prior && prior.changed_files || []);
      const refs = [taskRef, resultRef];
      if (historyRef) refs.push(historyRef);
      if (previousReview && previousReview.full_result_ref
        && !refs.some(ref => ref.path === previousReview.full_result_ref.path)) refs.push(previousReview.full_result_ref);

      const sections = [
        `# latest_${node.id}_task.redacted.md\n${taskSnapshot.bytes.toString('utf8')}`,
        `# latest_${node.id}_result.redacted.md\n${resultSnapshot.bytes.toString('utf8')}`,
      ];
      if (previousReview && previousReview.full_result_ref.path !== resultRef.path) {
        const checked = validateArtifactRef(previousReview.full_result_ref, {
          workspaceRoot,
          projectRoot,
          versionSha256: prior && prior.source_version_sha256,
          requireVersion: true,
        });
        if (!checked.ok) throw new Error(`previous_review_${checked.reason}`);
        sections.push(`# previous_review_result.redacted.md\n${checked.bytes.toString('utf8')}`);
      }
      if (historyRef) {
        const checked = validateArtifactRef(historyRef, { workspaceRoot, projectRoot });
        if (!checked.ok) throw new Error(`review_history_${checked.reason}`);
        sections.push(`# review_history.redacted.json\n${checked.bytes.toString('utf8')}`);
      }
      const fullContext = InteractionTrace.redact(sections.join('\n\n'));
      const versionSha256 = sha256(fullContext);
      const fallbackFile = path.join(
        runsDir,
        'review-delta',
        'versions',
        `${node.id}-${attempt}-${versionSha256}.full-context.redacted.md`,
      );
      atomicWrite(fallbackFile, fullContext);
      const fallbackRef = Object.assign(
        artifactRef(fallbackFile, 'full_context_redacted', { workspaceRoot, projectRoot }),
        { version_sha256: versionSha256 },
      );
      const versionedRefs = refs.map(ref => Object.assign({}, ref, { version_sha256: versionSha256 }));
      if (previousReview) {
        previousReview = Object.assign({}, previousReview, {
          full_result_ref: Object.assign({}, previousReview.full_result_ref, { version_sha256: versionSha256 }),
        });
      }
      if (historyRef) historyRef = Object.assign({}, historyRef, { version_sha256: versionSha256 });
      const state = {
        schema: STATE_SCHEMA,
        identity,
        required_rows: required.rows,
        previous_review: previousReview,
        changed_files: changedFiles,
        artifact_refs: versionedRefs,
        history_ref: historyRef,
        fallback_ref: fallbackRef,
        source_version_sha256: versionSha256,
      };
      ctx.review_delta_state = state;
      audit('review.delta.captured', {
        node: node.id || null,
        attempt,
        source_version_sha256: versionSha256,
        required_row_count: required.rows.length,
        failed_row_count: previousReview ? previousReview.failed_rows.length : 0,
        changed_file_count: changedFiles.length,
        history_ref: historyRef && historyRef.path || null,
        history_sha256: historyRef && historyRef.sha256 || null,
      });
      return { ok: true, state };
    } catch (error) {
      const reason = normalizeText(error && error.message || error || 'unknown_capture_failure');
      audit('review.delta.capture_failed', { node: node.id || null, attempt, reason });
      return { ok: activation.mode !== 'active', reason, shadow: activation.mode === 'shadow' };
    }
  }

  return {
    activation,
    auditFile,
    prepareEnvelope,
    captureResult,
  };
}

module.exports = {
  STATE_SCHEMA,
  HISTORY_SCHEMA,
  activationState,
  canonicalRequiredRows,
  create,
  extractJsonFence,
  failedRowsFromReview,
  goalHash,
  immutableIdentity,
  sha256,
  validateArtifactRef,
  validateImprovementConsistency,
};
