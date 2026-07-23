#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'projects', '控制台', 'server.js');

async function main() {
  const port = await freePort();
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-snapshot-'));
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CONSOLE_ALIAS_PORTS: '',
      CONSOLE_ARTIFACTS_DIR: artifacts,
      AUTO_OPTIMIZER_ENABLED: '0',
      SCHEDULED_PAGE_REVIEW_ENABLED: '0',
      QUEUE_WORKER_EVENT_WAKE_ENABLED: '0',
      WORKER_SUPERVISE_MS: '600000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForHealth(port);
    const first = await request(port, '/api/workspace/snapshot');
    assert.equal(first.status, 200);
    assert.equal(first.body.schemaVersion, 1);
    assert.match(first.body.revision, /^[a-f0-9]{24}$/);
    assert.equal(typeof first.body.lastSeq, 'number');
    assert(first.body.runners && first.body.queues && first.body.taskBoard);
    assert(first.body.bulletin && first.body.version);
    assert(first.headers.etag);
    assert(Number(first.headers['x-workspace-snapshot-bytes']) <= 220 * 1024);

    const unchanged = await request(port, '/api/workspace/snapshot', {
      'If-None-Match': first.headers.etag,
    });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.text, '');

    const [runners, queues, board, version] = await Promise.all([
      request(port, '/api/runners'),
      request(port, '/api/queues/overview'),
      request(port, '/api/task-board/ceo'),
      request(port, '/api/version'),
    ]);
    assert.deepEqual(Object.keys(first.body.runners.roles).sort(), Object.keys(runners.body.roles).sort());
    assert.deepEqual(Object.keys(first.body.queues.queues).sort(), Object.keys(queues.body.queues).sort());
    assert.deepEqual(first.body.taskBoard.counts, board.body.counts);
    assert.equal(first.body.version.version, version.body.version);

    console.log(JSON.stringify({
      pass: true,
      suite: 'workspace-snapshot',
      bytes: Number(first.headers['x-workspace-snapshot-bytes']),
      revision: first.body.revision,
    }));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    fs.rmSync(artifacts, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0) {
      throw new Error(`snapshot test server exited ${child.exitCode}: ${stderr.slice(-1000)}`);
    }
  }
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: pathname,
      headers,
      timeout: 5000,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let body = null;
        if (text) {
          try { body = JSON.parse(text); } catch (_) {}
        }
        resolve({ status: res.statusCode, headers: res.headers, text, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on('error', reject);
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200 && response.body && response.body.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('snapshot test server did not become healthy');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
