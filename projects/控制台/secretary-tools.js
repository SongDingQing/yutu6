#!/usr/bin/env node
'use strict';

/*
 * Secretary toolbox: read board context, discover capabilities, perform safe
 * queue/bulletin operations, and run web search without exposing secrets.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Q = require('../../shared/engine/queue');
const EventLog = require('../../shared/engine/eventlog');
const QueueAutoMerge = require('./queue-automerge');
const VersionManager = require('./tools/version-manager');

const ROOT = __dirname;
const WORKDIR = process.env.CONSOLE_WORKDIR
  ? path.resolve(process.env.CONSOLE_WORKDIR)
  : path.resolve(ROOT, '../..');
const BOARD_DIR = path.join(WORKDIR, 'board');
const REPAIR_DIR = path.join(BOARD_DIR, 'repair-tickets');
const REPAIR_LEAD_AGENT = 'repair-lead';
const REPAIR_EXECUTOR_AGENT = 'repair';
const CAP_REGISTRY = path.join(WORKDIR, 'shared', 'capability_registry', 'registry.json');
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const BULLETIN_DIR = path.join(QUEUE_ROOT, 'bulletin');
const BULLETIN_FILE = path.join(BULLETIN_DIR, 'cards.json');
const EVENTS = process.env.CONSOLE_EVENTS_FILE
  ? path.resolve(process.env.CONSOLE_EVENTS_FILE)
  : path.join(QUEUE_ROOT, 'engine-events.jsonl');
const MEOWA_CLI = path.join(WORKDIR, 'shared', 'tools', 'meowa', 'meowart_api.py');
const HERMES_ENV = path.join(process.env.HOME || '/Users/yutu6', '.hermes', '.env');
const YUTU_SECRETS = path.join(process.env.HOME || '/Users/yutu6', '.config', 'yutu6-secrets', 'secrets.env');
const YUTU_REMINDER = path.join(process.env.HOME || '/Users/yutu6', '.codex', 'modules', 'hermes-yutu-voice-bridge', 'scripts', 'send_yutu_reminder.py');
const FEISHU_NOTIFY = path.join(WORKDIR, 'shared', 'agents', 'ui-optimizer', 'notify-feishu.sh');
const MEMORY_OFFICER_AGENT = 'memory-officer';
const IT_ENGINEER_AGENT = 'it_engineer';
const OWNER_AUTO_NOTIFY_STATE = path.join(QUEUE_ROOT, 'owner-auto-notify-state.json');
const OWNER_AUTO_NOTIFY_COOLDOWN_MS = Math.max(0, parseInt(process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS || String(30 * 60 * 1000), 10) || (30 * 60 * 1000));
const FEISHU_NOTIFY_RATE_WINDOW_MS = Math.max(60 * 1000, parseInt(process.env.FEISHU_NOTIFY_RATE_WINDOW_MS || String(10 * 60 * 1000), 10) || (10 * 60 * 1000));
const FEISHU_NOTIFY_RATE_MAX = Math.max(1, parseInt(process.env.FEISHU_NOTIFY_RATE_MAX || '5', 10) || 5);
const FEISHU_NOTIFY_PENDING_LIMIT = Math.max(5, parseInt(process.env.FEISHU_NOTIFY_PENDING_LIMIT || '30', 10) || 30);
const SECRETARY_CONTEXT_MODE = String(process.env.SECRETARY_CONTEXT_MODE || 'compact').toLowerCase();
const SECRETARY_CONTEXT_FULL = /^(full|verbose|debug)$/i.test(SECRETARY_CONTEXT_MODE);
const SECRETARY_CONTEXT_CAPABILITY_LIMIT = Math.max(
  4,
  parseInt(process.env.SECRETARY_CONTEXT_CAPABILITY_LIMIT || (SECRETARY_CONTEXT_FULL ? '40' : '8'), 10)
    || (SECRETARY_CONTEXT_FULL ? 40 : 8),
);

function contextCharLimit(id, compactMax, fullMax) {
  const envName = `SECRETARY_CONTEXT_${String(id || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_CHARS`;
  const fallback = SECRETARY_CONTEXT_FULL ? fullMax : compactMax;
  return Math.max(200, parseInt(process.env[envName] || String(fallback), 10) || fallback);
}

function readText(file, max = 5000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.length <= max) return text;
    return `${text.slice(0, Math.floor(max * 0.35))}\n...\n${text.slice(-Math.floor(max * 0.65))}`;
  } catch (_) {
    return '';
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function stripNoticePrefix(title) {
  return String(title || '')
    .replace(/^(?:【直接】|【自动[:：]】|自动[:：]|自动通知[:：]?)\s*/u, '')
    .trim() || '玉兔6 通知';
}

function compactPlainNotice(text, max = 600) {
  return sanitizeOutput(String(text || ''), max * 2)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[>*`#]/g, ' ')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max)
    .trim();
}

function normalizeOwnerNotifyState(state) {
  const safe = state && typeof state === 'object' ? state : {};
  safe.notices = safe.notices && typeof safe.notices === 'object' ? safe.notices : {};
  safe.groups = safe.groups && typeof safe.groups === 'object' ? safe.groups : {};
  safe.taskWindows = safe.taskWindows && typeof safe.taskWindows === 'object' ? safe.taskWindows : {};
  safe.history = safe.history && typeof safe.history === 'object' ? safe.history : {};
  safe.feishuRate = safe.feishuRate && typeof safe.feishuRate === 'object' ? safe.feishuRate : {};
  safe.feishuRate.pending = Array.isArray(safe.feishuRate.pending) ? safe.feishuRate.pending : [];
  return safe;
}

function buildFeishuRateSummary(pending) {
  const rows = (pending || []).slice(-FEISHU_NOTIFY_PENDING_LIMIT);
  const bySource = {};
  for (const row of rows) {
    const key = row.source || 'unknown';
    bySource[key] = (bySource[key] || 0) + 1;
  }
  const examples = rows.slice(0, 5).map((row, idx) => `${idx + 1}. ${stripNoticePrefix(row.title).slice(0, 42)}`);
  const body = [
    `合并条数: ${rows.length}`,
    `来源: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(' / ') || 'unknown'}`,
    examples.length ? `摘要:\n${examples.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    title: '飞书通知合并摘要',
    body: compactPlainNotice(body, 900),
  };
}

function applyFeishuRateLimit(title, body, args = {}) {
  if (args.rateLimit === false || args.rateLimit === 'false') {
    return { allowed: true, title, body, rateLimited: false };
  }
  const now = Date.now();
  const state = normalizeOwnerNotifyState(readJson(OWNER_AUTO_NOTIFY_STATE, {}));
  const rate = state.feishuRate;
  const current = {
    atMs: now,
    at: new Date(now).toISOString(),
    title: stripNoticePrefix(title),
    body: compactPlainNotice(body, 500),
    source: String(args.source || 'secretary-tools').slice(0, 80),
  };
  const expired = !rate.windowStartMs || now - Number(rate.windowStartMs || 0) >= FEISHU_NOTIFY_RATE_WINDOW_MS;
  if (expired) {
    const pending = Array.isArray(rate.pending) ? rate.pending.filter(Boolean) : [];
    rate.windowStartMs = now;
    rate.windowStartAt = new Date(now).toISOString();
    rate.sentInWindow = 0;
    if (pending.length) {
      pending.push(current);
      const summary = buildFeishuRateSummary(pending);
      rate.pending = [];
      rate.sentInWindow = 1;
      rate.lastSummaryAtMs = now;
      rate.lastSummaryAt = new Date(now).toISOString();
      state.feishuRate = rate;
      writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
      return { allowed: true, title: summary.title, body: summary.body, rateLimited: false, summary: true, merged: pending.length };
    }
  }
  if (Number(rate.sentInWindow || 0) >= FEISHU_NOTIFY_RATE_MAX) {
    rate.pending.push(current);
    if (rate.pending.length > FEISHU_NOTIFY_PENDING_LIMIT) {
      rate.pending = rate.pending.slice(-FEISHU_NOTIFY_PENDING_LIMIT);
      rate.droppedPending = (rate.droppedPending || 0) + 1;
    }
    rate.lastLimitedAtMs = now;
    rate.lastLimitedAt = new Date(now).toISOString();
    rate.limitedCount = (rate.limitedCount || 0) + 1;
    state.feishuRate = rate;
    writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
    try {
      eventlog().emit('notify.rate_limited', {
        title: current.title.slice(0, 120),
        source: current.source,
        pending: rate.pending.length,
        windowMs: FEISHU_NOTIFY_RATE_WINDOW_MS,
        max: FEISHU_NOTIFY_RATE_MAX,
      });
    } catch (_) {}
    return { allowed: false, title: current.title, body: current.body, rateLimited: true, pending: rate.pending.length };
  }
  rate.sentInWindow = Number(rate.sentInWindow || 0) + 1;
  state.feishuRate = rate;
  writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
  return { allowed: true, title: current.title, body: current.body, rateLimited: false };
}

