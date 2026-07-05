'use strict';

class HookRegistry {
  constructor(opts = {}) {
    this.eventlog = opts.eventlog || null;
    this.hooks = new Map();
  }

  register(eventType, hook) {
    const type = String(eventType || '').trim();
    if (!type) throw new Error('hook eventType is required');
    if (!hook || typeof hook.handler !== 'function') throw new Error(`hook handler is required for ${type}`);
    const id = String(hook.id || '').trim();
    if (!id) throw new Error(`hook id is required for ${type}`);
    const list = this.hooks.get(type) || [];
    if (list.some(item => item.id === id)) throw new Error(`duplicate hook id for ${type}: ${id}`);
    list.push(Object.assign({
      enabled: true,
      priority: 100,
      timeoutMs: 100,
      failureMode: 'warn',
    }, hook, { id }));
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
      if (hook.enabled === false) {
        results.push({ id: hook.id, ok: true, skipped: true, reason: 'disabled' });
        continue;
      }
      if (hook.condition && !hook.condition(context)) {
        results.push({ id: hook.id, ok: true, skipped: true, reason: 'condition_false' });
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
        const result = { id: hook.id, ok: !outputFailed, elapsedMs, output: output || null };
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
        if (result.ok === false && failureMode === 'block') ok = false;
        results.push(result);
        emit(this.eventlog, 'hook.executed', {
          hookId: hook.id,
          eventType: type,
          ok: result.ok !== false,
          elapsedMs,
          timeout: !!result.timeout,
          failureMode: result.ok === false ? failureMode : undefined,
          reason: result.ok === false ? result.reason : undefined,
        });
      } catch (e) {
        const elapsedMs = Date.now() - started;
        const failure = {
          id: hook.id,
          ok: false,
          elapsedMs,
          reason: e && e.message || String(e),
          failureMode: hook.failureMode || 'warn',
        };
        results.push(failure);
        emit(this.eventlog, 'hook.executed', {
          hookId: hook.id,
          eventType: type,
          ok: false,
          elapsedMs,
          failureMode: failure.failureMode,
          reason: failure.reason,
        });
        if (failure.failureMode === 'block') ok = false;
      }
    }
    return { ok, eventType: type, results };
  }
}

function emit(eventlog, type, data) {
  try {
    if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data || {});
  } catch (_) {}
}

module.exports = { HookRegistry };
