'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POLICY_SCHEMA = 'yutu6-quality-ops-policy@1';
const LEDGER_SCHEMA = 'yutu6-quality-ops-review-ledger@1';
const PLAN_SCHEMA = 'yutu6-quality-ops-audit-plan@1';
const FINDINGS_SCHEMA = 'yutu6-quality-ops-findings@1';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readJsonLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
}

function readTerminalEvents(files) {
  const out = [];
  const seen = new Set();
  for (const file of Array.isArray(files) ? files : [files]) {
    if (!file) continue;
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let carry = '';
      let bytes = 0;
      do {
        bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        const parts = (carry + buffer.toString('utf8', 0, bytes)).split(/\r?\n/);
        carry = parts.pop() || '';
        for (const line of parts) {
          if (!/"type":"(?:task\.done|task\.failed|queue\.completed)"/.test(line)) continue;
          let event = null;
          try { event = JSON.parse(line); } catch (_) {}
          if (!event) continue;
          const key = Number.isFinite(Number(event.seq))
            ? `seq:${Number(event.seq)}`
            : [event.type, event.ts || '', event.task || '', event.queueAgent || '', event.queueId || ''].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(event);
        }
      } while (bytes > 0);
      if (carry && /"type":"(?:task\.done|task\.failed|queue\.completed)"/.test(carry)) {
        let event = null;
        try { event = JSON.parse(carry); } catch (_) {}
        if (event) {
          const key = Number.isFinite(Number(event.seq))
            ? `seq:${Number(event.seq)}`
            : [event.type, event.ts || '', event.task || '', event.queueAgent || '', event.queueId || ''].join('|');
          if (!seen.has(key)) {
            seen.add(key);
            out.push(event);
          }
        }
      }
    } catch (_) {
      // Rotated event files are best-effort audit input. Missing/unreadable files
      // leave the affected chain non-terminal instead of inventing completion.
    } finally {
      if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    }
  }
  return out;
}

function createPolicy(now = new Date()) {
  return {
    schema: POLICY_SCHEMA,
    activated_at: now.toISOString(),
    first_week_days: 7,
    first_week_strategy: 'all_new_chains_in_batches',
    steady_strategy: 'weighted_random_without_recent_repeats',
    daily_local_time: '12:00 Asia/Shanghai',
    weekly_local_time: 'Saturday 21:00 Asia/Shanghai',
    steady_sample_size: 8,
    first_week_batch_size: 12,
    route_attention_cap: 0.4,
    reservation_ttl_hours: 24,
    hidden_chain_of_thought_saved: false,
  };
}

function ensurePolicy(file, now = new Date()) {
  let policy = readJson(file, null);
  if (!policy || policy.schema !== POLICY_SCHEMA || !policy.activated_at) {
    policy = createPolicy(now);
    atomicWriteJson(file, policy);
  }
  return policy;
}

function normalizeLedger(raw) {
  const ledger = raw && typeof raw === 'object' ? raw : {};
  return {
    schema: LEDGER_SCHEMA,
    updated_at: ledger.updated_at || null,
    reviews: Array.isArray(ledger.reviews) ? ledger.reviews : [],
    reservations: Array.isArray(ledger.reservations) ? ledger.reservations : [],
  };
}

function mergeIndexEvents(events) {
  const traces = new Map();
  for (const ev of events) {
    if (!ev || !ev.trace_id) continue;
    const prev = traces.get(ev.trace_id) || {};
    traces.set(ev.trace_id, Object.assign({}, prev, ev));
  }
  return Array.from(traces.values());
}

function terminalEventOrder(event) {
  const seq = Number(event && event.seq);
  if (Number.isFinite(seq)) return seq;
  const at = Date.parse(event && (event.ts || event.at) || '');
  return Number.isFinite(at) ? at : -1;
}

function terminalEventSummary(event) {
  if (!event) return null;
  return {
    seq: Number.isFinite(Number(event.seq)) ? Number(event.seq) : null,
    ts: event.ts || event.at || null,
    type: event.type || null,
    task: event.task || null,
    queue_agent: event.queueAgent || null,
    queue_id: event.queueId || null,
    ok: typeof event.ok === 'boolean' ? event.ok : null,
    status: event.status || null,
  };
}

