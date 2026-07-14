#!/usr/bin/env node
/*
 * 玉兔6 · 本地控制台服务(零依赖 Node)
 * 蓝图 §5/§6:本地小服务 + 聊天网页;后端按所选 runner 把消息喂给对应 CLI(无头),流式回显。
 * 仅监听 127.0.0.1(localhost),不对外。CLI(codex)需在本机 PATH 可见。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process'); // [B-1 去同步阻塞] spawnSync 已全部移除
const SetupService = require('./setup-service');
SetupService.loadPrivateEnv();
const EventLog = require('../../shared/engine/eventlog');
const Q = require('../../shared/engine/queue');
const QueueOrganizer = require('../../shared/engine/queue-organizer');
const QueueAutoMerge = require('./queue-automerge');
const LocateAnything = require('./locate-anything-service');
const SecretaryTools = require('./secretary-tools');
const LlmUsage = require('./llm-usage');
const Runtime = require('./engine-runtime');
const VersionManager = require('./tools/version-manager');
const RuntimePaths = require('./runtime-paths');
const InsightScoutRepos = require('./insight-scout-repos');
const DecisionToken = require('./decision-token');
const ProjectDepartments = require('./project-departments');
// [B-1 去同步阻塞] 异步 sqlite / JSONL 增量游标 / 目录签名 async 版(稳定性拍板)
const AsyncUnblock = require('./async-unblock');

const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = process.env.PORT || cfg.port || 8787;
const HOST = '127.0.0.1';
const WORKDIR = path.resolve(ROOT, cfg.workdir || '.');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.json':'application/json; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.log':'text/plain; charset=utf-8', '.md':'text/markdown; charset=utf-8' };

// 任务历史(file = brain):每次派单追加一行 JSONL,供 WebUI 历史抽屉读取
const HISTORY = path.join(ARTIFACTS_ROOT, 'task-history.jsonl');
const ENGINE_EVENTS = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const ENGINE_JOBS = path.join(ARTIFACTS_ROOT, 'engine-jobs');
const ENGINE_TASKS = path.join(ARTIFACTS_ROOT, 'engine-tasks');
const ENGINE_RUNS = path.join(ARTIFACTS_ROOT, 'engine-runs');
const ENGINE_WORKER_LOG = path.join(ARTIFACTS_ROOT, 'engine-worker.log');
const QUEUE_ROOT = ARTIFACTS_ROOT;
const QUEUE_WORKER_LOG_DIR = path.join(ARTIFACTS_ROOT, 'queue-workers');
const TASK_ATTACHMENT_DIR = path.join(ARTIFACTS_ROOT, 'task-attachments');
const BULLETIN_DIR = path.join(ARTIFACTS_ROOT, 'bulletin');
const BULLETIN_FILE = path.join(BULLETIN_DIR, 'cards.json');
// 飞书决策卡真回调(拍板 Q12):默认开;DECISION_CALLBACK_ENABLED=0 可整体关闭 /api/decision 端点
const DECISION_CALLBACK_ENABLED = process.env.DECISION_CALLBACK_ENABLED !== '0';
const DECISION_ACTIONS_FILE = path.join(BULLETIN_DIR, 'decision-actions.json');
const PEEKABOO_BASELINE_DIR = path.join(ARTIFACTS_ROOT, 'peekaboo-baseline');
const NEW_API_BASE = (process.env.NEW_API_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const NEW_API_DB = process.env.NEW_API_DB || path.join(ARTIFACTS_ROOT, 'new-api', 'data', 'one-api.db');
const NEW_API_QUOTA_USD_DIVISOR = Math.max(1, Number(process.env.NEW_API_QUOTA_USD_DIVISOR || 500000) || 500000);
const WORKER_SUPERVISE_MS = Math.max(1000, parseInt(process.env.WORKER_SUPERVISE_MS || '10000', 10) || 10000);
const QUEUE_WORKER_EVENT_WAKE_ENABLED = process.env.QUEUE_WORKER_EVENT_WAKE_ENABLED !== '0';
const QUEUE_WORKER_EVENT_WAKE_DEBOUNCE_MS = Math.max(0, parseInt(process.env.QUEUE_WORKER_EVENT_WAKE_DEBOUNCE_MS || '25', 10) || 25);
const WORKER_HEARTBEAT_STALE_MS = Math.max(30 * 1000, parseInt(process.env.WORKER_HEARTBEAT_STALE_MS || String(2 * 60 * 1000), 10) || (2 * 60 * 1000));
const RUNNING_ENGINE_HEARTBEAT_STALE_MS = Math.max(1000, parseInt(process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS || '60000', 10) || 60000);
const RUNNING_NO_PROGRESS_STALE_MS = Math.max(0, parseInt(process.env.RUNNING_NO_PROGRESS_STALE_MS || String(8 * 60 * 1000), 10) || 0);
const PERSISTENT_QUEUE_AGENTS = new Set(String(process.env.PERSISTENT_QUEUE_AGENTS || 'repair-lead,repair')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean));
function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return !!defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw || ''));
}
const AUTO_OPTIMIZER_AGENT = 'ui_optimizer';
const FRONTEND_DESIGNER_AGENT = 'frontend_designer';
const AUTO_OPTIMIZER_ENABLED = envFlag('AUTO_OPTIMIZER_ENABLED', false);
const AUTO_OPTIMIZER_INTERVAL_MS = Math.max(60 * 1000, parseInt(process.env.AUTO_OPTIMIZER_INTERVAL_MS || String(60 * 60 * 1000), 10) || (60 * 60 * 1000));
const AUTO_OPTIMIZER_CHECK_MS = Math.max(1000, parseInt(process.env.AUTO_OPTIMIZER_CHECK_MS || '60000', 10) || 60000);
const AUTO_OPTIMIZER_STATE = path.join(ARTIFACTS_ROOT, 'ui-optimize', 'auto-state.json');
const SCHEDULED_PAGE_REVIEW_ENABLED = envFlag('SCHEDULED_PAGE_REVIEW_ENABLED', false);
const SCHEDULED_PAGE_REVIEW_INTERVAL_MS = Math.max(60 * 1000, parseInt(process.env.SCHEDULED_PAGE_REVIEW_INTERVAL_MS || String(4 * 60 * 60 * 1000), 10) || (4 * 60 * 60 * 1000));
const SCHEDULED_PAGE_REVIEW_CHECK_MS = Math.max(1000, parseInt(process.env.SCHEDULED_PAGE_REVIEW_CHECK_MS || '60000', 10) || 60000);
const SCHEDULED_PAGE_REVIEW_STATE = path.join(ARTIFACTS_ROOT, 'ui-review', 'scheduled-state.json');
const INSIGHT_SCOUT_REPOS_ENABLED = envFlag('INSIGHT_SCOUT_REPOS_ENABLED', false);
const INSIGHT_SCOUT_REPOS_INTERVAL_MS = Math.max(60 * 1000, parseInt(process.env.INSIGHT_SCOUT_REPOS_INTERVAL_MS || String(4 * 60 * 60 * 1000), 10) || (4 * 60 * 60 * 1000));
const INSIGHT_SCOUT_REPOS_CHECK_MS = Math.max(1000, parseInt(process.env.INSIGHT_SCOUT_REPOS_CHECK_MS || '60000', 10) || 60000);
const BACKGROUND_STARTUP_DELAY_MS = Math.max(0, parseInt(process.env.BACKGROUND_STARTUP_DELAY_MS || '3000', 10) || 3000);
const SCHEDULER_STARTUP_DELAY_MS = Math.max(10 * 1000, parseInt(process.env.SCHEDULER_STARTUP_DELAY_MS || String(60 * 1000), 10) || (60 * 1000));
const ENGINE_LOCK_STALE_MS = Math.max(60 * 1000, parseInt(process.env.ENGINE_LOCK_STALE_MS || String(2 * 60 * 60 * 1000), 10) || (2 * 60 * 60 * 1000));
const ARTIFACT_RETENTION_COUNT = Math.max(20, parseInt(process.env.ARTIFACT_RETENTION_COUNT || '200', 10) || 200);
const ARTIFACT_RETENTION_DAYS = Math.max(1, parseInt(process.env.ARTIFACT_RETENTION_DAYS || '14', 10) || 14);
const MAX_JSON_BODY_BYTES = Math.max(1024 * 1024, parseInt(process.env.MAX_JSON_BODY_BYTES || String(48 * 1024 * 1024), 10) || (48 * 1024 * 1024));
const MAX_IMAGE_ATTACHMENTS = Math.max(1, parseInt(process.env.MAX_IMAGE_ATTACHMENTS || '12', 10) || 12);
const MAX_IMAGE_BYTES = Math.max(1024 * 1024, parseInt(process.env.MAX_IMAGE_BYTES || String(10 * 1024 * 1024), 10) || (10 * 1024 * 1024));
const MAX_IMAGE_TOTAL_BYTES = Math.max(MAX_IMAGE_BYTES, parseInt(process.env.MAX_IMAGE_TOTAL_BYTES || String(30 * 1024 * 1024), 10) || (30 * 1024 * 1024));
const TASK_BOARD_HISTORY_LIMIT = 50;
const TASK_BOARD_EVENT_LIMIT = Math.max(300, parseInt(process.env.TASK_BOARD_EVENT_LIMIT || '1200', 10) || 1200);
const TASK_BOARD_CACHE_MS = Math.max(0, parseInt(process.env.TASK_BOARD_CACHE_MS || '1000', 10) || 1000);
const LLM_USAGE_CACHE_MS = Math.max(0, parseInt(process.env.LLM_USAGE_CACHE_MS || '60000', 10) || 60000);
// [B-1 去同步阻塞] /api/task-board 事件改 byte-offset 增量缓存;设 0 回退旧的每请求全量尾读
const TASK_BOARD_EVENTS_INCREMENTAL = process.env.TASK_BOARD_EVENTS_INCREMENTAL !== '0';
// [B-1 去同步阻塞] new-api sqlite 查询 TTL 缓存毫秒数(用量数据不需要每请求实时)。
// 默认 30s;设 0 关缓存(仍是异步 spawn,不阻塞事件循环)。
const NEW_API_SQLITE_CACHE_MS = (() => {
  const n = parseInt(process.env.NEW_API_SQLITE_CACHE_MS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 30000;
})();
// [B-1 去同步阻塞] 定时器路径先用 fs.promises 异步预计算 public/ 签名再消费缓存;
// 设 PAGE_REVIEW_ASYNC_SIGNATURE=0 回退旧的同步哈希(仅用于排障)。
const PAGE_REVIEW_ASYNC_SIGNATURE = process.env.PAGE_REVIEW_ASYNC_SIGNATURE !== '0';
// 签名缓存可信窗口:review 间隔按小时计,分钟级的签名陈旧无影响
const PAGE_SIGNATURE_CACHE_MS = Math.max(1000, parseInt(process.env.PAGE_SIGNATURE_CACHE_MS || '', 10) || 5 * 60 * 1000);
const IMAGE_EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
let workerSupervisorTimer = null;
let workerEventWatcher = null;
let workerEventWakeTimer = null;
let workerEventWakeSeq = 0;
let workerEventWakeOffset = 0;
let workerEventWakeRemainder = '';
let autoOptimizerTimer = null;
let scheduledPageReviewTimer = null;
let insightScoutReposTimer = null;
let taskBoardCache = null;
let llmUsageCache = null;
function appendHistory(entry) { try { fs.mkdirSync(path.dirname(HISTORY), { recursive: true }); fs.appendFileSync(HISTORY, JSON.stringify(entry) + '\n'); } catch (_) {} }
function readHistory(n) { try { return fs.readFileSync(HISTORY, 'utf8').trim().split('\n').filter(Boolean).slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
function readCurrentConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); }
  catch (_) { return cfg; }
}
function currentBoardReviewControl() {
  const current = readCurrentConfig();
  return current && current.boardReviewControl || cfg.boardReviewControl || {};
}
function engineLog() { return new EventLog(ENGINE_EVENTS); }
function readFileRangeUtf8(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, length));
    const read = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.slice(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function pickJsonScalar(line, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*("((?:\\\\.|[^"\\\\])*)"|-?\\d+(?:\\.\\d+)?|true|false|null)`).exec(line);
  if (!m) return undefined;
  if (m[1] && m[1][0] === '"') {
    try { return JSON.parse(m[1]); } catch (_) { return m[2] || ''; }
  }
  if (m[1] === 'true') return true;
  if (m[1] === 'false') return false;
  if (m[1] === 'null') return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : m[1];
}

function parseJsonlLine(line, opts = {}) {
  const maxOutputLineBytes = Math.max(2000, Number(opts.maxOutputLineBytes || 0) || 8000);
  if (opts.compactLargeOutput && line.length > maxOutputLineBytes && line.includes('"type":"node.output"')) {
    const ev = {
      seq: Number(pickJsonScalar(line, 'seq')) || 0,
      ts: pickJsonScalar(line, 'ts') || '',
      type: 'node.output',
      task: pickJsonScalar(line, 'task') || '',
      node: pickJsonScalar(line, 'node') || '',
      attempt: Number(pickJsonScalar(line, 'attempt')) || undefined,
      role: pickJsonScalar(line, 'role') || '',
      stream: pickJsonScalar(line, 'stream') || '',
      text: `[large node.output omitted: ${line.length} bytes]`,
      projectId: pickJsonScalar(line, 'projectId') || undefined,
      compacted: true,
      originalBytes: line.length,
    };
    return ev;
  }
  return JSON.parse(line);
}

function readJsonlTail(file, limit = 5000, tailBytes = 4 * 1024 * 1024, opts = {}) {
  try {
    const maxItems = Math.max(1, Number(limit || 5000) || 5000);
    const st = fs.statSync(file);
    if (!st.size) return [];
    const bytes = Math.min(st.size, Math.max(64 * 1024, Number(tailBytes || 0) || (4 * 1024 * 1024)));
    const start = st.size - bytes;
    const text = readFileRangeUtf8(file, start, bytes);
    const lines = text.split(/\r?\n/);
    if (start > 0) lines.shift();
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < maxItems; i--) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      let ev; try { ev = parseJsonlLine(line, opts); } catch (_) { continue; }
      out.push(ev);
    }
    return out.reverse();
  } catch (_) {
    return [];
  }
}

function readEvents(afterSeq, n) {
  try {
    const after = Number(afterSeq || 0);
    const limit = Math.max(1, Math.min(Number(n || 120), 500));
    const events = readJsonlTail(
      ENGINE_EVENTS,
      Math.max(limit * 4, 80),
      Math.min(768 * 1024, Math.max(128 * 1024, limit * 1600)),
      { compactLargeOutput: true, maxOutputLineBytes: 6000 }
    );
    return events.filter(ev => (ev.seq || 0) > after).slice(-limit);
  } catch (_) { return []; }
}

function readEngineEventsSince(afterSeq) {
  const baseSeq = Number(afterSeq || 0) || 0;
  let maxSeq = baseSeq;
  const out = [];
  try {
    const events = readJsonlTail(ENGINE_EVENTS, 2000, 2 * 1024 * 1024);
    for (const ev of events) {
      const seq = Number(ev && ev.seq) || 0;
      if (seq > maxSeq) maxSeq = seq;
      if (seq > baseSeq) out.push(ev);
    }
  } catch (_) {}
  return { events: out, maxSeq };
}

function latestEngineEventSeqFromTail(file = ENGINE_EVENTS, tailBytes = 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    if (!st.size) return 0;
    const start = Math.max(0, st.size - tailBytes);
    const text = readFileRangeUtf8(file, start, st.size - start);
    let maxSeq = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      const seq = Number(ev && ev.seq) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }
    return maxSeq;
  } catch (_) {
    return 0;
  }
}

function readEngineEventsFromWakeOffset() {
  const out = [];
  let maxSeq = workerEventWakeSeq;
  try {
    const st = fs.statSync(ENGINE_EVENTS);
    if (workerEventWakeOffset > st.size) {
      workerEventWakeOffset = 0;
      workerEventWakeRemainder = '';
    }
    if (workerEventWakeOffset === st.size) return { events: out, maxSeq, bytesRead: 0, skippedBytes: 0 };
    const maxReadBytes = Math.max(128 * 1024, parseInt(process.env.QUEUE_WORKER_EVENT_WAKE_MAX_READ_BYTES || String(512 * 1024), 10) || (512 * 1024));
    const available = st.size - workerEventWakeOffset;
    let start = workerEventWakeOffset;
    let skippedBytes = 0;
    if (available > maxReadBytes) {
      skippedBytes = available - maxReadBytes;
      start = st.size - maxReadBytes;
      workerEventWakeRemainder = '';
    }
    const text = workerEventWakeRemainder + readFileRangeUtf8(ENGINE_EVENTS, start, st.size - start);
    workerEventWakeOffset = st.size;
    const complete = /\r?\n$/.test(text);
    const lines = text.split(/\r?\n/);
    workerEventWakeRemainder = complete ? '' : (lines.pop() || '');
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.includes('queue.enqueued')) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      const seq = Number(ev && ev.seq) || 0;
      if (seq > maxSeq) maxSeq = seq;
      if (seq > workerEventWakeSeq) out.push(ev);
    }
    return { events: out, maxSeq, bytesRead: st.size - start, skippedBytes };
  } catch (_) {
    return { events: out, maxSeq, bytesRead: 0, skippedBytes: 0 };
  }
}

function handleVersion(res) {
  try {
    const state = VersionManager.readVersionState(WORKDIR);
    return json(res, 200, {
      ok: true,
      version: state.version || '0.0.0.0',
      updated_at: state.updated_at || null,
      owner_agent: state.owner_agent || 'it-engineer',
      last_change: state.last_change || null,
      remote: {
        name: state.remote && state.remote.name || VersionManager.DEFAULT_REMOTE_NAME,
        web_url: state.remote && state.remote.web_url || VersionManager.GITHUB_WEB_URL || null,
      },
      parts: state.parts || VersionManager.PART_LABELS,
    });
  } catch (e) {
    return json(res, 200, {
      ok: false,
      version: '0.0.0.0',
      updated_at: null,
      owner_agent: 'it-engineer',
      error: String(e && e.message || e).slice(0, 300),
    });
  }
}

let _versionHistoryCache = null;
function handleVersionHistory(res, u) {
  try {
    const limit = Math.min(Math.max(parseInt(u && u.searchParams.get('limit'), 10) || 80, 1), 300);
    const now = Date.now();
    if (_versionHistoryCache && _versionHistoryCache.limit === limit && (now - _versionHistoryCache.at) < 15000) {
      return json(res, 200, _versionHistoryCache.body);
    }
    const history = VersionManager.versionHistory(WORKDIR, { limit });
    const current = VersionManager.readVersionState(WORKDIR).version || null;
    const body = { ok: true, current, history, web_url: VersionManager.GITEE_WEB_URL };
    _versionHistoryCache = { limit, at: now, body };
    return json(res, 200, body);
  } catch (e) {
    return json(res, 200, { ok: false, current: null, history: [], error: String(e && e.message || e).slice(0, 300) });
  }
}

// 办公室"服务器即员工"探活:对 config.servers 逐个 net.connect 端口探测(避开自签 TLS),返回在线/离线。
let _serverStatusCache = null;
function serverMetaOf(s) {
  return { id: s.id, label: s.label, ip: s.ip, port: Number(s.port) || 443, accent: s.accent || '#5ed6c4', note: s.note || '' };
}
function handleServersStatus(res) {
  const list = Array.isArray(cfg.servers) ? cfg.servers : [];
  const now = Date.now();
  if (_serverStatusCache && (now - _serverStatusCache.at) < 8000) {
    return json(res, 200, _serverStatusCache.body);
  }
  if (!list.length) return json(res, 200, { ok: true, servers: [], checkedAt: new Date(now).toISOString() });
  const net = require('net');
  const probe = (s) => new Promise((resolve) => {
    const meta = serverMetaOf(s);
    const host = String(s.ip || '').trim();
    if (!host) return resolve(Object.assign(meta, { online: false }));
    let done = false;
    const sock = net.connect({ host, port: meta.port });
    const finish = (online) => { if (done) return; done = true; try { sock.destroy(); } catch (_) {} resolve(Object.assign(meta, { online })); };
    sock.setTimeout(2500);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
  Promise.all(list.map(probe)).then((servers) => {
    const body = { ok: true, servers, checkedAt: new Date(now).toISOString() };
    _serverStatusCache = { at: now, body };
    json(res, 200, body);
  }).catch((e) => json(res, 200, { ok: false, servers: [], error: String(e && e.message || e).slice(0, 200) }));
}

function serveStatic(res, rel) {
  const fp = path.join(ROOT, 'public', rel);
  if (!fp.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function setupOptions() {
  return { workspaceRoot: WORKDIR, configDir: process.env.YUTU6_CONFIG_DIR };
}
function setupReady() {
  return SetupService.status(setupOptions()).completed;
}
function handleSetupProvider(req, res, providerId) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method_not_allowed' });
  readJson(req, res, (body) => {
    SetupService.configureProvider(providerId, body || {}, setupOptions())
      .then((result) => json(res, result.ok ? 200 : 400, result))
      .catch(() => json(res, 500, { ok: false, provider: providerId, code: 'probe_failed' }));
  });
}
function handleProjects(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      system: ProjectDepartments.readSystemDepartments({ workspaceRoot: WORKDIR }),
      projects: ProjectDepartments.listProjectDepartments({ workspaceRoot: WORKDIR }),
    });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method_not_allowed' });
  readJson(req, res, (body) => {
    try {
      const result = ProjectDepartments.createProjectDepartment(body || {}, { workspaceRoot: WORKDIR });
      if (result.created) {
        try {
          new EventLog(ENGINE_EVENTS).emit('project.department.created', {
            projectId: result.project.projectId,
            queueAgent: result.project.supervisor.queueAgent,
            source: 'setup-api',
          });
        } catch (_) {}
      }
      return json(res, result.created ? 201 : 200, {
        ok: true, created: result.created, idempotent: result.idempotent, project: result.project,
      });
    } catch (err) {
      return json(res, 400, { ok: false, code: String(err && err.message || 'project_create_failed').slice(0, 120) });
    }
  });
}
function serveFile(res, fp) {
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(buf);
  });
}
function readJson(req, res, cb) {
  let data = '';
  let tooLarge = false;
  req.on('data', c => {
    data += c;
    if (data.length > MAX_JSON_BODY_BYTES) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on('error', () => {
    if (tooLarge) return json(res, 413, { error: '请求体过大' });
  });
  req.on('end', () => { let b; try { b = JSON.parse(data || '{}'); } catch { return json(res,400,{error:'坏 JSON'}); } cb(b); });
}

function safeAgent(s) {
  const agent = decodeURIComponent(String(s || ''));
  return /^[\p{L}\p{N}_-]+$/u.test(agent) ? agent : null;
}
function isQueueAgentDirName(s) {
  const agent = safeAgent(s);
  if (!agent) return false;
  // artifacts/queues may contain internal state folders. They are not agents and
  // must not appear in worker scans, UI queue lists, or queue-agent discovery.
  return !agent.startsWith('_') && !new Set(['queues', 'bulletin']).has(agent);
}
function safeQueueId(s) {
  const id = decodeURIComponent(String(s || ''));
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
function safeBulletinId(s) {
  const id = decodeURIComponent(String(s || ''));
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
function safeRepairTicketId(s) {
  const id = decodeURIComponent(String(s || ''));
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : null;
}
function safePriority(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  return n;
}

function relToWorkdir(file) {
  return path.relative(WORKDIR, file).split(path.sep).join('/');
}

function normalizeAttachmentArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).slice(0, MAX_IMAGE_ATTACHMENTS);
}

function decodeImageAttachment(att) {
  const rawData = String(att && (att.dataUrl || att.data || att.base64) || '').trim();
  let mime = String(att && (att.mime || att.type) || '').toLowerCase().trim();
  let base64 = rawData;
  const dataUrl = rawData.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (dataUrl) {
    mime = dataUrl[1].toLowerCase();
    base64 = dataUrl[2];
  }
  const ext = IMAGE_EXT_BY_MIME[mime];
  if (!ext) throw new Error(`不支持的图片类型:${mime || 'unknown'}`);
  const clean = String(base64 || '').replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('图片数据不是合法 base64');
  const buffer = Buffer.from(clean, 'base64');
  if (!buffer.length) throw new Error('图片为空');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`单张图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
  return { buffer, mime, ext };
}

function saveImageAttachments(rawAttachments) {
  const raw = normalizeAttachmentArray(rawAttachments);
  if (!raw.length) return [];
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dir = path.join(TASK_ATTACHMENT_DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  return raw.map((att, idx) => {
    const img = decodeImageAttachment(att);
    total += img.buffer.length;
    if (total > MAX_IMAGE_TOTAL_BYTES) throw new Error(`图片总大小超过 ${Math.round(MAX_IMAGE_TOTAL_BYTES / 1024 / 1024)}MB`);
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}-${idx + 1}`;
    const file = path.join(dir, `${id}.${img.ext}`);
    fs.writeFileSync(file, img.buffer, { mode: 0o600 });
    return {
      id,
      kind: 'image',
      mime: img.mime,
      size: img.buffer.length,
      path: relToWorkdir(file),
      created_at: nowIso(),
    };
  });
}

function attachmentInputPaths(attachments) {
  return (attachments || []).map(a => a && a.path).filter(Boolean);
}

function taskWithSavedAttachments(task, rawAttachments) {
  const saved = saveImageAttachments(rawAttachments);
  if (!saved.length) return { task, attachments: [] };
  const payload = task && typeof task === 'object' && !Array.isArray(task)
    ? Object.assign({}, task)
    : { goal: String(task || '') };
  delete payload.image;
  delete payload.images;
  const inputs = Array.isArray(payload.inputs) ? payload.inputs.slice() : [];
  for (const p of attachmentInputPaths(saved)) if (!inputs.includes(p)) inputs.push(p);
  payload.inputs = inputs;
  payload.attachments = saved;
  return { task: payload, attachments: saved };
}

function prepareTaskForEnqueue(task, body) {
  const objectAttachments = task && typeof task === 'object' && !Array.isArray(task) ? task.attachments : null;
  const rawAttachments = normalizeAttachmentArray(objectAttachments && objectAttachments.some(a => a && (a.dataUrl || a.data || a.base64))
    ? objectAttachments
    : (body && (body.attachments || body.images)));
  return taskWithSavedAttachments(task, rawAttachments);
}

function pidAlive(pid) {
  return Runtime.pidAlive(pid);
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function recordAgeMs(record) {
  const raw = record && (record.heartbeat_at || record.updated_at || record.ts || record.started_at);
  const t = raw ? Date.parse(raw) : 0;
  return t ? Date.now() - t : Infinity;
}

function recordStale(record) {
  return recordAgeMs(record) > ENGINE_LOCK_STALE_MS;
}

function processCmdSync(pid) {
  return Runtime.processCmd(pid);
}

function pidLooksLike(pid, marker) {
  return Runtime.pidLooksLike(pid, marker);
}

function removeFile(file) {
  try { fs.unlinkSync(file); return true; } catch (_) { return false; }
}

function killProcessGroup(pid, signal) {
  Runtime.killProcessGroup(pid, signal);
}

function terminateOrphanEngine(pid, meta) {
  Runtime.terminateEngine(Number(pid), {
    eventlog: engineLog(),
    termGraceMs: 5000,
    meta: meta || {},
  }).catch(() => {});
  return Runtime.pidLooksLike(pid, 'engine-runner.js');
}

function lockOwnerAlive(record) {
  return Runtime.lockOwnerAlive(record);
}

function lockEngineAlive(record) {
  return Runtime.engineAliveForRecord(record);
}

function lockValid(record) {
  return Runtime.lockValid(record, { staleMs: ENGINE_LOCK_STALE_MS });
}

function lockSweepReason(record, opts = {}) {
  return Runtime.lockSweepReason(record, {
    queueRoot: QUEUE_ROOT,
    staleMs: ENGINE_LOCK_STALE_MS,
    runningStaleMs: Math.max(RUNNING_ENGINE_HEARTBEAT_STALE_MS, RUNNING_NO_PROGRESS_STALE_MS || 0),
    startupKill: !!opts.startupKill,
  });
}

async function cleanJsonLock(file, kind, opts = {}) {
  const rec = readJsonFile(file);
  const reason = lockSweepReason(rec, opts);
  if (!reason) return false;
  const result = await Runtime.releaseLockFile(file, {
    record: rec,
    kind,
    reason,
    queueRoot: QUEUE_ROOT,
    staleMs: ENGINE_LOCK_STALE_MS,
    runningStaleMs: Math.max(RUNNING_ENGINE_HEARTBEAT_STALE_MS, RUNNING_NO_PROGRESS_STALE_MS || 0),
    eventlog: engineLog(),
    termGraceMs: 5000,
    meta: {
      queueAgent: rec && rec.agent || null,
      queueId: rec && rec.queueId || null,
      runnerType: rec && rec.runnerType || null,
      source: opts.startupKill ? 'server-startup' : 'server-cleanup',
    },
  });
  if (result.released) {
    engineLog().emit('runtime.lock.swept', { file: path.basename(file), kind, queueAgent: rec && rec.agent || null, queueId: rec && rec.queueId || null, reason });
    return true;
  }
  return false;
}

function cleanPidFile(file, marker) {
  const rec = readJsonFile(file);
  const raw = rec ? rec.pid : (() => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } })();
  const pid = parseInt(String(raw || '').trim(), 10);
  if (pid && pidLooksLike(pid, marker)) return false;
  if (removeFile(file)) {
    engineLog().emit('runtime.pid.swept', { file: path.basename(file), pid: pid || null, reason: pid ? 'dead-or-stale' : 'invalid' });
    return true;
  }
  return false;
}

function rotateGeneratedArtifacts() {
  // 2026-07-03 架构审视:loop-engineering(实测 593MB)与 ui-optimize/shots(实测 424MB)
  // 此前不在轮转名单=永不清理,是 artifacts 前两大磁盘户。
  const dirs = ['engine-runs', 'engine-jobs', 'engine-tasks', 'loop-engineering', 'ui-optimize/shots'].map(d => path.join(ARTIFACTS_ROOT, d));
  const olderThan = Date.now() - ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir).map(name => {
        const file = path.join(dir, name);
        const st = fs.statSync(file);
        return { file, name, mtime: st.mtimeMs };
      }).sort((a, b) => b.mtime - a.mtime);
    } catch (_) {
      continue;
    }
    let removed = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (i < ARTIFACT_RETENTION_COUNT && e.mtime >= olderThan) continue;
      try { fs.rmSync(e.file, { recursive: true, force: true }); removed++; } catch (_) {}
    }
    if (removed) engineLog().emit('artifacts.rotated', { dir: path.basename(dir), removed, keepCount: ARTIFACT_RETENTION_COUNT, keepDays: ARTIFACT_RETENTION_DAYS });
  }
}

async function selfCleanRuntimeArtifacts() {
  const legacy = path.join(ARTIFACTS_ROOT, 'engine-runner.lock.json');
  if (fs.existsSync(legacy)) await cleanJsonLock(legacy, 'legacy-engine-lock', { startupKill: true });
  for (const sub of ['engine-slots', 'engine-runner-types']) {
    const dir = path.join(ARTIFACTS_ROOT, sub);
    try {
      for (const f of fs.readdirSync(dir).filter(x => /\.json$/.test(x))) {
        await cleanJsonLock(path.join(dir, f), sub, { startupKill: true });
      }
    } catch (_) {}
  }
  try {
    const qroot = path.join(QUEUE_ROOT, 'queues');
    for (const agent of fs.readdirSync(qroot)) {
      if (isQueueAgentDirName(agent)) cleanPidFile(path.join(qroot, agent, '.worker.pid'), 'ceo-worker.js');
    }
  } catch (_) {}
  try {
    for (const f of fs.readdirSync(QUEUE_ROOT).filter(x => /\.pid$/.test(x))) {
      if (f === 'nohup-test.pid') removeFile(path.join(QUEUE_ROOT, f));
      else cleanPidFile(path.join(QUEUE_ROOT, f), '');
    }
  } catch (_) {}
  rotateGeneratedArtifacts();
}

function listProjects() {
  try {
    const managed = ProjectDepartments.listProjectDepartments({ workspaceRoot: WORKDIR })
      .map(project => project.projectId);
    return [...new Set(['控制台', ...managed])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return ['控制台'];
  }
}

function disabledQueueAgentIds() {
  const disabled = new Set();
  const agentsDir = path.join(WORKDIR, 'shared', 'agents');
  try {
    for (const id of fs.readdirSync(agentsDir)) {
      const file = path.join(agentsDir, id, 'agent.json');
      if (!fs.existsSync(file)) continue;
      const agent = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!/^(disabled|archived|retired)/i.test(String(agent.status || ''))) continue;
      if (agent.id) disabled.add(String(agent.id));
      if (agent.role) disabled.add(String(agent.role));
    }
  } catch (_) {}
  return disabled;
}

function configuredQueueAgents() {
  const disabled = disabledQueueAgentIds();
  const roleIds = Object.keys(cfg.roleRouting || {}).filter(safeAgent);
  const ids = ['ceo', ...roleIds.filter(id => id !== 'orchestrator' && !disabled.has(id))];
  for (const projectId of listProjects()) ids.push(`supervisor-${projectId}`);
  try {
    const dir = path.join(QUEUE_ROOT, 'queues');
    for (const agent of fs.readdirSync(dir)) if (isQueueAgentDirName(agent) && !disabled.has(agent) && !ids.includes(agent)) ids.push(agent);
  } catch (_) {}
  return [...new Set(ids)].map(id => {
    const projectMatch = String(id).match(/^supervisor-(.+)$/);
    const projectId = projectMatch ? projectMatch[1] : null;
    const roleKey = id === 'memory-officer' ? 'memory_officer' : id;
    return ({
    id,
    role: projectId ? 'supervisor' : (id === 'ceo' ? 'orchestrator' : roleKey),
    projectId,
    label: projectId ? `项目主管 · ${projectId}` : (id === 'ceo'
      ? (((cfg.roleRouting || {}).orchestrator || {}).label || 'CEO')
      : (((cfg.roleRouting || {})[roleKey] || {}).label || id)),
  });
  });
}

function workerPidFileState(pidFile, agent) {
  const cur = readJsonFile(pidFile);
  const pid = Number(cur && cur.pid || 0);
  const alive = !!pid && pidLooksLike(pid, 'ceo-worker.js');
  const heartbeatRaw = cur && (cur.heartbeat_at || cur.updated_at || cur.started_at);
  const heartbeatTs = heartbeatRaw ? Date.parse(heartbeatRaw) : 0;
  const heartbeatAgeMs = heartbeatTs ? Date.now() - heartbeatTs : Infinity;
  return {
    record: cur,
    agent,
    pid,
    alive,
    heartbeatAt: heartbeatRaw || null,
    heartbeatAgeMs,
    stale: !alive || !heartbeatTs || heartbeatAgeMs > WORKER_HEARTBEAT_STALE_MS,
  };
}

function terminateStaleWorker(state, pidFile, reason) {
  if (!state || !state.pid || !state.alive) {
    try { fs.unlinkSync(pidFile); } catch (_) {}
    return;
  }
  engineLog().emit('queue.worker.stale', {
    queueAgent: state.agent,
    pid: state.pid,
    reason,
    heartbeatAt: state.heartbeatAt,
    heartbeatAgeMs: Number.isFinite(state.heartbeatAgeMs) ? state.heartbeatAgeMs : null,
  });
  Runtime.killProcessGroup(state.pid, 'SIGTERM', { excludePids: [process.pid] });
  try { fs.unlinkSync(pidFile); } catch (_) {}
  const timer = setTimeout(() => {
    if (pidLooksLike(state.pid, 'ceo-worker.js')) {
      Runtime.killProcessGroup(state.pid, 'SIGKILL', { excludePids: [process.pid] });
      engineLog().emit('queue.worker.stale_killed', { queueAgent: state.agent, pid: state.pid, signal: 'SIGKILL' });
    }
  }, 5000);
  if (timer.unref) timer.unref();
}

function ensureQueueWorker(agent, opts = {}) {
  if (process.env.QUEUE_WORKER_DISABLED === '1') return;
  const safe = safeAgent(agent);
  if (!safe) return;
  const d = Q.qdir(QUEUE_ROOT, safe);
  const pidFile = path.join(d, '.worker.pid');
  const state = workerPidFileState(pidFile, safe);
  if (state.record && state.alive && !state.stale) {
    return { ok: true, action: 'already-running', pid: state.pid };
  }
  if (state.record && state.alive && state.stale) {
    if (opts.dryRun) return { ok: true, action: 'stale-worker', pid: state.pid, heartbeatAgeMs: state.heartbeatAgeMs };
    terminateStaleWorker(state, pidFile, 'worker heartbeat stale');
  } else {
    try { fs.unlinkSync(pidFile); } catch (_) {}
  }
  if (opts.spawn === false || opts.dryRun) {
    return { ok: true, action: 'spawn-needed' };
  }

  // 防并发重复 spawn 同 agent(根治 worker 成对 spawn / 孤儿堆积):spawn 前抢原子 spawn-lock,
  // TTL 8s 覆盖"spawn → worker 写 .worker.pid"窗口;窗口内第二次 ensure 命中锁即跳过,不再重复 spawn。
  const spawnLock = path.join(d, '.worker.spawn.lock');
  try {
    fs.mkdirSync(spawnLock);
  } catch (e) {
    let ageMs = Infinity;
    try { ageMs = Date.now() - fs.statSync(spawnLock).mtimeMs; } catch (_) {}
    if (ageMs < 8000) return { ok: true, action: 'spawn-in-progress' };
    try { fs.rmdirSync(spawnLock); fs.mkdirSync(spawnLock); } catch (_) { return { ok: true, action: 'spawn-in-progress' }; }
  }

  fs.mkdirSync(QUEUE_WORKER_LOG_DIR, { recursive: true });
  const fd = fs.openSync(path.join(QUEUE_WORKER_LOG_DIR, `${safe}.log`), 'a');
  let child;
  try {
    child = spawn(RuntimePaths.nodeBin(), [path.join(ROOT, 'ceo-worker.js'), '--agent', safe], {
      cwd: ROOT,
      env: RuntimePaths.applyRuntimeEnv(Object.assign({}, process.env, {
        QUEUE_AGENT: safe,
        // P0-A:生产 worker 默认开启 done gate 真执行/真比对(可用环境变量显式置 0 关闭)
        YUTU6_DONE_GATE_EXECUTE: process.env.YUTU6_DONE_GATE_EXECUTE || '1',
      })),
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    engineLog().emit('queue.worker.spawned', { queueAgent: safe, pid: child.pid });
    return { ok: true, action: 'spawned', pid: child.pid };
  } catch (e) {
    engineLog().emit('queue.worker.spawn_failed', { queueAgent: safe, reason: e.message });
    return { ok: false, action: 'spawn-failed', reason: e.message };
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

function ensureWorkersForBacklog() {
  const seen = new Set(['ceo', ...PERSISTENT_QUEUE_AGENTS]);
  try {
    const dir = path.join(QUEUE_ROOT, 'queues');
    for (const agent of fs.readdirSync(dir)) {
      if (isQueueAgentDirName(agent)) seen.add(agent);
    }
  } catch (_) {}
  for (const agent of seen) {
    try {
      const s = Q.list(QUEUE_ROOT, agent);
      if (PERSISTENT_QUEUE_AGENTS.has(agent) || s.queued.length || s.running.length) ensureQueueWorker(agent);
    } catch (_) {}
  }
}

function startWorkerSupervisor() {
  if (workerSupervisorTimer || process.env.QUEUE_WORKER_DISABLED === '1') return;
  workerSupervisorTimer = setInterval(ensureWorkersForBacklog, WORKER_SUPERVISE_MS);
  if (workerSupervisorTimer.unref) workerSupervisorTimer.unref();
  engineLog().emit('queue.supervisor.start', { intervalMs: WORKER_SUPERVISE_MS });
}

function processQueueWorkerWakeEvents(reason, opts = {}) {
  if (!QUEUE_WORKER_EVENT_WAKE_ENABLED || process.env.QUEUE_WORKER_DISABLED === '1') return { processed: 0, agents: [] };
  const scan = readEngineEventsFromWakeOffset();
  workerEventWakeSeq = Math.max(workerEventWakeSeq, scan.maxSeq);
  const agents = new Set();
  let processed = 0;
  for (const ev of scan.events) {
    if (!ev || ev.type !== 'queue.enqueued') continue;
    const agent = safeAgent(ev.queueAgent);
    if (!agent || !ev.queueId) continue;
    agents.add(agent);
    processed += 1;
  }
  for (const agent of agents) {
    try { ensureQueueWorker(agent, opts.ensureOpts || {}); } catch (_) {}
  }
  if (processed) {
    engineLog().emit('queue.worker.event_wake', {
      reason: reason || null,
      processed,
      agents: Array.from(agents).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      cursorSeq: workerEventWakeSeq,
      bytesRead: scan.bytesRead || 0,
      skippedBytes: scan.skippedBytes || 0,
    });
  }
  return { processed, agents: Array.from(agents) };
}

function scheduleQueueWorkerEventWake(reason) {
  if (!QUEUE_WORKER_EVENT_WAKE_ENABLED || process.env.QUEUE_WORKER_DISABLED === '1') return;
  if (workerEventWakeTimer) return;
  workerEventWakeTimer = setTimeout(() => {
    workerEventWakeTimer = null;
    processQueueWorkerWakeEvents(reason || 'fs-watch');
  }, QUEUE_WORKER_EVENT_WAKE_DEBOUNCE_MS);
  if (workerEventWakeTimer.unref) workerEventWakeTimer.unref();
}

function startQueueWorkerEventWake() {
  if (!QUEUE_WORKER_EVENT_WAKE_ENABLED || process.env.QUEUE_WORKER_DISABLED === '1' || workerEventWatcher) return;
  fs.mkdirSync(path.dirname(ENGINE_EVENTS), { recursive: true });
  if (!fs.existsSync(ENGINE_EVENTS)) fs.writeFileSync(ENGINE_EVENTS, '');
  try {
    const st = fs.statSync(ENGINE_EVENTS);
    workerEventWakeOffset = st.size;
    workerEventWakeRemainder = '';
  } catch (_) {
    workerEventWakeOffset = 0;
    workerEventWakeRemainder = '';
  }
  workerEventWakeSeq = latestEngineEventSeqFromTail(ENGINE_EVENTS);
  try {
    workerEventWatcher = fs.watch(ENGINE_EVENTS, { persistent: false }, () => scheduleQueueWorkerEventWake('fs-watch'));
    workerEventWatcher.on('error', err => {
      engineLog().emit('queue.worker.event_wake.error', { reason: err && err.message || String(err || 'unknown') });
      try { workerEventWatcher.close(); } catch (_) {}
      workerEventWatcher = null;
    });
    engineLog().emit('queue.worker.event_wake.start', {
      enabled: true,
      cursorSeq: workerEventWakeSeq,
      fallbackIntervalMs: WORKER_SUPERVISE_MS,
      debounceMs: QUEUE_WORKER_EVENT_WAKE_DEBOUNCE_MS,
    });
  } catch (err) {
    workerEventWatcher = null;
    engineLog().emit('queue.worker.event_wake.disabled', { reason: err && err.message || String(err || 'fs.watch unavailable') });
  }
  // 启动补偿:watcher 建立后立即扫一次队列,覆盖服务冷启动到监听建立之间的入队竞态。
  ensureWorkersForBacklog();
}

function queueAgentsFromDisk() {
  const dir = path.join(QUEUE_ROOT, 'queues');
  try {
    return fs.readdirSync(dir).filter(isQueueAgentDirName).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return [];
  }
}

function queueActiveItems(opts = {}) {
  const ignoreAgents = new Set(Array.isArray(opts.ignoreAgents) ? opts.ignoreAgents : []);
  const includePaused = !!opts.includePaused;
  const out = [];
  for (const agent of queueAgentsFromDisk()) {
    if (ignoreAgents.has(agent)) continue;
    let listed;
    try { listed = Q.list(QUEUE_ROOT, agent); } catch (_) { continue; }
    for (const entry of listed.queued || []) {
      out.push({ agent, queueId: entry.id, status: 'queued', priority: entry.priority, goal: queueTaskText(entry.task) });
    }
    for (const entry of listed.running || []) {
      out.push({ agent, queueId: entry.id, status: entry.cancel_requested ? 'canceling' : 'running', priority: entry.priority, goal: queueTaskText(entry.task) });
    }
    if (includePaused) {
      for (const entry of listed.paused || []) {
        out.push({ agent, queueId: entry.id, status: 'paused', priority: entry.priority, goal: queueTaskText(entry.task) });
      }
    }
  }
  return out;
}

function autoOptimizerState() {
  return readJsonFile(AUTO_OPTIMIZER_STATE) || {};
}

function writeAutoOptimizerState(patch) {
  const state = Object.assign({}, autoOptimizerState(), patch || {}, { updatedAt: nowIso() });
  writeJsonFileAtomic(AUTO_OPTIMIZER_STATE, state);
  return state;
}

function autoOptimizerExistingItems() {
  try {
    const listed = Q.list(QUEUE_ROOT, AUTO_OPTIMIZER_AGENT);
    return []
      .concat((listed.queued || []).map(entry => ({ agent: AUTO_OPTIMIZER_AGENT, queueId: entry.id, status: 'queued' })))
      .concat((listed.running || []).map(entry => ({ agent: AUTO_OPTIMIZER_AGENT, queueId: entry.id, status: entry.cancel_requested ? 'canceling' : 'running' })));
  } catch (_) {
    return [];
  }
}

function autoOptimizerDue(state, nowMs, force) {
  if (force) return { due: true, reason: 'forced-check' };
  const lastMs = Date.parse(state.lastEnqueuedAt || state.lastCompletedAt || '') || 0;
  if (!lastMs) return { due: true, reason: 'first-run' };
  const nextMs = lastMs + AUTO_OPTIMIZER_INTERVAL_MS;
  return {
    due: nowMs >= nextMs,
    reason: nowMs >= nextMs ? 'hourly-interval' : 'not-due',
    nextAt: new Date(nextMs).toISOString(),
  };
}

function autoOptimizerTask(stamp, reason) {
  const before = `projects/控制台/artifacts/ui-optimize/shots/auto-${stamp}-workspace-before.png`;
  const after = `projects/控制台/artifacts/ui-optimize/shots/auto-${stamp}-workspace-after.png`;
  const report = `projects/控制台/artifacts/ui-optimize/reports/auto-${stamp}.md`;
  return {
    role: AUTO_OPTIMIZER_AGENT,
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    title: '空闲自动优化',
    idem: `auto-ui-optimize:${stamp}`,
    goal: [
      '空闲自动优化师本轮任务。',
      `触发原因:${reason}`,
      '',
      '硬门禁(只此一项可中止本轮):',
      '- 先运行 `node projects/控制台/tools/auto-optimizer-preflight.js --json`; 如果返回 idle=false,立即停止:只写跳过报告,不要截图、不要改文件、不要发飞书。',
      '- 只处理 `projects/控制台/` 与控制台工作区页面; 未注册项目排除; 密钥不回显; 登录/授权交主人手动。',
      '',
      '⚠️ 铁律(老板 2026-06-25 明确):',
      '- **绝不允许"本轮无需改动/没什么问题/一切正常"这类结论。** 任何真实 UI 永远有可改进处。说"没问题"= 没认真挑 = 失职。preflight 通过(idle=true)的本轮,必须真挑出问题并落地至少 1 处小改。',
      '- **挑错不依赖截图。** 锁屏时 Peekaboo 截图会空白/失败——这种情况以源码审查为准,绝不因截图拿不到就说没问题。',
      '',
      '执行步骤:',
      '1. **读源码挑错(权威,锁屏也能做)**:用 Read 读 `projects/控制台/public/workspace.html`(必要时含 control-room.html),从 HTML/CSS/JS 直接找问题——对比度色值、字号过小、硬编码/不齐的间距、缺失的 hover/focus/空状态/加载态、长文本溢出、重复样式、点击无反馈。',
      `2. **截图辅助(可选)**:复用验证标签打开 \`http://127.0.0.1:41218/workspace\` 截图到 \`${before}\`(\`bash shared/agents/ui-optimizer/open-validation-tab.sh ... --wait 1\` + \`peekaboo image --mode frontmost --path ${before}\`)。截图失败/空白(锁屏)不影响本轮——继续用源码挑错。`,
      '3. **挑错**:从交互流畅性/易读性/一致性/可发现性四维度,挑出至少 3 条具体问题(到元素/CSS,带 文件:行 证据)。',
      '4. **评估洞察员**:用 Read 读 `board/insights/insights.md`,评估其中是否有对 WebUI 有益、属 UI 层、低风险可落地的洞察;有则一并纳入本轮改法(标注来源=洞察员),需人定方向的记录不擅自做。',
      '5. **落地**:用 Codex/本机最小改动修最值得改的 1-2 条(含洞察采纳项);不重写整页、不动业务逻辑。',
      `6. 改后(如能截图)重新截图到 \`${after}\`,写本轮报告 \`${report}\`(列出挑出的全部问题 + 本轮改了哪几条 + 洞察评估结论)。`,
      `7. 飞书: \`node projects/控制台/secretary-tools.js notify --type progress --title "自动优化师 · 本轮优化" --body "本轮挑出N条、改了:<具体>;洞察评估:<采纳/无>" --image ${after}\`。`,
      '',
      '最后输出 JSON(summary 必须写挑出的问题与本轮改动,不允许"无需改动";唯一例外是 preflight idle=false 跳过):',
      '```json',
      '{"implementation":{"done":true,"summary":"挑出哪些问题 + 本轮改了什么 + 洞察评估","changed_files":[]}}',
      '```',
    ].join('\n'),
    bounds: '空闲自动优化; 有其他 queued/running 任务时停止不抢占(preflight); 只处理 projects/控制台/; 锁屏时以源码审查为准不停摆; 未注册项目排除; 密钥不回显; 登录/授权交主人手动。',
    acceptance: 'preflight idle=true 时必须真挑错(≥3条,源码证据)并落地≥1处小改,严禁"无需改动"结论; 评估洞察员洞察并采纳有益UI项; 报告列全部问题+改动+洞察结论; 飞书progress卡附截图(锁屏无图可省图但仍要报告); 事件日志可追踪。',
    useOrchestrator: false,
    autoApproveHuman: true,
    nodeTimeoutSec: 900,
  };
}

function checkAutoOptimizer(opts = {}) {
  if (!AUTO_OPTIMIZER_ENABLED && !opts.force) {
    return { ok: true, action: 'disabled' };
  }
  const state = autoOptimizerState();
  const nowMs = Date.now();
  const due = autoOptimizerDue(state, nowMs, !!opts.force);
  if (!due.due) return { ok: true, action: 'skip', reason: due.reason, nextAt: due.nextAt };

  const active = queueActiveItems({ ignoreAgents: [AUTO_OPTIMIZER_AGENT] });
  if (active.length) {
    const lastRunMs = Date.parse(state.lastEnqueuedAt || state.lastCompletedAt || '') || 0;
    writeAutoOptimizerState({
      lastSkippedAt: nowIso(),
      lastSkipReason: 'queues-active',
      activeCount: active.length,
      sampleActive: active.slice(0, 8),
      nextAt: lastRunMs ? new Date(lastRunMs + AUTO_OPTIMIZER_INTERVAL_MS).toISOString() : null,
    });
    engineLog().emit('auto_optimizer.skipped', { reason: 'queues-active', activeCount: active.length, sampleActive: active.slice(0, 5) });
    return { ok: true, action: 'skip', reason: 'queues-active', activeCount: active.length, sampleActive: active.slice(0, 8) };
  }

  const existing = autoOptimizerExistingItems();
  if (existing.length) {
    engineLog().emit('auto_optimizer.skipped', { reason: 'already-active', existing });
    return { ok: true, action: 'skip', reason: 'already-active', existing };
  }

  const stamp = new Date(nowMs).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const task = autoOptimizerTask(stamp, due.reason);
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, AUTO_OPTIMIZER_AGENT, task, { priority: 99, idem: task.idem, eventlog: engineLog(), source: 'auto-optimizer' });
  writeAutoOptimizerState({
    lastEnqueuedAt: nowIso(),
    lastQueueId: entry.id,
    lastReason: due.reason,
    nextAt: new Date(nowMs + AUTO_OPTIMIZER_INTERVAL_MS).toISOString(),
  });
  engineLog().emit('auto_optimizer.enqueued', { queueAgent: AUTO_OPTIMIZER_AGENT, queueId: entry.id, priority: entry.priority, reason: due.reason, intervalMs: AUTO_OPTIMIZER_INTERVAL_MS });
  ensureQueueWorker(AUTO_OPTIMIZER_AGENT);
  return { ok: true, action: 'enqueued', entry: { id: entry.id, agent: AUTO_OPTIMIZER_AGENT, priority: entry.priority }, reason: due.reason };
}

function startAutoOptimizerScheduler() {
  if (autoOptimizerTimer || process.env.QUEUE_WORKER_DISABLED === '1') return;
  if (!AUTO_OPTIMIZER_ENABLED) {
    engineLog().emit('auto_optimizer.scheduler.start', { enabled: false, intervalMs: AUTO_OPTIMIZER_INTERVAL_MS, checkMs: AUTO_OPTIMIZER_CHECK_MS, agent: AUTO_OPTIMIZER_AGENT });
    return;
  }
  autoOptimizerTimer = setInterval(() => {
    try { checkAutoOptimizer(); }
    catch (e) { engineLog().emit('auto_optimizer.error', { reason: String(e && e.message || e).slice(0, 300) }); }
  }, AUTO_OPTIMIZER_CHECK_MS);
  if (autoOptimizerTimer.unref) autoOptimizerTimer.unref();
  setTimeout(() => {
    try { checkAutoOptimizer(); }
    catch (e) { engineLog().emit('auto_optimizer.error', { reason: String(e && e.message || e).slice(0, 300) }); }
  }, SCHEDULER_STARTUP_DELAY_MS).unref?.();
  engineLog().emit('auto_optimizer.scheduler.start', { enabled: AUTO_OPTIMIZER_ENABLED, intervalMs: AUTO_OPTIMIZER_INTERVAL_MS, checkMs: AUTO_OPTIMIZER_CHECK_MS, agent: AUTO_OPTIMIZER_AGENT });
}

function scheduledPageReviewState() {
  return readJsonFile(SCHEDULED_PAGE_REVIEW_STATE) || {};
}

function writeScheduledPageReviewState(patch) {
  const state = Object.assign({}, scheduledPageReviewState(), patch || {}, { updatedAt: nowIso() });
  writeJsonFileAtomic(SCHEDULED_PAGE_REVIEW_STATE, state);
  return state;
}

function pageReviewDue(state, nowMs, force) {
  if (force) return { due: true, reason: 'forced-check' };
  const lastMs = Date.parse(state.lastCheckedAt || state.lastEnqueuedAt || '') || 0;
  if (!lastMs) return { due: true, reason: 'first-run' };
  const nextMs = lastMs + SCHEDULED_PAGE_REVIEW_INTERVAL_MS;
  return {
    due: nowMs >= nextMs,
    reason: nowMs >= nextMs ? 'four-hour-interval' : 'not-due',
    nextAt: new Date(nextMs).toISOString(),
  };
}

// [B-1 去同步阻塞] public/ 目录签名(约 35MB,≤2MB 的文件读内容参与哈希)。
// 原实现在定时器回调里同步 SHA256 整个目录,单次可卡住事件循环数百 ms~数秒,
// 是 /api/health 超时 → watchdog 重启的热点之一。
// 现拆成两版(同参数下输出完全一致,见 tests/server-async-unblock.test.js):
//  - computePageReviewSignature:同步版,仅兼容直接调用方(测试/手工触发);
//  - computePageReviewSignatureAsync:异步版,逐文件 await 让出事件循环,
//    定时器与 HTTP 路径先预热 pageSignatureCache,再由 checkScheduledPageReview
//    同步消费缓存(返回 JSON 形状不变)。
const PAGE_REVIEW_SIGNATURE_OPTS = () => ({
  dir: path.join(ROOT, 'public'),
  hashRelRoot: ROOT,
  itemRelRoot: WORKDIR,
  algorithm: 'sha256-public-page-assets-v1',
});

function computePageReviewSignature() {
  return AsyncUnblock.directorySignature(PAGE_REVIEW_SIGNATURE_OPTS());
}

async function computePageReviewSignatureAsync() {
  return AsyncUnblock.directorySignatureAsync(PAGE_REVIEW_SIGNATURE_OPTS());
}

let pageSignatureCache = null; // { at, signature }

async function refreshPageSignatureCache() {
  const signature = await computePageReviewSignatureAsync();
  pageSignatureCache = { at: Date.now(), signature };
  return signature;
}

function consumePageSignatureCache() {
  const c = pageSignatureCache;
  if (!c) return null;
  if (Date.now() - c.at > PAGE_SIGNATURE_CACHE_MS) return null;
  return c.signature;
}

function scheduledPageReviewExistingItems() {
  const out = [];
  for (const agent of [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT]) {
    let listed;
    try { listed = Q.list(QUEUE_ROOT, agent); } catch (_) { continue; }
    for (const entry of listed.queued || []) {
      const task = entry.task && typeof entry.task === 'object' ? entry.task : {};
      if (task.scheduledPageReview || /^scheduled-page-review:/.test(String(task.idem || entry.idem || ''))) {
        out.push({ agent, queueId: entry.id, status: 'queued', reviewId: task.scheduledPageReview && task.scheduledPageReview.reviewId || null });
      }
    }
    for (const entry of listed.running || []) {
      const task = entry.task && typeof entry.task === 'object' ? entry.task : {};
      if (task.scheduledPageReview || /^scheduled-page-review:/.test(String(task.idem || entry.idem || ''))) {
        out.push({ agent, queueId: entry.id, status: entry.cancel_requested ? 'canceling' : 'running', reviewId: task.scheduledPageReview && task.scheduledPageReview.reviewId || null });
      }
    }
  }
  return out;
}

function scheduledPageReviewPaths(reviewId, agent) {
  const base = `projects/控制台/artifacts/ui-review/scheduled/${reviewId}`;
  return {
    base,
    manifest: `${base}/manifest.json`,
    index: `${base}/README.md`,
    screenshot: `${base}/${agent}-workspace.png`,
    report: `${base}/${agent}.md`,
    issues: `${base}/issues.jsonl`,
  };
}

function artifactPathFromWorkdirRel(rel) {
  const prefix = 'projects/控制台/artifacts/';
  const clean = String(rel || '').split('/').filter(Boolean).join('/');
  if (clean.startsWith(prefix)) return path.join(ARTIFACTS_ROOT, clean.slice(prefix.length));
  return path.join(WORKDIR, clean);
}

function scheduledPageReviewTask(agent, reviewId, reason, signature) {
  const paths = scheduledPageReviewPaths(reviewId, agent);
  const isOptimizer = agent === AUTO_OPTIMIZER_AGENT;
  const roleName = isOptimizer ? '自优化工程师 ui_optimizer(Codex 视觉评审)' : '前端程序员 frontend_designer(交互/代码评审)';
  const primaryWork = isOptimizer
    ? [
      `1. 先运行 \`node projects/控制台/tools/auto-optimizer-preflight.js --json --ignore ${AUTO_OPTIMIZER_AGENT},${FRONTEND_DESIGNER_AGENT}\`; 如果 idle=false,立即停止并只在 \`${paths.report}\` 写跳过原因。`,
      `2. 打开 \`http://127.0.0.1:41218/workspace\` 的验证标签并截图到 \`${paths.screenshot}\`;优先复用 \`shared/agents/ui-optimizer/open-validation-tab.sh\`。`,
      '3. 基于截图识别页面不流畅、交互反馈差、信息遮挡、状态不清、可读性不足等问题。Codex 视觉/代码复核是本任务必要前提。',
    ]
    : [
      `1. 先运行 \`node projects/控制台/tools/auto-optimizer-preflight.js --json --ignore ${AUTO_OPTIMIZER_AGENT},${FRONTEND_DESIGNER_AGENT}\`; 如果 idle=false,立即停止并只在 \`${paths.report}\` 写跳过原因。`,
      '2. 只读检查 `projects/控制台/public/workspace.html`、相关 API 状态流和近期 status，找交互逻辑不顺、前后端状态耦合、渲染/滚动/刷新架构可优化点。',
      '3. 不改文件;本轮只做评审和 issue 候选归档,由主管决定是否派单。',
    ];
  return {
    role: agent,
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    title: `定时页面评审 · ${roleName}`,
    idem: `scheduled-page-review:${reviewId}:${agent}`,
    scheduledPageReview: {
      reviewId,
      role: agent,
      reason,
      intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS,
      pageSignature: signature && signature.value || null,
      labels: ['review/interaction', 'review/architecture'],
    },
    goal: [
      `定时页面评审(${reviewId}) · ${roleName}`,
      `触发原因:${reason}`,
      '',
      '空闲硬门:',
      '- 本评审是低优先级任务,不得抢业务队列;一旦预检发现除本评审双 agent 外存在 queued/running,立即停止。',
      '- 只处理控制台页面评审;未注册项目排除;密钥、token、cookie、验证码不回显、不写入截图说明或报告。',
      '',
      '截图/隐私/存储规则:',
      `- 截图和报告只写入 \`${paths.base}/\`;不要上传外部服务。`,
      '- 如截图中出现密钥、cookie、token、私密聊天或授权信息,必须先遮挡/裁剪后再在报告中引用;无法脱敏就停止并写明需要主人手动处理。',
      '- 登录、扫码、OAuth、2FA、系统授权都交主人手动,不要自动尝试。',
      '',
      '执行步骤:',
      ...primaryWork,
      `4. 写报告到 \`${paths.report}\`,至少分两栏:「交互逻辑/流畅性问题」与「架构可优化点」。没有问题也要写清为什么跳过。`,
      `5. 将可落地事项以 JSONL 追加到 \`${paths.issues}\`:每行包含 label(review/interaction 或 review/architecture)、severity、title、evidence、suggested_owner、dispatch:"supervisor_decides"。`,
      `6. 不直接派修、不发通知;主管 review-loop 读取 \`${paths.index}\` 和 issues 后再决定是否派单。`,
      '',
      '最后输出 JSON:',
      '```json',
      '{"implementation":{"done":true,"summary":"本轮评审产出/或跳过原因","changed_files":["' + paths.report + '","' + paths.issues + '"],"logic_chain":{"summary":"...","current_status":"done","actions":["完成页面评审"],"evidence":[{"kind":"file","path":"' + paths.report + '","summary":"评审报告"}],"tests":[],"conclusion":"..."}}}',
      '```',
    ].join('\n'),
    bounds: '低优先级定时页面评审;仅空闲时运行;只处理 projects/控制台/ 页面评审;未注册项目排除;密钥不回显;登录/授权交主人手动。',
    acceptance: `预检空闲后才评审;报告落 ${paths.report}; issue 候选落 ${paths.issues} 并打 review/interaction 或 review/architecture;不直接派修。`,
    useOrchestrator: false,
    autoApproveHuman: true,
    nodeTimeoutSec: 900,
  };
}

function writeScheduledPageReviewManifest(reviewId, reason, signature) {
  const paths = scheduledPageReviewPaths(reviewId, 'index');
  const absDir = artifactPathFromWorkdirRel(paths.base);
  fs.mkdirSync(absDir, { recursive: true });
  const manifest = {
    reviewId,
    createdAt: nowIso(),
    reason,
    intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS,
    agents: [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT],
    pageSignature: signature,
    labels: ['review/interaction', 'review/architecture'],
    privacy: {
      screenshotDir: paths.base,
      externalUpload: false,
      redactSensitiveData: true,
      ownerHandlesLoginAndAuthorization: true,
    },
    consumption: {
      issuesFile: `${paths.base}/issues.jsonl`,
      dispatchPolicy: 'supervisor_decides',
    },
  };
  writeJsonFileAtomic(path.join(absDir, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(absDir, 'README.md'), [
    `# 定时页面评审 ${reviewId}`,
    '',
    `- 触发原因:${reason}`,
    `- 周期:${Math.round(SCHEDULED_PAGE_REVIEW_INTERVAL_MS / 60 / 60 / 1000)} 小时`,
    `- 参与:${FRONTEND_DESIGNER_AGENT} + ${AUTO_OPTIMIZER_AGENT}`,
    `- 页面签名:${signature && signature.value || 'unknown'}`,
    '- 标签:review/interaction, review/architecture',
    '- 派发:只生成 issue 候选,由主管决定是否派单。',
    '',
  ].join('\n'));
  return manifest;
}

function pruneScheduledPageReviewArtifacts(retain = 20) {
  const dir = path.join(ARTIFACTS_ROOT, 'ui-review', 'scheduled');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch (_) { return; }
  const remove = entries.slice(0, Math.max(0, entries.length - retain));
  for (const name of remove) {
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } catch (_) {}
  }
}

function acquireSchedulerLock(file, staleMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rec = { pid: process.pid, at: nowIso() };
  try {
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' });
    return true;
  } catch (_) {
    const existing = readJsonFile(file);
    const age = recordAgeMs(existing);
    if (age > staleMs) {
      try { fs.unlinkSync(file); } catch (_) {}
      try {
        fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' });
        return true;
      } catch (_) {}
    }
  }
  return false;
}

function releaseSchedulerLock(file) {
  try { fs.unlinkSync(file); } catch (_) {}
}

function checkScheduledPageReview(opts = {}) {
  if (!SCHEDULED_PAGE_REVIEW_ENABLED && !opts.force) {
    return { ok: true, action: 'disabled' };
  }
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const state = scheduledPageReviewState();
  const due = pageReviewDue(state, nowMs, !!opts.force);
  if (!due.due) return { ok: true, action: 'skip', reason: due.reason, nextAt: due.nextAt };

  const lockFile = path.join(ARTIFACTS_ROOT, 'ui-review', 'scheduled.lock');
  if (!acquireSchedulerLock(lockFile, Math.max(SCHEDULED_PAGE_REVIEW_CHECK_MS * 2, 5 * 60 * 1000))) {
    engineLog().emit('scheduled_page_review.skipped', { reason: 'scheduler-lock-held' });
    return { ok: true, action: 'skip', reason: 'scheduler-lock-held' };
  }

  try {
    const lockedState = scheduledPageReviewState();
    const lockedDue = pageReviewDue(lockedState, nowMs, !!opts.force);
    if (!lockedDue.due) return { ok: true, action: 'skip', reason: lockedDue.reason, nextAt: lockedDue.nextAt };

    const existing = scheduledPageReviewExistingItems();
    if (existing.length) {
      engineLog().emit('scheduled_page_review.skipped', { reason: 'already-active', existing });
      return { ok: true, action: 'skip', reason: 'already-active', existing };
    }

    const activeBefore = queueActiveItems();
    if (activeBefore.length) {
      writeScheduledPageReviewState({
        lastSkippedAt: nowIso(),
        lastSkipReason: 'queues-active',
        activeCount: activeBefore.length,
        sampleActive: activeBefore.slice(0, 8),
      });
      engineLog().emit('scheduled_page_review.skipped', { reason: 'queues-active', activeCount: activeBefore.length, sampleActive: activeBefore.slice(0, 5) });
      return { ok: true, action: 'skip', reason: 'queues-active', activeCount: activeBefore.length, sampleActive: activeBefore.slice(0, 8) };
    }

    // [B-1 去同步阻塞] 优先消费定时器/HTTP 路径异步预热好的签名缓存;
    // 缓存缺失或过期(直接调用方场景)才走同步计算,行为与旧版一致。
    const signature = consumePageSignatureCache() || computePageReviewSignature();
    if (!opts.force && lockedState.lastPageSignature === signature.value) {
      const nextAt = new Date(nowMs + SCHEDULED_PAGE_REVIEW_INTERVAL_MS).toISOString();
      writeScheduledPageReviewState({
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastSkippedAt: nowIso(),
        lastSkipReason: 'page-unchanged',
        lastPageSignature: signature.value,
        lastPageSignatureDetails: signature,
        nextAt,
      });
      engineLog().emit('scheduled_page_review.skipped', { reason: 'page-unchanged', pageSignature: signature.value, nextAt });
      return { ok: true, action: 'skip', reason: 'page-unchanged', pageSignature: signature.value, nextAt };
    }

    if (typeof opts.beforeSecondIdleCheck === 'function') opts.beforeSecondIdleCheck();
    const activeAfter = queueActiveItems();
    if (activeAfter.length) {
      writeScheduledPageReviewState({
        lastSkippedAt: nowIso(),
        lastSkipReason: 'queues-active-after-recheck',
        activeCount: activeAfter.length,
        sampleActive: activeAfter.slice(0, 8),
      });
      engineLog().emit('scheduled_page_review.skipped', { reason: 'queues-active-after-recheck', activeCount: activeAfter.length, sampleActive: activeAfter.slice(0, 5) });
      return { ok: true, action: 'skip', reason: 'queues-active-after-recheck', activeCount: activeAfter.length, sampleActive: activeAfter.slice(0, 8) };
    }

    const stamp = new Date(nowMs).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const reviewId = `scheduled-${stamp}`;
    const reason = lockedDue.reason;
    const manifest = writeScheduledPageReviewManifest(reviewId, reason, signature);
    pruneScheduledPageReviewArtifacts();
    const entries = [];
    for (const agent of [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT]) {
      const task = scheduledPageReviewTask(agent, reviewId, reason, signature);
      const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, agent, task, { priority: 99, idem: task.idem, eventlog: engineLog(), source: 'scheduled-page-review', projectId: '控制台' });
      entries.push({ id: entry.id, agent, priority: entry.priority });
    }
    const nextAt = new Date(nowMs + SCHEDULED_PAGE_REVIEW_INTERVAL_MS).toISOString();
    writeScheduledPageReviewState({
      lastCheckedAt: new Date(nowMs).toISOString(),
      lastEnqueuedAt: nowIso(),
      lastReviewId: reviewId,
      lastReason: reason,
      lastPageSignature: signature.value,
      lastPageSignatureDetails: signature,
      lastQueueEntries: entries,
      nextAt,
    });
    engineLog().emit('scheduled_page_review.enqueued', { reviewId, queueEntries: entries, reason, intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS, pageSignature: signature.value, manifest: manifest && manifest.consumption });
    for (const entry of entries) ensureQueueWorker(entry.agent);
    return { ok: true, action: 'enqueued', reviewId, entries, reason, pageSignature: signature.value, nextAt };
  } finally {
    releaseSchedulerLock(lockFile);
  }
}

// [B-1 去同步阻塞] 定时器/HTTP 入口统一走这里:先判 due(纯内存+小 JSON,便宜),
// due 时用 fs.promises 异步预热 public/ 签名缓存(逐文件让出事件循环),
// 然后同步调 checkScheduledPageReview(其内部消费缓存,不再同步哈希 35MB)。
// 返回值与 checkScheduledPageReview 完全相同(JSON 形状不变)。
async function checkScheduledPageReviewNonBlocking(opts = {}) {
  const enabled = SCHEDULED_PAGE_REVIEW_ENABLED || !!opts.force;
  if (enabled && PAGE_REVIEW_ASYNC_SIGNATURE) {
    const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
    const due = pageReviewDue(scheduledPageReviewState(), nowMs, !!opts.force);
    // 缓存仍在可信窗口内(PAGE_SIGNATURE_CACHE_MS)就不重复哈希:
    // due 且队列忙时定时器每 60s 都会走到这里,避免每 tick 重刷 ~35MB
    if (due.due && !consumePageSignatureCache()) {
      try { await refreshPageSignatureCache(); } catch (_) { /* 预热失败退回同步计算 */ }
    }
  }
  return checkScheduledPageReview(opts);
}

