#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const FrontendRoute = require('../frontend-route');

const CONTROL_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(CONTROL_ROOT, 'artifacts');
const OUTPUT_DIR = path.join(ARTIFACTS_ROOT, 'ai-fe-upgrade', 'canary');
const DEFAULT_DURATION_HOURS = 8;
const DEFAULT_INTERVAL_SECONDS = 60;
const HARD_FAILURE_LIMIT = 3;

function numberOption(name, fallback) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function fetchJson(base, pathname, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${pathname}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(`${pathname} HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function probe(base) {
  const [health, snapshot, workspace] = await Promise.all([
    fetchJson(base, '/api/health'),
    fetchJson(base, '/api/workspace/snapshot'),
    fetch(`${base}/workspace`, { cache: 'no-store' }).then(async response => ({
      status: response.status,
      html: await response.text(),
    })),
  ]);
  if (workspace.status !== 200 || !/\/app\/assets\//.test(workspace.html)) {
    throw new Error(`workspace is not serving the React build (HTTP ${workspace.status})`);
  }
  return {
    ok: true,
    ts: new Date().toISOString(),
    pid: Number(health.pid) || null,
    uptimeSec: Number(health.uptimeSec) || 0,
    rssBytes: Number(health.memory && health.memory.rssBytes) || 0,
    heapUsedBytes: Number(health.memory && health.memory.heapUsedBytes) || 0,
    revision: String(snapshot.revision || ''),
    lastSeq: Number(snapshot.lastSeq) || 0,
  };
}

function evaluateTransition(previous, current) {
  if (!current || current.ok !== true) return { ok: false, hardFailure: true, reason: 'probe-failed' };
  if (previous && Number(current.lastSeq) < Number(previous.lastSeq)) {
    return { ok: false, hardFailure: true, reason: 'event-sequence-regressed' };
  }
  return { ok: true, hardFailure: false, reason: '' };
}

function shouldRollback(consecutiveHardFailures) {
  return Number(consecutiveHardFailures) >= HARD_FAILURE_LIMIT;
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

async function run(opts = {}) {
  const base = opts.base || `http://127.0.0.1:${opts.port || 8799}`;
  const durationMs = opts.durationMs == null ? DEFAULT_DURATION_HOURS * 60 * 60 * 1000 : opts.durationMs;
  const intervalMs = opts.intervalMs == null ? DEFAULT_INTERVAL_SECONDS * 1000 : opts.intervalMs;
  const probeFn = opts.probeFn || probe;
  const sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const started = Date.now();
  const id = new Date(started).toISOString().replace(/[:.]/g, '-');
  const ledger = path.join(OUTPUT_DIR, `${id}.jsonl`);
  let previous = null;
  let consecutiveHardFailures = 0;
  let samples = 0;
  let failures = 0;
  let rollback = null;
  let initialRssBytes = null;
  let maxRssBytes = 0;

  do {
    let current;
    try {
      current = await probeFn(base);
    } catch (error) {
      current = {
        ok: false,
        ts: new Date().toISOString(),
        reason: String(error && error.message || error).slice(0, 300),
      };
    }
    const verdict = evaluateTransition(previous, current);
    samples += 1;
    if (current.ok) {
      if (initialRssBytes == null) initialRssBytes = current.rssBytes;
      maxRssBytes = Math.max(maxRssBytes, current.rssBytes || 0);
    }
    if (verdict.hardFailure) {
      failures += 1;
      consecutiveHardFailures += 1;
    } else {
      consecutiveHardFailures = 0;
      previous = current;
    }
    appendJsonLine(ledger, { sample: samples, ...current, verdict, consecutiveHardFailures });
    if (shouldRollback(consecutiveHardFailures)) {
      rollback = FrontendRoute.writeTarget(ARTIFACTS_ROOT, 'legacy', {
        reason: `frontend canary: ${verdict.reason}`,
      });
      appendJsonLine(ledger, { type: 'automatic-rollback', ts: new Date().toISOString(), reason: verdict.reason });
      break;
    }
    if (durationMs <= 0 || Date.now() - started >= durationMs) break;
    await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - started))));
  } while (Date.now() - started <= durationMs);

  const summary = {
    schema: 'yutu6-frontend-canary@1',
    ok: !rollback && failures === 0,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    samples,
    failures,
    initialRssBytes,
    maxRssBytes,
    rssGrowthBytes: initialRssBytes == null ? null : maxRssBytes - initialRssBytes,
    rollback: rollback ? { target: rollback.target, reason: rollback.reason } : null,
    ledger,
  };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  const once = process.argv.includes('--once');
  const durationHours = numberOption('--duration-hours', DEFAULT_DURATION_HOURS);
  const intervalSeconds = numberOption('--interval-seconds', DEFAULT_INTERVAL_SECONDS);
  const port = numberOption('--port', 8799);
  const summary = await run({
    port,
    durationMs: once ? 0 : durationHours * 60 * 60 * 1000,
    intervalMs: intervalSeconds * 1000,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_DURATION_HOURS,
  DEFAULT_INTERVAL_SECONDS,
  HARD_FAILURE_LIMIT,
  probe,
  evaluateTransition,
  shouldRollback,
  run,
};
