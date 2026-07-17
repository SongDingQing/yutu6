#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');

function ids(items) {
  return items.map(item => item.id);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-test-'));
  const agent = 'worker_code';

  try {
    Q.enqueue(root, agent, { goal: 'low priority' }, { id: 'low', priority: 50 });
    Q.enqueue(root, agent, { goal: 'high priority' }, { id: 'high', priority: 10 });
    Q.enqueue(root, agent, { goal: 'same priority later' }, { id: 'later', priority: 50 });
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['high', 'low', 'later']);

    const reprioritized = Q.setPriority(root, agent, 'later', 5);
    assert.strictEqual(reprioritized.priority, 5);
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['later', 'high', 'low']);

    const claimed = Q.claim(root, agent, { owner: 'worker:test', ownerPid: 4242, leaseMs: 1000 });
    assert.strictEqual(claimed.id, 'later');
    assert.strictEqual(claimed.status, 'running');
    assert.strictEqual(claimed.lease_owner, 'worker:test');
    assert.strictEqual(claimed.lease_owner_pid, 4242);
    assert.strictEqual(claimed.lease_ms, 1000);
    assert(claimed.lease_heartbeat_at);
    assert.strictEqual(Q.list(root, agent).running.length, 1);

    const touched = Q.touchLease(root, agent, 'later', { owner: 'worker:test', ownerPid: 4242, leaseMs: 1000, progress: 'still running' });
    assert.strictEqual(touched.progress, 'still running');
    assert.strictEqual(touched.lease_owner, 'worker:test');

    const steered = Q.steer(root, agent, 'later', 'check the critical path');
    assert.strictEqual(steered.steer.length, 1);
    assert.match(steered.steer[0].msg, /critical path/);

    const done = Q.complete(root, agent, 'later', true, { result: 'ok' });
    assert.strictEqual(done.status, 'done');
    assert.strictEqual(Q.list(root, agent).done, 1);
    assert.strictEqual(Q.list(root, agent).running.length, 0);

    const paused = Q.pause(root, agent, 'low');
    assert.strictEqual(paused.status, 'paused');
    assert.deepStrictEqual(ids(Q.list(root, agent).paused), ['low']);
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['high']);

    const resumed = Q.resume(root, agent, 'low');
    assert.strictEqual(resumed.status, 'queued');
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['high', 'low']);

    const canceledQueued = Q.cancel(root, agent, 'high');
    assert.strictEqual(canceledQueued.status, 'canceled');
    assert.strictEqual(Q.list(root, agent).canceled, 1);

    const running = Q.claim(root, agent);
    assert.strictEqual(running.id, 'low');
    const canceling = Q.cancel(root, agent, 'low');
    assert.strictEqual(canceling.status, 'canceling');
    assert.strictEqual(canceling.cancel_requested, true);
    const canceledRunning = Q.finish(root, agent, 'low', 'canceled', { reason: 'test cancel' });
    assert.strictEqual(canceledRunning.status, 'canceled');
    assert.strictEqual(Q.list(root, agent).canceled, 2);

    Q.enqueue(root, agent, { goal: 'pause while running' }, { id: 'run-pause', priority: 15 });
    Q.claim(root, agent);
    const pausedRunning = Q.finish(root, agent, 'run-pause', 'paused', {
      reason: 'needs human',
      progress_at: '2026-06-22T19:34:53.589Z',
      node_event_at: '2026-06-22T19:34:53.589Z',
      progress_event: 'edge.take',
      progress_node: 'review',
      progress_task: 'old-task',
      engine_pid: 424242,
      lease_ms: 90000,
    });
    assert.strictEqual(pausedRunning.status, 'paused');
    assert.strictEqual(pausedRunning.reason, 'needs human');
    assert.deepStrictEqual(ids(Q.list(root, agent).paused), ['run-pause']);

    const resumedRunningPause = Q.resume(root, agent, 'run-pause');
    assert.strictEqual(resumedRunningPause.status, 'queued');
    assert.strictEqual(resumedRunningPause.reason, undefined);
    assert.strictEqual(resumedRunningPause.engine_code, undefined);
    assert.strictEqual(resumedRunningPause.started_at, undefined);
    assert.strictEqual(resumedRunningPause.paused_at, undefined);
    assert.strictEqual(resumedRunningPause.progress_at, undefined);
    assert.strictEqual(resumedRunningPause.node_event_at, undefined);
    assert.strictEqual(resumedRunningPause.progress_event, undefined);
    assert.strictEqual(resumedRunningPause.progress_node, undefined);
    assert.strictEqual(resumedRunningPause.progress_task, undefined);
    assert.strictEqual(resumedRunningPause.engine_pid, undefined, 'resume 必须清 engine_pid(与 requeue 对齐,消除三份黑名单 drift)');
    assert.strictEqual(resumedRunningPause.lease_ms, undefined, 'resume 必须清 lease_ms(与 requeue 对齐)');
    Q.cancel(root, agent, 'run-pause');

    Q.enqueue(root, agent, { goal: 'blocked by current resource lock' }, { id: 'blocked', priority: 1 });
    Q.enqueue(root, agent, { goal: 'runnable later item' }, { id: 'runnable', priority: 2 });
    const matched = Q.claim(root, agent, { match: entry => entry.id === 'runnable' });
    assert.strictEqual(matched.id, 'runnable');
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['blocked']);
    Q.complete(root, agent, 'runnable', true);
    Q.cancel(root, agent, 'blocked');

    Q.enqueue(root, agent, { goal: 'retry me' }, { id: 'retry', priority: 20 });
    Q.claim(root, agent);
    Q.touchProgress(root, agent, 'retry', {
      progress_at: '2026-06-22T19:34:53.589Z',
      node_event_at: '2026-06-22T19:34:53.589Z',
      progress_event: 'edge.take',
      progress_node: 'review',
      progress_task: 'old-task',
    });
    const requeued = Q.requeue(root, agent, 'retry', { retry: 1, enginePid: 999999, pre_engine_wait_heartbeat_at: '2026-06-22T19:34:53.589Z' });
    assert.strictEqual(requeued.status, 'queued');
    assert.strictEqual(requeued.retry, 1);
    assert.strictEqual(requeued.enginePid, undefined);
    assert.strictEqual(requeued.pre_engine_wait_heartbeat_at, undefined, 'requeue 必须清 pre-engine 等待心跳');
    assert.strictEqual(requeued.progress_at, undefined);
    assert.strictEqual(requeued.node_event_at, undefined);
    assert.strictEqual(requeued.progress_event, undefined);
    assert.strictEqual(requeued.progress_node, undefined);
    assert.strictEqual(requeued.progress_task, undefined);
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['retry']);

    // touchLease/touchProgress 不得复活已迁出/损坏的 running 文件(TOCTOU 幽灵 running 防护)。
    Q.enqueue(root, agent, { goal: 'heartbeat race' }, { id: 'hb-race', priority: 12 });
    Q.claim(root, agent, { match: entry => entry.id === 'hb-race' });
    // 模拟"心跳读到 existsSync=true 后,任务被并发 finish 迁走":直接删掉 running 文件。
    const hbRunning = path.join(root, 'queues', agent, 'running', 'hb-race.json');
    fs.unlinkSync(hbRunning);
    assert.strictEqual(Q.touchProgress(root, agent, 'hb-race', { progress_at: 'x' }), null,
      'running 文件已迁走时 touchProgress 必须返回 null');
    assert.strictEqual(fs.existsSync(hbRunning), false, 'touchProgress 不得重建幽灵 running 文件');
    assert.strictEqual(Q.touchLease(root, agent, 'hb-race', { owner: 'w', ownerPid: 1 }), null,
      'running 文件已迁走时 touchLease 必须返回 null');
    assert.strictEqual(fs.existsSync(hbRunning), false, 'touchLease 不得重建幽灵 running 文件');
    // 损坏(存在但无法解析)的 running 文件:不得用两字段桩覆盖、丢掉任务数据。
    fs.writeFileSync(hbRunning, '{ not json');
    assert.strictEqual(Q.touchProgress(root, agent, 'hb-race', { progress_at: 'y' }), null,
      'running 文件损坏时 touchProgress 必须返回 null 而非覆盖');
    assert.strictEqual(fs.readFileSync(hbRunning, 'utf8'), '{ not json', 'touchProgress 不得覆盖损坏文件');
    fs.unlinkSync(hbRunning);

    Q.enqueue(root, agent, { goal: 'stale queued runtime metadata' }, { id: 'stale-queued', priority: 15 });
    const queueDir = path.join(root, 'queues', agent);
    const staleQueuedFile = fs.readdirSync(queueDir).find(file => file.endsWith('-stale-queued.json'));
    assert(staleQueuedFile, 'stale queued item should exist');
    const staleQueuedPath = path.join(queueDir, staleQueuedFile);
    const staleQueuedEntry = JSON.parse(fs.readFileSync(staleQueuedPath, 'utf8'));
    Object.assign(staleQueuedEntry, {
      enginePid: 999999,
      engine_started_at: '2026-06-22T19:34:53.589Z',
      engine_heartbeat_at: '2026-06-22T19:34:53.589Z',
      pre_engine_wait_heartbeat_at: '2026-06-22T19:34:53.589Z',
      progress_at: '2026-06-22T19:34:53.589Z',
      node_event_at: '2026-06-22T19:34:53.589Z',
      progress_event: 'node.start',
      progress_node: 'review',
      progress_task: 'old-task',
      engine_signal: 'SIGTERM',
      cancel_requested: true,
    });
    fs.writeFileSync(staleQueuedPath, JSON.stringify(staleQueuedEntry, null, 2));
    const claimedStaleQueued = Q.claim(root, agent, { match: entry => entry.id === 'stale-queued' });
    assert.strictEqual(claimedStaleQueued.status, 'running');
    assert.strictEqual(claimedStaleQueued.progress_at, undefined);
    assert.strictEqual(claimedStaleQueued.node_event_at, undefined);
    assert.strictEqual(claimedStaleQueued.progress_event, undefined);
    assert.strictEqual(claimedStaleQueued.progress_node, undefined);
    assert.strictEqual(claimedStaleQueued.progress_task, undefined);
    assert.strictEqual(claimedStaleQueued.enginePid, undefined);
    assert.strictEqual(claimedStaleQueued.engine_signal, undefined);
    assert.strictEqual(claimedStaleQueued.cancel_requested, undefined);
    assert.strictEqual(claimedStaleQueued.pre_engine_wait_heartbeat_at, undefined,
      'claim 必须清掉旧 attempt 的 pre-engine 等待心跳(无 enginePid 时 watchdog 优先读它判活)');
    assert(claimedStaleQueued.started_at, 'claim must provide a fresh started_at fallback');
    Q.complete(root, agent, 'stale-queued', true);

    // 并发 claim 竞争:rename 被别人抢先只应跳过该文件继续扫下一个,不得放弃整个调度周期。
    Q.enqueue(root, agent, { goal: 'race target' }, { id: 'race-a', priority: 10 });
    Q.enqueue(root, agent, { goal: 'race fallback' }, { id: 'race-b', priority: 20 });
    const raceFile = fs.readdirSync(queueDir).find(file => file.endsWith('-race-a.json'));
    fs.mkdirSync(path.join(queueDir, 'running'), { recursive: true });
    fs.renameSync(path.join(queueDir, raceFile), path.join(queueDir, 'running', 'race-a.json'));
    // 用 match 白名单模拟"扫描列表仍含 race-a(已被并发者移走)":claim 内部 rd() 读不到 race-a 会跳过,
    // rename 失败路径由 race-b 前放置一个只读障碍难以稳定模拟,这里验证的语义是:列表首选不可得时返回下一个可领项。
    const raceClaimed = Q.claim(root, agent, { match: entry => entry.id === 'race-a' || entry.id === 'race-b' });
    assert(raceClaimed && raceClaimed.id === 'race-b', 'claim 竞争失败必须继续扫下一个待领取项');
    Q.complete(root, agent, 'race-b', true);
    fs.unlinkSync(path.join(queueDir, 'running', 'race-a.json'));

    // setPriority/steer 对损坏文件必须返回 null 而非抛错(与 pause/cancel/resume 的 null 守卫对齐,不覆盖文件)。
    Q.enqueue(root, agent, { goal: 'corrupt guard' }, { id: 'corrupt', priority: 30 });
    const corruptFile = fs.readdirSync(queueDir).find(file => file.endsWith('-corrupt.json'));
    const corruptPath = path.join(queueDir, corruptFile);
    fs.writeFileSync(corruptPath, '{ not json');
    assert.strictEqual(Q.setPriority(root, agent, 'corrupt', 5), null, 'setPriority 遇损坏 queued 文件必须返回 null');
    assert.strictEqual(Q.steer(root, agent, 'corrupt', 'hi'), null, 'steer 遇损坏 queued 文件必须返回 null');
    assert.strictEqual(fs.readFileSync(corruptPath, 'utf8'), '{ not json', 'guard 不得覆盖损坏文件');
    fs.unlinkSync(corruptPath);

    // steer 遇损坏 running 文件必须返回 null 而非抛错/复活幽灵 running 文件。
    Q.enqueue(root, agent, { goal: 'steer corrupt running' }, { id: 'steer-corrupt', priority: 12 });
    Q.claim(root, agent, { match: entry => entry.id === 'steer-corrupt' });
    const steerRun = path.join(queueDir, 'running', 'steer-corrupt.json');
    fs.writeFileSync(steerRun, '{ not json');
    assert.strictEqual(Q.steer(root, agent, 'steer-corrupt', 'late'), null, 'running 文件损坏时 steer 必须返回 null');
    assert.strictEqual(fs.readFileSync(steerRun, 'utf8'), '{ not json', 'steer 不得覆盖损坏 running 文件');
    fs.unlinkSync(steerRun);

    Q.enqueue(root, agent, { goal: 'first drag item' }, { id: 'drag-a', priority: 80 });
    Q.enqueue(root, agent, { goal: 'second drag item' }, { id: 'drag-b', priority: 5 });
    Q.enqueue(root, agent, { goal: 'third drag item' }, { id: 'drag-c', priority: 50 });
    assert.deepStrictEqual(ids(Q.reorder(root, agent, ['drag-a', 'drag-c', 'drag-b', 'retry'], { normalizePriority: true })), ['drag-a', 'drag-c', 'drag-b', 'retry']);
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['drag-a', 'drag-c', 'drag-b', 'retry']);

    console.log(JSON.stringify({ pass: true, suite: 'queue' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
