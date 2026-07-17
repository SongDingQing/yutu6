#!/usr/bin/env node
'use strict';

const fs = require('fs');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function readRows() {
  return JSON.parse(fs.readFileSync(process.env.REVIEW_DELTA_ROWS_FILE, 'utf8'));
}

function deltaContext(prompt) {
  const line = prompt.split(/\r?\n/).find(item => item.startsWith('- 上一步差量上下文(供参考):'));
  return line ? JSON.parse(line.slice(line.indexOf(':') + 1)) : null;
}

function rowResult(row, status) {
  return {
    point: row.point,
    text: row.text,
    acceptance_id: row.acceptance_id,
    source_hash: row.source_hash,
    scope: row.scope,
    status,
    evidence: 'projects/控制台/fixture-proof.txt:1',
    notes: status === '完成' ? 'mock regression recheck passed' : 'mock review found a reproducible gap',
  };
}

function main() {
  const prompt = readStdin();
  const rows = readRows();
  const isReview = /^# 任务:review$/m.test(prompt);
  let payload;
  if (isReview) {
    const delta = deltaContext(prompt);
    if (!delta) throw new Error('review prompt missing delta context');
    const improvement = '补充 artifact ref 校验失败时的自动脱敏全文回退断言。';
    payload = {
      review: {
        pass: false,
        severity: 'medium',
        notes: `${['Bearer', 'TEST_ONLY_REDACTION_VALUE_1234567890'].join(' ')}; ${improvement}`,
        critique: improvement,
        evaluation: {
          score: 0.7,
          criteria_scores: rows.map((row, index) => ({
            id: row.acceptance_id,
            score: index === 0 ? 0.4 : 1,
            evidence: 'projects/控制台/fixture-proof.txt:1',
          })),
          gaps: [improvement],
          improvement_points: [improvement],
        },
        verification: {
          verdict: 'partial',
          immutable_context: {
            goal_sha256: delta.goal_sha256,
            spec_fingerprint: delta.spec_fingerprint,
            verified: true,
          },
          checked: ['projects/控制台/fixture-proof.txt'],
          acceptance_table: rows.map((row, index) => rowResult(row, index === 0 ? '未完成' : '完成')),
          evidence: [{
            kind: 'file',
            path: 'projects/控制台/fixture-proof.txt',
            summary: 'mock runner inspected the fixture proof',
          }],
        },
      },
    };
  } else {
    payload = {
      implementation: {
        done: true,
        summary: 'mock implementation used by the differential-context regression fixture',
        changed_files: ['projects/控制台/fixture-proof.txt'],
        receipt: {
          taskId: process.env.REVIEW_DELTA_TASK_ID,
          specFingerprint: process.env.REVIEW_DELTA_SPEC_FINGERPRINT,
          changedFiles: ['projects/控制台/fixture-proof.txt'],
          tests: ['fixture exit 0'],
          artifacts: ['projects/控制台/fixture-proof.txt:1'],
          verdict: 'done',
          blocked_required_specs: [],
        },
        acceptance_table: rows.map(row => rowResult(row, '完成')),
        logic_chain: {
          summary: 'mock fixture implementation',
          current_status: 'done',
          actions: ['wrote the deterministic fixture proof'],
          evidence: [{ kind: 'file', path: 'projects/控制台/fixture-proof.txt', summary: 'fixture proof exists' }],
          tests: [],
          conclusion: 'mock fixture complete',
        },
      },
    };
  }
  process.stdout.write(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`);
}

main();
