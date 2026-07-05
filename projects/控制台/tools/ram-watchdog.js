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
const WATCH_DIR = path.join(ARTIFACTS_ROOT, 'ram-watchdog');
const STATE_FILE = path.join(WATCH_DIR, 'state.json');
const STATUS_FILE = path.join(WATCH_DIR, 'status.json');
const TREND_FILE = path.join(WATCH_DIR, 'ram_trend.jsonl');
const ACTIONS_FILE = path.join(WATCH_DIR, 'actions.jsonl');
const LOCK_FILE = path.join(WATCH_DIR, 'sample.lock');
const EVENTS_FILE = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const DEFAULT_CONFIG_FILE = path.join(ROOT, 'config', 'ram-watchdog.json');
const EventLog = require(path.join(WORKDIR, 'shared', 'engine', 'eventlog'));

const KILL_CONFIRM_TOKEN = 'RAM_WATCHDOG_ENABLE_KILL';
const DEFAULTS = {
  intervalMs: 60 * 1000,
  lockStaleMs: 5 * 60 * 1000,
  highUsedRatio: 0.88,
  criticalUsedRatio: 0.94,
  swapHighRatio: 0.25,
  consecutiveLimit: 3,
  trendRetentionLines: 1000,
  actionRetentionLines: 1000,
  topProcessLimit: 15,
  minCandidateRssBytes: 1024 * 1024 * 1024,
  selfRssLimitBytes: 256 * 1024 * 1024,
};

const BASE_PROTECTED_NAMES = [
  'kernel_task',
  'launchd',
  'WindowServer',
  'loginwindow',
  'Finder',
  'SystemUIServer',
  'Dock',
  'ControlCenter',
  'configd',
  'notifyd',
  'powerd',
  'opendirectoryd',
  'securityd',
  'trustd',
  'cfprefsd',
  'distnoted',
  'runningboardd',
  'ReportCrash',
  'mds',
  'mdworker_shared',
  'airportd',
  'bluetoothd',
  'coreaudiod',
  'hidd',
  'UserEventAgent',
  'launchservicesd',
  'tccd',
  'softwareupdated',
  'backupd',
  'rapportd',
];

function nowIso() {
  return new Date().toISOString();
}

function intEnv(name, fallback, min = 0) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function clampRatio(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.01, Math.min(0.99, n));
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

function appendJsonl(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(data) + '\n');
}

function rotateJsonl(file, keepLines) {
  const keep = Math.max(1, Number(keepLines || 1));
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return { rotated: false, kept: 0, dropped: 0 }; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length <= keep) return { rotated: false, kept: lines.length, dropped: 0 };
  const kept = lines.slice(-keep);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, kept.join('\n') + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
  return { rotated: true, kept: kept.length, dropped: lines.length - kept.length };
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

function parseSwapUsage(text) {
  const raw = String(text || '');
  const unitBytes = unit => {
    const u = String(unit || '').toUpperCase();
    if (u === 'G') return 1024 * 1024 * 1024;
    if (u === 'M') return 1024 * 1024;
    if (u === 'K') return 1024;
    return 1;
  };
  const pick = label => {
    const m = raw.match(new RegExp(`${label}\\s*=\\s*([0-9.]+)([GMK]?)`, 'i'));
    return m ? Math.round(Number(m[1]) * unitBytes(m[2])) : 0;
  };
  const totalBytes = pick('total');
  const usedBytes = pick('used');
  return {
    totalBytes,
    usedBytes,
    usedRatio: totalBytes ? usedBytes / totalBytes : 0,
  };
}

function parseMemoryPressure(text) {
  const raw = String(text || '');
  const freeMatch = raw.match(/System-wide memory free percentage:\s*([0-9.]+)%/i);
  const pagesWanted = raw.match(/Pages wanted:\s*([0-9]+)/i);
  return {
    freePercent: freeMatch ? Number(freeMatch[1]) : null,
    pagesWanted: pagesWanted ? Number(pagesWanted[1]) : null,
    available: !!raw,
  };
}

