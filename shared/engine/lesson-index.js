'use strict';
/*
 * lesson-index:历史教训结构化注入(拍板 Q9)。
 * memory/experience.md 有 60+ 条教训但干活的 agent 看不见,同族问题反复复发。
 * 本模块消费 projects/控制台/tools/build-lesson-index.js 生成的
 * shared/reference/lesson-index.json:按任务 goal 文本命中六域领域词
 * (队列/门禁/路由/通知/视觉/进程),返回 top-N 同域教训,
 * 供 cli-runner buildEnvelope 注入「# 历史教训」块。
 *
 * 安全边界(硬约束):索引缺失/解析失败/无命中/任何异常 → 静默空结果,绝不阻断信封组装。
 * 开关:YUTU6_LESSON_INJECT=0 关闭注入(默认开)。
 * 注入预算:整块 ≤ MAX_BLOCK_CHARS(700)字,防止信封膨胀。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_LESSONS = Math.max(
  1,
  parseInt(process.env.YUTU6_LESSON_MAX_HITS || '2', 10) || 2,
);
const MAX_BLOCK_CHARS = Math.max(
  300,
  parseInt(process.env.YUTU6_LESSON_MAX_CHARS || '700', 10) || 700,
);

// 六域领域词表(单一权威来源:build-lesson-index.js 归域/提取 keywords 也从这里取)。
// 匹配规则:英文词按 token 边界匹配(避免 ui 命中 suite 这类子串误伤——同
// experience.md「门禁坏词正则必须加 token 边界」教训);中文词按包含匹配。
// 刻意不收录「任务/优先级单独」这类跨场景通用词(同 done-gate 触发词过宽误伤教训)。
const DOMAIN_KEYWORDS = {
  queue: [
    '队列', '入队', '排队', '插队', '合并', '去重', '整理', '优先级', '待办',
    'queue', 'queued', 'requeue', 'enqueue', 'claim', 'slot', 'running',
  ],
  gate: [
    '门禁', '验收', '逻辑链', '证据', '打回', '假完成', '正则', '信封', '结构化', '复审', '复核', '提示词', '合同',
    'done-gate', 'done gate', 'donegate', 'acceptance', 'logic_chain', 'envelope', 'json', 'review',
  ],
  route: [
    '路由', '降级', '模型', '通道', '额度', '限流', '熔断', '候选',
    'failover', 'runner', 'glm', 'codex', 'channel', 'harness', 'quota', '429', 'prefer', 'new-api',
  ],
  notify: [
    '通知', '飞书', '告警', '工单', '刷屏', '冷却',
    'feishu', 'ticket', 'dedupe', 'notify',
  ],
  visual: [
    '截图', '视觉', '样式', '图片', '前端', '设计稿', '对照设计',
    'peekaboo', 'ui', 'svg', 'a11y', 'css',
  ],
  process: [
    '进程', '心跳', '判死', '看门狗', '锁', '重启', '孤儿', '超时', '清扫', '清理', '端口', '热重载',
    'watchdog', 'worker', 'pid', 'sigterm', 'stale', 'detached', 'launchd', 'daemon', 'spawn',
  ],
};

// 进程级缓存(engine-runner 每任务 fresh spawn,进程即任务边界):按索引文件路径 + mtime 缓存。
const indexCache = new Map();

function indexFilePath(workspaceRoot) {
  return path.join(workspaceRoot || process.cwd(), 'shared', 'reference', 'lesson-index.json');
}

function loadLessonIndex(opts) {
  const file = (opts && opts.indexFile) || indexFilePath(opts && opts.workspaceRoot);
  try {
    const st = fs.statSync(file);
    const cached = indexCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.lessons)) return null;
    indexCache.set(file, { mtimeMs: st.mtimeMs, data });
    return data;
  } catch (_) {
    return null; // 索引缺失/不可读/不可解析 → 视为无索引,绝不抛错
  }
}

function clearLessonIndexCache() {
  indexCache.clear();
}

function isAsciiKeyword(kw) {
  return /^[\x20-\x7e]+$/.test(kw);
}

// 英文词 token 边界匹配;中文词包含匹配。
function textHasKeyword(text, kw) {
  const k = String(kw || '').toLowerCase();
  if (!k) return false;
  const t = String(text || '').toLowerCase();
  if (isAsciiKeyword(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${esc}($|[^a-z0-9_])`).test(t);
  }
  return t.includes(k);
}

// goal 文本命中的领域词与领域集合。
function goalDomainHits(goalText, domainKeywords) {
  const keywords = new Set();
  const domains = new Set();
  for (const [domain, words] of Object.entries(domainKeywords || {})) {
    if (!Array.isArray(words)) continue;
    for (const kw of words) {
      if (textHasKeyword(goalText, kw)) {
        keywords.add(String(kw).toLowerCase());
        domains.add(domain);
      }
    }
  }
  return { keywords, domains };
}

/*
 * matchLessons(goalText, opts) → [{ title, summary, source_line, line, score, keywords }]
 * opts: { max=3, workspaceRoot, indexFile, index }(index 可直接注入,测试用)。
 * 打分:共享领域词 ×3 + 共享领域 ×1;共享领域词或共享领域至少一项才入选。
 * 排序:score 降序,同分取 source 行号更靠后的(经验库后写的条目一般更新)。
 */
