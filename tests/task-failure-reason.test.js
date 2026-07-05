#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../shared/engine/eventlog');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-task-failure-reason-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const projectsDir = path.join(root, 'projects');
  const configPath = path.join(root, 'config.json');

  try {
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    writeJson(configPath, { runners: {}, roleRouting: {} });
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_PROJECTS_DIR = projectsDir;
    process.env.CONSOLE_CONFIG_PATH = configPath;

    const { _test } = require('../projects/控制台/ceo-worker');
    const Server = require('../projects/控制台/server');
    const log = new EventLog(path.join(artifactsDir, 'engine-events.jsonl'));

    log.emit('node.fail', {
      task: 'routed-after-board-node-fail',
      node: 'board-board_glm52-r1',
      role: 'board_glm52',
      reason: 'zhipu-glm 退出码 1: No available channel for model glm-5.2 under group default',
    });
    log.emit('project.route.waiting', {
      task: 'routed-after-board-node-fail',
      projectId: '控制台',
      queueAgent: 'supervisor-控制台',
      queueId: 'child',
    });
    log.emit('engine.worker.end', {
      task: 'routed-after-board-node-fail',
      flow: 'project-route',
      ok: true,
      waitingDownstream: true,
      state: 'waiting_downstream',
    });

    assert.strictEqual(
      _test.latestTaskFailureReason('routed-after-board-node-fail'),
      '',
      'successful project-route handoff must mask earlier director node failures',
    );
    const boardIndex = Server._test.buildTaskBoardIndex(
      fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    );
    const boardNode = Server._test.nodeStateForTask(boardIndex, 'routed-after-board-node-fail', 'board-board_glm52-r1');
    assert.strictEqual(boardNode.status, 'absent', 'board runner node.fail must render as absent, not failed');
    assert.match(Server._test.taskBoardStatusLabel('absent'), /缺席/);
    const boardProgress = Server._test.taskBoardProgressForEvent({
      type: 'node.fail',
      task: 'routed-after-board-node-fail',
      node: 'board-board_glm52-r1',
      role: 'board_glm52',
      reason: 'zhipu-glm 退出码 1: 访问量过大',
    }, '');
    assert.strictEqual(boardProgress.state, 'absent', 'board runner failure progress must be absent');

    log.emit('node.fail', {
      task: 'real-node-fail',
      node: 'implement',
      reason: 'real node failed',
    });
    assert.match(
      _test.latestTaskFailureReason('real-node-fail'),
      /real node failed/,
      'real latest node failure must still be reported',
    );

    log.emit('node.fail', {
      task: 'terminal-fail',
      node: 'implement',
      reason: 'early node failed',
    });
    log.emit('engine.worker.end', {
      task: 'terminal-fail',
      flow: 'agent-once',
      ok: false,
      reason: 'engine final failed',
    });
    assert.match(
      _test.latestTaskFailureReason('terminal-fail'),
      /engine final failed/,
      'terminal engine failure reason must win over earlier node failure',
    );

    // P1-C:running 文件竞态/引擎正常收尾导致的 running 缺失,应判为 infra noise(只重入队、不开重复维修工单);真失败不受影响
    assert.strictEqual(
      _test.isInfraRestartNoise('queue-running-missing', 'running 队列文件已不存在,终止对应 engine 并释放 slot'),
      true,
      'queue-running-missing 竞态应判为 infra noise(治 50b65386 工单堆积)',
    );
    assert.strictEqual(
      _test.isInfraRestartNoise('node-fail', 'real implement failure'),
      false,
      '真实任务失败不应被误判为 infra noise',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ pass: true, suite: 'task-failure-reason' }));
}

main();
