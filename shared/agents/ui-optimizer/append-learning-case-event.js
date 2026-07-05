#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function acquireLock(lockDir, opts = {}) {
  const timeoutMs = Math.max(100, Number(opts.timeoutMs) || 5000);
  const staleMs = Math.max(timeoutMs, Number(opts.staleMs) || 5 * 60 * 1000);
  const started = Date.now();
  const ownerFile = path.join(lockDir, 'owner.json');

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(ownerFile, JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
      }) + '\n');
      let released = false;
      return () => {
        if (released) return;
        released = true;
        fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      try {
        const st = fs.statSync(lockDir);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (_) {
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timeout acquiring event lock: ${lockDir}`);
      }
      sleep(25);
    }
  }
}

function buildEntry(env, values) {
  return {
    ts: new Date().toISOString(),
    type: 'learning_case.appended',
    source: 'ui-optimizer',
    taskId: env.UI_OPT_TASK_ID || null,
    queueAgent: env.UI_OPT_QUEUE_AGENT || 'ui-optimizer',
    queueId: env.UI_OPT_QUEUE_ID || null,
    rootQueueAgent: env.UI_OPT_ROOT_QUEUE_AGENT || null,
    rootQueueId: env.UI_OPT_ROOT_QUEUE_ID || null,
    rootTaskId: env.UI_OPT_ROOT_TASK_ID || null,
    caseFile: env.CASE_FILE_REL || null,
    sourceCaseAnchor: env.UI_OPT_SOURCE_CASE_ANCHOR || null,
    sourceCaseHash: env.UI_OPT_SOURCE_CASE_HASH || null,
    sourceCaseTitle: env.UI_OPT_SOURCE_CASE_TITLE || null,
    summary: env.SUMMARY_REL || null,
    iteration: Number(values.iter) || 0,
    maxIterations: Number(values.maxIter) || 0,
    enqueued: Number(values.enq) || 0,
    left: Number(values.left) || 0,
  };
}

function appendJsonlWithLock(file, entry, opts = {}) {
  if (!file) throw new Error('missing events file');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockDir = opts.lockDir || `${file}.learning-case.lock`;
  const release = acquireLock(lockDir, opts);
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } finally {
    release();
  }
}

function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const events = args.events || args.file;
  const entry = buildEntry(env, {
    iter: args.iter,
    maxIter: args['max-iter'] || args.maxIter,
    enq: args.enq,
    left: args.left,
  });
  appendJsonlWithLock(events, entry);
  return entry;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
}

module.exports = {
  acquireLock,
  appendJsonlWithLock,
  buildEntry,
  main,
  parseArgs,
};
