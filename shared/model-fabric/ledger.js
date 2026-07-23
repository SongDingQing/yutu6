'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function safeCorrelation(headers = {}) {
  const get = name => String(headers[name] || headers[name.toLowerCase()] || '').slice(0, 160) || null;
  return {
    task_id: get('x-yutu-task-id'),
    root_task_id: get('x-yutu-root-task-id'),
    agent_id: get('x-yutu-agent-id'),
    project_id: get('x-yutu-project-id'),
    trace_id: get('x-yutu-trace-id'),
  };
}

class FabricLedger {
  constructor(root) {
    this.root = root;
    this.policyFile = path.join(root, 'policy.jsonl');
    this.usageFile = path.join(root, 'usage.jsonl');
  }

  requestId() {
    return crypto.randomUUID();
  }

  policy(entry) {
    const event = {
      schema: 'yutu6-model-fabric-policy@1',
      event_id: entry.event_id || this.requestId(),
      ts: nowIso(),
      decision: entry.decision,
      endpoint: entry.endpoint,
      requested_model: entry.requested_model || null,
      logical_model: entry.logical_model || null,
      selected_provider: entry.selected_provider || null,
      selected_model: entry.selected_model || null,
      fallback_candidates: Array.isArray(entry.fallback_candidates) ? entry.fallback_candidates.slice(0, 8) : [],
      reason: String(entry.reason || '').slice(0, 160) || null,
      ...safeCorrelation(entry.headers),
      privacy: {
        prompt_body_logged: false,
        response_body_logged: false,
        tool_args_logged: false,
        secret_fields_redacted: true,
      },
    };
    appendJsonl(this.policyFile, event);
    return event;
  }

  usage(entry) {
    const usage = entry.usage && typeof entry.usage === 'object' ? entry.usage : {};
    const event = {
      schema: 'yutu6-model-fabric-usage@1',
      event_id: entry.event_id || this.requestId(),
      policy_event_id: entry.policy_event_id || null,
      ts: nowIso(),
      endpoint: entry.endpoint,
      provider: entry.provider || null,
      requested_model: entry.requested_model || null,
      upstream_model: entry.upstream_model || null,
      status: entry.status || 'unknown',
      http_status: Number(entry.http_status || 0) || null,
      duration_ms: Number(entry.duration_ms || 0) || 0,
      failover_count: Number(entry.failover_count || 0),
      usage: {
        input_tokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
        output_tokens: Number(usage.completion_tokens || usage.output_tokens || 0),
        total_tokens: Number(usage.total_tokens || 0),
        request_count: 1,
      },
      billing: {
        mode: entry.billing_mode || 'unknown',
        amount: null,
        currency: 'none',
      },
      error_class: entry.error_class || null,
      ...safeCorrelation(entry.headers),
      privacy: {
        content_recording: 'off',
        prompt_body_logged: false,
        response_body_logged: false,
        error_message_logged: false,
        secret_fields_redacted: true,
      },
    };
    appendJsonl(this.usageFile, event);
    return event;
  }

  summary(days = 7) {
    const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
    const since = Date.now() - safeDays * 86400000;
    const events = [];
    let text = '';
    try { text = fs.readFileSync(this.usageFile, 'utf8'); } catch (_) {}
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }
      if (Date.parse(event.ts || '') >= since) events.push(event);
    }
    const byModel = new Map();
    const byProvider = new Map();
    const totals = {
      calls: 0,
      successful_calls: 0,
      failed_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      failovers: 0,
    };
    for (const event of events) {
      totals.calls++;
      if (event.status === 'ok') totals.successful_calls++;
      else totals.failed_calls++;
      totals.input_tokens += Number(event.usage && event.usage.input_tokens || 0);
      totals.output_tokens += Number(event.usage && event.usage.output_tokens || 0);
      totals.total_tokens += Number(event.usage && event.usage.total_tokens || 0);
      totals.failovers += Number(event.failover_count || 0);
      aggregate(byModel, event.requested_model || '(unknown)', event);
      aggregate(byProvider, event.provider || '(unknown)', event);
    }
    return {
      schema: 'yutu6-model-fabric-usage-summary@1',
      days: safeDays,
      totals,
      by_model: [...byModel.values()].sort((a, b) => b.calls - a.calls),
      by_provider: [...byProvider.values()].sort((a, b) => b.calls - a.calls),
      recent: events.slice(-50).reverse(),
    };
  }
}

function aggregate(map, key, event) {
  const row = map.get(key) || { id: key, calls: 0, failures: 0, total_tokens: 0, duration_ms: 0 };
  row.calls++;
  if (event.status !== 'ok') row.failures++;
  row.total_tokens += Number(event.usage && event.usage.total_tokens || 0);
  row.duration_ms += Number(event.duration_ms || 0);
  map.set(key, row);
}

module.exports = { FabricLedger, appendJsonl, safeCorrelation };
