#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Triage = require('../projects/控制台/tools/quality-proposal-triage');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-proposal-triage-'));
  const cardsFile = path.join(root, 'cards.json');
  const reportRoot = path.join(root, 'reports');
  const eventsFile = path.join(root, 'events.jsonl');
  const cards = [
    {
      id: 'qops-security',
      title: '模型发布与外部推送必须等待 supervisor pass',
      source: '质量运营',
      status: 'todo',
      payload: { goal: 'preserved' },
    },
    {
      id: 'qops-test',
      title: '建立属性反例测试',
      source: '质量运营',
      status: '待拍板',
    },
    {
      id: 'qops-hook',
      title: '增加新的终态 hook',
      source: '质量运营',
      status: 'todo',
    },
    {
      id: 'owner-card',
      title: '主人自己的卡',
      source: '主人',
      status: 'todo',
    },
  ];
  writeJson(cardsFile, cards);

  const plan = Triage.buildPlan(cards, { now: new Date('2026-07-20T00:00:00.000Z') });
  assert.strictEqual(plan.total, 3);
  assert.strictEqual(plan.counts.foundational_policy, 1);
  assert.strictEqual(plan.counts.offline_candidate, 1);
  assert.strictEqual(plan.counts.dormant_candidate, 1);

  const result = Triage.applyPlan(cards, plan, { cardsFile, reportRoot, eventsFile });
  assert.strictEqual(result.archived, 3);
  assert(fs.existsSync(result.backup));
  assert(fs.existsSync(result.reportJson));
  assert(fs.existsSync(result.reportMd));

  const updated = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
  assert.strictEqual(updated.find(card => card.id === 'owner-card').status, 'todo');
  for (const id of ['qops-security', 'qops-test', 'qops-hook']) {
    const card = updated.find(item => item.id === id);
    assert.strictEqual(card.status, 'archived');
    assert.strictEqual(card.payload && card.payload.goal, id === 'qops-security' ? 'preserved' : undefined);
    assert.strictEqual(card.governanceDecision.schema, 'yutu6-quality-proposal-decision@1');
  }
  assert.strictEqual(JSON.parse(fs.readFileSync(result.backup, 'utf8')).length, 4);
  const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'quality_proposal.triaged');

  console.log(JSON.stringify({ pass: true, suite: 'quality-proposal-triage' }));
}

main();
