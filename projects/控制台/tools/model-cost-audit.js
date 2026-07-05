#!/usr/bin/env node
'use strict';

/*
 * Local-only model cost audit for the console control plane.
 * Reads queue ledgers and local LLM usage summaries; never returns prompt bodies,
 * responses, keys, cookies, or token files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR, 'queues')
  : path.join(ROOT, 'artifacts', 'queues');
const CFG_PATH = process.env.CONSOLE_CONFIG_PATH
  ? path.resolve(process.env.CONSOLE_CONFIG_PATH)
  : path.join(ROOT, 'config.json');
const LlmUsage = require(path.join(ROOT, 'llm-usage'));

const STATUS_DIRS = ['done', 'failed', 'running', 'paused', 'canceled'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseArgs(argv) {
  const opts = { days: 7, json: false, project: process.env.CONSOLE_COST_AUDIT_PROJECT || '控制台' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--days') opts.days = Math.max(1, Math.min(90, parseInt(argv[++i] || '7', 10) || 7));
    else if (arg === '--project') opts.project = argv[++i] || '';
  }
  return opts;
}

function roleFromAgent(agent) {
  if (/^supervisor-/.test(agent)) return 'supervisor';
  if (agent === 'memory-officer') return 'memory_officer';
  return agent;
}

function routeFor(cfg, agent, task) {
  const role = (task && task.role) || roleFromAgent(agent);
  const route = (cfg.roleRouting || {})[role] || {};
  return {
    role,
    runner: route.runner || 'unknown',
    label: route.label || role,
  };
}

function eventTimeMs(entry, file) {
  const raw = entry && (entry.enqueued_at || entry.started_at || entry.finished_at);
  const t = raw ? Date.parse(raw) : 0;
  if (t) return t;
  try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; }
}

function projectMatches(entry, project) {
  if (!project) return true;
  const task = entry && entry.task || {};
  return task.projectId === project
    || entry.projectId === project
    || task.scopedToProject === true && task.projectId === project;
}

function emptyAgentRow(agent) {
  return {
    agent,
    calls: 0,
    done: 0,
    failed: 0,
    running: 0,
    paused: 0,
    canceled: 0,
    successRate: 0,
    roles: {},
    runners: {},
    lastAt: null,
    lastAtMs: 0,
  };
}

function addCount(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function collectQueueCounts(cfg, days, nowMs, project) {
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const rows = [];
  if (!fs.existsSync(QUEUE_ROOT)) return rows;
  for (const agent of fs.readdirSync(QUEUE_ROOT)) {
    const agentDir = path.join(QUEUE_ROOT, agent);
    if (!fs.statSync(agentDir).isDirectory()) continue;
    const row = emptyAgentRow(agent);
    for (const status of STATUS_DIRS) {
      const dir = path.join(agentDir, status);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(dir, name);
        const entry = readJson(file);
        if (!entry) continue;
        if (!projectMatches(entry, project)) continue;
        const t = eventTimeMs(entry, file);
        if (t < sinceMs) continue;
        const task = entry.task || {};
        const route = routeFor(cfg, agent, task);
        row.calls++;
        row[status]++;
        row.lastAtMs = Math.max(row.lastAtMs, t);
        addCount(row.roles, route.role);
        addCount(row.runners, route.runner);
      }
    }
    if (row.calls) {
      row.successRate = Number(((row.done / row.calls) * 100).toFixed(1));
      row.lastAt = row.lastAtMs ? new Date(row.lastAtMs).toISOString() : null;
      delete row.lastAtMs;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => b.calls - a.calls || String(a.agent).localeCompare(String(b.agent)));
}

function collectRoleCounts(cfg, days, nowMs, project) {
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const byRole = new Map();
  function ensure(role) {
    if (!byRole.has(role)) {
      byRole.set(role, { role, calls: 0, done: 0, failed: 0, running: 0, paused: 0, canceled: 0 });
    }
    return byRole.get(role);
  }
  if (fs.existsSync(QUEUE_ROOT)) {
    for (const agent of fs.readdirSync(QUEUE_ROOT)) {
      const agentDir = path.join(QUEUE_ROOT, agent);
      if (!fs.statSync(agentDir).isDirectory()) continue;
      for (const status of STATUS_DIRS) {
        const dir = path.join(agentDir, status);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith('.json')) continue;
          const file = path.join(dir, name);
          const entry = readJson(file);
          if (!entry) continue;
          if (!projectMatches(entry, project)) continue;
          const t = eventTimeMs(entry, file);
          if (t < sinceMs) continue;
          const route = routeFor(cfg, agent, entry.task || {});
          const row = ensure(route.role);
          row.calls++;
          row[status]++;
        }
      }
    }
  }
  for (const role of Object.keys(cfg.roleRouting || {})) ensure(role);
  return [...byRole.values()].map(row => {
    const route = (cfg.roleRouting || {})[row.role] || {};
    return Object.assign(row, {
      runner: route.runner || 'unknown',
      label: route.label || row.role,
      successRate: row.calls ? Number(((row.done / row.calls) * 100).toFixed(1)) : null,
    });
  }).sort((a, b) => b.calls - a.calls || String(a.role).localeCompare(String(b.role)));
}

function summarizeModels(cfg, days, nowMs) {
  const queueAgents = Object.keys(cfg.roleRouting || {}).map(id => ({ id, role: id }));
  const overview = LlmUsage.buildOverview({ cfg, days, queueAgents, nowMs });
  return (overview.models || []).map(model => ({
    id: model.id,
    label: model.label,
    sourceStatus: model.sourceStatus,
    source: model.source,
    calls: asNumber(model.currentUsage && model.currentUsage.calls),
    totalTokens: asNumber(model.currentUsage && model.currentUsage.total_tokens),
    byAgent: model.currentUsage && model.currentUsage.byAgent || [],
    agents: (model.agents || []).map(a => ({ id: a.id, runner: a.runner, label: a.label })),
    caveat: model.currentUsage && model.currentUsage.costTreatment || '',
  }));
}

function buildAudit(opts) {
  const cfg = readJson(CFG_PATH) || {};
  const nowMs = Date.now();
  const queueCounts = collectQueueCounts(cfg, opts.days, nowMs, opts.project);
  const models = summarizeModels(cfg, opts.days, nowMs);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowDays: opts.days,
    project: opts.project || null,
    source: {
      config: path.relative(WORKDIR, CFG_PATH),
      queues: path.relative(WORKDIR, QUEUE_ROOT),
      note: 'local-only; LLM usage summarizes token counters only, queue counts summarize task envelopes only',
    },
    models,
    queueCounts,
    roleCounts: collectRoleCounts(cfg, opts.days, nowMs, opts.project),
  };
}

function printTable(audit) {
  console.log(`model cost audit · ${audit.windowDays}d · project=${audit.project || 'all'} · ${audit.generatedAt}`);
  console.log('\nmodels');
  for (const m of audit.models) {
    console.log(`- ${m.id}: calls=${m.calls} totalTokens=${m.totalTokens} source=${m.sourceStatus}`);
  }
  console.log('\nrole counts');
  for (const r of audit.roleCounts.filter(r => r.calls > 0).slice(0, 20)) {
    console.log(`- ${r.role}: calls=${r.calls} done=${r.done} failed=${r.failed} runner=${r.runner} success=${r.successRate}%`);
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  const audit = buildAudit(opts);
  if (opts.json) console.log(JSON.stringify(audit, null, 2));
  else printTable(audit);
}

module.exports = { buildAudit };
