#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');
const Organizer = require('../shared/engine/queue-organizer');

function ids(items) {
  return items.map(item => item.id);
}

function idempotencyFiles(root) {
  const dir = path.join(root, 'queue-organize-idempotency');
  try { return fs.readdirSync(dir).filter(file => /\.json$/.test(file)).sort(); }
  catch (_) { return []; }
}

function queuedEntryFile(root, agent, id) {
  const dir = Q.qdir(root, agent);
  const file = fs.readdirSync(dir).find(name => name.endsWith(`-${id}.json`));
  return file ? path.join(dir, file) : null;
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-test-'));
  const agent = 'ceo';

  try {
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: 'CEO 要有整理队列能力, 合并同类任务, 不影响 running。',
    }, { id: 'active-root', priority: 0 });
    const active = Q.claim(root, agent);
    assert.strictEqual(active.status, 'running');

    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '补充: 队列整理不要造新轮子, 先用已有 queue 工具。',
    }, { id: 'active-dupe', priority: 0 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '模型用量面板: glm 5.2 不应计费, 展示 claudecode/codex 用量和额度。',
    }, { id: 'llm-a', priority: 10 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '给控制室加 LLM 网关可观测面板, 借鉴 Helicone session trace 与 Portkey gateway 日志。',
    }, { id: 'llm-b', priority: 50 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '复盘最近 repair 队列 done 工单并飞书通知老板。',
    }, { id: 'repair-retro', priority: 20 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '完全重复任务: 控制台重复文本 exact regression',
      acceptance: '验收 A: 保留原任务。',
    }, { id: 'exact-a', priority: 30 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      goal: '完全重复任务: 控制台重复文本 exact regression',
      acceptance: '验收 B: 被合并项验收必须逐字保留。',
    }, { id: 'exact-b', priority: 31 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      queueMergeKey: 'structured-queue-cleanup',
      goal: '结构化合并 A: 清理同一个队列重复项',
    }, { id: 'struct-a', priority: 32 });
    Q.enqueue(root, agent, {
      projectId: '控制台',
      queueMergeKey: 'structured-queue-cleanup',
      goal: '结构化合并 B: 同一个明确 queueMergeKey',
    }, { id: 'struct-b', priority: 33 });

    const dry = Organizer.organize(root, { agents: [agent], projectId: '控制台', apply: false });
    assert.strictEqual(dry.applied, false);
    assert.strictEqual(dry.out_of_band, true);
    assert(dry.snapshot && dry.snapshot.hash, 'dry-run plan must include queue snapshot');
    assert(dry.plan_hash, 'dry-run plan must include plan hash');
    assert.strictEqual(dry.summary.planned_groups, 4);
    assert.deepStrictEqual(ids(Q.list(root, agent).queued), ['active-dupe', 'llm-a', 'repair-retro', 'exact-a', 'exact-b', 'struct-a', 'struct-b', 'llm-b']);

    const applied = Organizer.organize(root, {
      agents: [agent],
      projectId: '控制台',
      apply: true,
      plan: dry,
      source: 'test',
    });
    assert.strictEqual(applied.applied, true);
    assert.strictEqual(applied.idempotency_key, dry.idempotency_key);
    assert.strictEqual(applied.summary.skipped, 2);
    assert.strictEqual(applied.summary.queued_after, 6);

    const replay = Organizer.organize(root, {
      agents: [agent],
      projectId: '控制台',
      apply: true,
      plan: dry,
      source: 'test',
    });
    assert.strictEqual(replay.idempotent_replay, true);
    assert.strictEqual(replay.plan_hash, dry.plan_hash);

    const listed = Q.list(root, agent);
    assert.deepStrictEqual(ids(listed.running), ['active-root']);
    assert.strictEqual(listed.running[0].cancel_requested, undefined);
    assert.deepStrictEqual(ids(listed.queued), ['active-dupe', 'llm-a', 'repair-retro', 'exact-a', 'struct-a', 'llm-b']);
    assert.strictEqual(listed.canceled, 2);

    assert(listed.queued.some(entry => entry.id === 'active-dupe'), 'same-class active duplicate must not be auto-canceled by default');
    assert(listed.queued.some(entry => entry.id === 'llm-b'), 'same bucket text similarity must not be auto-canceled by default');

    const keep = listed.queued.find(entry => entry.id === 'exact-a');
    assert.match(keep.task.goal, /Queue organization merge note/);
    assert.match(keep.task.goal, /Queue organization preserved requirements/);
    assert.match(keep.task.goal, /exact-b/);
    assert.match(keep.task.goal, /验收 B: 被合并项验收必须逐字保留。/);
    assert(keep.queue_organize.integrity.requirement_hashes.length >= 1);
    assert(keep.queue_organize.integrity.acceptance_hashes.length >= 1);
    assert.strictEqual(keep.queue_organize.merged_from[0].id, 'exact-b');

    const structuredKeep = listed.queued.find(entry => entry.id === 'struct-a');
    assert.match(structuredKeep.task.goal, /Queue organization merge note/);
    assert.match(structuredKeep.task.goal, /struct-b/);
    const canceledStructured = JSON.parse(fs.readFileSync(path.join(root, 'queues', agent, 'canceled', 'struct-b.json'), 'utf8'));
    assert.deepStrictEqual(canceledStructured.merged_into, { agent, id: 'struct-a', state: 'queued' });

    const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-conflict-'));
    try {
      Q.enqueue(conflictRoot, agent, { projectId: '控制台', queueMergeKey: 'snapshot-conflict', goal: '冲突测试 exact' }, { id: 'conflict-a', priority: 10 });
      Q.enqueue(conflictRoot, agent, { projectId: '控制台', queueMergeKey: 'snapshot-conflict', goal: '冲突测试 exact' }, { id: 'conflict-b', priority: 11 });
      const conflictPlan = Organizer.organize(conflictRoot, { agents: [agent], projectId: '控制台' });
      Q.enqueue(conflictRoot, agent, { projectId: '控制台', goal: 'dry-run 后新增任务导致 snapshot 变化' }, { id: 'conflict-c', priority: 12 });
      const rejected = Organizer.organize(conflictRoot, { agents: [agent], projectId: '控制台', apply: true, plan: conflictPlan });
      assert.strictEqual(rejected.ok, false);
      assert.strictEqual(rejected.code, 'queue_snapshot_mismatch');
      assert(Q.list(conflictRoot, agent).queued.some(entry => entry.id === 'conflict-b'), 'snapshot reject must not cancel stale plan items');
    } finally {
      fs.rmSync(conflictRoot, { recursive: true, force: true });
    }

    const projectApplyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-project-apply-'));
    try {
      Q.enqueue(projectApplyRoot, agent, { projectId: 'demo-app', queueMergeKey: 'project-apply-guard', goal: 'generic project keep' }, { id: 'project-keep', priority: 10 });
      Q.enqueue(projectApplyRoot, agent, { projectId: 'demo-app', queueMergeKey: 'project-apply-guard', goal: 'generic project drop' }, { id: 'project-drop', priority: 11 });
      const projectPlan = Organizer.organize(projectApplyRoot, { agents: [agent], projectId: 'demo-app' });
      const projectApplied = Organizer.organize(projectApplyRoot, { agents: [agent], projectId: 'demo-app', apply: true, plan: projectPlan });
      assert.strictEqual(projectApplied.ok, true);
      assert.strictEqual(projectApplied.applied, true, '任意新建项目应使用同一套队列整理协议');
      assert(!Q.list(projectApplyRoot, agent).queued.some(entry => entry.id === 'project-drop'));
    } finally {
      fs.rmSync(projectApplyRoot, { recursive: true, force: true });
    }

    const crossAgentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-cross-agent-'));
    try {
      Q.enqueue(crossAgentRoot, 'agent_a', { projectId: '控制台', queueMergeKey: 'cross-agent-guard', goal: 'cross agent keep' }, { id: 'cross-a', priority: 10 });
      Q.enqueue(crossAgentRoot, 'agent_b', { projectId: '控制台', queueMergeKey: 'cross-agent-guard', goal: 'cross agent drop' }, { id: 'cross-b', priority: 11 });
      const crossPlan = Organizer.organize(crossAgentRoot, { agents: ['agent_a', 'agent_b'], projectId: '控制台', allowCrossAgentMerge: true });
      assert.strictEqual(crossPlan.summary.planned_groups, 1);
      const crossRejected = Organizer.organize(crossAgentRoot, { agents: ['agent_a', 'agent_b'], projectId: '控制台', apply: true, plan: crossPlan });
      assert.strictEqual(crossRejected.ok, false);
      assert.strictEqual(crossRejected.code, 'cross_agent_merge_requires_opt_in');
      assert(Q.list(crossAgentRoot, 'agent_b').queued.some(entry => entry.id === 'cross-b'), 'cross-agent reject must leave other agent queue untouched');
    } finally {
      fs.rmSync(crossAgentRoot, { recursive: true, force: true });
    }

    const pausedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-paused-'));
    try {
      Q.enqueue(pausedRoot, agent, { projectId: '控制台', queueMergeKey: 'paused-merge', goal: 'paused merge keep' }, { id: 'paused-keep', priority: 10 });
      Q.enqueue(pausedRoot, agent, { projectId: '控制台', queueMergeKey: 'paused-merge', goal: 'paused merge cancel', acceptance: 'paused acceptance must survive' }, { id: 'paused-cancel', priority: 11 });
      Q.pause(pausedRoot, agent, 'paused-cancel');
      const pausedPlan = Organizer.organize(pausedRoot, { agents: [agent], projectId: '控制台' });
      const pausedApplied = Organizer.organize(pausedRoot, { agents: [agent], projectId: '控制台', apply: true, plan: pausedPlan });
      assert.strictEqual(pausedApplied.ok, true);
      assert.deepStrictEqual(ids(Q.list(pausedRoot, agent).paused), ['paused-keep']);
      const pausedKeep = Q.list(pausedRoot, agent).paused.find(entry => entry.id === 'paused-keep');
      assert.match(pausedKeep.task.goal, /paused acceptance must survive/);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(pausedRoot, 'queues', agent, 'canceled', 'paused-cancel.json'), 'utf8')).merged_into.state, 'paused');
    } finally {
      fs.rmSync(pausedRoot, { recursive: true, force: true });
    }

    const noopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-noop-'));
    try {
      Q.enqueue(noopRoot, agent, { projectId: '控制台', queueMergeKey: 'noop-idempotency', goal: 'noop keep' }, { id: 'noop-keep', priority: 10 });
      Q.enqueue(noopRoot, agent, { projectId: '控制台', queueMergeKey: 'noop-idempotency', goal: 'noop cancel', acceptance: 'noop acceptance survives' }, { id: 'noop-cancel', priority: 11 });
      Q.enqueue(noopRoot, agent, { projectId: '控制台', goal: 'running sentinel must stay byte-identical' }, { id: 'noop-running', priority: 12 });
      Q.claim(noopRoot, agent, { match: entry => entry.id === 'noop-running' });
      const runningFile = path.join(Q.qdir(noopRoot, agent), 'running', 'noop-running.json');
      const runningBefore = fs.readFileSync(runningFile, 'utf8');

      const firstDry = Organizer.organize(noopRoot, { agents: [agent], projectId: '控制台' });
      assert.strictEqual(firstDry.summary.planned_groups, 1);
      assert.strictEqual(idempotencyFiles(noopRoot).length, 0, 'dry-run must not write idempotency audit files');
      const firstApply = Organizer.organize(noopRoot, { agents: [agent], projectId: '控制台', apply: true, plan: firstDry });
      assert.strictEqual(firstApply.ok, true);
      assert.strictEqual(firstApply.plan_hash, firstDry.plan_hash);
      assert.strictEqual(firstApply.summary.changed, 2);
      assert.strictEqual(idempotencyFiles(noopRoot).length, 1);
      assert.strictEqual(fs.existsSync(path.join(noopRoot, 'queues', '_organize-idempotency')), false, 'idempotency audits must not create a queue agent directory');

      const keepFile = queuedEntryFile(noopRoot, agent, 'noop-keep');
      const keepBeforeSecond = fs.readFileSync(keepFile, 'utf8');
      const canceledBeforeSecond = Q.list(noopRoot, agent).canceled;
      const idempotencyBeforeSecond = idempotencyFiles(noopRoot);
      const secondDry = Organizer.organize(noopRoot, { agents: [agent], projectId: '控制台' });
      assert.strictEqual(secondDry.summary.planned_groups, 0);
      const secondApply = Organizer.organize(noopRoot, { agents: [agent], projectId: '控制台', apply: true, plan: secondDry });
      assert.strictEqual(secondApply.ok, true);
      assert.strictEqual(secondApply.no_op, true);
      assert.strictEqual(secondApply.idempotency_written, false);
      assert.strictEqual(secondApply.summary.changed, 0);
      assert.strictEqual(secondApply.summary.skipped, 0);
      assert.deepStrictEqual(idempotencyFiles(noopRoot), idempotencyBeforeSecond);
      assert.strictEqual(Q.list(noopRoot, agent).canceled, canceledBeforeSecond);
      assert.strictEqual(fs.readFileSync(keepFile, 'utf8'), keepBeforeSecond, 'no-op apply must not append merge audit metadata again');
      assert.strictEqual(fs.readFileSync(runningFile, 'utf8'), runningBefore, 'running item must remain byte-identical across organize applies');
    } finally {
      fs.rmSync(noopRoot, { recursive: true, force: true });
    }

    const namedCaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-queue-organizer-5ba-0ee-'));
    try {
      Q.enqueue(namedCaseRoot, agent, {
        projectId: '控制台',
        queueMergeKey: 'hardening-false-merge-redo',
        goal: '5ba01b3f 假合并重做: 队列整理保留主任务',
        acceptance: '合并后任务数必须减少,主任务必须带 reviewChecklist。',
      }, { id: '5ba01b3f', priority: 10 });
      Q.enqueue(namedCaseRoot, agent, {
        projectId: '控制台',
        queueMergeKey: 'hardening-false-merge-redo',
        goal: '0ee86cb1 假合并重做: 被合并需求必须完整迁移',
        acceptance: '被合并需求全部保留; canceled 记录必须指向 merged_into; apply 必须幂等。',
      }, { id: '0ee86cb1', priority: 11 });
      Q.enqueue(namedCaseRoot, agent, {
        projectId: '控制台',
        goal: '5ba/0ee running sentinel must remain untouched',
      }, { id: 'named-running', priority: 12 });
      Q.claim(namedCaseRoot, agent, { match: entry => entry.id === 'named-running' });
      const runningFile = path.join(Q.qdir(namedCaseRoot, agent), 'running', 'named-running.json');
      const runningBefore = fs.readFileSync(runningFile, 'utf8');
      const beforeQueued = Q.list(namedCaseRoot, agent).queued.length;

      const namedDry = Organizer.organize(namedCaseRoot, { agents: [agent], projectId: '控制台' });
      assert.strictEqual(namedDry.summary.planned_groups, 1);
      assert.strictEqual(namedDry.summary.planned_cancel, 1);
      const namedApply = Organizer.organize(namedCaseRoot, { agents: [agent], projectId: '控制台', apply: true, plan: namedDry });
      assert.strictEqual(namedApply.ok, true);
      assert.strictEqual(namedApply.summary.queued_after, beforeQueued - 1, 'merge hard test must prove queued task count decreased');
      assert.strictEqual(namedApply.summary.changed, 2);
      const namedList = Q.list(namedCaseRoot, agent);
      assert.deepStrictEqual(ids(namedList.queued), ['5ba01b3f']);
      assert.strictEqual(namedList.canceled, 1);
      const namedKeep = namedList.queued[0];
      assert.match(namedKeep.task.goal, /0ee86cb1/);
      assert.match(namedKeep.task.goal, /被合并需求全部保留/);
      assert(namedKeep.task.reviewChecklist.some(item => item.source === 'ceo/0ee86cb1' && item.kind === 'acceptance'), 'reviewChecklist must include merged acceptance');
      assert(namedKeep.queue_organize.integrity.requirement_hashes.length >= 1);
      assert(namedKeep.queue_organize.integrity.acceptance_hashes.length >= 1);
      const namedCanceled = JSON.parse(fs.readFileSync(path.join(namedCaseRoot, 'queues', agent, 'canceled', '0ee86cb1.json'), 'utf8'));
      assert.deepStrictEqual(namedCanceled.merged_into, { agent, id: '5ba01b3f', state: 'queued' });
      assert.strictEqual(fs.readFileSync(runningFile, 'utf8'), runningBefore, 'running item must stay byte-identical in named hardening case');

      const namedSecondDry = Organizer.organize(namedCaseRoot, { agents: [agent], projectId: '控制台' });
      assert.strictEqual(namedSecondDry.summary.planned_groups, 0);
      const namedSecondApply = Organizer.organize(namedCaseRoot, { agents: [agent], projectId: '控制台', apply: true, plan: namedSecondDry });
      assert.strictEqual(namedSecondApply.ok, true);
      assert.strictEqual(namedSecondApply.no_op, true);
      assert.strictEqual(namedSecondApply.summary.changed, 0);
    } finally {
      fs.rmSync(namedCaseRoot, { recursive: true, force: true });
    }

    console.log(JSON.stringify({ pass: true, suite: 'queue-organizer' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
