#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ProtocolGate = require('../../../shared/engine/protocol-gate');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      out._.push(raw);
      continue;
    }
    const key = raw.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (value !== true) i++;
    out[key] = value;
  }
  return out;
}

function repoRoot(args = {}) {
  return path.resolve(args.root || process.env.YUTU6_WORKDIR || path.resolve(__dirname, '../../..'));
}

function run(root, cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: [cmd].concat(args).join(' '),
    status: res.status,
    ok: res.status === 0,
    stdout_tail: tail(res.stdout || ''),
    stderr_tail: tail(res.stderr || ''),
  };
}

function tail(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const lock = ProtocolGate.acquireEditLock(root, 'gate-closeout', {
    owner: args.owner || `gate-closeout:${process.pid}`,
    waitMs: Number(args.waitMs || 10000),
    leaseMs: Number(args.leaseMs || 120000),
    paths: [
      'shared/engine/done-gate.js',
      'shared/engine/protocol-gate.js',
      'projects/控制台/hardening-hooks.js',
    ],
  });
  if (!lock.ok) {
    console.log(JSON.stringify({ ok: false, reason: lock.reason, lockOwner: lock.owner || null }, null, 2));
    return 2;
  }
  try {
    const baselineFile = ProtocolGate.baselinePath(root, args);
    let baseline = null;
    let baselineResult = null;
    if (args.writeBaseline) {
      baseline = ProtocolGate.writeRuntimeBaseline(root, args);
      baselineResult = { ok: true, action: 'write', path: baselineFile };
    } else if (fs.existsSync(baselineFile)) {
      baseline = readJson(baselineFile, null);
      baselineResult = ProtocolGate.compareRuntimeBaseline(root, baseline, args);
    } else {
      baselineResult = { ok: false, reason: 'runtime_baseline_missing', path: baselineFile };
    }

    const tests = args.noTests
      ? []
      : [
        run(root, process.execPath, ['tests/protocol-gate.test.js']),
        ...(args.includeDoneGate ? [run(root, process.execPath, ['tests/done-gate.test.js'])] : []),
      ];
    const ok = baselineResult.ok === true && tests.every(t => t.ok);
    const summary = {
      ok,
      at: new Date().toISOString(),
      root,
      taskId: args.taskId || null,
      baseline: baselineResult,
      tests,
    };
    console.log(JSON.stringify(summary, null, 2));
    return ok ? 0 : 1;
  } finally {
    lock.release();
  }
}

process.exit(main());
