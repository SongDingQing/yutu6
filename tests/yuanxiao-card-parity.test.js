'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Approval = require('../projects/控制台/tools/notify-yuanxiao-approval');
const Callback = require('../projects/控制台/tools/yuanxiao-card-callback');
const RepairDelivery = require('../projects/控制台/repair-report-delivery');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanxiao-card-parity-'));
  try {
    const approvalDir = path.join(root, 'approvals');
    fs.mkdirSync(approvalDir, { recursive: true });
    fs.writeFileSync(path.join(approvalDir, '7.json'), `${JSON.stringify({
      seq: 7,
      cardId: 'card-native-7',
      taskId: 'task-native-7',
      title: '原生卡片联调',
      status: 'pending',
      verdict: null,
    }, null, 2)}\n`);

    const typed = Approval.buildTypedApprovalPayload(7, 'card-native-7', 'task-native-7', {
      title: '原生卡片联调',
      cause: '需要主人拍板',
      result: '候选结果',
    });
    assert.strictEqual(typed.card_type, 'decision');
    assert.deepStrictEqual(typed.actions.map(item => item.id), ['approve', 'reject']);
    assert.strictEqual(typed.payload.decision_ref.kind, 'yutu6_approval');
    assert(!JSON.stringify(typed).match(/secret|token|cookie/i));

    const calls = [];
    const pushed = Approval.pushTypedApprovalCard(7, 'card-native-7', 'task-native-7', {
      title: '原生卡片联调',
      cause: '需要主人拍板',
    }, (apiPath, payload) => {
      calls.push({ apiPath, payload });
      return { ok: true, code: 200, receiptId: `receipt-${calls.length}` };
    });
    assert.strictEqual(pushed.ok, true);
    assert.deepStrictEqual(calls.map(item => item.apiPath), ['/api/v1/tasks', '/api/v1/cards']);
    assert.strictEqual(calls[0].payload.status, 'paused');
    assert.strictEqual(calls[1].payload.task_id, 'task-native-7');

    const callbackLock = path.join(approvalDir, '.typed-card-callback.lock');
    fs.writeFileSync(callbackLock, 'busy\n', { mode: 0o600 });
    const busy = Callback.applyCardAction({
      approvalsDir: approvalDir,
      cardId: 'card-native-7',
      action: 'approve',
      idempotencyKey: 'card-native-7:approve:r1',
    });
    assert.strictEqual(busy.error, 'callback_busy');
    assert.strictEqual(busy.retryable, true);
    fs.unlinkSync(callbackLock);

    const first = Callback.applyCardAction({
      approvalsDir: approvalDir,
      cardId: 'card-native-7',
      action: 'approve',
      idempotencyKey: 'card-native-7:approve:r1',
    });
    const replay = Callback.applyCardAction({
      approvalsDir: approvalDir,
      cardId: 'card-native-7',
      action: 'approve',
      idempotencyKey: 'card-native-7:approve:r1',
    });
    assert.strictEqual(first.applied, true);
    assert.strictEqual(replay.idempotentReplay, true);
    const decided = JSON.parse(fs.readFileSync(path.join(approvalDir, '7.json'), 'utf8'));
    assert.strictEqual(decided.status, 'approved');
    assert.strictEqual(decided.decision_source, 'yuanxiao-native-card');

    const reportCard = RepairDelivery.buildTypedReportCard({
      ticketId: 'repair-7',
      title: '修复卡片回调',
      sha256: 'a'.repeat(64),
      sections: {
        severity: 'medium',
        rootCause: '重复请求缺少幂等约束',
        actions: '增加唯一键和动作回执',
        verification: '重复提交两次只有一次状态变化',
        risks: '旧客户端继续走文字通道',
      },
    });
    assert.strictEqual(reportCard.card_type, 'report');
    assert.strictEqual(reportCard.payload.responsible_party, '维修主管');
    assert.strictEqual(reportCard.payload.handling_status, '已完成并复核');
    assert.strictEqual(reportCard.payload.report_document_name, 'repair-7.html');
    assert.strictEqual(reportCard.payload.report_document_folder, '维修报告');
    assert.strictEqual(reportCard.actions[0].id, 'open_report');

    console.log('yuanxiao-card-parity: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
