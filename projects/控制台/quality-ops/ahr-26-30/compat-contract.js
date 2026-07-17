'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOOK_EVENT_SCHEMA = 'yutu6.hook-event@1';

const TOOL_ALIASES = Object.freeze({
  'file.read': ['file.read', 'read', 'open_file', 'read_file'],
  'file.search': ['file.search', 'grep', 'glob', 'search', 'scan'],
  'file.mutate': ['file.mutate', 'edit', 'write', 'multi_edit', 'edit_file', 'write_file', 'apply_patch', 'patch'],
  'command.run': ['command.run', 'bash', 'shell', 'shell_command', 'exec', 'exec_command', 'run_command'],
  'web.fetch': ['web.fetch', 'web_fetch', 'fetch_url'],
  'web.search': ['web.search', 'web_search', 'search_query'],
});

const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(TOOL_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(normalizeToken(alias), canonical);
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function canonicalToolName(value) {
  const resolved = resolveToolAlias(value);
  if (!resolved.matched) throw new Error(`unknown tool alias: ${value}`);
  return resolved.canonicalName;
}

function resolveToolAlias(value) {
  const originalName = String(value || '').trim();
  if (!originalName) throw new Error('tool name is required');
  const canonicalName = ALIAS_TO_CANONICAL.get(normalizeToken(originalName));
  return canonicalName
    ? { originalName, canonicalName, matched: true }
    : { originalName, canonicalName: originalName, matched: false };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeArtifactRef(file, workspaceRoot, options = {}) {
  if (!file) throw new Error('artifact path is required');
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const candidate = path.resolve(root, String(file));
  if (!isWithin(root, candidate)) throw new Error(`artifact path escapes workspace: ${file}`);
  if (options.requireExists !== false && !fs.existsSync(candidate)) {
    throw new Error(`artifact path does not exist: ${candidate}`);
  }
  const absolutePath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (!isWithin(root, absolutePath)) throw new Error(`artifact realpath escapes workspace: ${file}`);
  return {
    absolutePath,
    artifactId: `artifact:path-sha256:${sha256(absolutePath)}`,
  };
}

function firstDefined(input, ...keys) {
  for (const key of keys) {
    if (input[key] != null) return input[key];
  }
  return undefined;
}

function requiredString(value, field) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function normalizePhase(value) {
  const phase = normalizeToken(value);
  if (['pre', 'pre_tool', 'pre_tool_use', 'before_tool_use'].includes(phase)) return 'pre';
  if (['post', 'post_tool', 'post_tool_use', 'after_tool_use'].includes(phase)) return 'post';
  throw new Error(`unsupported hook phase: ${value}`);
}

function normalizeHookEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook event must be an object');
  const schemaVersion = requiredString(firstDefined(input, 'schemaVersion', 'schema_version'), 'schemaVersion');
  if (schemaVersion !== HOOK_EVENT_SCHEMA) throw new Error(`unsupported schemaVersion: ${schemaVersion}`);
  const event = {
    schemaVersion,
    phase: normalizePhase(firstDefined(input, 'phase', 'eventType', 'event_type')),
    requestId: requiredString(firstDefined(input, 'requestId', 'request_id'), 'requestId'),
    taskId: requiredString(firstDefined(input, 'taskId', 'task_id'), 'taskId'),
    toolCallId: requiredString(firstDefined(input, 'toolCallId', 'tool_call_id'), 'toolCallId'),
    toolName: canonicalToolName(firstDefined(input, 'toolName', 'tool_name', 'tool')),
  };
  if (input.arguments != null) event.arguments = input.arguments;
  if (input.argumentsPatch != null || input.arguments_patch != null) {
    event.argumentsPatch = firstDefined(input, 'argumentsPatch', 'arguments_patch');
  }
  if (input.policyDecision != null || input.policy_decision != null) {
    event.policyDecision = firstDefined(input, 'policyDecision', 'policy_decision');
  }
  if (input.outcome != null) event.outcome = input.outcome;
  if (input.evidenceRefs != null || input.evidence_refs != null) {
    event.evidenceRefs = firstDefined(input, 'evidenceRefs', 'evidence_refs');
  }
  assertPhaseResponsibilities(event);
  return event;
}

function assertPhaseResponsibilities(event) {
  if (event.phase === 'pre') {
    if (event.outcome != null || event.evidenceRefs != null) {
      throw new Error('pre hook may gate policy/arguments but may not record outcome/evidence');
    }
    return true;
  }
  if (event.policyDecision != null || event.argumentsPatch != null) {
    throw new Error('post hook may record outcome/evidence but may not gate policy or rewrite arguments');
  }
  if (!event.outcome || typeof event.outcome !== 'object') throw new Error('post hook outcome is required');
  return true;
}

function validateHookPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('hook policy must be an object');
  if (!['warn', 'block'].includes(policy.failureMode)) throw new Error('failureMode must be warn or block');
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');
  const allowedDegradation = new Set(['continue_with_warning', 'skip', 'fallback', 'block', 'kill_isolated_worker']);
  if (!allowedDegradation.has(policy.degradationMode)) throw new Error('degradationMode is required and unsupported');
  return {
    failureMode: policy.failureMode,
    timeoutMs: policy.timeoutMs,
    degradationMode: policy.degradationMode,
  };
}

function approvalAllowsGlobalSwitch(approval, requiredTaskId) {
  return Boolean(
    approval &&
    approval.status === 'approved' &&
    approval.taskId === requiredTaskId &&
    Array.isArray(approval.approvedScope) && approval.approvedScope.length > 0 &&
    typeof approval.rollbackPlan === 'string' && approval.rollbackPlan.trim()
  );
}

module.exports = {
  HOOK_EVENT_SCHEMA,
  TOOL_ALIASES,
  canonicalToolName,
  resolveToolAlias,
  normalizeArtifactRef,
  normalizeHookEvent,
  assertPhaseResponsibilities,
  validateHookPolicy,
  approvalAllowsGlobalSwitch,
};
