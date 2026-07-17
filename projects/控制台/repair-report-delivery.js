'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pushToInbox } = require('./tools/notify-yuanxiao-approval');
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
  const attempt = Number(previous && previous.attempts || 0) + 1;
  try {
    const pushed = sender(payload);
    if (!pushed || !pushed.ok) throw new Error(`yuanxiao HTTP ${pushed && pushed.code || 0}`);
    let receiptId = pushed.receiptId ? String(pushed.receiptId).slice(0, 160) : null;
    if (!receiptId) {
      try {
        const parsed = JSON.parse(String(pushed.raw || '{}'));
        receiptId = parsed && parsed.message && parsed.message.id ? String(parsed.message.id).slice(0, 160) : null;
      } catch (_) {}
    }
    state.deliveries[key] = {
      ticket_id: report.ticketId,
      report_sha256: report.sha256,
      status: 'sent',
      attempts: attempt,
      receipt_id: receiptId,
      http_code: Number(pushed.code || 0),
      sent_at: new Date().toISOString(),
    };
    writeJsonAtomic(stateFile, state);
    return { ok: true, sent: true, skipped: false, receiptId, code: Number(pushed.code || 0), key };
  } catch (error) {
    state.deliveries[key] = {
      ticket_id: report.ticketId,
      report_sha256: report.sha256,
      status: 'failed',
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
  deliverYuanxiao,
};
