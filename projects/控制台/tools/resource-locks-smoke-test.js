#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ResourceLocks = require('../resource-locks');
const Worker = require('../ceo-worker');
const MemoryMaintenance = require('./repair-memory-maintenance');
const LongRunMaintenance = require('./long-run-maintenance');
const Q = require('../../../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function isoAge(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function fakeEventlog() {
  const events = [];
  return {
    events,
    emit(type, data) {
      events.push(Object.assign({ type }, data || {}));
    },
  };
}

async function expectTimeout(promise, label) {
  let timedOut = false;
  try {
    await promise;
  } catch (e) {
    timedOut = /timeout/i.test(String(e && e.message || e));
  }
  assert.strictEqual(timedOut, true, label);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resource-locks-'));
  const locksRoot = path.join(root, 'resource-locks');
  const artifactsRoot = path.join(root, 'artifacts');
  const eventsFile = path.join(artifactsRoot, 'engine-events.jsonl');
  const eventlog = fakeEventlog();

  try {
    fs.mkdirSync(artifactsRoot, { recursive: true });
    fs.writeFileSync(eventsFile, '');

    const plan = ResourceLocks.planRunnableTasks([
      { id: 'frontA', task: { role: 'worker_code', resourceDomains: { write: ['frontend-public'] } } },
      { id: 'engineA', task: { role: 'worker_code', resourceDomains: { write: ['engine'] } } },
      { id: 'frontB', task: { role: 'worker_code', resourceDomains: { read: ['frontend-public'] } } },
      { id: 'repair', task: { role: 'repair', resourceDomains: { write: ['frontend-public'] } } },
    ]);
	    assert.deepStrictEqual(plan.runnable.map(x => x.id), ['frontA', 'engineA', 'repair']);
	    assert.deepStrictEqual(plan.blocked.map(x => x.id), ['frontB']);

	    const supervisorInferred = ResourceLocks.normalizeResourceRequest({
	      role: 'supervisor',
	      flowId: 'review-loop',
	      goal: '修改 workspace.html 的办公室布局',
	      inputs: ['projects/控制台/brief.md'],
	    });
	    assert(supervisorInferred.write.includes('frontend-public'));
	    assert(!supervisorInferred.write.includes('brief-status'), 'brief input must not serialize all supervisor tasks as status writes');
	    assert(supervisorInferred.read.includes('brief-status'), 'brief input remains a read dependency');

	    const front = await ResourceLocks.acquireResourceLease({
      queueAgent: 'worker_code',
      queueId: 'frontA',
      taskId: 'taskA',
      role: 'worker_code',
      resourceDomains: { write: ['frontend-public'] },
    }, {
      locksRoot,
      eventlog,
      timeoutMs: 500,
      leaseMs: 5000,
      heartbeatMs: 1000,
    });

    const engine = await ResourceLocks.acquireResourceLease({
      queueAgent: 'worker_code',
      queueId: 'engineA',
      taskId: 'taskB',
      role: 'worker_code',
      resourceDomains: { write: ['engine'] },
    }, {
      locksRoot,
      eventlog,
      timeoutMs: 500,
      leaseMs: 5000,
      heartbeatMs: 1000,
    });
    assert(front.token && engine.token && front.token !== engine.token);

    const frontProbe = await ResourceLocks.currentResourceConflicts({
      queueAgent: 'frontend_designer',
      queueId: 'frontProbe',
      role: 'frontend_designer',
      resourceDomains: { read: ['frontend-public'] },
    }, {
      locksRoot,
      eventlog,
      leaseMs: 5000,
    });
    assert.strictEqual(frontProbe.available, false);
    assert(frontProbe.conflicts.some(x => x.domain === 'frontend-public' && x.mode === 'write'));

    const configProbe = await ResourceLocks.currentResourceConflicts({
      queueAgent: 'worker_code',
      queueId: 'configProbe',
      role: 'worker_code',
      resourceDomains: { write: ['config'] },
    }, {
      locksRoot,
      eventlog,
      leaseMs: 5000,
    });
    assert.strictEqual(configProbe.available, true);

    const schedAgent = 'frontend_designer';
    Q.enqueue(artifactsRoot, schedAgent, {
      role: 'frontend_designer',
      resourceDomains: { write: ['frontend-public'] },
    }, { id: 'sched-blocked', priority: 1 });
    Q.enqueue(artifactsRoot, schedAgent, {
      role: 'frontend_designer',
      resourceDomains: { write: ['config'] },
    }, { id: 'sched-runnable', priority: 2 });
    const runnableIds = new Set();
    for (const item of Q.list(artifactsRoot, schedAgent).queued) {
      const probe = await ResourceLocks.currentResourceConflicts(Object.assign({
        queueAgent: schedAgent,
        queueId: item.id,
      }, item.task || {}), {
        locksRoot,
        eventlog,
        leaseMs: 5000,
      });
      if (probe.available) runnableIds.add(item.id);
    }
    const scheduled = Q.claim(artifactsRoot, schedAgent, { match: item => runnableIds.has(item.id) });
    assert.strictEqual(scheduled.id, 'sched-runnable');
    assert.deepStrictEqual(Q.list(artifactsRoot, schedAgent).queued.map(item => item.id), ['sched-blocked']);
    Q.complete(artifactsRoot, schedAgent, 'sched-runnable', true);
    Q.cancel(artifactsRoot, schedAgent, 'sched-blocked');

    await expectTimeout(ResourceLocks.acquireResourceLease({
      queueAgent: 'frontend_designer',
      queueId: 'frontB',
      taskId: 'taskC',
      role: 'frontend_designer',
      resourceDomains: { read: ['frontend-public'] },
    }, {
      locksRoot,
      eventlog,
      timeoutMs: 80,
      pollMs: 20,
      leaseMs: 5000,
      heartbeatMs: 1000,
    }), 'read must wait while another task holds write lock');

    const privileged = await ResourceLocks.acquireResourceLease({
      queueAgent: 'repair',
      queueId: 'repairA',
      taskId: 'taskRepair',
      role: 'repair',
      resourceDomains: { write: ['frontend-public', 'engine'] },
    }, {
      locksRoot,
      eventlog,
      timeoutMs: 100,
      leaseMs: 5000,
    });
    assert.strictEqual(privileged.bypassed, true);
    privileged.release();

    await front.release();
    const reader = await ResourceLocks.acquireResourceLease({
      queueAgent: 'quality_ops',
      queueId: 'readA',
      taskId: 'taskRead',
      role: 'quality_ops',
      resourceDomains: { read: ['frontend-public'] },
    }, {
      locksRoot,
      eventlog,
      timeoutMs: 500,
      leaseMs: 5000,
    });
    await reader.release();
    await engine.release();

    writeJson(path.join(locksRoot, 'domains', 'config.json'), {
      domain: 'config',
      readers: [],
      writer: {
        token: 'dead-writer',
        ownerPid: 999999,
        queueAgent: 'worker_code',
        queueId: 'dead',
        heartbeat_at: isoAge(10 * 60 * 1000),
        leaseMs: 1000,
      },
    });
    const swept = await ResourceLocks.sweepStaleResourceLocks(locksRoot, { eventlog, leaseMs: 1000 });
    assert(swept.some(x => x.token === 'dead-writer' && x.domain === 'config'));

    const cycle = ResourceLocks.detectCircularWait([
      { token: 'a', waitsFor: [{ token: 'b' }] },
      { token: 'b', waitsFor: [{ token: 'a' }] },
    ]);
    assert.deepStrictEqual(cycle, ['a', 'b', 'a']);

    const stalePreEngineStarted = Worker._test.runningEngineHeartbeat({
      started_at: isoAge(10 * 60 * 1000),
      pre_engine_wait_heartbeat_at: new Date().toISOString(),
    });
    assert.strictEqual(stalePreEngineStarted.source, 'pre_engine_wait_heartbeat_at');
    assert.strictEqual(stalePreEngineStarted.stale, false);

    const engineHeartbeatPreferred = Worker._test.runningEngineHeartbeat({
      enginePid: process.pid,
      engine_heartbeat_at: isoAge(10 * 60 * 1000),
      pre_engine_wait_heartbeat_at: new Date().toISOString(),
    });
    assert.strictEqual(engineHeartbeatPreferred.source, 'engine_heartbeat_at');
    assert.strictEqual(engineHeartbeatPreferred.stale, true);

    const pressure = MemoryMaintenance.shouldPurge({
      memory: { ok: true, level: 'critical', availableRatio: 0.03 },
      active: [],
      state: {},
      apply: false,
    });
    assert.strictEqual(pressure.ok, false);
    assert.strictEqual(pressure.reason, 'dry-run');

    const longRun = await LongRunMaintenance.runOnce({
      artifactsRoot,
      eventsFile,
      checkConsole: false,
      checkHttp: false,
      persistentAgents: [],
      applyMemory: false,
      eventlog,
    });
    assert.strictEqual(!!longRun.at, true);
    assert.strictEqual(longRun.watchdog.restartRequired, false);

    assert(eventlog.events.some(e => e.type === 'resource.lock.acquired'));
    assert(eventlog.events.some(e => e.type === 'resource.lock.bypassed'));
    assert(eventlog.events.some(e => e.type === 'maintenance.long_run.checked'));

    console.log(JSON.stringify({
      pass: true,
      suite: 'resource-locks-smoke',
      events: eventlog.events.length,
      locksRoot,
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