function startScheduledPageReviewScheduler() {
  if (scheduledPageReviewTimer || process.env.QUEUE_WORKER_DISABLED === '1') return;
  if (!SCHEDULED_PAGE_REVIEW_ENABLED) {
    engineLog().emit('scheduled_page_review.scheduler.start', { enabled: false, intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS, checkMs: SCHEDULED_PAGE_REVIEW_CHECK_MS, agents: [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT] });
    return;
  }
  const emitError = e => engineLog().emit('scheduled_page_review.error', { reason: String(e && e.message || e).slice(0, 300) });
  scheduledPageReviewTimer = setInterval(() => {
    // [B-1 去同步阻塞] async 版:签名哈希不再阻塞事件循环
    checkScheduledPageReviewNonBlocking().catch(emitError);
  }, SCHEDULED_PAGE_REVIEW_CHECK_MS);
  if (scheduledPageReviewTimer.unref) scheduledPageReviewTimer.unref();
  setTimeout(() => {
    checkScheduledPageReviewNonBlocking().catch(emitError);
  }, SCHEDULER_STARTUP_DELAY_MS).unref?.();
  engineLog().emit('scheduled_page_review.scheduler.start', { enabled: SCHEDULED_PAGE_REVIEW_ENABLED, intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS, checkMs: SCHEDULED_PAGE_REVIEW_CHECK_MS, agents: [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT] });
}

