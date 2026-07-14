#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  const projectFilePattern = /(?:^|\/)(?:simulaid|starlaid|yuanxiao|zongzi|chang-e|doubao|kimi|元宵|嫦娥|粽子)(?:[-_/]|$)/i;
  const leakedProjectFiles = tracked.filter(file => projectFilePattern.test(file));
  assert.deepStrictEqual(leakedProjectFiles, [], 'generic distribution contains project-specific files: ' + leakedProjectFiles.join(', '));

  for (const removed of [
    '交接给claude-code',
    '玉兔搬家部署包',
    '.claude',
    'knowledge/corpus/迁移记录',
    'wiki/people',
    'wiki/migration',
    'shared/agents/board-kimi',
    'shared/agents/board-gpt55',
  ]) {
    assert(!tracked.some(file => file === removed || file.startsWith(removed + '/')), 'legacy path still tracked: ' + removed);
  }

  const criticalFiles = [
    'README.md',
    'deploy-macos.sh',
    'projects/控制台/config.json',
    'projects/控制台/runtime-paths.js',
    'projects/控制台/setup-service.js',
    'projects/控制台/project-departments.js',
    'projects/控制台/public/setup.html',
    'shared/config/machine.json',
    'shared/config/environment.md',
    'shared/config/ssh-and-remotes.md',
    'shared/capability_registry/registry.json',
    'shared/routing/runners.yaml',
    'projects/控制台/tools/version-manager.js',
    'projects/控制台/tools/install-watchdog-launchd.sh',
    'projects/控制台/tools/install-ram-watchdog-launchd.sh',
    'projects/控制台/tools/install-daily-governance-hardening-launchd.sh',
  ];
  const critical = criticalFiles.map(file => read(root, file)).join('\n');
  assert(!/\/Users\/(?:yutu6?|[^/$\s]+)\//.test(critical), 'critical distribution files contain a personal absolute path');
  const runtimeRemoteConfig = [
    read(root, 'projects/控制台/config.json'),
    read(root, 'projects/控制台/tools/version-manager.js'),
    read(root, 'shared/config/machine.json'),
  ].join('\n');
  assert(!/SongDingQing|songdingqing/.test(runtimeRemoteConfig), 'runtime release config contains a fixed repository owner');
  assert(!/BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/.test(critical), 'private key material detected');
  assert(!/127\.0\.0\.1:10808/.test(critical), 'generic launchd configuration forces a developer proxy');

  const departments = JSON.parse(read(root, 'shared/organization/system-departments.json'));
  const capabilityRegistry = JSON.parse(read(root, 'shared/capability_registry/registry.json'));
  const config = JSON.parse(read(root, 'projects/控制台/config.json'));
  assert(departments.departments.length >= 5, 'generic system departments missing');
  assert.strictEqual(departments.capabilityRegistry.path, 'shared/capability_registry/registry.json');
  const capabilityIds = new Set(capabilityRegistry.modules.map(item => item.id));
  const listedRoles = [];
  for (const department of departments.departments) {
    assert.strictEqual(department.type, 'system');
    for (const role of department.roles) {
      listedRoles.push(role);
      assert(config.roleRouting[role], 'system department role missing from roleRouting: ' + role);
      const bindings = department.capabilityBindings && department.capabilityBindings[role];
      assert(bindings && bindings.length, 'system role missing capability binding: ' + role);
      for (const capabilityId of bindings) {
        assert(capabilityIds.has(capabilityId), 'unknown capability registry id: ' + capabilityId);
      }
    }
  }
  assert.deepStrictEqual(
    [...new Set(listedRoles)].sort(),
    [...departments.requiredSystemRoles].sort(),
    'required system role set does not match department roles',
  );
  assert.strictEqual(departments.projectDepartmentTemplate.queueInitialization, 'lazy-on-first-task');

  assert(fs.existsSync(path.join(root, 'project-packs', 'README.md')));
  assert(fs.existsSync(path.join(root, 'projects', '控制台', 'public', 'setup.html')));
  assert(read(root, 'projects/控制台/public/setup.html').includes('/api/setup/providers/'));
  assert(read(root, 'projects/控制台/public/setup.html').includes('/api/projects'));
  assert(read(root, 'projects/控制台/public/setup.html').includes('进入工作区'));
  assert(read(root, 'deploy-macos.sh').includes('/setup'));
  assert.strictEqual(require('../projects/控制台/tools/version-manager').DEFAULT_REMOTE_NAME, 'origin');

  console.log(JSON.stringify({ pass: true, suite: 'generic-distribution' }));
}

main();
