#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_KEEP_BATCHES = 4;
const DEFAULT_MAX_HOT_BYTES = 100 * 1024;
const DEFAULT_KEEP_ROOT_BACKUPS = 3;
const LOCK_NAME = '.archive.lock';
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 5000;

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function atomicWriteJson(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
}

function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, Math.max(1, ms));
}

function withInsightsLock(insightsDir, fn, opts = {}) {
  const lockDir = path.join(insightsDir, LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        created_at: nowIso(opts.now || new Date()),
        reason: opts.reason || 'insights-maintenance',
      }, null, 2) + '\n');
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const stat = fs.statSync(lockDir);
        stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      } catch (_) {
        stale = true;
      }
      if (stale) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
        continue;
      }
      if (Date.now() - started > (opts.waitMs == null ? LOCK_WAIT_MS : opts.waitMs)) {
        throw new Error(`insights archive lock busy: ${lockDir}`);
      }
      sleepMs(50);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function normalizeRepoUrl(url) {
  const s = String(url || '').trim();
  const m = /^https:\/\/github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i.exec(s);
  if (!m) return '';
  return `https://github.com/${m[1]}/${m[2].replace(/\.git$/i, '').replace(/\/+$/, '')}`;
}

function collectRepoUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const url = normalizeRepoUrl(value);
    if (url) out.push(url);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectRepoUrls(item, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'repo', 'repo_url', 'source_url', 'watch_ref']) {
      if (value[key]) collectRepoUrls(value[key], out);
    }
  }
  return out;
}

function slimSeenReposData(input, opts = {}) {
  const urls = [];
  collectRepoUrls(input && input.repos, urls);
  collectRepoUrls(opts.urlsToAdd || [], urls);
  const repos = [];
  const seen = new Set();
  for (const raw of urls) {
    const url = normalizeRepoUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    repos.push(url);
  }
  const previousRepos = new Set(collectRepoUrls(input && input.repos).map(normalizeRepoUrl).filter(Boolean));
  const added = repos.filter(url => !previousRepos.has(url));
  const data = {
    _note: '去重热库:仅保留已见仓库 URL;watch/borrowed 元数据在 references/borrowed-watch.json。洞察员默认只读 repos,不要读取全量历史 insights。',
    updated_at: opts.nowIso || nowIso(opts.now || new Date()),
    repos,
  };
  const expectedKeys = ['_note', 'updated_at', 'repos'];
  const inputKeys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).sort() : [];
  const shapeChanged = JSON.stringify(inputKeys) !== JSON.stringify(expectedKeys.slice().sort());
  const reposChanged = JSON.stringify(collectRepoUrls(input && input.repos).map(normalizeRepoUrl).filter(Boolean)) !== JSON.stringify(repos);
  return {
    data,
    added,
    changed: shapeChanged || reposChanged || added.length > 0,
  };
}

function slimSeenReposFile(file, opts = {}) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    data = {};
  }
  const result = slimSeenReposData(data, opts);
  if (result.changed || !fs.existsSync(file)) atomicWriteJson(file, result.data);
  return {
    updated: result.changed,
    added: result.added,
    repos: result.data.repos.length,
  };
}

function markerId(block) {
  const m = /<!--\s*insight-scout-run:([^>]+?)\s*-->/.exec(String(block || ''));
  return m ? m[1].trim() : '';
}

function splitInsightBatches(text) {
  const source = String(text || '');
  const re = /^<!--\s*insight-scout-run:[^>]+?-->\s*$/gm;
  const starts = [];
  let m;
  while ((m = re.exec(source))) starts.push(m.index);
  if (!starts.length) return { preamble: source, batches: [] };
  const batches = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : source.length;
    const block = source.slice(start, end).replace(/\s*$/g, '\n');
    batches.push({ id: markerId(block), text: block });
  }
  return { preamble: source.slice(0, starts[0]).replace(/\s*$/g, '\n'), batches };
}

