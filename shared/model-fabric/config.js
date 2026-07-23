'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SECRET_FIELD = /(authorization|cookie|credential|password|secret|token|api[_-]?key|private[_-]?key)/i;

function workspaceRootFrom(start = __dirname) {
  return path.resolve(start, '..', '..');
}

function expandPath(value, workspaceRoot = workspaceRootFrom()) {
  const text = String(value || '');
  if (!text) return '';
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return path.isAbsolute(text) ? text : path.resolve(workspaceRoot, text);
}

function readEnvFile(file) {
  const result = {};
  if (!file) return result;
  let source = '';
  try { source = fs.readFileSync(file, 'utf8'); } catch (_) { return result; }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function validateConfig(config) {
  const errors = [];
  if (!config || config.schema !== 'yutu6-model-fabric@1') errors.push('unsupported schema');
  const server = config && config.server || {};
  if (!['127.0.0.1', 'localhost', '::1'].includes(server.host)) {
    errors.push('server.host must be localhost');
  }
  if (!Number.isInteger(server.port) || server.port < 1024 || server.port > 65535) {
    errors.push('server.port must be an integer between 1024 and 65535');
  }
  const providerIds = new Set();
  for (const provider of config && config.providers || []) {
    if (!provider.id || providerIds.has(provider.id)) errors.push(`duplicate or missing provider id: ${provider.id || 'missing'}`);
    providerIds.add(provider.id);
    if (provider.kind !== 'openai_compatible') errors.push(`unsupported provider kind: ${provider.id}`);
    if (!/^https?:\/\//.test(String(provider.base_url || ''))) errors.push(`provider base_url missing: ${provider.id}`);
    if (provider.credential && provider.credential.value) errors.push(`inline credential forbidden: ${provider.id}`);
  }
  for (const model of config && config.models || []) {
    if (!model.id) errors.push('model id missing');
    if (!Array.isArray(model.deployments) || model.deployments.length === 0) {
      errors.push(`model deployments missing: ${model.id || 'missing'}`);
    }
    for (const deployment of model.deployments || []) {
      if (!providerIds.has(deployment.provider)) {
        errors.push(`unknown provider ${deployment.provider} for model ${model.id}`);
      }
    }
  }
  if (errors.length) {
    const error = new Error(`invalid model fabric config: ${errors.join('; ')}`);
    error.code = 'FABRIC_CONFIG_INVALID';
    error.details = errors;
    throw error;
  }
  return config;
}

function loadConfig(file, workspaceRoot = workspaceRootFrom()) {
  const resolved = expandPath(file, workspaceRoot);
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  validateConfig(config);
  Object.defineProperty(config, '__file', { value: resolved, enumerable: false });
  Object.defineProperty(config, '__workspaceRoot', { value: workspaceRoot, enumerable: false });
  return config;
}

function resolveCredential(provider, workspaceRoot = workspaceRootFrom()) {
  const credential = provider && provider.credential || {};
  if (credential.env && process.env[credential.env]) return process.env[credential.env];
  if (!credential.file || !credential.key) return '';
  const env = readEnvFile(expandPath(credential.file, workspaceRoot));
  return env[credential.key] || '';
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      if (key === 'credential') {
        const credential = entry && typeof entry === 'object' ? entry : {};
        result.credential = {
          source: credential.file ? 'local_file' : (credential.env ? 'environment' : 'none'),
          key_name: credential.key || credential.env || null,
        };
      }
      continue;
    }
    result[key] = sanitize(entry);
  }
  return result;
}

module.exports = {
  SECRET_FIELD,
  workspaceRootFrom,
  expandPath,
  readEnvFile,
  validateConfig,
  loadConfig,
  resolveCredential,
  sanitize,
};
