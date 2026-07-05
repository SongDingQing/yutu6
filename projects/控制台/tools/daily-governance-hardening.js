#!/usr/bin/env node
'use strict';

/*
 * daily-governance-hardening.js
 * 每日定时(北京时间凌晨5点 = Asia/Shanghai 05:00,launchd StartCalendarInterval 走本机本地时区)
 * 做四件事:
 *   1. 幂等投递 governance 每日复盘任务。
 *   2. 本机执行稳定性硬化 smoke/资源检查并写 `knowledge/归档/硬化建议-YYYYMMDD.md`。
 *   3. 审计复盘/硬化归档和 memory 是否真实落地,再飞书汇报"具体改进了什么"。
 *   4. 错峰(默认 +30 分钟,≈05:30)触发端到端金丝雀 tools/e2e-canary.js(拍板 Q6;避开 05:00 惊群)。
 *      开关:DGH_CANARY_ENABLED=0 / --no-canary 关闭;DGH_CANARY_DELAY_MS / --canary-delay-ms 调延迟。
 *   5. 周日(北京日历日 getDay()===0)加触发两件周治理(拍板 Q8/Q10),均 detached 错峰:
 *      - 公告板周清算 tools/bulletin-weekly-cleanup.js --apply(+45min ≈05:45);
 *      - 自省优化轮换 tools/self-review-rotation.js(+60min ≈06:00,同周自幂等)。
 *      开关:DGH_WEEKLY_CLEANUP_ENABLED / DGH_SELF_REVIEW_ROTATION_ENABLED(默认开),--no-weekly 跳过两者;
 *      延迟:DGH_WEEKLY_CLEANUP_DELAY_MS / DGH_SELF_REVIEW_DELAY_MS(或 --weekly-cleanup-delay-ms / --self-review-delay-ms)。
 *
 * 不重复触发:用「北京日期」拼确定性 id(gov-review-YYYYMMDD / qops-harden-YYYYMMDD),
 * 投递前扫描该 agent 全部状态目录(queued/running/paused/done/failed/canceled),
 * 命中即跳过。飞书汇报按标题+正文 hash 去重,内容变化时允许补发。
 *
 * 红线:Starlaid 一律排除;密钥不回显;只做本机 smoke/归档/通知,不做特权修复/不可逆操作。
 *
 * 用法:
 *   node tools/daily-governance-hardening.js
 *   node tools/daily-governance-hardening.js --json
 *   node tools/daily-governance-hardening.js --dry-run
 *   node tools/daily-governance-hardening.js --date 20260622
 *   node tools/daily-governance-hardening.js --audit-only --date 20260622
 *   node tools/daily-governance-hardening.js --no-notify --audit-wait-ms 0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');                 // projects/控制台
const WORKDIR = path.resolve(ROOT, '../..');                // 工作区根
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const ARCHIVE_DIR = process.env.DGH_ARCHIVE_DIR
  ? path.resolve(process.env.DGH_ARCHIVE_DIR)
  : path.join(WORKDIR, 'knowledge', '归档');
const MEMORY_DIR = process.env.DGH_MEMORY_DIR
  ? path.resolve(process.env.DGH_MEMORY_DIR)
  : path.join(WORKDIR, 'memory');
const REPORT_DIR = path.join(QUEUE_ROOT, 'daily-governance-hardening');
const Q = require(path.join(WORKDIR, 'shared', 'engine', 'queue'));
const DailyIgnition = require(path.join(ROOT, 'daily-ignition'));

const ARGS = process.argv.slice(2);
const JSON_OUT = hasFlag('--json');
const DRY_RUN = hasFlag('--dry-run');
const AUDIT_ONLY = hasFlag('--audit-only');
const NO_AUDIT = hasFlag('--no-audit');
const NO_NOTIFY = hasFlag('--no-notify');
const SKIP_LOCAL_HARDENING = hasFlag('--skip-local-hardening');
const FORCE_NOTIFY = hasFlag('--force-notify');
const AUDIT_WAIT_MS = numericArg('--audit-wait-ms', Number(process.env.DGH_AUDIT_WAIT_MS || 45 * 60 * 1000));
const AUDIT_INTERVAL_MS = numericArg('--audit-interval-ms', Number(process.env.DGH_AUDIT_INTERVAL_MS || 30 * 1000));
const COMMAND_TIMEOUT_MS = numericArg('--command-timeout-ms', Number(process.env.DGH_COMMAND_TIMEOUT_MS || 12 * 60 * 1000));
const DAILY_STAGGER_SCALE_MS = numericArg('--stagger-scale-ms', Number(process.env.DGH_STAGGER_SCALE_MS || 60 * 1000));
// 端到端金丝雀(拍板 Q6):跟随 daily 节律,但错峰 +30 分钟(≈05:30),避开 05:00 惊群(memory/decisions.md 既有教训)。
// env 开关:DGH_CANARY_ENABLED=0 或 --no-canary 关闭;DGH_CANARY_DELAY_MS / --canary-delay-ms 调错峰延迟。
const NO_CANARY = hasFlag('--no-canary');
const CANARY_ENABLED = !NO_CANARY && !/^(0|false|off|no)$/i.test(String(process.env.DGH_CANARY_ENABLED == null ? '1' : process.env.DGH_CANARY_ENABLED));
const CANARY_DELAY_MS = numericArg('--canary-delay-ms', Number(process.env.DGH_CANARY_DELAY_MS || 30 * 60 * 1000));
// 周日治理钩子(拍板 Q8/Q10):公告板周清算 +45min(≈05:45)、自省优化轮换 +60min(≈06:00),
// 都错开 05:00 惊群和 05:30 金丝雀。开关:DGH_WEEKLY_CLEANUP_ENABLED / DGH_SELF_REVIEW_ROTATION_ENABLED(默认开),
// --no-weekly 一次性跳过两者。两个工具各自同周/同日幂等,detached 触发不阻塞每日收口。
const NO_WEEKLY = hasFlag('--no-weekly');
const envOn = (value, fallback = '1') => !/^(0|false|off|no)$/i.test(String(value == null ? fallback : value));
const WEEKLY_CLEANUP_ENABLED = !NO_WEEKLY && envOn(process.env.DGH_WEEKLY_CLEANUP_ENABLED);
const SELF_REVIEW_ROTATION_ENABLED = !NO_WEEKLY && envOn(process.env.DGH_SELF_REVIEW_ROTATION_ENABLED);
const WEEKLY_CLEANUP_DELAY_MS = numericArg('--weekly-cleanup-delay-ms', Number(process.env.DGH_WEEKLY_CLEANUP_DELAY_MS || 45 * 60 * 1000));
const SELF_REVIEW_DELAY_MS = numericArg('--self-review-delay-ms', Number(process.env.DGH_SELF_REVIEW_DELAY_MS || 60 * 60 * 1000));
const MIN_ARCHIVE_BYTES = 512;
const REPAIR_TICKETS_DIR = path.join(WORKDIR, 'board', 'repair-tickets');

function hasFlag(flag) {
  return ARGS.includes(flag);
}

function argValue(flag) {
  const i = ARGS.indexOf(flag);
  return i >= 0 ? ARGS[i + 1] : null;
}

function numericArg(flag, fallback) {
  const raw = argValue(flag);
  const n = raw == null ? Number(fallback) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function prettyDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

// 北京日期 YYYYMMDD —— 不依赖本机时区设置,显式按 Asia/Shanghai 取日。
function beijingDate() {
  const override = argValue('--date');
  if (override && /^\d{8}$/.test(override)) return override;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts.replace(/-/g, ''); // YYYY-MM-DD -> YYYYMMDD
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function fileInfo(file) {
  try {
    const st = fs.statSync(file);
    return { exists: true, bytes: st.size, mtime: st.mtime.toISOString() };
  } catch (_) {
    return { exists: false, bytes: 0, mtime: null };
  }
}

function rel(file) {
  const r = path.relative(WORKDIR, file).split(path.sep).join('/');
  return r && !r.startsWith('..') ? r : file;
}

function sanitizeOutput(text, max = 3000) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(-max);
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

// 该 agent 是否已存在某 id 的任务(任意状态)—— 幂等护栏。
function alreadyQueued(agent, id, queueRoot = QUEUE_ROOT) {
  const d = Q.qdir(queueRoot, agent);
  const suffix = `-${id}.json`;
  const dirs = ['', 'running', 'paused', 'done', 'failed', 'canceled'];
  for (const sub of dirs) {
    const dir = path.join(d, sub);
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { continue; }
    const hit = files.find(f => f.endsWith(suffix) || f === id + '.json'); // running/paused 用 <id>.json
    if (hit) return { state: sub || 'queued', file: path.join(dir, hit) };
  }
  return null;
}

function jobs(DATE) {
  const pretty = prettyDate(DATE);
  return [
    {
      agent: 'governance',
      id: `gov-review-${DATE}`,
      priority: 40,
      staggerMinutes: 0,
      task: {
        role: 'governance',
        flowId: 'agent-once',
        projectId: '控制台',
        scopedToProject: true,
        title: `每日复盘 ${pretty}`,
        idem: `daily-governance:${DATE}`,
        useOrchestrator: false,
        autoApproveHuman: true,
        nodeTimeoutSec: 1500,
        bounds: 'Starlaid 一律排除;密钥/token 不回显不写盘;登录/授权交主人;不替 CEO 拆解目标、不抢维修员修复;只复盘+经验沉淀,不做不可逆删除或权限放大。',
        acceptance: '产出 knowledge/归档/复盘-' + DATE + '.md(当天问题/根因/维修结果/防复发规则/未闭环);经验追加 memory/experience.md(注明日期);最后输出结构化 JSON。',
        goal: [
          `你是监管/复盘智能体的【每日定时复盘】任务(北京时间凌晨5点触发,日期 ${pretty})。`,
          '',
          '红线(L0):Starlaid 一律排除,不读取/评估/修改;密钥/token/cookie 不回显不写盘;登录/授权交主人;不做不可逆删除或权限放大;不替 CEO 拆解目标,不抢维修员修复。',
          '',
          '目标:对过去约 24 小时做系统复盘,并把经验沉淀进 memory。复盘必须有事实、有根因、有未闭环缺口,不能只写空泛总结。',
          '',
          '步骤:',
          '1. 汇总当天问题与维修,阅读:',
          '   - projects/控制台/artifacts/engine-events.jsonl(当天 task.failed / error / 重试)',
          '   - board/repair-tickets/(当天维修工单与结案)',
          '   - board/status-rollup.md、board/decisions.md、board/progress.md(当天变更)',
          '2. 复盘:对反复失败/重大问题做根因分析与防复发规则。',
          `3. 写复盘归档 knowledge/归档/复盘-${DATE}.md(当天问题清单、根因、维修结果、防复发规则、未闭环缺口)。`,
          `4. 经验沉淀到 memory:把可复用教训/防复发规则追加到 memory/experience.md;新长期决策追加 memory/decisions.md;新实体/术语更新 memory/entities.md。每条注明日期 ${pretty}。`,
          '5. 只复盘+沉淀,不执行业务修复。',
          '',
          '最后输出 JSON:',
          '```json',
          `{"governance":{"done":true,"date":"${pretty}","problems":0,"archived":"knowledge/归档/复盘-${DATE}.md","memory_updated":["experience.md"]}}`,
          '```',
        ].join('\n'),
      },
    },
    {
      agent: 'quality_ops',
      id: `qops-harden-${DATE}`,
      priority: 45,
      staggerMinutes: 6,
      task: {
        role: 'quality_ops',
        flowId: 'agent-once',
        projectId: '控制台',
        scopedToProject: true,
        title: `每日稳定性硬化复核 ${pretty}`,
        idem: `daily-quality-ops:${DATE}`,
        useOrchestrator: false,
        autoApproveHuman: true,
        nodeTimeoutSec: 1200,
        bounds: 'Starlaid 一律排除;密钥不回显;不做特权维修/不可逆操作;只提可回退硬化建议,不直接改核心引擎(高危改动开维修工单交主人/维修员)。',
        acceptance: '复核 daily-governance-hardening 本机写出的 knowledge/归档/硬化建议-' + DATE + '.md;若当前 runner 无文件系统/命令能力,必须明确 done=false,不能把执行清单或骨架当作已硬化。',
        goal: [
          `你是质量运营/硬化智能体的【每日定时稳定性硬化复核】任务(北京时间凌晨5点触发,日期 ${pretty})。`,
          '',
          '重要:本机可执行 smoke/资源检查由 daily-governance-hardening 工具负责,工具会写 knowledge/归档/硬化建议-' + DATE + '.md 并做产物审计。你负责复核硬化思路、补充可回退建议,不要声称自己执行了无法执行的命令。',
          '',
          '红线(L0):Starlaid 一律排除;密钥不回显;不做特权维修/不可逆操作;只提可回退的硬化建议,不直接改核心引擎(高危改动交主人/维修员)。',
          '',
          '复核重点:',
          `1. 查看 knowledge/归档/硬化建议-${DATE}.md 是否有真实 smoke 结果、资源检查和回退建议。`,
          '2. 如果能访问事件日志,从 events*.jsonl 找高重复、确定性的动作序列,提出可回退硬化方案。',
          '3. 如果当前 runner 不能访问文件系统/不能执行命令,必须如实输出 done=false,reason=runner_no_fs_or_exec,不要输出 done=true。',
          '',
          '最后输出 JSON:',
          '```json',
          `{"quality_ops":{"done":true,"date":"${pretty}","reviewed":"knowledge/归档/硬化建议-${DATE}.md","hardening_count":0}}`,
          '```',
        ].join('\n'),
      },
    },
  ];
}

function dailyJobSchedule(job, date) {
  const minutes = Math.max(0, Number(job.staggerMinutes || 0));
  return {
    date,
    baseBeijingTime: '05:00',
    staggerMinutes: minutes,
    plannedBeijingTime: `05:${String(minutes).padStart(2, '0')}`,
    reason: 'daily-same-ignition-stagger',
  };
}

function enqueueOneDailyJob(job, DATE, opts = {}) {
  const existing = alreadyQueued(job.agent, job.id, opts.queueRoot || QUEUE_ROOT);
  const schedule = dailyJobSchedule(job, DATE);
  if (existing) {
    return { agent: job.agent, id: job.id, action: 'skipped', reason: `already ${existing.state}`, schedule };
  }
  if (opts.dryRun) {
    return { agent: job.agent, id: job.id, action: 'would-enqueue', priority: job.priority, schedule };
  }
  const task = Object.assign({}, job.task, { dailySchedule: schedule });
  const entry = Q.enqueue(opts.queueRoot || QUEUE_ROOT, job.agent, task, {
    id: job.id, priority: job.priority, idem: job.task.idem,
  });
  return { agent: job.agent, id: entry.id, action: 'enqueued', priority: entry.priority, seq: entry.seq, schedule };
}

function enqueueDailyJobs(DATE, opts = {}) {
  const results = [];
  for (const job of jobs(DATE)) {
    results.push(enqueueOneDailyJob(job, DATE, opts));
  }
  return results;
}

async function enqueueDailyJobsStaggered(DATE, opts = {}) {
  const results = [];
  const scaleMs = Math.max(0, Number(opts.staggerScaleMs == null ? DAILY_STAGGER_SCALE_MS : opts.staggerScaleMs));
  const started = Date.now();
  for (const job of jobs(DATE)) {
    const delayMs = Math.max(0, Number(job.staggerMinutes || 0) * scaleMs - (Date.now() - started));
    if (!opts.dryRun && delayMs > 0) await sleep(delayMs);
    results.push(enqueueOneDailyJob(job, DATE, opts));
  }
  return results;
}

// 端到端金丝雀触发:detached 子进程 + e2e-canary 自带 --delay-ms 睡眠实现错峰,
// 不阻塞本脚本的硬化/审计收口;金丝雀同日绿结果自幂等(见 tools/e2e-canary.js)。
function canarySchedule(DATE, delayMs) {
  const minutes = Math.max(0, Math.round(Number(delayMs || 0) / 60000));
  const totalMinutes = 5 * 60 + minutes;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return {
    date: DATE,
    baseBeijingTime: '05:00',
    staggerMinutes: minutes,
    plannedBeijingTime: `${hh}:${mm}`,
    reason: 'canary-stagger-avoid-0500-ignition',
  };
}

function triggerCanary(DATE, opts = {}) {
  const enabled = opts.enabled == null ? CANARY_ENABLED : !!opts.enabled;
  const delayMs = Math.max(0, Number(opts.delayMs == null ? CANARY_DELAY_MS : opts.delayMs));
  const schedule = canarySchedule(DATE, delayMs);
  if (!enabled) return { triggered: false, action: 'skipped', reason: opts.reason || 'canary-disabled', schedule };
  const script = path.join(__dirname, 'e2e-canary.js');
  const args = [script, '--date', prettyDate(DATE), '--delay-ms', String(delayMs)];
  if (opts.dryRun) {
    return { triggered: false, action: 'would-trigger', command: ['node'].concat(args.map(rel)).join(' '), delayMs, schedule };
  }
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, args, {
    cwd: WORKDIR,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return { triggered: true, action: 'spawned-detached', pid: child.pid, delayMs, schedule };
}

// 周日判定:DATE 为北京日历日 YYYYMMDD,用 UTC 构造该日历日再取星期,不受本机时区影响。
function beijingWeekday(DATE) {
  const y = Number(DATE.slice(0, 4));
  const m = Number(DATE.slice(4, 6));
  const d = Number(DATE.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = 周日
}

function weeklySchedule(DATE, delayMs, reason) {
  const minutes = Math.max(0, Math.round(Number(delayMs || 0) / 60000));
  const totalMinutes = 5 * 60 + minutes;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return {
    date: DATE,
    baseBeijingTime: '05:00',
    staggerMinutes: minutes,
    plannedBeijingTime: `${hh}:${mm}`,
    reason: reason || 'weekly-governance-stagger',
  };
}

// 周日治理钩子(拍板 Q8/Q10):detached 触发公告板周清算 + 自省优化轮换,
// 各自带 --delay-ms 睡眠错峰,不阻塞每日收口;两工具自身同日/同周幂等。
function triggerWeeklyGovernance(DATE, opts = {}) {
  const weekday = opts.weekday == null ? beijingWeekday(DATE) : Number(opts.weekday);
  const specs = [
    {
      name: 'bulletin-weekly-cleanup',
      script: 'bulletin-weekly-cleanup.js',
      extraArgs: ['--apply'],
      enabled: opts.cleanupEnabled == null ? WEEKLY_CLEANUP_ENABLED : !!opts.cleanupEnabled,
      delayMs: Math.max(0, Number(opts.cleanupDelayMs == null ? WEEKLY_CLEANUP_DELAY_MS : opts.cleanupDelayMs)),
      reason: 'weekly-bulletin-cleanup-stagger',
    },
    {
      name: 'self-review-rotation',
      script: 'self-review-rotation.js',
      extraArgs: [],
      enabled: opts.rotationEnabled == null ? SELF_REVIEW_ROTATION_ENABLED : !!opts.rotationEnabled,
      delayMs: Math.max(0, Number(opts.rotationDelayMs == null ? SELF_REVIEW_DELAY_MS : opts.rotationDelayMs)),
      reason: 'weekly-self-review-rotation-stagger',
    },
  ];
  if (weekday !== 0) {
    return { isSunday: false, weekday, action: 'skipped', reason: 'not-sunday', jobs: [] };
  }
  const jobs = specs.map(spec => {
    const schedule = weeklySchedule(DATE, spec.delayMs, spec.reason);
    if (!spec.enabled) {
      return { name: spec.name, action: 'skipped', reason: 'disabled', schedule };
    }
    const args = [path.join(__dirname, spec.script)].concat(spec.extraArgs, ['--delay-ms', String(spec.delayMs)]);
    if (opts.dryRun) {
      return { name: spec.name, action: 'would-trigger', command: ['node'].concat(args.map(rel)).join(' '), delayMs: spec.delayMs, schedule };
    }
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, args, {
      cwd: WORKDIR,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return { name: spec.name, action: 'spawned-detached', pid: child.pid, delayMs: spec.delayMs, schedule };
  });
  return { isSunday: true, weekday, action: 'triggered', jobs };
}

function hardeningCommands() {
  return [
    { name: 'mechanisms-smoke', args: ['projects/控制台/tools/mechanisms-smoke-test.js'] },
    { name: 'resource-locks-smoke', args: ['projects/控制台/tools/resource-locks-smoke-test.js'] },
    { name: 'project-guard-smoke', args: ['projects/控制台/tools/project-guard-smoke-test.js'] },
    { name: 'serial-smoke', args: ['projects/控制台/tools/serial-smoke-test.js'] },
    { name: 'long-run-maintenance', args: ['projects/控制台/tools/long-run-maintenance.js', '--json'] },
  ];
}

function runNodeCommand(command, opts = {}) {
  const started = Date.now();
  const res = spawnSync(process.execPath, command.args, {
    cwd: WORKDIR,
    env: Object.assign({}, process.env, {
      AUTO_REPAIR_ENABLED: process.env.AUTO_REPAIR_ENABLED || '0',
    }),
    encoding: 'utf8',
    timeout: opts.timeoutMs || COMMAND_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  return {
    name: command.name,
    command: ['node'].concat(command.args).join(' '),
    pass: res.status === 0 && !res.error && !res.signal,
    code: res.status,
    signal: res.signal || null,
    durationMs,
    stdoutTail: sanitizeOutput(res.stdout || '', 1800).trim(),
    stderrTail: sanitizeOutput(res.stderr || '', 1800).trim(),
    error: res.error ? sanitizeOutput(res.error.message, 500) : null,
  };
}

function eventCountsSince(eventsFile, sinceMs) {
  return eventSummarySince(eventsFile, sinceMs).counts;
}

function eventSummarySince(eventsFile, sinceMs) {
  const counts = {};
  const dailyIgnition = [];
  const text = readText(eventsFile);
  if (!text) return { counts, dailyIgnition };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    const at = Date.parse(ev.at || ev.time || ev.ts || '');
    if (sinceMs && at && at < sinceMs) continue;
    const type = String(ev.type || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
    if (type === 'resource.scheduler.all_blocked' || type === 'worker-heartbeat-stale') {
      const attr = ev.dailyIgnitionAttribution || DailyIgnition.dailyIgnitionAttribution(at || Date.now());
      if (attr && attr.inWindow) {
        dailyIgnition.push({
          type,
          seq: ev.seq == null ? null : ev.seq,
          ts: ev.ts || ev.at || ev.time || null,
          queueAgent: ev.queueAgent || null,
          queueId: ev.queueId || null,
          reason: ev.reason || attr.reason,
          beijingTime: attr.beijingTime || null,
        });
      }
    }
  }
  return { counts, dailyIgnition };
}

function queueSnapshot(queueRoot = QUEUE_ROOT) {
  const agents = ['ceo', 'supervisor-控制台', 'governance', 'quality_ops', 'repair', 'worker_code', 'it_engineer'];
  const out = [];
  for (const agent of agents) {
    try {
      const item = Q.list(queueRoot, agent);
      out.push({
        agent,
        queued: item.queued.length,
        running: item.running.length,
        paused: item.paused.length,
        done: item.done,
        failed: item.failed,
        canceled: item.canceled,
      });
    } catch (_) {}
  }
  return out;
}

function markdownTable(rows) {
  return rows.join('\n');
}

function writeHardeningArchive(DATE, hardening, opts = {}) {
  const archiveDir = opts.archiveDir || ARCHIVE_DIR;
  const pretty = prettyDate(DATE);
  const file = path.join(archiveDir, `硬化建议-${DATE}.md`);
  const tests = hardening.tests || [];
  const failures = tests.filter(t => !t.pass);
  const maintenance = tests.find(t => t.name === 'long-run-maintenance');
  const eventCounts = hardening.eventCounts || {};
  const dailyIgnition = hardening.dailyIgnition || [];
  const smokeRepairRows = hardening.smokeRepairTickets && hardening.smokeRepairTickets.failures || [];
  const topEvents = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `- ${k}: ${v}`);
  const queueRows = (hardening.queues || []).map(q => `| ${q.agent} | ${q.queued} | ${q.running} | ${q.paused} | ${q.failed} |`);
  const body = [
    `# 硬化建议归档 · ${pretty}`,
    '',
    '> daily-governance-hardening 本机执行器产出。只做可回退 smoke/资源检查/建议,不做特权维修或不可逆操作。',
    '> 红线遵守:Starlaid 排除;无密钥回显;未处理登录/授权。',
    '',
    '## 1. Smoke / 自测结果',
    '',
    '| 用例 | pass | code | 耗时(ms) | 摘要 |',
    '|------|------|------|----------|------|',
    ...tests.map(t => `| ${t.name} | ${t.pass ? 'true' : 'false'} | ${t.code == null ? '' : t.code} | ${t.durationMs} | ${oneLine(t.stderrTail || t.stdoutTail || t.error || 'ok', 90)} |`),
    '',
    `结论:${failures.length ? `有 ${failures.length} 个检查失败,需要维修员/主管复核。` : '本轮 smoke 全部通过,硬化链路有实测证据。'}`,
    '',
    '## 2. 资源与队列检查',
    '',
    maintenance
      ? `- long-run-maintenance:${maintenance.pass ? 'pass' : 'fail'}; 摘要:${oneLine(maintenance.stdoutTail || maintenance.stderrTail || '', 160)}`
      : '- long-run-maintenance:未执行',
    '',
    '| 队列 | queued | running | paused | failed |',
    '|------|--------|---------|--------|--------|',
    ...queueRows,
    '',
    '## 3. 24h 事件概况',
    '',
    topEvents.length ? topEvents.join('\n') : '- 未读取到事件日志或窗口内无事件。',
    '',
    '### 05:00 daily 同点火归因',
    '',
    dailyIgnition.length
      ? dailyIgnition.slice(0, 12).map(ev => `- ${ev.type} seq=${ev.seq == null ? 'n/a' : ev.seq} ts=${ev.ts || 'n/a'} queue=${ev.queueAgent || 'n/a'}/${ev.queueId || 'n/a'} beijing=${ev.beijingTime || 'n/a'}`).join('\n')
      : '- 过去 24h 未发现 resource.scheduler.all_blocked / worker-heartbeat-stale 落在 05:00±10 分钟同点火窗。',
    '',
    '### smoke 失败有效工单检查',
    '',
    smokeRepairRows.length
      ? smokeRepairRows.map(row => `- ${row.name}: ${row.ok ? 'ok' : 'missing-effective-ticket'}; effective=${row.effectiveTickets.length}; ignored=${row.ignoredTickets.length}; created=${row.createdTicketId || 'none'}`).join('\n')
      : '- 本轮 smoke 全绿,无需创建专项维修工单。',
    '',
    '## 4. 可回退硬化建议',
    '',
    failures.length
      ? failures.map((t, idx) => [
        `### H-${idx + 1} ${t.name} 失败收口`,
        `- 模式:${t.name} smoke 失败`,
        '- 风险:medium',
        '- 建议:开维修工单或交主管复核失败输出;不要在 daily 脚本内直接特权修复。',
        '- 回退方式:修复后重新运行本脚本 `--audit-only --date ' + DATE + '` 复验。',
      ].join('\n')).join('\n\n')
      : [
        '### H-1 每日硬化产物审计',
        '- 模式:过去只看 queue done,会把"无法执行命令的方案骨架"误判为硬化完成。',
        '- 改进:daily-governance-hardening 现在本机执行 smoke,并要求硬化归档真实存在且非骨架,否则飞书汇报直接标缺口。',
        '- 风险:low',
        '- 回退方式:设置 `--skip-local-hardening` 仅跳过本机硬化执行,保留审计和汇报。',
        '',
        '### H-2 复盘后飞书具体汇报',
        '- 模式:复盘归档存在但老板收不到"具体改进了什么"。',
        '- 改进:每日收口从复盘/硬化/status-rollup 提取具体条目并通过 Feishu 汇报,内容 hash 去重。',
        '- 风险:low',
        '- 回退方式:设置 `--no-notify` 仅写审计记录不发送。',
      ].join('\n'),
    '',
    '## 5. 验收清单',
    '',
    `- [${failures.length ? ' ' : 'x'}] 本机 smoke 有真实执行结果`,
    `- [${failures.length ? ' ' : 'x'}] 硬化归档非空、非骨架`,
    '- [x] 每条硬化建议带风险和回退方式',
    '- [x] Starlaid 排除、密钥未回显',
    '',
  ].join('\n');
  if (!opts.dryRun) {
    ensureDir(archiveDir);
    fs.writeFileSync(file, body);
  }
  return { file, rel: rel(file), bytes: Buffer.byteLength(body), failures: failures.map(t => t.name) };
}

function oneLine(text, max = 120) {
  return clip(String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '/')
    .trim(), max);
}

function clip(text, max = 120) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}

function runLocalHardening(DATE, opts = {}) {
  if (opts.skip) return { skipped: true, reason: 'skip-local-hardening' };
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const tests = [];
  if (!opts.dryRun) {
    for (const command of hardeningCommands()) tests.push(runNodeCommand(command, opts));
  } else {
    for (const command of hardeningCommands()) {
      tests.push({
        name: command.name,
        command: ['node'].concat(command.args).join(' '),
        pass: null,
        code: null,
        signal: null,
        durationMs: 0,
        stdoutTail: 'dry-run',
        stderrTail: '',
        error: null,
      });
    }
  }
  const summary = eventSummarySince(path.join(opts.queueRoot || QUEUE_ROOT, 'engine-events.jsonl'), sinceMs);
  const smokeRepairTickets = auditSmokeFailureRepairTickets(DATE, tests.filter(t => !t.pass), opts);
  const hardening = {
    skipped: false,
    dryRun: !!opts.dryRun,
    tests,
    eventCounts: summary.counts,
    dailyIgnition: summary.dailyIgnition,
    smokeRepairTickets,
    queues: queueSnapshot(opts.queueRoot || QUEUE_ROOT),
  };
  hardening.archive = writeHardeningArchive(DATE, hardening, opts);
  hardening.pass = tests.every(t => t.pass === true);
  return hardening;
}

function isPlaceholderArchive(text) {
  const s = String(text || '');
  const tbdCount = (s.match(/\bTBD\b|待执行|skeleton_only|无法真实执行|不能访问文件系统|归档骨架|占位归档/g) || []).length;
  return tbdCount >= 2;
}

function archiveEvidence(file, minBytes = MIN_ARCHIVE_BYTES) {
  const info = fileInfo(file);
  const text = info.exists ? readText(file) : '';
  const placeholder = info.exists ? isPlaceholderArchive(text) : false;
  return Object.assign({}, info, {
    path: file,
    rel: rel(file),
    ok: info.exists && info.bytes >= minBytes && !placeholder,
    placeholder,
  });
}

function readRepairTickets(dir = REPAIR_TICKETS_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(name => /\.md$/.test(name)); } catch (_) { return []; }
  return files.map(name => {
    const file = path.join(dir, name);
    const text = readText(file);
    const statusMatches = Array.from(text.matchAll(/^\s*-\s*status:\s*([A-Za-z_-]+)/gmi));
    const status = statusMatches.length ? statusMatches[statusMatches.length - 1][1] : 'unknown';
    return {
      id: name.replace(/\.md$/, ''),
      file,
      rel: rel(file),
      status,
      text,
    };
  });
}

function smokeFailureNeedle(failure) {
  const text = [failure && failure.name, failure && failure.command, failure && failure.stderrTail, failure && failure.stdoutTail, failure && failure.error]
    .filter(Boolean)
    .join('\n');
  if (/mechanisms-smoke|checkAutoOptimizer|auto optimizer|AUTO_OPTIMIZER/i.test(text)) return 'mechanisms-smoke';
  return String(failure && failure.name || 'smoke-failure').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48) || 'smoke-failure';
}

function ticketMentionsFailure(ticket, failure, needle) {
  const hay = String(ticket && ticket.text || '');
  const command = String(failure && failure.command || '');
  const name = String(failure && failure.name || '');
  return hay.includes(needle)
    || (name && hay.includes(name))
    || (command && hay.includes(command))
    || (/mechanisms-smoke/.test(needle) && /mechanisms-smoke|checkAutoOptimizer|AUTO_OPTIMIZER/.test(hay));
}

function ticketHasRerunGreen(ticket) {
  const text = String(ticket && ticket.text || '');
  return /(复跑绿|复跑.*PASS|smoke.*PASS|exit\s+0|code=0|退出码\s*0|全部通过)/i.test(text);
}

function ticketIsResidualDebtClosure(ticket) {
  const text = String(ticket && ticket.text || '');
  return /^done$/i.test(String(ticket && ticket.status || ''))
    && /(残余测试债|残余债|不相关|与本次无关|另行处理|遗留债)/.test(text)
    && !ticketHasRerunGreen(ticket);
}

function effectiveRepairTicketsForFailure(failure, opts = {}) {
  const needle = smokeFailureNeedle(failure);
  const tickets = readRepairTickets(opts.repairDir || REPAIR_TICKETS_DIR)
    .filter(ticket => ticketMentionsFailure(ticket, failure, needle));
  const ignored = tickets.filter(ticketIsResidualDebtClosure);
  const effective = tickets.filter(ticket => {
    if (ticketIsResidualDebtClosure(ticket)) return false;
    if (!/^done$/i.test(String(ticket.status || ''))) return true;
    return ticketHasRerunGreen(ticket);
  });
  return { needle, tickets, ignored, effective };
}

function createSmokeFailureRepairTicket(date, failure, audit, opts = {}) {
  if (opts.dryRun || opts.noAutoRepair || opts.disableAutoRepair) {
    return { created: false, dryRun: !!opts.dryRun, reason: opts.dryRun ? 'dry-run' : 'auto-repair-disabled' };
  }
  const fingerprint = crypto.createHash('sha256').update([
    date,
    failure && failure.name || '',
    failure && failure.command || '',
    failure && failure.stderrTail || failure && failure.stdoutTail || failure && failure.error || '',
  ].join('\n')).digest('hex').slice(0, 12);
  const ticketId = `repair-smoke-${date}-${fingerprint}`;
  const ticketFile = path.join(opts.repairDir || REPAIR_TICKETS_DIR, `${ticketId}.md`);
  if (fs.existsSync(ticketFile)) return { created: false, ticketId, reason: 'ticket-exists' };
  const SecretaryTools = require(path.join(ROOT, 'secretary-tools'));
  const problem = [
    `daily-governance-hardening 检测到 ${failure.name} 当前仍红,且没有有效维修工单。`,
    `NR13/NR16 要求当前仍红断言不得只靠残余债/不相关 done 票闭环。`,
  ].join('\n');
  const evidence = [
    `command=${failure.command || failure.name}`,
    `code=${failure.code == null ? 'unknown' : failure.code}`,
    `needle=${audit.needle}`,
    `ignoredTickets=${audit.ignored.map(t => t.rel).join(', ') || 'none'}`,
    `stderrTail=${oneLine(failure.stderrTail || failure.stdoutTail || failure.error || '', 240)}`,
  ].join('\n');
  const created = SecretaryTools.repairTicketAdd({
    id: ticketId,
    title: `smoke 当前仍红专项:${failure.name}`,
    source: 'daily-governance-hardening',
    priority: 'high',
    problem,
    evidence,
    expectation: '读取全量断言,定位失败,归因(回归/环境/真 bug),修复或明确豁免,复跑绿后方可结案。',
    redlines: 'Starlaid 排除;密钥不回显;高危/不可逆操作先给主人确认。',
    skipBulletin: 'true',
  });
  const repairTaskId = `repair-lead-smoke-${date}-${fingerprint}`;
  const existing = alreadyQueued('repair-lead', repairTaskId, opts.queueRoot || QUEUE_ROOT);
  if (!existing) {
    Q.enqueue(opts.queueRoot || QUEUE_ROOT, 'repair-lead', {
      role: 'repair-lead',
      flowId: 'agent-once',
      projectId: '控制台',
      goal: [
        `维修工单 ${ticketId}`,
        `请读取 board/repair-tickets/${ticketId}.md。`,
        `这是 daily-governance-hardening 按 NR13/NR16 自动创建的 smoke 当前仍红专项票。`,
        '先读失败断言和历史 ticket,定位根因,修复/豁免后复跑绿,再 repair-ticket-complete 结案。',
      ].join('\n'),
      bounds: '维修主管特权工单; Starlaid 排除; 密钥不回显; 高危/不可逆操作先给主人确认。',
      acceptance: '必须列出断言定位、根因、修复/豁免、复跑绿证据; 不接受残余债/不相关 done 结案。',
      useOrchestrator: false,
      autoApproveHuman: false,
      engineSlotBypass: true,
      repairTicketId: ticketId,
    }, { id: repairTaskId, priority: 0, idem: `daily-smoke-repair:${ticketId}` });
  }
  return { created: true, ticketId: created.ticket.id, repairQueueId: existing ? existing.file : repairTaskId };
}

function auditSmokeFailureRepairTickets(date, failures, opts = {}) {
  const rows = [];
  for (const failure of failures || []) {
    const audit = effectiveRepairTicketsForFailure(failure, opts);
    let created = null;
    if (!audit.effective.length) created = createSmokeFailureRepairTicket(date, failure, audit, opts);
    rows.push({
      name: failure.name,
      command: failure.command,
      ok: audit.effective.length > 0 || !!(created && created.created),
      needle: audit.needle,
      effectiveTickets: audit.effective.map(t => t.rel),
      ignoredTickets: audit.ignored.map(t => t.rel),
      candidateTickets: audit.tickets.map(t => t.rel),
      createdTicketId: created && created.ticketId || null,
      createResult: created,
    });
  }
  return {
    ok: rows.every(row => row.ok),
    failures: rows,
  };
}

function memoryEvidence(date, opts = {}) {
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const pretty = prettyDate(date);
  const files = ['experience.md', 'decisions.md', 'entities.md'].map(name => {
    const file = path.join(memoryDir, name);
    const text = readText(file);
    const info = fileInfo(file);
    return Object.assign({}, info, {
      name,
      rel: rel(file),
      mentionsDate: text.includes(pretty) || text.includes(date),
    });
  });
  return {
    ok: files.some(f => f.exists && f.mentionsDate),
    files,
  };
}

function triggerEvidence(date, opts = {}) {
  const queueRoot = opts.queueRoot || QUEUE_ROOT;
  const ids = [
    { agent: 'governance', id: `gov-review-${date}` },
    { agent: 'quality_ops', id: `qops-harden-${date}` },
  ];
  const entries = [];
  for (const item of ids) {
    const hit = alreadyQueued(item.agent, item.id, queueRoot);
    if (!hit) {
      entries.push({ agent: item.agent, id: item.id, ok: false, state: 'missing' });
      continue;
    }
    let entry = null;
    try { entry = JSON.parse(fs.readFileSync(hit.file, 'utf8')); } catch (_) {}
    entries.push({
      agent: item.agent,
      id: item.id,
      ok: true,
      state: hit.state,
      enqueued_at: entry && entry.enqueued_at || null,
      started_at: entry && entry.started_at || null,
      finished_at: entry && entry.finished_at || null,
      file: rel(hit.file),
    });
  }
  const gov = entries.find(e => e.agent === 'governance');
  const at = gov && gov.enqueued_at ? new Date(gov.enqueued_at) : null;
  const beijing = at ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at) : null;
  return {
    ok: entries.every(e => e.ok),
    entries,
    beijingTrigger: beijing,
    punctual: !!(beijing && /05:00:/.test(beijing)),
  };
}

function extractLines(text, patterns, limit = 8) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^\s*>/.test(raw)) continue;
    const line = raw.trim().replace(/^[-*]\s*/, '').replace(/^#+\s*/, '');
    if (!line || line.length < 8) continue;
    if (/^(?:\d+\.\s*)?(当天问题清单|根因分析|维修结果与未闭环缺口|防复发规则|结论|执行前置声明|验收清单|可回退硬化建议|硬化建议归档)/.test(line)) continue;
    if (/^H-\d+|^long-run-maintenance:|^模式:|^风险:|^回退方式:/.test(line)) continue;
    if (/^\[[ x]\]/i.test(line)) continue;
    if (/^[|:-]+$/.test(line)) continue;
    if (/^\|/.test(line)) continue;
    if (patterns.some(re => re.test(line))) out.push(clip(line, 160));
    if (out.length >= limit) break;
  }
  return out;
}

