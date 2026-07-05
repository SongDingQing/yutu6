#!/usr/bin/env node
'use strict';

// e2e-canary 状态机回归:mock 队列目录,不碰真实队列/控制台 API。
// 覆盖:done+产物→绿 / failed→红+开单 / 超时→红+开单 / done 无产物→红 / 同日幂等 / --dry-run 无副作用。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');
const Canary = require('../projects/控制台/tools/e2e-canary');

const AGENT = 'worker_code';

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-canary-test-'));
}

function makeHarness() {
  const events = [];
  const tickets = [];
  return {
    events,
    tickets,
    emit: (type, data) => events.push({ type, data }),
    openTicket: req => { tickets.push(req); return { ok: true, ticketId: `canary-red-${req.date}`, existed: false }; },
  };
}

function writeArtifact(root, date) {
  fs.mkdirSync(path.join(root, 'canary'), { recursive: true });
  fs.writeFileSync(Canary.artifactFile(root, date), date + '\n');
}

async function testGreen() {
  const root = freshRoot();
  const h = makeHarness();
  const date = '2026-07-03';
  try {
    const enqueue = ({ agent, task, priority, idem }) => {
      assert.strictEqual(agent, AGENT);
      assert.strictEqual(task.role, 'worker_code');
      assert.strictEqual(task.flowId, 'agent-once');
      assert.strictEqual(idem, `e2e-canary:${date}`);
      assert(priority >= 50, '金丝雀必须低优先级');
      assert.match(task.goal, /canary-2026-07-03\.txt/);
      const entry = Q.enqueue(root, agent, task, { id: 'cn1', priority, idem });
      // 模拟 worker:认领 → 写产物 → done
      Q.claim(root, agent);
      writeArtifact(root, date);
      Q.complete(root, agent, 'cn1', true);
      return { id: entry.id };
    };
    const out = await Canary.runCanary({ root, date, pollMs: 5, timeoutMs: 3000, enqueue, emit: h.emit, openTicket: h.openTicket });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.status, 'green');
    assert.strictEqual(out.queueId, 'cn1');
    assert.strictEqual(h.tickets.length, 0, '绿灯不开工单');
    assert(h.events.some(e => e.type === 'canary.passed'));
    assert(!h.events.some(e => e.type === 'canary.failed'));
    // 状态落盘
    const state = Canary.loadState(Canary.stateFilePath(root));
    assert.strictEqual(state.results.length, 1);
    assert.strictEqual(state.results[0].status, 'green');
    assert.strictEqual(state.results[0].date, date);
    assert.strictEqual(state.last.queueId, 'cn1');

    // 同日幂等:已绿则跳过,enqueue 不得再被调用
    const out2 = await Canary.runCanary({
      root, date, pollMs: 5, timeoutMs: 3000,
      enqueue: () => { throw new Error('同日已绿不应再入队'); },
      emit: h.emit, openTicket: h.openTicket,
    });
    assert.strictEqual(out2.skipped, true);
    assert.strictEqual(out2.reason, 'already-green-today');

    // --force 覆盖幂等:必须重新入队
    let forced = 0;
    const out3 = await Canary.runCanary({
      root, date, pollMs: 5, timeoutMs: 3000, force: true,
      enqueue: ({ agent, task, priority, idem }) => {
        forced++;
        const entry = Q.enqueue(root, agent, task, { id: 'cn1b', priority, idem });
        Q.claim(root, agent);
        Q.complete(root, agent, 'cn1b', true);
        return { id: entry.id };
      },
      emit: h.emit, openTicket: h.openTicket,
    });
    assert.strictEqual(forced, 1);
    assert.strictEqual(out3.status, 'green');
    assert.strictEqual(Canary.loadState(Canary.stateFilePath(root)).results.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testFailedOpensTicket() {
  const root = freshRoot();
  const h = makeHarness();
  const date = '2026-07-04';
  try {
    const enqueue = ({ agent, task, priority, idem }) => {
      const entry = Q.enqueue(root, agent, task, { id: 'cn2', priority, idem });
      Q.claim(root, agent);
      Q.complete(root, agent, 'cn2', false, { error: 'boom' });
      return { id: entry.id };
    };
    const out = await Canary.runCanary({ root, date, pollMs: 5, timeoutMs: 3000, enqueue, emit: h.emit, openTicket: h.openTicket });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.status, 'red');
    assert.strictEqual(out.reason, 'queue-failed');
    assert.strictEqual(h.tickets.length, 1, '红灯必须开工单');
    assert.strictEqual(h.tickets[0].date, date);
    assert.strictEqual(h.tickets[0].queueId, 'cn2');
    const failedEvents = h.events.filter(e => e.type === 'canary.failed');
    assert.strictEqual(failedEvents.length, 1, '红灯必须 emit canary.failed');
    assert.strictEqual(failedEvents[0].data.reason, 'queue-failed');
    const state = Canary.loadState(Canary.stateFilePath(root));
    assert.strictEqual(state.results[0].status, 'red');
    assert.strictEqual(state.results[0].ticket.ticketId, `canary-red-${date}`);

    // 同日红灯不触发幂等跳过:第二次仍会跑
    let again = 0;
    await Canary.runCanary({
      root, date, pollMs: 5, timeoutMs: 3000,
      enqueue: ({ agent, task, priority, idem }) => {
        again++;
        const entry = Q.enqueue(root, agent, task, { id: 'cn2b', priority, idem });
        Q.claim(root, agent);
        Q.complete(root, agent, 'cn2b', false);
        return { id: entry.id };
      },
      emit: h.emit, openTicket: h.openTicket,
    });
    assert.strictEqual(again, 1, '同日只有红灯时不应跳过');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testTimeoutOpensTicket() {
  const root = freshRoot();
  const h = makeHarness();
  const date = '2026-07-05';
  try {
    const enqueue = ({ agent, task, priority, idem }) => {
      // 入队后没有任何 worker 来处理 → 超时
      const entry = Q.enqueue(root, agent, task, { id: 'cn3', priority, idem });
      return { id: entry.id };
    };
    const out = await Canary.runCanary({ root, date, pollMs: 5, timeoutMs: 40, enqueue, emit: h.emit, openTicket: h.openTicket });
    assert.strictEqual(out.status, 'red');
    assert.match(out.reason, /^timeout/);
    assert.strictEqual(h.tickets.length, 1, '超时必须开工单');
    assert(h.events.some(e => e.type === 'canary.failed'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testDoneWithoutArtifactIsRed() {
  const root = freshRoot();
  const h = makeHarness();
  const date = '2026-07-06';
  try {
    const enqueue = ({ agent, task, priority, idem }) => {
      const entry = Q.enqueue(root, agent, task, { id: 'cn4', priority, idem });
      Q.claim(root, agent);
      Q.complete(root, agent, 'cn4', true); // done 但没写产物
      return { id: entry.id };
    };
    const out = await Canary.runCanary({ root, date, pollMs: 5, timeoutMs: 3000, enqueue, emit: h.emit, openTicket: h.openTicket });
    assert.strictEqual(out.status, 'red');
    assert.strictEqual(out.reason, 'artifact-missing');
    assert.strictEqual(h.tickets.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testDryRunNoSideEffects() {
  const root = freshRoot();
  const h = makeHarness();
  const date = '2026-07-07';
  try {
    const out = await Canary.runCanary({
      root, date, dryRun: true,
      enqueue: () => { throw new Error('dry-run 不应入队'); },
      emit: h.emit, openTicket: h.openTicket,
    });
    assert.strictEqual(out.dryRun, true);
    assert.strictEqual(out.enqueue.task.role, 'worker_code');
    assert.strictEqual(out.enqueue.task.flowId, 'agent-once');
    assert.match(out.enqueue.task.goal, /金丝雀巡检/);
    assert(!fs.existsSync(Canary.stateFilePath(root)), 'dry-run 不写状态');
    assert.strictEqual(h.events.length, 0);
    assert.strictEqual(h.tickets.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testStateKeepsLastSeven() {
  const root = freshRoot();
  const stateFile = Canary.stateFilePath(root);
  try {
    for (let i = 1; i <= 9; i++) {
      Canary.recordResult(stateFile, { date: `2026-06-${String(i).padStart(2, '0')}`, status: 'green' });
    }
    const state = Canary.loadState(stateFile);
    assert.strictEqual(state.results.length, Canary.KEEP_RESULTS, '状态只保留最近 7 次');
    assert.strictEqual(state.results[0].date, '2026-06-03');
    assert.strictEqual(state.results[6].date, '2026-06-09');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await testGreen();
  await testFailedOpensTicket();
  await testTimeoutOpensTicket();
  await testDoneWithoutArtifactIsRed();
  await testDryRunNoSideEffects();
  await testStateKeepsLastSeven();
  console.log(JSON.stringify({ pass: true, suite: 'e2e-canary' }));
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
