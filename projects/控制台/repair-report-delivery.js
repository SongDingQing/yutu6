'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pushToInbox, pushToYuanxiaoPath } = require('./tools/notify-yuanxiao-approval');
const { redactReportText } = require('./repair-report');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function compact(value, max = 220) {
  return redactReportText(value, max * 3).replace(/\s+/g, ' ').trim().slice(0, max);
}

function deliveryKey(report) {
  return crypto.createHash('sha256')
    .update(`repair-report-yuanxiao-v1\n${report.ticketId}\n${report.sha256}`)
    .digest('hex');
}

function buildYuanxiaoPayload(report, html) {
  const severity = compact(report.sections && report.sections.severity, 80) || '未单列';
  const rootCause = compact(report.sections && report.sections.rootCause, 200) || compact(report.summary, 200) || '见维修报告';
  const verification = compact(report.sections && report.sections.verification, 200) || '见维修报告';
  const preview = `严重度: ${severity}\n根因: ${rootCause}\n验证: ${verification}`;
  return {
    text: [
      `## 维修工单完成 · ${compact(report.title, 80)}`,
      '',
      `- 工单: ${report.ticketId}`,
      `- 严重度: ${severity}`,
      `- 根因: ${rootCause}`,
      `- 验证: ${verification}`,
      '- 完整维修过程与成果已同步到「维修报告」文档。',
    ].join('\n'),
    speaker: '维修主管',
    conversation: 'yuanxiao-app',
    format: 'markdown',
    source: 'repair-report',
    task_id: report.ticketId,
    dedupe_key: deliveryKey(report),
    files: [{
      document_update: true,
      document_folder: '维修报告',
      document_name: `${report.ticketId}.html`,
      name: `${report.ticketId}.html`,
      mime_type: 'text/html; charset=utf-8',
      size: `${report.sizeBytes} bytes`,
      sha256: report.sha256,
      content: html,
      preview_text: preview,
      find_hint: `元宵文档 / 维修报告 / ${report.ticketId}.html`,
    }],
  };
}

function buildTypedReportCard(report) {
  const sections = report.sections || {};
  const severity = compact(sections.severity, 80) || '未单列';
  const rootCause = compact(sections.rootCause, 260) || compact(report.summary, 260) || '见维修报告';
  const actions = compact(sections.actions, 320) || '见维修报告';
  const verification = compact(sections.verification, 260) || '见维修报告';
  const risks = compact(sections.risks, 260) || '无新增风险';
  const owner = compact(report.owner || '维修主管', 80);
  return {
    card_id: `repair-report-${String(report.ticketId).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 90)}`,
    card_type: 'report',
    task_id: report.ticketId,
    status: 'resolved',
    title: `问题处理报告 · ${compact(report.title, 100)}`,
    summary: rootCause,
    renderer: 'android_native_v2',
    actions: [{ id: 'open_report', label: '打开维修报告' }],
    payload: {
      report_kind: 'issue',
      severity,
      root_cause: rootCause,
      handling_process: actions,
      verification,
      remaining_risk: risks,
      responsible_party: owner,
      owner,
      handling_status: '已完成并复核',
      report_document_name: `${report.ticketId}.html`,
      report_document_folder: '维修报告',
      artifact_refs: [{
        kind: 'repair_html',
        name: `${report.ticketId}.html`,
        sha256: report.sha256,
      }],
    },
    actor: 'repair-report-delivery',
  };
}

function classifyError(error) {
  const text = String(error && error.message || error || '').toLowerCase();
  if (/timeout|timed out/.test(text)) return 'timeout';
  if (/permission|forbidden|denied/.test(text)) return 'permission';
  if (/connect|network|ssh|socket/.test(text)) return 'network';
  return 'delivery';
}

function deliverYuanxiao(report, options = {}) {
  if (!report || !report.ticketId || !report.file || !report.sha256) throw new Error('invalid repair report');
  const artifactsRoot = path.resolve(options.artifactsRoot || path.join(__dirname, 'artifacts'));
  const stateFile = path.resolve(options.stateFile || path.join(artifactsRoot, 'repair-reports', 'delivery-state.json'));
  const key = deliveryKey(report);
  const state = readJson(stateFile, { schema_version: 1, deliveries: {} });
  state.schema_version = 1;
  state.deliveries = state.deliveries && typeof state.deliveries === 'object' ? state.deliveries : {};
  const previous = state.deliveries[key];
  if (previous && previous.status === 'sent') {
    return { ok: true, sent: false, skipped: true, reason: 'already-sent', receiptId: previous.receipt_id || null, key };
  }

  const html = fs.readFileSync(report.file, 'utf8');
  const payload = buildYuanxiaoPayload(report, html);
  const sender = options.sender || pushToInbox;
  const cardSender = options.cardSender || pushToYuanxiaoPath;
  const attempt = Number(previous && previous.attempts || 0) + 1;
  let receiptId = previous && previous.receipt_id || null;
  let inboxSent = Boolean(previous && previous.inbox_sent);
  try {
    if (!inboxSent) {
      const pushed = sender(payload);
      if (!pushed || !pushed.ok) throw new Error(`yuanxiao HTTP ${pushed && pushed.code || 0}`);
      receiptId = pushed.receiptId ? String(pushed.receiptId).slice(0, 160) : null;
      if (!receiptId) {
        try {
          const parsed = JSON.parse(String(pushed.raw || '{}'));
          receiptId = parsed && parsed.message && parsed.message.id ? String(parsed.message.id).slice(0, 160) : null;
        } catch (_) {}
      }
      inboxSent = true;
      state.deliveries[key] = {
        ticket_id: report.ticketId,
        report_sha256: report.sha256,
        status: 'card_pending',
        inbox_sent: true,
        attempts: attempt,
        receipt_id: receiptId,
        sent_at: new Date().toISOString(),
      };
      writeJsonAtomic(stateFile, state);
    }

    const taskResult = cardSender('/api/v1/tasks', {
      task_id: report.ticketId,
      title: compact(report.title, 160),
      kind: 'repair',
      route: 'repair',
      status: 'done',
      progress: 100,
      project_id: '控制台',
      message: compact(report.summary || report.sections && report.sections.rootCause, 600),
    });
    if (!taskResult || !taskResult.ok) throw new Error(`yuanxiao typed task HTTP ${taskResult && taskResult.code || 0}`);
    const cardResult = cardSender('/api/v1/cards', buildTypedReportCard(report));
    if (!cardResult || !cardResult.ok) throw new Error(`yuanxiao typed card HTTP ${cardResult && cardResult.code || 0}`);
    state.deliveries[key] = {
      ticket_id: report.ticketId,
      report_sha256: report.sha256,
      status: 'sent',
      inbox_sent: true,
      native_card_sent: true,
      attempts: attempt,
      receipt_id: receiptId,
      http_code: 200,
      sent_at: new Date().toISOString(),
    };
    writeJsonAtomic(stateFile, state);
    return { ok: true, sent: true, skipped: false, receiptId, nativeCard: true, code: 200, key };
  } catch (error) {
    state.deliveries[key] = {
      ticket_id: report.ticketId,
      report_sha256: report.sha256,
      status: 'failed',
      inbox_sent: inboxSent,
      attempts: attempt,
      reason_class: classifyError(error),
      failed_at: new Date().toISOString(),
    };
    writeJsonAtomic(stateFile, state);
    return { ok: false, sent: false, skipped: false, reasonClass: classifyError(error), key };
  }
}

module.exports = {
  deliveryKey,
  buildYuanxiaoPayload,
  buildTypedReportCard,
  deliverYuanxiao,
};
