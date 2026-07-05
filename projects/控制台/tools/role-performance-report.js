#!/usr/bin/env node
'use strict';

/*
 * role-performance-report.js — HR 绩效报告(拍板 Q3:弹性编制决策依据)
 *
 * 聚合两路数据,输出 role×runner 近 7 天绩效:
 *   1. engine-events.jsonl(尾部采样,默认最后 16MB):runner.failover(failover 次数)、
 *      done_gate.xxx 与 task.needs_evidence(done-gate 打回)、engine.runner_lock.acquired(runner 归属)。
 *   2. queues/<agent>/{done,failed}/ 元数据:任务数 / 成功率 / 平均重试(retry 或 run_attempt-1)。
 *
 * 输出:
 *   - markdown 表写 board/hr-绩效报告-<YYYY-MM-DD>.md(窗口内空数据角色标"闲置",供弹性编制决策)
 *   - --json 额外把完整聚合结果打到 stdout
 *
 * 用法:
 *   node projects/控制台/tools/role-performance-report.js
 *   node projects/控制台/tools/role-performance-report.js --json
 *   node projects/控制台/tools/role-performance-report.js --days 7 --date 2026-07-03
 *   node projects/控制台/tools/role-performance-report.js --out /tmp/report.md
 *   node projects/控制台/tools/role-performance-report.js --no-write --json
 *
 * env:
 *   CONSOLE_ARTIFACTS_DIR / CONSOLE_EVENTS_FILE   与控制台其余工具一致
 *   HR_REPORT_BOARD_DIR                            报告输出目录(默认 <workdir>/board)
 *   HR_REPORT_EVENTS_TAIL_BYTES                    事件日志尾部采样字节数(默认 16MB)
 *
 * 红线:只读事件日志与队列元数据,不回显密钥;Starlaid 一律排除(不读其目录)。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');            // projects/控制台
const WORKDIR = path.resolve(ROOT, '../..');           // 工作区根
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const EVENTS_FILE = process.env.CONSOLE_EVENTS_FILE
  ? path.resolve(process.env.CONSOLE_EVENTS_FILE)
  : path.join(QUEUE_ROOT, 'engine-events.jsonl');
const BOARD_DIR = process.env.HR_REPORT_BOARD_DIR
  ? path.resolve(process.env.HR_REPORT_BOARD_DIR)
  : path.join(WORKDIR, 'board');
const ROUTING_FILE = path.join(WORKDIR, 'shared', 'routing', 'model-routing.yaml');
const DEFAULT_TAIL_BYTES = Math.max(64 * 1024, parseInt(process.env.HR_REPORT_EVENTS_TAIL_BYTES || '', 10) || 16 * 1024 * 1024);
const DEFAULT_DAYS = 7;

// done-gate 打回类事件(shared/engine/engine.js)
const DONE_GATE_EVENT_TYPES = new Set([
  'done_gate.blocked',
  'done_gate.review_invalid',
  'done_gate.self_report_incomplete',
  'done_gate.logic_chain_missing',
  'task.needs_evidence',
]);

// 兜底 role→runner(与 ceo-worker DEFAULT_ROLE_MAP 同源快照;仅当队列条目/事件都取不到 runner 时使用)
const FALLBACK_ROLE_RUNNER = {
  secretary: 'claude',
  orchestrator: 'codex',
  supervisor: 'codex',
  reasoning_architect: 'codex',
  worker_code: 'codex',
  worker_narrow: 'zhipu-glm',
  quality_ops: 'zhipu-glm',
  governance: 'codex',
  'insight-scout': 'zhipu-glm',
  memory_officer: 'codex',
  it_engineer: 'zhipu-glm',
  hr_manager: 'codex',
  hr_specialist: 'zhipu-glm',
  'repair-lead': 'claude-code',
  repair: 'codex-privileged',
  gui_desktop_control: 'peekaboo',
  frontend_designer: 'zhipu-glm',
};

function roleFromAgent(agent) {
  const a = String(agent || '');
  if (/^supervisor-/.test(a)) return 'supervisor';
  if (a === 'ceo') return 'orchestrator';
  return a;
}

function beijingDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
}

function eventTs(ev) {
  return Date.parse(ev && (ev.ts || ev.at || ev.time) || '') || 0;
}

// 尾部采样读事件日志(增量:不整读大文件;坏行容错)
function readEventsTail(file, tailBytes = DEFAULT_TAIL_BYTES) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return { events: [], sampledBytes: 0, fileBytes: 0, truncated: false }; }
  const len = Math.min(st.size, Math.max(1024, tailBytes));
  const start = st.size - len;
  let text = '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    text = buf.slice(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  let lines = text.split('\n').filter(Boolean);
  if (start > 0) lines = lines.slice(1); // 掐掉可能被截断的首行
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch (_) {}
  }
  return { events, sampledBytes: len, fileBytes: st.size, truncated: start > 0 };
}

// 事件两遍扫:先建 task→role / task→queueAgent / queueRef→runner 映射,再归因 failover / done-gate。
function collectEvents(options = {}) {
  const file = options.eventsFile || EVENTS_FILE;
  const sinceMs = options.sinceMs || 0;
  const untilMs = options.untilMs || Infinity;
  const tail = readEventsTail(file, options.tailBytes || DEFAULT_TAIL_BYTES);
  const inWindow = tail.events.filter(ev => {
    const ts = eventTs(ev);
    return ts >= sinceMs && ts <= untilMs;
  });

  const taskRole = {};
  const taskAgent = {};
  const runnerByQueueRef = {};
  for (const ev of inWindow) {
    if (ev.task && ev.role && !taskRole[ev.task]) taskRole[ev.task] = String(ev.role);
    if (ev.task && ev.queueAgent && !taskAgent[ev.task]) taskAgent[ev.task] = String(ev.queueAgent);
    if (ev.queueAgent && ev.queueId && ev.runnerType) {
      runnerByQueueRef[`${ev.queueAgent}/${ev.queueId}`] = String(ev.runnerType);
    }
  }

  const failoverByRoleRunner = {};
  const doneGateByRole = {};
  const rolesWithEvents = new Set();
  for (const ev of inWindow) {
    const type = String(ev.type || '');
    if (type === 'runner.failover') {
      const role = String(ev.role || taskRole[ev.task] || roleFromAgent(taskAgent[ev.task]) || 'unknown');
      const from = String(ev.from || 'unknown');
      failoverByRoleRunner[role] = failoverByRoleRunner[role] || {};
      failoverByRoleRunner[role][from] = (failoverByRoleRunner[role][from] || 0) + 1;
      rolesWithEvents.add(role);
    } else if (DONE_GATE_EVENT_TYPES.has(type)) {
      const role = String(taskRole[ev.task] || roleFromAgent(taskAgent[ev.task]) || 'unknown');
      doneGateByRole[role] = (doneGateByRole[role] || 0) + 1;
      rolesWithEvents.add(role);
    }
  }

  return {
    failoverByRoleRunner,
    doneGateByRole,
    runnerByQueueRef,
    rolesWithEvents,
    sample: { file, sampledBytes: tail.sampledBytes, fileBytes: tail.fileBytes, truncated: tail.truncated, parsed: tail.events.length, inWindow: inWindow.length },
  };
}

function entryRetry(entry) {
  const retry = Number(entry && entry.retry || 0);
  const attempt = Number(entry && entry.run_attempt || 0);
  return Math.max(0, Number.isFinite(retry) ? retry : 0, Number.isFinite(attempt) ? attempt - 1 : 0);
}

function entryFinishedMs(entry) {
  return Date.parse(entry && (entry.finished_at || entry.canceled_at || entry.updated_at) || '') || 0;
}

// 扫 queues/*/done|failed,窗口内按 role×runner 聚合任务数/成功/失败/重试
function collectQueueOutcomes(options = {}) {
  const root = options.root || QUEUE_ROOT;
  const sinceMs = options.sinceMs || 0;
  const untilMs = options.untilMs || Infinity;
  const runnerByQueueRef = options.runnerByQueueRef || {};
  const qroot = path.join(root, 'queues');
  let agents = [];
  try {
    agents = fs.readdirSync(qroot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch (_) {}

  const byKey = {};
  const rolesWithTasks = new Set();
  for (const agent of agents) {
    for (const status of ['done', 'failed']) {
      const dir = path.join(qroot, agent, status);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => /\.json$/.test(f)); } catch (_) { continue; }
      for (const f of files) {
        let entry = null;
        try { entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
        const finishedMs = entryFinishedMs(entry);
        if (!finishedMs || finishedMs < sinceMs || finishedMs > untilMs) continue;
        const task = entry.task && typeof entry.task === 'object' ? entry.task : {};
        const role = String(task.role || roleFromAgent(agent));
        const id = String(entry.id || f.replace(/\.json$/, ''));
        const runner = String(
          task.runnerType || task.runner
          || runnerByQueueRef[`${agent}/${id}`]
          || FALLBACK_ROLE_RUNNER[role]
          || 'unknown'
        );
        const key = `${role}|${runner}`;
        const row = byKey[key] || (byKey[key] = { role, runner, tasks: 0, done: 0, failed: 0, retrySum: 0, failovers: 0, doneGateRejects: 0 });
        row.tasks += 1;
        if (status === 'done') row.done += 1; else row.failed += 1;
        row.retrySum += entryRetry(entry);
        rolesWithTasks.add(role);
      }
    }
  }
  return { byKey, rolesWithTasks, agents };
}

// 已知角色全集:model-routing.yaml roles 段 + 队列 agent 映射的角色(供"闲置"标注)
function knownRoles(options = {}) {
  const roles = new Set();
  const routingFile = options.routingFile || ROUTING_FILE;
  try {
    const text = fs.readFileSync(routingFile, 'utf8');
    let inRoles = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '');
      if (/^roles:\s*$/.test(line)) { inRoles = true; continue; }
      if (inRoles && /^\S/.test(line) && line.trim()) inRoles = false; // 顶层新段落
      if (inRoles) {
        const m = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
        if (m) roles.add(m[1]);
      }
    }
  } catch (_) {}
  for (const agent of options.queueAgents || []) {
    const role = roleFromAgent(agent);
    if (/^[A-Za-z0-9_-]+$/.test(role)) roles.add(role);
  }
  return roles;
}

