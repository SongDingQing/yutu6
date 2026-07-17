'use strict';

/*
 * interaction-trace:为质量运营保存可审计的“可观察处理记录”。
 *
 * 原始 task.md/result.md/process.log 仍由 cli-runner 保管；本模块只补充：
 * - 脱敏副本，供质量运营读取；
 * - 小型 JSON 索引，串起 root task、交接、角色、runner 和证据；
 * - 明确不记录模型隐藏思维链，只记录显式 prompt、输出、工具日志引用与决策摘要。
 *
 * 任一记录失败均 fail-open，绝不影响任务执行。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'yutu6-interaction-trace@1';
const INDEX_SCHEMA = 'yutu6-interaction-index-event@1';
const PROCESS_SUMMARY_SCHEMA = 'yutu6-process-summary-redacted@1';
const WARNING_SCHEMA = 'yutu6-observability-warning@1';
const HOOK_ERROR_SCHEMA = 'yutu6-trace-hook-error@1';
const PROCESS_SUMMARY_SCHEMA_FILE = path.resolve(
  __dirname,
  '../../projects/控制台/quality-ops/schemas/process-summary.redacted.schema.json',
);
const PROCESS_TAIL_MAX = 32 * 1024;
const EXCERPT_MAX = 2400;
const TARGET_SUMMARY_MAX = 900;
const LOCK_WAIT_MS = 5;
const LOCK_RETRIES = 40;
const PLACEHOLDER_VALUE_RE = /^(?:n\s*\/\s*a|na|none|null|略|声明|待补|稍后补|见上|同上|[-—]+)$/i;
const MUTATION_NODE_RE = /^(?:implement|execute|repair|release|deploy|publish|build)(?:[-_.:]|$)/i;
const MUTATION_ROLES = new Set(['worker_code', 'frontend_designer', 'it_engineer', 'repair']);
const MUTATION_TAGS = new Set(['write', 'mutation', 'mutating', 'publish', 'release', 'deploy', 'build', 'repair']);
const MUTATION_EXECUTABLES = new Set([
  'bash', 'sh', 'zsh', 'git', 'npm', 'npx', 'pnpm', 'yarn', 'node',
  'codex', 'claude', 'claude-code', 'python', 'python3', 'rsync', 'scp',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function redact(text) {
  return String(text || '')
    .replace(/-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/(\bBasic\s+)[A-Za-z0-9+/=._-]{4,}/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\b((?:https?|ssh|git):\/\/)(?:[^/\s:@]+):(?:[^@/\s]+)@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:access_?token|api_?key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:ANTHROPIC|OPENAI|MINIMAX|DEEPSEEK|ZHIPU|FEISHU|MEOWART|NEW_API|BRAVE)?_?(?:API_?KEY|TOKEN|SECRET|PASSWORD|COOKIE|PRIVATE_?KEY)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}\]]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|token|secret|password|cookie|private[_-]?key)"\s*:\s*")[^"]+("?)/gi, '$1[REDACTED]$2')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,})\b/gi, '[REDACTED_CREDENTIAL]')
    .replace(/\b(?:sk|ma_live|glm|ds)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_CREDENTIAL]');
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function appendJsonLine(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = Buffer.from(`${JSON.stringify(data)}\n`, 'utf8');
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try { fs.writeSync(fd, line, 0, line.length); }
  finally { fs.closeSync(fd); }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (_) {}
}

function withFileLock(file, fn) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd = null;
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (ageMs > 30000) fs.unlinkSync(lockFile);
      } catch (_) {}
      sleepSync(LOCK_WAIT_MS);
    }
  }
  if (fd == null) throw new Error(`trace lock timeout: ${path.basename(file)}`);
  try { return fn(); }
  finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

function relativeToWorkspace(file, workdir) {
  if (!file) return null;
  const root = path.resolve(workdir || process.cwd());
  const absolute = path.resolve(file);
  const rel = path.relative(root, absolute);
  return rel && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    ? rel.split(path.sep).join('/')
    : absolute;
}

function traceRoot(opts) {
  if (opts && opts.traceRoot) return path.resolve(opts.traceRoot);
  if (opts && opts.queueRoot) return path.join(path.resolve(opts.queueRoot), 'quality-ops', 'traces');
  if (opts && opts.runsDir) {
    // <artifacts>/engine-runs/<taskId> -> <artifacts>/quality-ops/traces
    return path.join(path.dirname(path.dirname(path.resolve(opts.runsDir))), 'quality-ops', 'traces');
  }
  return path.resolve('artifacts', 'quality-ops', 'traces');
}

function rootHandoff(opts) {
  const meta = readJson(path.join(opts.runsDir || path.dirname(opts.dir || ''), 'meta.json')) || {};
  const envelopeSpecFingerprint = opts.ctx && opts.ctx.spec_fingerprint || null;
  return {
    from: meta.from || opts.queueAgent || null,
    to: meta.to || opts.queueAgent || null,
    // The task protocol fingerprint carried by the live envelope is canonical.
    // meta.json is checked separately so a stale handoff cannot silently replace it.
    spec_fingerprint: envelopeSpecFingerprint || meta.spec_fingerprint || null,
  };
}

function runnerParticipants(runnerId, runner) {
  const values = [runnerId];
  if (runner && runner.kind === 'openai_http_tool_harness') {
    values.push(runner.modelRunner || runner.plannerRunner || runner.textRunner);
    values.push(runner.executorRunner || runner.toolExecutorRunner);
  }
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function traceIdentity(opts) {
  const ctx = opts.ctx || {};
  const taskId = opts.taskId || ctx.taskId || null;
  const rootTaskId = ctx.rootTaskId || opts.rootTaskId || taskId;
  const rootQueueAgent = ctx.rootQueueAgent || opts.rootQueueAgent || opts.queueAgent || null;
  const rootQueueId = ctx.rootQueueId || opts.rootQueueId || opts.queueId || null;
  const chainSeed = [rootTaskId, rootQueueAgent, rootQueueId].filter(Boolean).join('|') || taskId || 'unknown';
  const spanSeed = [taskId, opts.node && opts.node.id, opts.attempt, opts.runnerId, opts.dir].join('|');
  return {
    chain_id: `chain-${sha256(chainSeed).slice(0, 20)}`,
    trace_id: `trace-${sha256(spanSeed).slice(0, 24)}`,
    root_task_id: rootTaskId,
    root_queue_agent: rootQueueAgent,
    root_queue_id: rootQueueId,
    task_id: taskId,
  };
}

function emit(opts, type, data) {
  try {
    if (opts.eventlog) opts.eventlog.emit(type, data);
  } catch (_) {}
}

function compact(text, max = EXCERPT_MAX) {
  const clean = redact(text).replace(/\r/g, '').trim();
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  if (clean.length <= limit) return clean;
  const marker = '\n...[truncated]...\n';
  if (limit <= marker.length) return marker.slice(0, limit);
  const contentBudget = limit - marker.length;
  const headLength = Math.floor(contentBudget * 0.6);
  const tailLength = contentBudget - headLength;
  return `${clean.slice(0, headLength)}${marker}${clean.slice(-tailLength)}`;
}

function boundedCompleteLineTail(text, max = PROCESS_TAIL_MAX) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const tail = value.slice(-max);
  // The cut may land inside a credential. Never expose that partial log line to redaction or output.
  const firstLineBreak = tail.indexOf('\n');
  return firstLineBreak >= 0 ? tail.slice(firstLineBreak + 1) : '';
}

function meaningfulText(value, minLength = 2) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const placeholderCandidate = text
    .replace(/^[\s|,;，；、:：.!?。！？()（）\[\]{}<>《》`"'“”‘’]+/, '')
    .replace(/[\s|,;，；、:：.!?。！？()（）\[\]{}<>《》`"'“”‘’]+$/, '')
    .trim();
  return text.length >= minLength
    && placeholderCandidate.length >= minLength
    && !PLACEHOLDER_VALUE_RE.test(placeholderCandidate);
}

function jsonSchemaTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function schemaValuesEqual(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch (_) { return false; }
}

function resolveLocalSchemaRef(rootSchema, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let current = rootSchema;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return current;
}

function isValidRfc3339DateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] == null ? 0 : Number(match[8]);
  const offsetMinute = match[9] == null ? 0 : Number(match[9]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function validateJsonSchema(value, schema, rootSchema = schema, instancePath = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return [{ keyword: 'schema', path: instancePath, message: '校验 schema 无效' }];
  }
  function add(keyword, message, at = instancePath) {
    errors.push({ keyword, path: at, message });
  }
  if (schema.$ref) {
    const target = resolveLocalSchemaRef(rootSchema, schema.$ref);
    if (!target) add('ref', `无法解析 ${schema.$ref}`);
    else errors.push(...validateJsonSchema(value, target, rootSchema, instancePath));
    return errors;
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some(type => jsonSchemaTypeMatches(value, type))) {
      add('type', `必须为 ${allowed.join('|')}`);
      return errors;
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !schemaValuesEqual(value, schema.const)) {
    add('const', `必须等于 ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(item => schemaValuesEqual(value, item))) {
    add('enum', `必须为 ${schema.enum.map(item => JSON.stringify(item)).join('|')}`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) errors.push(...validateJsonSchema(value, child, rootSchema, instancePath));
  }
  if (schema.if) {
    const conditionMatches = validateJsonSchema(value, schema.if, rootSchema, instancePath).length === 0;
    if (conditionMatches && schema.then) errors.push(...validateJsonSchema(value, schema.then, rootSchema, instancePath));
    if (!conditionMatches && schema.else) errors.push(...validateJsonSchema(value, schema.else, rootSchema, instancePath));
  }
  if (schema.not && validateJsonSchema(value, schema.not, rootSchema, instancePath).length === 0) {
    add('not', '命中禁止的值模式');
  }
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) add('min_length', `长度不得小于 ${schema.minLength}`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) add('max_length', `长度不得大于 ${schema.maxLength}`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) add('pattern', '不匹配要求的字符串模式');
      } catch (_) { add('schema', '字符串 pattern 无效'); }
    }
    if (schema.format === 'date-time') {
      if (!isValidRfc3339DateTime(value)) add('format', '必须为有效 RFC3339 date-time');
    }
  }
  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, schema.items, rootSchema, `${instancePath}[${index}]`));
      });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        let key;
        try { key = JSON.stringify(item); } catch (_) { key = String(item); }
        if (seen.has(key)) {
          add('unique_items', '数组元素必须唯一');
          break;
        }
        seen.add(key);
      }
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) add('required', `缺少必填字段 ${key}`, instancePath);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateJsonSchema(value[key], childSchema, rootSchema, `${instancePath}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) add('additional_properties', `不允许额外字段 ${key}`, `${instancePath}.${key}`);
      }
    }
  }
  return errors;
}

let cachedProcessSummarySchema = null;
function loadProcessSummarySchema() {
  if (!cachedProcessSummarySchema) cachedProcessSummarySchema = readJson(PROCESS_SUMMARY_SCHEMA_FILE);
  return cachedProcessSummarySchema;
}

function safeIdentifier(value, fallback) {
  const clean = redact(value == null ? '' : value)
    .replace(/[^\p{L}\p{N}._@:+-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

function commandMetadata(opts = {}) {
  const runner = opts.runner || {};
  const command = Array.isArray(runner.cmd) ? runner.cmd : [];
  const runnerKind = safeIdentifier(runner.kind || 'cli', 'cli');
  let executable = command[0] ? path.basename(String(command[0])) : '';
  if (!executable && runnerKind === 'openai_http') executable = 'openai_http';
  if (!executable && runnerKind === 'openai_http_tool_harness') executable = 'tool_harness';
  executable = safeIdentifier(executable || opts.runnerId, 'unknown_runner');
  return {
    operation: 'runner.execute',
    runner_id: safeIdentifier(opts.runnerId, 'unknown_runner'),
    runner_kind: runnerKind,
    executable,
    arguments_recorded: false,
  };
}

function structuredTags(ctx = {}) {
  const values = [ctx.task_type, ctx.taskType, ctx.category];
  for (const field of [ctx.tags, ctx.task_tags, ctx.taskTags]) {
    if (Array.isArray(field)) values.push(...field);
    else if (typeof field === 'string') values.push(...field.split(/[,;\s]+/));
  }
  return values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function taskClassification(opts = {}, command = commandMetadata(opts)) {
  const ctx = opts.ctx || {};
  const node = opts.node || {};
  const role = String(node.agent_role || '');
  const tags = structuredTags(ctx);
  const labelSources = [];
  if (MUTATION_NODE_RE.test(String(node.id || ''))) labelSources.push(`node:${node.id}`);
  if (MUTATION_ROLES.has(role)) labelSources.push(`role:${role}`);
  for (const tag of tags) if (MUTATION_TAGS.has(tag)) labelSources.push(`tag:${tag}`);
  const capabilitySources = [];
  if (command.runner_kind === 'openai_http_tool_harness') capabilitySources.push('runner_kind:openai_http_tool_harness');
  if (MUTATION_EXECUTABLES.has(String(command.executable || '').toLowerCase())) {
    capabilitySources.push(`executable:${command.executable}`);
  }
  const publish = labelSources.some(source => /(?:publish|release|deploy|build|it_engineer)/i.test(source));
  const requires = labelSources.length > 0 && capabilitySources.length > 0;
  return {
    rule_version: 'write-publish-dual-factor@1',
    kind: requires ? (publish ? 'publish' : 'write') : 'read_or_analysis',
    requires_structured_process_summary: requires,
    label_factor: { matched: labelSources.length > 0, sources: labelSources },
    command_or_path_factor: { matched: capabilitySources.length > 0, sources: capabilitySources },
  };
}

function taskTargetSummary(opts = {}) {
  const ctx = opts.ctx || {};
  return compact(ctx.target_summary || ctx.targetSummary || ctx.goal || '', TARGET_SUMMARY_MAX);
}

function resultTargetSummary(record, result) {
  const vars = result && result.vars || {};
  const implementation = vars.implementation && typeof vars.implementation === 'object'
    ? vars.implementation : {};
  const receipt = implementation.receipt && typeof implementation.receipt === 'object'
    ? implementation.receipt : {};
  const changed = Array.isArray(implementation.changed_files) ? implementation.changed_files
    : (Array.isArray(receipt.changedFiles) ? receipt.changedFiles : []);
  if (changed.length) {
    const safePaths = changed.slice(0, 16)
      .map(item => compact(item, 180))
      .filter(item => meaningfulText(item));
    if (safePaths.length) return compact(`目标文件: ${safePaths.join(', ')}`, TARGET_SUMMARY_MAX);
  }
  return compact(record.task_target_summary || '', TARGET_SUMMARY_MAX);
}

function makeProcessSummary(record, opts = {}) {
  const stderr = String(opts.stderr || '');
  const safeStderrTail = boundedCompleteLineTail(stderr, PROCESS_TAIL_MAX);
  return {
    schema: PROCESS_SUMMARY_SCHEMA,
    schema_ref: 'projects/控制台/quality-ops/schemas/process-summary.redacted.schema.json',
    generated_at: new Date().toISOString(),
    classification: record.task_classification,
    command: record.command,
    exit_code: Number.isInteger(opts.exitCode) ? opts.exitCode : null,
    target_summary: resultTargetSummary(record, opts.result),
    final_state: record.status,
    safe_output_summary: safeStderrTail ? compact(safeStderrTail, EXCERPT_MAX) : null,
    limits: {
      raw_command_arguments_recorded: false,
      output_tail_input_chars: PROCESS_TAIL_MAX,
      safe_output_summary_max_chars: EXCERPT_MAX,
      target_summary_max_chars: TARGET_SUMMARY_MAX,
      redaction_applied: true,
    },
  };
}

function warningRecord(warning) {
  const code = safeIdentifier(warning && warning.code, 'trace_integrity_unknown');
  const artifact = safeIdentifier(warning && warning.artifact, 'trace');
  const detail = compact(warning && warning.detail || code, 500);
  return {
    schema: WARNING_SCHEMA,
    id: `warning-${sha256(`${code}|${artifact}|${detail}`).slice(0, 20)}`,
    code,
    artifact,
    detail,
    severity: 'warning',
    audit_effect: 'quality_audit_no_pass',
    recorded_at: new Date().toISOString(),
  };
}

function mergeObservabilityWarnings(manifestFile, warnings, patch = {}) {
  const normalized = (Array.isArray(warnings) ? warnings : []).map(warningRecord);
  const warningFile = path.join(path.dirname(manifestFile), 'observability-warnings.jsonl');
  for (const warning of normalized) appendJsonLine(warningFile, warning);
  return withFileLock(manifestFile, () => {
    const manifest = readJson(manifestFile) || {};
    const existing = Array.isArray(manifest.observability_warning)
      ? manifest.observability_warning.map(warningRecord) : [];
    const byId = new Map(existing.map(item => [item.id, item]));
    for (const item of normalized) byId.set(item.id, item);
    const merged = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
    const next = Object.assign({}, manifest, patch, {
      observability_status: merged.length ? 'warning' : (patch.observability_status || 'ok'),
      observability_warning: merged,
    });
    atomicWrite(manifestFile, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

function inspectTraceIntegrity(manifestFile) {
  const dir = path.dirname(manifestFile);
  const warnings = [];
  function requireTextFile(name, artifact) {
    const file = path.join(dir, name);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (_) {
      warnings.push({ code: `${artifact}_missing`, artifact, detail: `${name} 不存在或不可读` });
      return null;
    }
    if (!meaningfulText(text)) {
      warnings.push({ code: `${artifact}_invalid_content`, artifact, detail: `${name} 为空或仅含占位内容` });
    }
    return text;
  }
  requireTextFile('task.redacted.md', 'task_redacted');
  requireTextFile('result.redacted.md', 'result_redacted');
  const summaryText = requireTextFile('process-summary.redacted.log', 'process_summary_redacted');
  const manifest = readJson(manifestFile);
  if (!manifest) {
    warnings.push({ code: 'manifest_invalid_json', artifact: 'manifest', detail: 'interaction-trace.json 不是有效 JSON' });
  } else {
    if (manifest.schema !== SCHEMA) {
      warnings.push({ code: 'manifest_schema_invalid', artifact: 'manifest', detail: `manifest.schema 必须为 ${SCHEMA}` });
    }
    for (const [field, value] of [
      ['trace_id', manifest.trace_id], ['task_id', manifest.task_id],
      ['agent_id', manifest.agent_id], ['runner_id', manifest.runner_id],
    ]) {
      if (!meaningfulText(value)) {
        warnings.push({ code: `manifest_${field}_missing`, artifact: 'manifest', detail: `manifest.${field} 缺失或无效` });
      }
    }
    const handoffMeta = readJson(path.join(dir, '..', 'meta.json'));
    if (handoffMeta && meaningfulText(handoffMeta.spec_fingerprint)) {
      if (!meaningfulText(manifest.spec_fingerprint)) {
        warnings.push({
          code: 'manifest_spec_fingerprint_missing',
          artifact: 'manifest',
          detail: 'manifest.spec_fingerprint 未关联 handoff 任务协议指纹',
        });
      } else if (manifest.spec_fingerprint !== handoffMeta.spec_fingerprint) {
        warnings.push({
          code: 'manifest_spec_fingerprint_mismatch',
          artifact: 'manifest',
          detail: 'manifest.spec_fingerprint 与 handoff meta.spec_fingerprint 不一致',
        });
      }
    }
  }
  if (summaryText != null) {
    let summary = null;
    try { summary = JSON.parse(summaryText); }
    catch (_) {
      warnings.push({ code: 'process_summary_invalid_json', artifact: 'process_summary_redacted', detail: '过程摘要不是有效 JSON' });
    }
    if (summary) {
      if (summary.schema !== PROCESS_SUMMARY_SCHEMA) {
        warnings.push({ code: 'process_summary_schema_invalid', artifact: 'process_summary_redacted', detail: '过程摘要 schema 不匹配' });
      }
      const schema = loadProcessSummarySchema();
      if (!schema || schema.$id !== PROCESS_SUMMARY_SCHEMA) {
        warnings.push({
          code: 'process_summary_schema_definition_unavailable',
          artifact: 'process_summary_redacted',
          detail: '统一过程摘要 schema 不可读或 $id 不匹配',
        });
      } else {
        for (const error of validateJsonSchema(summary, schema)) {
          warnings.push({
            code: `process_summary_schema_${safeIdentifier(error.keyword, 'validation')}`,
            artifact: 'process_summary_redacted',
            detail: `${error.path}: ${error.message}`,
          });
        }
      }
      if (!meaningfulText(summary.target_summary)) {
        warnings.push({ code: 'process_summary_target_summary_invalid', artifact: 'process_summary_redacted', detail: 'target_summary 为空或仅含整值占位内容' });
      }
    }
  }
  return warnings;
}

function recordHookError(trace, opts, error, phase) {
  try {
    const record = trace && trace.record || {};
    const manifestFile = trace && trace.manifestFile;
    const entry = {
      schema: HOOK_ERROR_SCHEMA,
      at: new Date().toISOString(),
      trace_id: record.trace_id || null,
      task_id: record.task_id || null,
      phase: safeIdentifier(phase, 'integrity_hook'),
      error: compact(error && error.message || error || 'unknown hook error', 500),
    };
    if (manifestFile) {
      appendJsonLine(path.join(path.dirname(manifestFile), 'trace-hook-errors.jsonl'), entry);
      try {
        withFileLock(manifestFile, () => {
          const manifest = readJson(manifestFile) || record;
          const hookErrors = Array.isArray(manifest.hook_error) ? manifest.hook_error.slice() : [];
          hookErrors.push(entry);
          const next = Object.assign({}, manifest, { hook_error: hookErrors, observability_status: 'hook_error' });
          atomicWrite(manifestFile, `${JSON.stringify(next, null, 2)}\n`);
        });
      } catch (_) {}
      try {
        mergeObservabilityWarnings(manifestFile, [{
          code: 'trace_integrity_hook_error',
          artifact: 'integrity_hook',
          detail: `${entry.phase}: ${entry.error}`,
        }]);
      } catch (_) {}
    }
    emit(opts, 'interaction.trace.hook_error', entry);
  } catch (_) {}
}

function recordPrompt(opts = {}) {
  try {
    const root = traceRoot(opts);
    const indexFile = path.join(root, 'index.jsonl');
    const id = traceIdentity(opts);
    const handoff = rootHandoff(opts);
    const node = opts.node || {};
    const role = node.agent_role || null;
    const command = commandMetadata(opts);
    const promptFile = path.join(opts.dir, 'task.md');
    const redactedPromptFile = path.join(opts.dir, 'task.redacted.md');
    const prompt = String(opts.prompt || '');
    atomicWrite(redactedPromptFile, redact(prompt));
    const record = {
      schema: SCHEMA,
      ...id,
      node_id: node.id || null,
      agent_role: role,
      agent_id: role || opts.runnerId || null,
      runner_id: opts.runnerId || null,
      runner_kind: opts.runner && opts.runner.kind || 'cli',
      interaction_agents: runnerParticipants(opts.runnerId, opts.runner),
      attempt: Number(opts.attempt || 1),
      queue_agent: opts.queueAgent || null,
      queue_id: opts.queueId || null,
      project_id: opts.projectId || opts.ctx && opts.ctx.projectId || null,
      from_agent: handoff.from,
      to_agent: role,
      handoff_to: handoff.to,
      spec_fingerprint: handoff.spec_fingerprint,
      route_key: [opts.queueAgent || 'direct', role || 'unknown', opts.runnerId || 'unknown'].join('>'),
      started_at: new Date().toISOString(),
      finished_at: null,
      status: 'running',
      hidden_chain_of_thought_saved: false,
      record_policy: 'observable_prompt_output_tools_and_decision_summary_only',
      command,
      task_classification: taskClassification(opts, command),
      task_target_summary: taskTargetSummary(opts),
      prompt: {
        raw_path: relativeToWorkspace(promptFile, opts.workdir),
        redacted_path: relativeToWorkspace(redactedPromptFile, opts.workdir),
        sha256: sha256(prompt),
        chars: prompt.length,
      },
      output: null,
      evidence_refs: [],
    };
    const manifestFile = path.join(opts.dir, 'interaction-trace.json');
    record.manifest_path = relativeToWorkspace(manifestFile, opts.workdir);
    atomicWrite(manifestFile, `${JSON.stringify(record, null, 2)}\n`);
    appendJsonLine(indexFile, {
      schema: INDEX_SCHEMA,
      event: 'interaction.started',
      at: record.started_at,
      ...id,
      node_id: record.node_id,
      agent_role: role,
      runner_id: record.runner_id,
      route_key: record.route_key,
      project_id: record.project_id,
      manifest_path: record.manifest_path,
      prompt_redacted_path: record.prompt.redacted_path,
    });
    emit(opts, 'interaction.trace.started', {
      task: id.task_id,
      rootTaskId: id.root_task_id,
      chainId: id.chain_id,
      traceId: id.trace_id,
      node: record.node_id,
      role,
      runner: record.runner_id,
      queueAgent: record.queue_agent,
      queueId: record.queue_id,
    });
    return { record, manifestFile, indexFile, workdir: opts.workdir };
  } catch (_) {
    return null;
  }
}

function recordResult(trace, opts = {}) {
  if (!trace || !trace.record || !trace.manifestFile) return null;
  try {
    const record = Object.assign({}, trace.record);
    const stdout = String(opts.stdout || '');
    const stderr = String(opts.stderr || '');
    const redactedResultFile = path.join(path.dirname(trace.manifestFile), 'result.redacted.md');
    atomicWrite(redactedResultFile, redact(stdout));
    record.finished_at = new Date().toISOString();
    record.status = opts.result && opts.result.fail ? 'failed' : 'completed';
    record.latency_ms = Number(opts.latencyMs || 0);
    const processSummaryFile = path.join(path.dirname(trace.manifestFile), 'process-summary.redacted.log');
    const processSummary = makeProcessSummary(record, opts);
    atomicWrite(processSummaryFile, `${JSON.stringify(processSummary, null, 2)}\n`);
    const processSummaryPath = relativeToWorkspace(processSummaryFile, trace.workdir);
    record.output = {
      raw_path: relativeToWorkspace(path.join(path.dirname(trace.manifestFile), 'result.md'), trace.workdir),
      redacted_path: relativeToWorkspace(redactedResultFile, trace.workdir),
      process_log_path: stderr ? relativeToWorkspace(path.join(path.dirname(trace.manifestFile), 'process.log'), trace.workdir) : null,
      process_summary_redacted_path: processSummaryPath,
      sha256: sha256(stdout),
      chars: stdout.length,
      observable_output_excerpt: compact(stdout),
      decision_summary: opts.result && opts.result.fail
        ? `执行失败:${compact(opts.result.fail, 900)}`
        : '执行完成；具体结论与证据见脱敏输出和 evidence_refs。',
      failure_reason: opts.result && opts.result.fail ? compact(opts.result.fail, 1200) : null,
    };
    record.evidence_refs = [
      record.prompt && record.prompt.redacted_path,
      record.output.redacted_path,
      record.output.process_summary_redacted_path,
      opts.result && opts.result.evidence && relativeToWorkspace(opts.result.evidence.path, trace.workdir),
    ].filter(Boolean);
    record.observability_status = 'pending_integrity_check';
    record.observability_warning = [];
    atomicWrite(trace.manifestFile, `${JSON.stringify(record, null, 2)}\n`);
    let finalized = record;
    try {
      const checker = typeof opts.integrityCheck === 'function' ? opts.integrityCheck : inspectTraceIntegrity;
      const warnings = checker(trace.manifestFile) || [];
      finalized = mergeObservabilityWarnings(trace.manifestFile, warnings, {
        integrity_check: {
          schema: 'yutu6-trace-integrity-check@1',
          checked_at: new Date().toISOString(),
          complete: warnings.length === 0,
          warning_count: warnings.length,
        },
      });
    } catch (error) {
      recordHookError(trace, opts, error, 'trace_completion_integrity');
      finalized = readJson(trace.manifestFile) || record;
    }
    appendJsonLine(trace.indexFile, {
      schema: INDEX_SCHEMA,
      event: 'interaction.finished',
      at: record.finished_at,
      chain_id: record.chain_id,
      trace_id: record.trace_id,
      root_task_id: record.root_task_id,
      task_id: record.task_id,
      node_id: record.node_id,
      agent_role: record.agent_role,
      runner_id: record.runner_id,
      route_key: record.route_key,
      project_id: record.project_id,
      status: finalized.status,
      latency_ms: finalized.latency_ms,
      manifest_path: finalized.manifest_path,
      output_redacted_path: finalized.output.redacted_path,
      process_summary_redacted_path: finalized.output.process_summary_redacted_path,
      evidence_refs: finalized.evidence_refs,
      observability_status: finalized.observability_status,
      observability_warning: finalized.observability_warning || [],
      hook_error: finalized.hook_error || [],
      content_hash: sha256(`${finalized.prompt.sha256}|${finalized.output.sha256}|${finalized.status}|${JSON.stringify(finalized.observability_warning || [])}`),
    });
    emit(opts, 'interaction.trace.finished', {
      task: record.task_id,
      rootTaskId: record.root_task_id,
      chainId: record.chain_id,
      traceId: record.trace_id,
      node: record.node_id,
      role: record.agent_role,
      runner: record.runner_id,
      status: finalized.status,
      latency_ms: finalized.latency_ms,
      observabilityStatus: finalized.observability_status,
      observabilityWarnings: finalized.observability_warning || [],
    });
    return finalized;
  } catch (error) {
    recordHookError(trace, opts, error, 'trace_completion');
    return null;
  }
}

module.exports = {
  SCHEMA,
  INDEX_SCHEMA,
  PROCESS_SUMMARY_SCHEMA,
  WARNING_SCHEMA,
  redact,
  sha256,
  traceRoot,
  recordPrompt,
  recordResult,
  meaningfulText,
  taskClassification,
  inspectTraceIntegrity,
  mergeObservabilityWarnings,
};
