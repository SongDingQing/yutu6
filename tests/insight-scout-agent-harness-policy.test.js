#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const InsightScoutRepos = require('../projects/控制台/insight-scout-repos');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function main() {
  const skill = read('.agents/skills/agent-harness-research/SKILL.md');
  const scoutPrompt = read('shared/agents/insight-scout/prompt.md');
  const qualityPrompt = read('shared/agents/quality-ops/prompt.md');
  const governancePrompt = read('shared/agents/governance/prompt.md');
  const agent = JSON.parse(read('shared/agents/insight-scout/agent.json'));
  const report = read('board/insights/agent-harness-deep-research-20260714.md');

  assert.match(skill, /### Light scan/);
  assert.match(skill, /### Deep research/);
  assert.match(skill, /15-50 evidence-backed candidates/);
  assert.match(skill, /openai\/codex/);
  assert.match(skill, /earendil-works\/pi/);
  assert.match(skill, /SWE-agent\/mini-swe-agent/);
  assert.match(skill, /do not enable a card automatically/i);
  assert.match(skill, /quality-ops/);
  assert.match(skill, /governance/);
  assert.match(skill, /## Trigger Boundary/);
  assert.match(skill, /## Ownership And Lifecycle/);

  for (const template of [
    'research-brief.md',
    'source-manifest.md',
    'open-source-teardown.md',
    'source-audit.md',
    'recommendation-ledger.md',
    'hook-skill-quality-review.md',
    'eval-canary.md',
  ]) {
    assert(fs.existsSync(path.join(root, '.agents/skills/agent-harness-research/templates', template)), `missing template ${template}`);
  }

  assert.match(scoutPrompt, /日常轻扫/);
  assert.match(scoutPrompt, /主人点名深研/);
  assert.match(scoutPrompt, /earendil-works\/pi/);
  assert.match(scoutPrompt, /insight-workload-audit\.js/);
  assert.match(qualityPrompt, /不得为凑满 50 条/);
  assert.match(qualityPrompt, /insight-workload\/latest/);
  assert.match(governancePrompt, /主人拍板/);
  assert.match(governancePrompt, /insight-workload\/latest/);
  assert(agent.read_paths.includes('.agents/skills/agent-harness-research/SKILL.md'));
  assert(agent.triggers.some(item => /Agent harness/.test(item)));

  assert(InsightScoutRepos.TOPICS.some(topic => topic.id === 'agent-harness'));
  const job = InsightScoutRepos.makeTask({
    key: '20260714-12',
    startAt: '2026-07-14T12:00:00+08:00',
  }, {
    topic: { id: 'agent-harness', label: 'Agent harness 深研' },
  });
  assert.match(job.task.goal, /agent harness 轻扫/);
  assert.match(job.task.goal, /2-3 个案例上限/);
  assert.match(job.task.goal, /主人点名“深研\/全面”/);
  assert(job.task.inputs.includes('.agents/skills/agent-harness-research/SKILL.md'));

  const rows = Array.from(report.matchAll(/^\| (AHR-\d{2}) \|/gm), match => match[1]);
  assert.strictEqual(rows.length, 50, 'deep research report must contain exactly 50 recommendation rows');
  assert.strictEqual(new Set(rows).size, 50, 'recommendation IDs must be unique');
  for (let number = 1; number <= 50; number++) {
    assert(rows.includes(`AHR-${String(number).padStart(2, '0')}`), `missing recommendation AHR-${number}`);
  }
  assert.match(report, /尚未运行独立 `quality-ops` agent/);
  assert.match(report, /尚未运行独立 `governance` agent/);
  assert.match(report, /运行时改动全部进入公告板 `todo`/);

  const validator = childProcess.spawnSync(process.execPath, [
    path.join(root, '.agents/skills/agent-harness-research/scripts/validate-report.js'),
    path.join(root, 'board/insights/agent-harness-deep-research-20260714.md'),
  ], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(validator.status, 0, validator.stderr || validator.stdout);
  const validation = JSON.parse(validator.stdout);
  assert.strictEqual(validation.recommendations, 50);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ahr-policy-'));
  try {
    const fifteen = report
      .replace('## 50 条候选账本', '## 候选账本')
      .split(/\r?\n/)
      .filter(line => {
        const match = /^\| AHR-(\d{2}) \|/.exec(line);
        return !match || Number(match[1]) <= 15;
      })
      .join('\n');
    const fifteenFile = path.join(temp, 'fifteen.md');
    fs.writeFileSync(fifteenFile, fifteen);
    const fifteenValidator = childProcess.spawnSync(process.execPath, [
      path.join(root, '.agents/skills/agent-harness-research/scripts/validate-report.js'),
      fifteenFile,
    ], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(fifteenValidator.status, 0, fifteenValidator.stderr || fifteenValidator.stdout);
    assert.strictEqual(JSON.parse(fifteenValidator.stdout).recommendations, 15);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const safeActions = read('board/insights/agent-harness-safe-actions-20260714.md');
  assert.match(safeActions, /未连接生产 hook/);
  assert.match(safeActions, /未启用任何卡/);

  console.log(JSON.stringify({ pass: true, suite: 'insight-scout-agent-harness-policy', recommendations: rows.length }));
}

main();
