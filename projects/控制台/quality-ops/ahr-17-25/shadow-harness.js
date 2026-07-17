'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA = 'yutu6.ahr17-25-shadow@1';
const OUTCOME_SCHEMA = 'yutu6.terminal-outcome@1';
const PHASES = Object.freeze(['reason', 'action', 'observation', 'decision']);
const TERMINAL_OUTCOMES = new Set(['success', 'fail', 'blocked', 'cancelled', 'waiting']);
const FAULT_SCENARIOS = new Set(['network_partition', 'process_crash', 'data_corruption']);
const OWNER_GATED_FEATURES = new Set(['ahr21_unified_process_group_termination', 'ahr25_split_message_queues']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a finite non-negative number`);
  return number;
}

function atomicWrite(file, bytes, hooks = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (typeof hooks.beforeRename === 'function') hooks.beforeRename(temp, file);
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function atomicWriteJson(file, value, hooks) {
  atomicWrite(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'), hooks);
}

function legacyStatus(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.state != null) return record.state;
  if (record.status != null) return record.status;
  return null;
}

function normalizeTypedOutcome(status, reason = null, now = new Date().toISOString()) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!TERMINAL_OUTCOMES.has(normalized)) throw new Error(`unsupported typed terminal outcome: ${status}`);
  return {
    schema: OUTCOME_SCHEMA,
    status: normalized,
    reason: reason == null ? null : String(reason),
    at: now,
  };
}

// AHR-19 compatibility rule: typed_outcome is append-only. Existing state/status strings are never rewritten.
function appendTypedOutcome(record, status, reason = null, now) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('legacy record must be an object');
  const output = Object.assign({}, record);
  output.typed_outcome = normalizeTypedOutcome(status, reason, now);
  return output;
}

function ownerApprovalAllows(feature, approval, requiredTaskId, requiredRollbackPlan = null) {
  if (!OWNER_GATED_FEATURES.has(feature)) throw new Error(`unknown owner-gated feature: ${feature}`);
  const rollbackPlan = approval && typeof approval.rollbackPlan === 'string' ? approval.rollbackPlan.trim() : '';
  const rollbackMatches = requiredRollbackPlan == null
    ? Boolean(rollbackPlan)
    : rollbackPlan === String(requiredRollbackPlan).trim();
  return Boolean(
    approval &&
    approval.status === 'approved' &&
    approval.taskId === requiredTaskId &&
    Array.isArray(approval.approvedScope) && approval.approvedScope.includes(feature) &&
    rollbackMatches
  );
}

function productionFeatureDecision(feature, options = {}) {
  const flag = options.featureFlag === true;
  const ownerApproved = ownerApprovalAllows(
    feature,
    options.approval,
    options.requiredTaskId,
    options.requiredRollbackPlan
  );
  return {
    feature,
    enabled: flag && ownerApproved,
    featureFlag: flag,
    ownerApproved,
    reason: !flag ? 'feature_flag_disabled' : (!ownerApproved ? 'owner_approval_required' : null),
  };
}

function validateShadowOptions(options) {
  const taskId = String(options.taskId || '');
  const shadowRoot = path.resolve(String(options.shadowRoot || ''));
  if (!/^ahr-fi-[a-z0-9][a-z0-9_-]*$/i.test(taskId)) {
    throw new Error('fault injection requires a dedicated ahr-fi-* taskId');
  }
  if (options.environment !== 'shadow') throw new Error('fault injection environment must be shadow');
  if (options.excludeFromHealthScore !== true) throw new Error('shadow fault injection must be excluded from health score');
  if (options.excludeFromQuotaBreaker !== true) throw new Error('shadow fault injection must be excluded from quota breaker');
  if (options.excludeFromProductionEventLedger !== true) {
    throw new Error('shadow fault injection must be excluded from the production event ledger');
  }
  if (!/(^|[\\/])ahr-17-25-shadow([\\/]|$)/.test(shadowRoot)) {
    throw new Error('shadowRoot must contain an ahr-17-25-shadow path segment');
  }
  const forbiddenRoots = (options.forbiddenRoots || []).filter(Boolean).map(root => path.resolve(root));
  for (const forbidden of forbiddenRoots) {
    const relative = path.relative(forbidden, shadowRoot);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error(`shadowRoot overlaps forbidden production root: ${forbidden}`);
    }
  }
  return { taskId, shadowRoot };
}

function initialState(options, taskId, clock) {
  const startedEpochMs = Number(clock());
  return {
    schema: SCHEMA,
    taskId,
    environment: 'shadow',
    exclusions: {
      healthScore: true,
      quotaBreaker: true,
      productionEventLedger: true,
    },
    featureFlags: {
      splitMessageQueues: options.splitMessageQueues === true,
    },
    budgets: {
      maxSteps: finiteNonNegative(options.budgets && options.budgets.maxSteps, 'budgets.maxSteps'),
      maxTimeMs: finiteNonNegative(options.budgets && options.budgets.maxTimeMs, 'budgets.maxTimeMs'),
      maxCostUsd: finiteNonNegative(options.budgets && options.budgets.maxCostUsd, 'budgets.maxCostUsd'),
      maxConsecutiveFormatErrors: finiteNonNegative(
        options.budgets && options.budgets.maxConsecutiveFormatErrors,
        'budgets.maxConsecutiveFormatErrors'
      ),
    },
    usage: { steps: 0, elapsedMs: 0, costUsd: 0 },
    formatErrors: { consecutive: 0, total: 0 },
    startedEpochMs,
    startedAt: new Date(startedEpochMs).toISOString(),
    updatedAt: new Date(startedEpochMs).toISOString(),
    trajectory: [],
    messages: { steering: [], followUp: [] },
  };
}

function validateState(state, taskId) {
  if (!state || state.schema !== SCHEMA || state.taskId !== taskId || state.environment !== 'shadow') {
    throw new Error('invalid or mismatched shadow trajectory state');
  }
  if (!state.exclusions || state.exclusions.healthScore !== true || state.exclusions.quotaBreaker !== true ||
      state.exclusions.productionEventLedger !== true) {
    throw new Error('shadow trajectory lost mandatory production exclusions');
  }
  return state;
}

function allowedNextPhase(previous, next) {
  if (!previous) return next === 'reason';
  if (previous === 'decision') return next === 'reason';
  if (previous === 'reason') return next === 'action' || next === 'decision';
  if (previous === 'action') return next === 'observation';
  if (previous === 'observation') return next === 'decision';
  return false;
}

class ShadowHarness {
  constructor(options = {}) {
    const safe = validateShadowOptions(options);
    this.options = Object.assign({}, options, safe);
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.root = safe.shadowRoot;
    this.taskId = safe.taskId;
    this.file = path.join(this.root, `${this.taskId}.json`);
    this.rollbackRoot = path.join(this.root, 'rollback');
    fs.mkdirSync(this.root, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.state = validateState(JSON.parse(fs.readFileSync(this.file, 'utf8')), this.taskId);
    } else {
      this.state = initialState(options, this.taskId, this.clock);
      atomicWriteJson(this.file, this.state);
    }
  }

  read() {
    this.state = validateState(JSON.parse(fs.readFileSync(this.file, 'utf8')), this.taskId);
    return clone(this.state);
  }

  _persist(next, hooks) {
    validateState(next, this.taskId);
    next.updatedAt = new Date(Number(this.clock())).toISOString();
    atomicWriteJson(this.file, next, hooks);
    this.state = next;
    return clone(next);
  }

  checkpoint(phase, payload = {}, hooks) {
    if (!PHASES.includes(phase)) throw new Error(`unsupported trajectory phase: ${phase}`);
    const next = clone(this.state);
    const previous = next.trajectory.length ? next.trajectory[next.trajectory.length - 1].phase : null;
    if (!allowedNextPhase(previous, phase)) throw new Error(`invalid trajectory transition: ${previous || 'start'} -> ${phase}`);
    const entry = {
      seq: next.trajectory.length + 1,
      phase,
      toolCallId: payload.toolCallId || null,
      summary: payload.summary == null ? null : String(payload.summary),
      evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.slice() : [],
      at: new Date(Number(this.clock())).toISOString(),
    };
    next.trajectory.push(entry);
    this._persist(next, hooks);
    return entry;
  }

  consumeBudget(delta = {}) {
    const next = clone(this.state);
    const stepDelta = finiteNonNegative(delta.steps || 0, 'steps');
    const costDelta = finiteNonNegative(delta.costUsd || 0, 'costUsd');
    const elapsedMs = Math.max(0, Number(this.clock()) - Number(next.startedEpochMs));
    const proposed = {
      steps: next.usage.steps + stepDelta,
      elapsedMs,
      costUsd: Number((next.usage.costUsd + costDelta).toFixed(8)),
    };
    let reason = null;
    if (proposed.steps > next.budgets.maxSteps) reason = 'step_budget_exceeded';
    else if (proposed.elapsedMs > next.budgets.maxTimeMs) reason = 'time_budget_exceeded';
    else if (proposed.costUsd > next.budgets.maxCostUsd) reason = 'cost_budget_exceeded';
    if (reason) {
      return {
        ok: false,
        reason,
        proposed,
        limit: clone(next.budgets),
        typedOutcome: normalizeTypedOutcome('fail', reason, new Date(Number(this.clock())).toISOString()),
      };
    }
    next.usage = proposed;
    this._persist(next);
    return { ok: true, usage: clone(next.usage) };
  }

  recordFormatResult(valid, reason = null) {
    const next = clone(this.state);
    if (valid) next.formatErrors.consecutive = 0;
    else {
      next.formatErrors.consecutive += 1;
      next.formatErrors.total += 1;
    }
    this._persist(next);
    const exceeded = next.formatErrors.consecutive > next.budgets.maxConsecutiveFormatErrors;
    return exceeded ? {
      ok: false,
      reason: 'format_error_budget_exceeded',
      detail: reason == null ? null : String(reason),
      typedOutcome: normalizeTypedOutcome('fail', 'format_error_budget_exceeded', new Date(Number(this.clock())).toISOString()),
      formatErrors: clone(next.formatErrors),
    } : { ok: true, formatErrors: clone(next.formatErrors) };
  }

  enqueueMessage(kind, message) {
    if (this.state.featureFlags.splitMessageQueues !== true) {
      return { accepted: false, reason: 'feature_flag_disabled', compatibilityMode: 'legacy_single_steer_queue' };
    }
    if (!['steering', 'followUp'].includes(kind)) throw new Error(`unsupported message queue: ${kind}`);
    const text = String(message || '').trim();
    if (!text) throw new Error('message is required');
    const next = clone(this.state);
    const entry = { seq: next.messages[kind].length + 1, message: text, at: new Date(Number(this.clock())).toISOString() };
    next.messages[kind].push(entry);
    this._persist(next);
    return { accepted: true, queue: kind, entry };
  }

  drainSteeringBeforeNextStep() {
    return this._drainMessages('steering');
  }

  drainFollowUpAfterTurn() {
    return this._drainMessages('followUp');
  }

  _drainMessages(kind) {
    if (this.state.featureFlags.splitMessageQueues !== true) return [];
    const next = clone(this.state);
    const entries = next.messages[kind].slice();
    next.messages[kind] = [];
    this._persist(next);
    return entries;
  }

  beginFaultInjection(scenario) {
    if (!FAULT_SCENARIOS.has(scenario)) throw new Error(`unsupported fault scenario: ${scenario}`);
    const bytes = fs.readFileSync(this.file);
    const snapshotFile = path.join(this.rollbackRoot, `${this.taskId}-${scenario}-${Date.now()}.snapshot.json`);
    atomicWrite(snapshotFile, bytes);
    return {
      scenario,
      snapshotFile,
      beforeSha256: sha256(bytes),
      canonicalFile: this.file,
      exclusions: clone(this.state.exclusions),
    };
  }

  recoverFaultInjection(transaction) {
    if (!transaction || !FAULT_SCENARIOS.has(transaction.scenario)) throw new Error('invalid fault transaction');
    const snapshot = fs.readFileSync(transaction.snapshotFile);
    atomicWrite(this.file, snapshot);
    try { fs.unlinkSync(transaction.snapshotFile); } catch (_) {}
    this.state = validateState(JSON.parse(snapshot.toString('utf8')), this.taskId);
    const after = fs.readFileSync(this.file);
    return {
      scenario: transaction.scenario,
      rolledBack: true,
      beforeSha256: transaction.beforeSha256,
      afterSha256: sha256(after),
      byteExact: transaction.beforeSha256 === sha256(after),
      healthScoreExcluded: this.state.exclusions.healthScore === true,
      quotaBreakerExcluded: this.state.exclusions.quotaBreaker === true,
      productionEventLedgerExcluded: this.state.exclusions.productionEventLedger === true,
    };
  }

  runFaultInjection(scenario, injector) {
    const transaction = this.beginFaultInjection(scenario);
    let error = null;
    try {
      injector({ canonicalFile: this.file, snapshotFile: transaction.snapshotFile });
    } catch (caught) {
      error = caught;
    }
    const recovery = this.recoverFaultInjection(transaction);
    return Object.assign(recovery, {
      injectedError: error ? String(error.code || error.message || error) : null,
    });
  }
}

function normalizeCompleteToolCall(call) {
  if (!call || typeof call !== 'object') throw new Error('tool call must be an object');
  if (call.streamComplete !== true || call.complete !== true) throw new Error('incomplete_streamed_tool_call');
  const id = String(call.id || call.toolCallId || '').trim();
  const name = String(call.name || call.toolName || '').trim();
  if (!id || !name) throw new Error('complete tool call requires id and name');
  let args = call.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); }
    catch (_) { throw new Error('incomplete_or_invalid_tool_arguments'); }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be a complete object');
  return { id, name, arguments: args };
}

function executeCompleteToolCall(call, executor) {
  const normalized = normalizeCompleteToolCall(call);
  if (typeof executor !== 'function') throw new Error('tool executor is required');
  return executor(normalized);
}

module.exports = {
  SCHEMA,
  OUTCOME_SCHEMA,
  PHASES,
  TERMINAL_OUTCOMES,
  FAULT_SCENARIOS,
  ShadowHarness,
  appendTypedOutcome,
  legacyStatus,
  normalizeTypedOutcome,
  normalizeCompleteToolCall,
  executeCompleteToolCall,
  ownerApprovalAllows,
  productionFeatureDecision,
  sha256,
};
