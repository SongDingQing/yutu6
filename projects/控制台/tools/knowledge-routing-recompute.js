#!/usr/bin/env node
'use strict';

// 旁路重算：只读追加式 usage.jsonl，离线生成延迟生效的阈值状态。
// 不在知识检索主链路做聚合，也不允许环境变量绕过主人批准。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Routing = require('../knowledge-routing');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '../..');
const CONFIG = path.join(ROOT, 'config.json');

function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

function hashWindow(events) {
  const ids = events.map(event => event.event_id).filter(Boolean).sort();
  return crypto.createHash('sha256').update(ids.join('\n')).digest('hex');
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    if (!event || !event.event_id || seen.has(event.event_id)) return false;
    seen.add(event.event_id);
    return true;
  });
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).knowledgeRouting || {};
  const activation = Routing.activationState(config, process.env);
  if (!activation.enabled || activation.config.dynamicRouting.enabled !== true) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      applied: false,
      reason: !activation.enabled ? activation.reason : 'dynamic_routing_disabled',
    })}\n`);
    return;
  }

  const ledgerFile = path.join(WORKSPACE, activation.config.stats && activation.config.stats.ledger
    || 'projects/控制台/artifacts/knowledge-routing/usage.jsonl');
  const stateFile = path.join(WORKSPACE, activation.config.dynamicRouting.stateFile
    || 'projects/控制台/artifacts/knowledge-routing/route-state.json');
  const all = dedupeEvents(Routing.readUsageLedger(ledgerFile))
    .filter(event => event.schema === 'console-knowledge-usage-event@1');
  const byTemplate = new Map();
  for (const event of all) {
    const key = String(event.template_id || 'unknown');
    if (!byTemplate.has(key)) byTemplate.set(key, []);
    byTemplate.get(key).push(event);
  }
  const previous = Routing.readRouteState(stateFile);
  const next = Object.assign({ schema: 'console-knowledge-route-state@1', routes: {} }, previous, {
    routes: Object.assign({}, previous.routes || {}),
    generatedAt: new Date().toISOString(),
  });
  const summaries = [];
  const windowSize = Math.max(1, Number(activation.config.dynamicRouting.windowSize) || 50);
  for (const [templateId, values] of byTemplate.entries()) {
    const window = values
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
      .slice(-windowSize);
    const windowHash = hashWindow(window);
    const prior = next.routes[templateId] || {
      threshold: activation.config.gate.initialThreshold,
      changes: [],
    };
    if (prior.lastWindowHash === windowHash) {
      summaries.push({ templateId, decision: 'duplicate_window_noop', hitCount: window.length });
      continue;
    }
    const hitCount = window.reduce((sum, event) => sum + (Number(event.hit) || 0), 0);
    const adoptionCount = window.reduce((sum, event) => sum + (Number(event.adopted) || 0), 0);
    const noContributionCount = window.reduce((sum, event) => sum + (Number(event.no_contribution) || 0), 0);
    const metrics = {
      hitCount,
      adoptionRate: hitCount ? adoptionCount / hitCount : 0,
      noContributionRate: hitCount ? noContributionCount / hitCount : 0,
    };
    const advanced = Routing.advanceRouteState(prior, metrics, Object.assign(
      { initialThreshold: activation.config.gate.initialThreshold },
      activation.config.dynamicRouting,
    ));
    next.routes[templateId] = Object.assign({}, advanced, { lastWindowHash: windowHash });
    summaries.push(Object.assign({ templateId }, metrics, {
      decision: advanced.decision,
      threshold: advanced.threshold,
    }));
  }
  if (!hasArg('--dry-run')) atomicJson(stateFile, next);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    applied: !hasArg('--dry-run'),
    dryRun: hasArg('--dry-run'),
    ledgerFile: path.relative(WORKSPACE, ledgerFile),
    stateFile: path.relative(WORKSPACE, stateFile),
    templates: summaries,
  })}\n`);
}

main();
