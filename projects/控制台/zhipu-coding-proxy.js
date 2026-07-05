#!/usr/bin/env node
'use strict';
/*
 * Local OpenAI-compatible shim for GLM Coding Plan.
 * It keeps the Zhipu team key on this Mac and exposes only a localhost
 * compatible endpoint for new-api / console runners.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = __dirname;
const PORT = parseInt(process.env.ZHIPU_CODING_PROXY_PORT || '3010', 10);
const HOST = process.env.ZHIPU_CODING_PROXY_HOST || '127.0.0.1';
const SECRET_FILE = process.env.ZHIPU_SECRET_FILE || path.join(ROOT, 'artifacts', 'new-api', 'zhipu.env');
const UPSTREAM_BASE = (process.env.ZHIPU_CODING_API_BASE || 'https://open.bigmodel.cn/api/coding/paas/v4').replace(/\/+$/, '');
const MODELS = (process.env.ZHIPU_CODING_MODELS || 'glm-5.2,glm-5,glm-4-flash').split(',').map(s => s.trim()).filter(Boolean);

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch (_) {}
  return out;
}

function apiKey() {
  return process.env.ZHIPU_API_KEY || readEnvFile(SECRET_FILE).ZHIPU_API_KEY || '';
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  let data = '';
  req.on('data', chunk => {
    data += chunk;
    if (data.length > 10 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => cb(data || '{}'));
}

function upstreamUrl(pathname) {
  if (pathname.endsWith('/chat/completions')) return `${UPSTREAM_BASE}/chat/completions`;
  if (pathname.endsWith('/images/generations')) return `${UPSTREAM_BASE}/images/generations`;
  return null;
}

async function proxy(req, res, pathname) {
  const key = apiKey();
  if (!key) return sendJson(res, 500, { error: { message: 'ZHIPU_API_KEY missing' } });
  const target = upstreamUrl(pathname);
  if (!target) return sendJson(res, 404, { error: { message: 'unsupported endpoint' } });
  readBody(req, async body => {
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': req.headers['content-type'] || 'application/json',
          accept: req.headers.accept || 'application/json',
        },
        body,
      });
    } catch (e) {
      return sendJson(res, 502, { error: { message: `upstream request failed: ${e.message}` } });
    }
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true, upstream: 'zhipu-coding' });
  if (req.method === 'GET' && (u.pathname === '/v1/models' || u.pathname === '/models')) {
    return sendJson(res, 200, { object: 'list', data: MODELS.map(id => ({ id, object: 'model', owned_by: 'zhipu-coding-plan' })) });
  }
  if (req.method === 'POST') return proxy(req, res, u.pathname);
  return sendJson(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, HOST, () => {
  console.log(`zhipu-coding-proxy listening on ${HOST}:${PORT}`);
});
