#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKDIR = path.resolve(__dirname, '../../..');
const Q = require(path.join(WORKDIR, 'shared/engine/queue'));

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function fakeFeishuScript() {
  return `#!/usr/bin/env bash
set -euo pipefail
title=""
body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    --image) shift 2 ;;
    *) shift ;;
  esac
done
python3 - "$FAKE_FEISHU_LOG" "$title" "$body" <<'PY'
import json
import sys
with open(sys.argv[1], "a", encoding="utf-8") as f:
    print(json.dumps({"title": sys.argv[2], "body": sys.argv[3]}, ensure_ascii=False), file=f)
PY
echo ok
`;
}

function readCalls(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function staleIso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-owner-notify-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const projectsDir = path.join(root, 'projects');
  const configPath = path.join(root, 'config.json');
  const fakeLog = path.join(root, 'fake-feishu.jsonl');
  const fakeNotify = path.join(root, 'shared', 'agents', 'ui-optimizer', 'notify-feishu.sh');

  try {
    fs.mkdirSync(path.dirname(fakeNotify), { recursive: true });
    fs.writeFileSync(fakeNotify, fakeFeishuScript());
    fs.chmodSync(fakeNotify, 0o755);
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    fs.mkdirSync(path.join(root, 'board', 'repair-tickets'), { recursive: true });
    writeJson(configPath, { roleRouting: {}, runners: {} });

    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_PROJECTS_DIR = projectsDir;
    process.env.CONSOLE_CONFIG_PATH = configPath;
    process.env.CONSOLE_BOARD_ROLLUP = path.join(root, 'board', 'status-rollup.md');
    process.env.QUEUE_AGENT = 'supervisor-控制台';
    process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS = String(30 * 60 * 1000);
    process.env.OWNER_AUTO_NOTIFY_AGGREGATE_MS = '5000';
    process.env.OWNER_AUTO_NOTIFY_TASK_WINDOW_MS = String(5 * 60 * 1000);
    process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS = '1000';
    process.env.RUNNING_NO_PROGRESS_STALE_MS = '0';
    process.env.AUTO_REPAIR_ENABLED = '0';
    process.env.FAKE_FEISHU_LOG = fakeLog;

    const WorkerTest = require(path.join(WORKDIR, 'projects/控制台/ceo-worker'))._test;
    const Tools = require(path.join(WORKDIR, 'projects/控制台/secretary-tools'));
    assert.strictEqual(WorkerTest.isExternalModelTransientFailure('kimi-k2 退出码 1: Invalid Authentication'), true);
    assert.strictEqual(WorkerTest.isExternalModelTransientFailure('zhipu-glm 退出码 1: 该模型当前访问量过大，请您稍后再试'), true);
    assert.strictEqual(WorkerTest.isExternalModelTransientFailure('预扣费额度失败, 用户剩余额度不足'), true);
    assert.strictEqual(WorkerTest.isExternalModelTransientFailure('node tests/run.js failed'), false);
    assert.strictEqual(WorkerTest.isExpectedNonRepairStop('engine-runner 被信号 SIGTERM 终止', { signal: 'SIGTERM' }, { cancel_requested: true }), true);
    assert.strictEqual(WorkerTest.isExpectedNonRepairStop('token-usage-stopgap: auto insight task canceled after cost audit', {}, {}), true);
    assert.strictEqual(WorkerTest.isExpectedNonRepairStop('engine-runner 被信号 SIGTERM 终止', { signal: 'SIGTERM' }, {}), false);

    const bossWrappedGoal = [
      '项目主管(控制台)执行 CEO brief。原始目标:',
      '飞书卡片再简化(老板觉得还是太复杂):',
      '1) 任务字段显示老板原始任务名。',
      '2) 选项描述简短。',
    ].join('\n');
    const failureSpec = {
      taskId: 'task-fail',
      queueAgent: 'supervisor-控制台',
      queueId: 'fail1',
      role: 'supervisor',
      projectId: '控制台',
      goal: bossWrappedGoal,
    };
    const failureEntry = { id: 'fail1', task: { goal: bossWrappedGoal } };
    const repairTicket = { ticket: { id: 'auto-fail1' }, repairQueueId: 'repair-q1' };
    const firstFailure = WorkerTest.notifyQueueIssue(failureSpec, failureEntry, 'node_failed: mock runner exit 1', repairTicket);
    const duplicateFailure = WorkerTest.notifyQueueIssue(failureSpec, failureEntry, 'node_failed: mock runner exit 1', repairTicket);
    const sameTaskDifferentFailure = WorkerTest.notifyQueueIssue(failureSpec, failureEntry, 'engine-runner 退出码 1; later failure detail changed', repairTicket);
    const secondFailureSpec = Object.assign({}, failureSpec, {
      taskId: 'task-fail-2',
      queueId: 'fail2',
      title: '飞书卡片简化 批量任务B',
    });
    const secondFailure = WorkerTest.notifyQueueIssue(secondFailureSpec, {
      id: 'fail2',
      task: { title: '飞书卡片简化 批量任务B' },
    }, 'node_failed: mock runner exit 1', { ticket: { id: 'auto-fail2' } });
    assert.strictEqual(firstFailure.scheduled, true);
    assert.strictEqual(duplicateFailure.skipped, true);
    assert.strictEqual(sameTaskDifferentFailure.skipped, true);
    assert.strictEqual(secondFailure.skipped, true);
    const restartNoise = WorkerTest.notifyQueueIssue(Object.assign({}, failureSpec, {
      taskId: 'task-restart-noise',
      queueId: 'restart-noise',
      title: '重启窗口任务',
    }), { id: 'restart-noise', task: { title: '重启窗口任务' } }, 'SIGTERM during infra_restart watchdog restart window', null);
    assert.strictEqual(restartNoise.skipped, true);
    assert.strictEqual(restartNoise.reason, 'infra-restart-noise');

    const pausedSpec = {
      taskId: 'task-pause',
      queueAgent: 'supervisor-控制台',
      queueId: 'pause1',
      role: 'supervisor',
      projectId: '控制台',
      title: '并发控制',
      goal: '并发控制做起来 老板',
    };
    const pausedFirst = WorkerTest.notifyQueueIssue(pausedSpec, { id: 'pause1', task: { title: '并发控制' } }, 'needs-human: 等主人确认', null);
    const failedAfterPause = WorkerTest.notifyQueueIssue(pausedSpec, { id: 'pause1', task: { title: '并发控制' } }, 'engine-runner 退出码 1; paused task later failed', null);
    assert.strictEqual(pausedFirst.scheduled, true);
    assert.strictEqual(failedAfterPause.skipped, true);
    const firstFlush = WorkerTest.flushOwnerAutoNoticeNow();
    assert(
      firstFlush.filter(r => r.sent).length >= 2,
      `failure and paused->failed groups should flush as two cards: ${JSON.stringify(firstFlush)}`,
    );

    const runDir = path.join(Q.qdir(artifactsDir, 'supervisor-控制台'), 'running');
    writeJson(path.join(runDir, 'stuck1.json'), {
      id: 'stuck1',
      target: 'supervisor-控制台',
      task: { goal: bossWrappedGoal },
      status: 'running',
      retry: 0,
      priority: 10,
      taskId: 'task-stuck',
      role: 'supervisor',
      projectId: '控制台',
      flowId: 'review-loop',
      enginePid: 999999,
      engine_started_at: staleIso(5000),
      engine_heartbeat_at: staleIso(5000),
      started_at: staleIso(5000),
      updated_at: staleIso(5000),
    });
    await WorkerTest.sweepStaleRunning();
    const sameTaskDifferentStuck = WorkerTest.notifyQueueStuck({
      taskId: 'task-stuck',
      queueAgent: 'supervisor-控制台',
      queueId: 'stuck1',
      role: 'supervisor',
      projectId: '控制台',
      goal: bossWrappedGoal,
    }, { id: 'stuck1', task: { goal: bossWrappedGoal } }, 'running 项无 enginePid,重新入队', {
      action: '已判定 running 占槽异常,随后重新入队',
    });
    assert.strictEqual(sameTaskDifferentStuck.skipped, true);
    const stuckFlush = WorkerTest.flushOwnerAutoNoticeNow();
    assert(stuckFlush.some(r => r.sent && /任务卡住/.test(r.title || '')), 'stuck group should flush once');
    const claimedAgain = Q.claim(artifactsDir, 'supervisor-控制台');
    assert(claimedAgain && claimedAgain.id === 'stuck1', 'stuck entry should be requeued for retry');
    claimedAgain.enginePid = 999999;
    claimedAgain.engine_started_at = staleIso(5000);
    claimedAgain.engine_heartbeat_at = staleIso(5000);
    claimedAgain.updated_at = staleIso(5000);
    writeJson(path.join(runDir, 'stuck1.json'), claimedAgain);
    await WorkerTest.sweepStaleRunning();

    const added = Tools.repairTicketAdd({
      id: 'repair-key',
      title: '卡死解除',
      source: '自动故障触发',
      problem: 'running 项卡死',
    });
    assert.strictEqual(added.ticket.id, 'repair-key');
    const completed = Tools.repairTicketComplete({
      id: 'repair-key',
      result: '根因: running 心跳失联; 处理: 清理占槽并补告警; 验证: owner-auto-notify-test PASS; 架构判断: 可泛化',
    });
    assert.strictEqual(completed.notify.sent, true);

    const calls = readCalls(fakeLog);
    assert.strictEqual(calls.length, 4, 'failure summary, paused->failed, stuck, and repair completion should each send one Feishu call');
    assert.strictEqual(calls[0].title, '控制台 - 执行失败 x2');
    assert(calls[0].body.includes('问题类型: 执行失败'));
    assert(calls[0].body.includes('影响任务: 2 个'));
    assert(calls[0].body.includes('触发次数: 4'));
    assert(calls[0].body.includes('飞书卡片简化'));
    assert(calls[0].body.includes('维修工单 auto-fail1, auto-fail2 已创建/接单'));
    assert(!/(任务出问题|【自动[:：]】|node_failed|mock runner|heartbeat|engine_heartbeat_at|心跳|超时)/i.test(`${calls[0].title}\n${calls[0].body}`));
    assert.strictEqual(calls[1].title, '并发控制 - 执行失败');
    assert(calls[1].body.includes('影响任务: 1 个'));
    assert(calls[1].body.includes('触发次数: 2'));
    assert(calls[1].body.includes('并发控制'));
    assert(calls[1].body.includes('已升级老板关注'));
    assert(!/(任务出问题|needs-human|paused task later failed|老板要求|请 CEO|原始目标)/i.test(`${calls[1].title}\n${calls[1].body}`));
    assert.strictEqual(calls[2].title, '飞书卡片简化 - 任务卡住');
    assert(calls[2].body.includes('问题类型: 任务卡住'));
    assert(calls[2].body.includes('下一步: 系统重试中'));
    assert(!/(任务卡住:|【自动[:：]】|stuck1|heartbeat|engine_heartbeat_at|心跳|超时|未续约)/i.test(`${calls[2].title}\n${calls[2].body}`));
    assert.strictEqual(calls[3].title, '关键修复完成: repair-key');
    assert(calls.every(call => !/(老板要求|请 CEO|原始目标)/.test(`${call.title}\n${call.body}`)));
    const notifyState = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'owner-auto-notify-state.json'), 'utf8'));
    const mergedNotices = Object.values(notifyState.notices || {}).filter(notice => notice.merged > 0);
    assert(mergedNotices.length >= 3, 'failure, paused->failed, and stuck duplicates should be merged into cooldown state');

    console.log(JSON.stringify({ pass: true, suite: 'owner-auto-notify' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
