#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function run(cmd, args, cwd, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: Object.assign({}, process.env, env),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return String(result.stdout || '').trim();
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-auto-push-'));
  const remote = path.join(temp, 'remote.git');
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  run('git', ['init', '--bare', remote], temp);
  run('git', ['init', '-b', 'main'], repo);
  run('git', ['config', 'user.name', 'Yutu6 Test'], repo);
  run('git', ['config', 'user.email', 'test@yutu6.local'], repo);
  run('git', ['remote', 'add', 'github', remote], repo);
  run('git', ['config', 'core.hooksPath', '.githooks'], repo);
  run('git', ['config', 'yutu6.autoPush', 'true'], repo);
  run('git', ['config', 'yutu6.autoPushRemote', 'github'], repo);

  fs.mkdirSync(path.join(repo, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'security'), { recursive: true });
  fs.copyFileSync(path.join(root, '.githooks', 'post-commit'), path.join(repo, '.githooks', 'post-commit'));
  fs.copyFileSync(path.join(root, 'security', 'git-auto-push.sh'), path.join(repo, 'security', 'git-auto-push.sh'));
  fs.chmodSync(path.join(repo, '.githooks', 'post-commit'), 0o755);
  fs.chmodSync(path.join(repo, 'security', 'git-auto-push.sh'), 0o755);

  fs.writeFileSync(path.join(repo, 'first.txt'), 'first\n');
  run('git', ['add', 'first.txt'], repo);
  run('git', ['commit', '-m', 'first'], repo);
  const first = run('git', ['rev-parse', 'HEAD'], repo);
  assert.strictEqual(run('git', ['rev-parse', 'refs/heads/main'], remote), first);

  run('git', ['config', 'yutu6.autoPush', 'false'], repo);
  fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n');
  run('git', ['add', 'second.txt'], repo);
  run('git', ['commit', '-m', 'second'], repo);
  assert.strictEqual(run('git', ['rev-parse', 'refs/heads/main'], remote), first,
    'disabled auto-push must leave the remote unchanged');

  console.log('git-auto-push tests passed');
}

main();
