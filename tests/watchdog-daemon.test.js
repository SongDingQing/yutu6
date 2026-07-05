#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Q = require('../shared/engine/queue');
const Watchdog = require('../projects/控制台/watchdog-daemon');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function isoAge(ms) {
  return new Date(Date.now() - ms).toISOString();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-watchdog-test-'));
  const artifactsRoot = path.join(root, 'artifacts');
  const stateFile = path.join(root, 'state.json');
  const restartLog = path.join(root, 'restarts.jsonl');
  const statusFile = path.join(root, 'status.json');
  const eventsFile = path.join(artifactsRoot, 'engine-events.jsonl');

  try {
    fs.mkdirSync(artifactsRoot, { recursive: true });
    fs.writeFileSync(eventsFile, JSON.stringify({
      seq: 1,
      ts: isoAge(20 * 60 * 1000),
      type: 'node.start',
      task: 'stale-task',
    }) + '\n' + JSON.stringify({
      seq: 2,
      ts: new Date().toISOString(),
      type: 'watchdog.daemon.start',
    }) + '\n');

    Q.enqueue(artifactsRoot, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'watchdog stale running regression',
    }, { id: 'staleRun', priority: 10 });
    const claimed = Q.claim(artifactsRoot, 'ceo', { owner: 'test', ownerPid: 999999, leaseMs: 1000 });
    assert.strictEqual(claimed.id, 'staleRun');
    writeJson(path.join(artifactsRoot, 'queues', 'ceo', 'running', 'staleRun.json'), Object.assign({}, claimed, {
      enginePid: 999999,
      engine_heartbeat_at: isoAge(20 * 60 * 1000),
      lease_heartbeat_at: isoAge(20 * 60 * 1000),
      heartbeat_at: isoAge(20 * 60 * 1000),
      updated_at: isoAge(20 * 60 * 1000),
      started_at: isoAge(20 * 60 * 1000),
      progress_at: isoAge(20 * 60 * 1000),
    }));
    writeJson(path.join(artifactsRoot, 'engine-slots', 'slot-0.json'), {
      agent: 'ceo',
      queueId: 'staleRun',
      runnerType: 'codex',
      ownerPid: 999999,
      enginePid: 999999,
      started_at: isoAge(20 * 60 * 1000),
      heartbeat_at: isoAge(20 * 60 * 1000),
    });

    Q.enqueue(artifactsRoot, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'watchdog no-progress regression',
    }, { id: 'noProgressRun', priority: 11 });
    const noProgress = Q.claim(artifactsRoot, 'ceo', { owner: 'test', ownerPid: 999999, leaseMs: 1000 });
    assert.strictEqual(noProgress.id, 'noProgressRun');
    writeJson(path.join(artifactsRoot, 'queues', 'ceo', 'running', 'noProgressRun.json'), Object.assign({}, noProgress, {
      enginePid: 999999,
      engine_heartbeat_at: new Date().toISOString(),
      lease_heartbeat_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: isoAge(20 * 60 * 1000),
      progress_at: isoAge(20 * 60 * 1000),
    }));

    Q.enqueue(artifactsRoot, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'watchdog fresh-progress regression',
    }, { id: 'freshProgressRun', priority: 12 });
    const freshProgress = Q.claim(artifactsRoot, 'ceo', { owner: 'test', ownerPid: 999999, leaseMs: 1000 });
    assert.strictEqual(freshProgress.id, 'freshProgressRun');
    writeJson(path.join(artifactsRoot, 'queues', 'ceo', 'running', 'freshProgressRun.json'), Object.assign({}, freshProgress, {
      enginePid: 999999,
      engine_heartbeat_at: new Date().toISOString(),
      lease_heartbeat_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: isoAge(20 * 60 * 1000),
      progress_at: new Date().toISOString(),
      node_event_at: new Date().toISOString(),
    }));

    const health = await Watchdog.collectHealth({
      artifactsRoot,
      eventsFile,
      checkConsole: false,
      checkHttp: false,
      workerStaleMs: 1000,
      runningStaleMs: 1000,
      noProgressStaleMs: 1000,
      eventStaleMs: 1000,
      lockStaleMs: 1000,
      persistentAgents: [],
    });
    assert.strictEqual(health.restartRequired, true);
    assert(health.problems.some(p => p.type === 'worker-heartbeat-stale' && p.queueAgent === 'ceo'));
    const workerStale = health.problems.find(p => p.type === 'worker-heartbeat-stale' && p.queueAgent === 'ceo');
    assert.strictEqual(typeof workerStale.dailyIgnitionWindow, 'boolean');
    assert(workerStale.dailyIgnitionAttribution && workerStale.dailyIgnitionAttribution.timeZone === 'Asia/Shanghai');
    assert(health.problems.some(p => p.type === 'running-heartbeat-stale' && p.queueId === 'staleRun'));
    assert(health.problems.some(p => p.type === 'running-no-progress' && p.queueId === 'noProgressRun'));
    assert(!health.problems.some(p => p.queueId === 'freshProgressRun'), 'fresh heartbeat plus explicit progress must not be a watchdog problem');
    assert(health.problems.some(p => p.type === 'runtime-lock-leak' && p.file === 'slot-0.json'));
    assert(health.problems.some(p => p.type === 'engine-events-stale' && p.latestType === 'node.start'));

    let healthProbeAttempts = 0;
    const slowHealth = await Watchdog.collectHealth({
      artifactsRoot,
      eventsFile,
      persistentAgents: [],
      checkConsole: true,
      workerStaleMs: 60 * 60 * 1000,
      runningStaleMs: 60 * 60 * 1000,
      noProgressStaleMs: 60 * 60 * 1000,
      eventStaleMs: 60 * 60 * 1000,
      lockStaleMs: 60 * 60 * 1000,
      httpReadyGraceMs: 1000,
      httpProbeIntervalMs: 1,
      ops: {
        launchdInfo: () => ({ ok: true, target: 'gui/501/com.yutu6.console', pid: 12345, alive: true, state: 'running' }),
        httpProbe: async () => {
          healthProbeAttempts += 1;
          return healthProbeAttempts < 3
            ? { ok: false, error: 'timeout 2500ms' }
            : { ok: true, statusCode: 200 };
        },
      },
    });
    assert(!slowHealth.problems.some(p => p.type === 'console-http-failed'), 'slow HTTP health inside grace window must not request HTTP restart');
    assert.strictEqual(healthProbeAttempts, 3, 'collectHealth must retry HTTP probe before deciding');

    writeJson(stateFile, {
      restarts: [
        { atMs: Date.now() - 1000, at: isoAge(1000), reason: 'one' },
      ],
    });
    const cooldown = Watchdog.throttleRestart('cooldown regression', {
      stateFile,
      restartCooldownMs: 60 * 1000,
      restartWindowMs: 10 * 60 * 1000,
      restartMaxInWindow: 3,
    });
    assert.strictEqual(cooldown.allowed, false);
    assert.strictEqual(cooldown.reason, 'cooldown');

    writeJson(stateFile, {
      restarts: [
        { atMs: Date.now() - 3 * 60 * 1000, at: isoAge(3 * 60 * 1000), reason: 'one' },
        { atMs: Date.now() - 2 * 60 * 1000, at: isoAge(2 * 60 * 1000), reason: 'two' },
      ],
    });
    const maxed = Watchdog.throttleRestart('max regression', {
      stateFile,
      restartCooldownMs: 10,
      restartWindowMs: 10 * 60 * 1000,
      restartMaxInWindow: 2,
    });
    assert.strictEqual(maxed.allowed, false);
    assert.strictEqual(maxed.reason, 'max-in-window');

    writeJson(stateFile, {
      restarts: [
        { atMs: Date.now() - 1000, at: isoAge(1000), reason: 'duplicate throttle' },
      ],
    });
    const throttleHealth = {
      problems: [{ type: 'console-http-failed', restart: true, reason: 'timeout 2500ms' }],
    };
    let throttleNotifyCount = 0;
    const throttleOpts = {
      stateFile,
      restartLog,
      eventsFile,
      restartCooldownMs: 60 * 1000,
      restartWindowMs: 10 * 60 * 1000,
      restartMaxInWindow: 3,
      ops: {
        notifyOwner: async () => {
          throttleNotifyCount += 1;
          return { attempted: true, sent: true };
        },
      },
    };
    const throttleOne = await Watchdog.restartConsole(throttleHealth, Object.assign({ reason: 'duplicate throttle' }, throttleOpts));
    const throttleTwo = await Watchdog.restartConsole(throttleHealth, Object.assign({ reason: 'duplicate throttle' }, throttleOpts));
    assert.strictEqual(throttleOne.status, 'throttled');
    assert.strictEqual(throttleTwo.status, 'throttled');
    assert.strictEqual(throttleNotifyCount, 1, 'same throttle window must only notify once');

    writeJson(stateFile, { restarts: [] });
    const order = [];
    const restart = await Watchdog.restartConsole(health, {
      stateFile,
      restartLog,
      eventsFile,
      skipThrottle: true,
      notify: true,
      ops: {
        stopConsoleService: async () => { order.push('stop'); return { ok: true }; },
        cleanupRuntimeArtifacts: async () => { order.push('cleanup'); return { ok: true }; },
        startConsoleService: async () => { order.push('start'); return { ok: true }; },
        httpProbe: async () => { order.push('probe'); return { ok: true }; },
        notifyOwner: async () => { order.push('notify'); return { attempted: true, sent: true }; },
      },
    });
    assert.strictEqual(restart.status, 'restarted');
    assert.deepStrictEqual(order, ['stop', 'cleanup', 'start', 'probe']);
    const restartText = fs.readFileSync(restartLog, 'utf8');
    assert(restartText.includes('"status":"restarted"'));

    const slowReadyOrder = [];
    let slowReadyAttempts = 0;
    const slowReady = await Watchdog.restartConsole(health, {
      stateFile,
      restartLog,
      eventsFile,
      skipThrottle: true,
      notify: false,
      httpReadyGraceMs: 1000,
      httpProbeIntervalMs: 1,
      ops: {
        stopConsoleService: async () => { slowReadyOrder.push('stop'); return { ok: true }; },
        cleanupRuntimeArtifacts: async () => { slowReadyOrder.push('cleanup'); return { ok: true }; },
        startConsoleService: async () => { slowReadyOrder.push('start'); return { ok: true }; },
        httpProbe: async () => {
          slowReadyAttempts += 1;
          slowReadyOrder.push(`probe-${slowReadyAttempts}`);
          return slowReadyAttempts < 3
            ? { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:41218' }
            : { ok: true, statusCode: 200 };
        },
      },
    });
    assert.strictEqual(slowReady.status, 'restarted', 'slow HTTP readiness inside grace window must be restart success');
    assert.deepStrictEqual(slowReadyOrder, ['stop', 'cleanup', 'start', 'probe-1', 'probe-2', 'probe-3']);
    const slowProbeAction = slowReady.actions.find(a => a.step === 'http-probe');
    assert(slowProbeAction && slowProbeAction.ok, 'slow-ready http-probe action must be ok');
    assert.strictEqual(slowProbeAction.detail.attempts, 3, 'slow-ready probe must record retry attempts');

    let failedReadyAttempts = 0;
    const failedReady = await Watchdog.restartConsole(health, {
      stateFile,
      restartLog,
      eventsFile,
      skipThrottle: true,
      notify: false,
      httpReadyGraceMs: 25,
      httpProbeIntervalMs: 1,
      ops: {
        stopConsoleService: async () => ({ ok: true }),
        cleanupRuntimeArtifacts: async () => ({ ok: true }),
        startConsoleService: async () => ({ ok: true }),
        httpProbe: async () => {
          failedReadyAttempts += 1;
          return { ok: false, error: 'timeout 2500ms' };
        },
      },
    });
    assert.strictEqual(failedReady.status, 'failed', 'HTTP never ready within grace window must stay failed');
    const failedProbeAction = failedReady.actions.find(a => a.step === 'http-probe');
    assert(failedProbeAction && !failedProbeAction.ok, 'failed-ready http-probe action must be failed');
    assert(failedProbeAction.detail.attempts >= 2, 'failed-ready probe must retry before failure');
    assert(failedProbeAction.detail.elapsedMs >= 20, 'failed-ready probe must wait for the configured grace window');

    const once = await Watchdog.runOnce({
      artifactsRoot,
      eventsFile,
      stateFile,
      statusFile,
      restartLog,
      checkConsole: false,
      checkHttp: false,
      workerStaleMs: 1000,
      runningStaleMs: 1000,
      noProgressStaleMs: 1000,
      eventStaleMs: 1000,
      lockStaleMs: 1000,
      skipThrottle: true,
      notify: false,
      ops: {
        stopConsoleService: async () => ({ ok: true }),
        cleanupRuntimeArtifacts: async () => ({ ok: true }),
        startConsoleService: async () => ({ ok: true }),
        httpProbe: async () => ({ ok: true }),
      },
    });
    assert.strictEqual(once.ok, true);
    assert(fs.existsSync(statusFile), 'runOnce must write visible watchdog status');

    // ── 拍板③ watchdog 降权(YUTU6_WATCHDOG_TIERED)回归 ──────────────────
    function setupWorkerOnlyRoot(name, workerPid) {
      const aRoot = path.join(root, name);
      fs.mkdirSync(aRoot, { recursive: true });
      Q.enqueue(aRoot, 'ceo', {
        role: 'orchestrator',
        flowId: 'review-loop',
        projectId: '控制台',
        goal: 'tiered watchdog regression',
      }, { id: 'queuedOnly', priority: 10 });
      writeJson(path.join(aRoot, 'queues', 'ceo', '.worker.pid'), {
        pid: workerPid,
        heartbeat_at: isoAge(20 * 60 * 1000),
        started_at: isoAge(30 * 60 * 1000),
      });
      return aRoot;
    }
    function tieredRunOpts(aRoot, extra) {
      return Object.assign({
        artifactsRoot: aRoot,
        eventsFile: path.join(aRoot, 'engine-events.jsonl'),
        stateFile: path.join(aRoot, 'state.json'),
        statusFile: path.join(aRoot, 'status.json'),
        restartLog: path.join(aRoot, 'restarts.jsonl'),
        checkConsole: false,
        workerStaleMs: 1000,
        runningStaleMs: 1000,
        noProgressStaleMs: 1000,
        eventStaleMs: 1000,
        lockStaleMs: 1000,
        persistentAgents: [],
        skipThrottle: true,
        notify: false,
      }, extra || {});
    }

    const tieredEnvKey = 'YUTU6_WATCHDOG_TIERED';
    const prevTieredEnv = process.env[tieredEnvKey];
    try {
      delete process.env[tieredEnvKey];
      assert.strictEqual(Watchdog.tieredRestartEnabled(), true, 'tiered watchdog must default ON');
      process.env[tieredEnvKey] = '0';
      assert.strictEqual(Watchdog.tieredRestartEnabled(), false, 'YUTU6_WATCHDOG_TIERED=0 must restore legacy behavior');
      process.env[tieredEnvKey] = '1';
      assert.strictEqual(Watchdog.tieredRestartEnabled(), true);
      process.env[tieredEnvKey] = '0';
      assert.strictEqual(Watchdog.tieredRestartEnabled({ tieredRestart: true }), true, 'explicit opts must override env');
      delete process.env[tieredEnvKey];

      // 正例: worker-heartbeat-stale 只重拉该 worker,不整机重启。
      const tieredRoot = setupWorkerOnlyRoot('tiered-worker-only', 424242);
      const tieredKills = [];
      const tieredFullSteps = [];
      const tieredOnce = await Watchdog.runOnce(tieredRunOpts(tieredRoot, {
        ops: {
          pidLooksLike: () => true,
          killWorkerPid: pid => { tieredKills.push(pid); return { sent: true }; },
          stopConsoleService: async () => { tieredFullSteps.push('stop'); return { ok: true }; },
          cleanupRuntimeArtifacts: async () => { tieredFullSteps.push('cleanup'); return { ok: true }; },
          startConsoleService: async () => { tieredFullSteps.push('start'); return { ok: true }; },
          httpProbe: async () => { tieredFullSteps.push('probe'); return { ok: true }; },
        },
      }));
      assert.strictEqual(tieredOnce.restart, null, 'worker-heartbeat-stale alone must NOT trigger full console restart');
      assert.deepStrictEqual(tieredFullSteps, [], 'no full-restart step may run for a worker-only problem');
      assert.deepStrictEqual(tieredKills, [424242], 'watchdog must TERM exactly the stale worker pid');
      assert(!fs.existsSync(path.join(tieredRoot, 'queues', 'ceo', '.worker.pid')), 'stale .worker.pid must be removed so server ensureWorkersForBacklog re-pulls the worker');
      assert.strictEqual(tieredOnce.ok, true, 'successful tiered worker restart must be a healthy runOnce outcome');
      assert(Array.isArray(tieredOnce.workerRestarts) && tieredOnce.workerRestarts.length === 1 && tieredOnce.workerRestarts[0].ok === true);
      assert.strictEqual(tieredOnce.health.restartRequired, false);
      assert.strictEqual(tieredOnce.health.workerRestartRequired, true);
      const tieredProblem = tieredOnce.health.problems.find(p => p.type === 'worker-heartbeat-stale');
      assert(tieredProblem && tieredProblem.restart === false && tieredProblem.workerRestart === true);
      const tieredEvents = fs.readFileSync(path.join(tieredRoot, 'engine-events.jsonl'), 'utf8')
        .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      const workerRestartEvent = tieredEvents.find(ev => ev.type === 'watchdog.worker.restart');
      assert(workerRestartEvent, 'tiered worker restart must emit watchdog.worker.restart');
      assert.strictEqual(workerRestartEvent.agent, 'ceo');
      assert.strictEqual(workerRestartEvent.pid, 424242);
      assert(workerRestartEvent.reason && workerRestartEvent.reason.includes('worker-heartbeat-stale'));
      assert(!tieredEvents.some(ev => ev.type === 'watchdog.restart.start'), 'no full-restart event for worker-only problem');

      // 反例: 开关=0 → 旧行为,worker-heartbeat-stale 仍整机重启,不做单 worker 重拉。
      const legacyRoot = setupWorkerOnlyRoot('tiered-off-legacy', 424243);
      const legacyKills = [];
      const legacySteps = [];
      const legacyOnce = await Watchdog.runOnce(tieredRunOpts(legacyRoot, {
        tieredRestart: false,
        ops: {
          pidLooksLike: () => true,
          killWorkerPid: pid => { legacyKills.push(pid); return { sent: true }; },
          stopConsoleService: async () => { legacySteps.push('stop'); return { ok: true }; },
          cleanupRuntimeArtifacts: async () => { legacySteps.push('cleanup'); return { ok: true }; },
          startConsoleService: async () => { legacySteps.push('start'); return { ok: true }; },
          httpProbe: async () => { legacySteps.push('probe'); return { ok: true }; },
        },
      }));
      assert(legacyOnce.restart && legacyOnce.restart.status === 'restarted', 'switch off must restore legacy full restart');
      assert.deepStrictEqual(legacySteps, ['stop', 'cleanup', 'start', 'probe']);
      assert.deepStrictEqual(legacyKills, [], 'legacy mode must not per-worker TERM');
      assert.strictEqual(legacyOnce.workerRestarts, null);
      const legacyProblem = legacyOnce.health.problems.find(p => p.type === 'worker-heartbeat-stale');
      assert(legacyProblem && legacyProblem.restart === true && !legacyProblem.workerRestart);
      assert.strictEqual(legacyOnce.health.workerRestartRequired, false);

      // 反例: 重拉失败(pid 不存在)→ 回退整机重启并记原因。
      const fallbackRoot = setupWorkerOnlyRoot('tiered-fallback', 424244);
      const fallbackSteps = [];
      const fallbackOnce = await Watchdog.runOnce(tieredRunOpts(fallbackRoot, {
        ops: {
          pidLooksLike: () => false,
          killWorkerPid: () => { throw new Error('must not TERM a dead pid'); },
          stopConsoleService: async () => { fallbackSteps.push('stop'); return { ok: true }; },
          cleanupRuntimeArtifacts: async () => { fallbackSteps.push('cleanup'); return { ok: true }; },
          startConsoleService: async () => { fallbackSteps.push('start'); return { ok: true }; },
          httpProbe: async () => { fallbackSteps.push('probe'); return { ok: true }; },
        },
      }));
      assert(fallbackOnce.restart && fallbackOnce.restart.status === 'restarted', 'failed worker restart must fall back to full console restart');
      assert.deepStrictEqual(fallbackSteps, ['stop', 'cleanup', 'start', 'probe']);
      assert(fallbackOnce.workerRestarts && fallbackOnce.workerRestarts.length === 1 && fallbackOnce.workerRestarts[0].ok === false);
      const fallbackProblem = fallbackOnce.health.problems.find(p => p.type === 'worker-heartbeat-stale');
      assert(fallbackProblem && fallbackProblem.restart === true, 'failed worker restart must escalate the problem to full restart');
      assert(/worker-restart-failed/.test(String(fallbackProblem.reason || '')), 'fallback must record the worker-restart failure reason');
      const fallbackEventsText = fs.readFileSync(path.join(fallbackRoot, 'engine-events.jsonl'), 'utf8');
      assert(fallbackEventsText.includes('"type":"watchdog.worker.restart.failed"'), 'failed worker restart must emit watchdog.worker.restart.failed');
      assert(fallbackEventsText.includes('"type":"watchdog.restart.start"'), 'fallback must run the full restart pipeline');
      const fallbackLogText = fs.readFileSync(path.join(fallbackRoot, 'restarts.jsonl'), 'utf8');
      assert(fallbackLogText.includes('worker-restart-failed'), 'restarts.jsonl must record the fallback reason');
    } finally {
      if (prevTieredEnv == null) delete process.env[tieredEnvKey];
      else process.env[tieredEnvKey] = prevTieredEnv;
    }

    const plist = path.join(__dirname, '../projects/控制台/launchd/com.yutu6.watchdog.plist');
    const plistText = fs.readFileSync(plist, 'utf8');
    assert(plistText.includes('<string>com.yutu6.watchdog</string>'));
    assert(plistText.includes('watchdog-daemon.js'));
    assert(plistText.includes('<key>KeepAlive</key>'));
    const lint = spawnSync('plutil', ['-lint', plist], { encoding: 'utf8' });
    assert.strictEqual(lint.status, 0, lint.stderr || lint.stdout);

    console.log(JSON.stringify({ pass: true, suite: 'watchdog-daemon' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
