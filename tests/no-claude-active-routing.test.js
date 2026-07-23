#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BoardReview = require('../projects/控制台/board-review');
const Failover = require('../shared/routing/failover');
const { loadAgents } = require('../shared/engine/agents');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(read(path.join(root, 'projects/控制台/config.json')));
  const machine = JSON.parse(read(path.join(root, 'shared/config/machine.json')));
  const modelRouting = read(path.join(root, 'shared/routing/model-routing.yaml'));
  const runnerRegistry = read(path.join(root, 'shared/routing/runners.yaml'));
  const workspace = read(path.join(root, 'projects/控制台/public/workspace.html'));
  const agents = loadAgents(path.join(root, 'shared/agents'));

  const activeRoleRunners = Object.entries(config.roleRouting || {})
    .map(([role, route]) => ({ role, runner: String(route && route.runner || '') }));
  assert(!activeRoleRunners.some(item => /^claude(?:-|$)/i.test(item.runner)), 'active roleRouting contains a Claude runner');
  assert(!Object.keys(config.runners || {}).some(id => /^claude(?:-|$)/i.test(id)), 'config registers a Claude runner');
  assert(!Object.values(config.runners || {}).some(def => (def.cmd || []).some(part => /(?:^|\/)claude$/i.test(String(part)))), 'runner command invokes Claude CLI');

  for (const id of ['codex', 'codex-privileged']) {
    const command = config.runners[id] && config.runners[id].cmd || [];
    const modelIndex = command.indexOf('--model');
    assert(modelIndex >= 0 && command[modelIndex + 1] === 'gpt-5.6-sol', `${id} must pin gpt-5.6-sol`);
  }

  assert(!BoardReview.DIRECTORS.some(director => /claude/i.test(`${director.id} ${director.role} ${director.runner} ${director.model}`)), 'active board contains Claude');
  assert(!agents.some(agent => /claude/i.test(`${agent.id} ${agent.role} ${agent.runner}`)), 'active agent registry contains Claude');
  assert(!/subscription\.claude/.test(modelRouting), 'model routing contains Claude subscription');
  assert(!/^\s{2}board_claude:/m.test(modelRouting), 'model routing contains Claude board role');
  assert(!/^\s*-\s+id:\s+claude(?:-|$)/mi.test(runnerRegistry), 'runner registry contains Claude runner');
  assert.strictEqual(Failover.preferTokenToRunnerId('subscription.claude'), null, 'Claude failover token must not resolve');
  assert.strictEqual(machine.runners.front_door, 'codex', 'machine front door must be Codex');
  assert(!machine.runners.claude && !machine.runners['claude-code'], 'machine config contains Claude runner');

  const boardIds = workspace.match(/const BOARD_DIRECTOR_IDS=\[([^\]]*)\]/);
  assert(boardIds && !/board_claude/.test(boardIds[1]), 'workspace active board list contains Claude');

  console.log(JSON.stringify({
    pass: true,
    suite: 'no-claude-active-routing',
    model: 'gpt-5.6-sol',
    boardDirectors: BoardReview.DIRECTORS.map(director => director.id),
  }));
}

main();