function safeAgent(s) {
  const agent = String(s || '');
  return /^[\p{L}\p{N}_-]+$/u.test(agent) ? agent : '';
}

function safeQueueId(s) {
  const id = String(s || '');
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

function queueTaskText(task) {
  if (task && typeof task === 'object') return String(task.goal || task.message || task.task || JSON.stringify(task)).slice(0, 240);
  return String(task || '').slice(0, 240);
}

function estimateContextTokens(text) {
  const raw = String(text || '');
  if (!raw) return 0;
  const ascii = (raw.match(/[\x00-\x7F]/g) || []).length;
  const nonAscii = raw.length - ascii;
  // 粗估即可:中文/日文等非 ASCII 约 1 字 1 token,英文按 4 字符 1 token。
  return Math.ceil(nonAscii + ascii / 4);
}

function budgetRow(id, text) {
  const raw = String(text || '');
  return {
    id,
    chars: raw.length,
    estimated_tokens: estimateContextTokens(raw),
  };
}

function contextBudget(ctx) {
  const boardRows = (ctx.board || []).map(b => budgetRow(`board:${b.id}`, b.text || ''));
  const rows = [
    ...boardRows,
    budgetRow('queues', JSON.stringify(ctx.queues || [])),
    budgetRow('bulletin', JSON.stringify(ctx.bulletin || {})),
    budgetRow('repair_tickets', JSON.stringify(ctx.repair_tickets || {})),
    budgetRow('capabilities', JSON.stringify(ctx.capabilities || [])),
    budgetRow('tools', Object.values(ctx.tools || {}).join('\n')),
  ];
  const totals = rows.reduce((acc, row) => {
    acc.chars += row.chars;
    acc.estimated_tokens += row.estimated_tokens;
    return acc;
  }, { chars: 0, estimated_tokens: 0 });
  const warnAt = Math.max(1000, parseInt(process.env.SECRETARY_CONTEXT_WARN_TOKENS || '8000', 10) || 8000);
  const top = rows
    .filter(row => row.estimated_tokens > 0)
    .sort((a, b) => b.estimated_tokens - a.estimated_tokens)
    .slice(0, 5);
  return {
    estimate: 'rough_local_chars_v1',
    warn_at_tokens: warnAt,
    status: totals.estimated_tokens > warnAt ? 'warn' : 'ok',
    total_chars: totals.chars,
    total_estimated_tokens: totals.estimated_tokens,
    top_sections: top,
    recommendations: totals.estimated_tokens > warnAt
      ? [
        '优先压缩 top_sections 中最大的 board/case 文档摘录。',
        '需要更多上下文时由秘书按需读取原文件,不要把长文永久塞进默认背景包。',
      ]
      : [
        '当前默认背景包在预算内;继续用 learning-cases/board 摘要而非全文堆叠。',
      ],
  };
}

function queueEntryStatus(agent, queueId) {
  const target = safeAgent(agent || '');
  const id = safeQueueId(queueId || '');
  if (!target || !id) return { agent: target || null, id: id || null, status: 'unknown' };
  const state = Q.list(QUEUE_ROOT, target);
  const runningIndex = (state.running || []).findIndex(entry => String(entry && entry.id || '') === id);
  if (runningIndex >= 0) {
    return { agent: target, id, status: 'running', runningActive: (state.running || []).length, queuedAhead: 0, position: 0 };
  }
  const queuedIndex = (state.queued || []).findIndex(entry => String(entry && entry.id || '') === id);
  if (queuedIndex >= 0) {
    return { agent: target, id, status: 'queued', runningActive: (state.running || []).length, queuedAhead: queuedIndex, position: queuedIndex + 1 };
  }
  const pausedIndex = (state.paused || []).findIndex(entry => String(entry && entry.id || '') === id);
  if (pausedIndex >= 0) {
    return { agent: target, id, status: 'paused', runningActive: (state.running || []).length, queuedAhead: pausedIndex, position: pausedIndex + 1 };
  }
  return { agent: target, id, status: 'not-found', runningActive: (state.running || []).length, queuedAhead: null, position: null };
}

function boardContext() {
  const files = [
    ['direction', path.join(BOARD_DIR, 'direction.md'), contextCharLimit('direction', 1200, 2400)],
    ['status-rollup', path.join(BOARD_DIR, 'status-rollup.md'), contextCharLimit('status-rollup', 1400, 4200)],
    ['progress', path.join(BOARD_DIR, 'progress.md'), contextCharLimit('progress', 900, 3200)],
    ['insights', path.join(BOARD_DIR, 'insights', 'README.md'), contextCharLimit('insights', 600, 1600)],
    ['learning-cases', path.join(BOARD_DIR, 'learning-cases', 'README.md'), contextCharLimit('learning-cases', 500, 1800)],
    ['ui-optimization-cases', path.join(BOARD_DIR, 'learning-cases', 'ui-optimization-cases.md'), contextCharLimit('ui-optimization-cases', 700, 3200)],
    ['self-reflection-optimizer-cases', path.join(BOARD_DIR, 'learning-cases', 'self-reflection-optimizer-cases.md'), contextCharLimit('self-reflection-optimizer-cases', 700, 2600)],
  ];
  return files.map(([id, file, max]) => ({
    id,
    path: path.relative(WORKDIR, file),
    text: readText(file, max).trim(),
  })).filter(x => x.text);
}

function capabilitySummary(query = '') {
  const registry = readJson(CAP_REGISTRY, {});
  const q = String(query || '').trim().toLowerCase();
  const modules = Array.isArray(registry.modules) ? registry.modules : [];
  return modules
    .filter(m => {
      if (!q) return true;
      const hay = [m.id, m.summary, ...(m.keywords || [])].join('\n').toLowerCase();
      return hay.includes(q);
    })
    .slice(0, q ? Math.max(SECRETARY_CONTEXT_CAPABILITY_LIMIT, 20) : SECRETARY_CONTEXT_CAPABILITY_LIMIT)
    .map(m => ({
      id: m.id,
      status: m.status || m.type || '',
      path: m.path || m.registered_in || '',
      summary: String(m.summary || '').replace(/\s+/g, ' ').slice(0, SECRETARY_CONTEXT_FULL ? 500 : 120),
      keywords: (m.keywords || []).slice(0, SECRETARY_CONTEXT_FULL ? 8 : 4),
    }));
}

function queueAgents() {
  const dir = path.join(QUEUE_ROOT, 'queues');
  try {
    return fs.readdirSync(dir).filter(safeAgent).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return ['ceo', 'secretary'];
  }
}

function queueSummary() {
  const rows = queueAgents().map(agent => {
    try {
      const s = Q.list(QUEUE_ROOT, agent);
      return {
        agent,
        queued: s.queued.length,
        running: s.running.length,
        paused: s.paused.length,
        done: s.done,
        failed: s.failed,
        canceled: s.canceled,
        running_items: s.running.slice(0, 3).map(x => ({ id: x.id, goal: queueTaskText(x.task), started_at: x.started_at || null })),
        queued_items: s.queued.slice(0, 5).map(x => ({ id: x.id, priority: x.priority, goal: queueTaskText(x.task) })),
      };
    } catch (e) {
      return { agent, error: e.message };
    }
  });
  if (SECRETARY_CONTEXT_FULL) return rows;
  const active = rows.filter(row => row.error || row.queued || row.running || row.paused);
  return active.length ? active.slice(0, 12) : [{ agent: 'all', queued: 0, running: 0, paused: 0, done: 'omitted', failed: 'omitted', note: 'compact mode hides inactive queue history' }];
}

function readBulletinCards() {
  const cards = readJson(BULLETIN_FILE, []);
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function bulletinSummary() {
  const cards = readBulletinCards();
  return {
    todo: cards.filter(c => c.status !== 'enabled').length,
    enabled: cards.filter(c => c.status === 'enabled').length,
    cards: cards.slice(0, 10).map(c => ({
      id: c.id,
      title: c.title,
      target: c.target,
      project: c.project || '',
      source: c.source || '',
      status: c.status,
      queueId: c.queueId || null,
    })),
  };
}

function safeTicketId(s) {
  const id = String(s || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

function slugText(s) {
  return String(s || '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'ticket';
}

function repairTicketPath(id) {
  const safe = safeTicketId(id);
  if (!safe) throw new Error('bad repair ticket id');
  return path.join(REPAIR_DIR, `${safe}.md`);
}

function repairTicketStatus(id) {
  const safe = safeTicketId(id);
  if (!safe) return '';
  const text = readText(repairTicketPath(safe), 4000);
  return ((text.match(/^- status:\s*(.+)$/m) || [null, ''])[1] || '').trim();
}

function doneLikeRepairStatus(status) {
  return /^(done|closed|canceled)$/i.test(String(status || '').trim());
}

function repairTicketIdFromBulletinCard(card) {
  if (!card) return '';
  const direct = String(card.id || '').match(/^repair-(.+)$/);
  if (direct && safeTicketId(direct[1])) return direct[1];
  const goal = card.payload && (card.payload.goal || card.payload.message || card.payload.task) || '';
  const byPath = String(goal).match(/board\/repair-tickets\/([A-Za-z0-9._-]+)\.md/);
  if (byPath && safeTicketId(byPath[1])) return byPath[1];
  const byTitle = String(goal).match(/维修工单\s+([A-Za-z0-9._-]+)/);
  if (byTitle && safeTicketId(byTitle[1])) return byTitle[1];
  return '';
}

function isRepairTarget(target) {
  return target === REPAIR_LEAD_AGENT || target === REPAIR_EXECUTOR_AGENT;
}

function removeRepairBulletinCards(ticketId, source = 'repair-ticket-complete') {
  const safe = safeTicketId(ticketId);
  if (!safe) return [];
  const cards = readBulletinCards();
  const removed = [];
  const kept = cards.filter(card => {
    const matches = card.id === `repair-${safe}` || repairTicketIdFromBulletinCard(card) === safe;
    if (matches) removed.push(card);
    return !matches;
  });
  if (removed.length) {
    writeJsonAtomic(BULLETIN_FILE, kept);
    for (const card of removed) {
      eventlog().emit('bulletin.removed', {
        bulletinId: card.id,
        target: card.target,
        title: card.title,
        source,
      });
    }
  }
  return removed;
}

function redactMemoryCandidate(text, max = 4000) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(0, max);
}

function repairMemoryQueueId(ticketId) {
  const hash = crypto.createHash('sha1').update(String(ticketId || '')).digest('hex').slice(0, 10);
  return `repair-memory-${hash}`;
}

function queueEntryExists(agent, id) {
  const safe = safeAgent(agent);
  if (!safe || !id) return false;
  const d = Q.qdir(QUEUE_ROOT, safe);
  try {
    if (fs.readdirSync(d).some(name => name.endsWith(`-${id}.json`))) return true;
  } catch (_) {}
  for (const state of ['running', 'paused', 'done', 'failed', 'canceled']) {
    if (fs.existsSync(path.join(d, state, `${id}.json`))) return true;
  }
  return false;
}

function enqueueRepairMemoryReview(ticketId, ticketFile, result, stamp) {
  const safe = safeTicketId(ticketId);
  if (!safe) return { queued: false, reason: 'bad-ticket-id' };
  const queueId = repairMemoryQueueId(safe);
  if (queueEntryExists(MEMORY_OFFICER_AGENT, queueId)) {
    eventlog().emit('memory.repair_review.skipped', { ticketId: safe, queueAgent: MEMORY_OFFICER_AGENT, queueId, reason: 'already-enqueued' });
    return { queued: false, reason: 'already-enqueued', queueAgent: MEMORY_OFFICER_AGENT, queueId };
  }
  const relFile = path.relative(WORKDIR, ticketFile);
  const task = {
    role: 'memory_officer',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: false,
    title: `维修复盘记忆提炼: ${safe}`,
    idem: `repair-memory:${safe}`,
    goal: [
      `维修工单 ${safe} 已完成,请按记忆官职责提炼长期记忆。`,
      `工单文件:${relFile}`,
      `完成时间:${stamp}`,
      '',
      '维修员完成结果(已做基础脱敏,仍需再次检查不要写入密钥/token/验证码):',
      redactMemoryCandidate(result),
      '',
      '提炼要求:',
      '1. 若完成结果中的"泛化判断"为可泛化模式,把「问题模式 → 根因 → 解法/预防/自动化建议」写入或合并到 `memory/experience.md`。',
      '2. 若包含"项目技术映射",把 `项目 → 技术/方案 → 文件路径/用途` 写入或合并到 `memory/entities.md`。',
      '3. 一次性个案默认不入库;已有记忆冲突时更新/合并,不要堆流水账。',
      '4. 只写 `memory/`;不要直接写 `knowledge/`、`kb.sqlite` 或 ingest 管道。Starlaid 排除,密钥不回显。',
    ].join('\n'),
    bounds: '只做长期记忆提炼;只写 memory/; Starlaid 一律排除; 密钥/token/验证码不写入、不回显; 不改 knowledge/ 管道。',
    inputs: [relFile, 'memory/experience.md', 'memory/entities.md', 'memory/INDEX.md'],
    acceptance: '可泛化维修经验进入 memory/experience.md; 项目技术映射进入 memory/entities.md; 一次性信息不流水账; 无密钥泄露。',
    useOrchestrator: false,
    autoApproveHuman: true,
  };
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, MEMORY_OFFICER_AGENT, task, { id: queueId, priority: 30, idem: `repair-memory:${safe}`, eventlog: eventlog(), source: 'repair-memory' });
  eventlog().emit('memory.repair_review.enqueued', {
    ticketId: safe,
    queueAgent: MEMORY_OFFICER_AGENT,
    queueId: entry.id,
    file: relFile,
  });
  return { queued: true, queueAgent: MEMORY_OFFICER_AGENT, queueId: entry.id };
}

function repairTicketList() {
  try {
    fs.mkdirSync(REPAIR_DIR, { recursive: true });
    return fs.readdirSync(REPAIR_DIR)
      .filter(f => /^[A-Za-z0-9._-]+\.md$/.test(f) && f !== 'README.md' && f !== 'TEMPLATE.md')
      .sort((a, b) => b.localeCompare(a))
      .map(name => {
        const file = path.join(REPAIR_DIR, name);
        const text = readText(file, 3000);
        const title = (text.match(/^#\s+(.+)$/m) || [null, name])[1];
        const status = (text.match(/^- status:\s*(.+)$/m) || [null, 'todo'])[1].trim();
        const created = (text.match(/^- created_at:\s*(.+)$/m) || [null, ''])[1].trim();
        return { id: name.replace(/\.md$/, ''), title, status, created_at: created, file: path.relative(WORKDIR, file) };
      });
  } catch (_) {
    return [];
  }
}

function repairSummary() {
  const tickets = repairTicketList();
  const active = tickets.filter(t => !/done|closed|canceled/i.test(t.status));
  return {
    todo: active.length,
    done: tickets.filter(t => /done|closed/i.test(t.status)).length,
    tickets: (SECRETARY_CONTEXT_FULL ? tickets : active).slice(0, SECRETARY_CONTEXT_FULL ? 10 : 5),
  };
}

function buildContext() {
  const ctx = {
    generated_at: new Date().toISOString(),
    context_mode: SECRETARY_CONTEXT_FULL ? 'full' : 'compact',
    board: boardContext(),
    queues: queueSummary(),
    bulletin: bulletinSummary(),
    repair_tickets: repairSummary(),
    capabilities: capabilitySummary(),
    tools: {
      context: 'node projects/控制台/secretary-tools.js context',
      search: 'node projects/控制台/secretary-tools.js search --query "<query>" --count 5',
      capabilities: 'node projects/控制台/secretary-tools.js capabilities [query]',
      meowa_credits: 'node projects/控制台/secretary-tools.js meowa-credits',
      meowa_skill_doc: 'node projects/控制台/secretary-tools.js meowa-skill-doc --task "<brief>"',
      bulletin_add: 'node projects/控制台/secretary-tools.js bulletin-add --title "..." --desc "..." --target ceo --source 秘书',
      bulletin_enable: 'node projects/控制台/secretary-tools.js bulletin-enable --id <card-id>  # 洞察员卡片不得后台自动启用; 需老板网页手动或 --owner-approved',
      queue_status: 'node projects/控制台/secretary-tools.js queue-status',
      queue_enqueue: 'node projects/控制台/secretary-tools.js queue-enqueue --agent ceo --goal "..."  # 传给 CEO 执行',
      queue_jump: 'node projects/控制台/secretary-tools.js queue-jump --agent <agent> --id <queue-id>  # 传给 CEO 执行',
      queue_priority: 'node projects/控制台/secretary-tools.js queue-priority --agent <agent> --id <queue-id> --priority <0-99>  # 传给 CEO 执行',
      queue_cancel: 'node projects/控制台/secretary-tools.js queue-cancel --agent <agent> --id <queue-id>  # 传给 CEO 执行',
      queue_cancel_many: 'node projects/控制台/secretary-tools.js queue-cancel-many --agent <agent> --ids "<id1,id2>"  # 传给 CEO 执行',
      queue_merge: 'node projects/控制台/secretary-tools.js queue-merge --agent <agent> --keep <queue-id> --cancel "<old-id1,old-id2>"  # 传给 CEO 执行',
      queue_organize: 'node projects/控制台/secretary-tools.js queue-organize --agent ceo --project 控制台 --dry-run ; add --apply to request CEO merge/cancel queued duplicates',
      it_release_request: 'node projects/控制台/secretary-tools.js it-release-request --part fix --message "..." --path <file>',
      it_rollback_request: 'node projects/控制台/secretary-tools.js it-rollback-request --target <version-or-commit> --reason "..."',
      repair_ticket_add: 'node projects/控制台/secretary-tools.js repair-ticket-add --title "..." --problem "..." --evidence "..." --expectation "..."',
      repair_ticket_list: 'node projects/控制台/secretary-tools.js repair-ticket-list',
      repair_ticket_complete: 'node projects/控制台/secretary-tools.js repair-ticket-complete --id <ticket-id> --result "..."',
      notify: 'node projects/控制台/secretary-tools.js notify --title "..." --body "..." [--image <本地图路径>]',
    },
  };
  ctx.context_budget = contextBudget(ctx);
  return ctx;
}

function buildContextText() {
  const ctx = buildContext();
  const board = ctx.board.map(b => `## board/${b.id}\n${b.text}`).join('\n\n');
  const queues = ctx.queues.map(q => {
    const active = [
      ...((q.running_items || []).map(x => `running ${x.id}: ${x.goal}`)),
      ...((q.queued_items || []).map(x => `queued ${x.id} p${x.priority}: ${x.goal}`)),
    ].join('\n');
    return `- ${q.agent}: running=${q.running || 0}, queued=${q.queued || 0}, paused=${q.paused || 0}, failed=${q.failed || 0}${active ? `\n${active}` : ''}`;
  }).join('\n');
  const bulletin = `todo=${ctx.bulletin.todo}, enabled=${ctx.bulletin.enabled}\n` +
    ctx.bulletin.cards.map(c => `- ${c.id} [${c.status}] ${c.title} -> ${c.target}${c.source ? ` source=${c.source}` : ''}`).join('\n');
  const repairs = `todo=${ctx.repair_tickets.todo}, done=${ctx.repair_tickets.done}\n` +
    ctx.repair_tickets.tickets.map(t => `- ${t.id} [${t.status}] ${t.title} (${t.file})`).join('\n');
  const caps = ctx.capabilities.map(c => `- ${c.id} (${c.status}): ${c.summary}`).join('\n');
  const budget = ctx.context_budget || {};
  const budgetTop = (budget.top_sections || [])
    .map(row => `- ${row.id}: 约 ${row.estimated_tokens} tokens / ${row.chars} chars`)
    .join('\n');
  const toolAllow = new Set(SECRETARY_CONTEXT_FULL
    ? Object.keys(ctx.tools)
    : ['context', 'search', 'capabilities', 'queue_status', 'queue_enqueue', 'bulletin_add', 'repair_ticket_add', 'notify']);
  const toolLines = Object.entries(ctx.tools)
    .filter(([key]) => toolAllow.has(key))
    .map(([, value]) => `- ${value}`)
    .join('\n');
  const omittedToolCount = Object.entries(ctx.tools).filter(([key]) => !toolAllow.has(key)).length;
  return [
    '[秘书后台背景包]',
    '你每次处理老板/前台派来的任务前,先以本背景包为准补足跨会话上下文。',
    `模式:${ctx.context_mode}; 默认只给摘要,需要全量时用 SECRETARY_CONTEXT_MODE=full 或按路径读取原文件。`,
    '',
    '## 上下文预算(粗估)',
    `- 状态:${budget.status || 'unknown'} · 合计约 ${budget.total_estimated_tokens || 0} tokens / ${budget.total_chars || 0} chars · 预警线 ${budget.warn_at_tokens || 0}`,
    budgetTop || '- 暂无可估算段落',
    `- 建议:${(budget.recommendations || []).join('；') || '无'}`,
    '',
    board || '(board 为空)',
    '',
    '## 队列概览',
    queues || '(无队列)',
    '',
    '## 公告板概览',
    bulletin || '(公告板为空)',
    '',
    '## 维修工单',
    repairs || '(无维修工单)',
    '',
    '## capability_registry 可用共享能力',
    caps || '(未登记能力)',
    '',
    '## 可调用工具',
    toolLines,
    !SECRETARY_CONTEXT_FULL && omittedToolCount > 0 ? `- 其余 ${omittedToolCount} 个低频工具已省略;需要时运行 SECRETARY_CONTEXT_MODE=full node projects/控制台/secretary-tools.js context-text 查看。` : null,
    '',
    '工具红线:不回显密钥/token/cookie; Starlaid 排除; 外部登录/OAuth/扫码交给主人。',
    '定位:前台 Cowork 负责深度交互/规格/可视化; 后台 secretary 负责补背景、路由、派单、队列/公告板运营; 维修员负责秘书够不到的本机特权运维工单。',
  ].join('\n');
}

function loadEnvFile(file, out) {
  const text = readText(file, 20000);
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const i = line.indexOf('=');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      if (k && out[k] == null) out[k] = v;
    }
  }
}

async function runSearch(args) {
  const query = args.query || args.q || args._[0] || '';
  if (!String(query).trim()) throw new Error('search requires --query');
  const env = Object.assign({}, process.env);
  loadEnvFile(HERMES_ENV, env);
  loadEnvFile(YUTU_SECRETS, env);
  if (!env.BRAVE_SEARCH_API_KEY) throw new Error('BRAVE_SEARCH_API_KEY is not configured');
  const count = Math.max(1, Math.min(parseInt(args.count || args.limit || '5', 10) || 5, 10));
  const { spawnSync } = require('child_process');
  const plugin = path.join(process.env.HOME || '/Users/yutu6', '.hermes', 'plugins', 'brave-search', '__init__.py');
  const script = `
import importlib.util, json, sys
path, payload = sys.argv[1], json.loads(sys.argv[2])
spec = importlib.util.spec_from_file_location('brave_search_plugin', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod._brave_search_tool(payload))
`;
  const payload = {
    query: String(query),
    count,
    country: args.country || 'CN',
    search_lang: args.search_lang || 'zh-hans',
    safesearch: args.safesearch || 'moderate',
  };
  const res = spawnSync('python3', ['-c', script, plugin, JSON.stringify(payload)], {
    cwd: WORKDIR,
    env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.error) throw new Error(`Brave Search spawn failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`Brave Search exited ${res.status}`);
  const body = JSON.parse((res.stdout || '{}').trim() || '{}');
  if (body.status !== 'ok') throw new Error(body.message || 'Brave Search failed');
  return { ok: true, provider: 'brave-search', query, results: body.results || [] };
}

function eventlog() { return new EventLog(EVENTS); }

function sanitizeOutput(text, max = 2000) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(0, max);
}

function displayPath(file) {
  if (!file) return '';
  const abs = path.resolve(process.cwd(), String(file));
  return abs.startsWith(WORKDIR + path.sep) ? path.relative(WORKDIR, abs) : abs;
}

function notify(args = {}) {
  const rawTitle = String(args.title || args._ && args._[0] || '玉兔6 通知').trim() || '玉兔6 通知';
  const rawBody = String(args.body || args.message || args.desc || args._ && args._[1] || '').trim();
  const rate = applyFeishuRateLimit(stripNoticePrefix(rawTitle), rawBody, args);
  const title = rate.title;
  const body = rate.body;
  const image = args.image || args.imagePath || args.image_path || '';
  const imagePath = image ? path.resolve(process.cwd(), String(image)) : '';
  const buttonLabel = String(args.buttonLabel || args.button_label || args.button || '').trim();
  const buttonUrl = String(args.buttonUrl || args.button_url || args.url || '').trim();
  // 三类交互(任务11):text=提问/对话(默认) / progress=进展卡片 / decision=决策按钮卡片
  const typeRaw = String(args.type || args.kind || 'text').trim().toLowerCase();
  const type = ['text', 'progress', 'decision'].includes(typeRaw) ? typeRaw : 'text';
  // 决策多按钮: 传 "label|url;;label|url" 或数组 [{label,url}]
  let buttons = '';
  if (Array.isArray(args.buttons)) {
    buttons = args.buttons.filter(b => b && b.url).map(b => `${String(b.label || '打开').replace(/[|;]/g, ' ')}|${b.url}`).join(';;');
  } else if (typeof args.buttons === 'string') {
    buttons = args.buttons.trim();
  }
  const { spawnSync } = require('child_process');
  if (!rate.allowed) {
    const result = {
      ok: false,
      attempted: false,
      sent: false,
      skipped: true,
      reason: 'rate-limited',
      title: title.slice(0, 120),
      pending: rate.pending || 0,
    };
    if (args.log !== false && args.log !== 'false') {
      eventlog().emit('notify.skipped', {
        title: result.title,
        source: args.source || 'secretary-tools',
        reason: 'rate-limited',
        pending: result.pending,
      });
    }
    return result;
  }
  if (!fs.existsSync(FEISHU_NOTIFY)) {
    return { ok: false, attempted: false, sent: false, error: 'notify-feishu.sh not found' };
  }
  const cli = [FEISHU_NOTIFY, '--type', type, '--title', title, '--body', body];
  if (imagePath) cli.push('--image', imagePath);
  if (buttonUrl) cli.push('--button-label', buttonLabel || '打开', '--button-url', buttonUrl);
  if (buttons) cli.push('--buttons', buttons);
  const res = spawnSync('bash', cli, {
    cwd: WORKDIR,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 1024 * 1024,
  });
  const stdout = sanitizeOutput(res.stdout || '', 1000);
  const stderr = sanitizeOutput(res.stderr || '', 1000);
  const sent = res.status === 0 && /\bok\b/.test(stdout);
  const result = {
    ok: sent,
    attempted: true,
    sent,
    type,
    code: res.status,
    title: title.slice(0, 120),
    rateSummary: !!rate.summary,
    merged: rate.merged || 0,
    image: imagePath ? displayPath(imagePath) : null,
    button: buttonUrl ? { label: (buttonLabel || '打开').slice(0, 30), url: buttonUrl.slice(0, 300) } : null,
    buttons: buttons ? buttons.split(';;').length : 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
  if (args.log !== false && args.log !== 'false') {
    eventlog().emit(sent ? 'notify.sent' : 'notify.failed', {
      title: result.title,
      type,
      image: result.image,
      button: !!result.button,
      buttons: result.buttons,
      code: result.code,
      reason: sent ? null : (result.stderr || result.stdout || 'not sent'),
      source: args.source || 'secretary-tools',
    });
  }
  return result;
}

function normalizeTask(args) {
  const goal = String(args.goal || args.message || '').trim();
  if (!goal) throw new Error('queue-enqueue requires --goal');
  return {
    role: args.role || (args.agent === 'ceo' ? 'orchestrator' : args.agent || 'orchestrator'),
    flowId: args.flow || args.flowId || (args.agent === 'ceo' ? 'project-route' : 'agent-once'),
    projectId: args.project || args.projectId || '控制台',
    goal,
    bounds: args.bounds || '只处理本秘书运营任务; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明。',
    acceptance: args.acceptance || '事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图。',
    useOrchestrator: args.useOrchestrator !== 'false',
    autoApproveHuman: args.autoApproveHuman !== 'false',
  };
}

async function queueEnqueue(args) {
  const agent = safeAgent(args.agent || 'ceo');
  if (!agent) throw new Error('bad --agent');
  const priority = args.priority == null ? undefined : Math.max(0, Math.min(parseInt(args.priority, 10) || 50, 99));
  const task = normalizeTask(Object.assign({}, args, { agent }));
  if (localQueueWriteRequested(args)) return queueActionLocal('enqueue', agent, args.id || '');
  return ceoQueueControl('enqueue', {
    agent,
    task,
    priority,
    idem: args.idem || `secretary:${Date.now()}`,
    id: args.id,
    reason: args.reason || '',
  });
}

function argListValue(...values) {
  const out = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value);
    else if (value != null && value !== false) out.push(value);
  }
  return out;
}

function parsePathArgs(args) {
  return argListValue(args.path, args.paths)
    .flatMap(v => String(v || '').split(','))
    .map(s => s.trim())
    .filter(Boolean);
}

function shellArg(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function itReleaseRequest(args) {
  const part = VersionManager.normalizePart(args.part || args.bump || args.kind || 'fix');
  const message = String(args.message || args.summary || args.update || '').trim();
  if (!message) throw new Error('it-release-request requires --message');
  const paths = parsePathArgs(args);
  if (!paths.length) throw new Error('it-release-request requires --path');
  const command = [
    'node projects/控制台/tools/version-manager.js release',
    `--part ${part}`,
    `--message ${shellArg(message)}`,
    ...paths.map(p => `--path ${shellArg(p)}`),
    '--push',
  ].join(' ');
  const task = {
    role: 'it_engineer',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: false,
    title: `IT 发布: ${message.slice(0, 40)}`,
    idem: args.idem || `it-release:${crypto.createHash('sha1').update([part, message, ...paths].join('\n')).digest('hex').slice(0, 12)}`,
    goal: [
      '按固定版本发布接口处理本次变更。',
      `版本段:${part}(${VersionManager.PART_LABELS[part]})`,
      `更新说明:${message}`,
      `路径清单:${paths.join(', ')}`,
      '',
      '必须执行:',
      '1. 先检查路径清单,确认不含密钥、运行产物、Starlaid。',
      '2. 运行发布命令:',
      command,
      '3. 回报版本号、commit 短哈希、push 结果。',
    ].join('\n'),
    bounds: '只做版本发布/Gitee push; 不改业务代码; 不读/写密钥; 不用 git add -A; Starlaid 排除。',
    inputs: ['VERSION.json', 'projects/控制台/tools/version-manager.js', ...paths],
    acceptance: 'VERSION.json 更新; commit message 以 v<四段版本号> 开头并写明更新内容; Gitee push 成功或报告本地 commit 与失败原因。',
    useOrchestrator: false,
    autoApproveHuman: true,
  };
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, IT_ENGINEER_AGENT, task, {
    priority: args.priority == null ? 5 : Math.max(0, Math.min(parseInt(args.priority, 10) || 5, 99)),
    idem: task.idem,
    eventlog: eventlog(),
    source: 'it-release-request',
  });
  eventlog().emit('version.release_requested', {
    queueAgent: IT_ENGINEER_AGENT,
    queueId: entry.id,
    part,
    paths,
    source: args.source || 'secretary-tools',
  });
  return { ok: true, queueAgent: IT_ENGINEER_AGENT, entry, command };
}

function itRollbackRequest(args) {
  const target = String(args.target || args.version || args.commit || '').trim();
  if (!target) throw new Error('it-rollback-request requires --target');
  const reason = String(args.reason || args.message || '').trim();
  if (!reason) throw new Error('it-rollback-request requires --reason');
  const dryRunCommand = `node projects/控制台/tools/version-manager.js rollback --target ${shellArg(target)} --dry-run`;
  const confirmCommand = `node projects/控制台/tools/version-manager.js rollback --target ${shellArg(target)} --confirm --reason ${shellArg(reason)} --push`;
  const task = {
    role: 'it_engineer',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: false,
    title: `IT 回滚 dry-run: ${target}`,
    idem: args.idem || `it-rollback:${crypto.createHash('sha1').update([target, reason].join('\n')).digest('hex').slice(0, 12)}`,
    goal: [
      '维修员发起版本回滚协作请求。先做 dry-run,不要直接回滚。',
      `目标版本/提交:${target}`,
      `维修员原因:${reason}`,
      '',
      '必须执行:',
      dryRunCommand,
      '',
      'dry-run 后回报影响范围、当前是否 clean、将回滚的提交数。',
      '只有主人明确确认后,才可在后续任务中执行:',
      confirmCommand,
    ].join('\n'),
    bounds: '只做回滚 dry-run 和确认等待; 未经主人确认不得执行 --confirm; 不重写历史、不强推、不读密钥; Starlaid 排除。',
    inputs: ['VERSION.json', 'projects/控制台/tools/version-manager.js'],
    acceptance: '返回 dry-run 计划; 如需实际回滚,明确等待主人确认; 不产生未确认回滚提交。',
    useOrchestrator: false,
    autoApproveHuman: false,
  };
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, IT_ENGINEER_AGENT, task, {
    priority: args.priority == null ? 0 : Math.max(0, Math.min(parseInt(args.priority, 10) || 0, 99)),
    idem: task.idem,
    eventlog: eventlog(),
    source: 'it-rollback-request',
  });
  eventlog().emit('version.rollback_requested', {
    queueAgent: IT_ENGINEER_AGENT,
    queueId: entry.id,
    target,
    source: args.source || 'secretary-tools',
  });
  return { ok: true, queueAgent: IT_ENGINEER_AGENT, entry, dryRunCommand, confirmCommand };
}

function consoleApiBase() {
  return String(process.env.SECRETARY_TOOLS_API_BASE || process.env.CONSOLE_API_BASE || 'http://127.0.0.1:41218').replace(/\/+$/, '');
}

function consolePostJson(apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, consoleApiBase());
    const payload = JSON.stringify(body || {});
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: Math.max(1000, parseInt(process.env.SECRETARY_TOOLS_API_TIMEOUT_MS || '10000', 10) || 10000),
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data || '{}'); }
        catch (_) { return reject(new Error(`console API returned non-JSON status ${res.statusCode}`)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || parsed.ok === false) {
          return reject(new Error(parsed.error || `console API failed with status ${res.statusCode}`));
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('console API request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

function queueActionLocal(action, agent, id) {
  throw new Error(`secretary direct queue writes are disabled; ${action} must be passed to CEO queue control`);
}

function localQueueWriteRequested(args) {
  return args && (args.local === true || args.local === 'true') || process.env.SECRETARY_TOOLS_QUEUE_LOCAL === '1';
}

function ceoQueueControl(action, body = {}) {
  return consolePostJson('/api/ceo/queue-control', Object.assign({}, body, {
    action,
    requestedBy: 'secretary-tools',
    source: 'secretary-tools',
  }));
}

async function queueAction(action, args) {
  const agent = safeAgent(args.agent || '');
  const id = String(args.id || '').trim();
  if (!agent || !id) throw new Error(`${action} requires --agent and --id`);
  if (localQueueWriteRequested(args)) return queueActionLocal(action, agent, id);
  return ceoQueueControl(action, {
    agent,
    id,
    reason: args.reason || '',
  });
}

async function queuePriority(args) {
  const agent = safeAgent(args.agent || '');
  const id = String(args.id || '').trim();
  const priority = args.priority == null ? '' : String(args.priority).trim();
  if (!agent || !id || !priority) throw new Error('queue-priority requires --agent, --id, and --priority');
  if (localQueueWriteRequested(args)) return queueActionLocal('priority', agent, id);
  return ceoQueueControl('priority', {
    agent,
    id,
    priority,
    reason: args.reason || '',
  });
}

function parseQueueIdList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return raw.map(v => String(v || '').trim()).filter(Boolean);
}

async function queueCancelMany(args) {
  const agent = safeAgent(args.agent || '');
  const ids = parseQueueIdList(args.ids || args.cancelIds || args.id);
  if (!agent || !ids.length) throw new Error('queue-cancel-many requires --agent and --ids');
  if (localQueueWriteRequested(args)) return queueActionLocal('batch-cancel', agent, ids.join(','));
  return ceoQueueControl('batch-cancel', {
    agent,
    ids,
    reason: args.reason || '',
    forceTerminal: args.forceTerminal === true || args.forceTerminal === 'true' || args.force === true || args.force === 'true',
  });
}

async function queueMerge(args) {
  const agent = safeAgent(args.agent || '');
  const keepId = String(args.keep || args.keepId || '').trim();
  const cancelIds = parseQueueIdList(args.cancel || args.cancelIds || args.ids);
  if (!agent || !keepId || !cancelIds.length) throw new Error('queue-merge requires --agent, --keep, and --cancel');
  if (localQueueWriteRequested(args)) return queueActionLocal('merge', agent, keepId);
  return ceoQueueControl('merge', {
    agent,
    keepId,
    cancelIds,
    reason: args.reason || `merged into ${keepId}`,
  });
}

async function queueOrganize(args) {
  const apply = args.apply === true || args.apply === 'true';
  const agents = parseQueueIdList(args.agents || args.agent || 'ceo').map(safeAgent).filter(Boolean);
  if (localQueueWriteRequested(args)) return queueActionLocal('organize', (agents.length ? agents : ['ceo'])[0], '');
  const base = {
    agent: (agents.length ? agents : ['ceo'])[0],
    projectId: args.project || args.projectId || '控制台',
    includePaused: args.includePaused !== false && args.includePaused !== 'false',
    mergeIntoActive: args.mergeIntoActive !== false && args.mergeIntoActive !== 'false',
    reportTerminal: args.reportTerminal === true || args.reportTerminal === 'true',
    allowCrossAgentMerge: args.allowCrossAgentMerge === true || args.allowCrossAgentMerge === 'true',
    allowSimilarityApply: args.allowSimilarityApply === true || args.allowSimilarityApply === 'true',
  };
  if (!apply) return ceoQueueControl('organize', Object.assign({}, base, { apply: false }));
  let plan = null;
  if (args.planFile) {
    plan = readJson(path.resolve(WORKDIR, String(args.planFile)), null);
    if (!plan) throw new Error(`queue-organize --apply could not read plan file: ${args.planFile}`);
  } else if (args.plan) {
    try { plan = JSON.parse(String(args.plan)); }
    catch (_) { throw new Error('queue-organize --plan must be valid JSON'); }
  } else {
    plan = await ceoQueueControl('organize', Object.assign({}, base, { apply: false }));
  }
  return ceoQueueControl('organize', Object.assign({}, base, { apply: true, plan }));
}

function bulletinCardFromArgs(args) {
  const title = String(args.title || '').trim();
  if (!title) throw new Error('bulletin-add requires --title');
  const desc = String(args.desc || args.description || '').trim();
  const target = safeAgent(args.target || 'ceo');
  if (!target) throw new Error('bad --target');
  const project = String(args.project || '控制台').slice(0, 80);
  const source = String(args.source || '秘书').slice(0, 80);
  const goal = String(args.goal || `${title}${desc ? '\n\n' + desc : ''}`).trim();
  return {
    id: args.id || `bb-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    title: title.slice(0, 140),
    desc: desc.slice(0, 1200),
    target,
    project,
    source,
    payload: {
      role: target === 'ceo' ? 'orchestrator' : target,
      flowId: target === 'ceo' ? 'project-route' : 'agent-once',
      projectId: project,
      goal,
      bounds: '只处理本公告板任务; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明。',
      acceptance: '任务有事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图。',
      useOrchestrator: target === 'ceo',
      autoApproveHuman: true,
    },
    status: 'todo',
    created_at: new Date().toISOString(),
    enabled_at: null,
    queueId: null,
  };
}

function bulletinAdd(args) {
  const cards = readBulletinCards();
  const card = bulletinCardFromArgs(args);
  if (cards.some(c => c.id === card.id)) throw new Error('bulletin id exists');
  cards.unshift(card);
  writeJsonAtomic(BULLETIN_FILE, cards);
  eventlog().emit('bulletin.added', { bulletinId: card.id, target: card.target, title: card.title, source: card.source || null });
  return { ok: true, card };
}

function isInsightBulletinCard(card) {
  const text = [
    card && card.source,
    card && card.id,
    card && card.title,
  ].filter(Boolean).join('\n');
  return /洞察员|insight[-_ ]?scout|^insight-/i.test(text);
}

function ownerApprovedBulletinEnable(args) {
  return args.ownerApproved === true
    || args['owner-approved'] === true
    || args.manual === true
    || args.confirm === true
    || args['confirm-insight'] === true;
}

function bulletinEnable(args) {
  const id = String(args.id || '').trim();
  if (!id) throw new Error('bulletin-enable requires --id');
  const cards = readBulletinCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx < 0) throw new Error('bulletin card not found');
  const card = cards[idx];
  const target = safeAgent(card.target || 'ceo');
  if (card.status === 'enabled') return { ok: true, already: true, card, queueStatus: queueEntryStatus(target, card.queueId) };
  if (target === 'ceo' && isInsightBulletinCard(card) && !ownerApprovedBulletinEnable(args)) {
    eventlog().emit('bulletin.enable_blocked', {
      bulletinId: id,
      target,
      source: card.source || null,
      reason: 'insight-requires-owner-enable',
    });
    return {
      ok: false,
      blocked: true,
      reason: 'insight-requires-owner-enable',
      message: '洞察员公告板卡片只作为建议暂存; 需要老板在网页手动启用, 或显式传 --owner-approved。',
      card,
    };
  }
  const repairTicketId = isRepairTarget(target) ? repairTicketIdFromBulletinCard(card) : '';
  const repairStatus = repairTicketId ? repairTicketStatus(repairTicketId) : '';
  if (repairTicketId && doneLikeRepairStatus(repairStatus)) {
    const [removed] = cards.splice(idx, 1);
    writeJsonAtomic(BULLETIN_FILE, cards);
    eventlog().emit('bulletin.enable_skipped', {
      bulletinId: id,
      reason: 'repair-ticket-already-done',
      ticketId: repairTicketId,
      status: repairStatus,
    });
    eventlog().emit('bulletin.removed', {
      bulletinId: id,
      target: removed.target,
      title: removed.title,
      source: 'repair-ticket-already-done',
    });
    return { ok: true, alreadyDone: true, ticketId: repairTicketId, status: repairStatus, card: removed };
  }
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, target, card.payload || { goal: card.title }, { idem: `bulletin:${id}`, eventlog: eventlog(), source: 'bulletin' });
  card.status = 'enabled';
  card.enabled_at = new Date().toISOString();
  card.queueId = entry.id;
  cards[idx] = card;
  writeJsonAtomic(BULLETIN_FILE, cards);
  eventlog().emit('bulletin.enabled', { bulletinId: id, queueAgent: target, queueId: entry.id, goal: queueTaskText(entry.task), source: card.source || null });
  eventlog().emit('queue.enqueued', { queueAgent: target, queueId: entry.id, priority: entry.priority, goal: queueTaskText(entry.task), source: 'bulletin', bulletinId: id });
  return { ok: true, card, entry, queueStatus: queueEntryStatus(target, entry.id) };
}

function bulletinRemove(args) {
  const id = String(args.id || '').trim();
  if (!id) throw new Error('bulletin-remove requires --id');
  const cards = readBulletinCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx < 0) throw new Error('bulletin card not found');
  const [card] = cards.splice(idx, 1);
  writeJsonAtomic(BULLETIN_FILE, cards);
  eventlog().emit('bulletin.removed', { bulletinId: id, target: card.target, title: card.title, source: card.source || null });
  return { ok: true, card };
}

function repairTicketMarkdown(ticket) {
  const evidence = ticket.evidence ? String(ticket.evidence).split(/\\n|\r?\n/).map(x => `- ${x}`).join('\n') : '- (秘书未提供)';
  const redlines = ticket.redlines ? String(ticket.redlines).split(/\\n|\r?\n/).map(x => `- ${x}`).join('\n') : [
    '- 高危/不可逆操作必须先给主人确认',
    '- 密钥/token/cookie/私钥不回显、不写日志',
    '- Starlaid 排除',
    '- 不破现有功能; 能验证就写验证结果',
  ].join('\n');
  return [
    `# 维修工单 ${ticket.id} · ${ticket.title}`,
    '',
    '- status: todo',
    `- created_at: ${ticket.created_at}`,
    `- source: ${ticket.source}`,
    `- priority: ${ticket.priority}`,
    '',
    '## 问题',
    ticket.problem || '(秘书未提供)',
    '',
    '## 事件证据 / 路径',
    evidence,
    '',
    '## 期望结果',
    ticket.expectation || '(秘书未提供)',
    '',
    '## 红线',
    redlines,
    '',
    '## 维修部门消费方式(v3 主管先行)',
    '`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:',
    '',
    '```bash',
    `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/${ticket.id}.md)"`,
    '```',
    '',
    '## 处理结果',
    '- status: todo',
    '',
  ].join('\n');
}

function compactCardDesc(text, fallback = '查看工单并处理') {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || fallback).slice(0, 48);
}