function statusRollupItems(date, limit = 8) {
  const pretty = prettyDate(date);
  const text = readText(path.join(WORKDIR, 'board', 'status-rollup.md'));
  return String(text || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(`- ${pretty}`) && /控制台/.test(line))
    .filter(line => !/每日5点复盘\/硬化闭环|daily-governance-hardening/.test(line))
    .slice(0, limit)
    .map(line => clip(line.replace(/^- /, ''), 180));
}

function improvementItems(date, opts = {}) {
  const archiveDir = opts.archiveDir || ARCHIVE_DIR;
  const govText = readText(path.join(archiveDir, `复盘-${date}.md`));
  const hardText = readText(path.join(archiveDir, `硬化建议-${date}.md`));
  const items = []
    .concat(extractLines(hardText, [/改进|smoke|通过|失败|审计|飞书|归档/], 6))
    .concat(statusRollupItems(date, 6))
    .concat(extractLines(govText, [/防复发|根因|维修|未闭环|改进|规则|问题/], 6));
  const seen = new Set();
  return items.filter(item => {
    const key = item.replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function buildReportBody(audit) {
  const concreteItems = [];
  if (audit.archives.hardening.ok) {
    concreteItems.push('硬化补实:本机执行 mechanisms/resource-locks/project-guard/serial smoke 与 long-run-maintenance,并写入硬化归档。');
  }
  if (audit.archives.governance.ok && audit.memory.ok) {
    concreteItems.push('复盘补实:当天问题、维修结果、防复发规则已归档,可复用经验已沉淀到 memory。');
  }
  for (const item of audit.improvements) {
    if (concreteItems.length >= 8) break;
    concreteItems.push(item);
  }
  const lines = [
    `每日5点复盘/硬化收口 · ${audit.prettyDate}`,
    `准点触发: ${audit.trigger.punctual ? '是' : '待确认'}${audit.trigger.beijingTrigger ? `(${audit.trigger.beijingTrigger})` : ''}`,
    `复盘归档: ${audit.archives.governance.ok ? '已产出' : '缺失/无效'} · ${audit.archives.governance.rel}`,
    `硬化归档: ${audit.archives.hardening.ok ? '已产出' : '缺失/无效'} · ${audit.archives.hardening.rel}`,
    `经验沉淀: ${audit.memory.ok ? '已写入 memory' : '未确认'}`,
    '',
    '今天具体改进了什么:',
  ];
  if (concreteItems.length) {
    concreteItems.slice(0, 8).forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
  } else {
    lines.push(audit.effective ? '1. 今日复盘/硬化均完成,但没有提取到新增具体改进项。' : '1. 今日收口不完整,已把缺口列入本条汇报。');
  }
  if (audit.missing.length) {
    lines.push('', '仍需补齐:');
    audit.missing.forEach(item => lines.push(`- ${item}`));
  }
  return lines.join('\n');
}

function auditDailyArtifacts(date, opts = {}) {
  const archiveDir = opts.archiveDir || ARCHIVE_DIR;
  const pretty = prettyDate(date);
  const archives = {
    governance: archiveEvidence(path.join(archiveDir, `复盘-${date}.md`)),
    hardening: archiveEvidence(path.join(archiveDir, `硬化建议-${date}.md`)),
  };
  const memory = memoryEvidence(date, opts);
  const trigger = triggerEvidence(date, opts);
  const missing = [];
  if (!trigger.ok) missing.push('05:00 投递记录缺失或不完整');
  if (!trigger.punctual) missing.push('未确认北京 05:00 准点触发');
  if (!archives.governance.ok) missing.push(`复盘归档无效:${archives.governance.rel}${archives.governance.placeholder ? '(疑似骨架)' : ''}`);
  if (!archives.hardening.ok) missing.push(`硬化归档无效:${archives.hardening.rel}${archives.hardening.placeholder ? '(疑似骨架)' : ''}`);
  if (!memory.ok) missing.push('memory 未确认写入当天经验/决策/实体');
  const audit = {
    ok: missing.length === 0,
    effective: missing.length === 0,
    date,
    prettyDate: pretty,
    at: nowIso(),
    trigger,
    archives,
    memory,
    improvements: improvementItems(date, opts),
    missing,
  };
  audit.title = `每日复盘改进汇报 ${pretty}`;
  audit.body = buildReportBody(audit);
  return audit;
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAudit(date, opts = {}) {
  const waitMs = opts.waitMs == null ? AUDIT_WAIT_MS : opts.waitMs;
  const intervalMs = opts.intervalMs == null ? AUDIT_INTERVAL_MS : opts.intervalMs;
  const deadline = Date.now() + waitMs;
  let audit = auditDailyArtifacts(date, opts);
  while (!audit.effective && waitMs > 0 && Date.now() < deadline) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    audit = auditDailyArtifacts(date, opts);
  }
  return audit;
}

function sendFeishuReport(audit, opts = {}) {
  const stateFile = path.join(opts.reportDir || REPORT_DIR, `report-state-${audit.date}.json`);
  const hash = hashText(audit.title + '\n' + audit.body);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  if (!opts.force && prev && prev.hash === hash && prev.sent) {
    return { ok: true, attempted: false, sent: false, skipped: true, reason: 'same report already sent', hash };
  }
  if (opts.noNotify || opts.dryRun) {
    return { ok: true, attempted: false, sent: false, skipped: true, reason: opts.dryRun ? 'dry-run' : 'no-notify', hash };
  }
  const SecretaryTools = require(path.join(ROOT, 'secretary-tools'));
  const result = SecretaryTools.notify({
    title: audit.title,
    body: audit.body,
    source: 'daily-governance-hardening',
  });
  const state = {
    at: nowIso(),
    hash,
    title: audit.title,
    sent: !!result.sent,
    ok: !!result.ok,
    code: result.code,
    reason: result.sent ? null : (result.stderr || result.stdout || result.error || 'not sent'),
  };
  writeJsonAtomic(stateFile, state);
  return Object.assign({ hash }, result);
}

function appendRunRecord(date, out, opts = {}) {
  if (opts.dryRun) return;
  ensureDir(opts.reportDir || REPORT_DIR);
  fs.appendFileSync(path.join(opts.reportDir || REPORT_DIR, `run-${date}.jsonl`), JSON.stringify(out) + '\n');
}

async function main() {
  const DATE = beijingDate();
  const results = AUDIT_ONLY ? [] : await enqueueDailyJobsStaggered(DATE, {
    dryRun: DRY_RUN,
    staggerScaleMs: DAILY_STAGGER_SCALE_MS,
  });
  const canary = AUDIT_ONLY
    ? { triggered: false, action: 'skipped', reason: 'audit-only' }
    : triggerCanary(DATE, { enabled: CANARY_ENABLED, delayMs: CANARY_DELAY_MS, dryRun: DRY_RUN });
  const weekly = AUDIT_ONLY
    ? { isSunday: null, action: 'skipped', reason: 'audit-only', jobs: [] }
    : triggerWeeklyGovernance(DATE, { dryRun: DRY_RUN });
  const hardening = runLocalHardening(DATE, { dryRun: DRY_RUN, skip: SKIP_LOCAL_HARDENING });
  const audit = NO_AUDIT ? null : await waitForAudit(DATE, {
    waitMs: DRY_RUN ? 0 : AUDIT_WAIT_MS,
    intervalMs: AUDIT_INTERVAL_MS,
  });
  const notify = audit ? sendFeishuReport(audit, { noNotify: NO_NOTIFY, dryRun: DRY_RUN, force: FORCE_NOTIFY }) : null;
  const out = {
    ok: !audit || audit.ok,
    tool: 'daily-governance-hardening',
    beijingDate: DATE,
    dryRun: DRY_RUN,
    auditOnly: AUDIT_ONLY,
    enqueued: results.filter(r => r.action === 'enqueued').length,
    skipped: results.filter(r => r.action === 'skipped').length,
    results,
    canary,
    weekly,
    hardening,
    audit,
    notify,
    at: nowIso(),
  };
  appendRunRecord(DATE, out, { dryRun: DRY_RUN });
  if (JSON_OUT) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const status = audit ? (audit.ok ? 'audit=ok' : `audit=missing(${audit.missing.length})`) : 'audit=skipped';
    process.stdout.write(`[daily-governance-hardening] ${DATE} enqueued=${out.enqueued} skipped=${out.skipped} canary=${canary.action || (canary.triggered ? 'spawned' : 'skipped')} weekly=${weekly.action} ${status}\n`);
  }
}

if (require.main === module) {
  main().catch(e => {
    process.stderr.write(sanitizeOutput(e && e.stack || e, 4000) + '\n');
    process.exit(1);
  });
}

module.exports = {
  beijingDate,
  jobs,
  enqueueDailyJobs,
  enqueueDailyJobsStaggered,
  canarySchedule,
  triggerCanary,
  beijingWeekday,
  weeklySchedule,
  triggerWeeklyGovernance,
  runLocalHardening,
  eventSummarySince,
  dailyJobSchedule,
  auditSmokeFailureRepairTickets,
  effectiveRepairTicketsForFailure,
  auditDailyArtifacts,
  waitForAudit,
  buildReportBody,
  improvementItems,
  isPlaceholderArchive,
  archiveEvidence,
  sendFeishuReport,
};
