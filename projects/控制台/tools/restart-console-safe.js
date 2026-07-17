#!/usr/bin/env node
'use strict';

// Fixed, no-argument launchd restart helper. It never accepts a command,
// service label, path or signal from HTTP and never escalates to a force-kill.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LABEL = 'com.yutu6.console';
const UID = process.getuid ? process.getuid() : 501;
const TARGET = `gui/${UID}/${LABEL}`;
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const LOG_DIR = path.join(ARTIFACTS_ROOT, 'console-restart');
const LOG_FILE = path.join(LOG_DIR, 'safe-restart.log');
const RESTART_BARRIER_FILE = path.join(LOG_DIR, '.restart-request.lock');
const STOP_TIMEOUT_MS = 20000;

function log(message) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, { mode: 0o600 });
}

function fixedCommand(file, args, timeout = 5000) {
  return spawnSync(file, args, { encoding: 'utf8', timeout, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
}

function servicePid() {
  const result = fixedCommand('/bin/launchctl', ['print', TARGET]);
  if (result.status !== 0) return 0;
  const match = String(result.stdout || '').match(/\bpid = (\d+)/);
  return match ? Number(match[1]) : 0;
}

function pidAlive(pid) {
  if (!Number(pid)) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (_) { return false; }
}

function pidIsQueueWorker(pid) {
  const result = fixedCommand('/bin/ps', ['-p', String(pid), '-o', 'command='], 1500);
  return result.status === 0 && /(?:^|\/)ceo-worker\.js(?:\s|$)/.test(String(result.stdout || ''));
}

function workerPidFiles() {
  const queues = path.join(ARTIFACTS_ROOT, 'queues');
  let agents = [];
  try { agents = fs.readdirSync(queues); } catch (_) { return []; }
  return agents.map(agent => path.join(queues, agent, '.worker.pid')).filter(file => fs.existsSync(file));
}

function runningQueueFiles() {
  const queues = path.join(ARTIFACTS_ROOT, 'queues');
  let agents = [];
  try { agents = fs.readdirSync(queues); } catch (_) { return []; }
  const running = [];
  for (const agent of agents) {
    const dir = path.join(queues, agent, 'running');
    let files = [];
    try { files = fs.readdirSync(dir).filter(file => file.endsWith('.json')); } catch (_) {}
    for (const file of files) running.push(path.join(dir, file));
  }
  return running;
}

function assertNoRunningTasks(stage) {
  const running = runningQueueFiles();
  if (!running.length) return;
  const error = new Error(`canonical running tasks detected ${stage} (${running.length}); restart aborted`);
  error.code = 'CONSOLE_RESTART_RUNNING';
  error.runningCount = running.length;
  throw error;
}

function readWorkerPid(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    try { return Number(JSON.parse(raw).pid) || 0; }
    catch (_) { return Number(String(raw).replace(/\D+/g, '')) || 0; }
  } catch (_) { return 0; }
}

async function waitUntil(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return !!check();
}

async function stopIdleWorkers() {
  const workers = workerPidFiles().map(file => ({ file, pid: readWorkerPid(file) })).filter(item => item.pid && pidAlive(item.pid) && pidIsQueueWorker(item.pid));
  for (const worker of workers) {
    log(`sending SIGTERM to idle queue worker pid=${worker.pid}`);
    try { process.kill(worker.pid, 'SIGTERM'); } catch (_) {}
  }
  const stopped = await waitUntil(() => workers.every(worker => !pidAlive(worker.pid)), STOP_TIMEOUT_MS);
  if (!stopped) throw new Error('queue worker did not exit after SIGTERM; restart aborted without force-kill');
  for (const worker of workers) try { fs.unlinkSync(worker.file); } catch (_) {}
}

async function stopIdleWorkersWithRunningGuards(stopFn = stopIdleWorkers) {
  // The HTTP endpoint creates a restart barrier before starting this helper,
  // but the helper remains the final authority: a worker may have claimed a
  // task just before observing that barrier. Re-scan on both sides of the
  // graceful worker stop so a newly-created running file fails closed.
  assertNoRunningTasks('before stopping idle workers');
  await stopFn();
  assertNoRunningTasks('after stopping idle workers');
}

async function main() {
  if (process.argv.length !== 2) {
    process.stderr.write('restart-console-safe accepts no arguments\n');
    process.exitCode = 64;
    return;
  }
  try {
    await new Promise(resolve => setTimeout(resolve, 900));
    log(`fixed restart requested target=${TARGET}`);
    await stopIdleWorkersWithRunningGuards();
    const oldPid = servicePid();
    if (oldPid) {
      // Keep this check immediately adjacent to the irreversible launchd
      // signal. It closes the window between worker shutdown and server TERM.
      assertNoRunningTasks('before launchd TERM');
      const stop = fixedCommand('/bin/launchctl', ['kill', 'TERM', TARGET]);
      if (stop.status !== 0) throw new Error('launchctl TERM failed');
      log(`sent launchd SIGTERM to console pid=${oldPid}`);
      const exited = await waitUntil(() => !pidAlive(oldPid), STOP_TIMEOUT_MS);
      if (!exited) throw new Error('console did not exit after SIGTERM; restart aborted without force-kill');
    }
    let newPid = servicePid();
    if (!newPid || newPid === oldPid) {
      const start = fixedCommand('/bin/launchctl', ['kickstart', TARGET]);
      if (start.status !== 0) throw new Error('launchctl kickstart failed');
      const started = await waitUntil(() => {
        newPid = servicePid();
        return !!newPid && newPid !== oldPid && pidAlive(newPid);
      }, STOP_TIMEOUT_MS);
      if (!started) throw new Error('console did not start before timeout');
    }
    log(`console restarted pid=${newPid}`);
  } finally {
    try { fs.unlinkSync(RESTART_BARRIER_FILE); } catch (_) {}
  }
}

if (require.main === module) {
  main().catch(error => {
    log(`restart failed: ${String(error && error.message || error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LABEL,
  TARGET,
  servicePid,
  pidIsQueueWorker,
  workerPidFiles,
  runningQueueFiles,
  assertNoRunningTasks,
  stopIdleWorkers,
  stopIdleWorkersWithRunningGuards,
};
