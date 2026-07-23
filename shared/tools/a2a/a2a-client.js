#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const parsed = { command: argv[0] || 'help' };
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}

function parseEnvFile(file) {
  const result = {};
  const source = fs.readFileSync(file, 'utf8');
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function credential(args) {
  if (args.token) throw new Error('raw --token is forbidden; use --token-env or --token-file with --token-key');
  if (args.tokenEnv) {
    const value = process.env[args.tokenEnv];
    if (!value) throw new Error(`credential environment variable is missing: ${args.tokenEnv}`);
    return value;
  }
  if (args.tokenFile) {
    if (!args.tokenKey) throw new Error('--token-file requires --token-key');
    const file = path.resolve(args.tokenFile.replace(/^~(?=\/)/, process.env.HOME || ''));
    const value = parseEnvFile(file)[args.tokenKey];
    if (!value) throw new Error(`credential key is missing from local file: ${args.tokenKey}`);
    return value;
  }
  return null;
}

function validateUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http/https A2A endpoints are supported');
  return url;
}

function baseAgentUrl(value) {
  const url = validateUrl(value);
  const suffixes = [
    '/.well-known/agent-card.json',
    '/agent-card.json',
    '/message:send',
    '/message:stream',
    '/v1',
  ];
  for (const suffix of suffixes) {
    if (url.pathname.endsWith(suffix)) {
      url.pathname = url.pathname.slice(0, -suffix.length);
      break;
    }
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function endpointUrl(value, protocol) {
  const base = baseAgentUrl(value);
  return protocol === 'jsonrpc' ? `${base}/v1` : `${base}/message:send`;
}

function cardUrl(value) {
  return `${baseAgentUrl(value)}/.well-known/agent-card.json`;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 120000));
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { text }; }
    if (!response.ok) {
      const message = data && (data.detail || data.error || data.message);
      throw new Error(`A2A HTTP ${response.status}: ${String(message || 'request failed').slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverAgent(value, options = {}) {
  const card = await requestJson(cardUrl(value), options);
  const name = card.name || card.displayName || card.agentName;
  const endpoint = card.url || card.endpoint || card.serviceEndpoint || baseAgentUrl(value);
  if (!name || !endpoint) throw new Error('invalid Agent Card: name and endpoint are required');
  return {
    name,
    description: card.description || '',
    endpoint,
    protocol_version: card.protocolVersion || card.version || null,
    capabilities: card.capabilities || {},
    skills: card.skills || [],
    raw: card,
  };
}

function collectText(value, output, seen) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.trim()) output.push(value.trim());
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (typeof value.text === 'string') output.push(value.text.trim());
  if (typeof value.content === 'string') output.push(value.content.trim());
  for (const key of ['parts', 'artifacts', 'message', 'messages', 'result', 'output', 'data']) {
    if (value[key] !== undefined) collectText(value[key], output, seen);
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectText(entry, output, seen);
  }
}

function extractText(value) {
  const output = [];
  collectText(value, output, new Set());
  return [...new Set(output.filter(Boolean))].join('\n').trim();
}

function requestBody(prompt, protocol, requestId) {
  const message = { role: 'user', content: prompt };
  if (protocol === 'jsonrpc') {
    return {
      jsonrpc: '2.0',
      method: 'SendMessage',
      params: { message },
      id: requestId,
    };
  }
  return { message };
}

async function invokeAgent(value, prompt, options = {}) {
  const protocol = options.protocol || 'http-json';
  if (!['http-json', 'jsonrpc'].includes(protocol)) throw new Error(`unsupported protocol: ${protocol}`);
  const requestId = options.requestId || `yutu6-${Date.now()}-${process.pid}`;
  const raw = await requestJson(endpointUrl(value, protocol), {
    method: 'POST',
    token: options.token || null,
    timeoutMs: options.timeoutMs,
    headers: { 'A2A-Version': options.a2aVersion || '1.0' },
    body: requestBody(prompt, protocol, requestId),
  });
  const text = extractText(raw);
  return { request_id: requestId, protocol, text, raw };
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function usage() {
  return [
    'Usage:',
    '  node a2a-client.js discover --url <agent-base-or-card-url> [credential options]',
    '  printf "task" | node a2a-client.js run --url <agent-base-url> [--protocol http-json|jsonrpc]',
    '',
    'Credential options (values are never accepted on the command line):',
    '  --token-env <ENV_KEY>',
    '  --token-file <local.env> --token-key <KEY_NAME>',
    '',
    'Other options:',
    '  --timeout-ms <milliseconds>',
    '  --json',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.url) throw new Error('--url is required');
  const token = credential(args);
  const timeoutMs = Number(args.timeoutMs || 120000);

  if (args.command === 'discover') {
    const discovered = await discoverAgent(args.url, { token, timeoutMs });
    process.stdout.write(`${JSON.stringify(discovered, null, 2)}\n`);
    return 0;
  }
  if (args.command === 'run') {
    const prompt = await readStdin();
    if (!prompt) throw new Error('task prompt is required on stdin');
    const result = await invokeAgent(args.url, prompt, {
      token,
      timeoutMs,
      protocol: args.protocol || 'http-json',
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.text || JSON.stringify(result.raw)}\n`);
    return 0;
  }
  throw new Error(`unknown command: ${args.command}\n${usage()}`);
}

if (require.main === module) {
  main().then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`[a2a-client] ${String(error.message || error)}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  parseArgs,
  parseEnvFile,
  credential,
  baseAgentUrl,
  endpointUrl,
  cardUrl,
  requestJson,
  discoverAgent,
  extractText,
  requestBody,
  invokeAgent,
  main,
};
