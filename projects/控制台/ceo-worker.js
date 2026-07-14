#!/usr/bin/env node
'use strict';
/*
 * Generic queue worker.
 * Legacy filename kept for server/service compatibility; pass --agent <id> or
 * QUEUE_AGENT=<id>. Each agent owns one queue; engine runners share a bounded
 * global slot pool. Resource-domain locks decide which queued tasks may run
 * together.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('./setup-service').loadPrivateEnv();

const Q = require('../../shared/engine/queue');
const EventLog = require('../../shared/engine/eventlog');
const SecretaryTools = require('./secretary-tools');
const QueueAutoMerge = require('./queue-automerge');
const BoardReview = require('./board-review');
const { hasActiveUnregisteredProjectReference, isUnregisteredProjectId, keywordProjectId, registeredProjectFromText } = require('./project-guard');
const Runtime = require('./engine-runtime');
const ResourceLocks = require('./resource-locks');
const QuotaDegrade = require('./quota-degrade');
const RuntimePaths = require('./runtime-paths');
const DoneGate = require('../../shared/engine/done-gate');
const { computeSourceRevision, defaultReloadDirs } = require('./source-revision');
const DailyIgnition = require('./daily-ignition');
const CODE_RELOAD_CHECK_MS = 30000;

const ROOT = __dirname;
const WORKDIR = path.resolve(ROOT, '../..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const QUEUE_ROOT = ARTIFACTS_ROOT;
const ENGINE_JOBS = path.join(ARTIFACTS_ROOT, 'engine-jobs');
const ENGINE_LOG = path.join(ARTIFACTS_ROOT, 'engine-worker.log');
const EVENTS = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const ENGINE_SLOTS = path.join(ARTIFACTS_ROOT, 'engine-slots');
const ENGINE_TYPE_LOCKS = path.join(ARTIFACTS_ROOT, 'engine-runner-types');
const RESOURCE_LOCKS = path.join(ARTIFACTS_ROOT, 'resource-locks');
const ACTIVE_CEO_TASK_LOCK = path.join(ARTIFACTS_ROOT, 'active-ceo-task.lock.json');
const LEGACY_ENGINE_LOCK = path.join(ARTIFACTS_ROOT, 'engine-runner.lock.json');
const CFG = (() => {
  const cfgPath = process.env.CONSOLE_CONFIG_PATH
    ? path.resolve(process.env.CONSOLE_CONFIG_PATH)
    : path.join(ROOT, 'config.json');
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch (_) { return {}; }
})();
const DEFAULT_ROLE_MAP = {
  secretary: 'codex',
  orchestrator: 'codex',
  supervisor: 'codex',
  reasoning_architect: 'codex',
  worker_code: 'codex',
  worker_narrow: 'zhipu-glm',
  quality_ops: 'zhipu-glm',
  governance: 'codex',
  'insight-scout': 'zhipu-glm',
  memory_officer: 'codex',
  it_engineer: 'zhipu-glm',
  hr_manager: 'codex',
  hr_specialist: 'zhipu-glm',
  'repair-lead': 'codex-privileged',
  repair: 'codex-privileged',
  gui_desktop_control: 'peekaboo',
  frontend_designer: 'zhipu-glm',
  board_glm52: 'zhipu-glm',
  board_deepseek: 'deepseek',
  board_claude: 'claude-fable-5',
  board_opus48: 'codex',
};
const ENGINE_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.ENGINE_MAX_CONCURRENCY || '3', 10) || 3);
const QUEUE_WORKER_MAX_IN_FLIGHT = Math.max(1, parseInt(process.env.QUEUE_WORKER_MAX_IN_FLIGHT || String(ENGINE_MAX_CONCURRENCY), 10) || ENGINE_MAX_CONCURRENCY);
const CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.CEO_ACTIVE_TASK_SERIAL_LOCK || process.env.CEO_SINGLE_ACTIVE_TASK || ''));
const RUNNER_SINGLEFLIGHT = new Set(String(process.env.RUNNER_SINGLEFLIGHT || 'codex,codex-privileged')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean));
const QUEUE_MAX_RETRY = Math.max(0, parseInt(process.env.QUEUE_MAX_RETRY || '2', 10) || 2);
const NODE_FAILURE_MAX_RETRY = Math.max(0, parseInt(process.env.NODE_FAILURE_MAX_RETRY || '2', 10) || 2);
const RUNNING_SWEEP_MS = Math.max(1000, parseInt(process.env.RUNNING_SWEEP_MS || '5000', 10) || 5000);
const ENGINE_LOCK_STALE_MS = Math.max(60 * 1000, parseInt(process.env.ENGINE_LOCK_STALE_MS || String(2 * 60 * 60 * 1000), 10) || (2 * 60 * 60 * 1000));
const RUNNING_ENGINE_HEARTBEAT_STALE_MS = Math.max(1000, parseInt(process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS || '60000', 10) || 60000);
const ENGINE_LEASE_HEARTBEAT_MS = Math.max(1000, parseInt(process.env.ENGINE_LEASE_HEARTBEAT_MS || '2000', 10) || 2000);
const ORPHAN_ENGINE_TERM_GRACE_MS = Math.max(0, parseInt(process.env.ORPHAN_ENGINE_TERM_GRACE_MS || '5000', 10) || 5000);
const AUTO_REPAIR_ENABLED = process.env.AUTO_REPAIR_ENABLED !== '0';
// 跟随 ARTIFACTS_ROOT(默认仍是 ROOT/artifacts): 让 CONSOLE_ARTIFACTS_DIR 沙箱化测试也隔离自动维修状态。
const AUTO_REPAIR_DIR = path.join(ARTIFACTS_ROOT, 'repair-auto');
const AUTO_REPAIR_STATE = path.join(AUTO_REPAIR_DIR, 'index.json');
const AUTO_REPAIR_COOLDOWN_MS = Math.max(60 * 1000, parseInt(process.env.AUTO_REPAIR_COOLDOWN_MS || String(30 * 60 * 1000), 10) || (30 * 60 * 1000));
const SUPERVISOR_REVIEW_NODE_TIMEOUT_SEC = 1800;
const PROJECT_DONE_NOTIFY_STATE = path.join(ARTIFACTS_ROOT, 'project-done-notify-state.json');
const PROJECT_DONE_NOTIFY_COOLDOWN_MS = Math.max(0, parseInt(process.env.PROJECT_DONE_NOTIFY_COOLDOWN_MS || String(2 * 60 * 1000), 10) || 0);
const OWNER_AUTO_NOTIFY_STATE = path.join(ARTIFACTS_ROOT, 'owner-auto-notify-state.json');
const OWNER_AUTO_NOTIFY_COOLDOWN_MS = Math.max(0, parseInt(process.env.OWNER_AUTO_NOTIFY_COOLDOWN_MS || String(30 * 60 * 1000), 10) || (30 * 60 * 1000));
const OWNER_AUTO_NOTIFY_AGGREGATE_MS = Math.max(0, parseInt(process.env.OWNER_AUTO_NOTIFY_AGGREGATE_MS || String(45 * 1000), 10) || 0);
const OWNER_AUTO_NOTIFY_TASK_WINDOW_MS = Math.max(0, parseInt(process.env.OWNER_AUTO_NOTIFY_TASK_WINDOW_MS || String(5 * 60 * 1000), 10) || 0);
const OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS = Math.max(60 * 1000, parseInt(process.env.OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS || String(24 * 60 * 60 * 1000), 10) || (24 * 60 * 60 * 1000));
const OWNER_AUTO_NOTIFY_HISTORY_MS = Math.max(60 * 60 * 1000, parseInt(process.env.OWNER_AUTO_NOTIFY_HISTORY_MS || String(24 * 60 * 60 * 1000), 10) || (24 * 60 * 60 * 1000));
const OWNER_AUTO_NOTIFY_TASK_LIST_LIMIT = Math.max(3, parseInt(process.env.OWNER_AUTO_NOTIFY_TASK_LIST_LIMIT || '5', 10) || 5);
// 故障分级响应(拍板 Q7): P0 服务不可用立即飞书 / P1 业务终态失败进当日 digest 日报 / P2 infra 噪声只 emit 事件+记账。
// YUTU6_NOTIFY_TIERED=0 整体退回旧行为(默认开)。
const NOTIFY_TIERED_ENABLED = process.env.YUTU6_NOTIFY_TIERED !== '0';
const NOTIFY_TIER_DIGEST_DIR = path.join(ARTIFACTS_ROOT, 'notify');
const NOTIFY_TIER_STATE = path.join(NOTIFY_TIER_DIGEST_DIR, 'tier-state.json');
const NOTIFY_P0_COOLDOWN_MS = Math.max(0, parseInt(process.env.YUTU6_NOTIFY_P0_COOLDOWN_MS || String(10 * 60 * 1000), 10) || 0);
const NOTIFY_P1_DIGEST_CHECK_MS = Math.max(60 * 1000, parseInt(process.env.YUTU6_NOTIFY_P1_DIGEST_CHECK_MS || String(5 * 60 * 1000), 10) || (5 * 60 * 1000));
const NOTIFY_P1_DIGEST_TASK_LIST_LIMIT = Math.max(3, parseInt(process.env.YUTU6_NOTIFY_P1_DIGEST_TASK_LIST_LIMIT || '8', 10) || 8);
const RUNNING_NO_PROGRESS_STALE_MS = Math.max(0, parseInt(process.env.RUNNING_NO_PROGRESS_STALE_MS || String(8 * 60 * 1000), 10) || 0);
const PROJECT_ROUTE_CHILD_DISCOVERY_MS = Math.max(1000, parseInt(process.env.PROJECT_ROUTE_CHILD_DISCOVERY_MS || '10000', 10) || 10000);
const PROJECT_ROUTE_KNOWN_CHILD_MISSING_MS = Math.max(100, parseInt(process.env.PROJECT_ROUTE_KNOWN_CHILD_MISSING_MS || '30000', 10) || 30000);
const PROJECT_ROUTE_EVENT_WAKE_ENABLED = process.env.PROJECT_ROUTE_EVENT_WAKE_ENABLED !== '0';
const PROJECT_ROUTE_DISCOVERY_FALLBACK_MS = Math.max(50, parseInt(process.env.PROJECT_ROUTE_DISCOVERY_FALLBACK_MS || '300', 10) || 300);
const PROJECT_ROUTE_ACTIVE_FALLBACK_MS = Math.max(50, parseInt(process.env.PROJECT_ROUTE_ACTIVE_FALLBACK_MS || '800', 10) || 800);
const WORKER_HEARTBEAT_MS = Math.max(1000, parseInt(process.env.WORKER_HEARTBEAT_MS || '5000', 10) || 5000);
const RESOURCE_DOMAIN_LOCKS_ENABLED = process.env.RESOURCE_DOMAIN_LOCKS_ENABLED !== '0';
const RESOURCE_LOCK_WAIT_TIMEOUT_MS = Math.max(1000, parseInt(process.env.RESOURCE_LOCK_WAIT_TIMEOUT_MS || String(30 * 60 * 1000), 10) || (30 * 60 * 1000));
const RESOURCE_LOCK_LEASE_MS = Math.max(30 * 1000, parseInt(process.env.RESOURCE_LOCK_LEASE_MS || String(5 * 60 * 1000), 10) || (5 * 60 * 1000));
const RESOURCE_LOCK_HEARTBEAT_MS = Math.max(1000, parseInt(process.env.RESOURCE_LOCK_HEARTBEAT_MS || String(Math.min(15 * 1000, Math.floor(RESOURCE_LOCK_LEASE_MS / 3))), 10) || Math.min(15 * 1000, Math.floor(RESOURCE_LOCK_LEASE_MS / 3)));
const QUOTA_DEGRADE_ENABLED = process.env.QUOTA_DEGRADE_ENABLED !== '0';
const QUOTA_DEGRADE_DRAIN_MS = Math.max(0, parseInt(process.env.QUOTA_DEGRADE_DRAIN_MS || '1800', 10) || 0);
const QUOTA_DEGRADE_LOCK_WAIT_MS = Math.max(100, parseInt(process.env.QUOTA_DEGRADE_LOCK_WAIT_MS || '5000', 10) || 5000);

const DEFAULT_BOUNDS = '只处理本任务; 未登记项目必须先创建项目部门; 不得跨项目操作; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明';
const DEFAULT_ACCEPTANCE = '跑通 review-loop: 总管拆解、实现、评审、完成事件都写入 engine-events.jsonl; 如无需改文件请明确说明';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventlog = new EventLog(EVENTS);
const PROJECT_ROUTE_WAKE_EVENT_TYPES = new Set([
  'queue.enqueued',
  'queue.claimed',
  'queue.completed',
  'queue.quota_degraded',
  'quota.snapshot.written',
  'queue.paused',
  'queue.canceled',
  'task.done',
  'task.failed',
  'task.canceled',
  'project.route.done',
  'project.route.failed',
  'project.route.paused',
  'project.route.canceled',
]);
const ownerAutoNotifyTimers = new Map();
let p1DigestNextCheckMs = 0;
let workerPidFile = null;
let workerHeartbeatTimer = null;
let workerSupersededNoticeSent = false;
let resourceSchedulerLastBlockedAt = 0;
let resourceSchedulerLastProbeFailedAt = 0;
const resourceSchedulerReservations = new Map();

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function safeAgent(s) {
  const agent = String(s || 'ceo');
  return /^[\p{L}\p{N}_-]+$/u.test(agent) ? agent : 'ceo';
}

function isQueueAgentDirName(s) {
  const agent = String(s || '');
  return /^[\p{L}\p{N}_-]+$/u.test(agent)
    && !agent.startsWith('_')
    && !new Set(['queues', 'bulletin']).has(agent);
}

function readEngineEventsSince(afterSeq) {
  const out = [];
  let maxSeq = Number(afterSeq || 0) || 0;
  try {
    const lines = fs.readFileSync(EVENTS, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let ev;
      try { ev = JSON.parse(line); } catch (_) { continue; }
      const seq = Number(ev && ev.seq) || 0;
      if (seq > maxSeq) maxSeq = seq;
      if (seq > Number(afterSeq || 0)) out.push(ev);
    }
  } catch (_) {}
  return { events: out, maxSeq };
}

function currentEngineEventSeq() {
  return readEngineEventsSince(0).maxSeq;
}

function queueRefKey(agent, queueId) {
  return `${agent || ''}/${queueId || ''}`;
}

function eventMatchesProjectRouteWake(ev, spec, root, refs) {
  if (!ev || !PROJECT_ROUTE_WAKE_EVENT_TYPES.has(ev.type)) return false;
  const rootAgent = root && root.rootQueueAgent;
  const rootId = root && root.rootQueueId;
  const rootTask = root && root.rootTaskId;
  if (rootAgent && rootId && ev.rootQueueAgent === rootAgent && ev.rootQueueId === rootId) return true;
  if (rootTask && ev.rootTaskId === rootTask) return true;
  if (spec && spec.taskId && (ev.task === spec.taskId || ev.sourceTask === spec.taskId)) return true;
  const refKeys = new Set((refs || []).map(ref => queueRefKey(ref.agent || ref.queueAgent, ref.queueId || ref.id)));
  return refKeys.has(queueRefKey(ev.queueAgent || ev.downstreamQueueAgent || ev.supervisorQueue, ev.queueId || ev.downstreamQueueId));
}

function waitForEventFileChange(timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    let watcher = null;
    let poller = null;
    let initialSize = -1;
    let initialMtimeMs = -1;
    try {
      const stat = fs.statSync(EVENTS);
      initialSize = stat.size;
      initialMtimeMs = stat.mtimeMs;
    } catch (_) {}
    const finish = reason => {
      if (done) return;
      done = true;
      try { if (watcher) watcher.close(); } catch (_) {}
      if (poller) clearInterval(poller);
      clearTimeout(timer);
      resolve(reason);
    };
    const timer = setTimeout(() => finish('timeout'), Math.max(0, timeoutMs));
    poller = setInterval(() => {
      try {
        const stat = fs.statSync(EVENTS);
        if (stat.size !== initialSize || stat.mtimeMs !== initialMtimeMs) finish('change');
      } catch (_) {}
    }, Math.min(100, Math.max(25, Math.floor(Math.max(1, timeoutMs) / 4))));
    if (poller && typeof poller.unref === 'function') poller.unref();
    try {
      watcher = fs.watch(EVENTS, { persistent: false }, () => finish('change'));
      watcher.on('error', () => finish('timeout'));
    } catch (_) {
      // fs.watch is only an optimization. If unavailable, keep the old timeout fallback.
    }
  });
}

async function waitForProjectRouteWake(spec, root, refs, afterSeq, timeoutMs, phase) {
  let cursor = Number(afterSeq || 0) || 0;
  if (!PROJECT_ROUTE_EVENT_WAKE_ENABLED) {
    await sleep(timeoutMs);
    return { woke: false, seq: cursor, reason: 'feature-disabled', phase };
  }
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const scan = readEngineEventsSince(cursor);
    cursor = Math.max(cursor, scan.maxSeq);
    const matched = scan.events.find(ev => eventMatchesProjectRouteWake(ev, spec, root, refs));
    if (matched) {
      return {
        woke: true,
        seq: cursor,
        event: { seq: matched.seq || null, type: matched.type || null, queueAgent: matched.queueAgent || null, queueId: matched.queueId || null },
        phase,
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { woke: false, seq: cursor, reason: 'fallback-timeout', phase };
    const reason = await waitForEventFileChange(remaining);
    if (reason === 'timeout') return { woke: false, seq: cursor, reason: 'fallback-timeout', phase };
  }
}

const AGENT = safeAgent(argValue('--agent') || process.env.QUEUE_AGENT || 'ceo');
const PROJECTS_DIR = process.env.CONSOLE_PROJECTS_DIR
  ? path.resolve(process.env.CONSOLE_PROJECTS_DIR)
  : path.join(WORKDIR, 'projects');
const BOARD_ROLLUP = process.env.CONSOLE_BOARD_ROLLUP
  ? path.resolve(process.env.CONSOLE_BOARD_ROLLUP)
  : path.join(WORKDIR, 'board', 'status-rollup.md');

function pidAlive(pid) {
  return Runtime.pidAlive(pid);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function writeJson(file, data, opts) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), opts);
}

function recordAgeMs(record) {
  const raw = record && (record.heartbeat_at || record.updated_at || record.ts || record.started_at);
  const t = raw ? Date.parse(raw) : 0;
  return t ? Date.now() - t : Infinity;
}

function recordStale(record) {
  return recordAgeMs(record) > ENGINE_LOCK_STALE_MS;
}

function runningEngineHeartbeat(record) {
  let raw = null;
  let source = null;
  const enginePid = Runtime.enginePidFromRecord(record);
  if (record) {
    if (enginePid && record.engine_heartbeat_at) {
      raw = record.engine_heartbeat_at;
      source = 'engine_heartbeat_at';
    } else if (!enginePid && record.pre_engine_wait_heartbeat_at) {
      raw = record.pre_engine_wait_heartbeat_at;
      source = 'pre_engine_wait_heartbeat_at';
    } else if (record.engine_started_at) {
      raw = record.engine_started_at;
      source = 'engine_started_at';
    } else if (record.started_at) {
      raw = record.started_at;
      source = 'started_at';
    }
  }
  const t = raw ? Date.parse(raw) : 0;
  if (!t) return { at: raw || null, ageMs: null, stale: false, source };
  const ageMs = Date.now() - t;
  return {
    at: raw,
    ageMs,
    stale: ageMs > RUNNING_ENGINE_HEARTBEAT_STALE_MS,
    source,
  };
}

function progressBelongsToCurrentTask(record) {
  if (!record) return true;
  const progressTask = record.progress_task;
  const currentTask = record.taskId
    || record.task_id
    || record.engineTask
    || record.task && (record.task.taskId || record.task.id);
  if (!progressTask || !currentTask) return true;
  return String(progressTask) === String(currentTask);
}

function explicitProgressAt(record) {
  if (!record || !progressBelongsToCurrentTask(record)) return null;
  return record.progress_at || record.node_event_at || null;
}

function runningNoProgress(record) {
  const staleMs = runningNoProgressStaleMs(record);
  if (!staleMs) return { at: null, ageMs: null, stale: false };
  const raw = explicitProgressAt(record) || record && record.started_at;
  const t = raw ? Date.parse(raw) : 0;
  if (!t) return { at: raw || null, ageMs: null, stale: false };
  const ageMs = Date.now() - t;
  return {
    at: raw,
    ageMs,
    stale: ageMs > staleMs,
  };
}

function runningRecentExplicitProgress(record) {
  const staleMs = runningNoProgressStaleMs(record);
  const raw = explicitProgressAt(record);
  const t = raw ? Date.parse(raw) : 0;
  if (!t || !staleMs) return { at: raw || null, ageMs: null, fresh: false };
  const ageMs = Date.now() - t;
  return {
    at: raw,
    ageMs,
    fresh: ageMs <= staleMs,
  };
}

function taskNodeTimeoutMs(record) {
  const task = record && record.task && typeof record.task === 'object' ? record.task : {};
  const raw = record && (record.nodeTimeoutSec ?? record.timeoutSec ?? task.nodeTimeoutSec ?? task.timeoutSec);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  const queueAgent = String(record && (record.queueAgent || record.agent || record.owner) || AGENT || '');
  const flowId = String(record && (record.flowId || task.flowId) || '');
  if (flowId === 'review-loop' && /^supervisor-/.test(queueAgent)) {
    return SUPERVISOR_REVIEW_NODE_TIMEOUT_SEC * 1000;
  }
  return 0;
}

function runningNoProgressStaleMs(record) {
  if (!RUNNING_NO_PROGRESS_STALE_MS) return 0;
  const nodeTimeoutMs = taskNodeTimeoutMs(record);
  return nodeTimeoutMs ? Math.max(RUNNING_NO_PROGRESS_STALE_MS, nodeTimeoutMs) : RUNNING_NO_PROGRESS_STALE_MS;
}

function processCmd(pid) {
  return Runtime.processCmd(pid);
}

function pidLooksLike(pid, marker) {
  return Runtime.pidLooksLike(pid, marker);
}

function parentPid(pid) {
  if (!pidAlive(pid)) return 0;
  try {
    const out = require('child_process').spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8', timeout: 1000 });
    return parseInt((out.stdout || '').trim(), 10) || 0;
  } catch (_) {
    return 0;
  }
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

function lockSweepReason(record) {
  return Runtime.lockSweepReason(record, {
    queueRoot: QUEUE_ROOT,
    staleMs: ENGINE_LOCK_STALE_MS,
    runningStaleMs: Math.max(RUNNING_ENGINE_HEARTBEAT_STALE_MS, RUNNING_NO_PROGRESS_STALE_MS || 0),
  });
}

function removeFile(file) {
  try { fs.unlinkSync(file); return true; } catch (_) { return false; }
}

function killProcessGroup(pid, signal) {
  Runtime.killProcessGroup(pid, signal);
}

async function terminateOrphanEngine(pid, meta = {}) {
  const result = await Runtime.terminateEngine(Number(pid), {
    eventlog,
    termGraceMs: ORPHAN_ENGINE_TERM_GRACE_MS,
    meta,
  });
  return result.attempted && !result.alive;
}

function updateWorkerPidHeartbeat() {
  if (!workerPidFile) return false;
  try {
    const cur = readJson(workerPidFile);
    if (!cur || Number(cur.pid) !== process.pid || cur.agent !== AGENT) return false;
    const now = new Date().toISOString();
    cur.heartbeat_at = now;
    cur.updated_at = now;
    writeJson(workerPidFile, cur);
    return true;
  } catch (_) {
    return false;
  }
}

function workerPidFileRecordOwned(record) {
  return !!(record && Number(record.pid) === process.pid && record.agent === AGENT);
}

function workerPidFileOwnership() {
  if (!workerPidFile) return { owned: false, record: null, pidFile: null };
  let record = null;
  try { record = readJson(workerPidFile); } catch (_) {}
  return {
    owned: workerPidFileRecordOwned(record),
    record,
    pidFile: workerPidFile,
  };
}

async function waitIfWorkerSuperseded(activeHandles) {
  const state = workerPidFileOwnership();
  if (state.owned) return false;
  if (!workerSupersededNoticeSent) {
    workerSupersededNoticeSent = true;
    eventlog.emit('queue.worker.superseded', {
      queueAgent: AGENT,
      pid: process.pid,
      activeCount: activeHandles.size,
      replacementPid: state.record && state.record.pid || null,
      action: activeHandles.size ? 'drain-then-exit' : 'exit',
    });
  }
  if (activeHandles.size) {
    await Promise.race([...activeHandles, sleep(1000)]);
    return true;
  }
  process.exit(0);
  return true;
}

function startWorkerPidHeartbeat(pidFile) {
  workerPidFile = pidFile;
  updateWorkerPidHeartbeat();
  if (workerHeartbeatTimer) clearInterval(workerHeartbeatTimer);
  workerHeartbeatTimer = setInterval(updateWorkerPidHeartbeat, WORKER_HEARTBEAT_MS);
  if (workerHeartbeatTimer.unref) workerHeartbeatTimer.unref();
}

function releaseWorkerPidFile() {
  if (!workerPidFile) return;
  try {
    const cur = readJson(workerPidFile);
    if (cur && Number(cur.pid) === process.pid && cur.agent === AGENT) fs.unlinkSync(workerPidFile);
  } catch (_) {}
}

process.once('exit', releaseWorkerPidFile);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    releaseWorkerPidFile();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

function cleanupPidFile(file, marker) {
  const cur = readJson(file);
  const pid = cur && cur.pid ? cur.pid : parseInt((() => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } })(), 10);
  if (pidLooksLike(pid, marker)) return false;
  if (removeFile(file)) {
    eventlog.emit('runtime.pid.swept', { file: path.basename(file), pid: pid || null, reason: pid ? 'dead-or-stale' : 'invalid' });
    return true;
  }
  return false;
}

function lockEventType(kind) {
  if (kind === 'slot') return 'engine.slot.swept';
  if (kind === 'runner_lock') return 'engine.runner_lock.swept';
  return 'engine.lock.swept';
}

function lockEventPayload(kind, file, record, reason, extra = {}) {
  const base = {
    queueAgent: record && record.agent || null,
    queueId: record && record.queueId || null,
    runnerType: record && record.runnerType || null,
    reason,
  };
  if (kind === 'slot') base.slot = path.basename(file);
  else if (kind === 'runner_lock') base.runnerType = record && record.runnerType || null;
  return Object.assign(base, extra || {});
}

async function releaseRuntimeLockFile(file, kind, reason, extra = {}) {
  const record = extra.record || readJson(file);
  const result = await Runtime.releaseLockFile(file, {
    record,
    kind,
    reason,
    queueRoot: QUEUE_ROOT,
    staleMs: ENGINE_LOCK_STALE_MS,
    runningStaleMs: Math.max(RUNNING_ENGINE_HEARTBEAT_STALE_MS, RUNNING_NO_PROGRESS_STALE_MS || 0),
    eventlog,
    termGraceMs: ORPHAN_ENGINE_TERM_GRACE_MS,
    meta: extra.meta || {},
  });
  if (result.released) {
    eventlog.emit(lockEventType(kind), lockEventPayload(kind, file, record, result.reason || reason, extra.event || {}));
  }
  return result;
}

async function releaseQueueRuntimeLocks(agent, queueId, reason, extra = {}) {
  const released = [];
  const blocked = [];
  const track = (result, file) => {
    if (result && result.released) released.push(path.basename(file));
    if (result && result.blocked) blocked.push(path.basename(file));
  };
  for (const s of listSlots()) {
    if (s.data.agent !== agent || s.data.queueId !== queueId) continue;
    const result = await releaseRuntimeLockFile(s.file, 'slot', reason, {
      record: s.data,
      meta: extra.meta,
      event: extra.event,
    });
    track(result, s.file);
  }
  for (const s of listRunnerTypeLocks()) {
    if (s.data.agent !== agent || s.data.queueId !== queueId) continue;
    const result = await releaseRuntimeLockFile(s.file, 'runner_lock', reason, {
      record: s.data,
      meta: extra.meta,
      event: extra.event,
    });
    track(result, s.file);
  }
  const legacy = readJson(LEGACY_ENGINE_LOCK);
  if (legacy && legacy.agent === agent && legacy.queueId === queueId) {
    const result = await releaseRuntimeLockFile(LEGACY_ENGINE_LOCK, 'legacy_engine_lock', reason, {
      record: legacy,
      meta: extra.meta,
      event: extra.event,
    });
    track(result, LEGACY_ENGINE_LOCK);
  }
  if (released.length) {
    eventlog.emit('engine.queue_locks.released', {
      queueAgent: agent,
      queueId,
      reason,
      locks: released,
    });
  }
  if (blocked.length) {
    eventlog.emit('engine.queue_locks.release_blocked', {
      queueAgent: agent,
      queueId,
      reason,
      locks: blocked,
    });
  }
  return { released, blocked, ok: blocked.length === 0 };
}

async function cleanupRuntimeLocks() {
  if (RESOURCE_DOMAIN_LOCKS_ENABLED) {
    await ResourceLocks.sweepStaleResourceLocks(RESOURCE_LOCKS, {
      eventlog,
      leaseMs: RESOURCE_LOCK_LEASE_MS,
    });
  }
  const legacy = readJson(LEGACY_ENGINE_LOCK);
  const legacyReason = lockSweepReason(legacy);
  if (legacyReason) {
    await releaseRuntimeLockFile(LEGACY_ENGINE_LOCK, 'legacy_engine_lock', legacyReason, { record: legacy });
  }
  for (const s of listSlots()) {
    const reason = lockSweepReason(s.data);
    if (!reason) continue;
    await releaseRuntimeLockFile(s.file, 'slot', reason, { record: s.data });
  }
  for (const s of listRunnerTypeLocks()) {
    const reason = lockSweepReason(s.data);
    if (!reason) continue;
    await releaseRuntimeLockFile(s.file, 'runner_lock', reason, { record: s.data });
  }
  sweepActiveCeoTaskLock('startup');
  try {
    const qroot = path.join(QUEUE_ROOT, 'queues');
    for (const agent of fs.readdirSync(qroot)) {
      if (!/^[\p{L}\p{N}_-]+$/u.test(agent)) continue;
      cleanupPidFile(path.join(qroot, agent, '.worker.pid'), 'ceo-worker.js');
    }
  } catch (_) {}
  try {
    for (const f of fs.readdirSync(QUEUE_ROOT).filter(x => /\.pid$/.test(x))) {
      const file = path.join(QUEUE_ROOT, f);
      if (f === 'nohup-test.pid') removeFile(file);
      else cleanupPidFile(file, '');
    }
  } catch (_) {}
}

async function acquireWorkerLock() {
  const dir = Q.qdir(QUEUE_ROOT, AGENT);
  const pidFile = path.join(dir, '.worker.pid');
  try {
    const cur = readJson(pidFile);
    if (cur && pidLooksLike(cur.pid, 'ceo-worker.js')) {
      console.log(`queue worker ${AGENT} already running pid=${cur.pid}`);
      process.exit(0);
    }
    fs.unlinkSync(pidFile);
  } catch (_) {}

  const payload = { pid: process.pid, agent: AGENT, started_at: new Date().toISOString() };
  try {
    writeJson(pidFile, payload, { flag: 'wx' });
    startWorkerPidHeartbeat(pidFile);
  } catch (e) {
    console.error(`cannot acquire ${AGENT} worker lock: ${e.message}`);
    process.exit(1);
  }

  const cleanup = () => {
    try {
      const cur = readJson(pidFile);
      if (cur && cur.pid === process.pid) fs.unlinkSync(pidFile);
    } catch (_) {}
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { cleanup(); process.exit(0); });
  }
}

function queuedEntryFiles(agent) {
  const d = Q.qdir(QUEUE_ROOT, agent);
  try {
    return fs.readdirSync(d)
      .filter(f => /\.json$/.test(f) && f !== '_seq')
      .sort()
      .map(f => path.join(d, f));
  } catch (_) {
    return [];
  }
}

function peekQueuedEntry(agent) {
  for (const file of queuedEntryFiles(agent)) {
    const entry = readJson(file);
    if (entry) return entry;
  }
  return null;
}

function queueAgents() {
  const qroot = path.join(QUEUE_ROOT, 'queues');
  try {
    return fs.readdirSync(qroot)
      .filter(isQueueAgentDirName);
  } catch (_) {
    return [];
  }
}

function entryBelongsToRoot(agent, entry, root) {
  if (!entry || !root || !root.rootQueueAgent || !root.rootQueueId) return false;
  if (agent === root.rootQueueAgent && entry.id === root.rootQueueId) return true;
  const payload = payloadFrom(entry);
  const rootQueueAgent = payload.rootQueueAgent || entry.rootQueueAgent || null;
  const rootQueueId = payload.rootQueueId || entry.rootQueueId || null;
  return rootQueueAgent === root.rootQueueAgent && rootQueueId === root.rootQueueId;
}

function activeRootEntries(root, opts = {}) {
  const out = [];
  const statuses = opts.includePaused ? ['queued', 'running', 'paused'] : ['queued', 'running'];
  for (const agent of queueAgents()) {
    let listed;
    try { listed = Q.list(QUEUE_ROOT, agent); } catch (_) { continue; }
    for (const status of statuses) {
      for (const entry of listed[status] || []) {
        if (!entryBelongsToRoot(agent, entry, root)) continue;
        if (isRootQueueEntry(agent, entry, root) && status !== 'running') continue;
        out.push({ agent, queueId: entry.id, status });
      }
    }
  }
  return out;
}

function queueEntriesForStatus(agent, status) {
  const d = Q.qdir(QUEUE_ROOT, agent);
  const dir = status === 'queued' ? d : path.join(d, status);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.json$/.test(f)).sort(); }
  catch (_) { return []; }
  return files.map(file => {
    const entry = readJson(path.join(dir, file));
    if (!entry) return null;
    return { agent, queueId: entry.id || file.replace(/\.json$/, '').replace(/^.*-/, ''), status, entry, file: path.join(dir, file) };
  }).filter(Boolean);
}

function downstreamItemKey(item) {
  return `${item && item.agent || ''}/${item && item.queueId || ''}`;
}

function dedupeDownstreamEntries(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    if (!item || !item.agent || !item.queueId) continue;
    const key = downstreamItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeDownstreamRefs(...groups) {
  const out = [];
  const seen = new Set();
  for (const group of groups || []) {
    for (const ref of group || []) {
      const agent = ref && (ref.agent || ref.queueAgent || ref.downstreamQueueAgent);
      const queueId = ref && (ref.queueId || ref.id || ref.downstreamQueueId);
      if (!agent || !queueId) continue;
      const key = `${agent}/${queueId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ agent, queueId });
    }
  }
  return out;
}

function refsFromDownstreamEntries(items) {
  return mergeDownstreamRefs((items || []).map(item => ({ agent: item.agent, queueId: item.queueId })));
}

function queuedEntryFileForId(agent, id) {
  const d = Q.qdir(QUEUE_ROOT, agent);
  try {
    const found = fs.readdirSync(d)
      .filter(f => /\.json$/.test(f) && f.endsWith(`-${id}.json`))
      .sort()[0];
    return found ? path.join(d, found) : null;
  } catch (_) {
    return null;
  }
}

function queueEntryById(agent, id, status) {
  if (!agent || !id || !status) return null;
  const d = Q.qdir(QUEUE_ROOT, agent);
  const file = status === 'queued'
    ? queuedEntryFileForId(agent, id)
    : path.join(d, status, `${id}.json`);
  if (!file || !fs.existsSync(file)) return null;
  const entry = readJson(file);
  if (!entry) return null;
  return { agent, queueId: entry.id || id, status, entry, file };
}

function queueEntriesForRefs(refs, statuses) {
  const out = [];
  for (const ref of refs || []) {
    const agent = ref && (ref.agent || ref.queueAgent);
    const queueId = ref && (ref.queueId || ref.id);
    if (!agent || !queueId) continue;
    for (const status of statuses || []) {
      const item = queueEntryById(agent, queueId, status);
      if (item) out.push(item);
    }
  }
  return out;
}

function downstreamRefsFromEvents(spec, root) {
  if (!spec || !root || !root.rootQueueAgent || !root.rootQueueId) return [];
  const taskId = spec.taskId || null;
  const refs = [];
  let lines = [];
  try { lines = fs.readFileSync(EVENTS, 'utf8').trim().split(/\r?\n/).filter(Boolean); }
  catch (_) { return refs; }
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    const type = ev && ev.type;
    if (!['project.routed', 'project.route.waiting', 'queue.enqueued'].includes(type)) continue;
    const taskMatches = !!taskId && (ev.task === taskId || ev.sourceTask === taskId);
    const rootMatches = ev.rootQueueAgent === root.rootQueueAgent && ev.rootQueueId === root.rootQueueId;
    if (!taskMatches && !rootMatches) continue;
    const agent = ev.queueAgent || ev.supervisorQueue || ev.downstreamQueueAgent || null;
    const queueId = ev.queueId || ev.downstreamQueueId || null;
    if (!agent || !queueId) continue;
    if (agent === root.rootQueueAgent && queueId === root.rootQueueId) continue;
    refs.push({ agent, queueId });
  }
  return mergeDownstreamRefs(refs);
}

function isRootQueueEntry(agent, entry, root) {
  return !!(root && agent === root.rootQueueAgent && entry && entry.id === root.rootQueueId);
}

function descendantEntriesForRoot(root, opts = {}) {
  if (!root || !root.rootQueueAgent || !root.rootQueueId) return [];
  const statuses = opts.statuses || ['queued', 'running', 'paused', 'done', 'failed', 'canceled'];
  const out = [];
  for (const agent of queueAgents()) {
    for (const item of statuses.flatMap(status => queueEntriesForStatus(agent, status))) {
      if (!entryBelongsToRoot(agent, item.entry, root)) continue;
      if (isRootQueueEntry(agent, item.entry, root)) continue;
      out.push(item);
    }
  }
  out.push(...queueEntriesForRefs(opts.refs || [], statuses));
  return dedupeDownstreamEntries(out);
}

function firstEntryReason(item) {
  const entry = item && item.entry || {};
  const taskId = entry.taskId || entry.task && entry.task.taskId || null;
  return sanitizeReason(entry.reason || entry.error || latestTaskFailureReason(taskId) || '');
}

function downstreamTaskId(item) {
  const entry = item && item.entry || {};
  const payload = payloadFrom(entry);
  return entry.taskId || payload.taskId || null;
}

function downstreamFlowId(item) {
  const entry = item && item.entry || {};
  const payload = payloadFrom(entry);
  return entry.flowId || payload.flowId || '';
}

function readTaskRecord(taskId) {
  if (!taskId) return null;
  return readJson(path.join(ARTIFACTS_ROOT, 'engine-tasks', `${taskId}.json`));
}

function completedNode(task, node) {
  if (!task) return false;
  if (task.last_completed_node === node) return true;
  if (task.visits && Number(task.visits[node]) > 0) return true;
  return Array.isArray(task.completed_steps) && task.completed_steps.some(step => String(step).startsWith(`${node}#`));
}

function collectText(value, out = [], depth = 0) {
  if (depth > 5 || value == null || out.length > 80) return out;
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, out, depth + 1);
  }
  return out;
}

const DELIVERY_NO_CHANGE_RE = /(不改任何文件|无需改文件|不用改文件|不要改任何文件|只读|调研|复盘|报告|评估|清单|说明|确认|冒烟|验证|审查)/i;
const DELIVERY_ACTION_RE = /(修复|修改|改造|实现|新增|接入|落地|合入|调整|重做|重构|代码|源码|文件|页面|布局|前端|UI|HTML|CSS|JS|workspace|server\.js|ceo-worker|shared\/engine|截图|Peekaboo)/i;

function extractManualMergeBlocks(text) {
  const s = String(text || '');
  const re = /(?:^|\n)\s*[—-]{3,}\s*\(合并:([^)]+)\)\s*[—-]{3,}\s*/g;
  const headers = [];
  let m;
  while ((m = re.exec(s))) {
    headers.push({ id: String(m[1] || '').trim(), start: m.index, bodyStart: re.lastIndex });
  }
  return headers.map((header, i) => {
    const next = headers[i + 1];
    return {
      id: header.id,
      text: s.slice(header.bodyStart, next ? next.start : s.length).trim(),
    };
  }).filter(block => block.id || block.text);
}

