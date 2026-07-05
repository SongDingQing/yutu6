'use strict';

// P0-B 热重载守卫:核心代码指纹必须在 .js 改动时变化(触发优雅重启)、在无改动时稳定(不空转重启)。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeSourceRevision, defaultReloadDirs } = require('../projects/控制台/source-revision');

function testRevisionStableThenChangesOnEdit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-rev-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = 2;\n');
    const r1 = computeSourceRevision([dir]);
    assert.strictEqual(r1, computeSourceRevision([dir]), '同样内容 → 指纹稳定,不应误触发重启');
    fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 999999;\n'); // 改内容(size 变)
    assert.notStrictEqual(r1, computeSourceRevision([dir]), '改了代码 → 指纹必须变(触发热重载)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testNonJsIgnored() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-rev-nonjs-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
    const r1 = computeSourceRevision([dir]);
    fs.writeFileSync(path.join(dir, 'runtime-artifact.log'), 'noise\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'noise\n');
    assert.strictEqual(r1, computeSourceRevision([dir]), '非 .js(运行时产物)不得影响修订指纹');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testMissingDirIsSafe() {
  const rev = computeSourceRevision([path.join(os.tmpdir(), `missing-${process.pid}-xyz`)]);
  assert.strictEqual(typeof rev, 'string');
  assert.strictEqual(rev.length, 64, '目录缺失不抛、仍返回合法指纹');
}

function testDefaultReloadDirs() {
  const dirs = defaultReloadDirs(path.join('/x', 'projects', '控制台'));
  assert(dirs.some(d => d.endsWith(path.join('shared', 'engine'))), '应含 shared/engine');
  assert(dirs.includes(path.join('/x', 'projects', '控制台')), '应含控制台目录本身');
}

function main() {
  testRevisionStableThenChangesOnEdit();
  testNonJsIgnored();
  testMissingDirIsSafe();
  testDefaultReloadDirs();
  console.log(JSON.stringify({ pass: true, suite: 'worker-code-reload' }));
}

main();
