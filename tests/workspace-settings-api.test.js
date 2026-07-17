#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-settings-api-'));
const artifacts = path.join(root, 'artifacts');
const configPath = path.join(root, '.hermes', 'config', 'console-runtime.json');
process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
process.env.CONSOLE_RUNTIME_SETTINGS_TEST_MODE = '1';
process.env.CONSOLE_RUNTIME_SETTINGS_TEST_PATH = configPath;
process.env.ENGINE_MAX_CONCURRENCY = '2';
process.env.QUEUE_WORKER_DISABLED = '1';

const Q = require('../shared/engine/queue');
const Server = require('../projects/控制台/server');

function request(port, method, apiPath, body, headers = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: apiPath,
      method,
      headers: Object.assign({ Host: `127.0.0.1:${port}` }, payload == null ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      }, headers),
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(raw || '{}'); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload != null) req.end(payload); else req.end();
  });
}

function csrfHeaders(cookieHeader) {
  const cookie = String(cookieHeader || '').split(';')[0];
  const token = cookie.split('=').slice(1).join('=');
  return { Cookie: cookie, 'X-Console-CSRF': token };
}

async function main() {
  const srv = http.createServer(Server.handler);
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { srv.off('error', reject); resolve(); });
  });
  const port = srv.address().port;
  try {
    const initial = await request(port, 'GET', '/api/settings/runtime');
    assert.strictEqual(initial.status, 200);
    assert.deepStrictEqual(Object.keys(initial.body).sort(), ['current', 'max', 'min', 'ok', 'pending', 'restartRequired']);
    assert.strictEqual(initial.body.current, 2);
    assert.strictEqual(initial.body.pending, 2);
    assert.strictEqual(initial.body.restartRequired, false);
    assert(initial.headers['set-cookie'] && initial.headers['set-cookie'][0].includes('SameSite=Strict'));
    const auth = csrfHeaders(initial.headers['set-cookie'][0]);

    const wrongHost = await request(port, 'GET', '/api/settings/runtime', undefined, { Host: `example.test:${port}` });
    assert.strictEqual(wrongHost.status, 403);
    const forwarded = await request(port, 'GET', '/api/settings/runtime', undefined, { 'X-Forwarded-For': '127.0.0.1' });
    assert.strictEqual(forwarded.status, 403);
    assert(Server._test.runtimeApiLocalError({ headers: { host: 'localhost' }, socket: { remoteAddress: '192.0.2.1' } }));
    assert.strictEqual(Server._test.runtimeApiLocalError({ headers: { host: 'localhost' }, socket: { remoteAddress: '::1' } }), '');
    assert.strictEqual(Server._test.runtimeApiLocalError({ headers: { host: '[::1]:8787' }, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '');
    assert(Server._test.runtimeApiLocalError({ headers: { host: '127.0.0.1', forwarded: 'for=127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }));
    const wrongMethod = await request(port, 'PUT', '/api/settings/runtime');
    assert.strictEqual(wrongMethod.status, 405);

    const missingCsrf = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 1 });
    assert.strictEqual(missingCsrf.status, 403);
    assert(!fs.existsSync(configPath));
    const badCsrf = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 1 }, { Cookie: auth.Cookie, 'X-Console-CSRF': '0'.repeat(64) });
    assert.strictEqual(badCsrf.status, 403);
    const unknown = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 1, command: 'anything' }, auth);
    assert.strictEqual(unknown.status, 400);
    const decimal = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 1.5 }, auth);
    assert.strictEqual(decimal.status, 400);
    const tooLow = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 0 }, auth);
    assert.strictEqual(tooLow.status, 400);
    const tooHigh = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: initial.body.max + 1 }, auth);
    assert.strictEqual(tooHigh.status, 400);

    const saved = await request(port, 'POST', '/api/settings/runtime', { engineMaxConcurrency: 1 }, auth);
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.body.current, 2, 'save must not mutate current effective value');
    assert.strictEqual(saved.body.pending, 1);
    assert.strictEqual(saved.body.restartRequired, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { version: 1, engineMaxConcurrency: 1 });
    assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.dirname(configPath)).mode & 0o777, 0o700);

    const childEnv = Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: artifacts,
      CONSOLE_RUNTIME_SETTINGS_TEST_MODE: '1',
      CONSOLE_RUNTIME_SETTINGS_TEST_PATH: configPath,
      ENGINE_MAX_CONCURRENCY: '4',
      QUEUE_WORKER_DISABLED: '1',
    });
    const freshServer = spawnSync(process.execPath, ['-e', "const s=require('./projects/控制台/server');process.stdout.write(JSON.stringify(s._test.runtimeSettingsResponse()))"], {
      cwd: path.resolve(__dirname, '..'), env: childEnv, encoding: 'utf8',
    });
    assert.strictEqual(freshServer.status, 0, freshServer.stderr);
    const freshServerState = JSON.parse(freshServer.stdout);
    assert.strictEqual(freshServerState.current, 1);
    assert.strictEqual(freshServerState.pending, 1);
    assert.strictEqual(freshServerState.restartRequired, false);
    const freshWorker = spawnSync(process.execPath, ['-e', "const w=require('./projects/控制台/ceo-worker');process.stdout.write(JSON.stringify(w._test.runtimeSettingsBoot))"], {
      cwd: path.resolve(__dirname, '..'), env: childEnv, encoding: 'utf8',
    });
    assert.strictEqual(freshWorker.status, 0, freshWorker.stderr);
    const freshWorkerState = JSON.parse(freshWorker.stdout);
    assert.deepStrictEqual(freshWorkerState, { engineMaxConcurrency: 1, source: 'private-config' });

    const cardsFile = path.join(artifacts, 'bulletin', 'cards.json');
    fs.mkdirSync(path.dirname(cardsFile), { recursive: true });
    fs.writeFileSync(cardsFile, JSON.stringify([
      { id: 'bb-todo-test', title: '可删除待拍板', status: 'todo', queueId: null },
      { id: 'bb-cn-todo-test', title: '中文待拍板', status: '待拍板', queueId: null },
      { id: 'bb-enabled-test', title: '已启用', status: 'enabled', queueId: 'real-running-id' },
    ], null, 2));
    const listed = await request(port, 'GET', '/api/bulletin');
    assert(listed.body.cards.every(card => card.kind === 'bulletin'));
    const protectedCard = await request(port, 'POST', '/api/bulletin/bb-enabled-test/remove', {});
    assert.strictEqual(protectedCard.status, 400);
    assert(JSON.parse(fs.readFileSync(cardsFile, 'utf8')).some(card => card.id === 'bb-enabled-test'));
    Q.enqueue(artifacts, 'worker_code', { goal: 'real queued task must not be deleted by bulletin route' }, { id: 'real-queued-id' });
    const queueIdAgainstBulletin = await request(port, 'POST', '/api/bulletin/real-queued-id/remove', {});
    assert.strictEqual(queueIdAgainstBulletin.status, 404);
    assert(Q.list(artifacts, 'worker_code').queued.some(entry => entry.id === 'real-queued-id'));
    const removed = await request(port, 'POST', '/api/bulletin/bb-todo-test/remove', {});
    assert.strictEqual(removed.status, 200);
    assert(!JSON.parse(fs.readFileSync(cardsFile, 'utf8')).some(card => card.id === 'bb-todo-test'));
    const removedCn = await request(port, 'POST', '/api/bulletin/bb-cn-todo-test/remove', {});
    assert.strictEqual(removedCn.status, 200);
    assert(!JSON.parse(fs.readFileSync(cardsFile, 'utf8')).some(card => card.id === 'bb-cn-todo-test'));

    const claimed = Q.claim(artifacts, 'worker_code', { match: entry => entry.id === 'real-queued-id' });
    assert(claimed);
    const restartWithParams = await request(port, 'POST', '/api/console/restart', { command: 'anything' }, auth);
    assert.strictEqual(restartWithParams.status, 400);
    const blockedRestart = await request(port, 'POST', '/api/console/restart', {}, auth);
    assert.strictEqual(blockedRestart.status, 409);
    assert.strictEqual(blockedRestart.body.runningCount, 1);

    Server._test.resetRestartRequestState();
    const spawnCalls = [];
    const fakeSpawn = (file, args, opts) => { spawnCalls.push({ file, args, opts }); return { pid: 43210, unref() {} }; };
    const scheduled = Server._test.scheduleSafeConsoleRestart({ now: 100000, spawnFn: fakeSpawn });
    assert.strictEqual(scheduled.code, 202);
    assert.strictEqual(spawnCalls.length, 1);
    assert.strictEqual(spawnCalls[0].file, process.execPath);
    assert.deepStrictEqual(spawnCalls[0].args, [path.join(path.resolve(__dirname, '..', 'projects', '控制台'), 'tools', 'restart-console-safe.js')]);
    assert(!Object.keys(spawnCalls[0].opts.env).some(key => /TOKEN|KEY|SECRET|PASSWORD/i.test(key)));
    const duplicate = Server._test.scheduleSafeConsoleRestart({ now: 101000, spawnFn: fakeSpawn });
    assert.strictEqual(duplicate.code, 429);
    assert.strictEqual(spawnCalls.length, 1);

    console.log(JSON.stringify({ pass: true, suite: 'workspace-settings-api', max: initial.body.max }));
  } finally {
    await new Promise(resolve => srv.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
