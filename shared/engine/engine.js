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
const { parse } = require('./yaml-lite');
const { validateFlow } = require('./validate');
const { compileWhen } = require('./condition');
const { TERMINAL_STATES } = require('./taskstore');
const DoneGate = require('./done-gate');
const ProtocolGate = require('./protocol-gate');

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
  const visits = Object.assign({}, t.visits || {});
  const t0 = nowMs();
  let lastWallProgressAt = t0;
  let lastWallProgressEvent = resumed ? 'task.resumed' : 'task.created';
  function markWallProgress(type) {
    lastWallProgressAt = nowMs();
    lastWallProgressEvent = type || 'progress';
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
        const selfRep = DoneGate.selfReportedIncomplete(ctx);
        if (selfRep.incomplete) {
          eventlog.emit('done_gate.self_report_incomplete', {
            task: taskId,
            flow: flow.id,
            reason: selfRep.reason,
            projectId,
          });
          taskstore.update(t, { done_gate: { ok: false, reason: selfRep.reason }, vars: ctx, visits });
          taskstore.setState(t, 'failed');
          return { ok: false, reason: `self_report_incomplete: ${selfRep.reason}`, task: t };
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
            skipped: !!result.skipped,
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
          const gate = DoneGate.validateReviewHardEvidence(ctx, {
            workspaceRoot: opts.workspaceRoot || process.cwd(),
          });
          if (!gate.ok) {
            out = Object.assign({}, out, { fail: `done_gate.review_verification: ${gate.reason}` });
            eventlog.emit('done_gate.review_invalid', {
              task: taskId,
              node: current,
              attempt,
              reason: gate.reason,
              projectId,
            });
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
    eventlog.emit('edge.take', { task: taskId, from: current, to: next, projectId });
    markWallProgress('edge.take');
    taskstore.update(t, { cursor: next, completed_pending_edge: null, vars: ctx, visits });
    current = next;
  }
  return { ok: false, reason: 'no_start', task: t };
}

module.exports = { loadFlow, runFlow };
