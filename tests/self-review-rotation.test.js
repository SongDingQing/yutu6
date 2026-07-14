#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-review-rotation-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const DAY = 24 * 60 * 60 * 1000;
  const SUNDAY = Date.parse('2026-07-05T05:00:00+08:00'); // 北京周日,ISO 周 2026-W27

  try {
    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_EVENTS_FILE = path.join(artifactsDir, 'engine-events.jsonl');

    const Rotation = require('../projects/控制台/tools/self-review-rotation');
    const Q = require('../shared/engine/queue');

    const stateFile = path.join(artifactsDir, 'self-reflection-optimizer', 'rotation-state.json');
    const base = { queueRoot: artifactsDir, stateFile, viaSecretary: false, eventsFile: process.env.CONSOLE_EVENTS_FILE };

    assert.strictEqual(Rotation.isoWeekKey(SUNDAY), '2026-W27');
    assert.strictEqual(Rotation.ROTATION_MODULES.length, 8);
    assert.strictEqual(Rotation.ROTATION_MODULES[0], 'shared/engine/queue.js');

    // ---- dry-run:不写状态、不入队 ----
    const dry = await Rotation.run(Object.assign({}, base, { now: SUNDAY, dryRun: true }));
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(dry.action, 'would-enqueue');
    assert.strictEqual(dry.module, 'shared/engine/queue.js');
    assert(!fs.existsSync(stateFile), 'dry-run must not write state');
    assert(!fs.existsSync(path.join(artifactsDir, 'queues', 'repair-lead')), 'dry-run must not enqueue');

    // ---- 第 1 轮:入队第 1 个模块,repair-lead / agent-once / priority 90 ----
    const r1 = await Rotation.run(Object.assign({}, base, { now: SUNDAY }));
    assert.strictEqual(r1.skipped, false);
    assert.strictEqual(r1.week, '2026-W27');
    assert.strictEqual(r1.module, 'shared/engine/queue.js');
    assert.strictEqual(r1.enqueue.action, 'enqueued');
    assert.strictEqual(r1.enqueue.via, 'local-queue');
    const list1 = Q.list(artifactsDir, 'repair-lead');
    assert.strictEqual(list1.queued.length, 1);
    const entry1 = list1.queued[0];
    assert.strictEqual(entry1.id, r1.queueId);
    assert(entry1.id.includes('2026-W27'), 'queue id must embed week key');
    assert.strictEqual(entry1.priority, 90);
    assert.strictEqual(entry1.task.role, 'repair-lead');
    assert.strictEqual(entry1.task.flowId, 'agent-once');
    assert(entry1.task.goal.includes('self-reflection-optimizer'), 'goal must reference the shared capability flow');
    assert(entry1.task.goal.includes('≤10 条'), 'goal must carry ledger budget');
    assert(entry1.task.goal.includes('auto_execute ≤3 条'), 'goal must carry auto-execute budget');
    assert(entry1.task.goal.includes('bulletin-add'), 'owner_decision items go to bulletin');
    assert(entry1.task.bounds.includes('未登记'));

    // ---- 同周幂等:第二次调用跳过,不新增队列条目 ----
    const r2 = await Rotation.run(Object.assign({}, base, { now: SUNDAY + 2 * 60 * 60 * 1000 }));
    assert.strictEqual(r2.skipped, true);
    assert.strictEqual(r2.reason, 'already-ran-this-week');
    assert.strictEqual(Q.list(artifactsDir, 'repair-lead').queued.length, 1);

    // ---- 下一周:轮换到第 2 个模块(顺序确定) ----
    const r3 = await Rotation.run(Object.assign({}, base, { now: SUNDAY + 7 * DAY }));
    assert.strictEqual(r3.skipped, false);
    assert.strictEqual(r3.week, '2026-W28');
    assert.strictEqual(r3.module, 'shared/engine/done-gate.js');

    // ---- --force:同周强制推进到第 3 个模块 ----
    const r4 = await Rotation.run(Object.assign({}, base, { now: SUNDAY + 7 * DAY + 60 * 1000, force: true }));
    assert.strictEqual(r4.skipped, false);
    assert.strictEqual(r4.module, 'shared/engine/cli-runner.js');
    assert.strictEqual(Q.list(artifactsDir, 'repair-lead').queued.length, 3);

    // ---- 状态文件:index 前进、历史留痕 ----
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(state.nextIndex, 3);
    assert.strictEqual(state.lastModule, 'shared/engine/cli-runner.js');
    assert.strictEqual(state.history.length, 3);
    assert.deepStrictEqual(state.history.map(h => h.module), [
      'shared/engine/queue.js',
      'shared/engine/done-gate.js',
      'shared/engine/cli-runner.js',
    ]);

    // ---- 同 id 已存在(任意状态)不重复入队 ----
    const stale = JSON.parse(JSON.stringify(state));
    stale.lastWeek = '2026-W26'; // 伪造成上周跑过,本周(W28)重跑第 4 个模块
    fs.writeFileSync(stateFile, JSON.stringify(stale, null, 2));
    const nextId = `self-review-${Rotation.moduleSlug(Rotation.ROTATION_MODULES[3])}-2026-W28`;
    fs.mkdirSync(path.join(artifactsDir, 'queues', 'repair-lead', 'done'), { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, 'queues', 'repair-lead', 'done', `${nextId}.json`), JSON.stringify({ id: nextId, status: 'done' }));
    const r5 = await Rotation.run(Object.assign({}, base, { now: SUNDAY + 7 * DAY + 2 * 60 * 1000 }));
    assert.strictEqual(r5.enqueue.action, 'skipped-existing');
    assert.strictEqual(Q.list(artifactsDir, 'repair-lead').queued.length, 3, 'existing id must not enqueue again');

    console.log(JSON.stringify({ pass: true, suite: 'self-review-rotation' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
