#!/usr/bin/env node
'use strict';

/*
 * self-review-rotation.js —— 自省优化定期轮换器(拍板 Q10)
 *
 * 维护 projects/控制台/artifacts/self-reflection-optimizer/rotation-state.json,
 * 按固定核心模块轮换表,每次调用取下一个模块,入队一条自省优化任务:
 *   - agent=repair-lead,flowId=agent-once,低优先级 90;
 *   - goal 按 .claude/skills/self-review-optimize 的流程描述:
 *     穷尽挑刺账本 ≤10 条 / auto_execute ≤3 条 / owner_decision 项写公告板卡。
 *
 * 幂等:同一"北京 ISO 周"已跑过则跳过(--force 覆盖);队列 id 按 模块+周 确定,
 * 已存在同 id 条目(任意状态)不重复入队。
 *
 * 入队路径:优先 secretary-tools queue-enqueue(走 CEO queue-control,保序);
 * 控制台服务器不可达时回退本地 Q.enqueue(与 daily-governance-hardening 的每日任务同款直投)。
 *
 * env 开关:SELF_REVIEW_ROTATION_ENABLED=0 时 CLI 直接跳过(默认开;只影响 CLI,不影响模块函数)。
 *
 * 红线:密钥不回显;只入队任务,不直接改模块代码。
 *
 * 用法:
 *   node tools/self-review-rotation.js               # 本周未跑则入队下一个模块
 *   node tools/self-review-rotation.js --dry-run
 *   node tools/self-review-rotation.js --force       # 同周强制再轮换一个模块
 *   node tools/self-review-rotation.js --list        # 查看轮换表与状态
 *   node tools/self-review-rotation.js --delay-ms 3600000   # 错峰(周日钩子用)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');                 // projects/控制台
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const STATE_FILE = path.join(QUEUE_ROOT, 'self-reflection-optimizer', 'rotation-state.json');
const EVENTS_FILE = process.env.CONSOLE_EVENTS_FILE
  ? path.resolve(process.env.CONSOLE_EVENTS_FILE)
  : path.join(QUEUE_ROOT, 'engine-events.jsonl');
// 相对 require,不依赖 CONSOLE_WORKDIR 指向(与 secretary-tools 同款)。
const Q = require('../../../shared/engine/queue');

const ROTATION_AGENT = 'repair-lead';
const ROTATION_PRIORITY = 90; // 低优先级,别跟业务任务抢
const ROTATION_MODULES = [
  'shared/engine/queue.js',
  'shared/engine/done-gate.js',
  'shared/engine/cli-runner.js',
  'projects/控制台/ceo-worker.js',
  'projects/控制台/server.js',
  'projects/控制台/engine-runner.js',
  'shared/routing/failover.js',
  'projects/控制台/board-review.js',
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function appendEvent(type, payload, eventsFile = EVENTS_FILE) {
  try {
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify(Object.assign({ ts: new Date().toISOString(), type }, payload || {})) + '\n');
  } catch (_) {}
}

// 北京日期 → ISO 周键(YYYY-Www),周一为一周之始,与"每周日跑一次"节律一一对应。
function beijingParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms == null ? Date.now() : ms));
  const [y, m, d] = parts.split('-').map(Number);
  return { y, m, d };
}

function isoWeekKey(ms) {
  const { y, m, d } = beijingParts(ms);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // 本周四
  const week1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function beijingDate(ms) {
  const { y, m, d } = beijingParts(ms);
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

// 队列 id 只允许 [A-Za-z0-9._-],非 ASCII(如 控制台)一律折叠成 '-'。
function moduleSlug(modulePath) {
  return String(modulePath || '')
    .replace(/\.js$/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function defaultState() {
  return { version: 1, nextIndex: 0, lastWeek: null, lastModule: null, lastQueueId: null, history: [] };
}

function readState(stateFile = STATE_FILE) {
  const state = readJson(stateFile, null);
  if (!state || typeof state !== 'object') return defaultState();
  return Object.assign(defaultState(), state, {
    nextIndex: Math.abs(Number(state.nextIndex) || 0) % ROTATION_MODULES.length,
    history: Array.isArray(state.history) ? state.history : [],
  });
}

// 该 agent 是否已存在某 id 的任务(任意状态)—— 幂等护栏。
function queueEntryAnywhere(queueRoot, agent, id) {
  const d = path.join(queueRoot, 'queues', agent);
  for (const sub of ['running', 'paused', 'done', 'failed', 'canceled']) {
    if (fs.existsSync(path.join(d, sub, `${id}.json`))) return { state: sub };
  }
  let files = [];
  try { files = fs.readdirSync(d); } catch (_) { return null; }
  if (files.some(f => /\.json$/.test(f) && f !== '_seq' && f.endsWith(`-${id}.json`))) return { state: 'queued' };
  return null;
}

function buildTask(modulePath, now) {
  const date = beijingDate(now);
  const slug = moduleSlug(modulePath);
  const goal = [
    `自省优化定期轮换任务(拍板 Q10)· 目标模块:${modulePath}`,
    '',
    '请按 .claude/skills/self-review-optimize 的流程,对上述模块做证据化的挑刺-优化闭环:',
    '1. 装载背景:读模块 README/相邻测试;grep memory/experience.md 相关教训;查 board/learning-cases/ 相关案例。',
    '2. 穷尽挑刺 → 账本 ≤10 条:每条写 证据(文件:行号)/影响/修法/风险/分级/验证,禁止"没问题"式回复(挑不满 3 条要把"没问题"证明出来)。',
    '3. 分级执行:auto_execute ≤3 条,逐条最小改动+跑账本里写的验证,失败立即回滚改判 defer;拿不准一律降级 owner_decision。',
    '4. owner_decision 项绝不动手:汇总成决策清单,用 secretary-tools bulletin-add 写公告板卡(--target ceo --source 自省优化),等老板拍板。',
    `5. 账本写 projects/控制台/artifacts/self-reflection-optimizer/${slug}-self-review-${date}.md;可复用教训按既有格式追加 board/learning-cases/self-reflection-optimizer-cases.md。`,
    '',
    '红线:密钥不读不回显;禁止 git add -A;不改公共 API/队列语义/鉴权/持久化格式;改动被核心引擎 require 时跑 node tests/run.js 全量。',
  ].join('\n');
  return {
    role: ROTATION_AGENT,
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    title: `自省优化轮换:${modulePath}`,
    goal,
    bounds: '密钥不回显; 禁止 git add -A; auto_execute 只做窄改动且可回滚; owner_decision 项只写公告板卡不动手; 高危/不可逆操作先给主人确认。',
    acceptance: `产出自省账本 projects/控制台/artifacts/self-reflection-optimizer/${slug}-self-review-${date}.md;auto_execute 每条附验证输出;owner_decision 项已写公告板卡(source=自省优化)。`,
    useOrchestrator: false,
    autoApproveHuman: true,
  };
}

// 优先 secretary-tools queue-enqueue(CLI 走 CEO queue-control;模块未导出 queueEnqueue);
// 控制台服务器不可达/失败时回退本地 Q.enqueue(与 daily-governance-hardening 每日任务同款直投)。
async function enqueueRotationTask(queueRoot, id, task, opts = {}) {
  let fallbackReason = null;
  if (opts.viaSecretary !== false) {
    const { spawnSync } = require('child_process');
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'secretary-tools.js'), 'queue-enqueue',
      '--agent', ROTATION_AGENT,
      '--role', ROTATION_AGENT,
      '--flow', 'agent-once',
      '--project', '控制台',
      '--goal', task.goal,
      '--bounds', task.bounds,
      '--acceptance', task.acceptance,
      '--priority', String(ROTATION_PRIORITY),
      '--id', id,
      '--idem', `self-review-rotation:${id}`,
      '--use-orchestrator', 'false',
      '--reason', 'self-review-rotation weekly',
    ], {
      env: process.env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (res.status === 0) return { action: 'enqueued', via: 'secretary-queue-enqueue', id };
    fallbackReason = String((res.stderr || '') + (res.stdout || '')).slice(0, 200);
  }
  const entry = Q.enqueue(queueRoot, ROTATION_AGENT, task, {
    id,
    priority: ROTATION_PRIORITY,
    idem: `self-review-rotation:${id}`,
  });
  return { action: 'enqueued', via: 'local-queue', id: entry.id, seq: entry.seq, fallbackReason };
}

async function run(opts = {}) {
  const now = Number(opts.now) || Date.now();
  const queueRoot = opts.queueRoot || QUEUE_ROOT;
  const stateFile = opts.stateFile || STATE_FILE;
  const state = readState(stateFile);
  const week = isoWeekKey(now);
  if (!opts.force && state.lastWeek === week) {
    return {
      ok: true,
      skipped: true,
      reason: 'already-ran-this-week',
      week,
      lastModule: state.lastModule || null,
      lastQueueId: state.lastQueueId || null,
      nextModule: ROTATION_MODULES[state.nextIndex],
    };
  }
  const index = state.nextIndex % ROTATION_MODULES.length;
  const modulePath = ROTATION_MODULES[index];
  const id = `self-review-${moduleSlug(modulePath)}-${week}`;
  const task = buildTask(modulePath, now);
  if (opts.dryRun) {
    return { ok: true, dryRun: true, action: 'would-enqueue', week, index, module: modulePath, queueId: id, priority: ROTATION_PRIORITY };
  }
  const existing = queueEntryAnywhere(queueRoot, ROTATION_AGENT, id);
  const enqueue = existing
    ? { action: 'skipped-existing', via: null, id, existingState: existing.state }
    : await enqueueRotationTask(queueRoot, id, task, opts);
  const next = Object.assign({}, state, {
    nextIndex: (index + 1) % ROTATION_MODULES.length,
    lastWeek: week,
    lastModule: modulePath,
    lastQueueId: id,
    lastRunAt: new Date(now).toISOString(),
  });
  next.history = state.history.concat([{
    week,
    module: modulePath,
    queueId: id,
    via: enqueue.via,
    action: enqueue.action,
    at: new Date(now).toISOString(),
  }]).slice(-52);
  writeJsonAtomic(stateFile, next);
  appendEvent('self_review.rotation', {
    week,
    module: modulePath,
    queueId: id,
    agent: ROTATION_AGENT,
    priority: ROTATION_PRIORITY,
    via: enqueue.via,
    action: enqueue.action,
  }, opts.eventsFile);
  return {
    ok: true,
    skipped: false,
    week,
    index,
    module: modulePath,
    queueId: id,
    agent: ROTATION_AGENT,
    priority: ROTATION_PRIORITY,
    enqueue,
    nextModule: ROTATION_MODULES[next.nextIndex],
  };
}

function hasFlag(args, flag) { return args.includes(flag); }
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const args = process.argv.slice(2);
  const enabled = !/^(0|false|off|no)$/i.test(String(process.env.SELF_REVIEW_ROTATION_ENABLED == null ? '1' : process.env.SELF_REVIEW_ROTATION_ENABLED));
  if (!enabled) {
    process.stdout.write(JSON.stringify({ ok: true, action: 'skipped', reason: 'SELF_REVIEW_ROTATION_ENABLED=0' }) + '\n');
    return;
  }
  if (hasFlag(args, '--list')) {
    const state = readState();
    process.stdout.write(JSON.stringify({
      modules: ROTATION_MODULES,
      nextIndex: state.nextIndex,
      nextModule: ROTATION_MODULES[state.nextIndex],
      lastWeek: state.lastWeek,
      lastModule: state.lastModule,
      history: state.history.slice(-8),
    }, null, 2) + '\n');
    return;
  }
  const delayMs = Math.max(0, Number(argValue(args, '--delay-ms') || 0));
  if (delayMs > 0) await sleep(delayMs);
  const nowRaw = argValue(args, '--now');
  const now = nowRaw ? (Number(nowRaw) || Date.parse(nowRaw) || Date.now()) : Date.now();
  const out = await run({
    now,
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
  });
  if (hasFlag(args, '--json')) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else if (out.skipped) process.stdout.write(`[self-review-rotation] ${out.week} 已跑过(${out.lastModule}),幂等跳过;下一个模块 ${out.nextModule}\n`);
  else if (out.dryRun) process.stdout.write(`[self-review-rotation] dry-run ${out.week} 将入队 ${out.module} -> ${out.queueId}(priority ${out.priority})\n`);
  else process.stdout.write(`[self-review-rotation] ${out.week} 入队 ${out.module} -> ${out.queueId}(${out.enqueue.action} via ${out.enqueue.via || 'n/a'});下一个模块 ${out.nextModule}\n`);
}

if (require.main === module) {
  main().catch(e => {
    process.stderr.write(String(e && e.stack || e).slice(0, 4000) + '\n');
    process.exit(1);
  });
}

module.exports = {
  ROTATION_MODULES,
  ROTATION_AGENT,
  ROTATION_PRIORITY,
  STATE_FILE,
  isoWeekKey,
  moduleSlug,
  buildTask,
  readState,
  queueEntryAnywhere,
  run,
};