function aggregate(options = {}) {
  const nowMs = options.nowMs == null ? Date.now() : options.nowMs;
  const days = Math.max(1, Number(options.days || DEFAULT_DAYS));
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const events = collectEvents({
    eventsFile: options.eventsFile,
    tailBytes: options.tailBytes,
    sinceMs,
    untilMs: nowMs,
  });
  const queues = collectQueueOutcomes({
    root: options.root,
    sinceMs,
    untilMs: nowMs,
    runnerByQueueRef: events.runnerByQueueRef,
  });

  const byKey = queues.byKey;
  // failover 归因:role×from-runner 行存在则累加;不存在则补 0 任务行(说明该 runner 被切走了)
  for (const [role, byRunner] of Object.entries(events.failoverByRoleRunner)) {
    for (const [runner, count] of Object.entries(byRunner)) {
      const key = `${role}|${runner}`;
      const row = byKey[key] || (byKey[key] = { role, runner, tasks: 0, done: 0, failed: 0, retrySum: 0, failovers: 0, doneGateRejects: 0 });
      row.failovers += count;
    }
  }
  // done-gate 打回:role 级归因,挂到该 role 任务数最多的行;无行则补 unknown runner 行
  for (const [role, count] of Object.entries(events.doneGateByRole)) {
    const rows = Object.values(byKey).filter(r => r.role === role);
    let target = rows.sort((a, b) => b.tasks - a.tasks)[0];
    if (!target) {
      target = byKey[`${role}|unknown`] = { role, runner: 'unknown', tasks: 0, done: 0, failed: 0, retrySum: 0, failovers: 0, doneGateRejects: 0 };
    }
    target.doneGateRejects += count;
  }

  const rows = Object.values(byKey).map(row => ({
    role: row.role,
    runner: row.runner,
    tasks: row.tasks,
    done: row.done,
    failed: row.failed,
    successRate: row.tasks ? row.done / row.tasks : null,
    failovers: row.failovers,
    doneGateRejects: row.doneGateRejects,
    avgRetry: row.tasks ? row.retrySum / row.tasks : null,
    status: row.tasks > 0 ? '正常' : '仅事件',
  })).sort((a, b) => b.tasks - a.tasks || a.role.localeCompare(b.role));

  const activeRoles = new Set(rows.map(r => r.role));
  const idleRoles = [...knownRoles({ routingFile: options.routingFile, queueAgents: queues.agents })]
    .filter(role => !activeRoles.has(role))
    .sort();

  return {
    ok: true,
    tool: 'role-performance-report',
    date: options.date || beijingDate(nowMs),
    windowDays: days,
    since: new Date(sinceMs).toISOString(),
    until: new Date(nowMs).toISOString(),
    rows,
    idleRoles,
    eventsSample: events.sample,
  };
}

