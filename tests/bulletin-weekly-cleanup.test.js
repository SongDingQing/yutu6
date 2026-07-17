#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bulletin-weekly-cleanup-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const cardsFile = path.join(artifactsDir, 'bulletin', 'cards.json');
  const NOW = Date.parse('2026-07-05T04:45:00+08:00'); // 周日
  const daysAgo = n => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  try {
    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_EVENTS_FILE = path.join(artifactsDir, 'engine-events.jsonl');

    const Cleanup = require('../projects/控制台/tools/bulletin-weekly-cleanup');

    // 队列夹具:ceo 队列里一条 done 超 7 天、一条 done 才 2 天。
    writeJson(path.join(artifactsDir, 'queues', 'ceo', 'done', 'q-old-done.json'), {
      id: 'q-old-done', status: 'done', finished_at: daysAgo(10),
    });
    writeJson(path.join(artifactsDir, 'queues', 'ceo', 'done', 'q-recent-done.json'), {
      id: 'q-recent-done', status: 'done', finished_at: daysAgo(2),
    });

    const card = (id, over) => Object.assign({
      id,
      title: `卡片 ${id}`,
      desc: '',
      target: 'ceo',
      project: '控制台',
      source: '手动',
      payload: { role: 'orchestrator', flowId: 'project-route', projectId: '控制台', goal: `goal ${id}` },
      status: 'todo',
      created_at: daysAgo(1),
      enabled_at: null,
      queueId: null,
    }, over);

    const fixtures = [
      // a) enabled 且 queue done 超 7 天 → 归档
      card('done-old', { status: 'enabled', queueId: 'q-old-done', enabled_at: daysAgo(10), created_at: daysAgo(10) }),
      // a 反例) queue done 才 2 天 → 保留
      card('done-recent', { status: 'enabled', queueId: 'q-recent-done', enabled_at: daysAgo(2), created_at: daysAgo(9) }),
      // b) 洞察员提案卡 20 天无 queueId → 归档
      card('proposal-stale', { source: '洞察员', created_at: daysAgo(20), title: '陈旧提案评审某某能力' }),
      // b 反例) 提案卡才 3 天 → 保留
      card('proposal-fresh', { source: '自省优化', created_at: daysAgo(3), title: '新鲜提案优化某某链路' }),
      // c) 同标题前缀(前 12 个规整字符相同)两张 → 保留最新 dup-new,归档 dup-old
      card('dup-old', { title: '重复标题测试卡片甲乙丙丁', created_at: daysAgo(5) }),
      card('dup-new', { title: '重复标题测试卡片甲乙丙丁戊', created_at: daysAgo(2) }),
      // 维修工单卡:最老但豁免
      card('repair-oldest', { source: '维修工单', created_at: daysAgo(30), title: '维修工单: 某某故障' }),
      // 维修工单卡:即使 queue done 超 7 天也豁免,避免清算摘要和实现口径冲突
      card('repair-done-old', { source: '维修工单', status: 'enabled', queueId: 'q-old-done', enabled_at: daysAgo(10), created_at: daysAgo(30), title: '维修工单: 旧完成队列' }),
      // 已归档的卡不参与
      card('already-archived', { status: 'archived', created_at: daysAgo(40) }),
    ];
    // 填充 8 张普通活卡(12..5 天前),使 a/b/c 清算后活卡 13 张 > 10,触发 d 截断 3 张最老。
    for (let i = 0; i < 8; i++) {
      fixtures.push(card(`filler-${i}`, { title: `独立填充卡片编号${i}壹贰叁`, created_at: daysAgo(12 - i) }));
    }
    writeJson(cardsFile, fixtures);
    const beforeBytes = fs.readFileSync(cardsFile, 'utf8');

    // ---- dry-run:只出计划,无副作用 ----
    const dry = Cleanup.run({ apply: false, now: NOW });
    assert.strictEqual(dry.action, 'dry-run');
    const planIds = dry.plan.actions.map(a => a.id).sort();
    assert(planIds.includes('done-old'), 'rule a should archive done-old');
    assert(!planIds.includes('done-recent'), 'recent done card must stay');
    assert(planIds.includes('proposal-stale'), 'rule b should archive stale proposal');
    assert(!planIds.includes('proposal-fresh'), 'fresh proposal must stay');
    assert(planIds.includes('dup-old'), 'rule c should archive older duplicate');
    assert(!planIds.includes('dup-new'), 'newest duplicate must stay');
    assert(!planIds.includes('repair-oldest'), 'repair card is exempt');
    assert(!planIds.includes('repair-done-old'), 'repair card with old done queue is exempt');
    assert(!planIds.includes('already-archived'), 'archived card is not active');
    const dupAction = dry.plan.actions.find(a => a.id === 'dup-old');
    assert.strictEqual(dupAction.keepId, 'dup-new');
    // d) 活卡 16-3=13 > 10 → 归档 3 张最老 filler(repair-oldest 更老但豁免)
    const capIds = dry.plan.actions.filter(a => a.rule === 'd').map(a => a.id).sort();
    assert.deepStrictEqual(capIds, ['filler-0', 'filler-1', 'filler-2']);
    assert.strictEqual(dry.plan.activeAfter, 10);
    // 无副作用:cards.json 未动、无备份、无摘要
    assert.strictEqual(fs.readFileSync(cardsFile, 'utf8'), beforeBytes, 'dry-run must not touch cards.json');
    assert(!fs.readdirSync(path.dirname(cardsFile)).some(f => f.includes('.bak-')), 'dry-run must not create backup');
    assert(!fs.existsSync(path.join(root, 'board')) || !fs.readdirSync(path.join(root, 'board')).some(f => f.startsWith('公告板清算-')), 'dry-run must not write summary');

    // ---- apply:归档 + 备份 + 摘要落盘 + 摘要卡 ----
    const applied = Cleanup.run({ apply: true, now: NOW });
    assert.strictEqual(applied.action, 'applied');
    assert(fs.existsSync(applied.backupFile), 'backup must exist');
    assert(path.basename(applied.backupFile).startsWith('cards.json.bak-'), 'backup name must be cards.json.bak-<ts>');
    assert.strictEqual(fs.readFileSync(applied.backupFile, 'utf8'), beforeBytes, 'backup must be pre-cleanup snapshot');

    const after = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    const byId = new Map(after.map(c => [c.id, c]));
    assert.strictEqual(byId.get('done-old').status, 'archived');
    assert.strictEqual(byId.get('done-old').archivedReason, 'queue-done-over-7d');
    assert.strictEqual(byId.get('proposal-stale').status, 'archived');
    assert.strictEqual(byId.get('proposal-stale').archivedReason, 'proposal-stale-14d');
    assert.strictEqual(byId.get('dup-old').status, 'archived');
    assert(byId.get('dup-old').archivedReason.startsWith('duplicate-merged:dup-new'));
    assert.strictEqual(byId.get('filler-0').archivedReason, 'active-cap-overflow');
    assert.strictEqual(byId.get('repair-oldest').status, 'todo', 'repair card must survive');
    assert.strictEqual(byId.get('repair-done-old').status, 'enabled', 'repair card with old done queue must survive');
    assert.strictEqual(byId.get('done-recent').status, 'enabled');
    assert.strictEqual(byId.get('proposal-fresh').status, 'todo');

    // 摘要落盘 board/公告板清算-<date>.md(中文)
    const summaryFile = path.join(root, 'board', '公告板清算-20260705.md');
    assert.strictEqual(applied.summaryFile, summaryFile);
    const summaryText = fs.readFileSync(summaryFile, 'utf8');
    assert(summaryText.includes('公告板周清算摘要'), 'summary must be Chinese digest');
    assert(summaryText.includes('done-old'), 'summary lists archived cards');
    assert(summaryText.includes('cards.json.bak-'), 'summary mentions backup');

    // 摘要卡:source=公告板清算,加给 CEO,自身下轮豁免
    assert.strictEqual(applied.summaryCard.ok, true);
    assert.strictEqual(applied.summaryCard.added, true);
    const summaryCard = JSON.parse(fs.readFileSync(cardsFile, 'utf8')).find(c => c.id === 'bb-weekly-cleanup-20260705');
    assert(summaryCard, 'summary card must be added');
    assert.strictEqual(summaryCard.source, '公告板清算');
    assert.strictEqual(summaryCard.target, 'ceo');
    assert.strictEqual(summaryCard.status, 'todo');

    // ---- 第二轮 dry-run:摘要卡豁免,不会被清算;同日摘要卡幂等 ----
    const second = Cleanup.run({ apply: false, now: NOW + 60 * 60 * 1000 });
    assert(!second.plan.actions.some(a => a.id === 'bb-weekly-cleanup-20260705'), 'summary card must be exempt next round');
    const secondApply = Cleanup.run({ apply: true, now: NOW + 60 * 60 * 1000 });
    assert.strictEqual(secondApply.summaryCard.added, false);
    assert.strictEqual(secondApply.summaryCard.already, true, 'same-day summary card add must be idempotent');

    // ---- daily-governance-hardening 周日钩子(dry-run,只验计划不落地) ----
    delete process.env.DGH_WEEKLY_CLEANUP_ENABLED;
    delete process.env.DGH_SELF_REVIEW_ROTATION_ENABLED;
    const DGH = require('../projects/控制台/tools/daily-governance-hardening');
    assert.strictEqual(DGH.beijingWeekday('20260705'), 0, '2026-07-05 is Sunday');
    assert.strictEqual(DGH.beijingWeekday('20260703'), 5, '2026-07-03 is Friday');
    const sunday = DGH.triggerWeeklyGovernance('20260705', { dryRun: true });
    assert.strictEqual(sunday.isSunday, true);
    assert.strictEqual(sunday.action, 'triggered');
    assert.deepStrictEqual(sunday.jobs.map(j => j.name), ['bulletin-weekly-cleanup', 'self-review-rotation']);
    assert(sunday.jobs.every(j => j.action === 'would-trigger'), 'dry-run must not spawn');
    assert.strictEqual(sunday.jobs[0].delayMs, 45 * 60 * 1000, 'cleanup staggers +45min');
    assert.strictEqual(sunday.jobs[1].delayMs, 60 * 60 * 1000, 'rotation staggers +60min');
    assert(sunday.jobs[0].command.includes('bulletin-weekly-cleanup.js --apply'), 'weekly hook applies cleanup');
    assert.strictEqual(sunday.jobs[0].schedule.plannedBeijingTime, '05:45');
    assert.strictEqual(sunday.jobs[1].schedule.plannedBeijingTime, '06:00');
    const friday = DGH.triggerWeeklyGovernance('20260703', { dryRun: true });
    assert.strictEqual(friday.isSunday, false);
    assert.strictEqual(friday.reason, 'not-sunday');
    assert.deepStrictEqual(friday.jobs, []);
    const disabled = DGH.triggerWeeklyGovernance('20260705', { dryRun: true, cleanupEnabled: false, rotationEnabled: false });
    assert(disabled.jobs.every(j => j.action === 'skipped' && j.reason === 'disabled'), 'env switches must disable jobs');

    console.log(JSON.stringify({ pass: true, suite: 'bulletin-weekly-cleanup', archived: applied.plan.actions.length }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
