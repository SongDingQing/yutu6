'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redactMemoryCandidate } = require('./memory-redaction');

const SECTION_DEFS = [
  ['chainEvidence', '链路证据'],
  ['handoffVerdict', '需求传递判断'],
  ['severity', '严重度'],
  ['rootCause', '根因'],
  ['actions', '处理过程'],
  ['verification', '复核验证'],
  ['architecture', '架构判断'],
  ['knowledge', '知识沉淀候选'],
  ['risks', '剩余风险 / 下一步'],
];

const REQUIRED_SECTION_KEYS = SECTION_DEFS.slice(0, 8).map(([key]) => key);
const LABEL_TO_KEY = new Map([
  ['链路证据', 'chainEvidence'],
  ['需求传递判断', 'handoffVerdict'],
  ['严重度', 'severity'],
  ['根因', 'rootCause'],
  ['处理', 'actions'],
  ['处理过程', 'actions'],
  ['验证', 'verification'],
  ['复核验证', 'verification'],
  ['架构判断', 'architecture'],
  ['知识沉淀候选', 'knowledge'],
  ['剩余风险', 'risks'],
  ['下一步', 'risks'],
  ['剩余风险 / 下一步', 'risks'],
]);

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function redactReportText(value, max = 100000) {
  return redactMemoryCandidate(String(value || ''), max)
    .replace(/\b(?:sk|ma_live|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, token => token.length >= 48 ? '[REDACTED]' : token);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseTicket(ticketText, ticketId) {
  const text = String(ticketText || '');
  const heading = text.match(/^#\s+维修工单\s+[^·\n]+(?:·\s*(.+))?$/m);
  const field = name => {
    const match = text.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  return {
    id: ticketId,
    title: heading && heading[1] ? heading[1].trim() : ticketId,
    source: field('source') || '维修部门',
    priority: field('priority') || 'normal',
    createdAt: field('created_at') || '',
  };
}

function normalizeResultLines(result) {
  const labels = [...LABEL_TO_KEY.keys()]
    .sort((a, b) => b.length - a.length)
    .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return redactReportText(result)
    .replace(/\r/g, '')
    .replace(new RegExp(`[;；]\\s*(?=(?:${labels})\\s*[:：])`, 'g'), '\n')
    .split('\n');
}

function parseResultSections(result) {
  const sections = Object.fromEntries(SECTION_DEFS.map(([key]) => [key, '']));
  const summary = [];
  let current = null;
  const labels = [...LABEL_TO_KEY.keys()]
    .sort((a, b) => b.length - a.length)
    .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const headingRe = new RegExp(`^(?:#{1,6}\\s*)?(?:[-*]\\s*)?(${labels})(?:\\s*[:：]\\s*(.*)|\\s*)$`);

  for (const rawLine of normalizeResultLines(result)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(headingRe);
    if (match) {
      current = LABEL_TO_KEY.get(match[1]) || null;
      const inline = String(match[2] || '').trim();
      if (current && inline) sections[current] = inline;
      continue;
    }
    if (current) sections[current] = [sections[current], line].filter(Boolean).join('\n');
    else summary.push(line);
  }

  return {
    sections,
    summary: summary.join('\n'),
    missingSections: REQUIRED_SECTION_KEYS.filter(key => !sections[key].trim()),
  };
}

function compact(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sectionHtml(key, label, value) {
  const body = value && value.trim()
    ? escapeHtml(value).replace(/\n/g, '<br>')
    : '<span class="missing">本项未单独列出</span>';
  return `<section class="report-section" data-section="${escapeHtml(key)}"><h2>${escapeHtml(label)}</h2><div class="section-body">${body}</div></section>`;
}

function renderReportHtml(report) {
  const missing = report.missingSections.length;
  const statusText = missing ? `已完成 · 报告缺 ${missing} 项结构字段` : '已完成 · 证据结构完整';
  const sections = SECTION_DEFS.map(([key, label]) => sectionHtml(key, label, report.sections[key])).join('\n');
  const fullResult = report.summary
    ? `<section class="report-section"><h2>补充结论</h2><div class="section-body">${escapeHtml(report.summary).replace(/\n/g, '<br>')}</div></section>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)} · 维修报告</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#d9e2ef;--blue:#2463eb;--blue-soft:#eef4ff;--green:#17825c;--orange:#b45309;--paper:#fff;--bg:#f4f7fb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;line-height:1.65}
.page{width:min(920px,calc(100% - 28px));margin:24px auto 48px}.masthead{background:var(--paper);border:1px solid var(--line);border-top:5px solid var(--blue);padding:26px;border-radius:8px}
.eyebrow{font-size:13px;font-weight:700;color:var(--blue);margin:0 0 6px}.masthead h1{font-size:26px;line-height:1.3;margin:0 0 14px}.status{display:inline-block;padding:5px 9px;border-radius:6px;background:var(--blue-soft);color:var(--blue);font-size:13px;font-weight:700}
.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);font-size:13px}.meta b{display:block;color:var(--muted);font-weight:600}.meta span{overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.report-section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:18px;min-width:0}.report-section h2{font-size:16px;margin:0 0 10px;color:var(--ink)}.section-body{font-size:14px;overflow-wrap:anywhere}.missing{color:var(--orange)}
.footer{margin-top:14px;color:var(--muted);font-size:12px;text-align:center}.footer code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:680px){.page{width:min(100% - 18px,920px);margin-top:10px}.masthead{padding:20px}.masthead h1{font-size:21px}.grid,.meta{grid-template-columns:1fr}}
@media print{body{background:#fff}.page{width:100%;margin:0}.masthead,.report-section{break-inside:avoid}.footer{margin-bottom:0}}
</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    <p class="eyebrow">玉兔6 · 维修部门固定结案报告</p>
    <h1>${escapeHtml(report.title)}</h1>
    <span class="status">${escapeHtml(statusText)}</span>
    <div class="meta">
      <div><b>维修工单</b><span>${escapeHtml(report.ticketId)}</span></div>
      <div><b>完成时间</b><span>${escapeHtml(report.completedAt)}</span></div>
      <div><b>来源 / 优先级</b><span>${escapeHtml(report.source)} / ${escapeHtml(report.priority)}</span></div>
      <div><b>内容指纹</b><span><code>${escapeHtml(report.resultHash ? report.resultHash.slice(0, 16) : '生成中')}</code></span></div>
    </div>
  </header>
  <div class="grid">${sections}${fullResult}</div>
  <p class="footer">报告由维修工单自动生成；敏感凭据已脱敏。完整依据以本机工单与事件日志为准。</p>
</main>
</body>
</html>`;
}

function commitPreparedRepairReport(report) {
  const prepared = report && report.prepared;
  if (!prepared || prepared.schemaVersion !== 1) throw new Error('prepared repair report is required');
  if (path.resolve(String(report.file || '')) !== path.resolve(String(prepared.reportFile || ''))
    || path.resolve(String(report.metaFile || '')) !== path.resolve(String(prepared.metaFile || ''))) {
    throw new Error('prepared repair report path mismatch');
  }
  const html = String(prepared.html || '');
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');
  if (!html || sha256 !== report.sha256 || Buffer.byteLength(html) !== report.sizeBytes) {
    throw new Error('prepared repair report integrity mismatch');
  }
  writeAtomic(prepared.reportFile, html);
  writeAtomic(prepared.metaFile, JSON.stringify(prepared.meta, null, 2) + '\n');
  const committed = Object.assign({}, report);
  delete committed.prepared;
  return committed;
}

function generateRepairReport(options = {}) {
  const ticketId = String(options.ticketId || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(ticketId)) throw new Error('invalid repair ticket id');
  const ticketFile = path.resolve(String(options.ticketFile || ''));
  const ticketText = fs.readFileSync(ticketFile, 'utf8');
  const result = String(options.result || '').trim();
  if (!result) throw new Error('repair report result is required');

  const artifactsRoot = path.resolve(options.artifactsRoot || path.join(__dirname, 'artifacts'));
  const outputDir = path.join(artifactsRoot, 'repair-reports');
  const reportFile = path.join(outputDir, `${ticketId}.html`);
  const metaFile = path.join(outputDir, `${ticketId}.report.json`);
  const parsedTicket = parseTicket(ticketText, ticketId);
  const parsedResult = parseResultSections(result);
  const resultHash = crypto.createHash('sha256').update(redactReportText(result)).digest('hex');
  const oldMeta = readJson(metaFile, {});
  const completedAt = oldMeta && oldMeta.result_hash === resultHash && oldMeta.completed_at
    ? oldMeta.completed_at
    : String(options.completedAt || new Date().toISOString());

  const report = {
    ticketId,
    title: parsedTicket.title,
    source: parsedTicket.source,
    priority: parsedTicket.priority,
    createdAt: parsedTicket.createdAt,
    completedAt,
    sections: parsedResult.sections,
    summary: parsedResult.summary,
    missingSections: parsedResult.missingSections,
    resultHash,
  };
  const html = renderReportHtml(report);
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');
  const sizeBytes = Buffer.byteLength(html);
  const meta = {
    schema_version: 1,
    ticket_id: ticketId,
    title: report.title,
    completed_at: completedAt,
    result_hash: resultHash,
    sha256,
    size_bytes: sizeBytes,
    missing_sections: report.missingSections,
    file: reportFile,
  };

  const generated = {
    ok: true,
    ticketId,
    title: report.title,
    source: report.source,
    priority: report.priority,
    completedAt,
    file: reportFile,
    metaFile,
    sha256,
    sizeBytes,
    sections: report.sections,
    summary: report.summary,
    missingSections: report.missingSections,
    prepared: {
      schemaVersion: 1,
      reportFile,
      metaFile,
      html,
      meta,
    },
  };
  return options.prepareOnly === true ? generated : commitPreparedRepairReport(generated);
}

function buildCompletionNotice(report) {
  const severity = compact(report.sections && report.sections.severity, 90) || '未单列';
  const rootCause = compact(report.sections && report.sections.rootCause, 180) || compact(report.summary, 180) || '见 HTML 报告';
  const verification = compact(report.sections && report.sections.verification, 180) || '见 HTML 报告';
  return [
    `工单: ${report.ticketId}`,
    `严重度: ${severity}`,
    `根因: ${rootCause}`,
    `验证: ${verification}`,
    '完整维修过程与成果见随附 HTML 报告。',
  ].join('\n');
}

module.exports = {
  SECTION_DEFS,
  REQUIRED_SECTION_KEYS,
  parseResultSections,
  renderReportHtml,
  generateRepairReport,
  commitPreparedRepairReport,
  buildCompletionNotice,
  redactReportText,
  escapeHtml,
};