function checkInsightScoutRepos(opts = {}) {
  if (!INSIGHT_SCOUT_REPOS_ENABLED && !opts.force) {
    return { ok: true, action: 'disabled' };
  }
  const result = InsightScoutRepos.enqueueDue({
    queueRoot: QUEUE_ROOT,
    eventlog: engineLog(),
    nowMs: opts.nowMs,
    slot: opts.slot,
    topic: opts.topic,
    force: !!opts.force,
    dryRun: !!opts.dryRun,
    allowConcurrent: !!opts.allowConcurrent,
    intervalMs: INSIGHT_SCOUT_REPOS_INTERVAL_MS,
    priority: opts.priority == null ? InsightScoutRepos.DEFAULT_PRIORITY : opts.priority,
    id: opts.id,
    source: 'insight-scout-repos',
  });
  if (result && result.action === 'enqueued') ensureQueueWorker(InsightScoutRepos.AGENT);
  return result;
}

function startInsightScoutReposScheduler() {
  if (insightScoutReposTimer || process.env.QUEUE_WORKER_DISABLED === '1') return;
  if (!INSIGHT_SCOUT_REPOS_ENABLED) {
    engineLog().emit('insight_scout.repos.scheduler.start', {
      enabled: false,
      intervalMs: INSIGHT_SCOUT_REPOS_INTERVAL_MS,
      checkMs: INSIGHT_SCOUT_REPOS_CHECK_MS,
      agent: InsightScoutRepos.AGENT,
    });
    return;
  }
  insightScoutReposTimer = setInterval(() => {
    try { checkInsightScoutRepos(); }
    catch (e) { engineLog().emit('insight_scout.repos.error', { reason: String(e && e.message || e).slice(0, 300) }); }
  }, INSIGHT_SCOUT_REPOS_CHECK_MS);
  if (insightScoutReposTimer.unref) insightScoutReposTimer.unref();
  setTimeout(() => {
    try { checkInsightScoutRepos(); }
    catch (e) { engineLog().emit('insight_scout.repos.error', { reason: String(e && e.message || e).slice(0, 300) }); }
  }, SCHEDULER_STARTUP_DELAY_MS).unref?.();
  engineLog().emit('insight_scout.repos.scheduler.start', {
    enabled: INSIGHT_SCOUT_REPOS_ENABLED,
    intervalMs: INSIGHT_SCOUT_REPOS_INTERVAL_MS,
    checkMs: INSIGHT_SCOUT_REPOS_CHECK_MS,
    agent: InsightScoutRepos.AGENT,
  });
}

