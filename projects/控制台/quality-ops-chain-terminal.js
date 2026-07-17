'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SharedAudit = require('../../shared/engine/quality-ops-audit');

const TERMINAL_SCHEMA = 'yutu6-quality-ops-chain-terminal@1';
const TERMINAL_TYPES = new Set([
  'project.route.done',
  'project.route.failed',
  'task.done',
  'task.failed',
  'queue.completed',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizedRootTaskId(event) {
  return event && (event.rootTaskId || event.root_task_id) || null;
}

function eventSequence(event) {
  if (!event || event.seq == null || event.seq === '') return null;
  const value = Number(event && event.seq);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function eventOutcome(event) {
  if (!event || !TERMINAL_TYPES.has(event.type)) return null;
  const statusOutcome = event.status === 'done' || event.status === 'completed'
    ? 'done'
    : (event.status === 'failed' ? 'failed' : null);
  if (event.type === 'project.route.done' || event.type === 'task.done') {
    return statusOutcome && statusOutcome !== 'done' ? null : 'done';
  }
  if (event.type === 'project.route.failed' || event.type === 'task.failed') {
    return statusOutcome && statusOutcome !== 'failed' ? null : 'failed';
  }
  if (event.type === 'queue.completed') {
    const okOutcome = event.ok === true ? 'done' : (event.ok === false ? 'failed' : null);
    if (okOutcome && statusOutcome && okOutcome !== statusOutcome) return null;
    return okOutcome || statusOutcome;
  }
  return null;
}

function terminalChannel(event) {
  if (!event) return null;
  if (event.type === 'project.route.done' || event.type === 'project.route.failed') return 'project_route';
  if (event.type === 'task.done' || event.type === 'task.failed') return 'task';
  if (event.type === 'queue.completed') return 'queue';
  return null;
}

function relativeEvidence(file, line, baseDir) {
  const absolute = path.resolve(file);
  const relative = baseDir ? path.relative(path.resolve(baseDir), absolute) : absolute;
  const safe = relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? relative.split(path.sep).join('/')
    : absolute;
  return `${safe}:${line}`;
}

function terminalFingerprint(event) {
  return sha256(JSON.stringify({
    seq: eventSequence(event),
    ts: event && (event.ts || event.at) || null,
    type: event && event.type || null,
    task: event && event.task || null,
    rootTaskId: normalizedRootTaskId(event),
    queueAgent: event && event.queueAgent || null,
    queueId: event && event.queueId || null,
    rootQueueAgent: event && event.rootQueueAgent || null,
    rootQueueId: event && event.rootQueueId || null,
    downstreamQueueAgent: event && event.downstreamQueueAgent || null,
    downstreamQueueId: event && event.downstreamQueueId || null,
    downstreamTaskId: event && event.downstreamTaskId || null,
    ok: typeof (event && event.ok) === 'boolean' ? event.ok : null,
    status: event && event.status || null,
  }));
}

function readTerminalEvents(files, options = {}) {
  const out = [];
  const seen = new Set();
  for (const file of Array.isArray(files) ? files : [files]) {
    if (!file) continue;
    let fd = null;
    let lineNumber = 0;
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
          lineNumber += 1;
          if (!/"type":"(?:project\.route\.(?:done|failed)|task\.(?:done|failed)|queue\.completed)"/.test(line)) continue;
          let event = null;
          try { event = JSON.parse(line); } catch (_) {}
          if (!event || !TERMINAL_TYPES.has(event.type)) continue;
          const fingerprint = terminalFingerprint(event);
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);
          out.push(Object.assign({}, event, {
            _event_fingerprint: fingerprint,
            _evidence_ref: relativeEvidence(file, lineNumber, options.baseDir),
          }));
        }
      } while (bytes > 0);
      if (carry) {
        lineNumber += 1;
        if (/"type":"(?:project\.route\.(?:done|failed)|task\.(?:done|failed)|queue\.completed)"/.test(carry)) {
          let event = null;
          try { event = JSON.parse(carry); } catch (_) {}
          if (event && TERMINAL_TYPES.has(event.type)) {
            const fingerprint = terminalFingerprint(event);
            if (!seen.has(fingerprint)) {
              seen.add(fingerprint);
              out.push(Object.assign({}, event, {
                _event_fingerprint: fingerprint,
                _evidence_ref: relativeEvidence(file, lineNumber, options.baseDir),
              }));
            }
          }
        }
      }
    } catch (_) {
      // Audit input is read-only and best effort. Missing evidence is represented
      // by an unknown terminal below; it is never converted into done or failed.
    } finally {
      if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    }
  }
  return out;
}

