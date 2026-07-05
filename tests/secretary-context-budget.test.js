#!/usr/bin/env node
'use strict';

const assert = require('assert');

function main() {
  const tools = require('../projects/控制台/secretary-tools');
  assert.strictEqual(tools.estimateContextTokens('abcd'), 1, 'ASCII token estimate should use 4 chars per token');
  assert.strictEqual(tools.estimateContextTokens('自省优化'), 4, 'CJK token estimate should count non-ASCII chars directly');

  const ctx = tools.buildContext();
  assert.strictEqual(ctx.context_mode, 'compact', 'secretary context should default to compact mode');
  assert(ctx.context_budget, 'context must include context_budget');
  assert.strictEqual(ctx.context_budget.estimate, 'rough_local_chars_v1');
  assert(Number.isFinite(ctx.context_budget.total_estimated_tokens), 'context budget must expose token estimate');
  assert(ctx.context_budget.total_estimated_tokens > 0, 'context budget estimate must be positive for live context');
  assert(Array.isArray(ctx.context_budget.top_sections), 'context budget must include top sections');
  assert(ctx.context_budget.top_sections.length > 0, 'context budget must identify heavy sections');
  assert(
    ctx.context_budget.total_estimated_tokens <= ctx.context_budget.warn_at_tokens,
    `compact default context should stay under warning budget: ${ctx.context_budget.total_estimated_tokens}/${ctx.context_budget.warn_at_tokens}`,
  );

  const text = tools.buildContextText();
  assert(text.includes('## 上下文预算(粗估)'), 'context-text must include budget section');
  assert(text.includes('合计约'), 'context-text must expose total estimate');
  assert(text.includes('预警线'), 'context-text must expose warning threshold');

  const tight = tools.contextBudget({
    board: [{ id: 'huge', text: '自'.repeat(9000) }],
    queues: [],
    bulletin: {},
    repair_tickets: {},
    capabilities: [],
    tools: {},
  });
  assert.strictEqual(tight.status, 'warn', 'large default context should warn');

  console.log('secretary-context-budget ok');
}

main();