function buildPrompt(message, history) {
  if (!cfg.includeHistory || !Array.isArray(history) || history.length === 0) return message;
  const recent = history.slice(-(cfg.historyMax || 6));
  const lines = recent.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`).join('\n');
  return `以下是之前的对话(供参考):\n${lines}\n\n当前用户消息:\n${message}`;
}

function buildSecretaryPrompt(message, history) {
  const base = buildPrompt(message, history);
  return [
    SecretaryTools.buildContextText(),
    '',
    '[秘书网页会话规则]',
    '- 先用上面的 board/队列/公告板/能力背景理解任务,再回复或派单。',
    '- 需要最新信息时,可调用: node projects/控制台/secretary-tools.js search --query "<query>" --count 5。',
    '- 需要共享能力时,先查 capability_registry; Meowa 用共享 CLI,不要复制 key。',
    '- 可运营队列/公告板: queue-status、queue-enqueue、queue-jump、queue-cancel、bulletin-add、bulletin-enable; 洞察员公告板卡片不得后台自动启用,需老板网页手动或明确批准。',
    '- 老板后续普通任务默认只走: 秘书补全 -> CEO 决策 -> 主管/员工执行;不涉及维修时不要直派专职队列。',
    '- 涉及维修/救火/重启/权限/孤儿进程/卡死等,写维修工单或转 repair-lead;不走普通 CEO 项目分派。',
    '- 前台 Cowork 负责深度交互/规格/定时/可视化; 你负责后台补背景、路由、派单、运营。',
    '',
    '[当前消息]',
    base,
  ].join('\n');
}

function readEnvFile(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch (_) {}
  return env;
}

function resolveConfigPath(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function resolveRunnerSecret(r, key) {
  if (r[`${key}Env`] && process.env[r[`${key}Env`]]) return process.env[r[`${key}Env`]];
  if (r.tokenEnv && key === 'token' && process.env[r.tokenEnv]) return process.env[r.tokenEnv];
  const file = resolveConfigPath(r.tokenFile || r.envFile);
  if (file) {
    const env = readEnvFile(file);
    const envKey = r[`${key}Key`] || (key === 'token' ? 'NEW_API_TOKEN' : null);
    if (envKey && env[envKey]) return env[envKey];
  }
  return r[key] || '';
}

function resolveRunnerBaseUrl(r) {
  const file = resolveConfigPath(r.tokenFile || r.envFile);
  const env = file ? readEnvFile(file) : {};
  return String(r.baseUrl || env.NEW_API_BASE_URL || '').replace(/\/+$/, '');
}

function expandEnvValue(value, env) {
  return String(value == null ? '' : value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => env[key] || '');
}

function buildRunnerEnv(r) {
  const out = Object.assign({}, process.env);
  const file = resolveConfigPath(r.envFile || r.tokenFile);
  const fileEnv = file ? readEnvFile(file) : {};
  if (r.envFromFile && typeof r.envFromFile === 'object') {
    for (const [target, source] of Object.entries(r.envFromFile)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(target) && fileEnv[source]) out[target] = fileEnv[source];
    }
  }
  const merged = Object.assign({ PROJECT_ROOT: ROOT, WORKDIR }, process.env, fileEnv, out);
  if (r.env && typeof r.env === 'object') {
    for (const [key, value] of Object.entries(r.env)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = expandEnvValue(value, merged);
    }
  }
  return out;
}

function safePeekabooArtifactPath(rel) {
  const clean = decodeURIComponent(String(rel || '')).replace(/\0/g, '');
  const fp = path.resolve(PEEKABOO_BASELINE_DIR, clean);
  const root = path.resolve(PEEKABOO_BASELINE_DIR);
  if (fp !== root && !fp.startsWith(root + path.sep)) return null;
  return fp;
}

function walkFiles(dir, depth, out) {
  if (depth < 0 || out.length >= 160) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(fp, depth - 1, out);
    else if (ent.isFile()) {
      try {
        const st = fs.statSync(fp);
        out.push({ fp, mtime: st.mtimeMs, size: st.size });
      } catch (_) {}
    }
  }
}

function peekabooArtifactUrl(rel) {
  return '/api/peekaboo-baseline/file/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

function listPeekabooBaselineArtifacts() {
  const root = path.resolve(PEEKABOO_BASELINE_DIR);
  const files = [];
  walkFiles(root, 3, files);
  files.sort((a, b) => b.mtime - a.mtime);
  const imageExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  const logExt = new Set(['.json', '.txt', '.log', '.md']);
  const toItem = f => {
    const rel = path.relative(root, f.fp);
    return {
      name: path.basename(f.fp),
      rel: rel.split(path.sep).join('/'),
      url: peekabooArtifactUrl(rel),
      run: rel.split(path.sep)[0] || '',
      mtime: new Date(f.mtime).toISOString(),
      size: f.size,
    };
  };
  return {
    ok: true,
    root: 'projects/控制台/artifacts/peekaboo-baseline',
    images: files.filter(f => imageExt.has(path.extname(f.fp).toLowerCase())).slice(0, 18).map(toItem),
    logs: files.filter(f => logExt.has(path.extname(f.fp).toLowerCase())).slice(0, 18).map(toItem),
  };
}

async function openaiHttpRun(r, prompt, emit) {
  const baseUrl = resolveRunnerBaseUrl(r);
  const token = resolveRunnerSecret(r, 'token');
  const model = r.model || (resolveConfigPath(r.tokenFile) ? readEnvFile(resolveConfigPath(r.tokenFile)).NEW_API_MODEL : '') || 'glm-5.2';
  if (!baseUrl) throw new Error('openai_http 缺 baseUrl/NEW_API_BASE_URL');
  if (!token) throw new Error('openai_http 缺 token/NEW_API_TOKEN');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      messages: r.systemPrompt ? [{ role: 'system', content: r.systemPrompt }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }],
      temperature: r.temperature == null ? 0.3 : r.temperature,
      max_tokens: r.maxTokens || 2048,
    }),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!response.ok || body.error) {
    const msg = (body.error && body.error.message) || body.message || body.raw || `HTTP ${response.status}`;
    throw new Error(String(msg).slice(0, 500));
  }
  const msg = (body.choices && body.choices[0] && body.choices[0].message) || {};
  const content = msg.content || msg.reasoning_content || '';
  emit({ type:'delta', text: content || '(openai_http 返回空内容)' });
  emit({ type:'done', code:0, model: body.model || model });
}

function mockRun(prompt, emit, done) {
  const reply = `【Mock 回显】我收到了:「${prompt.slice(0, 200)}」。这是自测用的假 runner,装好 codex 后在右上角切换即可。`;
  const parts = reply.match(/.{1,12}/gu) || [reply];
  let i = 0;
  const t = setInterval(() => {
    if (i >= parts.length) { clearInterval(t); emit({ type:'done', code:0 }); done(); return; }
    emit({ type:'delta', text: parts[i++] });
  }, 60);
}

function handleChat(res, body) {
  const { runner, message, history, role } = body || {};
  const r = cfg.runners[runner];
  if (!r) return json(res, 400, { error: `未知 runner: ${runner}` });
  if (typeof message !== 'string' || !message.trim()) return json(res, 400, { error: '空消息' });

  res.writeHead(200, { 'Content-Type':'application/x-ndjson; charset=utf-8', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' });
  let acc = '', logged = false;
  const logHist = (ok) => { if (logged) return; logged = true; appendHistory({ ts:new Date().toISOString(), role:role||null, runner, task:String(message).slice(0,1000), ok, summary:acc.slice(0,300) }); };
  const emit = (o) => { if (o && o.type === 'delta' && o.text) acc += o.text; try { res.write(JSON.stringify(o) + '\n'); } catch (_) {} };
  const prompt = role === 'secretary' ? buildSecretaryPrompt(message, history) : buildPrompt(message, history);

  if (r.cmd[0] === '__mock__') { return mockRun(prompt, emit, () => { logHist(true); res.end(); }); }
  if (r.kind === 'openai_http') {
    emit({ type:'meta', text:`runner=${runner} · openai_http · model=${r.model || 'default'}` });
    openaiHttpRun(r, prompt, emit)
      .then(() => { logHist(true); res.end(); })
      .catch(e => { emit({ type:'error', text:`openai_http 失败: ${e.message}` }); logHist(false); res.end(); });
    return;
  }

  emit({ type:'meta', text:`runner=${runner} · workdir=${WORKDIR}` });
  const args = [...r.cmd.slice(1)];
  if (r.promptVia === 'arg') args.push(prompt);

  let child;
  try {
    child = spawn(r.cmd[0], args, { cwd: WORKDIR, env: buildRunnerEnv(r) });
  } catch (e) {
    emit({ type:'error', text:`spawn 失败: ${e.message}` }); return res.end();
  }
  if (r.promptVia === 'stdin') {
    child.stdin.write(prompt);
    child.stdin.end();
  } else if (child.stdin) {
    child.stdin.end();
  }

  let finished = false;
  const finish = () => { if (finished) return; finished = true; try { res.end(); } catch (_) {} };
  child.stdout.on('data', d => emit({ type:'delta', text: d.toString() }));
  child.stderr.on('data', d => emit({ type:'log',   text: d.toString() }));
  child.on('error', e => { emit({ type:'error', text:`无法启动 ${r.cmd[0]}: ${e.message}(确认它在 PATH;新开终端再试)` }); logHist(false); finish(); });
  child.on('close', code => { if (!finished) emit({ type:'done', code }); logHist(code === 0); finish(); });

  res.on('close', () => { try { child.kill(); } catch (_) {} });
}

function handleEngineRun(res, body) {
  const goal = String((body && (body.goal || body.message)) || '').trim();
  if (!goal) return json(res, 400, { ok:false, error:'空任务' });
  let prepared;
  try {
    prepared = taskWithSavedAttachments({
      goal,
      inputs: Array.isArray(body && body.inputs) ? body.inputs : [],
    }, body && (body.attachments || body.images));
  } catch (e) {
    return json(res, 400, { ok:false, error:e.message });
  }
  const flowId = String((body && body.flowId) || 'review-loop').replace(/[^A-Za-z0-9_-]/g, '') || 'review-loop';
  const taskId = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(ENGINE_JOBS, { recursive: true });
  fs.mkdirSync(path.dirname(ENGINE_WORKER_LOG), { recursive: true });
  const spec = {
    taskId,
    flowId,
    role: body.role || 'orchestrator',
    goal,
    bounds: body.bounds || '只处理本任务; 未注册项目排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明',
    inputs: Array.isArray(prepared.task.inputs) ? prepared.task.inputs : [],
    attachments: prepared.attachments,
    acceptance: body.acceptance || '事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图',
    useOrchestrator: body.useOrchestrator !== false,
    autoApproveHuman: !!body.autoApproveHuman,
  };
  const specFile = path.join(ENGINE_JOBS, `${taskId}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
  engineLog().emit('task.queued', { task: taskId, flow: flowId, role: spec.role, goal: goal.slice(0, 500), attachments: prepared.attachments.length || undefined });

  const fd = fs.openSync(ENGINE_WORKER_LOG, 'a');
  let child;
  try {
    child = spawn(RuntimePaths.nodeBin(), [path.join(ROOT, 'engine-runner.js'), '--spec', specFile], {
      cwd: ROOT,
      env: RuntimePaths.applyRuntimeEnv(process.env),
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    engineLog().emit('task.failed', { task: taskId, flow: flowId, reason: `spawn engine-runner failed: ${e.message}` });
    return json(res, 500, { ok:false, error:e.message, taskId });
  }
  try { fs.closeSync(fd); } catch (_) {}
  return json(res, 200, { ok:true, taskId, flowId, events:'/api/events' });
}

function queueTaskText(task) {
  if (task && typeof task === 'object') return String(task.goal || task.message || task.task || JSON.stringify(task)).slice(0, 500);
  return String(task || '').slice(0, 500);
}

function nowIso() { return new Date().toISOString(); }

function defaultBulletinCards() {
  const ts = nowIso();
  return [
    {
      id: 'locate-anything-3b',
      title: '部署 LocateAnything-3B',
      desc: '视觉定位增强、补 Peekaboo；给截图和文字描述返回坐标框，与 Peekaboo 点击互补。Mac 可调研 locate-anything.cpp 本地跑或接 new-api 作视觉端点。注意：NVIDIA 非商用许可，启用前确认用途。',
      target: 'ceo',
      project: '控制台',
      payload: {
        role: 'orchestrator',
        flowId: 'project-route',
        projectId: '控制台',
        goal: '调研并部署 LocateAnything-3B，形成可被控制台/Peekaboo 调用的视觉定位服务；先确认 NVIDIA 非商用许可与本机用途边界，不要擅自接入生产。',
        bounds: '只处理控制台视觉定位增强；未注册项目排除；密钥不回显；外部下载或授权需要说明。',
        acceptance: '给出部署路径、调用方式、许可证风险说明；如已接通，提供一次截图定位冒烟结果。',
        useOrchestrator: true,
        autoApproveHuman: true
      },
      status: 'todo',
      created_at: ts
    },
    {
      id: 'peekaboo-baseline',
      title: 'Peekaboo 基线测试 + 产物上界面',
      desc: '主环境屏幕录制/辅助功能已授权；补 peekaboo agent 的 API key 走 new-api，跑截图和点击基线测试，并把截图产物展示到工作区界面。',
      target: 'ceo',
      project: '控制台',
      payload: {
        role: 'orchestrator',
        flowId: 'project-route',
        projectId: '控制台',
        goal: '完成 Peekaboo 基线测试：校准 agent key 走 new-api，跑一轮截图与点击冒烟，并把截图产物展示到控制台工作区界面。',
        bounds: '只动控制台与 Peekaboo 本地配置；未注册项目排除；密钥不回显；不删除已有产物。',
        acceptance: 'Peekaboo 截图和点击测试都有记录；工作区能看到相关产物入口或状态。',
        useOrchestrator: true,
        autoApproveHuman: true
      },
      status: 'todo',
      created_at: ts
    }
  ];
}

function ensureBulletinFile() {
  fs.mkdirSync(BULLETIN_DIR, { recursive: true });
  if (!fs.existsSync(BULLETIN_FILE)) writeBulletinCards(defaultBulletinCards());
}

function readBulletinCards() {
  ensureBulletinFile();
  try {
    const cards = JSON.parse(fs.readFileSync(BULLETIN_FILE, 'utf8'));
    return Array.isArray(cards) ? cards.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function writeBulletinCards(cards) {
  fs.mkdirSync(BULLETIN_DIR, { recursive: true });
  const tmp = `${BULLETIN_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cards, null, 2) + '\n');
  fs.renameSync(tmp, BULLETIN_FILE);
}

function repairTicketPath(id, workdir = WORKDIR) {
  const safe = safeRepairTicketId(id);
  if (!safe) return null;
  return path.join(workdir, 'board', 'repair-tickets', `${safe}.md`);
}

function repairTicketStatus(id, workdir = WORKDIR) {
  const file = repairTicketPath(id, workdir);
  if (!file) return '';
  let text = '';
  try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch (_) { return ''; }
  return ((text.match(/^- status:\s*(.+)$/m) || [null, ''])[1] || '').trim();
}

function doneLikeRepairStatus(status) {
  return /^(done|closed|canceled)$/i.test(String(status || '').trim());
}

function repairTicketIdFromBulletinCard(card) {
  if (!card) return '';
  const direct = String(card.id || '').match(/^repair-(.+)$/);
  if (direct && safeRepairTicketId(direct[1])) return direct[1];
  const goal = card.payload && (card.payload.goal || card.payload.message || card.payload.task) || '';
  const byPath = String(goal).match(/board\/repair-tickets\/([A-Za-z0-9._-]+)\.md/);
  if (byPath && safeRepairTicketId(byPath[1])) return byPath[1];
  const byTitle = String(goal).match(/维修工单\s+([A-Za-z0-9._-]+)/);
  if (byTitle && safeRepairTicketId(byTitle[1])) return byTitle[1];
  return '';
}

function doneRepairTicketBulletin(card, workdir = WORKDIR) {
  const ticketId = repairTicketIdFromBulletinCard(card);
  const status = ticketId ? repairTicketStatus(ticketId, workdir) : '';
  return {
    skip: !!(ticketId && doneLikeRepairStatus(status)),
    ticketId,
    status,
  };
}

function isRepairTarget(target) {
  return target === 'repair-lead' || target === 'repair';
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

function bulletinTargetRole(target) {
  if (target === 'ceo') return 'orchestrator';
  if (/^supervisor-/.test(target)) return 'supervisor';
  if (/^worker_code-/.test(target)) return 'worker_code';
  if (/^worker_narrow-/.test(target)) return 'worker_narrow';
  return target;
}

function normalizeBulletinPayload(body, target, project, title, desc) {
  const raw = body && body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  const payload = Object.assign({}, raw);
  const goal = String(payload.goal || payload.message || payload.task || `${title}${desc ? '\n\n' + desc : ''}`).trim();
  payload.goal = goal || title;
  if (!payload.role) payload.role = bulletinTargetRole(target);
  if (!payload.flowId) payload.flowId = target === 'ceo' ? 'project-route' : 'agent-once';
  if (project && !payload.projectId) payload.projectId = project;
  if (payload.useOrchestrator == null) payload.useOrchestrator = target === 'ceo';
  if (payload.autoApproveHuman == null) payload.autoApproveHuman = true;
  if (!payload.bounds) payload.bounds = '只处理本公告板任务; 未注册项目排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明';
  if (!payload.acceptance) payload.acceptance = '任务有事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图';
  return payload;
}

function normalizeBulletinCard(body) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('标题不能为空');
  const desc = String(body.desc || body.description || '').trim();
  const target = safeAgent(body.target || 'ceo');
  if (!target) throw new Error('坏 target');
  const project = body.project == null ? '' : String(body.project || '').trim().slice(0, 80);
  const source = body.source == null ? '' : String(body.source || '').trim().slice(0, 80);
  const rawId = body.id ? safeBulletinId(body.id) : null;
  if (body.id && !rawId) throw new Error('坏公告卡 id');
  return {
    id: rawId || `bb-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    title: title.slice(0, 140),
    desc: desc.slice(0, 1200),
    target,
    project,
    source,
    payload: normalizeBulletinPayload(body, target, project, title, desc),
    status: body.status === 'enabled' ? 'enabled' : 'todo',
    created_at: body.created_at || nowIso(),
    enabled_at: body.enabled_at || null,
    queueId: body.queueId || null
  };
}

// ── 公告卡 enable/remove 内核(网页 /api/bulletin 与飞书决策回调 /api/decision 共用同一套逻辑) ──
function removeBulletinCardAt(cards, idx, sourceOverride) {
  const [card] = cards.splice(idx, 1);
  writeBulletinCards(cards);
  engineLog().emit('bulletin.removed', { bulletinId: card.id, target: card.target, title: card.title, source: sourceOverride || card.source || null });
  return card;
}

function enableBulletinCardAt(cards, idx) {
  const card = cards[idx];
  const id = card.id;
  const target = safeAgent(card.target || 'ceo');
  if (!target) return { code: 400, body: { ok:false, error:'坏 target' } };
  const repairSkip = isRepairTarget(target) ? doneRepairTicketBulletin(card) : null;
  if (repairSkip && repairSkip.skip) {
    const [removed] = cards.splice(idx, 1);
    writeBulletinCards(cards);
    engineLog().emit('bulletin.enable_skipped', {
      bulletinId: id,
      reason: 'repair-ticket-already-done',
      ticketId: repairSkip.ticketId,
      status: repairSkip.status,
    });
    engineLog().emit('bulletin.removed', {
      bulletinId: id,
      target: removed.target,
      title: removed.title,
      source: 'repair-ticket-already-done',
    });
    return { code: 200, body: { ok:true, alreadyDone:true, ticketId: repairSkip.ticketId, status: repairSkip.status, card: removed } };
  }
  if (card.status === 'enabled') {
    return { code: 200, body: { ok:true, already:true, card, queueStatus: queueEntryStatus(target, card.queueId) } };
  }
  const payload = card.payload && typeof card.payload === 'object'
    ? card.payload
    : normalizeBulletinPayload(card, target, card.project || '', card.title || id, card.desc || '');
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, target, payload, { idem: `bulletin:${id}`, eventlog: engineLog(), source: 'bulletin' });
  card.status = 'enabled';
  card.enabled_at = nowIso();
  card.queueId = entry.id;
  cards[idx] = card;
  writeBulletinCards(cards);
  engineLog().emit('bulletin.enabled', { bulletinId: id, queueAgent: target, queueId: entry.id, goal: queueTaskText(entry.task), source: card.source || null });
  engineLog().emit('queue.enqueued', { queueAgent: target, queueId: entry.id, priority: entry.priority, goal: queueTaskText(entry.task), source: 'bulletin', bulletinId: id });
  ensureQueueWorker(target);
  return { code: 200, body: { ok:true, card, entry, queueStatus: queueEntryStatus(target, entry.id) } };
}

// ── 飞书决策卡真回调(拍板 Q12,老板 6/29:"两个选项作为两个按钮,按了就相当于决策") ──
// GET /api/decision/<cardId>/<approve|reject>?t=<token>
// token = HMAC-SHA256(每卡随机 secret, cardId:action);secret 存卡片记录/决策留痕,不回显日志。
// 已知边界:本服务只绑 127.0.0.1,手机点飞书按钮暂时不可达(LAN/桥接排后);不要为此改监听绑定。
// 反悔开关:DECISION_CALLBACK_ENABLED=0 可整体关闭该端点(默认开)。
function readDecisionActions() {
  try {
    const map = JSON.parse(fs.readFileSync(DECISION_ACTIONS_FILE, 'utf8'));
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch (_) {
    return {};
  }
}

function writeDecisionActions(map) {
  fs.mkdirSync(BULLETIN_DIR, { recursive: true });
  const tmp = `${DECISION_ACTIONS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
  fs.renameSync(tmp, DECISION_ACTIONS_FILE);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function decisionHtml(res, code, title, detail) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end([
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="font-family:-apple-system,sans-serif;max-width:480px;margin:18vh auto 0;padding:0 16px;text-align:center">',
    `<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>`,
    `<p style="color:#555;line-height:1.6;margin:0">${escapeHtml(detail || '')}</p>`,
    '</body></html>',
  ].join(''));
}

function handleDecisionCallback(req, res, match, u) {
  if (!DECISION_CALLBACK_ENABLED) return decisionHtml(res, 404, '决策回调未启用', '控制台已用 DECISION_CALLBACK_ENABLED=0 关闭此入口,请回控制台公告板处理。');
  if (req.method !== 'GET') return json(res, 405, { ok:false, error:'method not allowed' });
  const id = safeBulletinId(match[1]);
  const action = match[2];
  if (!id || (action !== 'approve' && action !== 'reject')) return decisionHtml(res, 400, '坏决策请求', '决策链接不完整。');
  const token = String(u.searchParams.get('t') || '');
  try {
    const cards = readBulletinCards();
    const idx = cards.findIndex(c => c && c.id === id);
    const card = idx >= 0 ? cards[idx] : null;
    const actions = readDecisionActions();
    const done = actions[id] || null;
    const secret = String((card && card.decisionSecret) || (done && done.secret) || '');
    // 无 secret(卡不存在 / 未签发回调按钮)与 token 不符一律 403,不执行任何决策。
    if (!secret || !DecisionToken.verify(secret, id, action, token)) {
      return decisionHtml(res, 403, '校验失败', '决策链接无效或已失效,本次点击未执行任何操作。');
    }
    const title = String((card && card.title) || (done && done.title) || id);
    if (done) {
      return decisionHtml(res, 200, '已处理过', `「${title}」此前已${done.action === 'approve' ? '批准' : '驳回'}(${done.at}),本次点击不再重复执行。`);
    }
    if (!card) return decisionHtml(res, 404, '决策卡不存在', `「${title}」可能已在控制台被处理或删除。`);
    if (card.status === 'enabled') {
      return decisionHtml(res, 200, '已处理过', `「${title}」已在控制台启用执行,本次点击不再重复执行。`);
    }
    let queueId = null;
    if (action === 'approve') {
      const r = enableBulletinCardAt(cards, idx);
      if (!(r.body && r.body.ok)) return decisionHtml(res, r.code || 500, '决策执行失败', String((r.body && r.body.error) || '批准未生效,请回控制台处理。'));
      queueId = (r.body.entry && r.body.entry.id) || null;
    } else {
      removeBulletinCardAt(cards, idx, 'feishu-decision-reject');
    }
    actions[id] = {
      action,
      at: nowIso(),
      title: title.slice(0, 140),
      target: card.target || null,
      queueId,
      secret, // 只留在本地留痕文件,用于重复点击的幂等校验;不写事件、不回显日志
    };
    writeDecisionActions(actions);
    engineLog().emit('decision.card.actioned', { bulletinId: id, action, title: title.slice(0, 140), target: card.target || null, queueId, via: 'feishu-card' });
    return decisionHtml(
      res,
      200,
      action === 'approve' ? '已批准' : '已驳回',
      action === 'approve' ? `「${title}」已批准,任务已进入执行队列。` : `「${title}」已驳回,该决策卡已从公告板移除。`,
    );
  } catch (e) {
    return decisionHtml(res, 500, '决策执行失败', String(e && e.message || e).slice(0, 200));
  }
}

function handleBulletin(req, res, match) {
  const id = match[1] ? safeBulletinId(match[1]) : null;
  const action = match[2] || null;
  if (match[1] && !id) return json(res, 400, { ok:false, error:'坏公告卡 id' });

  if (req.method === 'GET' && !id && !action) {
    return json(res, 200, { ok:true, cards: readBulletinCards() });
  }
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'method not allowed' });

  readJson(req, res, body => {
    try {
      const cards = readBulletinCards();
      if (!id && !action) {
        const card = normalizeBulletinCard(body);
        if (cards.some(c => c.id === card.id)) return json(res, 409, { ok:false, error:'公告卡 id 已存在' });
        cards.unshift(card);
        writeBulletinCards(cards);
        engineLog().emit('bulletin.added', { bulletinId: card.id, target: card.target, title: card.title, source: card.source || null });
        return json(res, 200, { ok:true, card });
      }
      if (!id || !action) return json(res, 400, { ok:false, error:'坏公告板路径' });
      const idx = cards.findIndex(c => c.id === id);
      if (idx < 0) return json(res, 404, { ok:false, error:'公告卡不存在' });

      if (action === 'remove') {
        const card = removeBulletinCardAt(cards, idx);
        return json(res, 200, { ok:true, card });
      }
      if (action !== 'enable') return json(res, 404, { ok:false, error:'未知公告板操作' });

      const r = enableBulletinCardAt(cards, idx);
      return json(res, r.code, r.body);
    } catch (e) {
      return json(res, 500, { ok:false, error:e.message });
    }
  });
}

function handleQueue(req, res, match) {
  const agent = safeAgent(match[1]);
  const id = match[2] ? safeQueueId(match[2]) : null;
  const action = match[3] || null;
  if (!agent) return json(res, 400, { ok:false, error:'坏 agent' });

  if (req.method === 'GET' && !id && !action) {
    try { return json(res, 200, Object.assign({ ok:true }, Q.list(QUEUE_ROOT, agent))); }
    catch (e) { return json(res, 500, { ok:false, error:e.message }); }
  }
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'method not allowed' });

  readJson(req, res, body => {
    try {
      if (isSecretaryQueueWrite(body)) {
        return rejectSecretaryQueueWrite(res);
      }
      if (!id && !action) {
        const task = body.task != null ? body.task : (body.goal != null ? body.goal : body.message);
        if (task == null || (typeof task === 'string' && !task.trim())) return json(res, 400, { ok:false, error:'空任务' });
        const customId = body.id != null ? safeQueueId(body.id) : undefined;
        if (body.id != null && !customId) return json(res, 400, { ok:false, error:'坏队列 id' });
        const priority = safePriority(body.priority);
        if (priority === null) return json(res, 400, { ok:false, error:'priority 必须是 0-99 的整数' });
        let prepared;
        try { prepared = prepareTaskForEnqueue(task, body); }
        catch (e) { return json(res, 400, { ok:false, error:e.message }); }
        const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, agent, prepared.task, {
          priority,
          idem: body.idem,
          id: customId,
          eventlog: engineLog(),
          source: 'api-queue',
        });
        engineLog().emit('queue.enqueued', { queueAgent: agent, queueId: entry.id, priority: entry.priority, goal: queueTaskText(entry.task), attachments: prepared.attachments.length || undefined });
        ensureQueueWorker(agent);
        return json(res, 200, { ok:true, entry });
      }
      if (!id || !action) return json(res, 400, { ok:false, error:'坏队列路径' });

      let result = null;
      if (action === 'jump') {
        result = setQueuePriorityLocal(agent, id, 0, queueControlMeta(body, 'jump', 'console-server:queue-api'));
        if (result.ok) engineLog().emit('queue.jumped', { queueAgent: agent, queueId: id, actor: 'ceo' });
      } else if (action === 'reorder') {
        const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : body.ids;
        if (!Array.isArray(orderedIds)) return json(res, 400, { ok:false, error:'orderedIds 必须是数组' });
        const priority = body.priority == null ? undefined : safePriority(body.priority);
        if (body.priority != null && priority === null) return json(res, 400, { ok:false, error:'priority 必须是 0-99 的整数' });
        result = Q.reorder(QUEUE_ROOT, agent, orderedIds.map(String), { normalizePriority: true, priority });
        engineLog().emit('queue.reordered', { queueAgent: agent, queueId: id, orderedIds: orderedIds.map(String) });
      } else if (action === 'priority' || action === 'setPriority' || action === 'set-priority') {
        const priority = safePriority(body.priority);
        if (priority === null) return json(res, 400, { ok:false, error:'priority 必须是 0-99 的整数' });
        result = setQueuePriorityLocal(agent, id, priority, queueControlMeta(body, 'priority', 'console-server:queue-api'));
        if (result.ok) engineLog().emit('queue.priority_set', { queueAgent: agent, queueId: id, priority, actor: 'ceo' });
      } else if (action === 'steer') {
        const msg = String(body.msg || body.message || body.steer || '').trim();
        if (!msg) return json(res, 400, { ok:false, error:'空引导' });
        result = Q.steer(QUEUE_ROOT, agent, id, msg);
        if (result) engineLog().emit('queue.steered', { queueAgent: agent, queueId: id, msg: msg.slice(0, 500) });
      } else if (action === 'pause') {
        result = Q.pause(QUEUE_ROOT, agent, id);
        if (result) engineLog().emit('queue.paused', { queueAgent: agent, queueId: id });
      } else if (action === 'resume') {
        result = Q.resume(QUEUE_ROOT, agent, id);
        if (result) {
          engineLog().emit('queue.resumed', { queueAgent: agent, queueId: id });
          ensureQueueWorker(agent);
        }
      } else if (action === 'cancel') {
        result = cancelQueueItemLocal(agent, id, { reason: body.reason || '', actor: 'ceo', requestedBy: queueWriteSource(body) || null, source: 'console-server:queue-api:cancel' });
        if (result.ok) engineLog().emit('queue.canceled', { queueAgent: agent, queueId: id, actor: 'ceo' });
      }
      if (!result || result.ok === false) return json(res, 404, Object.assign({ ok:false, error:'队列项不存在或不可操作' }, result || {}));
      return json(res, 200, { ok:true, result });
    } catch (e) {
      return json(res, 500, { ok:false, error:e.message });
    }
  });
}

function readAllEngineEvents(limit = TASK_BOARD_EVENT_LIMIT) {
  const n = Math.max(1, Math.min(Number(limit || TASK_BOARD_EVENT_LIMIT) || TASK_BOARD_EVENT_LIMIT, TASK_BOARD_EVENT_LIMIT));
  return readJsonlTail(ENGINE_EVENTS, n, Math.min(3 * 1024 * 1024, Math.max(512 * 1024, n * 1800)));
}

// [B-1 去同步阻塞] task-board 事件行过滤:大输出流事件不进任务板(与旧实现一致)
function taskBoardAcceptLine(line) {
  return !(line.includes('"type":"node.output"') || line.includes('"stream":"stdout"') || line.includes('"stream":"stderr"'));
}

// [B-1 去同步阻塞] 旧实现:每次 /api/task-board 请求同步读 768KB 尾部并 JSON.parse
// 最多 1200 条事件,单次可阻塞事件循环上百 ms,叠加即触发 /api/health 超时。
// 现改为 byte-offset 增量游标(先例:readEngineEventsFromWakeOffset):
// 常态请求只 stat + 读新增字节;全量重建仅发生在首次/文件轮转/增量过大时。
// 返回 JSON 形状与旧版一致。TASK_BOARD_EVENTS_INCREMENTAL=0 回退旧路径。
const taskBoardEventCursor = AsyncUnblock.createJsonlTailCursor({
  file: ENGINE_EVENTS,
  maxItems: TASK_BOARD_EVENT_LIMIT,
  tailBytes: 768 * 1024,
  maxIncrementBytes: 4 * 1024 * 1024,
  acceptLine: taskBoardAcceptLine,
});

function readTaskBoardEventsFull(limit = TASK_BOARD_EVENT_LIMIT) {
  const maxItems = Math.max(100, Math.min(Number(limit || TASK_BOARD_EVENT_LIMIT) || TASK_BOARD_EVENT_LIMIT, TASK_BOARD_EVENT_LIMIT));
  try {
    const st = fs.statSync(ENGINE_EVENTS);
    if (!st.size) return [];
    const bytes = Math.min(st.size, 768 * 1024);
    const start = st.size - bytes;
    const text = readFileRangeUtf8(ENGINE_EVENTS, start, bytes);
    const lines = text.split(/\r?\n/);
    if (start > 0) lines.shift();
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < maxItems; i--) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (!taskBoardAcceptLine(line)) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      out.push(ev);
    }
    return out.reverse();
  } catch (_) {
    return [];
  }
}

function readTaskBoardEvents(limit = TASK_BOARD_EVENT_LIMIT) {
  const maxItems = Math.max(100, Math.min(Number(limit || TASK_BOARD_EVENT_LIMIT) || TASK_BOARD_EVENT_LIMIT, TASK_BOARD_EVENT_LIMIT));
  if (!TASK_BOARD_EVENTS_INCREMENTAL) return readTaskBoardEventsFull(maxItems);
  return taskBoardEventCursor.read(maxItems);
}

function queueKey(agent, id) {
  return `${agent || ''}:${id || ''}`;
}

function rootKey(root) {
  return root && (root.queueId ? queueKey(root.queueAgent || 'ceo', root.queueId) : `task:${root.taskId || ''}`);
}

function queueEntryFile(agent, id) {
  if (!agent || !id) return null;
  const dir = Q.qdir(QUEUE_ROOT, agent);
  for (const file of fs.readdirSync(dir).filter(f => /\.json$/.test(f)).sort()) {
    if (file.endsWith(`-${id}.json`)) return path.join(dir, file);
  }
  for (const sub of ['running', 'paused', 'done', 'failed', 'canceled']) {
    const file = path.join(dir, sub, `${id}.json`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function readQueueEntry(agent, id) {
  const file = queueEntryFile(agent, id);
  return file ? readJsonFile(file) : null;
}

function writeJsonFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function queueEntryFiles(agent, id) {
  const dir = Q.qdir(QUEUE_ROOT, agent);
  const files = {};
  try {
    const queued = fs.readdirSync(dir).filter(f => /\.json$/.test(f) && f.endsWith(`-${id}.json`)).sort()[0];
    if (queued) files.queued = path.join(dir, queued);
  } catch (_) {}
  for (const sub of ['running', 'paused', 'done', 'failed', 'canceled']) {
    const file = path.join(dir, sub, `${id}.json`);
    if (fs.existsSync(file)) files[sub] = file;
  }
  return files;
}

function readFirstQueueEntryFile(files, order) {
  for (const state of order) {
    const file = files[state];
    if (file) {
      const entry = readJsonFile(file);
      if (entry) return { state, file, entry };
    }
  }
  return null;
}

function unlinkIfExists(file) {
  if (!file) return false;
  try { fs.unlinkSync(file); return true; }
  catch (_) { return false; }
}

function cancelQueueItemLocal(agent, id, opts = {}) {
  const files = queueEntryFiles(agent, id);
  const actionable = readFirstQueueEntryFile(files, ['queued', 'paused']);
  if (actionable) {
    const stamp = nowIso();
    const entry = Object.assign({}, actionable.entry, {
      id,
      target: agent,
      status: 'canceled',
      canceled_at: stamp,
      cancel_reason: opts.reason || actionable.entry.cancel_reason || null,
      canceled_by: opts.actor || opts.source || 'ceo',
    });
    attachQueueControl(entry, {
      action: 'cancel',
      actor: opts.actor || 'ceo',
      requestedBy: opts.requestedBy || null,
      reason: opts.reason || null,
      source: opts.source || 'ceo-queue-control',
    });
    entry.queue_cancel = {
      canceled_at: stamp,
      canceled_by: opts.actor || opts.source || 'ceo',
      requested_by: opts.requestedBy || null,
      reason: opts.reason || null,
    };
    const canceledFile = path.join(Q.qdir(QUEUE_ROOT, agent), 'canceled', `${id}.json`);
    writeJsonFileAtomic(canceledFile, entry);
    unlinkIfExists(actionable.file);
    return {
      ok: true,
      id,
      status: 'canceled',
      action: 'canceled',
      result: entry,
    };
  }

  if (files.running) {
    return { ok: false, id, action: 'running_read_only', status: 'running', error: 'running 队列项只读,不取消' };
  }

  const terminal = readFirstQueueEntryFile(files, ['canceled', 'done', 'failed']);
  if (!terminal) return { ok: false, id, action: 'not_found', error: '队列项不存在或不可操作' };
  if (!opts.forceTerminal && terminal.state !== 'canceled') {
    return { ok: false, id, action: 'terminal_exists', status: terminal.state, error: `队列项已是终态:${terminal.state}` };
  }

  const entry = Object.assign({}, terminal.entry, {
    id,
    target: agent,
    status: 'canceled',
    canceled_at: terminal.entry.canceled_at || nowIso(),
    cancel_reason: opts.reason || terminal.entry.cancel_reason || null,
    canceled_by: opts.actor || opts.source || 'ceo',
  });
  attachQueueControl(entry, {
    action: 'cancel',
    actor: opts.actor || 'ceo',
    requestedBy: opts.requestedBy || null,
    reason: opts.reason || null,
    source: opts.source || 'ceo-queue-control',
  });
  entry.queue_cancel = {
    canceled_at: entry.canceled_at,
    canceled_by: opts.actor || opts.source || 'ceo',
    requested_by: opts.requestedBy || null,
    reason: opts.reason || null,
  };
  const canceledFile = path.join(Q.qdir(QUEUE_ROOT, agent), 'canceled', `${id}.json`);
  writeJsonFileAtomic(canceledFile, entry);
  const removed = [];
  for (const state of ['queued', 'paused', 'done', 'failed']) {
    if (files[state] && unlinkIfExists(files[state])) removed.push(state);
  }
  return {
    ok: true,
    id,
    status: 'canceled',
    action: terminal.state === 'canceled' ? 'already_canceled' : 'terminal_canceled',
    removed,
    result: entry,
  };
}

function preserveQueueItemLocal(agent, id) {
  const files = queueEntryFiles(agent, id);
  const kept = readFirstQueueEntryFile(files, ['queued', 'running', 'paused', 'done', 'failed']);
  if (!kept) {
    return {
      ok: false,
      id,
      action: files.canceled ? 'only_canceled' : 'not_found',
      error: files.canceled ? '保留项只存在 canceled 记录' : '保留项不存在',
    };
  }
  const removedCanceledDuplicate = files.canceled ? unlinkIfExists(files.canceled) : false;
  return {
    ok: true,
    id,
    action: 'preserved',
    status: kept.state,
    removedCanceledDuplicate,
  };
}

function parseQueueIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return raw.map(v => safeQueueId(String(v || '').trim())).filter(Boolean);
}

function queueWriteSource(body) {
  if (!body) return '';
  return [body.source, body.requestedBy, body.requested_by, body.actor]
    .filter(v => v != null && v !== '')
    .map(v => String(v))
    .join(' ')
    .trim();
}

function isSecretaryQueueWrite(body) {
  return /(^|[^a-z0-9])secretary([^a-z0-9]|$)|秘书/i.test(queueWriteSource(body));
}

function rejectSecretaryQueueWrite(res) {
  return json(res, 403, {
    ok: false,
    code: 'secretary_direct_queue_write_rejected',
    error: '秘书不直接改队列; 请走 /api/ceo/queue-control 传给 CEO 执行',
  });
}

function queueControlMeta(body, action, source) {
  return {
    action,
    actor: 'ceo',
    requestedBy: String(body && (body.requestedBy || body.requested_by || body.source || '') || '').trim() || null,
    reason: String(body && body.reason || '').slice(0, 500) || null,
    source: source || 'ceo-queue-control',
  };
}

function attachQueueControl(entry, meta, extra = {}) {
  if (!entry || !meta) return entry;
  const at = nowIso();
  const record = Object.assign({
    at,
    action: meta.action,
    actor: meta.actor || 'ceo',
    requested_by: meta.requestedBy || null,
    reason: meta.reason || null,
    source: meta.source || 'ceo-queue-control',
  }, extra);
  entry.queue_control = record;
  const history = Array.isArray(entry.queue_control_history) ? entry.queue_control_history : [];
  entry.queue_control_history = history.concat([record]).slice(-20);
  return entry;
}

function setQueuePriorityLocal(agent, id, priority, meta) {
  const files = queueEntryFiles(agent, id);
  if (files.running) {
    return { ok: false, id, action: 'running_read_only', status: 'running', error: 'running 队列项只读,不改优先级' };
  }
  if (files.queued) {
    const result = Q.setPriority(QUEUE_ROOT, agent, id, priority);
    if (!result) return { ok: false, id, action: 'not_found', error: '队列项不存在或不可操作' };
    attachQueueControl(result, meta, { priority });
    result.queue_priority = {
      priority,
      set_at: result.queue_control.at,
      set_by: 'ceo',
      requested_by: meta && meta.requestedBy || null,
      reason: meta && meta.reason || null,
    };
    const updated = queueEntryFiles(agent, id).queued;
    if (updated) writeJsonFileAtomic(updated, result);
    return { ok: true, id, action: 'priority_set', status: 'queued', priority, result };
  }
  if (files.paused) {
    const entry = readJsonFile(files.paused);
    if (!entry) return { ok: false, id, action: 'not_found', error: '队列项不存在或不可操作' };
    entry.priority = priority;
    entry.priority_updated_at = nowIso();
    attachQueueControl(entry, meta, { priority });
    entry.queue_priority = {
      priority,
      set_at: entry.queue_control.at,
      set_by: 'ceo',
      requested_by: meta && meta.requestedBy || null,
      reason: meta && meta.reason || null,
    };
    writeJsonFileAtomic(files.paused, entry);
    return { ok: true, id, action: 'priority_set', status: 'paused', priority, result: entry };
  }
  const terminal = readFirstQueueEntryFile(files, ['canceled', 'done', 'failed']);
  if (terminal) {
    return { ok: false, id, action: 'terminal_exists', status: terminal.state, error: `队列项已是终态:${terminal.state}` };
  }
  return { ok: false, id, action: 'not_found', error: '队列项不存在或不可操作' };
}

function handleQueueBatch(req, res, match) {
  const agent = safeAgent(match[1]);
  const action = match[2];
  if (!agent) return json(res, 400, { ok:false, error:'坏 agent' });
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'method not allowed' });

  readJson(req, res, body => {
    try {
      if (isSecretaryQueueWrite(body)) {
        return rejectSecretaryQueueWrite(res);
      }
      if (action === 'batch-cancel') {
        const ids = [...new Set(parseQueueIds(body.ids || body.cancelIds || body.id))];
        if (!ids.length) return json(res, 400, { ok:false, error:'ids 必须是非空数组或逗号分隔字符串' });
        const forceTerminal = body.forceTerminal === true || body.force === true;
        const reason = String(body.reason || '').slice(0, 500);
        const meta = queueControlMeta(body, 'batch-cancel', 'console-server:batch-cancel');
        const results = ids.map(id => cancelQueueItemLocal(agent, id, { forceTerminal, reason, actor: 'ceo', requestedBy: meta.requestedBy, source: 'console-server:batch-cancel' }));
        const canceling = results.filter(r => r.status === 'canceling').map(r => r.id);
        if (canceling.length) ensureQueueWorker(agent);
        engineLog().emit('queue.batch_canceled', { queueAgent: agent, queueIds: ids, forceTerminal, ok: results.every(r => r.ok), actor: 'ceo', requestedBy: meta.requestedBy, source: body.source || null });
        return json(res, 200, { ok: results.every(r => r.ok), results });
      }

      if (action === 'merge') {
        const keepId = safeQueueId(body.keepId || body.keep || body.targetId || '');
        const cancelIds = [...new Set(parseQueueIds(body.cancelIds || body.cancel || body.ids))].filter(id => id !== keepId);
        if (!keepId) return json(res, 400, { ok:false, error:'keepId 必须是合法队列 id' });
        if (!cancelIds.length) return json(res, 400, { ok:false, error:'cancelIds 必须是非空数组或逗号分隔字符串' });
        const reason = String(body.reason || `merged into ${keepId}`).slice(0, 500);
        const meta = queueControlMeta(body, 'merge', 'console-server:merge');
        const result = QueueOrganizer.mergeByIds(QUEUE_ROOT, {
          agent,
          keepId,
          cancelIds,
          projectId: body.projectId || body.project || null,
          reason,
          source: 'console-server:merge',
        });
        const ok = result.ok !== false;
        engineLog().emit('queue.merged', { queueAgent: agent, keepId, canceledIds: cancelIds, ok, actor: 'ceo', requestedBy: meta.requestedBy, source: body.source || null, planHash: result.plan_hash || null });
        return json(res, result.status || (ok ? 200 : 409), result);
      }

      if (action === 'organize') {
        const apply = body.apply === true;
        const meta = queueControlMeta(body, 'organize', body.source || 'console-server:organize');
        const result = QueueOrganizer.organize(QUEUE_ROOT, {
          agents: [agent],
          projectId: body.projectId || body.project || null,
          includePaused: body.includePaused !== false,
          mergeIntoActive: body.mergeIntoActive !== false,
          reportTerminal: body.reportTerminal === true,
          allowCrossAgentMerge: body.allowCrossAgentMerge === true,
          allowSimilarityApply: body.allowSimilarityApply === true,
          apply,
          plan: body.plan || body.dryRunPlan || body.expectedPlan || null,
          source: meta.source,
        });
        if (result.ok === false) return json(res, result.status || 409, result);
        engineLog().emit('queue.organized', {
          queueAgent: agent,
          apply,
          projectId: result.projectId || null,
          plannedGroups: result.summary && result.summary.planned_groups || 0,
          plannedCancel: result.summary && result.summary.planned_cancel || 0,
          changed: result.summary && result.summary.changed || 0,
          skipped: result.summary && result.summary.skipped || 0,
          actor: 'ceo',
          requestedBy: meta.requestedBy,
          source: body.source || null,
        });
        return json(res, 200, result);
      }

      return json(res, 404, { ok:false, error:'unknown queue batch action' });
    } catch (e) {
      return json(res, 500, { ok:false, error:e.message });
    }
  });
}

function normalizeQueueControlAction(action) {
  const value = String(action || '').trim();
  if (value === 'setPriority' || value === 'set-priority') return 'priority';
  if (value === 'cancel-many' || value === 'batchCancel') return 'batch-cancel';
  return value;
}

function applyCeoQueueControl(body) {
  const action = normalizeQueueControlAction(body && body.action);
  const agent = safeAgent(body && body.agent || 'ceo');
  if (!action) return { status: 400, body: { ok:false, error:'action 必填' } };
  if (!agent) return { status: 400, body: { ok:false, error:'坏 agent' } };
  const meta = queueControlMeta(body, action, 'ceo-queue-control');

  if (action === 'enqueue') {
    const task = body.task != null ? body.task : (body.goal != null ? body.goal : body.message);
    if (task == null || (typeof task === 'string' && !task.trim())) return { status: 400, body: { ok:false, error:'空任务' } };
    const customId = body.id != null ? safeQueueId(body.id) : undefined;
    if (body.id != null && !customId) return { status: 400, body: { ok:false, error:'坏队列 id' } };
    const priority = safePriority(body.priority);
    if (priority === null) return { status: 400, body: { ok:false, error:'priority 必须是 0-99 的整数' } };
    let prepared;
    try { prepared = prepareTaskForEnqueue(task, body); }
    catch (e) { return { status: 400, body: { ok:false, error:e.message } }; }
    const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, agent, prepared.task, {
      priority,
      idem: body.idem,
      id: customId,
      eventlog: engineLog(),
      source: 'ceo-queue-control',
    });
    attachQueueControl(entry, meta, { priority });
    const file = queueEntryFiles(agent, entry.id).queued;
    if (file) writeJsonFileAtomic(file, entry);
    engineLog().emit('queue.enqueued', { queueAgent: agent, queueId: entry.id, priority: entry.priority, goal: queueTaskText(entry.task), actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source });
    ensureQueueWorker(agent);
    return { status: 200, body: { ok:true, entry } };
  }

  if (action === 'organize') {
    const apply = body.apply === true;
    const result = QueueOrganizer.organize(QUEUE_ROOT, {
      agents: [agent],
      projectId: body.projectId || body.project || null,
      includePaused: body.includePaused !== false,
      mergeIntoActive: body.mergeIntoActive !== false,
      reportTerminal: body.reportTerminal === true,
      allowCrossAgentMerge: body.allowCrossAgentMerge === true,
      allowSimilarityApply: body.allowSimilarityApply === true,
      apply,
      plan: body.plan || body.dryRunPlan || body.expectedPlan || null,
      source: 'ceo-queue-control',
    });
    if (result.ok === false) return { status: result.status || 409, body: result };
    engineLog().emit('queue.organized', {
      queueAgent: agent,
      apply,
      projectId: result.projectId || null,
      plannedGroups: result.summary && result.summary.planned_groups || 0,
      plannedCancel: result.summary && result.summary.planned_cancel || 0,
      changed: result.summary && result.summary.changed || 0,
      skipped: result.summary && result.summary.skipped || 0,
      actor: 'ceo',
      requestedBy: meta.requestedBy,
      source: meta.source,
    });
    return { status: 200, body: Object.assign({ actor:'ceo', requestedBy: meta.requestedBy }, result) };
  }

  if (action === 'merge') {
    const keepId = safeQueueId(body.keepId || body.keep || body.targetId || '');
    const cancelIds = [...new Set(parseQueueIds(body.cancelIds || body.cancel || body.ids))].filter(id => id !== keepId);
    if (!keepId) return { status: 400, body: { ok:false, error:'keepId 必须是合法队列 id' } };
    if (!cancelIds.length) return { status: 400, body: { ok:false, error:'cancelIds 必须是非空数组或逗号分隔字符串' } };
    const reason = String(body.reason || `merged into ${keepId}`).slice(0, 500);
    const result = QueueOrganizer.mergeByIds(QUEUE_ROOT, {
      agent,
      keepId,
      cancelIds,
      projectId: body.projectId || body.project || null,
      reason,
      source: 'ceo-queue-control:merge',
    });
    const ok = result.ok !== false;
    engineLog().emit('queue.merged', { queueAgent: agent, keepId, canceledIds: cancelIds, ok, actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source, planHash: result.plan_hash || null });
    return { status: result.status || (ok ? 200 : 409), body: Object.assign({ actor:'ceo', requestedBy: meta.requestedBy }, result) };
  }

  if (action === 'batch-cancel') {
    const ids = [...new Set(parseQueueIds(body.ids || body.cancelIds || body.id))];
    if (!ids.length) return { status: 400, body: { ok:false, error:'ids 必须是非空数组或逗号分隔字符串' } };
    const reason = String(body.reason || '').slice(0, 500);
    const results = ids.map(id => cancelQueueItemLocal(agent, id, { forceTerminal: body.forceTerminal === true || body.force === true, reason, actor: 'ceo', requestedBy: meta.requestedBy, source: 'ceo-queue-control:batch-cancel' }));
    const ok = results.every(r => r.ok);
    engineLog().emit('queue.batch_canceled', { queueAgent: agent, queueIds: ids, ok, actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source });
    return { status: ok ? 200 : 409, body: { ok, results, actor:'ceo', requestedBy: meta.requestedBy } };
  }

  const id = safeQueueId(body.id || body.queueId || '');
  if (!id) return { status: 400, body: { ok:false, error:'id 必须是合法队列 id' } };

  if (action === 'jump') {
    const result = setQueuePriorityLocal(agent, id, 0, meta);
    if (result.ok) engineLog().emit('queue.jumped', { queueAgent: agent, queueId: id, actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source });
    return { status: result.ok ? 200 : 409, body: result };
  }

  if (action === 'priority') {
    const priority = safePriority(body.priority);
    if (priority === null) return { status: 400, body: { ok:false, error:'priority 必须是 0-99 的整数' } };
    const result = setQueuePriorityLocal(agent, id, priority, meta);
    if (result.ok) engineLog().emit('queue.priority_set', { queueAgent: agent, queueId: id, priority, actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source });
    return { status: result.ok ? 200 : 409, body: result };
  }

  if (action === 'cancel') {
    const result = cancelQueueItemLocal(agent, id, { reason: meta.reason, actor: 'ceo', requestedBy: meta.requestedBy, source: 'ceo-queue-control:cancel' });
    if (result.ok) engineLog().emit('queue.canceled', { queueAgent: agent, queueId: id, actor: 'ceo', requestedBy: meta.requestedBy, source: meta.source });
    return { status: result.ok ? 200 : 409, body: result };
  }

  return { status: 400, body: { ok:false, error:`unsupported CEO queue action: ${action}` } };
}

function handleCeoQueueControl(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'method not allowed' });
  readJson(req, res, body => {
    try {
      const out = applyCeoQueueControl(body || {});
      return json(res, out.status, out.body);
    } catch (e) {
      return json(res, 500, { ok:false, error:e.message });
    }
  });
}

function readEngineTaskState(taskId) {
  if (!taskId) return null;
  return readJsonFile(path.join(ENGINE_TASKS, `${taskId}.json`));
}

function eventTime(ev) {
  const t = Date.parse(ev && ev.ts || '');
  return Number.isFinite(t) ? t : 0;
}

function queueEntryTime(entry) {
  const raw = entry && (entry.started_at || entry.enqueued_at || entry.paused_at || entry.updated_at || entry.finished_at);
  const t = Date.parse(raw || '');
  return Number.isFinite(t) ? t : 0;
}

function queueRunningStartedAt(entry) {
  if (!entry) return '';
  for (const raw of [entry.engine_started_at, entry.started_at, entry.claimed_at]) {
    const t = Date.parse(raw || '');
    if (Number.isFinite(t)) return raw;
  }
  return '';
}

function taskBoardRoleLabel(role, node) {
  const n = String(node || '');
  const r = String(role || '');
  if (n === 'orchestrator-plan') return 'CEO规划';
  if (n === 'review') return '复审';
  if (r === 'orchestrator' || r === 'ceo') return 'CEO';
  if (r === 'supervisor' || /^supervisor-/.test(r)) return '主管';
  if (r === 'worker_code' || /^worker_code-/.test(r)) return '后端程序员';
  if (r === 'worker_narrow' || /^worker_narrow-/.test(r)) return '外包';
  if (/^board_/.test(r)) return '董事';
  if (r === 'repair-lead') return '维修主管';
  if (r === 'repair') return '维修员';
  if (r === 'gui_desktop_control') return '桌面控制';
  if (r === 'hr_manager') return 'HR主管';
  if (r === 'hr_specialist') return 'HR专员';
  if (r === 'quality_ops') return '质量';
  if (r === 'governance') return '复盘';
  return r || n || '节点';
}

function isBoardRole(role, node) {
  return /^board_/.test(String(role || '')) || /^board-board_/.test(String(node || ''));
}

function isBoardRunnerAbsenceEvent(ev) {
  if (!ev) return false;
  if (ev.type === 'node.absent') return isBoardRole(ev.role, ev.node);
  if (ev.type !== 'node.fail' || !isBoardRole(ev.role, ev.node)) return false;
  const reason = String(ev.reason || '');
  return /runner|调用失败|退出码|authentication|auth|No available channel|访问量过大|timeout|timed? out|HTTP\s*\d+/i.test(reason);
}

function nodeRoleFromName(node) {
  const n = String(node || '');
  if (n === 'orchestrator-plan' || n === 'orchestrator') return 'orchestrator';
  if (n === 'implement') return 'worker_code';
  if (n === 'review') return 'supervisor';
  if (n === 'execute') return 'worker_code';
  return n || 'worker_code';
}

function taskBoardStatusLabel(status) {
  return {
    done: '✅完成',
    running: '🔵运行中',
    absent: '⚪缺席',
    rework: '↩打回',
    waiting: '⏳等上游',
    paused: '⏸暂停',
    pending: '⚪待开始',
    fail: '❌失败',
  }[status] || '⚪待开始';
}

function compactGoal(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function taskBoardShort(text, max = 72) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function taskBoardOutputText(text, max = 160) {
  const s = String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:NEW_API_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(Math.max(0, s.length - max + 1))}` : s;
}

function taskBoardOutputProgress(ev) {
  const raw = String(ev && (ev.text || ev.output || ev.delta) || '');
  const actor = taskBoardActor(ev);
  const scriptLike = ev && ev.stream === 'stderr'
    || /(exec_command|apply_patch|tool|command|script|bash|zsh|node|python|npm|rg|sed|cat|脚本|命令)/i.test(raw);
  return {
    text: scriptLike ? `${actor}跑脚本中` : `${actor}处理中`,
    state: 'run',
    kind: scriptLike ? 'script' : 'work',
  };
}

function taskBoardNodeWork(goal, ev) {
  let text = String(goal || '');
  const exampleAt = text.search(/例如|比如|示例/);
  if (exampleAt > 0) text = text.slice(0, exampleAt);
  const node = String(ev && ev.node || '');
  if (/(任务板修复|无法展开|拖拽|换位|输入时长|运行时长|双计时|reorder|setPriority)/i.test(text)) return '改任务板展开/排序/计时';
  if (/(workspace\.html|webUI|工作区|进行中|最新进展|进展显示)/i.test(text)) return '改工作区进展显示';
  if (/proper[-_\s]?pixel|清洗/i.test(text)) return 'proper-pixel-art 清洗';
  if (/(meowa|生图|生成)/i.test(text) && /(地块|tile|办公室|office)/i.test(text)) return '调 meowa 生成地块';
  if (/(飞书|notify|通知)/i.test(text)) return '飞书通知能力处理';
  if (/(Peekaboo|截图|截屏|视觉)/i.test(text)) return 'Peekaboo 截图验证';
  if (/(status\.md|status-rollup|状态)/i.test(text)) return '更新状态';
  if (node === 'review') return '复审';
  if (node === 'orchestrator-plan') return '规划派单';
  if (node === 'implement') return 'implement';
  return node || '处理';
}

function taskBoardActor(ev) {
  if (!ev) return '系统';
  // Resolve the *actor* role (who is doing the work), not the node's action
  // label — taskBoardRoleLabel maps review→复审 / orchestrator-plan→CEO规划 for
  // node-chain chips, but as an actor that double-prints (e.g. 复审复审中). Drop
  // the node so review→主管 / orchestrator-plan→CEO and the verb is added once.
  if (ev.queueAgent && !ev.role) return taskBoardRoleLabel(ev.queueAgent, '');
  return taskBoardRoleLabel(ev.role || nodeRoleFromName(ev.node), '');
}

function taskBoardNodePhrase(ev, goal, suffix) {
  const actor = taskBoardActor(ev);
  const work = taskBoardNodeWork(goal, ev);
  if (ev.node === 'review') return `${actor}复审${suffix}`;
  if (ev.node === 'orchestrator-plan') return `${actor}规划派单${suffix}`;
  if (work === 'implement') return `${actor} implement ${suffix}`;
  if (/^[A-Za-z0-9_-]/.test(work)) return `${actor} ${work}${suffix}`;
  return `${actor}${work}${suffix}`;
}

function taskBoardProgressForEvent(ev, goal) {
  const type = String(ev && ev.type || '');
  if (!type) return null;
  if (type === 'secretary.important_architecture') return { text: '秘书识别为重要架构,接入董事会', state: 'run' };
  if (type === 'board.review.required') return { text: `重要架构任务接入董事会${ev.labels && ev.labels.length ? ` · ${ev.labels.join('/')}` : ''}`, state: 'run' };
  if (type === 'board.review.round.start') return { text: `董事会评议中(第 ${ev.round || 1}/${ev.maxRounds || 1} 轮)`, state: 'run' };
  if (type === 'board.review.round.end') return { text: `董事会第 ${ev.round || 1} 轮完成 · ${ev.issueCount || 0} 条挑刺`, state: ev.continue ? 'run' : 'done' };
  if (type === 'board.review.approved') return { text: `董事会评议通过,默认执行 · ${ev.rounds || 1}/${ev.maxRounds || 1} 轮`, state: 'done' };
  if (type === 'board.review.await_owner') return { text: `董事会需主人拍板 · ${ev.bulletinId || ev.decisionId || ''}`, state: 'wait' };
  if (type === 'node.output') {
    if (!String(ev.text || ev.output || ev.delta || '').trim()) return null;
    return taskBoardOutputProgress(ev);
  }
  if (type === 'node.start') return { text: taskBoardNodePhrase(ev, goal, '中'), state: 'run' };
  if (type === 'node.end') return { text: taskBoardNodePhrase(ev, goal, '完成'), state: 'done' };
  if (type === 'node.absent' || isBoardRunnerAbsenceEvent(ev)) return { text: `${taskBoardActor(ev)}缺席${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'absent' };
  if (type === 'node.fail') return { text: `${taskBoardNodePhrase(ev, goal, '失败')}${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'fail' };
  if (type === 'node.await_human') return { text: `${taskBoardActor(ev)}等待主人确认`, state: 'wait' };
  if (type === 'node.human') return { text: `${taskBoardActor(ev)}已收到人工确认`, state: 'done' };
  if (type === 'peekaboo.soft_skip') return { text: `Peekaboo 截图待补${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'wait' };
  if (type === 'project.route.paused') return { text: `路由软暂停${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'wait' };
  if (type === 'project.route.waiting.restored') {
    const role = taskBoardRoleLabel(ev.queueAgent || 'supervisor', '');
    const queue = ev.queueId ? ` #${String(ev.queueId).slice(-8)}` : '';
    return { text: `已恢复等待下游 ${role}${queue}`, state: 'run' };
  }
  if (type === 'secretary.route.paused') return { text: `秘书转交软暂停${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'wait' };
  if (type === 'queue.paused') return { text: `队列暂停等待${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'wait' };
  if (type === 'queue.recovered') return { text: `队列已恢复${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'run' };
  if (type === 'edge.take') {
    const to = taskBoardRoleLabel(nodeRoleFromName(ev.to), ev.to);
    return { text: `流转到${to}${ev.to ? ` · ${ev.to}` : ''}`, state: 'run' };
  }
  if (type === 'project.brief.written') return { text: `CEO 写项目 brief · ${ev.projectId || '控制台'}`, state: 'run' };
  if (type === 'project.routed') return { text: `CEO 派给主管 · ${ev.supervisorQueue || ev.queueAgent || ''}${ev.queueId ? ` #${String(ev.queueId).slice(-8)}` : ''}`, state: 'run' };
  if (type === 'task.queued') return { text: `${taskBoardActor(ev)} ${ev.flow || 'review-loop'} 已入队`, state: 'run' };
  if (type === 'task.created') return { text: `${taskBoardActor(ev)}准备执行 · ${ev.start || ev.flow || ''}`, state: 'run' };
  if (type === 'engine.worker.start') return { text: `${taskBoardActor(ev)}启动引擎`, state: 'run' };
  if (type === 'queue.claimed') return { text: `${taskBoardActor(ev)}开始处理队列 #${String(ev.queueId || '').slice(-8)}`, state: 'run' };
  if (type === 'notify.sent') return { text: `飞书通知已发${ev.title ? ` · ${taskBoardShort(ev.title, 42)}` : ''}`, state: 'done' };
  if (type === 'task.needs_evidence') return { text: '等待验收证据', state: 'wait' };
  if (type === 'task.done') return { text: '任务已完成', state: 'done' };
  if (type === 'task.failed' || type === 'task.timeout' || type === 'engine.worker.crash') return { text: `${type === 'task.timeout' ? '任务超时' : '任务失败'}${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'fail' };
  if (type === 'engine.worker.end' && ev.paused) return { text: `引擎软暂停${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: 'wait' };
  if (type === 'engine.worker.end' && (ev.waitingDownstream || ev.state === 'waiting_downstream')) return { text: '等待下游任务完成', state: 'run' };
  if (type === 'engine.worker.end') return { text: ev.ok ? '引擎完成' : `引擎失败${ev.reason ? ` · ${taskBoardShort(ev.reason, 54)}` : ''}`, state: ev.ok ? 'done' : 'fail' };
  return null;
}

function taskBoardStepText(nodes, taskId, node) {
  if (!node) return '';
  const list = Array.isArray(nodes) ? nodes : [];
  const i = list.findIndex(n => n && n.node === node && (!taskId || !n.taskId || n.taskId === taskId));
  return i >= 0 ? `第${i + 1}/${list.length}步` : '';
}

function latestTaskBoardProgress(index, rootTaskId, nodes, cardStatus, action, taskText) {
  const taskIds = new Set([rootTaskId, action && action.taskId, ...(nodes || []).map(n => n && n.taskId)].filter(Boolean));
  const childTaskIds = [...taskIds].filter(id => id && id !== rootTaskId);
  let latest = null;
  for (const taskId of taskIds) {
    const goal = index.taskGoal.get(taskId) || taskText || '';
    for (const ev of index.eventsByTask.get(taskId) || []) {
      if (cardStatus === 'running' && childTaskIds.length && taskId === rootTaskId && /^(task\.done|engine\.worker\.end)$/.test(ev.type || '')) continue;
      const progress = taskBoardProgressForEvent(ev, goal);
      if (!progress) continue;
      const seq = Number(ev.seq || 0);
      if (latest && seq < latest.seq) continue;
      const stepText = taskBoardStepText(nodes, taskId, ev.node);
      latest = Object.assign({}, progress, {
        seq,
        ts: ev.ts || '',
        taskId,
        node: ev.node || '',
        stepText,
      });
    }
  }
  if (latest) return latest;
  const running = (nodes || []).find(n => n && n.status === 'running') || null;
  if (running) return {
    text: `${taskBoardRoleLabel(running.role, running.node)}${running.node ? ` ${running.node}` : ''} 中`,
    state: 'run',
    taskId: running.taskId || '',
    node: running.node || '',
    stepText: taskBoardStepText(nodes, running.taskId, running.node),
  };
  if (cardStatus === 'queued') return { text: '排队中: 等待 worker 空闲', state: 'wait', stepText: '' };
  return { text: '等待下游任务事件', state: 'wait', stepText: '' };
}

function latestProjectRouteEvent(index, rootTaskId) {
  let latest = null;
  for (const ev of index.eventsByTask.get(rootTaskId) || []) {
    if (!/^(project\.routed|project\.route\.waiting|engine\.worker\.end)$/.test(ev.type || '')) continue;
    if (ev.type === 'engine.worker.end' && !(ev.waitingDownstream || ev.state === 'waiting_downstream')) continue;
    const seq = Number(ev.seq || 0);
    if (!latest || seq >= Number(latest.seq || 0)) latest = ev;
  }
  return latest;
}

function downstreamWaitingInfo(rootEntry, index, rootTaskId, action) {
  const waiting = !!(rootEntry && (rootEntry.waiting_downstream || rootEntry.downstream_waiting_at || rootEntry.downstream_heartbeat_at));
  const ev = rootTaskId ? latestProjectRouteEvent(index, rootTaskId) : null;
  const actionAgent = action && action.agent && action.agent !== 'ceo' ? action.agent : '';
  const inflight = rootEntry && Array.isArray(rootEntry.downstream_inflight) && rootEntry.downstream_inflight[0] || null;
  const agent = inflight && inflight.agent || actionAgent || ev && (ev.supervisorQueue || ev.downstreamQueueAgent || ev.queueAgent) || '';
  const queueId = inflight && inflight.queueId || actionAgent && action && action.id || ev && (ev.downstreamQueueId || ev.queueId) || '';
  if (!waiting && !actionAgent && !(ev && (ev.type === 'project.routed' || ev.type === 'project.route.waiting'))) return null;
  const role = taskBoardRoleLabel(agent || 'supervisor', '');
  const queueText = queueId ? ` #${String(queueId).slice(-8)}` : '';
  const agentText = agent && !String(agent).startsWith(role) ? ` · ${agent}` : '';
  return {
    agent,
    queueId,
    roleLabel: role,
    text: `等待下游 ${role} 完成${agentText}${queueText}`,
  };
}

function waitingDownstreamProgress(info, progress) {
  if (!info) return progress;
  const p = progress || {};
  const text = String(p.text || '');
  const weak = !text || /等待(?:下游任务|节点)事件|等待下游任务完成|CEO 派给主管|引擎完成|已接入任务链/.test(text);
  if (weak) return Object.assign({}, p, { text: info.text, state: 'run' });
  if (text.includes(info.text)) return p;
  return Object.assign({}, p, {
    text: `${info.text} · ${text}`,
    state: p.state === 'fail' ? 'fail' : 'run',
  });
}

function makeRoot(taskId, queueAgent, queueId) {
  if (!taskId && !queueId) return null;
  return {
    taskId: taskId || null,
    queueAgent: queueAgent || 'ceo',
    queueId: queueId || null,
  };
}

function buildTaskBoardIndex(events) {
  const eventsByTask = new Map();
  const taskToQueue = new Map();
  const queueToTask = new Map();
  const taskGoal = new Map();
  const taskFlow = new Map();
  const rootByTask = new Map();
  const queueToRoot = new Map();
  const childrenByRoot = new Map();

  function addEvent(ev) {
    if (!ev.task) return;
    if (!eventsByTask.has(ev.task)) eventsByTask.set(ev.task, []);
    eventsByTask.get(ev.task).push(ev);
  }
  function rememberRoot(taskId, root) {
    if (!taskId || !root) return;
    const cur = rootByTask.get(taskId);
    if (!cur || !cur.queueId && root.queueId) rootByTask.set(taskId, root);
  }
  function rememberChild(root, qkey, taskId) {
    const key = rootKey(root);
    if (!key) return;
    if (!childrenByRoot.has(key)) childrenByRoot.set(key, { queueKeys: new Set(), taskIds: new Set() });
    if (qkey) childrenByRoot.get(key).queueKeys.add(qkey);
    if (taskId) childrenByRoot.get(key).taskIds.add(taskId);
  }
  function rootForTask(taskId) {
    if (!taskId) return null;
    const known = rootByTask.get(taskId);
    if (known) return known;
    const q = taskToQueue.get(taskId);
    if (q && q.agent === 'ceo') return makeRoot(taskId, 'ceo', q.id);
    return makeRoot(taskId, 'ceo', null);
  }
  function rootFromEvent(ev) {
    if (!ev) return null;
    if (ev.rootTaskId || ev.rootQueueId) return makeRoot(ev.rootTaskId || ev.task || null, ev.rootQueueAgent || 'ceo', ev.rootQueueId || null);
    if (ev.sourceTask) return rootForTask(ev.sourceTask);
    if (ev.queueAgent === 'ceo' && ev.queueId && ev.task) return makeRoot(ev.task, 'ceo', ev.queueId);
    return null;
  }

  for (const ev of events) {
    addEvent(ev);
    if (ev.task && ev.goal && !taskGoal.has(ev.task)) taskGoal.set(ev.task, ev.goal);
    if (ev.task && ev.flow && !taskFlow.has(ev.task)) taskFlow.set(ev.task, ev.flow);
    if (ev.type === 'task.queued' && ev.task && ev.queueAgent && ev.queueId) {
      const qkey = queueKey(ev.queueAgent, ev.queueId);
      taskToQueue.set(ev.task, { agent: ev.queueAgent, id: ev.queueId });
      queueToTask.set(qkey, ev.task);
      if (ev.queueAgent === 'ceo') rememberRoot(ev.task, makeRoot(ev.task, 'ceo', ev.queueId));
    }
  }

  for (const ev of events) {
    const root = rootFromEvent(ev);
    if (root && ev.task) rememberRoot(ev.task, root);
    if (root && ev.queueAgent && ev.queueId) {
      const qkey = queueKey(ev.queueAgent, ev.queueId);
      queueToRoot.set(qkey, root);
      if (ev.queueAgent !== 'ceo') rememberChild(root, qkey, queueToTask.get(qkey));
    }
    if (ev.type === 'project.routed' && ev.queueId) {
      const agent = ev.supervisorQueue || ev.queueAgent || 'supervisor';
      const rootForRoute = makeRoot(ev.rootTaskId || ev.task || null, ev.rootQueueAgent || 'ceo', ev.rootQueueId || (taskToQueue.get(ev.task || '') || {}).id || null);
      const qkey = queueKey(agent, ev.queueId);
      queueToRoot.set(qkey, rootForRoute);
      rememberChild(rootForRoute, qkey, queueToTask.get(qkey));
    }
    if (ev.type === 'queue.enqueued' && ev.queueAgent && ev.queueId && (ev.sourceTask || ev.rootTaskId || ev.rootQueueId)) {
      const rootForQueue = rootFromEvent(ev);
      const qkey = queueKey(ev.queueAgent, ev.queueId);
      queueToRoot.set(qkey, rootForQueue);
      if (ev.queueAgent !== 'ceo') rememberChild(rootForQueue, qkey, queueToTask.get(qkey));
    }
  }

  for (const [qkey, taskId] of queueToTask.entries()) {
    const root = queueToRoot.get(qkey);
    if (!root) continue;
    rememberRoot(taskId, root);
    rememberChild(root, qkey, taskId);
  }

  return { eventsByTask, taskToQueue, queueToTask, taskGoal, taskFlow, rootByTask, queueToRoot, childrenByRoot };
}

function nodeStateForTask(index, taskId, node) {
  const out = { status: 'pending', role: nodeRoleFromName(node), seq: 0, ts: '' };
  for (const ev of index.eventsByTask.get(taskId) || []) {
    if (ev.node !== node) continue;
    const seq = Number(ev.seq || 0);
    if (ev.role) out.role = ev.role;
    if (seq >= out.seq) {
      out.seq = seq;
      out.ts = ev.ts || out.ts;
      if (ev.type === 'node.start') out.status = 'running';
      else if (ev.type === 'node.end') out.status = 'done';
      else if (isBoardRunnerAbsenceEvent(ev)) {
        out.status = 'absent';
        out.statusText = '⚪缺席';
      } else if (ev.type === 'node.fail') out.status = 'fail';
      else if (ev.type === 'node.absent') {
        out.status = 'absent';
        out.statusText = '⚪缺席';
      }
    }
  }
  const task = readEngineTaskState(taskId);
  if (task && taskId && ['paused', 'awaiting_human', 'awaiting_verify'].includes(task.state)) {
    const activeNode = task.cursor || task.node || '';
    if (activeNode && activeNode === node) {
      out.status = 'paused';
      if (task.state === 'awaiting_human') out.statusText = '⏳等主人';
      else if (task.state === 'awaiting_verify') out.statusText = '⏳等验收';
      else if (task.timeout_reason === 'wall_timeout') out.statusText = task.timeout_detail === 'wall_no_progress' ? '⏸静默超时' : '⏸墙钟超时';
      else out.statusText = '⏸暂停';
    }
  }
  return out;
}

function taskHasEvent(index, taskId, type) {
  return (index.eventsByTask.get(taskId) || []).some(ev => ev.type === type);
}

function reviewDecisionFromEvent(ev) {
  if (!ev) return '';
  const raw = [
    ev.reviewResult,
    ev.review_result,
    ev.reviewStatus,
    ev.review_status,
    ev.result,
    ev.outcome,
    ev.decision,
    ev.pass === false ? 'rejected' : '',
    ev.pass === true ? 'approved' : '',
  ].filter(v => v != null && String(v).trim()).map(v => String(v).trim());
  for (const value of raw) {
    if (/(reject|rejected|return|returned|rework|failed|fail|打回|退回|返工|未通过|失败)/i.test(value)) return 'rework';
    if (/(approve|approved|pass|passed|accept|accepted|通过|同意|完成)/i.test(value)) return 'approved';
  }
  return '';
}

function taskBoardReviewOutcome(index, taskId, review, implement) {
  const events = index && index.eventsByTask && taskId ? index.eventsByTask.get(taskId) || [] : [];
  const reviewSeq = Number(review && review.seq || 0);
  const implementSeq = Number(implement && implement.seq || 0);
  let latestReviewToImplementSeq = 0;
  let reworkCount = 0;
  let latestDecision = null;
  for (const ev of events) {
    const seq = Number(ev && ev.seq || 0);
    if (ev && ev.type === 'edge.take' && ev.from === 'review' && ev.to === 'implement') {
      reworkCount += 1;
      if (seq > latestReviewToImplementSeq) latestReviewToImplementSeq = seq;
    }
    if (ev && ev.node === 'review') {
      const decision = reviewDecisionFromEvent(ev);
      if (decision && (!latestDecision || seq >= latestDecision.seq)) latestDecision = { decision, seq };
    }
  }
  const count = Math.max(1, reworkCount);
  if (latestDecision && latestDecision.decision === 'approved' && latestDecision.seq >= latestReviewToImplementSeq) {
    return { rework: false, count: reworkCount, source: 'explicit-approved' };
  }
  if (latestDecision && latestDecision.decision === 'rework' && latestDecision.seq >= reviewSeq) {
    return { rework: true, count, source: 'explicit-rework' };
  }
  if (review && review.status === 'fail') return { rework: true, count, source: 'review-fail' };
  if (latestReviewToImplementSeq && latestReviewToImplementSeq > reviewSeq) return { rework: true, count, source: 'review-return-edge' };
  if (review && review.status === 'done' && implement && implement.status === 'running' && implementSeq > reviewSeq) {
    return { rework: true, count, source: 'done-review-running-implement' };
  }
  return { rework: false, count: reworkCount, source: '' };
}

function childTaskIdsForRoot(index, root) {
  const child = index.childrenByRoot.get(rootKey(root));
  return child ? [...child.taskIds].filter(Boolean) : [];
}

function buildCeoNodeChain(root, cardStatus, index, action) {
  const rootTaskId = root.taskId;
  const childTaskIds = childTaskIdsForRoot(index, root);
  if (action && action.taskId && !childTaskIds.includes(action.taskId) && action.taskId !== rootTaskId) childTaskIds.push(action.taskId);
  const childTaskId = childTaskIds[0] || '';
  const nodes = [];
  const add = (id, label, status, role, meta = {}) => {
    const node = Object.assign({
      id,
      label,
      status,
      statusText: meta.statusText || taskBoardStatusLabel(status),
      role: role || '',
    }, meta);
    if (!node.statusText) node.statusText = taskBoardStatusLabel(node.status);
    nodes.push(node);
  };

  const ceo = rootTaskId ? nodeStateForTask(index, rootTaskId, 'orchestrator-plan') : { status: 'pending', role: 'orchestrator' };
  const routed = rootTaskId && (index.eventsByTask.get(rootTaskId) || []).some(ev => ev.type === 'project.routed');
  let ceoStatus = cardStatus === 'queued' ? 'pending' : ceo.status;
  if (routed && ceoStatus !== 'fail') ceoStatus = 'done';
  if (!rootTaskId && cardStatus === 'running') ceoStatus = 'running';
  add('ceo-plan', 'CEO规划', ceoStatus, 'orchestrator', { taskId: rootTaskId, node: 'orchestrator-plan', statusText: ceo.statusText });

  const implement = childTaskId ? nodeStateForTask(index, childTaskId, 'implement') : { status: 'pending', role: 'worker_code' };
  const review = childTaskId ? nodeStateForTask(index, childTaskId, 'review') : { status: 'pending', role: 'supervisor' };
  const reviewOutcome = childTaskId ? taskBoardReviewOutcome(index, childTaskId, review, implement) : { rework: false, count: 0 };
  const childStarted = childTaskId && (taskHasEvent(index, childTaskId, 'task.created') || implement.status !== 'pending' || review.status !== 'pending');
  const hasProjectChild = !!childTaskId || routed;
  if (hasProjectChild || cardStatus === 'queued') {
    let supervisorStatus = 'pending';
    if (childStarted) supervisorStatus = 'done';
    else if (routed || ceoStatus === 'done') supervisorStatus = 'waiting';
    add('supervisor-route', '主管', supervisorStatus, 'supervisor', { taskId: childTaskId || rootTaskId, node: 'supervisor' });

    let implementStatus = implement.status;
    let implementStatusText = implement.statusText;
    if (implementStatus === 'pending' && supervisorStatus === 'waiting') implementStatus = 'pending';
    if (reviewOutcome.rework) {
      if (implementStatus === 'running') implementStatusText = reviewOutcome.count > 1 ? `🔵第${reviewOutcome.count}次重做` : '🔵重做中';
      else if (implementStatus === 'done') implementStatusText = '✅重做完成';
      else if (implementStatus === 'pending' || implementStatus === 'waiting') implementStatusText = '⏳等重做';
    }
    add('implement', taskBoardRoleLabel(implement.role, 'implement'), implementStatus, implement.role, { taskId: childTaskId, node: 'implement', statusText: implementStatusText, rework: reviewOutcome.rework || undefined, reworkCount: reviewOutcome.count || undefined });

    let reviewStatus = review.status;
    let reviewStatusText = review.statusText;
    if (reviewOutcome.rework) {
      reviewStatus = 'rework';
      reviewStatusText = reviewOutcome.count > 1 ? `↩第${reviewOutcome.count}次打回` : '↩打回';
    } else if (reviewStatus === 'pending') {
      if (implementStatus === 'running' || implementStatus === 'waiting') reviewStatus = 'waiting';
      else if (implementStatus === 'done') reviewStatus = 'waiting';
      if (reviewStatus === 'waiting') reviewStatusText = '';
    }
    add('review', '复审', reviewStatus, 'supervisor', { taskId: childTaskId, node: 'review', statusText: reviewStatusText, rework: reviewOutcome.rework || undefined, reworkCount: reviewOutcome.count || undefined, reworkSource: reviewOutcome.source || undefined });
  }

  for (const taskId of [rootTaskId, ...childTaskIds].filter(Boolean)) {
    for (const ev of index.eventsByTask.get(taskId) || []) {
      if (!/^node\.(start|end|fail)$/.test(ev.type) || ['orchestrator-plan', 'implement', 'review'].includes(ev.node)) continue;
      const state = nodeStateForTask(index, taskId, ev.node);
      const id = `${taskId}:${ev.node}`;
      if (nodes.some(n => n.id === id)) continue;
      add(id, taskBoardRoleLabel(state.role, ev.node), state.status, state.role, { taskId, node: ev.node });
    }
  }

  let runningSeen = false;
  for (const node of nodes) {
    if (node.status !== 'running') continue;
    if (!runningSeen) {
      runningSeen = true;
      if (!node.statusText) node.statusText = taskBoardStatusLabel(node.status);
    } else {
      node.status = 'waiting';
      node.statusText = taskBoardStatusLabel(node.status);
    }
  }
  return nodes;
}

function buildCeoTaskCard(root, cardStatus, index, action) {
  const rootEntry = readQueueEntry(root.queueAgent || 'ceo', root.queueId);
  const rootTaskId = root.taskId || (rootEntry && (rootEntry.taskId || rootEntry.task && rootEntry.task.taskId)) || index.queueToTask.get(queueKey(root.queueAgent || 'ceo', root.queueId)) || '';
  const engineState = readEngineTaskState(rootTaskId);
  const taskText = queueTaskText(rootEntry && rootEntry.task) || index.taskGoal.get(rootTaskId) || action && queueTaskText(action.item && action.item.task) || rootTaskId || root.queueId || '';
  const activeAt = cardStatus === 'running'
    ? (queueRunningStartedAt(rootEntry) || queueRunningStartedAt(action) || '')
    : (rootEntry && (rootEntry.enqueued_at || rootEntry.paused_at) || action && action.enqueued_at);
  const qid = root.queueId || (rootEntry && rootEntry.id) || action && action.id || '';
  const actionAgent = action && action.agent || (cardStatus === 'queued' ? 'ceo' : null);
  const actionId = action && action.id || (cardStatus === 'queued' ? qid : null);
  const nodes = buildCeoNodeChain(makeRoot(rootTaskId, root.queueAgent || 'ceo', qid), cardStatus, index, action);
  const reworkCount = Math.max(0, ...nodes.map(n => Number(n && n.reworkCount || 0)));
  const rework = nodes.some(n => n && (n.rework || n.status === 'rework'));
  const waitingDownstream = cardStatus === 'running' ? downstreamWaitingInfo(rootEntry, index, rootTaskId, action) : null;
  const progress = waitingDownstreamProgress(waitingDownstream, latestTaskBoardProgress(index, rootTaskId, nodes, cardStatus, action, taskText));
  return {
    id: rootKey(root) || rootTaskId || qid,
    rootTaskId,
    rootQueueAgent: root.queueAgent || 'ceo',
    rootQueueId: qid,
    status: cardStatus,
    statusText: rework && cardStatus === 'running' ? '退回重做' : (waitingDownstream ? `等待下游 ${waitingDownstream.roleLabel} 完成` : (cardStatus === 'running' ? '执行中' : (cardStatus === 'paused' ? '暂停等待' : '排队中'))),
    rework,
    reworkCount,
    waitingDownstream: !!waitingDownstream,
    downstream: waitingDownstream,
    task: taskText,
    brief: compactGoal(taskText),
    enqueued_at: rootEntry && rootEntry.enqueued_at || action && action.enqueued_at || '',
    started_at: activeAt || '',
    flow: index.taskFlow.get(rootTaskId) || engineState && engineState.flow || '',
    state: engineState && engineState.state || cardStatus,
    action: actionAgent && actionId ? { agent: actionAgent, id: actionId, taskId: action && action.taskId || rootTaskId } : null,
    queueOrder: action && action.order != null ? action.order : null,
    nodes,
    progress,
    runDir: rootTaskId ? path.relative(WORKDIR, path.join(ENGINE_RUNS, rootTaskId)).split(path.sep).join('/') : '',
  };
}

function terminalQueueEntryTime(entry) {
  const raw = entry && (entry.finished_at || entry.canceled_at || entry.updated_at || entry.started_at || entry.enqueued_at);
  const t = Date.parse(raw || '');
  return Number.isFinite(t) ? t : 0;
}

function readTerminalQueueHistory(agents, index, limit = TASK_BOARD_HISTORY_LIMIT) {
  const candidateLimit = Math.max(limit * 4, 80);
  const candidates = [];
  const pushCandidate = (agentId, status, statusDir, file) => {
    try {
      const full = path.join(statusDir, file);
      const st = fs.statSync(full);
      candidates.push({ agentId, status, file, full, mtimeMs: st.mtimeMs || 0 });
    } catch (_) {}
  };
  for (const agent of agents || []) {
    const agentId = agent && agent.id || agent;
    if (!agentId) continue;
    const dir = Q.qdir(QUEUE_ROOT, agentId);
    for (const status of ['done', 'failed', 'canceled']) {
      const statusDir = path.join(dir, status);
      let files = [];
      try { files = fs.readdirSync(statusDir).filter(f => /\.json$/.test(f)); }
      catch (_) { continue; }
      for (const file of files) pushCandidate(agentId, status, statusDir, file);
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const rows = [];
  for (const candidate of candidates.slice(0, candidateLimit)) {
    const entry = readJsonFile(candidate.full);
    if (!entry) continue;
    const id = String(entry.id || candidate.file.replace(/\.json$/, ''));
    const taskId = entry.taskId || entry.task && entry.task.taskId || index && index.queueToTask.get(queueKey(candidate.agentId, id)) || '';
    const finishedAt = entry.finished_at || entry.canceled_at || entry.updated_at || entry.started_at || entry.enqueued_at || '';
    rows.push({
      key: queueKey(candidate.agentId, id),
      agent: candidate.agentId,
      id,
      task: queueTaskText(entry.task) || index && index.taskGoal.get(taskId) || taskId || id,
      taskId,
      status: entry.status || candidate.status,
      ok: (entry.status || candidate.status) === 'done',
      reason: entry.reason || entry.error || entry.cancel_reason || '',
      error: entry.error || '',
      enqueued_at: entry.enqueued_at || '',
      started_at: entry.started_at || '',
      finished_at: finishedAt,
      time: terminalQueueEntryTime(entry) || candidate.mtimeMs,
    });
    if (rows.length >= limit * 2) break;
  }
  rows.sort((a, b) => (b.time || 0) - (a.time || 0));
  return rows.slice(0, limit).map(row => {
    const out = Object.assign({}, row);
    delete out.time;
    return out;
  });
}

function handleCeoTaskBoard(res) {
  try {
    if (taskBoardCache && TASK_BOARD_CACHE_MS > 0 && Date.now() - taskBoardCache.at < TASK_BOARD_CACHE_MS) {
      return json(res, 200, Object.assign({}, taskBoardCache.payload, { cached: true }));
    }
    const events = readTaskBoardEvents(TASK_BOARD_EVENT_LIMIT);
    const index = buildTaskBoardIndex(events);
    const agents = configuredQueueAgents();
    const queueStates = agents.map(agent => {
      try { return { agent: agent.id, state: Q.list(QUEUE_ROOT, agent.id) }; }
      catch (_) { return { agent: agent.id, state: { queued: [], running: [], paused: [] } }; }
    });

    const activeCandidates = [];
    for (const { agent, state } of queueStates) {
      for (const status of ['running', 'queued', 'paused']) {
        for (const item of state[status] || []) {
          const qkey = queueKey(agent, item.id);
          const taskId = item.taskId || item.task && item.task.taskId || index.queueToTask.get(qkey) || '';
          let root = index.rootByTask.get(taskId) || index.queueToRoot.get(qkey);
          if (!root && agent === 'ceo') root = makeRoot(taskId, 'ceo', item.id);
          if (!root || root.queueAgent !== 'ceo' || agent === 'ceo' && status !== 'running') continue;
          activeCandidates.push({
            root,
            agent,
            id: item.id,
            item,
            taskId,
            status,
            started_at: queueRunningStartedAt(item),
            enqueued_at: item.enqueued_at || '',
            sort: status === 'running' ? 0 : status === 'queued' ? 1 : 2,
            time: queueEntryTime(item),
          });
        }
      }
    }

    const ceoState = Q.list(QUEUE_ROOT, 'ceo');
    for (const item of ceoState.running || []) {
      const qkey = queueKey('ceo', item.id);
      const taskId = item.taskId || item.task && item.task.taskId || index.queueToTask.get(qkey) || '';
      activeCandidates.push({
        root: makeRoot(taskId, 'ceo', item.id),
        agent: 'ceo',
        id: item.id,
        item,
        taskId,
        status: 'running',
        started_at: queueRunningStartedAt(item),
        enqueued_at: item.enqueued_at || '',
        sort: 0,
        time: queueEntryTime(item),
      });
    }
    activeCandidates.sort((a, b) => a.sort - b.sort || a.time - b.time);

    const seenRoots = new Set();
    const active = [];
    for (const candidate of activeCandidates) {
      const key = rootKey(candidate.root);
      if (!key || seenRoots.has(key)) continue;
      seenRoots.add(key);
      active.push(buildCeoTaskCard(candidate.root, 'running', index, candidate));
    }

    const queued = [];
    let pendingOrder = 0;
    for (const status of ['queued', 'paused']) {
      for (const item of ceoState[status] || []) {
        const qkey = queueKey('ceo', item.id);
        if (seenRoots.has(qkey)) continue;
        const taskId = item.taskId || item.task && item.task.taskId || index.queueToTask.get(qkey) || '';
        const root = makeRoot(taskId, 'ceo', item.id);
        queued.push(buildCeoTaskCard(root, status === 'paused' ? 'paused' : 'queued', index, {
          agent: 'ceo',
          id: item.id,
          item,
          taskId,
          status,
          enqueued_at: item.enqueued_at || '',
          order: pendingOrder++,
        }));
      }
    }
    queued.sort((a, b) => (a.queueOrder == null ? 999999 : a.queueOrder) - (b.queueOrder == null ? 999999 : b.queueOrder));

    const tasks = [...active, ...queued];
    const history = readTerminalQueueHistory(agents, index, TASK_BOARD_HISTORY_LIMIT);
    const payload = {
      ok: true,
      source: path.relative(WORKDIR, ENGINE_EVENTS),
      generated_at: nowIso(),
      counts: {
        active: active.length,
        overflowActive: 0,
        queued: queued.length,
        total: tasks.length,
        history: history.length,
      },
      tasks,
      history,
    };
    taskBoardCache = { at: Date.now(), payload };
    return json(res, 200, payload);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

function probe(res, id) {
  const r = cfg.runners[id];
  if (!r) return json(res, 400, { ok:false, error:'未知 runner' });
  if (r.cmd[0] === '__mock__') return json(res, 200, { ok:true, version:'mock' });
  if (r.kind === 'openai_http') {
    const baseUrl = resolveRunnerBaseUrl(r);
    const token = resolveRunnerSecret(r, 'token');
    if (!baseUrl || !token) return json(res, 200, { ok:false, error:'openai_http 缺 baseUrl 或 token' });
    fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${token}` } })
      .then(async rr => {
        const text = await rr.text();
        let body; try { body = JSON.parse(text); } catch (_) { body = {}; }
        const models = Array.isArray(body.data) ? body.data.map(m => m.id).filter(Boolean).slice(0, 8) : [];
        json(res, 200, { ok: rr.ok, version: `${r.model || 'openai_http'} via ${baseUrl}`, models });
      })
      .catch(e => json(res, 200, { ok:false, error:e.message }));
    return;
  }
  let out = '', done = false;
  const finish = (o) => { if (done) return; done = true; json(res, 200, o); };
  let child;
  try { child = spawn(r.cmd[0], ['--version'], { env: buildRunnerEnv(r) }); }
  catch (e) { return json(res, 200, { ok:false, error: e.message }); }
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => out += d);
  child.on('error', e => finish({ ok:false, error:`${r.cmd[0]} 不在 PATH: ${e.message}` }));
  child.on('close', code => finish({ ok: code === 0, version: out.trim().slice(0,120), code }));
}

// [B-1 去同步阻塞] 原实现 spawnSync('sqlite3',{timeout:2500}) 单次可阻塞事件循环
// 至 2.5s,而 newApiUsageFromDb / newApiDbFallback / handleNewApiOverview 每请求
// 调用多次 —— 这是 /api/health 超时 → watchdog 整机重启的最大热点(357 条重启
// 记录中 202 条)。现改为异步 spawn + TTL 内存缓存:
//  - 等待 sqlite3 期间事件循环空闲,/api/health 始终毫秒级响应;
//  - 同一 SQL 在 NEW_API_SQLITE_CACHE_MS(默认 30s)内共享同一 Promise(并发去重),
//    用量数据不需要每请求实时;失败结果不缓存。
const sqliteJsonCache = AsyncUnblock.createTtlCache();
function sqliteJson(sql) {
  if (!fs.existsSync(NEW_API_DB)) return Promise.resolve([]);
  return sqliteJsonCache.get(sql, NEW_API_SQLITE_CACHE_MS,
    () => AsyncUnblock.sqliteJsonAsync(NEW_API_DB, sql, { timeoutMs: 2500 }));
}

async function newApiAdminAuth() {
  const rows = await sqliteJson("select id as user_id, access_token from users where role >= 100 and status = 1 and access_token != '' order by id limit 1");
  const row = rows[0] || null;
  if (!row || !row.user_id || !row.access_token) return null;
  return { userId: row.user_id, token: row.access_token };
}

async function newApiFetch(pathname, auth) {
  const headers = { accept: 'application/json' };
  if (auth) {
    headers['New-Api-User'] = String(auth.userId);
    headers.authorization = `Bearer ${auth.token}`;
  }
  const resp = await fetch(`${NEW_API_BASE}${pathname}`, { headers });
  const text = await resp.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = {}; }
  if (!resp.ok || body.success === false) throw new Error(body.message || `new-api ${resp.status}`);
  return body.data;
}

// [B-1 去同步阻塞] 改 async:两条查询并行发,内部走 sqliteJson 异步+缓存
async function newApiDbFallback() {
  const [countsRows, modelRows] = await Promise.all([
    sqliteJson(`
    select
      (select count(*) from channels) as channel_count,
      (select count(*) from channels where status = 1) as enabled_channels,
      (select count(*) from tokens where deleted_at is null) as token_count,
      (select count(*) from logs where created_at >= strftime('%s','now','localtime','start of day')) as today_logs,
      (select coalesce(sum(quota),0) from logs where created_at >= strftime('%s','now','localtime','start of day')) as today_quota
  `),
    sqliteJson("select distinct trim(value) as model from channels, json_each('[\"' || replace(models, ',', '\",\"') || '\"]') where trim(value) != '' order by model limit 12"),
  ]);
  const counts = countsRows[0] || {};
  const models = modelRows.map(r => r.model).filter(Boolean);
  return { counts, models };
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function quotaCostUsd(quota) {
  return Number((Number(quota || 0) / NEW_API_QUOTA_USD_DIVISOR).toFixed(6));
}

function enrichUsageRow(row) {
  const prompt = Number(row.prompt_tokens || 0);
  const completion = Number(row.completion_tokens || 0);
  const quota = Number(row.quota || 0);
  return Object.assign({}, row, {
    calls: Number(row.calls || 0),
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(row.total_tokens || (prompt + completion)),
    quota,
    estimated_cost_usd: quotaCostUsd(quota),
    avg_use_time: Number(row.avg_use_time || 0),
    last_at: Number(row.last_at || 0),
    created_at: row.created_at == null ? row.created_at : Number(row.created_at || 0),
    use_time: row.use_time == null ? row.use_time : Number(row.use_time || 0),
  });
}

// [B-1 去同步阻塞] 改 async:5 条聚合查询并行发(原先是 5 次串行 spawnSync)
async function newApiUsageFromDb(days, limit) {
  if (!fs.existsSync(NEW_API_DB)) return null;
  const safeDays = clampInt(days, 7, 1, 90);
  const safeLimit = clampInt(limit, 80, 10, 300);
  const sinceExpr = `cast(strftime('%s','now','localtime','start of day','-${safeDays - 1} day') as integer)`;
  const where = `created_at >= ${sinceExpr}`;
  const [totalsRows, byModelRows, byTokenRows, byDayRows, recentRows] = await Promise.all([
    sqliteJson(`
    select
      count(*) as calls,
      coalesce(sum(prompt_tokens),0) as prompt_tokens,
      coalesce(sum(completion_tokens),0) as completion_tokens,
      coalesce(sum(prompt_tokens + completion_tokens),0) as total_tokens,
      coalesce(sum(quota),0) as quota,
      coalesce(avg(case when use_time > 0 then use_time end),0) as avg_use_time,
      coalesce(max(created_at),0) as last_at
    from logs
    where ${where}
  `),
    sqliteJson(`
    select
      coalesce(nullif(model_name,''),'(unknown)') as model,
      count(*) as calls,
      coalesce(sum(prompt_tokens),0) as prompt_tokens,
      coalesce(sum(completion_tokens),0) as completion_tokens,
      coalesce(sum(prompt_tokens + completion_tokens),0) as total_tokens,
      coalesce(sum(quota),0) as quota,
      coalesce(avg(case when use_time > 0 then use_time end),0) as avg_use_time,
      coalesce(max(created_at),0) as last_at
    from logs
    where ${where}
    group by coalesce(nullif(model_name,''),'(unknown)')
    order by quota desc, calls desc
    limit 60
  `),
    sqliteJson(`
    select
      coalesce(nullif(token_name,''),'token #' || token_id) as token_name,
      token_id,
      count(*) as calls,
      coalesce(sum(prompt_tokens),0) as prompt_tokens,
      coalesce(sum(completion_tokens),0) as completion_tokens,
      coalesce(sum(prompt_tokens + completion_tokens),0) as total_tokens,
      coalesce(sum(quota),0) as quota,
      coalesce(avg(case when use_time > 0 then use_time end),0) as avg_use_time,
      coalesce(max(created_at),0) as last_at
    from logs
    where ${where}
    group by token_id, coalesce(nullif(token_name,''),'token #' || token_id)
    order by quota desc, calls desc
    limit 60
  `),
    sqliteJson(`
    select
      date(created_at,'unixepoch','localtime') as day,
      count(*) as calls,
      coalesce(sum(prompt_tokens),0) as prompt_tokens,
      coalesce(sum(completion_tokens),0) as completion_tokens,
      coalesce(sum(prompt_tokens + completion_tokens),0) as total_tokens,
      coalesce(sum(quota),0) as quota,
      coalesce(max(created_at),0) as last_at
    from logs
    where ${where}
    group by day
    order by day
  `),
    sqliteJson(`
    select
      id,
      created_at,
      type,
      coalesce(nullif(token_name,''),'token #' || token_id) as token_name,
      token_id,
      coalesce(nullif(model_name,''),'(unknown)') as model,
      quota,
      prompt_tokens,
      completion_tokens,
      prompt_tokens + completion_tokens as total_tokens,
      use_time,
      is_stream,
      channel_id,
      coalesce(nullif(channel_name,''),'channel #' || channel_id) as channel_name,
      request_id,
      upstream_request_id
    from logs
    where ${where}
    order by created_at desc, id desc
    limit ${safeLimit}
  `),
  ]);
  const totals = enrichUsageRow(totalsRows[0] || {});
  const byModel = byModelRows.map(enrichUsageRow);
  const byToken = byTokenRows.map(enrichUsageRow);
  const byDay = byDayRows.map(enrichUsageRow);
  const recent = recentRows.map(enrichUsageRow);
  return { days: safeDays, totals, byModel, byToken, byDay, recent };
}

// [B-1 去同步阻塞] 改 async(单条查询,异步 spawn)
async function newApiLogDetailFromDb(id) {
  if (!fs.existsSync(NEW_API_DB)) return null;
  const safeId = clampInt(id, 0, 1, Number.MAX_SAFE_INTEGER);
  if (!safeId) return null;
  const row = (await sqliteJson(`
    select
      id,
      user_id,
      created_at,
      type,
      username,
      coalesce(nullif(token_name,''),'token #' || token_id) as token_name,
      token_id,
      coalesce(nullif(model_name,''),'(unknown)') as model,
      quota,
      prompt_tokens,
      completion_tokens,
      prompt_tokens + completion_tokens as total_tokens,
      use_time,
      is_stream,
      channel_id,
      coalesce(nullif(channel_name,''),'channel #' || channel_id) as channel_name,
      request_id,
      upstream_request_id,
      ip
    from logs
    where id = ${safeId}
    limit 1
  `))[0];
  if (!row) return null;
  const detail = enrichUsageRow(row);
  detail.content_hidden = true;
  detail.content_hidden_reason = 'request content is not returned by console to avoid leaking prompts or secrets';
  return detail;
}

// [B-1 去同步阻塞] handler 改 async;返回 JSON 形状不变
async function handleNewApiUsage(res, u) {
  try {
    const usage = await newApiUsageFromDb(u.searchParams.get('days'), u.searchParams.get('limit'));
    if (!usage) {
      return json(res, 200, {
        ok: false,
        error: 'new-api 本地数据库不存在',
        dbPath: path.relative(WORKDIR, NEW_API_DB),
        baseUrl: NEW_API_BASE,
      });
    }
    return json(res, 200, {
      ok: true,
      source: 'local-db',
      dbPath: path.relative(WORKDIR, NEW_API_DB),
      baseUrl: NEW_API_BASE,
      quotaUnit: {
        raw: 'new-api quota',
        estimatedCost: 'quota / divisor',
        divisor: NEW_API_QUOTA_USD_DIVISOR,
        currency: 'USD-estimated',
      },
      usage,
    });
  } catch (e) {
    return json(res, 200, { ok:false, error:e.message, baseUrl: NEW_API_BASE });
  }
}

// [B-1 去同步阻塞] handler 改 async;返回 JSON 形状不变
async function handleNewApiLogDetail(res, id) {
  try {
    const detail = await newApiLogDetailFromDb(id);
    if (!detail) return json(res, 404, { ok:false, error:'log not found' });
    return json(res, 200, {
      ok: true,
      source: 'local-db',
      quotaUnit: {
        raw: 'new-api quota',
        estimatedCost: 'quota / divisor',
        divisor: NEW_API_QUOTA_USD_DIVISOR,
        currency: 'USD-estimated',
      },
      detail,
    });
  } catch (e) {
    return json(res, 500, { ok:false, error:e.message });
  }
}

// [B-1 去同步阻塞] handler 改 async;返回 JSON 形状不变
async function handleLlmUsageOverview(res, u) {
  let newApiUsage = null;
  const days = clampInt(u.searchParams.get('days'), 7, 1, 90);
  const cacheKey = `days=${days}`;
  if (llmUsageCache && LLM_USAGE_CACHE_MS > 0 && llmUsageCache.key === cacheKey && Date.now() - llmUsageCache.at < LLM_USAGE_CACHE_MS) {
    return json(res, 200, Object.assign({}, llmUsageCache.payload, { cached: true }));
  }
  try { newApiUsage = await newApiUsageFromDb(days, 120); } catch (_) {}
  try {
    const payload = Object.assign({ ok: true }, LlmUsage.buildOverview({
      cfg,
      days,
      newApiUsage,
      queueAgents: configuredQueueAgents(),
    }));
    llmUsageCache = { key: cacheKey, at: Date.now(), payload };
    return json(res, 200, payload);
  } catch (e) {
    const payload = { ok:false, error:String(e && e.message || e).slice(0, 500), schema: LlmUsage.LOCAL_LOG_SCHEMA };
    llmUsageCache = { key: cacheKey, at: Date.now(), payload };
    return json(res, 200, payload);
  }
}

async function handleNewApiOverview(res) {
  try {
    const status = await newApiFetch('/api/status', null).catch(() => ({}));
    let auth = null;
    // [B-1 去同步阻塞] newApiAdminAuth 已改 async(异步 sqlite)
    try { auth = await newApiAdminAuth(); } catch (_) {}
    let source = 'local-db';
    let channelTotal = null, tokenTotal = null, todayQuota = null, todayLogs = null, models = [];
    if (auth) {
      try {
        source = 'new-api-api';
        const [channels, tokens, stat, logs, pricing] = await Promise.all([
          newApiFetch('/api/channel/?p=1&size=10', auth),
          newApiFetch('/api/token/?p=1&size=10', auth),
          newApiFetch('/api/log/stat?type=day', auth),
          newApiFetch('/api/log/?p=1&size=1', auth),
          newApiFetch('/api/pricing', auth).catch(() => []),
        ]);
        channelTotal = Number(channels.total || 0);
        tokenTotal = Number(tokens.total || 0);
        todayQuota = Number(stat.quota || 0);
        todayLogs = Number(logs.total || 0);
        models = Array.isArray(pricing) ? [...new Set(pricing.map(x => x && x.model_name).filter(Boolean))].slice(0, 12) : [];
      } catch (_) {
        source = 'local-db';
      }
    }
    const fallback = await newApiDbFallback();
    const counts = fallback.counts || {};
    const overview = {
      ok: true,
      source,
      baseUrl: NEW_API_BASE,
      routes: {
        console: `${NEW_API_BASE}/console`,
        channels: `${NEW_API_BASE}/console/channel`,
        tokens: `${NEW_API_BASE}/console/token`,
        logs: `${NEW_API_BASE}/console/log`,
        dashboard: `${NEW_API_BASE}/detail`,
        pricing: `${NEW_API_BASE}/pricing`
      },
      settings: {
        selfUseMode: !!status.self_use_mode_enabled,
        demoSite: !!status.demo_site_enabled,
        headerNavModules: status.HeaderNavModules || ''
      },
      metrics: {
        channels: channelTotal != null ? channelTotal : Number(counts.channel_count || 0),
        enabledChannels: Number(counts.enabled_channels || 0),
        tokens: tokenTotal != null ? tokenTotal : Number(counts.token_count || 0),
        todayLogs: todayLogs != null ? todayLogs : Number(counts.today_logs || 0),
        todayQuota: todayQuota != null ? todayQuota : Number(counts.today_quota || 0),
        models: (models.length ? models : fallback.models || []).slice(0, 12)
      }
    };
    return json(res, 200, overview);
  } catch (e) {
    return json(res, 200, { ok:false, error:e.message, baseUrl: NEW_API_BASE });
  }
}

const handler = (req, res) => {
  const u = new URL(req.url, `http://${HOST}`);
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(302, { Location: setupReady() ? '/workspace' : '/setup' });
    return res.end();
  }
  if (req.method === 'GET' && u.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    });
  }
  if (req.method === 'GET' && u.pathname === '/setup') return serveStatic(res, 'setup.html');
  if (req.method === 'GET' && u.pathname === '/api/setup/status') return json(res, 200, SetupService.status(setupOptions()));
  const setupProviderMatch = u.pathname.match(/^\/api\/setup\/providers\/([a-z0-9_-]+)$/);
  if (setupProviderMatch) return handleSetupProvider(req, res, setupProviderMatch[1]);
  if (u.pathname === '/api/setup/complete') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method_not_allowed' });
    return readJson(req, res, () => {
      const result = SetupService.completeSetup(setupOptions());
      json(res, result.ok ? 200 : 409, result);
    });
  }
  if (u.pathname === '/api/projects') return handleProjects(req, res);
  if (req.method === 'GET' && u.pathname === '/api/version') return handleVersion(res);
  if (req.method === 'GET' && u.pathname === '/api/version/history') return handleVersionHistory(res, u);
  if (req.method === 'GET' && u.pathname === '/api/servers/status') return handleServersStatus(res);
  if (req.method === 'GET' && u.pathname === '/api/runners') {
    const includeDeprecated = /^(1|true|yes)$/i.test(String(u.searchParams.get('includeDeprecated') || ''));
    const runners = Object.entries(cfg.runners)
      .filter(([, r]) => includeDeprecated || !r.hidden)
      .map(([id, r]) => ({ id, label: r.label, note: r.note || '', deprecated: !!r.hidden }));
    return json(res, 200, { runners, roles: cfg.roleRouting || {}, frontDoorPolicy: cfg.frontDoorPolicy || null, glm52Delegation: cfg.glm52Delegation || null, versionManagement: cfg.versionManagement || null, boardReviewControl: currentBoardReviewControl(), queueAgents: configuredQueueAgents(), workdir: WORKDIR });
  }
  if (req.method === 'GET' && u.pathname === '/api/history')
    return json(res, 200, { history: readHistory(parseInt(u.searchParams.get('n') || '30', 10)) });
  if (req.method === 'GET' && u.pathname === '/api/events') {
    const events = readEvents(u.searchParams.get('after') || 0, u.searchParams.get('n') || 120);
    const lastSeq = events.length ? events[events.length - 1].seq : Number(u.searchParams.get('after') || 0);
    return json(res, 200, { source: path.relative(WORKDIR, ENGINE_EVENTS), lastSeq, events });
  }
  if (req.method === 'GET' && u.pathname === '/api/task-board/ceo') return handleCeoTaskBoard(res);
  if (req.method === 'GET' && u.pathname === '/api/auto-optimizer/status') {
    return json(res, 200, {
      ok: true,
      enabled: AUTO_OPTIMIZER_ENABLED,
      agent: AUTO_OPTIMIZER_AGENT,
      intervalMs: AUTO_OPTIMIZER_INTERVAL_MS,
      checkMs: AUTO_OPTIMIZER_CHECK_MS,
      state: autoOptimizerState(),
      active: queueActiveItems({ ignoreAgents: [AUTO_OPTIMIZER_AGENT] }).slice(0, 20),
      existing: autoOptimizerExistingItems(),
    });
  }
  if (req.method === 'POST' && u.pathname === '/api/auto-optimizer/check') {
    readJson(req, res, b => json(res, 200, checkAutoOptimizer({ force: !!(b && b.force) })));
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/page-review/status') {
    return json(res, 200, {
      ok: true,
      enabled: SCHEDULED_PAGE_REVIEW_ENABLED,
      agents: [FRONTEND_DESIGNER_AGENT, AUTO_OPTIMIZER_AGENT],
      intervalMs: SCHEDULED_PAGE_REVIEW_INTERVAL_MS,
      checkMs: SCHEDULED_PAGE_REVIEW_CHECK_MS,
      state: scheduledPageReviewState(),
      active: queueActiveItems().slice(0, 20),
      existing: scheduledPageReviewExistingItems(),
    });
  }
  if (req.method === 'POST' && u.pathname === '/api/page-review/check') {
    // [B-1 去同步阻塞] 改走 async 预热路径,HTTP handler 不再同步哈希 public/ 目录
    readJson(req, res, b => {
      checkScheduledPageReviewNonBlocking({ force: !!(b && b.force) })
        .then(result => json(res, 200, result))
        .catch(e => json(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 300) }));
    });
    return;
  }
  const bulletinMatch = u.pathname.match(/^\/api\/bulletin(?:\/([^/]+)\/(enable|remove))?$/);
  if (bulletinMatch) return handleBulletin(req, res, bulletinMatch);
  // 飞书决策卡按钮回调(拍板 Q12):点按钮即拍板;token 校验失败一律不执行
  const decisionMatch = u.pathname.match(/^\/api\/decision\/([^/]+)\/(approve|reject)$/);
  if (decisionMatch) return handleDecisionCallback(req, res, decisionMatch, u);
  if (u.pathname === '/api/ceo/queue-control') return handleCeoQueueControl(req, res);
  const queueBatchMatch = u.pathname.match(/^\/api\/queue\/([^/]+)\/(batch-cancel|merge|organize)$/);
  if (queueBatchMatch) return handleQueueBatch(req, res, queueBatchMatch);
  const queueMatch = u.pathname.match(/^\/api\/queue\/([^/]+)(?:\/([^/]+)\/(jump|reorder|priority|setPriority|set-priority|steer|pause|resume|cancel))?$/);
  if (queueMatch) return handleQueue(req, res, queueMatch);
  if (req.method === 'GET' && u.pathname === '/api/probe') return probe(res, u.searchParams.get('runner'));
  if (req.method === 'GET' && u.pathname === '/api/llm-usage/overview') return handleLlmUsageOverview(res, u);
  if (req.method === 'GET' && u.pathname === '/api/newapi/overview') return handleNewApiOverview(res);
  if (req.method === 'GET' && u.pathname === '/api/newapi/usage') return handleNewApiUsage(res, u);
  const newApiLogMatch = u.pathname.match(/^\/api\/newapi\/logs\/(\d+)$/);
  if (req.method === 'GET' && newApiLogMatch) return handleNewApiLogDetail(res, newApiLogMatch[1]);
  if (req.method === 'GET' && u.pathname === '/api/peekaboo-baseline/artifacts')
    return json(res, 200, listPeekabooBaselineArtifacts());
  const peekabooFileMatch = u.pathname.match(/^\/api\/peekaboo-baseline\/file\/(.+)$/);
  if (req.method === 'GET' && peekabooFileMatch) {
    const fp = safePeekabooArtifactPath(peekabooFileMatch[1]);
    if (!fp) { res.writeHead(403).end('forbidden'); return; }
    return serveFile(res, fp);
  }
  if (req.method === 'GET' && u.pathname === '/api/vision/locate/health')
    return json(res, 200, { ok:true, state: LocateAnything.health() });
  if (req.method === 'GET' && ['/control-room', '/workspace', '/api-gateway', '/public/workspace.html'].includes(u.pathname) && !setupReady()) {
    res.writeHead(302, { Location: '/setup' });
    return res.end();
  }
  if (req.method === 'GET' && u.pathname === '/control-room') return serveStatic(res, 'control-room.html');
  if (req.method === 'GET' && u.pathname === '/workspace') return serveStatic(res, 'workspace.html');
  if (req.method === 'GET' && u.pathname === '/office-experiment') return serveStatic(res, 'office-experiment.html');
  if (req.method === 'GET' && u.pathname === '/api-gateway') return serveStatic(res, 'newapi.html');
  if (req.method === 'GET' && u.pathname === '/api/cr/overview') {
    try { return json(res, 200, require('./control-room').overview(WORKDIR)); }
    catch (e) { return json(res, 500, { error: String(e.message || e) }); }
  }
  if (req.method === 'POST' && u.pathname === '/api/chat') {
    readJson(req, res, b => handleChat(res, b));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/engine/run') {
    readJson(req, res, b => handleEngineRun(res, b));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/vision/locate') {
    readJson(req, res, b => {
      LocateAnything.locate(b)
        .then(result => json(res, result.status, result.body))
        .catch(e => json(res, 500, { ok:false, error:String(e && e.message || e) }));
    });
    return;
  }
  if (u.pathname.startsWith('/public/')) return serveStatic(res, u.pathname.replace('/public/', ''));
  res.writeHead(404).end('not found');
};

// 同时监听 IPv4(127.0.0.1)和 IPv6(::1)本地回环 —— mac 上 localhost 常优先走 ::1,
// 只绑一个会出现"服务在跑但浏览器连不上"。两个都绑,仍然只对本机,不对外网。
function boot(host, primary) {
  const s = http.createServer(handler);
  s.on('error', e => {
    if (e.code === 'EADDRINUSE' && primary) { console.error(`\n  ✗ 端口 ${PORT} 已被占用。换端口重启:PORT=8890 bash start.sh\n`); process.exit(1); }
    else if (primary) console.error(`  ${host} 监听失败: ${e.message}`);
    // 非主(::1)失败静默:有些机器没开 IPv6
  });
  s.listen(PORT, host, () => console.log(`  ✓ 监听 ${host.includes(':') ? '[' + host + ']' : host}:${PORT}`));
}
async function start() {
  console.log('\n  玉兔6 控制台启动中…');
  console.log(`  工作目录(runner 在此执行):${WORKDIR}`);
  console.log(`  runners: ${Object.keys(cfg.runners).join(', ')}`);
  await selfCleanRuntimeArtifacts();
  boot('127.0.0.1', true);
  boot('::1', false);
  console.log(`  打开 → http://localhost:${PORT}  或  http://127.0.0.1:${PORT}   (Ctrl+C 退出)\n`);
  const timer = setTimeout(() => {
    try {
      ensureWorkersForBacklog();
      startWorkerSupervisor();
      startQueueWorkerEventWake();
      startAutoOptimizerScheduler();
      startScheduledPageReviewScheduler();
      startInsightScoutReposScheduler();
      engineLog().emit('console.background_startup.done', {
        delayMs: BACKGROUND_STARTUP_DELAY_MS,
        schedulerStartupDelayMs: SCHEDULER_STARTUP_DELAY_MS,
      });
    } catch (e) {
      engineLog().emit('console.background_startup.error', { reason: String(e && e.message || e).slice(0, 300) });
    }
  }, BACKGROUND_STARTUP_DELAY_MS);
  if (timer.unref) timer.unref();
}

if (require.main === module) {
  start().catch(e => {
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

module.exports = {
  handler,
  start,
  configuredQueueAgents,
  ensureQueueWorker,
  ensureWorkersForBacklog,
  startQueueWorkerEventWake,
  processQueueWorkerWakeEvents,
  checkAutoOptimizer,
  checkScheduledPageReview,
  checkInsightScoutRepos,
  queueActiveItems,
  selfCleanRuntimeArtifacts,
  checkScheduledPageReviewNonBlocking,
  _test: {
    computePageReviewSignature,
    computePageReviewSignatureAsync,
    refreshPageSignatureCache,
    readTaskBoardEvents,
    readTaskBoardEventsFull,
    taskBoardEventCursor,
    sqliteJson,
    sqliteJsonCache,
    newApiUsageFromDb,
    handleNewApiUsage,
    handleCeoTaskBoard,
    scheduledPageReviewExistingItems,
    scheduledPageReviewTask,
    startInsightScoutReposScheduler,
    doneLikeRepairStatus,
    doneRepairTicketBulletin,
    repairTicketIdFromBulletinCard,
    repairTicketStatus,
    buildCeoTaskCard,
    buildCeoNodeChain,
    buildTaskBoardIndex,
    nodeStateForTask,
    taskBoardStatusLabel,
    taskBoardProgressForEvent,
    workerPidFileState,
    isQueueAgentDirName,
    enableBulletinCardAt,
    removeBulletinCardAt,
    handleDecisionCallback,
    readDecisionActions,
  },
};
