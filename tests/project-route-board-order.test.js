#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-route-board-order-'));
  const artifacts = path.join(root, 'artifacts');
  const projects = path.join(root, 'projects');
  const config = path.join(root, 'config.json');
  fs.mkdirSync(path.join(projects, '控制台'), { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ runners: {}, roleRouting: {} }));

  const oldEnv = {
    CONSOLE_CONFIG_PATH: process.env.CONSOLE_CONFIG_PATH,
    CONSOLE_ARTIFACTS_DIR: process.env.CONSOLE_ARTIFACTS_DIR,
    CONSOLE_PROJECTS_DIR: process.env.CONSOLE_PROJECTS_DIR,
    CONSOLE_MEMORY_DECISIONS: process.env.CONSOLE_MEMORY_DECISIONS,
    YUTU6_CEO_ELASTIC: process.env.YUTU6_CEO_ELASTIC,
  };
  process.env.CONSOLE_CONFIG_PATH = config;
  process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
  process.env.CONSOLE_PROJECTS_DIR = projects;
  process.env.CONSOLE_MEMORY_DECISIONS = path.join(root, 'memory', 'decisions.md');
  process.env.YUTU6_CEO_ELASTIC = '0';

  const EngineRunner = require('../projects/控制台/engine-runner');
  const BoardReview = require('../projects/控制台/board-review');
  const oldShouldRun = BoardReview.shouldRunBoardReview;
  const oldRun = BoardReview.runBoardReview;
  const events = [];
  let boardFinished = false;
  let boardInput = null;
  try {
    BoardReview.shouldRunBoardReview = () => ({ important: true, reason: 'test', matches: ['engine'], labels: ['引擎'] });
    BoardReview.runBoardReview = async opts => {
      boardInput = { projectId: opts.projectId, planText: opts.planText };
      opts.eventlog.emit('node.start', { task: opts.taskId, node: 'board-test', role: 'board_deepseek', projectId: opts.projectId });
      opts.eventlog.emit('node.end', { task: opts.taskId, node: 'board-test', role: 'board_deepseek', projectId: opts.projectId });
      boardFinished = true;
      return { ok: true, approved: true, revisedGoal: `${opts.spec.goal}\n董事会修订`, rounds: [{}], maxRounds: 1 };
    };
    const result = await EngineRunner._test.runProjectRoute({
      spec: {
        taskId: 'order-test',
        projectId: '控制台',
        role: 'orchestrator',
        flowId: 'project-route',
        goal: '秘书补全后的任务',
        originalGoal: '老板原始目标',
        useOrchestrator: true,
      },
      taskId: 'order-test',
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
      cliRunner(node, ctx) {
        assert.strictEqual(boardFinished, true, 'CEO 不得在董事会结束前开始拆解');
        assert(ctx.goal.includes('董事会修订'), 'CEO 必须收到董事会修订后的目标');
        return { vars: { orchestrator: { projectId: '控制台', summary: '范围摘要', acceptance: [{ text: '保持董事会修订后的验收原子', scope: 'project/控制台' }] } } };
      },
      ctx: { goal: '秘书补全后的任务', projectId: '控制台' },
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(boardInput, { projectId: '控制台', planText: '老板原始目标' });
    const boardStart = events.findIndex(ev => ev.type === 'node.start' && ev.node === 'board-test');
    const ceoStart = events.findIndex(ev => ev.type === 'node.start' && ev.node === 'orchestrator-plan');
    assert(boardStart >= 0 && ceoStart > boardStart, '真实事件顺序必须是董事会 -> CEO');
    assert(events.some(ev => ev.type === 'project.routed'), '放行后必须继续路由给主管');
    console.log(JSON.stringify({ pass: true, suite: 'project-route-board-order' }));
  } finally {
    BoardReview.shouldRunBoardReview = oldShouldRun;
    BoardReview.runBoardReview = oldRun;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
