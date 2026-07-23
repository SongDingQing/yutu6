#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RepairReport = require('../projects/控制台/repair-report');
const Delivery = require('../projects/控制台/repair-report-delivery');

function assertSectionBoundariesBeforeSideEffects() {
  const compatibleHeadings = RepairReport.parseResultSections([
    '## 链路证据',
    'Markdown 标题正文。',
    '### 需求传递判断：无遗漏。',
    '#### 严重度: 严重。',
    '## 根因',
    'Markdown 标题与普通列表字段共用匹配语法。',
    '处理过程: 收紧分段边界。',
    '复核验证：纯解析断言通过。',
    '## 架构判断',
    '在解析入口修复。',
    '知识沉淀候选：兼容真正 Markdown 标题与无列表单行标签。',
    '## 剩余风险 / 下一步',
    '无。',
  ].join('\n'));
  assert.deepStrictEqual(compatibleHeadings.missingSections, [], 'compatible top-level headings must fill every required section');
  assert.strictEqual(compatibleHeadings.sections.chainEvidence, 'Markdown 标题正文。');
  assert.strictEqual(compatibleHeadings.sections.handoffVerdict, '无遗漏。');
  assert.strictEqual(compatibleHeadings.sections.actions, '收紧分段边界。');
  assert.strictEqual(compatibleHeadings.sections.knowledge, '兼容真正 Markdown 标题与无列表单行标签。');

  const knowledgeListLines = [
    '- 泛化判断：可泛化模式。',
    '- 问题模式：知识候选使用普通列表字段。',
    '- 根因：列表字段不应切换顶级 section。',
    '- 解法：只识别真正 Markdown heading 或无列表标签。',
    '- 处理：在解析边界做最小修复。',
    '- 验证：断言每个 section 的内容来源。',
    '- 下一步：保留回归语料。',
    '#根因：缺少空格，不是真正的 Markdown heading。',
    '- 项目技术映射：控制台 → repair-report.js → 维修报告解析。',
  ];
  const listCounterexample = RepairReport.parseResultSections([
    '链路证据: 顶级链路证据。',
    '需求传递判断: 顶级传递判断。',
    '严重度: 顶级严重度。',
    '根因: 顶级根因。',
    '处理过程: 顶级处理。',
    '复核验证: 顶级验证。',
    '架构判断: 顶级架构判断。',
    '知识沉淀候选:',
    ...knowledgeListLines,
    '剩余风险 / 下一步: 顶级风险。',
  ].join('\n'));
  assert.deepStrictEqual(listCounterexample.missingSections, [], 'missingSections=[] must mean the intended top-level boundaries are populated');
  assert.strictEqual(listCounterexample.sections.rootCause, '顶级根因。', 'knowledge 根因 list item must not overwrite rootCause');
  assert.strictEqual(listCounterexample.sections.actions, '顶级处理。', 'knowledge 处理 list item must not overwrite actions');
  assert.strictEqual(listCounterexample.sections.verification, '顶级验证。', 'knowledge 验证 list item must not overwrite verification');
  assert.strictEqual(listCounterexample.sections.risks, '顶级风险。', 'knowledge 下一步 list item must not overwrite risks');
  assert.strictEqual(listCounterexample.sections.knowledge, knowledgeListLines.join('\n'), 'all knowledge list fields must remain inside knowledge');

  const oldErrorArtifactKnowledge = [
    '- 泛化判断：面向文件名、队列键或 URL 段的自动 ID，生成器输出集合必须是下游 validator 接受集合的子集。',
    '- 问题模式：Unicode 展示 slug 与 ASCII-only 路径校验组合后拒绝非 ASCII 标题。',
    '- 根因：producer/consumer 契约分裂，且回归语料只覆盖 ASCII happy path。',
    '- 解法：在生产边界生成可读 ASCII 前缀与稳定内容哈希。',
    '- 项目技术映射：控制台的 repairTicketAdd()/repairTicketPath()。',
  ];
  const oldErrorArtifact = RepairReport.parseResultSections([
    '# 维修主管结案记录 · repair-20260713-ticket-id-unicode-slug',
    '## 链路证据',
    '旧产物链路证据。',
    '## 需求传递判断',
    '无遗漏。',
    '## 严重度',
    '严重。',
    '## 根因',
    '自动 ID 生产者与消费者契约分裂。',
    '## 处理过程',
    '修复自动 ID 生产边界。',
    '## 复核验证',
    '专项测试退出 0。',
    '## 架构判断',
    '系统性入口契约缺口。',
    '## 知识沉淀候选',
    ...oldErrorArtifactKnowledge,
    '## 剩余风险 / 下一步',
    '碰撞理论风险低。',
  ].join('\n'));
  assert.deepStrictEqual(oldErrorArtifact.missingSections, []);
  assert.strictEqual(oldErrorArtifact.sections.rootCause, '自动 ID 生产者与消费者契约分裂。', 'old artifact knowledge must not replace its top-level root cause');
  assert.strictEqual(oldErrorArtifact.sections.knowledge, oldErrorArtifactKnowledge.join('\n'), 'old artifact knowledge must not be truncated at its internal root-cause label');
}