function parseVmStat(text, totalBytes) {
  const pageSizeMatch = String(text || '').match(/page size of (\d+) bytes/i);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
  const pages = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^Pages\s+([^:]+):\s+([0-9.]+)/i);
    if (!m) continue;
    pages[m[1].trim().toLowerCase().replace(/[-\s]+/g, '_')] = Number(String(m[2]).replace(/\./g, ''));
  }
  const bytes = key => Math.max(0, Number(pages[key] || 0) * pageSize);
  const freeBytes = bytes('free');
  const speculativeBytes = bytes('speculative');
  const inactiveBytes = bytes('inactive');
  const purgeableBytes = bytes('purgeable');
  const fileBackedBytes = bytes('file_backed');
  const wiredBytes = bytes('wired_down');
  const compressedBytes = bytes('occupied_by_compressor');
  const reclaimableBytes = Math.min(totalBytes || 0, speculativeBytes + inactiveBytes + purgeableBytes);
  const availableBytes = Math.min(totalBytes || 0, freeBytes + speculativeBytes + inactiveBytes + purgeableBytes);
  const usedBytes = Math.max(0, totalBytes ? totalBytes - availableBytes : 0);
  return {
    pageSize,
    totalBytes,
    freeBytes,
    speculativeBytes,
    inactiveBytes,
    purgeableBytes,
    fileBackedBytes,
    wiredBytes,
    compressedBytes,
    reclaimableBytes,
    availableBytes,
    usedBytes,
    usedRatio: totalBytes ? usedBytes / totalBytes : null,
    availableRatio: totalBytes ? availableBytes / totalBytes : null,
    rawPages: pages,
  };
}

function collectMemoryStatsDarwin() {
  const totalBytes = sysctlNumber('hw.memsize');
  const vm = run('/usr/bin/vm_stat', []);
  const swap = run('/usr/sbin/sysctl', ['-n', 'vm.swapusage']);
  const pressure = run('/usr/bin/memory_pressure', [], { timeoutMs: 5000, maxBuffer: 512 * 1024 });
  const stats = parseVmStat(vm.stdout, totalBytes);
  return Object.assign(stats, {
    ok: vm.ok && !!totalBytes,
    vmStatOk: vm.ok,
    vmStatError: vm.ok ? null : (vm.stderr || vm.error || `exit ${vm.code}`).slice(0, 300),
    swap: parseSwapUsage(swap.stdout),
    memoryPressure: parseMemoryPressure(pressure.stdout || pressure.stderr),
  });
}

function sanitizeCommandName(value) {
  const base = path.basename(String(value || '').trim().split(/\s+/)[0] || '');
  return base.replace(/[^\p{L}\p{N}._+-]/gu, '').slice(0, 80) || 'unknown';
}

function parsePs(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const command = String(m[4] || '').trim();
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssBytes: Number(m[3]) * 1024,
      commandName: sanitizeCommandName(command),
    });
  }
  return out;
}

function collectProcessesDarwin() {
  const res = run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { timeoutMs: 5000, maxBuffer: 2 * 1024 * 1024 });
  return {
    ok: res.ok,
    error: res.ok ? null : (res.stderr || res.error || `exit ${res.code}`).slice(0, 300),
    processes: parsePs(res.stdout),
  };
}

