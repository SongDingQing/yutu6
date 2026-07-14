#!/usr/bin/env node
'use strict';
/*
 * CEO 按复杂度伸缩(拍板 Q4)回归:
 * - 简单任务(显式 projectId + 短 goal + 非重要域)在 orchestrator-plan 前短路直通项目主管;
 * - 跨项目/长 goal/重要域/useOrchestrator===true/维修救火 仍走全链(orchestrator-plan);
 * - YUTU6_CEO_ELASTIC=0 退回全量过 CEO;
 * - 直通路径协议字段完整:brief 落盘、supervisor 队列入队、结构化验收表、
 *   root 链路字段、handoff shadow spec_fingerprint。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SIMPLE_GOAL = '把 workspace 任务板上的今日进展文案改得更顺口';

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readEvents(artifactsDir, taskId) {
  return fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(e => e.task === taskId || e.sourceTask === taskId);
}

function runEngine(specFile, extraEnv) {
  return spawnSync(process.execPath, [path.join(REPO, 'projects/控制台/engine-runner.js'), '--spec', specFile], {
    cwd: REPO,
    env: Object.assign({}, process.env, extraEnv || {}),
    encoding: 'utf8',
  });
}

function pendingQueueEntries(artifactsDir, agent) {
  const dir = path.join(artifactsDir, 'queues', agent);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => /\.json$/.test(f) && f !== '_seq');
  } catch (_) {
    return [];
  }
  return files.sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceo-elastic-depth-test-'));
  const projectsDir = path.join(root, 'projects');
  const artifactsDir = path.join(root, 'artifacts');
  const configPath = path.join(root, 'config.json');

  try {
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    fs.mkdirSync(path.join(projectsDir, 'ExampleProject'), { recursive: true });
    writeJson(configPath, { runners: {}, roleRouting: {} });

    process.env.CONSOLE_PROJECTS_DIR = projectsDir;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_CONFIG_PATH = configPath;
    process.env.CONSOLE_CONFIG_FILE = configPath; // board-review 控制读这份,确保未禁用/无特殊控制
    delete process.env.YUTU6_CEO_ELASTIC;

    const { _test } = require('../projects/控制台/engine-runner');

    // ---- 开关判定 ----
    assert.strictEqual(_test.ceoElasticEnabled(), true, '默认应开启弹性伸缩');
    process.env.YUTU6_CEO_ELASTIC = '0';
    assert.strictEqual(_test.ceoElasticEnabled(), false);
    process.env.YUTU6_CEO_ELASTIC = 'off';
    assert.strictEqual(_test.ceoElasticEnabled(), false);
    process.env.YUTU6_CEO_ELASTIC = '1';
    assert.strictEqual(_test.ceoElasticEnabled(), true);
    delete process.env.YUTU6_CEO_ELASTIC;

    // ---- isSimpleTask 判据(保守:全部满足才简单) ----
    const simple = _test.isSimpleTask({ projectId: '控制台', goal: SIMPLE_GOAL, queueAgent: 'ceo' });
    assert.strictEqual(simple.simple, true, JSON.stringify(simple));
    assert.strictEqual(simple.projectId, '控制台');
    assert.strictEqual(simple.reason, 'simple_task');

    assert.strictEqual(_test.isSimpleTask({ goal: SIMPLE_GOAL }).reason, 'no_explicit_project');
    assert.strictEqual(_test.isSimpleTask({ projectId: '未注册项目', goal: SIMPLE_GOAL }).reason, 'unregistered_project');
    assert.strictEqual(_test.isSimpleTask({ projectId: '不存在的项目', goal: SIMPLE_GOAL }).reason, 'unknown_project');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: SIMPLE_GOAL, useOrchestrator: true }).reason, 'use_orchestrator_required');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: SIMPLE_GOAL, boardReview: { required: true } }).reason, 'board_review_required');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: '重启控制台服务', action: 'restart-console' }).reason, 'console_restart_request');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: '' }).reason, 'empty_goal');

    // 长 goal(>=600 字符)不直通
    const longVerdict = _test.isSimpleTask({ projectId: '控制台', goal: '一'.repeat(700) });
    assert.strictEqual(longVerdict.reason, 'goal_too_long');
    assert.strictEqual(longVerdict.goalChars, 700);

    // 跨项目信号不直通
    assert.strictEqual(_test.isSimpleTask({
      projectId: '控制台',
      goal: '跨项目统计:汇总每日完成数并同步展示',
    }).reason, 'cross_project_signal');
    assert.strictEqual(_test.isSimpleTask({
      projectId: '控制台',
      goal: '顺手把 ExampleProject 看板的文案也统一下',
    }).reason, 'mentions_other_project');

    // 主动涉 未注册项目 不直通(排除语境不算)
    assert.strictEqual(_test.isSimpleTask({
      projectId: '控制台',
      goal: '修改 未注册项目 项目的构建脚本并运行测试',
    }).reason, 'unregistered_project_reference');
    assert.strictEqual(_test.isSimpleTask({
      projectId: '控制台',
      goal: SIMPLE_GOAL,
      bounds: '只处理本任务; 未注册项目 一律排除; 密钥不回显',
    }).simple, true, '未注册项目 排除语境不应挡直通');

    // 董事会重要域不直通(structured 优先 + 文本兜底)
    const importantVerdict = _test.isSimpleTask({
      projectId: '控制台',
      goal: '重构 shared/engine 队列引擎的并发锁机制,合并 claim/lease 状态机',
    });
    assert.strictEqual(importantVerdict.simple, false);
    assert.match(importantVerdict.reason, /^board_important:/);
    const structuredImportant = _test.isSimpleTask({
      projectId: '控制台',
      goal: SIMPLE_GOAL,
      architectureChange: true,
      impactAreas: ['queue'],
      changeAction: 'refactor',
    });
    assert.strictEqual(structuredImportant.simple, false);
    assert.match(structuredImportant.reason, /^board_important:/);

    // 维修/救火类不直通
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: '维修工位掉线问题' }).reason, 'repair_or_firefight');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', queueAgent: 'repair', goal: SIMPLE_GOAL }).reason, 'repair_or_firefight');
    assert.strictEqual(_test.isSimpleTask({ projectId: '控制台', goal: '服务宕机,紧急恢复' }).reason, 'repair_or_firefight');

    // 秘书信封形态:originalGoal 短正文优先,背景包不把任务撑成"复杂"
    const envelopeVerdict = _test.isSimpleTask({
      projectId: '控制台',
      originalGoal: SIMPLE_GOAL,
      goal: `秘书补全稿:\n\n目标:${SIMPLE_GOAL}\n项目:控制台\n\n[秘书后台背景包]\n${'队列引擎路由背景噪声 '.repeat(200)}`,
      boardReview: { required: false, source: 'secretary' },
    });
    assert.strictEqual(envelopeVerdict.simple, true, JSON.stringify(envelopeVerdict));
    assert.strictEqual(envelopeVerdict.goalChars, SIMPLE_GOAL.length);
    assert.strictEqual(
      _test.stripSecretaryContextPackText(`短正文\n[秘书后台背景包]\n${'x'.repeat(2000)}`),
      '短正文',
    );

    const baseEnv = {
      CONSOLE_PROJECTS_DIR: projectsDir,
      CONSOLE_ARTIFACTS_DIR: artifactsDir,
      CONSOLE_CONFIG_PATH: configPath,
      CONSOLE_CONFIG_FILE: configPath,
      YUTU6_HANDOFF_MODE: 'shadow',
    };
    delete process.env.YUTU6_CEO_ELASTIC;

    // ---- 直通路径端到端:事件 + brief 落盘 + supervisor 队列入队 + 协议字段 ----
    const directSpec = path.join(root, 'elastic-direct-spec.json');
    writeJson(directSpec, {
      taskId: 'ceo-elastic-direct',
      queueAgent: 'ceo',
      queueId: 'elasticSimple',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: SIMPLE_GOAL,
      autoApproveHuman: true,
      // 故意不设 useOrchestrator:若未短路,空 runners 配置会让 orchestrator-plan 失败退出非 0
    });
    const direct = runEngine(directSpec, baseEnv);
    assert.strictEqual(direct.status, 0, direct.stderr || direct.stdout);
    const directEvents = readEvents(artifactsDir, 'ceo-elastic-direct');
    const directEvent = directEvents.find(e => e.type === 'route.direct_to_supervisor');
    assert(directEvent, '简单任务应发 route.direct_to_supervisor 事件');
    assert.strictEqual(directEvent.reason, 'simple_task');
    assert.strictEqual(directEvent.projectId, '控制台');
    assert.strictEqual(directEvent.queueAgent, 'supervisor-控制台');
    assert(!directEvents.some(e => e.type === 'node.start' && e.node === 'orchestrator-plan'), '直通路径不应经过 orchestrator-plan');
    assert(directEvents.some(e => e.type === 'project.brief.written' && e.projectId === '控制台'));
    assert(directEvents.some(e => e.type === 'queue.enqueued' && e.queueAgent === 'supervisor-控制台'));
    assert(directEvents.some(e => e.type === 'project.routed' && e.supervisorQueue === 'supervisor-控制台' && e.queueId));
    assert(directEvents.some(e => e.type === 'project.route.waiting'));
    assert(directEvents.some(e => e.type === 'engine.worker.end' && e.waitingDownstream === true && e.state === 'waiting_downstream'), '直通路径父任务仍等待下游');
    assert(!directEvents.some(e => e.type === 'task.failed'));

    // brief 落盘
    const brief = fs.readFileSync(path.join(projectsDir, '控制台', 'brief.md'), 'utf8');
    assert(brief.includes(SIMPLE_GOAL), 'brief 应包含任务原文');
    assert(brief.includes('taskId:ceo-elastic-direct'));
    assert(brief.includes('CEO 弹性伸缩'), 'brief 计划摘要应注明直通来源');

    // supervisor 队列入队 + 协议字段(结构化验收表 / root 链路)
    const entries = pendingQueueEntries(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(entries.length, 1, '应恰好入队一条 supervisor 任务');
    const child = entries[0].task || {};
    assert.strictEqual(child.flowId, 'review-loop');
    assert.strictEqual(child.role, 'supervisor');
    assert.strictEqual(child.projectId, '控制台');
    assert(String(child.goal || '').includes(SIMPLE_GOAL));
    assert.match(String(child.acceptance || ''), /结构化验收表/, '直通路径必须保留结构化验收表');
    assert.match(String(child.acceptance || ''), /\| 要点 \| 完成状态\(完成\/部分\/未完成\) \| 证据位置/);
    assert.strictEqual(child.rootQueueAgent, 'ceo');
    assert.strictEqual(child.rootQueueId, 'elasticSimple');
    assert.strictEqual(child.rootTaskId, 'ceo-elastic-direct');
    assert.strictEqual(child.parentTaskId, 'ceo-elastic-direct');
    assert((child.inputs || []).includes('projects/控制台/brief.md'));

    // handoff shadow spec_fingerprint(协议字段)
    const shadowEvent = directEvents.find(e => e.type === 'handoff.shadow.written');
    assert(shadowEvent && /^[0-9a-f]{64}$/.test(String(shadowEvent.fingerprint || '')), '直通路径应保留 handoff shadow 指纹');
    const meta = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'engine-runs', 'ceo-elastic-direct', 'meta.json'), 'utf8'));
    assert.strictEqual(meta.spec_fingerprint, shadowEvent.fingerprint);

    // ---- 复杂任务(跨项目)仍走 orchestrator-plan ----
    const crossSpec = path.join(root, 'elastic-cross-spec.json');
    writeJson(crossSpec, {
      taskId: 'ceo-elastic-cross',
      queueAgent: 'ceo',
      queueId: 'elasticCross',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: '跨项目对齐:控制台与 ExampleProject 的看板每日汇总文案统一说明',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const cross = runEngine(crossSpec, baseEnv);
    assert.strictEqual(cross.status, 0, cross.stderr || cross.stdout);
    const crossEvents = readEvents(artifactsDir, 'ceo-elastic-cross');
    assert(!crossEvents.some(e => e.type === 'route.direct_to_supervisor'), '跨项目任务不应直通');
    assert(crossEvents.some(e => e.type === 'node.start' && e.node === 'orchestrator-plan'), '跨项目任务应走 orchestrator-plan');
    assert(crossEvents.some(e => e.type === 'project.routed'));

    // ---- 开关退回:YUTU6_CEO_ELASTIC=0 时简单任务也走全链 ----
    const offSpec = path.join(root, 'elastic-off-spec.json');
    writeJson(offSpec, {
      taskId: 'ceo-elastic-off',
      queueAgent: 'ceo',
      queueId: 'elasticOff',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: SIMPLE_GOAL,
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const off = runEngine(offSpec, Object.assign({}, baseEnv, { YUTU6_CEO_ELASTIC: '0' }));
    assert.strictEqual(off.status, 0, off.stderr || off.stdout);
    const offEvents = readEvents(artifactsDir, 'ceo-elastic-off');
    assert(!offEvents.some(e => e.type === 'route.direct_to_supervisor'), '开关关闭时不应直通');
    assert(offEvents.some(e => e.type === 'node.start' && e.node === 'orchestrator-plan'), '开关关闭时应走 orchestrator-plan');
    assert(offEvents.some(e => e.type === 'project.routed'));

    console.log(JSON.stringify({ pass: true, suite: 'ceo-elastic-depth' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
