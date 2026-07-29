'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Queue = require('../shared/engine/queue');
const Approval = require('../projects/控制台/tools/notify-yuanxiao-approval');
const Callback = require('../projects/控制台/tools/yuanxiao-card-callback');
const PullDecision = require('../projects/控制台/tools/pull-yuanxiao-decision');
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
    assert.deepStrictEqual(typed.actions.map(item => item.label), ['同意', '否决']);
    assert(typed.summary.length <= 180);
    assert.strictEqual(typed.payload.decision_ref.kind, 'yutu6_approval');
    assert(!JSON.stringify(typed).match(/secret|token|cookie/i));

    const conciseBody = Approval.buildBody(7, {
      title: '原生卡片联调',
      cause: '很长的背景说明不应铺在审批卡正文里',
      source: '内部链路',
      progress: '已完成实现和复核',
      result: '只显示这一句结论，主人可快速拍板',
      note: '保留在 payload',
    }, true);
    assert(conciseBody.includes('只显示这一句结论'));
    assert(conciseBody.includes('同意'));
    assert(conciseBody.includes('否决'));
    assert(!conciseBody.includes('**起因**'));
    assert(!conciseBody.includes('**来源**'));
    assert(!conciseBody.includes('**进展**'));
    assert.strictEqual(
      Approval.parsePushResponse('{"status":"error","error":"bridge_disabled","upstream_status":503}\nHTTP:200').ok,
      false
    );
    assert.strictEqual(
      Approval.parsePushResponse('{"status":"ok","card":{"card_id":"card-native-7"}}\nHTTP:200').ok,
      true
    );

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

    const imageOne = path.join(root, 'comic-page-01.png');
    const imageTwo = path.join(root, 'comic-page-02.png');
    fs.writeFileSync(imageOne, Buffer.from([1, 2, 3]));
    fs.writeFileSync(imageTwo, Buffer.from([4, 5, 6]));
    const parsedMultiImageArgs = Approval.parseArgs([
      '--title', '露西漫画审批',
      '--image', imageOne,
      '--image', imageTwo,
    ]);
    assert.deepStrictEqual(parsedMultiImageArgs.image, [imageOne, imageTwo]);

    const reportApprovalDir = path.join(root, 'report-approvals');
    const typedCalls = [];
    const inboxCalls = [];
    const reportApprovalArgs = {
      title: '审批 · Simulaid 主管试行报告',
      cause: '是否同意启动三个小试验？',
      result: '推荐：同意先做三个小试验。',
      project: 'Simulaid',
      'task-id': 'simulaid-report-pilot',
      'card-id': 'supervisor-report-aabbccddeeff0011',
      'report-document-name': 'simulaid-report.md',
      'report-document-folder': 'Simulaid报告',
      'report-fingerprint': 'a'.repeat(64),
      image: [imageOne, imageTwo],
      execution: {
        queueAgent: 'supervisor-Simulaid',
        queueId: 'srap-aabbccddeeff0011',
        priority: 30,
        idem: 'supervisor-report-approval:test',
        task: {
          role: 'supervisor',
          flowId: 'review-loop',
          projectId: 'Simulaid',
          approvalReportFingerprint: 'a'.repeat(64),
          goal: '执行主人已批准的 Simulaid 主管报告推荐方案。',
        },
      },
    };
    const firstReportApproval = Approval.sendApproval(reportApprovalArgs, {
      approvalsDir: reportApprovalDir,
      typedSender(apiPath, payload) {
        typedCalls.push({ apiPath, payload });
        return { ok: true, code: 200, receiptId: `typed-${typedCalls.length}` };
      },
      inboxSender(payload) {
        inboxCalls.push(payload);
        return { ok: true, code: 200, receiptId: 'inbox-report-approval' };
      },
    });
    assert.strictEqual(firstReportApproval.ok, true);
    assert.strictEqual(firstReportApproval.nativeCard, true);
    assert.strictEqual(firstReportApproval.idempotent, false);
    assert.deepStrictEqual(typedCalls.map(item => item.apiPath), ['/api/v1/tasks', '/api/v1/cards']);
    assert.deepStrictEqual(typedCalls[1].payload.actions.map(item => item.label), ['同意', '否决']);
    assert.strictEqual(typedCalls[1].payload.payload.report_document_name, 'simulaid-report.md');
    assert.strictEqual(typedCalls[1].payload.payload.report_fingerprint, 'a'.repeat(64));
    assert.strictEqual(inboxCalls[0].approval_required, true);
    assert.strictEqual(inboxCalls[0].typed_card_id, reportApprovalArgs['card-id']);
    assert.strictEqual(inboxCalls[0].images.length, 2);
    const reportApprovalLedger = JSON.parse(fs.readFileSync(
      path.join(reportApprovalDir, `${firstReportApproval.seq}.json`),
      'utf8'
    ));
    assert.strictEqual(reportApprovalLedger.execution.queue_agent, 'supervisor-Simulaid');
    assert.strictEqual(reportApprovalLedger.execution.status, 'pending');
    assert.deepStrictEqual(
      reportApprovalLedger.images.map(item => item.ref),
      [imageOne, imageTwo]
    );

    const replayReportApproval = Approval.sendApproval(reportApprovalArgs, {
      approvalsDir: reportApprovalDir,
      typedSender() {
        throw new Error('幂等重放不应重复创建 typed card');
      },
      inboxSender() {
        throw new Error('幂等重放不应重复发送 inbox fallback');
      },
    });
    assert.strictEqual(replayReportApproval.ok, true);
    assert.strictEqual(replayReportApproval.nativeCard, true);
    assert.strictEqual(replayReportApproval.idempotent, true);

    const approvedReport = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: root,
      cardId: reportApprovalArgs['card-id'],
      action: 'approve',
      idempotencyKey: `${reportApprovalArgs['card-id']}:approve:r1`,
    });
    assert.strictEqual(approvedReport.ok, true);
    assert.strictEqual(approvedReport.autoEnqueued, true);
    assert.strictEqual(approvedReport.queueAgent, 'supervisor-Simulaid');
    assert.strictEqual(approvedReport.queueId, 'srap-aabbccddeeff0011');
    assert.strictEqual(Queue.list(root, 'supervisor-Simulaid').queued.length, 1);

    const repeatedReportApproval = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: root,
      cardId: reportApprovalArgs['card-id'],
      action: 'approve',
      idempotencyKey: `${reportApprovalArgs['card-id']}:approve:r2`,
    });
    assert.strictEqual(repeatedReportApproval.ok, true);
    assert.strictEqual(repeatedReportApproval.autoEnqueued, true);
    assert.strictEqual(repeatedReportApproval.queueReused, true);
    assert.strictEqual(Queue.list(root, 'supervisor-Simulaid').queued.length, 1);

    fs.writeFileSync(path.join(reportApprovalDir, '99.json'), `${JSON.stringify({
      seq: 99,
      cardId: 'supervisor-report-reject-test',
      taskId: 'simulaid-report-reject',
      title: '否决不入队',
      status: 'pending',
      verdict: null,
      execution: Approval.normalizeExecutionPlan({
        queueAgent: 'supervisor-Simulaid',
        queueId: 'srap-reject-test',
        task: {
          projectId: 'Simulaid',
          goal: '这份任务不应入队。',
        },
      }),
    }, null, 2)}\n`);
    const rejectedReport = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: root,
      cardId: 'supervisor-report-reject-test',
      action: 'reject',
      idempotencyKey: 'supervisor-report-reject-test:reject:r1',
    });
    assert.strictEqual(rejectedReport.ok, true);
    assert.strictEqual(rejectedReport.autoEnqueued, false);
    assert.strictEqual(Queue.list(root, 'supervisor-Simulaid').queued.length, 1);

    fs.writeFileSync(path.join(reportApprovalDir, '100.json'), `${JSON.stringify({
      seq: 100,
      cardId: 'supervisor-report-missing-plan',
      taskId: 'simulaid-report-missing-plan',
      title: '缺执行计划',
      status: 'pending',
      verdict: null,
      report: {
        document_name: 'missing-plan.md',
        document_folder: 'Simulaid报告',
        fingerprint: 'b'.repeat(64),
      },
    }, null, 2)}\n`);
    const missingPlan = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: root,
      cardId: 'supervisor-report-missing-plan',
      action: 'approve',
      idempotencyKey: 'supervisor-report-missing-plan:approve:r1',
    });
    assert.strictEqual(missingPlan.ok, false);
    assert.strictEqual(missingPlan.retryable, true);
    assert.strictEqual(missingPlan.error, 'missing_report_execution_plan');
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(reportApprovalDir, '100.json'), 'utf8')).status,
      'pending'
    );

    fs.writeFileSync(path.join(reportApprovalDir, '101.json'), `${JSON.stringify({
      seq: 101,
      cardId: 'supervisor-report-retry-enqueue',
      taskId: 'simulaid-report-retry-enqueue',
      title: '入队失败后恢复',
      status: 'pending',
      verdict: null,
      execution: Approval.normalizeExecutionPlan({
        queueAgent: 'supervisor-Simulaid',
        queueId: 'srap-retry-enqueue',
        task: {
          projectId: 'Simulaid',
          goal: '入队失败恢复测试。',
        },
      }),
    }, null, 2)}\n`);
    const invalidArtifactsRoot = path.join(root, 'not-a-directory');
    fs.writeFileSync(invalidArtifactsRoot, 'occupied');
    const enqueueFailed = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: invalidArtifactsRoot,
      cardId: 'supervisor-report-retry-enqueue',
      action: 'approve',
      idempotencyKey: 'supervisor-report-retry-enqueue:approve:r1',
    });
    assert.strictEqual(enqueueFailed.ok, false);
    assert.strictEqual(enqueueFailed.retryable, true);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(reportApprovalDir, '101.json'), 'utf8')).status,
      'pending'
    );
    const enqueueRecovered = Callback.applyCardAction({
      approvalsDir: reportApprovalDir,
      artifactsRoot: root,
      cardId: 'supervisor-report-retry-enqueue',
      action: 'approve',
      idempotencyKey: 'supervisor-report-retry-enqueue:approve:r1',
    });
    assert.strictEqual(enqueueRecovered.ok, true);
    assert.strictEqual(enqueueRecovered.autoEnqueued, true);
    assert.strictEqual(enqueueRecovered.queueId, 'srap-retry-enqueue');

    const pullApprovalDir = path.join(root, 'pull-approvals');
    fs.mkdirSync(pullApprovalDir, { recursive: true });
    fs.writeFileSync(path.join(pullApprovalDir, '1.json'), `${JSON.stringify({
      seq: 1,
      cardId: 'supervisor-report-chat-fallback',
      taskId: 'simulaid-report-chat-fallback',
      title: '兼容回传也应自动入队',
      status: 'pending',
      verdict: null,
      execution: Approval.normalizeExecutionPlan({
        queueAgent: 'supervisor-Simulaid',
        queueId: 'srap-chat-fallback',
        task: {
          projectId: 'Simulaid',
          goal: '兼容文字决策回传自动入队测试。',
        },
      }),
    }, null, 2)}\n`);
    const pulledApproval = PullDecision.applyVerdict(
      1,
      'approved',
      '采纳 1',
      'phone-message-1',
      { approvalsDir: pullApprovalDir, artifactsRoot: root }
    );
    assert.strictEqual(pulledApproval.applied, true);
    assert.strictEqual(pulledApproval.autoEnqueued, true);
    assert.strictEqual(pulledApproval.queueId, 'srap-chat-fallback');
    const pulledReplay = PullDecision.applyVerdict(
      1,
      'approved',
      '采纳 1',
      'phone-message-1',
      { approvalsDir: pullApprovalDir, artifactsRoot: root }
    );
    assert.strictEqual(pulledReplay.applied, false);
    assert.strictEqual(pulledReplay.idempotentReplay, true);
    assert.strictEqual(
      Queue.list(root, 'supervisor-Simulaid').queued
        .filter(entry => entry.id === 'srap-chat-fallback').length,
      1
    );

    const degradedTask = Approval.pushTypedApprovalCard(8, 'card-native-8', 'task-native-8', {
      title: '自包含卡片联调',
      result: '任务总账离线时仍应创建决策卡',
    }, (apiPath) => apiPath === '/api/v1/tasks'
      ? { ok: false, code: 200, upstreamStatus: 503 }
      : { ok: true, code: 200, receiptId: 'local-card-8' });
    assert.strictEqual(degradedTask.ok, true);
    assert.strictEqual(degradedTask.taskOk, false);
    assert.strictEqual(degradedTask.stage, 'card-without-task-ledger');

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
    assert.strictEqual(reportCard.payload.compact_view, true);
    assert.strictEqual(reportCard.payload.handling_process, undefined);
    assert.strictEqual(reportCard.payload.remaining_risk, undefined);
    assert.strictEqual(reportCard.payload.report_document_name, 'repair-7.html');
    assert.strictEqual(reportCard.payload.report_document_folder, '维修报告');
    assert.strictEqual(reportCard.actions[0].id, 'open_report');

    console.log('yuanxiao-card-parity: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
