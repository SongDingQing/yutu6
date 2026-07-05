#!/usr/bin/env node
'use strict';

// 任务11 守卫:飞书三类交互——提问=text、进展=progress 卡片、决策=decision 按钮卡片。
// 用 notify-feishu.sh 的 FEISHU_DRY_RUN 干跑模式断言 payload 结构(不联网、不需凭据)。

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../shared/agents/ui-optimizer/notify-feishu.sh');

function dryRun(args) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { FEISHU_DRY_RUN: '1' }),
    timeout: 20000,
  });
  const line = String(res.stdout || '').split(/\r?\n/).find(l => l.startsWith('DRY_RUN '));
  assert(line, `应有 DRY_RUN 输出: stdout=${res.stdout} stderr=${res.stderr}`);
  const outer = JSON.parse(line.slice('DRY_RUN '.length));
  return { msg_type: outer.msg_type, content: JSON.parse(outer.content) };
}

function testText() {
  const { msg_type, content } = dryRun(['--type', 'text', '--title', '提问', '--body', '服务器地址给一下']);
  assert.strictEqual(msg_type, 'text', '提问/对话应为纯文本');
  assert(/提问/.test(content.text) && /服务器地址/.test(content.text));
}

function testProgress() {
  const { msg_type, content } = dryRun(['--type', 'progress', '--title', 'failover上线', '--body', 'v0.0.3.5 已 push', '--button-label', '看提交', '--button-url', 'https://example.com/c']);
  assert.strictEqual(msg_type, 'interactive', '进展应为 interactive 卡片');
  assert.strictEqual(content.header.template, 'blue', '进展卡蓝头');
  assert(/进展/.test(content.header.title.content), '头部应标“进展”');
  const div = content.elements.find(e => e.tag === 'div');
  assert(div && /push/.test(div.text.content), '正文应在 div 元素');
  const action = content.elements.find(e => e.tag === 'action');
  assert(action && action.actions.length === 1, '应有 1 个按钮');
  assert.strictEqual(action.actions[0].url, 'https://example.com/c');
}

function testDecision() {
  const { msg_type, content } = dryRun([
    '--type', 'decision', '--title', '是否clone元宵', '--body', '在GitHub不在gitee',
    '--buttons', '现在clone|http://localhost:8787/d/yes;;等重装|http://localhost:8787/d/wait',
  ]);
  assert.strictEqual(msg_type, 'interactive', '决策应为 interactive 卡片');
  assert.strictEqual(content.header.template, 'orange', '决策卡橙头');
  assert(/需决策/.test(content.header.title.content), '头部应标“需决策”');
  const action = content.elements.find(e => e.tag === 'action');
  assert(action && action.actions.length === 2, '应有 2 个决策按钮');
  assert.strictEqual(action.actions[0].type, 'primary', '首按钮应 primary');
  assert.strictEqual(action.actions[1].type, 'default', '次按钮 default');
  assert.strictEqual(action.actions[0].url, 'http://localhost:8787/d/yes');
}

function testUnknownTypeFallsBackText() {
  const { msg_type } = dryRun(['--type', 'wat', '--title', 't', '--body', 'b']);
  assert.strictEqual(msg_type, 'text', '未知类型回退为 text');
}

function main() {
  testText();
  testProgress();
  testDecision();
  testUnknownTypeFallsBackText();
  console.log(JSON.stringify({ pass: true, suite: 'feishu-card-types' }));
}

main();
