'use strict';

// Board-only failover orchestration. Other roles retain the shared runner's normal
// routing; board retries resolve one verified context_ref before candidate calls.
const BoardContextRef = require('./board-context-ref');
const InteractionTrace = require('../../shared/engine/interaction-trace');

function redactReason(value, max = 500) {
  const clean = InteractionTrace.redact(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

function classifyFailure(value) {
  const reason = String(value || '');
  if (/\b429\b|rate.?limit|too many requests|访问量过大|请求(?:过于)?频繁|频率限制|限流|稍后再试/i.test(reason)) {
    return 'http_429';
  }
  if (/timeout|timed out|ETIMEDOUT|ECONN(?:RESET|REFUSED|ABORTED)|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|connection (?:closed|reset|refused)|transport|\b5\d\d\b|server error|service unavailable/i.test(reason)) {
    return 'transport';
  }
  if (/invalid authentication|unauthorized|forbidden|\b401\b|\b403\b|认证失败|鉴权失败/i.test(reason)) return 'auth';
  if (/quota|余额不足|额度不足|insufficient balance|payment required|billing/i.test(reason)) return 'quota';
  return 'runner_error';
}

function fallbackDelta(info) {
  return [
    'Board runner 回退差异（只追加本段，不重新展开共享背景）:',
    `- failure_kind: ${info.kind}`,
    `- failure_reason: ${redactReason(info.reason) || 'unknown'}`,
    `- runner_diff: ${info.from || 'unknown'} -> ${info.to || 'unknown'}`,
  ].join('\n');
}

function appendFallbackDelta(ctx, info) {
  return Object.assign({}, ctx || {}, {
    goal: [String(ctx && ctx.goal || '').trim(), '', fallbackDelta(info)].join('\n'),
  });
}

function candidateContext(ctx) {
  const source = ctx && typeof ctx === 'object' ? ctx : {};
  const { boardLegacyGoal, boardContextRef, ...safe } = source;
  return safe;
}

function emit(eventlog, type, data) {
  try { if (eventlog) eventlog.emit(type, data); } catch (_) {}
}

function prepareSharedContext(ctx, candidates, capabilityFor) {
  const base = Object.assign({}, ctx || {});
  const boardContext = base.boardContextRef;
  const legacyGoal = String(base.boardLegacyGoal || '');
  if (!boardContext || boardContext.enabled !== true) {
    return { ctx: base, mode: 'legacy_passthrough', reason: 'context_ref_unavailable' };
  }
  const capabilities = candidates.map(runnerId => ({
    runner: runnerId,
    capability: typeof capabilityFor === 'function' ? capabilityFor(runnerId) : null,
  }));
  if (!legacyGoal) {
    return {
      ctx: base,
      mode: 'context_ref_blocked',
      reason: 'legacy_full_envelope_missing',
      capabilities,
      blocked: true,
    };
  }
  const unsupported = capabilities.find(row => !row.capability
    || row.capability.mode !== BoardContextRef.DELIVERY_MODE);
  if (unsupported) {
    return {
      ctx: Object.assign(base, { goal: legacyGoal || base.goal }),
      mode: 'legacy_full_fail_closed',
      reason: `runner_context_ref_capability_missing:${unsupported.runner}`,
      capabilities,
    };
  }
  const materialized = BoardContextRef.materializeContextOnce(base.goal, boardContext);
  if (!materialized.ok) {
    return {
      ctx: Object.assign(base, { goal: legacyGoal || base.goal }),
      mode: 'legacy_full_fail_closed',
      reason: materialized.reason,
      capabilities,
    };
  }
  const measurement = legacyGoal
    ? BoardContextRef.measurePromptReduction([legacyGoal], [materialized.goal])
    : null;
  if (measurement && !measurement.lower_input_tokens) {
    return {
      ctx: Object.assign(base, { goal: legacyGoal }),
      mode: 'legacy_full_fail_closed',
      reason: 'materialized_prompt_not_smaller_than_legacy',
      capabilities,
      measurement,
    };
  }
  return {
    ctx: Object.assign(base, { goal: materialized.goal }),
    mode: BoardContextRef.DELIVERY_MODE,
    reason: null,
    capabilities,
    measurement,
    context: materialized.resolved,
    boardContext,
  };
}

function makeBoardFailoverRunner(opts = {}) {
  if (typeof opts.candidatesFor !== 'function') throw new Error('board failover runner requires candidatesFor');
  if (typeof opts.makeSingleRunner !== 'function') throw new Error('board failover runner requires makeSingleRunner');

  async function runNodeAsync(node, ctx, attempt) {
    const candidates = Array.from(new Set((opts.candidatesFor(node && node.agent_role) || []).filter(Boolean)));
    if (!candidates.length) return { fail: `board runner candidates unavailable: ${node && node.agent_role || 'unknown'}` };
    const preparedContext = prepareSharedContext(ctx, candidates, opts.capabilityFor);
    if (preparedContext.blocked) {
      emit(opts.eventlog, 'board.review.context_ref.blocked', {
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        reason: preparedContext.reason,
        projectId: opts.projectId || null,
      });
      return { fail: `board context_ref blocked: ${preparedContext.reason}` };
    }
    let currentCtx = preparedContext.ctx;
    emit(opts.eventlog, preparedContext.mode === BoardContextRef.DELIVERY_MODE
      ? 'board.review.context_ref.delivered'
      : 'board.review.context_ref.fail_closed', {
      task: opts.taskId || null,
      node: node && node.id || null,
      role: node && node.agent_role || null,
      mode: preparedContext.mode,
      reason: preparedContext.reason,
      context_ref: preparedContext.context && preparedContext.context.ref || null,
      context_sha256: preparedContext.context && preparedContext.context.sha256 || null,
      candidate_count: candidates.length,
      measurement: preparedContext.measurement || null,
      projectId: opts.projectId || null,
    });
    let lastFail = '';
    const attempts = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const runnerId = candidates[index];
      const candidateNode = index === 0
        ? node
        : Object.assign({}, node, { id: `${node.id}-fo${index}` });
      const runner = opts.makeSingleRunner({
        node: candidateNode,
        role: node && node.agent_role,
        runnerId,
        candidateIndex: index,
      });
      let out;
      const deliveredCtx = candidateContext(currentCtx);
      try {
        if (runner && typeof runner.runNodeAsync === 'function') out = await runner.runNodeAsync(candidateNode, deliveredCtx, attempt);
        else if (typeof runner === 'function') out = await Promise.resolve(runner(candidateNode, deliveredCtx, attempt));
        else out = { fail: `board candidate runner unavailable: ${runnerId}` };
      } catch (error) {
        out = { fail: error && error.message || String(error) };
      }
      out = out || {};
      attempts.push({
        runner: runnerId,
        candidate_index: index,
        ok: !out.fail,
        usage: out.runner_usage || null,
      });
      if (!out.fail) {
        let usageArtifact = null;
        try {
          usageArtifact = out.runner_usage && preparedContext.boardContext
            ? BoardContextRef.recordProviderUsage(preparedContext.boardContext, {
              taskId: opts.taskId,
              node: candidateNode && candidateNode.id,
              role: node && node.agent_role,
              runner: runnerId,
              attempt,
              candidateIndex: index,
              usage: out.runner_usage,
              request: out.runner_request || null,
            })
            : null;
        } catch (_) {}
        if (out.runner_usage) {
          emit(opts.eventlog, 'board.review.context_ref.provider_usage', {
            task: opts.taskId || null,
            node: candidateNode && candidateNode.id || null,
            role: node && node.agent_role || null,
            runner: runnerId,
            attempt,
            candidate_index: index,
            context_ref: preparedContext.context && preparedContext.context.ref || null,
            delivery_mode: preparedContext.mode,
            usage: out.runner_usage,
            request: out.runner_request || null,
            artifact: usageArtifact,
            projectId: opts.projectId || null,
          });
        }
        return Object.assign({}, out, {
          board_failover: {
            candidates,
            attempts,
            used_fallback: index > 0,
            context_mode: preparedContext.mode,
            context_ref: preparedContext.context && preparedContext.context.ref || null,
            local_measurement: preparedContext.measurement || null,
            provider_usage_artifact: usageArtifact,
          },
        });
      }
      lastFail = String(out.fail);
      if (index >= candidates.length - 1) break;
      const next = candidates[index + 1];
      const kind = classifyFailure(lastFail);
      emit(opts.eventlog, 'runner.failover', {
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        from: runnerId,
        to: next,
        reason: kind,
        detail: redactReason(lastFail, 300),
        attempt,
        projectId: opts.projectId || null,
      });
      if (kind === 'http_429' || kind === 'transport') {
        currentCtx = appendFallbackDelta(currentCtx, {
          kind,
          reason: lastFail,
          from: runnerId,
          to: next,
        });
        emit(opts.eventlog, 'board.review.context_ref.fallback_delta', {
          task: opts.taskId || null,
          node: node && node.id || null,
          role: node && node.agent_role || null,
          from: runnerId,
          to: next,
          reason: kind,
          full_background_reassembled: false,
          projectId: opts.projectId || null,
        });
      }
    }
    return {
      fail: redactReason(lastFail || `all board candidates unavailable: ${candidates.join(',')}`),
      board_failover: {
        candidates,
        attempts,
        used_fallback: attempts.length > 1,
        context_mode: preparedContext.mode,
        context_ref: preparedContext.context && preparedContext.context.ref || null,
        local_measurement: preparedContext.measurement || null,
      },
    };
  }

  return { runNodeAsync };
}

module.exports = {
  classifyFailure,
  redactReason,
  fallbackDelta,
  appendFallbackDelta,
  candidateContext,
  prepareSharedContext,
  makeBoardFailoverRunner,
};
