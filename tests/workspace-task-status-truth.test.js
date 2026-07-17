#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Server = require('../projects/控制台/server');

function workspaceNodeChainContext() {
  const file = path.resolve(__dirname, '../projects/控制台/public/workspace.html');
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('function taskBoardNormalizeNodeChain');
  const end = html.indexOf('function taskBoardCeoActions', start);
  assert(start > 0 && end > start, 'workspace task-board node-chain block must exist');
  const ctx = {
    esc: value => String(value == null ? '' : value).replace(/[&<>\"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }[char])),
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
}

function gateEvents(complete = false) {
  const events = [
    { seq: 1, type: 'task.queued', task: 'root-gate', queueAgent: 'ceo', queueId: 'rootq', flow: 'project-route', goal: '重要架构任务' },
    { seq: 2, type: 'board.review.round.start', task: 'root-gate', round: 1, maxRounds: 1 },
    { seq: 3, type: 'node.start', task: 'root-gate', node: 'board-board_claude-r1', role: 'board_claude' },
    // Same node name in another task must never affect this root task's chain.
    { seq: 4, type: 'node.end', task: 'foreign-task', node: 'board-board_claude-r1', role: 'board_claude' },
    { seq: 5, type: 'node.end', task: 'root-gate', node: 'board-board_claude-r1', role: 'board_claude' },
    { seq: 6, type: 'node.start', task: 'root-gate', node: 'orchestrator-plan', role: 'orchestrator' },
    { seq: 7, type: 'node.end', task: 'root-gate', node: 'orchestrator-plan', role: 'orchestrator' },
    { seq: 8, type: 'project.routed', task: 'root-gate', rootTaskId: 'root-gate', rootQueueAgent: 'ceo', rootQueueId: 'rootq', supervisorQueue: 'supervisor-控制台', queueId: 'childq' },
    { seq: 9, type: 'task.queued', task: 'child-gate', queueAgent: 'supervisor-控制台', queueId: 'childq', rootTaskId: 'root-gate', rootQueueAgent: 'ceo', rootQueueId: 'rootq', flow: 'review-loop', goal: '实现任务' },
    { seq: 10, type: 'task.created', task: 'child-gate', flow: 'review-loop', start: 'implement' },
  ];
  if (!complete) return events;
  return events.concat([
    { seq: 11, type: 'node.start', task: 'child-gate', node: 'implement', role: 'worker_code' },
    { seq: 12, type: 'node.end', task: 'child-gate', node: 'implement', role: 'worker_code' },
    { seq: 13, type: 'node.start', task: 'child-gate', node: 'review', role: 'supervisor' },
    { seq: 14, type: 'node.end', task: 'child-gate', node: 'review', role: 'supervisor', decision: 'approved' },
    { seq: 15, type: 'task.done', task: 'child-gate' },
  ]);
}

function buildGateNodes(complete = false) {
  const index = Server._test.buildTaskBoardIndex(gateEvents(complete));
  const root = { taskId: 'root-gate', queueAgent: 'ceo', queueId: 'rootq' };
  const action = { agent: 'supervisor-控制台', id: 'childq', taskId: 'child-gate' };
  return Server._test.buildCeoNodeChain(root, 'running', index, action);
}

function main() {
  const nodes = buildGateNodes(false);
  const byId = id => nodes.find(node => node.id === id);
  const boardIndex = nodes.findIndex(node => node.node === 'board-board_claude-r1');
  const ceoIndex = nodes.findIndex(node => node.id === 'ceo-plan');
  const supervisorIndex = nodes.findIndex(node => node.id === 'supervisor-route');

  assert.strictEqual(byId('ceo-plan').status, 'done', 'explicit CEO node.end must remain done');
  assert(boardIndex === 0 && boardIndex < ceoIndex && ceoIndex < supervisorIndex, 'board gate must render before CEO and all execution nodes');
  assert.strictEqual(nodes.filter(node => node.node === 'board-board_claude-r1').length, 1, 'foreign task events must not duplicate or complete the board node');
  assert.strictEqual(nodes[boardIndex].status, 'done', 'same-task board node.end must complete the pre-CEO gate');
  assert.notStrictEqual(byId('supervisor-route').status, 'done', 'task.created alone must not complete the supervisor stage');
  assert.strictEqual(byId('supervisor-route').statusText, '⏳已接单', 'created child task must expose a truthful intermediate supervisor state');
  assert.strictEqual(byId('implement').status, 'pending', 'implement must stay pending without implement node.start/node.end');
  assert.strictEqual(byId('review').status, 'pending', 'review must stay pending without review node.start/node.end');

  const workspace = workspaceNodeChainContext();
  const normalized = workspace.taskBoardNormalizeNodeChain(nodes);
  assert.strictEqual(normalized.find(node => node.id === 'implement').status, 'pending', 'UI normalization must not infer implement completion from a later board node');
  assert.strictEqual(normalized.find(node => node.id === 'review').status, 'pending', 'UI normalization must not infer review completion from a later board node');
  const html = workspace.taskBoardNodeChain(nodes);
  assert(!html.includes('<b>主管</b><em>✅完成</em>'), 'board-running card must not render supervisor as completed');
  assert(!html.includes('<b>后端程序员</b><em>✅完成</em>'), 'board-running card must not render implement as completed');
  assert(!html.includes('<b>复审</b><em>✅完成</em>'), 'board-running card must not render review as completed');

  const boardRunningIndex = Server._test.buildTaskBoardIndex([
    { seq: 1, type: 'task.queued', task: 'root-board-running', queueAgent: 'ceo', queueId: 'root-board-running-q', flow: 'project-route', goal: '重要架构任务' },
    { seq: 2, type: 'node.start', task: 'root-board-running', node: 'board-board_glm52-r1', role: 'board_glm52' },
  ]);
  const boardRunningNodes = Server._test.buildCeoNodeChain(
    { taskId: 'root-board-running', queueAgent: 'ceo', queueId: 'root-board-running-q' },
    'running',
    boardRunningIndex,
    null,
  );
  assert.strictEqual(boardRunningNodes[0].status, 'running', '董事会实际运行时必须显示运行中');
  assert.strictEqual(boardRunningNodes.find(node => node.id === 'ceo-plan').status, 'pending', '董事会未结束时 CEO 必须保持待开始');

  const retryIndex = Server._test.buildTaskBoardIndex(gateEvents(true).concat([
    { seq: 16, type: 'task.queued', task: 'child-retry', queueAgent: 'supervisor-控制台', queueId: 'childq-retry', rootTaskId: 'root-gate', rootQueueAgent: 'ceo', rootQueueId: 'rootq', flow: 'review-loop', goal: '重试实现任务' },
    { seq: 17, type: 'task.created', task: 'child-retry', flow: 'review-loop', start: 'implement' },
    { seq: 18, type: 'node.start', task: 'child-retry', node: 'implement', role: 'worker_code' },
  ]));
  const retryNodes = Server._test.buildCeoNodeChain(
    { taskId: 'root-gate', queueAgent: 'ceo', queueId: 'rootq' },
    'running',
    retryIndex,
    { agent: 'supervisor-控制台', id: 'childq-retry', taskId: 'child-retry' },
  );
  const retryById = id => retryNodes.find(node => node.id === id);
  assert.strictEqual(retryById('supervisor-route').taskId, 'child-retry', 'active retry taskId must own the supervisor stage');
  assert.strictEqual(retryById('supervisor-route').status, 'waiting', 'a completed prior child must not complete the active retry supervisor stage');
  assert.strictEqual(retryById('implement').taskId, 'child-retry', 'active retry taskId must own implementation status');
  assert.strictEqual(retryById('implement').status, 'running', 'active retry implementation must not inherit prior child completion');
  assert.strictEqual(retryById('review').status, 'waiting', 'active retry review must wait for its own implementation end');
  assert(!retryNodes.some(node => node.taskId === 'child-gate' && /^board-/.test(node.node || '')), 'prior child board nodes must not leak into the active retry chain');

  const completed = buildGateNodes(true);
  assert.strictEqual(completed.find(node => node.id === 'supervisor-route').status, 'done', 'explicit review/task completion must complete supervisor stage');
  assert.strictEqual(completed.find(node => node.id === 'implement').status, 'done', 'implement node.end must complete implementation');
  assert.strictEqual(completed.find(node => node.id === 'review').status, 'done', 'review node.end must complete review');

  console.log('workspace task status truth tests: ok');
}

main();
