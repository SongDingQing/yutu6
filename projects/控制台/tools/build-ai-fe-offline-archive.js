#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = process.env.AI_FE_RAW_DIR || '/tmp/ai-fe-full-raw';
const OUTPUT_DIR = process.env.AI_FE_OUTPUT_DIR
  || '/Users/yutu6/Documents/参考知识库/AI前端设计面试题库-2026';
const INDEX_FILE = path.join(OUTPUT_DIR, '题库索引.json');
const RAW_OUTPUT_DIR = path.join(OUTPUT_DIR, '原始块数据');
const SHEET_ASSET_DIR = path.join(OUTPUT_DIR, 'assets', 'embedded-sheets');
const COLLECTION_FILE = 'AI前端设计面试题库-完整合集.md';

const CHAPTER_FILES = [
  '01-TypeScript与类型系统.md',
  '02-流式处理与实时通信.md',
  '03-前端状态管理与数据流.md',
  '04-性能优化与渲染.md',
  '05-前端AI架构设计.md',
  '06-AI特性与前端工程实践.md',
  '07-AI工程化与前端工具链.md',
  '08-大模型前端集成.md',
];

function cleanText(value) {
  return String(value || '')
    .replace(/\u200b/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function normalizeListText(value) {
  return cleanText(value)
    .replace(/^[◦•·]\s*/, '')
    .replace(/^(\d+[.)])\s*/, '$1 ');
}

function inferCodeLanguage(code, chapterNumber) {
  const sample = code.slice(0, 6000);
  if (/^\s*FROM\s+\S+/m.test(sample)) return 'dockerfile';
  if (/^\s*(name|on|jobs|steps|services|version):\s/m.test(sample)) return 'yaml';
  if (/^\s*#!/m.test(sample) || /\b(npm|pnpm|yarn|docker|git)\s+[a-z-]+/m.test(sample)) return 'bash';
  if (/^\s*[{[][\s\S]*["'][\w-]+["']\s*:/m.test(sample) && !/\b(interface|type|function|const|let|class)\b/.test(sample)) {
    return 'json';
  }
  if (/<\/?[A-Za-z][^>]*>/.test(sample) || /\bReact\.(FC|Component)\b/.test(sample)) return 'tsx';
  if (/\b(interface|type|enum|implements|satisfies|infer|keyof|Readonly|Promise<)\b/.test(sample)) return 'typescript';
  if (/\b(const|let|function|async|await|import|export|class)\b/.test(sample)) {
    return chapterNumber <= 5 ? 'typescript' : 'javascript';
  }
  return 'text';
}

function codeFence(code) {
  return code.includes('```') ? '````' : '```';
}

function externalLinks(block) {
  const seen = new Set();
  const links = [];
  for (const link of block.links || []) {
    const href = cleanText(link.href);
    const text = cleanText(link.text) || href;
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    links.push(`[${text}](${href})`);
  }
  return links;
}

function listDepth(block, byId) {
  let depth = 0;
  let parent = byId.get(block.parentId);
  while (parent) {
    if (/docx-(ordered|bullet)-block/.test(parent.classes)) depth += 1;
    parent = byId.get(parent.parentId);
  }
  return depth;
}

function numericBlockId(block) {
  const value = Number(block.id);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function orderDocumentBlocks(blocks) {
  const byId = new Map(blocks.map(block => [block.id, block]));
  const childrenByParent = new Map();

  for (const block of blocks) {
    const parentId = block.parentId || '';
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(block);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => numericBlockId(left) - numericBlockId(right));
  }

  const roots = blocks
    .filter(block => !byId.has(block.parentId))
    .sort((left, right) => numericBlockId(left) - numericBlockId(right));
  const ordered = [];
  const visited = new Set();

  function visit(block) {
    if (visited.has(block.id)) return;
    visited.add(block.id);
    ordered.push(block);
    for (const child of childrenByParent.get(block.id) || []) visit(child);
  }

  for (const root of roots) visit(root);
  for (const block of [...blocks].sort((left, right) => numericBlockId(left) - numericBlockId(right))) {
    visit(block);
  }

  if (ordered.length !== blocks.length) {
    throw new Error(`Document tree ordering lost blocks: expected ${blocks.length}, got ${ordered.length}`);
  }
  return ordered;
}

function renderBlock(block, context) {
  const { byId, chapterNumber } = context;
  const classes = block.classes || '';

  if (classes.includes('docx-divider-block')) return '';

  if (classes.includes('docx-code-block')) {
    const code = (block.codeLines || [])
      .map(line => String(line.text || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' '))
      .join('\n')
      .replace(/\s+$/g, '');
    if (!code) return '';
    const fence = codeFence(code);
    return `${fence}${inferCodeLanguage(code, chapterNumber)}\n${code}\n${fence}`;
  }

  if (classes.includes('docx-sheet-block')) {
    const assetName = `${String(chapterNumber).padStart(2, '0')}-sheet-block-${block.id}.png`;
    const assetPath = path.join(SHEET_ASSET_DIR, assetName);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Missing embedded sheet asset: ${assetPath}`);
    }
    return `![原文嵌入表格](assets/embedded-sheets/${assetName})`;
  }

  const text = normalizeListText(block.ownText);
  if (!text) return '';

  const links = externalLinks(block);
  const suffix = links.length ? `\n\n相关链接：${links.join('、')}` : '';
  const indent = '  '.repeat(listDepth(block, byId));

  if (classes.includes('docx-bullet-block')) {
    return `${indent}- ${text}${suffix}`;
  }
  if (classes.includes('docx-ordered-block')) {
    const normalized = /^\d+[.)]\s/.test(text) ? text : `1. ${text}`;
    return `${indent}${normalized}${suffix}`;
  }
  return `${text}${suffix}`;
}

function splitAnswers(raw, expectedQuestions) {
  const blocks = orderDocumentBlocks(raw.blocks || []);
  const headings = blocks.filter(block => (block.classes || '').includes('docx-heading2-block'));
  if (headings.length !== expectedQuestions.length) {
    throw new Error(
      `${raw.documentTitle}: expected ${expectedQuestions.length} questions, extracted ${headings.length}`,
    );
  }

  return headings.map((heading, index) => {
    const start = blocks.indexOf(heading) + 1;
    const nextHeading = headings[index + 1];
    const end = nextHeading ? blocks.indexOf(nextHeading) : blocks.length;
    return {
      heading,
      blocks: blocks.slice(start, end),
    };
  });
}

function auditCodeBlocks(raw, chapterFile) {
  const results = [];
  for (const block of raw.blocks || []) {
    if (!(block.classes || '').includes('docx-code-block')) continue;
    const numbers = (block.codeLines || []).map(line => Number(line.number));
    const max = numbers.length ? Math.max(...numbers) : 0;
    const missing = [];
    for (let line = 1; line <= max; line += 1) {
      if (!numbers.includes(line)) missing.push(line);
    }
    if (!numbers.length || missing.length || numbers.length !== max) {
      throw new Error(
        `${chapterFile}: incomplete code block ${block.id}; lines=${numbers.length}, max=${max}, missing=${missing.join(',')}`,
      );
    }
    results.push({
      blockId: block.id,
      lineCount: numbers.length,
    });
  }
  return results;
}

function buildChapter(chapter, chapterIndex, raw, chapterFile) {
  const chapterNumber = chapterIndex + 1;
  const byId = new Map((raw.blocks || []).map(block => [block.id, block]));
  const answers = splitAnswers(raw, chapter.questions);
  const codeAudit = auditCodeBlocks(raw, chapterFile);
  const sheetCount = (raw.blocks || []).filter(block => (block.classes || '').includes('docx-sheet-block')).length;
  const sections = [
    `# ${chapter.title}`,
    '',
    `- 原始文档：${chapter.url}`,
    `- 离线归档日期：2026-07-17`,
    `- 本章题数：${chapter.questions.length}`,
    `- 完整性：答案正文、代码示例、列表与嵌入表格均已本地归档`,
    '',
    '> 说明：下面每题先给出完整离线答案；原文锚点仅用于溯源，不再代替答案内容。',
    '',
  ];

  const answerAudits = [];
  answers.forEach((answer, questionIndex) => {
    const question = chapter.questions[questionIndex];
    const rendered = answer.blocks
      .map(block => renderBlock(block, { byId, chapterNumber }))
      .filter(Boolean);
    if (!rendered.length) {
      throw new Error(`${chapterFile}: question ${questionIndex + 1} has no local answer`);
    }

    const codeBlocks = answer.blocks.filter(block => (block.classes || '').includes('docx-code-block')).length;
    const sheets = answer.blocks.filter(block => (block.classes || '').includes('docx-sheet-block')).length;
    sections.push(
      `## ${question.text}`,
      '',
      '### 完整答案',
      '',
      rendered.join('\n\n'),
      '',
      `> 原文定位：[飞书原文](${chapter.url}${question.href})`,
      '',
    );
    answerAudits.push({
      question: question.text,
      contentBlocks: rendered.length,
      codeBlocks,
      sheets,
    });
  });

  return {
    markdown: `${sections.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`,
    audit: {
      chapter: chapter.title,
      file: chapterFile,
      questionCount: answers.length,
      answerCount: answerAudits.length,
      codeBlockCount: codeAudit.length,
      codeLineCount: codeAudit.reduce((sum, item) => sum + item.lineCount, 0),
      sheetCount,
      questions: answerAudits,
    },
  };
}

function buildReadme(audits, index) {
  const lines = [
    '# AI 前端设计面试题库（完整离线归档）',
    '',
    `- 来源：${index.source}`,
    '- 归档日期：2026-07-17',
    `- 章节：${audits.length}`,
    `- 题目与完整答案：${audits.reduce((sum, item) => sum + item.answerCount, 0)}`,
    `- 本地代码示例：${audits.reduce((sum, item) => sum + item.codeBlockCount, 0)} 个代码块，${audits.reduce((sum, item) => sum + item.codeLineCount, 0)} 行`,
    `- 嵌入表格：${audits.reduce((sum, item) => sum + item.sheetCount, 0)} 张`,
    '',
    '## 内容说明',
    '',
    '本目录已保存完整题干、完整答案正文、代码示例、列表层级和嵌入表格，可离线阅读。',
    '每题末尾仍保留飞书原文锚点，只用于来源校验，不承担答案内容。',
    `若希望一次搜索全部内容，可直接打开 [${COLLECTION_FILE}](${encodeURI(COLLECTION_FILE)})。`,
    '',
    '## 章节',
    '',
  ];

  audits.forEach((audit, indexNumber) => {
    lines.push(
      `${indexNumber + 1}. [${audit.chapter}](${encodeURI(audit.file)})：${audit.answerCount} 题，${audit.codeBlockCount} 个代码块，${audit.sheetCount} 张表格`,
    );
  });

  lines.push(
    '',
    '## 校验与原始数据',
    '',
    '- `归档校验报告.json`：题目、答案、代码行与表格的机器校验结果。',
    '- `原始块数据/`：从飞书虚拟文档逐段采集并按块合并后的结构化数据。',
    '- `章节截图/`：8 个章节的来源页面截图。',
    '- `assets/embedded-sheets/`：原文中的嵌入式表格截图。',
    '',
    '## 使用边界',
    '',
    '- 这是参考知识库，不直接替代玉兔6的生产实现规范。',
    '- 若原文后续更新，可通过原文锚点核对，再重新运行归档工具。',
    '',
  );
  return lines.join('\n');
}

function main() {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  if (!Array.isArray(index.chapters) || index.chapters.length !== CHAPTER_FILES.length) {
    throw new Error('Chapter index is incomplete');
  }

  fs.mkdirSync(RAW_OUTPUT_DIR, { recursive: true });
  const audits = [];
  const chapterMarkdown = [];

  index.chapters.forEach((chapter, chapterIndex) => {
    const chapterCode = String(chapterIndex + 1).padStart(2, '0');
    const rawFile = path.join(SOURCE_DIR, `${chapterCode}.json`);
    const chapterFile = CHAPTER_FILES[chapterIndex];
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
    const built = buildChapter(chapter, chapterIndex, raw, chapterFile);
    fs.writeFileSync(path.join(OUTPUT_DIR, chapterFile), built.markdown);
    fs.copyFileSync(rawFile, path.join(RAW_OUTPUT_DIR, `${chapterCode}.json`));
    audits.push(built.audit);
    chapterMarkdown.push(built.markdown.trim());
  });

  const report = {
    schema: 'yutu6-ai-fe-offline-archive@1',
    generatedAt: new Date().toISOString(),
    source: index.source,
    chapterCount: audits.length,
    questionCount: audits.reduce((sum, item) => sum + item.questionCount, 0),
    answerCount: audits.reduce((sum, item) => sum + item.answerCount, 0),
    codeBlockCount: audits.reduce((sum, item) => sum + item.codeBlockCount, 0),
    codeLineCount: audits.reduce((sum, item) => sum + item.codeLineCount, 0),
    sheetCount: audits.reduce((sum, item) => sum + item.sheetCount, 0),
    placeholdersRemaining: 0,
    chapters: audits,
  };

  if (report.questionCount !== index.questionCount || report.answerCount !== index.questionCount) {
    throw new Error(`Question coverage mismatch: expected ${index.questionCount}, got ${report.answerCount}`);
  }

  const enrichedIndex = {
    ...index,
    archivedAt: '2026-07-17',
    archiveMode: 'full-offline',
    answerCount: report.answerCount,
    codeBlockCount: report.codeBlockCount,
    codeLineCount: report.codeLineCount,
    sheetCount: report.sheetCount,
    chapters: index.chapters.map((chapter, chapterIndex) => ({
      ...chapter,
      localFile: CHAPTER_FILES[chapterIndex],
      answerCount: audits[chapterIndex].answerCount,
      codeBlockCount: audits[chapterIndex].codeBlockCount,
      codeLineCount: audits[chapterIndex].codeLineCount,
      sheetCount: audits[chapterIndex].sheetCount,
    })),
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), buildReadme(audits, index));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, COLLECTION_FILE),
    [
      '# AI 前端设计面试题库（完整合集）',
      '',
      '> 共 8 章、144 题。答案正文、代码示例和嵌入表格均已保存在本文件或本目录资源中。',
      '',
      chapterMarkdown.join('\n\n---\n\n'),
      '',
    ].join('\n'),
  );
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(enrichedIndex, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '归档校验报告.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
