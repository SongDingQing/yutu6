#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: body == null ? 'GET' : 'POST',
      headers: body == null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(2500, () => req.destroy(new Error('request timeout')));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('server exited early: ' + logs.join('').slice(-2000));
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server health timeout: ' + logs.join('').slice(-2000));
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-setup-gate-'));
  const configDir = path.join(temp, 'config');
  const artifacts = path.join(temp, 'artifacts');
  const port = await freePort();
  const projectId = `api-fixture-${process.pid}`;
  const projectDir = path.join(root, 'projects', projectId);
  const logs = [];
  const child = spawn(process.execPath, ['projects/控制台/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      YUTU6_CONFIG_DIR: configDir,
      CONSOLE_ARTIFACTS_DIR: artifacts,
      YUTU6_SETUP_FORCE: '1',
      YUTU6_PROJECT_CREATE_RATE_LIMIT: '1',
      AUTO_OPTIMIZER_ENABLED: '0',
      SCHEDULED_PAGE_REVIEW_ENABLED: '0',
      INSIGHT_SCOUT_REPOS_ENABLED: '0',
      YUTU6_KB_INJECT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  try {
    await waitForHealth(port, child, logs);
    const setup = await request(port, '/setup');
    assert.strictEqual(setup.status, 200);
    assert(setup.body.includes('玉兔6 初始化'));

    const blocked = await request(port, '/workspace');
    assert.strictEqual(blocked.status, 302);
    assert.strictEqual(blocked.headers.location, '/setup');

    const status = JSON.parse((await request(port, '/api/setup/status')).body);
    assert.strictEqual(status.completed, false);

    const escaped = await request(port, '/api/projects', { projectId: '../escape' });
    assert.strictEqual(escaped.status, 400);
    assert.match(JSON.parse(escaped.body).code, /^project_id_(?:reserved|invalid_characters)$/);
    const created = await request(port, '/api/projects', { projectId, name: 'API 夹具' });
    assert.strictEqual(created.status, 201, created.body);
    assert.strictEqual(JSON.parse(created.body).project.supervisor.queueAgent, `supervisor-${projectId}`);
    const runners = JSON.parse((await request(port, '/api/runners')).body);
    assert(runners.queueAgents.some(agent => agent.id === `supervisor-${projectId}` && agent.role === 'supervisor'));
    assert(!fs.existsSync(path.join(artifacts, 'queues', `supervisor-${projectId}`)), 'project queue must remain lazy until first task');
    const repeated = await request(port, '/api/projects', { projectId });
    assert.strictEqual(repeated.status, 200);
    assert.strictEqual(JSON.parse(repeated.body).created, false);
    const limited = await request(port, '/api/projects', { projectId: `${projectId}-second` });
    assert.strictEqual(limited.status, 400);
    assert.strictEqual(JSON.parse(limited.body).code, 'project_create_rate_limited');

    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(configDir, 'setup-state.json'), JSON.stringify({
      schemaVersion: 1,
      completed: true,
      providers: {
        codex: { ok: true, kind: 'cli', capability: 'executor' },
      },
    }), { mode: 0o600 });

    const open = await request(port, '/workspace');
    assert.strictEqual(open.status, 200);
    assert(open.body.includes('玉兔6'));
    console.log(JSON.stringify({ pass: true, suite: 'setup-gate' }));
  } finally {
    await stop(child);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
