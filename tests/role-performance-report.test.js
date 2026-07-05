#!/usr/bin/env node
'use strict';

// role-performance-report 聚合回归:夹具队列元数据 + 夹具事件流 → 断言 role×runner 聚合数字正确。
// 覆盖:任务数/成功率/平均重试/failover 归因/done-gate 打回/窗口过滤/闲置角色标注/markdown 落盘。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Report = require('../projects/控制台/tools/role-performance-report');

const NOW = Date.parse('2026-07-03T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function iso(msAgo) {
  return new Date(NOW - msAgo).toISOString();
}

function writeQueueEntry(root, agent, status, entry) {
  const dir = path.join(root, 'queues', agent, status);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
}

function buildFixture(root) {
  // worker_code:窗口内 2 done + 1 failed(其中 1 条 runner 来自事件映射,其余兜底 codex)
  writeQueueEntry(root, 'worker_code', 'done', {
    id: 'wc1', target: 'worker_code', status: 'done',
    task: { role: 'worker_code', flowId: 'agent-once' },
    run_attempt: 1, finished_at: iso(1 * DAY),
  });
  writeQueueEntry(root, 'worker_code', 'done', {
    id: 'wc2', target: 'worker_code', status: 'done',
    task: { role: 'worker_code', flowId: 'agent-once' },
    run_attempt: 2, finished_at: iso(2 * DAY),
  });
  writeQueueEntry(root, 'worker_code', 'failed', {
    id: 'wc3', target: 'worker_code', status: 'failed',
    task: { role: 'worker_code', flowId: 'agent-once' },
    retry: 2, finished_at: iso(3 * DAY),
  });
  // 窗口外(10 天前)必须被排除
  writeQueueEntry(root, 'worker_code', 'done', {
    id: 'wc-old', target: 'worker_code', status: 'done',
    task: { role: 'worker_code' },
    run_attempt: 1, finished_at: iso(10 * DAY),
  });
  // it_engineer:显式 runnerType,1 done
  writeQueueEntry(root, 'it_engineer', 'done', {
    id: 'it1', target: 'it_engineer', status: 'done',
    task: { role: 'it_engineer', runnerType: 'zhipu-glm' },
    run_attempt: 1, finished_at: iso(1 * DAY),
  });
  // supervisor-控制台 → role 归一为 supervisor(task.role 缺省)
  writeQueueEntry(root, 'supervisor-控制台', 'done', {
    id: 'sup1', target: 'supervisor-控制台', status: 'done',
    task: { flowId: 'review-loop' },
    run_attempt: 1, finished_at: iso(1 * DAY),
  });

  const events = [
    // runner 归属映射:wc1 由 runner_lock 事件标为 codex(与兜底一致,验证映射路径)
    { seq: 1, ts: iso(1 * DAY), type: 'engine.runner_lock.acquired', queueAgent: 'worker_code', queueId: 'wc1', runnerType: 'codex' },
    // task→role 映射
    { seq: 2, ts: iso(1 * DAY), type: 'node.start', task: 't1', node: 'implement', role: 'worker_code' },
    // failover:worker_code 从 codex 被切走 → worker_code|codex 行 +1
    { seq: 3, ts: iso(1 * DAY), type: 'runner.failover', task: 't1', role: 'worker_code', from: 'codex', to: 'zhipu-glm', reason: 'timeout' },
    // 窗口外 failover 必须被排除
    { seq: 4, ts: iso(10 * DAY), type: 'runner.failover', task: 't-old', role: 'worker_code', from: 'codex', to: 'zhipu-glm' },
    // done-gate 打回 ×2:一条经 task→role 映射,一条经 queue.completed 的 queueAgent 归因
    { seq: 5, ts: iso(1 * DAY), type: 'done_gate.blocked', task: 't1', flow: 'agent-once', reason: 'no evidence' },
    { seq: 6, ts: iso(1 * DAY), type: 'queue.completed', task: 't2', queueAgent: 'worker_code', queueId: 'wc2', ok: true },
    { seq: 7, ts: iso(1 * DAY), type: 'task.needs_evidence', task: 't2' },
    // 无关事件不计数
    { seq: 8, ts: iso(1 * DAY), type: 'queue.enqueued', queueAgent: 'worker_code', queueId: 'wc9' },
  ];
  const eventsFile = path.join(root, 'engine-events.jsonl');
  fs.writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

  const routingFile = path.join(root, 'model-routing.yaml');
  fs.writeFileSync(routingFile, [
    'schema_version: 1',
    'roles:',
    '  worker_code:',
    '    tier: exec',
    '  it_engineer:',
    '    tier: cheap',
    '  governance:',
    '    tier: strong',
    '  quality_ops:',
    '    tier: standard',
    'failover:',
    '  predictive: true',
    '',
  ].join('\n'));
  return { eventsFile, routingFile };
}

