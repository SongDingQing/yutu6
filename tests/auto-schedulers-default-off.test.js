#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-auto-schedulers-off-'));

try {
  process.env.CONSOLE_ARTIFACTS_DIR = root;
  process.env.QUEUE_WORKER_DISABLED = '1';
  delete process.env.AUTO_OPTIMIZER_ENABLED;
  delete process.env.SCHEDULED_PAGE_REVIEW_ENABLED;
  delete process.env.INSIGHT_SCOUT_REPOS_ENABLED;

  const Server = require('../projects/控制台/server');

  const auto = Server.checkAutoOptimizer({ nowMs: Date.parse('2026-07-03T00:00:00.000Z') });
  assert.strictEqual(auto.action, 'disabled');

  const page = Server.checkScheduledPageReview({ nowMs: Date.parse('2026-07-03T00:00:00.000Z') });
  assert.strictEqual(page.action, 'disabled');

  const insight = Server.checkInsightScoutRepos({ nowMs: Date.parse('2026-07-03T00:00:00.000Z') });
  assert.strictEqual(insight.action, 'disabled');

  console.log(JSON.stringify({ pass: true, suite: 'auto-schedulers-default-off' }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