function terminalSummary(event) {
  if (!event) return null;
  return {
    seq: eventSequence(event),
    ts: event.ts || event.at || null,
    type: event.type || null,
    outcome: eventOutcome(event),
    task: event.task || null,
    root_task_id: normalizedRootTaskId(event),
    queue_agent: event.queueAgent || null,
    queue_id: event.queueId || null,
    root_queue_agent: event.rootQueueAgent || null,
    root_queue_id: event.rootQueueId || null,
    downstream_queue_agent: event.downstreamQueueAgent || null,
    downstream_queue_id: event.downstreamQueueId || null,
    downstream_task_id: event.downstreamTaskId || null,
    evidence_ref: event._evidence_ref || null,
  };
}

function traceContext(chain) {
  const traces = Array.isArray(chain && chain.traces) ? chain.traces : [];
  const taskIds = new Set(traces.map(trace => trace && trace.task_id).filter(Boolean));
  const rootQueues = new Set();
  for (const trace of traces) {
    if (!trace || !trace.root_queue_agent || !trace.root_queue_id) continue;
    rootQueues.add(`${trace.root_queue_agent}\u0000${trace.root_queue_id}`);
  }
  return {
    traces,
    taskIds,
    childTaskIds: new Set(Array.from(taskIds).filter(id => id !== chain.root_task_id)),
    rootQueues,
  };
}

function rootQueueMatches(event, context) {
  if (!event.queueAgent || !event.queueId) return false;
  if (context.rootQueues.size && !context.rootQueues.has(`${event.queueAgent}\u0000${event.queueId}`)) return false;
  if (event.rootQueueAgent && event.rootQueueAgent !== event.queueAgent) return false;
  if (event.rootQueueId && event.rootQueueId !== event.queueId) return false;
  return true;
}

function classifyTerminalEvent(rootTaskId, event, context) {
  const rootRef = normalizedRootTaskId(event);
  const outcome = eventOutcome(event);
  const channel = terminalChannel(event);
  const claimsRoot = event && (event.task === rootTaskId || rootRef === rootTaskId);
  if (!channel || !claimsRoot) return { kind: 'irrelevant' };
  if (!outcome) return { kind: 'invalid', reason: 'terminal_outcome_invalid' };

  if (event.task !== rootTaskId) {
    if (rootRef === rootTaskId && context.taskIds.has(event.task)) {
      return { kind: 'node', outcome, channel };
    }
    return { kind: 'invalid', reason: 'terminal_lineage_task_not_in_chain' };
  }
  if (rootRef && rootRef !== rootTaskId) return { kind: 'invalid', reason: 'terminal_root_task_mismatch' };

  if (channel === 'project_route') {
    if (rootRef !== rootTaskId) return { kind: 'invalid', reason: 'project_route_root_task_missing' };
    if (context.rootQueues.size) {
      if (!event.rootQueueAgent || !event.rootQueueId) {
        return { kind: 'invalid', reason: 'project_route_root_queue_missing' };
      }
      if (!context.rootQueues.has(`${event.rootQueueAgent}\u0000${event.rootQueueId}`)) {
        return { kind: 'invalid', reason: 'project_route_root_queue_mismatch' };
      }
    }
    if (context.childTaskIds.size) {
      if (!event.downstreamQueueAgent || !event.downstreamQueueId || !event.downstreamTaskId) {
        return { kind: 'invalid', reason: 'project_route_downstream_lineage_missing' };
      }
      if (!context.childTaskIds.has(event.downstreamTaskId)) {
        return { kind: 'invalid', reason: 'project_route_downstream_task_mismatch' };
      }
    } else if (event.downstreamTaskId && !context.taskIds.has(event.downstreamTaskId)) {
      return { kind: 'invalid', reason: 'project_route_downstream_trace_missing' };
    }
  }

  if (channel === 'queue' && !rootQueueMatches(event, context)) {
    return { kind: 'invalid', reason: 'root_queue_lineage_mismatch' };
  }
  return { kind: 'authority', outcome, channel };
}

