'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCHEMA_VERSION = 1;
const DEFAULT_CONFIG_DIR = path.join(process.env.HOME || '.', '.config', 'yutu6');
const API_TIMEOUT_MS = 20000;

const PROVIDERS = Object.freeze({
  codex: {
    id: 'codex', label: 'OpenAI Codex', kind: 'cli', capability: 'executor', required: true,
    command: 'codex', args: ['login', 'status'], loginHint: '未登录时在终端运行: codex login',
  },
  claude: {
    id: 'claude', label: 'Claude Code', kind: 'cli', capability: 'executor', required: false,
    command: 'claude', args: ['auth', 'status', '--json'], loginHint: '可选: 未登录时在终端运行 claude login', optional: true,
  },
  zhipu: {
    id: 'zhipu', label: '智谱 Coding Plan', kind: 'api', protocol: 'openai', capability: 'reviewer',
    keyEnv: 'ZHIPU_API_KEY', baseEnv: 'ZHIPU_BASE_URL', modelEnv: 'ZHIPU_MODEL',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', defaultModel: 'glm-5',
  },
  minimax: {
    id: 'minimax', label: 'MiniMax', kind: 'api', protocol: 'anthropic', capability: 'reviewer',
    keyEnv: 'MINIMAX_API_KEY', baseEnv: 'MINIMAX_BASE_URL', modelEnv: 'MINIMAX_MODEL',
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic', defaultModel: 'MiniMax-M3',
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', kind: 'api', protocol: 'openai', capability: 'reviewer',
    keyEnv: 'DEEPSEEK_API_KEY', baseEnv: 'DEEPSEEK_BASE_URL', modelEnv: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat',
  },
  openai_compatible: {
    id: 'openai_compatible', label: 'OpenAI 兼容接口', kind: 'api', protocol: 'openai', capability: 'reviewer',
    keyEnv: 'OPENAI_COMPAT_API_KEY', baseEnv: 'OPENAI_COMPAT_BASE_URL', modelEnv: 'OPENAI_COMPAT_MODEL',
    defaultBaseUrl: '', defaultModel: '', optional: true,
  },
});

function configDir(opts = {}) {
  return path.resolve(opts.configDir || process.env.YUTU6_CONFIG_DIR || DEFAULT_CONFIG_DIR);
}

function files(opts = {}) {
  const dir = configDir(opts);
  return {
    dir,
    env: path.join(dir, 'providers.env'),
    state: path.join(dir, 'setup-state.json'),
  };
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
}

function readEnvFile(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!raw || /^\s*#/.test(raw)) continue;
      const idx = raw.indexOf('=');
      if (idx <= 0) continue;
      out[raw.slice(0, idx)] = raw.slice(idx + 1);
    }
  } catch (_) {}
  return out;
}

function writeAtomic(file, text, mode = 0o600) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, mode);
}

function writeEnvFile(file, env) {
  const lines = Object.keys(env).sort().map((key) => `${key}=${env[key]}`);
  writeAtomic(file, lines.length ? `${lines.join('\n')}\n` : '', 0o600);
}

function defaultState() {
  return { schemaVersion: SCHEMA_VERSION, completed: false, providers: {}, updatedAt: null };
}

function readState(opts = {}) {
  const fp = files(opts).state;
  try {
    const state = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Object.assign(defaultState(), state, { providers: state.providers || {} });
  } catch (_) {
    return defaultState();
  }
}

function writeState(state, opts = {}) {
  const next = Object.assign(defaultState(), state, {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  });
  writeAtomic(files(opts).state, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}

function cleanValue(value, label, max = 500) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(`${label}_required`);
  if (text.length > max || /[\0\r\n]/.test(text)) throw new Error(`${label}_invalid`);
  return text;
}

function safeBaseUrl(value) {
  const text = cleanValue(value, 'base_url', 1000).replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(text); } catch (_) { throw new Error('base_url_invalid'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('base_url_must_use_https_or_localhost');
  }
  if (parsed.username || parsed.password) throw new Error('base_url_must_not_include_credentials');
  return text;
}

