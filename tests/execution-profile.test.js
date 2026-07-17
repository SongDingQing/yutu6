#!/usr/bin/env node
'use strict';

const assert = require('assert');

const Profile = require('../shared/engine/execution-profile');
const LoopEngineering = require('../shared/engine/loop-engineering');
const EngineRunner = require('../projects/控制台/engine-runner');
const CeoWorker = require('../projects/控制台/ceo-worker');

function main() {
  assert.deepStrictEqual(
    Profile.loopEngineeringDecision({ goal: '修改一个配置值并跑专项测试' }, {}),
    { enabled: false, reason: 'routine_single_pass' },
  );
  assert.strictEqual(
    Profile.loopEngineeringDecision({ goal: '对多智能体架构进行三轮挑刺优化' }, {}).enabled,
    true,
  );
  assert.strictEqual(
    Profile.loopEngineeringDecision({ goal: '修复页面布局与交互' }, {}).enabled,
    true,
  );
  assert.deepStrictEqual(
    Profile.loopEngineeringDecision({ loopEngineering: true, goal: '普通任务' }, {}),
    { enabled: true, reason: 'explicit_on' },
  );
  assert.deepStrictEqual(
    Profile.loopEngineeringDecision({ loopEngineering: false, goal: '架构优化' }, {}),
    { enabled: false, reason: 'explicit_off' },
  );
  assert.deepStrictEqual(
    Profile.loopEngineeringDecision({ nodeRetry: 1, goal: '对多智能体架构进行三轮挑刺优化' }, {}),
    { enabled: false, reason: 'retry_single_pass' },
  );
  assert.deepStrictEqual(
    Profile.loopEngineeringDecision({ nodeRetry: 2, loopEngineering: true, goal: '架构优化' }, {}),
    { enabled: true, reason: 'explicit_on' },
  );
  assert.match(
    Profile.loopEngineeringDecision({ autoSource: 'scheduled', goal: '架构优化' }, {}).reason,
    /automatic_lightweight/,
  );
  assert.strictEqual(
    EngineRunner._test.loopEngineeringEnabledForSpec({ goal: '修改一个配置值并跑专项测试' }),
    false,
  );
  assert.strictEqual(
    EngineRunner._test.loopEngineeringEnabledForSpec({ goal: '对多智能体架构进行三轮挑刺优化' }),
    true,
  );
  const retrySpec = CeoWorker._test.makeSpec({
    id: 'execution-profile-retry-fixture',
    nodeRetry: 2,
    engineRetry: 2,
    retry_reason: 'node_failed',
    task: {
      projectId: '控制台',
      projectMode: false,
      goal: '对多智能体架构进行三轮挑刺优化',
      acceptance: '专项测试通过',
    },
  });
  assert.strictEqual(retrySpec.nodeRetry, 2);
  assert.strictEqual(retrySpec.engineRetry, 2);
  assert.strictEqual(retrySpec.retryReason, 'node_failed');
  assert.strictEqual(EngineRunner._test.loopEngineeringEnabledForSpec(retrySpec), false);
  const hydrated = EngineRunner._test.hydrateRetryMetadata(
    { queueAgent: 'supervisor-控制台', queueId: 'fixture' },
    { nodeRetry: 2, engineRetry: 2, retry_reason: 'node_failed' },
  );
  assert.strictEqual(hydrated.nodeRetry, 2);
  assert.strictEqual(hydrated.engineRetry, 2);
  assert.strictEqual(hydrated.retryReason, 'node_failed');

  const acceptance = [
    '结构化验收表',
    '验收表协议: structured-acceptance@2',
    '模板: templates/structured-acceptance-table.md',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置 | 备注 |',
    '|---|---|---|---|',
    '| 任务验收: 修复根因 | 未完成 | | |',
    '| 任务验收: 跑专项测试 | 未完成 | | |',
    '| 视觉/UI证据: not_applicable | not_applicable | task-envelope:visual_acceptance | |',
  ].join('\n');
  const standards = LoopEngineering.deriveStandards({ acceptance });
  assert.deepStrictEqual(standards.map(item => item.text), [
    '修复根因',
    '跑专项测试',
    '视觉/UI证据: not_applicable',
  ]);
  assert(!standards.some(item => /---|模板:|完成状态/.test(item.text)));

  console.log(JSON.stringify({ pass: true, suite: 'execution-profile' }));
}

main();
