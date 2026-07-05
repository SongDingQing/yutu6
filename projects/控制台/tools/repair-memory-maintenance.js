#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const STATE_DIR = path.join(ARTIFACTS_ROOT, 'memory-maintenance');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STATUS_FILE = path.join(STATE_DIR, 'status.json');
const EVENTS_FILE = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const ResourceLocks = require('../resource-locks');
const Q = require(path.join(WORKDIR, 'shared', 'engine', 'queue'));
const EventLog = require(path.join(WORKDIR, 'shared', 'engine', 'eventlog'));

const DEFAULT_MIN_PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PRESSURE_RATIO = 0.15;
const CRITICAL_PRESSURE_RATIO = 0.08;

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function emit(eventlog, type, data) {
  try { eventlog.emit(type, data || {}); } catch (_) {}
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args || [], {
    cwd: WORKDIR,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 5000,
    maxBuffer: opts.maxBuffer || 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    code: res.status == null ? null : res.status,
    signal: res.signal || null,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    error: res.error && res.error.message || null,
  };
}

function sysctlNumber(name) {
  const res = run('/usr/sbin/sysctl', ['-n', name]);
  const n = Number(String(res.stdout || '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseVmStat(text, totalBytes) {
  const pageSizeMatch = String(text || '').match(/page size of (\d+) bytes/i);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
  const pages = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^Pages\s+([^:]+):\s+([0-9.]+)/i);
    if (!m) continue;
    pages[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = Number(String(m[2]).replace(/\./g, ''));
  }
  const bytes = key => Math.max(0, Number(pages[key] || 0) * pageSize);
  const freeBytes = bytes('free') + bytes('speculative');
  const inactiveBytes = bytes('inactive');
  const purgeableBytes = bytes('purgeable');
  const availableBytes = freeBytes + inactiveBytes + purgeableBytes;
  const usedBytes = Math.max(0, totalBytes ? totalBytes - availableBytes : 0);
  return {
    pageSize,
    totalBytes,
    freeBytes,
    inactiveBytes,
    purgeableBytes,
    availableBytes,
    usedBytes,
    availableRatio: totalBytes ? availableBytes / totalBytes : null,
    rawPages: pages,
  };
}

function collectMemoryStats() {
  const totalBytes = sysctlNumber('hw.memsize');
  const vm = run('/usr/bin/vm_stat', []);
  const stats = parseVmStat(vm.stdout, totalBytes);
  const ratio = stats.availableRatio == null ? 1 : stats.availableRatio;
  const level = ratio <= CRITICAL_PRESSURE_RATIO ? 'critical' : (ratio <= DEFAULT_PRESSURE_RATIO ? 'warning' : 'ok');
  return Object.assign(stats, {
    ok: vm.ok && !!totalBytes,
    level,
    vmStatOk: vm.ok,
    vmStatError: vm.ok ? null : (vm.stderr || vm.error || `exit ${vm.code}`).slice(0, 300),
  });
}

function safeAgent(s) {
  return /^[\p{L}\p{N}_-]+$/u.test(String(s || '')) ? String(s) : '';
}

function queueAgents(root = ARTIFACTS_ROOT) {
  const dir = path.join(root, 'queues');
  try {
    return fs.readdirSync(dir).filter(safeAgent).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return [];
  }
}

function queueTaskText(task) {
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    return String(task.title || task.goal || task.message || task.task || JSON.stringify(task)).replace(/\s+/g, ' ').slice(0, 160);
  }
  return String(task || '').replace(/\s+/g, ' ').slice(0, 160);
}

function activeQueueItems(opts = {}) {
  const ignore = new Set(opts.ignoreAgents || []);
  const out = [];
  for (const agent of queueAgents(opts.artifactsRoot || ARTIFACTS_ROOT)) {
    if (ignore.has(agent)) continue;
    let listed;
    try { listed = Q.list(opts.artifactsRoot || ARTIFACTS_ROOT, agent); } catch (_) { continue; }
    for (const entry of listed.queued || []) out.push({ agent, queueId: entry.id, status: 'queued', goal: queueTaskText(entry.task) });
    for (const entry of listed.running || []) out.push({ agent, queueId: entry.id, status: entry.cancel_requested ? 'canceling' : 'running', goal: queueTaskText(entry.task) });
  }
  return out;
}

function removeOldTmpFiles(dir, opts = {}) {
  const maxAgeMs = Number(opts.maxAgeMs || 12 * 60 * 60 * 1000);
  const removed = [];
  const visit = current => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git'].includes(entry.name)) visit(file);
        continue;
      }
      if (!/(\.tmp$|^\.tmp|\.part$|\.download$)/.test(entry.name)) continue;
      let st = null;
      try { st = fs.statSync(file); } catch (_) {}
      if (!st || Date.now() - st.mtimeMs < maxAgeMs) continue;
      try {
        fs.unlinkSync(file);
        removed.push(path.relative(WORKDIR, file));
      } catch (_) {}
    }
  };
  visit(dir);
  return removed;
}

