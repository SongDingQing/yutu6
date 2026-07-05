'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function emit(eventlog, type, data) {
  try {
    if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data);
  } catch (_) {}
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!n || Number.isNaN(n)) return false;
  try { process.kill(n, 0); return true; }
  catch (_) { return false; }
}

function processCmd(pid) {
  if (!pidAlive(pid)) return '';
  try {
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    return (out.stdout || '').trim();
  } catch (_) {
    return '';
  }
}

function pidLooksLike(pid, marker) {
  const cmd = processCmd(pid);
  return !!cmd && (!marker || cmd.includes(marker));
}

function processGroupId(pid) {
  if (!pidAlive(pid)) return 0;
  try {
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'pgid='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    return parseInt((out.stdout || '').trim(), 10) || 0;
  } catch (_) {
    return 0;
  }
}

function parentPid(pid) {
  if (!pidAlive(pid)) return 0;
  try {
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    return parseInt((out.stdout || '').trim(), 10) || 0;
  } catch (_) {
    return 0;
  }
}

function ancestorPids(pid = process.pid) {
  const out = [];
  const seen = new Set();
  let cur = Number(pid) || 0;
  for (let i = 0; cur && i < 32; i++) {
    const ppid = parentPid(cur);
    if (!ppid || seen.has(ppid)) break;
    seen.add(ppid);
    out.push(ppid);
    cur = ppid;
  }
  return out;
}

function protectedPidReason(pid, opts = {}) {
  const n = Number(pid);
  if (!n) return 'invalid-pid';
  const excluded = new Set([process.pid, ...ancestorPids(process.pid)]);
  for (const p of opts.excludePids || []) {
    const x = Number(p);
    if (x) excluded.add(x);
  }
  if (excluded.has(n)) return n === process.pid ? 'current-process' : 'current-process-ancestor';
  const targetPgid = processGroupId(n);
  const currentPgid = processGroupId(process.pid);
  if (targetPgid && currentPgid && targetPgid === currentPgid && targetPgid === n) {
    return 'current-process-group';
  }
  return null;
}

function killProcessGroup(pid, signal, opts = {}) {
  const n = Number(pid);
  if (!n) return { sent: false, reason: 'invalid-pid' };
  const protectedReason = protectedPidReason(n, opts);
  if (protectedReason) return { sent: false, blocked: true, reason: protectedReason };
  const pgid = processGroupId(n);
  if (pgid && pgid === n) {
    try { process.kill(-n, signal); return { sent: true, group: true }; } catch (_) {}
  }
  try { process.kill(n, signal); return { sent: true, group: false }; } catch (_) {}
  return { sent: false, reason: 'signal-failed' };
}

function enginePidFromRecord(record) {
  if (!record) return 0;
  for (const key of ['enginePid', 'engine_pid']) {
    const n = Number(record[key]);
    if (n) return n;
  }
  const legacy = Number(record.pid);
  return legacy && pidLooksLike(legacy, 'engine-runner.js') ? legacy : 0;
}

function engineRecordMatchesCommand(record, cmd) {
  if (!cmd || !cmd.includes('engine-runner.js')) return false;
  const bindings = [
    record && record.engineSpecFile,
    record && record.specFile,
    record && record.taskId,
    record && record.task,
  ].filter(Boolean).map(String);
  if (!bindings.length) return true;
  return bindings.some(value => cmd.includes(value));
}

function engineAliveForRecord(record) {
  const pid = typeof record === 'number' ? Number(record) : enginePidFromRecord(record);
  if (!pid) return false;
  const cmd = processCmd(pid);
  if (typeof record === 'number') return !!cmd && cmd.includes('engine-runner.js');
  return engineRecordMatchesCommand(record || {}, cmd);
}