function batchMonth(block, fallback = new Date()) {
  const text = String(block || '');
  let m = /^##\s+(\d{4})-(\d{2})-\d{2}/m.exec(text);
  if (m) return `${m[1]}${m[2]}`;
  m = /(?:20\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/.exec(text);
  if (m) return m[0].slice(0, 6);
  const d = new Date(fallback);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function archiveHeader(month) {
  return [
    `# 洞察员归档 ${month.slice(0, 4)}-${month.slice(4, 6)}`,
    '',
    '> 冷区归档:由 `board/insights/scripts/maintain-insights.js` 维护。默认不要整卷读入上下文;按仓库名、URL、slot 或标题用 `rg` 命中后只读相关小节。',
    '',
  ].join('\n');
}

function buildHotPreamble(timestamp) {
  return [
    '# 洞察员 · 借鉴分析(insights)',
    '',
    '> 洞察员产出:找优秀开源案例 + 分析「玉兔6 有哪些值得借鉴」。给老板 / CEO 参考,不是待办任务(只有分析出明确该做的行动,才单独提一张待办卡)。',
    '>',
    '> 渐进披露:默认只读本文件热区。热区定义为最近 4 个 insight-scout 单次运行批次,并受 100KB 上限保护;更早批次归档到 `references/archive-YYYYMM.md`。',
    '>',
    '> 按需检索:需要历史上下文时,先看 `references/archive-index.md`,或用 `rg "<仓库名|URL|slot|标题>" board/insights/references/` 定位归档文件,只读命中的小节。',
    '>',
    '> 去重:默认读取 `seen-repos.json` 的 `repos` URL 列表即可;watch/借鉴库元数据在 `references/borrowed-watch.json`,分析正文不回灌到去重热库。',
    `>`,
    `> 最近维护:${timestamp}`,
    '',
    '<!-- insights-hot-zone: keep-last-4-batches max-100KB -->',
    '',
  ].join('\n');
}

function chooseHotBatches(batches, keepBatches, maxBytes, timestamp) {
  let keep = batches.slice(Math.max(0, batches.length - keepBatches));
  let hotText = buildHotPreamble(timestamp) + keep.map(batch => batch.text.trimEnd() + '\n').join('\n');
  while (keep.length > 1 && Buffer.byteLength(hotText) > maxBytes) {
    keep = keep.slice(1);
    hotText = buildHotPreamble(timestamp) + keep.map(batch => batch.text.trimEnd() + '\n').join('\n');
  }
  const keepIds = new Set(keep.map(batch => batch.id).filter(Boolean));
  return {
    keep,
    keepIds,
    hotText,
  };
}

function archiveBatches(referencesDir, batches, timestamp) {
  const grouped = new Map();
  for (const batch of batches) {
    const month = batchMonth(batch.text, timestamp);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(batch);
  }
  const archived = [];
  for (const [month, list] of grouped.entries()) {
    const archiveFile = path.join(referencesDir, `archive-${month}.md`);
    let archiveText = '';
    try { archiveText = fs.readFileSync(archiveFile, 'utf8'); } catch (_) {}
    if (!archiveText.trim()) archiveText = archiveHeader(month);
    let changed = false;
    for (const batch of list) {
      if (batch.id && archiveText.includes(`insight-scout-run:${batch.id}`)) {
        archived.push({ id: batch.id, archive: archiveFile, status: 'already-present' });
        continue;
      }
      archiveText = archiveText.replace(/\s*$/g, '\n\n') + batch.text.trimEnd() + '\n';
      changed = true;
      archived.push({ id: batch.id, archive: archiveFile, status: 'archived' });
    }
    if (changed) atomicWrite(archiveFile, archiveText);
  }
  return archived;
}

function archiveStats(referencesDir) {
  let files = [];
  try { files = fs.readdirSync(referencesDir).filter(f => /^archive-\d{6}\.md$/.test(f)).sort(); } catch (_) {}
  return files.map(file => {
    const full = path.join(referencesDir, file);
    const text = fs.readFileSync(full, 'utf8');
    return {
      file,
      batches: (text.match(/<!--\s*insight-scout-run:/g) || []).length,
      headings: (text.match(/^##\s+/gm) || []).length,
      bytes: Buffer.byteLength(text),
    };
  });
}

function writeArchiveIndex(referencesDir, opts = {}) {
  const timestamp = opts.timestamp || nowIso();
  const stats = archiveStats(referencesDir);
  const lines = [
    '# 洞察员 references 索引',
    '',
    `更新时间:${timestamp}`,
    '',
    '## 默认读取顺序',
    '- 热区:`../insights.md` 只保留最近 4 个 insight-scout 运行批次,并受 100KB 上限保护。',
    '- 去重:`../seen-repos.json` 只保留 `repos` URL 列表,用于下一批去重与追加。',
    '- 冷区:需要历史上下文时,先按关键词/URL/slot 用 `rg` 检索本目录,再只读命中的归档小节。',
    '',
    '## 归档分卷',
  ];
  if (!stats.length) lines.push('- 暂无归档分卷。');
  for (const item of stats) {
    lines.push(`- \`${item.file}\`:批次 ${item.batches} 个,标题 ${item.headings} 个,${item.bytes} bytes。`);
  }
  lines.push(
    '',
    '## 外移元数据',
    '- `borrowed-watch.json`:watch 配置 + borrowed_libraries 元数据;从 seen-repos 热库外移,按需读取。',
    '',
    '## 备份收敛',
    `- 根目录每个基准文件只保留最近 ${DEFAULT_KEEP_ROOT_BACKUPS} 份 \`.bak/.pre\`;旧快照见 \`backups/backup-manifest.json\` 与 \`backups/\`。`,
    '',
    '## 并发与回滚',
    '- 维护脚本使用 `../.archive.lock` 目录锁;写归档、索引、热区和 JSON 均先写临时文件再 rename。',
    '- 若读取 `insights.md` 失败,脚本直接报错退出,不会删除或移动任何批次。'
  );
  atomicWrite(path.join(referencesDir, 'archive-index.md'), lines.join('\n') + '\n');
}

function compactRootBackups(insightsDir, referencesDir, opts = {}) {
  const keepCount = opts.keepRootBackups || DEFAULT_KEEP_ROOT_BACKUPS;
  const backupsDir = path.join(referencesDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const bases = ['insights.md', 'seen-repos.json'];
  const kept = {};
  const moved = [];
  let files = [];
  try { files = fs.readdirSync(insightsDir); } catch (_) {}
  for (const base of bases) {
    const matches = files
      .filter(file => file.startsWith(`${base}.bak`) || file.startsWith(`${base}.pre`))
      .map(file => {
        const full = path.join(insightsDir, file);
        const stat = fs.statSync(full);
        return { file, full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    kept[base] = matches.slice(0, keepCount).map(item => ({
      path: relPath(path.join(insightsDir, item.file)),
      bytes: item.bytes,
    }));
    for (const item of matches.slice(keepCount)) {
      let target = path.join(backupsDir, item.file);
      if (fs.existsSync(target)) {
        target = path.join(backupsDir, `${item.file}.moved-${Date.now()}`);
      }
      fs.renameSync(item.full, target);
      moved.push({
        from: relPath(item.full),
        to: relPath(target),
        bytes: item.bytes,
      });
    }
  }
  return { kept, moved };
}

function relPath(file) {
  const cwd = process.cwd();
  const rel = path.relative(cwd, file).split(path.sep).join('/');
  return rel && !rel.startsWith('..') ? rel : file.split(path.sep).join('/');
}

function updateBackupManifest(referencesDir, compactResult, timestamp) {
  const file = path.join(referencesDir, 'backups', 'backup-manifest.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  data._note = `旧 .bak/.pre 已从 board/insights 根目录移入 references/backups;根目录每个基准文件仅保留最近 ${DEFAULT_KEEP_ROOT_BACKUPS} 份。`;
  data.keep_policy = `keep latest ${DEFAULT_KEEP_ROOT_BACKUPS} root snapshots per base file; move older snapshots to references/backups`;
  data.last_maintenance = {
    updated_at: timestamp,
    kept: compactResult.kept,
    moved: compactResult.moved,
  };
  atomicWriteJson(file, data);
}

function maintainInsightsLayout(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const insightsDir = opts.insightsDir || path.join(workspaceRoot, 'board', 'insights');
  const referencesDir = path.join(insightsDir, 'references');
  const insightsFile = path.join(insightsDir, 'insights.md');
  const seenReposFile = path.join(insightsDir, 'seen-repos.json');
  const timestamp = opts.timestamp || nowIso(opts.now || new Date());
  const keepBatches = opts.keepBatches || DEFAULT_KEEP_BATCHES;
  const maxHotBytes = opts.maxHotBytes || DEFAULT_MAX_HOT_BYTES;
  const run = () => {
    const text = fs.readFileSync(insightsFile, 'utf8');
    const beforeBytes = Buffer.byteLength(text);
    const parsed = splitInsightBatches(text);
    const chosen = chooseHotBatches(parsed.batches, keepBatches, maxHotBytes, timestamp);
    const archiveCandidates = parsed.batches.filter(batch => !chosen.keepIds.has(batch.id));
    let archived = [];
    let hotChanged = false;
    if (archiveCandidates.length) {
      fs.mkdirSync(referencesDir, { recursive: true });
      archived = archiveBatches(referencesDir, archiveCandidates, timestamp);
      writeArchiveIndex(referencesDir, { timestamp });
      atomicWrite(insightsFile, chosen.hotText);
      hotChanged = true;
    } else if (beforeBytes > maxHotBytes && parsed.batches.length) {
      writeArchiveIndex(referencesDir, { timestamp });
      atomicWrite(insightsFile, chosen.hotText);
      hotChanged = true;
    }
    const seen = slimSeenReposFile(seenReposFile, { nowIso: timestamp });
    const compact = compactRootBackups(insightsDir, referencesDir, { keepRootBackups: opts.keepRootBackups || DEFAULT_KEEP_ROOT_BACKUPS });
    updateBackupManifest(referencesDir, compact, timestamp);
    const afterText = fs.readFileSync(insightsFile, 'utf8');
    return {
      ok: true,
      insights: {
        beforeBytes,
        afterBytes: Buffer.byteLength(afterText),
        beforeBatches: parsed.batches.length,
        hotBatches: splitInsightBatches(afterText).batches.length,
        archived: archived.filter(item => item.status === 'archived').length,
        alreadyArchived: archived.filter(item => item.status === 'already-present').length,
        changed: hotChanged,
      },
      seenRepos: seen,
      backups: {
        kept: compact.kept,
        moved: compact.moved.length,
      },
      archives: archiveStats(referencesDir),
    };
  };
  if (opts.lock === false) return run();
  return withInsightsLock(insightsDir, run, { reason: 'insights-maintenance', now: opts.now });
}

function verifyInsightsLayout(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const insightsDir = opts.insightsDir || path.join(workspaceRoot, 'board', 'insights');
  const referencesDir = path.join(insightsDir, 'references');
  const insightsFile = path.join(insightsDir, 'insights.md');
  const seenReposFile = path.join(insightsDir, 'seen-repos.json');
  const text = fs.readFileSync(insightsFile, 'utf8');
  const parsed = splitInsightBatches(text);
  const bytes = Buffer.byteLength(text);
  const seen = JSON.parse(fs.readFileSync(seenReposFile, 'utf8'));
  const seenKeys = Object.keys(seen).sort();
  const rootFiles = fs.readdirSync(insightsDir);
  const backupCounts = {};
  for (const base of ['insights.md', 'seen-repos.json']) {
    backupCounts[base] = rootFiles.filter(file => file.startsWith(`${base}.bak`) || file.startsWith(`${base}.pre`)).length;
  }
  const errors = [];
  const keepBatches = opts.keepBatches || DEFAULT_KEEP_BATCHES;
  const maxHotBytes = opts.maxHotBytes || DEFAULT_MAX_HOT_BYTES;
  const keepRootBackups = opts.keepRootBackups || DEFAULT_KEEP_ROOT_BACKUPS;
  if (parsed.batches.length > keepBatches) errors.push(`hot batches ${parsed.batches.length} > ${keepBatches}`);
  if (bytes > maxHotBytes) errors.push(`hot bytes ${bytes} > ${maxHotBytes}`);
  if (JSON.stringify(seenKeys) !== JSON.stringify(['_note', 'repos', 'updated_at'])) errors.push(`seen-repos keys ${seenKeys.join(',')} not slim`);
  if (!Array.isArray(seen.repos)) errors.push('seen-repos.repos is not an array');
  for (const [base, count] of Object.entries(backupCounts)) {
    if (count > keepRootBackups) errors.push(`${base} root backups ${count} > ${keepRootBackups}`);
  }
  const archives = archiveStats(referencesDir);
  if (!archives.length) errors.push('no archive files found');
  return {
    ok: errors.length === 0,
    errors,
    hot: { bytes, batches: parsed.batches.length },
    seenRepos: { keys: seenKeys, repos: Array.isArray(seen.repos) ? seen.repos.length : 0 },
    backups: backupCounts,
    archives,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace') opts.workspaceRoot = path.resolve(argv[++i]);
    else if (arg === '--verify' || arg === '--check') opts.verify = true;
    else if (arg === '--keep-batches') opts.keepBatches = Number(argv[++i]);
    else if (arg === '--max-hot-bytes') opts.maxHotBytes = Number(argv[++i]);
    else if (arg === '--keep-root-backups') opts.keepRootBackups = Number(argv[++i]);
  }
  return opts;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = opts.verify ? verifyInsightsLayout(opts) : maintainInsightsLayout(opts);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exit(1);
  } catch (e) {
    process.stderr.write(String(e && e.stack || e) + '\n');
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_KEEP_BATCHES,
  DEFAULT_MAX_HOT_BYTES,
  DEFAULT_KEEP_ROOT_BACKUPS,
  withInsightsLock,
  maintainInsightsLayout,
  verifyInsightsLayout,
  splitInsightBatches,
  slimSeenReposData,
  slimSeenReposFile,
  normalizeRepoUrl,
};
