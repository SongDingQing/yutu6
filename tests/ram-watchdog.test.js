#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RamWatchdog = require('../projects/控制台/tools/ram-watchdog');

const GiB = 1024 * 1024 * 1024;

function fakeMemory(usedRatio, opts = {}) {
  const totalBytes = opts.totalBytes || 40 * GiB;
  const availableBytes = Math.round(totalBytes * (1 - usedRatio));
  const reclaimableBytes = opts.reclaimableBytes || 6 * GiB;
  return {
    ok: true,
    totalBytes,
    freeBytes: Math.max(0, availableBytes - reclaimableBytes),
    speculativeBytes: 1 * GiB,
    inactiveBytes: 4 * GiB,
    purgeableBytes: 1 * GiB,
    fileBackedBytes: 3 * GiB,
    wiredBytes: 2 * GiB,
    compressedBytes: 512 * 1024 * 1024,
    reclaimableBytes,
    availableBytes,
    usedBytes: totalBytes - availableBytes,
    usedRatio,
    availableRatio: 1 - usedRatio,
    swap: {
      totalBytes: 8 * GiB,
      usedBytes: opts.swapUsedBytes || 0,
      usedRatio: (opts.swapUsedBytes || 0) / (8 * GiB),
    },
    memoryPressure: { freePercent: Math.round((1 - usedRatio) * 100), pagesWanted: 0, available: true },
  };
}

