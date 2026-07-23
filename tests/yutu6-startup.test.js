#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const control = path.join(root, 'projects', '控制台');
const manifestFile = path.join(control, 'config', 'startup-components.json');
const managerFile = path.join(control, 'tools', 'yutu6-startup.js');
const wrapperFile = path.join(root, 'start-all.sh');
const installerFile = path.join(control, 'tools', 'install-unified-startup-launchd.sh');
const bootstrapPlist = path.join(control, 'launchd', 'com.yutu6.startup.plist');

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
assert.strictEqual(manifest.schema, 'yutu6-startup-components@1');

const ids = manifest.launch_agents.map(entry => entry.id);
assert.strictEqual(new Set(ids).size, ids.length, 'startup component ids must be unique');
for (const required of [
  'console',
  'model-fabric',
  'hermes-gateway',
  'hermes-voice-wake',
  'yuanxiao-decision-pull',
  'yuanxiao-tasks-push',
  'console-watchdog',
  'ram-watchdog',
  'long-run-maintenance',
  'worker-orphan-reaper',
  'daily-governance-hardening',
]) {
  assert(ids.includes(required), `missing startup component: ${required}`);
}

const excluded = new Set(manifest.excluded.map(entry => entry.id));
assert(excluded.has('frontend-canary'));
assert(excluded.has('repair-memory-maintenance'));
assert(excluded.has('queue-workers'));
for (const id of excluded) assert(!ids.includes(id), `excluded component is active: ${id}`);

for (const entry of manifest.launch_agents) {
  if (!entry.source) continue;
  const file = path.join(control, entry.source);
  assert(fs.existsSync(file), `missing plist: ${file}`);
  const lint = spawnSync('/usr/bin/plutil', ['-lint', file], { encoding: 'utf8' });
  assert.strictEqual(lint.status, 0, lint.stderr || lint.stdout);
}

for (const file of [managerFile, wrapperFile, installerFile, bootstrapPlist]) {
  assert(fs.existsSync(file), `missing unified startup file: ${file}`);
}

const managerSource = fs.readFileSync(managerFile, 'utf8');
assert(managerSource.includes("fs.openSync(LOCK_FILE, 'wx'"), 'startup manager needs a single-flight lock');
assert(managerSource.includes("'compose', '-f', composeFile, 'up', '-d'"), 'startup manager must reconcile compose');
assert(managerSource.includes("['kickstart', `${DOMAIN}/${entry.label}`]"), 'startup manager must recover stopped services');
assert(managerSource.includes('writeJsonAtomic(STATUS_FILE'), 'startup manager must persist health status');

const bootstrapSource = fs.readFileSync(bootstrapPlist, 'utf8');
assert(bootstrapSource.includes('<string>com.yutu6.startup</string>'));
assert(bootstrapSource.includes('<key>RunAtLoad</key>'));
assert(bootstrapSource.includes('<key>StartInterval</key>'));
assert(bootstrapSource.includes('<integer>600</integer>'));
assert(bootstrapSource.includes('<string>--quiet</string>'));
assert(bootstrapSource.includes('<string>/dev/null</string>'));

const validate = spawnSync('/bin/bash', [wrapperFile, 'validate'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30000,
});
assert.strictEqual(validate.status, 0, validate.stderr || validate.stdout);
assert.strictEqual(JSON.parse(validate.stdout).ok, true);

const secretPattern = /(API_KEY|TOKEN|PASSWORD|SECRET)\s*[:=]\s*["'][^"']+["']/i;
assert(!secretPattern.test(managerSource), 'startup manager must not embed secret values');

console.log(JSON.stringify({ pass: true, suite: 'yutu6-startup', components: ids.length }));
