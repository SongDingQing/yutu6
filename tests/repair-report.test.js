#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RepairReport = require('../projects/控制台/repair-report');
const Delivery = require('../projects/控制台/repair-report-delivery');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-report-test-'));
  try {
    const ticketFile = path.join(root, 'board', 'repair-tickets', 'ticket-html.md');
    const artifactsRoot = path.join(root, 'artifacts');
    fs.mkdirSync(path.dirname(ticketFile), { recursive: true });
    fs.writeFileSync(ticketFile, [
      '# 维修工单 ticket-html · 固定报告测试',
      '',
      '- status: todo',
      '- created_at: 2026-07-10T00:00:00.000Z',
      '- source: 主人直接交办',
      '- priority: high',
    ].join('\n'));

    const result = [
      '链路证据: 主人 -> 维修主管 -> 维修员,实际返回与 brief 一致。',
      '需求传递判断: 无遗漏。',
      '严重度: 小问题。',
      '根因: 缺少统一报告生成器。',
      '处理过程: 新增固定 HTML 和双通道投递。',
      '复核验证: node tests/repair-report.test.js 通过。',
      '架构判断: 可泛化为统一维修结案协议。',
      '知识沉淀候选: 问题模式 -> 缺少固定回执; 解法 -> 单工单单报告。',
      '剩余风险 / 下一步: 无。',
      'api_key=sk-' + 'A'.repeat(32),
    ].join('\n');

    const first = RepairReport.generateRepairReport({
      ticketId: 'ticket-html',
      ticketFile,
      result,
      completedAt: '2026-07-10T01:00:00.000Z',
      artifactsRoot,
    });
    const second = RepairReport.generateRepairReport({
      ticketId: 'ticket-html',
      ticketFile,
      result,
      completedAt: '2026-07-10T02:00:00.000Z',
      artifactsRoot,
    });
    assert.strictEqual(first.file, second.file, 'one ticket must keep one fixed HTML path');
    assert.strictEqual(first.sha256, second.sha256, 'same completion must generate the same report fingerprint');
    assert.deepStrictEqual(first.missingSections, []);
    const html = fs.readFileSync(first.file, 'utf8');
    const actualHash = require('crypto').createHash('sha256').update(html).digest('hex');
    assert.strictEqual(first.sha256, actualHash, 'reported SHA must match the exact HTML bytes');
    assert(html.includes('玉兔6 · 维修部门固定结案报告'));
    assert(html.includes('链路证据'));
    assert(html.includes('处理过程'));
    assert(html.includes('[REDACTED]'), 'secret-like value must be redacted');
    assert(!html.includes('sk-' + 'A'.repeat(32)), 'raw secret-like value must not reach HTML');

    let calls = 0;
    let captured = null;
    const sender = payload => {
      calls++;
      captured = payload;
      return { ok: true, code: 200, receiptId: 'msg_test_receipt', raw: '{truncated-response' };
    };
    const stateFile = path.join(artifactsRoot, 'repair-reports', 'delivery-test.json');
    const sent = Delivery.deliverYuanxiao(first, { artifactsRoot, stateFile, sender });
    const replay = Delivery.deliverYuanxiao(first, { artifactsRoot, stateFile, sender });
    assert.strictEqual(sent.sent, true);
    assert.strictEqual(sent.receiptId, 'msg_test_receipt');
    assert.strictEqual(replay.skipped, true);
    assert.strictEqual(calls, 1, 'same report replay must not push YuanXiao twice');
    assert.strictEqual(captured.source, 'repair-report');
    assert.strictEqual(captured.task_id, 'ticket-html');
    assert.strictEqual(captured.files[0].document_update, true);
    assert.strictEqual(captured.files[0].document_folder, '维修报告');
    assert.strictEqual(captured.files[0].content, html);

    console.log(JSON.stringify({ pass: true, suite: 'repair-report' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
