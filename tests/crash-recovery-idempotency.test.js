#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');
const EventLog = require('../shared/engine/eventlog');
const { TaskStore } = require('../shared/engine/taskstore');
const { runFlow } = require('../shared/engine/engine');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function staleIso() {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

function idempotentFlow() {
  return {
    id: 'idempotent-recovery-smoke',
    guards: { validate_before_run: true, wall_timeout_sec: 30 },
    nodes: [
      { id: 'effect', agent_role: 'worker_code' },
      { id: 'review', agent_role: 'supervisor' },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { from: 'effect', to: 'review' },
      { from: 'review', to: 'done', when: '{{ review.pass == true }}' },
    ],
    acceptance: { require_evidence: true },
  };
}

function makeRunner(counterFile) {
  return node => {
    if (node.id === 'effect') {
      const current = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) || 0 : 0;
      fs.writeFileSync(counterFile, String(current + 1));
      return {
        vars: { implementation: { done: true, summary: 'effect done', changed_files: [] } },
        evidence: { type: 'external_side_effect', path: counterFile },
      };
    }
    if (node.id === 'review') {
      return { vars: { review: { pass: true, severity: 'low' } } };
    }
    return {};
  };
}

function seedCompletedEffect(store, taskId, flow, opts = {}) {
  const t = store.create(taskId, flow.id, { projectId: '控制台' });
  const evidence = { type: 'external_side_effect', path: opts.counterFile || 'counter' };
  store.update(t, {
    state: 'running',
    node: opts.cursor || 'effect',
    cursor: opts.cursor || 'effect',
    visits: { effect: 1 },
    vars: { projectId: '控制台', implementation: { done: true, summary: 'effect done', changed_files: [] } },
    evidence: [evidence],
    steps: {
      'effect#1': {
        key: 'effect#1',
        node: 'effect',
        status: 'done',
        attempt: 1,
        vars: { implementation: { done: true, summary: 'effect done', changed_files: [] } },
        evidence,
        completed_at: new Date().toISOString(),
      },
    },
    completed_steps: ['effect#1'],
    completed_pending_edge: opts.pendingEdge ? 'effect#1' : null,
    last_completed_node: 'effect',
  });
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-crash-recovery-'));
  const agent = 'supervisor-控制台';
  const flow = idempotentFlow();
  const counterFile = path.join(root, 'side-effect-count.txt');

  try {
    const queueRoot = path.join(root, 'artifacts');
    const eventlog = new EventLog(path.join(root, 'events.jsonl'));
    const store = new TaskStore(path.join(root, 'tasks'));
    const runner = makeRunner(counterFile);

    Q.enqueue(queueRoot, agent, { goal: 'claim then crash before finish', projectId: '控制台' }, { id: 'recoverMe', priority: 10 });
    const claimed = Q.claim(queueRoot, agent, { owner: 'worker:test', ownerPid: 12345, leaseMs: 20 });
    assert.strictEqual(claimed.id, 'recoverMe');
    assert.strictEqual(claimed.lease_owner, 'worker:test');
    assert(claimed.lease_heartbeat_at, 'claim must write lease heartbeat');

    const first = runFlow({
      flow,
      runner,
      eventlog,
      taskstore: store,
      taskId: 'task-recoverMe',
      vars: { projectId: '控制台', queueAgent: agent, queueId: 'recoverMe' },
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(fs.readFileSync(counterFile, 'utf8'), '1');

    const runningFile = path.join(Q.qdir(queueRoot, agent), 'running', 'recoverMe.json');
    const running = readJson(runningFile);
    const oldHeartbeat = staleIso();
    Object.assign(running, {
      taskId: 'task-recoverMe',
      lease_ms: 20,
      lease_heartbeat_at: oldHeartbeat,
      heartbeat_at: oldHeartbeat,
      engine_heartbeat_at: oldHeartbeat,
      updated_at: oldHeartbeat,
      started_at: oldHeartbeat,
      lease_claimed_at: oldHeartbeat,
    });
    writeJson(runningFile, running);

    const recovered = Q.recoverStaleRunning(queueRoot, agent, { leaseMs: 20, maxRetry: 2, reason: 'test stale lease' });
    assert.strictEqual(recovered.length, 1);
    assert.strictEqual(recovered[0].status, 'queued');
    assert.strictEqual(recovered[0].retry, 1);

    const reclaimed = Q.claim(queueRoot, agent, { owner: 'worker:restart', ownerPid: 22345, leaseMs: 20 });
    assert.strictEqual(reclaimed.id, 'recoverMe');
    assert.strictEqual(reclaimed.taskId, 'task-recoverMe');
    assert.strictEqual(reclaimed.retry, 1);

    const second = runFlow({
      flow,
      runner,
      eventlog,
      taskstore: store,
      taskId: reclaimed.taskId,
      vars: { projectId: '控制台', queueAgent: agent, queueId: 'recoverMe' },
    });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(fs.readFileSync(counterFile, 'utf8'), '1', 'terminal task resume must not repeat side effect');
    Q.finish(queueRoot, agent, 'recoverMe', 'done', { taskId: reclaimed.taskId });

    seedCompletedEffect(store, 'task-pending-edge', flow, { pendingEdge: true, counterFile });
    const third = runFlow({
      flow,
      runner,
      eventlog,
      taskstore: store,
      taskId: 'task-pending-edge',
      vars: { projectId: '控制台' },
    });
    assert.strictEqual(third.ok, true);
    assert.strictEqual(fs.readFileSync(counterFile, 'utf8'), '1', 'pending-edge replay must not repeat side effect');

    seedCompletedEffect(store, 'task-cursor-review', flow, { cursor: 'review', counterFile });
    const fourth = runFlow({
      flow,
      runner,
      eventlog,
      taskstore: store,
      taskId: 'task-cursor-review',
      vars: { projectId: '控制台' },
    });
    assert.strictEqual(fourth.ok, true);
    assert.strictEqual(fs.readFileSync(counterFile, 'utf8'), '1', 'cursor resume must start after last completed node');

    const events = eventlog.since(0);
    assert(events.some(e => e.type === 'task.resume_terminal' && e.task === 'task-recoverMe'));
    assert(events.some(e => e.type === 'node.replay' && e.task === 'task-pending-edge' && e.node === 'effect'));

    const progressAwareFlow = {
      id: 'progress-aware-wall-timeout',
      guards: {
        validate_before_run: true,
        wall_timeout_sec: 1,
        wall_timeout_progress_grace_sec: 10,
      },
      nodes: [
        { id: 'effect', agent_role: 'worker_code' },
        { id: 'review', agent_role: 'supervisor' },
        { id: 'done', type: 'end' },
      ],
      edges: [
        { from: 'effect', to: 'review' },
        { from: 'review', to: 'done', when: '{{ review.pass == true }}' },
      ],
      acceptance: { require_evidence: true },
    };
    let fakeNow = 0;
    const progressAware = runFlow({
      flow: progressAwareFlow,
      runner: node => {
        fakeNow += 2000;
        if (node.id === 'effect') {
          return {
            vars: { implementation: { done: true, summary: 'slow but active', changed_files: [] } },
            evidence: { type: 'result', path: 'slow-active' },
          };
        }
        if (node.id === 'review') return { vars: { review: { pass: true, severity: 'low' } } };
        return {};
      },
      eventlog,
      taskstore: store,
      taskId: 'task-progress-aware-wall-timeout',
      vars: { projectId: '控制台' },
      now: () => fakeNow,
    });
    assert.strictEqual(progressAware.ok, true, 'recent node progress must defer wall_timeout');
    assert(eventlog.since(0).some(e => e.type === 'task.timeout.deferred' && e.task === 'task-progress-aware-wall-timeout'));

    const staleWallStore = new TaskStore(path.join(root, 'stale-wall-tasks'));
    let staleNow = 0;
    const staleWall = runFlow({
      flow: Object.assign({}, progressAwareFlow, {
        id: 'stale-wall-timeout',
        guards: {
          validate_before_run: true,
          wall_timeout_sec: 1,
          wall_timeout_progress_grace_sec: 0,
        },
      }),
      runner,
      eventlog,
      taskstore: staleWallStore,
      taskId: 'task-stale-wall-timeout',
      vars: { projectId: '控制台' },
      now: () => {
        staleNow += 1100;
        return staleNow;
      },
    });
    assert.strictEqual(staleWall.ok, false, 'stale wall timeout must still pause');
    assert.strictEqual(staleWall.reason, 'wall_timeout');
    assert.strictEqual(staleWall.task.state, 'paused');
    assert.strictEqual(staleWall.task.timeout_reason, 'wall_timeout');

    const atomicStore = new TaskStore(path.join(root, 'atomic-tasks'));
    const atomicTask = atomicStore.create('task-atomic-write', flow.id, { marker: 'before' });
    const atomicFile = path.join(root, 'atomic-tasks', 'task-atomic-write.json');
    const beforeAtomicRaw = fs.readFileSync(atomicFile, 'utf8');
    const realRenameSync = fs.renameSync;
    fs.renameSync = function patchedRenameSync(src, dst) {
      if (dst === atomicFile && path.basename(src).startsWith('.task-atomic-write.json.')) {
        throw new Error('simulated taskstore rename crash');
      }
      return realRenameSync.apply(fs, arguments);
    };
    try {
      assert.throws(() => {
        atomicStore.update(atomicTask, { state: 'running', vars: { marker: 'after' } });
      }, /simulated taskstore rename crash/);
    } finally {
      fs.renameSync = realRenameSync;
    }
    assert.strictEqual(fs.readFileSync(atomicFile, 'utf8'), beforeAtomicRaw,
      'failed atomic write must leave previous task JSON intact');
    assert.strictEqual(atomicStore.get('task-atomic-write').vars.marker, 'before',
      'taskstore recovery read must still parse the previous complete JSON');
    assert.strictEqual(fs.readdirSync(path.dirname(atomicFile)).some(file => file.endsWith('.tmp')), false,
      'failed atomic write must clean temp files');

    console.log(JSON.stringify({ pass: true, suite: 'crash-recovery-idempotency' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