function commandProbe(def, opts = {}) {
  const spawnFn = opts.spawn || spawn;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 10000));
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child && child.kill('SIGTERM'); } catch (_) {}
      finish({ ok: false, code: 'cli_timeout' });
    }, timeoutMs);
    try {
      child = spawnFn(def.command, def.args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      return finish({ ok: false, code: 'cli_not_found' });
    }
    let stdout = '';
    let stderr = '';
    child.stdout && child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr && child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (err) => finish({ ok: false, code: err && err.code === 'ENOENT' ? 'cli_not_found' : 'cli_error' }));
    child.once('close', (code) => {
      const text = `${stdout}\n${stderr}`;
      if (code !== 0) return finish({ ok: false, code: 'not_logged_in' });
      if (def.id === 'claude') {
        try {
          const body = JSON.parse(stdout || '{}');
          if (!body.loggedIn) return finish({ ok: false, code: 'not_logged_in' });
        } catch (_) {
          if (!/logged\s*in|authenticated/i.test(text)) return finish({ ok: false, code: 'probe_unrecognized' });
        }
      }
      if (def.id === 'codex' && !/logged\s*in/i.test(text)) return finish({ ok: false, code: 'not_logged_in' });
      return finish({ ok: true, code: 'connected' });
    });
  });
}

function probePayload(def, baseUrl, model, apiKey) {
  if (def.protocol === 'anthropic') {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      },
    };
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: {
      model,
      max_tokens: 8,
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    },
  };
}

