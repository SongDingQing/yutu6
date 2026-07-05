#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(read(path.join(root, 'projects/控制台/config.json')));
  const policy = config.frontDoorPolicy || {};
  assert.strictEqual(policy.enabled, true, 'frontDoorPolicy must be enabled');
  assert.strictEqual(policy.defaultIntakeAgent, 'secretary', 'default intake agent must be secretary');
  assert.strictEqual(policy.defaultIntakeRole, 'secretary', 'default intake role must be secretary');
  assert.deepStrictEqual(policy.normalTaskRoute.slice(0, 3), ['chairman', 'secretary', 'ceo'], 'normal tasks must route chairman -> secretary -> ceo');
  assert(policy.repairTaskRoute.includes('repair-lead'), 'repair tasks must route to repair-lead');
  assert.strictEqual(config.roleRouting.secretary.runner, 'claude', 'secretary front door runs on Claude Code (2026-07-03 owner decision)');
  assert.strictEqual(config.roleRouting.orchestrator.runner, 'codex', 'CEO/orchestrator must remain executable through codex');

  const secretaryPrompt = read(path.join(root, 'shared/agents/secretary/prompt.md'));
  assert(/后续老板传递的任务/.test(secretaryPrompt), 'secretary prompt must persist owner front-door decision');
  assert(/不涉及维修/.test(secretaryPrompt) && /CEO/.test(secretaryPrompt), 'secretary prompt must send non-repair work to CEO');
  assert(!/纯桌面\/点击任务可派给对应专职队列/.test(secretaryPrompt), 'secretary prompt must not allow normal desktop work to bypass CEO');

  const ceoPrompt = read(path.join(root, 'shared/agents/orchestrator/prompt.md'));
  assert(/接收秘书转交/.test(ceoPrompt), 'CEO prompt must state secretary handoff');
  assert(/维修部门/.test(ceoPrompt), 'CEO prompt must exclude repair work from ordinary routing');

  const server = read(path.join(root, 'projects/控制台/server.js'));
  assert(/frontDoorPolicy/.test(server), 'server /api/runners must expose frontDoorPolicy');
  assert(/秘书补全 -> CEO 决策/.test(server), 'secretary web prompt must enforce secretary -> CEO route');

  const worker = read(path.join(root, 'projects/控制台/ceo-worker.js'));
  assert(/非维修任务一律转 CEO 决策/.test(worker), 'secretary queue envelope must enforce CEO route');

  const workspace = read(path.join(root, 'projects/控制台/public/workspace.html'));
  assert(/sel\.value='secretary'/.test(workspace), 'workspace dispatch default must remain secretary');

  console.log('front-door-policy ok');
}

main();