function reduceChainTerminal(rootTaskId, terminalEvents) {
  const relevant = (terminalEvents || []).filter(event => event && event.task === rootTaskId);
  const taskEvents = relevant
    .filter(event => event.type === 'task.done' || event.type === 'task.failed')
    .sort((a, b) => terminalEventOrder(a) - terminalEventOrder(b));
  const queueEvents = relevant
    .filter(event => event.type === 'queue.completed')
    .sort((a, b) => terminalEventOrder(a) - terminalEventOrder(b));
  const task = taskEvents[taskEvents.length - 1] || null;
  const queue = queueEvents[queueEvents.length - 1] || null;
  const taskDone = !!task && task.type === 'task.done';
  const taskFailed = !!task && task.type === 'task.failed';
  const queueDone = !!queue && queue.ok === true;
  const queueFailed = !!queue && queue.ok === false;
  const conflicts = [];
  if (taskDone && queueFailed) conflicts.push('task.done_vs_queue.completed.ok=false');
  if (taskFailed && queueDone) conflicts.push('task.failed_vs_queue.completed.ok=true');
  let status = 'running';
  if (taskFailed || queueFailed) status = 'failed';
  else if (taskDone && queueDone) status = 'completed';
  return {
    status,
    complete: status === 'completed' || status === 'failed',
    source: task && queue ? 'task+queue' : (task ? 'task-only' : (queue ? 'queue-only' : 'none')),
    task: terminalEventSummary(task),
    queue: terminalEventSummary(queue),
    conflicts,
  };
}

function buildChains(events, terminalEvents = []) {
  const traces = mergeIndexEvents(events).filter(x => x.chain_id && x.trace_id);
  const byChain = new Map();
  for (const trace of traces) {
    const list = byChain.get(trace.chain_id) || [];
    list.push(trace);
    byChain.set(trace.chain_id, list);
  }
  const chains = [];
  for (const [chainId, list] of byChain.entries()) {
    list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const routeParts = [];
    const seenRoute = new Set();
    for (const item of list) {
      const part = [item.agent_role || 'unknown', item.runner_id || 'unknown'].join('@');
      if (!seenRoute.has(part)) {
        seenRoute.add(part);
        routeParts.push(part);
      }
    }
    const last = list[list.length - 1] || {};
    const rootTaskId = last.root_task_id || list[0] && list[0].root_task_id || null;
    const terminal = reduceChainTerminal(rootTaskId, terminalEvents);
    const contentHash = sha256([
      list.map(x => [x.trace_id, x.content_hash || '', x.status || '', x.at || ''].join('|')).join('\n'),
      JSON.stringify(terminal),
    ].join('\n'));
    chains.push({
      chain_id: chainId,
      root_task_id: rootTaskId,
      project_id: last.project_id || null,
      route_key: routeParts.join(' -> ') || 'unknown',
      roles: routeParts,
      first_at: list[0] && list[0].at || null,
      last_at: last.at || null,
      content_hash: contentHash,
      // Span failures remain trace evidence. Only the root task's final task.* and
      // queue.completed events may settle the interaction chain.
      status: terminal.status,
      terminal,
      span_failures: list.filter(x => x.status === 'failed').map(x => x.trace_id),
      traces: list,
    });
  }
  return chains.sort((a, b) => String(a.last_at || '').localeCompare(String(b.last_at || '')));
}

function traceObservabilityWarnings(trace) {
  if (!trace) return [];
  if (Array.isArray(trace.observability_warning)) return trace.observability_warning.filter(Boolean);
  return trace.observability_warning
    ? [{ code: 'observability_warning', detail: String(trace.observability_warning) }]
    : [];
}

function traceHookErrors(trace) {
  return trace && Array.isArray(trace.hook_error) ? trace.hook_error.filter(Boolean) : [];
}

