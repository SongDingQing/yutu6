#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKDIR = path.resolve(__dirname, '../../..');
const Q = require(path.join(WORKDIR, 'shared/engine/queue'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-mechanisms-smoke-'));
  const artifactsDir = path.join(root, 'artifacts');
  const eventsFile = path.join(artifactsDir, 'engine-events.jsonl');
  const configPath = path.join(root, 'config.json');

  try {
    fs.mkdirSync(path.join(root, 'projects', '控制台'), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ port: 49129, workdir: root, runners: {}, roleRouting: {} }, null, 2));
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_EVENTS_FILE = eventsFile;
    process.env.CONSOLE_CONFIG_PATH = configPath;
    delete process.env.AUTO_OPTIMIZER_ENABLED;

    const Server = require(path.join(WORKDIR, 'projects/控制台/server'));
    const WorkerTest = require(path.join(WORKDIR, 'projects/控制台/ceo-worker'))._test;
    const QueueAutoMerge = require(path.join(WORKDIR, 'projects/控制台/queue-automerge'));

    const disabled = Server.checkAutoOptimizer();
    assert.strictEqual(disabled.action, 'disabled');

    const bossNotice = WorkerTest.buildProjectDoneNotice({
      taskId: 'missing-task',
      queueAgent: 'supervisor-控制台',
      queueId: 'boss1',
      projectId: '控制台',
      role: 'supervisor',
      goal: '项目主管(控制台)执行 CEO brief。原始目标:\n【老板要求,请 CEO 拆解落地】机制三项: 暂停自动优化、飞书通知优化、入队自动同类合并。',
    });
    assert.strictEqual(bossNotice.title, '【直接】控制台机制优化');
    assert(!/老板要求|请 CEO|原始目标/.test(bossNotice.title));

    const autoNotice = WorkerTest.buildProjectDoneNotice({
      taskId: 'missing-task',
      queueAgent: 'supervisor-控制台',
      queueId: 'auto1',
      projectId: '控制台',
      role: 'ui_optimizer',
      title: '空闲自动优化',
      goal: '空闲自动优化师本轮任务。',
    });
    assert(/^【自动:】/.test(autoNotice.title));

    const passNotice = {
      title: '串行冒烟',
      body: '串行冒烟 · serial smoke PASS',
      result: 'serial smoke PASS',
      evidence: { review: { pass: true } },
    };
    const passSpec = { taskId: 't1', queueAgent: 'supervisor-控制台', queueId: 'q1', projectId: '控制台' };
    assert.strictEqual(WorkerTest.shouldSkipProjectDoneNotice(passNotice, passSpec), true);
    assert.strictEqual(WorkerTest.shouldSkipProjectDoneNotice(passNotice, Object.assign({}, passSpec, { taskId: 't2', queueId: 'q2' })), true);

    const first = QueueAutoMerge.enqueue(artifactsDir, 'ceo', {
      projectId: '控制台',
      goal: '控制台 飞书通知优化 和 入队自动同类合并 回归测试任务',
    }, { id: 'merge-old', priority: 20 });
    assert.strictEqual(first.autoMerge.applied, false);
    const second = QueueAutoMerge.enqueue(artifactsDir, 'ceo', {
      projectId: '控制台',
      goal: '控制台 飞书通知优化 和 入队自动同类合并 回归测试任务',
    }, { id: 'merge-new', priority: 20 });
    assert.strictEqual(second.autoMerge.applied, true);
    const listed = Q.list(artifactsDir, 'ceo');
    assert.deepStrictEqual(listed.queued.map(e => e.id), ['merge-old']);
    const canceled = readJson(path.join(artifactsDir, 'queues', 'ceo', 'canceled', 'merge-new.json'));
    assert.strictEqual(canceled.merged_into.id, 'merge-old');
    assert.strictEqual(canceled.queue_organize.merged_by, 'auto-enqueue-merge');
    assert(/Queue auto-merge note/.test(listed.queued[0].task.goal));

    const uiA = QueueAutoMerge.enqueue(artifactsDir, 'ceo', {
      projectId: '控制台',
      goal: 'workspace.html 任务板 UI: 调整卡片标题和运行时长显示。',
    }, { id: 'ui-a', priority: 30 });
    assert.strictEqual(uiA.autoMerge.applied, false);
    const uiB = QueueAutoMerge.enqueue(artifactsDir, 'ceo', {
      projectId: '控制台',
      goal: 'workspace.html 任务板 UI: 修复滚动区域闪动和头像刷新。',
    }, { id: 'ui-b', priority: 31 });
    assert.strictEqual(uiB.autoMerge.applied, false);
    assert.strictEqual(uiB.autoMerge.reason, 'similarity-requires-manual-review');
    const afterUi = Q.list(artifactsDir, 'ceo');
    assert(afterUi.queued.some(e => e.id === 'ui-a'), 'same bucket UI task must not be auto-canceled');
    assert(afterUi.queued.some(e => e.id === 'ui-b'), 'new same bucket UI task must remain queued without exact key');

    console.log(JSON.stringify({ pass: true, suite: 'console-mechanisms-smoke' }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
