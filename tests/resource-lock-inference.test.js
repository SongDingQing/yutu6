#!/usr/bin/env node
'use strict';

const assert = require('assert');
const ResourceLocks = require('../projects/控制台/resource-locks');

const backgroundHeavy = ResourceLocks.normalizeResourceRequest({
  role: 'supervisor',
  flowId: 'review-loop',
  inputs: ['projects/控制台/brief.md'],
  goal: [
    '项目主管执行 CEO brief。',
    '[秘书后台背景包]',
    '历史上曾修改 config/engine/agents/queue-state/brief-status 并跑 tests。',
    '目标:修改 projects/控制台/public/workspace.html 的任务卡片布局。',
  ].join('\n'),
});
assert.deepStrictEqual(backgroundHeavy.write, ['frontend-public'], '秘书背景引用不得膨胀成多域写锁');
assert(backgroundHeavy.read.includes('brief-status'), 'brief 输入仍是读依赖');

const taskScopedBrief = ResourceLocks.normalizeResourceRequest({
  role: 'supervisor',
  flowId: 'review-loop',
  inputs: ['projects/控制台/artifacts/task-briefs/cr-example.md'],
  goal: '项目主管执行当前任务 brief，只读核实方案。',
});
assert(!taskScopedBrief.read.includes('brief-status'), '任务级 brief 不应长期占用全局 brief-status 读锁');
assert(taskScopedBrief.read.includes('console-project'), '任务级 brief 仍应保留项目范围读依赖');

const projectRoute = ResourceLocks.normalizeResourceRequest({
  role: 'orchestrator',
  flowId: 'project-route',
  goal: '用单一可信脚本替代每任务自制 fixture，并交给项目主管复核。',
});
assert(projectRoute.write.includes('brief-status'), 'project-route 仍需保护实际追加的项目 brief');
assert(!projectRoute.write.includes('queue-state'), '普通 project-route 不得因控制面运行记录而长期占用 queue-state');

const queueMaintenanceRoute = ResourceLocks.normalizeResourceRequest({
  role: 'orchestrator',
  flowId: 'project-route',
  goal: '清理队列状态文件并重排积压队列。',
});
assert(queueMaintenanceRoute.write.includes('queue-state'), '真实队列维护目标仍必须取得 queue-state 写锁');

const memoryOfficer = ResourceLocks.normalizeResourceRequest({
  role: 'memory_officer',
  goal: [
    '[秘书后台背景包]',
    '背景提到修复 engine-runner.js、config.json、shared/agents 和队列状态。',
    '目标:把本次教训沉淀到 memory/repair-cases.md。',
  ].join('\n'),
});
assert.deepStrictEqual(memoryOfficer.write, ['memory'], '记忆官只应锁住自己的主责写域');
assert(!memoryOfficer.write.includes('engine'));
assert(!memoryOfficer.write.includes('config'));
assert(!memoryOfficer.write.includes('agents'));
assert(!memoryOfficer.write.includes('queue-state'));

const mixedLegacyEnvelope = ResourceLocks.normalizeResourceRequest({
  role: 'supervisor',
  flowId: 'review-loop',
  goal: [
    '项目主管(控制台)执行 CEO brief。原始目标:',
    '秘书补全稿: 目标:刚输入任务就显示 CEO、主管、后端程序员全部完成，修复一下 项目:控制台',
    '图片附件(本地路径): projects/控制台/artifacts/task-attachments/example.png',
    '验收:更新 board/status-rollup.md。 目标:Simulaid 其他游戏问题。',
  ].join(' '),
});
assert.deepStrictEqual(mixedLegacyEnvelope.write, ['frontend-public'], '混入第二目标/附件/公告板背景时必须只锁第一个原始目标主域');

const capped = ResourceLocks.normalizeResourceRequest({
  role: 'worker_code',
  goal: [
    '修改 projects/控制台/public/workspace.html。',
    '修改 projects/控制台/engine-runner.js。',
    '修改 projects/控制台/config.json。',
    '新增 tests/example.test.js 回归测试。',
  ].join('\n'),
});
assert.strictEqual(capped.source, 'inferred-capped');
assert.strictEqual(capped.write.length, 2, '未声明的文本启发式任务最多占两个写域');
assert(capped.read.includes('config') && capped.read.includes('tests'), '被截下的次要域应降为读依赖');

const evidenceBacked = ResourceLocks.normalizeResourceRequest({
  role: 'worker_code',
  changed_files: [
    'projects/控制台/public/workspace.html',
    'projects/控制台/engine-runner.js',
    'projects/控制台/config.json',
    'tests/example.test.js',
  ],
});
assert.deepStrictEqual(evidenceBacked.write, ['frontend-public', 'engine', 'config', 'tests'], 'changed_files 硬证据不得被推断上限截断');

const readOnly = ResourceLocks.normalizeResourceRequest({
  role: 'quality_ops',
  goal: '只读核实 projects/控制台/engine-runner.js 和 projects/控制台/config.json,不修改任何文件。',
});
assert(!readOnly.write.includes('engine') && !readOnly.write.includes('config'), '只读审核不得拿写锁');
assert(readOnly.read.includes('engine') && readOnly.read.includes('config'));

assert.strictEqual(
  ResourceLocks.domainForPath('/Users/yutu6/玉兔6工作区/projects/控制台/server.js'),
  'console-backend',
  '绝对路径必须命中精细域',
);

console.log(JSON.stringify({ pass: true, suite: 'resource-lock-inference' }));
