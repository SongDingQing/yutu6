'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const CONTRACT_ID = 'zhipu-coding-plan-v1';
const BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const CHAT_COMPLETIONS_URL = `${BASE_URL}/chat/completions`;
const MODEL = 'glm-5.2';
const TOKEN_FILE = path.join(os.homedir(), '.config', 'yutu6-secrets', 'secrets.env');
const TOKEN_KEY = 'ZHIPU_API_KEY';
const PROBE_MAX_TOKENS = 16;

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function expandPath(value) {
  const text = String(value || '');
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return path.resolve(text);
}

function readEnvFile(file) {
  const env = {};
  let source = '';
  try { source = fs.readFileSync(file, 'utf8'); } catch (_) { return env; }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function isContractRunner(runner) {
  return !!runner && runner.providerContract === CONTRACT_ID;
}

function validateRunner(runner) {
  if (!isContractRunner(runner)) return [];
  const errors = [];
  if (normalizeBaseUrl(runner.baseUrl) !== BASE_URL) errors.push(`baseUrl must be ${BASE_URL}`);
  if (String(runner.model || '') !== MODEL) errors.push(`model must be ${MODEL}`);
  if (expandPath(runner.tokenFile) !== TOKEN_FILE) errors.push(`tokenFile must be ${TOKEN_FILE}`);
  if (String(runner.tokenKey || '') !== TOKEN_KEY) errors.push(`tokenKey must be ${TOKEN_KEY}`);
  return errors;
}

function assertRunner(runner, runnerId = 'zhipu') {
  const errors = validateRunner(runner);
  if (!errors.length) return runner;
  const error = new Error(`GLM Coding Plan contract drift (${runnerId}): ${errors.join('; ')}`);
  error.code = 'ZHIPU_CODING_PLAN_CONTRACT_DRIFT';
  error.details = errors;
  throw error;
}

function readApiKey() {
  return process.env[TOKEN_KEY] || readEnvFile(TOKEN_FILE)[TOKEN_KEY] || '';
}

function resolveRunner(runner, runnerId = 'zhipu') {
  if (!isContractRunner(runner)) return null;
  assertRunner(runner, runnerId);
  return {
    contract: CONTRACT_ID,
    baseUrl: BASE_URL,
    chatUrl: CHAT_COMPLETIONS_URL,
    model: MODEL,
    token: readApiKey(),
    tokenFile: TOKEN_FILE,
    tokenKey: TOKEN_KEY,
  };
}

function isFabricProvider(provider) {
  return !!provider && provider.id === 'zhipu-coding-plan';
}

function validateFabricProvider(provider) {
  if (!isFabricProvider(provider)) return [];
  const errors = [];
  const credential = provider.credential || {};
  if (normalizeBaseUrl(provider.base_url) !== BASE_URL) errors.push(`base_url must be ${BASE_URL}`);
  if (expandPath(credential.file) !== TOKEN_FILE) errors.push(`credential.file must be ${TOKEN_FILE}`);
  if (String(credential.key || '') !== TOKEN_KEY) errors.push(`credential.key must be ${TOKEN_KEY}`);
  if (provider.health_mode !== 'chat_completion') errors.push('health_mode must be chat_completion');
  if (provider.health_model !== MODEL) errors.push(`health_model must be ${MODEL}`);
  if (provider.strip_v1_prefix !== true) errors.push('strip_v1_prefix must be true');
  return errors;
}

function assertFabricProvider(provider) {
  const errors = validateFabricProvider(provider);
  if (!errors.length) return provider;
  const error = new Error(`GLM Coding Plan fabric contract drift: ${errors.join('; ')}`);
  error.code = 'ZHIPU_CODING_PLAN_CONTRACT_DRIFT';
  error.details = errors;
  throw error;
}

function buildChatBody(options = {}) {
  const messages = Array.isArray(options.messages)
    ? options.messages
    : [{ role: 'user', content: String(options.prompt || '') }];
  return {
    model: MODEL,
    messages,
    temperature: options.temperature == null ? 0.3 : options.temperature,
    max_tokens: Math.max(1, Number(options.maxTokens || 2048)),
  };
}

function safeErrorClass(status, message, providerCode) {
  const text = String(message || '');
  const code = String(providerCode || '');
  if (status === 401 || status === 403) return 'auth';
  if (['1308', '1310'].includes(code)) return 'quota';
  if (code === '1309') return 'subscription_expired';
  if (code === '1311') return 'model_not_in_plan';
  if (['1305', '1312'].includes(code)) return 'platform_overload';
  if (['1302', '1303'].includes(code)) return 'rate_limit';
  if (/(?:额度|预扣|quota|balance|insufficient)/i.test(text)) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream';
  return 'http';
}

function providerError(body, status) {
  const detail = body && body.error && typeof body.error === 'object' ? body.error : {};
  const message = detail.message || body && body.message || '';
  const providerCode = detail.code || body && body.code || null;
  return {
    message: String(message || ''),
    providerCode: providerCode == null ? null : String(providerCode),
    errorClass: safeErrorClass(status, message, providerCode),
  };
}

function retryableFailure(status, providerCode) {
  const code = String(providerCode || '');
  return [408, 429, 500, 502, 503, 504].includes(Number(status))
    && !['1308', '1309', '1310', '1311'].includes(code);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function httpsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers = { ...(options.headers || {}) };
    const body = options.body == null ? null : Buffer.from(String(options.body));
    if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length')) {
      headers['content-length'] = body.length;
    }
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers,
      agent: false,
    }, response => {
      const status = Number(response.statusCode || 0);
      let consumed = false;
      const consume = async () => {
        if (consumed) throw new TypeError('response body already consumed');
        consumed = true;
        const chunks = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      };
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get(name) { return response.headers[String(name || '').toLowerCase()] || null; } },
        body: Readable.toWeb(response),
        text: async () => (await consume()).toString('utf8'),
        arrayBuffer: async () => {
          const buffer = await consume();
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
      });
    });
    request.on('error', reject);
    if (options.signal) {
      const abort = () => request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    if (body) request.write(body);
    request.end();
  });
}

