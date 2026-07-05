#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-usage-safety-'));
  const codexRoot = path.join(root, 'codex');
  const claudeRoot = path.join(root, 'claude');
  fs.mkdirSync(codexRoot, { recursive: true });
  fs.mkdirSync(claudeRoot, { recursive: true });

  try {
    process.env.CODEX_USAGE_LOG_ROOT = codexRoot;
    process.env.CLAUDE_USAGE_LOG_ROOT = claudeRoot;
    process.env.LLM_USAGE_MAX_FILES = '5';
    process.env.LLM_USAGE_MAX_FILE_BYTES = String(128 * 1024);
    process.env.LLM_USAGE_MAX_READ_BYTES = String(32 * 1024);
    process.env.LLM_USAGE_MAX_JSON_PARSE_BYTES = String(16 * 1024);

    fs.writeFileSync(path.join(codexRoot, 'large-rollout.jsonl'), 'x'.repeat(512 * 1024));
    fs.writeFileSync(path.join(codexRoot, 'recent.jsonl'), [
      JSON.stringify({
        ts: new Date().toISOString(),
        agent: 'repair',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
      '',
    ].join('\n'));

    const LlmUsage = require('../projects/控制台/llm-usage');
    const overview = LlmUsage.buildOverview({ cfg: {}, nowMs: Date.now(), queueAgents: [] });
    const codex = overview.models.find(m => m.id === 'codex');
    assert(codex, 'codex usage model must be present');
    assert(overview.models.some(m => m.id === 'claude-code'), 'Claude usage must be visible by default (2026-07-03 秘书+维修主管复活)');
    assert.strictEqual(codex.sourceStatus, 'ok');
    assert(codex.sourceDetail.filesSkipped >= 1, 'large usage files must be skipped instead of parsed');
    assert.strictEqual(codex.currentUsage.total_tokens, 15);

    console.log(JSON.stringify({ pass: true, suite: 'llm-usage-safety' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