function appendMergedSummaries(value, out) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = [item.summary, item.goal, item.acceptance, item.bounds].filter(Boolean).join('\n');
    if (text.trim()) out.push(text);
  }
}

function mergedRequirementTexts(entry, task) {
  const payload = payloadFrom(entry || {});
  const vars = task && task.vars || {};
  const texts = [
    payload.goal,
    payload.acceptance,
    vars.goal,
    vars.acceptance,
  ].filter(Boolean);
  const out = [];
  for (const text of texts) {
    for (const block of extractManualMergeBlocks(text)) {
      if (block.text) out.push(block.text);
    }
  }
  appendMergedSummaries(payload.queueOrganizeMergedFrom, out);
  appendMergedSummaries(payload.queue_organize && payload.queue_organize.merged_from, out);
  appendMergedSummaries(entry && entry.queue_organize && entry.queue_organize.merged_from, out);
  return out;
}

function deliveryEvidenceRequired(entry, task) {
  const payload = payloadFrom(entry || {});
  const text = [
    payload.goal,
    payload.acceptance,
    task && task.vars && task.vars.goal,
    task && task.vars && task.vars.acceptance,
  ].filter(Boolean).join('\n');
  const mergedTexts = mergedRequirementTexts(entry, task);
  if (mergedTexts.some(s => DELIVERY_ACTION_RE.test(s))) return true;
  if (DELIVERY_NO_CHANGE_RE.test(text)) return false;
  return DELIVERY_ACTION_RE.test(text);
}

function hasDeliveryEvidence(task) {
  const vars = task && task.vars || {};
  const implementation = vars.implementation || {};
  if (Array.isArray(implementation.changed_files) && implementation.changed_files.length > 0) return true;
  const strings = collectText([implementation, task && task.evidence, task && task.steps]);
  return strings.some(s => /\.(png|jpe?g|webp|gif|pdf|patch|diff)\b/i.test(s)
    || /截图|screenshot|peekaboo|git diff|文件已修改|已落盘/i.test(s));
}

function validateSupervisorReviewDone(item) {
  if (!item || item.status !== 'done') return { ok: false, reason: 'downstream entry is not done', item };
  if (!/^supervisor-/.test(String(item.agent || ''))) {
    return { ok: false, reason: `${item.agent}/${item.queueId} 不是主管队列`, item };
  }
  const flowId = downstreamFlowId(item);
  if (flowId !== 'review-loop') {
    return { ok: false, reason: `${item.agent}/${item.queueId} flow=${flowId || 'unknown'} 不是 review-loop`, item };
  }
  const taskId = downstreamTaskId(item);
  const task = readTaskRecord(taskId);
  if (!task) return { ok: false, reason: `${item.agent}/${item.queueId} 缺少 engine-tasks/${taskId || 'unknown'}.json 复审记录`, item };
  if (task.flow !== 'review-loop' || task.state !== 'done') {
    return { ok: false, reason: `${item.agent}/${item.queueId} taskstore flow/state=${task.flow || 'unknown'}/${task.state || 'unknown'} 未完成 review-loop`, item };
  }
  if (!completedNode(task, 'implement') || !completedNode(task, 'review')) {
    return { ok: false, reason: `${item.agent}/${item.queueId} 未走完 implement + review 节点`, item };
  }
  const vars = task.vars || {};
  const implementation = vars.implementation || {};
  const review = vars.review || {};
  if (implementation.done !== true) {
    return { ok: false, reason: `${item.agent}/${item.queueId} implementation.done 未通过`, item };
  }
  if (review.pass !== true) {
    return { ok: false, reason: `${item.agent}/${item.queueId} review.pass 未通过`, item };
  }
  if (deliveryEvidenceRequired(item.entry, task) && !hasDeliveryEvidence(task)) {
    return { ok: false, reason: `${item.agent}/${item.queueId} 缺少 changed_files/截图/diff 等交付证据`, item };
  }
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: WORKDIR,
    requireDeliveryEvidence: deliveryEvidenceRequired(item.entry, task),
    executeEvidence: DoneGate.executeEvidenceEnabledFromEnv(), // P0-A:生产开关注入时真跑证据命令
    gitVerify: DoneGate.executeEvidenceEnabledFromEnv(),
    runnersConfig: CFG.runners || null, // 拍板⑤:特权写路径审计(告警模式)
  });
  if (!gate.ok) {
    return { ok: false, reason: `${item.agent}/${item.queueId} done gate 未通过: ${gate.reason}`, item, gate };
  }
  return { ok: true, reason: null, item, gate };
}

function summarizeDownstreamResult(root, opts = {}) {
  const refs = opts.refs || [];
  const failed = descendantEntriesForRoot(root, { statuses: ['failed'], refs });
  if (failed.length) {
    const item = failed[0];
    return { status: 'failed', ok: false, reason: firstEntryReason(item) || `下游队列失败: ${item.agent}/${item.queueId}`, entries: failed };
  }
  const canceled = descendantEntriesForRoot(root, { statuses: ['canceled'], refs });
  if (canceled.length) {
    const item = canceled[0];
    return { status: 'canceled', ok: false, reason: firstEntryReason(item) || `下游队列取消: ${item.agent}/${item.queueId}`, entries: canceled };
  }
  const paused = descendantEntriesForRoot(root, { statuses: ['paused'], refs });
  if (paused.length) {
    const item = paused[0];
    return { status: 'paused', ok: false, reason: firstEntryReason(item) || `下游队列暂停: ${item.agent}/${item.queueId}`, entries: paused };
  }
  const done = descendantEntriesForRoot(root, { statuses: ['done'], refs });
  if (done.length) {
    const checked = done.map(validateSupervisorReviewDone);
    const valid = checked.find(item => item.ok);
    if (valid) return { status: 'done', ok: true, reason: null, entries: [valid.item].concat(done.filter(item => item !== valid.item)) };
    const active = descendantEntriesForRoot(root, { statuses: ['queued', 'running'], refs });
    if (active.length) return null;
    const reason = checked.map(item => item.reason).filter(Boolean).slice(0, 3).join('; ') || '缺少主管 review-loop 复审通过证据';
    return { status: 'failed', ok: false, reason: `下游 done 被拦截: ${reason}`, entries: done, invalidDone: true };
  }
  return null;
}

function downstreamEntryFresh(item) {
  if (!item || !item.entry) return false;
  if (item.status === 'queued') return true;
  if (item.status !== 'running') return false;
  const heartbeat = runningEngineHeartbeat(item.entry);
  if (heartbeat.at) return !heartbeat.stale;
  return recordAgeMs(item.entry) <= RUNNING_ENGINE_HEARTBEAT_STALE_MS;
}

function activeDownstreamEntriesForRoot(root, opts = {}) {
  const active = descendantEntriesForRoot(root, { statuses: ['queued', 'running'], refs: opts.refs || [] });
  return {
    active,
    fresh: active.filter(downstreamEntryFresh),
  };
}

function touchRunningWaitingDownstream(entryOrId, spec, active = []) {
  try {
    const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
    if (!id) return null;
    const file = path.join(Q.qdir(QUEUE_ROOT, AGENT), 'running', `${id}.json`);
    const cur = readJson(file);
    if (!cur) return null;
    const now = new Date().toISOString();
    const root = lockRootForSpec(spec);
    const inFlight = (active || []).slice(0, 5).map(x => ({
      agent: x.agent,
      queueId: x.queueId,
      status: x.status,
      heartbeatAt: x.entry && (x.entry.engine_heartbeat_at || x.entry.heartbeat_at || x.entry.updated_at || x.entry.started_at) || null,
    }));
    cur.waiting_downstream = true;
    cur.downstream_waiting_at = cur.downstream_waiting_at || now;
    cur.downstream_heartbeat_at = now;
    cur.downstream_root = root;
    cur.downstream_inflight = inFlight;
    cur.downstream_inflight_count = (active || []).length;
    cur.lease_heartbeat_at = now;
    cur.lease_owner = cur.lease_owner || `worker:${process.pid}`;
    cur.lease_owner_pid = cur.lease_owner_pid || process.pid;
    cur.engine_heartbeat_at = now;
    cur.heartbeat_at = now;
    cur.updated_at = now;
    cur.enginePid = null;
    cur.engine_pid = null;
    writeJson(file, cur);
    return cur;
  } catch (_) {}
  return null;
}

function markRunningWaitingDownstream(entry, spec) {
  touchRunningWaitingDownstream(entry, spec, []);
}

