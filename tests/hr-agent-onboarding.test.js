#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HR = require('../projects/控制台/tools/hr-agent-onboarding');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const low = HR.validateSpec({
    id: 'hr-test-agent',
    name: 'HR Test Agent',
    role: 'hr_test_agent',
    ownership: 'HR',
    capability: '验证 HR 入职流程。',
    runner: 'zhipu-glm',
    read_paths: ['shared/DATA-MAP.md'],
    writes: ['shared/agents/hr-test-agent/'],
  });
  assert.strictEqual(low.four_elements.pass, true);
  assert.strictEqual(low.risk.level, 'low');
  assert(low.rendered.prompt_md.includes('shared/DATA-MAP.md'), 'rendered prompt must include data map');

  const missing = HR.validateSpec({
    id: 'bad-agent',
    name: 'Bad Agent',
    role: 'bad_agent',
    runner: 'zhipu-glm',
  });
  assert.strictEqual(missing.four_elements.pass, false);
  assert(missing.four_elements.missing.includes('归属'));
  assert(missing.four_elements.missing.includes('能力'));
  assert(missing.four_elements.missing.includes('文件权限'));

  const high = HR.validateSpec({
    id: 'danger-agent',
    name: 'Danger Agent',
    role: 'danger_agent',
    ownership: '控制台',
    capability: '改核心引擎。',
    runner: 'codex',
    read_paths: ['shared/engine/'],
    writes: ['shared/engine/engine.js'],
  });
  assert.strictEqual(high.risk.level, 'high');
  assert.strictEqual(high.risk.approval_required, true);

  const smoke = HR.smoke();
  assert.strictEqual(smoke.pass, true, JSON.stringify(smoke, null, 2));
  assert(smoke.flow.includes('四要素校验'));
  assert(smoke.flow.includes('smoke校验'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-test-'));
  const specFile = path.join(tmp, 'spec.json');
  writeJson(specFile, {
    id: 'hr-cli-agent',
    name: 'HR CLI Agent',
    role: 'hr_cli_agent',
    ownership: 'HR',
    capability: '验证 CLI validate。',
    runner: 'zhipu-glm',
    read_paths: ['shared/DATA-MAP.md'],
    writes: ['shared/agents/hr-cli-agent/'],
  });
  const cli = spawnSync(process.execPath, ['projects/控制台/tools/hr-agent-onboarding.js', 'validate', '--spec', specFile], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
  const parsed = JSON.parse(cli.stdout);
  assert.strictEqual(parsed.pass, true);

  console.log(JSON.stringify({ pass: true, suite: 'hr-agent-onboarding' }));
}

main();