function purgeCommand() {
  for (const bin of ['/usr/sbin/purge', '/usr/bin/purge', 'purge']) {
    if (bin === 'purge') return bin;
    try {
      if (fs.existsSync(bin)) return bin;
    } catch (_) {}
  }
  return 'purge';
}

function shouldPurge({ memory, active, state, apply, force }) {
  if (!apply) return { ok: false, reason: 'dry-run' };
  if (active.length && !force) return { ok: false, reason: 'queues-active' };
  if (!memory.ok) return { ok: false, reason: 'memory-stats-unavailable' };
  if (memory.level === 'ok' && !force) return { ok: false, reason: 'memory-pressure-ok' };
  const last = Date.parse(state.lastPurgeAt || '') || 0;
  const dueAt = last + DEFAULT_MIN_PURGE_INTERVAL_MS;
  if (last && Date.now() < dueAt && !force) {
    return { ok: false, reason: 'purge-cooldown', nextAt: new Date(dueAt).toISOString() };
  }
  return { ok: true, reason: force ? 'forced' : `memory-${memory.level}` };
}

function runPurge() {
  const bin = purgeCommand();
  const res = run(bin, [], { timeoutMs: 60 * 1000, maxBuffer: 512 * 1024 });
  return {
    attempted: true,
    ok: res.ok,
    code: res.code,
    signal: res.signal,
    reason: res.ok ? 'purge-completed' : (res.stderr || res.error || `exit ${res.code}`).slice(0, 300),
  };
}

async function runOnce(opts = {}) {
  const eventlog = opts.eventlog || new EventLog(opts.eventsFile || EVENTS_FILE);
  const state = readJson(opts.stateFile || STATE_FILE) || {};
  const memory = collectMemoryStats();
  const active = activeQueueItems({
    artifactsRoot: opts.artifactsRoot || ARTIFACTS_ROOT,
    ignoreAgents: opts.ignoreAgents || ['ui_optimizer'],
  });
  const staleResourceLocks = await ResourceLocks.sweepStaleResourceLocks(
    path.join(opts.artifactsRoot || ARTIFACTS_ROOT, 'resource-locks'),
    { eventlog, leaseMs: Number(opts.resourceLeaseMs || 5 * 60 * 1000) },
  );
  const removedTmpFiles = opts.cleanupTmp === false
    ? []
    : removeOldTmpFiles(opts.artifactsRoot || ARTIFACTS_ROOT, { maxAgeMs: Number(opts.tmpMaxAgeMs || 12 * 60 * 60 * 1000) });
  const decision = shouldPurge({
    memory,
    active,
    state,
    apply: !!opts.apply,
    force: !!opts.force,
  });
  const purge = decision.ok ? runPurge() : { attempted: false, ok: true, skipped: true, reason: decision.reason, nextAt: decision.nextAt || null };
  const nextState = Object.assign({}, state, {
    lastCheckAt: nowIso(),
    lastMemoryLevel: memory.level,
    lastAvailableRatio: memory.availableRatio,
    lastActiveCount: active.length,
    lastPurgeDecision: purge.reason,
  });
  if (purge.attempted && purge.ok) nextState.lastPurgeAt = nowIso();
  writeJsonAtomic(opts.stateFile || STATE_FILE, nextState);
  const result = {
    ok: true,
    at: nowIso(),
    apply: !!opts.apply,
    memory,
    activeCount: active.length,
    active: active.slice(0, 10),
    staleResourceLocks,
    removedTmpFiles,
    purge,
  };
  writeJsonAtomic(opts.statusFile || STATUS_FILE, result);
  emit(eventlog, 'maintenance.memory.checked', {
    level: memory.level,
    availableRatio: memory.availableRatio,
    activeCount: active.length,
    purgeAttempted: !!purge.attempted,
    purgeReason: purge.reason,
    staleResourceLocks: staleResourceLocks.length,
    removedTmpFiles: removedTmpFiles.length,
  });
  return result;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const value = (name, fallback = null) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  return {
    json: args.has('--json'),
    apply: args.has('--apply'),
    force: args.has('--force'),
    daemon: args.has('--daemon'),
    intervalMs: Math.max(60 * 1000, Number(value('--interval-ms', 12 * 60 * 60 * 1000)) || 12 * 60 * 60 * 1000),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const once = async () => {
    const result = await runOnce({ apply: args.apply, force: args.force });
    if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(`${result.memory.level}: purge=${result.purge.reason}, active=${result.activeCount}\n`);
  };
  await once();
  if (!args.daemon) return;
  setInterval(() => {
    once().catch(e => console.error(e && e.stack || e));
  }, args.intervalMs);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

module.exports = {
  activeQueueItems,
  collectMemoryStats,
  parseVmStat,
  runOnce,
  shouldPurge,
};
