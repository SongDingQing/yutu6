'use strict';

const fs = require('fs');
const path = require('path');

const SYSTEMIC_RE = /(系统性|全局|核心|架构|engine|引擎|queue|队列|worker|server|launchd|done\s*gate|hook|权限|授权|内存|孤儿|误杀|所有任务|任何任务|多智能体|多队列)/i;
const RECURRING_RE = /(反复|经常|重复|多次|再次|一直|每次|复发|卡住|又出现|仍然)/i;
const BROAD_RE = /(多个|所有|全局|跨模块|跨队列|跨智能体|大面积|批量|整条链路)/i;
const REQUIREMENT_HINT_RE = /(必须|需要|要求|期望|验收|目标|红线|不要|不许|确保|确认|先|再|覆盖|验证|修复)/;

function readText(file, max = 20000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!max || text.length <= max) return text;
    const head = Math.floor(max * 0.45);
    return `${text.slice(0, head)}\n...\n${text.slice(-Math.floor(max * 0.55))}`;
  } catch (_) {
    return '';
  }
}

function safeId(value) {
  const s = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(s) ? s : '';
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactText(value, max = 2000) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  try { return JSON.stringify(value).slice(0, max); }
  catch (_) { return String(value).slice(0, max); }
}

function containsAnyId(text, ids) {
  const hay = String(text || '');
  return ids.some(id => id && hay.includes(id));
}

function collectJsonlRecords(file, ids, limit = 120) {
  const text = readText(file, 2 * 1024 * 1024);
  if (!text) return [];
  const out = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = Math.max(0, lines.length - 5000); i < lines.length; i++) {
    const raw = lines[i];
    if (ids.length && !containsAnyId(raw, ids)) continue;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) {}
    out.push({
      source: 'eventlog',
      path: file,
      line: i + 1,
      type: parsed && (parsed.type || parsed.event || parsed.name) || 'raw',
      text: compactText(parsed || raw),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function collectFileRecords(dir, ids, opts = {}) {
  const maxFiles = opts.maxFiles || 80;
  const out = [];
  function walk(current, depth) {
    if (out.length >= maxFiles || depth > 5) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const nameHit = containsAnyId(entry.name, ids);
        if (nameHit || depth < 2) walk(file, depth + 1);
        continue;
      }
      if (!/\.(md|log|json|jsonl|txt)$/i.test(entry.name)) continue;
      const text = readText(file, 12000);
      if (ids.length && !containsAnyId(`${file}\n${text}`, ids)) continue;
      out.push({
        source: opts.source || 'file',
        path: file,
        text: compactText(text, 4000),
      });
    }
  }
  walk(dir, 0);
  return out;
}

function collectInteractionRecords(opts = {}) {
  const workdir = path.resolve(opts.workdir || process.env.CONSOLE_WORKDIR || path.resolve(__dirname, '../../..'));
  const artifacts = path.resolve(opts.artifactsDir || process.env.CONSOLE_ARTIFACTS_DIR || path.join(workdir, 'projects', '控制台', 'artifacts'));
  const ids = uniq([
    safeId(opts.ticketId),
    safeId(opts.taskId),
    safeId(opts.queueId),
    ...(Array.isArray(opts.ids) ? opts.ids.map(safeId) : []),
  ]);
  const records = [];
  const eventlog = opts.eventlog || path.join(artifacts, 'engine-events.jsonl');
  records.push(...collectJsonlRecords(eventlog, ids));
  records.push(...collectFileRecords(path.join(artifacts, 'engine-runs'), ids, { source: 'engine-run', maxFiles: opts.maxRunFiles || 80 }));
  records.push(...collectFileRecords(path.join(artifacts, 'queues'), ids, { source: 'queue', maxFiles: opts.maxQueueFiles || 80 }));
  return records;
}