function repairTicketAdd(args) {
  const title = String(args.title || '').trim();
  if (!title) throw new Error('repair-ticket-add requires --title');
  const stamp = new Date().toISOString();
  const local = stamp.replace(/[-:TZ.]/g, '').slice(0, 14);
  const id = safeTicketId(args.id) || `repair-${local}-${slugText(title)}`;
  const file = repairTicketPath(id);
  if (fs.existsSync(file)) throw new Error('repair ticket exists');
  const ticket = {
    id,
    title: title.slice(0, 120),
    created_at: stamp,
    source: String(args.source || '秘书').slice(0, 80),
    priority: String(args.priority || 'normal').slice(0, 40),
    problem: String(args.problem || args.desc || args.description || '').trim(),
    evidence: String(args.evidence || '').trim(),
    expectation: String(args.expectation || args.expected || '').trim(),
    redlines: String(args.redlines || args.bounds || '').trim(),
  };
  fs.mkdirSync(REPAIR_DIR, { recursive: true });
  fs.writeFileSync(file, repairTicketMarkdown(ticket));

  const skipBulletin = args.bulletin === 'false'
    || args.skipBulletin === 'true'
    || args.noBulletin === 'true'
    || ticket.source === '自动故障触发'
    || /^auto-/.test(id);
  const card = {
    id: `repair-${id}`,
    title: `维修工单: ${ticket.title}`,
    desc: compactCardDesc(ticket.problem || ticket.expectation),
    target: REPAIR_LEAD_AGENT,
    project: '控制台',
    source: '维修工单',
    payload: {
      role: 'repair-lead',
      flowId: 'agent-once',
      projectId: '控制台',
      goal: [
        `维修工单 ${id}`,
        `读取 board/repair-tickets/${id}.md。`,
        '你是维修主管:先读链路交互记录,判断需求传递是否遗漏、严重度和根因。',
        '小问题可直接最小修复;严重问题做全局系统排查,并把写码执行分派给 repair 维修员。',
        '复核维修员结果后再 repair-ticket-complete 结案。',
      ].join('\n'),
      bounds: '维修主管特权工单; 高危先确认; Starlaid 排除; 密钥不回显。',
      acceptance: '链路证据、严重度、根因、处理/派工、复核验证和架构判断写入工单结果; 必要时通知主人。',
      useOrchestrator: false,
      autoApproveHuman: false,
      engineSlotBypass: true,
    },
    status: 'todo',
    created_at: stamp,
    enabled_at: null,
    queueId: null,
  };
  let bulletinId = null;
  if (!skipBulletin) {
    const cards = readBulletinCards();
    if (!cards.some(c => c.id === card.id)) {
      cards.unshift(card);
      writeJsonAtomic(BULLETIN_FILE, cards);
      eventlog().emit('bulletin.added', { bulletinId: card.id, target: card.target, title: card.title, source: card.source });
    }
    bulletinId = card.id;
  }
  eventlog().emit('repair.ticket.created', { ticketId: id, file: path.relative(WORKDIR, file), title: ticket.title, source: ticket.source });
  return { ok: true, ticket: { id, file: path.relative(WORKDIR, file), title: ticket.title }, bulletinId };
}

