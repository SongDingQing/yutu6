#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const RECEIPT_SCHEMA = 'runner-timeout-settlement@1';
const PROCESS_MARKER_ENV = 'YUTU6_TIMEOUT_FENCE_PROCESS_MARKER';

function nowIso() {
  return new Date().toISOString();
}

function numberEnv(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function atomicJson(file, value) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function psRows() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat='], {
    encoding: 'utf8',
    timeout: 2000,
  });
  if (result.error || result.status !== 0) return { available: false, rows: [] };
  const rows = String(result.stdout || '').split(/\r?\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/);
    return match ? {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      stat: match[4],
    } : null;
  }).filter(Boolean);
  return { available: true, rows };
}

function markerRows(marker) {
  if (!marker) return { available: true, rows: [] };
  const result = spawnSync('ps', ['eww', '-axo', 'pid=,ppid=,pgid=,stat=,command='], {
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return { available: false, rows: [] };
  const needle = `${PROCESS_MARKER_ENV}=${marker}`;
  const rows = String(result.stdout || '').split(/\r?\n/).filter(line => line.includes(needle)).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/);
    return match ? {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      stat: match[4],
    } : null;
  }).filter(Boolean);
  return { available: true, rows };
}

function live(row) {
  return !!(row && !/^Z/i.test(String(row.stat || '')));
}