function unknownTerminal(rootTaskId, details = {}) {
  return {
    schema: TERMINAL_SCHEMA,
    root_task_id: rootTaskId || null,
    status: 'unknown',
    final_state: 'unknown',
    complete: false,
    confidence: 'unknown',
    final_state_source: [],
    unknown_reason: details.unknownReason || 'terminal_evidence_missing',
    warnings: details.warnings || [],
    rejected_terminal_events: details.rejected || [],
    node_terminal_events: details.nodeEvents || [],
    terminal_history: details.history || [],
  };
}

function reduceChainTerminal(chain, terminalEvents) {
  const rootTaskId = chain && chain.root_task_id || null;
  if (!rootTaskId) return unknownTerminal(null, { unknownReason: 'root_task_id_missing' });
  const context = traceContext(chain);
  const authorities = [];
  const rejected = [];
  const nodeEvents = [];
  let projectRouteClaimed = false;
  for (const event of terminalEvents || []) {
    if (event && (event.type === 'project.route.done' || event.type === 'project.route.failed')
      && (event.task === rootTaskId || normalizedRootTaskId(event) === rootTaskId)) {
      projectRouteClaimed = true;
    }
    const classified = classifyTerminalEvent(rootTaskId, event, context);
    if (classified.kind === 'authority') authorities.push({ event, ...classified });
    else if (classified.kind === 'node') nodeEvents.push(terminalSummary(event));
    else if (classified.kind === 'invalid') rejected.push({ reason: classified.reason, event: terminalSummary(event) });
  }

  const history = authorities
    .slice()
    .sort((a, b) => (eventSequence(a.event) ?? Number.MAX_SAFE_INTEGER) - (eventSequence(b.event) ?? Number.MAX_SAFE_INTEGER))
    .map(item => terminalSummary(item.event));
  if (!authorities.length) {
    return unknownTerminal(rootTaskId, {
      unknownReason: rejected.length ? 'terminal_lineage_invalid' : 'terminal_evidence_missing',
      rejected,
      nodeEvents,
      history,
    });
  }
  if (authorities.some(item => eventSequence(item.event) == null)) {
    return unknownTerminal(rootTaskId, {
      unknownReason: 'terminal_order_missing_sequence',
      rejected,
      nodeEvents,
      history,
    });
  }

  const bySequence = new Map();
  for (const item of authorities) {
    const seq = eventSequence(item.event);
    const entries = bySequence.get(seq) || [];
    entries.push(item);
    bySequence.set(seq, entries);
  }
  const duplicateSequence = Array.from(bySequence.entries()).find(([, entries]) => {
    return new Set(entries.map(item => item.event._event_fingerprint || terminalFingerprint(item.event))).size > 1;
  });
  if (duplicateSequence) {
    return unknownTerminal(rootTaskId, {
      unknownReason: 'terminal_sequence_conflict',
      warnings: [{ code: 'terminal_sequence_conflict', seq: duplicateSequence[0] }],
      rejected,
      nodeEvents,
      history,
    });
  }

  const requiredChannels = context.childTaskIds.size || projectRouteClaimed
    ? ['project_route', 'task', 'queue']
    : ['task', 'queue'];
  const latest = new Map();
  for (const item of authorities) {
    const previous = latest.get(item.channel);
    if (!previous || eventSequence(item.event) > eventSequence(previous.event)) latest.set(item.channel, item);
  }
  const missingChannels = requiredChannels.filter(channel => !latest.has(channel));
  if (missingChannels.length) {
    return unknownTerminal(rootTaskId, {
      unknownReason: `terminal_channels_missing:${missingChannels.join(',')}`,
      warnings: [{ code: 'terminal_channels_missing', channels: missingChannels }],
      rejected,
      nodeEvents,
      history,
    });
  }

  const selected = requiredChannels.map(channel => latest.get(channel));
  const outcomes = new Set(selected.map(item => item.outcome));
  if (outcomes.size !== 1) {
    return unknownTerminal(rootTaskId, {
      unknownReason: 'terminal_outcome_conflict',
      warnings: [{ code: 'terminal_outcome_conflict', evidence_refs: selected.map(item => item.event._evidence_ref).filter(Boolean) }],
      rejected,
      nodeEvents,
      history,
    });
  }

  const latestSelectedSeq = Math.max(...selected.map(item => eventSequence(item.event)));
  const laterRejected = rejected.filter(item => item.event.seq != null && item.event.seq > latestSelectedSeq);
  if (laterRejected.length) {
    return unknownTerminal(rootTaskId, {
      unknownReason: 'later_terminal_lineage_invalid',
      warnings: [{ code: 'later_terminal_lineage_invalid', evidence_refs: laterRejected.map(item => item.event.evidence_ref).filter(Boolean) }],
      rejected,
      nodeEvents,
      history,
    });
  }

  const warnings = [];
  for (let index = 1; index < history.length; index += 1) {
    const previousAt = Date.parse(history[index - 1].ts || '');
    const currentAt = Date.parse(history[index].ts || '');
    if (Number.isFinite(previousAt) && Number.isFinite(currentAt) && currentAt < previousAt) {
      warnings.push({
        code: 'terminal_timestamp_order_inversion',
        detail: 'seq remains authoritative; timestamp order is not used to guess the final state',
        evidence_refs: [history[index - 1].evidence_ref, history[index].evidence_ref].filter(Boolean),
      });
      break;
    }
  }
  if (rejected.length) {
    warnings.push({
      code: 'non_authoritative_terminal_rejected',
      count: rejected.length,
      evidence_refs: rejected.map(item => item.event.evidence_ref).filter(Boolean),
    });
  }

  const finalState = selected[0].outcome;
  return {
    schema: TERMINAL_SCHEMA,
    root_task_id: rootTaskId,
    status: finalState === 'done' ? 'completed' : 'failed',
    final_state: finalState,
    complete: true,
    confidence: warnings.length ? 'warning' : 'authoritative',
    final_state_source: selected.map(item => terminalSummary(item.event)),
    unknown_reason: null,
    warnings,
    rejected_terminal_events: rejected,
    node_terminal_events: nodeEvents,
    terminal_history: history,
  };
}

function buildChains(indexEvents, terminalEvents) {
  const baseChains = SharedAudit.buildChains(indexEvents, []);
  return baseChains.map(chain => {
    const terminal = reduceChainTerminal(chain, terminalEvents);
    const contentHash = sha256([
      chain.traces.map(trace => [trace.trace_id, trace.content_hash || '', trace.status || '', trace.at || ''].join('|')).join('\n'),
      JSON.stringify(terminal, (key, value) => {
        return key === 'evidence_ref' || key === 'evidence_refs' ? undefined : value;
      }),
    ].join('\n'));
    return Object.assign({}, chain, {
      content_hash: contentHash,
      status: terminal.status,
      final_state: terminal.final_state,
      final_state_source: terminal.final_state_source,
      unknown_reason: terminal.unknown_reason,
      terminal,
    });
  });
}

module.exports = {
  TERMINAL_SCHEMA,
  TERMINAL_TYPES,
  readTerminalEvents,
  reduceChainTerminal,
  buildChains,
  eventOutcome,
  eventSequence,
  terminalSummary,
};