function pct(v) {
  return v == null ? '-' : `${Math.round(v * 1000) / 10}%`;
}

function num(v, digits = 2) {
  return v == null ? '-' : String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
}

function renderMarkdown(report) {
  const lines = [
    `# HR 绩效报告 · ${report.date}(近 ${report.windowDays} 天)`,
    '',
    `> 数据源:engine-events.jsonl 尾部采样(${report.eventsSample.sampledBytes} / ${report.eventsSample.fileBytes} bytes${report.eventsSample.truncated ? ',已截断更早事件' : ''})+ queues/*/done|failed 元数据。`,
    `> 窗口:${report.since} ~ ${report.until}。生成:projects/控制台/tools/role-performance-report.js。`,
    '',
    '## role × runner 绩效',
    '',
    '| 角色 | runner | 任务数 | 成功 | 失败 | 成功率 | failover | done-gate 打回 | 平均重试 | 状态 |',
    '|------|--------|--------|------|------|--------|----------|----------------|----------|------|',
  ];
  for (const row of report.rows) {
    lines.push(`| ${row.role} | ${row.runner} | ${row.tasks} | ${row.done} | ${row.failed} | ${pct(row.successRate)} | ${row.failovers} | ${row.doneGateRejects} | ${num(row.avgRetry)} | ${row.status} |`);
  }
  for (const role of report.idleRoles) {
    lines.push(`| ${role} | - | 0 | 0 | 0 | - | 0 | 0 | - | 闲置 |`);
  }
  if (!report.rows.length && !report.idleRoles.length) {
    lines.push('| (无数据) | - | 0 | 0 | 0 | - | 0 | 0 | - | - |');
  }
  lines.push(
    '',
    '## 闲置角色(弹性编制候选)',
    '',
    report.idleRoles.length
      ? report.idleRoles.map(role => `- ${role}:窗口内无完成/失败任务,也无 failover / done-gate 事件;连续闲置可考虑收编/合并(交 HR 主管评审)。`).join('\n')
      : '- 无:所有已知角色窗口内都有活动。',
    '',
    '## 口径说明',
    '',
    '- 任务数 = 窗口内 done + failed 队列条目数;成功率 = done / 任务数。',
    '- failover = runner.failover 事件按 role×被切走 runner 归因;done-gate 打回 = done_gate.* / task.needs_evidence 事件按 role 归因(挂该 role 任务最多的行)。',
    '- 平均重试 = mean(max(retry, run_attempt-1));"仅事件"= 窗口内无完成任务但有 failover/打回事件。',
    '- 事件日志为尾部采样,超窗口的更早 failover/打回可能被低估。',
    '',
  );
  return lines.join('\n');
}

