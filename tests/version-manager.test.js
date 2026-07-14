#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const VersionManager = require('../projects/控制台/tools/version-manager');

function git(root, args) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  return res.stdout.trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function main() {
  assert.strictEqual(VersionManager.bumpVersion('0.0.0.0', 'fix'), '0.0.0.1');
  assert.strictEqual(VersionManager.bumpVersion('0.0.0.99', 'fix'), '0.0.1.0');
  assert.strictEqual(VersionManager.bumpVersion('0.0.99.99', 'fix'), '0.1.0.0');
  assert.strictEqual(VersionManager.bumpVersion('0.99.99.99', 'fix'), '1.0.0.0');
  assert.throws(() => VersionManager.bumpVersion('99.99.99.99', 'fix'), /overflow/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-manager-test-'));
  try {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'Version Test']);
    git(root, ['config', 'user.email', 'version-test@example.invalid']);
    write(path.join(root, 'README.md'), '# tmp\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-m', 'init']);

    write(path.join(root, 'feature.txt'), 'one\n');
    const remoteDryRun = VersionManager.release({
      root,
      part: 'fix',
      message: '远程 dry-run',
      path: 'feature.txt',
      dryRun: true,
    });
    assert.strictEqual(remoteDryRun.dryRun, true);
    assert.strictEqual(remoteDryRun.remote.action, 'missing');
    assert.strictEqual(remoteDryRun.remote.webUrl, null);
    assert.strictEqual(remoteDryRun.remote.url, '');
    assert.strictEqual(git(root, ['remote']), '');

    const first = VersionManager.release({
      root,
      part: 'fix',
      message: '初始版本管理',
      path: 'feature.txt',
      noRemote: true,
    });
    assert.strictEqual(first.nextVersion, '0.0.0.1');
    assert.strictEqual(first.committed, true);
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');
    assert(/^v0\.0\.0\.1 初始版本管理/.test(git(root, ['log', '-1', '--format=%s'])));

    write(path.join(root, 'feature.txt'), 'two\n');
    const second = VersionManager.release({
      root,
      part: 'minor',
      message: '小功能改动',
      path: 'feature.txt',
      noRemote: true,
    });
    assert.strictEqual(second.nextVersion, '0.0.1.1');

    const dryRun = VersionManager.rollback({ root, target: '0.0.0.1', dryRun: true });
    assert.strictEqual(dryRun.dryRun, true);
    assert.strictEqual(dryRun.commitsToRevert, 1);
    assert.strictEqual(dryRun.nextVersion, '1.0.1.1');

    write(path.join(root, 'secretary-tools.js'), 'console.log("ok");\n');
    const allowedSecretary = VersionManager.release({
      root,
      part: 'fix',
      message: '允许秘书工具文件',
      path: 'secretary-tools.js',
      noRemote: true,
    });
    assert.strictEqual(allowedSecretary.nextVersion, '0.0.1.2');

    const beforeSensitiveVersion = VersionManager.readVersionState(root).version;
    assert.throws(() => VersionManager.release({
      root,
      part: 'fix',
      message: '拒绝敏感文件',
      path: '.env',
      noRemote: true,
    }), /sensitive path/);
    assert.strictEqual(VersionManager.readVersionState(root).version, beforeSensitiveVersion);

    write(path.join(root, 'admin.env'), 'TOKEN=secret\n');
    assert.throws(() => VersionManager.release({
      root,
      part: 'fix',
      message: '拒绝 env 后缀',
      path: 'admin.env',
      noRemote: true,
    }), /sensitive path/);
    assert.strictEqual(VersionManager.readVersionState(root).version, beforeSensitiveVersion);

    write(path.join(root, 'safe.txt'), 'safe\n');
    assert.throws(() => VersionManager.release({
      root,
      part: 'fix',
      message: '拒绝 all 混入敏感文件',
      all: true,
      noRemote: true,
    }), /refuse --all with sensitive path/);
    assert.strictEqual(VersionManager.readVersionState(root).version, beforeSensitiveVersion);

    console.log(JSON.stringify({ pass: true, suite: 'version-manager' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
