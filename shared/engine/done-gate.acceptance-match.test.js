#!/usr/bin/env node
// 回归测试:done-gate 设计对照行按 decisions.md:行号锚点匹配。
// 起因:2026-06-24 / 2026-06-25 decisions.md:65 连续两次 "第N行 缺少要点" 误报 —— 执行/复核方用省略号"…"
// 截断超长设计对照要点,导致全文 containment 匹配失败被判缺行。修复后按行号锚点回退匹配,
// 但缺行/错行仍须打回。绑定工单 auto-20260625085725-8ba9be40a639d621(decisions.md:538 规则落地验证)。
// 运行: node shared/engine/done-gate.acceptance-match.test.js

const assert = require('assert');
const { findAcceptanceRow } = require('./done-gate.js');

const D65 = `设计对照 memory/decisions.md:65 理由:粒度改分钟方向对,但CEO根因诊断经代码核实为错(后端多处写started_at且server.js:1929已做enqueued_at兜底),被否两轮的enqueued_at喂运行芯片方案仍在、配合宽松验收会放行'刚启动就显示运行N分钟'的错误执行,故误判风险为真;带'只用真实运行起点+静态兜底文案+收紧验收'修订后可执行。`;
const D65_ABBREV = `设计对照 memory/decisions.md:65 理由:粒度改分钟方向对,但CEO根因诊断经代码核实为错…故误判风险为真;带'只用真实运行起点+静态兜底文案+收紧验收'修订后可执行。`;

const required = { point: D65 };
const abbrevRow = { point: D65_ABBREV, status: '完成' };
const wrongAnchorRow = { point: '设计对照 memory/decisions.md:77 边界规则', status: '完成' };
const nonDesignRow = { point: '任务验收: 跑 review-loop', status: '完成' };

const cases = [
  ['省略号截断的同锚点设计对照行可匹配', () => assert.strictEqual(findAcceptanceRow(required, [wrongAnchorRow, abbrevRow]), abbrevRow)],
  ['真正缺失(无 :65 行)仍判 null', () => assert.strictEqual(findAcceptanceRow(required, [wrongAnchorRow, nonDesignRow]), null)],
  ['错锚点设计对照行不会误匹配 :65', () => assert.strictEqual(findAcceptanceRow(required, [wrongAnchorRow]), null)],
  ['逐字原文仍匹配', () => assert.ok(findAcceptanceRow(required, [{ point: D65, status: '完成' }]))],
  ['非设计对照行 containment 不回归', () => assert.ok(findAcceptanceRow(
    { point: '任务验收: 完成后更新 status.md' },
    [{ point: '任务验收: 完成后更新 status.md 并 rollup', status: '完成' }]))],
  ['空 filled 列表判 null', () => assert.strictEqual(findAcceptanceRow(required, []), null)],
];

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`  ok - ${name}`); }
  catch (e) { failed += 1; console.error(`  FAIL - ${name}: ${e.message}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
