#!/usr/bin/env node
'use strict';

const path = require('path');
const DoneGate = require('../../../../shared/engine/done-gate');

const workspaceRoot = path.resolve(__dirname, '../../../..');
const acceptance = [
  '结构化验收表(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)',
  '模板: templates/structured-acceptance-table.md',
  '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
  '|---|---|---|---|',
  '| 任务验收: 在 控制台 项目 scope 内跑 review-loop; 完成前更新 projects/控制台/status.md。 | 未完成 |  |  |',
  '| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 未完成 |  |  |',
].join('\n');

function runVisualRow(evidence, notes) {
  return DoneGate.validateStructuredAcceptanceTable({
    goal: 'AHR-26..30 纯引擎、hook、兼容设计与自动化测试任务',
    bounds: '不改 UI；不以无关截图充当证据。',
    acceptance,
    implementation: {
      done: true,
      acceptance_table: [
        {
          point: '任务验收: 在 控制台 项目 scope 内跑 review-loop; 完成前更新 projects/控制台/status.md。',
          status: '完成',
          evidence: 'projects/控制台/artifacts/engine-tasks/cr-1784018284182-397d53ad.json:1; projects/控制台/status.md:1',
          notes: '当前真实任务为控制台 review-loop，status 已更新。',
        },
        {
          point: '视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告',
          status: '完成',
          evidence,
          notes,
        },
      ],
    },
  }, { workspaceRoot, requireReview: false });
}

const naMarker = runVisualRow(
  'NA: projects/控制台/brief.md:15631; projects/控制台/brief.md:15643',
  '本任务无 UI 或视觉验收面。',
);
const rationaleOnly = runVisualRow(
  'projects/控制台/brief.md:15631; projects/控制台/brief.md:15643',
  '不适用：本任务无 UI 或视觉验收面，不要求 Peekaboo。',
);

if (naMarker.ok || rationaleOnly.ok) {
  throw new Error('expected current DoneGate to expose the documented non-UI acceptance conflict');
}

process.stdout.write(`${JSON.stringify({
  schema: 'yutu6-done-gate-na-probe@1',
  taskId: 'cr-1784018284182-397d53ad',
  naMarker,
  rationaleOnly,
  contractSatisfied: false,
  conclusion: 'The current global DoneGate cannot accept the brief-required non-UI NA row without a real Peekaboo image.',
})}\n`);
