#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, '../projects/控制台/tools/owner-auto-notify-test.js');
const result = spawnSync(process.execPath, [script], {
  cwd: path.resolve(__dirname, '..'),
  // 拍板 Q7 后该 harness 守卫的是旧聚合通道(YUTU6_NOTIFY_TIERED=0 的退回路径);
  // 分级默认行为由 tests/notify-severity-tiers.test.js 守卫。
  env: Object.assign({}, process.env, { YUTU6_NOTIFY_TIERED: '0' }),
  encoding: 'utf8',
  timeout: 30000,
  maxBuffer: 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

assert.strictEqual(result.status, 0, `owner-auto-notify-test exited ${result.status}`);
const notifyScript = fs.readFileSync(path.resolve(__dirname, '../shared/agents/ui-optimizer/notify-feishu.sh'), 'utf8');
// 任务11:三类交互——提问/对话仍走纯文本(默认),进展/决策走 interactive 卡片(有意新增)。
assert(/"text",\s*json\.dumps\(\{"text": text\}/.test(notifyScript) || notifyScript.includes('json.dumps({"text": text}'), 'Feishu text(提问/对话)仍须编码为纯文本 payload');
assert(notifyScript.includes('"interactive"'), 'Feishu 进展/决策须支持 interactive 卡片(任务11)');
assert(notifyScript.includes('parse_buttons'), 'Feishu 决策卡须支持按钮(parse_buttons)');
console.log(JSON.stringify({ pass: true, suite: 'owner-auto-notify-wrapper' }));
