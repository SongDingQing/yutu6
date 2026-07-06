#!/usr/bin/env node
'use strict';
// routing-replay:只读聚合 engine-events,按 role×runner 输出成功率/降级率(洞察#3 RouterEval)。
// 用途:改 shared/routing/model-routing.yaml 的 prefer 或 config roleMap 前后,跑一次做对照,
//   看某 role 的某 runner 历史成功率/降级率,判断路由变更是否合理。不改任何运行代码、不做决策。
//
// 数据源(全在 engine-events,由 cli-runner emit):
//   runner.call     → 分母:role×runner 的总调用数、成功数、平均时延(需 YUTU6_RUNNER_EVENTS 未关)
//   runner.failover → 降级数:from=R 表示 R 被切走一次
//   quota.breaker.tripped → 熔断数:runner=R 触发熔断
//   runner.quality  → 质量分:review 节点的 pass/score(role 维度)
// 注意轮转:engine-events 到 64MB 会 rename 归档,故 glob engine-events*.jsonl 全遍历(按 mtime),否则漏历史。
//
// 用法:
//   node tools/routing-replay.js [--days N] [--json] [--out <file>] [--no-write] [--tail-bytes N]
//   --days N       只算最近 N 天(默认 7);--json 输出 JSON 到 stdout;
//   --out <file>   指定输出 md 路径;--no-write 不落盘(只 stdout);--tail-bytes 每个归档尾部采样字节(默认 32MB)

const fs = require('fs');
const path = require('path');

const WORKDIR = path.resolve(__dirname, '..', '..', '..');
const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts');
const EVENTS_DIR = process.env.CONSOLE_ARTIFACTS_DIR || ARTIFACTS;
const BOARD_DIR = path.join(WORKDIR, 'board');
const ARCHIVE_RE = /^engine-events(\.[0-9-]+)?\.jsonl$/; // 当前 + 归档

function parseCliArgs(argv) {
  const a = { days: 7, json: false, write: true, out: null, tailBytes: 32 * 1024 * 1024 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--days') a.days = Math.max(1, parseInt(argv[++i], 10) || 7);
    else if (t === '--json') a.json = true;
    else if (t === '--no-write') a.write = false;
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--tail-bytes') a.tailBytes = Math.max(1, parseInt(argv[++i], 10) || a.tailBytes);
  }
  return a;
}

function beijingDate(now = new Date()) {
  const b = new Date(now.getTime() + 8 * 3600 * 1000);
  return b.toISOString().slice(0, 10);
}

// 尾部采样读单个事件文件(大文件不整读,坏行容错;掐掉被截断的首行)。
function readEventsTail(file, tailBytes) {
  let fd;
  const events = [];
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - tailBytes);
    const len = st.size - start;
    if (len <= 0) return events;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    let lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (start > 0 && lines.length) lines = lines.slice(1); // 首行可能被截断
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch (_) {}
    }
  } catch (_) {} finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
  return events;
}