function reportFilePath(report, options = {}) {
  const dir = options.boardDir || BOARD_DIR;
  return path.join(dir, `hr-绩效报告-${report.date}.md`);
}

function writeReport(report, options = {}) {
  const file = options.out || reportFilePath(report, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderMarkdown(report));
  return file;
}

function parseCliArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--no-write') args.noWrite = true;
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--tail-bytes') args.tailBytes = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date 必须是 YYYY-MM-DD');
  const report = aggregate({ days: args.days, date: args.date, tailBytes: args.tailBytes });
  let file = null;
  if (!args.noWrite) file = writeReport(report, { out: args.out ? path.resolve(args.out) : null });
  if (args.json) {
    process.stdout.write(JSON.stringify(Object.assign({ file }, report), null, 2) + '\n');
  } else {
    process.stdout.write(`[role-performance-report] date=${report.date} rows=${report.rows.length} idle=${report.idleRoles.length}${file ? ` file=${file}` : ''}\n`);
  }
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(String(e && e.message || e) + '\n');
    process.exit(1);
  }
}

module.exports = {
  beijingDate,
  roleFromAgent,
  readEventsTail,
  collectEvents,
  collectQueueOutcomes,
  knownRoles,
  aggregate,
  renderMarkdown,
  reportFilePath,
  writeReport,
  DONE_GATE_EVENT_TYPES,
};
