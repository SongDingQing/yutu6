#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const BoardReview = require('../board-review');
const BoardContextRef = require('../board-context-ref');
const BoardEvidenceMerge = require('../board-evidence-merge');
const BoardFailoverRunner = require('../board-failover-runner');
const BoardRunnerAdapter = require('../board-runner-adapter');
const EventLog = require('../../../shared/engine/eventlog');
const { makeCliRunner } = require('../../../shared/engine/cli-runner');

function occurrences(text, needle) {
  return String(text).split(String(needle)).length - 1;
}

function okOpinion(role) {
  return {
    vars: {
      board_review: {
        risk_level: 'low',
        can_execute: true,
        hard_block: false,
        misjudgment_risk: false,
        issues: [],
        suggestions: [],
        summary: `${role} context ref ok`,
      },
    },
  };
}

function userText(requestBody) {
  const messages = requestBody && requestBody.messages || [];
  const message = messages.find(row => row && row.role === 'user') || {};
  if (typeof message.content === 'string') return message.content;
  return (Array.isArray(message.content) ? message.content : [])
    .filter(block => block && block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-context-ref-'));
  const previousConfig = process.env.CONSOLE_CONFIG_FILE;
  const previousTiered = process.env.YUTU6_BOARD_TIERED;
  const previousMergeApproval = process.env.CONSOLE_BOARD_EVIDENCE_MERGE_APPROVAL_FILE;
  const previousMergeFlag = process.env[BoardEvidenceMerge.FEATURE_FLAG];
  try {
    const configFile = path.join(root, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ boardReviewControl: { enabled: true, maxRounds: 1 } }));
    const mergeApprovalFile = path.join(root, 'board-evidence-merge-approved.json');
    fs.writeFileSync(mergeApprovalFile, JSON.stringify({
      schema: BoardEvidenceMerge.APPROVAL_SCHEMA,
      status: 'approved',
      shadowEnabled: true,
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
      scope: BoardEvidenceMerge.FEATURE_SCOPE,
      rollback: 'test fixture only; remove the feature flag',
    }));
    process.env.CONSOLE_CONFIG_FILE = configFile;
    process.env.YUTU6_BOARD_TIERED = '0';
    process.env.CONSOLE_BOARD_EVIDENCE_MERGE_APPROVAL_FILE = mergeApprovalFile;
    process.env[BoardEvidenceMerge.FEATURE_FLAG] = '1';

    const longRollup = Array.from({ length: 80 }, (_, index) => `- 稳定趋势 ${index + 1}: queue/runner/status evidence remains read-only.`).join('\n');
    const contextPack = [
      '[秘书后台背景包]',
      '模式:compact;这段没有标题边界，必须继续内联，不能参与哈希删除。',
      '',
      '## 上下文预算(粗估)',
      '- 状态:ok · 合计约 5850 tokens / 13836 chars · 预警线 8000',
      '',
      '## board/direction',
      '# 方向(你写给总管)',
      '只维护控制台前门入口治理。',
      '',
      '## board/status-rollup',
      longRollup,
      '',
      '## 验收模板',
      '| 要点 | 状态 | 证据 |',
      '|---|---|---|',
      '| 事件日志可追踪 | 完成 | artifact |',
    ].join('\n');
    const taskGoal = '目标:重构控制台 queue/runner fallback prompt，保留任务目标和角色专属语义。';
    const instruction = `${taskGoal}\n${contextPack}`;
    const artifactsRoot = path.join(root, 'artifacts');
    const prepared = BoardContextRef.prepareBoardContextRef({
      instruction,
      planText: instruction,
      taskId: 'context-ref-unit',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(prepared.enabled, true);
    assert.strictEqual(prepared.semanticEquivalent, true);
    assert.strictEqual(prepared.originalBlockCount, 8, 'instruction+plan each contain four titled blocks');
    assert.strictEqual(prepared.uniqueBlockCount, 4, 'exact full blocks must be stored once');
    assert.strictEqual(prepared.reusedBlockCopies, 4);
    assert.strictEqual(fs.statSync(prepared.contextFile).mode & 0o222, 0, 'context_ref must have no write bits');
    assert.strictEqual(fs.statSync(prepared.manifestFile).mode & 0o222, 0, 'manifest must have no write bits');
    const contextText = fs.readFileSync(prepared.contextFile, 'utf8');
    assert.strictEqual(occurrences(contextText, '## board/direction'), 1);
    assert.strictEqual(occurrences(contextText, '## board/status-rollup'), 1);
    assert.strictEqual(occurrences(contextText, '## 上下文预算(粗估)'), 1);
    assert.strictEqual(occurrences(contextText, '## 验收模板'), 1);
    const manifest = JSON.parse(fs.readFileSync(prepared.manifestFile, 'utf8'));
    assert.strictEqual(manifest.semantic_equivalence, 'verified_exact_block_hash');
    assert.strictEqual(manifest.schema, BoardContextRef.MANIFEST_SCHEMA);
    assert.strictEqual(manifest.hash_boundary, BoardContextRef.HASH_BOUNDARY);
    assert.strictEqual(manifest.redaction_version, BoardContextRef.REDACTION_VERSION);
    assert.strictEqual(manifest.hash_contract, 'schema+manifest_schema+redaction_version+block_boundary+ordered_block_hash_and_text');
    assert.strictEqual(manifest.not_deduplicated.length, 2, 'unheaded fragments stay source-local and inline');
    const sourceBlocks = BoardContextRef.splitSecretaryContextPack(instruction).blocks;
    for (const block of manifest.blocks) {
      assert.strictEqual(block.sha256.length, 64);
      const sourceBlock = sourceBlocks.find(row => row.hash === block.sha256);
      assert(sourceBlock, `source block must remain addressable for ${block.heading}`);
      assert.strictEqual(BoardContextRef.sha256(sourceBlock.text), block.sha256);
      assert(contextText.includes(sourceBlock.text), `context_ref must retain the complete source block for ${block.heading}`);
    }

    const hardBreakPack = [
      '目标:保留 Markdown 硬换行语义。',
      '[秘书后台背景包]',
      '## Markdown 换行语义',
      '第一行  ',
      '第二行',
    ].join('\n');
    const softBreakPack = hardBreakPack.replace('第一行  \n', '第一行\n');
    const hardBreakBlock = BoardContextRef.splitSecretaryContextPack(hardBreakPack).blocks[0];
    const softBreakBlock = BoardContextRef.splitSecretaryContextPack(softBreakPack).blocks[0];
    assert(hardBreakBlock.text.includes('第一行  \n第二行'), 'Markdown hard-break spaces must survive parsing');
    assert(!softBreakBlock.text.includes('第一行  \n第二行'));
    assert.notStrictEqual(hardBreakBlock.text, softBreakBlock.text, 'hard and soft line breaks are different source blocks');
    assert.notStrictEqual(hardBreakBlock.hash, softBreakBlock.hash, 'Markdown-significant trailing spaces must affect the full-block hash');

    const exactHardBreakDedupe = BoardContextRef.prepareBoardContextRef({
      instruction: hardBreakPack,
      planText: hardBreakPack,
      taskId: 'hard-break-exact-dedupe',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(exactHardBreakDedupe.enabled, true);
    assert.strictEqual(exactHardBreakDedupe.originalBlockCount, 2);
    assert.strictEqual(exactHardBreakDedupe.uniqueBlockCount, 1, 'byte-identical hard-break blocks may reuse one copy');
    assert.strictEqual(exactHardBreakDedupe.reusedBlockCopies, 1);
    assert(fs.readFileSync(exactHardBreakDedupe.contextFile, 'utf8').includes('第一行  \n第二行'),
      'the read-only context_ref must retain the Markdown hard break');

    const semanticBreakSeparation = BoardContextRef.prepareBoardContextRef({
      instruction: hardBreakPack,
      planText: softBreakPack,
      taskId: 'hard-break-semantic-separation',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(semanticBreakSeparation.enabled, true);
    assert.strictEqual(semanticBreakSeparation.originalBlockCount, 2);
    assert.strictEqual(semanticBreakSeparation.uniqueBlockCount, 2,
      'hard-break and soft-break blocks must not be deduplicated as semantically equivalent');
    assert.strictEqual(semanticBreakSeparation.reusedBlockCopies, 0);

    const backtickInstruction = [
      '目标:保留 instruction 围栏语义。',
      '[秘书后台背景包]',
      '## instruction fenced block',
      '```md',
      '## example heading',
      'shared fenced body',
      '```',
    ].join('\n');
    const backtickPlan = backtickInstruction
      .replace('instruction 围栏语义', 'plan 围栏语义')
      .replace('## instruction fenced block', '## plan fenced block');
    const backtickInstructionBlocks = BoardContextRef.splitSecretaryContextPack(backtickInstruction).blocks;
    const backtickPlanBlocks = BoardContextRef.splitSecretaryContextPack(backtickPlan).blocks;
    assert.strictEqual(backtickInstructionBlocks.length, 1, 'backtick-fenced pseudo headings are not block boundaries');
    assert.strictEqual(backtickPlanBlocks.length, 1, 'the plan parser must use the same fence-aware boundary rule');
    assert(backtickInstructionBlocks[0].text.includes('```md\n## example heading\nshared fenced body\n```'));

    const separatedBacktickFences = BoardContextRef.prepareBoardContextRef({
      instruction: backtickInstruction,
      planText: backtickPlan,
      taskId: 'backtick-fenced-heading-separation',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(separatedBacktickFences.enabled, true);
    assert.strictEqual(separatedBacktickFences.originalBlockCount, 2);
    assert.strictEqual(separatedBacktickFences.uniqueBlockCount, 2,
      'matching pseudo headings inside different complete blocks must not be deduplicated');
    assert.strictEqual(separatedBacktickFences.reusedBlockCopies, 0);
    assert.strictEqual(occurrences(fs.readFileSync(separatedBacktickFences.contextFile, 'utf8'), '```'), 4,
      'both balanced backtick fences must survive storage');
    const materializedBacktickFences = BoardContextRef.materializeContextOnce('role-specific goal', separatedBacktickFences);
    assert.strictEqual(materializedBacktickFences.ok, true, materializedBacktickFences.reason);
    assert.strictEqual(occurrences(materializedBacktickFences.goal, '```'), 4,
      'both balanced backtick fences must survive final materialization');
    assert.strictEqual(occurrences(materializedBacktickFences.goal, '## example heading'), 2,
      'pseudo headings remain source-local code in both complete blocks');

    const exactBacktickFence = BoardContextRef.prepareBoardContextRef({
      instruction: backtickInstruction,
      planText: backtickInstruction,
      taskId: 'backtick-fenced-heading-exact-dedupe',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(exactBacktickFence.originalBlockCount, 2);
    assert.strictEqual(exactBacktickFence.uniqueBlockCount, 1,
      'byte-identical complete blocks containing a balanced backtick fence remain reusable');
    assert.strictEqual(exactBacktickFence.reusedBlockCopies, 1);
    assert.strictEqual(occurrences(fs.readFileSync(exactBacktickFence.contextFile, 'utf8'), '```'), 2);

    const tildeInstruction = [
      '目标:保留 instruction 波浪线围栏语义。',
      '[秘书后台背景包]',
      '## instruction tilde block',
      '~~~markdown',
      '## example heading',
      'shared tilde body',
      '~~~',
    ].join('\n');
    const tildePlan = tildeInstruction
      .replace('instruction 波浪线围栏语义', 'plan 波浪线围栏语义')
      .replace('## instruction tilde block', '## plan tilde block');
    assert.strictEqual(BoardContextRef.splitSecretaryContextPack(tildeInstruction).blocks.length, 1,
      'tilde-fenced pseudo headings are not block boundaries');
    const separatedTildeFences = BoardContextRef.prepareBoardContextRef({
      instruction: tildeInstruction,
      planText: tildePlan,
      taskId: 'tilde-fenced-heading-separation',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(separatedTildeFences.originalBlockCount, 2);
    assert.strictEqual(separatedTildeFences.uniqueBlockCount, 2);
    assert.strictEqual(separatedTildeFences.reusedBlockCopies, 0);
    assert.strictEqual(occurrences(fs.readFileSync(separatedTildeFences.contextFile, 'utf8'), '~~~'), 4,
      'both balanced tilde fences must survive storage');

    const exactTildeFence = BoardContextRef.prepareBoardContextRef({
      instruction: tildeInstruction,
      planText: tildeInstruction,
      taskId: 'tilde-fenced-heading-exact-dedupe',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(exactTildeFence.uniqueBlockCount, 1,
      'byte-identical complete blocks containing a balanced tilde fence remain reusable');
    assert.strictEqual(exactTildeFence.reusedBlockCopies, 1);
    assert.strictEqual(occurrences(fs.readFileSync(exactTildeFence.contextFile, 'utf8'), '~~~'), 2);

    for (const unclosedFence of [
      ['```md', 'unclosed-backtick'],
      ['~~~markdown', 'unclosed-tilde'],
    ]) {
      const unclosedPack = [
        `目标:${unclosedFence[1]} 必须失败关闭。`,
        '[秘书后台背景包]',
        '## stable outer block',
        unclosedFence[0],
        '## example heading',
        'the fence intentionally reaches end-of-document',
      ].join('\n');
      const parsedUnclosed = BoardContextRef.splitSecretaryContextPack(unclosedPack);
      assert.strictEqual(parsedUnclosed.blocks.length, 1, 'pseudo headings remain inside an unclosed fence');
      assert.strictEqual(parsedUnclosed.ambiguousMarkdownFence, true);
      const rejectedUnclosed = BoardContextRef.prepareBoardContextRef({
        instruction: unclosedPack,
        planText: unclosedPack,
        taskId: unclosedFence[1],
        artifactsRoot,
        workspaceRoot: root,
      });
      assert.strictEqual(rejectedUnclosed.enabled, false);
      assert.strictEqual(rejectedUnclosed.semanticEquivalent, false);
      assert.strictEqual(rejectedUnclosed.reason, 'ambiguous_markdown_fence');
      assert.strictEqual(rejectedUnclosed.instruction.taskText, unclosedPack,
        'failure closure must preserve the complete legacy instruction envelope');
    }

    const htmlCommentInstruction = [
      '目标:保留 instruction HTML 注释语义。',
      '[秘书后台背景包]',
      '## instruction HTML comment block',
      '<!--',
      '## example heading',
      'shared commented body',
      '-->',
    ].join('\n');
    const htmlCommentPlan = htmlCommentInstruction
      .replace('instruction HTML 注释语义', 'plan HTML 注释语义')
      .replace('## instruction HTML comment block', '## plan HTML comment block');
    const htmlInstructionBlocks = BoardContextRef.splitSecretaryContextPack(htmlCommentInstruction).blocks;
    const htmlPlanBlocks = BoardContextRef.splitSecretaryContextPack(htmlCommentPlan).blocks;
    assert.strictEqual(htmlInstructionBlocks.length, 1, 'HTML-comment pseudo headings are not block boundaries');
    assert.strictEqual(htmlPlanBlocks.length, 1, 'the plan parser must apply the same HTML-block boundary rule');
    assert(htmlInstructionBlocks[0].text.includes('<!--\n## example heading\nshared commented body\n-->'));

    const separatedHtmlComments = BoardContextRef.prepareBoardContextRef({
      instruction: htmlCommentInstruction,
      planText: htmlCommentPlan,
      taskId: 'html-comment-heading-separation',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(separatedHtmlComments.enabled, true);
    assert.strictEqual(separatedHtmlComments.originalBlockCount, 2);
    assert.strictEqual(separatedHtmlComments.uniqueBlockCount, 2,
      'matching pseudo headings inside different HTML-comment blocks must not be deduplicated');
    assert.strictEqual(separatedHtmlComments.reusedBlockCopies, 0);
    const separatedHtmlText = fs.readFileSync(separatedHtmlComments.contextFile, 'utf8');
    assert.strictEqual(occurrences(separatedHtmlText, '<!--\n## example heading'), 2);
    assert.strictEqual(occurrences(separatedHtmlText, 'shared commented body\n-->'), 2,
      'both HTML comment closers must survive storage');
    const materializedHtmlComments = BoardContextRef.materializeContextOnce('role-specific goal', separatedHtmlComments);
    assert.strictEqual(materializedHtmlComments.ok, true, materializedHtmlComments.reason);
    assert.strictEqual(occurrences(materializedHtmlComments.goal, '<!--\n## example heading'), 2);
    assert.strictEqual(occurrences(materializedHtmlComments.goal, 'shared commented body\n-->'), 2,
      'both balanced comments must survive final materialization');

    const exactHtmlComment = BoardContextRef.prepareBoardContextRef({
      instruction: htmlCommentInstruction,
      planText: htmlCommentInstruction,
      taskId: 'html-comment-heading-exact-dedupe',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(exactHtmlComment.uniqueBlockCount, 1,
      'byte-identical complete blocks containing a balanced HTML comment remain reusable');
    assert.strictEqual(exactHtmlComment.reusedBlockCopies, 1);
    assert.strictEqual(occurrences(fs.readFileSync(exactHtmlComment.contextFile, 'utf8'), '<!--\n## example heading'), 1);

    const lowercaseDeclarationInstruction = [
      '目标:保留 instruction 小写 HTML declaration 语义。',
      '[秘书后台背景包]',
      '## instruction lowercase declaration block',
      '<!custom',
      '## example heading',
      'shared lowercase declaration body',
      '>',
    ].join('\n');
    const lowercaseDeclarationPlan = lowercaseDeclarationInstruction
      .replace('instruction 小写 HTML declaration 语义', 'plan 小写 HTML declaration 语义')
      .replace('## instruction lowercase declaration block', '## plan lowercase declaration block');
    const declarationInstructionBlocks = BoardContextRef.splitSecretaryContextPack(lowercaseDeclarationInstruction).blocks;
    const declarationPlanBlocks = BoardContextRef.splitSecretaryContextPack(lowercaseDeclarationPlan).blocks;
    assert.strictEqual(declarationInstructionBlocks.length, 1,
      'lowercase declaration pseudo headings are not instruction block boundaries');
    assert.strictEqual(declarationPlanBlocks.length, 1,
      'the plan parser must apply the same lowercase declaration boundary rule');

    const separatedLowercaseDeclarations = BoardContextRef.prepareBoardContextRef({
      instruction: lowercaseDeclarationInstruction,
      planText: lowercaseDeclarationPlan,
      taskId: 'lowercase-declaration-heading-separation',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(separatedLowercaseDeclarations.enabled, true);
    assert.strictEqual(separatedLowercaseDeclarations.originalBlockCount, 2);
    assert.strictEqual(separatedLowercaseDeclarations.uniqueBlockCount, 2,
      'matching pseudo headings inside different lowercase declaration blocks must not be deduplicated');
    assert.strictEqual(separatedLowercaseDeclarations.reusedBlockCopies, 0);
    const separatedDeclarationText = fs.readFileSync(separatedLowercaseDeclarations.contextFile, 'utf8');
    assert.strictEqual(occurrences(separatedDeclarationText, '<!custom\n## example heading'), 2);
    assert.strictEqual(occurrences(separatedDeclarationText, 'shared lowercase declaration body\n>'), 2,
      'both lowercase declaration closers must survive storage');
    const materializedLowercaseDeclarations = BoardContextRef.materializeContextOnce(
      'role-specific goal', separatedLowercaseDeclarations,
    );
    assert.strictEqual(materializedLowercaseDeclarations.ok, true, materializedLowercaseDeclarations.reason);
    assert.strictEqual(occurrences(materializedLowercaseDeclarations.goal, '<!custom\n## example heading'), 2);
    assert.strictEqual(occurrences(materializedLowercaseDeclarations.goal, 'shared lowercase declaration body\n>'), 2,
      'both balanced lowercase declarations must survive final materialization');

    const exactLowercaseDeclaration = BoardContextRef.prepareBoardContextRef({
      instruction: lowercaseDeclarationInstruction,
      planText: lowercaseDeclarationInstruction,
      taskId: 'lowercase-declaration-heading-exact-dedupe',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(exactLowercaseDeclaration.originalBlockCount, 2);
    assert.strictEqual(exactLowercaseDeclaration.uniqueBlockCount, 1,
      'byte-identical complete blocks containing a balanced lowercase declaration remain reusable');
    assert.strictEqual(exactLowercaseDeclaration.reusedBlockCopies, 1);
    const exactDeclarationText = fs.readFileSync(exactLowercaseDeclaration.contextFile, 'utf8');
    assert.strictEqual(occurrences(exactDeclarationText, '<!custom\n## example heading'), 1);
    assert.strictEqual(occurrences(exactDeclarationText, 'shared lowercase declaration body\n>'), 1);

    const unclosedLowercaseDeclarationPack = [
      '目标:未闭合小写 HTML declaration 必须失败关闭。',
      '[秘书后台背景包]',
      '## stable outer block',
      '<!custom',
      '## example heading',
      'the declaration intentionally reaches end-of-document',
    ].join('\n');
    const parsedUnclosedLowercaseDeclaration = BoardContextRef.splitSecretaryContextPack(
      unclosedLowercaseDeclarationPack,
    );
    assert.strictEqual(parsedUnclosedLowercaseDeclaration.blocks.length, 1,
      'pseudo headings remain inside an unclosed lowercase declaration');
    assert.strictEqual(parsedUnclosedLowercaseDeclaration.ambiguousMarkdownHtmlBlock, true);
    const rejectedUnclosedLowercaseDeclaration = BoardContextRef.prepareBoardContextRef({
      instruction: unclosedLowercaseDeclarationPack,
      planText: unclosedLowercaseDeclarationPack,
      taskId: 'unclosed-lowercase-declaration',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(rejectedUnclosedLowercaseDeclaration.enabled, false);
    assert.strictEqual(rejectedUnclosedLowercaseDeclaration.semanticEquivalent, false);
    assert.strictEqual(rejectedUnclosedLowercaseDeclaration.reason, 'ambiguous_markdown_html_block');
    assert.strictEqual(rejectedUnclosedLowercaseDeclaration.instruction.taskText, unclosedLowercaseDeclarationPack,
      'lowercase declaration failure closure must preserve the complete legacy instruction envelope');

    const rawHtmlPack = [
      '目标:HTML raw block 内伪标题不得切块。',
      '[秘书后台背景包]',
      '## script wrapper',
      '<script type="text/plain">',
      '## script pseudo heading',
      '</script>',
      '## following real block',
      'stable content',
    ].join('\n');
    const rawHtmlBlocks = BoardContextRef.splitSecretaryContextPack(rawHtmlPack).blocks;
    assert.strictEqual(rawHtmlBlocks.length, 2, 'raw HTML closes before the following real heading');
    assert(rawHtmlBlocks[0].text.includes('<script type="text/plain">\n## script pseudo heading\n</script>'));
    assert.strictEqual(rawHtmlBlocks[1].heading, '## following real block');

    const blankTerminatedHtmlPack = [
      '目标:CommonMark 块标签内伪标题不得切块。',
      '[秘书后台背景包]',
      '## div wrapper',
      '<div>',
      '## div pseudo heading',
      '</div>',
      '',
      '## following block after blank',
      'stable content',
    ].join('\n');
    const blankTerminatedBlocks = BoardContextRef.splitSecretaryContextPack(blankTerminatedHtmlPack).blocks;
    assert.strictEqual(blankTerminatedBlocks.length, 2, 'type-6 HTML block ends at the blank line');
    assert(blankTerminatedBlocks[0].text.includes('<div>\n## div pseudo heading\n</div>'));
    assert.strictEqual(blankTerminatedBlocks[1].heading, '## following block after blank');

    for (const unclosedHtml of [
      ['<!--', 'unclosed-html-comment'],
      ['<script>', 'unclosed-html-raw-tag'],
    ]) {
      const unclosedHtmlPack = [
        `目标:${unclosedHtml[1]} 必须失败关闭。`,
        '[秘书后台背景包]',
        '## stable outer block',
        unclosedHtml[0],
        '## example heading',
        'the HTML block intentionally reaches end-of-document',
      ].join('\n');
      const parsedUnclosedHtml = BoardContextRef.splitSecretaryContextPack(unclosedHtmlPack);
      assert.strictEqual(parsedUnclosedHtml.blocks.length, 1, 'pseudo headings remain inside an unclosed HTML block');
      assert.strictEqual(parsedUnclosedHtml.ambiguousMarkdownHtmlBlock, true);
      const rejectedUnclosedHtml = BoardContextRef.prepareBoardContextRef({
        instruction: unclosedHtmlPack,
        planText: unclosedHtmlPack,
        taskId: unclosedHtml[1],
        artifactsRoot,
        workspaceRoot: root,
      });
      assert.strictEqual(rejectedUnclosedHtml.enabled, false);
      assert.strictEqual(rejectedUnclosedHtml.semanticEquivalent, false);
      assert.strictEqual(rejectedUnclosedHtml.reason, 'ambiguous_markdown_html_block');
      assert.strictEqual(rejectedUnclosedHtml.instruction.taskText, unclosedHtmlPack,
        'HTML failure closure must preserve the complete legacy instruction envelope');
    }

    const deepseekGoal = BoardReview._test.makeDirectorGoal({
      director: BoardReview.DIRECTORS[0], round: 1, maxRounds: 1,
      instruction, planText: instruction, previousRounds: [], projectId: '控制台', boardContext: prepared,
    });
    const finalGoal = BoardReview._test.makeDirectorGoal({
      director: BoardReview.DIRECTORS.find(item => item.final), round: 1, maxRounds: 1,
      instruction, planText: instruction, previousRounds: [], projectId: '控制台', boardContext: prepared,
    });
    assert(deepseekGoal.includes(`context_ref:${prepared.ref}`));
    assert(finalGoal.includes(`context_ref:${prepared.ref}`));
    assert(deepseekGoal.includes(taskGoal));
    assert(finalGoal.includes(taskGoal));
    assert(finalGoal.includes('你是最终放行判断者'));
    assert(deepseekGoal.includes('DeepSeek 董事'));
    assert(deepseekGoal.includes('没有标题边界，必须继续内联'));
    assert(!deepseekGoal.includes(longRollup), 'stable titled background must not be re-expanded');
    assert(deepseekGoal.includes('task_goal_ref:sha256:'), 'identical plan content must retain its semantic label through an exact ref');

    const legacyGoals = BoardReview.DIRECTORS.map(director => BoardReview._test.makeLegacyDirectorGoal({
      director, round: 1, maxRounds: 1, instruction, planText: instruction, previousRounds: [], projectId: '控制台',
    }));
    const referencedGoals = BoardReview.DIRECTORS.map(director => BoardReview._test.makeDirectorGoal({
      director, round: 1, maxRounds: 1, instruction, planText: instruction, previousRounds: [], projectId: '控制台', boardContext: prepared,
    }));
    const measurement = BoardContextRef.measurePromptReduction(legacyGoals, referencedGoals);
    assert.strictEqual(measurement.lower_input_tokens, true);
    assert(measurement.reduced_estimated_input_tokens > 1000, JSON.stringify(measurement));
    assert(measurement.after_chars < measurement.before_chars);
    const materializedGoals = referencedGoals.map(goal => {
      const delivered = BoardContextRef.materializeContextOnce(goal, prepared);
      assert.strictEqual(delivered.ok, true, delivered.reason);
      assert.strictEqual(occurrences(delivered.goal, BoardContextRef.MATERIALIZED_START), 1);
      assert.strictEqual(occurrences(delivered.goal, longRollup), 1, 'verified context must be materialized exactly once');
      return delivered.goal;
    });
    const idempotentMaterialization = BoardContextRef.materializeContextOnce(materializedGoals[0], prepared);
    assert.strictEqual(idempotentMaterialization.ok, true);
    assert.strictEqual(idempotentMaterialization.reused, true);
    assert.strictEqual(idempotentMaterialization.goal, materializedGoals[0]);
    const materializedMeasurement = BoardContextRef.measurePromptReduction(legacyGoals, materializedGoals);
    assert.strictEqual(materializedMeasurement.lower_input_tokens, true, JSON.stringify(materializedMeasurement));
    assert(materializedMeasurement.after_estimated_input_tokens > measurement.after_estimated_input_tokens,
      'materialized measurement must include the remotely consumed background');

    const capability = { mode: BoardContextRef.DELIVERY_MODE, resolver: 'test_project_board_wrapper' };
    const unsupported = BoardFailoverRunner.prepareSharedContext({
      goal: deepseekGoal,
      boardLegacyGoal: legacyGoals[0],
      boardContextRef: prepared,
    }, ['no-context-capability'], () => null);
    assert.strictEqual(unsupported.mode, 'legacy_full_fail_closed');
    assert.strictEqual(unsupported.ctx.goal, legacyGoals[0]);
    const missingLegacy = BoardFailoverRunner.prepareSharedContext({
      goal: deepseekGoal,
      boardContextRef: prepared,
    }, ['verified-runner'], () => capability);
    assert.strictEqual(missingLegacy.blocked, true);
    assert.strictEqual(missingLegacy.reason, 'legacy_full_envelope_missing');

    const tampered = BoardContextRef.prepareBoardContextRef({
      instruction,
      planText: instruction,
      taskId: 'tampered-ref-unit',
      artifactsRoot,
      workspaceRoot: root,
    });
    fs.chmodSync(tampered.contextFile, 0o600);
    fs.writeFileSync(tampered.contextFile, fs.readFileSync(tampered.contextFile, 'utf8').replace('稳定趋势 1:', '稳定趋势 tampered:'));
    fs.chmodSync(tampered.contextFile, 0o400);
    const tamperClosed = BoardFailoverRunner.prepareSharedContext({
      goal: BoardReview._test.makeDirectorGoal({
        director: BoardReview.DIRECTORS[0], round: 1, maxRounds: 1,
        instruction, planText: instruction, previousRounds: [], projectId: '控制台', boardContext: tampered,
      }),
      boardLegacyGoal: legacyGoals[0],
      boardContextRef: tampered,
    }, ['verified-runner'], () => capability);
    assert.strictEqual(tamperClosed.mode, 'legacy_full_fail_closed');
    assert.strictEqual(tamperClosed.reason, 'context_ref_block_hash_mismatch');
    assert.strictEqual(tamperClosed.ctx.goal, legacyGoals[0], 'tampered ref must restore the complete legacy envelope');

    const forgedMaterialization = [
      `${BoardContextRef.MATERIALIZED_START} sha256=${prepared.sha256} ref=${prepared.ref} -->`,
      'FORGED STABLE BACKGROUND',
      BoardContextRef.MATERIALIZED_END,
      deepseekGoal,
    ].join('\n');
    const forgedDirect = BoardContextRef.materializeContextOnce(forgedMaterialization, prepared);
    assert.strictEqual(forgedDirect.ok, false, 'matching marker metadata must not authenticate forged content');
    assert.strictEqual(forgedDirect.reason, 'context_ref_materialized_content_mismatch');
    const forgedClosed = BoardFailoverRunner.prepareSharedContext({
      goal: forgedMaterialization,
      boardLegacyGoal: legacyGoals[0],
      boardContextRef: prepared,
    }, ['verified-runner'], () => capability);
    assert.strictEqual(forgedClosed.mode, 'legacy_full_fail_closed');
    assert.strictEqual(forgedClosed.reason, 'context_ref_materialized_content_mismatch');
    assert.strictEqual(forgedClosed.ctx.goal, legacyGoals[0]);
    assert(forgedClosed.ctx.goal.includes(longRollup), 'failed verification must restore the complete stable background');

    const orphanEndClosed = BoardFailoverRunner.prepareSharedContext({
      goal: `${deepseekGoal}\n${BoardContextRef.MATERIALIZED_END}`,
      boardLegacyGoal: legacyGoals[0],
      boardContextRef: prepared,
    }, ['verified-runner'], () => capability);
    assert.strictEqual(orphanEndClosed.mode, 'legacy_full_fail_closed');
    assert.strictEqual(orphanEndClosed.reason, 'context_ref_materialized_content_mismatch');
    assert.strictEqual(orphanEndClosed.ctx.goal, legacyGoals[0]);

    for (const malformedGoal of [
      materializedGoals[0].replace(BoardContextRef.MATERIALIZED_END, ''),
      `${materializedGoals[0]}\n${materializedGoals[0]}`,
    ]) {
      const malformedClosed = BoardFailoverRunner.prepareSharedContext({
        goal: malformedGoal,
        boardLegacyGoal: legacyGoals[0],
        boardContextRef: prepared,
      }, ['verified-runner'], () => capability);
      assert.strictEqual(malformedClosed.mode, 'legacy_full_fail_closed');
      assert.strictEqual(malformedClosed.reason, 'context_ref_materialized_content_mismatch');
      assert.strictEqual(malformedClosed.ctx.goal, legacyGoals[0]);
    }

    const uncertain = BoardContextRef.prepareBoardContextRef({
      instruction: '目标:保留\n[秘书后台背景包]\n没有任何标题边界的局部语义',
      planText: '',
      taskId: 'uncertain',
      artifactsRoot,
      workspaceRoot: root,
    });
    assert.strictEqual(uncertain.enabled, false);
    assert.strictEqual(uncertain.reason, 'no_titled_context_blocks');
    assert(uncertain.instruction.taskText.includes('没有任何标题边界的局部语义'), 'unverifiable content must remain full inline');

    const fallbackEvents = [];
    const seen = [];
    const credentialSentinel = 'url-userinfo-sentinel-value';
    const querySentinel = 'query-sentinel-value';
    const fallbackRunner = BoardFailoverRunner.makeBoardFailoverRunner({
      taskId: 'fallback-unit',
      projectId: '控制台',
      eventlog: { emit(type, data) { fallbackEvents.push({ type, ...data }); } },
      candidatesFor() { return ['primary-runner', 'fallback-runner']; },
      capabilityFor() { return capability; },
      makeSingleRunner({ runnerId }) {
        return {
          async runNodeAsync(node, ctx) {
            seen.push({ runnerId, node: node.id, goal: ctx.goal });
            if (runnerId === 'primary-runner') {
              return { fail: `HTTP 429 transport https://alice:${credentialSentinel}@example.invalid/v1?access_token=${querySentinel} Bearer should-not-leak` };
            }
            return okOpinion(node.agent_role);
          },
        };
      },
    });
    const fallbackResult = await fallbackRunner.runNodeAsync(
      { id: 'board-board_glm52-r1', agent_role: 'board_glm52' },
      { goal: deepseekGoal, boardLegacyGoal: legacyGoals[0], boardContextRef: prepared },
      1,
    );
    assert(!fallbackResult.fail);
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(occurrences(seen[1].goal, `context_ref:${prepared.ref}`), 1, 'fallback must reuse the same ref once');
    assert.strictEqual(occurrences(seen[0].goal, longRollup), 1, 'primary must consume one verified materialization');
    assert.strictEqual(occurrences(seen[1].goal, longRollup), 1, 'fallback must reuse the first materialization');
    assert.strictEqual(occurrences(seen[1].goal, BoardContextRef.MATERIALIZED_START), 1);
    assert(seen[1].goal.includes('failure_kind: http_429'));
    assert(seen[1].goal.includes('runner_diff: primary-runner -> fallback-runner'));
    assert(!seen[1].goal.includes('should-not-leak'));
    assert(!seen[1].goal.includes(credentialSentinel));
    assert(!seen[1].goal.includes(querySentinel));
    assert(fallbackEvents.filter(event => event.type === 'runner.failover')
      .every(event => !String(event.detail).includes(credentialSentinel) && !String(event.detail).includes(querySentinel)));
    assert(fallbackEvents.some(event => event.type === 'board.review.context_ref.fallback_delta'
      && event.full_background_reassembled === false));
    const unsafeReason = `transport https://alice:${credentialSentinel}@example.invalid/v1?access_token=${querySentinel}`;
    const safeReason = BoardFailoverRunner.redactReason(unsafeReason);
    assert(!safeReason.includes(credentialSentinel));
    assert(!safeReason.includes(querySentinel));
    assert(safeReason.includes('[REDACTED]'));

    // Regression for review-2: both the primary and final fallback fail after a
    // verified context_ref was materialized. No terminal result or downstream
    // Board persistence/event is allowed to retain constructed credentials.
    const terminalSentinels = {
      userinfo: 'terminal-userinfo-sentinel',
      query: 'terminal-query-sentinel',
      bearer: 'terminal-bearer-sentinel',
      basic: 'QWxhZGRpbjpvcGVuU2VzYW1l',
    };
    const terminalFailure = `HTTP 429 transport https://alice:${terminalSentinels.userinfo}@example.invalid/v1?access_token=${terminalSentinels.query} Basic ${terminalSentinels.basic} Bearer ${terminalSentinels.bearer}`;
    const terminalSeen = [];
    const terminalEventsFile = path.join(root, 'board-terminal-events.jsonl');
    const terminalEventlog = new EventLog(terminalEventsFile);
    const terminalRunner = BoardFailoverRunner.makeBoardFailoverRunner({
      taskId: 'context-ref-terminal-failure',
      projectId: '控制台',
      eventlog: terminalEventlog,
      candidatesFor(role) { return [`${role}-primary`, `${role}-final`]; },
      capabilityFor() { return capability; },
      makeSingleRunner({ runnerId }) {
        return {
          async runNodeAsync(node, ctx) {
            terminalSeen.push({ runnerId, role: node.agent_role, ctx: Object.assign({}, ctx) });
            return { fail: terminalFailure };
          },
        };
      },
    });
    const terminalUnit = await terminalRunner.runNodeAsync(
      { id: 'board-terminal-unit', agent_role: 'board_glm52' },
      { goal: deepseekGoal, boardLegacyGoal: legacyGoals[0], boardContextRef: prepared },
      1,
    );
    assert(terminalUnit.fail);
    for (const sentinel of Object.values(terminalSentinels)) {
      assert(!terminalUnit.fail.includes(sentinel), `terminal fail leaked ${sentinel}`);
    }
    assert.strictEqual(terminalSeen.length, 2);
    assert(terminalSeen.every(row => !Object.prototype.hasOwnProperty.call(row.ctx, 'boardLegacyGoal')));
    assert(terminalSeen.every(row => !Object.prototype.hasOwnProperty.call(row.ctx, 'boardContextRef')));
    assert(terminalSeen.every(row => occurrences(row.ctx.goal, longRollup) === 1));
    assert(terminalSeen.every(row => occurrences(row.ctx.goal, BoardContextRef.MATERIALIZED_START) === 1));
    assert(terminalSeen[1].ctx.goal.includes('runner_diff: board_glm52-primary -> board_glm52-final'));

    const terminalArtifactsRoot = path.join(root, 'terminal-artifacts');
    const terminalMemoryFile = path.join(root, 'terminal-decisions.md');
    const terminalReview = await BoardReview.runBoardReview({
      spec: {
        taskId: 'context-ref-terminal-review',
        projectId: '控制台',
        goal: instruction,
        originalGoal: taskGoal,
      },
      ctx: { workspaceRoot: root },
      projectId: '控制台',
      planText: instruction,
      assessment: BoardReview.assessTask('重构 queue runner 并发架构。'),
      artifactsRoot: terminalArtifactsRoot,
      memoryFile: terminalMemoryFile,
      eventlog: terminalEventlog,
      cliRunner: { runBoardNodeAsync: terminalRunner.runNodeAsync },
      // 测试不得调用生产飞书通知；此前这里会把临时决策卡误发给主人。
      notify() { return { attempted: false, sent: false, test: true }; },
    });
    assert.strictEqual(terminalReview.ok, false);
    assert.strictEqual(terminalReview.paused, true);
    const terminalEventText = fs.readFileSync(terminalEventsFile, 'utf8');
    const cooldownFile = path.join(terminalArtifactsRoot, 'board-review-runner-health.json');
    const cooldownText = fs.readFileSync(cooldownFile, 'utf8');
    const terminalMemoryText = fs.readFileSync(terminalMemoryFile, 'utf8');
    for (const sentinel of Object.values(terminalSentinels)) {
      assert(!terminalEventText.includes(sentinel), `terminal event leaked ${sentinel}`);
      assert(!cooldownText.includes(sentinel), `cooldown state leaked ${sentinel}`);
      assert(!terminalMemoryText.includes(sentinel), `decision memory leaked ${sentinel}`);
    }
    const terminalEvents = terminalEventText.trim().split(/\n/).filter(Boolean).map(JSON.parse);
    const absentEvents = terminalEvents.filter(event => event.type === 'node.absent');
    const cooldownEvents = terminalEvents.filter(event => event.type === 'board.review.director.cooldown');
    assert.strictEqual(absentEvents.length, BoardReview.DIRECTORS.length);
    assert.strictEqual(cooldownEvents.length, BoardReview.DIRECTORS.length);
    assert(absentEvents.every(event => String(event.reason).includes('[REDACTED]')));
    assert(cooldownEvents.every(event => String(event.reason).includes('[REDACTED]')));

    const eventsFile = path.join(root, 'board-events.jsonl');
    const eventlog = new EventLog(eventsFile);
    const integrationSeen = [];
    const integrationRunner = BoardFailoverRunner.makeBoardFailoverRunner({
      taskId: 'context-ref-integration',
      projectId: '控制台',
      eventlog,
      candidatesFor(role) { return [`${role}-primary`, `${role}-fallback`]; },
      capabilityFor() { return capability; },
      makeSingleRunner({ runnerId }) {
        return {
          async runNodeAsync(node, ctx) {
            integrationSeen.push({ runnerId, role: node.agent_role, goal: ctx.goal });
            if (runnerId.endsWith('-primary')) return { fail: 'ECONNRESET transport failure' };
            return okOpinion(node.agent_role);
          },
        };
      },
    });
    const reviewed = await BoardReview.runBoardReview({
      spec: {
        taskId: 'context-ref-integration',
        projectId: '控制台',
        goal: instruction,
        originalGoal: taskGoal,
      },
      ctx: { workspaceRoot: root },
      projectId: '控制台',
      planText: instruction,
      assessment: BoardReview.assessTask('重构 queue runner 并发架构。'),
      artifactsRoot,
      memoryFile: path.join(root, 'decisions.md'),
      eventlog,
      cliRunner: { runBoardNodeAsync: integrationRunner.runNodeAsync },
    });
    assert.strictEqual(reviewed.ok, true);
    assert.strictEqual(integrationSeen.length, BoardReview.DIRECTORS.length * 2, 'each active director uses primary then fallback');
    const refs = integrationSeen.map(row => row.goal.match(/context_ref:([^\n]+)/)).filter(Boolean).map(match => match[1]);
    assert.strictEqual(new Set(refs).size, 1, 'all roles and fallbacks must share one context_ref');
    assert(integrationSeen.filter(row => row.runnerId.endsWith('-fallback')).every(row => row.goal.includes('failure_kind: transport')));
    assert(integrationSeen.every(row => occurrences(row.goal, longRollup) === 1));
    assert(integrationSeen.every(row => occurrences(row.goal, BoardContextRef.MATERIALIZED_START) === 1));
    const events = fs.readFileSync(eventsFile, 'utf8').trim().split(/\n/).filter(Boolean).map(JSON.parse);
    const preparedEvent = events.find(event => event.type === 'board.review.context_ref.prepared');
    assert(preparedEvent && preparedEvent.semantic_equivalence === true
      && preparedEvent.local_estimate_only === true
      && preparedEvent.reduced_estimated_input_tokens > 0);
    assert.strictEqual(events.filter(event => event.type === 'board.review.context_ref.delivered').length, BoardReview.DIRECTORS.length);
    assert.strictEqual(events.filter(event => event.type === 'board.review.context_ref.fallback_delta').length, BoardReview.DIRECTORS.length);
    assert(fs.existsSync(path.join(
      artifactsRoot, 'engine-runs', 'context-ref-integration', 'board-context-ref', 'prompt-reduction.json',
    )));

    // Capture the actual final OpenAI-compatible HTTP request for the two production
    // board API runner shapes. The local endpoint returns provider-shaped usage so
    // the same transport/usage path is exercised without reading a real credential.
    const providerRequests = [];
    const providerServer = http.createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        providerRequests.push(body);
        const promptTokens = BoardContextRef.estimateInputTokens(userText(body));
        const content = JSON.stringify(okOpinion('provider-contract').vars);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 12, total_tokens: promptTokens + 12 },
        }));
      });
    });
    await new Promise(resolve => providerServer.listen(0, '127.0.0.1', resolve));
    const providerBaseUrl = `http://127.0.0.1:${providerServer.address().port}`;
    const providerRuns = path.join(root, 'provider-runs');
    const productionApiShapes = [
      ['deepseek-board-direct', 'deepseek-chat'],
      ['zhipu-board-direct', 'glm-5.2'],
    ];
    const providerComparisons = [];
    assert.strictEqual(BoardContextRef.recordProviderUsage(prepared, {
      taskId: 'unbound-provider-usage',
      node: 'board-unbound',
      runner: 'deepseek-board-direct',
      usage: { prompt_tokens: 123 },
    }), null, 'provider usage without a final request hash must not become a durable receipt');
    try {
      for (const [runnerId, model] of productionApiShapes) {
        const runners = {
          [runnerId]: {
            kind: 'openai_http', cmd: ['__openai_http__'], baseUrl: providerBaseUrl,
            token: 'x', model, maxTokens: 64,
          },
        };
        const single = () => BoardRunnerAdapter.makeBoardCandidateRunner({
          runners,
          roleMap: { board_glm52: runnerId },
          role: 'board_glm52',
          runnerId,
          candidateIndex: 0,
          roleExecMeta: {},
          workdir: root,
          runsDir: path.join(providerRuns, runnerId),
          taskId: `provider-${runnerId}`,
          projectId: '控制台',
          failover: false,
        });
        const wrapped = BoardFailoverRunner.makeBoardFailoverRunner({
          taskId: `provider-${runnerId}`,
          projectId: '控制台',
          candidatesFor() { return [runnerId]; },
          capabilityFor() { return capability; },
          makeSingleRunner: single,
        });
        const node = { id: `board-${runnerId}`, agent_role: 'board_glm52' };
        const delivered = await wrapped.runNodeAsync(node, {
          goal: deepseekGoal,
          boardLegacyGoal: legacyGoals[0],
          boardContextRef: prepared,
          acceptance: '输出董事会挑刺 JSON; 不改文件; 不回显密钥。',
        }, 1);
        assert(!delivered.fail, delivered.fail);
        assert(delivered.runner_usage && delivered.runner_usage.prompt_tokens > 0);
        assert(delivered.board_failover.provider_usage_artifact);
        assert(fs.existsSync(delivered.board_failover.provider_usage_artifact));
        const usageReceipt = JSON.parse(fs.readFileSync(delivered.board_failover.provider_usage_artifact, 'utf8'));
        assert.strictEqual(usageReceipt.schema, 'yutu6-board-context-provider-usage@2');
        assert.strictEqual(fs.statSync(delivered.board_failover.provider_usage_artifact).mode & 0o222, 0);
        const deliveredRequest = providerRequests[providerRequests.length - 1];
        const deliveredText = userText(deliveredRequest);
        assert.strictEqual(deliveredRequest.model, model);
        assert.strictEqual(occurrences(deliveredText, longRollup), 1);
        assert.strictEqual(occurrences(deliveredText, BoardContextRef.MATERIALIZED_START), 1);
        assert.strictEqual(usageReceipt.request.prompt_sha256, BoardContextRef.sha256(deliveredText));
        assert.strictEqual(usageReceipt.request.prompt_chars, deliveredText.length);
        assert.strictEqual(usageReceipt.usage.prompt_tokens, delivered.runner_usage.prompt_tokens);

        const legacyNode = { id: `legacy-${runnerId}`, agent_role: 'board_glm52' };
        const legacyOut = await single().runNodeAsync(legacyNode, {
          goal: legacyGoals[0],
          acceptance: '输出董事会挑刺 JSON; 不改文件; 不回显密钥。',
        }, 1);
        assert(!legacyOut.fail, legacyOut.fail);
        const legacyRequest = providerRequests[providerRequests.length - 1];
        assert(legacyOut.runner_usage.prompt_tokens > delivered.runner_usage.prompt_tokens,
          `${runnerId} provider usage must show fewer prompt tokens: legacy=${legacyOut.runner_usage.prompt_tokens} delivered=${delivered.runner_usage.prompt_tokens}`);
        providerComparisons.push({
          runner: runnerId,
          delivered_prompt_tokens: delivered.runner_usage.prompt_tokens,
          legacy_prompt_tokens: legacyOut.runner_usage.prompt_tokens,
        });
      }
    } finally {
      await closeServer(providerServer);
    }

    // Capture the final task.md passed through the two production CLI runner shapes.
    const cliScript = path.join(root, 'board-cli-contract.js');
    fs.writeFileSync(cliScript, [
      "'use strict';",
      "process.stdin.resume();",
      "process.stdin.on('data', () => {});",
      "process.stdin.on('end', () => process.stdout.write(JSON.stringify({board_review:{risk_level:'low',can_execute:true,hard_block:false,misjudgment_risk:false,issues:[],suggestions:[],summary:'ok'}})));",
    ].join('\n'));
    for (const runnerId of ['codex', 'codex-privileged']) {
      const runners = { [runnerId]: { kind: 'command', cmd: [process.execPath, cliScript], promptVia: 'stdin' } };
      const wrapped = BoardFailoverRunner.makeBoardFailoverRunner({
        taskId: `cli-${runnerId}`,
        projectId: '控制台',
        candidatesFor() { return [runnerId]; },
        capabilityFor() { return capability; },
        makeSingleRunner() {
          return makeCliRunner({
            runners,
            roleMap: { board_opus48: runnerId },
            roleExecMeta: {},
            workdir: root,
            runsDir: path.join(root, 'cli-runs', runnerId),
            taskId: `cli-${runnerId}`,
            projectId: '控制台',
            failover: false,
          });
        },
      });
      const node = { id: `board-${runnerId}`, agent_role: 'board_opus48' };
      const out = await wrapped.runNodeAsync(node, {
        goal: finalGoal,
        boardLegacyGoal: legacyGoals[legacyGoals.length - 1],
        boardContextRef: prepared,
        acceptance: '输出董事会挑刺 JSON; 不改文件; 不回显密钥。',
      }, 1);
      assert(!out.fail, out.fail);
      const taskFile = path.join(root, 'cli-runs', runnerId, `${node.id}-1`, 'task.md');
      const finalPrompt = fs.readFileSync(taskFile, 'utf8');
      assert.strictEqual(occurrences(finalPrompt, longRollup), 1, `${runnerId} final prompt must materialize once`);
      assert.strictEqual(occurrences(finalPrompt, BoardContextRef.MATERIALIZED_START), 1);
      assert(finalPrompt.includes('你是最终放行判断者'));
    }

    const sharedRunnerSource = fs.readFileSync(path.resolve(__dirname, '../../../shared/engine/cli-runner.js'), 'utf8');
    for (const taskSpecificNeedle of [
      'spec_snapshot, attachments, boardLegacyGoal, boardContextRef',
      'function normalizeRunnerUsage(value)',
      'function decodeOpenAiTransportResult(result)',
      'result.runner_usage = res.usage',
      'usage: res && res.usage',
    ]) {
      assert(!sharedRunnerSource.includes(taskSpecificNeedle), `Board special case remained in shared runner: ${taskSpecificNeedle}`);
    }

    console.log(JSON.stringify({
      pass: true,
      suite: 'board-context-ref',
      semantic_equivalence: manifest.semantic_equivalence,
      thin_local_measurement: measurement,
      materialized_local_measurement: materializedMeasurement,
      provider_usage_comparisons: providerComparisons,
      shared_context_ref: prepared.ref,
      fallback_delta_events: fallbackEvents.filter(event => event.type === 'board.review.context_ref.fallback_delta').length,
    }));
  } finally {
    if (previousConfig == null) delete process.env.CONSOLE_CONFIG_FILE;
    else process.env.CONSOLE_CONFIG_FILE = previousConfig;
    if (previousTiered == null) delete process.env.YUTU6_BOARD_TIERED;
    else process.env.YUTU6_BOARD_TIERED = previousTiered;
    if (previousMergeApproval == null) delete process.env.CONSOLE_BOARD_EVIDENCE_MERGE_APPROVAL_FILE;
    else process.env.CONSOLE_BOARD_EVIDENCE_MERGE_APPROVAL_FILE = previousMergeApproval;
    if (previousMergeFlag == null) delete process.env[BoardEvidenceMerge.FEATURE_FLAG];
    else process.env[BoardEvidenceMerge.FEATURE_FLAG] = previousMergeFlag;
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
