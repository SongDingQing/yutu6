#!/usr/bin/env node
'use strict';
/*
 * 控制台后台引擎 worker。
 * server.js 只负责排队并保持 Web/API 响应; 真 CLI 编排在独立 Node 进程里同步执行,
 * 所有状态写入 artifacts/engine-events.jsonl, workspace.html 轮询这条日志点亮工位。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const WORKDIR = path.resolve(ROOT, '../..');
const CFG_PATH = process.env.CONSOLE_CONFIG_PATH
  ? path.resolve(process.env.CONSOLE_CONFIG_PATH)
  : path.join(ROOT, 'config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

const EventLog = require('../../shared/engine/eventlog');
const { TaskStore } = require('../../shared/engine/taskstore');
const { loadFlow, runFlow } = require('../../shared/engine/engine');
const { HookRegistry } = require('../../shared/engine/hook-registry');
const { makeCliRunner } = require('../../shared/engine/cli-runner');
const Handoff = require('../../shared/engine/handoff');
const DoneGate = require('../../shared/engine/done-gate');
const LoopEngineering = require('../../shared/engine/loop-engineering');
const { loadAgents } = require('../../shared/engine/agents');
const Q = require('../../shared/engine/queue');
const QueueAutoMerge = require('./queue-automerge');
const BoardReview = require('./board-review');
const { hasActiveStarlaidReference, isStarlaidProjectId, keywordProjectId } = require('./project-guard');
const RuntimePaths = require('./runtime-paths');
const VersionProgressHook = require('./version-progress-hook');
const HardeningHooks = require('./hardening-hooks');
const InsightScoutRepos = require('./insight-scout-repos');

const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const EVENTS = path.join(ARTIFACTS_ROOT, 'engine-events.jsonl');
const TASKS = path.join(ARTIFACTS_ROOT, 'engine-tasks');
const RUNS = path.join(ARTIFACTS_ROOT, 'engine-runs');
const QUEUE_ROOT = ARTIFACTS_ROOT;
const MEMORY_DECISIONS = process.env.CONSOLE_MEMORY_DECISIONS
  ? path.resolve(process.env.CONSOLE_MEMORY_DECISIONS)
  : path.join(WORKDIR, 'memory', 'decisions.md');
const PROJECTS_DIR = process.env.CONSOLE_PROJECTS_DIR
  ? path.resolve(process.env.CONSOLE_PROJECTS_DIR)
  : path.join(WORKDIR, 'projects');
const DEFAULT_NODE_TIMEOUT_SEC = 900;
const SUPERVISOR_REVIEW_NODE_TIMEOUT_SEC = 1800;
const ACTION_VERIFY_ENABLED = process.env.CONSOLE_ACTION_VERIFY !== '0';
const ACTION_VERIFY_HEAL_ENABLED = process.env.CONSOLE_ACTION_VERIFY_HEAL !== '0';
const ACTION_VERIFY_SCREENSHOT_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.CONSOLE_ACTION_VERIFY_SCREENSHOT_TIMEOUT_MS || '15000', 10) || 15000,
);
const TASKSTORE_RUNNING_STALE_MS = Math.max(
  0,
  parseInt(process.env.TASKSTORE_RUNNING_STALE_MS || String(2 * 60 * 60 * 1000), 10) || 0,
);
const QUEUE_PROGRESS_EVENT_TYPES = new Set([
  'edge.take',
  'project.route.waiting',
  'project.routed',
  'project.brief.written',
  'task.created',
]);

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function safeName(s) {
  return String(s || 'x').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'x';
}

function eventIndicatesQueueProgress(type) {
  return String(type || '').startsWith('node.') || QUEUE_PROGRESS_EVENT_TYPES.has(type);
}

function makeHookRegistry(eventlog) {
  const registry = new HookRegistry({ eventlog });
  HardeningHooks.registerHardeningHooks(registry, {
    workspaceRoot: WORKDIR,
  });
  LoopEngineering.registerLoopEngineeringHooks(registry);
  VersionProgressHook.registerVersionProgressHook(registry, {
    root: WORKDIR,
    workspaceRoot: WORKDIR,
  });
  return registry;
}

function touchQueueProgress(spec, type, data) {
  const agent = spec && spec.queueAgent;
  const id = spec && spec.queueId;
  if (!agent || !id || !eventIndicatesQueueProgress(type)) return;
  if (data && data.task && spec.taskId && data.task !== spec.taskId) return;
  const now = new Date().toISOString();
  try {
    Q.touchProgress(QUEUE_ROOT, agent, id, {
      progress_at: now,
      node_event_at: now,
      progress_event: String(type || '').slice(0, 80),
      progress_node: data && data.node ? String(data.node).slice(0, 120) : null,
      progress_task: data && data.task || spec.taskId || null,
    });
  } catch (_) {}
}

function createProgressEventLog(file, spec) {
  const eventlog = new EventLog(file);
  const emit = eventlog.emit.bind(eventlog);
  eventlog.emit = (type, data = {}) => {
    touchQueueProgress(spec, type, data);
    return emit(type, data);
  };
  return eventlog;
}

function rel(file) {
  if (!file) return null;
  const r = path.relative(WORKDIR, file).split(path.sep).join('/');
  return r && !r.startsWith('..') ? r : file;
}

function latestNodeResultMarkdown(taskId, nodeId = 'execute') {
  const root = path.join(RUNS, String(taskId || ''));
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith(`${nodeId}-`) && /^\d+$/.test(d.name.slice(nodeId.length + 1)))
      .map(d => d.name)
      .sort((a, b) => (Number(b.split('-').pop()) || 0) - (Number(a.split('-').pop()) || 0));
  } catch (_) {
    return null;
  }
  for (const dir of dirs) {
    const file = path.join(root, dir, 'result.md');
    const text = readText(file);
    if (text) return { file, text };
  }
  return null;
}

function sanitizeReason(s) {
  return String(s || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(NEW_API_TOKEN|API[_-]?KEY|TOKEN|SECRET)=([^\s]+)/gi, '$1=[redacted]')
    .replace(/(token|api[_-]?key|secret)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[redacted]')
    .slice(0, 1000);
}

function readEnvPairs(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch (_) {}
  return env;
}

function resolveConfigPath(baseDir, file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function buildRunnerEnv(runner) {
  const env = Object.assign({}, process.env);
  const envFile = resolveConfigPath(WORKDIR, runner && (runner.envFile || runner.tokenFile));
  const fileEnv = envFile ? readEnvPairs(envFile) : {};
  if (runner && runner.envFromFile && typeof runner.envFromFile === 'object') {
    for (const [targetKey, sourceKey] of Object.entries(runner.envFromFile)) {
      if (fileEnv[sourceKey] != null) env[targetKey] = fileEnv[sourceKey];
    }
  } else {
    Object.assign(env, fileEnv);
  }
  if (runner && runner.env && typeof runner.env === 'object') Object.assign(env, runner.env);
  return RuntimePaths.applyRuntimeEnv(env);
}

function fingerprintFile(file) {
  try {
    const bytes = fs.readFileSync(file);
    return {
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (e) {
    return { error: sanitizeReason(e.message) };
  }
}

function capturePeekabooScreenshot({ file, runner }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bin = process.env.CONSOLE_PEEKABOO_IMAGE_BIN || RuntimePaths.peekabooBin();
  const mode = process.env.CONSOLE_PEEKABOO_IMAGE_MODE || 'frontmost';
  const res = spawnSync(bin, ['image', '--mode', mode, '--path', file], {
    cwd: WORKDIR,
    env: buildRunnerEnv(runner || {}),
    encoding: 'utf8',
    timeout: ACTION_VERIFY_SCREENSHOT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error) return { ok: false, path: file, reason: sanitizeReason(res.error.message) };
  if (res.signal) return { ok: false, path: file, reason: sanitizeReason(`peekaboo image interrupted: ${res.signal}`) };
  if (res.status !== 0) {
    const detail = sanitizeReason((res.stderr || res.stdout || '').trim() || `exit ${res.status}`);
    return { ok: false, path: file, reason: `peekaboo image failed: ${detail}` };
  }
  const fp = fingerprintFile(file);
  if (fp.error) return { ok: false, path: file, reason: fp.error };
  if (!fp.bytes) return { ok: false, path: file, reason: 'peekaboo image produced empty screenshot' };
  return { ok: true, path: file, fingerprint: fp };
}

function screenshotRef(capture) {
  return capture && capture.path ? rel(capture.path) : null;
}

function actionKind(text) {
  const s = String(text || '').toLowerCase();
  if (/scroll|滚动|滑动/.test(s)) return 'scroll';
  if (/type|input|fill|输入|键入|填写/.test(s)) return 'input';
  if (/click|点击|点按|press|tap/.test(s)) return 'click';
  return 'gui_action';
}

function verdictFromScreenshots(before, after, out) {
  if (out && out.fail) {
    return { landed: false, method: 'runner_exit', reason: sanitizeReason(out.fail) };
  }
  if (!before || !before.ok) {
    return { landed: false, method: 'screenshot_before', reason: `before screenshot unavailable: ${sanitizeReason(before && before.reason || 'unknown')}` };
  }
  if (!after || !after.ok) {
    return { landed: false, method: 'screenshot_after', reason: `after screenshot unavailable: ${sanitizeReason(after && after.reason || 'unknown')}` };
  }
  const a = before.fingerprint || {};
  const b = after.fingerprint || {};
  if (a.sha256 && b.sha256 && a.sha256 !== b.sha256) {
    return { landed: true, method: 'sha256', reason: 'before/after screenshot content changed' };
  }
  if (a.bytes !== b.bytes) {
    return { landed: true, method: 'bytes', reason: 'before/after screenshot size changed' };
  }
  return { landed: false, method: 'sha256', reason: 'before/after screenshots are identical' };
}

function mergeVars(out, record) {
  return Object.assign({}, (out && out.vars) || {}, {
    computer_use_action_verify: record,
  });
}

function withVerifyEvidence(out, record) {
  return {
    vars: mergeVars(out, record),
    evidence: {
      type: 'computer_use_action_verify',
      traceId: record.traceId,
      node: record.node,
      action: record.action,
      landed: record.landed,
      reason: record.reason,
      beforeScreenshot: record.beforeScreenshot,
      afterScreenshot: record.afterScreenshot,
      correction: record.correction || null,
      result: out && out.evidence || null,
    },
  };
}

function healGoal(ctx, record) {
  return [
    String(ctx.goal || '').trim(),
    '',
    'computer-use 执行后截图核验判定上一动作未落地。',
    `未落地原因:${record.reason || 'unknown'}`,
    '请基于当前屏幕重新定位目标,只执行一步最小纠错:优先重定位/重试;如果目标不可见、需要登录/授权或超过能力边界,停止并明确上报原因。不要静默继续做后续步骤。',
  ].filter(Boolean).join('\n');
}

function emitActionEvent(eventlog, type, record, extra) {
  const payload = Object.assign({
    task: record.task,
    node: record.node,
    attempt: record.attempt,
    role: record.role,
    traceId: record.traceId,
    action: record.action,
    beforeScreenshot: record.beforeScreenshot,
    afterScreenshot: record.afterScreenshot,
    landed: record.landed,
    method: record.method,
    reason: record.reason,
    projectId: record.projectId || null,
  }, extra || {});
  eventlog.emit(type, payload);
}

function runVerifiedGuiAction(baseRunner, node, ctx, attempt, opts) {
  const traceId = `${opts.taskId}:${node.id}:${attempt}`;
  const verifyDir = path.join(opts.runsDir, 'action-verify', `${safeName(node.id)}-${safeName(attempt)}`);
  const runner = opts.config && opts.config.runners && opts.config.runners.peekaboo || {};
  const base = {
    task: opts.taskId,
    node: node.id,
    attempt,
    role: node.agent_role || null,
    traceId,
    action: actionKind([ctx.goal, ctx.acceptance, node.id].join('\n')),
    projectId: ctx.projectId || null,
  };

  const before = capturePeekabooScreenshot({ file: path.join(verifyDir, 'before.png'), runner });
  const firstOut = baseRunner(node, ctx, attempt) || {};
  const after = capturePeekabooScreenshot({ file: path.join(verifyDir, 'after.png'), runner });
  const verdict = verdictFromScreenshots(before, after, firstOut);
  const record = Object.assign({}, base, {
    beforeScreenshot: screenshotRef(before),
    afterScreenshot: screenshotRef(after),
    landed: verdict.landed,
    method: verdict.method,
    reason: verdict.reason,
    correction: null,
  });
  emitActionEvent(opts.eventlog, 'action.verify', record);
  if (verdict.landed) return Object.assign({}, firstOut, withVerifyEvidence(firstOut, record));

  if (!ACTION_VERIFY_HEAL_ENABLED) {
    record.correction = { type: 'report', attempted: false, reason: 'self-heal disabled' };
    emitActionEvent(opts.eventlog, 'action.heal', record, { correction: record.correction });
    return Object.assign({}, withVerifyEvidence(firstOut, record), {
      fail: `computer-use action did not land: ${record.reason}`,
    });
  }

  if (/screenshot_/.test(verdict.method)) {
    record.correction = {
      type: 'report',
      attempted: true,
      landed: false,
      reason: 'screenshot verification unavailable; manual authorization or Peekaboo health check required',
    };
    emitActionEvent(opts.eventlog, 'action.heal', record, { correction: record.correction });
    return Object.assign({}, withVerifyEvidence(firstOut, record), {
      fail: `computer-use action could not be verified: ${record.reason}`,
    });
  }

  const correction = {
    type: 'retry',
    attempted: true,
    reason: verdict.reason,
  };
  const healCtx = Object.assign({}, ctx, {
    goal: healGoal(ctx, record),
    previous_computer_use_action_verify: record,
  });
  const healOut = baseRunner(node, healCtx, `${attempt}-heal`) || {};
  const healedAfter = capturePeekabooScreenshot({ file: path.join(verifyDir, 'after-heal.png'), runner });
  const healVerdict = verdictFromScreenshots(after && after.ok ? after : before, healedAfter, healOut);
  correction.afterScreenshot = screenshotRef(healedAfter);
  correction.landed = healVerdict.landed;
  correction.method = healVerdict.method;
  correction.result = healOut.evidence || null;
  correction.fail = healOut.fail ? sanitizeReason(healOut.fail) : null;
  correction.finalReason = healVerdict.reason;
  record.correction = correction;
  record.landed = !!healVerdict.landed;
  record.reason = healVerdict.reason;
  emitActionEvent(opts.eventlog, 'action.heal', record, { correction });

  if (healVerdict.landed) return Object.assign({}, healOut, withVerifyEvidence(healOut, record));
  return Object.assign({}, withVerifyEvidence(healOut, record), {
    fail: `computer-use action did not land after self-heal: ${healVerdict.reason}`,
  });
}

function makeActionVerifyingRunner(baseRunner, opts) {
  function actionVerifyingRunner(node, ctx, attempt) {
    if (!ACTION_VERIFY_ENABLED || !node || node.agent_role !== 'gui_desktop_control') {
      return baseRunner(node, ctx, attempt);
    }
    return runVerifiedGuiAction(baseRunner, node, ctx, attempt, opts);
  }
  if (typeof baseRunner.runNodeAsync === 'function') {
    actionVerifyingRunner.runNodeAsync = async function runNodeAsync(node, ctx, attempt) {
      if (!ACTION_VERIFY_ENABLED || !node || node.agent_role !== 'gui_desktop_control') {
        return baseRunner.runNodeAsync(node, ctx, attempt);
      }
      return actionVerifyingRunner(node, ctx, attempt);
    };
  }
  return actionVerifyingRunner;
}

function explicitNodeTimeoutSec(spec) {
  const raw = spec && (spec.nodeTimeoutSec != null ? spec.nodeTimeoutSec : spec.timeoutSec);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function defaultNodeTimeoutSec(spec, flowId) {
  const explicit = explicitNodeTimeoutSec(spec);
  if (explicit) return explicit;
  if (flowId === 'review-loop' && /^supervisor-/.test(String(spec && spec.queueAgent || ''))) {
    return SUPERVISOR_REVIEW_NODE_TIMEOUT_SEC;
  }
  return DEFAULT_NODE_TIMEOUT_SEC;
}

function attachmentInputPaths(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map(a => a && a.path)
    .filter(Boolean);
}

function mergeInputs(inputs, attachments) {
  const out = Array.isArray(inputs) ? inputs.slice() : [];
  for (const p of attachmentInputPaths(attachments)) if (!out.includes(p)) out.push(p);
  return out;
}

function withAttachmentPrompt(goal, attachments) {
  const paths = attachmentInputPaths(attachments);
  if (!paths.length) return goal;
  return [
    String(goal || '').trim(),
    '',
    '图片附件(本地路径,Codex 可直接读取/分析;不要回显图片原始内容或 base64):',
    ...paths.map((p, i) => `${i + 1}. ${p}`),
  ].filter(Boolean).join('\n');
}

function loadSpec() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node engine-runner.js --spec <spec.json>');
    process.exit(0);
  }
  const idx = process.argv.indexOf('--spec');
  const file = idx >= 0 ? process.argv[idx + 1] : process.argv[2];
  if (!file || String(file).startsWith('-')) throw new Error('missing --spec <file>');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadAgentPrompts() {
  const out = {};
  const dir = path.join(WORKDIR, 'shared/agents');
  try {
    for (const agent of loadAgents(dir)) {
      const promptFile = path.join(dir, agent.id, agent.prompt || 'prompt.md');
      out[agent.role] = readText(promptFile).trim();
    }
  } catch (_) {}
  return out;
}

function envEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw == null) return !!defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw || ''));
}

function rolloutPercent(route) {
  const rollout = route && route.rollout && typeof route.rollout === 'object' ? route.rollout : {};
  const envName = rollout.envOverride || route.rolloutPercentEnv;
  const raw = envName && process.env[envName] != null ? process.env[envName] : (rollout.percent != null ? rollout.percent : route.rolloutPercent);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function rolloutBucket(role, route, spec = {}) {
  const key = [
    role,
    spec.taskId || '',
    spec.queueAgent || '',
    spec.queueId || '',
    String(spec.goal || spec.message || '').slice(0, 300),
  ].join('|');
  const hex = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

function routeRunnerForRole(role, route, spec = {}) {
  if (!route || !route.runner) return null;
  const rollout = route.rollout && typeof route.rollout === 'object' ? route.rollout : {};
  const disableEnv = String(rollout.disableEnv || route.disableEnv || '').split('=')[0];
  const fallbackRunner = rollout.rollbackRunner || route.rollbackRunner || route.fallbackRunner || route.runner;
  if (disableEnv && !envEnabled(disableEnv, true)) return fallbackRunner;
  const percent = rolloutPercent(route);
  if (percent <= 0) return fallbackRunner;
  if (percent >= 100) return route.runner;
  return rolloutBucket(role, route, spec) < percent ? route.runner : fallbackRunner;
}

function roleMapFromConfig(config, spec = {}) {
  const out = {};
  for (const [role, route] of Object.entries((config && config.roleRouting) || {})) {
    const runner = routeRunnerForRole(role, route, spec);
    if (runner) out[role] = runner;
  }
  return out;
}

// 把每个角色 config.roleRouting[role].execution 暴露给 runner 解析,
// 让 requiresWritableRunnerForImplement 这类角色级声明能被遵守(不再只靠 goal 文本启发式)。
function roleExecMetaFromConfig(config) {
  const out = {};
  for (const [role, route] of Object.entries((config && config.roleRouting) || {})) {
    if (route && route.execution && typeof route.execution === 'object') out[role] = route.execution;
  }
  return out;
}

function makeCtx(spec) {
  const rawAcceptance = spec.acceptance || '事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图';
  const acceptance = spec.structuredAcceptance === false || spec.skipStructuredAcceptance
    ? rawAcceptance
    : DoneGate.buildStructuredAcceptanceTable({
      goal: spec.goal || spec.message || '',
      acceptance: rawAcceptance,
      projectId: spec.projectId || null,
      workspaceRoot: WORKDIR,
      decisionsFile: MEMORY_DECISIONS,
      templatePath: DoneGate.structuredAcceptanceTemplatePath({ workspaceRoot: WORKDIR }),
    });
  return {
    goal: withAttachmentPrompt(spec.goal || spec.message || '', spec.attachments),
    bounds: spec.bounds || '只处理本任务; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明',
    inputs: mergeInputs(spec.inputs, spec.attachments),
    attachments: Array.isArray(spec.attachments) ? spec.attachments : [],
    acceptance,
    workspaceRoot: WORKDIR,
    projectId: spec.projectId || null,
    scopedToProject: !!spec.scopedToProject,
    taskId: spec.taskId || null,
    queueAgent: spec.queueAgent || null,
    queueId: spec.queueId || null,
    rootQueueAgent: spec.rootQueueAgent || null,
    rootQueueId: spec.rootQueueId || null,
    rootTaskId: spec.rootTaskId || null,
    agentPrompts: loadAgentPrompts(),
  };
}

// 交接文件夹机制 shadow 阶段(拍板①②修正版):任务启动时(spec 就绪处)把任务稿/元数据
// 寄生写进 engine-runs/<taskId>/ 根(该目录本就创建、轮转现成),生命周期随目录轮转绑队列终态。
// board_* 角色(纯文本 runner,走 board-review 专用通道)排除;
// 任何失败静默降级 + emit handoff.fallback,绝不阻断任务。
function isBoardRole(role) {
  return /^board[_-]/i.test(String(role || ''));
}

function writeHandoffShadow({ spec, ctx, runsDir, eventlog, taskId }) {
  if (!Handoff.isEnabled(process.env)) return null;
  if (isBoardRole(spec && spec.role)) return null;
  try {
    const doc = Handoff.writeTaskDoc(runsDir, Object.assign({}, ctx, { taskId }));
    const meta = Handoff.writeMeta(runsDir, {
      taskId,
      queueAgent: spec.queueAgent || null,
      queueId: spec.queueId || null,
      from: spec.rootQueueAgent || spec.queueAgent || 'ceo',
      to: spec.queueAgent || spec.role || null,
      spec_fingerprint: doc.fingerprint,
      attempts: [],
    });
    eventlog.emit('handoff.shadow.written', {
      task: taskId,
      mode: Handoff.mode(process.env),
      file: rel(doc.file),
      meta: rel(meta.file),
      fingerprint: doc.fingerprint,
      projectId: spec.projectId || null,
    });
    return doc;
  } catch (e) {
    try {
      eventlog.emit('handoff.fallback', {
        task: taskId,
        stage: 'write',
        reason: sanitizeReason(e && e.message || String(e)),
        projectId: spec && spec.projectId || null,
      });
    } catch (_) {}
    return null;
  }
}

function readQueueEntry(spec) {
  if (!spec.queueId) return null;
  const agent = spec.queueAgent || 'ceo';
  const file = path.join(Q.qdir(QUEUE_ROOT, agent), 'running', `${spec.queueId}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function makeQueueCheckpoint(spec, eventlog) {
  if (!spec.queueId) return null;
  const agent = spec.queueAgent || 'ceo';
  let consumedSteer = Number(spec.consumedSteer || 0);
  return ({ node, ctx }) => {
    const entry = readQueueEntry(spec);
    if (!entry) return null;
    if (entry.cancel_requested) {
      return { cancel: true, reason: `queue ${spec.queueId} canceled` };
    }
    const steer = Array.isArray(entry.steer) ? entry.steer : [];
    const fresh = steer.slice(consumedSteer).filter(s => s && s.msg);
    consumedSteer = steer.length;
    if (!fresh.length) return null;
    const lines = fresh.map(s => `- [${s.at || 'unknown'}] ${String(s.msg)}`);
    ctx.goal = `${String(ctx.goal || '').trim()}\n\n队列引导消息(运行中安全检查点注入,当前节点:${node.id}):\n${lines.join('\n')}`;
    eventlog.emit('queue.steer.applied', {
      queueAgent: agent,
      queueId: spec.queueId,
      task: spec.taskId,
      node: node.id,
      count: fresh.length,
      msg: fresh.map(s => String(s.msg)).join('\n').slice(0, 500),
    });
    return { steered: true };
  };
}

function singleAgentFlow(role) {
  return {
    schema_version: 1,
    id: 'agent-once',
    description: 'Queue worker single-agent execution flow',
    guards: {
      max_loops: 1,
      wall_timeout_sec: 1800,
      validate_before_run: true,
    },
    nodes: [
      { id: 'execute', agent_role: role || 'worker_code' },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { from: 'execute', to: 'done' },
    ],
    acceptance: {
      require_evidence: true,
      visual_artifacts_need_screenshot: true,
    },
  };
}

function queueLeaseFreshForTask(task, staleMs) {
  const vars = task && task.vars || {};
  const agent = vars.queueAgent || task.queueAgent || null;
  const id = vars.queueId || task.queueId || null;
  if (!agent || !id) return false;
  const file = path.join(Q.qdir(QUEUE_ROOT, agent), 'running', `${id}.json`);
  let entry = null;
  try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!entry) return false;
  return !Q.isLeaseStale(entry, { leaseMs: staleMs }).stale;
}

function sweepTaskStoreRunning(taskstore, eventlog) {
  const swept = taskstore.sweepStaleRunning({
    staleMs: TASKSTORE_RUNNING_STALE_MS,
    isLeaseFresh: task => queueLeaseFreshForTask(task, TASKSTORE_RUNNING_STALE_MS),
  });
  for (const item of swept) {
    eventlog.emit('taskstore.running.recovered', {
      task: item.id,
      state: item.state,
      reason: item.reason,
      ageMs: item.ageMs,
    });
  }
  return swept;
}

function listProjects() {
  try {
    return fs.readdirSync(PROJECTS_DIR)
      .filter(name => !name.startsWith('_') && name !== 'Starlaid')
      .filter(name => {
        try { return fs.statSync(path.join(PROJECTS_DIR, name)).isDirectory(); }
        catch (_) { return false; }
      })
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return ['控制台'];
  }
}

function normalizeProjectId(projectId) {
  const projects = listProjects();
  const raw = String(projectId || '').trim();
  if (!raw || /starlaid/i.test(raw)) return null;
  if (projects.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  return projects.find(p => p.toLowerCase() === lower) || null;
}

function defaultProjectId() {
  return normalizeProjectId('控制台') || listProjects()[0] || '控制台';
}

function normalizeKeywordProjectId(text) {
  const candidate = keywordProjectId(text);
  return candidate ? (normalizeProjectId(candidate) || candidate) : null;
}

function inferProjectId(spec, planText, planProjectId) {
  const source = spec || {};
  const sourceText = [source.goal, source.message, source.originalGoal]
    .filter(Boolean).join('\n');
  if (isStarlaidProjectId(source.projectId)) return null;
  const explicit = normalizeProjectId(source.projectId);
  if (explicit) return explicit;
  if (hasActiveStarlaidReference(sourceText)) return null;
  const sourceKeyword = normalizeKeywordProjectId(sourceText);
  if (sourceKeyword) return sourceKeyword;
  if (isStarlaidProjectId(planProjectId)) return null;
  const planned = normalizeProjectId(planProjectId);
  if (planned) return planned;
  if (hasActiveStarlaidReference(planText)) return null;
  const planKeyword = normalizeKeywordProjectId(planText);
  if (planKeyword) return planKeyword;
  return defaultProjectId();
}

function supervisorQueue(projectId) {
  return `supervisor-${projectId}`;
}

// ===== CEO 按复杂度伸缩(拍板 Q4):简单任务直通项目主管 =====
// 开关 YUTU6_CEO_ELASTIC:默认开;=0/false/off 退回全量过 CEO(orchestrator-plan)。
function ceoElasticEnabled() {
  const raw = process.env.YUTU6_CEO_ELASTIC;
  if (raw == null) return true;
  return !/^(0|false|off)$/i.test(String(raw).trim());
}

const SIMPLE_TASK_MAX_GOAL_CHARS = 600;
const CROSS_PROJECT_SIGNAL_RE = /跨项目|跨\s*(?:两|多|数)\s*个?\s*项目|两个项目|多个项目|多项目|cross[-\s]?project/i;
const REPAIR_FIREFIGHT_TEXT_RE = /维修|抢修|救火|灭火|紧急(?:修复|处理|抢修|任务|恢复)|故障|宕机|崩溃|事故|hotfix|incident|outage|emergency|firefight/i;
const REPAIR_ROLE_RE = /repair|维修/i;

// 与 board-review.js stripSecretaryContextPack 同规则(显式标记,不用启发式正则):
// 弹性判据只看老板正文,不能让秘书后台背景包把所有任务都撑成"复杂"。
function stripSecretaryContextPackText(text) {
  const s = String(text || '');
  const start = s.indexOf('[秘书后台背景包]');
  if (start === -1) return s;
  const goalIdx = s.indexOf('\n目标:', start);
  if (goalIdx > start) return (s.slice(0, start) + s.slice(goalIdx + 1)).trim();
  return s.slice(0, start).trim();
}

// 简单判据用的"老板正文":originalGoal 优先(秘书信封保留的原文),否则剥背景包后的 goal。
function simpleTaskGoalText(spec) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const original = String(source.originalGoal || '').trim();
  if (original) return original;
  return stripSecretaryContextPackText(String(source.goal || source.message || '')).trim();
}

function mentionedProjects(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return [];
  return listProjects().filter(p => s.includes(String(p).toLowerCase()));
}

// e) 维修/救火类不走直通:角色/队列/来源命中 repair,或正文出现救火信号。
function isRepairOrFirefightSpec(spec) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const roleText = [
    source.role,
    source.queueAgent,
    source.autoSource,
    source.rootAutoSource,
    source.directAgent,
    source.targetAgent,
    source.routeAgent,
    source.assigneeAgent,
    source.assignee,
  ].filter(Boolean).join('\n');
  if (REPAIR_ROLE_RE.test(roleText)) return true;
  const text = [source.title, source.originalGoal, source.goal, source.message, source.bounds]
    .filter(Boolean).join('\n');
  return REPAIR_FIREFIGHT_TEXT_RE.test(text);
}

// c) 董事会重要域判定:structured 优先(shouldRunBoardReview 内部先看结构化字段),
// goal 用剥离背景包后的老板正文,避免背景包关键词误判;董事会被禁用/已评审/显式跳过时
// 弹性判据仍用文本兜底——那只免掉董事会,不代表任务简单。
function boardImportanceForSimpleTask(spec, goalText) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const probe = Object.assign({}, source, {
    goal: goalText,
    originalGoal: String(source.originalGoal || '').trim() || null,
  });
  const assessment = BoardReview.shouldRunBoardReview(probe, '');
  if (assessment && assessment.important) return assessment;
  const bypassReasons = new Set(['already-reviewed', 'skipBoardReview']);
  if (assessment && (assessment.disabled || bypassReasons.has(assessment.reason))) {
    const textAssessment = BoardReview.assessTask([probe.originalGoal, goalText].filter(Boolean).join('\n'));
    if (textAssessment && textAssessment.important) return textAssessment;
  }
  return null;
}

// 拍板 Q4 保守判据:全部满足才算简单任务;任何一条拿不准都走全链(orchestrator-plan)。
function isSimpleTask(spec) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const fail = (reason, extra) => Object.assign({ simple: false, reason }, extra || {});
  // a) projectId 必须显式给定且能规范化(Starlaid/未知项目一律不算)。
  if (!source.projectId) return fail('no_explicit_project');
  if (isStarlaidProjectId(source.projectId)) return fail('starlaid_project');
  const projectId = normalizeProjectId(source.projectId);
  if (!projectId) return fail('unknown_project');
  // d) 显式要求 CEO 拆解 / 董事会评议的任务不短路。
  if (source.useOrchestrator === true) return fail('use_orchestrator_required');
  if (source.boardReview && source.boardReview.required === true) return fail('board_review_required');
  // 控制台重启类结构化动作走全链(复用现有 detached 交接分支)。
  if (isConsoleRestartExecutionRequest(source, '')) return fail('console_restart_request');
  // e) 维修/救火类不直通。
  if (isRepairOrFirefightSpec(source)) return fail('repair_or_firefight');
  // b) 老板正文非空、<600 字符、无跨项目信号、不提及其他项目、不主动涉 Starlaid。
  const goalText = simpleTaskGoalText(source);
  if (!goalText) return fail('empty_goal');
  if (goalText.length >= SIMPLE_TASK_MAX_GOAL_CHARS) return fail('goal_too_long', { goalChars: goalText.length });
  const crossText = [goalText, source.title, source.bounds].filter(Boolean).join('\n');
  if (CROSS_PROJECT_SIGNAL_RE.test(crossText)) return fail('cross_project_signal');
  const otherProjects = mentionedProjects(crossText).filter(p => p !== projectId);
  if (otherProjects.length) return fail('mentions_other_project', { otherProjects });
  if (hasActiveStarlaidReference(crossText)) return fail('starlaid_reference');
  // c) 不命中董事会重要域(structured 优先 + 文本兜底)。
  const important = boardImportanceForSimpleTask(source, goalText);
  if (important) return fail(`board_important:${important.reason || 'unknown'}`);
  return { simple: true, reason: 'simple_task', projectId, goalChars: goalText.length };
}

const DIRECT_AGENT_MAP = {
  frontend_designer: { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' },
  'frontend-designer': { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' },
  it_engineer: { agent: 'it_engineer', role: 'it_engineer', flowId: 'agent-once' },
  'it-engineer': { agent: 'it_engineer', role: 'it_engineer', flowId: 'agent-once' },
  hr_manager: { agent: 'hr_manager', role: 'hr_manager', flowId: 'agent-once' },
  'hr-manager': { agent: 'hr_manager', role: 'hr_manager', flowId: 'agent-once' },
  'repair-lead': { agent: 'repair-lead', role: 'repair-lead', flowId: 'agent-once' },
  repair_lead: { agent: 'repair-lead', role: 'repair-lead', flowId: 'agent-once' },
  repair: { agent: 'repair', role: 'repair', flowId: 'agent-once' },
  gui_desktop_control: { agent: 'gui_desktop_control', role: 'gui_desktop_control', flowId: 'agent-once' },
  'gui-desktop-control': { agent: 'gui_desktop_control', role: 'gui_desktop_control', flowId: 'agent-once' },
};

function normalizeDirectAgent(value) {
  const token = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (DIRECT_AGENT_MAP[token]) return DIRECT_AGENT_MAP[token];
  if (/^(?:前端程序员|前端设计师|frontend)$/.test(token)) return DIRECT_AGENT_MAP.frontend_designer;
  if (/^(?:it工程师|it|版本工程师)$/.test(token)) return DIRECT_AGENT_MAP.it_engineer;
  if (/^(?:hr|hr主管|人力资源)$/.test(token)) return DIRECT_AGENT_MAP.hr_manager;
  if (/^(?:repair_lead|维修主管|维修部门主管)$/.test(token)) return DIRECT_AGENT_MAP.repair_lead;
  if (/^(?:repair|维修员)$/.test(token)) return DIRECT_AGENT_MAP.repair;
  if (/^(?:peekaboo|桌面控制|gui)$/.test(token)) return DIRECT_AGENT_MAP.gui_desktop_control;
  return null;
}

function explicitDirectQueueForGoal(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.directRoute === false || spec.skipDirectRoute === true) return null;
  const candidates = [
    spec.directAgent,
    spec.targetAgent,
    spec.routeAgent,
    spec.assigneeAgent,
    spec.assignee,
  ];
  for (const value of candidates) {
    const direct = normalizeDirectAgent(value);
    if (direct) return direct;
  }
  return null;
}

function hasNegatedDirectRoute(text, roleRe) {
  const s = String(text || '')
    .replace(/(?:starlaid|星桥)\s*(?:项目|范围|全程|一律|硬)?\s*(?:排除|不涉及|无关|跳过|不处理)/gi, '')
    .replace(/(?:排除|不涉及|无关|跳过|不处理)\s*(?:starlaid|星桥)/gi, '');
  const role = `(?:${roleRe})`;
  const before = new RegExp(`(?:不要|不用|无需|别|不必|禁止|避免|不要交给|别交给|不要让|别让|不交给|不派给|排除)\\s*.{0,16}${role}`, 'i');
  const after = new RegExp(`${role}\\s*.{0,16}(?:不用|无需|不参与|不接|不做|不处理|排除|跳过|不要接|别接)`, 'i');
  return before.test(s) || after.test(s);
}

function automaticLightweightSource(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const explicit = [
    spec.autoSource,
    spec.rootAutoSource,
    spec.automationSource,
    spec.source,
    spec.queueSource,
  ].filter(Boolean).join('\n');
  const text = [
    explicit,
    spec.queueAgent,
    spec.role,
    spec.flowId,
    spec.goal,
    spec.bounds,
    spec.title,
  ].filter(Boolean).join('\n');
  if (/洞察员|insight[-_ ]?scout|insight-/i.test(text)) return 'insight-scout';
  if (/ui[_-]?optimizer|界面自优化|ui\s*自优化|自省优化|self[-_ ]?reflection/i.test(text)) return 'optimizer';
  if (/scheduled|cron|定时|自动巡检|自动洞察/i.test(text)) return 'scheduled';
  return null;
}

function loopEngineeringEnabledForSpec(spec) {
  if (spec && spec.loopEngineering === false) return false;
  if (spec && spec.loopEngineering === true) return true;
  if (process.env.CONSOLE_LOOP_ENGINEERING_AUTOMATION === '1') return true;
  return !automaticLightweightSource(spec);
}

function rootTaskFields(spec, taskId) {
  return {
    rootQueueAgent: spec.rootQueueAgent || spec.queueAgent || 'ceo',
    rootQueueId: spec.rootQueueId || spec.queueId || null,
    rootTaskId: spec.rootTaskId || taskId,
    rootAutoSource: spec.rootAutoSource || automaticLightweightSource(spec) || null,
    parentTaskId: taskId,
  };
}

function directQueueForGoal(spec, planText) {
  const explicit = explicitDirectQueueForGoal(spec);
  if (explicit) return explicit;
  if (spec && (spec.directRoute === false || spec.skipDirectRoute === true)) return null;
  void planText;
  const text = [spec.goal, spec.message, spec.originalGoal]
    .filter(Boolean).join('\n').toLowerCase();
  if (!hasNegatedDirectRoute(text, 'it\\s*工程师|it_engineer|it-engineer|版本工程师')
    && /(it\s*工程师|gitee|码云|版本管理|版本发布|远端同步|仓库同步|四段版本号)/i.test(text)
    && /(commit|push|pull|release|rollback|revert|reset|回滚|发布|提交|上传|下载|同步|拉取|推送)/i.test(text)) {
    return { agent: 'it_engineer', role: 'it_engineer', flowId: 'agent-once' };
  }
  if (!hasNegatedDirectRoute(text, '前端程序员|前端设计师|frontend[_-]?designer|frontend')
    && /(前端程序员|前端设计师|frontend[_-]?designer)/i.test(text)
    && /(workspace\.html|任务板|办公室|工位|进展区|滚轮|滚动|渲染|刷新|闪动|页面|前端|webui|ui|html|css|js)/i.test(text)) {
    return { agent: 'frontend_designer', role: 'frontend_designer', flowId: 'agent-once' };
  }
  if (!hasNegatedDirectRoute(text, 'hr|人力资源|hr主管|hr专员')
    && /(hr|人力资源|hr主管|hr专员|新增智能体|创建新智能体|agent\s*(创建|入职|招聘)|花名册|职责边界|边界审核)/i.test(text)) {
    return { agent: 'hr_manager', role: 'hr_manager', flowId: 'agent-once' };
  }
  const requiresImplementation = /workspace\.html|public\/|server\.js|ceo-worker|shared\/engine|review-loop|git diff|代码|源码|文件|实现|修复|改造|整合|写进|引用|落地|合入|视图|页面|前端|ui|html|css|js/.test(text);
  if (requiresImplementation) return null;
  if (!hasNegatedDirectRoute(text, 'peekaboo|gui_desktop_control|gui|桌面控制')
    && /peekaboo|截图|截屏|点击|桌面|screen recording|accessibility|gui|屏幕录制|辅助功能/.test(text)) {
    return { agent: 'gui_desktop_control', role: 'gui_desktop_control', flowId: 'agent-once' };
  }
  return null;
}

function isConsoleRestartExecutionRequest(spec, planText) {
  void planText;
  if (!spec || typeof spec !== 'object') return false;
  if (spec.restartConsole === true || spec.consoleRestart === true) return true;
  const candidates = [
    spec.action,
    spec.intent,
    spec.operation,
    spec.commandType,
    spec.requestedAction,
    spec.systemAction,
  ];
  if (candidates.some(isConsoleRestartActionValue)) return true;
  if (isConsoleRestartRequestObject(spec.request)) return true;
  if (isConsoleRestartRequestObject(spec.restart)) return true;
  if (isConsoleRestartCommand(spec.command)) return true;
  if (Array.isArray(spec.actions) && spec.actions.some(isConsoleRestartRequestObject)) return true;
  if (Array.isArray(spec.commands) && spec.commands.some(cmd => isConsoleRestartRequestObject(cmd) || isConsoleRestartCommand(cmd))) return true;
  return false;
}

function normalizedActionToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

function isConsoleRestartActionValue(value) {
  const token = normalizedActionToken(value);
  if (!token) return false;
  return [
    'restart-console',
    'console-restart',
    'restart-control-console',
    'restart-yutu6-console',
    'restart-com.yutu6.console',
    'launchctl-kickstart-console',
  ].includes(token);
}

function isRestartActionValue(value) {
  const token = normalizedActionToken(value);
  return [
    'restart',
    'kickstart',
    'launchctl-kickstart',
    'restart-service',
  ].includes(token);
}

function isConsoleTargetValue(value) {
  const token = normalizedActionToken(value);
  return [
    'console',
    'control-console',
    '控制台',
    'yutu6-console',
    'com.yutu6.console',
  ].includes(token);
}

function isConsoleRestartCommand(value) {
  const command = String(value || '').trim();
  if (!command) return false;
  return /^launchctl\s+kickstart\s+-k\s+gui\/\S+\/com\.yutu6\.console$/i.test(command)
    || /^node\s+projects\/控制台\/tools\/console-restart-detached\.js(?:\s|$)/i.test(command);
}

function isConsoleRestartRequestObject(value) {
  if (typeof value === 'string') return isConsoleRestartActionValue(value) || isConsoleRestartCommand(value);
  if (!value || typeof value !== 'object') return false;
  if (value.restartConsole === true || value.consoleRestart === true) return true;
  if ([value.action, value.intent, value.operation, value.commandType, value.type].some(isConsoleRestartActionValue)) return true;
  const target = value.target || value.service || value.project || value.subject;
  if ([value.action, value.intent, value.operation, value.commandType, value.type].some(isRestartActionValue) && isConsoleTargetValue(target)) return true;
  if (isConsoleRestartCommand(value.command)) return true;
  return false;
}

function writeConsoleRestartHandoff(projectId, spec, taskId) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const dir = path.join(ARTIFACTS_ROOT, 'console-restart');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `handoff-${safeName(taskId || stamp)}.md`);
  const reason = String(spec && (spec.title || spec.goal || spec.message) || 'console restart').replace(/\s+/g, ' ').slice(0, 180);
  const command = [
    'node',
    'projects/控制台/tools/console-restart-detached.js',
    '--delay-ms',
    '5000',
    '--reason',
    JSON.stringify(reason),
  ].join(' ');
  const body = [
    '# 控制台 detached 重启交接',
    '',
    `- projectId: ${projectId || '控制台'}`,
    `- taskId: ${taskId || '-'}`,
    `- reason: ${reason}`,
    '',
    '不要在控制台队列任务里直接执行 `launchctl kickstart -k ... com.yutu6.console`。',
    '需要重启时,由主人本机或外部维修会话执行下面命令;脚本会把实际 kickstart 交给 launchd one-shot job,避免杀掉正在跑的 engine 进程后留下 running 孤儿。',
    '',
    '```bash',
    command,
    '```',
    '',
    '验证建议:重启后再跑 `node projects/控制台/tools/project-guard-smoke-test.js`、`node projects/控制台/tools/serial-smoke-test.js` 与 `node tests/ceo-serial-lock.test.js`。',
    '',
  ].join('\n');
  fs.writeFileSync(file, body);
  return {
    file: rel(file),
    command,
  };
}

function appendBrief(projectId, spec, planText) {
  const dir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString();
  const block = [
    '',
    `## CEO 派单 ${stamp}`,
    `- projectId:${projectId}`,
    `- taskId:${spec.taskId}`,
    `- queue:${spec.queueAgent || '-'} / ${spec.queueId || '-'}`,
    `- 目标:${String(spec.goal || '').trim()}`,
    `- 边界:${String(spec.bounds || '').trim()}`,
    `- 验收:${String(spec.acceptance || '').trim()}`,
    '',
    `### CEO 计划摘要`,
    String(planText || '(无)').trim().slice(0, 3000),
    '',
  ].join('\n');
  fs.appendFileSync(path.join(dir, 'brief.md'), block);
}

// 协议必需步骤(CEO 增值步骤之外,直通/全链两条路径都必须走,一步不能少):
// brief 落盘 + project.brief.written、direct 建议压制记录、root 链路字段、
// supervisor review-loop 入队(含 DoneGate 结构化验收表)、queue.enqueued/project.routed/
// edge.take/project.route.waiting 事件、waiting_downstream 返回值。
function routeBriefToSupervisor({ routeSpec, taskId, eventlog, projectId, planText }) {
  appendBrief(projectId, routeSpec, planText);
  eventlog.emit('project.brief.written', { task: taskId, projectId, file: `projects/${projectId}/brief.md` });
  const direct = directQueueForGoal(routeSpec, planText);
  const directHint = direct
    ? `\n\n原始派单建议:可让 ${direct.agent} / ${direct.role} 参与具体实现,但根任务完成必须经主管 review-loop 的 implement + review 复审通过。`
    : '';
  if (direct) {
    eventlog.emit('project.route.direct_suppressed', {
      task: taskId,
      projectId,
      directAgent: direct.agent,
      directRole: direct.role,
      reason: 'project-route completion requires supervisor review-loop',
    });
  }
  const queueAgent = supervisorQueue(projectId);
  const childRoot = rootTaskFields(routeSpec, taskId);
  const supervisorGoal = `项目主管(${projectId})执行 CEO brief。原始目标:\n${routeSpec.goal || ''}${directHint}`;
  const entry = QueueAutoMerge.enqueue(QUEUE_ROOT, queueAgent, Object.assign({
    role: 'supervisor',
    flowId: 'review-loop',
    projectId,
    autoSource: childRoot.rootAutoSource || null,
    scopedToProject: true,
    goal: supervisorGoal,
    bounds: `只处理 projects/${projectId}/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明。`,
    inputs: [`projects/${projectId}/brief.md`].concat(mergeInputs(routeSpec.inputs, routeSpec.attachments)),
    attachments: Array.isArray(routeSpec.attachments) ? routeSpec.attachments : [],
    acceptance: DoneGate.buildStructuredAcceptanceTable({
      goal: supervisorGoal,
      acceptance: `在 ${projectId} 项目 scope 内跑 review-loop; 完成后更新 projects/${projectId}/status.md,并由系统增量更新 board/status-rollup.md。`,
      projectId,
      workspaceRoot: WORKDIR,
      decisionsFile: MEMORY_DECISIONS,
    }),
    useOrchestrator: false,
    autoApproveHuman: true,
  }, childRoot), { priority: routeSpec.priority != null ? routeSpec.priority : 50, eventlog, source: 'project-route', projectId });
  eventlog.emit('queue.enqueued', { queueAgent, queueId: entry.id, priority: entry.priority, goal: String(entry.task.goal || '').slice(0, 500), attachments: (entry.task.attachments || []).length || undefined, projectId, sourceTask: taskId, rootQueueAgent: childRoot.rootQueueAgent, rootQueueId: childRoot.rootQueueId, rootTaskId: childRoot.rootTaskId });
  eventlog.emit('project.routed', { task: taskId, projectId, supervisorQueue: queueAgent, queueId: entry.id, rootQueueAgent: childRoot.rootQueueAgent, rootQueueId: childRoot.rootQueueId, rootTaskId: childRoot.rootTaskId });
  eventlog.emit('edge.take', { task: taskId, from: 'orchestrator', to: 'supervisor', projectId });
  eventlog.emit('project.route.waiting', { task: taskId, projectId, queueAgent, queueId: entry.id, rootQueueAgent: childRoot.rootQueueAgent, rootQueueId: childRoot.rootQueueId, rootTaskId: childRoot.rootTaskId });
  return { ok: true, waitingDownstream: true, projectId, queueAgent, queueId: entry.id };
}

// 拍板 Q4:简单任务在 orchestrator-plan 之前短路,直通项目主管。
// 跳过的只有 CEO 增值步骤(orchestrator-plan 拆解、董事会评议——isSimpleTask 已确保不命中
// 重要域/未被显式要求);协议必需步骤全部复用 routeBriefToSupervisor,与全链一致。
// spec_fingerprint(handoff shadow)在 main() 里对本任务照常写入,子任务入队后由子引擎自写。
function runDirectSupervisorRoute({ spec, taskId, eventlog, ctx, verdict }) {
  const projectId = verdict.projectId;
  eventlog.emit('task.created', { task: taskId, flow: 'project-route', start: 'direct-to-supervisor', projectId });
  ctx.projectId = projectId;
  eventlog.emit('route.direct_to_supervisor', {
    task: taskId,
    projectId,
    reason: 'simple_task',
    queueAgent: supervisorQueue(projectId),
    goalChars: verdict.goalChars != null ? verdict.goalChars : null,
    queueId: spec.queueId || null,
    rootQueueAgent: spec.rootQueueAgent || spec.queueAgent || 'ceo',
  });
  const planText = [
    '(CEO 弹性伸缩:简单任务直通项目主管,CEO 拆解节点已跳过;brief 采用秘书信封/任务原文)',
    String(spec.goal || spec.message || '').trim().slice(0, 3000),
  ].filter(Boolean).join('\n');
  return routeBriefToSupervisor({ routeSpec: Object.assign({}, spec), taskId, eventlog, projectId, planText });
}

async function runProjectRoute({ spec, taskId, eventlog, cliRunner, ctx }) {
  if (ceoElasticEnabled()) {
    const verdict = isSimpleTask(spec);
    if (verdict.simple) {
      return runDirectSupervisorRoute({ spec, taskId, eventlog, ctx, verdict });
    }
  }
  eventlog.emit('task.created', { task: taskId, flow: 'project-route', start: 'orchestrator-plan', projectId: spec.projectId || null });
  let planText = '';
  if (spec.useOrchestrator !== false) {
    const planned = runOrchestratorPlan({ taskId, eventlog, cliRunner, ctx });
    if (!planned.ok) return { ok: false, reason: planned.reason };
    planText = ctx.orchestrator_plan || '';
  } else {
    eventlog.emit('node.start', { task: taskId, node: 'orchestrator-plan', attempt: 1, role: 'orchestrator', projectId: spec.projectId || null });
    planText = String(spec.goal || '').slice(0, 3000);
    ctx.orchestrator_plan = planText;
    eventlog.emit('node.end', { task: taskId, node: 'orchestrator-plan', attempt: 1, role: 'orchestrator', projectId: spec.projectId || null });
  }
  const projectId = inferProjectId(spec, planText, ctx.orchestrator_projectId);
  if (!projectId) {
    const reason = '检测到 Starlaid 排除范围或项目归属需要主人确认,CEO 已软暂停派单';
    eventlog.emit('project.route.paused', { task: taskId, reason, projectId: null });
    eventlog.emit('node.await_human', { task: taskId, node: 'project-route', reason, projectId: null });
    return { ok: false, paused: true, reason };
  }
  ctx.projectId = projectId;
  let routeSpec = Object.assign({}, spec);
  if (isConsoleRestartExecutionRequest(spec, planText)) {
    const handoff = writeConsoleRestartHandoff(projectId, spec, taskId);
    const reason = `控制台重启请求已转为外部 detached 触发,未进入普通执行槽; 请主人本机执行 ${handoff.command}`;
    eventlog.emit('project.route.restart_detached_required', {
      task: taskId,
      projectId,
      handoff: handoff.file,
      command: handoff.command,
      queueAgent: spec.queueAgent || null,
      queueId: spec.queueId || null,
    });
    eventlog.emit('node.await_human', { task: taskId, node: 'project-route', reason, projectId });
    return { ok: false, paused: true, reason, projectId, restartHandoff: handoff.file };
  }
  const boardAssessment = BoardReview.shouldRunBoardReview(routeSpec, planText);
  if (boardAssessment.important) {
    const boardResult = await BoardReview.runBoardReview({
      spec: routeSpec,
      ctx,
      taskId,
      projectId,
      planText,
      assessment: boardAssessment,
      eventlog,
      cliRunner,
      artifactsRoot: ARTIFACTS_ROOT,
      memoryFile: MEMORY_DECISIONS,
    });
    if (boardResult.paused) {
      eventlog.emit('node.await_human', { task: taskId, node: 'board-review', reason: boardResult.reason, projectId });
      return { ok: false, paused: true, reason: boardResult.reason, projectId, boardDecisionId: boardResult.decisionId || null };
    }
    if (!boardResult.ok) {
      eventlog.emit('node.fail', { task: taskId, node: 'board-review', attempt: 1, role: 'board_opus48', reason: boardResult.reason || 'board review failed', projectId });
      return { ok: false, reason: boardResult.reason || 'board review failed', projectId };
    }
    routeSpec = Object.assign({}, routeSpec, {
      goal: boardResult.revisedGoal || routeSpec.goal,
      boardReview: {
        completed: true,
        decision: 'default_execute',
        rounds: boardResult.rounds ? boardResult.rounds.length : 0,
        maxRounds: boardResult.maxRounds || BoardReview.MAX_ROUNDS,
        assessment: boardAssessment,
      },
    });
    ctx.goal = routeSpec.goal || ctx.goal;
    planText = [
      planText,
      '',
      `董事会评议:默认执行; 轮次 ${routeSpec.boardReview.rounds}/${routeSpec.boardReview.maxRounds}; 记录见 memory/decisions.md。`,
    ].filter(Boolean).join('\n');
  }
  return routeBriefToSupervisor({ routeSpec, taskId, eventlog, projectId, planText });
}

function runOrchestratorPlan({ taskId, eventlog, cliRunner, ctx }) {
  const node = { id: 'orchestrator-plan', agent_role: 'orchestrator' };
  eventlog.emit('node.start', { task: taskId, node: node.id, attempt: 1, role: node.agent_role, projectId: ctx.projectId || null });
  const out = cliRunner(node, Object.assign({}, ctx, {
    acceptance: '把老板任务拆成项目主管可执行 brief; 判断 projectId; 不改文件; 最后输出简短 JSON,包含 projectId/summary/acceptance',
  }), 1) || {};
  if (out.fail) {
    eventlog.emit('node.fail', { task: taskId, node: node.id, attempt: 1, role: node.agent_role, reason: out.fail, projectId: ctx.projectId || null });
    return { ok: false, reason: out.fail };
  }
  let summary = '';
  if (out.evidence && out.evidence.path) summary = readText(out.evidence.path).slice(0, 3000);
  const planProjectId = out.vars && out.vars.orchestrator && out.vars.orchestrator.projectId;
  const normalizedProjectId = normalizeProjectId(planProjectId);
  if (normalizedProjectId) ctx.orchestrator_projectId = normalizedProjectId;
  ctx.orchestrator_plan = summary || '(总管已完成拆解,详见 result.md)';
  eventlog.emit('node.end', { task: taskId, node: node.id, attempt: 1, role: node.agent_role, evidence: out.evidence || null, projectId: ctx.projectId || null });
  return { ok: true };
}

async function main() {
  const spec = loadSpec();
  const taskId = spec.taskId || `engine-${Date.now()}`;
  const flowId = spec.flowId || 'review-loop';
  const eventlog = createProgressEventLog(EVENTS, spec);
  const taskstore = new TaskStore(TASKS);
  sweepTaskStoreRunning(taskstore, eventlog);
  const runsDir = path.join(RUNS, taskId);
  fs.mkdirSync(runsDir, { recursive: true });

  const baseCliRunner = makeCliRunner({
    runners: cfg.runners,
    roleMap: roleMapFromConfig(cfg, spec),
    roleExecMeta: roleExecMetaFromConfig(cfg),
    workdir: WORKDIR,
    runsDir,
    nodeTimeoutSec: defaultNodeTimeoutSec(spec, flowId),
    eventlog,
    queueRoot: QUEUE_ROOT,
    queueAgent: spec.queueAgent || null,
    queueId: spec.queueId || null,
    taskId,
    projectId: spec.projectId || null,
  });
  const cliRunner = makeActionVerifyingRunner(baseCliRunner, {
    config: cfg,
    eventlog,
    runsDir,
    taskId,
  });

  const ctx = makeCtx(spec);
  eventlog.emit('engine.worker.start', { task: taskId, flow: flowId, pid: process.pid, projectId: spec.projectId || null });
  writeHandoffShadow({ spec, ctx, runsDir, eventlog, taskId });

  if (flowId === 'project-route') {
    const routed = await runProjectRoute({ spec: Object.assign({}, spec, { taskId }), taskId, eventlog, cliRunner, ctx });
    eventlog.emit('engine.worker.end', {
      task: taskId,
      flow: flowId,
      ok: !!routed.ok,
      canceled: false,
      paused: !!routed.paused,
      waitingDownstream: !!routed.waitingDownstream,
      reason: routed.reason || null,
      state: routed.paused ? 'paused' : (routed.waitingDownstream ? 'waiting_downstream' : (routed.ok ? 'done' : 'failed')),
      projectId: routed.projectId || spec.projectId || null,
    });
    process.exit(routed.ok ? 0 : (routed.paused ? 5 : 3));
  }

  if (spec.useOrchestrator !== false) {
    const planned = runOrchestratorPlan({ taskId, eventlog, cliRunner, ctx });
    if (!planned.ok) {
      eventlog.emit('task.failed', { task: taskId, flow: flowId, reason: planned.reason });
      eventlog.emit('engine.worker.end', { task: taskId, flow: flowId, ok: false, reason: planned.reason });
      process.exit(2);
    }
  }

  const flowFile = path.join(WORKDIR, 'shared/routing/flows', `${flowId}.yaml`);
  const flow = flowId === 'agent-once' ? singleAgentFlow(spec.role) : loadFlow(flowFile);
	  const loopEngineeringEnabled = loopEngineeringEnabledForSpec(spec);
	  if (!loopEngineeringEnabled) {
	    eventlog.emit('loop.skipped', {
	      task: taskId,
	      reason: 'auto-lightweight',
	      source: automaticLightweightSource(spec),
	      projectId: spec.projectId || null,
	    });
	  }
	  let result = runFlow({
    flow,
    runner: cliRunner,
    humanGate: spec.autoApproveHuman ? () => ({ human: { decision: 'approve' } }) : null,
    eventlog,
    taskstore,
    taskId,
    vars: ctx,
	    workspaceRoot: WORKDIR,
	    runnersConfig: cfg.runners || null, // 拍板⑤:done gate 特权写路径审计读 execution.allowedWritePaths
	    loopEngineering: LoopEngineering.createLoopEngineering({
	      enabled: loopEngineeringEnabled,
	      workspaceRoot: WORKDIR,
	      artifactsRoot: ARTIFACTS_ROOT,
      skillsRoot: path.join(WORKDIR, '.agents/skills'),
      taskId,
    }),
    hooks: makeHookRegistry(eventlog),
    checkpoint: makeQueueCheckpoint(spec, eventlog),
  });

  if (result.ok && flowId === 'agent-once' && spec.role === InsightScoutRepos.AGENT) {
    const vars = Object.assign({}, ctx, result.task && result.task.vars || {});
    let applied = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: WORKDIR,
      artifactsRoot: ARTIFACTS_ROOT,
      taskId,
      queueAgent: spec.queueAgent || InsightScoutRepos.AGENT,
      queueId: spec.queueId || null,
      slot: spec.insightScoutRepos && spec.insightScoutRepos.slot || null,
      topic: spec.insightScoutRepos && spec.insightScoutRepos.topic || null,
      output: vars,
      eventlog,
    });
    if (!applied.ok) {
      const resultMarkdown = latestNodeResultMarkdown(taskId, 'execute');
      const extracted = resultMarkdown && InsightScoutRepos.extractInsightScoutOutputFromText(resultMarkdown.text);
      if (extracted) {
        eventlog.emit('insight_scout.output_extracted', {
          task: taskId,
          queueAgent: spec.queueAgent || InsightScoutRepos.AGENT,
          queueId: spec.queueId || null,
          source: 'result.md',
          file: rel(resultMarkdown.file),
        });
        applied = InsightScoutRepos.applyInsightScoutOutput({
          workspaceRoot: WORKDIR,
          artifactsRoot: ARTIFACTS_ROOT,
          taskId,
          queueAgent: spec.queueAgent || InsightScoutRepos.AGENT,
          queueId: spec.queueId || null,
          slot: spec.insightScoutRepos && spec.insightScoutRepos.slot || null,
          topic: spec.insightScoutRepos && spec.insightScoutRepos.topic || null,
          output: extracted,
          eventlog,
        });
      }
    }
    if (!applied.ok) {
      const reason = `insight_scout_output_gate: ${applied.reason || 'unknown'}`;
      eventlog.emit('insight_scout.output_invalid', {
        task: taskId,
        queueAgent: spec.queueAgent || InsightScoutRepos.AGENT,
        queueId: spec.queueId || null,
        reason: applied.reason || null,
      });
      eventlog.emit('task.failed', { task: taskId, flow: flowId, reason, projectId: spec.projectId || null });
      result = Object.assign({}, result, { ok: false, reason });
    } else {
      result = Object.assign({}, result, { insightScoutOutput: applied });
    }
  }

  eventlog.emit('engine.worker.end', {
    task: taskId,
    flow: flowId,
    ok: !!result.ok,
    canceled: !!result.canceled,
    paused: isPausedResult(result),
    reason: result.reason || null,
    state: result.task && result.task.state,
  });
  process.exit(result.ok ? 0 : (result.canceled ? 4 : (isPausedResult(result) ? 5 : 3)));
}

function isPausedResult(result) {
  const state = result && result.task && result.task.state;
  return result && !result.ok && !result.canceled && (
    result.reason === 'awaiting_human' ||
    result.reason === 'no_edge' ||
    state === 'paused' ||
    state === 'awaiting_human'
  );
}

function runMain() {
  main().catch(e => {
    try {
      const spec = (() => { try { return loadSpec(); } catch (_) { return {}; } })();
      const eventlog = new EventLog(EVENTS);
      eventlog.emit('engine.worker.crash', { task: spec.taskId || null, reason: e.message });
    } catch (_) {}
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

if (require.main === module) runMain();

module.exports = {
  _test: {
    listProjects,
    normalizeProjectId,
    inferProjectId,
    defaultProjectId,
    supervisorQueue,
    isConsoleRestartExecutionRequest,
    directQueueForGoal,
    ceoElasticEnabled,
    isSimpleTask,
    simpleTaskGoalText,
    isRepairOrFirefightSpec,
    boardImportanceForSimpleTask,
    stripSecretaryContextPackText,
    roleMapFromConfig,
    routeRunnerForRole,
    rolloutPercent,
    defaultNodeTimeoutSec,
    automaticLightweightSource,
    loopEngineeringEnabledForSpec,
    isPausedResult,
    isBoardRole,
    writeHandoffShadow,
    makeCtx,
  },
};