async function terminateEngine(recordOrPid, opts = {}) {
  const pid = typeof recordOrPid === 'number' ? Number(recordOrPid) : enginePidFromRecord(recordOrPid);
  const markerRecord = typeof recordOrPid === 'number' ? pid : (recordOrPid || {});
  if (!pid) return { attempted: false, pid, alive: false };

  const protectedReason = protectedPidReason(pid, opts);
  if (protectedReason) {
    const alive = pidAlive(pid);
    emit(opts.eventlog, 'queue.orphan_engine.kill_blocked', Object.assign({
      pid,
      reason: protectedReason,
    }, opts.meta || {}));
    return { attempted: false, pid, alive, blocked: true, reason: protectedReason };
  }

  if (!engineAliveForRecord(markerRecord)) return { attempted: false, pid, alive: false };

  const meta = Object.assign({ pid }, opts.meta || {});
  emit(opts.eventlog, 'queue.orphan_engine.kill', Object.assign({ signal: 'SIGTERM' }, meta));
  killProcessGroup(pid, 'SIGTERM', opts);
  await sleep(Math.max(0, Number(opts.termGraceMs || 0)));

  if (engineAliveForRecord(markerRecord)) {
    emit(opts.eventlog, 'queue.orphan_engine.kill', Object.assign({ signal: 'SIGKILL' }, meta));
    killProcessGroup(pid, 'SIGKILL', opts);
    await sleep(Math.max(50, Number(opts.killWaitMs || 200)));
  }

  return { attempted: true, pid, alive: engineAliveForRecord(markerRecord) };
}

function recordAgeMs(record) {
  const raw = record && (record.heartbeat_at || record.updated_at || record.ts || record.started_at);
  const t = raw ? Date.parse(raw) : 0;
  return t ? Date.now() - t : Infinity;
}

function recordStale(record, staleMs) {
  return recordAgeMs(record) > Number(staleMs || 0);
}

function queueRunningExists(queueRoot, agent, queueId) {
  if (!queueRoot || !agent || !queueId) return true;
  return fs.existsSync(path.join(queueRoot, 'queues', String(agent), 'running', `${queueId}.json`));
}

function queueRunningRecord(queueRoot, agent, queueId) {
  if (!queueRoot || !agent || !queueId) return null;
  return readJson(path.join(queueRoot, 'queues', String(agent), 'running', `${queueId}.json`));
}

function taskField(record, key) {
  if (!record) return null;
  if (record[key] != null) return record[key];
  const task = record.task && typeof record.task === 'object' ? record.task : null;
  return task && task[key] != null ? task[key] : null;
}

function isPrivilegedRuntimeRecord(record, running) {
  const agent = String(record && record.agent || running && running.target || '').toLowerCase();
  const role = String(taskField(record, 'role') || taskField(running, 'role') || '').toLowerCase();
  const runnerType = String(record && record.runnerType || taskField(running, 'runnerType') || '').toLowerCase();
  return agent === 'repair'
    || agent === 'cleanup'
    || role === 'repair'
    || role === 'cleanup'
    || runnerType === 'repair-bypass'
    || taskField(record, 'privileged') === true
    || taskField(running, 'privileged') === true
    || taskField(record, 'engineSlotBypass') === true
    || taskField(running, 'engineSlotBypass') === true
    || taskField(record, 'bypassEngineSlot') === true
    || taskField(running, 'bypassEngineSlot') === true;
}

function freshRunningTimestamp(record) {
  const fields = [
    record && record.engine_heartbeat_at,
    record && record.lease_heartbeat_at,
    record && record.heartbeat_at,
    record && record.progress_at,
    record && record.node_event_at,
    record && record.updated_at,
    record && record.started_at,
  ].filter(Boolean);
  let best = 0;
  for (const value of fields) {
    const t = Date.parse(value);
    if (t && t > best) best = t;
  }
  return best;
}

function runningRecordFresh(record, opts = {}) {
  const t = freshRunningTimestamp(record);
  if (!t) return false;
  const staleMs = Number(
    opts.runningStaleMs
    || opts.running_stale_ms
    || opts.engineHeartbeatStaleMs
    || opts.engine_heartbeat_stale_ms
    || opts.noProgressStaleMs
    || 0
  );
  if (!staleMs) return true;
  return Date.now() - t <= staleMs;
}

