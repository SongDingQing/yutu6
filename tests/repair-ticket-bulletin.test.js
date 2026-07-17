#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-repair-bulletin-test-'));
  const artifactsDir = path.join(root, 'artifacts');

  try {
    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_EVENTS_FILE = path.join(artifactsDir, 'engine-events.jsonl');

    const Tools = require('../projects/控制台/secretary-tools');
    const Server = require('../projects/控制台/server');
    fs.mkdirSync(path.join(root, 'board', 'repair-tickets'), { recursive: true });

    const manual = Tools.repairTicketAdd({
      id: 'manual-ticket',
      title: 'Manual repair',
      source: '秘书',
      problem: 'manual repair smoke',
    });
    assert.strictEqual(manual.bulletinId, 'repair-manual-ticket');
    assert(Tools.bulletinSummary().cards.some(card => card.id === 'repair-manual-ticket'));

    const completed = Tools.repairTicketComplete({
      id: 'manual-ticket',
      result: '根因: test; 处理: done; 验证: local assertion; 架构判断: one-off',
      notify: 'false',
    });
    assert.deepStrictEqual(completed.removedBulletins, ['repair-manual-ticket']);
    assert.strictEqual(completed.memoryReview.queued, true);
    assert.strictEqual(completed.memoryReview.queueAgent, 'memory-officer');
    assert.strictEqual(completed.yuanxiao.attempted, false);
    assert(fs.existsSync(path.join(artifactsDir, 'repair-reports', 'manual-ticket.html')), 'completion must generate one fixed HTML report');
    assert.strictEqual(completed.report.file, 'artifacts/repair-reports/manual-ticket.html');
    assert(!Tools.bulletinSummary().cards.some(card => card.id === 'repair-manual-ticket'));
    const memoryQueued = Q.list(artifactsDir, 'memory-officer').queued;
    assert.strictEqual(memoryQueued.length, 1);
    assert.strictEqual(memoryQueued[0].task.role, 'memory_officer');
    assert.strictEqual(memoryQueued[0].task.flowId, 'agent-once');
    assert(memoryQueued[0].task.goal.includes('问题模式 → 根因 → 解法'));
    assert(memoryQueued[0].task.bounds.includes('只写 memory/'));

    const cardsFile = path.join(artifactsDir, 'bulletin', 'cards.json');
    writeJson(cardsFile, [{
      id: 'repair-manual-ticket',
      title: '维修工单: Manual repair',
      target: 'repair-lead',
      project: '控制台',
      source: '维修工单',
      payload: {
        role: 'repair-lead',
        flowId: 'agent-once',
        projectId: '控制台',
        goal: '维修工单 manual-ticket\n请读取 board/repair-tickets/manual-ticket.md 后处理。',
      },
      status: 'todo',
      queueId: null,
    }]);

    const skipped = Tools.bulletinEnable({ id: 'repair-manual-ticket' });
    assert.strictEqual(skipped.alreadyDone, true);
    assert.strictEqual(skipped.ticketId, 'manual-ticket');
    assert.strictEqual(Q.list(artifactsDir, 'repair').queued.length, 0);
    assert(!Tools.bulletinSummary().cards.some(card => card.id === 'repair-manual-ticket'));

    const apiSkip = Server._test.doneRepairTicketBulletin({
      id: 'repair-manual-ticket',
      target: 'repair-lead',
      payload: {
        goal: '维修工单 manual-ticket\n请读取 board/repair-tickets/manual-ticket.md 后处理。',
      },
    }, root);
    assert.strictEqual(apiSkip.skip, true);
    assert.strictEqual(apiSkip.ticketId, 'manual-ticket');
    assert.strictEqual(apiSkip.status, 'done');

    writeJson(cardsFile, [{
      id: 'feedback-card',
      title: '启用反馈测试',
      target: 'ceo',
      project: '控制台',
      source: '洞察员',
      payload: {
        role: 'orchestrator',
        flowId: 'project-route',
        projectId: '控制台',
        goal: '启用后应返回明确排队反馈',
      },
      status: 'todo',
      queueId: null,
    }]);
    const blocked = Tools.bulletinEnable({ id: 'feedback-card' });
    assert.strictEqual(blocked.blocked, true);
    assert.strictEqual(blocked.reason, 'insight-requires-owner-enable');
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 0);
    const enabled = Tools.bulletinEnable({ id: 'feedback-card', ownerApproved: true });
    assert.strictEqual(enabled.ok, true);
    assert.strictEqual(enabled.queueStatus.status, 'queued');
    assert.strictEqual(enabled.queueStatus.position, 1);
    assert.strictEqual(enabled.queueStatus.queuedAhead, 0);
    assert.strictEqual(enabled.card.queueId, enabled.entry.id);
    const alreadyEnabled = Tools.bulletinEnable({ id: 'feedback-card' });
    assert.strictEqual(alreadyEnabled.already, true);
    assert.strictEqual(alreadyEnabled.queueStatus.status, 'queued');
    assert.strictEqual(alreadyEnabled.queueStatus.id, enabled.entry.id);

    const auto = Tools.repairTicketAdd({
      id: 'auto-20260620000000-testfp',
      title: 'Auto repair',
      source: '自动故障触发',
      problem: 'node_failed',
    });
    assert.strictEqual(auto.bulletinId, null);
    assert(!Tools.bulletinSummary().cards.some(card => card.id === 'repair-auto-20260620000000-testfp'));

    console.log(JSON.stringify({ pass: true, suite: 'repair-ticket-bulletin' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
