#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Q = require('../shared/engine/queue');
const Worker = require('../projects/控制台/ceo-worker')._test;

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'projects', '控制台', 'server.js');
const WORKSPACE = path.join(ROOT, 'projects', '控制台', 'public', 'workspace.html');

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 3000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await get(port, '/api/health');
      if (response.status === 200 && response.body.ok) return response.body;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

async function main() {
  const queueRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-memory-queue-'));
  try {
    assert.strictEqual(Q.hasWork(queueRoot, 'sample'), false, 'empty queue must not count as work');
    const entry = Q.enqueue(queueRoot, 'sample', { goal: 'memory smoke' }, { id: 'memory-smoke' });
    assert.strictEqual(Q.hasWork(queueRoot, 'sample'), true, 'queued item must count as work');
    Q.claim(queueRoot, 'sample', { owner: 'test', ownerPid: process.pid });
    assert.strictEqual(Q.hasWork(queueRoot, 'sample'), true, 'running item must count as work');
    Q.finish(queueRoot, 'sample', entry.id, 'done');
    assert.strictEqual(Q.hasWork(queueRoot, 'sample'), false, 'terminal history must not keep supervisor work-active');
  } finally {
    fs.rmSync(queueRoot, { recursive: true, force: true });
  }

  assert.strictEqual(Worker.shouldExitIdleWorker({ persistent: false, idleExitMs: 1000, idleSince: 1000, now: 2001 }), true);
  assert.strictEqual(Worker.shouldExitIdleWorker({ persistent: true, idleExitMs: 1000, idleSince: 1000, now: 3000 }), false);
  assert.strictEqual(Worker.shouldExitIdleWorker({ persistent: false, idleExitMs: 1000, idleSince: 1000, now: 3000, activeCount: 1 }), false);
  assert.strictEqual(Worker.shouldExitIdleWorker({ persistent: false, idleExitMs: 1000, idleSince: 1000, now: 3000, hasQueued: true }), false);

  const html = fs.readFileSync(WORKSPACE, 'utf8');
  assert(html.includes("fetch('/api/queues/overview')"), 'workspace must use the aggregate queue snapshot');
  assert(html.includes('/api/queue/${encodeURIComponent(agent.id)}'), 'workspace must retain the legacy per-agent fallback');
  assert(html.includes('document.hidden||workspacePollInFlight'), 'workspace polling must pause while hidden and prevent overlap');
  assert(html.includes('BULLETIN_POLL_MS=10000'), 'bulletin polling must not keep the old 1.5s churn');
  assert(!html.includes('setInterval(()=>pollQueue(), 1500)'), 'old high-frequency queue poll must be removed');

  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-memory-server-'));
  const port = 38000 + Math.floor(Math.random() * 2000);
  Q.enqueue(artifacts, 'ceo', { goal: 'aggregate queue smoke' }, { id: 'aggregate-smoke' });
  const child = spawn(process.execPath, [SERVER], {
    cwd: path.dirname(SERVER),
    env: Object.assign({}, process.env, {
      PORT: String(port),
      CONSOLE_ALIAS_PORTS: '',
      CONSOLE_ARTIFACTS_DIR: artifacts,
      QUEUE_WORKER_DISABLED: '1',
      BACKGROUND_STARTUP_DELAY_MS: '600000',
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    const health = await waitForServer(port);
    assert(health.memory && health.memory.rssBytes > 0, 'health must expose process memory for future regression baselines');
    const first = await get(port, '/api/queues/overview');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.ok, true);
    assert.strictEqual((first.body.queues.ceo.queued || [])[0].id, 'aggregate-smoke');
    const second = await get(port, '/api/queues/overview');
    assert.strictEqual(second.body.cached, true, 'second queue overview should reuse the short-lived snapshot');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
  assert(!stderr.includes('EADDRINUSE'), stderr);
  console.log('memory architecture regression tests passed');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
