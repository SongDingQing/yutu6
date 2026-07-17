#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RuntimeSettings = require('../projects/控制台/runtime-settings');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-runtime-settings-'));
  const configPath = path.join(root, '.hermes', 'config', 'console-runtime.json');
  const warnings = [];
  const logger = { warn: message => warnings.push(String(message)) };
  try {
    const bounds = RuntimeSettings.concurrencyBounds(2);
    assert.deepStrictEqual(bounds, { min: 1, max: 4 });
    assert(RuntimeSettings.runtimeConfigPath({}).endsWith(path.join('.hermes', 'config', 'console-runtime.json')));

    const missing = RuntimeSettings.loadRuntimeSettings({ configPath, env: { ENGINE_MAX_CONCURRENCY: '2' }, cpuCount: 2, logger });
    assert.strictEqual(missing.engineMaxConcurrency, 2);
    assert.strictEqual(missing.source, 'legacy-env');

    await RuntimeSettings.saveRuntimeSettings(1, { configPath, cpuCount: 2 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { version: 1, engineMaxConcurrency: 1 });
    assert.strictEqual(fs.statSync(path.dirname(configPath)).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600);
    const fromFile = RuntimeSettings.loadRuntimeSettings({ configPath, env: { ENGINE_MAX_CONCURRENCY: '4' }, cpuCount: 2, logger });
    assert.strictEqual(fromFile.engineMaxConcurrency, 1, 'private config must override legacy env');
    assert.strictEqual(fromFile.source, 'private-config');

    const beforeInvalid = fs.readFileSync(configPath, 'utf8');
    await assert.rejects(RuntimeSettings.saveRuntimeSettings(1.5, { configPath, cpuCount: 2 }), /integer/);
    await assert.rejects(RuntimeSettings.saveRuntimeSettings(5, { configPath, cpuCount: 2 }), /integer/);
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), beforeInvalid, 'validation failure must preserve prior config');

    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('injected rename failure'); };
    try {
      await assert.rejects(RuntimeSettings.saveRuntimeSettings(2, { configPath, cpuCount: 2 }), /injected rename failure/);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), beforeInvalid, 'atomic write failure must preserve prior config');
    assert.strictEqual(fs.readdirSync(path.dirname(configPath)).filter(name => name.endsWith('.tmp')).length, 0);

    await Promise.all([1, 2, 3, 4].map(value => RuntimeSettings.saveRuntimeSettings(value, { configPath, cpuCount: 2 })));
    const concurrent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert([1, 2, 3, 4].includes(concurrent.engineMaxConcurrency));
    assert.strictEqual(fs.readdirSync(path.dirname(configPath)).filter(name => name.endsWith('.lock')).length, 0);

    fs.writeFileSync(configPath, '{broken json\n', { mode: 0o600 });
    const fallback = RuntimeSettings.loadRuntimeSettings({ configPath, env: { ENGINE_MAX_CONCURRENCY: '3' }, cpuCount: 2, logger });
    assert.strictEqual(fallback.engineMaxConcurrency, 3);
    assert.strictEqual(fallback.source, 'legacy-env');
    assert(warnings.some(line => /ignored/.test(line)));
    assert(!warnings.join('\n').includes('{broken json'), 'warning must not echo config content');

    const helper = path.join(__dirname, '..', 'projects', '控制台', 'tools', 'restart-console-safe.js');
    const rejectedArgs = spawnSync(process.execPath, [helper, '--service', 'evil'], { encoding: 'utf8', env: { CONSOLE_ARTIFACTS_DIR: root } });
    assert.strictEqual(rejectedArgs.status, 64);
    assert.match(rejectedArgs.stderr, /accepts no arguments/);
    const helperSource = fs.readFileSync(helper, 'utf8');
    assert(!helperSource.includes('SIGKILL'));
    assert(!helperSource.includes('shell:'));
    assert(helperSource.includes("const LABEL = 'com.yutu6.console'"));

    const previousArtifactsDir = process.env.CONSOLE_ARTIFACTS_DIR;
    const helperArtifacts = path.join(root, 'restart-helper-artifacts');
    process.env.CONSOLE_ARTIFACTS_DIR = helperArtifacts;
    delete require.cache[require.resolve(helper)];
    const RestartHelper = require(helper);
    try {
      let stopEntered = false;
      await assert.rejects(
        RestartHelper.stopIdleWorkersWithRunningGuards(async () => {
          stopEntered = true;
          const runningDir = path.join(helperArtifacts, 'queues', 'worker_code', 'running');
          fs.mkdirSync(runningDir, { recursive: true });
          fs.writeFileSync(path.join(runningDir, 'claimed-after-http-check.json'), '{}\n');
        }),
        error => error && error.code === 'CONSOLE_RESTART_RUNNING' && error.runningCount === 1,
        'a running task claimed between the two helper scans must abort restart',
      );
      assert.strictEqual(stopEntered, true);
      assert.strictEqual(RestartHelper.runningQueueFiles().length, 1);
    } finally {
      if (previousArtifactsDir == null) delete process.env.CONSOLE_ARTIFACTS_DIR;
      else process.env.CONSOLE_ARTIFACTS_DIR = previousArtifactsDir;
      delete require.cache[require.resolve(helper)];
    }

    const guardedStopIndex = helperSource.indexOf('await stopIdleWorkersWithRunningGuards();');
    const finalRunningCheckIndex = helperSource.indexOf("assertNoRunningTasks('before launchd TERM');");
    const termIndex = helperSource.indexOf("fixedCommand('/bin/launchctl', ['kill', 'TERM', TARGET])");
    assert(guardedStopIndex >= 0, 'helper must guard the real idle-worker stop');
    assert(finalRunningCheckIndex > guardedStopIndex, 'helper must re-scan after the worker-stop phase');
    assert(termIndex > finalRunningCheckIndex, 'the final running scan must occur immediately before launchd TERM');

    console.log(JSON.stringify({ pass: true, suite: 'runtime-settings', bounds }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
