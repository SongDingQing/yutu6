#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../shared/engine/eventlog');
const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-incident-idempotency-'));
  const artifactsDir = path.join(root, 'artifacts');
  const configPath = path.join(root, 'config.json');
  const agent = 'supervisor-控制台';

  try {
    fs.mkdirSync(path.join(root, 'board', 'repair-tickets'), { recursive: true });
    fs.mkdirSync(path.join(root, 'projects', '控制台'), { recursive: true });
    writeJson(configPath, { runners: {}, roleRouting: {} });

    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_PROJECTS_DIR = path.join(root, 'projects');
    process.env.CONSOLE_CONFIG_PATH = configPath;
    process.env.CONSOLE_BOARD_ROLLUP = path.join(root, 'board', 'status-rollup.md');
    process.env.QUEUE_AGENT = agent;
    process.env.AUTO_REPAIR_ENABLED = '1';
    process.env.AUTO_REPAIR_COOLDOWN_MS = String(30 * 60 * 1000);
    delete process.env.YUTU6_NOTIFY_TIERED;
    process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS = '1000';

    const WorkerTest = require('../projects/控制台/ceo-worker')._test;
    const eventlog = new EventLog(path.join(artifactsDir, 'engine-events.jsonl'));

    Q.enqueue(artifactsDir, agent, {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'terminal task is waiting for queue completion settling',
    }, { id: 'settling-exit', priority: 10 });
    const claimed = Q.claim(artifactsDir, agent);
    assert.strictEqual(claimed.id, 'settling-exit');
    const runningFile = path.join(artifactsDir, 'queues', agent, 'running', 'settling-exit.json');
    const running = readJson(runningFile);
    Object.assign(running, {
      taskId: 'task-settling-exit',
      flowId: 'review-loop',
      role: 'supervisor',
      projectId: '控制台',
      enginePid: 999999,
      engine_started_at: new Date().toISOString(),
      engine_heartbeat_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      progress_at: new Date().toISOString(),
    });
    writeJson(runningFile, running);
    writeJson(path.join(artifactsDir, 'engine-tasks', 'task-settling-exit.json'), {
      id: 'task-settling-exit',
      flow: 'review-loop',
      state: 'failed',
      node: 'done',
      updated: new Date().toISOString(),
      vars: { projectId: '控制台' },
      evidence: [],
      history: [],
    });

    await WorkerTest.sweepStaleRunning();
    const afterSweep = Q.list(artifactsDir, agent);
    assert(afterSweep.running.some(entry => entry.id === 'settling-exit'),
      'fresh-heartbeat engine exit must remain running while the worker settles Q.finish');
    assert(!afterSweep.queued.some(entry => entry.id === 'settling-exit'),
      'fresh-heartbeat terminal task must not be requeued for terminal resume');
    const settlingEvents = eventlog.since(0);
    assert(settlingEvents.some(event => event.type === 'queue.running.keepalive'
      && event.queueId === 'settling-exit'
      && event.settling === true
      && event.taskState === 'failed'),
    'settling guard must emit an auditable keepalive with terminal task state');
    assert(!settlingEvents.some(event => event.type === 'task.resume_terminal'
      && event.task === 'task-settling-exit'),
    'sweep must not resume an already-terminal task');
    assert(!settlingEvents.some(event => event.type === 'queue.completed'
      && event.queueId === 'settling-exit'),
    'settling sweep must not duplicate queue completion');

    const staleSettling = readJson(runningFile);
    const staleAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    Object.assign(staleSettling, {
      engine_heartbeat_at: staleAt,
      heartbeat_at: staleAt,
      progress_at: staleAt,
    });
    writeJson(runningFile, staleSettling);
    await WorkerTest.sweepStaleRunning();
    const afterSettlement = Q.list(artifactsDir, agent);
    assert(!afterSettlement.running.some(entry => entry.id === 'settling-exit'),
      'terminal task must leave running after the settling window expires');
    assert(!afterSettlement.queued.some(entry => entry.id === 'settling-exit'),
      'terminal task must settle directly instead of entering terminal resume');
    assert.strictEqual(afterSettlement.failed, 1,
      'failed taskstore state must reconcile exactly one queue entry to failed');
    assert(fs.existsSync(path.join(artifactsDir, 'queues', agent, 'failed', 'settling-exit.json')),
      'failed taskstore settlement must persist the failed queue entry');
    const reconciledEvents = eventlog.since(0);
    assert(!reconciledEvents.some(event => event.type === 'task.resume_terminal'
      && event.task === 'task-settling-exit'),
    'expired terminal settlement must not launch engine terminal resume');
    assert.strictEqual(reconciledEvents.filter(event => event.type === 'queue.completed'
      && event.queueId === 'settling-exit'
      && event.reconciled === 'taskstore-terminal').length, 1,
    'expired terminal settlement must emit exactly one reconciled completion');

    const spec = {
      taskId: 'task-incident-a',
      queueAgent: agent,
      queueId: 'incident-a',
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'incident-level repair dedupe',
    };
    const entry = { id: 'incident-a', task: { role: 'supervisor', flowId: 'review-loop' } };
    const detailedReason = 'done_gate.logic_chain: implementation.acceptance_table 第1行未完成';
    const first = WorkerTest.openAutoRepairTicket(spec, entry, detailedReason, { code: 3, signal: null });
    assert(first && first.ticket && first.ticket.id, 'first incident failure must open one repair ticket');

    const duplicate = WorkerTest.openAutoRepairTicket(spec, entry, 'failed', { code: 3, signal: null });
    assert.strictEqual(duplicate, null, 'same queue/task incident must dedupe even when reason degrades to failed');
    const dedupeEvent = eventlog.since(0).find(event => event.type === 'repair.ticket.skipped'
      && event.queueId === 'incident-a'
      && event.reason === 'incident-dedupe-cooldown');
    assert(dedupeEvent && dedupeEvent.incidentFingerprint && dedupeEvent.reasonFingerprint,
      'incident dedupe must emit both stable incident and reason-pattern fingerprints');

    const independentSpec = Object.assign({}, spec, { taskId: 'task-incident-b' });
    const independent = WorkerTest.openAutoRepairTicket(independentSpec, entry, detailedReason, { code: 3, signal: null });
    assert(independent && independent.ticket && independent.ticket.id,
      'different taskId must open an independent repair ticket despite the same reason pattern');
    assert.notStrictEqual(independent.ticket.id, first.ticket.id,
      'independent incidents must receive distinct ticket identities');

    const repairState = readJson(path.join(artifactsDir, 'repair-auto', 'index.json'));
    const incidentRows = Object.values(repairState).filter(row => row && row.sourceQueueId === 'incident-a');
    assert.strictEqual(incidentRows.length, 2, 'repair state must persist one row per distinct incident');
    assert(incidentRows.every(row => row.incidentFingerprint && row.reasonFingerprint),
      'new repair state rows must retain both incident identity and reason-pattern fingerprint');

    console.log(JSON.stringify({ pass: true, suite: 'repair-incident-idempotency' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