function chainObservabilityWarnings(chain) {
  const out = [];
  const seen = new Set();
  function add(item) {
    const key = [item.trace_id || '', item.code || '', item.artifact || ''].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  }
  for (const trace of chain && (chain.traces || chain.trace_refs) || []) {
    for (const warning of traceObservabilityWarnings(trace)) {
      add({
        trace_id: trace.trace_id || null,
        code: warning && warning.code || 'observability_warning',
        artifact: warning && warning.artifact || null,
        audit_effect: warning && warning.audit_effect || 'quality_audit_no_pass',
      });
    }
    for (const hookError of traceHookErrors(trace)) {
      add({
        trace_id: trace.trace_id || null,
        code: 'trace_integrity_hook_error',
        artifact: 'integrity_hook',
        audit_effect: 'quality_audit_no_pass',
        phase: hookError && hookError.phase || null,
      });
    }
  }
  return out;
}

function ageDays(from, now) {
  const t = Date.parse(from || '');
  return Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 86400000) : Infinity;
}

function isFirstWeek(policy, now = new Date()) {
  return ageDays(policy && policy.activated_at, now) < Number(policy && policy.first_week_days || 7);
}

function reviewKey(chainId, contentHash) {
  return `${chainId}:${contentHash}`;
}

function activeReservationKeys(ledger, now, ttlHours) {
  const ttlMs = Number(ttlHours || 24) * 3600000;
  const out = new Set();
  for (const row of ledger.reservations || []) {
    const at = Date.parse(row.reserved_at || '');
    if (row.status === 'reserved' && Number.isFinite(at) && now.getTime() - at < ttlMs) {
      out.add(reviewKey(row.chain_id, row.content_hash));
    }
  }
  return out;
}

