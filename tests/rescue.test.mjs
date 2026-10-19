import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRescueCore, sha256 } from '../apps/rescue/rescue-core.mjs';
import { createRescueServer } from '../apps/rescue/rescue-service.mjs';

function fixture(extra = {}, dependencies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu-rescue-'));
  const appRoot = path.join(root, 'app'), rescueHome = path.join(root, 'rescue');
  fs.mkdirSync(appRoot); fs.writeFileSync(path.join(appRoot, 'app.mjs'), 'old'); fs.writeFileSync(path.join(appRoot, 'peer.mjs'), 'peer');
  const commands = [];
  const config = { appRoot, rescueHome, editableFiles: ['app.mjs', 'peer.mjs'], ownerTokenEnv: 'OWNER_TOKEN', ownerActor: 'owner', actors: [
    { id: 'owner', read: true, write: true, activate: true }, { id: 'remote', tokenEnv: 'REMOTE_TOKEN', read: true, write: true }, { id: 'api', read: true, write: true },
  ], ...extra };
  const deps = { command: async (name, cwd) => { commands.push({ name, cwd }); }, health: async () => true, ...dependencies };
  return { root, appRoot, config, deps, commands, core: createRescueCore(config, deps), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('rescue can accept owner input with main absent, persists and rejects unauthenticated/forged origins', async () => {
  const f = fixture(); const server = createRescueServer(f.config, { core: f.core, env: { OWNER_TOKEN: 'o'.repeat(32), REMOTE_TOKEN: 'r'.repeat(32) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const headers = { Authorization: 'Bearer ' + 'o'.repeat(32), 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/input', { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' }, body: '{"text":"no"}' })).status, 403);
    assert.equal((await fetch(base + '/api/input', { method: 'POST', headers, body: '{"text":"主程序已关闭，请先核验"}' })).status, 200);
    assert.equal((await (await fetch(base + '/api/state', { headers })).json()).mainAppRequired, false);
    assert.equal(createRescueCore(f.config, f.deps).status().inputs[0].text, '主程序已关闭，请先核验');
    const noModel = await fetch(base + '/api/run', { method: 'POST', headers, body: '{}' }); assert.equal(noModel.status, 400); assert.match((await noModel.json()).error, /尚未配置/);
    const remote = { Authorization: 'Bearer ' + 'r'.repeat(32), 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/repair', { method: 'POST', headers: remote, body: '{"action":"apply"}' })).status, 400);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); f.close(); }
});
test('staging enforces identity, path, compare-and-set and is independent of live files', async () => {
  const f = fixture();
  try {
    assert.throws(() => f.core.read('untrusted-model', 'app.mjs'), /没有/);
    for (const file of ['../secret', 'data/chat.json', 'config.json', 'rescue/progress.json']) assert.throws(() => f.core.read('owner', file), /清单/);
    assert.throws(() => f.core.stage('owner', 'app.mjs', 'new', 'stale'), /已变化/);
    f.core.stage('owner', 'app.mjs', 'new', sha256('old'));
    assert.equal(fs.readFileSync(path.join(f.appRoot, 'app.mjs'), 'utf8'), 'old');
    await f.core.check('owner'); await assert.rejects(f.core.apply('owner'), /默认关闭/);
    fs.writeFileSync(path.join(f.appRoot, 'peer.mjs'), 'someone-else');
    assert.equal(f.core.status().phase, 'checked');
  } finally { f.close(); }
});
test('activation restarts only fixed owner operations and never rolls back chat data', async () => {
  const f = fixture({ activationEnabled: true });
  try {
    fs.mkdirSync(path.join(f.appRoot, 'data')); fs.writeFileSync(path.join(f.appRoot, 'data', 'chat.json'), 'retained');
    f.core.stage('owner', 'app.mjs', 'new', sha256('old')); await f.core.check('owner');
    assert.throws(() => f.core.apply('remote'), /没有/);
    const result = await f.core.apply('owner'); assert.equal(result.phase, 'completed');
    assert.equal(fs.readFileSync(path.join(f.appRoot, 'app.mjs'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(f.appRoot, 'data', 'chat.json'), 'utf8'), 'retained');
    assert.deepEqual(f.commands.map(c => c.name), ['check', 'stop', 'start']);
    await f.core.rollback('owner'); assert.equal(fs.readFileSync(path.join(f.appRoot, 'app.mjs'), 'utf8'), 'old');
  } finally { f.close(); }
});
test('unhealthy candidate rolls back, changed dependency blocks before any stop', async () => {
  let checks = 0; const f = fixture({ activationEnabled: true }, { health: async () => ++checks > 1 });
  try {
    f.core.stage('owner', 'app.mjs', 'bad', sha256('old')); await f.core.check('owner');
    assert.equal((await f.core.apply('owner')).phase, 'rolled-back'); assert.equal(fs.readFileSync(path.join(f.appRoot, 'app.mjs'), 'utf8'), 'old');
    f.core.stage('owner', 'app.mjs', 'new', sha256('old')); await f.core.check('owner'); fs.writeFileSync(path.join(f.appRoot, 'peer.mjs'), 'changed');
    const count = f.commands.length; await assert.rejects(f.core.apply('owner'), /已变化/); assert.equal(f.commands.length, count);
  } finally { f.close(); }
});
test('crash state requires recovery and symlink cannot escape editable scope', () => {
  const f = fixture();
  try {
    f.core.stage('owner', 'app.mjs', 'new', sha256('old'));
    const journal = path.join(f.config.rescueHome, 'progress.json'); const data = JSON.parse(fs.readFileSync(journal)); data.phase = 'applying'; fs.writeFileSync(journal, JSON.stringify(data));
    const restored = createRescueCore(f.config, f.deps); assert.equal(restored.status().phase, 'recovery-required'); assert.throws(() => restored.stage('owner', 'app.mjs', 'again', sha256('old')), /待核验/);
    fs.rmSync(path.join(f.appRoot, 'app.mjs')); fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.appRoot, 'app.mjs'));
    assert.throws(() => f.core.read('owner', 'app.mjs'), /符号链接/);
  } finally { f.close(); }
});
test('independent API model works while main is absent; capped calls survive restart', async () => {
  const f = fixture({ apiActor: 'api', apiModelId: 'assistant', apiMaxCalls: 1 });
  f.config.providersFile = path.join(f.root, 'providers.json');
  fs.writeFileSync(f.config.providersFile, JSON.stringify({ schema: 1, providers: [{ id: 'demo', baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'MODEL_KEY' }], models: [{ id: 'assistant', provider: 'demo', model: 'test', capabilities: { tools: true } }] }));
  let calls = 0;
  const server = createRescueServer(f.config, { core: f.core, env: { OWNER_TOKEN: 'o'.repeat(32), MODEL_KEY: 'fake-key' }, fetchImpl: async (_url, request) => {
    calls++; assert.equal(request.headers.Authorization, 'Bearer fake-key'); return new Response(JSON.stringify({ choices: [{ message: { content: '主程序不在线；独立接口仍可回复。' } }] }));
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { Authorization: 'Bearer ' + 'o'.repeat(32), 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/run', { method: 'POST', headers, body: '{}' })).status, 202);
    for (let i = 0; i < 30 && !f.core.status().events.some(e => e.message.includes('仍可回复')); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(calls, 1); assert(f.core.status().events.some(e => e.message.includes('仍可回复')));
    const state = await (await fetch(base + '/api/state', { headers })).text(); assert(!state.includes('fake-key')); assert(!state.includes('MODEL_KEY'));
    assert.equal((await fetch(base + '/api/run', { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.config.rescueHome, 'api-budget.json'))).calls, 1);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); f.close(); }
});