async function waitForProjectRouteDownstream(spec, entry) {
  const root = lockRootForSpec(spec);
  if (!root) return { status: 'failed', ok: false, reason: 'project-route 缺少 rootQueue 信息,无法等待下游状态', entries: [] };
  markRunningWaitingDownstream(entry, spec);
  let knownRefs = downstreamRefsFromEvents(spec, root);
  let sawDescendant = knownRefs.length > 0;
  let missingKnownSince = null;
  const start = Date.now();
  let eventSeq = currentEngineEventSeq();
  const waitStats = {
    eventWakeCount: 0,
    fallbackWakeCount: 0,
    lastWakeEvent: null,
    eventWakeEnabled: PROJECT_ROUTE_EVENT_WAKE_ENABLED,
    activeFallbackMs: PROJECT_ROUTE_ACTIVE_FALLBACK_MS,
    discoveryFallbackMs: PROJECT_ROUTE_DISCOVERY_FALLBACK_MS,
  };
  const waitForWake = async (timeoutMs, phase) => {
    const wake = await waitForProjectRouteWake(spec, root, knownRefs, eventSeq, timeoutMs, phase);
    eventSeq = Math.max(eventSeq, Number(wake.seq || 0) || 0);
    if (wake.woke) {
      waitStats.eventWakeCount += 1;
      waitStats.lastWakeEvent = wake.event || null;
    } else {
      waitStats.fallbackWakeCount += 1;
    }
    return wake;
  };
  const finish = result => {
    try {
      eventlog.emit('project.route.wait.summary', {
        task: spec.taskId || null,
        queueAgent: spec.queueAgent || null,
        queueId: spec.queueId || null,
        rootQueueAgent: root.rootQueueAgent || null,
        rootQueueId: root.rootQueueId || null,
        rootTaskId: root.rootTaskId || null,
        status: result && result.status || null,
        durationMs: Date.now() - start,
        eventWakeCount: waitStats.eventWakeCount,
        fallbackWakeCount: waitStats.fallbackWakeCount,
        eventWakeEnabled: waitStats.eventWakeEnabled,
        activeFallbackMs: waitStats.activeFallbackMs,
        discoveryFallbackMs: waitStats.discoveryFallbackMs,
        lastWakeEvent: waitStats.lastWakeEvent,
      });
    } catch (_) {}
    return result;
  };
  while (true) {
    knownRefs = mergeDownstreamRefs(knownRefs, downstreamRefsFromEvents(spec, root));
    const summarized = summarizeDownstreamResult(root, { refs: knownRefs });
    if (summarized) return finish(summarized);
    const { active } = activeDownstreamEntriesForRoot(root, { refs: knownRefs });
    if (active.length) {
      sawDescendant = true;
      missingKnownSince = null;
      knownRefs = mergeDownstreamRefs(knownRefs, refsFromDownstreamEntries(active));
      touchRunningWaitingDownstream(entry, spec, active);
      await waitForWake(PROJECT_ROUTE_ACTIVE_FALLBACK_MS, 'active-downstream');
      continue;
    }
    touchRunningWaitingDownstream(entry, spec, []);
    if (!sawDescendant && Date.now() - start < PROJECT_ROUTE_CHILD_DISCOVERY_MS) {
      await waitForWake(PROJECT_ROUTE_DISCOVERY_FALLBACK_MS, 'discover-child');
      continue;
    }
    if (knownRefs.length) {
      if (missingKnownSince == null) missingKnownSince = Date.now();
      if (Date.now() - missingKnownSince < PROJECT_ROUTE_KNOWN_CHILD_MISSING_MS) {
        await waitForWake(PROJECT_ROUTE_DISCOVERY_FALLBACK_MS, 'known-child-missing');
        continue;
      }
      const known = knownRefs.map(ref => `${ref.agent}/${ref.queueId}`).join(',');
      return finish({
        status: 'failed',
        ok: false,
        reason: `project-route 下游队列已创建但未在任何状态找到,root=${root.rootQueueAgent}/${root.rootQueueId},known=${known}`,
        entries: [],
      });
    }
    return finish({
      status: 'failed',
      ok: false,
      reason: `project-route 未创建下游队列或 root 关联无法匹配,root=${root.rootQueueAgent}/${root.rootQueueId}`,
      entries: [],
    });
  }
}

function downstreamEventMeta(downstream) {
  const item = downstream && downstream.entries && downstream.entries[0] || null;
  const entry = item && item.entry || {};
  const meta = {
    downstreamQueueAgent: item && item.agent || null,
    downstreamQueueId: item && item.queueId || null,
    downstreamTaskId: entry.taskId || entry.task && entry.task.taskId || null,
  };
  if (downstream && downstream.invalidDone) {
    meta.doneGateBlocked = true;
    meta.doneGateReason = downstream.reason || null;
  }
  return meta;
}

function emitProjectRouteFinal(spec, downstream) {
  const meta = downstreamEventMeta(downstream);
  const base = Object.assign({
    task: spec.taskId,
    flow: spec.flowId,
    projectId: spec.projectId || null,
    rootQueueAgent: spec.rootQueueAgent || null,
    rootQueueId: spec.rootQueueId || null,
    rootTaskId: spec.rootTaskId || null,
    status: downstream.status,
  }, meta);
  if (downstream.status === 'done') {
    eventlog.emit('project.route.done', base);
    eventlog.emit('task.done', Object.assign({}, base, { loop: 1, evidence: 1 }));
  } else if (downstream.status === 'canceled') {
    eventlog.emit('project.route.canceled', Object.assign({}, base, { reason: downstream.reason || null }));
    eventlog.emit('task.canceled', Object.assign({}, base, { reason: downstream.reason || null }));
  } else if (downstream.status === 'paused') {
    eventlog.emit('project.route.paused', Object.assign({}, base, { reason: downstream.reason || null }));
  } else {
    eventlog.emit('project.route.failed', Object.assign({}, base, { reason: downstream.reason || null }));
    eventlog.emit('task.failed', Object.assign({}, base, { reason: downstream.reason || null }));
  }
}

function sameActiveRoot(a, b) {
  return !!(a && b && a.rootQueueAgent === b.rootQueueAgent && a.rootQueueId === b.rootQueueId);
}

function lockRootForCeoEntry(entry, spec) {
  return {
    rootQueueAgent: 'ceo',
    rootQueueId: entry.id,
    rootTaskId: spec && spec.taskId || null,
  };
}

function lockRootForSpec(spec) {
  if (spec && spec.rootQueueAgent && spec.rootQueueId) {
    return {
      rootQueueAgent: spec.rootQueueAgent,
      rootQueueId: spec.rootQueueId,
      rootTaskId: spec.rootTaskId || null,
    };
  }
  if (spec && spec.queueAgent === 'ceo' && spec.queueId) {
    return {
      rootQueueAgent: 'ceo',
      rootQueueId: spec.queueId,
      rootTaskId: spec.taskId || null,
    };
  }
  return null;
}

function sweepActiveCeoTaskLock(reason) {
  const lock = readJson(ACTIVE_CEO_TASK_LOCK);
  if (!lock) return { active: false, lock: null, entries: [] };
  const entries = activeRootEntries(lock);
  if (entries.length) return { active: true, lock, entries };
  if (removeFile(ACTIVE_CEO_TASK_LOCK)) {
    eventlog.emit('ceo.active_task.swept', {
      rootQueueAgent: lock.rootQueueAgent || null,
      rootQueueId: lock.rootQueueId || null,
      rootTaskId: lock.rootTaskId || null,
      reason: reason || 'no-in-flight-descendants',
    });
  }
  return { active: false, lock, entries: [] };
}

async function waitForCeoActiveTaskTurn(nextEntry) {
  let loggedWait = false;
  let lastWaitSweep = 0;
  while (true) {
    const now = Date.now();
    if (now - lastWaitSweep >= RUNNING_SWEEP_MS) {
      lastWaitSweep = now;
      await sweepStaleRunning();
    }
    const lock = readJson(ACTIVE_CEO_TASK_LOCK);
    if (!lock) return;
    if (lock.rootQueueAgent === 'ceo' && lock.rootQueueId === nextEntry.id) return;
    const swept = sweepActiveCeoTaskLock('completed-before-next-ceo');
    if (!swept.active) {
      loggedWait = false;
      continue;
    }
    if (!loggedWait) {
      loggedWait = true;
      eventlog.emit('ceo.active_task.wait', {
        waitingQueueAgent: 'ceo',
        waitingQueueId: nextEntry.id,
        activeRootQueueAgent: swept.lock.rootQueueAgent || null,
        activeRootQueueId: swept.lock.rootQueueId || null,
        activeRootTask: swept.lock.rootTaskId || null,
        inFlight: swept.entries.slice(0, 5),
        inFlightCount: swept.entries.length,
      });
    }
    await sleep(800);
  }
}

function acquireActiveCeoTask(entry, spec) {
  if (AGENT !== 'ceo') return null;
  fs.mkdirSync(path.dirname(ACTIVE_CEO_TASK_LOCK), { recursive: true });
  const root = lockRootForCeoEntry(entry, spec);
  while (true) {
    const current = readJson(ACTIVE_CEO_TASK_LOCK);
    if (sameActiveRoot(current, root)) return current;
    if (current) {
      const entries = activeRootEntries(current);
      if (entries.length) {
        throw new Error(`active CEO task still running: ${current.rootQueueAgent}/${current.rootQueueId}`);
      }
      try { fs.unlinkSync(ACTIVE_CEO_TASK_LOCK); } catch (_) {}
    }
    const payload = Object.assign({}, root, {
      queueAgent: 'ceo',
      queueId: entry.id,
      pid: process.pid,
      ownerPid: process.pid,
      projectId: spec && spec.projectId || null,
      started_at: new Date().toISOString(),
    });
    try {
      writeJson(ACTIVE_CEO_TASK_LOCK, payload, { flag: 'wx' });
      eventlog.emit('ceo.active_task.acquired', {
        rootQueueAgent: payload.rootQueueAgent,
        rootQueueId: payload.rootQueueId,
        rootTaskId: payload.rootTaskId,
        projectId: payload.projectId || null,
      });
      return payload;
    } catch (_) {}
  }
}

function releaseActiveCeoTaskIfComplete(spec, reason) {
  const root = lockRootForSpec(spec);
  const lock = readJson(ACTIVE_CEO_TASK_LOCK);
  if (!sameActiveRoot(root, lock)) return;
  const entries = activeRootEntries(lock);
  if (entries.length) {
    eventlog.emit('ceo.active_task.still_active', {
      rootQueueAgent: lock.rootQueueAgent,
      rootQueueId: lock.rootQueueId,
      rootTaskId: lock.rootTaskId || null,
      inFlight: entries.slice(0, 5),
      inFlightCount: entries.length,
    });
    return;
  }
  if (removeFile(ACTIVE_CEO_TASK_LOCK)) {
    eventlog.emit('ceo.active_task.released', {
      rootQueueAgent: lock.rootQueueAgent,
      rootQueueId: lock.rootQueueId,
      rootTaskId: lock.rootTaskId || null,
      reason: reason || 'root-complete',
    });
  }
}

function slotFile(k) {
  return path.join(ENGINE_SLOTS, `slot-${k}.json`);
}

function slotAlive(slot) {
  return lockValid(slot);
}

function listSlots() {
  try {
    fs.mkdirSync(ENGINE_SLOTS, { recursive: true });
    return fs.readdirSync(ENGINE_SLOTS)
      .filter(f => /^slot-\d+\.json$/.test(f))
      .map(f => ({ file: path.join(ENGINE_SLOTS, f), data: readJson(path.join(ENGINE_SLOTS, f)) }))
      .filter(s => s.data);
  } catch (_) {
    return [];
  }
}

function runnerTypeLockFile(runnerType) {
  const safe = String(runnerType || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';
  return path.join(ENGINE_TYPE_LOCKS, `runner-${safe}.json`);
}

function listRunnerTypeLocks() {
  try {
    fs.mkdirSync(ENGINE_TYPE_LOCKS, { recursive: true });
    return fs.readdirSync(ENGINE_TYPE_LOCKS)
      .filter(f => /^runner-[A-Za-z0-9_-]+\.json$/.test(f))
      .map(f => ({ file: path.join(ENGINE_TYPE_LOCKS, f), data: readJson(path.join(ENGINE_TYPE_LOCKS, f)) }))
      .filter(s => s.data);
  } catch (_) {
    return [];
  }
}

async function cleanupDeadSlots() {
  for (const s of listSlots()) {
    const reason = lockSweepReason(s.data);
    if (!reason) continue;
    await releaseRuntimeLockFile(s.file, 'slot', reason, { record: s.data });
  }
}

async function cleanupDeadRunnerTypeLocks() {
  for (const s of listRunnerTypeLocks()) {
    const reason = lockSweepReason(s.data);
    if (!reason) continue;
    await releaseRuntimeLockFile(s.file, 'runner_lock', reason, { record: s.data });
  }
}

function envEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw == null) return !!defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw || ''));
}

function rolloutPercent(route) {
  const rollout = route && route.rollout && typeof route.rollout === 'object' ? route.rollout : {};
  const envName = rollout.envOverride || route.rolloutPercentEnv;
  const raw = envName && process.env[envName] != null ? process.env[envName] : (rollout.percent != null ? rollout.percent : route.rolloutPercent);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function rolloutBucket(role, route, spec = {}) {
  const key = [
    role,
    spec.taskId || spec.id || '',
    spec.queueAgent || AGENT || '',
    spec.queueId || '',
    String(spec.goal || spec.message || '').slice(0, 300),
  ].join('|');
  const hex = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

function routeRunnerForRole(role, route, spec = {}) {
  if (!route || !route.runner) return null;
  const rollout = route.rollout && typeof route.rollout === 'object' ? route.rollout : {};
  const disableEnv = String(rollout.disableEnv || route.disableEnv || '').split('=')[0];
  const fallbackRunner = rollout.rollbackRunner || route.rollbackRunner || route.fallbackRunner || route.runner;
  if (disableEnv && !envEnabled(disableEnv, true)) return fallbackRunner;
  const percent = rolloutPercent(route);
  if (percent <= 0) return fallbackRunner;
  if (percent >= 100) return route.runner;
  return rolloutBucket(role, route, spec) < percent ? route.runner : fallbackRunner;
}

function runnerTypeForRole(role, spec = {}) {
  const route = (CFG.roleRouting || {})[role] || {};
  return routeRunnerForRole(role, route, spec) || DEFAULT_ROLE_MAP[role] || 'codex';
}

function runnerTypeForEntry(entry) {
  const payload = payloadFrom(entry);
  return runnerTypeForRole(payload.role || roleFromAgent(AGENT), Object.assign({}, payload, { id: entry && entry.id, queueId: entry && entry.id, queueAgent: AGENT }));
}

function roleForAgentEntry(agent, entry) {
  const payload = payloadFrom(entry || {});
  if (/^supervisor-/.test(String(agent || ''))) return 'supervisor';
  if (agent === 'ceo') return 'orchestrator';
  return payload.role || roleFromAgent(agent);
}

function runnerTypeForAgentEntry(agent, entry) {
  const payload = payloadFrom(entry || {});
  return payload.runnerType || payload.runner || runnerTypeForRole(roleForAgentEntry(agent, entry), Object.assign({}, payload, { id: entry && entry.id, queueId: entry && entry.id, queueAgent: agent }));
}

function quotaBucketForEntry(entry, runnerType) {
  const payload = payloadFrom(entry || {});
  return payload.quotaBucket || payload.quota_bucket || payload.runnerQuotaBucket || payload.runner_quota_bucket || runnerType || null;
}

function quotaScopeForAgentEntry(agent, entry, runnerTypeHint = null) {
  const runnerType = runnerTypeHint || runnerTypeForAgentEntry(agent, entry);
  const bucket = quotaBucketForEntry(entry, runnerType);
  return QuotaDegrade.bucketScope(bucket && bucket !== runnerType ? bucket : null, runnerType);
}

function quotaScopeForSpec(spec, entry, runnerTypeHint = null) {
  const runnerType = runnerTypeHint || runnerTypeForRole(spec && spec.role || roleFromAgent(AGENT), Object.assign({}, spec || {}, { id: entry && entry.id, queueId: entry && entry.id, queueAgent: AGENT }));
  const bucket = quotaBucketForEntry(entry || { task: spec || {} }, runnerType);
  return QuotaDegrade.bucketScope(bucket && bucket !== runnerType ? bucket : null, runnerType);
}

function isQuotaScopePausedForEntry(agent, entry, runnerTypeHint = null) {
  if (!QUOTA_DEGRADE_ENABLED) return { paused: false, scope: null, state: null };
  const scope = quotaScopeForAgentEntry(agent, entry, runnerTypeHint);
  const state = QuotaDegrade.readState(ARTIFACTS_ROOT, scope);
  // 调度层额度门:用 breakerDecision(计入 retry_after)而非裸 statePaused(只看 status)。
  // 根因修复(2026-07-06 停机):statePaused 对 degraded 恒真,retry_after 过期后调度层仍无限 block,
  // 而恢复所需的试探(probe)在 cli-runner,任务被挡在调度层永远到不了 cli-runner → degraded 死锁、all_blocked 空转。
  // breakerDecision:retry_after 未到→blocked(仍等);过期→{blocked:false,probe:true}(放行,让 cli-runner 跑一次 probe 自愈);
  // 人工 degraded 无 retry_after→blocked(维持等人工 restore)。三种既有语义不变,只补"退避过期即放行试探"这条自愈路径。
  const decision = QuotaDegrade.breakerDecision(state);
  return {
    paused: !!decision.blocked,
    probe: !!decision.probe,
    scope,
    state,
  };
}

function shouldBypassEngineSlot(entry, spec, runnerType) {
  const payload = payloadFrom(entry);
  return AGENT === 'repair-lead'
    || AGENT === 'repair'
    || AGENT === 'cleanup'
    || spec && spec.role === 'repair-lead'
    || spec && spec.role === 'repair'
    || spec && spec.role === 'cleanup'
    || payload.role === 'repair-lead'
    || payload.role === 'repair'
    || payload.role === 'cleanup'
    || payload.privileged === true
    || payload.engineSlotBypass === true
    || payload.bypassEngineSlot === true
    || String(runnerType || '') === 'repair-bypass';
}

function bypassEngineSlot(entry, runnerType) {
  eventlog.emit('engine.slot.bypassed', {
    queueAgent: AGENT,
    queueId: entry.id,
    runnerType,
    reason: 'privileged-repair-channel',
  });
  return {
    file: null,
    runnerType,
    bypassed: true,
    release() {
      eventlog.emit('engine.slot.bypass_released', {
        queueAgent: AGENT,
        queueId: entry.id,
        runnerType,
      });
    },
  };
}

async function acquireRunnerTypeLock(entry, runnerType) {
  if (!RUNNER_SINGLEFLIGHT.has(runnerType)) {
    return {
      file: null,
      release() {},
    };
  }
  fs.mkdirSync(ENGINE_TYPE_LOCKS, { recursive: true });
  const file = runnerTypeLockFile(runnerType);
  let loggedWait = false;
  while (true) {
    await cleanupDeadRunnerTypeLocks();
    const cur = readJson(file);
    if (cur && lockValid(cur)) {
      if (!loggedWait) {
        loggedWait = true;
        eventlog.emit('engine.slot.wait', { queueAgent: AGENT, queueId: entry.id, runnerType, reason: 'runner-singleflight' });
      }
      await sleep(700);
      continue;
    }
    if (cur) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
    const payload = {
      pid: process.pid,
      ownerPid: process.pid,
      agent: AGENT,
      queueId: entry.id,
      runnerType,
      started_at: new Date().toISOString(),
    };
    try {
      writeJson(file, payload, { flag: 'wx' });
      eventlog.emit('engine.runner_lock.acquired', { queueAgent: AGENT, queueId: entry.id, runnerType });
      return {
        file,
        release() {
          try {
            const cur2 = readJson(file);
            if (cur2 && cur2.ownerPid === process.pid && cur2.queueId === entry.id) {
              if (Runtime.engineAliveForRecord(cur2)) {
                eventlog.emit('engine.runner_lock.release_blocked', {
                  queueAgent: AGENT,
                  queueId: entry.id,
                  runnerType,
                  reason: 'engine still alive',
                  enginePid: Runtime.enginePidFromRecord(cur2) || null,
                });
                return;
              }
              fs.unlinkSync(file);
            }
          } catch (_) {}
          eventlog.emit('engine.runner_lock.released', { queueAgent: AGENT, queueId: entry.id, runnerType });
        },
      };
    } catch (_) {
      await sleep(300);
    }
  }
}

async function acquireEngineSlot(entry, runnerType) {
  fs.mkdirSync(ENGINE_SLOTS, { recursive: true });
  let loggedWait = false;
  while (true) {
    await cleanupDeadSlots();
    for (let i = 0; i < ENGINE_MAX_CONCURRENCY; i++) {
      const file = slotFile(i);
      const cur = readJson(file);
      if (cur && lockValid(cur)) continue;
      if (cur) {
        try { fs.unlinkSync(file); } catch (_) {}
      }
      const payload = {
        pid: process.pid,
        ownerPid: process.pid,
        agent: AGENT,
        queueId: entry.id,
        runnerType,
        started_at: new Date().toISOString(),
      };
      try {
        writeJson(file, payload, { flag: 'wx' });
        eventlog.emit('engine.slot.acquired', {
          queueAgent: AGENT,
          queueId: entry.id,
          runnerType,
          slot: path.basename(file),
          maxConcurrency: ENGINE_MAX_CONCURRENCY,
        });
        return {
          file,
          runnerType,
          release() {
            try {
              const cur2 = readJson(file);
              if (cur2 && cur2.ownerPid === process.pid && cur2.queueId === entry.id) {
                if (Runtime.engineAliveForRecord(cur2)) {
                  eventlog.emit('engine.slot.release_blocked', {
                    queueAgent: AGENT,
                    queueId: entry.id,
                    runnerType,
                    slot: path.basename(file),
                    reason: 'engine still alive',
                    enginePid: Runtime.enginePidFromRecord(cur2) || null,
                  });
                  return;
                }
                fs.unlinkSync(file);
              }
            } catch (_) {}
            eventlog.emit('engine.slot.released', { queueAgent: AGENT, queueId: entry.id, runnerType, slot: path.basename(file) });
          },
        };
      } catch (_) {}
    }
    if (!loggedWait) {
      loggedWait = true;
      eventlog.emit('engine.slot.wait', { queueAgent: AGENT, queueId: entry.id, runnerType, reason: 'capacity' });
    }
    await sleep(700);
  }
}

function sanitizeFlow(flowId) {
  return String(flowId || 'review-loop').replace(/[^A-Za-z0-9_-]/g, '') || 'review-loop';
}

function listProjects() {
  try {
    return fs.readdirSync(PROJECTS_DIR)
      .filter(name => !name.startsWith('_'))
      .filter(name => {
        try { return fs.statSync(path.join(PROJECTS_DIR, name)).isDirectory(); }
        catch (_) { return false; }
      })
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return ['控制台'];
  }
}

function normalizeProjectId(projectId) {
  const projects = listProjects();
  const raw = String(projectId || '').trim();
  if (!raw) return null;
  if (isUnregisteredProjectId(raw)) return null;
  const exact = projects.find(p => p === raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  return projects.find(p => p.toLowerCase() === lower) || null;
}

function defaultProjectId() {
  return normalizeProjectId('控制台') || listProjects()[0] || '控制台';
}

function normalizeKeywordProjectId(text) {
  const registered = registeredProjectFromText(text, listProjects());
  if (registered) return registered;
  const candidate = keywordProjectId(text);
  return candidate ? (normalizeProjectId(candidate) || candidate) : null;
}

function inferProjectId(payload) {
  const rawText = [payload && payload.goal, payload && payload.message, payload && payload.task]
    .filter(Boolean).join('\n');
  if (isUnregisteredProjectId(payload && payload.projectId)) return null;
  const explicit = normalizeProjectId(payload && payload.projectId);
  if (explicit) return explicit;
  if (hasActiveUnregisteredProjectReference(rawText)) return null;
  const keyword = normalizeKeywordProjectId(rawText);
  if (keyword) return keyword;
  return defaultProjectId();
}

function projectFromAgent(agent) {
  const m = String(agent || '').match(/^supervisor-(.+)$/);
  return m ? normalizeProjectId(m[1]) || m[1] : null;
}

function supervisorQueue(projectId) {
  return `supervisor-${projectId}`;
}

function roleFromAgent(agent) {
  if (agent === 'secretary') return 'secretary';
  if (/^supervisor-/.test(String(agent || ''))) return 'supervisor';
  return agent === 'ceo' ? 'orchestrator' : agent;
}

function payloadFrom(entry) {
  if (entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)) return entry.task;
  return { goal: String((entry && entry.task) || '') };
}

function readRunningEntry(id) {
  const file = path.join(Q.qdir(QUEUE_ROOT, AGENT), 'running', `${id}.json`);
  return readJson(file);
}

function buildGoal(base, steer) {
  const goal = String(base || '').trim();
  if (!Array.isArray(steer) || !steer.length) return goal;
  const lines = steer
    .filter(s => s && s.msg)
    .map(s => `- [${s.at || 'unknown'}] ${String(s.msg)}`);
  if (!lines.length) return goal;
  return `${goal}\n\n队列引导消息(启动前已注入):\n${lines.join('\n')}`;
}

function attachmentInputPaths(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map(a => a && a.path)
    .filter(Boolean);
}

function mergeInputs(inputs, attachments) {
  const out = Array.isArray(inputs) ? inputs.slice() : [];
  for (const p of attachmentInputPaths(attachments)) if (!out.includes(p)) out.push(p);
  return out;
}

function structuredAcceptanceForTask(goal, acceptance, projectId) {
  return DoneGate.buildStructuredAcceptanceTable({
    goal,
    acceptance: acceptance || DEFAULT_ACCEPTANCE,
    projectId,
    workspaceRoot: WORKDIR,
    templatePath: DoneGate.structuredAcceptanceTemplatePath({ workspaceRoot: WORKDIR }),
  });
}

function makeSpec(entry) {
  const latest = readRunningEntry(entry.id) || entry;
  const payload = payloadFrom(latest);
  const initialSteer = Array.isArray(latest.steer) ? latest.steer : [];
  const existingTaskId = latest.taskId || payload.taskId || null;
  const shouldResumeTask = !!existingTaskId && !!(latest.recovered_at || latest.recovered_reason || latest.lease_stale_at || latest.resumed_at || payload.resumeTask);
  const taskId = shouldResumeTask ? existingTaskId : `cr-${Date.now()}-${entry.id}`;
  const rawGoal = payload.goal || payload.message || payload.task || latest.task || '';
  const projectId = isUnregisteredProjectId(payload.projectId)
    ? null
    : (normalizeProjectId(payload.projectId) || projectFromAgent(AGENT) || inferProjectId(payload));
  const projectMode = AGENT === 'ceo' && payload.projectMode !== false;
  const scoped = /^supervisor-/.test(AGENT);
  const rootQueueAgent = payload.rootQueueAgent || (AGENT === 'ceo' ? 'ceo' : null);
  const rootQueueId = payload.rootQueueId || (AGENT === 'ceo' ? entry.id : null);
  const rootTaskId = payload.rootTaskId || (AGENT === 'ceo' ? taskId : null);
  const spec = {
    taskId,
    queueAgent: AGENT,
    queueId: entry.id,
    rootQueueAgent,
    rootQueueId,
    rootTaskId,
    parentTaskId: payload.parentTaskId || null,
    consumedSteer: initialSteer.length,
    flowId: projectMode ? 'project-route' : sanitizeFlow(payload.flowId || 'review-loop'),
    role: scoped ? 'supervisor' : (payload.role || roleFromAgent(AGENT)),
    projectId,
    title: payload.title || payload.shortTitle || payload.name || payload.idem || null,
    summary: payload.summary || null,
    idem: payload.idem || null,
    scopedToProject: scoped ? projectId : !!payload.scopedToProject,
    goal: buildGoal(rawGoal, initialSteer),
    bounds: payload.bounds || DEFAULT_BOUNDS,
    inputs: mergeInputs(payload.inputs, payload.attachments),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    acceptance: structuredAcceptanceForTask(rawGoal, payload.acceptance || DEFAULT_ACCEPTANCE, projectId),
    useOrchestrator: payload.useOrchestrator !== false,
    autoApproveHuman: payload.autoApproveHuman !== false,
    nodeTimeoutSec: payload.nodeTimeoutSec || payload.timeoutSec || null,
  };
  spec.resourceDomains = ResourceLocks.normalizeResourceRequest(Object.assign({}, payload, spec), {
    taskPatch: { queueAgent: AGENT },
  }).resourceDomains;
  return spec;
}

function resourceLockTaskForQueuedEntry(entry) {
  const payload = payloadFrom(entry);
  const rawGoal = payload.goal || payload.message || payload.task || entry.task || '';
  const projectId = isUnregisteredProjectId(payload.projectId)
    ? null
    : (normalizeProjectId(payload.projectId) || projectFromAgent(AGENT) || inferProjectId(payload));
  const scoped = /^supervisor-/.test(AGENT);
  return Object.assign({}, payload, {
    queueAgent: AGENT,
    queueId: entry.id,
    role: scoped ? 'supervisor' : (payload.role || roleFromAgent(AGENT)),
    projectId,
    title: payload.title || payload.shortTitle || payload.name || payload.idem || null,
    summary: payload.summary || null,
    goal: rawGoal,
    inputs: mergeInputs(payload.inputs, payload.attachments),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  });
}

function resourceReservationItems() {
  return Array.from(resourceSchedulerReservations.values());
}

function requestConflictsWithReservations(entry, request) {
  if (!request || request.privileged || !request.domains.length) return false;
  const task = Object.assign({}, resourceLockTaskForQueuedEntry(entry), {
    resourceDomains: request.resourceDomains,
  });
  const plan = ResourceLocks.planRunnableTasks([{ id: entry.id, task }], resourceReservationItems());
  return !plan.runnable.some(item => item.id === entry.id);
}

function reserveClaimedResource(entry, request) {
  if (!entry || !request || request.privileged || !request.domains.length) return;
  resourceSchedulerReservations.set(entry.id, {
    id: entry.id,
    task: resourceLockTaskForQueuedEntry(entry),
    request,
    reserved_at: new Date().toISOString(),
  });
}

function releaseClaimedResourceReservation(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  if (id) resourceSchedulerReservations.delete(id);
}

function workerClaimOptions() {
  return {
    owner: `worker:${process.pid}`,
    ownerPid: process.pid,
    leaseMs: RUNNING_ENGINE_HEARTBEAT_STALE_MS,
  };
}

async function claimNextRunnableEntry() {
  const claimOpts = workerClaimOptions();
  if (!RESOURCE_DOMAIN_LOCKS_ENABLED) {
    return Q.claim(QUEUE_ROOT, AGENT, Object.assign({}, claimOpts, {
      match: entry => !isQuotaScopePausedForEntry(AGENT, entry).paused,
    }));
  }
  let queued = [];
  try {
    queued = Q.list(QUEUE_ROOT, AGENT).queued || [];
  } catch (_) {
    return Q.claim(QUEUE_ROOT, AGENT, claimOpts);
  }
  if (!queued.length) return null;

  const runnableIds = new Set();
  const runnableRequests = new Map();
  const blocked = [];
  for (const entry of queued) {
    const quotaPause = isQuotaScopePausedForEntry(AGENT, entry);
    if (quotaPause.paused) {
      blocked.push({
        queueId: entry.id,
        read: [],
        write: [],
        conflicts: [],
        reason: 'quota-degraded',
        quotaScope: quotaPause.scope && quotaPause.scope.key || null,
      });
      continue;
    }
    let probe;
    const task = resourceLockTaskForQueuedEntry(entry);
    try {
      probe = await ResourceLocks.currentResourceConflicts(task, {
        locksRoot: RESOURCE_LOCKS,
        eventlog,
        leaseMs: RESOURCE_LOCK_LEASE_MS,
        coordinatorTimeoutMs: 1000,
      });
    } catch (e) {
      if (Date.now() - resourceSchedulerLastProbeFailedAt > 10 * 1000) {
        resourceSchedulerLastProbeFailedAt = Date.now();
        eventlog.emit('resource.scheduler.probe_failed', {
          queueAgent: AGENT,
          reason: sanitizeReason(e.message),
          action: 'fallback-head-claim',
        });
      }
      return Q.claim(QUEUE_ROOT, AGENT, claimOpts);
    }
    if (probe.available && !requestConflictsWithReservations(entry, probe.request)) {
      runnableIds.add(entry.id);
      runnableRequests.set(entry.id, probe.request);
    } else {
      blocked.push({
        queueId: entry.id,
        read: probe.request.read,
        write: probe.request.write,
        conflicts: probe.conflicts.slice(0, 6),
        reason: probe.available ? 'reserved-by-local-worker' : 'resource-lock-conflict',
      });
    }
  }

  if (!runnableIds.size) {
    if (Date.now() - resourceSchedulerLastBlockedAt > 10 * 1000) {
      resourceSchedulerLastBlockedAt = Date.now();
      eventlog.emit('resource.scheduler.all_blocked', Object.assign({
        queueAgent: AGENT,
        blocked: blocked.slice(0, 8),
      }, DailyIgnition.dailyIgnitionEventFields(Date.now())));
    }
    return null;
  }

  const firstQueuedId = queued[0] && queued[0].id;
  const entry = Q.claim(QUEUE_ROOT, AGENT, Object.assign({}, claimOpts, {
    match: item => runnableIds.has(item.id),
  }));
  if (entry && firstQueuedId && firstQueuedId !== entry.id) {
    eventlog.emit('resource.scheduler.selected_later', {
      queueAgent: AGENT,
      queueId: entry.id,
      skippedBefore: queued.findIndex(item => item.id === entry.id),
      blocked: blocked.slice(0, 8),
    });
  }
  if (entry) reserveClaimedResource(entry, runnableRequests.get(entry.id));
  return entry;
}

function noteRunningEnginePid(entry, pid) {
  try {
    const now = new Date().toISOString();
    const cur = Q.touchLease(QUEUE_ROOT, AGENT, entry.id, {
      owner: `worker:${process.pid}`,
      ownerPid: process.pid,
      leaseMs: RUNNING_ENGINE_HEARTBEAT_STALE_MS,
      enginePid: pid,
      engine_heartbeat_at: now,
      engine_started_at: readRunningEntry(entry.id) && readRunningEntry(entry.id).engine_started_at || now,
    });
    return cur;
  } catch (_) {}
  return null;
}

function noteRunningSpec(entry, spec) {
  try {
    const cur = readRunningEntry(entry.id);
    if (!cur) return;
    cur.taskId = spec.taskId;
    cur.projectId = spec.projectId || cur.projectId || null;
    cur.flowId = spec.flowId || cur.flowId || null;
    cur.role = spec.role || cur.role || null;
    cur.rootQueueAgent = spec.rootQueueAgent || cur.rootQueueAgent || null;
    cur.rootQueueId = spec.rootQueueId || cur.rootQueueId || null;
    cur.rootTaskId = spec.rootTaskId || cur.rootTaskId || null;
    cur.parentTaskId = spec.parentTaskId || cur.parentTaskId || null;
    cur.resourceDomains = spec.resourceDomains || cur.resourceDomains || null;
    if (Array.isArray(spec.attachments)) cur.attachments = spec.attachments;
    Q.touchLease(QUEUE_ROOT, AGENT, entry.id, Object.assign(cur, {
      owner: `worker:${process.pid}`,
      ownerPid: process.pid,
      leaseMs: RUNNING_ENGINE_HEARTBEAT_STALE_MS,
    }));
  } catch (_) {}
}

function touchPreEngineWaitHeartbeat(entry, phase = null) {
  try {
    const now = new Date().toISOString();
    return Q.touchLease(QUEUE_ROOT, AGENT, entry.id, {
      owner: `worker:${process.pid}`,
      ownerPid: process.pid,
      leaseMs: RUNNING_ENGINE_HEARTBEAT_STALE_MS,
      pre_engine_waiting: true,
      pre_engine_wait_phase: phase,
      pre_engine_wait_heartbeat_at: now,
    });
  } catch (_) {}
  return null;
}

function startPreEngineWaitHeartbeat(entry, phase) {
  touchPreEngineWaitHeartbeat(entry, phase);
  const intervalMs = Math.max(1000, Math.min(ENGINE_LEASE_HEARTBEAT_MS, Math.floor(RUNNING_ENGINE_HEARTBEAT_STALE_MS / 3)));
  const timer = setInterval(() => touchPreEngineWaitHeartbeat(entry, phase), intervalMs);
  if (timer.unref) timer.unref();
  return () => {
    clearInterval(timer);
    try {
      Q.touchLease(QUEUE_ROOT, AGENT, entry.id, {
        owner: `worker:${process.pid}`,
        ownerPid: process.pid,
        leaseMs: RUNNING_ENGINE_HEARTBEAT_STALE_MS,
        pre_engine_waiting: false,
        pre_engine_wait_phase: null,
      });
    } catch (_) {}
  };
}

function noteEnginePid(entry, lease, pid, specFile = null) {
  noteRunningEnginePid(entry, pid);
  const now = new Date().toISOString();
  for (const file of [lease.file, lease.typeLockFile].filter(Boolean)) {
    try {
      const cur = readJson(file);
      if (!cur || cur.ownerPid !== process.pid || cur.queueId !== entry.id) continue;
      cur.enginePid = pid;
      cur.engineSpecFile = specFile || cur.engineSpecFile || null;
      if (specFile) cur.taskId = path.basename(specFile, '.json');
      cur.updated_at = now;
      cur.heartbeat_at = now;
      writeJson(file, cur);
    } catch (_) {}
  }
}

function runEngine(specFile, entry, lease) {
  return new Promise(resolve => {
    fs.mkdirSync(path.dirname(ENGINE_LOG), { recursive: true });
    const fd = fs.openSync(ENGINE_LOG, 'a');
    let settled = false;
    let canceling = false;
    let forcedStopReason = null;
    let forcedStopKind = null;
    let poll = null;
    let killTimer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (killTimer) clearTimeout(killTimer);
      try { fs.closeSync(fd); } catch (_) {}
      resolve(result);
    };
    let child;
    try {
      child = spawn(RuntimePaths.nodeBin(), [path.join(ROOT, 'engine-runner.js'), '--spec', specFile], {
        cwd: ROOT,
        env: RuntimePaths.applyRuntimeEnv(process.env),
        detached: true,
        stdio: ['ignore', fd, fd],
      });
      noteEnginePid(entry, lease, child.pid, specFile);
    } catch (e) {
      finish({ ok: false, code: null, error: e.message });
      return;
    }

    let lastHeartbeat = 0;
    const stopChild = (kind, reason, extra = {}) => {
      if (forcedStopReason || canceling) return;
      forcedStopKind = kind;
      forcedStopReason = reason;
      eventlog.emit('queue.engine.terminate', Object.assign({
        queueAgent: AGENT,
        queueId: entry.id,
        task: path.basename(specFile, '.json'),
        enginePid: child && child.pid || null,
        reason,
        kind,
      }, extra));
      killProcessGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), 5000);
    };
    poll = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeat >= ENGINE_LEASE_HEARTBEAT_MS) {
        lastHeartbeat = now;
        noteEnginePid(entry, lease, child.pid, specFile);
      }
      const latest = readRunningEntry(entry.id);
      if (!latest) {
        stopChild('queue-running-missing', 'running 队列文件已不存在,终止对应 engine 并释放 slot', {});
        return;
      }
      if (latest.cancel_requested && !canceling) {
        canceling = true;
        eventlog.emit('queue.canceling', { queueAgent: AGENT, queueId: entry.id, task: path.basename(specFile, '.json') });
        killProcessGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), 5000);
        return;
      }
      const quotaPause = isQuotaScopePausedForEntry(AGENT, latest, lease && lease.runnerType);
      if (quotaPause.paused && !canceling && !forcedStopReason) {
        stopChild(
          'quota-degraded',
          `quota scope ${quotaPause.scope && quotaPause.scope.key || 'unknown'} 已进入降级保全,终止当前 engine 并回退到 clean queued`,
          { quotaScope: quotaPause.scope && quotaPause.scope.key || null },
        );
        return;
      }
      if (!canceling && !forcedStopReason && RUNNING_NO_PROGRESS_STALE_MS) {
        const progress = runningNoProgress(latest);
        if (progress.stale) {
          const seconds = Math.max(0, Math.round((progress.ageMs || 0) / 1000));
          stopChild(
            'no-node-progress',
            `running 项 ${progress.at || 'unknown'} 后已 ${seconds}s 无节点进展,按节点无进展超时判死`,
            { progressAt: progress.at || null, progressAgeMs: progress.ageMs },
          );
        }
      }
    }, 500);

    child.on('error', e => finish({ ok: false, code: null, error: e.message, canceled: canceling }));
    child.on('close', (code, signal) => {
      finish({
        ok: code === 0 && !canceling && !forcedStopReason,
        canceled: canceling || code === 4,
        paused: !canceling && !forcedStopReason && code === 5,
        code,
        signal,
        noProgress: forcedStopKind === 'no-node-progress',
        queueMissing: forcedStopKind === 'queue-running-missing',
        quotaDegraded: forcedStopKind === 'quota-degraded',
        error: forcedStopReason || null,
      });
    });
  });
}