function seededRandom(seedText) {
  let state = parseInt(sha256(seedText).slice(0, 8), 16) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function weightedChoice(candidates, weights, random) {
  const total = weights.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (!total) return 0;
  let cursor = random() * total;
  for (let i = 0; i < candidates.length; i++) {
    cursor -= Math.max(0, weights[i]);
    if (cursor <= 0) return i;
  }
  return candidates.length - 1;
}

function selectChains({ chains, ledger: rawLedger, policy, now = new Date(), seed } = {}) {
  const ledger = normalizeLedger(rawLedger);
  const reviewed = new Set(ledger.reviews.map(row => reviewKey(row.chain_id, row.content_hash)));
  const reserved = activeReservationKeys(ledger, now, policy && policy.reservation_ttl_hours);
  const candidates = (chains || []).filter(chain => {
    const key = reviewKey(chain.chain_id, chain.content_hash);
    return !reviewed.has(key) && !reserved.has(key);
  });
  if (isFirstWeek(policy, now)) {
    return { strategy: 'first_week_full', candidates: candidates.length, selected: candidates };
  }
  const sampleSize = Math.max(1, Number(policy && policy.steady_sample_size || 8));
  const frequencies = new Map();
  for (const chain of chains || []) frequencies.set(chain.route_key, (frequencies.get(chain.route_key) || 0) + 1);
  const reviewCounts = new Map();
  for (const row of ledger.reviews) reviewCounts.set(row.route_key, (reviewCounts.get(row.route_key) || 0) + 1);
  const routeOrder = Array.from(new Set(candidates.map(x => x.route_key)))
    .sort((a, b) => (frequencies.get(a) || 0) - (frequencies.get(b) || 0) || a.localeCompare(b));
  const maxPerRoute = Math.max(1, Math.ceil(sampleSize * Number(policy && policy.route_attention_cap || 0.4)));
  const selected = [];
  const selectedIds = new Set();
  const routeSelected = new Map();
  // 冷门线路先各取一条，确保“重点抽查”不是仅概率口号。
  for (const route of routeOrder) {
    if (selected.length >= sampleSize) break;
    const candidate = candidates.find(x => x.route_key === route && !selectedIds.has(x.chain_id));
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(candidate.chain_id);
    routeSelected.set(route, 1);
  }
  const remaining = candidates.filter(x => !selectedIds.has(x.chain_id));
  const random = seededRandom(seed || now.toISOString().slice(0, 10));
  while (selected.length < sampleSize && remaining.length) {
    const allowed = remaining.filter(x => (routeSelected.get(x.route_key) || 0) < maxPerRoute);
    const pool = allowed.length ? allowed : remaining;
    const maxFrequency = Math.max(1, ...Array.from(frequencies.values()));
    const weights = pool.map(chain => {
      const freq = frequencies.get(chain.route_key) || 1;
      const seen = reviewCounts.get(chain.route_key) || 0;
      return 1 + (maxFrequency / freq) * 2 + 2 / (seen + 1);
    });
    const chosen = pool[weightedChoice(pool, weights, random)];
    selected.push(chosen);
    selectedIds.add(chosen.chain_id);
    routeSelected.set(chosen.route_key, (routeSelected.get(chosen.route_key) || 0) + 1);
    const idx = remaining.findIndex(x => x.chain_id === chosen.chain_id);
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return { strategy: 'steady_weighted_random', candidates: candidates.length, selected };
}

function planChain(chain) {
  return {
    chain_id: chain.chain_id,
    root_task_id: chain.root_task_id,
    project_id: chain.project_id,
    route_key: chain.route_key,
    content_hash: chain.content_hash,
    status: chain.status,
    terminal: chain.terminal || null,
    span_failures: Array.isArray(chain.span_failures) ? chain.span_failures : [],
    first_at: chain.first_at,
    last_at: chain.last_at,
    trace_refs: chain.traces.map(trace => ({
      trace_id: trace.trace_id,
      task_id: trace.task_id || null,
      node_id: trace.node_id || null,
      agent_role: trace.agent_role || null,
      runner_id: trace.runner_id || null,
      status: trace.status || null,
      manifest_path: trace.manifest_path || null,
      prompt_redacted_path: trace.prompt_redacted_path || null,
      output_redacted_path: trace.output_redacted_path || null,
      evidence_refs: trace.evidence_refs || [],
      observability_status: trace.observability_status || null,
      observability_warning: traceObservabilityWarnings(trace),
      hook_error: Array.isArray(trace.hook_error) ? trace.hook_error : [],
    })),
    audit_gate: {
      observability_warning_forbids_pass: true,
      observability_warnings: chainObservabilityWarnings(chain),
    },
  };
}

function makePlan(selection, opts = {}) {
  const now = opts.now || new Date();
  const date = opts.date || now.toISOString().slice(0, 10);
  const auditId = opts.auditId || `qops-${date.replace(/-/g, '')}-${selection.strategy}`;
  const batchSize = Math.max(1, Number(opts.batchSize || (selection.strategy === 'first_week_full' ? 12 : 8)));
  const chains = selection.selected.map(planChain);
  const batches = [];
  for (let i = 0; i < chains.length; i += batchSize) {
    batches.push({
      batch_id: `batch-${String(batches.length + 1).padStart(2, '0')}`,
      chains: chains.slice(i, i + batchSize),
    });
  }
  return {
    schema: PLAN_SCHEMA,
    audit_id: auditId,
    created_at: now.toISOString(),
    strategy: selection.strategy,
    candidate_count: selection.candidates,
    selected_count: chains.length,
    batch_size: batchSize,
    batches,
    constraints: {
      read_redacted_records_only: true,
      save_hidden_chain_of_thought: false,
      findings_require_evidence: true,
      proposals_are_owner_approval_todo_only: true,
      observability_warning_forbids_pass: true,
    },
  };
}

function reservePlan(ledgerRaw, plan, now = new Date()) {
  const ledger = normalizeLedger(ledgerRaw);
  const existing = new Set(ledger.reservations.map(row => `${row.audit_id}:${row.batch_id}:${row.chain_id}:${row.content_hash}`));
  for (const batch of plan.batches || []) {
    for (const chain of batch.chains || []) {
      const key = `${plan.audit_id}:${batch.batch_id}:${chain.chain_id}:${chain.content_hash}`;
      if (existing.has(key)) continue;
      ledger.reservations.push({
        audit_id: plan.audit_id,
        batch_id: batch.batch_id,
        chain_id: chain.chain_id,
        content_hash: chain.content_hash,
        route_key: chain.route_key,
        reserved_at: now.toISOString(),
        status: 'reserved',
      });
    }
  }
  ledger.updated_at = now.toISOString();
  return ledger;
}

function validateFindings(batch, data) {
  if (!data || data.schema !== FINDINGS_SCHEMA) throw new Error(`findings schema must be ${FINDINGS_SCHEMA}`);
  const expected = new Map((batch.chains || []).map(x => [x.chain_id, x]));
  const reviews = Array.isArray(data.chain_reviews) ? data.chain_reviews : [];
  const seen = new Set();
  for (const review of reviews) {
    if (!expected.has(review.chain_id)) throw new Error(`findings contains unplanned chain: ${review.chain_id}`);
    if (!['pass', 'warning', 'fail'].includes(review.verdict)) throw new Error(`bad verdict for ${review.chain_id}`);
    const observabilityWarnings = chainObservabilityWarnings(expected.get(review.chain_id));
    if (review.verdict === 'pass' && observabilityWarnings.length) {
      const codes = Array.from(new Set(observabilityWarnings.map(item => item.code))).join(',');
      throw new Error(`audit-gate observability_warning forbids pass for ${review.chain_id}: ${codes}`);
    }
    if (!Array.isArray(review.evidence_refs) || !review.evidence_refs.filter(Boolean).length) {
      throw new Error(`review evidence missing for ${review.chain_id}`);
    }
    if (!String(review.chain_summary || '').trim()) throw new Error(`chain summary missing for ${review.chain_id}`);
    seen.add(review.chain_id);
  }
  for (const id of expected.keys()) if (!seen.has(id)) throw new Error(`planned chain was not reviewed: ${id}`);
  return true;
}

function completeBatch(ledgerRaw, plan, batch, findings, now = new Date()) {
  validateFindings(batch, findings);
  const ledger = normalizeLedger(ledgerRaw);
  const reviewById = new Map(findings.chain_reviews.map(x => [x.chain_id, x]));
  const reviewed = new Set(ledger.reviews.map(row => reviewKey(row.chain_id, row.content_hash)));
  for (const chain of batch.chains || []) {
    const key = reviewKey(chain.chain_id, chain.content_hash);
    if (!reviewed.has(key)) {
      const review = reviewById.get(chain.chain_id);
      ledger.reviews.push({
        audit_id: plan.audit_id,
        batch_id: batch.batch_id,
        chain_id: chain.chain_id,
        content_hash: chain.content_hash,
        route_key: chain.route_key,
        root_task_id: chain.root_task_id,
        verdict: review.verdict,
        finding_count: Array.isArray(review.findings) ? review.findings.length : 0,
        reviewed_at: now.toISOString(),
      });
      reviewed.add(key);
    }
  }
  for (const reservation of ledger.reservations) {
    if (reservation.audit_id === plan.audit_id && reservation.batch_id === batch.batch_id) {
      reservation.status = 'completed';
      reservation.completed_at = now.toISOString();
    }
  }
  ledger.updated_at = now.toISOString();
  return ledger;
}

function proposalFingerprint(proposal) {
  const title = String(proposal && proposal.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const category = String(proposal && proposal.category || 'process').toLowerCase();
  const evidence = (proposal && proposal.evidence_refs || []).map(String).sort().join('|');
  return sha256(`${category}|${title}|${evidence}`);
}

module.exports = {
  POLICY_SCHEMA,
  LEDGER_SCHEMA,
  PLAN_SCHEMA,
  FINDINGS_SCHEMA,
  sha256,
  readJson,
  atomicWriteJson,
  readJsonLines,
  readTerminalEvents,
  createPolicy,
  ensurePolicy,
  normalizeLedger,
  mergeIndexEvents,
  reduceChainTerminal,
  buildChains,
  isFirstWeek,
  selectChains,
  makePlan,
  reservePlan,
  validateFindings,
  completeBatch,
  proposalFingerprint,
  traceObservabilityWarnings,
  traceHookErrors,
  chainObservabilityWarnings,
};