function compactNoticeText(text, max = 500) {
  return sanitizeOutput(text, max)
    .replace(/\s+/g, ' ')
    .trim() || '未提供详情';
}

function shouldSkipRepairCompletionNotice(ticketId, title, body) {
  const state = readJson(OWNER_AUTO_NOTIFY_STATE, {});
  state.notices = state.notices && typeof state.notices === 'object' ? state.notices : {};
  const fingerprint = crypto.createHash('sha256').update(['repair-complete', ticketId].join('\n')).digest('hex').slice(0, 16);
  const now = Date.now();
  const last = state.notices[fingerprint] || {};
  if (OWNER_AUTO_NOTIFY_COOLDOWN_MS && last.atMs && now - last.atMs < OWNER_AUTO_NOTIFY_COOLDOWN_MS) {
    state.notices[fingerprint] = Object.assign({}, last, {
      skipped: (last.skipped || 0) + 1,
      lastSkippedAt: new Date(now).toISOString(),
      lastBody: body,
    });
    writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
    eventlog().emit('repair.ticket.notify_skipped', {
      ticketId,
      reason: 'dedupe-cooldown',
      fingerprint,
    });
    return { skipped: true, fingerprint };
  }
  state.notices[fingerprint] = {
    atMs: now,
    at: new Date(now).toISOString(),
    kind: 'repair-complete',
    ticketId,
    title,
    body,
    skipped: 0,
  };
  writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
  return { skipped: false, fingerprint };
}