async function requestChatCompletion(options = {}) {
  const fetchImpl = options.fetchImpl || httpsFetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
  const token = options.token || readApiKey();
  if (!token) return { ok: false, status: null, errorClass: 'credential_missing', providerCode: null, attempts: 0, body: {} };
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || 3)));
  const retryDelayMs = options.retryDelayMs == null ? 750 : Math.max(0, Number(options.retryDelayMs) || 0);
  const sleepImpl = options.sleepImpl || sleep;
  const body = options.body || buildChatBody(options);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { parsed = {}; }
      const error = providerError(parsed, response.status);
      const ok = response.ok && !parsed.error;
      last = {
        ok,
        status: response.status,
        body: parsed,
        errorClass: ok ? null : error.errorClass,
        providerCode: error.providerCode,
        attempts: attempt,
      };
      if (ok || attempt >= maxAttempts || !retryableFailure(response.status, error.providerCode)) return last;
    } catch (error) {
      last = {
        ok: false,
        status: null,
        body: {},
        errorClass: error && error.name === 'AbortError' ? 'timeout' : 'transport',
        providerCode: null,
        attempts: attempt,
      };
      if (attempt >= maxAttempts || options.signal && options.signal.aborted) return last;
    }
    await sleepImpl(Math.min(3000, retryDelayMs * Math.pow(2, attempt - 1)));
  }
  return last;
}

module.exports = Object.freeze({
  CONTRACT_ID,
  BASE_URL,
  CHAT_COMPLETIONS_URL,
  MODEL,
  TOKEN_FILE,
  TOKEN_KEY,
  PROBE_MAX_TOKENS,
  normalizeBaseUrl,
  readEnvFile,
  isContractRunner,
  validateRunner,
  assertRunner,
  readApiKey,
  resolveRunner,
  isFabricProvider,
  validateFabricProvider,
  assertFabricProvider,
  buildChatBody,
  safeErrorClass,
  providerError,
  retryableFailure,
  httpsFetch,
  requestChatCompletion,
});
