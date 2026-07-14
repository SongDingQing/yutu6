#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function resolveMaybeRepoPath(p) {
  return path.isAbsolute(p) ? p : path.join(path.resolve(__dirname, '..'), p);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-routing-test-'));
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

    const { _test } = require('../projects/控制台/engine-runner');
    const workerTest = require('../projects/控制台/ceo-worker')._test;

    assert.strictEqual(_test.automaticLightweightSource({
      source: '洞察员',
      target: 'ceo',
      bounds: '只处理本洞察员公告板候选',
    }), 'insight-scout');
    assert.strictEqual(_test.loopEngineeringEnabledForSpec({
      source: '洞察员',
      bounds: '只处理本洞察员公告板候选',
    }), false);
    assert.strictEqual(_test.loopEngineeringEnabledForSpec({
      source: '洞察员',
      loopEngineering: true,
    }), true);

    assert.strictEqual(_test.normalizeProjectId('控制台'), '控制台');
    assert.strictEqual(_test.normalizeProjectId('未注册项目'), null);

    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '边界: 未注册项目 一律排除; 密钥不回显',
    }, '', null), '控制台');

    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '目标: 复核控制台 project-route 守卫',
    }, '诊断: inferProjectId 显式 projectId 且非主动操作 未注册项目 时正常透传', null), '控制台');

    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '目标: 新增 CEO 到秘书反馈通道',
    }, '- **A. CEO→秘书反馈通道(核心新增)**:CEO 拆解区分「硬失败(红线/未注册项目)」与「需澄清」', null), '控制台');

    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '目标: 自动维修直入队、不进公告板',
    }, '本任务派给主管时**不得**再过会触发「检测到 未注册项目 或无法安全确定项目归属」的 CEO 转交判死分支(`buildSecretaryEnvelope()` 约 1309–1353)', null), '控制台');

    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '目标: 修复 未注册项目 项目的构建脚本并运行测试',
    }, '', null), '控制台');
    assert.strictEqual(workerTest.inferProjectId({
      projectId: '控制台',
      goal: '目标: 修复 未注册项目 项目的构建脚本并运行测试',
    }), '控制台');

    assert.strictEqual(_test.inferProjectId({
      goal: '目标: 修复 未注册项目 项目的构建脚本并运行测试',
    }, '', null), null);
    assert.strictEqual(workerTest.inferProjectId({
      goal: '目标: 修复 未注册项目 项目的构建脚本并运行测试',
    }), null);

    assert.strictEqual(_test.inferProjectId({
      goal: '优化 workspace 任务板 queue 视图',
    }, '', null), '控制台');

    assert.strictEqual(_test.inferProjectId({
      goal: '控制台任务板回归',
    }, '', 'ExampleProject'), '控制台');

    assert.strictEqual(_test.inferProjectId({
      goal: '普通系统恢复冒烟,未指定项目',
    }, '', 'ExampleProject'), 'ExampleProject');

    assert.strictEqual(_test.inferProjectId({
      goal: 'ExampleProject 项目回归测试',
    }, '', null), 'ExampleProject');

    assert.strictEqual(_test.inferProjectId({
      goal: '普通系统恢复冒烟,未指定项目',
    }, '', null), '控制台');
    assert.strictEqual(workerTest.inferProjectId({
      goal: '普通系统恢复冒烟,未指定项目',
    }), '控制台');

    assert.strictEqual(_test.inferProjectId({
      goal: '整理一个没有项目关键词的后台提醒',
    }, '```json\n{"orchestrator":{"projectId":"ExampleProject","summary":"LLM 猜错","acceptance":"n/a"}}\n```', 'ExampleProject'), 'ExampleProject');
    assert.strictEqual(workerTest.inferProjectId({
      projectId: '控制台',
      goal: '边界: 如果涉及 未注册项目 就停止; buildSecretaryEnvelope() 只是函数名',
    }), '控制台');
    assert.strictEqual(_test.inferProjectId({
      projectId: '控制台',
      goal: '修复控制台 project-guard: build未注册项目Status() 只是函数名,不是 未注册项目 项目操作',
    }, '', null), '控制台');
    assert.strictEqual(workerTest.inferProjectId({
      projectId: '控制台',
      goal: 'Refactor build未注册项目Status() helper in console guard only',
    }), '控制台');
    assert.strictEqual(workerTest.isRetryableEngineFailure('检测到 未注册项目 排除范围或项目归属需要主人确认,CEO 已软暂停派单', { code: 5, paused: true }), false);
    assert.strictEqual(workerTest.isRetryableEngineFailure('node_failed', { code: 3 }), true);

    assert.strictEqual(_test.supervisorQueue('控制台'), 'supervisor-控制台');
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: '进行中任务区的渲染 + 滚轮 + 刷新问题, 前端程序员做, workspace.html 相关',
    }, ''), { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' });
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: '前端设计师兼容别名: 调整 workspace.html 任务板滚动。',
    }, ''), { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' });
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: '重整办公室布局: 每个部门(总裁办/公共协作/系统办/ExampleProject/人力资源/董事会)占一整行; 前端程序员做; Peekaboo 截图确认。',
      bounds: '办公室改一行一行; 前端做; 未注册项目 排除',
    }, '前端程序员负责实现(布局/CSS),不是后端逻辑改动。{"summary":"前端程序员实现,未注册项目 排除。"}'), { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' });
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: 'HR主管安排一次智能体职责边界审核,并更新花名册',
    }, ''), { agent: 'hr_manager', role: 'hr_manager', flowId: 'agent-once' });
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: 'Gitee 版本发布: 按四段版本号 commit 并 push 到远端',
    }, ''), { agent: 'it_engineer', role: 'it_engineer', flowId: 'agent-once' });
    assert.deepStrictEqual(_test.directQueueForGoal({
      targetAgent: 'frontend_designer',
      goal: '结构化指定前端程序员处理任务板 UI。',
    }, ''), { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' });
    assert.strictEqual(_test.directQueueForGoal({
      goal: '不要交给前端设计师,由 worker_code 修复 workspace.html 的数据合并逻辑。',
    }, ''), null);
    assert.strictEqual(_test.directQueueForGoal({
      goal: '前端设计师排除,由 worker_code 修复 workspace.html。',
    }, ''), null);
    assert.strictEqual(_test.directQueueForGoal({
      goal: '这次不派给 IT 工程师;只是在 brief 里提到 Gitee rollback 风险,不执行发布。',
    }, ''), null);
    assert.strictEqual(_test.directQueueForGoal({
      goal: '完整审视系统逻辑:闲置角色 + 越界。找出没派上用场的角色,理清任务边界,产出审视报告 + 修改清单。',
    }, 'CEO 计划摘要提到可让 it_engineer / it_engineer 参与具体实现,但这只是参与建议,不是版本发布/回滚任务。'), null);
    assert.deepStrictEqual(_test.directQueueForGoal({
      goal: '维修员请求 IT 工程师 rollback 到 0.0.0.1,先 dry-run',
    }, ''), { agent: 'it_engineer', role: 'it_engineer', flowId: 'agent-once' });
    assert.strictEqual(_test.directQueueForGoal({
      goal: '普通 workspace.html 修复任务, 交给后端程序员处理',
    }, ''), null);
    assert.strictEqual(_test.defaultNodeTimeoutSec({ queueAgent: 'supervisor-控制台' }, 'review-loop'), 1800);
    assert.strictEqual(_test.defaultNodeTimeoutSec({ queueAgent: 'supervisor-控制台', nodeTimeoutSec: 1 }, 'review-loop'), 1);
    assert.strictEqual(_test.defaultNodeTimeoutSec({ queueAgent: 'worker_code' }, 'agent-once'), 900);
    const doneGateSpec = workerTest.makeSpec({
      id: 'doneGateTemplateSpec',
      task: {
        projectId: '控制台',
        projectMode: false,
        flowId: 'review-loop',
        goal: 'done gate 结构化验收表模板接入',
        acceptance: '填齐才过; 留空打回; 证据对不上打回',
      },
    });
    assert.match(doneGateSpec.acceptance, /结构化验收表/);
    assert.match(doneGateSpec.acceptance, /模板: templates\/structured-acceptance-table\.md/);
    assert.match(doneGateSpec.acceptance, /\| 要点 \| 完成状态\(完成\/部分\/未完成\) \| 证据位置/);
    assert.strictEqual(_test.isPausedResult({ ok: false, reason: 'awaiting_human', task: { state: 'awaiting_human' } }), true);
    assert.strictEqual(_test.isConsoleRestartExecutionRequest({
      goal: '请: 1) 重启 console 服务(如 launchctl kickstart -k gui/$(id -u)/com.yutu6.console)让修复生效; 2) 重启后验证并飞书简报。',
    }, ''), false);
    assert.strictEqual(_test.isConsoleRestartExecutionRequest({
      goal: '优化任务稳定性: 修复重启自杀陷阱,把重启 console 改成 detached 脚本,补 sweepStaleRunning 心跳超时测试。',
    }, ''), false);
    assert.strictEqual(_test.isConsoleRestartExecutionRequest({
      action: 'restart-console',
      goal: '结构化控制台重启动作请求',
    }, ''), true);
    assert.strictEqual(_test.isConsoleRestartExecutionRequest({
      request: { action: 'restart', target: 'com.yutu6.console' },
    }, ''), true);

    const dryRun = spawnSync(process.execPath, [
      path.join(__dirname, '../projects/控制台/tools/console-restart-detached.js'),
      '--dry-run',
      '--delay-ms',
      '1000',
      '--reason',
      'routing test',
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const dryJson = JSON.parse(dryRun.stdout);
    assert.strictEqual(dryJson.dryRun, true);
    assert.strictEqual(dryJson.service, 'com.yutu6.console');
    assert(fs.existsSync(resolveMaybeRepoPath(dryJson.scriptPath)), 'detached restart dry-run should write script artifact');

    const softSpec = path.join(root, 'soft-pause-spec.json');
    writeJson(softSpec, {
      taskId: 'project-route-soft-pause',
      queueAgent: 'ceo',
      queueId: 'softRoute',
      role: 'orchestrator',
      flowId: 'project-route',
      goal: '目标: 修复 未注册项目 项目的构建脚本并运行测试',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const soft = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', softSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(soft.status, 5, soft.stderr || soft.stdout);
    const events = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
    assert(events.some(e => e.type === 'project.route.paused' && e.task === 'project-route-soft-pause'));
    assert(events.some(e => e.type === 'engine.worker.end' && e.task === 'project-route-soft-pause' && e.paused === true && e.state === 'paused'));
    assert(!events.some(e => e.type === 'task.failed' && e.task === 'project-route-soft-pause'));

    const restartSpec = path.join(root, 'restart-handoff-spec.json');
    writeJson(restartSpec, {
      taskId: 'project-route-restart-handoff',
      queueAgent: 'ceo',
      queueId: 'restartRoute',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      action: 'restart-console',
      goal: '结构化控制台重启动作请求。',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const restart = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', restartSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(restart.status, 5, restart.stderr || restart.stdout);
    const restartEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'project-route-restart-handoff');
    const handoffEvent = restartEvents.find(e => e.type === 'project.route.restart_detached_required');
    assert(handoffEvent, 'console restart request should produce detached handoff event');
    assert(handoffEvent.handoff && fs.existsSync(resolveMaybeRepoPath(handoffEvent.handoff)), 'restart handoff file missing');
    assert(!restartEvents.some(e => e.type === 'project.routed'), 'console restart request must not enqueue normal supervisor review-loop');
    assert(restartEvents.some(e => e.type === 'engine.worker.end' && e.paused === true && e.state === 'paused'));

    const mentionSpec = path.join(root, 'restart-mention-spec.json');
    writeJson(mentionSpec, {
      taskId: 'project-route-restart-mention-only',
      queueAgent: 'ceo',
      queueId: 'restartMentionOnly',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: '普通背景包: 文档里提到重启 console 和 launchctl kickstart -k gui/$(id -u)/com.yutu6.console,但这只是说明文本,不是执行动作。',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const mention = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', mentionSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(mention.status, 0, mention.stderr || mention.stdout);
    const mentionEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'project-route-restart-mention-only');
    assert(!mentionEvents.some(e => e.type === 'project.route.restart_detached_required'), 'text-only restart mention must not produce detached handoff');
    assert(!mentionEvents.some(e => e.type === 'engine.worker.end' && e.paused === true), 'text-only restart mention must not pause');
    assert(mentionEvents.some(e => e.type === 'project.routed' && e.queueId), 'text-only restart mention should route normally');
    assert(mentionEvents.some(e => e.type === 'engine.worker.end' && e.waitingDownstream === true && e.state === 'waiting_downstream'));
	
	    const routedSpec = path.join(root, 'routed-spec.json');
    writeJson(routedSpec, {
      taskId: 'project-route-waits-child',
      queueAgent: 'ceo',
      queueId: 'routeWait',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: '目标: 控制台任务链状态传播冒烟',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const routed = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', routedSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(routed.status, 0, routed.stderr || routed.stdout);
    const routedEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'project-route-waits-child');
    assert(routedEvents.some(e => e.type === 'project.routed' && e.queueId), 'project-route did not enqueue child');
    assert(routedEvents.some(e => e.type === 'project.route.waiting'), 'project-route did not mark waiting downstream');
    assert(routedEvents.some(e => e.type === 'engine.worker.end' && e.waitingDownstream === true && e.state === 'waiting_downstream'), 'project-route did not end as waiting_downstream');
    assert(!routedEvents.some(e => e.type === 'task.done'), 'project-route parent must not be done before child finishes');

    const insightSpec = path.join(root, 'insight-route-spec.json');
    writeJson(insightSpec, {
      taskId: 'project-route-insight-auto',
      queueAgent: 'ceo',
      queueId: 'insightRoot',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: '请判断是否立项一次协议对照调研',
      bounds: '只处理本洞察员公告板候选; 是否采纳由 CEO/主管决定。',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const insightRoute = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', insightSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(insightRoute.status, 0, insightRoute.stderr || insightRoute.stdout);
    const insightEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'project-route-insight-auto');
    const insightRouted = insightEvents.find(e => e.type === 'project.routed');
    assert(insightRouted && insightRouted.queueId, 'insight project-route did not enqueue child');
    const insightChild = Q.list(artifactsDir, 'supervisor-控制台').queued.find(e => e.id === insightRouted.queueId);
    assert(insightChild, 'insight supervisor child queue entry missing');
    assert.strictEqual(insightChild.task.autoSource, 'insight-scout', 'insight autoSource must be passed to supervisor child');

    const directSuppressedSpec = path.join(root, 'direct-suppressed-spec.json');
    writeJson(directSuppressedSpec, {
      taskId: 'project-route-direct-suppressed',
      queueAgent: 'ceo',
      queueId: 'directRoot',
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: '办公室视图调整: 前端程序员做, 修改 workspace.html 布局并截图验收。',
      useOrchestrator: false,
      autoApproveHuman: true,
    });
    const directSuppressed = spawnSync(process.execPath, [path.join(__dirname, '../projects/控制台/engine-runner.js'), '--spec', directSuppressedSpec], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    assert.strictEqual(directSuppressed.status, 0, directSuppressed.stderr || directSuppressed.stdout);
    const directSuppressedEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'project-route-direct-suppressed' || e.sourceTask === 'project-route-direct-suppressed');
    assert(directSuppressedEvents.some(e => e.type === 'project.route.direct_suppressed' && e.directAgent === 'frontend_designer'), 'direct frontend route should be recorded as suppressed');
    assert(directSuppressedEvents.some(e => e.type === 'project.routed' && e.supervisorQueue === 'supervisor-控制台' && !e.direct), 'direct-like project task must be routed through supervisor review-loop');
    assert(!directSuppressedEvents.some(e => e.type === 'queue.enqueued' && e.queueAgent === 'frontend_designer'), 'project-route must not enqueue frontend_designer agent-once directly');

    console.log(JSON.stringify({ pass: true, suite: 'project-routing' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
