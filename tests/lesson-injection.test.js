#!/usr/bin/env node
'use strict';

// 教训结构化注入 守卫(拍板 Q9):
// 1) build-lesson-index 解析 experience 片段 → 条目数/keywords/行号锚点正确;--check 校验 mtime 一致性;
// 2) matchLessons 按 goal 命中领域词返回 top3,注入块预算 ≤1200 字;
// 3) buildEnvelope 注入 "# 历史教训" 块;
// 4) YUTU6_LESSON_INJECT=0 关闭 / 索引缺失 → 不注入且不报错(绝不阻断信封)。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Builder = require('../projects/控制台/tools/build-lesson-index');
const LessonIndex = require('../shared/engine/lesson-index');
const { buildEnvelope } = require('../shared/engine/cli-runner');

const BUILDER_CLI = path.resolve(__dirname, '..', 'projects', '控制台', 'tools', 'build-lesson-index.js');

// 夹具:experience.md 片段(3 条教训:队列域×2、视觉域×1;首条在第 5 行)
const FIXTURE = [
  '# 经验库 · 成功模式 + 失败教训',
  '',
  '## 失败教训(已踩过的坑)',
  '',
  '- **跨队列优先级丢失**:priority 0 的任务路由到下游队列后变回 50。',
  '  - 根因:路由时没传递优先级。',
  '  - 做法:在正确的下游队列里重新插队;或修路由让其携带优先级。',
  '',
  '- **队列清扫器误杀活引擎**:worker 刚 claim 任务就被判 engine 缺失而 requeue。',
  '  - 根因:清扫逻辑把 worker pid 当 engine pid,心跳判死数据源不对齐。',
  '  - 做法(可验证):恢复路径统一走受保护的 engine pid 解析,fresh running 加等待窗口。',
  '',
  '- **截图失败标记被当完成证据**:视觉验收把 failure.json 当截图完成证据。',
  '  - 根因:视觉证据门未绑定 peekaboo 图片路径本身。',
  '  - 做法:完成行必须给真实 peekaboo 截图路径,失败标记只能写阻塞说明。',
].join('\n');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-inject-'));
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'memory', 'experience.md'), FIXTURE);
  return root;
}

function withEnv(key, val, fn) {
  const prev = process.env[key];
  if (val === undefined) delete process.env[key]; else process.env[key] = val;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  }
}

