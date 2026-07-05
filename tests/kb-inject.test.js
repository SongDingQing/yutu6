#!/usr/bin/env node
'use strict';

// 知识库打通 守卫:cli-runner fetchKbContext 把 query.py --json 的检索结果注入信封,
// 且任何失败/空/关闭都静默降级返空(绝不阻断信封组装)。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { fetchKbContext, buildEnvelope } = require('../shared/engine/cli-runner');

const pyOk = (() => {
  try { return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0; }
  catch (_) { return false; }
})();

// 造一个临时 workspaceRoot:knowledge/query.py(python stub) + knowledge/kb.sqlite(占位)
function makeKbRoot(queryPyBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-inject-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'query.py'), queryPyBody);
  fs.writeFileSync(path.join(root, 'knowledge', 'kb.sqlite'), 'x'); // 仅需存在
  return root;
}

const HIT_STUB = [
  'import sys, json',
  'q = [a for a in sys.argv[1:] if not a.startswith("--")][0]',
  'print(json.dumps({"ok": True, "query": q, "mode": "fts", "hits": [',
  '  {"path": "templates/office.md", "text": "办公室椅子提示词模板 #C00000 微软雅黑"},',
  '  {"path": "rules/brand.md", "text": "品牌主色 红 #C00000"}',
  '], "entities": [{"name": "yuhua", "type": "style"}]}, ensure_ascii=False))',
].join('\n');

const EMPTY_STUB = 'import sys, json\nprint(json.dumps({"ok": True, "hits": [], "mode": "fts"}))';
const ERR_STUB = 'import sys\nsys.exit(1)';

function withEnv(val, fn) {
  const prev = process.env.YUTU6_KB_INJECT;
  if (val === undefined) delete process.env.YUTU6_KB_INJECT; else process.env.YUTU6_KB_INJECT = val;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.YUTU6_KB_INJECT; else process.env.YUTU6_KB_INJECT = prev;
  }
}

function testInjectsHits() {
  if (!pyOk) { console.error('  (skip: python3 不可用)'); return; }
  const root = makeKbRoot(HIT_STUB);
  try {
    const block = withEnv(undefined, () => fetchKbContext({ workspaceRoot: root, goal: '生成办公室椅子图' }));
    assert(/知识库检索/.test(block), '应注入知识库检索块: ' + JSON.stringify(block));
    assert(/办公室椅子提示词模板/.test(block), '应含命中文本');
    assert(/templates\/office\.md/.test(block), '应含出处路径');
    assert(/yuhua/.test(block), '应含相关实体');
    // 注入进 envelope
    const env = withEnv(undefined, () => buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, { workspaceRoot: root, goal: '生成办公室椅子图', acceptance: 'x' }));
    assert(/知识库检索/.test(env), 'buildEnvelope 应含知识库块');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testDisabledReturnsEmpty() {
  if (!pyOk) return;
  const root = makeKbRoot(HIT_STUB);
  try {
    const block = withEnv('0', () => fetchKbContext({ workspaceRoot: root, goal: '生成办公室椅子图' }));
    assert.strictEqual(block, '', 'YUTU6_KB_INJECT=0 应返空');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testNoKnowledgeDirReturnsEmpty() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-nodir-'));
  try {
    const block = withEnv(undefined, () => fetchKbContext({ workspaceRoot: root, goal: '随便' }));
    assert.strictEqual(block, '', '无 knowledge/ 目录应返空,不报错');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testEmptyHitsReturnsEmpty() {
  if (!pyOk) return;
  const root = makeKbRoot(EMPTY_STUB);
  try {
    const block = withEnv(undefined, () => fetchKbContext({ workspaceRoot: root, goal: '随便' }));
    assert.strictEqual(block, '', '检索为空应返空(不注入空块)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testQueryErrorReturnsEmpty() {
  if (!pyOk) return;
  const root = makeKbRoot(ERR_STUB);
  try {
    const block = withEnv(undefined, () => fetchKbContext({ workspaceRoot: root, goal: '随便' }));
    assert.strictEqual(block, '', 'query.py 报错应静默返空');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testNoGoalReturnsEmpty() {
  const root = makeKbRoot(HIT_STUB);
  try {
    const block = withEnv(undefined, () => fetchKbContext({ workspaceRoot: root, goal: '' }));
    assert.strictEqual(block, '', '无 goal 应返空');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function main() {
  testInjectsHits();
  testDisabledReturnsEmpty();
  testNoKnowledgeDirReturnsEmpty();
  testEmptyHitsReturnsEmpty();
  testQueryErrorReturnsEmpty();
  testNoGoalReturnsEmpty();
  console.log(JSON.stringify({ pass: true, suite: 'kb-inject' }));
}

main();
