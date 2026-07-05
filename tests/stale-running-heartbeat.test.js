#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../shared/engine/eventlog');
const Q = require('../shared/engine/queue');
const Runtime = require('../projects/控制台/engine-runtime');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isoAge(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function seedReviewLoopTask(artifactsDir, taskId, opts = {}) {
  const fixtureEvidenceCommand = 'node -e "process.exit(0)"';
  const implementation = Object.assign({
    done: true,
    summary: 'stale-running downstream implementation',
    changed_files: opts.changedFiles || [],
    logic_chain: {
      summary: 'stale-running downstream fixture did the requested work',
      current_status: 'done',
      actions: ['seeded downstream review-loop fixture'],
      evidence: (opts.changedFiles || []).length
        ? (opts.changedFiles || []).map(file => ({ kind: 'file', path: file, summary: `verified ${file}` }))
        : [{ kind: 'command', command: fixtureEvidenceCommand, exit_code: 0, summary: 'non-delivery fixture command exit 0' }],
      tests: [{ command: fixtureEvidenceCommand, exit_code: 0, summary: 'fixture command exit 0' }],
      conclusion: 'fixture completion is real for this test case',
    },
  }, opts.implementation || {});
  const review = Object.assign({
    pass: true,
    severity: 'low',
    notes: 'stale-running downstream review passed',
    verification: {
      verdict: 'true',
      checked: ['implementation.logic_chain', 'implementation.changed_files', ...(opts.changedFiles || [])],
      evidence: (opts.changedFiles || []).length
        ? (opts.changedFiles || []).map(file => ({ kind: 'file', path: file, summary: `changed_files contains and file exists: ${file}` }))
        : [{ kind: 'test', command: fixtureEvidenceCommand, exit_code: 0, summary: 'non-delivery fixture command exit 0' }],
    },
  }, opts.review || {});
  const evidence = [
    { type: 'result', path: `/tmp/${taskId}/implement-1/result.md` },
    { type: 'result', path: `/tmp/${taskId}/review-1/result.md` },
  ];
  writeJson(path.join(artifactsDir, 'engine-tasks', `${taskId}.json`), {
    id: taskId,
    flow: 'review-loop',
    state: 'done',
    node: 'done',
    vars: {
      goal: opts.goal || 'fresh downstream child',
      acceptance: opts.acceptance || 'test acceptance',
      implementation,
      review,
    },
    evidence,
    visits: { implement: 1, review: 1 },
    steps: {
      'implement#1': { key: 'implement#1', node: 'implement', status: 'done', vars: { implementation }, evidence: evidence[0] },
      'review#1': { key: 'review#1', node: 'review', status: 'done', vars: { review }, evidence: evidence[1] },
    },
    completed_steps: ['implement#1', 'review#1'],
    last_completed_node: 'review',
    history: [],
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-stale-running-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const projectsDir = path.join(root, 'projects');
  const configPath = path.join(root, 'config.json');

  const fakeEngines = [];
  function spawnFakeEngine() {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'engine-runner.js'], {
      stdio: 'ignore',
    });
    fakeEngines.push(child);
    return child;
  }
  function spawnFakeWorker() {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'ceo-worker.js'], {
      stdio: 'ignore',
    });
    fakeEngines.push(child);
    return child;
  }
  async function waitForChildExit(child, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!child || child.exitCode !== null || child.signalCode !== null || !Runtime.pidAlive(child.pid)) return true;
      await sleep(25);
    }
    return child && (child.exitCode !== null || child.signalCode !== null || !Runtime.pidAlive(child.pid));
  }
  try {
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    writeJson(configPath, { runners: {}, roleRouting: {} });

    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_PROJECTS_DIR = projectsDir;
    process.env.CONSOLE_CONFIG_PATH = configPath;
    process.env.CONSOLE_BOARD_ROLLUP = path.join(root, 'board', 'status-rollup.md');
    process.env.AUTO_REPAIR_ENABLED = '0';
    process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS = String(24 * 60 * 60 * 1000);
    process.env.QUEUE_AGENT = 'ceo';
    process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS = '1000';
    process.env.RUNNING_NO_PROGRESS_STALE_MS = '50';
    process.env.ORPHAN_ENGINE_TERM_GRACE_MS = '10';
    process.env.RUNNING_SWEEP_MS = '20';

    const { _test } = require('../projects/控制台/ceo-worker');
    const Server = require('../projects/控制台/server');

    Q.enqueue(artifactsDir, 'quality_ops', {
      role: 'quality_ops',
      flowId: 'agent-once',
      projectId: '控制台',
      goal: 'event wake worker startup fixture',
    }, { id: 'eventWakeQuality', priority: 50 });
    new EventLog(path.join(artifactsDir, 'engine-events.jsonl')).emit('queue.enqueued', {
      queueAgent: 'quality_ops',
      queueId: 'eventWakeQuality',
      priority: 50,
      goal: 'event wake worker startup fixture',
    });
    const workerWake = Server.processQueueWorkerWakeEvents('test', { ensureOpts: { spawn: false } });
    assert.strictEqual(workerWake.processed, 1, 'queue.enqueued event must be consumed by worker event wake');
    assert.deepStrictEqual(workerWake.agents, ['quality_ops'], 'worker event wake must target the enqueued agent');

    assert.strictEqual(
      _test.runningNoProgress({ task: { nodeTimeoutSec: 1 }, progress_at: isoAge(200) }).stale,
      false,
      'task-level nodeTimeoutSec must extend the no-progress watchdog window',
    );
    assert.strictEqual(
      _test.runningNoProgress({ task: { nodeTimeoutSec: 1 }, progress_at: isoAge(1200) }).stale,
      true,
      'no-progress watchdog must still trip after the effective task timeout',
    );
    assert.strictEqual(
      _test.runningNoProgress({
        taskId: 'new-engine-task',
        task: { nodeTimeoutSec: 1 },
        started_at: new Date().toISOString(),
        progress_at: isoAge(5 * 60 * 1000),
        node_event_at: isoAge(5 * 60 * 1000),
        progress_event: 'node.start',
        progress_task: 'old-engine-task',
      }).stale,
      false,
      'stale progress from an older task attempt must not immediately kill a fresh retry',
    );
    assert.strictEqual(
      _test.runningNoProgress({
        queueAgent: 'supervisor-控制台',
        taskId: 'supervisor-default-timeout',
        task: { flowId: 'review-loop' },
        progress_at: isoAge(5 * 60 * 1000),
        progress_task: 'supervisor-default-timeout',
      }).stale,
      false,
      'supervisor review-loop default node timeout must extend the no-progress watchdog window',
    );

    assert.strictEqual(
      _test.workerPidFileRecordOwned({ pid: process.pid, agent: 'ceo' }),
      true,
      'worker pidfile ownership must accept the current worker pid',
    );
    assert.strictEqual(
      _test.workerPidFileRecordOwned({ pid: process.pid + 1, agent: 'ceo' }),
      false,
      'worker pidfile ownership must reject a replacement worker pid',
    );

    const liveOwner = spawnFakeWorker();
    const liveRepairEngine = spawnFakeEngine();
    await sleep(80);
    const liveRepairRunning = {
      id: 'liveRepair',
      target: 'repair',
      role: 'repair',
      enginePid: liveRepairEngine.pid,
      engine_heartbeat_at: new Date().toISOString(),
      progress_at: new Date().toISOString(),
    };
    writeJson(path.join(artifactsDir, 'queues', 'repair', 'running', 'liveRepair.json'), liveRepairRunning);
    const liveRepairLock = {
      agent: 'repair',
      queueId: 'liveRepair',
      runnerType: 'codex-privileged',
      ownerPid: liveOwner.pid,
      enginePid: liveRepairEngine.pid,
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    };
    assert.strictEqual(
      Runtime.lockSweepReason(liveRepairLock, {
        queueRoot: artifactsDir,
        startupKill: true,
        runningStaleMs: 1000,
      }),
      null,
      'startup cleanup must not kill a repair engine whose owner worker is still alive',
    );

    const freshDetachedRepair = Object.assign({}, liveRepairLock, { ownerPid: 999999 });
    assert.strictEqual(
      Runtime.lockSweepReason(freshDetachedRepair, {
        queueRoot: artifactsDir,
        startupKill: true,
        runningStaleMs: 1000,
      }),
      null,
      'startup cleanup must protect a fresh privileged repair running entry even if owner pid is gone',
    );

    const staleRepairRunning = Object.assign({}, liveRepairRunning, {
      engine_heartbeat_at: isoAge(5 * 60 * 1000),
      progress_at: isoAge(5 * 60 * 1000),
    });
    writeJson(path.join(artifactsDir, 'queues', 'repair', 'running', 'liveRepair.json'), staleRepairRunning);
    assert.strictEqual(
      Runtime.lockSweepReason(freshDetachedRepair, {
        queueRoot: artifactsDir,
        startupKill: true,
        runningStaleMs: 1000,
      }),
      'startup-detached-engine',
      'startup cleanup must still classify stale detached repair engines for cleanup',
    );

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'fresh running waiting for engine pid',
    }, { id: 'freshNoEnginePid', priority: 10 });
    const freshNoEnginePid = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(freshNoEnginePid.id, 'freshNoEnginePid');
    const freshNoEnginePidLockFile = path.join(artifactsDir, 'engine-slots', 'slot-fresh-no-engine.json');
    writeJson(freshNoEnginePidLockFile, {
      pid: liveOwner.pid,
      ownerPid: liveOwner.pid,
      agent: 'ceo',
      queueId: 'freshNoEnginePid',
      runnerType: 'codex',
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    });

    await _test.sweepStaleRunning();
    const freshNoEnginePidList = Q.list(artifactsDir, 'ceo');
    assert(
      freshNoEnginePidList.running.some(e => e.id === 'freshNoEnginePid'),
      'freshly claimed running task without enginePid must wait instead of being requeued',
    );
    assert(
      !freshNoEnginePidList.queued.some(e => e.id === 'freshNoEnginePid'),
      'freshly claimed running task without enginePid must not be duplicated into queued',
    );
    assert(fs.existsSync(freshNoEnginePidLockFile), 'worker-owned lock must remain while enginePid is still being attached');
    Q.finish(artifactsDir, 'ceo', 'freshNoEnginePid', 'canceled', { reason: 'test cleanup' });
    fs.rmSync(freshNoEnginePidLockFile, { force: true });

    const heartbeatStaleEngine = spawnFakeEngine();
    await sleep(60);

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'orphan running without engine heartbeat',
    }, { id: 'noHeartbeat', priority: 10 });
    const orphan = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(orphan.id, 'noHeartbeat');
    const orphanFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'noHeartbeat.json');
    const orphanEntry = readJson(orphanFile);
    Object.assign(orphanEntry, {
      enginePid: heartbeatStaleEngine.pid,
      started_at: isoAge(5 * 60 * 1000),
    });
    delete orphanEntry.engine_started_at;
    delete orphanEntry.engine_heartbeat_at;
    writeJson(orphanFile, orphanEntry);

    await _test.sweepStaleRunning();
    const afterOrphanSweep = Q.list(artifactsDir, 'ceo');
    assert(!afterOrphanSweep.running.some(e => e.id === 'noHeartbeat'), 'heartbeat-less stale running task must leave running');
    const requeued = afterOrphanSweep.queued.find(e => e.id === 'noHeartbeat');
    assert(requeued, 'heartbeat-less stale running task must be requeued');
    assert.strictEqual(requeued.retry, 1);
    assert.match(requeued.recovered_reason, /未续约|心跳超时/);
    Q.cancel(artifactsDir, 'ceo', 'noHeartbeat');

    const staleSlotEngine = spawnFakeEngine();
    await sleep(60);
    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'stale heartbeat with engine slot lock',
    }, { id: 'staleSlot', priority: 10 });
    const staleSlot = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(staleSlot.id, 'staleSlot');
    const staleSlotFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'staleSlot.json');
    const staleSlotEntry = readJson(staleSlotFile);
    Object.assign(staleSlotEntry, {
      enginePid: staleSlotEngine.pid,
      engine_started_at: isoAge(5 * 60 * 1000),
      engine_heartbeat_at: isoAge(5 * 60 * 1000),
      progress_at: isoAge(5 * 60 * 1000),
    });
    writeJson(staleSlotFile, staleSlotEntry);
    const engineSlotFile = path.join(artifactsDir, 'engine-slots', 'slot-0.json');
    writeJson(engineSlotFile, {
      pid: process.pid,
      ownerPid: 999999,
      agent: 'ceo',
      queueId: 'staleSlot',
      runnerType: 'codex',
      enginePid: staleSlotEngine.pid,
      started_at: isoAge(5 * 60 * 1000),
      heartbeat_at: isoAge(5 * 60 * 1000),
    });

    await _test.sweepStaleRunning();
    assert(!fs.existsSync(engineSlotFile), 'stale slot lock must be removed after engine termination');
    assert(await waitForChildExit(staleSlotEngine), 'stale slot engine must be terminated before lock release');
    const staleSlotList = Q.list(artifactsDir, 'ceo');
    assert(!staleSlotList.running.some(e => e.id === 'staleSlot'), 'stale slot task must leave running');
    assert(staleSlotList.queued.some(e => e.id === 'staleSlot'), 'stale slot task must be requeued');
    Q.cancel(artifactsDir, 'ceo', 'staleSlot');

    const manualCleanupEngine = spawnFakeEngine();
    await sleep(60);
    const manualSlotFile = path.join(artifactsDir, 'engine-slots', 'slot-1.json');
    writeJson(manualSlotFile, {
      pid: process.pid,
      ownerPid: 999999,
      agent: 'ceo',
      queueId: 'manualCleanup',
      runnerType: 'codex',
      enginePid: manualCleanupEngine.pid,
      started_at: isoAge(5 * 60 * 1000),
      heartbeat_at: isoAge(5 * 60 * 1000),
    });
    const manualRelease = await _test.releaseQueueRuntimeLocks('ceo', 'manualCleanup', 'manual cleanup regression');
    assert.deepStrictEqual(manualRelease.blocked, [], 'manual cleanup must not leave blocked locks after killing engine');
    assert(manualRelease.released.includes('slot-1.json'), 'manual cleanup must release matching slot lock');
    assert(!fs.existsSync(manualSlotFile), 'manual cleanup slot must be removed');
    assert(await waitForChildExit(manualCleanupEngine), 'manual cleanup must terminate bound engine before removing slot');

    const progressStaleEngine = spawnFakeEngine();
    await sleep(60);
    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'fresh heartbeat but no node progress',
    }, { id: 'noProgress', priority: 10 });
    const noProgress = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(noProgress.id, 'noProgress');
    const noProgressFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'noProgress.json');
    const noProgressEntry = readJson(noProgressFile);
    Object.assign(noProgressEntry, {
      enginePid: progressStaleEngine.pid,
      engine_started_at: new Date().toISOString(),
      engine_heartbeat_at: new Date().toISOString(),
      lease_heartbeat_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      progress_at: isoAge(5 * 60 * 1000),
    });
    writeJson(noProgressFile, noProgressEntry);

    await _test.sweepStaleRunning();
    const afterNoProgressSweep = Q.list(artifactsDir, 'ceo');
    assert(!afterNoProgressSweep.running.some(e => e.id === 'noProgress'), 'fresh-heartbeat no-progress task must leave running');
    const progressRequeued = afterNoProgressSweep.queued.find(e => e.id === 'noProgress');
    assert(progressRequeued, 'fresh-heartbeat no-progress task must be requeued');
    assert.strictEqual(progressRequeued.retry, 1);
    assert.match(progressRequeued.recovered_reason, /无节点进展|无进展/);
    Q.cancel(artifactsDir, 'ceo', 'noProgress');

    const freshProgressEngine = spawnFakeEngine();
    await sleep(60);
    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'review-loop',
      projectId: '控制台',
      nodeTimeoutSec: 5,
      goal: 'stale heartbeat but fresh node progress',
    }, { id: 'freshProgress', priority: 10 });
    const freshProgress = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(freshProgress.id, 'freshProgress');
    const freshProgressFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'freshProgress.json');
    const freshProgressEntry = readJson(freshProgressFile);
    Object.assign(freshProgressEntry, {
      enginePid: freshProgressEngine.pid,
      engine_started_at: isoAge(5 * 60 * 1000),
      engine_heartbeat_at: isoAge(5 * 60 * 1000),
      lease_heartbeat_at: isoAge(5 * 60 * 1000),
      heartbeat_at: isoAge(5 * 60 * 1000),
      updated_at: isoAge(5 * 60 * 1000),
      progress_at: new Date().toISOString(),
      node_event_at: new Date().toISOString(),
    });
    writeJson(freshProgressFile, freshProgressEntry);

    await _test.sweepStaleRunning();
    const afterFreshProgressSweep = Q.list(artifactsDir, 'ceo');
    assert(afterFreshProgressSweep.running.some(e => e.id === 'freshProgress'), 'fresh progress must protect an alive engine from heartbeat-only stale recovery');
    assert(!afterFreshProgressSweep.queued.some(e => e.id === 'freshProgress'), 'fresh progress task must not be requeued');
    Q.finish(artifactsDir, 'ceo', 'freshProgress', 'canceled', { reason: 'test cleanup' });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'parent waits for downstream',
    }, { id: 'parentWait', priority: 10 });
    const parent = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(parent.id, 'parentWait');
    const parentFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'parentWait.json');
    const oldParentHeartbeat = isoAge(5 * 60 * 1000);
    const parentEntry = readJson(parentFile);
    Object.assign(parentEntry, {
      taskId: 'task-parent-wait',
      flowId: 'project-route',
      rootQueueAgent: 'ceo',
      rootQueueId: 'parentWait',
      rootTaskId: 'task-parent-wait',
      engine_heartbeat_at: oldParentHeartbeat,
    });
    writeJson(parentFile, parentEntry);

    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'fresh downstream child',
      rootQueueAgent: 'ceo',
      rootQueueId: 'parentWait',
      rootTaskId: 'task-parent-wait',
    }, { id: 'freshChild', priority: 10 });
    const child = Q.claim(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(child.id, 'freshChild');
    const childFile = path.join(artifactsDir, 'queues', 'supervisor-控制台', 'running', 'freshChild.json');
    const childEntry = readJson(childFile);
    Object.assign(childEntry, {
      taskId: 'task-fresh-child',
      engine_started_at: new Date().toISOString(),
      engine_heartbeat_at: new Date().toISOString(),
    });
    writeJson(childFile, childEntry);

    await _test.sweepStaleRunning();
    let ceoList = Q.list(artifactsDir, 'ceo');
    assert(ceoList.running.some(e => e.id === 'parentWait'), 'parent with fresh downstream must remain running');
    assert(!ceoList.queued.some(e => e.id === 'parentWait'), 'parent with fresh downstream must not be requeued');
    let parentState = readJson(parentFile);
    assert.strictEqual(parentState.waiting_downstream, true);
    assert(Date.parse(parentState.engine_heartbeat_at) > Date.parse(oldParentHeartbeat), 'waiting parent heartbeat must be renewed');
    assert.strictEqual(parentState.downstream_inflight_count, 1);

    seedReviewLoopTask(artifactsDir, 'task-fresh-child');
    Q.finish(artifactsDir, 'supervisor-控制台', 'freshChild', 'done', {
      taskId: 'task-fresh-child',
      result: 'ok',
    });

    await _test.sweepStaleRunning();
    ceoList = Q.list(artifactsDir, 'ceo');
    assert(!ceoList.running.some(e => e.id === 'parentWait'), 'parent must leave running after downstream done');
    assert(!ceoList.queued.some(e => e.id === 'parentWait'), 'parent must not requeue after downstream done');
    const doneParentFile = path.join(artifactsDir, 'queues', 'ceo', 'done', 'parentWait.json');
    assert(fs.existsSync(doneParentFile), 'parent must finish done after downstream done');
    parentState = readJson(doneParentFile);
    assert.strictEqual(parentState.status, 'done');
    assert.strictEqual(parentState.downstream.downstreamQueueId, 'freshChild');

    const pausedChildTaskId = 'task-paused-child';
    writeJson(path.join(artifactsDir, 'engine-tasks', `${pausedChildTaskId}.json`), {
      id: pausedChildTaskId,
      flow: 'review-loop',
      state: 'paused',
      node: 'review',
      cursor: 'review',
      timeout_reason: 'wall_timeout',
      timeout_detail: 'wall_no_progress',
      last_completed_node: 'implement',
      vars: { projectId: '控制台' },
      evidence: [{ type: 'result', path: 'implement-2/result.md' }],
      visits: { implement: 2, review: 1 },
      steps: {
        'implement#1': { key: 'implement#1', node: 'implement', status: 'done' },
        'review#1': { key: 'review#1', node: 'review', status: 'done' },
        'implement#2': { key: 'implement#2', node: 'implement', status: 'done' },
      },
      completed_steps: ['implement#1', 'review#1', 'implement#2'],
    });
    const pausedIndex = Server._test.buildTaskBoardIndex([
      { seq: 1, type: 'task.queued', task: pausedChildTaskId, flow: 'review-loop', queueAgent: 'supervisor-控制台', queueId: 'pausedChild' },
      { seq: 2, type: 'project.routed', task: 'task-paused-root', supervisorQueue: 'supervisor-控制台', queueId: 'pausedChild', rootQueueAgent: 'ceo', rootQueueId: 'pausedRoot', rootTaskId: 'task-paused-root' },
      { seq: 3, type: 'node.start', task: pausedChildTaskId, node: 'implement', role: 'worker_code' },
      { seq: 4, type: 'node.end', task: pausedChildTaskId, node: 'implement', role: 'worker_code' },
      { seq: 5, type: 'node.start', task: pausedChildTaskId, node: 'review', role: 'supervisor' },
      { seq: 6, type: 'node.end', task: pausedChildTaskId, node: 'review', role: 'supervisor' },
      { seq: 7, type: 'edge.take', task: pausedChildTaskId, from: 'review', to: 'implement' },
      { seq: 8, type: 'node.start', task: pausedChildTaskId, node: 'implement', role: 'worker_code' },
      { seq: 9, type: 'node.end', task: pausedChildTaskId, node: 'implement', role: 'worker_code' },
      { seq: 10, type: 'edge.take', task: pausedChildTaskId, from: 'implement', to: 'review' },
      { seq: 11, type: 'task.timeout', task: pausedChildTaskId, node: 'review', reason: 'wall_no_progress' },
    ]);
    const pausedNodes = Server._test.buildCeoNodeChain(
      { taskId: 'task-paused-root', queueAgent: 'ceo', queueId: 'pausedRoot' },
      'paused',
      pausedIndex,
      { agent: 'ceo', id: 'pausedRoot', taskId: 'task-paused-root' },
    );
    const pausedReview = pausedNodes.find(n => n.id === 'review');
    assert(pausedReview, 'paused review node must exist');
    assert.strictEqual(pausedReview.status, 'paused');
    assert.match(pausedReview.statusText, /超时/);
    const restoredProgress = Server._test.taskBoardProgressForEvent({
      type: 'project.route.waiting.restored',
      task: 'task-paused-root',
      queueAgent: 'supervisor-控制台',
      queueId: 'pausedChild',
    });
    assert(restoredProgress, 'restored project-route progress must render');
    assert.strictEqual(restoredProgress.state, 'run');
    assert.match(restoredProgress.text, /已恢复等待下游/);

    const staleWorker = spawnFakeWorker();
    await sleep(60);
    const staleWorkerPidFile = path.join(artifactsDir, 'queues', 'repair', '.worker.pid');
    writeJson(staleWorkerPidFile, {
      pid: staleWorker.pid,
      agent: 'repair',
      started_at: isoAge(10 * 60 * 1000),
      heartbeat_at: isoAge(10 * 60 * 1000),
    });
    const staleWorkerState = Server._test.workerPidFileState(staleWorkerPidFile, 'repair');
    assert.strictEqual(staleWorkerState.alive, true);
    assert.strictEqual(staleWorkerState.stale, true, 'worker watchdog must treat alive pid with stale heartbeat as unhealthy');
    const restartPlan = Server.ensureQueueWorker('repair', { spawn: false });
    assert.strictEqual(restartPlan.action, 'spawn-needed', 'worker watchdog must request a replacement worker after stale cleanup');
    assert(!fs.existsSync(staleWorkerPidFile), 'stale worker pid file must be cleared before replacement');
    assert(await waitForChildExit(staleWorker), 'stale worker process must be terminated by watchdog cleanup');

    const restartDryRun = spawnSync(process.execPath, [
      path.join(__dirname, '../projects/控制台/tools/console-restart-detached.js'),
      '--dry-run',
      '--delay-ms',
      '1000',
      '--stop-timeout-ms',
      '5000',
      '--cleanup-timeout-ms',
      '5000',
      '--start-timeout-ms',
      '5000',
      '--reason',
      'stale-running-heartbeat test',
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env, { CONSOLE_ARTIFACTS_DIR: artifactsDir }),
      encoding: 'utf8',
    });
    assert.strictEqual(restartDryRun.status, 0, restartDryRun.stderr || restartDryRun.stdout);
    const restartPlanJson = JSON.parse(restartDryRun.stdout);
    const restartScript = fs.readFileSync(path.join(path.resolve(__dirname, '..'), restartPlanJson.scriptPath), 'utf8');
    assert.match(restartScript, /launchctl kill TERM/, 'detached restart script must stop old console before cleanup');
    assert.match(restartScript, /selfCleanRuntimeArtifacts/, 'detached restart script must clean runtime leftovers before restart');
    assert.match(restartScript, /STOP_TIMEOUT_SEC/, 'detached restart script must include timeout protection');
    assert.match(restartScript, /kickstart -k/, 'detached restart script must start console after cleanup');

    console.log(JSON.stringify({ pass: true, suite: 'stale-running-heartbeat' }));
  } finally {
    for (const fakeEngine of fakeEngines) {
      if (fakeEngine && fakeEngine.pid) {
        try { process.kill(fakeEngine.pid, 'SIGKILL'); } catch (_) {}
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err && err.stack || err);
    process.exit(1);
  });
