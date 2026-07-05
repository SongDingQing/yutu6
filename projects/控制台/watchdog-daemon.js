#!/usr/bin/env node
'use strict';

/*
 * 玉兔6控制台 · 独立外层 watchdog daemon.
 *
 * This process is intentionally meant to run under its own launchd service
 * (com.yutu6.watchdog), outside the console server/worker process tree.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const EventLog = require('../../shared/engine/eventlog');
const Q = require('../../shared/engine/queue');
const Runtime = require('./engine-runtime');
const DailyIgnition = require('./daily-ignition');

const ROOT = __dirname;
const WORKDIR = path.resolve(ROOT, '../..');
const CFG = readJson(path.join(ROOT, 'config.json')) || {};
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const ENGINE_EVENTS = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const WATCHDOG_DIR = path.join(ARTIFACTS_ROOT, 'watchdog');
const WATCHDOG_STATE = path.join(WATCHDOG_DIR, 'state.json');
const WATCHDOG_STATUS = path.join(WATCHDOG_DIR, 'status.json');
const WATCHDOG_RESTARTS = path.join(WATCHDOG_DIR, 'restarts.jsonl');

const DEFAULTS = {
  serviceLabel: process.env.CONSOLE_LAUNCHD_LABEL || 'com.yutu6.console',
  servicePlist: process.env.CONSOLE_LAUNCHD_PLIST || path.join(ROOT, 'artifacts', 'com.yutu6.console.plist'),
  watchdogLabel: process.env.WATCHDOG_LAUNCHD_LABEL || 'com.yutu6.watchdog',
  uid: Number(process.env.CONSOLE_LAUNCHD_UID || (process.getuid ? process.getuid() : process.env.UID)) || 501,
  port: Number(process.env.PORT || CFG.port || 41218) || 41218,
  intervalMs: intEnv('WATCHDOG_INTERVAL_MS', 30 * 1000, 1000),
  httpTimeoutMs: intEnv('WATCHDOG_HTTP_TIMEOUT_MS', 2500, 500),
  httpReadyGraceMs: intEnv('WATCHDOG_HTTP_READY_GRACE_MS', 45 * 1000, 1000),
  httpProbeIntervalMs: intEnv('WATCHDOG_HTTP_PROBE_INTERVAL_MS', 1000, 100),
  httpProbePath: process.env.WATCHDOG_HTTP_PROBE_PATH || '/api/health',
  workerStaleMs: intEnv('WATCHDOG_WORKER_STALE_MS', 5 * 60 * 1000, 30 * 1000),
  runningStaleMs: intEnv('WATCHDOG_RUNNING_STALE_MS', 10 * 60 * 1000, 60 * 1000),
  noProgressStaleMs: intEnv('WATCHDOG_NO_PROGRESS_STALE_MS', 12 * 60 * 1000, 60 * 1000),
  eventStaleMs: intEnv('WATCHDOG_EVENT_STALE_MS', 10 * 60 * 1000, 60 * 1000),
  lockStaleMs: intEnv('WATCHDOG_LOCK_STALE_MS', 30 * 60 * 1000, 60 * 1000),
  restartCooldownMs: intEnv('WATCHDOG_RESTART_COOLDOWN_MS', 2 * 60 * 1000, 30 * 1000),
  restartWindowMs: intEnv('WATCHDOG_RESTART_WINDOW_MS', 30 * 60 * 1000, 5 * 60 * 1000),
  restartMaxInWindow: intEnv('WATCHDOG_RESTART_MAX_IN_WINDOW', 3, 1),
  stopTimeoutMs: intEnv('WATCHDOG_STOP_TIMEOUT_MS', 25 * 1000, 5 * 1000),
  cleanupTimeoutMs: intEnv('WATCHDOG_CLEANUP_TIMEOUT_MS', 45 * 1000, 5 * 1000),
  startTimeoutMs: intEnv('WATCHDOG_START_TIMEOUT_MS', 45 * 1000, 5 * 1000),
  persistentAgents: String(process.env.PERSISTENT_QUEUE_AGENTS || 'repair')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
};

function intEnv(name, fallback, min = 0) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

// 拍板③ watchdog 降权: worker-heartbeat-stale 降级为「只重拉该 worker」
// (TERM 该 worker pid + 删 .worker.pid,由 server 的 worker 监督循环
// ensureWorkersForBacklog(10s)自动重拉);running-* / console-* 保留整机重启。
// YUTU6_WATCHDOG_TIERED=0 退回旧行为(全部整机重启)。默认开。
function tieredRestartEnabled(opts = {}) {
  if (opts.tieredRestart != null) return !!opts.tieredRestart;
  return boolEnv('YUTU6_WATCHDOG_TIERED', true);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function appendJsonl(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(data) + '\n');
}

function safeAgent(agent) {
  const s = String(agent || '');
  return /^[\p{L}\p{N}_-]+$/u.test(s) ? s : null;
}

function eventlog(opts = {}) {
  return opts.eventlog || new EventLog(opts.eventsFile || ENGINE_EVENTS);
}

function emitWatchdogEvent(type, data = {}, opts = {}) {
  try {
    eventlog(opts).emit(type, Object.assign({
      source: 'watchdog-daemon',
    }, data || {}));
  } catch (_) {}
}

function serviceTarget(opts = {}) {
  const uid = Number(opts.uid || DEFAULTS.uid) || DEFAULTS.uid;
  const label = opts.serviceLabel || DEFAULTS.serviceLabel;
  return `gui/${uid}/${label}`;
}

function spawnLaunchctl(args, opts = {}) {
  if (opts.ops && typeof opts.ops.spawnLaunchctl === 'function') {
    return opts.ops.spawnLaunchctl(args, opts);
  }
  return spawnSync('/bin/launchctl', args, {
    cwd: WORKDIR,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 5000,
  });
}

function launchdInfo(opts = {}) {
  if (opts.ops && typeof opts.ops.launchdInfo === 'function') {
    return opts.ops.launchdInfo(opts);
  }
  const target = serviceTarget(opts);
  const res = spawnLaunchctl(['print', target], opts);
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  const pid = parseInt((stdout.match(/^\s*pid = (\d+)/m) || [])[1] || '', 10) || 0;
  const state = (stdout.match(/^\s*state = ([^\n]+)/m) || [])[1] || null;
  return {
    ok: res.status === 0,
    target,
    pid,
    alive: !!pid && Runtime.pidAlive(pid),
    state,
    code: res.status == null ? null : res.status,
    error: res.error && res.error.message || null,
    stderr: stderr.slice(0, 400),
  };
}

function httpProbe(opts = {}) {
  if (opts.ops && typeof opts.ops.httpProbe === 'function') return opts.ops.httpProbe(opts);
  if (opts.checkHttp === false) return Promise.resolve({ ok: true, skipped: true });
  const port = Number(opts.port || DEFAULTS.port) || DEFAULTS.port;
  const timeoutMs = Number(opts.httpTimeoutMs || DEFAULTS.httpTimeoutMs) || DEFAULTS.httpTimeoutMs;
  const probePath = String(opts.httpProbePath || DEFAULTS.httpProbePath || '/api/health');
  const startedAt = Date.now();
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: probePath,
      method: 'GET',
      timeout: timeoutMs,
    }, res => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 500,
        statusCode: res.statusCode,
        path: probePath,
        durationMs: Date.now() - startedAt,
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`timeout ${timeoutMs}ms`));
    });
    req.on('error', e => resolve({
      ok: false,
      error: e.message,
      path: probePath,
      durationMs: Date.now() - startedAt,
    }));
    req.end();
  });
}

async function waitForHttpReady(opts = {}) {
  if (opts.ops && typeof opts.ops.waitForHttpReady === 'function') return opts.ops.waitForHttpReady(opts);
  if (opts.checkHttp === false) return { ok: true, skipped: true, attempts: 0 };
  const graceMs = Number(opts.httpReadyGraceMs || DEFAULTS.httpReadyGraceMs) || DEFAULTS.httpReadyGraceMs;
  const intervalMs = Number(opts.httpProbeIntervalMs || DEFAULTS.httpProbeIntervalMs) || DEFAULTS.httpProbeIntervalMs;
  const startedAt = Date.now();
  const deadline = startedAt + graceMs;
  let attempts = 0;
  let lastProbe = null;
  const failures = [];
  while (true) {
    attempts += 1;
    lastProbe = await httpProbe(opts);
    if (lastProbe && lastProbe.ok) {
      return Object.assign({}, lastProbe, {
        ok: true,
        attempts,
        elapsedMs: Date.now() - startedAt,
        graceMs,
      });
    }
    if (lastProbe) failures.push({
      atMs: Date.now() - startedAt,
      statusCode: lastProbe.statusCode == null ? null : lastProbe.statusCode,
      error: lastProbe.error || null,
      durationMs: lastProbe.durationMs == null ? null : lastProbe.durationMs,
    });
    if (Date.now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  return {
    ok: false,
    attempts,
    elapsedMs: Date.now() - startedAt,
    graceMs,
    lastProbe,
    failures: failures.slice(-8),
    error: lastProbe && (lastProbe.error || (lastProbe.statusCode ? `http ${lastProbe.statusCode}` : null)) || `not ready within ${graceMs}ms`,
  };
}

function queueAgents(opts = {}) {
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  const out = new Set(['ceo']);
  const roleRouting = (opts.config || CFG).roleRouting || {};
  for (const id of Object.keys(roleRouting)) {
    const agent = id === 'orchestrator' ? 'ceo' : (id === 'memory_officer' ? 'memory-officer' : id);
    if (safeAgent(agent)) out.add(agent);
  }
  for (const agent of opts.persistentAgents || DEFAULTS.persistentAgents) {
    if (safeAgent(agent)) out.add(agent);
  }
  try {
    const dir = path.join(artifactsRoot, 'queues');
    for (const agent of fs.readdirSync(dir)) {
      if (safeAgent(agent)) out.add(agent);
    }
  } catch (_) {}
  return [...out].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function workerPidState(artifactsRoot, agent, opts = {}) {
  const pidFile = path.join(artifactsRoot, 'queues', agent, '.worker.pid');
  const record = readJson(pidFile);
  const pid = Number(record && record.pid || 0);
  const alive = !!pid && Runtime.pidLooksLike(pid, 'ceo-worker.js');
  const heartbeatRaw = record && (record.heartbeat_at || record.updated_at || record.started_at);
  const heartbeatTs = heartbeatRaw ? Date.parse(heartbeatRaw) : 0;
  const heartbeatAgeMs = heartbeatTs ? Date.now() - heartbeatTs : Infinity;
  const staleMs = Number(opts.workerStaleMs || DEFAULTS.workerStaleMs);
  return {
    agent,
    pidFile,
    record,
    pid,
    alive,
    heartbeatAt: heartbeatRaw || null,
    heartbeatAgeMs,
    stale: !alive || !heartbeatTs || heartbeatAgeMs > staleMs,
  };
}

function queueSnapshot(opts = {}) {
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  const agents = queueAgents(opts);
  const items = [];
  const running = [];
  let queuedCount = 0;
  let runningCount = 0;
  for (const agent of agents) {
    let listed;
    try { listed = Q.list(artifactsRoot, agent); } catch (_) { continue; }
    queuedCount += (listed.queued || []).length;
    runningCount += (listed.running || []).length;
    items.push({
      agent,
      queued: (listed.queued || []).length,
      running: (listed.running || []).length,
      paused: (listed.paused || []).length,
    });
    for (const entry of listed.running || []) {
      running.push({ agent, id: entry.id, entry });
    }
  }
  return { agents, items, running, queuedCount, runningCount, activeCount: queuedCount + runningCount };
}

function parseIso(value) {
  const t = value ? Date.parse(value) : 0;
  return t || 0;
}

function bestTimestamp(record, fields) {
  let best = 0;
  let bestField = null;
  let bestValue = null;
  for (const field of fields) {
    const value = record && record[field];
    const t = parseIso(value);
    if (t && t >= best) {
      best = t;
      bestField = field;
      bestValue = value;
    }
  }
  return {
    at: bestValue,
    field: bestField,
    ts: best,
    ageMs: best ? Date.now() - best : Infinity,
  };
}

function runningHeartbeat(entry) {
  return bestTimestamp(entry, [
    'engine_heartbeat_at',
    'lease_heartbeat_at',
    'heartbeat_at',
    'updated_at',
    'engine_started_at',
    'started_at',
  ]);
}

function runningProgress(entry) {
  return bestTimestamp(entry, [
    'progress_at',
    'node_event_at',
    'engine_started_at',
    'started_at',
  ]);
}

function sameRoot(a, b) {
  if (!a || !b) return false;
  const aAgent = a.rootQueueAgent || a.target || a.queueAgent;
  const aId = a.rootQueueId || a.id || a.queueId;
  const bAgent = b.rootQueueAgent || b.target || b.queueAgent;
  const bId = b.rootQueueId || b.id || b.queueId;
  return !!aAgent && !!aId && aAgent === bAgent && aId === bId;
}

function hasFreshDownstream(item, runningItems, opts = {}) {
  const entry = item.entry || {};
  if (!entry.waiting_downstream) return false;
  for (const other of runningItems) {
    if (other === item) continue;
    const child = other.entry || {};
    if (!sameRoot(entry, child)) continue;
    const hb = runningHeartbeat(child);
    if (hb.ts && hb.ageMs <= Number(opts.runningStaleMs || DEFAULTS.runningStaleMs)) return true;
  }
  return false;
}

function runningProblems(snapshot, opts = {}) {
  const problems = [];
  for (const item of snapshot.running) {
    const entry = item.entry || {};
    if (hasFreshDownstream(item, snapshot.running, opts)) continue;
    const hb = runningHeartbeat(entry);
    if (!hb.ts || hb.ageMs > Number(opts.runningStaleMs || DEFAULTS.runningStaleMs)) {
      problems.push(Object.assign({
        type: 'running-heartbeat-stale',
        restart: true,
        queueAgent: item.agent,
        queueId: item.id,
        heartbeatAt: hb.at || null,
        heartbeatAgeMs: Number.isFinite(hb.ageMs) ? hb.ageMs : null,
      }, DailyIgnition.dailyIgnitionEventFields(Date.now())));
      continue;
    }
    const progress = runningProgress(entry);
    if (!entry.waiting_downstream && progress.ts && progress.ageMs > Number(opts.noProgressStaleMs || DEFAULTS.noProgressStaleMs)) {
      problems.push({
        type: 'running-no-progress',
        restart: true,
        queueAgent: item.agent,
        queueId: item.id,
        progressAt: progress.at || null,
        progressField: progress.field || null,
        progressAgeMs: progress.ageMs,
      });
    }
  }
  return problems;
}

function listRuntimeLocks(artifactsRoot) {
  const out = [];
  const legacy = path.join(artifactsRoot, 'engine-runner.lock.json');
  if (fs.existsSync(legacy)) out.push({ kind: 'legacy-engine-lock', file: legacy, record: readJson(legacy) });
  for (const spec of [
    { kind: 'slot', dir: path.join(artifactsRoot, 'engine-slots'), pattern: /^slot-\d+\.json$/ },
    { kind: 'runner_lock', dir: path.join(artifactsRoot, 'engine-runner-types'), pattern: /^runner-[A-Za-z0-9_-]+\.json$/ },
  ]) {
    try {
      for (const f of fs.readdirSync(spec.dir).filter(name => spec.pattern.test(name))) {
        out.push({ kind: spec.kind, file: path.join(spec.dir, f), record: readJson(path.join(spec.dir, f)) });
      }
    } catch (_) {}
  }
  return out.filter(x => x.record);
}

function lockProblems(opts = {}) {
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  const problems = [];
  for (const item of listRuntimeLocks(artifactsRoot)) {
    const reason = Runtime.lockSweepReason(item.record, {
      queueRoot: artifactsRoot,
      staleMs: Number(opts.lockStaleMs || DEFAULTS.lockStaleMs),
      runningStaleMs: Math.max(Number(opts.runningStaleMs || DEFAULTS.runningStaleMs), Number(opts.noProgressStaleMs || DEFAULTS.noProgressStaleMs)),
      startupKill: true,
    });
    if (!reason) continue;
    problems.push({
      type: 'runtime-lock-leak',
      restart: true,
      kind: item.kind,
      file: path.basename(item.file),
      queueAgent: item.record.agent || null,
      queueId: item.record.queueId || null,
      runnerType: item.record.runnerType || null,
      reason,
    });
  }
  return problems;
}

function recentJsonlEvents(file, limitBytes = 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, limitBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function latestMeaningfulEvent(opts = {}) {
  const events = recentJsonlEvents(opts.eventsFile || ENGINE_EVENTS);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || /^watchdog\./.test(String(ev.type || ''))) continue;
    return ev;
  }
  return null;
}

function workerProblems(snapshot, opts = {}) {
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  const persistent = new Set(opts.persistentAgents || DEFAULTS.persistentAgents);
  const byAgent = new Map(snapshot.items.map(item => [item.agent, item]));
  const tiered = tieredRestartEnabled(opts);
  const problems = [];
  for (const agent of snapshot.agents) {
    const active = byAgent.get(agent) || { queued: 0, running: 0 };
    if (!persistent.has(agent) && !active.queued && !active.running) continue;
    const state = workerPidState(artifactsRoot, agent, opts);
    if (!state.stale) continue;
    problems.push(Object.assign({
      type: 'worker-heartbeat-stale',
      // 降权(拍板③): tiered 开启时不整机重启,改为 workerRestart(只重拉该 worker)。
      restart: !tiered,
      workerRestart: tiered,
      queueAgent: agent,
      queued: active.queued || 0,
      running: active.running || 0,
      pid: state.pid || null,
      alive: state.alive,
      heartbeatAt: state.heartbeatAt,
      heartbeatAgeMs: Number.isFinite(state.heartbeatAgeMs) ? state.heartbeatAgeMs : null,
    }, DailyIgnition.dailyIgnitionEventFields(Date.now())));
  }
  return problems;
}

function eventProblems(snapshot, opts = {}) {
  if (!snapshot.runningCount) return [];
  const latest = latestMeaningfulEvent(opts);
  const ts = latest && parseIso(latest.ts);
  const ageMs = ts ? Date.now() - ts : Infinity;
  if (ts && ageMs <= Number(opts.eventStaleMs || DEFAULTS.eventStaleMs)) return [];
  return [{
    type: 'engine-events-stale',
    restart: true,
    latestType: latest && latest.type || null,
    latestSeq: latest && latest.seq || null,
    latestAt: latest && latest.ts || null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    runningCount: snapshot.runningCount,
  }];
}

async function collectHealth(opts = {}) {
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  fs.mkdirSync(path.join(artifactsRoot, 'watchdog'), { recursive: true });
  const snapshot = queueSnapshot(Object.assign({}, opts, { artifactsRoot }));
  const problems = [];

  if (opts.checkConsole !== false) {
    const info = launchdInfo(opts);
    if (!info.ok || !info.alive) {
      problems.push({
        type: 'console-not-running',
        restart: true,
        target: info.target,
        launchdOk: info.ok,
        pid: info.pid || null,
        state: info.state || null,
        reason: info.stderr || info.error || 'launchd service has no live pid',
      });
    } else {
      const probe = await waitForHttpReady(opts);
      if (!probe.ok) {
        problems.push({
          type: 'console-http-failed',
          restart: true,
          target: info.target,
          pid: info.pid,
          reason: probe.error || `http ${probe.statusCode}`,
          attempts: probe.attempts || null,
          elapsedMs: probe.elapsedMs || null,
          graceMs: probe.graceMs || null,
        });
      }
    }
  }

  problems.push(...workerProblems(snapshot, opts));
  problems.push(...runningProblems(snapshot, opts));
  problems.push(...lockProblems(Object.assign({}, opts, { artifactsRoot })));
  problems.push(...eventProblems(snapshot, opts));

  const restartProblems = problems.filter(p => p.restart);
  const workerRestartProblems = problems.filter(p => p.workerRestart && !p.restart);
  return {
    ok: restartProblems.length === 0 && workerRestartProblems.length === 0,
    at: nowIso(),
    artifactsRoot,
    serviceLabel: opts.serviceLabel || DEFAULTS.serviceLabel,
    watchdogLabel: opts.watchdogLabel || DEFAULTS.watchdogLabel,
    tieredRestart: tieredRestartEnabled(opts),
    queue: {
      activeCount: snapshot.activeCount,
      queuedCount: snapshot.queuedCount,
      runningCount: snapshot.runningCount,
      agents: snapshot.items,
    },
    problems,
    restartRequired: restartProblems.length > 0,
    workerRestartRequired: workerRestartProblems.length > 0,
  };
}

function compactProblem(problem) {
  const parts = [problem.type];
  if (problem.queueAgent || problem.queueId) parts.push(`${problem.queueAgent || '?'}:${problem.queueId || '?'}`);
  if (problem.reason) parts.push(String(problem.reason));
  return parts.join(' ');
}

function restartReason(health) {
  const problems = (health.problems || []).filter(p => p.restart);
  if (!problems.length) return 'manual watchdog restart';
  return problems.slice(0, 3).map(compactProblem).join('; ');
}

function readState(opts = {}) {
  return readJson(opts.stateFile || WATCHDOG_STATE) || { restarts: [] };
}

function writeState(state, opts = {}) {
  writeJsonAtomic(opts.stateFile || WATCHDOG_STATE, state);
}

function throttleRestart(reason, opts = {}) {
  const now = Date.now();
  const state = readState(opts);
  const windowMs = Number(opts.restartWindowMs || DEFAULTS.restartWindowMs);
  const cooldownMs = Number(opts.restartCooldownMs || DEFAULTS.restartCooldownMs);
  const max = Number(opts.restartMaxInWindow || DEFAULTS.restartMaxInWindow);
  const restarts = Array.isArray(state.restarts) ? state.restarts.filter(x => now - Number(x.atMs || 0) <= windowMs) : [];
  const last = restarts[restarts.length - 1] || null;
  if (last && now - Number(last.atMs || 0) < cooldownMs) {
    return {
      allowed: false,
      state: Object.assign({}, state, { restarts }),
      reason: 'cooldown',
      nextAt: new Date(Number(last.atMs || 0) + cooldownMs).toISOString(),
      recentCount: restarts.length,
    };
  }
  if (restarts.length >= max) {
    return {
      allowed: false,
      state: Object.assign({}, state, { restarts }),
      reason: 'max-in-window',
      nextAt: new Date(Number(restarts[0].atMs || now) + windowMs).toISOString(),
      recentCount: restarts.length,
    };
  }
  restarts.push({ atMs: now, at: nowIso(), reason: String(reason || '').slice(0, 500) });
  return {
    allowed: true,
    state: Object.assign({}, state, { restarts, lastRestartAt: nowIso(), lastRestartReason: reason }),
    recentCount: restarts.length,
  };
}

async function stopConsoleService(opts = {}) {
  if (opts.ops && typeof opts.ops.stopConsoleService === 'function') return opts.ops.stopConsoleService(opts);
  const info = launchdInfo(opts);
  const target = serviceTarget(opts);
  const actions = [];
  if (!info.pid) return { ok: true, action: 'no-live-pid', target, before: info, actions };
  const term = spawnLaunchctl(['kill', 'TERM', target], Object.assign({}, opts, { timeoutMs: 5000 }));
  actions.push({ step: 'launchctl-kill-term', code: term.status == null ? null : term.status, stderr: String(term.stderr || '').slice(0, 300) });
  const deadline = Date.now() + Number(opts.stopTimeoutMs || DEFAULTS.stopTimeoutMs);
  while (Runtime.pidAlive(info.pid) && Date.now() < deadline) await sleep(250);
  if (Runtime.pidAlive(info.pid)) {
    try { process.kill(info.pid, 'SIGKILL'); actions.push({ step: 'kill-kill', pid: info.pid }); } catch (e) { actions.push({ step: 'kill-kill-failed', pid: info.pid, reason: e.message }); }
    await sleep(500);
  }
  return { ok: !Runtime.pidAlive(info.pid), action: 'stopped', target, before: info, actions };
}

async function cleanupRuntimeArtifacts(opts = {}) {
  if (opts.ops && typeof opts.ops.cleanupRuntimeArtifacts === 'function') return opts.ops.cleanupRuntimeArtifacts(opts);
  const timeoutMs = Number(opts.cleanupTimeoutMs || DEFAULTS.cleanupTimeoutMs);
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`cleanup timeout ${timeoutMs}ms`)), timeoutMs);
  });
  const cleanup = (async () => {
    const Server = require('./server');
    await Server.selfCleanRuntimeArtifacts();
    return { ok: true, action: 'selfCleanRuntimeArtifacts' };
  })();
  try {
    return await Promise.race([cleanup, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function startConsoleService(opts = {}) {
  if (opts.ops && typeof opts.ops.startConsoleService === 'function') return opts.ops.startConsoleService(opts);
  const target = serviceTarget(opts);
  const actions = [];
  let kicked = spawnLaunchctl(['kickstart', '-k', target], Object.assign({}, opts, { timeoutMs: 10000 }));
  actions.push({ step: 'launchctl-kickstart', code: kicked.status == null ? null : kicked.status, stderr: String(kicked.stderr || '').slice(0, 300) });
  if (kicked.status !== 0) {
    const plist = opts.servicePlist || DEFAULTS.servicePlist;
    if (plist && fs.existsSync(plist)) {
      const boot = spawnLaunchctl(['bootstrap', `gui/${Number(opts.uid || DEFAULTS.uid) || DEFAULTS.uid}`, plist], Object.assign({}, opts, { timeoutMs: 10000 }));
      actions.push({ step: 'launchctl-bootstrap', plist, code: boot.status == null ? null : boot.status, stderr: String(boot.stderr || '').slice(0, 300) });
      kicked = spawnLaunchctl(['kickstart', '-k', target], Object.assign({}, opts, { timeoutMs: 10000 }));
      actions.push({ step: 'launchctl-kickstart-after-bootstrap', code: kicked.status == null ? null : kicked.status, stderr: String(kicked.stderr || '').slice(0, 300) });
    }
  }
  const deadline = Date.now() + Number(opts.startTimeoutMs || DEFAULTS.startTimeoutMs);
  let info = launchdInfo(opts);
  while ((!info.ok || !info.alive) && Date.now() < deadline) {
    await sleep(500);
    info = launchdInfo(opts);
  }
  return { ok: info.ok && info.alive, action: 'started', target, after: info, actions };
}

async function notifyOwner(title, body, meta = {}, opts = {}) {
  if (opts.notify === false) return { attempted: false, sent: false, skipped: true };
  if (opts.ops && typeof opts.ops.notifyOwner === 'function') return opts.ops.notifyOwner(title, body, meta, opts);
  try {
    const SecretaryTools = require('./secretary-tools');
    const result = SecretaryTools.notify({
      title,
      body,
      source: meta.source || 'watchdog-daemon',
      log: false,
    });
    emitWatchdogEvent(result.sent ? 'watchdog.notify.sent' : 'watchdog.notify.failed', {
      title,
      body: String(body || '').slice(0, 300),
      code: result.code == null ? null : result.code,
      reason: result.sent ? null : String(result.stderr || result.stdout || result.error || 'not sent').slice(0, 300),
    }, opts);
    return result;
  } catch (e) {
    emitWatchdogEvent('watchdog.notify.failed', { title, reason: e.message }, opts);
    return { attempted: true, sent: false, error: e.message };
  }
}

async function restartConsole(health, opts = {}) {
  const reason = opts.reason || restartReason(health);
  const throttle = opts.skipThrottle ? { allowed: true, state: readState(opts), recentCount: 0 } : throttleRestart(reason, opts);
  if (!throttle.allowed) {
    const notifyKey = [reason, throttle.reason || '', throttle.nextAt || ''].join('|');
    const alreadyNotified = throttle.state && throttle.state.lastThrottleNotifyKey === notifyKey;
    const record = {
      id: `wd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      at: nowIso(),
      status: 'throttled',
      throttle: { reason: throttle.reason, nextAt: throttle.nextAt, recentCount: throttle.recentCount },
      reason,
      problems: (health && health.problems || []).filter(p => p.restart),
    };
    appendJsonl(opts.restartLog || WATCHDOG_RESTARTS, record);
    writeState(Object.assign({}, throttle.state, {
      lastThrottleAt: record.at,
      lastThrottleReason: throttle.reason,
      lastThrottleNextAt: throttle.nextAt,
      lastThrottleNotifyKey: alreadyNotified ? throttle.state.lastThrottleNotifyKey : notifyKey,
      lastThrottleNotifyAt: alreadyNotified ? throttle.state.lastThrottleNotifyAt : record.at,
    }), opts);
    emitWatchdogEvent('watchdog.restart.throttled', record, opts);
    if (alreadyNotified) {
      emitWatchdogEvent('watchdog.notify.skipped', {
        title: '控制台 watchdog 已节流',
        reason: 'duplicate-throttle-window',
        throttle: record.throttle,
      }, opts);
    } else {
      await notifyOwner('控制台 watchdog 已节流', `原因: ${reason}\n状态: ${throttle.reason}, 下次可重启 ${throttle.nextAt || '稍后'}`, { source: 'watchdog-throttle' }, opts);
    }
    return record;
  }

  const id = `wd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const record = {
    id,
    at: nowIso(),
    status: 'started',
    reason,
    serviceLabel: opts.serviceLabel || DEFAULTS.serviceLabel,
    problems: (health && health.problems || []).filter(p => p.restart),
    actions: [],
  };
  appendJsonl(opts.restartLog || WATCHDOG_RESTARTS, record);
  writeState(throttle.state, opts);
  emitWatchdogEvent('watchdog.restart.start', {
    id,
    reason,
    problems: record.problems.slice(0, 8),
  }, opts);

  let ok = false;
  try {
    const stopped = await stopConsoleService(opts);
    record.actions.push({ step: 'stop-console', ok: stopped.ok, detail: stopped });
    const cleaned = await cleanupRuntimeArtifacts(opts);
    record.actions.push({ step: 'cleanup-runtime', ok: cleaned.ok, detail: cleaned });
    const started = await startConsoleService(opts);
    record.actions.push({ step: 'start-console', ok: started.ok, detail: started });
    const probe = await waitForHttpReady(opts);
    record.actions.push({ step: 'http-probe', ok: probe.ok, detail: probe });
    ok = !!(stopped.ok && cleaned.ok && started.ok && probe.ok);
    record.status = ok ? 'restarted' : 'failed';
    record.finishedAt = nowIso();
  } catch (e) {
    record.status = 'failed';
    record.finishedAt = nowIso();
    record.error = e && e.stack || String(e);
  }

  appendJsonl(opts.restartLog || WATCHDOG_RESTARTS, record);
  emitWatchdogEvent(ok ? 'watchdog.restart.done' : 'watchdog.restart.failed', {
    id,
    reason,
    status: record.status,
    actions: record.actions.map(a => ({ step: a.step, ok: a.ok })),
    error: record.error ? String(record.error).slice(0, 400) : null,
  }, opts);
  if (ok) {
    emitWatchdogEvent('watchdog.notify.skipped', {
      title: '控制台已自动重启',
      reason: 'successful-restart-suppressed',
      restartId: id,
    }, opts);
  } else {
    await notifyOwner(
      '控制台自动重启失败',
      `原因: ${reason}\n结果: 未完成,已记录日志`,
      { source: 'watchdog-restart' },
      opts,
    );
  }
  return record;
}

function workerPidLooksAlive(pid, opts = {}) {
  if (opts.ops && typeof opts.ops.pidLooksLike === 'function') return opts.ops.pidLooksLike(pid, 'ceo-worker.js');
  return Runtime.pidLooksLike(pid, 'ceo-worker.js');
}

function killWorkerPid(pid, opts = {}) {
  if (opts.ops && typeof opts.ops.killWorkerPid === 'function') return opts.ops.killWorkerPid(pid, opts);
  // 与 server.terminateStaleWorker 对齐: TERM 整个进程组,worker 的子进程一并带走。
  return Runtime.killProcessGroup(pid, 'SIGTERM', { excludePids: [process.pid] });
}

// 降权动作(拍板③): 只重拉单个 worker —— TERM 其 pid 并删 .worker.pid,
// 之后由 server 的 ensureWorkersForBacklog(10s 监督循环)自动重拉。
// 任何失败(pid 不存在 / 信号发不出 / pid 文件删不掉)都返回 ok:false,
// 由 runOnce 回退整机重启并记录原因。
async function restartWorker(problem, opts = {}) {
  if (opts.ops && typeof opts.ops.restartWorker === 'function') return opts.ops.restartWorker(problem, opts);
  const artifactsRoot = opts.artifactsRoot || ARTIFACTS_ROOT;
  const agent = safeAgent(problem && problem.queueAgent);
  const reason = compactProblem(problem || { type: 'worker-heartbeat-stale' });
  const result = { ok: false, agent, pid: Number(problem && problem.pid || 0) || null, reason, actions: [] };
  try {
    if (!agent) throw new Error(`invalid worker agent: ${String(problem && problem.queueAgent || '')}`);
    const pidFile = path.join(artifactsRoot, 'queues', agent, '.worker.pid');
    const record = readJson(pidFile);
    const pid = Number(problem && problem.pid || (record && record.pid) || 0);
    result.pid = pid || null;
    if (!pid) throw new Error('worker pid missing');
    if (!workerPidLooksAlive(pid, opts)) throw new Error(`pid ${pid} is not a live ceo-worker`);
    const killed = killWorkerPid(pid, opts);
    if (killed && killed.sent === false) throw new Error(`TERM not sent: ${killed.reason || 'signal-failed'}`);
    result.actions.push({ step: 'kill-term', pid });
    try {
      fs.unlinkSync(pidFile);
      result.actions.push({ step: 'unlink-pid-file', file: path.basename(pidFile) });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    result.ok = true;
    emitWatchdogEvent('watchdog.worker.restart', { agent, pid, reason }, opts);
  } catch (e) {
    result.error = e.message;
    emitWatchdogEvent('watchdog.worker.restart.failed', {
      agent,
      pid: result.pid,
      reason,
      error: e.message,
    }, opts);
  }
  return result;
}

async function runOnce(opts = {}) {
  const health = await collectHealth(opts);
  writeJsonAtomic(opts.statusFile || WATCHDOG_STATUS, health);
  let workerRestarts = null;
  // 降权路径: 只有 worker 级问题(且没有任何需要整机重启的问题)时,逐个重拉 worker。
  if (opts.restart !== false && health.workerRestartRequired && !health.restartRequired) {
    workerRestarts = [];
    for (const problem of health.problems.filter(p => p.workerRestart && !p.restart)) {
      const result = await restartWorker(problem, opts);
      workerRestarts.push(result);
      if (!result.ok) {
        // 回退: 该问题升级为整机重启,原因记入 problem.reason(进 restarts.jsonl 与事件)。
        problem.restart = true;
        problem.reason = `worker-restart-failed: ${result.error || 'unknown'}`;
      }
    }
    if (workerRestarts.some(r => !r.ok)) {
      health.restartRequired = true;
      health.ok = false;
    }
  }
  if (health.restartRequired && opts.restart !== false) {
    const restart = await restartConsole(health, opts);
    return { ok: restart.status === 'restarted', health, restart, workerRestarts };
  }
  const ok = health.restartRequired
    ? false
    : (workerRestarts ? workerRestarts.every(r => r.ok) : health.ok);
  return { ok, health, restart: null, workerRestarts };
}

async function runDaemon(opts = {}) {
  emitWatchdogEvent('watchdog.daemon.start', {
    pid: process.pid,
    intervalMs: opts.intervalMs || DEFAULTS.intervalMs,
    serviceLabel: opts.serviceLabel || DEFAULTS.serviceLabel,
    watchdogLabel: opts.watchdogLabel || DEFAULTS.watchdogLabel,
  }, opts);
  while (true) {
    try {
      await runOnce(opts);
    } catch (e) {
      const reason = e && e.stack || String(e);
      emitWatchdogEvent('watchdog.daemon.error', { reason: reason.slice(0, 1000) }, opts);
      await notifyOwner('控制台 watchdog 自身异常', `结果: launchd 会保持 watchdog 常驻\n原因: ${String(e && e.message || e).slice(0, 240)}`, { source: 'watchdog-error' }, opts);
    }
    await sleep(Number(opts.intervalMs || DEFAULTS.intervalMs));
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = Object.assign({}, DEFAULTS, {
    restart: args.restart === false || args.restart === 'false' || args.noRestart ? false : true,
    notify: args.notify === false || args.notify === 'false' || args.noNotify ? false : true,
  });
  if (args.once || args.status) {
    const result = await runOnce(opts);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  }
  await runDaemon(opts);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS,
  collectHealth,
  compactProblem,
  eventProblems,
  hasFreshDownstream,
  httpProbe,
  launchdInfo,
  latestMeaningfulEvent,
  lockProblems,
  queueSnapshot,
  restartConsole,
  restartReason,
  restartWorker,
  runDaemon,
  runOnce,
  tieredRestartEnabled,
  runningHeartbeat,
  runningProblems,
  runningProgress,
  throttleRestart,
  waitForHttpReady,
  workerPidState,
  workerProblems,
  _test: {
    appendJsonl,
    readJson,
    sameRoot,
    serviceTarget,
    writeJsonAtomic,
  },
};
