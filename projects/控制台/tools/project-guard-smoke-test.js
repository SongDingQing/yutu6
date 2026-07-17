#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { keywordProjectId } = require('../project-guard');

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
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function setupHarness() {
  for (const project of ['控制台', 'Simulaid']) {
    const dir = path.join(projectsDir, project);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'brief.md'), `# ${project} project route smoke\n`);
    fs.writeFileSync(path.join(dir, 'status.md'), `# ${project} project route status\n`);
  }
  writeJson(configPath, {
    roleRouting: {
      orchestrator: { runner: 'mock' },
      supervisor: { runner: 'mock' },
      worker_code: { runner: 'mock' },
      quality_ops: { runner: 'mock' },
      board_deepseek: { runner: 'mock' },
      board_glm52: { runner: 'mock' },
      board_gpt55: { runner: 'mock' },
      board_opus48: { runner: 'mock' },
    },
    runners: {
      mock: {
        label: 'Project Route Smoke Mock',
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

function spec(name, goal, projectId) {
  const value = {
    taskId: `route-${name}-${stamp}`,
    queueAgent: 'ceo',
    queueId: `route${name}`,
    role: 'orchestrator',
    flowId: 'project-route',
    goal,
    bounds: '只处理本任务;密钥不回显;高危操作先确认',
    acceptance: 'project route smoke completes or safely pauses',
    useOrchestrator: false,
    autoApproveHuman: true,
  };
  if (projectId) value.projectId = projectId;
  return value;
}

function main() {
  setupHarness();
  assert.strictEqual(keywordProjectId('修复控制台队列'), '控制台');
  assert.strictEqual(keywordProjectId('构建 Simulaid 团结工程'), 'Simulaid');
  assert.strictEqual(keywordProjectId('整理一个尚未登记的新项目'), null);

  const inferred = runEngine(spec('inferred', '修复控制台队列并运行 smoke'), 'inferred');
  assert.strictEqual(inferred.status, 0, inferred.stderr || inferred.stdout);

  const explicit = runEngine(spec('explicit', '执行已确认的项目任务', 'Simulaid'), 'explicit');
  assert.strictEqual(explicit.status, 0, explicit.stderr || explicit.stdout);

  const unknown = runEngine(spec('unknown', '整理一个尚未登记的新项目', '不存在的项目'), 'unknown');
  assert.strictEqual(unknown.status, 5, unknown.stderr || unknown.stdout);

  const events = readEvents();
  assert(events.some(e => e.type === 'project.routed' && e.task === `route-inferred-${stamp}` && e.projectId === '控制台'));
  assert(events.some(e => e.type === 'project.routed' && e.task === `route-explicit-${stamp}` && e.projectId === 'Simulaid'));
  assert(events.some(e => e.type === 'project.route.paused' && e.task === `route-unknown-${stamp}`));
  assert(!events.some(e => e.type === 'task.failed' && e.task === `route-unknown-${stamp}`));

  console.log(JSON.stringify({ pass: true, runRoot }, null, 2));
}

main();
