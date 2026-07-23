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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wlqz9sAAAAASUVORK5CYII=', 'base64');

async function main() {
  const port = await freePort();
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-attachments-'));
  process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
  process.env.AUTO_OPTIMIZER_ENABLED = '0';
  process.env.SCHEDULED_PAGE_REVIEW_ENABLED = '0';
  process.env.QUEUE_WORKER_EVENT_WAKE_ENABLED = '0';
  const serverModule = require(SERVER);
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CONSOLE_ALIAS_PORTS: '',
      CONSOLE_ARTIFACTS_DIR: artifacts,
      BACKGROUND_STARTUP_DELAY_MS: '600000',
      WORKER_SUPERVISE_MS: '600000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForHealth(port);
    const uploaded = await request(port, {
      method: 'POST',
      pathname: '/api/attachments',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
        'X-File-Name': encodeURIComponent('proof.png'),
      },
      body: PNG,
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.json.ok, true);
    const attachment = uploaded.json.attachment;
    assert.match(attachment.id, /^[A-Za-z0-9_-]{12,120}$/);
    assert.equal(attachment.mime, 'image/png');
    assert.match(attachment.hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(uploaded.json).includes('base64'), false);

    const stagedDir = path.join(artifacts, 'task-attachments', 'staged');
    const metadataFile = path.join(stagedDir, `${attachment.id}.json`);
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    assert.equal(Object.hasOwn(metadata, 'dataUrl'), false);
    assert.equal(fs.statSync(metadataFile).mode & 0o777, 0o600);

    const preview = await request(port, {
      method: 'GET',
      pathname: `/api/attachments/${attachment.id}`,
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.buffer, PNG);

    const prepared = serverModule._test.prepareTaskForEnqueue({
      goal: 'inspect attachment',
      attachments: [attachment],
    }, {});
    assert.equal(prepared.attachments.length, 1);
    assert.equal(prepared.task.attachments[0].id, attachment.id);
    assert.equal(JSON.stringify(prepared.task).includes('dataUrl'), false);
    assert(prepared.task.inputs.includes(attachment.path));

    const mismatch = await request(port, {
      method: 'POST',
      pathname: '/api/attachments',
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': PNG.length,
        'X-File-Name': encodeURIComponent('fake.jpg'),
      },
      body: PNG,
    });
    assert.equal(mismatch.status, 415);

    const oversized = await request(port, {
      method: 'POST',
      pathname: '/api/attachments',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': 10 * 1024 * 1024 + 1,
        'X-File-Name': encodeURIComponent('huge.png'),
      },
      body: Buffer.alloc(0),
    });
    assert.equal(oversized.status, 413);

    metadata.created_at = '2020-01-01T00:00:00.000Z';
    metadata.claimed_at = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    const protectedResult = serverModule._test.cleanupStagedAttachments({
      now: Date.now(),
      activeIds: new Set([attachment.id]),
    });
    assert.equal(protectedResult.removed, 0);
    assert.equal(fs.existsSync(metadataFile), true);

    const cleanupResult = serverModule._test.cleanupStagedAttachments({
      now: Date.now(),
      activeIds: new Set(),
    });
    assert.equal(cleanupResult.removed, 1);
    assert.equal(fs.existsSync(metadataFile), false);

    const traversal = await request(port, {
      method: 'GET',
      pathname: '/api/attachments/%2E%2Eescape',
    });
    assert.equal(traversal.status, 400);

    console.log(JSON.stringify({
      pass: true,
      suite: 'attachment-staging',
      streamedBytes: PNG.length,
      retentionDays: uploaded.json.limits.retentionDays,
    }));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    fs.rmSync(artifacts, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0) {
      throw new Error(`attachment test server exited ${child.exitCode}: ${stderr.slice(-1000)}`);
    }
  }
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: options.method,
      path: options.pathname,
      headers: options.headers || {},
      agent: false,
      timeout: 5000,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buffer.toString('utf8')); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${options.pathname}`)));
    req.on('error', reject);
    if (options.body && options.body.length) req.write(options.body);
    req.end();
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, { method: 'GET', pathname: '/api/health' });
      if (response.status === 200 && response.json && response.json.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('attachment test server did not become healthy');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