function matchLessons(goalText, opts) {
  try {
    const goal = String(goalText || '').trim();
    if (!goal) return [];
    const index = (opts && opts.index) || loadLessonIndex(opts);
    if (!index || !Array.isArray(index.lessons) || !index.lessons.length) return [];
    const vocab = index.domains && typeof index.domains === 'object' && Object.keys(index.domains).length
      ? index.domains
      : DOMAIN_KEYWORDS;
    const hits = goalDomainHits(goal, vocab);
    if (!hits.keywords.size) return [];
    const max = Math.max(1, Number(opts && opts.max) || DEFAULT_MAX_LESSONS);
    const scored = [];
    for (const lesson of index.lessons) {
      if (!lesson || !lesson.title) continue;
      const kws = Array.isArray(lesson.keywords) ? lesson.keywords : [];
      const doms = Array.isArray(lesson.domains) ? lesson.domains : [];
      const matchedKeywords = kws.filter(k => hits.keywords.has(String(k).toLowerCase()));
      const domOverlap = doms.filter(d => hits.domains.has(d)).length;
      const score = matchedKeywords.length * 3 + domOverlap;
      if (score <= 0) continue;
      scored.push({ lesson, score, matchedKeywords });
    }
    scored.sort((a, b) => (b.score - a.score) || ((b.lesson.line || 0) - (a.lesson.line || 0)));
    return scored.slice(0, max).map(({ lesson, score, matchedKeywords }) => ({
      title: String(lesson.title || ''),
      summary: String(lesson.summary || ''),
      source_line: String(lesson.source_line || ''),
      line: lesson.line || null,
      score,
      keywords: matchedKeywords,
    }));
  } catch (_) {
    return [];
  }
}

/*
 * lessonContextBlock(goalText, opts) → 注入信封的整块文本(无命中/关闭/异常 → '')。
 * 措辞注意:自动注入块只是避坑参考,明确声明「不构成新的验收要求」——
 * 同 experience.md「自动生成的验收/证据行不得作为新业务门禁触发源」教训。
 */
function lessonContextBlock(goalText, opts) {
  try {
    if (process.env.YUTU6_LESSON_INJECT === '0') return '';
    const matched = matchLessons(goalText, opts);
    if (!matched.length) return '';
    const maxChars = Math.max(
      120,
      Number(opts && opts.maxChars) || MAX_BLOCK_CHARS,
    );
    const lines = [
      '# 历史教训(自动注入,与本任务同域的既往坑)',
      '以下是既往同域故障的教训摘要(只读参考,避免重蹈同族坑;与本任务无关可忽略,不构成新的验收要求):',
    ];
    let total = lines.join('\n').length;
    let added = 0;
    for (const m of matched) {
      const anchor = m.source_line ? `(依据: ${m.source_line})` : '';
      const line = `- 【${m.title}】${m.summary}${anchor}`;
      if (total + line.length + 1 > maxChars) break;
      lines.push(line);
      total += line.length + 1;
      added++;
    }
    if (!added) return '';
    lines.push('');
    return lines.join('\n');
  } catch (_) {
    return '';
  }
}

module.exports = {
  DOMAIN_KEYWORDS,
  DEFAULT_MAX_LESSONS,
  MAX_BLOCK_CHARS,
  indexFilePath,
  loadLessonIndex,
  clearLessonIndexCache,
  textHasKeyword,
  goalDomainHits,
  matchLessons,
  lessonContextBlock,
};