function treeSnapshot(rootPid, known = [], marker = null) {
  const snapshot = psRows();
  const marked = markerRows(marker);
  const selected = new Set([
    Number(rootPid),
    ...known.map(Number).filter(Boolean),
    ...marked.rows.map(row => row.pid),
  ]);
  if (!snapshot.available || !marked.available) {
    return {
      available: false,
      marker_available: marked.available,
      marker_pids: marked.rows.map(row => row.pid),
      pids: Array.from(selected).filter(Boolean),
      pgids: Array.from(new Set(marked.rows.map(row => row.pgid).filter(id => id > 1))),
      rows: [],
    };
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of snapshot.rows) {
      if (selected.has(row.ppid) && !selected.has(row.pid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  const rows = snapshot.rows.filter(row => selected.has(row.pid) && live(row));
  return {
    available: true,
    marker_available: true,
    marker_pids: marked.rows.filter(live).map(row => row.pid),
    pids: rows.map(row => row.pid),
    pgids: Array.from(new Set(rows.map(row => row.pgid).filter(id => id > 1))),
    rows,
  };
}

function survivorsFor(pids, pgids, marker = null) {
  const snapshot = psRows();
  const marked = markerRows(marker);
  if (!snapshot.available || !marked.available) {
    return {
      available: false,
      marker_available: marked.available,
      marker_pids: marked.rows.map(row => row.pid),
      pids: Array.from(new Set(pids.concat(marked.rows.map(row => row.pid)))),
      pgids: Array.from(new Set(pgids.concat(marked.rows.map(row => row.pgid).filter(id => id > 1)))),
    };
  }
  const pidSet = new Set(pids.map(Number));
  const pgidSet = new Set(pgids.map(Number));
  const markerPidSet = new Set(marked.rows.filter(live).map(row => row.pid));
  const liveRows = snapshot.rows.filter(live);
  const survivors = liveRows.filter(row => pidSet.has(row.pid) || markerPidSet.has(row.pid));
  const survivorGroups = liveRows.filter(row => pgidSet.has(row.pgid) || markerPidSet.has(row.pid));
  return {
    available: true,
    marker_available: true,
    marker_pids: Array.from(markerPidSet),
    pids: Array.from(new Set(survivors.map(row => row.pid))),
    pgids: Array.from(new Set(survivorGroups.map(row => row.pgid))),
  };
}

function signalTargets(pids, pgids, signal) {
  const attempted = [];
  for (const pgid of Array.from(new Set(pgids)).filter(id => id > 1)) {
    try { process.kill(-pgid, signal); attempted.push({ target: 'pgid', id: pgid, signal, ok: true }); }
    catch (error) { attempted.push({ target: 'pgid', id: pgid, signal, ok: error && error.code === 'ESRCH' }); }
  }
  for (const pid of Array.from(new Set(pids)).filter(id => id > 1)) {
    try { process.kill(pid, signal); attempted.push({ target: 'pid', id: pid, signal, ok: true }); }
    catch (error) { attempted.push({ target: 'pid', id: pid, signal, ok: error && error.code === 'ESRCH' }); }
  }
  return attempted;
}

async function waitForExit(pids, pgids, timeoutMs, pollMs, marker = null) {
  const started = Date.now();
  let last = survivorsFor(pids, pgids, marker);
  while (Date.now() - started <= timeoutMs) {
    last = survivorsFor(pids, pgids, marker);
    if (last.available && last.pids.length === 0 && last.pgids.length === 0) {
      return { confirmed: true, waited_ms: Date.now() - started, survivors: last };
    }
    await sleep(pollMs);
  }
  return { confirmed: false, waited_ms: Date.now() - started, survivors: last };
}

function dirtyWorktreeFiles(workdir) {
  const files = new Set();
  for (const args of [
    ['diff', '--name-only', '-z', '--'],
    ['diff', '--cached', '--name-only', '-z', '--'],
    ['ls-files', '--others', '--exclude-standard', '-z', '--'],
  ]) {
    const result = spawnSync('git', args, { cwd: workdir, encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) continue;
    for (const item of String(result.stdout || '').split('\0').filter(Boolean)) files.add(item);
  }
  const all = Array.from(files);
  return { files: all.slice(0, 4096), truncated: all.length > 4096, total: all.length };
}

function dirtySnapshot(workdir, enabled) {
  if (!enabled) return { enabled: false, available: false, files: {} };
  const listed = dirtyWorktreeFiles(workdir);
  const files = listed.files;
  const values = {};
  for (const relative of files) {
    const absolute = path.resolve(workdir, relative);
    const boundary = path.relative(workdir, absolute);
    if (!boundary || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary)) continue;
    try {
      const stat = fs.statSync(absolute);
      values[relative.split(path.sep).join('/')] = { mtime_ms: stat.mtimeMs, size: stat.size };
    } catch (_) {
      values[relative.split(path.sep).join('/')] = null;
    }
  }
  return {
    enabled: true,
    available: true,
    files: values,
    dirty_count: listed.total,
    sampled_count: files.length,
    truncated: listed.truncated,
  };
}

function mtimeChanges(before, after) {
  if (!before || !after || !before.available || !after.available) return [];
  const keys = new Set([...Object.keys(before.files || {}), ...Object.keys(after.files || {})]);
  const changes = [];
  for (const key of keys) {
    const a = before.files[key];
    const b = after.files[key];
    if (a && b && a.mtime_ms === b.mtime_ms) continue;
    if (a == null && b == null) continue;
    changes.push({ path: key, before: a, after: b });
  }
  return changes;
}

async function main() {
  const executable = String(process.env.YUTU6_TIMEOUT_FENCE_ORIGINAL_EXECUTABLE || '');
  const receiptFile = String(process.env.YUTU6_TIMEOUT_FENCE_RECEIPT || '');
  const taskId = String(process.env.YUTU6_TIMEOUT_FENCE_TASK_ID || '');
  const nodeId = String(process.env.YUTU6_TIMEOUT_FENCE_NODE_ID || '');
  const runnerId = String(process.env.YUTU6_TIMEOUT_FENCE_RUNNER_ID || '');
  const workdir = path.resolve(process.env.YUTU6_TIMEOUT_FENCE_WORKDIR || process.cwd());
  const timeoutMs = numberEnv('YUTU6_TIMEOUT_FENCE_TIMEOUT_MS', 600000, 1, 24 * 60 * 60 * 1000);
  const leadMs = numberEnv('YUTU6_TIMEOUT_FENCE_INTERNAL_LEAD_MS', 100, 1, 1000);
  const terminationGraceMs = numberEnv('YUTU6_TIMEOUT_FENCE_TERM_GRACE_MS', 750, 50, 1500);
  const settleTimeoutMs = numberEnv('YUTU6_TIMEOUT_FENCE_SETTLE_TIMEOUT_MS', 1500, 100, 2500);
  const pollMs = numberEnv('YUTU6_TIMEOUT_FENCE_SETTLE_POLL_MS', 50, 10, 500);
  const postSettleMonitorMs = numberEnv('YUTU6_TIMEOUT_FENCE_POST_SETTLE_MONITOR_MS', 200, 0, 500);
  const uninterruptibleGraceMs = numberEnv('YUTU6_TIMEOUT_FENCE_UNINTERRUPTIBLE_GRACE_MS', 0, 0, 1000);
  const dirtyMonitor = process.env.YUTU6_TIMEOUT_FENCE_DIRTY_MONITOR === '1';
  if (!executable || !receiptFile || !taskId || !nodeId) {
    process.stderr.write('runner timeout fence shim missing required metadata\n');
    process.exit(127);
  }

  let child;
  let childClosed = null;
  let terminating = false;
  let normalReceiptWritten = false;
  const startedAt = nowIso();
  const processMarker = crypto.randomBytes(18).toString('hex');
  const childEnv = Object.assign({}, process.env);
  for (const name of Object.keys(childEnv)) {
    if (name.startsWith('YUTU6_TIMEOUT_FENCE_')) delete childEnv[name];
  }
  childEnv[PROCESS_MARKER_ENV] = processMarker;
  try {
    child = spawn(executable, process.argv.slice(2), {
      cwd: workdir,
      env: childEnv,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    atomicJson(receiptFile, {
      schema: RECEIPT_SCHEMA,
      task_id: taskId,
      node_id: nodeId,
      runner_id: runnerId,
      started_at: startedAt,
      timeout: { timed_out: false },
      settle: { tree_exited: true, survivors: [] },
      spawn_error: String(error && error.message || error).slice(0, 300),
    });
    process.exit(127);
  }
  process.stdin.pipe(child.stdin);
  child.stdin.on('error', () => {});
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  const terminate = async trigger => {
    if (terminating) return;
    terminating = true;
    const detectedAt = nowIso();
    const before = dirtySnapshot(workdir, dirtyMonitor);
    const initial = treeSnapshot(child.pid, [], processMarker);
    const knownPids = Array.from(new Set([child.pid, ...initial.pids]));
    const knownPgids = Array.from(new Set([child.pid, ...initial.pgids]));
    const attempts = [];
    let graceStartedAt = null;
    let graceEndedAt = null;
    if (uninterruptibleGraceMs > 0) {
      graceStartedAt = nowIso();
      await sleep(uninterruptibleGraceMs);
      graceEndedAt = nowIso();
    }
    const expanded = treeSnapshot(child.pid, knownPids, processMarker);
    for (const pid of expanded.pids) if (!knownPids.includes(pid)) knownPids.push(pid);
    for (const pgid of expanded.pgids) if (!knownPgids.includes(pgid)) knownPgids.push(pgid);
    attempts.push(...signalTargets(knownPids, knownPgids, 'SIGTERM'));
    let settled = await waitForExit(knownPids, knownPgids, terminationGraceMs, pollMs, processMarker);
    if (!settled.confirmed) {
      const latest = treeSnapshot(child.pid, knownPids, processMarker);
      for (const pid of latest.pids) if (!knownPids.includes(pid)) knownPids.push(pid);
      for (const pgid of latest.pgids) if (!knownPgids.includes(pgid)) knownPgids.push(pgid);
      attempts.push(...signalTargets(knownPids, knownPgids, 'SIGKILL'));
      settled = await waitForExit(knownPids, knownPgids, settleTimeoutMs, pollMs, processMarker);
    }
    if (settled.confirmed && postSettleMonitorMs > 0) {
      await sleep(postSettleMonitorMs);
      const post = survivorsFor(knownPids, knownPgids, processMarker);
      if (!post.available || post.pids.length || post.pgids.length) {
        settled = { confirmed: false, waited_ms: settled.waited_ms + postSettleMonitorMs, survivors: post };
      }
    }
    const after = dirtySnapshot(workdir, dirtyMonitor);
    const changes = mtimeChanges(before, after);
    atomicJson(receiptFile, {
      schema: RECEIPT_SCHEMA,
      task_id: taskId,
      node_id: nodeId,
      runner_id: runnerId,
      started_at: startedAt,
      timeout: {
        timed_out: trigger === 'node_timeout',
        trigger,
        detected_at: detectedAt,
        configured_timeout_ms: timeoutMs,
        uninterruptible_grace_ms: uninterruptibleGraceMs,
        grace_started_at: graceStartedAt,
        grace_ended_at: graceEndedAt,
      },
      termination: {
        root_pid: child.pid,
        initial_tree_pids: initial.pids,
        marker_tracking_required: true,
        marker_observation_available: initial.marker_available === true && expanded.marker_available === true,
        marker_observed_pids: Array.from(new Set([...(initial.marker_pids || []), ...(expanded.marker_pids || [])])),
        observed_tree_pids: knownPids,
        observed_process_groups: knownPgids,
        attempts,
      },
      settle: {
        tree_exited: settled.confirmed === true,
        confirmed_at: settled.confirmed ? nowIso() : null,
        waited_ms: settled.waited_ms,
        survivors: settled.survivors && settled.survivors.pids || knownPids,
        survivor_process_groups: settled.survivors && settled.survivors.pgids || knownPgids,
        process_observation_available: settled.survivors && settled.survivors.available === true,
      },
      dirty_worktree: {
        monitor_enabled: dirtyMonitor,
        timeout_snapshot_available: before.available,
        dirty_count: before.dirty_count || 0,
        sampled_count: before.sampled_count || 0,
        truncated: before.truncated === true,
        mtime_changes: changes,
      },
    });
    process.exit(trigger === 'node_timeout' ? 124 : 143);
  };

  const internalTimer = setTimeout(() => terminate('node_timeout'), Math.max(1, timeoutMs - leadMs));
  process.once('SIGTERM', () => terminate(Date.now() - Date.parse(startedAt) >= timeoutMs - leadMs * 2 ? 'node_timeout' : 'external_sigterm'));
  process.once('SIGINT', () => terminate('external_sigint'));
  child.once('error', error => {
    clearTimeout(internalTimer);
    if (terminating) return;
    atomicJson(receiptFile, {
      schema: RECEIPT_SCHEMA,
      task_id: taskId,
      node_id: nodeId,
      runner_id: runnerId,
      started_at: startedAt,
      timeout: { timed_out: false },
      settle: { tree_exited: true, survivors: [] },
      child_error: String(error && error.message || error).slice(0, 300),
    });
    process.exit(127);
  });
  child.once('close', (code, signal) => {
    childClosed = { code, signal };
    clearTimeout(internalTimer);
    if (terminating || normalReceiptWritten) return;
    normalReceiptWritten = true;
    const survivors = survivorsFor([child.pid], [child.pid], processMarker);
    atomicJson(receiptFile, {
      schema: RECEIPT_SCHEMA,
      task_id: taskId,
      node_id: nodeId,
      runner_id: runnerId,
      started_at: startedAt,
      timeout: { timed_out: false },
      termination: { root_pid: child.pid, attempts: [] },
      settle: {
        tree_exited: survivors.available && survivors.pids.length === 0 && survivors.pgids.length === 0,
        confirmed_at: nowIso(),
        survivors: survivors.pids,
        survivor_process_groups: survivors.pgids,
        process_observation_available: survivors.available,
      },
      exit: childClosed,
      dirty_worktree: { monitor_enabled: dirtyMonitor, mtime_changes: [] },
    });
    if (signal) process.exit(128);
    process.exit(code == null ? 1 : code);
  });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error && error.message || error).slice(0, 300)}\n`);
    process.exit(127);
  });
}

module.exports = {
  main,
  _test: { psRows, markerRows, treeSnapshot, survivorsFor, dirtySnapshot, mtimeChanges },
};
