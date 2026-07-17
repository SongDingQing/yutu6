#!/usr/bin/env node
'use strict';

/*
 * Front-door capability preflight.
 *
 * The CLI runner may attach instruction-expansion/module-registry guidance to
 * more than one agent in the same task.  Do not make each agent discover a
 * missing mount by running sed or an absent helper.  Probe once, allow one
 * lightweight retry, cache the verdict briefly, and inject either verified
 * paths or a named fallback.  It never installs capabilities and only writes
 * its project-scoped TTL cache plus a caller-selected event artifact.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TTL_MS = 30 * 1000;
const DEFAULT_RETRY_DELAY_MS = 25;
const DEFAULT_LOOKUP_TIMEOUT_MS = 3000;
const MAX_LOOKUP_OUTPUT_CHARS = 1800;

function positiveInt(value, fallback, minimum = 0) {
  const number = Number.parseInt(String(value == null ? '' : value), 10);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function redactText(value, max = MAX_LOOKUP_OUTPUT_CHARS) {
  return String(value == null ? '' : value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/"([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"')
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[:=]\s*([^\s,;]+)/g, '$1=[REDACTED]')
    .slice(0, Math.max(0, max));
}

function auditField(value, max = 160) {
  return redactText(value, max).replace(/[\r\n\t]+/g, ' ').trim();
}

function emitEvent(eventlog, type, payload) {
  if (!eventlog) return;
  try {
    if (typeof eventlog === 'function') eventlog(type, payload);
    else if (typeof eventlog.emit === 'function') eventlog.emit(type, payload);
  } catch (_) {}
}

function publicResolution(result, extra = {}) {
  const clean = Object.assign({}, result, extra);
  delete clean._cacheExpiresAt;
  return clean;
}

function readSharedCache(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.schema_version === 1 && parsed.entries && typeof parsed.entries === 'object'
      ? parsed
      : { schema_version: 1, entries: {} };
  } catch (_) {
    return { schema_version: 1, entries: {} };
  }
}

function writeSharedCache(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function acquireCacheLock(file, wait = sleep) {
  const lockDir = `${file}.lock`;
  const deadline = Date.now() + 1500;
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false, mode: 0o700 });
      return () => { try { fs.rmdirSync(lockDir); } catch (_) {} };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return null;
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > 5000) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch (_) {}
      if (Date.now() >= deadline) return null;
      await wait(5);
    }
  }
}

function defaultCapabilitySpecs(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || path.resolve(__dirname, '../..'));
  const homeDir = path.resolve(options.homeDir || process.env.HOME || '/Users/yutu6');
  return {
    'instruction-expansion-router': {
      fallback: 'generic_task_envelope',
      required: [
        { name: 'router_index', file: path.join(workspaceRoot, 'shared', 'capability_registry', 'modules', 'instruction-expansion-router', 'INDEX.md'), mode: 'read' },
        { name: 'expansion_spec', file: path.join(workspaceRoot, 'shared', 'capability_registry', 'modules', 'instruction-expansion-router', 'expansion-spec.md'), mode: 'read' },
      ],
    },
    'module-registry': {
      fallback: 'workspace_capability_registry',
      required: [
        { name: 'registry_index', file: path.join(homeDir, '.codex', 'modules', 'INDEX.md'), mode: 'read' },
        { name: 'lookup', file: path.join(homeDir, '.codex', 'modules', 'scripts', 'module_lookup.py'), mode: 'execute' },
      ],
      invoke: { pathName: 'lookup' },
    },
  };
}

async function defaultProbe(spec) {
  const checked = [];
  for (const item of spec.required || []) {
    try {
      const mode = item.mode === 'execute' ? fs.constants.R_OK | fs.constants.X_OK : fs.constants.R_OK;
      await fs.promises.access(item.file, mode);
      checked.push({ name: item.name, ok: true });
    } catch (_) {
      checked.push({ name: item.name, ok: false });
    }
  }
  return { ok: checked.length > 0 && checked.every(item => item.ok), checked };
}

class CapabilityPreflight {
  constructor(options = {}) {
    this.specs = options.specs || defaultCapabilitySpecs(options);
    this.ttlMs = positiveInt(options.ttlMs, DEFAULT_TTL_MS, 1);
    this.retryDelayMs = positiveInt(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0);
    this.lookupTimeoutMs = positiveInt(options.lookupTimeoutMs, DEFAULT_LOOKUP_TIMEOUT_MS, 1);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.sleep = typeof options.sleep === 'function' ? options.sleep : sleep;
    this.probe = typeof options.probe === 'function' ? options.probe : defaultProbe;
    this.spawn = typeof options.spawn === 'function' ? options.spawn : spawnSync;
    this.cacheFile = options.cacheFile === false
      ? null
      : path.resolve(options.cacheFile || path.join(options.workspaceRoot || path.resolve(__dirname, '../..'), 'projects', '控制台', 'artifacts', 'capability-preflight-cache.json'));
    this.cache = new Map();
    this.inFlight = new Map();
    this.invocationCache = new Map();
    this.invocationInFlight = new Map();
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
    this.invocationCache.clear();
    this.invocationInFlight.clear();
  }

  async resolve(request = {}) {
    const capability = String(request.capability || '').trim();
    const spec = this.specs[capability];
    if (!spec) throw new Error(`unknown capability: ${capability || '(empty)'}`);
    const now = this.now();
    const cached = this.cache.get(capability);
    if (cached && cached.expiresAt > now) {
      return Object.assign({}, cached.result, { cacheHit: true });
    }
    if (this.inFlight.has(capability)) {
      const result = await this.inFlight.get(capability);
      return publicResolution(result, { cacheHit: true });
    }
    const pending = this.resolveCoordinated(capability, spec, request);
    this.inFlight.set(capability, pending);
    try {
      const result = await pending;
      const expiresAt = Number(result._cacheExpiresAt) || (this.now() + this.ttlMs);
      const clean = publicResolution(result);
      this.cache.set(capability, { result: clean, expiresAt });
      return clean;
    } finally {
      this.inFlight.delete(capability);
    }
  }

  async resolveCoordinated(capability, spec, request) {
    if (!this.cacheFile) return this.resolveUncached(capability, spec, request);
    const release = await acquireCacheLock(this.cacheFile, this.sleep);
    if (!release) return this.resolveUncached(capability, spec, request);
    try {
      const now = this.now();
      const state = readSharedCache(this.cacheFile);
      const cached = state.entries[capability];
      if (cached && cached.expiresAt > now && cached.result) {
        this.cache.set(capability, cached);
        return Object.assign({}, cached.result, { cacheHit: true, _cacheExpiresAt: cached.expiresAt });
      }
      const result = await this.resolveUncached(capability, spec, request);
      for (const [key, value] of Object.entries(state.entries)) {
        if (!value || value.expiresAt <= now) delete state.entries[key];
      }
      const expiresAt = this.now() + this.ttlMs;
      state.entries[capability] = { result, expiresAt };
      writeSharedCache(this.cacheFile, state);
      return Object.assign({}, result, { _cacheExpiresAt: expiresAt });
    } finally {
      release();
    }
  }

  async resolveUncached(capability, spec, request) {
    let attempts = 1;
    let probe = await this.probe(spec, attempts);
    if (!probe || !probe.ok) {
      await this.sleep(this.retryDelayMs);
      attempts = 2;
      probe = await this.probe(spec, attempts);
    }
    const available = !!(probe && probe.ok);
    const result = {
      capability,
      available,
      attempts,
      cacheHit: false,
      probeResult: available
        ? (attempts === 1 ? 'available_initial' : 'available_after_retry')
        : 'unavailable_after_retry',
      fallback: available ? 'none' : String(spec.fallback || 'capability_fallback'),
      verifiedPaths: available
        ? Object.fromEntries((spec.required || []).map(item => [item.name, item.file]))
        : {},
    };
    const payload = {
      taskId: auditField(request.taskId || 'unknown'),
      capability: auditField(capability),
      probe_result: result.probeResult,
      attempts,
      fallback: result.fallback,
    };
    emitEvent(request.eventlog, available ? 'capability.available' : 'capability_unavailable', payload);
    return result;
  }

  async invoke(request = {}) {
    const resolution = request.resolution;
    const capability = String(request.capability || resolution && resolution.capability || '').trim();
    const spec = this.specs[capability];
    if (!spec || !resolution || !resolution.available || !spec.invoke) {
      return { ok: false, skipped: true, reason: 'capability_not_available' };
    }
    const executable = resolution.verifiedPaths[spec.invoke.pathName];
    if (!executable) return { ok: false, skipped: true, reason: 'verified_executable_missing' };
    const query = redactText(String(request.query || ''), 500).trim();
    const cacheKey = `${capability}\n${query}`;
    const now = this.now();
    const cached = this.invocationCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return Object.assign({}, cached.result, { cacheHit: true });
    if (this.invocationInFlight.has(cacheKey)) {
      const result = await this.invocationInFlight.get(cacheKey);
      return Object.assign({}, result, { cacheHit: true });
    }
    const pending = Promise.resolve().then(() => {
      const child = this.spawn(executable, [query], {
        encoding: 'utf8',
        timeout: this.lookupTimeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const ok = !child.error && child.status === 0;
      const result = {
        ok,
        skipped: false,
        cacheHit: false,
        output: ok ? redactText(child.stdout || '') : '',
        reason: ok ? null : 'verified_capability_call_failed',
      };
      emitEvent(request.eventlog, ok ? 'capability.invoked' : 'capability.invoke_failed', {
        taskId: auditField(request.taskId || 'unknown'),
        capability: auditField(capability),
        probe_result: resolution.probeResult,
        fallback: ok ? 'none' : String(spec.fallback || 'capability_fallback'),
      });
      return result;
    });
    this.invocationInFlight.set(cacheKey, pending);
    try {
      const result = await pending;
      this.invocationCache.set(cacheKey, { result, expiresAt: this.now() + this.ttlMs });
      return result;
    } finally {
      this.invocationInFlight.delete(cacheKey);
    }
  }
}

function renderResolution(resolution, invocation) {
  if (resolution.available) {
    const verified = Object.entries(resolution.verifiedPaths)
      .map(([name, file]) => `  - ${name}: ${file}`)
      .join('\n');
    const lookup = invocation && invocation.ok && invocation.output.trim()
      ? `\n  - 已由 hook 调用一次并缓存的只读 lookup 摘要:\n${invocation.output.trim().split(/\r?\n/).map(line => `    ${line}`).join('\n')}`
      : '';
    return `- ${resolution.capability}: available (${resolution.probeResult});只使用下列已验证路径:\n${verified}${lookup}`;
  }
  return [
    `- ${resolution.capability}: unavailable (${resolution.probeResult}); fallback=${resolution.fallback}。`,
    '  - hook 已完成首次探测和一次轻量重试；本 TTL 内禁止再次 sed、读取、执行或猜测未注入路径。',
    resolution.fallback === 'workspace_capability_registry'
      ? '  - 使用工作区 shared/capability_registry/registry.json，或调用 `node projects/控制台/secretary-tools.js capabilities <query>`。'
      : '  - 直接使用当前任务信封的目标/边界/输入/验收生成通用补齐稿。',
  ].join('\n');
}

let defaultPreflight = null;

async function prepareFrontDoorCapabilityContext(options = {}) {
  if (options.enabled === false || process.env.CONSOLE_CAPABILITY_PREFLIGHT === '0') {
    return { enabled: false, promptByRole: {}, resolutions: {}, invocation: null };
  }
  const preflight = options.preflight || defaultPreflight || (defaultPreflight = new CapabilityPreflight({
    workspaceRoot: options.workspaceRoot,
    homeDir: options.homeDir,
    cacheFile: options.cacheFile,
    ttlMs: positiveInt(process.env.CONSOLE_CAPABILITY_PREFLIGHT_TTL_MS, DEFAULT_TTL_MS, 1),
    retryDelayMs: positiveInt(process.env.CONSOLE_CAPABILITY_PREFLIGHT_RETRY_MS, DEFAULT_RETRY_DELAY_MS, 0),
  }));
  const base = {
    taskId: options.taskId || 'unknown',
    eventlog: options.eventlog,
  };
  const router = await preflight.resolve(Object.assign({}, base, { capability: 'instruction-expansion-router' }));
  const moduleRegistry = await preflight.resolve(Object.assign({}, base, { capability: 'module-registry' }));
  const invocation = moduleRegistry.available
    ? await preflight.invoke(Object.assign({}, base, {
      capability: 'module-registry',
      resolution: moduleRegistry,
      query: options.query || '',
    }))
    : null;
  const block = [
    '# Capability preflight（控制台 hook 已执行）',
    '以下探测结果优先于 skill 文档中的静态路径提示；只使用 available 项列出的已验证路径。',
    renderResolution(router, null),
    renderResolution(moduleRegistry, invocation),
    '- 安全边界:不自动安装、不修改全局模块、不记录查询正文或命令输出到事件日志。',
  ].join('\n');
  return {
    enabled: true,
    promptByRole: { secretary: block, orchestrator: block },
    resolutions: { router, moduleRegistry },
    invocation,
  };
}

function appendJsonlEvent(file) {
  return (type, payload) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(Object.assign({ at: new Date().toISOString(), type }, payload))}\n`);
  };
}

function cliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

async function main() {
  const args = cliArgs(process.argv.slice(2));
  const eventFile = args.events ? path.resolve(args.events) : null;
  const result = await prepareFrontDoorCapabilityContext({
    workspaceRoot: args.workspace ? path.resolve(args.workspace) : path.resolve(__dirname, '../..'),
    homeDir: args.home ? path.resolve(args.home) : undefined,
    cacheFile: args.cache ? path.resolve(args.cache) : undefined,
    taskId: args['task-id'] || 'capability-preflight-cli',
    query: args.query || '',
    eventlog: eventFile ? appendJsonlEvent(eventFile) : null,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    router: result.resolutions.router && result.resolutions.router.probeResult,
    moduleRegistry: result.resolutions.moduleRegistry && result.resolutions.moduleRegistry.probeResult,
    moduleRegistryFallback: result.resolutions.moduleRegistry && result.resolutions.moduleRegistry.fallback,
    lookupInvoked: !!(result.invocation && result.invocation.ok),
    eventFile,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`capability preflight failed: ${auditField(error && error.message || error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  CapabilityPreflight,
  auditField,
  defaultCapabilitySpecs,
  defaultProbe,
  prepareFrontDoorCapabilityContext,
  redactText,
  renderResolution,
};