function frontmostAppDarwin() {
  const res = run('/usr/bin/osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ], { timeoutMs: 2500, maxBuffer: 128 * 1024 });
  const name = String(res.stdout || '').trim();
  return {
    ok: res.ok && !!name,
    name: res.ok && name ? sanitizeCommandName(name) : null,
    error: res.ok ? null : (res.stderr || res.error || `exit ${res.code}`).slice(0, 300),
  };
}

function processSelfSnapshot(opts = {}) {
  const memoryUsage = opts.memoryUsage || process.memoryUsage();
  return {
    pid: process.pid,
    ppid: process.ppid || null,
    rssBytes: Number(memoryUsage.rss || 0),
  };
}

function loadConfig(file = DEFAULT_CONFIG_FILE) {
  const cfg = readJson(file);
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function normalizeConfig(raw, opts = {}) {
  const cfg = raw || {};
  const killAllowlist = Array.isArray(cfg.kill_allowlist) ? cfg.kill_allowlist.map(sanitizeCommandName).filter(Boolean) : [];
  const enableKillConfigured = Object.prototype.hasOwnProperty.call(cfg, 'enable_kill') ? cfg.enable_kill : null;
  const killGate = {
    enableKillConfigured,
    killConfirmTokenOk: cfg.kill_confirm === KILL_CONFIRM_TOKEN,
    supervisorApproved: cfg.kill_supervisor_approved === true,
    cliExecuteRequested: opts.executeKill === true,
  };
  killGate.configReadyForFutureLiveKill = killGate.enableKillConfigured === true
    && killGate.killConfirmTokenOk
    && killGate.supervisorApproved
    && killGate.cliExecuteRequested;
  killGate.liveKillAllowed = false;
  killGate.reason = killGate.configReadyForFutureLiveKill
    ? 'config-ready-but-v1-dry-run-only'
    : 'disabled-by-default';
  return {
    intervalMs: Math.max(30 * 1000, Number(cfg.sample_interval_ms || opts.intervalMs || DEFAULTS.intervalMs) || DEFAULTS.intervalMs),
    lockStaleMs: Math.max(30 * 1000, Number(cfg.lock_stale_ms || DEFAULTS.lockStaleMs) || DEFAULTS.lockStaleMs),
    highUsedRatio: clampRatio(cfg.high_used_ratio, DEFAULTS.highUsedRatio),
    criticalUsedRatio: clampRatio(cfg.critical_used_ratio, DEFAULTS.criticalUsedRatio),
    swapHighRatio: clampRatio(cfg.swap_high_ratio, DEFAULTS.swapHighRatio),
    consecutiveLimit: Math.max(1, Number(cfg.consecutive_limit || DEFAULTS.consecutiveLimit) || DEFAULTS.consecutiveLimit),
    trendRetentionLines: Math.max(10, Number(cfg.trend_retention_lines || DEFAULTS.trendRetentionLines) || DEFAULTS.trendRetentionLines),
    actionRetentionLines: Math.max(10, Number(cfg.action_retention_lines || DEFAULTS.actionRetentionLines) || DEFAULTS.actionRetentionLines),
    topProcessLimit: Math.max(5, Number(cfg.top_process_limit || DEFAULTS.topProcessLimit) || DEFAULTS.topProcessLimit),
    minCandidateRssBytes: Math.max(0, Number(cfg.min_candidate_rss_bytes || DEFAULTS.minCandidateRssBytes) || DEFAULTS.minCandidateRssBytes),
    selfRssLimitBytes: Math.max(64 * 1024 * 1024, Number(cfg.self_rss_limit_bytes || DEFAULTS.selfRssLimitBytes) || DEFAULTS.selfRssLimitBytes),
    killAllowlist,
    killGate,
  };
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!n || n < 1) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function acquireLock(lockFile, staleMs) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const payload = { pid: process.pid, at: nowIso() };
  try {
    fs.writeFileSync(lockFile, JSON.stringify(payload) + '\n', { flag: 'wx' });
    return { acquired: true, staleRemoved: false };
  } catch (e) {
    if (!e || e.code !== 'EEXIST') throw e;
  }
  const existing = readJson(lockFile) || {};
  const ageMs = Date.now() - (Date.parse(existing.at || '') || 0);
  if (ageMs > staleMs || !pidAlive(existing.pid)) {
    try { fs.unlinkSync(lockFile); } catch (_) {}
    fs.writeFileSync(lockFile, JSON.stringify(payload) + '\n', { flag: 'wx' });
    return { acquired: true, staleRemoved: true, previous: existing };
  }
  return { acquired: false, existing, ageMs };
}

function releaseLock(lockFile) {
  const existing = readJson(lockFile) || {};
  if (Number(existing.pid) === process.pid) {
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

async function withSampleLock(lockFile, staleMs, fn) {
  const lock = acquireLock(lockFile, staleMs);
  if (!lock.acquired) return { locked: true, lock };
  try {
    const result = await fn(lock);
    return { locked: false, lock, result };
  } finally {
    releaseLock(lockFile);
  }
}

function classifyPressure(memory, config) {
  const usedRatio = Number(memory.usedRatio || 0);
  const swapRatio = Number(memory.swap && memory.swap.usedRatio || 0);
  const critical = usedRatio >= config.criticalUsedRatio;
  const high = critical || usedRatio >= config.highUsedRatio || swapRatio >= config.swapHighRatio;
  return {
    level: critical ? 'critical' : (high ? 'high' : 'ok'),
    high,
    critical,
    usedRatio,
    swapUsedRatio: swapRatio,
    highUsedRatio: config.highUsedRatio,
    criticalUsedRatio: config.criticalUsedRatio,
    swapHighRatio: config.swapHighRatio,
  };
}

function collectConsoleProtectedPids(artifactsRoot = ARTIFACTS_ROOT) {
  const out = new Set();
  const add = value => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 1) out.add(n);
  };
  const queueRoot = path.join(artifactsRoot, 'queues');
  try {
    for (const agent of fs.readdirSync(queueRoot)) {
      if (!/^[\p{L}\p{N}_-]+$/u.test(agent)) continue;
      const worker = readJson(path.join(queueRoot, agent, '.worker.pid'));
      add(worker && worker.pid);
      const runningDir = path.join(queueRoot, agent, 'running');
      let entries = [];
      try { entries = fs.readdirSync(runningDir).filter(name => name.endsWith('.json')).slice(0, 200); } catch (_) {}
      for (const name of entries) {
        const record = readJson(path.join(runningDir, name));
        add(record && record.ownerPid);
        add(record && record.enginePid);
        add(record && record.lease_owner_pid);
      }
    }
  } catch (_) {}
  const slotRoot = path.join(artifactsRoot, 'engine-slots');
  try {
    for (const name of fs.readdirSync(slotRoot).filter(s => s.endsWith('.json')).slice(0, 200)) {
      const slot = readJson(path.join(slotRoot, name));
      add(slot && slot.ownerPid);
      add(slot && slot.enginePid);
    }
  } catch (_) {}
  return [...out].sort((a, b) => a - b);
}

function protectionEvidence(processes, frontmost, self, extraProtectedPids = []) {
  const protectedNames = new Set(BASE_PROTECTED_NAMES);
  if (frontmost && frontmost.name) protectedNames.add(frontmost.name);
  const protectedPids = new Set([self.pid, self.ppid].filter(Boolean).map(Number));
  for (const pid of extraProtectedPids || []) {
    const n = Number(pid);
    if (Number.isFinite(n) && n > 1) protectedPids.add(n);
  }
  for (const proc of processes || []) {
    if (proc.pid === self.pid || proc.pid === self.ppid) protectedPids.add(proc.pid);
  }
  return {
    mode: 'reverse-allowlist',
    defaultKillPolicy: 'deny',
    baselineProtectedNames: [...BASE_PROTECTED_NAMES],
    frontmostApp: frontmost && frontmost.name || null,
    frontmostDetectionOk: !!(frontmost && frontmost.ok),
    protectedNames: [...protectedNames].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    protectedPids: [...protectedPids].sort((a, b) => a - b),
    consoleProtectedPids: [...(extraProtectedPids || [])].map(Number).filter(n => Number.isFinite(n) && n > 1).sort((a, b) => a - b),
  };
}

function analyzeProcesses(processes, config, protection) {
  const allow = new Set(config.killAllowlist);
  const protectedNames = new Set(protection.protectedNames || []);
  const protectedPids = new Set(protection.protectedPids || []);
  const sorted = [...(processes || [])].sort((a, b) => b.rssBytes - a.rssBytes);
  const topConsumers = sorted.slice(0, config.topProcessLimit).map(proc => {
    const reasons = [];
    if (protectedPids.has(proc.pid)) reasons.push('protected-pid');
    if (protectedNames.has(proc.commandName)) reasons.push('protected-name');
    if (!allow.has(proc.commandName)) reasons.push('not-in-explicit-kill-allowlist');
    if (proc.rssBytes < config.minCandidateRssBytes) reasons.push('below-candidate-rss-floor');
    const candidate = reasons.length === 0;
    return {
      pid: proc.pid,
      ppid: proc.ppid,
      commandName: proc.commandName,
      rssBytes: proc.rssBytes,
      candidate,
      reasons: candidate ? ['allowlisted-and-not-protected'] : reasons,
    };
  });
  return {
    allowlist: [...allow].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    topConsumers,
    candidates: topConsumers.filter(p => p.candidate),
  };
}

function manualActions(memory, pressure) {
  if (!pressure.high) return [];
  return [{
    type: 'manual-cache-release',
    command: 'sudo purge',
    requiresSudo: true,
    autoExecuted: false,
    reason: 'macOS purge requires owner confirmation; RAM watchdog only lists this action',
    reclaimableBytesEstimate: memory.reclaimableBytes,
    evidence: {
      inactiveBytes: memory.inactiveBytes,
      purgeableBytes: memory.purgeableBytes,
      speculativeBytes: memory.speculativeBytes,
    },
  }];
}

function updateState(state, pressure, config) {
  const previous = state && typeof state === 'object' ? state : {};
  const consecutiveHighCount = pressure.high ? Number(previous.consecutiveHighCount || 0) + 1 : 0;
  return Object.assign({}, previous, {
    lastSampleAt: nowIso(),
    lastLevel: pressure.level,
    lastUsedRatio: pressure.usedRatio,
    consecutiveHighCount,
    consecutiveLimit: config.consecutiveLimit,
  });
}

function makeTrendRecord(result) {
  return {
    ts: result.at,
    usedBytes: result.memory.usedBytes,
    totalBytes: result.memory.totalBytes,
    availableBytes: result.memory.availableBytes,
    reclaimableBytes: result.memory.reclaimableBytes,
    usedRatio: result.memory.usedRatio,
    swapUsedBytes: result.memory.swap && result.memory.swap.usedBytes || 0,
    swapTotalBytes: result.memory.swap && result.memory.swap.totalBytes || 0,
    level: result.pressure.level,
    consecutiveHighCount: result.pressure.consecutiveHighCount,
    selfRssBytes: result.self.rssBytes,
  };
}

function emitEvent(type, data, opts = {}) {
  try {
    const eventlog = opts.eventlog || new EventLog(opts.eventsFile || EVENTS_FILE);
    eventlog.emit(type, data || {});
  } catch (_) {}
}

async function collectSnapshot(opts, config) {
  const platform = opts.platform || process.platform;
  const self = processSelfSnapshot(opts);
  if (platform !== 'darwin') {
    return {
      supported: false,
      platform,
      self,
      error: 'ram-watchdog supports Darwin/macOS only',
    };
  }
  const memory = opts.collectMemory ? await opts.collectMemory() : collectMemoryStatsDarwin();
  const processResult = opts.collectProcesses ? await opts.collectProcesses() : collectProcessesDarwin();
  const frontmost = opts.frontmostApp ? await opts.frontmostApp() : frontmostAppDarwin();
  return {
    supported: true,
    platform,
    self,
    memory,
    processesOk: processResult.ok !== false,
    processError: processResult.error || null,
    processes: processResult.processes || [],
    frontmost,
    config,
  };
}

async function runOnce(opts = {}) {
  const rawConfig = opts.config || loadConfig(opts.configFile || DEFAULT_CONFIG_FILE);
  const config = normalizeConfig(rawConfig, opts);
  const lockFile = opts.lockFile || LOCK_FILE;
  const lockRun = await withSampleLock(lockFile, config.lockStaleMs, async lock => {
    const snapshot = await collectSnapshot(opts, config);
    if (!snapshot.supported) {
      const unsupported = {
        ok: false,
        supportedPlatform: false,
        at: nowIso(),
        platform: snapshot.platform,
        error: snapshot.error,
        self: Object.assign({}, snapshot.self, {
          rssLimitBytes: config.selfRssLimitBytes,
          overRssLimit: snapshot.self.rssBytes > config.selfRssLimitBytes,
        }),
        samplingMutex: { acquired: true, lockFile, staleRemoved: !!lock.staleRemoved },
      };
      writeJsonAtomic(opts.statusFile || STATUS_FILE, unsupported);
      return unsupported;
    }

    const pressureBase = classifyPressure(snapshot.memory, config);
    const state = updateState(readJson(opts.stateFile || STATE_FILE) || {}, pressureBase, config);
    const pressure = Object.assign({}, pressureBase, {
      consecutiveHighCount: state.consecutiveHighCount,
      consecutiveLimit: config.consecutiveLimit,
      alarm: pressureBase.critical || state.consecutiveHighCount >= config.consecutiveLimit,
    });
    const self = Object.assign({}, snapshot.self, {
      rssLimitBytes: config.selfRssLimitBytes,
      overRssLimit: snapshot.self.rssBytes > config.selfRssLimitBytes,
    });
    const extraProtectedPids = opts.consoleProtectedPids || collectConsoleProtectedPids(opts.artifactsRoot || ARTIFACTS_ROOT);
    const protection = protectionEvidence(snapshot.processes, snapshot.frontmost, self, extraProtectedPids);
    const processPlan = analyzeProcesses(snapshot.processes, config, protection);
    const manual = manualActions(snapshot.memory, pressure);
    const result = {
      ok: true,
      supportedPlatform: true,
      at: nowIso(),
      platform: snapshot.platform,
      config: {
        sampleIntervalMs: config.intervalMs,
        highUsedRatio: config.highUsedRatio,
        criticalUsedRatio: config.criticalUsedRatio,
        consecutiveLimit: config.consecutiveLimit,
        trendRetentionLines: config.trendRetentionLines,
        actionRetentionLines: config.actionRetentionLines,
      },
      self,
      samplingMutex: { acquired: true, lockFile, staleRemoved: !!lock.staleRemoved },
      memory: snapshot.memory,
      pressure,
      trend: {
        file: opts.trendFile || TREND_FILE,
        retentionLines: config.trendRetentionLines,
      },
      protection,
      killPlan: {
        mode: 'reverse-allowlist',
        dryRun: !config.killGate.liveKillAllowed,
        liveKillAllowed: config.killGate.liveKillAllowed,
        gate: config.killGate,
        allowlist: processPlan.allowlist,
        candidates: processPlan.candidates,
        topConsumers: processPlan.topConsumers,
        note: 'Default is deny. A process is only a candidate when explicitly allowlisted and not protected.',
      },
      cleanupPlan: {
        automaticActions: ['sample', 'trend-record', 'status-write', 'jsonl-rotation'],
        manualActions: manual,
        sudoActionsListedOnly: true,
        beforeAfterObservation: {
          beforeMemory: {
            usedBytes: snapshot.memory.usedBytes,
            availableBytes: snapshot.memory.availableBytes,
            reclaimableBytes: snapshot.memory.reclaimableBytes,
          },
          afterMemory: {
            usedBytes: snapshot.memory.usedBytes,
            availableBytes: snapshot.memory.availableBytes,
            reclaimableBytes: snapshot.memory.reclaimableBytes,
          },
          reason: 'No privileged purge or process kill was executed in the default RAM watchdog pass.',
        },
      },
      warnings: [],
    };
    if (self.overRssLimit) result.warnings.push({ type: 'watchdog-self-rss-over-limit', rssBytes: self.rssBytes, limitBytes: self.rssLimitBytes });
    if (manual.length) result.warnings.push({ type: 'manual-sudo-action-listed', command: 'sudo purge' });
    writeJsonAtomic(opts.stateFile || STATE_FILE, state);
    appendJsonl(opts.trendFile || TREND_FILE, makeTrendRecord(result));
    appendJsonl(opts.actionsFile || ACTIONS_FILE, {
      ts: result.at,
      level: pressure.level,
      alarm: pressure.alarm,
      manualActions: manual.map(a => ({ type: a.type, command: a.command, reclaimableBytesEstimate: a.reclaimableBytesEstimate })),
      killCandidates: result.killPlan.candidates.length,
      selfOverRssLimit: self.overRssLimit,
    });
    const trendRotation = rotateJsonl(opts.trendFile || TREND_FILE, config.trendRetentionLines);
    const actionRotation = rotateJsonl(opts.actionsFile || ACTIONS_FILE, config.actionRetentionLines);
    result.trend.rotation = trendRotation;
    result.actionLog = {
      file: opts.actionsFile || ACTIONS_FILE,
      retentionLines: config.actionRetentionLines,
      rotation: actionRotation,
    };
    writeJsonAtomic(opts.statusFile || STATUS_FILE, result);
    emitEvent('maintenance.ram_watchdog.checked', {
      level: pressure.level,
      usedRatio: pressure.usedRatio,
      consecutiveHighCount: pressure.consecutiveHighCount,
      alarm: pressure.alarm,
      reclaimableBytes: snapshot.memory.reclaimableBytes,
      manualActions: manual.length,
      killCandidates: result.killPlan.candidates.length,
      selfRssBytes: self.rssBytes,
      selfOverRssLimit: self.overRssLimit,
    }, opts);
    return result;
  });
  if (lockRun.locked) {
    const skipped = {
      ok: false,
      skipped: true,
      reason: 'sample-lock-held',
      at: nowIso(),
      samplingMutex: {
        acquired: false,
        lockFile,
        existing: lockRun.lock.existing || null,
        ageMs: lockRun.lock.ageMs || null,
      },
    };
    writeJsonAtomic(opts.statusFile || STATUS_FILE, skipped);
    return skipped;
  }
  return lockRun.result;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const value = (name, fallback = null) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  return {
    json: args.has('--json'),
    daemon: args.has('--daemon'),
    executeKill: args.has('--execute-kill'),
    noExitOnSelfLimit: args.has('--no-exit-on-self-limit'),
    configFile: value('--config', DEFAULT_CONFIG_FILE),
    intervalMs: Math.max(30 * 1000, Number(value('--interval-ms', intEnv('RAM_WATCHDOG_INTERVAL_MS', DEFAULTS.intervalMs, 30 * 1000))) || DEFAULTS.intervalMs),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let running = false;
  const once = async () => {
    if (running) return null;
    running = true;
    try {
      const result = await runOnce(args);
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else if (result.supportedPlatform === false) process.stdout.write(`unsupported: ${result.error}\n`);
      else if (result.skipped) process.stdout.write(`skipped: ${result.reason}\n`);
      else process.stdout.write(`${result.pressure.level}: used=${(result.pressure.usedRatio * 100).toFixed(1)}%, highCount=${result.pressure.consecutiveHighCount}, manualActions=${result.cleanupPlan.manualActions.length}\n`);
      if (args.daemon && result.self && result.self.overRssLimit && !args.noExitOnSelfLimit) {
        process.stderr.write(`ram-watchdog self RSS over limit; exiting for launchd restart\n`);
        process.exit(75);
      }
      return result;
    } finally {
      running = false;
    }
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
  BASE_PROTECTED_NAMES,
  DEFAULTS,
  KILL_CONFIRM_TOKEN,
  acquireLock,
  analyzeProcesses,
  classifyPressure,
  collectConsoleProtectedPids,
  normalizeConfig,
  parseArgs,
  parseMemoryPressure,
  parsePs,
  parseSwapUsage,
  parseVmStat,
  protectionEvidence,
  rotateJsonl,
  runOnce,
};
