#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Audit = require('../projects/控制台/tools/insight-workload-audit');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function reportFixture() {
  const rows = [];
  for (let n = 1; n <= 15; n++) rows.push(`| AHR-${String(n).padStart(2, '0')} | 建议 ${n} | 证据 | 收益 | 回退 | recommend |`);
  return [
    '# fixture',
    '## 来源清单',
    ...Array.from({ length: 8 }, (_, i) => `- https://example.com/${i}`),
    '## 候选账本',
    '| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-workload-audit-'));
  try {
    const report = path.join(root, 'report.md');
    const cardsFile = path.join(root, 'cards.json');
    const queueRoot = path.join(root, 'queues');
    const outDir = path.join(root, 'out');
    fs.writeFileSync(report, reportFixture());
    writeJson(cardsFile, [
      {
        id: 'pkg-a',
        title: 'AHR-01..05',
        desc: '第一包',
        target: 'ceo',
        project: '控制台',
        status: 'enabled',
        queueId: 'qa',
        payload: { projectId: '控制台', goal: '处理 AHR-01..05' },
      },
      {
        id: 'pkg-b',
        title: 'AHR-06..10',
        desc: '第二包',
        target: 'ceo',
        project: '控制台',
        status: 'enabled',
        queueId: 'qb',
        payload: { projectId: '控制台', goal: '处理 AHR-06..10' },
      },
      {
        id: 'pkg-b-copy',
        title: 'AHR-06..10',
        desc: '第二包',
        target: 'ceo',
        project: '控制台',
        status: 'todo',
        queueId: null,
        payload: { projectId: '控制台', goal: '处理 AHR-06..10' },
      },
    ]);
    writeJson(path.join(queueRoot, 'ceo', 'done', 'qa.json'), {
      id: 'qa',
      started_at: '2026-07-16T00:00:00.000Z',
      finished_at: '2026-07-16T00:10:00.000Z',
    });
    writeJson(path.join(queueRoot, 'ceo', 'failed', 'qb.json'), {
      id: 'qb',
      started_at: '2026-07-16T00:10:00.000Z',
      finished_at: '2026-07-16T00:20:00.000Z',
      error: 'fixture failure',
    });

    const result = Audit.run({ report, cards: cardsFile, queueRoot, outDir });
    assert.strictEqual(result.audit.recommendations.count, 15);
    assert.strictEqual(result.audit.recommendations.sources, 8);
    assert.strictEqual(result.audit.packageCount, 3);
    assert.strictEqual(result.audit.totalDurationMs, 20 * 60 * 1000);
    assert.deepStrictEqual(result.audit.recommendations.missing, [
      'AHR-11', 'AHR-12', 'AHR-13', 'AHR-14', 'AHR-15',
    ]);
    assert(result.audit.recommendations.multiplyCovered.some(item => item.id === 'AHR-06'));
    assert.strictEqual(result.audit.duplicateCards.length, 1);
    assert(fs.existsSync(result.jsonFile));
    assert(fs.existsSync(result.markdownFile));
    assert.match(fs.readFileSync(result.markdownFile, 'utf8'), /20m 0s/);
    console.log(JSON.stringify({ pass: true, suite: 'insight-workload-audit' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