function repairTicketComplete(args) {
  const id = safeTicketId(args.id || '');
  if (!id) throw new Error('repair-ticket-complete requires --id');
  const file = repairTicketPath(id);
  if (!fs.existsSync(file)) throw new Error('repair ticket not found');
  const result = String(args.result || args.summary || '').trim();
  if (!result) throw new Error('repair-ticket-complete requires --result');
  const stamp = new Date().toISOString();
  const current = fs.readFileSync(file, 'utf8');
  const updated = current
    .replace(/^- status:\s*todo\s*$/m, '- status: done')
    .replace(/## 处理结果\n- status:\s*todo/, '## 处理结果\n- status: done');
  fs.writeFileSync(file, updated);
  fs.appendFileSync(file, [
    '',
    `### 完成记录 ${stamp}`,
    '- status: done',
    '',
    result,
    '',
  ].join('\n'));
  eventlog().emit('repair.ticket.completed', { ticketId: id, file: path.relative(WORKDIR, file) });
  const removedBulletins = removeRepairBulletinCards(id);
  let memoryReview = { queued: false, reason: 'not-attempted' };
  try {
    memoryReview = enqueueRepairMemoryReview(id, file, result, stamp);
  } catch (e) {
    memoryReview = { queued: false, reason: e.message };
    eventlog().emit('memory.repair_review.enqueue_failed', { ticketId: id, reason: e.message });
  }
  let notifyResult = { attempted: false };
  if (args.notify !== 'false') {
    const title = `关键修复完成: ${id}`;
    const body = [
      `工单: board/repair-tickets/${id}.md`,
      `修复: ${compactNoticeText(result, 500)}`,
    ].join('\n');
    const dedupe = shouldSkipRepairCompletionNotice(id, title, body);
    if (dedupe.skipped) {
      notifyResult = { attempted: false, sent: false, skipped: true, reason: 'dedupe-cooldown', fingerprint: dedupe.fingerprint };
    } else {
      notifyResult = notify({
        title,
        body,
        source: 'repair-ticket-complete',
        log: false,
      });
      eventlog().emit(notifyResult.sent ? 'repair.ticket.notify_sent' : 'repair.ticket.notify_failed', {
        ticketId: id,
        channel: 'feishu',
        code: notifyResult.code,
        reason: notifyResult.sent ? null : (notifyResult.stderr || notifyResult.stdout || 'not sent'),
      });
    }
  }
  if (args.notify !== 'false' && !notifyResult.skipped && !notifyResult.sent && fs.existsSync(YUTU_REMINDER)) {
    const { spawnSync } = require('child_process');
    const res = spawnSync('python3', [YUTU_REMINDER, '--context', `关键修复完成 ${id}`, `维修员完成关键修复: ${result.slice(0, 300)}`], {
      cwd: WORKDIR,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    notifyResult = Object.assign({}, notifyResult, {
      yutuReminder: { attempted: true, ok: res.status === 0, code: res.status },
    });
  }
  return { ok: true, ticket: { id, file: path.relative(WORKDIR, file) }, removedBulletins: removedBulletins.map(card => card.id), memoryReview, notify: notifyResult };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function spawnMeowa(subcmd, args) {
  const { spawnSync } = require('child_process');
  const extra = [];
  if (subcmd === 'skill-doc') {
    if (!args.task) throw new Error('meowa-skill-doc requires --task');
    extra.push('skill-doc', '--task', args.task);
  } else if (subcmd === 'credits-balance') {
    extra.push('credits-balance');
  } else {
    throw new Error('unsupported meowa command');
  }
  const res = spawnSync('python3', [MEOWA_CLI, ...extra], { cwd: WORKDIR, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  return { ok: res.status === 0, code: res.status, stdout: res.stdout || '', stderr: (res.stderr || '').replace(/(ma_live_)[A-Za-z0-9_-]+/g, '$1[REDACTED]') };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let result;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    result = {
      ok: true,
      commands: ['context', 'context-text', 'search', 'capabilities', 'notify', 'queue-status', 'queue-enqueue', 'queue-jump', 'queue-priority', 'queue-cancel', 'queue-cancel-many', 'queue-merge', 'queue-organize', 'it-release-request', 'it-rollback-request', 'bulletin-list', 'bulletin-add', 'bulletin-enable', 'bulletin-remove', 'repair-ticket-list', 'repair-ticket-add', 'repair-ticket-complete', 'meowa-credits', 'meowa-skill-doc'],
    };
  } else if (cmd === 'context') result = buildContext();
  else if (cmd === 'context-text') return process.stdout.write(buildContextText() + '\n');
  else if (cmd === 'search') result = await runSearch(args);
  else if (cmd === 'capabilities') result = { ok: true, modules: capabilitySummary(args._[0] || args.query || '') };
  else if (cmd === 'notify') result = notify(args);
  else if (cmd === 'queue-status') result = { ok: true, queues: queueSummary() };
  else if (cmd === 'queue-enqueue') result = await queueEnqueue(args);
  else if (cmd === 'queue-jump') result = await queueAction('jump', args);
  else if (cmd === 'queue-priority') result = await queuePriority(args);
  else if (cmd === 'queue-cancel') result = await queueAction('cancel', args);
  else if (cmd === 'queue-cancel-many') result = await queueCancelMany(args);
  else if (cmd === 'queue-merge') result = await queueMerge(args);
  else if (cmd === 'queue-organize') result = await queueOrganize(args);
  else if (cmd === 'it-release-request') result = itReleaseRequest(args);
  else if (cmd === 'it-rollback-request') result = itRollbackRequest(args);
  else if (cmd === 'bulletin-list') result = { ok: true, bulletin: bulletinSummary(), cards: readBulletinCards() };
  else if (cmd === 'bulletin-add') result = bulletinAdd(args);
  else if (cmd === 'bulletin-enable') result = bulletinEnable(args);
  else if (cmd === 'bulletin-remove') result = bulletinRemove(args);
  else if (cmd === 'repair-ticket-list') result = { ok: true, repair_tickets: repairSummary(), tickets: repairTicketList() };
  else if (cmd === 'repair-ticket-add') result = repairTicketAdd(args);
  else if (cmd === 'repair-ticket-complete') result = repairTicketComplete(args);
  else if (cmd === 'meowa-credits') result = spawnMeowa('credits-balance', args);
  else if (cmd === 'meowa-skill-doc') result = spawnMeowa('skill-doc', args);
  else throw new Error(`unknown command: ${cmd}`);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(e => {
    process.stderr.write(String(e && e.message || e).replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]') + '\n');
    process.exit(1);
  });
}

module.exports = {
  buildContext,
  buildContextText,
  estimateContextTokens,
  contextBudget,
  capabilitySummary,
  queueSummary,
  queueOrganize,
  itReleaseRequest,
  itRollbackRequest,
  bulletinSummary,
  bulletinEnable,
  repairSummary,
  repairTicketAdd,
  repairTicketComplete,
  notify,
};