function writeJsonl(file, count) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [];
  for (let i = 0; i < count; i++) lines.push(JSON.stringify({ i }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

async function main() {
  const vm = RamWatchdog.parseVmStat([
    'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
    'Pages free: 10.',
    'Pages active: 20.',
    'Pages inactive: 30.',
    'Pages speculative: 40.',
    'Pages purgeable: 50.',
    'Pages wired down: 60.',
    'Pages occupied by compressor: 70.',
  ].join('\n'), 1000 * 4096);
  assert.strictEqual(vm.pageSize, 4096);
  assert.strictEqual(vm.reclaimableBytes, (30 + 40 + 50) * 4096);
  assert.strictEqual(vm.availableBytes, (10 + 30 + 40 + 50) * 4096);

  const defaultConfig = RamWatchdog.normalizeConfig({}, {});
  assert.strictEqual(defaultConfig.killGate.enableKillConfigured, null);
  assert.strictEqual(defaultConfig.killGate.liveKillAllowed, false);
  assert(defaultConfig.intervalMs >= 30 * 1000);

  const enabledConfig = RamWatchdog.normalizeConfig({
    enable_kill: true,
    kill_confirm: RamWatchdog.KILL_CONFIRM_TOKEN,
    kill_supervisor_approved: true,
    kill_allowlist: ['AllowedApp'],
  }, { executeKill: true });
  assert.strictEqual(enabledConfig.killGate.configReadyForFutureLiveKill, true);
  assert.strictEqual(enabledConfig.killGate.liveKillAllowed, false);
  assert.deepStrictEqual(enabledConfig.killAllowlist, ['AllowedApp']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ram-watchdog-test-'));
  const stateFile = path.join(root, 'state.json');
  const statusFile = path.join(root, 'status.json');
  const trendFile = path.join(root, 'ram_trend.jsonl');
  const actionsFile = path.join(root, 'actions.jsonl');
  const lockFile = path.join(root, 'sample.lock');
  const eventsFile = path.join(root, 'engine-events.jsonl');
  try {
    const unsupported = await RamWatchdog.runOnce({
      platform: 'linux',
      stateFile,
      statusFile,
      trendFile,
      actionsFile,
      lockFile,
      eventsFile,
      config: {},
    });
    assert.strictEqual(unsupported.supportedPlatform, false);
    assert.strictEqual(unsupported.ok, false);
    assert(fs.existsSync(statusFile), 'unsupported run still writes explicit status');

    const processes = [
      { pid: 1, ppid: 0, rssBytes: 3 * GiB, commandName: 'kernel_task' },
      { pid: 22, ppid: 1, rssBytes: 2 * GiB, commandName: 'WindowServer' },
      { pid: 33, ppid: 1, rssBytes: 1500 * 1024 * 1024, commandName: 'Safari' },
      { pid: 44, ppid: 1, rssBytes: 2 * GiB, commandName: 'AllowedApp' },
      { pid: 77, ppid: 1, rssBytes: 2 * GiB, commandName: 'WorkerApp' },
      { pid: process.pid, ppid: process.ppid, rssBytes: 512 * 1024 * 1024, commandName: 'node' },
    ];
    const high1 = await RamWatchdog.runOnce({
      platform: 'darwin',
      stateFile,
      statusFile,
      trendFile,
      actionsFile,
      lockFile,
      eventsFile,
      memoryUsage: { rss: 300 * 1024 * 1024 },
      config: {
        high_used_ratio: 0.80,
        critical_used_ratio: 0.95,
        consecutive_limit: 2,
        kill_allowlist: ['AllowedApp', 'WorkerApp'],
        trend_retention_lines: 1000,
        action_retention_lines: 1000,
        min_candidate_rss_bytes: 1024,
        self_rss_limit_bytes: 256 * 1024 * 1024,
      },
      consoleProtectedPids: [77],
      collectMemory: async () => fakeMemory(0.90),
      collectProcesses: async () => ({ ok: true, processes }),
      frontmostApp: async () => ({ ok: true, name: 'Safari' }),
    });
    assert.strictEqual(high1.pressure.level, 'high');
    assert.strictEqual(high1.pressure.consecutiveHighCount, 1);
    assert.strictEqual(high1.pressure.alarm, false);
    assert.strictEqual(high1.cleanupPlan.manualActions.length, 1);
    assert.strictEqual(high1.cleanupPlan.manualActions[0].command, 'sudo purge');
    assert.strictEqual(high1.cleanupPlan.manualActions[0].autoExecuted, false);
    assert.strictEqual(high1.killPlan.dryRun, true);
    assert(high1.killPlan.candidates.some(p => p.commandName === 'AllowedApp'));
    assert(!high1.killPlan.candidates.some(p => p.commandName === 'WorkerApp'));
    assert(high1.killPlan.topConsumers.some(p => p.commandName === 'WorkerApp' && p.reasons.includes('protected-pid')));
    assert(high1.killPlan.topConsumers.some(p => p.commandName === 'Safari' && p.reasons.includes('protected-name')));
    assert(high1.protection.protectedNames.includes('kernel_task'));
    assert(high1.protection.protectedNames.includes('WindowServer'));
    assert(high1.protection.protectedNames.includes('Finder'));
    assert(high1.protection.protectedNames.includes('Safari'));
    assert(high1.protection.protectedPids.includes(77));
    assert(high1.protection.consoleProtectedPids.includes(77));
    assert(high1.self.overRssLimit, 'watchdog self RSS guard must be surfaced');

    const high2 = await RamWatchdog.runOnce({
      platform: 'darwin',
      stateFile,
      statusFile,
      trendFile,
      actionsFile,
      lockFile,
      eventsFile,
      memoryUsage: { rss: 80 * 1024 * 1024 },
      config: {
        high_used_ratio: 0.80,
        critical_used_ratio: 0.95,
        consecutive_limit: 2,
        kill_allowlist: ['AllowedApp'],
        min_candidate_rss_bytes: 1024,
      },
      collectMemory: async () => fakeMemory(0.90),
      collectProcesses: async () => ({ ok: true, processes }),
      frontmostApp: async () => ({ ok: true, name: 'Safari' }),
    });
    assert.strictEqual(high2.pressure.consecutiveHighCount, 2);
    assert.strictEqual(high2.pressure.alarm, true);
    assert(fs.readFileSync(trendFile, 'utf8').trim().split(/\r?\n/).length >= 2);

    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
    const skipped = await RamWatchdog.runOnce({
      platform: 'darwin',
      stateFile,
      statusFile,
      trendFile,
      actionsFile,
      lockFile,
      eventsFile,
      collectMemory: async () => fakeMemory(0.10),
      collectProcesses: async () => ({ ok: true, processes: [] }),
      frontmostApp: async () => ({ ok: false, name: null }),
    });
    assert.strictEqual(skipped.skipped, true);
    assert.strictEqual(skipped.reason, 'sample-lock-held');
    fs.unlinkSync(lockFile);

    writeJsonl(trendFile, 1005);
    const rotation = RamWatchdog.rotateJsonl(trendFile, 1000);
    assert.strictEqual(rotation.rotated, true);
    assert.strictEqual(rotation.kept, 1000);
    assert.strictEqual(fs.readFileSync(trendFile, 'utf8').trim().split(/\r?\n/).length, 1000);

    const plist = path.join(__dirname, '../projects/控制台/launchd/com.yutu6.ram-watchdog.plist');
    const plistText = fs.readFileSync(plist, 'utf8');
    assert(plistText.includes('<string>com.yutu6.ram-watchdog</string>'));
    assert(plistText.includes('ram-watchdog.js'));
    assert(plistText.includes('<integer>300</integer>'));
    const lint = spawnSync('plutil', ['-lint', plist], { encoding: 'utf8' });
    if (lint.error && lint.error.code === 'ENOENT') {
      console.warn('plutil not available; plist lint skipped');
    } else {
      assert.strictEqual(lint.status, 0, lint.stderr || lint.stdout);
    }

    console.log(JSON.stringify({ pass: true, suite: 'ram-watchdog' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