function sanitizeReason(text) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(0, 1000);
}

function compactNotifyText(text, max = 220) {
  return sanitizeReason(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '未提供详情';
}

function stripNotifyPrefix(title) {
  return String(title || '')
    .replace(/^(?:【直接】|【自动[:：]】|自动[:：])\s*/u, '')
    .trim() || '任务通知';
}

function prefixedNotifyTitle(title, opts = {}) {
  const clean = stripNotifyPrefix(title);
  return opts.automatic ? `【自动:】${clean}` : `【直接】${clean}`;
}

function cleanNotifyText(text) {
  return sanitizeReason(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[>*`#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function notifyGoalSource(text) {
  let s = cleanNotifyText(text);
  const original = s.match(/(?:原始目标|original goal)[:：]\s*([\s\S]+)$/i);
  if (original) s = original[1];
  s = s.replace(/^项目主管(?:\([^)]*\))?执行\s*CEO\s*brief[。.:：\s]*/i, '');
  s = s.replace(/^CEO\s*(?:派单|brief|计划摘要)[：:\s]*/i, '');
  s = s.replace(/^【[^】]*(?:老板|CEO|拆解|落地)[^】]*】\s*/u, '');
  s = s.replace(/^(?:老板要求|老板拍板|老板反馈|老板原话|请\s*CEO\s*拆解(?:落地|修复)?)[,，:：\s]*/iu, '');
  const boundary = s.search(/\s(?:边界|验收|输入|验证|范围|后续|上一步结果|结构化输出要求|请在最后输出)[:：]/);
  if (boundary > 0) s = s.slice(0, boundary);
  const labeled = s.match(/^(?:目标|任务)[:：]\s*([^。；;!?？！]+)/);
  if (labeled) s = labeled[1];
  return cleanNotifyText(s);
}

function notifyKeywordName(src) {
  const s = notifyGoalSource(src);
  if (!s) return '';
  if (/(自动优化|ui[_-]?optimizer|空闲自动优化)/i.test(s) && /(飞书|通知)/i.test(s) && /(同类合并|重复合并|入队.*合并|queue.*merge)/i.test(s)) return '控制台机制优化';
  if (/(自动优化|ui[_-]?optimizer|空闲自动优化)/i.test(s)) return '暂停自动优化';
  if (/(同类合并|重复合并|入队.*合并|queue.*merge)/i.test(s)) return '入队自动合并';
  if (/卡片再简化/i.test(s) || (/(飞书|notify|通知)/i.test(s) && /卡片/i.test(s) && /(简化|精简|复杂)/i.test(s))) return '飞书卡片简化';
  if (/(飞书|notify|通知)/i.test(s) && /(刷屏|去重|节流|冷却|合并|标题)/i.test(s)) return '飞书刷屏与标题修复';
  if (/(飞书|notify|通知)/i.test(s) && /(进行中|进展|滚动|tb-full|workspace\.html)/i.test(s)) return '通知与进展区修复';
  if (/(飞书|notify|通知)/i.test(s)) return '飞书通知升级';
  if (/(进行中|进展区|最新进展|进展显示|tb-full)/i.test(s)) return '进展区滚动修复';
  if (/滚动条/i.test(s)) return /现代|无边框|悬浮/.test(s) ? '滚动条现代化' : '滚动条优化';
  if (/(链路图|连线|边标签|节点.*布局|布局整理)/i.test(s)) return '链路图布局';
  if (/(Peekaboo|截图|截屏|视觉)/i.test(s)) return 'Peekaboo验证';
  if (/(任务板|进行中卡|过往任务)/i.test(s)) return '任务板精修';
  if (/LocateAnything|grounding|视觉定位/i.test(s)) return '视觉定位服务';
  if (/open[-_\s]?multi[-_\s]?agent|DAG/i.test(s)) return 'DAG调研';
  if (/claude-code-workflow|workflow orchestration/i.test(s)) return '编排插件评估';
  if (/Agentrooms|claude-code-by-agents/i.test(s)) return '跨机协作评估';
  if (/serial[_\s-]?smoke/i.test(s)) return '串行冒烟';
  return '';
}

function trimNotifyTaskName(text, max = 18) {
  let s = cleanNotifyText(text)
    .replace(/\([^)]*(?:workspace\.html|public\/workspace\.html)[^)]*\)/ig, '')
    .replace(/\b(public\/)?workspace\.html\b/ig, '')
    .replace(/[【】\[\]（）()]/g, ' ')
    .replace(/^[-·,，。；;:：\s]+|[-·,，。；;:：\s]+$/g, '');
  const colon = s.search(/[:：]/);
  if (colon > 0 && colon < 36) s = s.slice(0, colon);
  const stop = s.search(/[。；;!?？！]/);
  if (stop > 0) s = s.slice(0, stop);
  s = s.replace(/^(webUI|WebUI|UI)\s*/i, '').replace(/^(请|把|将|用)\s*/u, '');
  s = cleanNotifyText(s);
  const limit = /[\u3400-\u9fff]/.test(s) ? max : Math.max(max, 24);
  return s.length > limit ? `${s.slice(0, Math.max(1, limit - 1))}…` : s;
}

function preferredNotifyTitle(spec) {
  const fields = ['idem', 'title', 'shortTitle', 'name', 'summary'];
  for (const key of fields) {
    const v = spec && spec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function conciseNotifyTaskName(spec) {
  const preferred = preferredNotifyTitle(spec);
  const raw = preferred || (spec && spec.goal) || '';
  return trimNotifyTaskName(notifyKeywordName(raw) || notifyGoalSource(raw) || raw, 18) || '任务完成';
}

function extractJsonBlocks(text) {
  const out = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    try { out.push(JSON.parse(m[1].trim())); } catch (_) {}
  }
  return out;
}

function latestNodeResultText(taskId, node) {
  const dir = path.join(ARTIFACTS_ROOT, 'engine-runs', String(taskId || ''));
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return ''; }
  const prefix = `${node}-`;
  const candidates = names
    .filter(name => name.startsWith(prefix))
    .map(name => {
      const n = parseInt(name.slice(prefix.length), 10) || 0;
      return { name, n };
    })
    .sort((a, b) => b.n - a.n);
  for (const c of candidates) {
    try {
      return fs.readFileSync(path.join(dir, c.name, 'result.md'), 'utf8');
    } catch (_) {}
  }
  return '';
}

function structuredResult(text, key) {
  for (const block of extractJsonBlocks(text)) {
    if (block && block[key] && typeof block[key] === 'object') return block[key];
  }
  return null;
}

function firstResultSentence(text) {
  const stripped = String(text || '').replace(/```[\s\S]*?```/g, ' ');
  const line = stripped
    .split(/\r?\n/)
    .map(cleanNotifyText)
    .filter(Boolean)
    .find(s => !/^[-*]?\s*(验证|changed_files|summary|pass|severity)[:：]/i.test(s)
      && !/(项目主管.*CEO\s*brief|原始目标|老板要求|老板拍板|请\s*CEO\s*拆解)/i.test(s));
  if (!line) return '';
  const stop = line.search(/[。；;!?？！](?=\s|$)/);
  return stop > 12 ? line.slice(0, stop + 1) : line;
}

function projectCompletionEvidence(spec) {
  const implementText = latestNodeResultText(spec && spec.taskId, 'implement') || latestNodeResultText(spec && spec.taskId, 'execute');
  const reviewText = latestNodeResultText(spec && spec.taskId, 'review');
  const implementation = structuredResult(implementText, 'implementation') || {};
  const review = structuredResult(reviewText, 'review') || {};
  const changedFiles = Array.isArray(implementation.changed_files) ? implementation.changed_files : [];
  const summary = implementation.summary || firstResultSentence(implementText) || review.notes || firstResultSentence(reviewText) || '';
  return { implementation, review, changedFiles, summary: cleanNotifyText(summary) };
}

function projectCompletionResultLine(spec, evidence) {
  let summary = evidence && evidence.summary || '';
  if (!summary) summary = notifyGoalSource(spec && spec.goal) ? '已完成并更新状态' : '已完成';
  summary = summary.replace(/^已完成[。.:：\s]+/u, '').trim() || summary;
  const summaryLead = summary.slice(0, 28);
  if (
    summary &&
    /[\u3400-\u9fff]/.test(summary) &&
    !/^(已|完成|通过|修复|新增|更新|整理|接入|验证|无需)/.test(summary) &&
    !/(已|完成|通过|修复|新增|更新|整理|接入|验证)/.test(summaryLead)
  ) summary = `已${summary}`;
  const review = evidence && evidence.review || {};
  const reviewPass = review.pass === true || /PASS/i.test(String(review.notes || ''));
  if (reviewPass && !/(复审|review|PASS|通过)/i.test(summary)) summary = `${summary.replace(/[。.]$/, '')}，复审通过`;
  return compactNotifyText(summary, 128);
}

function buildProjectDoneNotice(spec) {
  const evidence = projectCompletionEvidence(spec || {});
  let title = conciseNotifyTaskName(spec || {});
  if (title === '任务完成' && evidence.summary) {
    title = trimNotifyTaskName(notifyKeywordName(evidence.summary) || evidence.summary, 18) || title;
  }
  title = prefixedNotifyTitle(title, { automatic: isAutomaticTaskSpec(spec || {}) });
  const result = projectCompletionResultLine(spec || {}, evidence);
  return {
    title,
    body: compactNotifyText(`${title} · ${result}`, 180),
    result,
    evidence,
  };
}

function isLowSignalProjectNotice(notice) {
  const hay = `${notice && notice.title || ''}\n${notice && notice.body || ''}`;
  return /(serial[_\s-]?smoke|冒烟|滚动条|样式|标签复用|截图验证|任务板精修|UI\s*微调|微调)/i.test(hay);
}

function isAutomaticTaskSpec(spec) {
  const strongHay = [
    spec && spec.role,
    spec && spec.queueAgent,
    spec && spec.queueId,
    spec && spec.rootQueueId,
    spec && spec.idem,
    spec && spec.title,
    spec && spec.summary,
  ].map(v => String(v || '')).join('\n');
  if (/(ui[_-]?optimizer|空闲自动优化|自动优化师|自动维修|auto[-_:]|repair-memory|系统自动)/i.test(strongHay)) return true;
  return /(空闲自动优化师本轮任务|系统自动产生|自动故障触发)/i.test(String(spec && spec.goal || ''));
}

function isTestPassProjectNotice(notice) {
  const hay = `${notice && notice.title || ''}\n${notice && notice.body || ''}\n${notice && notice.result || ''}`;
  if (!/(serial[_\s-]?smoke|smoke|冒烟|单次测试|测试通过|自测|回归)/i.test(hay)) return false;
  if (/(失败|failed|fail|error|卡住|paused|canceled|取消)/i.test(hay)) return false;
  const review = notice && notice.evidence && notice.evidence.review || {};
  return review.pass === true || /(PASS|通过|ok|成功)/i.test(hay);
}

function shouldSkipProjectDoneNotice(notice, spec) {
  const state = readJsonDefault(PROJECT_DONE_NOTIFY_STATE, {});
  if (isTestPassProjectNotice(notice)) {
    state.once = state.once && typeof state.once === 'object' ? state.once : {};
    const key = crypto.createHash('sha256').update(['test-pass', spec && spec.projectId || '', notice.title].join('\n')).digest('hex').slice(0, 16);
    const last = state.once[key];
    const now = Date.now();
    state.once[key] = Object.assign({}, last || {}, {
      suppressedAtMs: last && last.suppressedAtMs || now,
      suppressedAt: last && last.suppressedAt || new Date(now).toISOString(),
      lastSkippedAt: new Date(now).toISOString(),
      title: notice.title,
      body: notice.body,
      projectId: spec && spec.projectId || null,
      skipped: (last && last.skipped || 0) + 1,
    });
    writeJsonAtomic(PROJECT_DONE_NOTIFY_STATE, state);
    eventlog.emit('notify.auto.skipped', {
      title: notice.title,
      body: compactNotifyText(notice.body, 220),
      queueAgent: spec && spec.queueAgent || null,
      queueId: spec && spec.queueId || null,
      task: spec && spec.taskId || null,
      projectId: spec && spec.projectId || null,
      source: 'project-complete',
      reason: 'test-pass-suppressed',
    });
    return true;
  }
  if (!PROJECT_DONE_NOTIFY_COOLDOWN_MS || !isLowSignalProjectNotice(notice)) return false;
  const key = crypto.createHash('sha256').update([spec && spec.projectId || '', notice.title].join('\n')).digest('hex').slice(0, 16);
  const now = Date.now();
  const last = state[key] || {};
  if (last.atMs && now - last.atMs < PROJECT_DONE_NOTIFY_COOLDOWN_MS) {
    state[key] = Object.assign({}, last, {
      skipped: (last.skipped || 0) + 1,
      lastSkippedAt: new Date(now).toISOString(),
      lastBody: notice.body,
    });
    writeJsonAtomic(PROJECT_DONE_NOTIFY_STATE, state);
    eventlog.emit('notify.auto.skipped', {
      title: notice.title,
      body: compactNotifyText(notice.body, 220),
      queueAgent: spec && spec.queueAgent || null,
      queueId: spec && spec.queueId || null,
      task: spec && spec.taskId || null,
      projectId: spec && spec.projectId || null,
      source: 'project-complete',
      reason: 'cooldown',
    });
    return true;
  }
  state[key] = {
    atMs: now,
    at: new Date(now).toISOString(),
    title: notice.title,
    body: notice.body,
    projectId: spec && spec.projectId || null,
    skipped: 0,
  };
  writeJsonAtomic(PROJECT_DONE_NOTIFY_STATE, state);
  return false;
}

function notifyOwner(title, body, meta = {}) {
  let result;
  try {
    result = SecretaryTools.notify({
      title,
      body,
      image: meta.image || '',
      source: meta.source || 'ceo-worker',
      log: false,
    });
  } catch (e) {
    result = { attempted: true, sent: false, code: null, stderr: sanitizeReason(e.message) };
  }
  eventlog.emit(result.sent ? 'notify.auto.sent' : 'notify.auto.failed', {
    title: String(title || '').slice(0, 120),
    body: compactNotifyText(body, 220),
    queueAgent: meta.queueAgent || null,
    queueId: meta.queueId || null,
    task: meta.taskId || null,
    projectId: meta.projectId || null,
    source: meta.source || 'ceo-worker',
    code: result.code == null ? null : result.code,
    reason: result.sent ? null : compactNotifyText(result.stderr || result.stdout || 'not sent', 300),
  });
  return result;
}

function notifyProjectDone(spec) {
  if (!spec || !/^supervisor-/.test(String(spec.queueAgent || ''))) return null;
  const notice = buildProjectDoneNotice(spec);
  if (shouldSkipProjectDoneNotice(notice, spec)) return { attempted: false, sent: false, skipped: true, reason: 'cooldown' };
  return notifyOwner(notice.title, notice.body, {
    source: 'project-complete',
    queueAgent: spec.queueAgent,
    queueId: spec.queueId,
    taskId: spec.taskId,
    projectId: spec.projectId || null,
  });
}

function isHumanGateReason(reason) {
  return /awaiting_human|needs[-_ ]?human|human|人审|主人确认|owner confirmation|软暂停/i.test(String(reason || ''));
}

function normalizeNoticeReason(reason) {
  return compactNotifyText(reason, 500)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?s\b/g, '<seconds>')
    .replace(/\b\d{3,}\b/g, '<num>');
}

function ownerNoticeTaskKey(spec) {
  const safeSpec = spec || {};
  if (safeSpec.taskId) return String(safeSpec.taskId);
  if (safeSpec.rootTaskId) return String(safeSpec.rootTaskId);
  if (safeSpec.parentTaskId) return String(safeSpec.parentTaskId);
  if (safeSpec.queueAgent && safeSpec.queueId) return `${safeSpec.queueAgent}/${safeSpec.queueId}`;
  if (safeSpec.queueId) return String(safeSpec.queueId);
  return 'unknown-task';
}

function noticeHash(parts, size = 16) {
  return crypto.createHash('sha256').update(parts.map(v => String(v || '')).join('\n')).digest('hex').slice(0, size);
}

function normalizeReasonPart(text) {
  return cleanNotifyText(text)
    .toLowerCase()
    .replace(/<num>|<time>|<seconds>/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'unknown';
}

function noticeReasonCategory(kind, reason) {
  const normalized = normalizeNoticeReason(reason);
  const hay = normalized.toLowerCase();
  if (kind === 'queue-stuck' || /(no[-_ ]?progress|running.*stale|heartbeat|enginepid|占槽|卡住|无节点进展|失联)/i.test(normalized)) {
    return { category: 'stuck', problemType: '任务卡住', severity: 50 };
  }
  if (kind === 'needs-human' || isHumanGateReason(reason)) {
    return { category: 'needs-human', problemType: '需确认', severity: 20 };
  }
  if (/(done[-_ ]?gate|validateReviewLoop|implementation\.done|review.*pass|验收|门禁|打回|复审.*fail)/i.test(normalized)) {
    return { category: 'done-gate', problemType: '验收打回', severity: 45 };
  }
  if (/(timeout|timed out|etimedout|超时)/i.test(normalized)) {
    return { category: 'timeout', problemType: '执行超时', severity: 55 };
  }
  if (/(queue worker crashed|worker.*crash|uncaught|崩溃)/i.test(normalized)) {
    return { category: 'worker-crash', problemType: '运行报错', severity: 60 };
  }
  if (/(spawn|enoent|eacces|runner.*not found|启动失败)/i.test(normalized)) {
    return { category: 'runner-spawn', problemType: '运行报错', severity: 55 };
  }
  if (/(node_failed|node failed|engine-runner.*退出码|exit code|退出码|signal|信号|failed without reason)/i.test(normalized)) {
    return { category: 'runner-exit', problemType: '执行失败', severity: 40 };
  }
  if (/(cancel|canceled|cancelled|取消)/i.test(normalized)) {
    return { category: 'canceled', problemType: '已取消', severity: 10 };
  }
  const parts = normalized
    .split(/[:：/|>]+/)
    .map(normalizeReasonPart)
    .filter(Boolean)
    .slice(0, 2);
  return {
    category: parts.length ? `reason-${parts.join('-')}` : 'reason-unknown',
    problemType: '运行报错',
    severity: 35,
  };
}

function ownerNoticeFingerprint(kind, spec, reason) {
  const safeSpec = spec || {};
  const issue = noticeReasonCategory(kind, reason);
  const key = [
    'owner-notice-v2',
    safeSpec.projectId || projectFromAgent(safeSpec.queueAgent || AGENT) || '',
    issue.category,
  ].join('\n');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function normalizeOwnerNoticeState(state) {
  const safe = state && typeof state === 'object' ? state : {};
  safe.notices = safe.notices && typeof safe.notices === 'object' ? safe.notices : {};
  safe.groups = safe.groups && typeof safe.groups === 'object' ? safe.groups : {};
  safe.taskWindows = safe.taskWindows && typeof safe.taskWindows === 'object' ? safe.taskWindows : {};
  safe.taskDedupe = safe.taskDedupe && typeof safe.taskDedupe === 'object' ? safe.taskDedupe : {};
  safe.history = safe.history && typeof safe.history === 'object' ? safe.history : {};
  return safe;
}

function pruneOwnerNoticeState(state, now = Date.now()) {
  const historyCutoff = now - OWNER_AUTO_NOTIFY_HISTORY_MS;
  for (const [key, rows] of Object.entries(state.history || {})) {
    const kept = Array.isArray(rows) ? rows.filter(row => row && row.atMs >= historyCutoff) : [];
    if (kept.length) state.history[key] = kept;
    else delete state.history[key];
  }
  for (const [key, row] of Object.entries(state.taskWindows || {})) {
    if (!row || !row.untilMs || row.untilMs < now) delete state.taskWindows[key];
  }
  for (const [key, row] of Object.entries(state.taskDedupe || {})) {
    if (!row || !row.untilMs || row.untilMs < now) delete state.taskDedupe[key];
  }
}

function readableNoticeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^cr-\d+-([a-f0-9]{6,})$/i.test(raw)) return raw.replace(/^cr-\d+-/i, 'task-').slice(0, 18);
  return raw.length > 18 ? raw.slice(0, 18) : raw;
}

function cleanStructuredTaskName(text) {
  let s = cleanNotifyText(text)
    .replace(/^(?:老板要求|老板拍板|老板反馈|老板|请|修|做|实现|处理|排查|优化)[,，:：\s]*/iu, '')
    .replace(/\b(?:owner|boss)\b/ig, '')
    .replace(/老板/g, '')
    .replace(/做起来|搞起来|修一下|处理一下|看一下/g, '')
    .replace(/\([^)]*(?:workspace\.html|public\/workspace\.html)[^)]*\)/ig, '')
    .replace(/\b(public\/)?workspace\.html\b/ig, '')
    .replace(/[【】\[\]（）()]/g, ' ')
    .replace(/^[-·,，。；;:：\s]+|[-·,，。；;:：\s]+$/g, '');
  const colon = s.search(/[:：]/);
  if (colon > 0 && colon < 36) s = s.slice(0, colon);
  const stop = s.search(/[。；;!?？！]/);
  if (stop > 0) s = s.slice(0, stop);
  return trimNotifyTaskName(s, 20);
}

function structuredTaskNameFromFields(spec, payload) {
  const fields = [
    spec && spec.title,
    spec && spec.shortTitle,
    spec && spec.name,
    spec && spec.summary,
    payload && payload.title,
    payload && payload.shortTitle,
    payload && payload.name,
    payload && payload.summary,
    spec && spec.idem,
    payload && payload.idem,
  ];
  for (const raw of fields) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const mapped = notifyKeywordName(raw);
    const name = cleanStructuredTaskName(mapped || raw);
    if (name && !/^(?:cr-\d+|[a-f0-9]{6,}|node[_-]?failed|engine|heartbeat|queue|supervisor-|worker-|repair\/|ceo\/)/i.test(name)) return name;
  }
  return '';
}

function mappedTaskNameFromGoal(spec, payload) {
  const fields = [spec && spec.goal, payload && payload.goal, payload && payload.message, payload && payload.task];
  for (const raw of fields) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const source = notifyGoalSource(raw);
    const mapped = notifyKeywordName(source || raw);
    if (mapped) return cleanStructuredTaskName(mapped);
    const labeled = cleanNotifyText(source).match(/^(?:目标|任务|标题|task|title)[:：]\s*([^。；;!?？！]+)/i);
    if (labeled) {
      const name = cleanStructuredTaskName(labeled[1]);
      if (name) return name;
    }
  }
  return '';
}

function fallbackTaskNameForNotice(spec, entry) {
  const key = ownerNoticeTaskKey(Object.assign({}, spec || {}, {
    queueId: spec && spec.queueId || entry && entry.id || null,
  }));
  if (key && key !== 'unknown-task') return readableNoticeId(key);
  return '当前任务';
}

function taskWindowFingerprint(spec) {
  return noticeHash(['owner-notice-task-window-v2', spec && spec.projectId || '', ownerNoticeTaskKey(spec)]);
}

function taskCategoryDedupeKey(context) {
  return noticeHash([
    'owner-notice-task-category-v1',
    context && context.projectId || '',
    context && context.taskKey || '',
    context && context.category || '',
  ]);
}

function isInfraRestartNoise(kind, reason) {
  const s = normalizeNoticeReason(reason);
  const lower = s.toLowerCase();
  // running 文件竞态 / 引擎正常收尾导致的 running 缺失:属基础设施竞态,重入队即可,
  // 不当任务失败开重复维修工单(治指纹 50b65386 工单堆积;仍 emit notify.auto.skipped 留痕)。
  if (kind === 'queue-running-missing' || /running 队列文件已不存在|running 文件.{0,4}不存在/i.test(s)) return true;
  if (/(infra[_-]?restart|restart window|watchdog restart|控制台.*重启|重启窗口|launchd|stop-console|cleanup-runtime|start-console)/i.test(s)) return true;
  if (/(sigterm|signal.*term|terminated|被.*term|退出信号.*term)/i.test(lower)
    && /(restart|watchdog|launchd|cleanup|infra|控制台|server|worker|engine slot|slot)/i.test(lower)) return true;
  return false;
}

function repairTicketIdForNotice(repairTicket) {
  return repairTicket && repairTicket.ticket && repairTicket.ticket.id
    || repairTicket && repairTicket.ticketId
    || repairTicket && repairTicket.id
    || '';
}

function ownerIssueContext(kind, spec, entry, reason, repairTicket, opts = {}) {
  const safeSpec = spec || {};
  const queueAgent = safeSpec.queueAgent || AGENT;
  const queueId = safeSpec.queueId || entry && entry.id || null;
  const issue = noticeReasonCategory(kind, reason);
  const taskName = taskLabelForNotice(Object.assign({}, safeSpec, { queueAgent, queueId }), entry);
  const projectId = safeSpec.projectId || projectFromAgent(queueAgent) || null;
  return {
    kind,
    category: issue.category,
    problemType: issue.problemType,
    severity: issue.severity,
    projectId,
    projectLabel: projectId || '控制台',
    taskName,
    taskKey: ownerNoticeTaskKey(Object.assign({}, safeSpec, { queueAgent, queueId })),
    taskId: safeSpec.taskId || null,
    queueAgent,
    queueId,
    reason: normalizeNoticeReason(reason),
    repairTicketId: repairTicketIdForNotice(repairTicket),
    nextStep: opts.nextStep || repairStatusForNotice(repairTicket, kind === 'needs-human'),
  };
}

function addOwnerIssueToGroup(group, context, now) {
  group.lastAtMs = now;
  group.lastAt = new Date(now).toISOString();
  group.totalEvents = (group.totalEvents || 0) + 1;
  if (!group.problemType || (context.severity || 0) >= (group.severity || 0)) {
    group.problemType = context.problemType;
    group.category = context.category;
    group.severity = context.severity || 0;
  }
  group.tasks = group.tasks && typeof group.tasks === 'object' ? group.tasks : {};
  const existing = group.tasks[context.taskKey] || {};
  group.tasks[context.taskKey] = Object.assign({}, existing, {
    taskName: context.taskName || existing.taskName || context.taskKey,
    taskId: context.taskId || existing.taskId || null,
    queueAgent: context.queueAgent || existing.queueAgent || null,
    queueId: context.queueId || existing.queueId || null,
    firstAtMs: existing.firstAtMs || now,
    firstAt: existing.firstAt || new Date(now).toISOString(),
    lastAtMs: now,
    lastAt: new Date(now).toISOString(),
    events: (existing.events || 0) + 1,
    reason: context.reason || existing.reason || '',
    nextStep: context.nextStep || existing.nextStep || '',
  });
  group.repairTicketIds = Array.isArray(group.repairTicketIds) ? group.repairTicketIds : [];
  if (context.repairTicketId && !group.repairTicketIds.includes(context.repairTicketId)) {
    group.repairTicketIds.push(context.repairTicketId);
  }
  group.dirty = true;
  return group;
}

function buildOwnerIssueNotice(group) {
  const tasks = Object.values(group.tasks || {}).sort((a, b) => (a.firstAtMs || 0) - (b.firstAtMs || 0));
  const count = tasks.length || 1;
  const problemType = group.problemType || '运行报错';
  const titleTask = count === 1 ? (tasks[0] && tasks[0].taskName || '当前任务') : (group.projectLabel || '控制台');
  const title = count === 1 ? `${titleTask} - ${problemType}` : `${titleTask} - ${problemType} x${count}`;
  const agentLabels = Array.from(new Set(tasks.map(task => agentLabelForNotice(task.queueAgent)).filter(Boolean))).slice(0, 3);
  const nextSteps = Array.from(new Set(tasks.map(task => String(task.nextStep || '').replace(/^下一步[:：]\s*/u, '').trim()).filter(Boolean))).slice(0, 3);
  const taskLines = tasks.slice(0, OWNER_AUTO_NOTIFY_TASK_LIST_LIMIT).map((task, idx) => {
    const id = readableNoticeId(task.taskId || task.queueId || '');
    return `${idx + 1}. ${task.taskName || id || '当前任务'}${id ? ` (${id})` : ''}`;
  });
  if (count > taskLines.length) taskLines.push(`其余 ${count - taskLines.length} 个任务已合并`);
  const repairIds = Array.isArray(group.repairTicketIds) ? group.repairTicketIds.filter(Boolean) : [];
  let closure = '';
  if (repairIds.length) {
    closure = `闭环: 维修工单 ${repairIds.slice(0, 3).join(', ')} 已创建/接单`;
    if (repairIds.length > 3) closure += ` 等 ${repairIds.length} 个`;
  } else if (problemType === '需确认') {
    closure = '闭环: 等主人确认';
  } else if ((group.repeat24h || 0) >= 2 || count > 1) {
    closure = `闭环: 同类问题 24h 内第 ${group.repeat24h || count} 次, 已升级老板关注`;
  } else {
    closure = '闭环: 已记录待处理; 同类复发将升级/转维修';
  }
  const lines = [
    `问题类型: ${problemType}`,
    `影响任务: ${count} 个`,
    `触发次数: ${group.totalEvents || count}`,
    `时间范围: ${group.firstAt || ''} ~ ${group.lastAt || group.firstAt || ''}`,
    agentLabels.length ? `处理状态: ${agentLabels.join(' / ')}正在处理` : '',
    nextSteps.length ? `下一步: ${nextSteps.join(' / ')}` : '',
    `任务清单:\n${taskLines.join('\n')}`,
    closure,
  ].filter(Boolean);
  return { title: stripNotifyPrefix(title), body: compactNotifyText(lines.join('\n'), 900) };
}

function ownerNoticeHistoryKey(context) {
  return `${context.projectId || ''}:${context.category || ''}`;
}

function queueOwnerAutoNotice(kind, spec, entry, reason, repairTicket, opts = {}) {
  const context = ownerIssueContext(kind, spec, entry, reason, repairTicket, opts);
  const now = Date.now();
  const state = normalizeOwnerNoticeState(readJsonDefault(OWNER_AUTO_NOTIFY_STATE, {}));
  pruneOwnerNoticeState(state, now);
  if (isInfraRestartNoise(kind, reason)) {
    const dedupeKey = taskCategoryDedupeKey(context);
    state.taskDedupe[dedupeKey] = Object.assign({}, state.taskDedupe[dedupeKey] || {}, {
      untilMs: now + OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS,
      until: new Date(now + OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS).toISOString(),
      taskKey: context.taskKey,
      category: context.category,
      skipped: (state.taskDedupe[dedupeKey] && state.taskDedupe[dedupeKey].skipped || 0) + 1,
      reason: 'infra-restart-noise',
    });
    writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
    eventlog.emit('notify.auto.skipped', {
      title: `${context.taskName || '当前任务'} - ${context.problemType}`,
      body: compactNotifyText(reason, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      reason: 'infra-restart-noise',
    });
    return { attempted: false, sent: false, skipped: true, reason: 'infra-restart-noise' };
  }
  const historyKey = ownerNoticeHistoryKey(context);
  state.history[historyKey] = Array.isArray(state.history[historyKey]) ? state.history[historyKey] : [];
  state.history[historyKey].push({
    atMs: now,
    at: new Date(now).toISOString(),
    taskKey: context.taskKey,
    problemType: context.problemType,
  });
  let fingerprint = ownerNoticeFingerprint(kind, Object.assign({}, spec || {}, {
    projectId: context.projectId,
    queueAgent: context.queueAgent,
    queueId: context.queueId,
  }), reason);
  const taskWindowKey = taskWindowFingerprint({
    projectId: context.projectId,
    taskId: context.taskKey,
  });
  const taskDedupeKey = taskCategoryDedupeKey(context);
  const taskDedupe = state.taskDedupe[taskDedupeKey];
  const taskWindow = state.taskWindows[taskWindowKey];
  if (taskWindow && taskWindow.untilMs > now && taskWindow.fingerprint) {
    fingerprint = taskWindow.fingerprint;
  }
  if (taskDedupe && taskDedupe.untilMs > now && taskDedupe.fingerprint) {
    fingerprint = taskDedupe.fingerprint;
  }
  let group = state.groups[fingerprint];
  const cooldownHit = group && group.sentAtMs && OWNER_AUTO_NOTIFY_COOLDOWN_MS && now - group.sentAtMs < OWNER_AUTO_NOTIFY_COOLDOWN_MS;
  if (taskDedupe && taskDedupe.untilMs > now && taskDedupe.sentAtMs) {
    taskDedupe.skipped = (taskDedupe.skipped || 0) + 1;
    taskDedupe.lastSkippedAtMs = now;
    taskDedupe.lastSkippedAt = new Date(now).toISOString();
    state.taskDedupe[taskDedupeKey] = taskDedupe;
    writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
    eventlog.emit('notify.auto.skipped', {
      title: `${context.taskName || '当前任务'} - ${context.problemType}`,
      body: compactNotifyText(reason, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      reason: 'task-category-dedupe',
      fingerprint,
    });
    return { attempted: false, sent: false, skipped: true, reason: 'task-category-dedupe', fingerprint };
  }
  if (!group || (group.sentAtMs && !cooldownHit)) {
    group = {
      fingerprint,
      firstAtMs: now,
      firstAt: new Date(now).toISOString(),
      lastAtMs: now,
      lastAt: new Date(now).toISOString(),
      flushAfterMs: now + OWNER_AUTO_NOTIFY_AGGREGATE_MS,
      projectId: context.projectId,
      projectLabel: context.projectLabel,
      category: context.category,
      problemType: context.problemType,
      severity: context.severity || 0,
      status: 'pending',
      tasks: {},
      repairTicketIds: [],
      totalEvents: 0,
      sentAtMs: null,
      dirty: true,
    };
  }
  group.repeat24h = state.history[historyKey].length;
  addOwnerIssueToGroup(group, context, now);
  if (cooldownHit && group.sentAtMs) group.dirty = false;
  state.groups[fingerprint] = group;
  state.notices[fingerprint] = Object.assign({}, state.notices[fingerprint] || {}, {
    atMs: group.firstAtMs,
    at: group.firstAt,
    lastAtMs: group.lastAtMs,
    lastAt: group.lastAt,
    kind,
    projectId: context.projectId,
    category: group.category,
    problemType: group.problemType,
    taskCount: Object.keys(group.tasks || {}).length,
    merged: Math.max(0, (group.totalEvents || 1) - 1),
  });
  state.taskWindows[taskWindowKey] = {
    fingerprint,
    untilMs: now + OWNER_AUTO_NOTIFY_TASK_WINDOW_MS,
    until: new Date(now + OWNER_AUTO_NOTIFY_TASK_WINDOW_MS).toISOString(),
    taskKey: context.taskKey,
  };
  state.taskDedupe[taskDedupeKey] = Object.assign({}, state.taskDedupe[taskDedupeKey] || {}, {
    fingerprint,
    untilMs: now + OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS,
    until: new Date(now + OWNER_AUTO_NOTIFY_TASK_DEDUPE_MS).toISOString(),
    taskKey: context.taskKey,
    category: context.category,
  });
  writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, state);
  const noticePreview = buildOwnerIssueNotice(group);
  if (cooldownHit) {
    eventlog.emit('notify.auto.skipped', {
      title: noticePreview.title,
      body: compactNotifyText(noticePreview.body, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      reason: 'dedupe-cooldown-merged',
      fingerprint,
    });
    return { attempted: false, sent: false, skipped: true, reason: 'dedupe-cooldown', fingerprint, groupCount: Object.keys(group.tasks || {}).length };
  }
  if ((taskWindow && taskWindow.fingerprint === fingerprint) || (group.totalEvents || 0) > 1) {
    eventlog.emit('notify.auto.skipped', {
      title: noticePreview.title,
      body: compactNotifyText(noticePreview.body, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      reason: 'aggregate-merged',
      fingerprint,
    });
  } else {
    eventlog.emit('notify.auto.scheduled', {
      title: noticePreview.title,
      body: compactNotifyText(noticePreview.body, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      fingerprint,
      flushAfter: new Date(group.flushAfterMs).toISOString(),
    });
  }
  scheduleOwnerAutoNoticeFlush(fingerprint, Math.max(0, group.flushAfterMs - now));
  return { attempted: false, sent: false, scheduled: true, skipped: (group.totalEvents || 0) > 1, fingerprint, groupCount: Object.keys(group.tasks || {}).length };
}

function scheduleOwnerAutoNoticeFlush(fingerprint, delayMs) {
  if (!fingerprint) return null;
  if (delayMs <= 0) return flushOwnerAutoNoticeGroup(fingerprint, { force: true });
  if (ownerAutoNotifyTimers.has(fingerprint)) return null;
  const timer = setTimeout(() => {
    ownerAutoNotifyTimers.delete(fingerprint);
    flushOwnerAutoNoticeGroup(fingerprint, { force: true });
  }, delayMs);
  ownerAutoNotifyTimers.set(fingerprint, timer);
  return timer;
}

function flushOwnerAutoNoticeGroup(fingerprint, opts = {}) {
  const timer = ownerAutoNotifyTimers.get(fingerprint);
  if (timer) {
    clearTimeout(timer);
    ownerAutoNotifyTimers.delete(fingerprint);
  }
  const state = normalizeOwnerNoticeState(readJsonDefault(OWNER_AUTO_NOTIFY_STATE, {}));
  const group = state.groups[fingerprint];
  if (!group) return { attempted: false, sent: false, skipped: true, reason: 'missing-group', fingerprint };
  const now = Date.now();
  if (!opts.force && group.flushAfterMs && group.flushAfterMs > now) {
    return { attempted: false, sent: false, skipped: true, reason: 'not-due', fingerprint };
  }
  if (group.sentAtMs && !group.dirty) {
    return { attempted: false, sent: false, skipped: true, reason: 'already-sent', fingerprint };
  }
  const notice = buildOwnerIssueNotice(group);
  const result = notifyOwner(notice.title, notice.body, {
    source: group.problemType === '任务卡住' ? 'queue-stuck' : (group.problemType === '需确认' ? 'human-gate' : 'queue-failure'),
    queueAgent: null,
    queueId: null,
    taskId: null,
    projectId: group.projectId || null,
  });
  const latest = normalizeOwnerNoticeState(readJsonDefault(OWNER_AUTO_NOTIFY_STATE, {}));
  const latestGroup = latest.groups[fingerprint] || group;
  latestGroup.sendAttempts = (latestGroup.sendAttempts || 0) + 1;
  latestGroup.lastSendAttemptAtMs = Date.now();
  latestGroup.lastSendAttemptAt = new Date(latestGroup.lastSendAttemptAtMs).toISOString();
  latestGroup.title = notice.title;
  latestGroup.body = notice.body;
  if (result.sent) {
    latestGroup.status = 'sent';
    latestGroup.sentAtMs = latestGroup.lastSendAttemptAtMs;
    latestGroup.sentAt = latestGroup.lastSendAttemptAt;
    latestGroup.dirty = false;
    for (const [key, row] of Object.entries(latest.taskDedupe || {})) {
      if (row && row.fingerprint === fingerprint) {
        latest.taskDedupe[key] = Object.assign({}, row, {
          sentAtMs: latestGroup.sentAtMs,
          sentAt: latestGroup.sentAt,
        });
      }
    }
  } else {
    latestGroup.status = 'send_failed';
    latestGroup.lastSendError = compactNotifyText(result.stderr || result.stdout || result.error || 'not sent', 300);
    latestGroup.dirty = true;
  }
  latest.groups[fingerprint] = latestGroup;
  latest.notices[fingerprint] = Object.assign({}, latest.notices[fingerprint] || {}, {
    title: notice.title,
    body: notice.body,
    sentAtMs: latestGroup.sentAtMs || null,
    sentAt: latestGroup.sentAt || null,
    status: latestGroup.status,
    sendAttempts: latestGroup.sendAttempts,
    taskCount: Object.keys(latestGroup.tasks || {}).length,
    merged: Math.max(0, (latestGroup.totalEvents || 1) - 1),
  });
  writeJsonAtomic(OWNER_AUTO_NOTIFY_STATE, latest);
  return Object.assign({}, result, { title: notice.title, body: notice.body, fingerprint });
}

function flushOwnerAutoNoticeNow() {
  const state = normalizeOwnerNoticeState(readJsonDefault(OWNER_AUTO_NOTIFY_STATE, {}));
  return Object.keys(state.groups || {}).map(fingerprint => flushOwnerAutoNoticeGroup(fingerprint, { force: true }));
}

function taskLabelForNotice(spec, entry) {
  const safeSpec = spec || {};
  const payload = payloadFrom(entry || {});
  return structuredTaskNameFromFields(safeSpec, payload)
    || mappedTaskNameFromGoal(safeSpec, payload)
    || fallbackTaskNameForNotice(safeSpec, entry);
}

function agentLabelForNotice(agent) {
  const raw = String(agent || '').trim();
  const supervisor = raw.match(/^supervisor-(.+)$/);
  if (supervisor) return `${supervisor[1]}主管智能体`;
  const labels = {
    ceo: 'CEO智能体',
    secretary: '秘书智能体',
    repair: '维修员智能体',
    worker_code: '后端程序员智能体',
    worker_narrow: '轻量执行智能体',
    quality_ops: '质量运营智能体',
    governance: '监管智能体',
    'insight-scout': '洞察员智能体',
    memory_officer: '记忆官智能体',
    'memory-officer': '记忆官智能体',
    it_engineer: 'IT工程师智能体',
    hr_manager: 'HR主管智能体',
    hr_specialist: 'HR专员智能体',
    ui_optimizer: 'UI优化师智能体',
    frontend_designer: '前端程序员智能体',
    gui_desktop_control: '桌面控制智能体',
    zhipu_designer: '智谱设计师智能体',
    reasoning_architect: '架构师智能体',
  };
  return labels[raw] || (raw ? `${raw}智能体` : '系统智能体');
}

function issueNextStepForNotice(repairTicket, isHumanGate) {
  const ticketId = repairTicket && repairTicket.ticket && repairTicket.ticket.id || repairTicket && repairTicket.ticketId || '';
  if (ticketId) return '下一步: 维修员已接单';
  if (isHumanGate) return '下一步: 等主人确认';
  return '下一步: 已记录待处理';
}

function stuckNextStepForNotice(detail = {}) {
  const action = String(detail.action || '');
  if (/暂不判失败|继续等待|观察/.test(action)) return '下一步: 继续观察';
  if (/终止|接管/.test(action)) return '下一步: 已接管重试';
  if (/重试|重新入队|恢复流程|失联/.test(action)) return '下一步: 系统重试中';
  return '下一步: 系统处理中';
}

function repairStatusForNotice(repairTicket, isHumanGate) {
  return issueNextStepForNotice(repairTicket, isHumanGate);
}

function notifyQueueIssue(spec, entry, reason, repairTicket) {
  const safeSpec = spec || {};
  const queueAgent = safeSpec.queueAgent || AGENT;
  const queueId = safeSpec.queueId || entry && entry.id || null;
  const isHumanGate = isHumanGateReason(reason);
  const kind = isHumanGate ? 'needs-human' : 'queue-failure';
  return queueOwnerAutoNotice(kind, Object.assign({}, safeSpec, { queueAgent, queueId }), entry, reason, repairTicket);
}

function notifyQueueStuck(spec, entry, reason, detail = {}) {
  const safeSpec = spec || {};
  const queueAgent = safeSpec.queueAgent || AGENT;
  const queueId = safeSpec.queueId || entry && entry.id || null;
  const stuckReason = reason || stuckNextStepForNotice(detail);
  return queueOwnerAutoNotice('queue-stuck', Object.assign({}, safeSpec, { queueAgent, queueId }), entry, stuckReason, null, {
    nextStep: stuckNextStepForNotice(detail),
  });
}

// ── 故障分级响应(拍板 Q7)────────────────────────────────────────────────
// classifyFailureSeverity(reason, context) → 'P0' | 'P1' | 'P2'
// 判据优先级: 结构化 kind/标志位 > 文本兜底。
// P0 = 服务不可用(console-not-running / http 探活失败 / 端口占用 / watchdog 连续重启)。
// P2 = infra 噪声(重启窗口 SIGTERM / 供应商限流额度 / queue-running-missing / skill 加载失败 /
//      queue-stuck 回收重试——被 sweep 兜住,终态失败会另走 queue-failure)。
// P1 = 其余业务任务终态失败(done-gate 打回耗尽重试、真实 node.fail 无候选可降级)。
const NOTIFY_P0_KINDS = new Set([
  'console-down',
  'console-not-running',
  'http-failed',
  'port-conflict',
  'watchdog-restart-loop',
  'service-unavailable',
]);
const NOTIFY_P0_TEXT_RE = new RegExp([
  'console[-_ ]?not[-_ ]?running',
  '控制台未运行',
  '控制台不可用',
  'http[-_ ]?failed',
  '探活.{0,6}失败',
  'EADDRINUSE',
  'address already in use',
  '端口.{0,6}(占用|被占|冲突)',
  'port .{0,12}(in use|occupied|conflict)',
  'service unavailable',
  '服务不可用',
  'restart[-_ ]?loop',
  'consecutive restart',
  '(watchdog|看门狗).{0,24}(连续|反复|多次|循环)',
  '(连续|反复|多次|循环)重启',
].join('|'), 'i');
const NOTIFY_P2_SKILL_LOAD_RE = /(skill|技能).{0,16}(加载|装载|load(?:ing)?).{0,16}(失败|出错|异常|error|fail)|(加载|load(?:ing)?).{0,8}(skill|技能).{0,16}(失败|error|fail)/i;

function classifyFailureSeverity(reason, context = {}) {
  const kind = String(context.kind || context.eventType || '');
  const text = String(reason || '');
  // P0: 服务不可用 — 结构化优先,文本兜底
  if (context.serviceDown === true) return 'P0';
  if (NOTIFY_P0_KINDS.has(kind)) return 'P0';
  if (NOTIFY_P0_TEXT_RE.test(text)) return 'P0';
  // P2: 已知瞬态 infra 噪声
  if (context.transient === true) return 'P2';
  if (kind === 'queue-running-missing') return 'P2';
  if (kind === 'queue-stuck') return 'P2';
  if (isInfraRestartNoise(kind, text)) return 'P2';
  if (isExternalModelTransientFailure(text)) return 'P2';
  if (NOTIFY_P2_SKILL_LOAD_RE.test(text)) return 'P2';
  // P1: 业务任务终态失败(failover 未兜住)
  return 'P1';
}

function localDateString(ms = Date.now()) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function p1DigestFileForDate(date) {
  return path.join(NOTIFY_TIER_DIGEST_DIR, `p1-digest-${date}.jsonl`);
}

function readNotifyTierState() {
  const state = readJsonDefault(NOTIFY_TIER_STATE, {});
  state.counts = state.counts && typeof state.counts === 'object' ? state.counts : {};
  state.p0Sent = state.p0Sent && typeof state.p0Sent === 'object' ? state.p0Sent : {};
  state.p1Flushed = state.p1Flushed && typeof state.p1Flushed === 'object' ? state.p1Flushed : {};
  return state;
}

function recordTierAccount(state, severity, now = Date.now()) {
  const date = localDateString(now);
  state.counts[date] = state.counts[date] && typeof state.counts[date] === 'object' ? state.counts[date] : {};
  state.counts[date][severity] = (state.counts[date][severity] || 0) + 1;
  const dates = Object.keys(state.counts).sort();
  while (dates.length > 30) delete state.counts[dates.shift()];
  return state;
}

function appendP1DigestEntry(context, reason, now = Date.now()) {
  const date = localDateString(now);
  const file = p1DigestFileForDate(date);
  fs.mkdirSync(NOTIFY_TIER_DIGEST_DIR, { recursive: true });
  const row = {
    at: new Date(now).toISOString(),
    atMs: now,
    severity: 'P1',
    kind: context.kind || null,
    projectId: context.projectId || null,
    taskName: context.taskName || null,
    taskKey: context.taskKey || null,
    taskId: context.taskId || null,
    queueAgent: context.queueAgent || null,
    queueId: context.queueId || null,
    category: context.category || null,
    problemType: context.problemType || null,
    reason: compactNotifyText(sanitizeReason(reason), 300),
    repairTicketId: context.repairTicketId || null,
    nextStep: context.nextStep || null,
  };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return { file, date, row };
}

function readP1DigestRows(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function buildP1DigestNotice(date, rows) {
  const byGroup = new Map();
  for (const row of rows) {
    const key = `${row.projectId || '控制台'} · ${row.problemType || '执行失败'}`;
    byGroup.set(key, (byGroup.get(key) || 0) + 1);
  }
  const groupLines = Array.from(byGroup.entries()).map(([key, count]) => `- ${key}: ${count} 条`);
  const taskLines = rows.slice(0, NOTIFY_P1_DIGEST_TASK_LIST_LIMIT).map((row, idx) => {
    const id = readableNoticeId(row.taskId || row.queueId || '');
    return `${idx + 1}. ${row.taskName || id || '当前任务'}${id ? ` (${id})` : ''} - ${row.problemType || '执行失败'}`;
  });
  if (rows.length > taskLines.length) taskLines.push(`其余 ${rows.length - taskLines.length} 条已合并`);
  const repairIds = Array.from(new Set(rows.map(row => row.repairTicketId).filter(Boolean))).slice(0, 5);
  const lines = [
    `P1 业务任务终态失败日报(failover 未兜住)`,
    `日期: ${date} · 共 ${rows.length} 条`,
    groupLines.length ? `分布:\n${groupLines.join('\n')}` : '',
    taskLines.length ? `任务清单:\n${taskLines.join('\n')}` : '',
    repairIds.length ? `维修工单: ${repairIds.join(', ')}` : '',
    `明细: artifacts/notify/p1-digest-${date}.jsonl`,
  ].filter(Boolean);
  return {
    title: `P1 故障日报 ${date} · ${rows.length} 条`,
    body: compactNotifyText(lines.join('\n'), 900),
  };
}

// 日切点触发: 把 today 之前尚未汇总的 p1-digest-<date>.jsonl 各汇总为一条飞书。
// opts.force=true 时不等日切(测试/手动)。发送失败不落 flushed 标记,下轮重试。
function flushP1Digest(opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const today = localDateString(now);
  const state = readNotifyTierState();
  let files = [];
  try {
    files = fs.readdirSync(NOTIFY_TIER_DIGEST_DIR).filter(name => /^p1-digest-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name));
  } catch (_) {
    files = [];
  }
  const results = [];
  for (const name of files.sort()) {
    const date = name.slice('p1-digest-'.length, -'.jsonl'.length);
    if (!opts.force && date >= today) continue;
    const flushed = state.p1Flushed[date];
    if (flushed && flushed.sent) continue;
    const rows = readP1DigestRows(path.join(NOTIFY_TIER_DIGEST_DIR, name));
    if (!rows.length) {
      state.p1Flushed[date] = { atMs: now, at: new Date(now).toISOString(), count: 0, sent: true, empty: true };
      continue;
    }
    const notice = buildP1DigestNotice(date, rows);
    const result = notifyOwner(notice.title, notice.body, { source: 'p1-digest' });
    state.p1Flushed[date] = {
      atMs: Date.now(),
      at: new Date().toISOString(),
      count: rows.length,
      sent: !!result.sent,
      attempts: (flushed && flushed.attempts || 0) + 1,
    };
    eventlog.emit(result.sent ? 'notify.tier.p1.flushed' : 'notify.tier.p1.flush_failed', {
      date,
      count: rows.length,
      title: notice.title,
    });
    results.push(Object.assign({ date, count: rows.length }, result));
  }
  writeJsonAtomic(NOTIFY_TIER_STATE, state);
  return results;
}

function maybeFlushP1DigestAtDayCut(now = Date.now()) {
  if (!NOTIFY_TIERED_ENABLED) return null;
  if (now < p1DigestNextCheckMs) return null;
  p1DigestNextCheckMs = now + NOTIFY_P1_DIGEST_CHECK_MS;
  try {
    return flushP1Digest({ now });
  } catch (e) {
    try { eventlog.emit('notify.tier.p1.flush_failed', { reason: sanitizeReason(e.message) }); } catch (_) {}
    return null;
  }
}

// P0 去重类目: 用命中的服务不可用规则做粗粒度键(细粒度 category 会把易变文本掺进指纹)。
function p0DedupeCategory(reason, context = {}) {
  const kind = String(context.kind || '');
  if (NOTIFY_P0_KINDS.has(kind)) return kind;
  const text = String(reason || '');
  if (/console[-_ ]?not[-_ ]?running|控制台未运行|控制台不可用/i.test(text)) return 'console-not-running';
  if (/http[-_ ]?failed|探活.{0,6}失败/i.test(text)) return 'http-failed';
  if (/EADDRINUSE|address already in use|端口.{0,6}(占用|被占|冲突)|port .{0,12}(in use|occupied|conflict)/i.test(text)) return 'port-conflict';
  if (/(watchdog|看门狗).{0,24}(连续|反复|多次|循环)|(连续|反复|多次|循环)重启|restart[-_ ]?loop|consecutive restart/i.test(text)) return 'watchdog-restart-loop';
  return 'service-unavailable';
}

function sendP0OwnerNotice(context, reason, now = Date.now()) {
  const state = readNotifyTierState();
  recordTierAccount(state, 'P0', now);
  const dedupeKey = `${context.projectId || ''}:${p0DedupeCategory(reason, context)}`;
  const last = state.p0Sent[dedupeKey];
  if (NOTIFY_P0_COOLDOWN_MS && last && last.atMs && now - last.atMs < NOTIFY_P0_COOLDOWN_MS) {
    state.p0Sent[dedupeKey] = Object.assign({}, last, {
      skipped: (last.skipped || 0) + 1,
      lastSkippedAt: new Date(now).toISOString(),
    });
    writeJsonAtomic(NOTIFY_TIER_STATE, state);
    eventlog.emit('notify.auto.skipped', {
      title: `${context.projectLabel || '控制台'} - 服务不可用`,
      body: compactNotifyText(reason, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: context.kind,
      reason: 'p0-cooldown',
    });
    return { attempted: false, sent: false, skipped: true, severity: 'P0', reason: 'p0-cooldown' };
  }
  const id = readableNoticeId(context.taskId || context.queueId || '');
  const lines = [
    `问题类型: 服务不可用 (P0)`,
    `影响: ${context.taskName || id || '控制台服务'}${id ? ` (${id})` : ''}`,
    `原因: ${compactNotifyText(sanitizeReason(reason), 300)}`,
    context.repairTicketId ? `闭环: 维修工单 ${context.repairTicketId} 已创建/接单` : (context.nextStep || '下一步: 请尽快确认服务状态'),
  ].filter(Boolean);
  const result = notifyOwner(`${context.projectLabel || '控制台'} - 服务不可用`, compactNotifyText(lines.join('\n'), 900), {
    source: 'p0-service-down',
    queueAgent: context.queueAgent,
    queueId: context.queueId,
    taskId: context.taskId,
    projectId: context.projectId,
  });
  if (result.sent) {
    state.p0Sent[dedupeKey] = { atMs: now, at: new Date(now).toISOString(), skipped: 0 };
    for (const [key, row] of Object.entries(state.p0Sent)) {
      if (row && row.atMs && now - row.atMs > 24 * 60 * 60 * 1000) delete state.p0Sent[key];
    }
  }
  writeJsonAtomic(NOTIFY_TIER_STATE, state);
  return Object.assign({}, result, { severity: 'P0' });
}

// 分级路由: P0 立即飞书(绕过聚合窗口/infra 噪声过滤) / P1 写当日 digest / P2 只 emit+记账。
function routeOwnerFailureNotice(kind, spec, entry, reason, repairTicket, opts = {}) {
  if (!NOTIFY_TIERED_ENABLED) {
    return queueOwnerAutoNotice(kind, spec, entry, reason, repairTicket, opts);
  }
  if (kind === 'needs-human') {
    // 人审门不是故障: 保持既有即时聚合通道,等主人确认的语义不变。
    return queueOwnerAutoNotice(kind, spec, entry, reason, repairTicket, opts);
  }
  const severity = classifyFailureSeverity(reason, { kind, spec, entry });
  const context = ownerIssueContext(kind, spec, entry, reason, repairTicket, opts);
  const now = Date.now();
  if (severity === 'P0') {
    return sendP0OwnerNotice(context, reason, now);
  }
  if (severity === 'P1') {
    const state = readNotifyTierState();
    recordTierAccount(state, 'P1', now);
    writeJsonAtomic(NOTIFY_TIER_STATE, state);
    const digest = appendP1DigestEntry(context, reason, now);
    eventlog.emit('notify.tier.p1.digested', {
      title: `${context.taskName || '当前任务'} - ${context.problemType}`,
      body: compactNotifyText(reason, 220),
      queueAgent: context.queueAgent,
      queueId: context.queueId,
      task: context.taskId,
      projectId: context.projectId,
      source: kind,
      severity: 'P1',
      digestFile: `artifacts/notify/p1-digest-${digest.date}.jsonl`,
    });
    return { attempted: false, sent: false, digested: true, severity: 'P1', digestFile: digest.file, date: digest.date };
  }
  const state = readNotifyTierState();
  recordTierAccount(state, 'P2', now);
  writeJsonAtomic(NOTIFY_TIER_STATE, state);
  eventlog.emit('notify.tier.p2.suppressed', {
    title: `${context.taskName || '当前任务'} - ${context.problemType}`,
    body: compactNotifyText(reason, 220),
    queueAgent: context.queueAgent,
    queueId: context.queueId,
    task: context.taskId,
    projectId: context.projectId,
    source: kind,
    severity: 'P2',
    reason: 'p2-infra-noise',
  });
  return { attempted: false, sent: false, skipped: true, severity: 'P2', reason: 'p2-infra-noise' };
}

// 生产入口(分级开关生效); notifyQueueIssue/notifyQueueStuck 保留旧语义作为退回路径。
function notifyQueueIssueTiered(spec, entry, reason, repairTicket) {
  if (!NOTIFY_TIERED_ENABLED) return notifyQueueIssue(spec, entry, reason, repairTicket);
  const safeSpec = spec || {};
  const queueAgent = safeSpec.queueAgent || AGENT;
  const queueId = safeSpec.queueId || entry && entry.id || null;
  const kind = isHumanGateReason(reason) ? 'needs-human' : 'queue-failure';
  return routeOwnerFailureNotice(kind, Object.assign({}, safeSpec, { queueAgent, queueId }), entry, reason, repairTicket);
}

function notifyQueueStuckTiered(spec, entry, reason, detail = {}) {
  if (!NOTIFY_TIERED_ENABLED) return notifyQueueStuck(spec, entry, reason, detail);
  const safeSpec = spec || {};
  const queueAgent = safeSpec.queueAgent || AGENT;
  const queueId = safeSpec.queueId || entry && entry.id || null;
  const stuckReason = reason || stuckNextStepForNotice(detail);
  return routeOwnerFailureNotice('queue-stuck', Object.assign({}, safeSpec, { queueAgent, queueId }), entry, stuckReason, null, {
    nextStep: stuckNextStepForNotice(detail),
  });
}

function readJsonDefault(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function autoRepairFingerprint(spec, reason) {
  const key = [
    spec && spec.queueAgent || AGENT,
    spec && spec.role || '',
    String(reason || '').replace(/\d{5,}/g, '<num>').slice(0, 500),
  ].join('\n');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function isExternalModelTransientFailure(reason) {
  const s = String(reason || '');
  return /(Invalid Authentication|unauthorized|forbidden|\b401\b|\b403\b|认证失败|鉴权失败|api key|apikey|token 无效|token失效|该模型当前访问量过大|稍后再试|rate.?limit|\b429\b|余额不足|额度不足|剩余额度|预扣费额度失败|insufficient balance|payment required|billing)/i.test(s);
}

function isExpectedNonRepairStop(reason, result, entry) {
  const s = String(reason || '');
  return reason === 'canceled'
    || !!(result && result.canceled)
    || !!(entry && (entry.cancel_requested || entry.status === 'canceling' || entry.status === 'canceled'))
    || /(token-usage-stopgap|auto insight task canceled|owner cancel|manual cancel|queue cancel|主动取消|手动取消|已取消|取消请求)/i.test(s);
}

function openAutoRepairTicket(spec, entry, reason, result) {
  if (!AUTO_REPAIR_ENABLED || AGENT === 'repair-lead' || AGENT === 'repair') return null;
  if (!reason || isExpectedNonRepairStop(reason, result, entry)) return null;
  if (isExternalModelTransientFailure(reason)) {
    eventlog.emit('repair.ticket.skipped', {
      queueAgent: AGENT,
      queueId: entry && entry.id || null,
      task: spec && spec.taskId || null,
      reason: 'external-model-channel',
      detail: sanitizeReason(reason),
    });
    return null;
  }
  // 拍板 Q7: P2 infra 噪声不开重复维修工单(重试/重入队已兜住); YUTU6_NOTIFY_TIERED=0 退回旧行为。
  if (NOTIFY_TIERED_ENABLED && classifyFailureSeverity(reason, { kind: 'queue-failure', spec, entry }) === 'P2') {
    eventlog.emit('repair.ticket.skipped', {
      queueAgent: AGENT,
      queueId: entry && entry.id || null,
      task: spec && spec.taskId || null,
      reason: 'p2-infra-noise',
      detail: sanitizeReason(reason),
    });
    return null;
  }
  const now = new Date();
  const fingerprint = autoRepairFingerprint(spec, reason);
  const state = readJsonDefault(AUTO_REPAIR_STATE, {});
  const last = state[fingerprint] || {};
  const lastAt = last.at ? Date.parse(last.at) : 0;
  if (lastAt && Date.now() - lastAt < AUTO_REPAIR_COOLDOWN_MS) {
    eventlog.emit('repair.ticket.skipped', {
      queueAgent: AGENT,
      queueId: entry.id,
      task: spec && spec.taskId || null,
      reason: 'dedupe-cooldown',
      fingerprint,
      lastTicketId: last.ticketId || null,
    });
    return null;
  }
  const title = `自动维修 ${AGENT}/${entry.id}`;
  const ticketId = `auto-${now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${fingerprint}`;
  const evidence = [
    `queueAgent=${AGENT}`,
    `queueId=${entry.id}`,
    `task=${spec && spec.taskId || 'unknown'}`,
    `role=${spec && spec.role || 'unknown'}`,
    `flow=${spec && spec.flowId || 'unknown'}`,
    `project=${spec && spec.projectId || 'unknown'}`,
    `reason=${sanitizeReason(reason)}`,
    `engine_code=${result && result.code != null ? result.code : 'unknown'}`,
    `engine_signal=${result && result.signal || 'none'}`,
    `events=projects/控制台/artifacts/engine-events.jsonl`,
    `runs=projects/控制台/artifacts/engine-runs/${spec && spec.taskId || 'unknown'}`,
  ].join('\n');
  let created;
  try {
    created = SecretaryTools.repairTicketAdd({
      id: ticketId,
      title,
      source: '自动故障触发',
      priority: 'high',
      problem: `队列任务失败,系统自动开维修工单。失败原因:${sanitizeReason(reason)}`,
      evidence,
      expectation: '维修主管读取工单后先判断根因、需求传递遗漏与架构风险;能安全修则修并验证,需要执行时分派 Codex 维修员;高危/不可逆操作停止并请求主人确认;完成后写回工单并通知主人。',
      redlines: '高危/不可逆操作必须先给主人确认\n密钥/token/cookie/私钥不回显、不写日志\n不得跨项目操作\n不破现有功能; 能验证就写验证结果',
    });
  } catch (e) {
    eventlog.emit('repair.ticket.create_failed', { queueAgent: AGENT, queueId: entry.id, task: spec && spec.taskId || null, reason: sanitizeReason(e.message), fingerprint });
    return null;
  }
  const repairTask = {
    role: 'repair-lead',
    flowId: 'agent-once',
    projectId: '控制台',
    goal: [
      `维修工单 ${created.ticket.id}`,
      `请读取 board/repair-tickets/${created.ticket.id}.md。`,
      '你是维修主管:先查链路交互记录,判断失败原因、需求传递遗漏、严重度和架构风险。',
      '小问题可直接最小修复;严重问题先做全局系统排查,再把写码执行分派给 repair 维修员。',
      '如需维修员执行,使用 secretary-tools queue-enqueue --agent repair --goal "...",并在复核后再结案。',
      `最后运行: node projects/控制台/secretary-tools.js repair-ticket-complete --id ${created.ticket.id} --result "<根因/处理/验证/架构判断/知识沉淀候选>"`,
    ].join('\n'),
    bounds: '维修主管特权工单; 高危/不可逆操作先给主人确认; 不得跨项目操作; 密钥不回显。',
    acceptance: '主管完成链路核查、严重度分级、必要派工、复核和结案; 工单 status 变 done; 尝试飞书通知主人。',
    useOrchestrator: false,
    autoApproveHuman: false,
    nodeTimeoutSec: 600,
    engineSlotBypass: true,
    repairTicketId: created.ticket.id,
    sourceFailure: {
      queueAgent: AGENT,
      queueId: entry.id,
      taskId: spec && spec.taskId || null,
      reason: sanitizeReason(reason),
    },
  };
  const repairEntry = QueueAutoMerge.enqueue(QUEUE_ROOT, 'repair-lead', repairTask, { priority: 0, idem: `auto-repair:${created.ticket.id}`, eventlog, source: 'auto-repair' });
  created.repairQueueId = repairEntry.id;
  created.repairQueueAgent = 'repair-lead';
  created.fingerprint = fingerprint;
  state[fingerprint] = {
    at: now.toISOString(),
    ticketId: created.ticket.id,
    repairQueueAgent: 'repair-lead',
    repairQueueId: repairEntry.id,
    sourceQueueAgent: AGENT,
    sourceQueueId: entry.id,
    taskId: spec && spec.taskId || null,
  };
  writeJsonAtomic(AUTO_REPAIR_STATE, state);
  eventlog.emit('repair.ticket.enqueued', {
    ticketId: created.ticket.id,
    repairQueueAgent: 'repair-lead',
    repairQueueId: repairEntry.id,
    sourceQueueAgent: AGENT,
    sourceQueueId: entry.id,
    task: spec && spec.taskId || null,
    fingerprint,
  });
  return created;
}

function taskHasSuccessfulFailureBoundary(ev) {
  if (!ev) return false;
  if (ev.type === 'task.done') return true;
  if (ev.type === 'project.route.waiting' || ev.type === 'project.route.done') return true;
  if (ev.type === 'engine.worker.end' && (ev.ok === true || ev.waitingDownstream === true || ev.state === 'waiting_downstream')) return true;
  return false;
}

function latestTaskFailureReason(taskId) {
  if (!taskId) return '';
  let generic = '';
  try {
    const lines = fs.readFileSync(EVENTS, 'utf8').trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (_) { continue; }
      if (ev.task !== taskId) continue;
      if (taskHasSuccessfulFailureBoundary(ev)) return '';
      if (!ev.reason) continue;
      if (ev.type === 'node.fail' || ev.type === 'engine.worker.crash') {
        return sanitizeReason(ev.reason);
      }
      if (['task.failed', 'engine.worker.end'].includes(ev.type)) {
        const reason = sanitizeReason(ev.reason);
        if (reason && reason !== 'node_failed') return reason;
        if (!generic) generic = reason;
      }
    }
  } catch (_) {}
  return generic;
}

function engineFailureReason(result, spec) {
  if (result && result.ok) return null;
  if (result && result.canceled) return 'canceled';
  const fromEvents = latestTaskFailureReason(spec && spec.taskId);
  if (fromEvents) return fromEvents;
  if (result && result.noProgress && result.error) return sanitizeReason(result.error);
  if (result && result.queueMissing && result.error) return sanitizeReason(result.error);
  if (result && result.error) return `spawn engine-runner failed: ${sanitizeReason(result.error)}`;
  if (result && result.signal) {
    return `engine-runner 被信号 ${result.signal} 终止; 可能来自运行清扫、外部 kill 或资源压力,请查 artifacts/engine-runs/${spec.taskId} 与 artifacts/engine-worker.log`;
  }
  if (result && result.code != null) {
    return `engine-runner 退出码 ${result.code}; 未写明原因,请查 artifacts/engine-runs/${spec.taskId} 与 artifacts/engine-worker.log`;
  }
  return `engine-runner failed without reason; 请查 artifacts/engine-runs/${spec && spec.taskId || 'unknown'} 与 artifacts/engine-worker.log`;
}

function classifyQuotaExhaustion(reason, result) {
  if (!QUOTA_DEGRADE_ENABLED) {
    return { isQuotaExhausted: false, confidence: 'disabled', reason: 'feature_disabled', rawReason: String(reason || '') };
  }
  if (result && (result.canceled || result.paused)) {
    return { isQuotaExhausted: false, confidence: 'negative', reason: 'terminal_not_quota', rawReason: String(reason || '') };
  }
  if (result && result.quotaDegraded) {
    return {
      isQuotaExhausted: true,
      confidence: 'high',
      reason: 'quota_degraded_scope_active',
      rawReason: String(reason || ''),
    };
  }
  return QuotaDegrade.classifyQuotaSignal(reason, result);
}

function quotaSnapshotEntries(scope) {
  const statuses = ['queued', 'running', 'paused', 'done', 'failed', 'canceled'];
  const entries = [];
  for (const agent of queueAgents()) {
    for (const status of statuses) {
      for (const item of queueEntriesForStatus(agent, status)) {
        const itemScope = quotaScopeForAgentEntry(agent, item.entry);
        if (!itemScope || itemScope.key !== scope.key) continue;
        entries.push({
          agent,
          queueId: item.queueId,
          status,
          runnerType: runnerTypeForAgentEntry(agent, item.entry),
          quotaScope: itemScope.key,
          file: path.relative(ARTIFACTS_ROOT, item.file).split(path.sep).join('/'),
          entry: item.entry,
        });
      }
    }
  }
  return entries;
}

function runningEntriesForQuotaScope(scope, exclude = {}) {
  const out = [];
  for (const agent of queueAgents()) {
    for (const item of queueEntriesForStatus(agent, 'running')) {
      if (exclude.agent === agent && exclude.queueId === item.queueId) continue;
      const itemScope = quotaScopeForAgentEntry(agent, item.entry);
      if (itemScope && itemScope.key === scope.key) out.push(item);
    }
  }
  return out;
}

async function waitForQuotaScopeDrain(scope, exclude = {}) {
  const started = Date.now();
  let remaining = runningEntriesForQuotaScope(scope, exclude);
  while (remaining.length && Date.now() - started < QUOTA_DEGRADE_DRAIN_MS) {
    await sleep(100);
    remaining = runningEntriesForQuotaScope(scope, exclude);
  }
  return {
    drained: remaining.length === 0,
    timedOut: remaining.length > 0,
    remaining: remaining.map(item => ({ agent: item.agent, queueId: item.queueId, status: item.status })),
    waitedMs: Date.now() - started,
  };
}

function quotaCleanRequeuePatch(scope, incidentId, signal, result, reason) {
  return {
    quota_degrade_incident: incidentId,
    quota_degrade_scope: scope.key,
    quota_degraded_at: new Date().toISOString(),
    quota_signal: 'quota_exhausted',
    quota_signal_confidence: signal && signal.confidence || null,
    quota_signal_reason: signal && signal.reason || null,
    cleanup_status: 'execution_context_discarded',
    partial_artifacts_possible: true,
    partial_artifacts_note: '任务内部临时上下文已丢弃; 若 runner 在失败前产生文件或外部副作用,恢复后需由任务自检或人工复核。',
    last_engine_error: sanitizeReason(reason),
    last_engine_code: result && result.code != null ? result.code : null,
    last_engine_signal: result && result.signal || null,
    error: null,
  };
}

async function handleQuotaDegradation(spec, entry, result, reason, runnerType, signal) {
  const scope = quotaScopeForSpec(spec, entry, runnerType);
  return QuotaDegrade.withScopeLock(ARTIFACTS_ROOT, scope, async () => {
    const preservationStartedAt = new Date().toISOString();
    const incident = QuotaDegrade.beginOrUpdateIncident(ARTIFACTS_ROOT, scope, {
      queueAgent: AGENT,
      queueId: entry && entry.id || null,
      taskId: spec && spec.taskId || null,
      runnerType,
      code: result && result.code,
      signal: result && result.signal || null,
      reason: sanitizeReason(reason),
      rawReason: signal && signal.rawReason || reason,
      confidence: signal && signal.confidence || null,
    });
    const incidentId = incident.state.incidentId;
    eventlog.emit(incident.merged ? 'quota.degrade.merged' : 'quota.degrade.start', {
      scope: scope.key,
      incidentId,
      queueAgent: AGENT,
      queueId: entry && entry.id || null,
      task: spec && spec.taskId || null,
      runnerType,
      reason: sanitizeReason(reason),
      confidence: signal && signal.confidence || null,
    });

    const lockRelease = await releaseQueueRuntimeLocks(AGENT, entry.id, 'quota exhausted degradation', {
      meta: { queueAgent: AGENT, queueId: entry.id, task: spec && spec.taskId || null, scope: scope.key },
      event: { task: spec && spec.taskId || null, quotaScope: scope.key },
    });
    if (lockReleaseBlocked(lockRelease)) {
      eventlog.emit('quota.degrade.lock_release_blocked', {
        scope: scope.key,
        incidentId,
        queueAgent: AGENT,
        queueId: entry.id,
        locks: lockRelease.blocked,
      });
    }

    const requeued = Q.requeue(QUEUE_ROOT, AGENT, entry.id, quotaCleanRequeuePatch(scope, incidentId, signal, result, reason));
    if (requeued) {
      eventlog.emit('queue.quota_requeued', {
        queueAgent: AGENT,
        queueId: entry.id,
        task: spec && spec.taskId || null,
        scope: scope.key,
        incidentId,
        status: 'queued',
      });
    }

    const drain = await waitForQuotaScopeDrain(scope, { agent: AGENT, queueId: entry.id });
    if (drain.timedOut) {
      eventlog.emit('quota.degrade.drain_timeout', {
        scope: scope.key,
        incidentId,
        remaining: drain.remaining.slice(0, 10),
        waitedMs: drain.waitedMs,
      });
    }
    const preservationFinishedAt = new Date().toISOString();
    const snapshotResult = QuotaDegrade.writeSnapshot(
      ARTIFACTS_ROOT,
      scope,
      incidentId,
      quotaSnapshotEntries(scope),
      {
        preservationStartedAt,
        preservationFinishedAt,
        drainTimedOut: drain.timedOut,
        triggers: incident.state.triggers || [],
      },
    );
    const state = QuotaDegrade.finishIncidentSnapshot(ARTIFACTS_ROOT, scope, incidentId, snapshotResult);
    eventlog.emit('quota.snapshot.written', {
      scope: scope.key,
      incidentId,
      revision: snapshotResult.snapshot.revision,
      file: path.relative(ARTIFACTS_ROOT, snapshotResult.file).split(path.sep).join('/'),
      counts: snapshotResult.snapshot.counts,
      drainTimedOut: drain.timedOut,
    });
    eventlog.emit('queue.quota_degraded', {
      queueAgent: AGENT,
      queueId: entry.id,
      task: spec && spec.taskId || null,
      scope: scope.key,
      incidentId,
      snapshotRevision: snapshotResult.snapshot.revision,
      status: 'queued',
      reason: 'quota_exhausted',
    });
    if (CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) releaseActiveCeoTaskIfComplete(spec, 'quota-degraded');
    return { scope, incidentId, requeued, snapshot: snapshotResult.snapshot, state, drain };
  }, { waitMs: QUOTA_DEGRADE_LOCK_WAIT_MS });
}

function isRetryableEngineFailure(reason, result) {
  if (result && (result.canceled || result.paused)) return false;
  const quota = classifyQuotaExhaustion(reason, result);
  if (quota.isQuotaExhausted) return false;
  const text = String(reason || '');
  if (/awaiting_human|needs[-_ ]?human|主人确认|软暂停|project\.route\.paused|项目尚未登记/i.test(text)) return false;
  return /node_failed|运行超时|timeout|ETIMEDOUT|被信号|退出码|spawn .*失败|failed without reason/i.test(text)
    || !!(result && result.signal)
    || !!(result && (result.code === 1 || result.code === 3));
}

function maybeRetryEngineFailure(spec, entry, result, reason) {
  if (!isRetryableEngineFailure(reason, result)) return false;
  const currentRetry = Number(entry && (entry.nodeRetry != null ? entry.nodeRetry : entry.engineRetry)) || 0;
  if (currentRetry >= NODE_FAILURE_MAX_RETRY) return false;
  const retry = currentRetry + 1;
  const requeued = Q.requeue(QUEUE_ROOT, AGENT, entry.id, {
    nodeRetry: retry,
    engineRetry: retry,
    last_engine_error: sanitizeReason(reason),
    last_engine_code: result && result.code != null ? result.code : null,
    last_engine_signal: result && result.signal || null,
    retry_reason: 'node_failed',
  });
  if (!requeued) return false;
  eventlog.emit('queue.retry', {
    queueAgent: AGENT,
    queueId: entry.id,
    task: spec && spec.taskId || null,
    retry,
    maxRetry: NODE_FAILURE_MAX_RETRY,
    reason: sanitizeReason(reason),
    retryKind: 'node_failed',
    projectId: spec && spec.projectId || null,
  });
  return true;
}

function taskTextForSecretary(payload, latest) {
  return String(payload.goal || payload.message || payload.task || latest.task || '').trim();
}

function buildSecretaryEnvelope(payload, latest) {
  const raw = taskTextForSecretary(payload, latest);
  const projectId = inferProjectId(payload);
  if (!projectId) {
    return { blocked: true, reason: '项目尚未登记或无法安全确定归属,秘书已软暂停转交' };
  }
  const context = SecretaryTools.buildContextText();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const inputs = mergeInputs(payload.inputs, attachments);
  const attachmentBlock = attachmentInputPaths(attachments).length
    ? [
      '图片附件(本地路径,可直接交给 Codex 多模态/文件读取):',
      ...attachmentInputPaths(attachments).map((p, i) => `${i + 1}. ${p}`),
    ].join('\n')
    : '';
  // 2026-07-03 架构审视 A-5:任务正文置于背景包之前——下游任何"保头截尾"截断(如董事会
  // compact(base,5000))先砍的是背景包而不是老板正文。此前包前置曾把老板任务正文整段截丢(实证事故)。
  const goal = [
    '秘书补全稿:',
    '',
    `目标:${raw}`,
    `项目:${projectId}`,
    attachmentBlock,
    '边界:只处理本任务; 未登记项目必须先创建项目部门; 不得跨项目操作; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明。',
    '可用动作:必要时先用 secretary-tools 搜索/查能力/看队列/加公告板;非维修任务一律转 CEO 决策,由 CEO 再派主管/员工或专职队列。',
    '验收:秘书已基于 board 背景补全并转交 CEO;CEO 写入项目 brief,派到对应项目主管或专职队列;事件日志可追踪;项目主管完成后更新 status 与 rollup。',
    '',
    context,
  ].filter(Boolean).join('\n');
  const boardAssessment = BoardReview.shouldRunBoardReview({
    originalGoal: raw,
    goal: raw,
    projectId,
  }, '');
  return {
    projectId,
    task: {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId,
      goal,
      originalGoal: raw,
      fromSecretary: true,
      boardReview: boardAssessment.important ? Object.assign({ required: true, source: 'secretary' }, boardAssessment) : { required: false, source: 'secretary', reason: boardAssessment.reason },
      bounds: payload.bounds || DEFAULT_BOUNDS,
      inputs,
      attachments,
      acceptance: payload.acceptance || 'CEO 完成项目归属判定,写 brief,入队项目主管;项目主管完成后更新 status/rollup。',
      useOrchestrator: payload.useOrchestrator !== false,
      autoApproveHuman: payload.autoApproveHuman !== false,
    },
  };
}

async function handleSecretary(entry) {
  const latest = readRunningEntry(entry.id) || entry;
  const payload = payloadFrom(latest);
  const taskId = `sec-${Date.now()}-${entry.id}`;
  eventlog.emit('queue.claimed', { queueAgent: AGENT, queueId: entry.id });
  eventlog.emit('task.created', { task: taskId, flow: 'secretary-route', start: 'expand', queueAgent: AGENT, queueId: entry.id });
  eventlog.emit('node.start', { task: taskId, node: 'expand', attempt: 1, role: 'secretary', queueAgent: AGENT, queueId: entry.id });
  const envelope = buildSecretaryEnvelope(payload, latest);
  if (envelope.blocked) {
    eventlog.emit('node.await_human', { task: taskId, node: 'expand', attempt: 1, role: 'secretary', reason: envelope.reason });
    Q.finish(QUEUE_ROOT, AGENT, entry.id, 'paused', { reason: envelope.reason, error: null });
    eventlog.emit('secretary.route.paused', { task: taskId, queueAgent: AGENT, queueId: entry.id, reason: envelope.reason });
    eventlog.emit('queue.paused', { queueAgent: AGENT, queueId: entry.id, task: taskId, reason: envelope.reason });
    notifyQueueIssueTiered({
      taskId,
      queueAgent: AGENT,
      queueId: entry.id,
      flowId: 'secretary-route',
      role: 'secretary',
      projectId: null,
      goal: taskTextForSecretary(payload, latest),
    }, entry, envelope.reason, null);
    return;
  }
  if (envelope.task && envelope.task.boardReview && envelope.task.boardReview.required) {
    eventlog.emit('secretary.important_architecture', {
      task: taskId,
      queueAgent: AGENT,
      queueId: entry.id,
      projectId: envelope.projectId,
      reason: envelope.task.boardReview.reason,
      matches: envelope.task.boardReview.matches || [],
      labels: envelope.task.boardReview.labels || [],
    });
  }
  eventlog.emit('secretary.expanded', { task: taskId, queueAgent: AGENT, queueId: entry.id, projectId: envelope.projectId });
  const ceoEntry = QueueAutoMerge.enqueue(QUEUE_ROOT, 'ceo', envelope.task, { priority: latest.priority != null ? latest.priority : 50, eventlog, source: 'secretary-route' });
  eventlog.emit('queue.enqueued', {
    queueAgent: 'ceo',
    queueId: ceoEntry.id,
    priority: ceoEntry.priority,
    goal: String(envelope.task.goal || '').slice(0, 500),
    attachments: (envelope.task.attachments || []).length || undefined,
    sourceQueueAgent: AGENT,
    sourceQueueId: entry.id,
    projectId: envelope.projectId,
  });
  eventlog.emit('edge.take', { task: taskId, from: 'secretary', to: 'orchestrator', projectId: envelope.projectId });
  eventlog.emit('node.end', { task: taskId, node: 'expand', attempt: 1, role: 'secretary' });
  eventlog.emit('task.done', { task: taskId, flow: 'secretary-route', evidence: 1, projectId: envelope.projectId });
  Q.finish(QUEUE_ROOT, AGENT, entry.id, 'done', { ceoQueueId: ceoEntry.id, projectId: envelope.projectId });
  eventlog.emit('queue.completed', { queueAgent: AGENT, queueId: entry.id, task: taskId, ok: true, status: 'done', projectId: envelope.projectId });
}

function appendProjectStatus(projectId, spec, result) {
  if (!projectId || !result.ok) return;
  const stamp = new Date().toISOString();
  const projDir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(projDir, { recursive: true });
  const cleanGoal = String(spec.goal || '').slice(0, 240).replace(/\s+/g, ' ');
  const block = [
    '',
    `## 项目主管执行记录 ${stamp}`,
    `- 任务:${cleanGoal}`,
    `- 队列:${spec.queueAgent}/${spec.queueId}`,
    `- 引擎任务:${spec.taskId}`,
    `- 状态:完成`,
    '',
  ].join('\n');
  fs.appendFileSync(path.join(projDir, 'status.md'), block);
  fs.mkdirSync(path.dirname(BOARD_ROLLUP), { recursive: true });
  fs.appendFileSync(BOARD_ROLLUP, `\n- ${stamp} · ${projectId}: 项目主管完成 ${spec.queueId}; 引擎任务 ${spec.taskId}。\n`);
  eventlog.emit('project.status.updated', { projectId, task: spec.taskId, queueAgent: spec.queueAgent, queueId: spec.queueId, statusFile: `projects/${projectId}/status.md` });
  eventlog.emit('board.rollup.updated', { projectId, task: spec.taskId, file: 'board/status-rollup.md' });
}

async function handle(entry) {
  if (AGENT === 'secretary') {
    await handleSecretary(entry);
    return;
  }
  const runnerType = runnerTypeForEntry(entry);
  let typeLock = { file: null, release() {} };
  let resourceLock = { release() {} };
  let lease = null;
  let spec = null;
  let resourcesReleased = false;
  let stopPreEngineWaitHeartbeat = null;
  const releaseRunResources = async () => {
    if (resourcesReleased) return;
    resourcesReleased = true;
    if (stopPreEngineWaitHeartbeat) {
      try { stopPreEngineWaitHeartbeat(); } catch (_) {}
      stopPreEngineWaitHeartbeat = null;
    }
    if (lease) {
      try { lease.release(); } catch (_) {}
      lease = null;
    }
    try { typeLock.release(); } catch (_) {}
    typeLock = { file: null, release() {} };
    try {
      const released = resourceLock.release();
      if (released && typeof released.then === 'function') await released;
    } catch (_) {}
    resourceLock = { release() {} };
    releaseClaimedResourceReservation(entry);
  };
  try {
    eventlog.emit('queue.claimed', { queueAgent: AGENT, queueId: entry.id });
    spec = makeSpec(entry);
    noteRunningSpec(entry, spec);
    stopPreEngineWaitHeartbeat = startPreEngineWaitHeartbeat(entry, 'pre-engine-lock-wait');
    if (CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) acquireActiveCeoTask(entry, spec);
    if (RESOURCE_DOMAIN_LOCKS_ENABLED) {
      resourceLock = await ResourceLocks.acquireResourceLease(spec, {
        locksRoot: RESOURCE_LOCKS,
        eventlog,
        timeoutMs: RESOURCE_LOCK_WAIT_TIMEOUT_MS,
        leaseMs: RESOURCE_LOCK_LEASE_MS,
        heartbeatMs: RESOURCE_LOCK_HEARTBEAT_MS,
      });
    }
    typeLock = await acquireRunnerTypeLock(entry, runnerType);
    lease = shouldBypassEngineSlot(entry, spec, runnerType)
      ? bypassEngineSlot(entry, runnerType)
      : await acquireEngineSlot(entry, runnerType);
    lease.typeLockFile = typeLock.file;
    if (stopPreEngineWaitHeartbeat) {
      try { stopPreEngineWaitHeartbeat(); } catch (_) {}
      stopPreEngineWaitHeartbeat = null;
    }
    fs.mkdirSync(ENGINE_JOBS, { recursive: true });
    const specFile = path.join(ENGINE_JOBS, `${spec.taskId}.json`);
    writeJson(specFile, spec);
    eventlog.emit('task.queued', {
      task: spec.taskId,
      flow: spec.flowId,
      role: spec.role,
      goal: spec.goal.slice(0, 500),
      queueAgent: AGENT,
      queueId: entry.id,
      rootQueueAgent: spec.rootQueueAgent || null,
      rootQueueId: spec.rootQueueId || null,
      rootTaskId: spec.rootTaskId || null,
      projectId: spec.projectId || null,
      resourceDomains: spec.resourceDomains || null,
    });

    const result = await runEngine(specFile, entry, lease);
    let recordedFailure = latestTaskFailureReason(spec.taskId);
    let effectiveOk = !!result.ok && !recordedFailure;
    let reason = effectiveOk ? null : (recordedFailure || engineFailureReason(result, spec));
    let downstream = null;
    let downstreamPropagated = false;
    const quotaSignal = !effectiveOk ? classifyQuotaExhaustion(reason, result) : { isQuotaExhausted: false };
    if (!effectiveOk && quotaSignal.isQuotaExhausted) {
      eventlog.emit('quota.signal.detected', {
        queueAgent: AGENT,
        queueId: entry.id,
        task: spec.taskId,
        runnerType,
        confidence: quotaSignal.confidence || null,
        reason: quotaSignal.reason || null,
        rawReason: sanitizeReason(quotaSignal.rawReason || reason),
        code: result && result.code != null ? result.code : null,
        signal: result && result.signal || null,
      });
      await releaseRunResources();
      await handleQuotaDegradation(spec, entry, result, reason, runnerType, quotaSignal);
      return;
    }
    if (!effectiveOk && maybeRetryEngineFailure(spec, entry, result, reason)) {
      return;
    }
    if (effectiveOk && spec.flowId === 'project-route' && AGENT === 'ceo') {
      await releaseRunResources();
      downstream = await waitForProjectRouteDownstream(spec, entry);
      emitProjectRouteFinal(spec, downstream);
      downstreamPropagated = true;
      effectiveOk = downstream.status === 'done';
      reason = effectiveOk ? null : downstream.reason;
      recordedFailure = downstream.status === 'failed' ? (reason || 'downstream failed') : recordedFailure;
      result.downstream = downstream;
    }
    if (!effectiveOk && !recordedFailure && !downstreamPropagated) {
      eventlog.emit('node.fail', { task: spec.taskId, node: 'engine-runner', attempt: 1, role: spec.role, reason, projectId: spec.projectId || null });
      eventlog.emit('task.failed', { task: spec.taskId, flow: spec.flowId, reason });
    }
    const status = downstream ? downstream.status : (result.paused ? 'paused' : (result.canceled ? 'canceled' : (effectiveOk ? 'done' : 'failed')));
    Q.finish(QUEUE_ROOT, AGENT, entry.id, status, {
      engine_code: result.code,
      engine_signal: result.signal || null,
      error: result.error || (!effectiveOk && !result.canceled && !result.paused ? reason : null),
      reason: status === 'paused' ? reason : undefined,
      downstream: downstream ? downstreamEventMeta(downstream) : undefined,
    });
    if (/^supervisor-/.test(AGENT)) appendProjectStatus(spec.projectId, spec, Object.assign({}, result, { ok: effectiveOk }));
    const queueEvent = {
      queueAgent: AGENT,
      queueId: entry.id,
      task: spec.taskId,
      ok: effectiveOk,
      status,
      code: result.code,
      signal: result.signal || null,
      reason,
      rootQueueAgent: spec.rootQueueAgent || null,
      rootQueueId: spec.rootQueueId || null,
      rootTaskId: spec.rootTaskId || null,
    };
    if (status === 'paused') eventlog.emit('queue.paused', queueEvent);
    else eventlog.emit('queue.completed', queueEvent);
	    if (CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) releaseActiveCeoTaskIfComplete(spec, status);
    if (effectiveOk) {
      notifyProjectDone(spec);
    } else if (status === 'paused') {
      notifyQueueIssueTiered(spec, entry, reason, null);
    } else {
      const repairTicket = downstreamPropagated ? null : openAutoRepairTicket(spec, entry, reason, result);
      if (!result.canceled) notifyQueueIssueTiered(spec, entry, reason, repairTicket);
    }
  } finally {
    await releaseRunResources();
  }
}

function findLeaseForQueue(agent, id) {
  for (const s of listSlots()) {
    if (s.data.agent === agent && s.data.queueId === id) return s.data;
  }
  for (const s of listRunnerTypeLocks()) {
    if (s.data.agent === agent && s.data.queueId === id) return s.data;
  }
  const legacy = readJson(LEGACY_ENGINE_LOCK);
  if (legacy && legacy.agent === agent && legacy.queueId === id) return legacy;
  return null;
}

function enginePidForRunning(entry, id) {
  const fromEntry = Runtime.enginePidFromRecord(entry);
  if (fromEntry) return fromEntry;
  const lease = findLeaseForQueue(AGENT, id);
  return Runtime.enginePidFromRecord(lease);
}

function specFromRunningEntry(entry, id) {
  const payload = payloadFrom(entry || {});
  return {
    taskId: entry && entry.taskId || null,
    queueAgent: AGENT,
    queueId: id,
    flowId: entry && entry.flowId || payload.flowId || null,
    role: entry && entry.role || payload.role || roleFromAgent(AGENT),
    projectId: entry && entry.projectId || payload.projectId || projectFromAgent(AGENT) || null,
    goal: payload.goal || payload.message || payload.task || '',
    title: payload.title || entry && entry.title || null,
    summary: payload.summary || entry && entry.summary || null,
    rootQueueAgent: entry && entry.rootQueueAgent || payload.rootQueueAgent || null,
    rootQueueId: entry && entry.rootQueueId || payload.rootQueueId || null,
    rootTaskId: entry && entry.rootTaskId || payload.rootTaskId || null,
  };
}

function recoverRunningEntry(id, e, recoveredReason) {
  const retry = Number(e.retry || 0) + 1;
  if (retry > QUEUE_MAX_RETRY) {
    e.error = `${recoveredReason}; 已超过最大重试 ${QUEUE_MAX_RETRY}`;
    e.retry = retry;
    Q.finish(QUEUE_ROOT, AGENT, id, 'failed', e);
    eventlog.emit('queue.swept', { queueAgent: AGENT, queueId: id, status: 'failed', retry, reason: e.error });
    const syntheticSpec = specFromRunningEntry(e, id);
    const repairTicket = openAutoRepairTicket(syntheticSpec, e, e.error, { code: null, signal: null });
    notifyQueueIssueTiered(syntheticSpec, e, e.error, repairTicket);
    return { status: 'failed', retry };
  }
  const recovered = Q.requeue(QUEUE_ROOT, AGENT, id, {
    retry,
    recovered_at: new Date().toISOString(),
    recovered_reason: recoveredReason,
    error: null,
  });
  if (recovered) {
    eventlog.emit('queue.recovered', { queueAgent: AGENT, queueId: id, retry, maxRetry: QUEUE_MAX_RETRY, reason: recoveredReason });
    eventlog.emit('queue.retry', { queueAgent: AGENT, queueId: id, retry, maxRetry: QUEUE_MAX_RETRY });
  }
  return { status: recovered ? 'queued' : 'missing', retry };
}

function lockReleaseBlocked(result) {
  return !!(result && Array.isArray(result.blocked) && result.blocked.length);
}

async function sweepStaleRunning() {
  await cleanupDeadSlots();
  await cleanupDeadRunnerTypeLocks();
  const runDir = path.join(Q.qdir(QUEUE_ROOT, AGENT), 'running');
  for (const f of fs.readdirSync(runDir).filter(x => /\.json$/.test(x))) {
    const id = f.replace(/\.json$/, '');
    const file = path.join(runDir, f);
    const e = readJson(file) || { id, target: AGENT };
    const canceled = !!e.cancel_requested;
    if (canceled) {
      const lockRelease = await releaseQueueRuntimeLocks(AGENT, id, 'cancel requested before worker restart', {
        meta: { queueAgent: AGENT, queueId: id },
      });
      if (lockReleaseBlocked(lockRelease)) {
        eventlog.emit('queue.recovery.blocked', { queueAgent: AGENT, queueId: id, status: 'canceled', reason: 'runtime lock release blocked before cancel finish', locks: lockRelease.blocked });
        continue;
      }
      Q.finish(QUEUE_ROOT, AGENT, id, 'canceled', e);
      eventlog.emit('queue.swept', { queueAgent: AGENT, queueId: id, status: 'canceled', reason: 'cancel requested before worker restart' });
      continue;
    }
    const runningSpec = specFromRunningEntry(e, id);
    const isProjectRoute = (runningSpec.flowId || e.flowId || e.task && e.task.flowId) === 'project-route';
    if (isProjectRoute) {
      const spec = Object.assign({}, runningSpec, {
        flowId: 'project-route',
        rootQueueAgent: runningSpec.rootQueueAgent || e.rootQueueAgent || 'ceo',
        rootQueueId: runningSpec.rootQueueId || e.rootQueueId || id,
        rootTaskId: runningSpec.rootTaskId || e.rootTaskId || runningSpec.taskId || null,
      });
      const root = lockRootForSpec(spec);
      const { active, fresh } = activeDownstreamEntriesForRoot(root);
      if (fresh.length) {
        touchRunningWaitingDownstream(id, spec, fresh);
        eventlog.emit('queue.running.keepalive', {
          queueAgent: AGENT,
          queueId: id,
          reason: e.waiting_downstream ? 'waiting for project-route downstream' : 'active project-route downstream prevents stale recovery',
          inFlight: fresh.slice(0, 5).map(x => ({ agent: x.agent, queueId: x.queueId, status: x.status })),
          inFlightCount: active.length,
          freshInFlightCount: fresh.length,
        });
        continue;
      }
      if (active.length) {
        const heartbeat = runningEngineHeartbeat(e);
        if (!heartbeat.stale) {
          eventlog.emit('queue.running.keepalive', {
            queueAgent: AGENT,
            queueId: id,
            reason: 'project-route downstream exists but heartbeat is stale; parent heartbeat timeout will decide recovery',
            inFlight: active.slice(0, 5).map(x => ({
              agent: x.agent,
              queueId: x.queueId,
              status: x.status,
              heartbeatAt: x.entry && (x.entry.engine_heartbeat_at || x.entry.engine_started_at || x.entry.started_at) || null,
            })),
            inFlightCount: active.length,
            freshInFlightCount: fresh.length,
            heartbeatAt: heartbeat.at || null,
            heartbeatAgeMs: heartbeat.ageMs,
          });
          continue;
        }
        eventlog.emit('queue.downstream.stale', {
          queueAgent: AGENT,
          queueId: id,
          reason: 'all project-route downstream entries are stale and parent heartbeat timed out',
          inFlight: active.slice(0, 5).map(x => ({ agent: x.agent, queueId: x.queueId, status: x.status })),
          inFlightCount: active.length,
          heartbeatAt: heartbeat.at || null,
          heartbeatAgeMs: heartbeat.ageMs,
        });
      }
      if (e.waiting_downstream) {
        const downstream = summarizeDownstreamResult(root);
        if (downstream) {
          emitProjectRouteFinal(spec, downstream);
          const status = downstream.status;
          const effectiveOk = status === 'done';
          const reason = effectiveOk ? null : downstream.reason;
          const lockRelease = await releaseQueueRuntimeLocks(AGENT, id, 'project-route downstream terminal', {
            meta: { queueAgent: AGENT, queueId: id, status },
          });
          if (lockReleaseBlocked(lockRelease)) {
            eventlog.emit('queue.recovery.blocked', { queueAgent: AGENT, queueId: id, status, reason: 'runtime lock release blocked before downstream terminal finish', locks: lockRelease.blocked });
            continue;
          }
          Q.finish(QUEUE_ROOT, AGENT, id, status, {
            error: !effectiveOk && status !== 'paused' ? reason : null,
            reason: status === 'paused' ? reason : undefined,
            downstream: downstreamEventMeta(downstream),
          });
          const queueEvent = {
            queueAgent: AGENT,
            queueId: id,
            task: spec.taskId,
            ok: effectiveOk,
            status,
            reason,
            rootQueueAgent: spec.rootQueueAgent || null,
            rootQueueId: spec.rootQueueId || null,
            rootTaskId: spec.rootTaskId || null,
          };
          if (status === 'paused') eventlog.emit('queue.paused', queueEvent);
          else eventlog.emit('queue.completed', queueEvent);
	      if (CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) releaseActiveCeoTaskIfComplete(spec, status);
          eventlog.emit('queue.swept', { queueAgent: AGENT, queueId: id, status, reason: 'project-route downstream already terminal' });
          continue;
        }
        const heartbeat = runningEngineHeartbeat(e);
        if (!heartbeat.stale) {
          eventlog.emit('queue.running.keepalive', {
            queueAgent: AGENT,
            queueId: id,
            reason: 'waiting_downstream has no terminal result yet; waiting for heartbeat timeout before recovery',
            heartbeatAt: heartbeat.at || null,
            heartbeatAgeMs: heartbeat.ageMs,
          });
          continue;
        }
      }
    }
    const enginePid = enginePidForRunning(e, id);
    const lease = findLeaseForQueue(AGENT, id);
    const heartbeat = runningEngineHeartbeat(e);
    const engineAlive = pidLooksLike(enginePid, 'engine-runner.js');
    if (!enginePid && heartbeat.at && !heartbeat.stale) {
      eventlog.emit('queue.running.keepalive', {
        queueAgent: AGENT,
        queueId: id,
        enginePid: null,
        ownerPid: lease && (lease.ownerPid || lease.pid) || e.owner_pid || e.lease_owner_pid || null,
        reason: 'waiting for engine pid',
        heartbeatAt: heartbeat.at || null,
        heartbeatAgeMs: heartbeat.ageMs,
      });
      continue;
    }
    if (heartbeat.stale) {
      const progress = runningRecentExplicitProgress(e);
      if (engineAlive && progress.fresh) {
        eventlog.emit('queue.running.keepalive', {
          queueAgent: AGENT,
          queueId: id,
          enginePid,
          ownerPid: lease && (lease.ownerPid || lease.pid) || null,
          reason: 'engine heartbeat stale but recent node progress exists',
          heartbeatAt: heartbeat.at || null,
          heartbeatAgeMs: heartbeat.ageMs,
          progressAt: progress.at || null,
          progressAgeMs: progress.ageMs,
        });
        continue;
      }
      if (engineAlive) {
        await terminateOrphanEngine(enginePid, {
          queueAgent: AGENT,
          queueId: id,
          reason: 'engine heartbeat stale',
          heartbeatAt: heartbeat.at,
          heartbeatAgeMs: heartbeat.ageMs,
        });
      }
      const lockRelease = await releaseQueueRuntimeLocks(AGENT, id, 'engine heartbeat stale', {
        meta: { queueAgent: AGENT, queueId: id },
      });
      if (lockReleaseBlocked(lockRelease)) {
        eventlog.emit('queue.recovery.blocked', { queueAgent: AGENT, queueId: id, status: 'running', reason: 'runtime lock release blocked after stale heartbeat kill', locks: lockRelease.blocked });
        continue;
      }
      const seconds = Math.max(0, Math.round((heartbeat.ageMs || 0) / 1000));
      const recoveredReason = `running 项 engine_heartbeat_at ${heartbeat.at || 'unknown'} 已 ${seconds}s 未续约,按心跳超时判死并重新入队`;
      notifyQueueStuckTiered(runningSpec, e, recoveredReason, {
        action: engineAlive ? '已终止失联 engine,随后重新入队或在重试耗尽后失败' : 'engine 心跳已失联,随后重新入队或在重试耗尽后失败',
      });
      recoverRunningEntry(id, e, recoveredReason);
      continue;
    }
    if (engineAlive) {
      const progress = runningNoProgress(e);
      if (progress.stale) {
        const seconds = Math.max(0, Math.round((progress.ageMs || 0) / 1000));
        const recoveredReason = `running 项 ${progress.at || 'unknown'} 后已 ${seconds}s 无节点进展,按节点无进展超时判死并重新入队`;
        notifyQueueStuckTiered(runningSpec, e, recoveredReason, {
          action: '已判定 running 节点无进展卡住,将终止对应 engine 并重新入队或在重试耗尽后失败',
        });
        await terminateOrphanEngine(enginePid, {
          queueAgent: AGENT,
          queueId: id,
          reason: 'engine no node progress',
          progressAt: progress.at || null,
          progressAgeMs: progress.ageMs,
        });
        const lockRelease = await releaseQueueRuntimeLocks(AGENT, id, 'engine no node progress', {
          meta: { queueAgent: AGENT, queueId: id },
        });
        if (lockReleaseBlocked(lockRelease)) {
          eventlog.emit('queue.recovery.blocked', { queueAgent: AGENT, queueId: id, status: 'running', reason: 'runtime lock release blocked after no-progress kill', locks: lockRelease.blocked });
          continue;
        }
        recoverRunningEntry(id, e, recoveredReason);
        continue;
      }
      eventlog.emit('queue.running.keepalive', {
        queueAgent: AGENT,
        queueId: id,
        enginePid,
        ownerPid: lease && (lease.ownerPid || lease.pid) || null,
        reason: 'engine pid alive',
        heartbeatAt: heartbeat.at || null,
        heartbeatAgeMs: heartbeat.ageMs,
      });
      continue;
    }
    const recoveredReason = enginePid
      ? `running 项记录的 enginePid ${enginePid} 已不存在,重新入队`
      : 'running 项无 enginePid,重新入队';
    notifyQueueStuckTiered(runningSpec, e, recoveredReason, {
      action: '已判定 running 占槽异常,随后重新入队或在重试耗尽后失败',
    });
    const lockRelease = await releaseQueueRuntimeLocks(AGENT, id, 'engine pid missing', {
      meta: { queueAgent: AGENT, queueId: id },
    });
    if (lockReleaseBlocked(lockRelease)) {
      eventlog.emit('queue.recovery.blocked', { queueAgent: AGENT, queueId: id, status: 'running', reason: 'runtime lock release blocked after missing engine pid', locks: lockRelease.blocked });
      continue;
    }
    recoverRunningEntry(id, e, recoveredReason);
  }
}

function workerInFlightLimit() {
  if (AGENT === 'secretary' || AGENT === 'repair-lead' || AGENT === 'repair') return 1;
  return QUEUE_WORKER_MAX_IN_FLIGHT;
}

async function handleClaimedEntry(entry) {
  try {
    await handle(entry);
  } catch (e) {
    try { Q.finish(QUEUE_ROOT, AGENT, entry.id, 'failed', { error: e.message }); } catch (_) {}
    const syntheticSpec = {
      taskId: `worker-crash-${Date.now()}-${entry.id}`,
      queueAgent: AGENT,
      queueId: entry.id,
      rootQueueAgent: payloadFrom(entry).rootQueueAgent || (AGENT === 'ceo' ? 'ceo' : null),
      rootQueueId: payloadFrom(entry).rootQueueId || (AGENT === 'ceo' ? entry.id : null),
      rootTaskId: payloadFrom(entry).rootTaskId || null,
      flowId: 'worker-crash',
      role: (payloadFrom(entry).role || roleFromAgent(AGENT)),
      projectId: inferProjectId(payloadFrom(entry)),
    };
    eventlog.emit('node.fail', { task: syntheticSpec.taskId, node: 'queue-worker', attempt: 1, role: syntheticSpec.role, reason: sanitizeReason(e.message), projectId: syntheticSpec.projectId || null });
    eventlog.emit('task.failed', { task: syntheticSpec.taskId, flow: syntheticSpec.flowId, reason: sanitizeReason(e.message) });
    eventlog.emit('queue.completed', { queueAgent: AGENT, queueId: entry.id, task: syntheticSpec.taskId, ok: false, status: 'failed', reason: sanitizeReason(e.message), rootQueueAgent: syntheticSpec.rootQueueAgent || null, rootQueueId: syntheticSpec.rootQueueId || null, rootTaskId: syntheticSpec.rootTaskId || null });
    if (CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) releaseActiveCeoTaskIfComplete(syntheticSpec, 'worker-crash');
    const repairTicket = openAutoRepairTicket(syntheticSpec, entry, `queue worker crashed: ${sanitizeReason(e.message)}`, { code: null, signal: null });
    notifyQueueIssueTiered(syntheticSpec, entry, `queue worker crashed: ${sanitizeReason(e.message)}`, repairTicket);
  } finally {
    releaseClaimedResourceReservation(entry);
  }
}

async function main() {
  await acquireWorkerLock();
  await cleanupRuntimeLocks();
  await sweepStaleRunning();
  let lastSweep = Date.now();
  const reloadDirs = defaultReloadDirs(__dirname);
  const bootSourceRevision = computeSourceRevision(reloadDirs);
  let lastCodeCheck = Date.now();
  const activeHandles = new Set();
  eventlog.emit('queue.worker.start', { queueAgent: AGENT, pid: process.pid, maxInFlight: workerInFlightLimit(), maxConcurrency: ENGINE_MAX_CONCURRENCY, sourceRevision: bootSourceRevision.slice(0, 12) });
  while (true) {
    if (Date.now() - lastSweep >= RUNNING_SWEEP_MS) {
      await sweepStaleRunning();
      lastSweep = Date.now();
      // 拍板 Q7: 日切点把昨日 P1 digest 汇总成一条飞书(内部自带节流,默认 5 分钟查一次)。
      maybeFlushP1DigestAtDayCut();
    }
    if (await waitIfWorkerSuperseded(activeHandles)) continue;
    // P0-B 热重载:仅在空闲(无在途引擎)时复查核心代码指纹;变了 → 优雅退出,server 用新码重启。
    // 绝不打断在途引擎(activeHandles>0 时跳过),贯彻"等在途收尾、不强杀活引擎"。
    if (activeHandles.size === 0 && Date.now() - lastCodeCheck >= CODE_RELOAD_CHECK_MS) {
      lastCodeCheck = Date.now();
      const rev = computeSourceRevision(reloadDirs);
      if (rev !== bootSourceRevision) {
        eventlog.emit('queue.worker.code_reload', { queueAgent: AGENT, pid: process.pid, from: bootSourceRevision.slice(0, 12), to: rev.slice(0, 12) });
        process.exit(0); // process.once('exit') 释放 pidfile;server.ensureQueueWorker 用新代码重启
      }
    }
    if (activeHandles.size >= workerInFlightLimit()) {
      await Promise.race(activeHandles);
      continue;
    }
    if (AGENT === 'ceo' && CEO_ACTIVE_TASK_SERIAL_LOCK_ENABLED) {
      const next = peekQueuedEntry(AGENT);
      if (!next) {
        if (activeHandles.size) await Promise.race([Promise.race(activeHandles), sleep(800)]);
        else await sleep(800);
        continue;
      }
      await waitForCeoActiveTaskTurn(next);
    }
    const entry = await claimNextRunnableEntry();
    if (!entry) {
      if (activeHandles.size) await Promise.race([Promise.race(activeHandles), sleep(800)]);
      else await sleep(800);
      continue;
    }
    const task = handleClaimedEntry(entry);
    activeHandles.add(task);
    task.finally(() => activeHandles.delete(task));
  }
}

function runMain() {
  main().catch(e => {
    try { eventlog.emit('queue.worker.crash', { queueAgent: AGENT, reason: e.message }); } catch (_) {}
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

if (require.main === module) runMain();

module.exports = {
  classifyFailureSeverity,
  _test: {
    activeRootEntries,
    appendP1DigestEntry,
    buildP1DigestNotice,
    classifyFailureSeverity,
    flushP1Digest,
    maybeFlushP1DigestAtDayCut,
    notifyQueueIssueTiered,
    notifyQueueStuckTiered,
    openAutoRepairTicket,
    routeOwnerFailureNotice,
    acquireActiveCeoTask,
    entryBelongsToRoot,
	    lockRootForCeoEntry,
	    lockRootForSpec,
	    makeSpec,
    buildProjectDoneNotice,
    conciseNotifyTaskName,
    defaultProjectId,
    flushOwnerAutoNoticeNow,
    flushOwnerAutoNoticeGroup,
    inferProjectId,
    isInfraRestartNoise,
    isQueueAgentDirName,
    isRetryableEngineFailure,
    latestTaskFailureReason,
    isTestPassProjectNotice,
    classifyQuotaExhaustion,
    handleQuotaDegradation,
    isQuotaScopePausedForEntry,
    quotaScopeForAgentEntry,
    quotaScopeForSpec,
    quotaSnapshotEntries,
    runningEntriesForQuotaScope,
	    noticeReasonCategory,
	    isExternalModelTransientFailure,
	    isExpectedNonRepairStop,
	    notifyQueueIssue,
	    notifyQueueStuck,
	    notifyGoalSource,
	    normalizeProjectId,
	    prefixedNotifyTitle,
	    releaseQueueRuntimeLocks,
	    runningNoProgress,
	    resourceDomainsForTask: ResourceLocks.normalizeResourceRequest,
    shouldSkipProjectDoneNotice,
	    shouldBypassEngineSlot,
	    runEngine,
	    sameActiveRoot,
	    descendantEntriesForRoot,
	    emitProjectRouteFinal,
	    runningEngineHeartbeat,
	    summarizeDownstreamResult,
	    sweepStaleRunning,
	    sweepActiveCeoTaskLock,
	    workerPidFileRecordOwned,
	    waitForCeoActiveTaskTurn,
	    waitForProjectRouteDownstream,
	  },
	};
