#!/usr/bin/env node
'use strict';

/*
 * Schedule a console restart outside the console/queue process tree.
 *
 * This intentionally does not call launchctl kickstart directly from a queue
 * worker. It launches a detached one-shot shell through launchctl asuser; do
 * not use `launchctl submit` here because submitted jobs are kept alive on this
 * machine and will repeatedly SIGTERM the console service.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const RuntimePaths = require('../runtime-paths');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');

function argValue(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? String(process.argv[idx + 1] || '') : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function safeLabel(value, fallback) {
  const s = String(value || fallback || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

function jsonOut(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function parentPid(pid) {
  const n = Number(pid) || 0;
  if (!n) return 0;
  try {
    const out = spawnSync('ps', ['-p', String(n), '-o', 'ppid='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    return parseInt(String(out.stdout || '').trim(), 10) || 0;
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

function main() {
  const service = safeLabel(argValue('--service', process.env.CONSOLE_LAUNCHD_LABEL || 'com.yutu6.console'), 'com.yutu6.console');
  const uid = Number(argValue('--uid', process.getuid ? process.getuid() : process.env.UID)) || 501;
  const delayMs = Math.max(1000, Number(argValue('--delay-ms', '5000')) || 5000);
  const stopTimeoutMs = Math.max(5000, Number(argValue('--stop-timeout-ms', '20000')) || 20000);
  const cleanupTimeoutMs = Math.max(5000, Number(argValue('--cleanup-timeout-ms', '30000')) || 30000);
  const startTimeoutMs = Math.max(5000, Number(argValue('--start-timeout-ms', '30000')) || 30000);
  const reason = argValue('--reason', 'manual detached console restart');
  const stopWorkers = !hasArg('--skip-workers');
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const dir = path.join(ARTIFACTS_ROOT, 'console-restart');
  const jobLabel = safeLabel(`com.yutu6.console.restart.${stamp}.${process.pid}`, `com.yutu6.console.restart.${stamp}`);
  const scriptPath = path.join(dir, `${jobLabel}.sh`);
  const logPath = path.join(dir, `${jobLabel}.log`);
  const dryRun = hasArg('--dry-run');
  const serviceTarget = `gui/${uid}/${service}`;
  const nodeBin = RuntimePaths.nodeBin();
  const excludePids = [process.pid, ...ancestorPids(process.pid)].filter(Boolean);
  const cleanupJs = "require('./projects/控制台/server').selfCleanRuntimeArtifacts().then(()=>process.exit(0),e=>{console.error(e&&e.stack||e);process.exit(1);})";
  const safeReason = String(reason).replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');

  fs.mkdirSync(dir, { recursive: true });
  const script = [
    '#!/bin/zsh',
    'set -u',
    `LOG=${shellQuote(logPath)}`,
    `SERVICE_TARGET=${shellQuote(serviceTarget)}`,
    `WORKDIR=${shellQuote(WORKDIR)}`,
    `NODE_BIN=${shellQuote(nodeBin)}`,
    `STOP_TIMEOUT_SEC=${Math.ceil(stopTimeoutMs / 1000)}`,
    `CLEANUP_TIMEOUT_SEC=${Math.ceil(cleanupTimeoutMs / 1000)}`,
    `START_TIMEOUT_SEC=${Math.ceil(startTimeoutMs / 1000)}`,
    `STOP_WORKERS=${stopWorkers ? '1' : '0'}`,
    `EXCLUDE_PIDS=${shellQuote(excludePids.join(' '))}`,
    'log() { echo "[$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }',
    'service_pid() { /bin/launchctl print "$SERVICE_TARGET" 2>/dev/null | /usr/bin/awk -F" = " \'/pid =/{print $2; exit}\' | /usr/bin/tr -dc "0-9"; }',
    'pid_alive() { [ -n "${1:-}" ] && /bin/kill -0 "$1" >/dev/null 2>&1; }',
    'pid_command() { [ -n "${1:-}" ] && /bin/ps -p "$1" -o command= 2>/dev/null || true; }',
    'pid_excluded() { for p in ${(z)EXCLUDE_PIDS}; do [ "$p" = "${1:-}" ] && return 0; done; return 1; }',
    'sleep_one() { /bin/sleep 1; }',
    `sleep ${Math.ceil(delayMs / 1000)}`,
    `log "restart requested service=${service} reason=${safeReason}"`,
    'old_pid="$(service_pid)"',
    'if [ -n "$old_pid" ]; then',
    '  log "stopping old console pid=$old_pid"',
    '  /bin/launchctl kill TERM "$SERVICE_TARGET" >> "$LOG" 2>&1 || true',
    'fi',
    'deadline=$(( $(/bin/date +%s) + STOP_TIMEOUT_SEC ))',
    'while [ -n "$old_pid" ] && pid_alive "$old_pid"; do',
    '  if [ "$(/bin/date +%s)" -ge "$deadline" ]; then break; fi',
    '  sleep_one',
    'done',
    'if [ -n "$old_pid" ] && pid_alive "$old_pid"; then',
    '  log "old console pid=$old_pid did not exit before timeout, sending KILL"',
    '  /bin/kill -KILL "$old_pid" >> "$LOG" 2>&1 || true',
    '  sleep_one',
    'fi',
    'if [ -n "$old_pid" ] && pid_alive "$old_pid"; then',
    '  log "old console pid=$old_pid still alive after KILL; aborting"',
    '  exit 2',
    'fi',
    'if [ "$STOP_WORKERS" = "1" ]; then',
    '  log "stopping queue workers"',
    '  for pidfile in "$WORKDIR"/projects/控制台/artifacts/queues/*/.worker.pid; do',
    '    [ -f "$pidfile" ] || continue',
    '    worker_pid="$(/usr/bin/sed -n \'s/.*"pid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p\' "$pidfile" | /usr/bin/head -n 1)"',
    '    [ -n "$worker_pid" ] || worker_pid="$(/usr/bin/tr -dc "0-9" < "$pidfile")"',
    '    [ -n "$worker_pid" ] || { /bin/rm -f "$pidfile"; continue; }',
    '    if pid_excluded "$worker_pid"; then',
    '      log "skipping current task ancestor worker pid=$worker_pid pidfile=$pidfile"',
    '      continue',
    '    fi',
    '    worker_cmd="$(pid_command "$worker_pid")"',
    '    case "$worker_cmd" in',
    '      *ceo-worker.js*)',
    '        log "stopping queue worker pid=$worker_pid pidfile=$pidfile"',
    '        /bin/kill -TERM "$worker_pid" >> "$LOG" 2>&1 || true',
    '        worker_deadline=$(( $(/bin/date +%s) + STOP_TIMEOUT_SEC ))',
    '        while pid_alive "$worker_pid"; do',
    '          if [ "$(/bin/date +%s)" -ge "$worker_deadline" ]; then break; fi',
    '          sleep_one',
    '        done',
    '        if pid_alive "$worker_pid"; then',
    '          log "queue worker pid=$worker_pid did not exit before timeout, sending KILL"',
    '          /bin/kill -KILL "$worker_pid" >> "$LOG" 2>&1 || true',
    '          sleep_one',
    '        fi',
    '        if pid_alive "$worker_pid"; then',
    '          log "queue worker pid=$worker_pid still alive after KILL; aborting"',
    '          exit 5',
    '        fi',
    '        /bin/rm -f "$pidfile"',
    '        ;;',
    '      *)',
    '        log "removing stale/non-worker pidfile=$pidfile pid=$worker_pid"',
    '        /bin/rm -f "$pidfile"',
    '        ;;',
    '    esac',
    '  done',
    'fi',
    'log "old console stopped; cleaning runtime leftovers"',
    'cd "$WORKDIR" || exit 1',
    `"${nodeBin}" -e ${shellQuote(cleanupJs)} >> "$LOG" 2>&1 &`,
    'cleanup_pid=$!',
    'deadline=$(( $(/bin/date +%s) + CLEANUP_TIMEOUT_SEC ))',
    'while pid_alive "$cleanup_pid"; do',
    '  if [ "$(/bin/date +%s)" -ge "$deadline" ]; then',
    '    log "runtime cleanup timeout; killing cleanup pid=$cleanup_pid"',
    '    /bin/kill -KILL "$cleanup_pid" >> "$LOG" 2>&1 || true',
    '    wait "$cleanup_pid" >/dev/null 2>&1 || true',
    '    exit 3',
    '  fi',
    '  sleep_one',
    'done',
    'wait "$cleanup_pid"',
    'cleanup_code=$?',
    'if [ "$cleanup_code" -ne 0 ]; then',
    '  log "runtime cleanup failed exit=$cleanup_code"',
    '  exit "$cleanup_code"',
    'fi',
    'log "starting console service"',
    '/bin/launchctl kickstart -k "$SERVICE_TARGET" >> "$LOG" 2>&1',
    'code=$?',
    'if [ "$code" -ne 0 ]; then',
    '  log "kickstart failed exit=$code"',
    '  exit "$code"',
    'fi',
    'deadline=$(( $(/bin/date +%s) + START_TIMEOUT_SEC ))',
    'while true; do',
    '  new_pid="$(service_pid)"',
    '  if [ -n "$new_pid" ] && [ "$new_pid" != "${old_pid:-}" ] && pid_alive "$new_pid"; then',
    '    log "console restarted pid=$new_pid"',
    '    exit 0',
    '  fi',
    '  if [ "$(/bin/date +%s)" -ge "$deadline" ]; then break; fi',
    '  sleep_one',
    'done',
    'log "kickstart returned but service pid was not observed before timeout"',
    'exit 4',
    '',
  ].join('\n');
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  const launchCommand = [
    '/bin/launchctl',
    'asuser',
    String(uid),
    '/bin/zsh',
    '-lc',
    `/usr/bin/nohup /bin/zsh ${shellQuote(scriptPath)} >/dev/null 2>&1 &`,
  ];
  const result = {
    ok: true,
    dryRun,
    service,
    uid,
    delayMs,
    stopTimeoutMs,
    cleanupTimeoutMs,
    startTimeoutMs,
    stopWorkers,
    excludePids,
    jobLabel,
    scriptPath: path.relative(WORKDIR, scriptPath).split(path.sep).join('/'),
    logPath: path.relative(WORKDIR, logPath).split(path.sep).join('/'),
    launchCommand,
  };

  if (dryRun) {
    jsonOut(result);
    return;
  }

  const submitted = spawnSync(launchCommand[0], launchCommand.slice(1), {
    cwd: WORKDIR,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (submitted.error || submitted.status !== 0) {
    jsonOut(Object.assign({}, result, {
      ok: false,
      code: submitted.status,
      error: submitted.error && submitted.error.message || null,
      stderr: String(submitted.stderr || '').slice(0, 1000),
      stdout: String(submitted.stdout || '').slice(0, 1000),
    }));
    process.exit(1);
  }
  jsonOut(Object.assign({}, result, {
    code: submitted.status,
    stdout: String(submitted.stdout || '').slice(0, 1000),
  }));
}

if (require.main === module) main();
