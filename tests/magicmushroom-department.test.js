#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAgents, extractRoles, extractRunnerIds, validateAgent } = require('../shared/engine/agents');
const { keywordProjectId } = require('../projects/控制台/project-guard');
const engine = require('../projects/控制台/engine-runner')._test;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const root = path.resolve(__dirname, '..');
  const config = readJson(path.join(root, 'projects/控制台/config.json'));
  const team = readJson(path.join(root, 'projects/MagicMushroom/team.json'));
  const agents = loadAgents(path.join(root, 'shared/agents'));
  const roles = extractRoles(fs.readFileSync(path.join(root, 'shared/routing/model-routing.yaml'), 'utf8'));
  const runners = extractRunnerIds(fs.readFileSync(path.join(root, 'shared/routing/runners.yaml'), 'utf8'));
  const ctx = { root, roles, runners };

  assert.strictEqual(team.projectId, 'MagicMushroom');
  assert.strictEqual(team.repositoryPath, '/Users/yutu6/UnityProject/MagicMushroom');
  assert.strictEqual(team.unityVersion, '6000.3.16f1');
  assert.strictEqual(team.roles.supervisor, 'magicmushroom_supervisor');
  assert.strictEqual(team.roles.programmer, 'magicmushroom_programmer');

  assert.strictEqual(keywordProjectId('MagicMushroom Unity 6 工程任务'), 'MagicMushroom');
  assert.strictEqual(keywordProjectId('/Users/yutu6/UnityProject/MagicMushroom'), 'MagicMushroom');
  assert.strictEqual(keywordProjectId('Simulaid 团结工程任务'), 'Simulaid');

  const department = config.projectDepartments && config.projectDepartments.MagicMushroom;
  assert(department, 'MagicMushroom project department must be configured');
  assert.strictEqual(department.supervisorRole, 'magicmushroom_supervisor');
  assert.strictEqual(department.programmerRole, 'magicmushroom_programmer');

  const supervisor = agents.find(agent => agent.id === 'magicmushroom-supervisor');
  const programmer = agents.find(agent => agent.id === 'magicmushroom-programmer');
  assert(supervisor, 'MagicMushroom supervisor agent missing');
  assert(programmer, 'MagicMushroom programmer agent missing');
  assert.strictEqual(supervisor.runner, 'codex');
  assert.strictEqual(programmer.runner, 'codex');
  assert.strictEqual(supervisor.project_scope, 'MagicMushroom');
  assert.strictEqual(programmer.project_scope, 'MagicMushroom');
  assert.deepStrictEqual(validateAgent(supervisor, ctx), []);
  assert.deepStrictEqual(validateAgent(programmer, ctx), []);

  const selected = engine.promptSelectionForSpec({
    flowId: 'review-loop',
    projectId: 'MagicMushroom',
    useOrchestrator: false,
  });
  assert.deepStrictEqual(
    [...selected.roles].sort(),
    ['magicmushroom_programmer', 'magicmushroom_supervisor'],
    'MagicMushroom review-loop must load dedicated prompts',
  );

  const baseFlow = {
    id: 'review-loop',
    nodes: [
      { id: 'implement', agent_role: 'worker_code' },
      { id: 'review', agent_role: 'supervisor' },
    ],
  };
  const mapped = engine.applyProjectDepartmentRoles(baseFlow, config, { projectId: 'MagicMushroom' });
  assert.strictEqual(mapped.nodes[0].agent_role, 'magicmushroom_programmer');
  assert.strictEqual(mapped.nodes[1].agent_role, 'magicmushroom_supervisor');
  assert.strictEqual(baseFlow.nodes[0].agent_role, 'worker_code', 'role mapping must not mutate shared flow');

  const server = require('../projects/控制台/server');
  const queueAgents = server.configuredQueueAgents();
  const projectSupervisor = queueAgents.find(agent => agent.id === 'supervisor-MagicMushroom');
  const projectProgrammer = queueAgents.find(agent => agent.id === 'magicmushroom_programmer');
  assert(projectSupervisor, 'MagicMushroom supervisor queue must be discoverable');
  assert.strictEqual(projectSupervisor.role, 'magicmushroom_supervisor');
  assert.strictEqual(projectSupervisor.projectId, 'MagicMushroom');
  assert(projectProgrammer, 'MagicMushroom programmer queue must be discoverable');
  assert.strictEqual(projectProgrammer.projectId, 'MagicMushroom');
  assert(!queueAgents.some(agent => agent.id === 'magicmushroom_supervisor'), 'dedicated supervisor role must not create a duplicate queue');

  const repo = team.repositoryPath;
  if (fs.existsSync(repo)) {
    const versionFile = path.join(repo, 'ProjectSettings/ProjectVersion.txt');
    assert(fs.readFileSync(versionFile, 'utf8').includes('m_EditorVersion: 6000.3.16f1'));
  }

  console.log(JSON.stringify({ pass: true, suite: 'magicmushroom-department' }));
}

main();
