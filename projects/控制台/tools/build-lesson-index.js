#!/usr/bin/env node
'use strict';
/*
 * build-lesson-index:解析 memory/experience.md → shared/reference/lesson-index.json(拍板 Q9)。
 * 条目识别:以「- **标题**」开头的行(含嵌套的同族子条目);
 * 每条提取 { title, keywords[], domains[], summary(≤200字:现象+做法), line, source_line }。
 * keywords 从 标题+根因 提取六域领域词(领域词表单一来源:shared/engine/lesson-index.js)。
 *
 * 用法:
 *   node projects/控制台/tools/build-lesson-index.js            # 生成/覆盖索引
 *   node projects/控制台/tools/build-lesson-index.js --check    # 校验索引与源文件 mtime 一致性(不一致 exit 1)
 *   可选:--root DIR / --source FILE / --out FILE(测试/工具化用)
 */
const fs = require('fs');
const path = require('path');
const LessonIndex = require('../../../shared/engine/lesson-index');

const DOMAIN_KEYWORDS = LessonIndex.DOMAIN_KEYWORDS;
const DEFAULT_SOURCE_REL = path.join('memory', 'experience.md');
const DEFAULT_OUT_REL = path.join('shared', 'reference', 'lesson-index.json');

// 「- **标题**:现象…」;[::]? 吞掉标题后的冒号,余下为现象起始文本。
const ENTRY_RE = /^\s*-\s+\*\*(.+?)\*\*[::]?\s*(.*)$/;
const ROOT_CAUSE_RE = /^\s*-\s*根因[^::]{0,40}[::]\s*(.*)$/;
const APPROACH_RE = /^\s*-\s*做法[^::]{0,40}[::]\s*(.*)$/;

function cleanText(s) {
  return String(s || '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, max) {
  const t = String(s || '');
  return t.length > max ? t.slice(0, Math.max(0, max - 1)) + '…' : t;
}

// 解析 markdown → 原始条目 [{ title, phenomenon, rootCause, approach, line(1-based) }]
function parseLessons(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const entries = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#/.test(line)) { current = null; continue; } // 标题行终止当前条目
    const m = line.match(ENTRY_RE);
    if (m) {
      current = {
        title: cleanText(m[1]),
        phenomenon: cleanText(m[2]),
        rootCause: '',
        approach: '',
        line: i + 1,
      };
      if (current.title) entries.push(current);
      continue;
    }
    if (!current) continue;
    if (!current.rootCause) {
      const rc = line.match(ROOT_CAUSE_RE);
      if (rc) { current.rootCause = cleanText(rc[1]); continue; }
    }
    if (!current.approach) {
      const ap = line.match(APPROACH_RE);
      if (ap) { current.approach = cleanText(ap[1]); continue; }
    }
  }
  return entries;
}

// 领域词提取:按包含匹配归域(英文词 token 边界,中文词包含;实现同 lesson-index.textHasKeyword)。
function keywordsForText(text) {
  const keywords = [];
  const domains = [];
  for (const [domain, words] of Object.entries(DOMAIN_KEYWORDS)) {
    let domainHit = false;
    for (const kw of words) {
      if (LessonIndex.textHasKeyword(text, kw)) { keywords.push(kw); domainHit = true; }
    }
    if (domainHit) domains.push(domain);
  }
  return { keywords, domains };
}

function lessonFromEntry(entry, sourceRel) {
  // keywords 来源=标题+根因(拍板);根因缺失(如成功模式条目)退化用现象文本。
  const kwSource = `${entry.title} ${entry.rootCause || entry.phenomenon || ''}`;
  const { keywords, domains } = keywordsForText(kwSource);
  const pieces = [];
  if (entry.phenomenon) pieces.push(`现象:${truncate(entry.phenomenon, 110)}`);
  if (entry.approach) pieces.push(`做法:${truncate(entry.approach, 160)}`);
  else if (entry.rootCause) pieces.push(`根因:${truncate(entry.rootCause, 110)}`);
  const summary = truncate(pieces.join(';'), 200);
  return {
    title: truncate(entry.title, 80),
    keywords,
    domains,
    summary,
    line: entry.line,
    source_line: `${sourceRel}:${entry.line}`,
  };
}

function buildIndex({ markdown, mtimeMs, sourceRel }) {
  const rel = String(sourceRel || DEFAULT_SOURCE_REL).split(path.sep).join('/');
  const lessons = parseLessons(markdown).map(e => lessonFromEntry(e, rel));
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source: rel,
    source_mtime_ms: Math.floor(Number(mtimeMs) || 0),
    entry_count: lessons.length,
    domains: DOMAIN_KEYWORDS,
    lessons,
  };
}

function buildIndexFromFile(sourceFile, sourceRel) {
  const markdown = fs.readFileSync(sourceFile, 'utf8');
  const st = fs.statSync(sourceFile);
  return buildIndex({ markdown, mtimeMs: st.mtimeMs, sourceRel });
}

function writeIndex(index, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n');
}

// --check:索引存在、可解析,且 source_mtime_ms 与源文件当前 mtime 一致。
function checkIndex({ sourceFile, outFile }) {
  if (!fs.existsSync(outFile)) return { ok: false, reason: 'index_missing', out: outFile };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (_) {
    return { ok: false, reason: 'index_unparsable', out: outFile };
  }
  if (!data || !Array.isArray(data.lessons)) return { ok: false, reason: 'index_invalid', out: outFile };
  if (!fs.existsSync(sourceFile)) return { ok: false, reason: 'source_missing', source: sourceFile };
  const mtime = Math.floor(fs.statSync(sourceFile).mtimeMs);
  if (mtime !== data.source_mtime_ms) {
    return {
      ok: false,
      reason: 'source_mtime_mismatch',
      source_mtime_ms: mtime,
      index_mtime_ms: data.source_mtime_ms,
      hint: '源文件已更新,请重跑 build-lesson-index.js 再生成索引',
    };
  }
  return { ok: true, entry_count: data.entry_count, source_mtime_ms: data.source_mtime_ms };
}

function parseArgs(argv) {
  const args = { check: false, root: null, source: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const root = path.resolve(args.root || path.resolve(__dirname, '..', '..', '..'));
  const sourceFile = path.resolve(args.source || path.join(root, DEFAULT_SOURCE_REL));
  const outFile = path.resolve(args.out || path.join(root, DEFAULT_OUT_REL));
  const sourceRel = path.relative(root, sourceFile) || DEFAULT_SOURCE_REL;

  if (args.check) {
    const result = checkIndex({ sourceFile, outFile });
    console.log(JSON.stringify(Object.assign({ mode: 'check' }, result)));
    return result.ok ? 0 : 1;
  }

  if (!fs.existsSync(sourceFile)) {
    console.log(JSON.stringify({ mode: 'build', ok: false, reason: 'source_missing', source: sourceFile }));
    return 1;
  }
  const index = buildIndexFromFile(sourceFile, sourceRel);
  writeIndex(index, outFile);
  console.log(JSON.stringify({
    mode: 'build',
    ok: true,
    out: outFile,
    entry_count: index.entry_count,
    with_keywords: index.lessons.filter(l => l.keywords.length).length,
  }));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { parseLessons, buildIndex, buildIndexFromFile, checkIndex, keywordsForText, writeIndex, main };
