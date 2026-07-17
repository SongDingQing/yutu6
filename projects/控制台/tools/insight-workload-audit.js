#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_REPORT = path.join(WORKSPACE_ROOT, 'board/insights/agent-harness-deep-research-20260714.md');
const DEFAULT_CARDS = path.join(WORKSPACE_ROOT, 'projects/控制台/artifacts/bulletin/cards.json');
const DEFAULT_QUEUE_ROOT = path.join(WORKSPACE_ROOT, 'projects/控制台/artifacts/queues');
const DEFAULT_OUT_DIR = path.join(WORKSPACE_ROOT, 'projects/控制台/artifacts/insight-workload');
const QUEUE_STATES = ['running', 'paused', 'done', 'failed', 'canceled'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。；：、,.!?！？;:()[\]{}"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReport(text) {
  const rows = Array.from(String(text || '').matchAll(/^\| (AHR-\d{2}) \|([^|]*)\|/gm))
    .map(match => ({ id: match[1], summary: match[2].trim() }));
  const urls = new Set(Array.from(String(text || '').matchAll(/https:\/\/[^)\s|]+/g), match => match[0]));
  return {
    rows,
    ids: rows.map(row => row.id),
    sources: urls.size,
  };
}

function recommendationIds(text) {
  const ids = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/AHR-(\d{2})\s*(?:\.\.|-|至)\s*(?:AHR-)?(\d{2})/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let n = Math.min(start, end); n <= Math.max(start, end); n++) {
      ids.add(`AHR-${String(n).padStart(2, '0')}`);
    }
  }
  for (const match of source.matchAll(/AHR-(\d{2})/gi)) ids.add(`AHR-${match[1]}`);
  return [...ids].sort();
}

function queueEntryFile(queueRoot, agent, id) {
  if (!agent || !id) return null;
  const dir = path.join(queueRoot, agent);
  for (const state of QUEUE_STATES) {
    const file = path.join(dir, state, `${id}.json`);
    if (fs.existsSync(file)) return { file, state };
  }
  let queued = [];
  try { queued = fs.readdirSync(dir); } catch (_) {}
  const hit = queued.find(file => file.endsWith(`-${id}.json`));
  return hit ? { file: path.join(dir, hit), state: 'queued' } : null;
}

function durationMs(entry) {
  if (!entry) return 0;
  const start = Date.parse(entry.started_at || entry.startedAt || '');
  const finish = Date.parse(entry.finished_at || entry.finishedAt || '');
  return Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? finish - start : 0;
}

function cardSignature(card) {
  const payload = card && card.payload && typeof card.payload === 'object' ? card.payload : {};
  return [
    card && card.target || 'ceo',
    card && card.project || payload.projectId || '控制台',
    card && card.title,
    payload.goal || card && (card.goal || card.desc),
  ].map(normalizeText).join('\n');
}

