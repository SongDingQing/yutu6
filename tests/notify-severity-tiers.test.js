#!/usr/bin/env node
'use strict';

// 拍板 Q7 守卫: 故障分级响应 P0/P1/P2。
// - classifyFailureSeverity 三类样例各得正确级别(结构化 kind 优先,文本兜底);
// - P0 立即飞书(不等聚合窗口); P1 不即时发,写入 artifacts/notify/p1-digest-<date>.jsonl,
//   日切点 flushP1Digest 汇总为一条; P2 只 emit 事件+记账,不飞书、不开重复维修工单;
// - YUTU6_NOTIFY_TIERED=0 整体退回旧行为(聚合通道 + infra-restart-noise 跳过语义不变)。
// 自派生双场景: 父进程分别以 tiered / legacy 模式 spawn 自身。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKDIR = path.resolve(__dirname, '..');

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

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function localDateString(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setupSandbox(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const artifactsDir = path.join(root, 'artifacts');
  const fakeLog = path.join(root, 'fake-feishu.jsonl');
  const fakeNotify = path.join(root, 'shared', 'agents', 'ui-optimizer', 'notify-feishu.sh');
  fs.mkdirSync(path.dirname(fakeNotify), { recursive: true });
  fs.writeFileSync(fakeNotify, fakeFeishuScript());
  fs.chmodSync(fakeNotify, 0o755);
  fs.mkdirSync(path.join(root, 'projects', '控制台'), { recursive: true });
  fs.mkdirSync(path.join(root, 'board', 'repair-tickets'), { recursive: true });
  writeJson(path.join(root, 'config.json'), { roleRouting: {}, runners: {} });

  process.env.CONSOLE_WORKDIR = root;
  process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
  process.env.CONSOLE_PROJECTS_DIR = path.join(root, 'projects');
  process.env.CONSOLE_CONFIG_PATH = path.join(root, 'config.json');
  process.env.CONSOLE_BOARD_ROLLUP = path.join(root, 'board', 'status-rollup.md');
  process.env.QUEUE_AGENT = 'supervisor-控制台';
  process.env.FAKE_FEISHU_LOG = fakeLog;
  return { root, artifactsDir, fakeLog };
}

function specFor(id, title) {
  return {
    taskId: `task-${id}`,
    queueAgent: 'supervisor-控制台',
    queueId: id,
    role: 'supervisor',
    projectId: '控制台',
    title,
    goal: title,
  };
}

function entryFor(id, title) {
  return { id, task: { title } };
}

function eventsOfType(artifactsDir, type) {
  return readJsonl(path.join(artifactsDir, 'engine-events.jsonl')).filter(row => row.type === type);
}

function runTieredScenario() {
  const { root, artifactsDir, fakeLog } = setupSandbox('notify-tier-on-');
  try {
    // 聚合窗口留 5s,证明 P0 的"立刻发"不是靠零窗口
    process.env.OWNER_AUTO_NOTIFY_AGGREGATE_MS = '5000';
    process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS = String(30 * 60 * 1000);
    process.env.AUTO_REPAIR_ENABLED = '1';
    delete process.env.YUTU6_NOTIFY_TIERED; // 默认开

    const WorkerTest = require(path.join(WORKDIR, 'projects/控制台/ceo-worker'))._test;
    const classify = WorkerTest.classifyFailureSeverity;

    // ── 1. 分类函数: 三类样例各得正确级别 ─────────────────────────────
    // P0 服务不可用: 结构化 kind 优先
    assert.strictEqual(classify('anything', { kind: 'console-down' }), 'P0');
    assert.strictEqual(classify('anything', { kind: 'http-failed' }), 'P0');
    assert.strictEqual(classify('anything', { kind: 'watchdog-restart-loop' }), 'P0');
    // P0 文本兜底
    assert.strictEqual(classify('console-not-running: http 探活连续 3 次失败', {}), 'P0');
    assert.strictEqual(classify('listen EADDRINUSE: address already in use :::8787', {}), 'P0');
    assert.strictEqual(classify('端口 8787 被占用,server 起不来', {}), 'P0');
    assert.strictEqual(classify('watchdog 检测到控制台连续重启 5 次', {}), 'P0');
    // P1 业务终态失败(failover 未兜住)
    assert.strictEqual(classify('done-gate 打回: review 未通过; 已超过最大重试 2', {}), 'P1');
    assert.strictEqual(classify('node_failed: engine-runner 退出码 1, failover 无候选可降级', {}), 'P1');
    assert.strictEqual(classify('queue worker crashed: TypeError x is not a function', {}), 'P1');
    // P2 infra 噪声: 结构化 kind 优先
    assert.strictEqual(classify('anything', { kind: 'queue-running-missing' }), 'P2');
    assert.strictEqual(classify('running 项无 enginePid,重新入队', { kind: 'queue-stuck' }), 'P2');
    // P2 文本兜底
    assert.strictEqual(classify('SIGTERM during infra_restart watchdog restart window', {}), 'P2');
    assert.strictEqual(classify('running 队列文件已不存在,终止对应 engine 并释放 slot', {}), 'P2');
    assert.strictEqual(classify('该模型当前访问量过大，请您稍后再试', {}), 'P2');
    assert.strictEqual(classify('skill 加载失败: ui-optimizer skill not found', {}), 'P2');

    // ── 2. P2: 不飞书,只 emit 事件 ───────────────────────────────────
    const p2a = WorkerTest.notifyQueueIssueTiered(specFor('p2a', '重启窗口任务'), entryFor('p2a', '重启窗口任务'),
      'SIGTERM during infra_restart watchdog restart window', null);
    assert.strictEqual(p2a.severity, 'P2');
    assert.strictEqual(p2a.skipped, true);
    const p2b = WorkerTest.notifyQueueIssueTiered(specFor('p2b', '限流任务'), entryFor('p2b', '限流任务'),
      '该模型当前访问量过大，请您稍后再试', null);
    assert.strictEqual(p2b.severity, 'P2');
    const p2stuck = WorkerTest.notifyQueueStuckTiered(specFor('p2c', '占槽任务'), entryFor('p2c', '占槽任务'),
      'running 项无 enginePid,重新入队', { action: '已判定 running 占槽异常,随后重新入队' });
    assert.strictEqual(p2stuck.severity, 'P2');
    assert.strictEqual(readJsonl(fakeLog).length, 0, 'P2 不应触发飞书');
    assert(eventsOfType(artifactsDir, 'notify.tier.p2.suppressed').length >= 3, 'P2 应 emit notify.tier.p2.suppressed');
    // 记账
    const stateAfterP2 = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'notify', 'tier-state.json'), 'utf8'));
    const todayKey = localDateString(Date.now());
    assert(stateAfterP2.counts[todayKey].P2 >= 3, 'P2 应记账');

    // ── 3. P1: 进当日 digest,不即时飞书 ─────────────────────────────
    const p1 = WorkerTest.notifyQueueIssueTiered(specFor('p1a', '飞书卡片简化'), entryFor('p1a', '飞书卡片简化'),
      'done-gate 打回: review 未通过; 已超过最大重试 2', { ticket: { id: 'auto-p1a' } });
    assert.strictEqual(p1.severity, 'P1');
    assert.strictEqual(p1.digested, true);
    const today = localDateString(Date.now());
    const todayDigest = path.join(artifactsDir, 'notify', `p1-digest-${today}.jsonl`);
    const digestRows = readJsonl(todayDigest);
    assert.strictEqual(digestRows.length, 1, 'P1 应写入当日 digest 文件');
    assert.strictEqual(digestRows[0].severity, 'P1');
    assert.strictEqual(digestRows[0].repairTicketId, 'auto-p1a');
    assert(/飞书卡片简化/.test(digestRows[0].taskName || ''), 'digest 行应带任务名');
    assert.strictEqual(readJsonl(fakeLog).length, 0, 'P1 不应即时飞书');
    assert(eventsOfType(artifactsDir, 'notify.tier.p1.digested').length >= 1, 'P1 应 emit notify.tier.p1.digested');

    // ── 4. needs-human: 分级开着也保持既有即时聚合通道 ────────────────
    const gate = WorkerTest.notifyQueueIssueTiered(specFor('gate1', '并发控制'), entryFor('gate1', '并发控制'),
      'needs-human: 等主人确认', null);
    assert.strictEqual(gate.severity, undefined, 'needs-human 不参与分级');
    WorkerTest.flushOwnerAutoNoticeNow();
    let calls = readJsonl(fakeLog);
    assert.strictEqual(calls.length, 1, 'needs-human 应照旧走飞书');
    assert(/需确认/.test(calls[0].title), `needs-human 卡片标题: ${calls[0].title}`);

    // ── 5. P0: 立即飞书,不等聚合窗口 ────────────────────────────────
    const p0 = WorkerTest.notifyQueueIssueTiered(specFor('p0a', '控制台探活'), entryFor('p0a', '控制台探活'),
      'console-not-running: http-failed 探活连续 3 次失败', null);
    assert.strictEqual(p0.severity, 'P0');
    assert.strictEqual(p0.sent, true, 'P0 应立即发送成功');
    calls = readJsonl(fakeLog);
    assert.strictEqual(calls.length, 2, 'P0 应立刻多一条飞书(不等 5s 聚合窗口)');
    assert(/服务不可用/.test(calls[1].title), `P0 卡片标题: ${calls[1].title}`);
    assert(/P0/.test(calls[1].body), 'P0 卡片正文应标注级别');
    // 同类 P0 冷却窗口内去重
    const p0dup = WorkerTest.notifyQueueIssueTiered(specFor('p0b', '控制台探活'), entryFor('p0b', '控制台探活'),
      'console-not-running: http-failed 探活连续 4 次失败', null);
    assert.strictEqual(p0dup.skipped, true);
    assert.strictEqual(p0dup.reason, 'p0-cooldown');
    assert.strictEqual(readJsonl(fakeLog).length, 2, 'P0 冷却内不应重复发');

    // ── 6. 日切汇总: 昨日 digest 一次性发一条,当日不发,重复 flush 幂等 ──
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
    const yDate = localDateString(yesterdayMs);
    const yFile = path.join(artifactsDir, 'notify', `p1-digest-${yDate}.jsonl`);
    fs.appendFileSync(yFile, JSON.stringify({ at: new Date(yesterdayMs).toISOString(), atMs: yesterdayMs, severity: 'P1', projectId: '控制台', problemType: '验收打回', taskName: '任务甲', taskId: 'task-y1', repairTicketId: 'auto-y1' }) + '\n');
    fs.appendFileSync(yFile, JSON.stringify({ at: new Date(yesterdayMs).toISOString(), atMs: yesterdayMs, severity: 'P1', projectId: '控制台', problemType: '执行失败', taskName: '任务乙', taskId: 'task-y2' }) + '\n');
    const flushResults = WorkerTest.flushP1Digest({ now: Date.now() });
    assert.strictEqual(flushResults.length, 1, '日切应只汇总昨日一条');
    calls = readJsonl(fakeLog);
    assert.strictEqual(calls.length, 3, '日报应正好发一条飞书');
    assert(new RegExp(`P1 故障日报 ${yDate}`).test(calls[2].title), `日报标题: ${calls[2].title}`);
    assert(/2 条/.test(calls[2].title));
    assert(/任务甲/.test(calls[2].body) && /任务乙/.test(calls[2].body), '日报正文应含任务清单');
    const flushAgain = WorkerTest.flushP1Digest({ now: Date.now() });
    assert.strictEqual(flushAgain.length, 0, '重复 flush 应幂等');
    assert.strictEqual(readJsonl(fakeLog).length, 3, '重复 flush 不应再发');
    assert(fs.existsSync(todayDigest), '当日 digest 应保留待明日汇总');

    // ── 7. 工单闸门: P2 不开维修工单,P1 照常开 ──────────────────────
    const noTicket = WorkerTest.openAutoRepairTicket(specFor('p2t', '重启窗口任务'), entryFor('p2t', '重启窗口任务'),
      'SIGTERM during infra_restart watchdog restart window', { code: null, signal: 'SIGTERM' });
    assert.strictEqual(noTicket, null, 'P2 infra 噪声不应开维修工单');
    assert(eventsOfType(artifactsDir, 'repair.ticket.skipped').some(row => row.reason === 'p2-infra-noise'),
      'P2 跳过工单应留 repair.ticket.skipped 事件');
    const ticket = WorkerTest.openAutoRepairTicket(specFor('p1t', '真实失败任务'), entryFor('p1t', '真实失败任务'),
      'node_failed: engine-runner 退出码 1, failover 无候选可降级', { code: 1, signal: null });
    assert(ticket && ticket.ticket && ticket.ticket.id, 'P1 真实失败仍应开维修工单');

    console.log(JSON.stringify({ pass: true, suite: 'notify-severity-tiers', mode: 'tiered' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runLegacyScenario() {
  const { root, artifactsDir, fakeLog } = setupSandbox('notify-tier-off-');
  try {
    process.env.OWNER_AUTO_NOTIFY_AGGREGATE_MS = '0'; // 旧路径立即冲刷,便于断言
    process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS = String(30 * 60 * 1000);
    process.env.AUTO_REPAIR_ENABLED = '0';
    assert.strictEqual(process.env.YUTU6_NOTIFY_TIERED, '0', 'legacy 场景需 YUTU6_NOTIFY_TIERED=0');

    const Worker = require(path.join(WORKDIR, 'projects/控制台/ceo-worker'));
    const WorkerTest = Worker._test;

    // 分类函数仍导出可用(纯函数,不受开关影响)
    assert.strictEqual(Worker.classifyFailureSeverity('listen EADDRINUSE: address already in use', {}), 'P0');

    // 终态失败: 退回旧聚合通道并发飞书,不写 digest
    const legacyFail = WorkerTest.notifyQueueIssueTiered(specFor('l1', '飞书卡片简化'), entryFor('l1', '飞书卡片简化'),
      'node_failed: mock runner exit 1', { ticket: { id: 'auto-l1' } });
    assert.strictEqual(legacyFail.severity, undefined, '开关关闭时不应带分级字段');
    assert.strictEqual(legacyFail.scheduled, true);
    const calls = readJsonl(fakeLog);
    assert.strictEqual(calls.length, 1, '旧行为: 失败应经聚合通道发飞书');
    assert(/执行失败/.test(calls[0].title), `旧卡片标题: ${calls[0].title}`);

    // infra 噪声: 保持旧的 infra-restart-noise 跳过语义
    const legacyNoise = WorkerTest.notifyQueueIssueTiered(specFor('l2', '重启窗口任务'), entryFor('l2', '重启窗口任务'),
      'SIGTERM during infra_restart watchdog restart window', null);
    assert.strictEqual(legacyNoise.skipped, true);
    assert.strictEqual(legacyNoise.reason, 'infra-restart-noise');

    // stuck: 退回旧通道
    const legacyStuck = WorkerTest.notifyQueueStuckTiered(specFor('l3', '占槽任务'), entryFor('l3', '占槽任务'),
      'running 项无 enginePid,重新入队', { action: '已判定 running 占槽异常,随后重新入队' });
    assert.strictEqual(legacyStuck.severity, undefined);
    assert(readJsonl(fakeLog).length >= 2, '旧行为: stuck 也应发飞书');

    // 不应生成任何 digest 文件 / tier 状态
    const notifyDir = path.join(artifactsDir, 'notify');
    const digestFiles = fs.existsSync(notifyDir)
      ? fs.readdirSync(notifyDir).filter(name => /^p1-digest-/.test(name))
      : [];
    assert.strictEqual(digestFiles.length, 0, '开关关闭时不应写 P1 digest');

    console.log(JSON.stringify({ pass: true, suite: 'notify-severity-tiers', mode: 'legacy' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const mode = process.env.NOTIFY_TIER_TEST_MODE;
  if (mode === 'tiered') return runTieredScenario();
  if (mode === 'legacy') return runLegacyScenario();

  for (const scenario of [
    { mode: 'tiered', extraEnv: {} },
    { mode: 'legacy', extraEnv: { YUTU6_NOTIFY_TIERED: '0' } },
  ]) {
    const env = Object.assign({}, process.env, scenario.extraEnv, { NOTIFY_TIER_TEST_MODE: scenario.mode });
    if (scenario.mode === 'tiered') delete env.YUTU6_NOTIFY_TIERED;
    const result = spawnSync(process.execPath, [__filename], {
      cwd: WORKDIR,
      env,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.strictEqual(result.status, 0, `notify-severity-tiers ${scenario.mode} exited ${result.status}`);
  }
  console.log(JSON.stringify({ pass: true, suite: 'notify-severity-tiers' }));
}

main();
