#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.YUTU6_KB_INJECT = '0';
process.env.YUTU6_LESSON_INJECT = '0';

const { buildEnvelope } = require('../shared/engine/cli-runner');

function baseContext(visualRequired) {
  return {
    taskId: 'prompt-budget-fixture',
    spec_fingerprint: 'fixture-fingerprint',
    projectId: '控制台',
    goal: '修复一个非视觉 Node.js 边界问题',
    acceptance: '修复根因并运行相关专项测试',
    bounds: '只处理本任务; 密钥不回显',
    inputs: [],
    visual_acceptance: {
      schema: 'visual-acceptance@1',
      required: visualRequired,
      state: visualRequired ? 'pending_visual_evidence' : 'not_applicable',
      source: 'task_type',
    },
  };
}

function main() {
  const nonVisual = baseContext(false);
  const implement = buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, nonVisual);
  const review = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, nonVisual);
  const chars = implement.length + review.length;

  assert(
    chars <= 6200,
    `non-visual implement+review prompt budget exceeded: ${chars} chars`,
  );
  assert(!/视觉\/UI 行必须填可核 peekaboo 图片/.test(implement));
  assert(!/glm-5\.2 不能作为最终视觉自验替代/.test(review));
  assert(!/loop engineering 已开启/.test(review));
  assert(!/node tests\/run\.js(?!\s+--profile)/.test(`${implement}\n${review}`));
  assert.match(implement, /--profile smoke/);

  const visual = buildEnvelope(
    { id: 'review', agent_role: 'supervisor' },
    baseContext(true),
  );
  assert.match(visual, /peekaboo 图片/);
  assert.match(visual, /glm-5\.2 不能作为最终视觉自验替代/);

  console.log(JSON.stringify({
    pass: true,
    suite: 'prompt-budget',
    nonVisualChars: chars,
    estimatedTokens: Math.round(chars / 4),
  }));
}

main();
