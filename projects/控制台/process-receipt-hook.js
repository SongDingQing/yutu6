'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const InteractionTrace = require('../../shared/engine/interaction-trace');
const ContractSchemaValidator = require('./process-receipt-schema-validator');

const CONFIG_SCHEMA = 'console-process-receipt-hook@1';
const PROCESS_SCHEMA = 'yutu6-process-summary-contract@2';
const PROCESS_SCHEMA_REF = 'projects/控制台/quality-ops/schemas/process-summary.contract.schema.json';
const RECEIPT_SCHEMA = 'yutu6-critical-action-receipt@1';
const RECEIPT_SCHEMA_REF = 'projects/控制台/quality-ops/schemas/critical-action-receipt.schema.json';
const SUMMARY_FILE = 'process-summary.contract.redacted.json';
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const PROCESS_SCHEMA_FILE = path.join(DEFAULT_WORKSPACE_ROOT, PROCESS_SCHEMA_REF);
const RECEIPT_SCHEMA_FILE = path.join(DEFAULT_WORKSPACE_ROOT, RECEIPT_SCHEMA_REF);
const DEFAULT_MAX_CHARS = 8192;
const MAX_ITEMS = 32;
const ACTION_KIND = new Set(['command', 'tool']);
const TERMINAL_STATUS = new Set(['completed', 'failed']);
const DEFAULT_ALLOWED_ACTIONS = new Set([
  'bash', 'claude', 'codex', 'git', 'hermes', 'mock', 'node', 'npm', 'npx',
  'openai_http', 'peekaboo', 'pnpm', 'python', 'python3', 'quality_ops_ingest',
  'quality_ops_schedule', 'quality_ops_weekly', 'sh', 'tool_harness', 'yarn', 'zsh',
]);
const DEFAULT_ALLOWED_PREFIXES = [
  'board/', 'memory/', 'projects/', 'shared/', 'templates/', 'tests/',
];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function serializedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, serializedJson(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function safeIdentifier(value, fallback = 'unavailable', max = 120) {
  const clean = InteractionTrace.redact(String(value == null ? '' : value))
    .replace(/[^\p{L}\p{N}._:+-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return clean || fallback;
}

function loadConfig(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const file = options.file || path.join(workspaceRoot, 'projects/控制台/config/process-receipts.json');
  return { file, config: readJson(file, null) };
}

function activationDecision(config, env = process.env) {
  if (!config || config.schema !== CONFIG_SCHEMA) return { active: false, reason: 'config_invalid' };
  if (String(env.CONSOLE_PROCESS_RECEIPTS || '').trim() === '0') return { active: false, reason: 'environment_kill_switch' };
  if (config.enabled !== true) return { active: false, reason: 'feature_disabled' };
  if (config.supervisorReviewed !== true) return { active: false, reason: 'supervisor_review_missing' };
  if (config.ownerApproved !== true) return { active: false, reason: 'owner_approval_missing' };
  return { active: true, reason: 'approved' };
}

function allowedActions(config = {}) {
  const values = Array.isArray(config.allowedActionNames) ? config.allowedActionNames : [];
  return new Set([...DEFAULT_ALLOWED_ACTIONS, ...values.map(value => safeIdentifier(value, ''))].filter(Boolean));
}

function allowedPrefixes(config = {}) {
  const values = Array.isArray(config.allowedEvidencePrefixes) ? config.allowedEvidencePrefixes : DEFAULT_ALLOWED_PREFIXES;
  return values.map(value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')).filter(Boolean);
}

function pathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function fileContainsLine(file, targetLine) {
  if (targetLine == null) return true;
  if (!Number.isInteger(targetLine) || targetLine < 1) return false;
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let line = 1;
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      for (let index = 0; index < bytesRead; index += 1) {
        if (line === targetLine) return true;
        if (buffer[index] === 10) line += 1;
      }
    }
    return false;
  } finally {
    fs.closeSync(descriptor);
  }
}

function workspaceEvidenceExists(filePart, workspaceRoot, lineNumber = null) {
  const root = path.resolve(workspaceRoot || DEFAULT_WORKSPACE_ROOT);
  const candidate = path.resolve(root, ...filePart.split('/'));
  if (!pathInsideRoot(candidate, root)) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (!pathInsideRoot(fs.realpathSync(candidate), fs.realpathSync(root))) return false;
    return fileContainsLine(candidate, lineNumber);
  } catch (_) {
    return false;
  }
}

function safeWorkspaceRef(value, config = {}, options = {}) {
  let text = InteractionTrace.redact(String(value == null ? '' : value)).trim();
  if (!text || path.isAbsolute(text) || text.includes('\0')) return null;
  text = text.replace(/\\/g, '/').replace(/^\.\//, '');
  const lineSuffix = /(:\d+|#L\d+)$/.exec(text);
  const suffix = lineSuffix ? lineSuffix[0] : '';
  const lineNumber = lineSuffix ? Number(lineSuffix[0].replace(/^:|^#L/, '')) : null;
  const filePart = suffix ? text.slice(0, -suffix.length) : text;
  const normalized = path.posix.normalize(filePart);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  if (/(^|\/)(?:\.env|auth\.json|credentials?|secrets?)(?:\.|\/|$)/i.test(normalized)) return null;
  if (!allowedPrefixes(config).some(prefix => normalized.startsWith(prefix))) return null;
  const ref = `${normalized}${suffix}`;
  if (ref.length > 320) return null;
  if (options.mustExist === true && !workspaceEvidenceExists(normalized, options.workspaceRoot, lineNumber)) return null;
  return ref;
}

function uniqueSafeRefs(values, config, max = MAX_ITEMS, options = {}) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const ref = safeWorkspaceRef(value, config, options);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
    if (out.length >= max) break;
  }
  return out;
}

function actionNameFor(runner, legacySummary, config = {}) {
  const kind = String(runner && runner.kind || legacySummary && legacySummary.command && legacySummary.command.runner_kind || 'cli');
  let candidate = '';
  if (kind === 'openai_http') candidate = 'openai_http';
  else if (kind === 'openai_http_tool_harness') candidate = 'tool_harness';
  else if (legacySummary && legacySummary.command) candidate = legacySummary.command.executable;
  else if (runner && Array.isArray(runner.cmd)) candidate = path.basename(String(runner.cmd[0] || ''));
  candidate = safeIdentifier(candidate.replace(/^__|__$/g, ''), '');
  if (candidate === 'openai_http_tool_harness') candidate = 'tool_harness';
  if (candidate === 'openai_http') candidate = 'openai_http';
  if (candidate === 'mock') candidate = 'mock';
  return allowedActions(config).has(candidate) ? candidate : null;
}

function structuredResultFiles(result) {
  const vars = result && result.vars && typeof result.vars === 'object' ? result.vars : {};
  const implementation = vars.implementation && typeof vars.implementation === 'object' ? vars.implementation : {};
  const receipt = implementation.receipt && typeof implementation.receipt === 'object' ? implementation.receipt : {};
  const logic = implementation.logic_chain && typeof implementation.logic_chain === 'object' ? implementation.logic_chain : {};
  const affected = [];
  const evidence = [];
  if (Array.isArray(implementation.changed_files)) affected.push(...implementation.changed_files);
  if (Array.isArray(receipt.changedFiles)) affected.push(...receipt.changedFiles);
  if (Array.isArray(receipt.artifacts)) evidence.push(...receipt.artifacts);
  if (Array.isArray(logic.evidence)) {
    for (const item of logic.evidence) if (item && item.path) evidence.push(item.path);
  }
  if (result && result.evidence && result.evidence.path) evidence.push(result.evidence.path);
  return { affected, evidence };
}

function securityBlock() {
  return {
    hidden_chain_of_thought_saved: false,
    raw_command_arguments_saved: false,
    raw_sensitive_output_saved: false,
    redaction_applied: true,
  };
}

function maxSummaryChars(config = {}) {
  const value = Number(config.maxSummaryChars || DEFAULT_MAX_CHARS);
  return Number.isInteger(value) && value >= 2048 && value <= 32768 ? value : DEFAULT_MAX_CHARS;
}

function schemaFileFor(kind) {
  return kind === 'receipt' ? RECEIPT_SCHEMA_FILE : PROCESS_SCHEMA_FILE;
}

function contractValidationErrors(value, kind = 'process', options = {}) {
  const errors = ContractSchemaValidator.validate(value, schemaFileFor(kind));
  const config = options.config || {};
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  for (const ref of Array.isArray(value && value.evidence_refs) ? value.evidence_refs : []) {
    if (safeWorkspaceRef(ref, config, { mustExist: true, workspaceRoot }) !== ref) {
      errors.push({ keyword: 'evidence_exists', path: '$.evidence_refs', message: 'evidence reference must resolve to a workspace file' });
    }
  }
  const declaredLimit = kind === 'receipt'
    ? value && value.limits && value.limits.max_receipt_chars
    : value && value.limits && value.limits.max_summary_chars;
  const configuredLimit = maxSummaryChars(config);
  if (Number.isInteger(declaredLimit) && declaredLimit !== configuredLimit) {
    errors.push({ keyword: 'configured_length', path: '$.limits', message: 'declared character limit must match the active configuration' });
  }
  if (serializedJson(value).length > configuredLimit) {
    errors.push({ keyword: 'serialized_length', path: '$', message: 'final persisted JSON exceeds the declared character limit' });
  }
  return errors;
}

function forceUnavailable(value, kind, reason) {
  value.availability = 'unavailable';
  value.unavailable_reason = reason;
  if (kind === 'receipt') value.action = null;
  else value.actions = [];
  value.affected_files = [];
  value.evidence_refs = [];
  return value;
}

function compactToLimit(summary, config = {}, kind = 'process', options = {}) {
  const limit = maxSummaryChars(config);
  const next = JSON.parse(JSON.stringify(summary));
  const minimumEvidence = next.availability === 'available' ? 1 : 0;
  while (serializedJson(next).length > limit && next.evidence_refs.length > minimumEvidence) next.evidence_refs.pop();
  while (serializedJson(next).length > limit && next.affected_files.length) next.affected_files.pop();
  if (serializedJson(next).length > limit || (next.availability === 'available' && !next.evidence_refs.length)) {
    forceUnavailable(next, kind, 'summary_length_limit');
  }
  if (serializedJson(next).length > limit) throw new Error('process receipt minimum contract exceeds configured limit');
  const errors = contractValidationErrors(next, kind, Object.assign({}, options, { config }));
  if (errors.length) {
    const keywords = [...new Set(errors.map(error => error.keyword))].slice(0, 6).join(',');
    throw new Error(`process receipt contract validation failed: ${keywords}`);
  }
  return next;
}

function buildProcessSummary(input = {}) {
  const config = input.config || {};
  const workspaceRoot = input.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : {};
  const legacy = input.legacySummary && typeof input.legacySummary === 'object' ? input.legacySummary : {};
  const resultFiles = structuredResultFiles(input.result);
  const runner = input.runner || {};
  const actionName = actionNameFor(runner, legacy, config);
  const exitCode = Number.isInteger(legacy.exit_code) ? legacy.exit_code
    : (Number.isInteger(input.exitCode) ? input.exitCode : null);
  let unavailableReason = null;
  if (!actionName) unavailableReason = 'action_not_allowlisted';
  else if (!Number.isInteger(exitCode)) unavailableReason = 'exit_code_unavailable';
  const evidence = uniqueSafeRefs([
    ...(Array.isArray(manifest.evidence_refs) ? manifest.evidence_refs : []),
    ...resultFiles.evidence,
  ], config, MAX_ITEMS, { mustExist: true, workspaceRoot });
  if (!unavailableReason && !evidence.length) unavailableReason = 'evidence_unavailable';
  const terminal = TERMINAL_STATUS.has(manifest.status) ? manifest.status
    : (input.result && input.result.fail ? 'failed' : 'completed');
  const summary = {
    schema: PROCESS_SCHEMA,
    schema_ref: PROCESS_SCHEMA_REF,
    generated_at: new Date(input.now || Date.now()).toISOString(),
    availability: unavailableReason ? 'unavailable' : 'available',
    unavailable_reason: unavailableReason,
    runner: {
      id: safeIdentifier(manifest.runner_id || input.runnerId, 'unavailable'),
      kind: safeIdentifier(manifest.runner_kind || runner.kind || 'cli', 'cli'),
    },
    actions: unavailableReason ? [] : [{
      kind: runner.kind === 'openai_http_tool_harness' ? 'tool' : 'command',
      name: actionName,
      exit_code: exitCode,
    }],
    affected_files: uniqueSafeRefs(resultFiles.affected, config),
    evidence_refs: evidence,
    final_state: terminal,
    security: securityBlock(),
    limits: {
      max_summary_chars: maxSummaryChars(config),
      max_items_per_list: MAX_ITEMS,
    },
  };
  return compactToLimit(summary, config, 'process', { workspaceRoot });
}

function listManifestFiles(root) {
  const out = [];
  function visit(dir, depth) {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (entry.isFile() && entry.name === 'interaction-trace.json') out.push(file);
    }
  }
  visit(root, 0);
  return out;
}

function attemptMatches(manifest, node, attempt) {
  return String(manifest && manifest.node_id || '') === String(node && node.id || '')
    && String(manifest && manifest.attempt || '') === String(attempt || '');
}

function resultBelongsToManifest(result, manifestFile) {
  const evidence = result && result.evidence && result.evidence.path;
  return evidence && path.resolve(path.dirname(evidence)) === path.resolve(path.dirname(manifestFile));
}

function finalizeRunnerSummaries(input = {}) {
  const config = input.config || {};
  const activation = input.activation || activationDecision(config, input.env);
  if (!activation.active) return { active: false, reason: activation.reason, files: [] };
  const files = [];
  const manifests = listManifestFiles(input.runsDir).filter(file => {
    const manifest = readJson(file, null);
    return manifest && attemptMatches(manifest, input.node, input.attempt);
  });
  for (const manifestFile of manifests) {
    const manifest = readJson(manifestFile, {});
    const legacySummary = readJson(path.join(path.dirname(manifestFile), 'process-summary.redacted.log'), null);
    const runner = input.runners && input.runners[manifest.runner_id] || { kind: manifest.runner_kind };
    const summary = buildProcessSummary({
      config,
      manifest,
      legacySummary,
      runner,
      runnerId: manifest.runner_id,
      result: resultBelongsToManifest(input.result, manifestFile) ? input.result : null,
      workspaceRoot: input.workspaceRoot,
    });
    const file = path.join(path.dirname(manifestFile), SUMMARY_FILE);
    atomicWriteJson(file, summary);
    files.push(file);
  }
  if (!files.length) {
    const dir = path.join(input.runsDir, 'process-summary-unavailable', `${safeIdentifier(input.node && input.node.id)}-${safeIdentifier(input.attempt)}`);
    const summary = buildProcessSummary({
      config,
      manifest: {
        node_id: input.node && input.node.id,
        attempt: input.attempt,
        runner_id: input.runnerId || 'unavailable',
        runner_kind: 'unavailable',
        status: input.result && input.result.fail ? 'failed' : 'completed',
        evidence_refs: [],
      },
      legacySummary: null,
      runner: {},
      result: null,
      workspaceRoot: input.workspaceRoot,
    });
    forceUnavailable(summary, 'process', 'runner_trace_unavailable');
    const finalizedSummary = compactToLimit(summary, config, 'process', { workspaceRoot: input.workspaceRoot });
    const file = path.join(dir, SUMMARY_FILE);
    atomicWriteJson(file, finalizedSummary);
    files.push(file);
  }
  return { active: true, reason: activation.reason, files };
}

function emitReceiptEvent(eventlog, type, data) {
  try { if (eventlog) eventlog.emit(type, data); } catch (_) {}
}

function makeProcessReceiptRunner(baseRunner, options = {}) {
  if (typeof baseRunner !== 'function') throw new Error('process receipt hook requires a runner function');
  const loaded = options.config ? { config: options.config, file: null } : loadConfig({ workspaceRoot: options.workspaceRoot });
  const activation = activationDecision(loaded.config, options.env);
  emitReceiptEvent(options.eventlog, 'process.receipt.activation', {
    task: options.taskId || null,
    active: activation.active,
    reason: activation.reason,
    projectId: options.projectId || null,
  });
  if (!activation.active) return baseRunner;
  function finalize(node, ctx, attempt, result) {
    try {
      const finalized = finalizeRunnerSummaries({
        config: loaded.config,
        activation,
        env: options.env,
        runsDir: options.runsDir,
        runners: options.runners,
        workspaceRoot: options.workspaceRoot,
        runnerId: options.roleMap && options.roleMap[node && node.agent_role],
        node,
        attempt,
        result,
      });
      emitReceiptEvent(options.eventlog, 'process.summary.recorded', {
        task: options.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        attempt,
        count: finalized.files.length,
        projectId: options.projectId || null,
      });
    } catch (_) {
      emitReceiptEvent(options.eventlog, 'process.summary.unavailable', {
        task: options.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        attempt,
        reason: 'summary_writer_error',
        projectId: options.projectId || null,
      });
    }
    return result;
  }
  const wrapped = function processReceiptRunner(node, ctx, attempt) {
    try { return finalize(node, ctx, attempt, baseRunner(node, ctx, attempt)); }
    catch (error) {
      finalize(node, ctx, attempt, { fail: 'runner_exception' });
      throw error;
    }
  };
  if (typeof baseRunner.runNodeAsync === 'function') {
    wrapped.runNodeAsync = async (node, ctx, attempt) => {
      try { return finalize(node, ctx, attempt, await baseRunner.runNodeAsync(node, ctx, attempt)); }
      catch (error) {
        finalize(node, ctx, attempt, { fail: 'runner_exception' });
        throw error;
      }
    };
  }
  if (typeof baseRunner.runBoardNodeAsync === 'function') {
    wrapped.runBoardNodeAsync = async (node, ctx, attempt) => {
      try { return finalize(node, ctx, attempt, await baseRunner.runBoardNodeAsync(node, ctx, attempt)); }
      catch (error) {
        finalize(node, ctx, attempt, { fail: 'runner_exception' });
        throw error;
      }
    };
  }
  return wrapped;
}

function buildCriticalActionReceipt(input = {}) {
  const config = input.config || {};
  const workspaceRoot = input.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  const name = safeIdentifier(input.actionName, '');
  const actionAllowed = allowedActions(config).has(name);
  const exitCode = Number.isInteger(input.exitCode) ? input.exitCode : null;
  const evidence = uniqueSafeRefs(input.evidenceRefs, config, MAX_ITEMS, { mustExist: true, workspaceRoot });
  let unavailableReason = null;
  if (!actionAllowed) unavailableReason = 'action_not_allowlisted';
  else if (!Number.isInteger(exitCode)) unavailableReason = 'exit_code_unavailable';
  else if (!evidence.length) unavailableReason = 'evidence_unavailable';
  const receipt = {
    schema: RECEIPT_SCHEMA,
    schema_ref: RECEIPT_SCHEMA_REF,
    receipt_id: `receipt-${sha256(`${name}|${input.taskId || ''}|${input.actionId || ''}|${input.now || Date.now()}`).slice(0, 24)}`,
    generated_at: new Date(input.now || Date.now()).toISOString(),
    task_id: safeIdentifier(input.taskId, 'unavailable'),
    availability: unavailableReason ? 'unavailable' : 'available',
    unavailable_reason: unavailableReason,
    action: unavailableReason ? null : {
      kind: ACTION_KIND.has(input.actionKind) ? input.actionKind : 'tool',
      name,
      exit_code: exitCode,
    },
    affected_files: uniqueSafeRefs(input.affectedFiles, config),
    evidence_refs: evidence,
    final_state: input.finalState === 'failed' || exitCode !== 0 ? 'failed' : 'completed',
    security: securityBlock(),
    limits: {
      max_receipt_chars: maxSummaryChars(config),
      max_items_per_list: MAX_ITEMS,
    },
  };
  return compactToLimit(receipt, config, 'receipt', { workspaceRoot });
}

function writeCriticalActionReceipt(input = {}) {
  const loaded = input.config ? { config: input.config } : loadConfig({ workspaceRoot: input.workspaceRoot });
  const activation = input.activation || activationDecision(loaded.config, input.env);
  if (!activation.active) return { active: false, reason: activation.reason, file: null, receipt: null };
  const receipt = buildCriticalActionReceipt(Object.assign({}, input, { config: loaded.config }));
  const root = path.resolve(input.receiptsRoot);
  const actionDir = safeIdentifier(input.actionName);
  const file = path.join(root, actionDir, `${receipt.receipt_id}.json`);
  atomicWriteJson(file, receipt);
  return { active: true, reason: activation.reason, file, receipt };
}

function contractShapeValid(value, kind = 'process', options = {}) {
  return contractValidationErrors(value, kind, options).length === 0;
}

module.exports = {
  CONFIG_SCHEMA,
  PROCESS_SCHEMA,
  RECEIPT_SCHEMA,
  SUMMARY_FILE,
  loadConfig,
  activationDecision,
  actionNameFor,
  safeWorkspaceRef,
  buildProcessSummary,
  buildCriticalActionReceipt,
  finalizeRunnerSummaries,
  makeProcessReceiptRunner,
  writeCriticalActionReceipt,
  contractValidationErrors,
  contractShapeValid,
  _test: {
    atomicWriteJson,
    serializedJson,
    compactToLimit,
    listManifestFiles,
    structuredResultFiles,
    maxSummaryChars,
    workspaceEvidenceExists,
  },
};