function splitRequirementText(text) {
  return String(text || '')
    .split(/[。；;\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeRequirement(text) {
  return String(text || '')
    .replace(/[，,。；;：:\s"'`「」『』()[\]{}<>《》]+/g, '')
    .toLowerCase();
}

function extractRequirements(text) {
  const chunks = splitRequirementText(text);
  const out = [];
  const quoted = String(text || '').match(/[「『`"]([^「」『』`"]{2,80})[」』`"]/g) || [];
  for (const q of quoted) {
    const cleaned = q.replace(/^[「『`"]|[」』`"]$/g, '').trim();
    if (cleaned) out.push(cleaned);
  }
  for (const chunk of chunks) {
    if (REQUIREMENT_HINT_RE.test(chunk) || /[A-Za-z0-9_-]+/.test(chunk)) out.push(chunk.slice(0, 120));
  }
  return uniq(out.map(s => s.trim()).filter(s => normalizeRequirement(s).length >= 2));
}

function requirementCovered(requirement, text) {
  const req = normalizeRequirement(requirement);
  const hay = normalizeRequirement(text);
  if (!req) return true;
  if (hay.includes(req)) return true;
  const tokens = uniq(req.split(/(?=[A-Z])|[\/_-]+/i).filter(t => t.length >= 2));
  if (!tokens.length) return false;
  const hits = tokens.filter(t => hay.includes(t)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.7));
}

function findHandoffOmissions(interactions = []) {
  const omissions = [];
  for (const item of interactions) {
    const expected = compactText(item.expected || item.expectation || item.originalDemand || item.sourceDemand || item.goal || '');
    const brief = compactText(item.brief || item.handoff || item.transmitted || item.prompt || '');
    const actual = compactText(item.actual || item.result || item.response || item.returned || '');
    const reqs = extractRequirements(expected);
    if (!reqs.length) continue;
    const missingInBrief = reqs.filter(req => !requirementCovered(req, brief));
    const missingInActual = reqs.filter(req => !requirementCovered(req, actual));
    if (missingInBrief.length || missingInActual.length) {
      omissions.push({
        from: item.from || item.sender || '',
        to: item.to || item.receiver || '',
        missingInBrief,
        missingInActual,
        expected: expected.slice(0, 500),
        brief: brief.slice(0, 500),
        actual: actual.slice(0, 500),
        evidence: item.evidence || item.path || null,
      });
    }
  }
  return omissions;
}

function repeatedSignalCount(records = []) {
  const text = records.map(r => compactText(r.text || r)).join('\n');
  const matches = text.match(RECURRING_RE);
  return matches ? matches.length : 0;
}

function analyzeRepairContext(input = {}) {
  const ticketText = compactText(input.ticketText || input.ticket || '');
  const records = Array.isArray(input.records) ? input.records : [];
  const interactions = Array.isArray(input.interactions) ? input.interactions : [];
  const omissions = findHandoffOmissions(interactions);
  const allText = [
    ticketText,
    records.map(r => compactText(r.text || r)).join('\n'),
    interactions.map(i => compactText(i)).join('\n'),
  ].join('\n');
  const uniqueAgents = uniq(interactions.flatMap(i => [i.from, i.to]).filter(Boolean));
  const uniqueTasks = uniq([
    ...(Array.isArray(input.taskIds) ? input.taskIds : []),
    ...records.map(r => r.taskId || r.task || '').filter(Boolean),
  ]);
  const systemic = SYSTEMIC_RE.test(allText);
  const recurring = RECURRING_RE.test(allText) || repeatedSignalCount(records) >= 2;
  const broadImpact = BROAD_RE.test(allText)
    || uniqueAgents.length >= 3
    || uniqueTasks.length >= 2
    || Number(input.affectedTasks || 0) >= 2;
  const handoffOmission = omissions.length > 0;
  const severe = systemic || recurring || broadImpact || (handoffOmission && uniqueAgents.length >= 2);
  const severity = severe ? 'severe' : 'simple';
  const repairDepth = severe ? 'global_system_trace' : 'local_fix';
  const requiredInvestigation = severe
    ? [
      'reconstruct_full_chain',
      'verify_requirement_integrity_each_handoff',
      'find_root_cause_not_surface_symptom',
      'repair_or_guard_systemic_failure',
      'record_evidence_for_done_gate',
    ]
    : [
      'verify_local_reproduction',
      'apply_minimal_fix',
      'record_local_evidence_for_done_gate',
    ];
  return {
    severity,
    repairDepth,
    signals: { systemic, recurring, broadImpact, handoffOmission },
    handoffOmissions: omissions,
    requiredInvestigation,
    evidenceSummary: {
      recordCount: records.length,
      interactionCount: interactions.length,
      agents: uniqueAgents,
      tasks: uniqueTasks,
    },
  };
}

function buildRepairChecklist(analysis) {
  const a = analysis || {};
  const base = [
    '读取工单原文和红线',
    '读取 eventlog / engine-runs / queues 中的链路交互记录',
    '列出 谁派给谁 / brief / 期望返回 / 实际返回',
  ];
  if (a.repairDepth === 'global_system_trace') {
    return base.concat([
      '逐环节核对需求是否完整传递',
      '判断是否为系统性、广影响或反复问题',
      '修根因并补守卫/测试/流程记录',
      '完成记录附链路证据和 done gate 证据',
    ]);
  }
  return base.concat([
    '确认影响面局限在当前文件/当前队列项',
    '做最小局部修复',
    '完成记录附局部复现和验证证据',
  ]);
}

module.exports = {
  collectInteractionRecords,
  extractRequirements,
  findHandoffOmissions,
  analyzeRepairContext,
  buildRepairChecklist,
  requirementCovered,
};
