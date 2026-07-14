#!/usr/bin/env node
'use strict';

// 任务4 守卫:版本历史从 VERSION.json 的 git 提交历史构建(含手动 bump)。
// 断言:版本号/时间/描述解析、同版本去重、按前两段分组字段、描述清洗。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VM = require('../projects/控制台/tools/version-manager');

function git(root, args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8' }); }

function commitVersion(root, version, subject) {
  fs.writeFileSync(path.join(root, 'VERSION.json'), JSON.stringify({ version, last_change: { summary: subject } }) + '\n');
  git(root, ['add', 'VERSION.json']);
  git(root, ['commit', '-q', '-m', subject]);
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-hist-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['remote', 'add', 'origin', 'git@github.com:example/yutu6.git']);
  commitVersion(root, '0.0.0.1', 'v0.0.0.1 接入版本管理');
  commitVersion(root, '0.0.0.2', '链路图改真实图片 → 0.0.0.2');
  commitVersion(root, '0.0.1.0', 'v0.0.1.0(minor): 稳定性批次');
  commitVersion(root, '0.0.1.0', '0.0.1.0 补一次提交(同版本)'); // 同版本两次提交 → 去重
  commitVersion(root, '0.1.0.0', 'v0.1.0.0(major): 通用系统部门');
  return root;
}

function testHistoryParsing() {
  const root = setupRepo();
  try {
    const h = VM.versionHistory(root, { limit: 50 });
    // 时间倒序:最新的 0.1.0.0 在最前
    assert.strictEqual(h[0].version, '0.1.0.0', '应时间倒序,最新在前');
    // 同版本去重:0.0.1.0 只出现一次
    const v010 = h.filter(e => e.version === '0.0.1.0');
    assert.strictEqual(v010.length, 1, '同版本多次提交应去重');
    // 分组字段 = 前两段
    assert.strictEqual(h[0].group, '0.1', '0.1.0.0 → group 0.1');
    assert.strictEqual(v010[0].group, '0.0', '0.0.1.0 → group 0.0');
    // 描述清洗:去掉版本号前后缀
    const top = h[0];
    assert(!/0\.1\.0\.0/.test(top.desc), '描述应清掉版本号: ' + top.desc);
    assert(/通用系统部门/.test(top.desc), '描述应保留正文: ' + top.desc);
    // commitUrl 从当前 origin 派生,不依赖内置账号。
    assert.strictEqual(top.commitUrl.startsWith('https://github.com/example/yutu6/commit/'), true, 'commitUrl 应从 origin 派生');
    // 时间字段存在且可解析
    assert(top.at && !isNaN(new Date(top.at).getTime()), 'at 应为可解析时间');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testEmptyRepoSafe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-hist-empty-'));
  try {
    git(root, ['init', '-q']);
    const h = VM.versionHistory(root, { limit: 10 });
    assert(Array.isArray(h) && h.length === 0, '无 VERSION.json 提交 → 空数组,不抛错');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testCleanDesc() {
  assert.strictEqual(VM.cleanVersionDesc('飞书三类交互(任务11): 提问 → 0.0.4.5'), '飞书三类交互(任务11): 提问');
  assert.strictEqual(VM.cleanVersionDesc('v0.0.2.3(minor): 维修主管批次'), '维修主管批次');
  assert.strictEqual(VM.cleanVersionDesc('0.0.1.0: 普通描述'), '普通描述');
}

function main() {
  testHistoryParsing();
  testEmptyRepoSafe();
  testCleanDesc();
  console.log(JSON.stringify({ pass: true, suite: 'version-history' }));
}

main();
