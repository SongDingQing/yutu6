#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const skillRoot = '/Users/yutu6/.codex/skills/self-reflection-optimizer';

function read(file) {
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8');
}

function json(file) {
  return JSON.parse(read(file));
}

function main() {
  const skill = read(path.join(skillRoot, 'SKILL.md'));
  assert(skill.includes('name: self-reflection-optimizer'), 'skill frontmatter name must exist');
  assert(skill.includes('description: Use when'), 'skill must have concrete trigger description');
  assert(skill.includes('auto_execute'), 'skill must define auto_execute classification');
  assert(skill.includes('owner_decision'), 'skill must define owner_decision classification');
  assert(skill.includes('board/learning-cases/self-reflection-optimizer-cases.md'), 'skill must write reusable self-reflection cases');
  assert(skill.includes('Starlaid') && skill.includes('星桥'), 'skill must preserve Starlaid/Xingqiao exclusion');
  assert(skill.includes('secretary -> CEO -> supervisor'), 'skill must preserve front-door route');

  const policy = read(path.join(skillRoot, 'references/decision-policy.md'));
  assert(policy.includes('自动执行条件'), 'decision policy must define auto execution');
  assert(policy.includes('主人拍板条件'), 'decision policy must define owner decision');
  assert(policy.includes('案例沉淀格式'), 'decision policy must define case format');

  const trigger = read('projects/控制台/tools/self-reflection-trigger.js');
  assert(trigger.includes('queue-enqueue'), 'trigger must enqueue through secretary-tools');
  assert(trigger.includes('secretary'), 'trigger must route through secretary');
  assert(trigger.includes('trigger-state.json'), 'trigger must keep idempotency state');
  assert(trigger.includes('extractCaseEntry'), 'trigger must hash an individual case entry');
  assert(trigger.includes('self_reflection.triggered'), 'trigger must write event log');

  function triggerDryRun(source, moduleName = 'ui-optimizer') {
    return spawnSync(process.execPath, [
      path.join(root, 'projects/控制台/tools/self-reflection-trigger.js'),
      '--dry-run',
      '--source', source,
      '--module', moduleName,
      '--reason', 'test',
    ], { cwd: root, encoding: 'utf8' });
  }

  const dry = triggerDryRun('board/learning-cases/self-reflection-optimizer-cases.md');
  assert.strictEqual(dry.status, 0, dry.stderr || dry.stdout);
  const dryJson = JSON.parse(dry.stdout);
  assert.strictEqual(dryJson.ok, true, 'dry-run trigger must report ok');
  assert.strictEqual(dryJson.dryRun, true, 'dry-run must not enqueue');
  assert.strictEqual(dryJson.module, 'ui-optimizer', 'dry-run must keep module');
  assert(dryJson.queueId && dryJson.queueId.startsWith('self-reflect-'), 'dry-run must compute queue id');
  assert(dryJson.case && dryJson.case.title, 'dry-run must expose selected case entry');
  assert.strictEqual(String(dryJson.hash || '').length, 64, 'dry-run hash must be case-entry sha256');
  assert.strictEqual(String(dryJson.sourceHash || '').length, 64, 'dry-run must still expose source file hash for auditing');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-reflection-case-hash-'));
  try {
    const tmpCase = path.join(tmpDir, 'cases.md');
    const latestCase = [
      '## 2026-07-01 · Latest stable case',
      '- 来源: tmp',
      '- 场景: latest',
      '- 现象: latest entry stays unchanged',
      '- 根因/判断: only the latest entry should define trigger identity',
      '- 改法: hash the selected case entry',
      '- 验证: dry-run hash comparison',
      '- 可复用原则: file-level churn must not retrigger the same case',
      '',
    ].join('\n');
    fs.writeFileSync(tmpCase, [
      '# Cases',
      '',
      '## Older case',
      '- 来源: tmp-old',
      '- 场景: before',
      '',
      latestCase,
    ].join('\n'));
    const first = triggerDryRun(tmpCase, 'page-agent-token-architecture');
    assert.strictEqual(first.status, 0, first.stderr || first.stdout);
    const firstJson = JSON.parse(first.stdout);
    fs.writeFileSync(tmpCase, [
      '# Cases',
      '',
      '## Older case',
      '- 来源: tmp-old',
      '- 场景: changed text that should not matter',
      '',
      latestCase,
    ].join('\n'));
    const second = triggerDryRun(tmpCase, 'page-agent-token-architecture');
    assert.strictEqual(second.status, 0, second.stderr || second.stdout);
    const secondJson = JSON.parse(second.stdout);
    assert.notStrictEqual(secondJson.sourceHash, firstJson.sourceHash, 'full file hash should notice unrelated file churn');
    assert.strictEqual(secondJson.hash, firstJson.hash, 'case-entry hash must stay stable when the selected case is unchanged');
    assert.strictEqual(secondJson.queueId, firstJson.queueId, 'queue id must be derived from the selected case entry');
    assert.strictEqual(secondJson.case.title, '2026-07-01 · Latest stable case');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const titleDry = spawnSync(process.execPath, [
    path.join(root, 'projects/控制台/tools/self-reflection-trigger.js'),
    '--dry-run',
    '--source', 'board/learning-cases/self-reflection-optimizer-cases.md',
    '--module', 'ui-optimizer',
    '--case-title', dryJson.case.title,
    '--reason', 'test',
  ], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(titleDry.status, 0, titleDry.stderr || titleDry.stdout);
  assert.strictEqual(JSON.parse(titleDry.stdout).hash, dryJson.hash, 'explicit case title must select the same entry');

  const loop = read('shared/agents/ui-optimizer/loop.sh');
  assert(loop.includes('self-reflection-trigger.js'), 'ui optimizer loop must call self-reflection trigger');
  assert(loop.includes('trigger_self_reflection_from_case'), 'ui optimizer loop must define trigger function');

  const readme = read('board/learning-cases/README.md');
  assert(readme.includes('self-reflection-optimizer-cases.md'), 'learning cases README must list self-reflection cases');
  assert(readme.includes('self-reflection-trigger.js'), 'learning cases README must document auto trigger');

  const secretaryTools = read('projects/控制台/secretary-tools.js');
  assert(secretaryTools.includes("['self-reflection-optimizer-cases'"), 'secretary context must include self-reflection cases');

  const registry = json('shared/capability_registry/registry.json');
  const found = (registry.modules || []).find(m => m.id === 'self-reflection-optimizer');
  assert(found, 'capability registry must include self-reflection optimizer');
  assert.strictEqual(found.status, 'present_in_workspace', 'registry status must be present_in_workspace');
  assert(found.path === 'shared/capability_registry/modules/self-reflection-optimizer', 'registry path must be module path');

  const moduleJson = json('shared/capability_registry/modules/self-reflection-optimizer/module.json');
  assert.strictEqual(moduleJson.id, 'self-reflection-optimizer', 'module.json id must match');
  assert((moduleJson.authorized_agents || []).includes('secretary'), 'secretary must be authorized');
  assert((moduleJson.authorized_agents || []).includes('ceo'), 'ceo must be authorized');

  console.log('self-reflection-optimizer ok');
}

main();
