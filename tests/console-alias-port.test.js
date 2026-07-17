#!/usr/bin/env node
'use strict';

const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'projects', '控制台', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`timeout waiting for ${url}`);
}

async function main() {
  const primary = await freePort();
  let alias = await freePort();
  while (alias === primary) alias = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: path.join(ROOT, 'projects', '控制台'),
    env: Object.assign({}, process.env, {
      PORT: String(primary),
      CONSOLE_ALIAS_PORTS: `${alias},${primary},invalid,70000,${alias}`,
      QUEUE_WORKER_DISABLED: '1',
      UI_OPTIMIZER_ENABLED: '0',
      AUTO_PAGE_REVIEW_ENABLED: '0',
      INSIGHT_SCOUT_REPOS_ENABLED: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const primaryResponse = await waitFor(`http://127.0.0.1:${primary}/api/health`);
    const aliasResponse = await waitFor(`http://127.0.0.1:${alias}/workspace`);
    assert.strictEqual(primaryResponse.status, 200);
    assert.strictEqual(aliasResponse.status, 200);
    const html = await aliasResponse.text();
    assert(/玉兔6|workspace|工作区/i.test(html), 'alias must serve the real workspace page');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  assert.strictEqual(child.exitCode === 0 || child.signalCode === 'SIGTERM', true, stderr);
  console.log(JSON.stringify({ pass: true, suite: 'console-alias-port' }));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
