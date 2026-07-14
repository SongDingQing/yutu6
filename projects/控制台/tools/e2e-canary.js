#!/usr/bin/env node
'use strict';

/*
 * e2e-canary.js — 端到端金丝雀巡检(拍板 Q6:质量运营激活)
 *
 * 做什么:
 *   1. 用 secretary-tools queue-enqueue 入队一条固定小任务(role=worker_code,flowId=agent-once,低优先级):
 *      在 projects/控制台/artifacts/canary/ 写入 canary-<date>.txt(内容为日期)并回报。
 *   2. 轮询队列(queues/<agent>/{done,failed,canceled}/<id>.json)直到 done/failed/超时(默认 20 分钟)。
 *   3. done 且产物文件存在 = 绿;否则 = 红:secretary-tools repair-ticket-add 开 P0 工单 + emit `canary.failed` 事件。
 *   4. 结果写 artifacts/canary/state.json(保留最近 7 次)。
 *
 * 幂等:同日已有绿色结果则跳过(--force 覆盖)。
 * 红线:未登记或未授权项目不处理;密钥不回显;金丝雀任务本身只写 artifacts/canary/ 下一个文本文件。
 *
 * 用法:
 *   node projects/控制台/tools/e2e-canary.js
 *   node projects/控制台/tools/e2e-canary.js --dry-run          # 只打印将入队内容,不做任何写入
 *   node projects/控制台/tools/e2e-canary.js --force            # 同日已绿也重跑
 *   node projects/控制台/tools/e2e-canary.js --date 2026-07-03
 *   node projects/控制台/tools/e2e-canary.js --delay-ms 1800000 # 先睡 30 分钟再跑(daily 错峰用)
 *
 * env 开关:
 *   E2E_CANARY_AGENT       目标队列 agent(默认 worker_code)
 *   E2E_CANARY_TIMEOUT_MS  轮询超时(默认 20*60*1000)
 *   E2E_CANARY_POLL_MS     轮询间隔(默认 15000)
 *   E2E_CANARY_PRIORITY    队列优先级(默认 90,低优先级)
 *   CONSOLE_ARTIFACTS_DIR / CONSOLE_EVENTS_FILE 与控制台其余工具一致
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');            // projects/控制台
const WORKDIR = path.resolve(ROOT, '../..');           // 工作区根
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const EVENTS_FILE = process.env.CONSOLE_EVENTS_FILE
  ? path.resolve(process.env.CONSOLE_EVENTS_FILE)
  : path.join(QUEUE_ROOT, 'engine-events.jsonl');
const SECRETARY_TOOLS = path.join(ROOT, 'secretary-tools.js');

const DEFAULT_AGENT = process.env.E2E_CANARY_AGENT || 'worker_code';
const DEFAULT_TIMEOUT_MS = positiveInt(process.env.E2E_CANARY_TIMEOUT_MS, 20 * 60 * 1000);
const DEFAULT_POLL_MS = positiveInt(process.env.E2E_CANARY_POLL_MS, 15 * 1000);
const DEFAULT_PRIORITY = clampPriority(process.env.E2E_CANARY_PRIORITY, 90);
const KEEP_RESULTS = 7;

function positiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampPriority(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : fallback;
}

// 北京日期 YYYY-MM-DD(与 daily-governance-hardening 同一取日口径)
function canaryDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
}

function canaryDir(root = QUEUE_ROOT) {
  return path.join(root, 'canary');
}

function stateFilePath(root = QUEUE_ROOT) {
  return path.join(canaryDir(root), 'state.json');
}

function artifactFile(root, date) {
  return path.join(canaryDir(root), `canary-${date}.txt`);
}

function rel(file) {
  const r = path.relative(WORKDIR, file).split(path.sep).join('/');
  return r && !r.startsWith('..') ? r : file;
}

function buildCanaryTask(date) {
  return {
    role: 'worker_code',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    title: `金丝雀巡检 ${date}`,
    idem: `e2e-canary:${date}`,
    useOrchestrator: false,
    autoApproveHuman: true,
    nodeTimeoutSec: 600,
    goal: [
      `金丝雀巡检:在 projects/控制台/artifacts/canary/ 写入 canary-${date}.txt 内容为日期并回报。`,
      '',
      `具体要求:文件路径 projects/控制台/artifacts/canary/canary-${date}.txt,内容为 ${date}(一行纯文本)。`,
      '写完后回报文件路径与内容。这是端到端链路巡检任务,除该文件外不要改任何东西。',
    ].join('\n'),
    bounds: '只写 projects/控制台/artifacts/canary/ 下这一个文本文件; 不改代码; 未授权项目不处理; 密钥不回显。',
    acceptance: `projects/控制台/artifacts/canary/canary-${date}.txt 存在且内容为日期;回报路径与内容。`,
  };
}

function loadState(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      parsed.results = Array.isArray(parsed.results) ? parsed.results : [];
      return parsed;
    }
  } catch (_) {}
  return { results: [] };
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function recordResult(stateFile, result, keep = KEEP_RESULTS) {
  const state = loadState(stateFile);
  state.results = state.results.concat([result]).slice(-Math.max(1, keep));
  state.updated_at = new Date().toISOString();
  state.last = result;
  writeJsonAtomic(stateFile, state);
  return state;
}

function hasGreenForDate(state, date) {
  return (state.results || []).some(r => r && r.date === date && r.status === 'green');
}

// 队列条目状态机:done / failed / canceled / running / paused / queued / missing
function queueEntryStatus(root, agent, id) {
  const d = path.join(root, 'queues', agent);
  for (const sub of ['done', 'failed', 'canceled', 'running', 'paused']) {
    const file = path.join(d, sub, `${id}.json`);
    if (fs.existsSync(file)) {
      let entry = null;
      try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
      return { state: sub, file, entry };
    }
  }
  let files = [];
  try { files = fs.readdirSync(d); } catch (_) {}
  const hit = files.find(f => f.endsWith(`-${id}.json`));
  if (hit) return { state: 'queued', file: path.join(d, hit), entry: null };
  return { state: 'missing', file: null, entry: null };
}

function sanitizeOutput(text, max = 2000) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(-max);
}

function runSecretaryTool(cliArgs) {
  const { spawnSync } = require('child_process');
  const res = spawnSync(process.execPath, [SECRETARY_TOOLS].concat(cliArgs), {
    cwd: WORKDIR,
    env: process.env,
    encoding: 'utf8',
    timeout: 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.status !== 0 || res.error) {
    throw new Error(`secretary-tools ${cliArgs[0]} failed: ${sanitizeOutput(res.stderr || res.stdout || (res.error && res.error.message) || `exit ${res.status}`, 500)}`);
  }
  try { return JSON.parse(res.stdout); }
  catch (_) { throw new Error(`secretary-tools ${cliArgs[0]} returned non-JSON output`); }
}

// 默认入队:走 secretary-tools queue-enqueue(→ CEO 队列控制,留审计事件),不直接写队列目录。
function defaultEnqueue({ agent, task, priority, idem }) {
  const out = runSecretaryTool([
    'queue-enqueue',
    '--agent', agent,
    '--role', task.role,
    '--flow', task.flowId,
    '--project', task.projectId,
    '--priority', String(priority),
    '--goal', task.goal,
    '--bounds', task.bounds,
    '--acceptance', task.acceptance,
    '--idem', idem,
    '--useOrchestrator', 'false',
    '--reason', 'e2e-canary 端到端金丝雀巡检',
  ]);
  const id = out && (out.entry && out.entry.id || out.id);
  if (!id) throw new Error('queue-enqueue returned no entry id');
  return { id, entry: out.entry || null };
}

// 默认开工单:走 secretary-tools repair-ticket-add(P0),同日重复红灯用确定性 id 去重。
function defaultOpenTicket({ date, reason, queueId, agent, artifact }) {
  const ticketId = `canary-red-${date}`;
  try {
    const out = runSecretaryTool([
      'repair-ticket-add',
      '--id', ticketId,
      '--title', `金丝雀巡检红灯 ${date}: ${reason}`,
      '--priority', 'P0',
      '--source', 'e2e-canary',
      '--problem', `端到端金丝雀巡检失败(${reason})。链路 queue-enqueue → ${agent} worker → engine 执行 → 产物落盘 中至少一环断了。`,
      '--evidence', [
        `date=${date}`,
        `queueAgent=${agent}`,
        `queueId=${queueId || 'none'}`,
        `reason=${reason}`,
        `expectedArtifact=${artifact}`,
        `state=projects/控制台/artifacts/canary/state.json`,
      ].join('\n'),
      '--expectation', '定位红灯环节(入队/认领/引擎/产物),修复后重跑 node projects/控制台/tools/e2e-canary.js --force 复验绿灯。',
      '--redlines', '未授权项目不处理; 密钥不回显; 高危操作先给主人确认。',
    ]);
    return { ok: true, ticketId: out && out.ticket && out.ticket.id || ticketId, existed: false };
  } catch (e) {
    if (/repair ticket exists/i.test(String(e && e.message || ''))) {
      return { ok: true, ticketId, existed: true };
    }
    return { ok: false, ticketId, error: sanitizeOutput(e && e.message || String(e), 300) };
  }
}

function defaultEmit(type, data) {
  try {
    const EventLog = require(path.join(WORKDIR, 'shared', 'engine', 'eventlog'));
    new EventLog(EVENTS_FILE).emit(type, data);
    return true;
  } catch (_) { return false; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCanary(options = {}) {
  const root = options.root || QUEUE_ROOT;
  const agent = options.agent || DEFAULT_AGENT;
  const date = options.date || canaryDate();
  const force = !!options.force;
  const dryRun = !!options.dryRun;
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const pollMs = Math.max(1, options.pollMs == null ? DEFAULT_POLL_MS : options.pollMs);
  const priority = options.priority == null ? DEFAULT_PRIORITY : options.priority;
  const stateFile = options.stateFile || stateFilePath(root);
  const enqueue = options.enqueue || defaultEnqueue;
  const openTicket = options.openTicket || defaultOpenTicket;
  const emit = options.emit || defaultEmit;
  const now = options.now || (() => Date.now());
  const task = buildCanaryTask(date);
  const artifact = artifactFile(root, date);

  // 幂等:同日已绿则跳过(--force 覆盖)
  const state = loadState(stateFile);
  if (!force && hasGreenForDate(state, date)) {
    return { ok: true, skipped: true, reason: 'already-green-today', date, stateFile };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      date,
      enqueue: { agent, priority, idem: task.idem, task },
      expectedArtifact: rel(artifact),
      wouldPoll: { timeoutMs, pollMs },
    };
  }

  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  let queueId = null;
  let status = null;
  let reason = null;

  try {
    const res = await enqueue({ agent, task, priority, idem: task.idem });
    queueId = res && (res.id || (res.entry && res.entry.id)) || null;
    if (!queueId) throw new Error('enqueue returned no queue id');
  } catch (e) {
    status = 'red';
    reason = `enqueue-failed: ${sanitizeOutput(e && e.message || String(e), 300)}`;
  }

  if (queueId) {
    const deadline = startedMs + Math.max(0, timeoutMs);
    for (;;) {
      const st = queueEntryStatus(root, agent, queueId);
      if (st.state === 'done') {
        if (fs.existsSync(artifact)) { status = 'green'; reason = null; }
        else { status = 'red'; reason = 'artifact-missing'; }
        break;
      }
      if (st.state === 'failed' || st.state === 'canceled') {
        status = 'red';
        reason = `queue-${st.state}`;
        break;
      }
      if (now() >= deadline) {
        status = 'red';
        reason = `timeout(${timeoutMs}ms, last=${st.state})`;
        break;
      }
      await sleep(pollMs);
    }
  }

  const finishedMs = now();
  const result = {
    date,
    status,
    reason,
    queueAgent: agent,
    queueId,
    artifact: rel(artifact),
    artifactExists: fs.existsSync(artifact),
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
  };

  if (status === 'green') {
    emit('canary.passed', { date, queueAgent: agent, queueId, artifact: result.artifact });
  } else {
    emit('canary.failed', { date, queueAgent: agent, queueId, reason, artifact: result.artifact });
    result.ticket = openTicket({ date, reason, queueId, agent, artifact: result.artifact });
  }
  recordResult(stateFile, result);

  return { ok: status === 'green', status, date, queueId, reason, result, stateFile };
}

function parseCliArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--agent') args.agent = argv[++i];
    else if (a === '--timeout-ms') args.timeoutMs = positiveInt(argv[++i], DEFAULT_TIMEOUT_MS);
    else if (a === '--poll-ms') args.pollMs = positiveInt(argv[++i], DEFAULT_POLL_MS);
    else if (a === '--priority') args.priority = clampPriority(argv[++i], DEFAULT_PRIORITY);
    else if (a === '--delay-ms') args.delayMs = positiveInt(argv[++i], 0);
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('--date 必须是 YYYY-MM-DD');
  }
  if (args.delayMs) await sleep(args.delayMs); // daily 错峰:先睡再跑,detached 场景下不阻塞父进程
  const out = await runCanary({
    date: args.date,
    agent: args.agent,
    force: args.force,
    dryRun: args.dryRun,
    timeoutMs: args.timeoutMs,
    pollMs: args.pollMs,
    priority: args.priority,
  });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (!out.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => {
    process.stderr.write(sanitizeOutput(e && e.stack || e, 4000) + '\n');
    process.exit(1);
  });
}

module.exports = {
  canaryDate,
  buildCanaryTask,
  artifactFile,
  stateFilePath,
  loadState,
  recordResult,
  hasGreenForDate,
  queueEntryStatus,
  runCanary,
  KEEP_RESULTS,
};