// glob 所有 engine-events*.jsonl(当前 + 归档),按 mtime 升序;读尾部合并。
function readAllEvents(tailBytes) {
  let names = [];
  try { names = fs.readdirSync(EVENTS_DIR).filter((n) => ARCHIVE_RE.test(n)); } catch (_) { return []; }
  const files = names
    .map((n) => path.join(EVENTS_DIR, n))
    .map((f) => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch (_) { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.m - b.m)
    .map((x) => x.f);
  const all = [];
  for (const f of files) all.push(...readEventsTail(f, tailBytes));
  return all;
}

function eventTs(ev) { const t = Date.parse(ev && ev.ts); return isNaN(t) ? 0 : t; }

// 聚合:两遍扫。第一遍建 task→role(从 node.start/任意带 role 的事件);第二遍归因 role×runner。
function aggregate(events, options = {}) {
  const sinceMs = Date.now() - (options.days || 7) * 24 * 3600 * 1000;
  const inWindow = events.filter((ev) => eventTs(ev) >= sinceMs);

  const taskRole = {};
  for (const ev of inWindow) {
    if (ev && ev.task && ev.role && !taskRole[ev.task]) taskRole[ev.task] = String(ev.role);
  }

  // rows[role][runner] = { calls, ok, fail, latencySum, latencyN, failovers, tripped }
  const rows = {};
  const cell = (role, runner) => {
    rows[role] = rows[role] || {};
    rows[role][runner] = rows[role][runner] || { calls: 0, ok: 0, fail: 0, latencySum: 0, latencyN: 0, failovers: 0, tripped: 0, qualityN: 0, qualityPass: 0, scoreSum: 0, scoreN: 0 };
    return rows[role][runner];
  };

  for (const ev of inWindow) {
    if (!ev || !ev.type) continue;
    const role = String(ev.role || taskRole[ev.task] || 'unknown');
    if (ev.type === 'runner.call') {
      const c = cell(role, String(ev.runner || 'unknown'));
      c.calls++;
      if (ev.ok) c.ok++; else c.fail++;
      if (typeof ev.latency_ms === 'number') { c.latencySum += ev.latency_ms; c.latencyN++; }
    } else if (ev.type === 'runner.failover') {
      cell(role, String(ev.from || 'unknown')).failovers++;
    } else if (ev.type === 'quota.breaker.tripped') {
      cell(role, String(ev.runner || 'unknown')).tripped++;
    } else if (ev.type === 'runner.quality') {
      // quality 是 role 维度(无 runner);挂到该 role 的一个特殊聚合桶
      const c = cell(role, '(role-quality)');
      c.qualityN++;
      if (ev.pass) c.qualityPass++;
      if (typeof ev.score === 'number') { c.scoreSum += ev.score; c.scoreN++; }
    }
  }

  const out = [];
  for (const role of Object.keys(rows).sort()) {
    for (const runner of Object.keys(rows[role]).sort()) {
      const c = rows[role][runner];
      out.push({
        role, runner,
        calls: c.calls,
        ok: c.ok,
        fail: c.fail,
        success_rate: c.calls ? +(c.ok / c.calls).toFixed(3) : null,
        failovers: c.failovers,
        // 降级率 = 该 runner 被切走次数 / 该 runner 总调用数(runner.call 分母);无调用则用 failover 绝对数
        failover_rate: c.calls ? +(c.failovers / c.calls).toFixed(3) : null,
        tripped: c.tripped,
        avg_latency_ms: c.latencyN ? Math.round(c.latencySum / c.latencyN) : null,
        quality_calls: c.qualityN || undefined,
        quality_pass_rate: c.qualityN ? +(c.qualityPass / c.qualityN).toFixed(3) : undefined,
        avg_score: c.scoreN ? +(c.scoreSum / c.scoreN).toFixed(3) : undefined,
      });
    }
  }
  return { windowDays: options.days || 7, generatedAt: new Date().toISOString(), totalEventsInWindow: inWindow.length, rows: out };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# 路由回归对照(routing-replay)`);
  lines.push('');
  lines.push(`_窗口:最近 ${report.windowDays} 天 · 生成:${report.generatedAt} · 窗口内事件 ${report.totalEventsInWindow}_`);
  lines.push('');
  lines.push('> 数据源:engine-events 的 runner.call/runner.failover/quota.breaker.tripped/runner.quality。');
  lines.push('> 用途:改 model-routing.yaml prefer / roleMap 前后各跑一次对照。runner.call 需 YUTU6_RUNNER_EVENTS 未关。');
  lines.push('');
  if (!report.rows.length) {
    lines.push('_窗口内无 runner.* 事件(可能 YUTU6_RUNNER_EVENTS=0,或事件尚未产生)。_');
    return lines.join('\n') + '\n';
  }
  lines.push('| role | runner | 调用 | 成功率 | 降级次数 | 降级率 | 熔断 | 平均时延ms | 质量样本 | 质量通过率 | 均分 |');
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const r of report.rows) {
    lines.push(`| ${r.role} | ${r.runner} | ${r.calls} | ${r.success_rate ?? '—'} | ${r.failovers} | ${r.failover_rate ?? '—'} | ${r.tripped} | ${r.avg_latency_ms ?? '—'} | ${r.quality_calls ?? '—'} | ${r.quality_pass_rate ?? '—'} | ${r.avg_score ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

function reportFilePath(outArg) {
  if (outArg) return path.isAbsolute(outArg) ? outArg : path.join(WORKDIR, outArg);
  return path.join(BOARD_DIR, `routing-replay-${beijingDate()}.md`);
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const events = readAllEvents(args.tailBytes);
  const report = aggregate(events, { days: args.days });
  if (args.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return; }
  const md = renderMarkdown(report);
  if (args.write) {
    const file = reportFilePath(args.out);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) {}
    fs.writeFileSync(file, md);
    process.stderr.write(`routing-replay 已写:${file}(${report.rows.length} 行,窗口 ${args.days} 天)\n`);
  }
  process.stdout.write(md);
}

if (require.main === module) main();

module.exports = { aggregate, renderMarkdown, readEventsTail, readAllEvents, parseCliArgs };