async function apiProbe(def, input, opts = {}) {
  const fetchFn = opts.fetch || fetch;
  const current = readEnvFile(files(opts).env);
  const apiKey = cleanValue(input.apiKey || current[def.keyEnv], 'api_key', 4000);
  const baseUrl = safeBaseUrl(input.baseUrl || current[def.baseEnv] || def.defaultBaseUrl);
  const model = cleanValue(input.model || current[def.modelEnv] || def.defaultModel, 'model', 200);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(opts.timeoutMs || API_TIMEOUT_MS)));
  const started = Date.now();
  try {
    const payload = probePayload(def, baseUrl, model, apiKey);
    const response = await fetchFn(payload.url, {
      method: 'POST', headers: payload.headers, body: JSON.stringify(payload.body), signal: controller.signal,
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? 'authentication_failed'
        : response.status === 404
          ? 'endpoint_or_model_not_found'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500 ? 'provider_unavailable' : 'probe_failed';
      return { ok: false, code, status: response.status, latencyMs: Date.now() - started };
    }
    return { ok: true, code: 'connected', status: response.status, latencyMs: Date.now() - started, baseUrl, model };
  } catch (err) {
    return { ok: false, code: err && err.name === 'AbortError' ? 'probe_timeout' : 'connection_failed', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeProvider(id, input = {}, opts = {}) {
  const def = PROVIDERS[id];
  if (!def) return { ok: false, provider: id, code: 'unknown_provider' };
  const started = Date.now();
  try {
    const result = def.kind === 'cli' ? await commandProbe(def, opts) : await apiProbe(def, input, opts);
    return Object.assign({ provider: id, kind: def.kind, latencyMs: Date.now() - started }, result);
  } catch (err) {
    return { ok: false, provider: id, kind: def.kind, code: String(err && err.message || 'probe_failed').slice(0, 80), latencyMs: Date.now() - started };
  }
}

async function configureProvider(id, input = {}, opts = {}) {
  const def = PROVIDERS[id];
  if (!def) return { ok: false, provider: id, code: 'unknown_provider' };
  const probe = await probeProvider(id, input, opts);
  if (!probe.ok) return probe;

  if (def.kind === 'api') {
    const fp = files(opts).env;
    const env = readEnvFile(fp);
    env[def.keyEnv] = cleanValue(input.apiKey || env[def.keyEnv], 'api_key', 4000);
    env[def.baseEnv] = probe.baseUrl;
    env[def.modelEnv] = probe.model;
    writeEnvFile(fp, env);
    if (opts.loadIntoProcess !== false) {
      process.env[def.keyEnv] = env[def.keyEnv];
      process.env[def.baseEnv] = env[def.baseEnv];
      process.env[def.modelEnv] = env[def.modelEnv];
    }
  }

  const state = readState(opts);
  state.providers[id] = {
    ok: true,
    kind: def.kind,
    capability: def.capability,
    testedAt: new Date().toISOString(),
    latencyMs: Number(probe.latencyMs || 0),
  };
  writeState(state, opts);
  return { ok: true, provider: id, kind: def.kind, code: 'configured', latencyMs: probe.latencyMs };
}

function legacyInstallationDetected(opts = {}) {
  if (/^(1|true|yes)$/i.test(String(process.env.YUTU6_SETUP_BYPASS || ''))) return true;
  if (/^(1|true|yes)$/i.test(String(process.env.YUTU6_SETUP_FORCE || ''))) return false;
  const root = path.resolve(opts.workspaceRoot || path.join(__dirname, '../..'));
  const events = path.join(root, 'projects', '控制台', 'artifacts', 'engine-events.jsonl');
  try { return fs.statSync(events).size > 0; } catch (_) { return false; }
}

function requirements(state, opts = {}) {
  const rows = state.providers || {};
  const executorReady = Object.entries(rows).some(([id, row]) => row && row.ok && PROVIDERS[id] && PROVIDERS[id].capability === 'executor');
  const apiReady = Object.entries(rows).some(([id, row]) => row && row.ok && PROVIDERS[id] && PROVIDERS[id].kind === 'api');
  const allowCliOnly = /^(1|true|yes)$/i.test(String(process.env.YUTU6_SETUP_ALLOW_CLI_ONLY || opts.allowCliOnly || ''));
  return { executorReady, apiReady, allowCliOnly, ready: executorReady && (apiReady || allowCliOnly) };
}

function publicProviders(state, opts = {}) {
  const env = readEnvFile(files(opts).env);
  return Object.values(PROVIDERS).map((def) => ({
    id: def.id,
    label: def.label,
    kind: def.kind,
    protocol: def.protocol || null,
    capability: def.capability,
    required: !!def.required,
    optional: !!def.optional,
    configured: def.kind === 'cli'
      ? !!(state.providers[def.id] && state.providers[def.id].ok)
      : !!env[def.keyEnv],
    tested: !!(state.providers[def.id] && state.providers[def.id].ok),
    testedAt: state.providers[def.id] && state.providers[def.id].testedAt || null,
    loginHint: def.loginHint || null,
    baseUrl: def.kind === 'api' ? (env[def.baseEnv] || def.defaultBaseUrl) : null,
    model: def.kind === 'api' ? (env[def.modelEnv] || def.defaultModel) : null,
  }));
}

function status(opts = {}) {
  const state = readState(opts);
  const legacy = !state.completed && legacyInstallationDetected(opts);
  const req = requirements(state, opts);
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    completed: !!state.completed || legacy,
    mode: legacy ? 'legacy-compatible' : 'managed',
    requirements: req,
    providers: publicProviders(state, opts),
    configDir: configDir(opts).replace(process.env.HOME || '', '~'),
  };
}

function completeSetup(opts = {}) {
  const state = readState(opts);
  const req = requirements(state, opts);
  if (!req.ready) return { ok: false, code: !req.executorReady ? 'executor_required' : 'api_provider_required', requirements: req };
  state.completed = true;
  state.completedAt = new Date().toISOString();
  writeState(state, opts);
  return { ok: true, completed: true, requirements: req };
}

function loadPrivateEnv(opts = {}) {
  const env = readEnvFile(files(opts).env);
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null) process.env[key] = value;
  }
  return Object.keys(env);
}

module.exports = {
  PROVIDERS,
  files,
  readEnvFile,
  readState,
  status,
  requirements,
  probeProvider,
  configureProvider,
  completeSetup,
  legacyInstallationDetected,
  loadPrivateEnv,
};
