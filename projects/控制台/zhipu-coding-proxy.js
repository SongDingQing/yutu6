#!/usr/bin/env node
'use strict';
/*
 * Local OpenAI-compatible shim for GLM Coding Plan.
 * It keeps the Zhipu team key on this Mac and exposes only a localhost
 * compatible endpoint for new-api / console runners.
 */
const http = require('http');
const { Readable } = require('stream');
const ZhipuCodingPlan = require('../../shared/model-fabric/zhipu-coding-plan');

const PORT = parseInt(process.env.ZHIPU_CODING_PROXY_PORT || '3010', 10);
const HOST = process.env.ZHIPU_CODING_PROXY_HOST || '127.0.0.1';
const UPSTREAM_BASE = ZhipuCodingPlan.BASE_URL;
const MODELS = (process.env.ZHIPU_CODING_MODELS || 'glm-5.2,glm-5,glm-4-flash').split(',').map(s => s.trim()).filter(Boolean);

function apiKey() {
  return ZhipuCodingPlan.readApiKey();
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
  if (pathname.endsWith('/chat/completions')) return ZhipuCodingPlan.CHAT_COMPLETIONS_URL;
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
      upstream = await ZhipuCodingPlan.httpsFetch(target, {
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
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on('error', error => {
      if (!res.headersSent) sendJson(res, 502, { error: { message: `upstream stream failed: ${error.message}` } });
      else res.end();
    }).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true, upstream: ZhipuCodingPlan.CONTRACT_ID });
  if (req.method === 'GET' && (u.pathname === '/v1/models' || u.pathname === '/models')) {
    return sendJson(res, 200, { object: 'list', data: MODELS.map(id => ({ id, object: 'model', owned_by: 'zhipu-coding-plan' })) });
  }
  if (req.method === 'POST') return proxy(req, res, u.pathname);
  return sendJson(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, HOST, () => {
  console.log(`zhipu-coding-proxy listening on ${HOST}:${PORT}`);
});
