#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const catalogFile = path.join(root, 'projects', '控制台', 'config', 'agent-platforms.json');
const managerFile = path.join(root, 'projects', '控制台', 'tools', 'agent-platforms.js');
const wrapperFile = path.join(root, 'agent-platforms.sh');
const manager = require(managerFile);

const catalog = manager.readCatalog();
assert.strictEqual(catalog.schema, 'yutu6-agent-platforms@1');
assert.strictEqual(catalog.policy.default_platform, 'yutu6-native');
assert.strictEqual(catalog.policy.external_autostart, false);

const native = manager.platformById(catalog, 'yutu6-native');
const fabric = manager.platformById(catalog, 'yutu6-fabric');
const nexent = manager.platformById(catalog, 'nexent');
assert.strictEqual(native.enabled, true);
assert.strictEqual(native.autostart, true);
assert.strictEqual(fabric.enabled, true);
assert.strictEqual(fabric.autostart, true);
assert.strictEqual(fabric.ports.http, 3020);
assert.strictEqual(nexent.enabled, false);
assert.strictEqual(nexent.autostart, false);
assert.strictEqual(nexent.heavy, true);
assert.strictEqual(nexent.ports.upstream_web, 3000);
assert.strictEqual(nexent.ports.yutu6_web, 3100);
assert.strictEqual(nexent.launch.temporary_port_rewrite.from, '"3000:3000"');

const plan = manager.plan(nexent, catalog);
assert.strictEqual(plan.recommendation, 'optional_a2a_sidecar');
assert(plan.start.includes('--confirm-heavy'));
assert.strictEqual(plan.model_pool.base_url, 'http://host.docker.internal:3000/v1');
assert(plan.completion_boundary.includes('not a trusted done verdict'));
const fabricPlan = manager.plan(fabric, catalog);
assert.strictEqual(fabricPlan.recommendation, 'primary_model_and_agent_plane');
assert.strictEqual(fabricPlan.model_pool.base_url, 'http://127.0.0.1:3020/v1');

const models = manager.runnerInventory();
assert(models.some(entry => entry.source === 'yutu6-model-pool'));
assert(models.some(entry => entry.source === 'cli'));
assert(models.every(entry => !Object.prototype.hasOwnProperty.call(entry, 'token')));
assert(models.every(entry => !Object.prototype.hasOwnProperty.call(entry, 'tokenFile')));

const list = spawnSync(process.execPath, [managerFile, 'list', '--json'], {
  cwd: root,
  encoding: 'utf8',
});
assert.strictEqual(list.status, 0, list.stderr);
assert.strictEqual(JSON.parse(list.stdout).length, 3);

const heavyFence = spawnSync(process.execPath, [managerFile, 'start', 'nexent'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 5000,
});
assert.notStrictEqual(heavyFence.status, 0);
assert(heavyFence.stderr.includes('--confirm-heavy'));

for (const file of [catalogFile, managerFile, wrapperFile]) {
  assert(fs.existsSync(file), `missing platform integration file: ${file}`);
}

const source = `${fs.readFileSync(catalogFile, 'utf8')}\n${fs.readFileSync(managerFile, 'utf8')}`;
assert(!/(sk-|ma_live_)[A-Za-z0-9._-]{10,}/.test(source), 'platform files must not embed secret values');
assert(!source.includes('restart: always'), 'optional platform must not be added as an autostart service');

console.log(JSON.stringify({
  pass: true,
  suite: 'agent-platforms',
  platforms: catalog.platforms.length,
  runners: models.length,
}));
