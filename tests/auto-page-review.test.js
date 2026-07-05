#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-page-review-test-'));
process.env.CONSOLE_ARTIFACTS_DIR = root;
process.env.QUEUE_WORKER_DISABLED = '1';
process.env.AUTO_OPTIMIZER_ENABLED = '';
process.env.SCHEDULED_PAGE_REVIEW_ENABLED = '1';
process.env.SCHEDULED_PAGE_REVIEW_INTERVAL_MS = String(4 * 60 * 60 * 1000);
process.env.SCHEDULED_PAGE_REVIEW_CHECK_MS = '60000';

const Q = require('../shared/engine/queue');
const Server = require('../projects/控制台/server');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function queued(agent) {
  return Q.list(root, agent).queued;
}

function cancelQueued(agent) {
  for (const entry of queued(agent)) Q.cancel(root, agent, entry.id);
}

function main() {
  try {
    const start = Date.parse('2026-06-23T00:00:00.000Z');
    const first = Server.checkScheduledPageReview({ force: true, nowMs: start });
    assert.strictEqual(first.action, 'enqueued');
    assert.strictEqual(first.entries.length, 2);
    assert.deepStrictEqual(first.entries.map(e => e.agent).sort(), ['frontend_designer', 'ui_optimizer']);

    const frontend = queued('frontend_designer')[0];
    const optimizer = queued('ui_optimizer')[0];
    assert(frontend, 'frontend_designer review task should be queued');
    assert(optimizer, 'ui_optimizer review task should be queued');
    assert.strictEqual(frontend.priority, 99, 'frontend review must be low priority');
    assert.strictEqual(optimizer.priority, 99, 'ui_optimizer review must be low priority');
    assert.strictEqual(frontend.task.scheduledPageReview.reviewId, first.reviewId);
    assert.strictEqual(optimizer.task.scheduledPageReview.reviewId, first.reviewId);
    assert.match(optimizer.task.goal, /Codex/);
    assert.match(optimizer.task.goal, /--ignore ui_optimizer,frontend_designer/);
    assert.match(frontend.task.goal, /review\/interaction/);
    assert.match(frontend.task.goal, /review\/architecture/);

    const manifestPath = path.join(root, 'ui-review', 'scheduled', first.reviewId, 'manifest.json');
    const manifest = readJson(manifestPath);
    assert.deepStrictEqual(manifest.agents, ['frontend_designer', 'ui_optimizer']);
    assert.strictEqual(manifest.privacy.redactSensitiveData, true);
    assert.strictEqual(manifest.consumption.dispatchPolicy, 'supervisor_decides');

    cancelQueued('frontend_designer');
    cancelQueued('ui_optimizer');

    const unchanged = Server.checkScheduledPageReview({
      nowMs: start + 4 * 60 * 60 * 1000 + 1,
    });
    assert.strictEqual(unchanged.action, 'skip');
    assert.strictEqual(unchanged.reason, 'page-unchanged');
    assert(unchanged.nextAt, 'page unchanged skip must reset nextAt');
    assert.strictEqual(queued('frontend_designer').length, 0);
    assert.strictEqual(queued('ui_optimizer').length, 0);

    const raced = Server.checkScheduledPageReview({
      force: true,
      nowMs: start + 8 * 60 * 60 * 1000,
      beforeSecondIdleCheck() {
        Q.enqueue(root, 'worker_code', {
          role: 'worker_code',
          projectId: '控制台',
          goal: 'business task arrives during page review idle recheck',
        }, { id: 'businessRace', priority: 10 });
      },
    });
    assert.strictEqual(raced.action, 'skip');
    assert.strictEqual(raced.reason, 'queues-active-after-recheck');
    assert.strictEqual(queued('frontend_designer').length, 0);
    assert.strictEqual(queued('ui_optimizer').length, 0);

    console.log(JSON.stringify({ pass: true, suite: 'auto-page-review' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main();
