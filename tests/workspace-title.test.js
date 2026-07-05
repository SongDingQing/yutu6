#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTitleHelpers() {
  const file = path.resolve(__dirname, '../projects/控制台/public/workspace.html');
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('function cleanTaskText');
  const end = html.indexOf('function normalizeRole', start);
  assert(start > 0 && end > start, 'workspace title helper block not found');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  assert.strictEqual(typeof ctx.conciseTaskName, 'function');
  return ctx.conciseTaskName;
}

function main() {
  const conciseTaskName = loadTitleHelpers();

  const secretaryBackground = `秘书补全稿:
[秘书后台背景包]
你每次处理老板/前台派来的任务前,先以本背景包为准补足跨会话上下文。

## board/status-rollup
Hermes×MiniMax×飞书 私聊闭环已通。
目标:这看样子像是一个任务出现了三次，这是什么情况，是有 bug`;
  assert.strictEqual(conciseTaskName(secretaryBackground, { max: 12 }), '秘书后台背景包');

  const officeVisual = `【老板要求,请 CEO 拆解落地】办公室视觉 + 素材:
1) 左边房间(办公室视图)不好看,重新设计房间布局。
2) 下方派单打字框有点丑,优化。
3) 重做 meowa 地块/办公室形状任务,出侧视图并飞书发老板。`;
  const officeTitle = conciseTaskName(officeVisual, { max: 12 });
  assert.match(officeTitle, /办公室视觉/);
  assert.notStrictEqual(officeTitle, '飞书通知升级');
  assert(!/老板要求|CEO/.test(officeTitle), officeTitle);

  const mechanism = `【老板要求,请 CEO 拆解落地】机制三项:
1) 暂停自动优化。
2) 飞书通知优化。
3) 入队自动同类合并。`;
  const mechanismTitle = conciseTaskName(mechanism, { max: 12 });
  assert.match(mechanismTitle, /机制三项/);
  assert.notStrictEqual(mechanismTitle, '飞书通知升级');
  assert(!/老板要求|CEO/.test(mechanismTitle), mechanismTitle);

  const realFeishuTask = '老板拍板:飞书通知升级,测试类消息不要反复发,标题要直接';
  assert.match(conciseTaskName(realFeishuTask, { max: 12 }), /^飞书通知升级/);

  console.log(JSON.stringify({ pass: true, suite: 'workspace-title' }));
}

main();
