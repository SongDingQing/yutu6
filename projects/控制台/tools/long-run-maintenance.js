#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const STATUS_DIR = path.join(ARTIFACTS_ROOT, 'long-run-maintenance');
const STATUS_FILE = path.join(STATUS_DIR, 'status.json');
const EVENTS_FILE = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');

const EventLog = require(path.join(WORKDIR, 'shared', 'engine', 'eventlog'));
const Watchdog = require('../watchdog-daemon');
const ResourceLocks = require('../resource-locks');
const MemoryMaintenance = require('./repair-memory-maintenance');

function nowIso() {
  return new Date().toISOString();
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

function dirStats(dir, opts = {}) {
  const maxFiles = Number(opts.maxFiles || 5000);
  let files = 0;
  let bytes = 0;
  const visit = current => {
    if (files > maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git'].includes(entry.name)) visit(file);
      } else {
        files++;
        try { bytes += fs.statSync(file).size; } catch (_) {}
      }
      if (files > maxFiles) return;
    }
  };
  visit(dir);
  return { files, bytes, truncated: files > maxFiles };
}

function artifactHealth(root = ARTIFACTS_ROOT, eventsFile = EVENTS_FILE) {
  const eventsBytes = fileSize(eventsFile);
  const queueStats = dirStats(path.join(root, 'queues'), { maxFiles: 10000 });
  const resourceStats = dirStats(path.join(root, 'resource-locks'), { maxFiles: 1000 });
  const warnings = [];
  if (eventsBytes > 100 * 1024 * 1024) warnings.push({ type: 'engine-events-large', bytes: eventsBytes });
  if (queueStats.files > 5000) warnings.push({ type: 'queue-files-large', files: queueStats.files, bytes: queueStats.bytes });
  if (resourceStats.files > 200) warnings.push({ type: 'resource-lock-files-large', files: resourceStats.files, bytes: resourceStats.bytes });
  return {
    eventsBytes,
    queueStats,
    resourceStats,
    warnings,
  };
}

async function runOnce(opts = {}) {
  const eventlog = opts.eventlog || new EventLog(opts.eventsFile || EVENTS_FILE);
  const watchdog = await Watchdog.collectHealth({
    artifactsRoot: opts.artifactsRoot || ARTIFACTS_ROOT,
    eventsFile: opts.eventsFile || EVENTS_FILE,
    checkConsole: opts.checkConsole !== false,
    checkHttp: opts.checkHttp !== false,
    persistentAgents: opts.persistentAgents || ['repair'],
  });
  const staleResourceLocks = await ResourceLocks.sweepStaleResourceLocks(
    path.join(opts.artifactsRoot || ARTIFACTS_ROOT, 'resource-locks'),
    { eventlog, leaseMs: Number(opts.resourceLeaseMs || 5 * 60 * 1000) },
  );
  const memory = await MemoryMaintenance.runOnce({
    artifactsRoot: opts.artifactsRoot || ARTIFACTS_ROOT,
    eventsFile: opts.eventsFile || EVENTS_FILE,
    apply: !!opts.applyMemory,
    cleanupTmp: opts.cleanupTmp !== false,
  });
  const artifacts = artifactHealth(opts.artifactsRoot || ARTIFACTS_ROOT, opts.eventsFile || EVENTS_FILE);
  const problems = []
    .concat(watchdog.problems || [])
    .concat(artifacts.warnings || []);
  const result = {
    ok: problems.filter(p => p.restart || p.type).length === 0 || !watchdog.restartRequired,
    at: nowIso(),
    mode: opts.applyMemory ? 'active-memory-gated' : 'observe-and-sweep-safe',
    watchdog,
    memory: {
      level: memory.memory.level,
      availableRatio: memory.memory.availableRatio,
      purge: memory.purge,
      activeCount: memory.activeCount,
      removedTmpFiles: memory.removedTmpFiles,
    },
    resources: {
      staleLocksSwept: staleResourceLocks,
    },
    artifacts,
    problems,
    nextActions: problems.length
      ? ['查看 status.json 中 problems; 涉及重启/授权/不可逆操作时交给主人确认']
      : [],
  };
  writeJsonAtomic(opts.statusFile || STATUS_FILE, result);
  eventlog.emit('maintenance.long_run.checked', {
    ok: result.ok,
    watchdogOk: watchdog.ok,
    restartRequired: watchdog.restartRequired,
    memoryLevel: result.memory.level,
    purgeAttempted: !!(result.memory.purge && result.memory.purge.attempted),
    staleResourceLocks: staleResourceLocks.length,
    warnings: artifacts.warnings.length,
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
    daemon: args.has('--daemon'),
    applyMemory: args.has('--apply-memory'),
    checkConsole: !args.has('--skip-console'),
    checkHttp: !args.has('--skip-http'),
    intervalMs: Math.max(60 * 1000, Number(value('--interval-ms', 15 * 60 * 1000)) || 15 * 60 * 1000),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const once = async () => {
    const result = await runOnce(args);
    if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(`${result.ok ? 'ok' : 'check'}: watchdog=${result.watchdog.ok}, memory=${result.memory.level}, warnings=${result.artifacts.warnings.length}\n`);
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
  artifactHealth,
  runOnce,
};
