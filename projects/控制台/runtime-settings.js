#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_CONFIG_VERSION = 1;
const ENV_KEY = 'ENGINE_MAX_CONCURRENCY';
const DEFAULT_ENGINE_MAX_CONCURRENCY = 3;
const CONFIG_BASENAME = 'console-runtime.json';

function concurrencyBounds(cpuCount = os.cpus().length) {
  const count = Math.max(1, Number(cpuCount) || 1);
  return { min: 1, max: Math.max(1, Math.min(count * 2, 16)) };
}

function runtimeConfigPath(env = process.env) {
  // Production is intentionally fixed under the local private Hermes config.
  // Tests may opt into an isolated path, but the HTTP API never accepts a path.
  if (env.CONSOLE_RUNTIME_SETTINGS_TEST_MODE === '1' && env.CONSOLE_RUNTIME_SETTINGS_TEST_PATH) {
    return path.resolve(env.CONSOLE_RUNTIME_SETTINGS_TEST_PATH);
  }
  return path.join(os.homedir(), '.hermes', 'config', CONFIG_BASENAME);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateRuntimeDocument(value, opts = {}) {
  const bounds = opts.bounds || concurrencyBounds(opts.cpuCount);
  if (!isPlainObject(value)) return { ok: false, error: 'runtime config must be an object', bounds };
  const keys = Object.keys(value).sort();
  if (keys.some(key => !['engineMaxConcurrency', 'version'].includes(key))) {
    return { ok: false, error: 'runtime config has unknown fields', bounds };
  }
  if (value.version !== RUNTIME_CONFIG_VERSION) return { ok: false, error: 'unsupported runtime config version', bounds };
  const n = value.engineMaxConcurrency;
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
    return { ok: false, error: `engineMaxConcurrency must be an integer in ${bounds.min}..${bounds.max}`, bounds };
  }
  return { ok: true, value: n, document: { version: RUNTIME_CONFIG_VERSION, engineMaxConcurrency: n }, bounds };
}

function readRuntimeConfig(opts = {}) {
  const file = opts.configPath || runtimeConfigPath(opts.env || process.env);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, missing: true, configPath: file, bounds: concurrencyBounds(opts.cpuCount) };
    return { ok: false, invalid: true, error: 'runtime config read failed', configPath: file, bounds: concurrencyBounds(opts.cpuCount) };
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return { ok: false, invalid: true, error: 'runtime config is not valid JSON', configPath: file, bounds: concurrencyBounds(opts.cpuCount) }; }
  const checked = validateRuntimeDocument(parsed, opts);
  return Object.assign({}, checked, { configPath: file, invalid: !checked.ok });
}

function safeWarn(logger, message) {
  if (!logger) return;
  const fn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : (typeof logger === 'function' ? logger : null);
  if (fn) fn(`[runtime-settings] ${message}`);
}

function loadRuntimeSettings(opts = {}) {
  const env = opts.env || process.env;
  const bounds = concurrencyBounds(opts.cpuCount);
  const fileState = readRuntimeConfig(Object.assign({}, opts, { env, bounds }));
  if (fileState.ok) {
    return { engineMaxConcurrency: fileState.value, source: 'private-config', configPath: fileState.configPath, bounds };
  }
  if (fileState.invalid) safeWarn(opts.logger, 'private runtime config was ignored; using legacy environment or built-in default');
  const legacyRaw = env[ENV_KEY];
  if (legacyRaw != null && String(legacyRaw).trim() !== '') {
    const legacy = Number(legacyRaw);
    if (Number.isInteger(legacy) && legacy >= bounds.min && legacy <= bounds.max) {
      return { engineMaxConcurrency: legacy, source: 'legacy-env', configPath: fileState.configPath, bounds };
    }
    safeWarn(opts.logger, `legacy ${ENV_KEY} was outside the allowed integer range; using built-in default`);
  }
  return {
    engineMaxConcurrency: Math.max(bounds.min, Math.min(DEFAULT_ENGINE_MAX_CONCURRENCY, bounds.max)),
    source: 'default',
    configPath: fileState.configPath,
    bounds,
  };
}

function applyRuntimeSettingsToEnv(opts = {}) {
  const env = opts.env || process.env;
  const loaded = loadRuntimeSettings(Object.assign({}, opts, { env }));
  env[ENV_KEY] = String(loaded.engineMaxConcurrency);
  return loaded;
}

function runtimeSettingsState(currentValue, opts = {}) {
  const bounds = concurrencyBounds(opts.cpuCount);
  const current = Number(currentValue);
  const safeCurrent = Number.isInteger(current) && current >= bounds.min && current <= bounds.max
    ? current
    : Math.max(bounds.min, Math.min(DEFAULT_ENGINE_MAX_CONCURRENCY, bounds.max));
  const fileState = readRuntimeConfig(Object.assign({}, opts, { bounds }));
  const pending = fileState.ok ? fileState.value : safeCurrent;
  return {
    current: safeCurrent,
    pending,
    min: bounds.min,
    max: bounds.max,
    restartRequired: pending !== safeCurrent,
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireConfigLock(lockPath, opts = {}) {
  const timeoutMs = Math.max(100, Number(opts.timeoutMs) || 2500);
  const staleMs = Math.max(timeoutMs * 2, Number(opts.staleMs) || 30000);
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
      fs.fsyncSync(fd);
      return fd;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (ageMs > staleMs) { fs.unlinkSync(lockPath); continue; }
      } catch (_) {}
      await delay(25);
    }
  }
  const error = new Error('runtime settings are busy; retry later');
  error.code = 'SETTINGS_LOCK_TIMEOUT';
  throw error;
}

function fsyncDirectory(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch (_) {}
  finally { if (fd != null) try { fs.closeSync(fd); } catch (_) {} }
}

async function saveRuntimeSettings(engineMaxConcurrency, opts = {}) {
  const bounds = concurrencyBounds(opts.cpuCount);
  const checked = validateRuntimeDocument({ version: RUNTIME_CONFIG_VERSION, engineMaxConcurrency }, { bounds });
  if (!checked.ok) {
    const error = new Error(checked.error);
    error.code = 'SETTINGS_VALIDATION';
    throw error;
  }
  const file = opts.configPath || runtimeConfigPath(opts.env || process.env);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const lockPath = path.join(dir, `.${CONFIG_BASENAME}.lock`);
  const lockFd = await acquireConfigLock(lockPath, opts);
  const tmp = path.join(dir, `.${CONFIG_BASENAME}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let tmpFd;
  try {
    const payload = `${JSON.stringify(checked.document, null, 2)}\n`;
    tmpFd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(tmpFd, payload, 'utf8');
    fs.fsyncSync(tmpFd);
    fs.closeSync(tmpFd);
    tmpFd = null;
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
    fsyncDirectory(dir);
    return { ok: true, configPath: file, engineMaxConcurrency, bounds };
  } finally {
    if (tmpFd != null) try { fs.closeSync(tmpFd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
    try { fs.closeSync(lockFd); } catch (_) {}
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
}

module.exports = {
  RUNTIME_CONFIG_VERSION,
  ENV_KEY,
  DEFAULT_ENGINE_MAX_CONCURRENCY,
  concurrencyBounds,
  runtimeConfigPath,
  validateRuntimeDocument,
  readRuntimeConfig,
  loadRuntimeSettings,
  applyRuntimeSettingsToEnv,
  runtimeSettingsState,
  saveRuntimeSettings,
};
