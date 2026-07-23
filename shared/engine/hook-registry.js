'use strict';

const VALID_MODES = new Set(['active', 'shadow', 'dormant']);

class HookRegistry {
  constructor(opts = {}) {
    this.eventlog = opts.eventlog || null;
    this.hooks = new Map();
    this.policy = normalizePolicy(opts.policy);
    this.requireBlockingProvenance = opts.requireBlockingProvenance === true;
    this.emitDormantEvents = opts.emitDormantEvents === true
      || process.env.YUTU6_GATE_DORMANT_AUDIT === '1';
  }

  register(eventType, hook) {
    const type = String(eventType || '').trim();
    if (!type) throw new Error('hook eventType is required');
    if (!hook || typeof hook.handler !== 'function') throw new Error(`hook handler is required for ${type}`);
    const id = String(hook.id || '').trim();
    if (!id) throw new Error(`hook id is required for ${type}`);
    const list = this.hooks.get(type) || [];
    if (list.some(item => item.id === id)) throw new Error(`duplicate hook id for ${type}: ${id}`);
    const policy = this.policy.get(id) || null;
    const registered = Object.assign({
      enabled: true,
      priority: 100,
      timeoutMs: 100,
      failureMode: 'warn',
      mode: 'active',
      incidentRefs: [],
      regressionTests: [],
    }, hook, { id });
    if (policy) {
      registered.mode = policy.mode || registered.mode;
      registered.incidentRefs = normalizeRefs(policy.incident_refs || policy.incidentRefs || registered.incidentRefs);
      registered.regressionTests = normalizeRefs(
        policy.regression_tests || policy.regressionTests || registered.regressionTests,
      );
      registered.policyReason = policy.reason || registered.policyReason || null;
      registered.activation = policy.activation || registered.activation || null;
      registered.duplicateOf = policy.duplicate_of || policy.duplicateOf || registered.duplicateOf || null;
      registered.policyClass = policy.class || registered.policyClass || null;
      if (policy.failure_mode) registered.failureMode = policy.failure_mode;
      if (policy.timeout_ms != null) registered.timeoutMs = Number(policy.timeout_ms);
    } else {
      registered.incidentRefs = normalizeRefs(registered.incidentRefs);
      registered.regressionTests = normalizeRefs(registered.regressionTests);
    }
    if (registered.enabled === false) registered.mode = 'dormant';
    if (!VALID_MODES.has(registered.mode)) throw new Error(`invalid hook mode for ${type}/${id}: ${registered.mode}`);
    if (this.requireBlockingProvenance
      && registered.mode === 'active'
      && registered.failureMode === 'block'
      && registered.incidentRefs.length === 0) {
      throw new Error(`active blocking hook lacks incidentRefs: ${type}/${id}`);
    }
    if (this.requireBlockingProvenance
      && registered.mode === 'active'
      && registered.failureMode === 'block'
      && registered.regressionTests.length === 0) {
      throw new Error(`active blocking hook lacks regressionTests: ${type}/${id}`);
    }
    list.push(registered);
    list.sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100) || a.id.localeCompare(b.id));
    this.hooks.set(type, list);
    return this;
  }

  list(eventType = null) {
    if (eventType) return (this.hooks.get(eventType) || []).slice();
    return [...this.hooks.entries()].flatMap(([type, hooks]) => hooks.map(hook => Object.assign({ eventType: type }, hook)));
  }

  runSync(eventType, context = {}) {
    const type = String(eventType || '').trim();
    const results = [];
    let ok = true;
    for (const hook of this.hooks.get(type) || []) {
      const started = Date.now();
      const mode = hook.mode || (hook.enabled === false ? 'dormant' : 'active');
      if (hook.enabled === false || mode === 'dormant') {
        const skipped = {
          id: hook.id,
          ok: true,
          skipped: true,
          mode: 'dormant',
          reason: hook.policyReason || 'dormant',
          incidentRefs: hook.incidentRefs || [],
          regressionTests: hook.regressionTests || [],
          duplicateOf: hook.duplicateOf || null,
        };
        results.push(skipped);
        if (this.emitDormantEvents) {
          emit(this.eventlog, 'hook.skipped', {
            hookId: hook.id,
            eventType: type,
            mode: skipped.mode,
            reason: skipped.reason,
            incidentRefs: skipped.incidentRefs,
            regressionTests: skipped.regressionTests,
            duplicateOf: skipped.duplicateOf,
          });
        }
        continue;
      }
      if (hook.condition && !hook.condition(context)) {
        const skipped = {
          id: hook.id,
          ok: true,
          skipped: true,
          mode,
          reason: 'condition_false',
          incidentRefs: hook.incidentRefs || [],
          regressionTests: hook.regressionTests || [],
        };
        results.push(skipped);
        emit(this.eventlog, 'hook.skipped', {
          hookId: hook.id,
          eventType: type,
          mode,
          reason: skipped.reason,
          incidentRefs: skipped.incidentRefs,
          regressionTests: skipped.regressionTests,
        });
        continue;
      }
      try {
        const output = hook.handler(context);
        if (output && typeof output.then === 'function') {
          throw new Error(`hook ${hook.id} returned a Promise in sync registry`);
        }
        const elapsedMs = Date.now() - started;
        const failureMode = hook.failureMode || 'warn';
        const outputFailed = output && typeof output === 'object' && output.ok === false;
        const result = {
          id: hook.id,
          ok: !outputFailed,
          observedOk: !outputFailed,
          elapsedMs,
          mode,
          shadow: mode === 'shadow',
          incidentRefs: hook.incidentRefs || [],
          regressionTests: hook.regressionTests || [],
          output: output || null,
        };
        if (outputFailed) {
          result.reason = output.reason || output.error || output.decision || 'hook returned ok=false';
          result.failureMode = failureMode;
        }
        if (Number(hook.timeoutMs || 0) > 0 && elapsedMs > Number(hook.timeoutMs)) {
          result.timeout = true;
          result.reason = result.reason || `hook exceeded ${hook.timeoutMs}ms budget`;
          if (failureMode === 'block') {
            result.ok = false;
            result.failureMode = failureMode;
          }
        }
        result.observedOk = result.ok !== false;
        if (mode === 'shadow' && result.ok === false) {
          result.ok = true;
          result.shadowFailure = true;
        }
        if (result.ok === false && failureMode === 'block' && mode === 'active') ok = false;
        results.push(result);
        emit(this.eventlog, 'hook.executed', {
          hookId: hook.id,
          eventType: type,
          ok: result.ok !== false,
          observedOk: result.observedOk !== false,
          mode,
          shadow: mode === 'shadow',
          elapsedMs,
          timeout: !!result.timeout,
          failureMode: result.observedOk === false ? failureMode : undefined,
          reason: result.observedOk === false ? result.reason : undefined,
          incidentRefs: result.incidentRefs,
          regressionTests: result.regressionTests,
        });
        if (result.observedOk === false) {
          emit(this.eventlog, 'gate.incident', {
            gateId: hook.id,
            eventType: type,
            mode,
            blocking: mode === 'active' && failureMode === 'block',
            reason: result.reason || 'hook validation failed',
            elapsedMs,
            incidentRefs: result.incidentRefs,
            regressionTests: result.regressionTests,
          });
        }
      } catch (e) {
        const elapsedMs = Date.now() - started;
        const failure = {
          id: hook.id,
          ok: false,
          observedOk: false,
          elapsedMs,
          mode,
          shadow: mode === 'shadow',
          incidentRefs: hook.incidentRefs || [],
          regressionTests: hook.regressionTests || [],
          reason: e && e.message || String(e),
          failureMode: hook.failureMode || 'warn',
        };
        if (mode === 'shadow') {
          failure.ok = true;
          failure.shadowFailure = true;
        }
        results.push(failure);
        emit(this.eventlog, 'hook.executed', {
          hookId: hook.id,
          eventType: type,
          ok: failure.ok !== false,
          observedOk: false,
          mode,
          shadow: mode === 'shadow',
          elapsedMs,
          failureMode: failure.failureMode,
          reason: failure.reason,
          incidentRefs: failure.incidentRefs,
          regressionTests: failure.regressionTests,
        });
        emit(this.eventlog, 'gate.incident', {
          gateId: hook.id,
          eventType: type,
          mode,
          blocking: mode === 'active' && failure.failureMode === 'block',
          reason: failure.reason,
          elapsedMs,
          incidentRefs: failure.incidentRefs,
          regressionTests: failure.regressionTests,
        });
        if (failure.failureMode === 'block' && mode === 'active') ok = false;
      }
    }
    return { ok, eventType: type, results };
  }
}

function normalizeRefs(value) {
  if (!value) return [];
  const refs = Array.isArray(value) ? value : [value];
  return refs.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizePolicy(value) {
  const source = value && value.gates && typeof value.gates === 'object'
    ? value.gates
    : value && typeof value === 'object'
      ? value
      : {};
  return new Map(Object.entries(source).map(([id, entry]) => [id, entry || {}]));
}

function emit(eventlog, type, data) {
  try {
    if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data || {});
  } catch (_) {}
}

module.exports = { HookRegistry, VALID_MODES };