// ---------- 1) 索引构建 ----------
function testBuildIndexFromFixture() {
  const root = makeRoot();
  try {
    const res = spawnSync(process.execPath, [BUILDER_CLI, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'build 应 exit 0: ' + res.stderr + res.stdout);
    const outFile = path.join(root, 'shared', 'reference', 'lesson-index.json');
    assert(fs.existsSync(outFile), '应落盘 shared/reference/lesson-index.json');
    const index = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.strictEqual(index.entry_count, 3, '夹具应解析出 3 条教训');
    assert.strictEqual(index.lessons.length, 3);

    const [l1, l2, l3] = index.lessons;
    // 行号锚点(夹具首条在第 5 行)
    assert.strictEqual(l1.line, 5, '首条行号应为 5,实际 ' + l1.line);
    assert.strictEqual(l1.source_line, 'memory/experience.md:5');
    assert.strictEqual(l2.line, 9);
    assert.strictEqual(l3.line, 13);
    // keywords/归域(标题+根因提取领域词)
    assert(l1.keywords.includes('队列'), 'l1 keywords 应含 队列: ' + JSON.stringify(l1.keywords));
    assert(l1.keywords.includes('优先级'), 'l1 keywords 应含 优先级');
    assert(l1.domains.includes('queue'), 'l1 应归队列域');
    assert(l1.domains.includes('route'), 'l1 根因含 路由 应归路由域');
    assert(l2.keywords.includes('心跳') && l2.keywords.includes('判死'), 'l2 keywords 应含 心跳/判死');
    assert(l2.domains.includes('process'), 'l2 应归进程域');
    assert(l3.keywords.includes('截图') && l3.keywords.includes('peekaboo'), 'l3 keywords 应含 截图/peekaboo');
    assert(l3.domains.includes('visual'), 'l3 应归视觉域');
    // summary ≤200 且含 现象+做法
    for (const l of index.lessons) {
      assert(l.summary.length <= 200, 'summary 应 ≤200 字');
      assert(/现象:/.test(l.summary), 'summary 应含现象');
      assert(/做法:/.test(l.summary), 'summary 应含做法');
    }

    // --check:一致 → exit 0
    const ok = spawnSync(process.execPath, [BUILDER_CLI, '--check', '--root', root], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, '--check 一致应 exit 0: ' + ok.stdout);
    // 源文件 mtime 变化 → exit 1
    const src = path.join(root, 'memory', 'experience.md');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(src, future, future);
    const stale = spawnSync(process.execPath, [BUILDER_CLI, '--check', '--root', root], { encoding: 'utf8' });
    assert.strictEqual(stale.status, 1, '--check 源已更新应 exit 1');
    assert(/source_mtime_mismatch/.test(stale.stdout), '应报 source_mtime_mismatch');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---------- 2) matchLessons 命中与预算 ----------
function testMatchLessonsQueueGoal() {
  const root = makeRoot();
  try {
    const index = Builder.buildIndexFromFile(path.join(root, 'memory', 'experience.md'), 'memory/experience.md');
    const matched = LessonIndex.matchLessons('队列合并整理:把重复任务去重后重新入队', { index });
    assert(matched.length >= 2, '队列合并 goal 应命中至少 2 条队列域教训: ' + JSON.stringify(matched.map(m => m.title)));
    assert(matched.length <= 3, '默认 top3');
    const titles = matched.map(m => m.title);
    assert(titles.includes('跨队列优先级丢失'), '应命中 跨队列优先级丢失');
    assert(titles.includes('队列清扫器误杀活引擎'), '应命中 队列清扫器误杀活引擎');
    assert(!titles.includes('截图失败标记被当完成证据'), '视觉域教训不应被队列 goal 命中');
    for (const m of matched) {
      assert(/^memory\/experience\.md:\d+$/.test(m.source_line), '返回应带行号锚点: ' + m.source_line);
      assert(m.summary, '返回应带 summary');
    }
    // 无领域词 goal → 空
    assert.deepStrictEqual(LessonIndex.matchLessons('写一首关于春天的诗', { index }), []);
    assert.deepStrictEqual(LessonIndex.matchLessons('', { index }), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testInjectionBudget() {
  // 构造 10 条超长教训,全部命中队列域;整块必须 ≤1200 字
  const lessons = [];
  for (let i = 0; i < 10; i++) {
    lessons.push({
      title: `队列超长教训${i}` + 'x'.repeat(70),
      keywords: ['队列'],
      domains: ['queue'],
      summary: ('现象:' + '长'.repeat(96) + ';做法:' + '改'.repeat(95)).slice(0, 200),
      line: 10 + i,
      source_line: `memory/experience.md:${10 + i}`,
    });
  }
  const index = { version: 1, domains: LessonIndex.DOMAIN_KEYWORDS, lessons };
  const block = LessonIndex.lessonContextBlock('队列合并', { index, max: 10 });
  assert(block, '应有注入块');
  assert(block.length <= LessonIndex.MAX_BLOCK_CHARS, `注入块应 ≤${LessonIndex.MAX_BLOCK_CHARS} 字,实际 ${block.length}`);
  assert(/# 历史教训/.test(block), '应带块标题');
}

// ---------- 3) 信封含教训块 ----------
function testEnvelopeContainsLessonBlock() {
  const root = makeRoot();
  try {
    const build = spawnSync(process.execPath, [BUILDER_CLI, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(build.status, 0);
    LessonIndex.clearLessonIndexCache();
    const env = withEnv('YUTU6_LESSON_INJECT', undefined, () => buildEnvelope(
      { id: 'implement', agent_role: 'worker_code' },
      { workspaceRoot: root, goal: '队列合并整理:把重复任务去重', acceptance: 'x' }
    ));
    assert(env.includes('# 历史教训(自动注入,与本任务同域的既往坑)'), '信封应含历史教训块');
    assert(/跨队列优先级丢失/.test(env), '信封应含命中的教训标题');
    assert(/memory\/experience\.md:5/.test(env), '信封应含行号锚点');
    assert(/不构成新的验收要求/.test(env), '注入块必须声明不构成新验收要求(防自动行反向触发门禁)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---------- 4) 开关关闭 / 索引缺失:不注入、不报错 ----------
function testDisabledSwitch() {
  const root = makeRoot();
  try {
    const build = spawnSync(process.execPath, [BUILDER_CLI, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(build.status, 0);
    LessonIndex.clearLessonIndexCache();
    const block = withEnv('YUTU6_LESSON_INJECT', '0', () =>
      LessonIndex.lessonContextBlock('队列合并整理', { workspaceRoot: root }));
    assert.strictEqual(block, '', 'YUTU6_LESSON_INJECT=0 应返空');
    const env = withEnv('YUTU6_LESSON_INJECT', '0', () => buildEnvelope(
      { id: 'implement', agent_role: 'worker_code' },
      { workspaceRoot: root, goal: '队列合并整理:把重复任务去重', acceptance: 'x' }
    ));
    assert(!/# 历史教训/.test(env), '开关关闭时信封不得含教训块');
    assert(/# 任务:implement/.test(env), '信封本体仍应正常组装');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testMissingIndexSilent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-noidx-'));
  try {
    LessonIndex.clearLessonIndexCache();
    const matched = withEnv('YUTU6_LESSON_INJECT', undefined, () =>
      LessonIndex.matchLessons('队列合并整理', { workspaceRoot: root }));
    assert.deepStrictEqual(matched, [], '索引缺失应返回空数组');
    const env = withEnv('YUTU6_LESSON_INJECT', undefined, () => buildEnvelope(
      { id: 'implement', agent_role: 'worker_code' },
      { workspaceRoot: root, goal: '队列合并整理:把重复任务去重', acceptance: 'x' }
    ));
    assert(!/# 历史教训/.test(env), '索引缺失时不注入');
    assert(/# 任务:implement/.test(env), '索引缺失绝不阻断信封组装');
    // 索引损坏(非法 JSON)同样静默
    fs.mkdirSync(path.join(root, 'shared', 'reference'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shared', 'reference', 'lesson-index.json'), '{broken');
    LessonIndex.clearLessonIndexCache();
    const env2 = withEnv('YUTU6_LESSON_INJECT', undefined, () => buildEnvelope(
      { id: 'implement', agent_role: 'worker_code' },
      { workspaceRoot: root, goal: '队列合并整理', acceptance: 'x' }
    ));
    assert(!/# 历史教训/.test(env2), '索引损坏时不注入');
    assert(/# 任务:implement/.test(env2), '索引损坏绝不阻断信封组装');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function main() {
  testBuildIndexFromFixture();
  testMatchLessonsQueueGoal();
  testInjectionBudget();
  testEnvelopeContainsLessonBlock();
  testDisabledSwitch();
  testMissingIndexSilent();
  console.log(JSON.stringify({ pass: true, suite: 'lesson-injection' }));
}

main();
