#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const Q = require(path.join(WORKDIR, 'shared', 'engine', 'queue'));

function safeAgent(s) {
  return /^[\p{L}\p{N}_-]+$/u.test(String(s || '')) ? String(s) : '';
}

function queueTaskText(task) {
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    return String(task.goal || task.message || task.task || JSON.stringify(task)).replace(/\s+/g, ' ').slice(0, 180);
  }
  return String(task || '').replace(/\s+/g, ' ').slice(0, 180);
}

function queueAgents() {
  const dir = path.join(QUEUE_ROOT, 'queues');
  try {
    return fs.readdirSync(dir).filter(safeAgent).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return [];
  }
}

function activeItems(ignoreAgents) {
  const ignore = new Set(ignoreAgents || []);
  const out = [];
  for (const agent of queueAgents()) {
    if (ignore.has(agent)) continue;
    let listed;
    try { listed = Q.list(QUEUE_ROOT, agent); } catch (_) { continue; }
    for (const entry of listed.queued || []) out.push({ agent, queueId: entry.id, status: 'queued', goal: queueTaskText(entry.task) });
    for (const entry of listed.running || []) out.push({ agent, queueId: entry.id, status: entry.cancel_requested ? 'canceling' : 'running', goal: queueTaskText(entry.task) });
  }
  return out;
}

function main() {
  const json = process.argv.includes('--json');
  const ignoreIdx = process.argv.indexOf('--ignore');
  const ignore = ignoreIdx >= 0 ? String(process.argv[ignoreIdx + 1] || '').split(',').filter(Boolean) : ['ui_optimizer'];
  const active = activeItems(ignore);
  const result = {
    ok: true,
    idle: active.length === 0,
    activeCount: active.length,
    active: active.slice(0, 20),
    ignoredAgents: ignore,
  };
  if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else if (result.idle) process.stdout.write('idle\n');
  else process.stdout.write(`busy: ${active.length} active queued/running item(s)\n`);
  process.exit(result.idle ? 0 : 2);
}

if (require.main === module) main();

module.exports = { activeItems };