function protectedRunningTaskReason(record, opts = {}) {
  if (!record || !record.agent || !record.queueId) return null;
  const running = queueRunningRecord(opts.queueRoot, record.agent, record.queueId);
  if (!running) return null;
  if (isPrivilegedRuntimeRecord(record, running) && runningRecordFresh(running, opts)) {
    return 'privileged-running-task';
  }
  if (opts.protectFreshRunning === true && runningRecordFresh(running, opts)) {
    return 'fresh-running-task';
  }
  return null;
}

function lockOwnerAlive(record) {
  return pidLooksLike(record && record.ownerPid, 'ceo-worker.js')
    || pidLooksLike(record && record.pid, 'ceo-worker.js');
}

function lockValid(record, opts = {}) {
  if (!record) return false;
  if (engineAliveForRecord(record)) return true;
  const ownerAlive = lockOwnerAlive(record);
  const enginePid = enginePidFromRecord(record);
  if (!enginePid) return ownerAlive;
  return ownerAlive && !recordStale(record, opts.staleMs);
}

function lockSweepReason(record, opts = {}) {
  if (!record) return 'invalid';
  const engineAlive = engineAliveForRecord(record);
  const ownerAlive = lockOwnerAlive(record);
  if (record.agent && record.queueId && !queueRunningExists(opts.queueRoot, record.agent, record.queueId)) {
    return 'queue-running-missing';
  }
  if (engineAlive && ownerAlive) return null;
  if (engineAlive) {
    const protectedReason = protectedRunningTaskReason(record, opts);
    if (protectedReason) return null;
  }
  if (opts.startupKill && engineAlive) return 'startup-detached-engine';
  if (engineAlive && !ownerAlive) return 'orphan-engine-owner-dead';
  if (engineAlive) return null;
  if (ownerAlive) return null;
  return 'dead';
}

function removeFile(file) {
  try { fs.unlinkSync(file); return true; }
  catch (_) { return false; }
}

async function releaseLockFile(file, opts = {}) {
  const record = opts.record || readJson(file);
  const reason = opts.reason || lockSweepReason(record, opts);
  if (!reason && !opts.force) return { released: false, reason: null, record };

  if (record && opts.killEngine !== false) {
    await terminateEngine(record, {
      eventlog: opts.eventlog,
      termGraceMs: opts.termGraceMs,
      meta: Object.assign({
        kind: opts.kind || null,
        reason: reason || opts.reason || null,
        queueAgent: record.agent || null,
        queueId: record.queueId || null,
        runnerType: record.runnerType || null,
      }, opts.meta || {}),
      excludePids: opts.excludePids,
      killWaitMs: opts.killWaitMs,
    });
  }

  if (record && engineAliveForRecord(record)) {
    emit(opts.eventlog, 'engine.lock.release_blocked', {
      file: path.basename(file),
      kind: opts.kind || null,
      queueAgent: record.agent || null,
      queueId: record.queueId || null,
      runnerType: record.runnerType || null,
      reason: reason || opts.reason || null,
      enginePid: enginePidFromRecord(record) || null,
    });
    return { released: false, blocked: true, reason, record };
  }

  const removed = removeFile(file);
  return { released: removed, reason, record };
}

function listJsonFiles(dir, pattern) {
  try {
    return fs.readdirSync(dir)
      .filter(f => !pattern || pattern.test(f))
      .map(f => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

module.exports = {
  engineAliveForRecord,
  enginePidFromRecord,
  protectedPidReason,
  killProcessGroup,
  listJsonFiles,
  lockOwnerAlive,
  lockSweepReason,
  lockValid,
  pidAlive,
  pidLooksLike,
  processCmd,
  protectedRunningTaskReason,
  queueRunningRecord,
  queueRunningExists,
  readJson,
  runningRecordFresh,
  releaseLockFile,
  terminateEngine,
};
