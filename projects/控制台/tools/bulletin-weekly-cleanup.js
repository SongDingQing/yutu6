#!/usr/bin/env node
'use strict';

/*
 * bulletin-weekly-cleanup.js —— 公告板周清算(拍板 Q8)
 *
 * 读 projects/控制台/artifacts/bulletin/cards.json,按四条规则出清算计划:
 *   a) enabled 卡:其 queueId 对应任务已 done/failed 超 7 天 → 归档(status=archived,留 archivedReason);
 *   b) todo/enabled 提案类卡(source=洞察员/自省优化):创建超 14 天且无 queueId 进展 → 归档(两周硬时限);
 *   c) 同 queueId / 同标题前缀多卡 → 保留最新一张,其余归档(维修工单卡不做标题前缀合并,避免误伤);
 *   d) 清算后活卡(todo+enabled)仍 >10 张 → 按创建时间归档最老的超额部分;
 *      维修工单卡(source=维修工单 / repair-* id)与清算摘要卡(source=公告板清算)豁免不清算。
 *   e) --apply 时产出中文清算摘要写 board/公告板清算-<YYYYMMDD>.md,
 *      并用 secretary-tools bulletin-add 给 CEO 加一张"清算摘要"卡(source=公告板清算,该卡自身下轮豁免)。
 *
 * 默认 dry-run 只打印计划;--apply 才动 cards.json(原子写 + 清算前备份 cards.json.bak-<ts>)。
 * 归档不是删除:卡片留在 cards.json 里,status=archived,可人工翻案。
 *
 * env 开关:BULLETIN_WEEKLY_CLEANUP_ENABLED=0 时 CLI 直接跳过(默认开;只影响 CLI,不影响模块函数)。
 *
 * 红线:未登记或未授权项目不处理;密钥不回显;不删除文件,只改卡片状态;失败不重试破坏现场。
 *
 * 用法:
 *   node tools/bulletin-weekly-cleanup.js                # dry-run,打印计划
 *   node tools/bulletin-weekly-cleanup.js --apply        # 实际清算
 *   node tools/bulletin-weekly-cleanup.js --apply --json
 *   node tools/bulletin-weekly-cleanup.js --delay-ms 2700000 --apply   # 错峰(周日钩子用)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');                 // projects/控制台
const WORKDIR = process.env.CONSOLE_WORKDIR
  ? path.resolve(process.env.CONSOLE_WORKDIR)
  : path.resolve(ROOT, '../..');
const QUEUE_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');
const BULLETIN_FILE = path.join(QUEUE_ROOT, 'bulletin', 'cards.json');
const BOARD_DIR = path.join(WORKDIR, 'board');
const EVENTS_FILE = process.env.CONSOLE_EVENTS_FILE
  ? path.resolve(process.env.CONSOLE_EVENTS_FILE)
  : path.join(QUEUE_ROOT, 'engine-events.jsonl');

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_RETENTION_MS = Math.max(0, Number(process.env.BULLETIN_CLEANUP_DONE_DAYS || 7)) * DAY_MS;
const PROPOSAL_TTL_MS = Math.max(0, Number(process.env.BULLETIN_CLEANUP_PROPOSAL_DAYS || 14)) * DAY_MS;
const ACTIVE_CAP = Math.max(1, parseInt(process.env.BULLETIN_CLEANUP_ACTIVE_CAP || '10', 10) || 10);
const PROPOSAL_SOURCES = ['洞察员', '自省优化'];
const REPAIR_SOURCE = '维修工单';
const SUMMARY_SOURCE = '公告板清算';
const TITLE_PREFIX_LEN = 12;

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

function beijingDate(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms == null ? Date.now() : ms));
  return parts.replace(/-/g, '');
}

function prettyDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function isActiveCard(card) {
  return !!card && (card.status === 'todo' || card.status === 'enabled');
}

function isExemptCard(card) {
  // 清算摘要卡自身下轮豁免(source=公告板清算)。
  return !!card && String(card.source || '') === SUMMARY_SOURCE;
}

function isRepairCard(card) {
  return !!card && (String(card.source || '') === REPAIR_SOURCE || /^repair-/.test(String(card.id || '')));
}

function createdMsOf(card) {
  const t = Date.parse(card && card.created_at || '');
  return Number.isFinite(t) ? t : 0;
}

function titleKey(title) {
  const normalized = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (normalized.length < 6) return normalized ? `full:${normalized}` : '';
  return normalized.slice(0, TITLE_PREFIX_LEN);
}

// 只读扫描队列条目状态(不经过 Q.qdir,避免在只读检查时创建目录)。
function queueEntryLookup(queueRoot, agent, id) {
  const safeAgent = String(agent || '');
  const safeId = String(id || '');
  if (!/^[\p{L}\p{N}_-]+$/u.test(safeAgent) || !/^[A-Za-z0-9._-]+$/.test(safeId)) return null;
  const d = path.join(queueRoot, 'queues', safeAgent);
  for (const sub of ['running', 'paused', 'done', 'failed', 'canceled']) {
    const file = path.join(d, sub, `${safeId}.json`);
    if (!fs.existsSync(file)) continue;
    const entry = readJson(file, null);
    let finishedMs = Date.parse(entry && entry.finished_at || '');
    if (!Number.isFinite(finishedMs)) {
      try { finishedMs = fs.statSync(file).mtimeMs; } catch (_) { finishedMs = NaN; }
    }
    return { state: sub, entry, finishedMs };
  }
  let files = [];
  try { files = fs.readdirSync(d); } catch (_) { return null; }
  if (files.some(f => /\.json$/.test(f) && f !== '_seq' && f.endsWith(`-${safeId}.json`))) {
    return { state: 'queued', entry: null, finishedMs: NaN };
  }
  return null;
}

function buildPlan(cards, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const queueRoot = opts.queueRoot || QUEUE_ROOT;
  const activeCap = Math.max(1, Number(opts.activeCap || ACTIVE_CAP));
  const actions = [];
  const archivedIds = new Set();
  const mark = (card, rule, reason, extra) => {
    if (archivedIds.has(card.id)) return;
    archivedIds.add(card.id);
    actions.push(Object.assign({
      id: card.id,
      title: String(card.title || '').slice(0, 120),
      source: card.source || '',
      rule,
      action: 'archive',
      reason,
    }, extra || {}));
  };

  const active = cards.filter(isActiveCard);

  // 规则 a + b
  for (const card of active) {
    if (isExemptCard(card)) continue;
    if (card.status === 'enabled' && card.queueId) {
      const hit = queueEntryLookup(queueRoot, card.target, card.queueId);
      if (hit && (hit.state === 'done' || hit.state === 'failed')
        && Number.isFinite(hit.finishedMs) && now - hit.finishedMs > DONE_RETENTION_MS) {
        mark(card, 'a', `queue-${hit.state}-over-7d`, { queueId: card.queueId, queueState: hit.state });
        continue;
      }
    }
    if (PROPOSAL_SOURCES.includes(String(card.source || ''))) {
      const createdMs = createdMsOf(card);
      if (createdMs && now - createdMs > PROPOSAL_TTL_MS) {
        const hit = card.queueId ? queueEntryLookup(queueRoot, card.target, card.queueId) : null;
        if (!hit) mark(card, 'b', 'proposal-stale-14d', { queueId: card.queueId || null });
      }
    }
  }

  // 规则 c:同 queueId / 同标题前缀去重(保留最新;维修卡不做标题前缀合并)
  const remaining = active.filter(c => !archivedIds.has(c.id) && !isExemptCard(c));
  const groups = new Map();
  for (const card of remaining) {
    const keys = [];
    if (card.queueId) keys.push(`q:${card.queueId}`);
    if (!isRepairCard(card)) {
      const t = titleKey(card.title);
      if (t) keys.push(`t:${t}`);
    }
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
  }
  for (const [key, group] of groups) {
    const live = group.filter(c => !archivedIds.has(c.id));
    if (live.length < 2) continue;
    live.sort((a, b) => createdMsOf(b) - createdMsOf(a));
    const keep = live[0];
    for (const card of live.slice(1)) {
      mark(card, 'c', `duplicate-merged:${keep.id}`, { keepId: keep.id, groupKey: key });
    }
  }

  // 规则 d:活卡上限截断(维修工单卡 + 清算摘要卡豁免)
  const survivors = active.filter(c => !archivedIds.has(c.id));
  if (survivors.length > activeCap) {
    const candidates = survivors
      .filter(c => !isRepairCard(c) && !isExemptCard(c))
      .sort((a, b) => createdMsOf(a) - createdMsOf(b));
    let overflow = survivors.length - activeCap;
    for (const card of candidates) {
      if (overflow <= 0) break;
      mark(card, 'd', 'active-cap-overflow');
      overflow--;
    }
  }

  const ruleCounts = { a: 0, b: 0, c: 0, d: 0 };
  for (const action of actions) ruleCounts[action.rule] = (ruleCounts[action.rule] || 0) + 1;
  return {
    at: new Date(now).toISOString(),
    date: beijingDate(now),
    totalCards: cards.length,
    activeBefore: active.length,
    activeAfter: active.length - archivedIds.size,
    activeCap,
    ruleCounts,
    actions,
  };
}

function summaryMarkdown(plan, extra = {}) {
  const pretty = prettyDate(plan.date);
  const ruleNames = {
    a: 'a) 任务终态超 7 天',
    b: 'b) 提案卡 14 天硬时限',
    c: 'c) 重复卡合并',
    d: 'd) 活卡上限截断',
  };
  const lines = [
    `# 公告板周清算摘要 · ${pretty}`,
    '',
    '> bulletin-weekly-cleanup(拍板 Q8)自动产出。归档=卡片留在 cards.json、status=archived,可人工翻案;不是删除。',
    '> 豁免:维修工单卡不清算;清算摘要卡自身下轮豁免。红线:未授权项目不处理、密钥不回显。',
    '',
    '## 总览',
    '',
    `- 卡片总数:${plan.totalCards}`,
    `- 清算前活卡(todo+enabled):${plan.activeBefore}`,
    `- 本轮归档:${plan.actions.length} 张(a=${plan.ruleCounts.a || 0} / b=${plan.ruleCounts.b || 0} / c=${plan.ruleCounts.c || 0} / d=${plan.ruleCounts.d || 0})`,
    `- 清算后活卡:${plan.activeAfter}(上限 ${plan.activeCap})`,
    extra.backupRel ? `- 清算前备份:${extra.backupRel}` : null,
    '',
    '## 归档明细',
    '',
  ].filter(l => l != null);
  if (!plan.actions.length) {
    lines.push('- 本轮无需归档,公告板健康。');
  } else {
    for (const rule of ['a', 'b', 'c', 'd']) {
      const rows = plan.actions.filter(x => x.rule === rule);
      if (!rows.length) continue;
      lines.push(`### ${ruleNames[rule]}(${rows.length} 张)`, '');
      for (const row of rows) {
        lines.push(`- \`${row.id}\` ${row.title}(source=${row.source || '无'};reason=${row.reason})`);
      }
      lines.push('');
    }
  }
  lines.push('## 下一步', '', '- 误归档的卡可人工把 status 改回 todo/enabled(cards.json 有清算前备份)。', '');
  return lines.join('\n');
}

// 用 secretary-tools bulletin-add(CLI,模块未导出 bulletinAdd)给 CEO 加清算摘要卡;
// 同日重跑靠确定性 id 幂等("bulletin id exists" 视为已加过)。
function addSummaryCard(plan, summaryRel, opts = {}) {
  const cardId = `bb-weekly-cleanup-${plan.date}`;
  const desc = `本轮归档 ${plan.actions.length} 张(a=${plan.ruleCounts.a || 0}/b=${plan.ruleCounts.b || 0}/c=${plan.ruleCounts.c || 0}/d=${plan.ruleCounts.d || 0}),清算后活卡 ${plan.activeAfter}/${plan.activeCap}。详见 ${summaryRel}。`;
  const { spawnSync } = require('child_process');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'secretary-tools.js'), 'bulletin-add',
    '--id', cardId,
    '--title', `公告板周清算摘要 ${prettyDate(plan.date)}`,
    '--desc', desc,
    '--target', 'ceo',
    '--source', SUMMARY_SOURCE,
    '--goal', `请 CEO 查阅公告板周清算摘要 ${summaryRel},确认归档合理;误归档的卡可人工翻案(status 改回 todo/enabled)。`,
  ], {
    cwd: WORKDIR,
    env: process.env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.status === 0) return { ok: true, added: true, cardId };
  const errText = String((res.stderr || '') + (res.stdout || ''));
  if (/bulletin id exists/i.test(errText)) {
    return { ok: true, added: false, already: true, cardId };
  }
  return { ok: false, added: false, cardId, error: errText.slice(0, 300) };
}

function run(opts = {}) {
  const now = Number(opts.now) || Date.now();
  const bulletinFile = opts.bulletinFile || BULLETIN_FILE;
  const boardDir = opts.boardDir || BOARD_DIR;
  if (!fs.existsSync(bulletinFile)) {
    return { ok: true, apply: !!opts.apply, action: 'skipped', reason: 'no-cards-file', bulletinFile };
  }
  const cards = readJson(bulletinFile, []);
  if (!Array.isArray(cards)) {
    return { ok: false, apply: !!opts.apply, action: 'aborted', reason: 'cards-json-not-array', bulletinFile };
  }
  const plan = buildPlan(cards.filter(Boolean), Object.assign({}, opts, { now }));
  if (!opts.apply) {
    return { ok: true, apply: false, action: 'dry-run', plan };
  }

  // 清算前备份(同目录,带时间戳),再原子写。
  const ts = new Date(now).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupFile = `${bulletinFile}.bak-${ts}`;
  fs.copyFileSync(bulletinFile, backupFile);
  const byId = new Map(plan.actions.map(a => [a.id, a]));
  const archivedAt = new Date(now).toISOString();
  const next = cards.map(card => {
    if (!card || !byId.has(card.id)) return card;
    return Object.assign({}, card, {
      status: 'archived',
      archivedReason: byId.get(card.id).reason,
      archived_at: archivedAt,
    });
  });
  writeJsonAtomic(bulletinFile, next);

  // 中文清算摘要落盘 board/公告板清算-<date>.md
  const summaryFile = path.join(boardDir, `公告板清算-${plan.date}.md`);
  const summaryRel = path.relative(WORKDIR, summaryFile).split(path.sep).join('/');
  const backupRel = path.relative(WORKDIR, backupFile).split(path.sep).join('/');
  fs.mkdirSync(boardDir, { recursive: true });
  fs.writeFileSync(summaryFile, summaryMarkdown(plan, { backupRel }));

  // 给 CEO 加一张清算摘要卡(source=公告板清算,下轮豁免)。
  const summaryCard = opts.skipSummaryCard ? { ok: true, added: false, skipped: true } : addSummaryCard(plan, summaryRel, opts);

  appendEvent('bulletin.weekly_cleanup', {
    date: plan.date,
    archived: plan.actions.length,
    ruleCounts: plan.ruleCounts,
    activeBefore: plan.activeBefore,
    activeAfter: plan.activeAfter,
    summary: summaryRel,
    backup: backupRel,
    summaryCard: summaryCard.cardId || null,
  }, opts.eventsFile);

  return {
    ok: true,
    apply: true,
    action: 'applied',
    plan,
    backupFile,
    summaryFile,
    summaryCard,
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
  const enabled = !/^(0|false|off|no)$/i.test(String(process.env.BULLETIN_WEEKLY_CLEANUP_ENABLED == null ? '1' : process.env.BULLETIN_WEEKLY_CLEANUP_ENABLED));
  if (!enabled) {
    process.stdout.write(JSON.stringify({ ok: true, action: 'skipped', reason: 'BULLETIN_WEEKLY_CLEANUP_ENABLED=0' }) + '\n');
    return;
  }
  const delayMs = Math.max(0, Number(argValue(args, '--delay-ms') || 0));
  if (delayMs > 0) await sleep(delayMs);
  const apply = hasFlag(args, '--apply') && !hasFlag(args, '--dry-run');
  const nowRaw = argValue(args, '--now');
  const now = nowRaw ? (Number(nowRaw) || Date.parse(nowRaw) || Date.now()) : Date.now();
  const out = run({ apply, now });
  if (hasFlag(args, '--json')) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  if (out.action === 'dry-run') {
    const plan = out.plan;
    process.stdout.write(`[bulletin-weekly-cleanup] dry-run ${plan.date} 活卡 ${plan.activeBefore} -> ${plan.activeAfter},计划归档 ${plan.actions.length} 张(--apply 才生效)\n`);
    for (const a of plan.actions) process.stdout.write(`  - [${a.rule}] ${a.id} ${a.title} (${a.reason})\n`);
  } else if (out.action === 'applied') {
    process.stdout.write(`[bulletin-weekly-cleanup] applied ${out.plan.date} 归档 ${out.plan.actions.length} 张,活卡 ${out.plan.activeBefore} -> ${out.plan.activeAfter};摘要 ${out.summaryFile}\n`);
  } else {
    process.stdout.write(`[bulletin-weekly-cleanup] ${out.action}: ${out.reason || ''}\n`);
  }
}

if (require.main === module) {
  main().catch(e => {
    process.stderr.write(String(e && e.stack || e).slice(0, 4000) + '\n');
    process.exit(1);
  });
}

module.exports = {
  buildPlan,
  run,
  queueEntryLookup,
  titleKey,
  isRepairCard,
  isExemptCard,
  summaryMarkdown,
  BULLETIN_FILE,
  SUMMARY_SOURCE,
  REPAIR_SOURCE,
  PROPOSAL_SOURCES,
  ACTIVE_CAP,
};
