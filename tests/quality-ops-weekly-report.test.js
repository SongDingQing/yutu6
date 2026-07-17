#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qops-pdf-test-'));
  try {
    const artifacts = path.join(root, 'artifacts');
    const outputDir = path.join(root, 'Documents', '玉兔质量运营报告');
    writeJson(path.join(artifacts, 'quality-ops', 'review-ledger.json'), {
      reviews: [
        { chain_id: 'chain-a', content_hash: 'a', route_key: 'secretary@codex -> orchestrator@codex', verdict: 'warning', reviewed_at: '2026-07-11T04:00:00.000Z' },
        { chain_id: 'chain-b', content_hash: 'b', route_key: 'quality_ops@zhipu-glm-tools', verdict: 'pass', reviewed_at: '2026-07-12T04:00:00.000Z' },
      ],
      reservations: [{ chain_id: 'chain-c', status: 'reserved', reserved_at: '2026-07-12T05:00:00.000Z' }],
    });
    writeJson(path.join(artifacts, 'quality-ops', 'proposal-ledger.json'), {
      proposals: [{ title: '重复检查固化为脚本', category: 'script', status: 'todo_owner_decision', created_at: '2026-07-12T04:30:00.000Z' }],
    });
    writeJson(path.join(artifacts, 'quality-ops', 'audits', '2026-07-12', 'qops-test', 'results', 'batch-01.json'), {
      schema: 'yutu6-quality-ops-findings@1', ingested_at: '2026-07-12T04:00:00.000Z',
      chain_reviews: [{ chain_id: 'chain-a', verdict: 'warning', findings: ['主管重复读取同一上下文，可改为索引命中。'] }],
    });
    const python = process.env.YUTU6_PYTHON || '/Users/yutu6/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
    const script = path.join(__dirname, '../projects/控制台/tools/quality-ops-weekly-report.py');
    const run = spawnSync(python, [script, '--artifacts', artifacts, '--output-dir', outputDir, '--end-date', '2026-07-12'], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    });
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
    assert.strictEqual(result.reviewed_chains, 2);
    assert.strictEqual(result.proposals, 1);
    assert(result.bytes > 1000);
    const bytes = fs.readFileSync(result.output);
    assert.strictEqual(bytes.slice(0, 4).toString('ascii'), '%PDF');
    console.log(JSON.stringify({ pass: true, suite: 'quality-ops-weekly-report', bytes: result.bytes }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
