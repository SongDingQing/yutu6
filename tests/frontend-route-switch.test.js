#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-route-switch-'));
process.env.CONSOLE_ARTIFACTS_DIR = root;
process.env.QUEUE_WORKER_DISABLED = '1';
const FrontendRoute = require('../projects/控制台/frontend-route');
const Server = require('../projects/控制台/server');

function request(port, pathname, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = opts.body || '';
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: opts.method || 'GET',
      headers: Object.assign({}, opts.headers || {}, body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function isReactShell(body) {
  return /<script[^>]+type="module"[^>]+src="\/app\/assets\/index-[^"]+\.js"/.test(String(body || ''));
}

async function main() {
  assert.strictEqual(FrontendRoute.readTarget(root), 'legacy');
  const server = http.createServer(Server.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const legacy = await request(port, '/workspace');
    assert.strictEqual(legacy.status, 200);
    assert(!isReactShell(legacy.body));

    const routeState = await request(port, '/api/frontend/route');
    assert.strictEqual(routeState.status, 200);
    assert.strictEqual(JSON.parse(routeState.body).target, 'legacy');
    assert.deepStrictEqual(JSON.parse(routeState.body).options.map(item => item.label), ['简洁 UI', '复杂 UI']);
    const cookie = routeState.headers['set-cookie'][0].split(';')[0];
    const token = cookie.slice(cookie.indexOf('=') + 1);

    const rejected = await request(port, '/api/frontend/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'react' }),
    });
    assert.strictEqual(rejected.status, 403);

    const switched = await request(port, '/api/frontend/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Console-CSRF': token,
      },
      body: JSON.stringify({ target: 'react' }),
    });
    assert.strictEqual(switched.status, 200);
    assert.strictEqual(JSON.parse(switched.body).target, 'react');
    assert.strictEqual(fs.statSync(FrontendRoute.routeFile(root)).mode & 0o777, 0o600);
    const react = await request(port, '/workspace');
    assert.strictEqual(react.status, 200);
    assert(isReactShell(react.body));

    const rollback = await request(port, '/api/frontend/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Console-CSRF': token,
      },
      body: JSON.stringify({ target: 'legacy' }),
    });
    assert.strictEqual(rollback.status, 200);
    assert.strictEqual(JSON.parse(rollback.body).target, 'legacy');
    const restored = await request(port, '/workspace');
    assert.strictEqual(restored.status, 200);
    assert(!isReactShell(restored.body));

    const explicitReact = await request(port, '/workspace-next');
    const explicitLegacy = await request(port, '/workspace-legacy');
    assert(isReactShell(explicitReact.body));
    assert(!isReactShell(explicitLegacy.body));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ pass: true, suite: 'frontend-route-switch' }));
}

main().catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
