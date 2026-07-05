'use strict';

const DoneGate = require('../../shared/engine/done-gate');
const ProtocolGate = require('../../shared/engine/protocol-gate');

const DONE_GATE_META_HOOK_ID = 'console.done_gate_meta';
const PROTOCOL_GATE_HOOK_ID = 'console.protocol_gate';
const HARD_REGRESSION_HOOK_ID = 'console.hard_regression_coverage';

function varsFromEvent(event) {
  if (event && event.ctx && typeof event.ctx === 'object') return event.ctx;
  if (event && event.task && event.task.vars && typeof event.task.vars === 'object') return event.task.vars;
  return {};
}

function requireDoneGateMeta(event) {
  if (!event || event.flow !== 'review-loop') {
    throw new Error('hardening meta hook only accepts review-loop true_done events');
  }
  if (!event.gate || event.gate.ok !== true) {
    throw new Error('task.true_done reached without a passing DoneGate result');
  }
  return {
    ok: true,
    gate: 'shared/engine/done-gate.validateReviewLoopCompletion',
  };
}

function requireHardRegressionCoverage(event, opts = {}) {
  const vars = varsFromEvent(event);
  const result = DoneGate.validateHardRegressionCoverage(vars, {
    workspaceRoot: opts.workspaceRoot || event && event.workspaceRoot || process.cwd(),
  });
  if (!result.ok) {
    const err = new Error(result.reason || 'hard regression coverage failed');
    err.details = result;
    throw err;
  }
  return {
    ok: true,
    required: result.required || [],
  };
}

function requireProtocolGate(event, opts = {}) {
  const task = event && event.task || {
    id: event && (event.taskId || event.task_id || event.task) || null,
    flow: event && event.flow || 'review-loop',
    state: 'done',
    vars: varsFromEvent(event),
  };
  const result = ProtocolGate.validateCompletionProtocol(task, {
    workspaceRoot: opts.workspaceRoot || event && event.workspaceRoot || process.cwd(),
    projectId: event && event.projectId,
  });
  if (!result.ok) {
    const err = new Error(result.reason || 'protocol gate failed');
    err.details = result;
    throw err;
  }
  return {
    ok: true,
    skipped: !!result.skipped,
    spec: result.spec || null,
  };
}

function registerHardeningHooks(registry, opts = {}) {
  registry.register('task.true_done', {
    id: DONE_GATE_META_HOOK_ID,
    priority: 10,
    enabled: opts.enabled !== false,
    timeoutMs: opts.metaTimeoutMs || 50,
    failureMode: 'block',
    handler(event) {
      return requireDoneGateMeta(event);
    },
  });
  registry.register('task.true_done', {
    id: PROTOCOL_GATE_HOOK_ID,
    priority: 15,
    enabled: opts.enabled !== false,
    timeoutMs: opts.protocolTimeoutMs || 100,
    failureMode: 'block',
    handler(event) {
      return requireProtocolGate(event, opts);
    },
  });
  registry.register('task.true_done', {
    id: HARD_REGRESSION_HOOK_ID,
    priority: 20,
    enabled: opts.enabled !== false,
    timeoutMs: opts.regressionTimeoutMs || 100,
    failureMode: 'block',
    handler(event) {
      return requireHardRegressionCoverage(event, opts);
    },
  });
  return registry;
}

module.exports = {
  DONE_GATE_META_HOOK_ID,
  PROTOCOL_GATE_HOOK_ID,
  HARD_REGRESSION_HOOK_ID,
  requireDoneGateMeta,
  requireProtocolGate,
  requireHardRegressionCoverage,
  registerHardeningHooks,
};