function main() {
  assertSectionBoundariesBeforeSideEffects();

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

    const publicSha256 = '0123456789abcdef'.repeat(4);
    const sshUri = 'ssh://deploy-user@ops.example';
    const sshTarget = 'deploy-user@ops.example';
    const numericSshTarget = 'user@2';
    const schemaLikeSshTarget = 'deploy-user@2';
    const nonNumericSchemaTarget = 'structured-acceptance@v2';
    const bearerValue = 'Bearer-' + 'B'.repeat(48);
    const apiKeyValue = 'sk-' + 'A'.repeat(32);
    const longNonHexToken = 'Z'.repeat(56);
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
      '验收表协议: structured-acceptance@2',
      '视觉验收 schema: visual-acceptance@1',
      `截图 SHA-256: ${publicSha256}`,
      `SSH URI: ${sshUri}`,
      `SSH target: ${sshTarget}`,
      `数字 SSH host: ${numericSshTarget}`,
      `相似 schema 的 SSH host: ${schemaLikeSshTarget}`,
      `非数字 schema 版本: ${nonNumericSchemaTarget}`,
      `Credential header: Bearer ${bearerValue}`,
      `api_key=${apiKeyValue}`,
      `Opaque evidence: ${longNonHexToken}`,
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
    assert(html.includes('structured-acceptance@2'), 'numeric schema protocol must remain in fixed HTML');
    assert(html.includes('visual-acceptance@1'), 'known visual schema version must remain in fixed HTML');
    assert(html.includes(publicSha256), 'pure SHA-256 evidence must remain in fixed HTML');
    assert(html.includes('[REDACTED SSH TARGET]'), 'real SSH targets must be redacted');
    assert(html.includes('Bearer [REDACTED]'), 'Bearer credential must be redacted');
    assert(html.includes('api_key=[REDACTED]'), 'API key must be redacted');
    assert(html.includes('Opaque evidence: [REDACTED]'), 'long non-hex token must be redacted');
    assert(!html.includes(sshUri), 'raw ssh:// target must not reach HTML');
    assert(!html.includes(sshTarget), 'raw user@host target must not reach HTML');
    assert(!html.includes(numericSshTarget), 'non-schema numeric SSH target must not reach HTML');
    assert(!html.includes(schemaLikeSshTarget), 'unknown schema-like numeric SSH target must not reach HTML');
    assert(!html.includes(nonNumericSchemaTarget), 'known schema name with a non-numeric host must not reach HTML');
    assert(!html.includes(bearerValue), 'raw Bearer credential must not reach HTML');
    assert(!html.includes(apiKeyValue), 'raw API key must not reach HTML');
    assert(!html.includes(longNonHexToken), 'raw long non-hex token must not reach HTML');

    let calls = 0;
    let cardCalls = 0;
    let captured = null;
    let capturedCard = null;
    const sender = payload => {
      calls++;
      captured = payload;
      return { ok: true, code: 200, receiptId: 'msg_test_receipt', raw: '{truncated-response' };
    };
    const cardSender = (apiPath, payload) => {
      cardCalls++;
      if (apiPath === '/api/v1/cards') capturedCard = payload;
      return { ok: true, code: 200, receiptId: apiPath === '/api/v1/cards' ? 'card_test_receipt' : 'task_test_receipt' };
    };
    const stateFile = path.join(artifactsRoot, 'repair-reports', 'delivery-test.json');
    const sent = Delivery.deliverYuanxiao(first, { artifactsRoot, stateFile, sender, cardSender });
    const replay = Delivery.deliverYuanxiao(first, { artifactsRoot, stateFile, sender, cardSender });
    assert.strictEqual(sent.sent, true);
    assert.strictEqual(sent.receiptId, 'msg_test_receipt');
    assert.strictEqual(replay.skipped, true);
    assert.strictEqual(calls, 1, 'same report replay must not push YuanXiao twice');
    assert.strictEqual(cardCalls, 2, 'first delivery creates/updates one task and one native card only');
    assert.strictEqual(captured.source, 'repair-report');
    assert.strictEqual(captured.task_id, 'ticket-html');
    assert.strictEqual(captured.files[0].document_update, true);
    assert.strictEqual(captured.files[0].document_folder, '维修报告');
    assert.strictEqual(captured.files[0].content, html);
    assert.strictEqual(capturedCard.card_type, 'report');
    assert.strictEqual(capturedCard.payload.report_kind, 'issue');
    assert.strictEqual(capturedCard.payload.report_document_name, 'ticket-html.html');
    assert.strictEqual(capturedCard.payload.artifact_refs[0].sha256, first.sha256);
    assert.strictEqual(capturedCard.actions[0].id, 'open_report');

    console.log(JSON.stringify({ pass: true, suite: 'repair-report' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