function rowOf(report, role, runner) {
  return report.rows.find(r => r.role === role && r.runner === runner);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-report-test-'));
  try {
    const { eventsFile, routingFile } = buildFixture(root);
    const report = Report.aggregate({
      root,
      eventsFile,
      routingFile,
      nowMs: NOW,
      days: 7,
      date: '2026-07-03',
    });

    // worker_code|codex:3 任务(2 done + 1 failed,窗口外排除),成功率 2/3,平均重试 (0+1+2)/3=1
    const wc = rowOf(report, 'worker_code', 'codex');
    assert(wc, 'worker_code|codex 行必须存在');
    assert.strictEqual(wc.tasks, 3);
    assert.strictEqual(wc.done, 2);
    assert.strictEqual(wc.failed, 1);
    assert.strictEqual(Math.round(wc.successRate * 1000), 667);
    assert.strictEqual(wc.avgRetry, 1);
    assert.strictEqual(wc.failovers, 1, '窗口内 failover 只有 1 次(窗口外排除)');
    assert.strictEqual(wc.doneGateRejects, 2, 'done_gate.blocked + task.needs_evidence 各 1 次');
    assert.strictEqual(wc.status, '正常');

    // it_engineer:显式 runnerType 生效
    const it = rowOf(report, 'it_engineer', 'zhipu-glm');
    assert(it, 'it_engineer|zhipu-glm 行必须存在');
    assert.strictEqual(it.tasks, 1);
    assert.strictEqual(it.done, 1);
    assert.strictEqual(it.successRate, 1);
    assert.strictEqual(it.failovers, 0);
    assert.strictEqual(it.doneGateRejects, 0);

    // supervisor-控制台 → supervisor(兜底 runner codex)
    const sup = rowOf(report, 'supervisor', 'codex');
    assert(sup, 'supervisor 行必须存在(agent 名归一)');
    assert.strictEqual(sup.tasks, 1);

    // 闲置角色:governance / quality_ops 在路由表里但窗口内无数据
    assert(report.idleRoles.includes('governance'), 'governance 应标闲置');
    assert(report.idleRoles.includes('quality_ops'), 'quality_ops 应标闲置');
    assert(!report.idleRoles.includes('worker_code'), '有数据角色不得标闲置');

    // markdown:表格行 + 闲置标注
    const md = Report.renderMarkdown(report);
    assert.match(md, /\| worker_code \| codex \| 3 \| 2 \| 1 \| 66\.7% \| 1 \| 2 \| 1 \| 正常 \|/);
    assert.match(md, /\| governance \| - \| 0 \| 0 \| 0 \| - \| 0 \| 0 \| - \| 闲置 \|/);
    assert(md.includes('HR 绩效报告 · 2026-07-03(近 7 天)'));

    // 落盘文件名:board/hr-绩效报告-<date>.md
    const boardDir = path.join(root, 'board');
    const file = Report.writeReport(report, { boardDir });
    assert.strictEqual(path.basename(file), 'hr-绩效报告-2026-07-03.md');
    assert(fs.existsSync(file));
    assert.match(fs.readFileSync(file, 'utf8'), /role × runner 绩效/);

    // 空数据兜底:全新 root 不炸,产出空表 + 路由表角色全闲置
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'role-report-empty-'));
    try {
      const emptyReport = Report.aggregate({
        root: emptyRoot,
        eventsFile: path.join(emptyRoot, 'no-events.jsonl'),
        routingFile,
        nowMs: NOW,
        days: 7,
        date: '2026-07-03',
      });
      assert.strictEqual(emptyReport.rows.length, 0);
      assert.deepStrictEqual([...emptyReport.idleRoles].sort(), ['governance', 'it_engineer', 'quality_ops', 'worker_code']);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }

    console.log(JSON.stringify({ pass: true, suite: 'role-performance-report' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
