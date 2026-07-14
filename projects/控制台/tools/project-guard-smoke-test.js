#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { hasActiveUnregisteredProjectReference } = require('../project-guard');

const ROOT = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const runRoot = path.join(ROOT, 'artifacts', 'project-guard-smoke', stamp);
const artifactsDir = path.join(runRoot, 'artifacts');
const projectsDir = path.join(runRoot, 'projects');
const configPath = path.join(runRoot, 'config.json');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readEvents() {
  const file = path.join(artifactsDir, 'engine-events.jsonl');
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function setupHarness() {
  fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
  fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# project guard smoke brief\n');
  fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# project guard smoke status\n');
  writeJson(configPath, {
    roleRouting: {
      orchestrator: { runner: 'mock' },
      supervisor: { runner: 'mock' },
      worker_code: { runner: 'mock' },
      quality_ops: { runner: 'mock' },
      board_deepseek: { runner: 'mock' },
      board_glm52: { runner: 'mock' },
      board_opus48: { runner: 'mock' },
    },
    runners: {
      mock: {
        label: 'Project Guard Smoke Mock',
        cmd: [process.execPath, '-e', 'process.stdout.write("{}\\n")'],
        promptVia: 'arg',
      },
    },
  });
}

function runEngine(spec, name) {
  const specFile = path.join(runRoot, `${name}.json`);
  writeJson(specFile, spec);
  return spawnSync(process.execPath, [path.join(ROOT, 'engine-runner.js'), '--spec', specFile], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: artifactsDir,
      CONSOLE_CONFIG_PATH: configPath,
      CONSOLE_PROJECTS_DIR: projectsDir,
      AUTO_REPAIR_ENABLED: '0',
    }),
    encoding: 'utf8',
  });
}

function main() {
  setupHarness();

  assert.strictEqual(hasActiveUnregisteredProjectReference('边界: 未登记项目一律排除; 密钥不回显'), false);
  assert.strictEqual(hasActiveUnregisteredProjectReference('CEO plan 红线复述: 如果涉及 unknown project 就停止不处理'), false);
  assert.strictEqual(hasActiveUnregisteredProjectReference('诊断: inferProjectId 会拒绝未注册项目'), false);
  assert.strictEqual(hasActiveUnregisteredProjectReference('目标: 修复未登记项目的构建脚本'), true);
  assert.strictEqual(hasActiveUnregisteredProjectReference('Goal: build unknown project scripts'), true);

  const redlineGoal = [
    '修引擎项目归属判断,确保记忆集成、维修机制、Git 远端接入等系统级任务可路由。',
    '边界:只处理 projects/控制台/ 与明确输入; 未登记项目一律排除; 密钥不回显; 登录/授权交主人手动。',
    'CEO plan 红线复述: 如果涉及未注册项目,立即停止并不处理。',
  ].join('\n');

  const allowed = runEngine({
    taskId: `guard-allowed-${stamp}`,
    queueAgent: 'ceo',
    queueId: 'guardAllowed',
    role: 'orchestrator',
    flowId: 'project-route',
    projectId: '控制台',
    goal: redlineGoal,
    bounds: '只处理本任务; 未登记项目一律排除; 密钥不回显',
    acceptance: 'project guard smoke allowed',
    useOrchestrator: false,
    autoApproveHuman: true,
  }, 'allowed');
  assert.strictEqual(allowed.status, 0, allowed.stderr || allowed.stdout);

  const blocked = runEngine({
    taskId: `guard-blocked-${stamp}`,
    queueAgent: 'ceo',
    queueId: 'guardBlocked',
    role: 'orchestrator',
    flowId: 'project-route',
    goal: '目标: 修复未登记项目的构建脚本并运行测试。',
    bounds: '只处理本任务; 密钥不回显',
    acceptance: 'project guard smoke blocked',
    useOrchestrator: false,
    autoApproveHuman: true,
  }, 'blocked');
  assert.strictEqual(blocked.status, 5, blocked.stderr || blocked.stdout);

  const explicitActive = runEngine({
    taskId: `guard-explicit-${stamp}`,
    queueAgent: 'ceo',
    queueId: 'guardExplicit',
    role: 'orchestrator',
    flowId: 'project-route',
    projectId: '控制台',
    goal: '目标: 修复未登记项目的构建脚本并运行测试。',
    bounds: '只处理本任务; 密钥不回显',
    acceptance: 'project guard smoke explicit projectId wins',
    useOrchestrator: false,
    autoApproveHuman: true,
  }, 'explicit');
  assert.strictEqual(explicitActive.status, 0, explicitActive.stderr || explicitActive.stdout);

  const events = readEvents();
  assert(events.some(e => e.type === 'project.routed' && e.projectId === '控制台' && e.queueId), 'allowed task was not routed to 控制台');
  assert(events.some(e => e.type === 'project.route.paused' && e.task === `guard-blocked-${stamp}`), 'blocked task did not soft pause in project-route');
  assert(events.some(e => e.type === 'engine.worker.end' && e.task === `guard-blocked-${stamp}` && e.paused === true), 'blocked task did not end as paused');
  assert(!events.some(e => e.type === 'task.failed' && e.task === `guard-blocked-${stamp}`), 'soft-paused route must not emit task.failed');
  assert(events.some(e => e.type === 'project.routed' && e.task === `guard-explicit-${stamp}` && e.projectId === '控制台'), 'explicit projectId did not route to 控制台');

  console.log(JSON.stringify({ pass: true, runRoot }, null, 2));
}

main();
