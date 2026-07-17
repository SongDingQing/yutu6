'use strict';
/*
 * engine:声明式编排器(蓝图 §18)。结构已知的流程写死、零 token 走;
 * 只在「无边匹配 / 需临场拆解」时才交回 LLM 的 planner 节点(on_no_edge)。
 * 同步织入可信地基(§10 + §18.7):任务状态机/attempt、事件日志、验收证据、
 * 三道护栏(max_loops + 墙钟超时 + 跑前 dry-run 校验)、human gate 一等节点。
 *
 * runner(node, ctx, attempt) -> { vars?, evidence?, fail? }   // 执行 agent 节点
 * humanGate(node, ctx)       -> { human: { decision } } | null // 人工节点;null=暂停等人
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('./yaml-lite');
const { validateFlow } = require('./validate');
const { compileWhen } = require('./condition');
const { TERMINAL_STATES } = require('./taskstore');
const DoneGate = require('./done-gate');
const ProtocolGate = require('./protocol-gate');

const REVIEW_ROUTING_CONTRACT_FEATURE = 'review-routing-contract-v1';
const REVIEW_ROUTING_CONTRACT_ENV = 'YUTU6_REVIEW_ROUTING_CONTRACT_ENABLED';
const REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA = 'review-routing-contract-approval@1';
const REVIEW_ROUTING_CONTRACT_APPROVAL_TASK = 'cr-1784188730576-9502ee93';
const REVIEW_ROUTING_CONTRACT_PROJECT = '控制台';
const REVIEW_ROUTING_CONTRACT_APPROVAL_REL = 'projects/控制台/config/review-routing-contract-approval.json';
const REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL = 'board/control-plane/approvals.md';
const CONTROL_PLANE_APPROVAL_SCHEMA = 'control-plane-approval@1';

function loadFlow(file) { return parse(fs.readFileSync(file, 'utf8')); }

function guardMs(value, fallbackSec) {
  const raw = value != null ? value : fallbackSec;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

function isPeekabooSoftFailure(flow, node, ctx, reason) {
  if (!node || node.agent_role !== 'gui_desktop_control') return false;
  if (node.soft_fail === false) return false;
  const acceptance = flow && flow.acceptance || {};
  const text = [node.id, ctx && ctx.goal, ctx && ctx.acceptance, reason]
    .filter(Boolean).join('\n').toLowerCase();
  const visual = acceptance.visual_artifacts_need_screenshot || /截图|截屏|视觉|screenshot|peekaboo/.test(text);
  const secondaryGate = node.soft_fail === true || flow.id === 'review-loop' || ctx.visualSoftGate || ctx.screenshotSoftGate;
  return !!visual && !!secondaryGate;
}

function reviewLoopDeliveryRequired(ctx) {
  return DoneGate.deliveryEvidenceRequiredFromText(ctx && ctx.goal, ctx && ctx.acceptance);
}

function reviewCritique(review) {
  if (!review || typeof review !== 'object') return '';
  if (review.critique != null) {
    const explicit = Array.isArray(review.critique) ? review.critique : [review.critique];
    return explicit.map(value => String(value == null ? '' : value).trim()).filter(Boolean).join('; ').slice(0, 6000);
  }
  const values = [
    review.notes,
    review.feedback,
    review.evaluation && review.evaluation.gaps,
    review.evaluation && review.evaluation.improvement_points,
  ];
  const parts = [];
  const add = value => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach(add);
    const text = String(value).trim();
    if (text && !parts.includes(text)) parts.push(text);
  };
  values.forEach(add);
  return parts.join('; ').slice(0, 6000);
}

function appendReviewHistory(ctx, detail) {
  const history = Array.isArray(ctx.review_loop_history) ? ctx.review_loop_history.slice() : [];
  history.push(detail);
  ctx.review_loop_history = history;
  return history;
}

function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function validRfc3339(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    && Number.isFinite(Date.parse(text));
}

function readTrustedControlPlaneApproval(workspaceRoot, recordId) {
  const id = String(recordId || '').trim();
  if (!id) return null;
  const file = path.resolve(workspaceRoot, REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const records = [];
    const marker = /<!--\s*control-plane-approval@1\s+(\{[^\r\n]*\})\s*-->/g;
    let match;
    while ((match = marker.exec(raw))) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.recordId === id) {
          records.push(parsed);
        }
      } catch (_) {}
    }
    return records.length === 1 ? records[0] : null;
  } catch (_) {
    return null;
  }
}

function reviewRoutingContractActivation(opts = {}, ctx = {}) {
  const explicitlyConfigured = Object.prototype.hasOwnProperty.call(opts, 'reviewRoutingContractEnabled');
  const featureFlag = explicitlyConfigured
    ? opts.reviewRoutingContractEnabled === true
    : process.env[REVIEW_ROUTING_CONTRACT_ENV] === '1';
  if (!featureFlag) {
    return { enabled: false, featureFlag: false, ownerApproved: false, reason: 'feature_flag_disabled' };
  }
  if (String(ctx.projectId || ctx.project_id || '') !== REVIEW_ROUTING_CONTRACT_PROJECT) {
    return { enabled: false, featureFlag: true, ownerApproved: false, reason: 'project_scope_mismatch' };
  }
  const workspaceRoot = path.resolve(opts.workspaceRoot || process.cwd());
  const approvalFile = path.resolve(workspaceRoot, REVIEW_ROUTING_CONTRACT_APPROVAL_REL);
  const approval = readJsonObject(approvalFile);
  const trustedApproval = approval
    && approval.approvalSource === REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL
    ? readTrustedControlPlaneApproval(workspaceRoot, approval.approvalRecordId)
    : null;
  const ownerApproved = Boolean(
    approval
    && approval.schema === REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA
    && approval.feature === REVIEW_ROUTING_CONTRACT_FEATURE
    && approval.status === 'approved'
    && approval.ownerApproved === true
    && approval.approvedBy === '主人'
    && approval.taskId === REVIEW_ROUTING_CONTRACT_APPROVAL_TASK
    && Array.isArray(approval.approvedScope)
    && approval.approvedScope.includes(REVIEW_ROUTING_CONTRACT_FEATURE)
    && validRfc3339(approval.approvedAt)
    && typeof approval.rollbackPlan === 'string'
    && approval.rollbackPlan.trim().length > 0
    && trustedApproval
    && trustedApproval.schema === CONTROL_PLANE_APPROVAL_SCHEMA
    && trustedApproval.recordId === approval.approvalRecordId
    && trustedApproval.decision === 'approved'
    && trustedApproval.approvedBy === '主人'
    && trustedApproval.projectId === REVIEW_ROUTING_CONTRACT_PROJECT
    && trustedApproval.taskId === REVIEW_ROUTING_CONTRACT_APPROVAL_TASK
    && trustedApproval.feature === REVIEW_ROUTING_CONTRACT_FEATURE
    && Array.isArray(trustedApproval.approvedScope)
    && trustedApproval.approvedScope.includes(REVIEW_ROUTING_CONTRACT_FEATURE)
    && trustedApproval.approvedAt === approval.approvedAt
    && trustedApproval.rollbackPlan === approval.rollbackPlan
  );
  return {
    enabled: ownerApproved,
    featureFlag: true,
    ownerApproved,
    reason: ownerApproved ? null : 'owner_approval_required',
    approvalSource: ownerApproved ? REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL : REVIEW_ROUTING_CONTRACT_APPROVAL_REL,
    approvalRecordId: ownerApproved ? approval.approvalRecordId : null,
  };
}

function taskViewForDoneGate(t, flow, ctx, visits) {
  return Object.assign({}, t, {
    flow: flow && flow.id || t.flow,
    state: 'done',
    vars: ctx || {},
    visits: Object.assign({}, visits || t.visits || {}),
    evidence: Array.isArray(t.evidence) ? t.evidence : [],
  });
}

function runSyncHooks(hooks, eventType, context, eventlog) {
  if (!hooks || typeof hooks.runSync !== 'function') return null;
  try {
    return hooks.runSync(eventType, context);
  } catch (e) {
    const reason = e && e.message || String(e);
    try {
      eventlog.emit('hook.registry_failed', {
        eventType,
        reason,
        projectId: context && context.projectId || null,
      });
    } catch (_) {}
    return { ok: false, eventType, results: [{ ok: false, reason }] };
  }
}

function runFlow(opts) {
  const { flow, runner, humanGate, eventlog, taskstore, taskId } = opts;
  const guards = flow.guards || {};
  const maxLoops = guards.max_loops != null ? guards.max_loops : 99;
  const wallMs = guardMs(guards.wall_timeout_sec, 1800);
  const wallProgressGraceMs = guardMs(
    guards.wall_timeout_progress_grace_sec != null
      ? guards.wall_timeout_progress_grace_sec
      : guards.wall_progress_grace_sec,
    Math.min(wallMs || 1800 * 1000, 15 * 60 * 1000) / 1000,
  );
  const wallAbsoluteMs = guardMs(guards.wall_timeout_absolute_sec, 0);
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const nodesById = {}; for (const n of flow.nodes) nodesById[n.id] = n;
  const edgesFrom = {}; for (const e of flow.edges) (edgesFrom[e.from] = edgesFrom[e.from] || []).push(e);

  // 护栏②:跑前校验
  if (guards.validate_before_run) {
    const v = validateFlow(flow);
    if (!v.ok) { eventlog.emit('flow.invalid', { flow: flow.id, errors: v.errors }); return { ok: false, errors: v.errors }; }
  }

  const t = typeof taskstore.start === 'function'
    ? taskstore.start(taskId, flow.id, opts.vars || {})
    : taskstore.create(taskId, flow.id, opts.vars || {});
  const resumed = !!t._resumed;
  const existingTerminal = TERMINAL_STATES && TERMINAL_STATES.has && TERMINAL_STATES.has(t.state);
  const ctx = Object.assign({ loop: 0, max_loops: maxLoops }, opts.vars || {}, t.vars || {});
  const projectId = ctx.projectId || ctx.project_id || null;
  ctx.taskId = ctx.taskId || taskId;
  ProtocolGate.ensureTaskProtocol(ctx, { taskId, flow: flow.id, projectId });
  // Capture the owner override before any runner output is merged into ctx.
  // A model cannot self-authorize completion by returning this field later.
  const directOverrideInput = opts.manualCompletionOverride || ctx.manual_completion_override || null;
  const directOverrideSupplied = !!directOverrideInput;
  let directOverride = { ok: false, reason: '缺少人工覆盖回执' };
  if (directOverrideSupplied) {
    let verified = null;
    if (typeof opts.verifyManualCompletionOverride !== 'function') {
      verified = { ok: false, reason: '人工覆盖缺少最终消费点验证器' };
    } else {
      try {
        verified = opts.verifyManualCompletionOverride(directOverrideInput, {
          taskId,
          flowId: flow.id,
          projectId,
        });
      } catch (error) {
        verified = { ok: false, reason: String(error && error.message || error || '人工覆盖最终复核异常') };
      }
    }
    if (!verified || verified.ok !== true) {
      directOverride = {
        ok: false,
        reason: String(verified && verified.reason || '人工覆盖最终消费点复核失败').slice(0, 500),
      };
    } else {
      directOverride = DoneGate.validateDirectCompletionOverride(
        verified.override,
        taskId,
        { finalConsumerVerified: true },
      );
    }
  }
  const visits = Object.assign({}, t.visits || {});
  const t0 = nowMs();
  let lastWallProgressAt = t0;
  let lastWallProgressEvent = resumed ? 'task.resumed' : 'task.created';
  function markWallProgress(type) {
    lastWallProgressAt = nowMs();
    lastWallProgressEvent = type || 'progress';
  }
  let directCompletionObserved = false;
  function checkDirectCompletion(phase, edge = null) {
    const gate = DoneGate.selfReportedIncomplete(ctx, {
      conflictMode: opts.directCompletionConflictMode || 'shadow',
    });
    if (gate.conflicts.length && !directCompletionObserved) {
      eventlog.emit('done_gate.direct_schema_conflict', {
        task: taskId,
        flow: flow.id,
        phase,
        edge,
        mode: gate.conflict_mode,
        blocked: gate.conflict_blocked,
        conflicts: gate.conflicts.slice(0, 20),
        signals: gate.signals,
        projectId,
      });
    }
    directCompletionObserved = true;
    if (!gate.incomplete) {
      taskstore.update(t, {
        done_gate: {
          ok: true,
          direct_completion: {
            conflict_mode: gate.conflict_mode,
            conflicts: gate.conflicts,
            signals: gate.signals,
          },
        },
        vars: ctx,
        visits,
      });
      return { ok: true, gate };
    }
    if (directOverride.ok) {
      eventlog.emit('done_gate.direct_manual_override', {
        task: taskId,
        flow: flow.id,
        phase,
        edge,
        reason: gate.reason,
        override: directOverride.receipt,
        projectId,
      });
      taskstore.update(t, {
        done_gate: {
          ok: true,
          overridden: true,
          reason: gate.reason,
          manual_override: directOverride.receipt,
          direct_completion: gate,
        },
        vars: ctx,
        visits,
      });
      return { ok: true, gate, overridden: true };
    }
    const lateOverrideSupplied = !!ctx.manual_completion_override
      && ctx.manual_completion_override !== directOverrideInput;
    if (directOverrideSupplied || lateOverrideSupplied) {
      eventlog.emit('done_gate.direct_manual_override_rejected', {
        task: taskId,
        flow: flow.id,
        phase,
        edge,
        reason: lateOverrideSupplied
          ? 'runner 输出不得后加或替换 owner override'
          : directOverride.reason,
        projectId,
      });
    }
    eventlog.emit('done_gate.self_report_incomplete', {
      task: taskId,
      flow: flow.id,
      phase,
      edge,
      reason: gate.reason,
      negatives: gate.negatives.slice(0, 20),
      projectId,
    });
    taskstore.update(t, { done_gate: { ok: false, reason: gate.reason, direct_completion: gate }, vars: ctx, visits });
    return { ok: false, gate };
  }
  function wallTimeoutInfo(nodeId) {
    if (!wallMs) return null;
    const now = nowMs();
    const wallAgeMs = now - t0;
    if (wallAbsoluteMs && wallAgeMs > wallAbsoluteMs) {
      return {
        timeout: true,
        reason: 'wall_timeout_absolute',
        node: nodeId,
        wallAgeMs,
        progressAgeMs: now - lastWallProgressAt,
        progressAt: new Date(lastWallProgressAt).toISOString(),
        progressEvent: lastWallProgressEvent,
      };
    }
    if (wallAgeMs <= wallMs) return null;
    const progressAgeMs = now - lastWallProgressAt;
    if (wallProgressGraceMs && progressAgeMs <= wallProgressGraceMs) {
      return {
        timeout: false,
        deferred: true,
        reason: 'recent_progress',
        node: nodeId,
        wallAgeMs,
        progressAgeMs,
        progressAt: new Date(lastWallProgressAt).toISOString(),
        progressEvent: lastWallProgressEvent,
      };
    }
    return {
      timeout: true,
      reason: 'wall_no_progress',
      node: nodeId,
      wallAgeMs,
      progressAgeMs,
      progressAt: new Date(lastWallProgressAt).toISOString(),
      progressEvent: lastWallProgressEvent,
    };
  }
  let current = t.cursor || (flow.nodes[0] || {}).id;
  if (existingTerminal) {
    eventlog.emit('task.resume_terminal', { task: taskId, flow: flow.id, state: t.state, projectId });
    return { ok: t.state === 'done', reason: t.state === 'done' ? null : t.state, task: t, ctx, resumed: true };
  }
  taskstore.setState(t, 'running');
  eventlog.emit(resumed ? 'task.resumed' : 'task.created', {
    task: taskId,
    flow: flow.id,
    start: current,
    projectId,
    cursor: current,
    lastCompletedNode: t.last_completed_node || null,
  });
  if (flow.id === 'review-loop' && opts.loopEngineering && typeof opts.loopEngineering.init === 'function') {
    opts.loopEngineering.init(ctx, { taskId, flow: flow.id, eventlog, projectId });
    taskstore.update(t, { vars: ctx, visits });
  }

  while (current) {
    const timeout = wallTimeoutInfo(current);
    if (timeout && timeout.deferred) {
      eventlog.emit('task.timeout.deferred', {
        task: taskId,
        node: current,
        reason: timeout.reason,
        wallAgeMs: timeout.wallAgeMs,
        progressAgeMs: timeout.progressAgeMs,
        progressAt: timeout.progressAt,
        progressEvent: timeout.progressEvent,
        projectId,
      });
    } else if (timeout && timeout.timeout) {                           // 护栏①:墙钟超时(进展感知)
      eventlog.emit('task.timeout', {
        task: taskId,
        node: current,
        reason: timeout.reason,
        wallAgeMs: timeout.wallAgeMs,
        progressAgeMs: timeout.progressAgeMs,
        progressAt: timeout.progressAt,
        progressEvent: timeout.progressEvent,
        projectId,
      });
      taskstore.update(t, {
        node: current,
        cursor: current,
        timeout_reason: 'wall_timeout',
        timeout_detail: timeout.reason,
        timeout_wall_age_ms: timeout.wallAgeMs,
        timeout_progress_age_ms: timeout.progressAgeMs,
        timeout_progress_at: timeout.progressAt,
        timeout_progress_event: timeout.progressEvent,
      });
      taskstore.setState(t, 'paused');
      return { ok: false, reason: 'wall_timeout', task: t };
    }
    const node = nodesById[current];
    taskstore.update(t, { node: current, cursor: current, vars: ctx, visits });

    // 终点
    if (node.type === 'end') {
      if (flow.acceptance && flow.acceptance.require_evidence && t.evidence.length === 0) {
        eventlog.emit('task.needs_evidence', { task: taskId, projectId });        // §10 验收证据门
        taskstore.setState(t, 'awaiting_verify');
        return { ok: false, reason: 'needs_evidence', task: t };
      }
      // agent-once 自报未完成门(防假完成,延续 P0-A):runner 永远写 result.md 当 evidence,
      // 所以 require_evidence 对 agent-once 形同虚设。模型显式自报 done=false/blocked 时必须打回。
      if (flow.id !== 'review-loop') {
        const directGate = checkDirectCompletion('end_node');
        if (!directGate.ok) {
          taskstore.setState(t, 'failed');
          return { ok: false, reason: `self_report_incomplete: ${directGate.gate.reason}`, task: t };
        }
      }
      let trueDoneGate = null;
      let trueDoneTask = taskViewForDoneGate(t, flow, ctx, visits);
      if (flow.id === 'review-loop') {
        const gate = DoneGate.validateReviewLoopCompletion(trueDoneTask, {
          workspaceRoot: opts.workspaceRoot || process.cwd(),
          requireDeliveryEvidence: reviewLoopDeliveryRequired(ctx),
          executeEvidence: DoneGate.executeEvidenceEnabledFromEnv(), // P0-A:生产开关注入时真跑证据命令
          gitVerify: DoneGate.executeEvidenceEnabledFromEnv(),
          runnersConfig: opts.runnersConfig || null, // 拍板⑤:特权写路径审计的允许区声明来源
        });
        trueDoneGate = gate;
        if (!gate.ok) {
          eventlog.emit('done_gate.blocked', {
            task: taskId,
            flow: flow.id,
            reason: gate.reason,
            projectId,
          });
          taskstore.update(t, { done_gate: { ok: false, reason: gate.reason }, vars: ctx, visits });
          taskstore.setState(t, 'failed');
          return { ok: false, reason: `done_gate_failed: ${gate.reason}`, task: t };
        }
        // 拍板⑤告警模式:特权 runner 写到允许区外 → 发事件 + 回执(done_gate.write_audit)附告警,不打回
        if (gate.write_audit && Array.isArray(gate.write_audit.outside) && gate.write_audit.outside.length) {
          eventlog.emit('privileged.write.outside', {
            task: taskId,
            flow: flow.id,
            runner: gate.write_audit.runner || null,
            files: gate.write_audit.outside.slice(0, 50),
            mode: gate.write_audit.mode || null,
            projectId,
          });
        }
        taskstore.update(t, {
          done_gate: gate.write_audit ? { ok: true, write_audit: gate.write_audit } : { ok: true },
          vars: ctx,
          visits,
        });
        trueDoneTask = taskViewForDoneGate(t, flow, ctx, visits);
      }
      const completionEventId = `${taskId}:${flow.id}:true_done`;
      const hookResult = flow.id === 'review-loop' ? runSyncHooks(opts.hooks, 'task.true_done', {
        taskId,
        task: trueDoneTask,
        flow: flow.id,
        ctx,
        projectId,
        gate: trueDoneGate,
        trueCompletionVerdict: {
          ok: true,
          source: 'engine.done_gate',
          reason: null,
          taskId,
          flow: flow.id,
          projectId,
          completionEventId,
        },
        completionEventId,
        workspaceRoot: opts.workspaceRoot || process.cwd(),
        eventlog,
      }, eventlog) : null;
      if (hookResult) {
        eventlog.emit('hook.summary', {
          task: taskId,
          eventType: 'task.true_done',
          ok: !!hookResult.ok,
          hooks: (hookResult.results || []).map(result => ({
            id: result.id || null,
            ok: result.ok !== false,
            observedOk: result.observedOk !== false,
            skipped: !!result.skipped,
            mode: result.mode || 'active',
            shadow: !!result.shadow,
            reason: result.reason || null,
          })),
          projectId,
        });
        if (hookResult.ok === false) {
          const failed = (hookResult.results || []).find(result => result && result.ok === false && result.failureMode === 'block')
            || (hookResult.results || []).find(result => result && result.ok === false)
            || {};
          const reason = failed.reason || 'task.true_done hook blocked completion';
          eventlog.emit('hook.blocked', {
            task: taskId,
            eventType: 'task.true_done',
            hookId: failed.id || null,
            reason,
            projectId,
          });
          taskstore.update(t, {
            hook_gate: {
              ok: false,
              eventType: 'task.true_done',
              hookId: failed.id || null,
              reason,
              results: hookResult.results || [],
            },
            vars: ctx,
            visits,
          });
          taskstore.setState(t, 'failed');
          return { ok: false, reason: `hook_gate_failed: ${reason}`, task: t };
        }
        taskstore.update(t, {
          hook_gate: {
            ok: true,
            eventType: 'task.true_done',
            results: hookResult.results || [],
          },
          vars: ctx,
          visits,
        });
      }
      eventlog.emit('task.done', { task: taskId, loop: ctx.loop, evidence: t.evidence.length, projectId });
      taskstore.update(t, { loop: ctx.loop, cursor: null, vars: ctx, visits }); taskstore.setState(t, 'done');
      return { ok: true, task: t, ctx };
    }

    // human gate 一等节点(§18.2)
    if (node.type === 'human_gate') {
      const res = humanGate ? humanGate(node, ctx) : null;
      if (!res) {
      eventlog.emit('node.await_human', { task: taskId, node: current, projectId });
        taskstore.setState(t, 'awaiting_human');
        return { ok: false, reason: 'awaiting_human', node: current, task: t };
      }
      Object.assign(ctx, res);
      eventlog.emit('node.human', { task: taskId, node: current, decision: (res.human || {}).decision, projectId });
      markWallProgress('node.human');
    } else {
      if (typeof opts.checkpoint === 'function') {
        const cp = opts.checkpoint({ phase: 'before_node', node, ctx, task: t });
        if (cp && cp.cancel) {
          eventlog.emit('task.canceled', { task: taskId, node: current, reason: cp.reason || 'queue canceled', projectId });
          taskstore.setState(t, 'canceled');
          return { ok: false, canceled: true, reason: cp.reason || 'canceled', node: current, task: t };
        }
      }
      // agent 节点:attempt + 访问计数(loop = 本节点进入次数)
      let stepKey = null;
      let replay = null;
      if (t.completed_pending_edge && t.cursor === current && typeof taskstore.step === 'function') {
        const pending = taskstore.step(t, t.completed_pending_edge);
        if (pending && pending.status === 'done' && pending.node === current) {
          stepKey = t.completed_pending_edge;
          const m = String(stepKey).match(/#(\d+)$/);
          visits[current] = m ? Number(m[1]) : (visits[current] || 1);
          replay = pending;
        }
      }
      if (!stepKey) {
        visits[current] = (visits[current] || 0) + 1;
        stepKey = `${current}#${visits[current]}`;
        replay = typeof taskstore.step === 'function' ? taskstore.step(t, stepKey) : null;
      }
      ctx.loop = visits[current];
      if (replay && replay.status === 'done') {
        if (replay.vars) Object.assign(ctx, replay.vars);
        eventlog.emit('node.replay', {
          task: taskId,
          node: current,
          step: stepKey,
          attempt: replay.attempt || null,
          role: node.agent_role || null,
          projectId,
        });
        taskstore.update(t, { vars: ctx, visits });
        markWallProgress('node.replay');
      } else {
        const attempt = t.attempt + 1;
        taskstore.update(t, { attempt, visits, vars: ctx });
        eventlog.emit('node.start', { task: taskId, node: current, attempt, role: node.agent_role || null, projectId });
        let out;
        try { out = runner(node, ctx, attempt) || {}; }
        catch (e) { out = { fail: e.message }; }
        if (out.vars) Object.assign(ctx, out.vars);
        if (out.evidence) t.evidence.push(out.evidence);
        taskstore.update(t, { evidence: t.evidence, vars: ctx, visits });
        if (!out.fail && flow.id === 'review-loop' && node.id === 'implement') {
          const gate = DoneGate.validateImplementationLogicChain(ctx, {
            workspaceRoot: opts.workspaceRoot || process.cwd(),
          });
          if (!gate.ok) {
            out = Object.assign({}, out, { fail: `done_gate.logic_chain: ${gate.reason}` });
            eventlog.emit('done_gate.logic_chain_missing', {
              task: taskId,
              node: current,
              attempt,
              reason: gate.reason,
              projectId,
            });
          }
        }
        if (!out.fail && flow.id === 'review-loop' && node.id === 'review') {
          const activation = reviewRoutingContractActivation(opts, ctx);
          if (!activation.enabled) {
            eventlog.emit('review.contract.inactive', {
              task: taskId,
              node: current,
              attempt,
              reason: activation.reason,
              featureFlag: activation.featureFlag,
              ownerApproved: activation.ownerApproved,
              projectId,
            });
            const legacyGate = DoneGate.validateReviewHardEvidence(ctx, {
              workspaceRoot: opts.workspaceRoot || process.cwd(),
            });
            if (!legacyGate.ok) {
              out = Object.assign({}, out, { fail: `done_gate.review_verification: ${legacyGate.reason}` });
              eventlog.emit('done_gate.review_invalid', {
                task: taskId,
                node: current,
                attempt,
                reason: legacyGate.reason,
                projectId,
              });
            } else if (ctx.review && typeof ctx.review === 'object') {
              // The flow edges now consume review.routing. While the new contract is
              // inactive, preserve the legacy pass→edge mapping plus the existing
              // finite-loop safety upgrade. Default-off deployments stay reachable
              // without enabling warning/manual/history behavior from the gated contract.
              ctx.review.routing = ctx.review.pass === true
                ? 'approve'
                : (ctx.loop >= ctx.max_loops ? 'loop_limit' : 'rework');
              if (ctx.review.routing === 'loop_limit') {
                eventlog.emit('done_gate.review_loop_limit', {
                  task: taskId,
                  node: current,
                  attempt,
                  loop: ctx.loop,
                  maxLoops: ctx.max_loops,
                  critique: reviewCritique(ctx.review) || null,
                  contractActive: false,
                  projectId,
                });
              }
            }
          } else {
          const gate = DoneGate.validateReviewRoutingContract(ctx, {
            workspaceRoot: opts.workspaceRoot || process.cwd(),
          });
          const critique = reviewCritique(ctx.review);
          let route = gate.route;
          if (route === 'rework' && ctx.loop >= ctx.max_loops) route = 'loop_limit';
          if (ctx.review && typeof ctx.review === 'object') ctx.review.routing = route;
          if (critique && route !== 'approve') ctx.review_critique = critique;
          const history = appendReviewHistory(ctx, {
            taskId,
            loop: ctx.loop,
            attempt,
            pass: !!(ctx.review && ctx.review.pass),
            verdict: gate.verification && gate.verification.verdict || null,
            lifecycle: gate.lifecycle && gate.lifecycle.status || null,
            routing: route,
            critique: critique || null,
            warnings: (gate.warnings || []).map(warning => warning.reason),
          });
          taskstore.update(t, {
            review_contract: {
              ok: gate.ok,
              route,
              reason: gate.reason || null,
              loop: ctx.loop,
              warnings: gate.warnings || [],
            },
            review_loop_history: history,
            vars: ctx,
            visits,
          });
          eventlog.emit('review.contract', {
            task: taskId,
            node: current,
            attempt,
            loop: ctx.loop,
            pass: !!(ctx.review && ctx.review.pass),
            route,
            critique: critique || null,
            warningCount: (gate.warnings || []).length,
            projectId,
          });
          for (const warning of gate.warnings || []) {
            eventlog.emit('done_gate.review_alignment_warning', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              reason: warning.reason,
              category: warning.category || null,
              misalignedRequiredRows: warning.misaligned_required_rows || [],
              critique: critique || null,
              projectId,
            });
          }
          if (!gate.ok && route === 'hard_block') {
            eventlog.emit('done_gate.review_hard_block', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              reason: gate.reason,
              projectId,
            });
            taskstore.setState(t, 'paused');
            return { ok: false, reason: 'review_hard_block', hard_block: true, node: current, task: t, ctx };
          }
          if (route === 'hold') {
            eventlog.emit('done_gate.review_lifecycle_hold', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              reason: gate.reason,
              projectId,
            });
            taskstore.setState(t, 'awaiting_human');
            return { ok: false, reason: 'review_lifecycle_hold', node: current, task: t, ctx };
          }
          if (route === 'manual_review') {
            eventlog.emit('done_gate.review_manual_required', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              reason: gate.reason,
              projectId,
            });
          }
          if (route === 'loop_limit') {
            eventlog.emit('done_gate.review_loop_limit', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              maxLoops: ctx.max_loops,
              critique: critique || null,
              projectId,
            });
          }
          }
        }
        let reviewLoopResult = null;
        if (!out.fail && flow.id === 'review-loop' && node.id === 'review' && opts.loopEngineering && typeof opts.loopEngineering.afterReview === 'function') {
          reviewLoopResult = opts.loopEngineering.afterReview(ctx, {
            taskId,
            flow: flow.id,
            eventlog,
            projectId,
            loop: ctx.loop,
            attempt,
          });
          if (reviewLoopResult && reviewLoopResult.round) {
            t.evidence.push({
              type: 'loop_engineering_round',
              round: reviewLoopResult.round.round,
              score: reviewLoopResult.round.score,
              decision: reviewLoopResult.decision,
            });
            taskstore.update(t, { evidence: t.evidence, vars: ctx, visits });
          }
        }
        if (!out.fail && flow.id === 'review-loop' && node.id === 'review' && reviewLoopResult) {
          let adjustedRoute = null;
          if (reviewLoopResult.decision === 'iterate') adjustedRoute = 'rework';
          if (reviewLoopResult.decision === 'blocked_stop') adjustedRoute = 'loop_limit';
          const contractRoute = ctx.review && ctx.review.routing;
          const routeCanBeAdjusted = contractRoute === 'approve' || contractRoute === 'rework';
          // Contract-level safety routes are authoritative. In particular, an
          // evidence/verdict conflict must stay on the human path even when loop
          // engineering would otherwise request another implementation round.
          if (adjustedRoute && routeCanBeAdjusted && contractRoute !== adjustedRoute) {
            const previousRoute = ctx.review.routing || null;
            ctx.review.routing = adjustedRoute;
            const history = Array.isArray(ctx.review_loop_history) ? ctx.review_loop_history : [];
            const latest = history[history.length - 1];
            if (latest && latest.taskId === taskId && latest.loop === ctx.loop) {
              latest.routing = adjustedRoute;
              latest.pass = ctx.review.pass === true;
              latest.loop_engineering_decision = reviewLoopResult.decision;
            }
            taskstore.update(t, {
              review_contract: Object.assign({}, t.review_contract || {}, {
                route: adjustedRoute,
                loop_engineering_decision: reviewLoopResult.decision,
              }),
              review_loop_history: history,
              vars: ctx,
              visits,
            });
            eventlog.emit('review.contract.adjusted', {
              task: taskId,
              node: current,
              attempt,
              loop: ctx.loop,
              from: previousRoute,
              to: adjustedRoute,
              reason: `loop_engineering.${reviewLoopResult.decision}`,
              projectId,
            });
          }
        }
        // runner.quality:review 节点收尾 emit 质量分,作 role×runner 质量回写路由的地基(洞察#2/#4)。
        // 纯观测事件,不改决策;role 维度(engine 侧无 runnerType),runner 由消费端 role-performance-report 补。
        if (!out.fail && flow.id === 'review-loop' && node.id === 'review' && process.env.YUTU6_RUNNER_EVENTS !== '0') {
          try {
            const rv = ctx.review || {};
            const roundScore = reviewLoopResult && reviewLoopResult.round && typeof reviewLoopResult.round.score === 'number'
              ? reviewLoopResult.round.score : null;
            eventlog.emit('runner.quality', {
              task: taskId, node: current, role: node.agent_role || null, attempt, loop: ctx.loop,
              pass: rv.pass === true,
              score: roundScore != null ? roundScore : (typeof rv.score === 'number' ? rv.score : null),
              decision: (reviewLoopResult && reviewLoopResult.decision) || null,
              projectId,
            });
          } catch (_) {}
        }
        if (out.fail && isPeekabooSoftFailure(flow, node, ctx, out.fail)) {
        ctx.screenshot_pending = true;
        ctx.visual_evidence_status = 'screenshot_pending';
        const evidence = {
          type: 'visual_soft_skip',
          runner: 'peekaboo',
          screenshot_pending: true,
          reason: String(out.fail).slice(0, 1000),
          node: current,
        };
        t.evidence.push(evidence);
        taskstore.update(t, { evidence: t.evidence, vars: ctx, visits });
        eventlog.emit('peekaboo.soft_skip', {
          task: taskId,
          node: current,
          attempt,
          role: node.agent_role || null,
          reason: evidence.reason,
          screenshot_pending: true,
          projectId,
        });
        eventlog.emit('node.end', { task: taskId, node: current, attempt, loop: ctx.loop, soft: true, screenshot_pending: true, projectId });
        markWallProgress('node.end');
          if (typeof taskstore.recordStep === 'function') {
            taskstore.recordStep(t, stepKey, node, {
              attempt,
              vars: { screenshot_pending: true, visual_evidence_status: 'screenshot_pending' },
              evidence,
            });
            taskstore.update(t, { completed_pending_edge: stepKey, vars: ctx, visits });
          }
        } else if (out.fail) {
        eventlog.emit('node.fail', { task: taskId, node: current, attempt, reason: out.fail, projectId });
        taskstore.setState(t, 'failed');
        return { ok: false, reason: 'node_failed', node: current, task: t };
        } else {
        eventlog.emit('node.end', { task: taskId, node: current, attempt, loop: ctx.loop, projectId });
        markWallProgress('node.end');
          if (typeof taskstore.recordStep === 'function') {
            taskstore.recordStep(t, stepKey, node, {
              attempt,
              vars: out.vars || {},
              evidence: out.evidence || null,
            });
            taskstore.update(t, { completed_pending_edge: stepKey, vars: ctx, visits });
          }
        }
      }
    }

    // 选下一节点:按顺序取第一条 when 为真的边(无 when = 默认边)
    let next = null;
    for (const e of edgesFrom[current] || []) {
      if (compileWhen(e.when)(ctx)) { next = e.to; break; }
    }
    if (!next) {                                                       // 无边匹配 → 交回 LLM planner(§18.1)
      eventlog.emit('node.no_edge', { task: taskId, node: current, on_no_edge: flow.on_no_edge || null, projectId });
      taskstore.setState(t, 'paused');
      return { ok: false, reason: 'no_edge', node: current, on_no_edge: flow.on_no_edge || 'planner', task: t };
    }
    if (flow.id !== 'review-loop' && nodesById[next] && nodesById[next].type === 'end') {
      const directGate = checkDirectCompletion('before_terminal_edge', { from: current, to: next });
      if (!directGate.ok) {
        taskstore.setState(t, 'failed');
        return {
          ok: false,
          reason: `self_report_incomplete: ${directGate.gate.reason}`,
          node: current,
          task: t,
        };
      }
    }
    eventlog.emit('edge.take', { task: taskId, from: current, to: next, projectId });
    markWallProgress('edge.take');
    taskstore.update(t, { cursor: next, completed_pending_edge: null, vars: ctx, visits });
    current = next;
  }
  return { ok: false, reason: 'no_start', task: t };
}

module.exports = {
  REVIEW_ROUTING_CONTRACT_FEATURE,
  REVIEW_ROUTING_CONTRACT_ENV,
  REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA,
  REVIEW_ROUTING_CONTRACT_APPROVAL_TASK,
  REVIEW_ROUTING_CONTRACT_APPROVAL_REL,
  REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL,
  CONTROL_PLANE_APPROVAL_SCHEMA,
  reviewRoutingContractActivation,
  loadFlow,
  runFlow,
};