function buildAudit({ reportText, cards, queueRoot }) {
  const report = parseReport(reportText);
  const reportIds = new Set(report.ids);
  const packages = [];
  const coverage = new Map();
  const signatureGroups = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    const signature = cardSignature(card);
    if (signature) {
      const group = signatureGroups.get(signature) || [];
      group.push(card.id || '(no-id)');
      signatureGroups.set(signature, group);
    }
    const text = [
      card.title,
      card.desc,
      card.payload && card.payload.goal,
    ].filter(Boolean).join('\n');
    const ids = recommendationIds(text).filter(id => reportIds.has(id));
    if (!ids.length) continue;
    const queue = queueEntryFile(queueRoot, card.target || 'ceo', card.queueId);
    const queueData = queue ? readJson(queue.file, {}) : null;
    const item = {
      id: card.id || null,
      title: card.title || '',
      status: card.status || null,
      queueId: card.queueId || null,
      queueState: queue ? queue.state : null,
      durationMs: durationMs(queueData),
      recommendations: ids,
      error: queueData && queueData.error || null,
    };
    packages.push(item);
    for (const id of ids) {
      const list = coverage.get(id) || [];
      list.push(item.id);
      coverage.set(id, list);
    }
  }

  const missing = report.ids.filter(id => !coverage.has(id));
  const multiplyCovered = report.ids
    .filter(id => (coverage.get(id) || []).length > 1)
    .map(id => ({ id, cards: coverage.get(id) }));
  const duplicateCards = [...signatureGroups.values()]
    .filter(group => group.length > 1)
    .map(ids => ({ ids }));
  const totalDurationMs = packages.reduce((sum, item) => sum + item.durationMs, 0);
  const terminal = packages.filter(item => ['done', 'failed', 'canceled'].includes(item.queueState));
  return {
    generatedAt: new Date().toISOString(),
    recommendations: {
      count: report.rows.length,
      ids: report.ids,
      sources: report.sources,
      missing,
      multiplyCovered,
    },
    packages,
    packageCount: packages.length,
    terminalPackageCount: terminal.length,
    totalDurationMs,
    duplicateCards,
  };
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${seconds}s`].filter(Boolean).join(' ');
}

function renderMarkdown(audit, refs = {}) {
  const lines = [
    '# 洞察修改稿负载硬审计',
    '',
    `- 生成时间: ${audit.generatedAt}`,
    `- 报告: ${refs.report || '-'}`,
    `- 候选: ${audit.recommendations.count}`,
    `- 来源 URL: ${audit.recommendations.sources}`,
    `- 实施主题包: ${audit.packageCount}`,
    `- 已进入终态: ${audit.terminalPackageCount}`,
    `- 主题包累计运行时长: ${formatDuration(audit.totalDurationMs)}`,
    `- 未进入实施主题包候选: ${audit.recommendations.missing.length ? audit.recommendations.missing.join(', ') : '无'}`,
    `- 重复覆盖候选: ${audit.recommendations.multiplyCovered.length}`,
    `- 重复内容公告卡组: ${audit.duplicateCards.length}`,
    '',
    '## 主题包',
    '',
    '| 卡片 | AHR | 公告状态 | 队列终态 | 时长 |',
    '|---|---|---|---|---|',
  ];
  for (const item of audit.packages) {
    lines.push(`| ${item.id || '-'} ${item.title || ''} | ${item.recommendations.join(', ')} | ${item.status || '-'} | ${item.queueState || '-'} | ${formatDuration(item.durationMs)} |`);
  }
  if (!audit.packages.length) lines.push('| - | - | - | - | - |');
  lines.push('', '## 机器结论', '');
  lines.push('- 数量、编号覆盖、重复卡、队列状态和时长由本脚本判定，不再消耗模型复核。');
  lines.push('- 采纳价值、角色边界、权限和运行时风险仍交给质量运营/监管做语义复核。');
  lines.push('- 主题包处于 `enabled` 不等于实施成功，必须结合实际队列终态和 done gate 证据。');
  return `${lines.join('\n')}\n`;
}

function run(options = {}) {
  const report = path.resolve(options.report || DEFAULT_REPORT);
  const cardsFile = path.resolve(options.cards || DEFAULT_CARDS);
  const queueRoot = path.resolve(options.queueRoot || DEFAULT_QUEUE_ROOT);
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const reportText = fs.readFileSync(report, 'utf8');
  const cards = readJson(cardsFile, []);
  const audit = buildAudit({ reportText, cards, queueRoot });
  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'latest.json');
  const markdownFile = path.join(outDir, 'latest.md');
  fs.writeFileSync(jsonFile, `${JSON.stringify(audit, null, 2)}\n`);
  fs.writeFileSync(markdownFile, renderMarkdown(audit, {
    report: path.relative(WORKSPACE_ROOT, report),
    cards: path.relative(WORKSPACE_ROOT, cardsFile),
  }));
  return { audit, jsonFile, markdownFile };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = run({
    report: args.report,
    cards: args.cards,
    queueRoot: args['queue-root'],
    outDir: args['out-dir'],
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    recommendations: result.audit.recommendations.count,
    packages: result.audit.packageCount,
    totalDurationMs: result.audit.totalDurationMs,
    jsonFile: result.jsonFile,
    markdownFile: result.markdownFile,
  })}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`insight workload audit failed: ${error && error.message || error}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildAudit,
  cardSignature,
  formatDuration,
  parseReport,
  recommendationIds,
  renderMarkdown,
  run,
};
