#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const writer = path.join(root, 'shared/agents/ui-optimizer/append-learning-case-event.js');

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-opt-event-writer-'));
  try {
    const events = path.join(tmp, 'engine-events.jsonl');
    const runs = [];
    for (let i = 0; i < 12; i++) {
      runs.push(spawnSync(process.execPath, [
        writer,
        '--events', events,
        '--iter', String(i + 1),
        '--max-iter', '12',
        '--enq', String(i),
        '--left', '0',
      ], {
        cwd: root,
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CASE_FILE_REL: 'board/learning-cases/ui-optimization-cases.md',
          SUMMARY_REL: 'projects/控制台/artifacts/ui-optimize/reports/SUMMARY.md',
          UI_OPT_TASK_ID: `task-${i}`,
          UI_OPT_QUEUE_AGENT: 'ui-optimizer',
          UI_OPT_QUEUE_ID: `queue-${i}`,
          UI_OPT_ROOT_QUEUE_ID: 'root-queue',
          UI_OPT_SOURCE_CASE_ANCHOR: 'board/learning-cases/ui-optimization-cases.md#source-case',
          UI_OPT_SOURCE_CASE_HASH: 'source-case-hash',
          UI_OPT_SOURCE_CASE_TITLE: 'Source case',
        }),
      }));
    }

    for (const [i, run] of runs.entries()) {
      assert.strictEqual(run.status, 0, run.stderr || `writer ${i} failed`);
    }

    const lines = fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 12, 'all simulated writers must append exactly one line');
    const parsed = lines.map(line => JSON.parse(line));
    assert(parsed.every(ev => ev.type === 'learning_case.appended'), 'all events must keep stable type');
    assert.strictEqual(new Set(parsed.map(ev => ev.taskId)).size, 12, 'task ids must not be lost or duplicated');
    assert(parsed.every(ev => ev.rootQueueId === 'root-queue'), 'root queue metadata must survive');
    assert(parsed.every(ev => ev.sourceCaseAnchor === 'board/learning-cases/ui-optimization-cases.md#source-case'), 'source case anchor must survive');
    assert(parsed.every(ev => ev.sourceCaseHash === 'source-case-hash'), 'source case hash must survive');
    assert(parsed.every(ev => ev.sourceCaseTitle === 'Source case'), 'source case title must survive');
    assert(!fs.existsSync(`${events}.learning-case.lock`), 'event lock must be released after append');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('ui-optimizer-event-writer ok');
}

main();
