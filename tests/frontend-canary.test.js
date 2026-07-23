#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Canary = require('../projects/控制台/tools/frontend-canary');

assert.strictEqual(Canary.DEFAULT_DURATION_HOURS, 8);
assert.strictEqual(Canary.DEFAULT_INTERVAL_SECONDS, 60);
assert.deepStrictEqual(
  Canary.evaluateTransition({ lastSeq: 10 }, { ok: true, lastSeq: 11 }),
  { ok: true, hardFailure: false, reason: '' },
);
assert.deepStrictEqual(
  Canary.evaluateTransition({ lastSeq: 10 }, { ok: true, lastSeq: 9 }),
  { ok: false, hardFailure: true, reason: 'event-sequence-regressed' },
);
assert.strictEqual(Canary.evaluateTransition(null, { ok: false }).hardFailure, true);
assert.strictEqual(Canary.shouldRollback(2), false);
assert.strictEqual(Canary.shouldRollback(3), true);

const source = fs.readFileSync(path.join(__dirname, '..', 'projects', '控制台', 'tools', 'frontend-canary.js'), 'utf8');
assert(source.includes("FrontendRoute.writeTarget(ARTIFACTS_ROOT, 'legacy'"));
assert(source.includes("'/api/workspace/snapshot'"));
assert(source.includes('rssGrowthBytes'));

console.log(JSON.stringify({ pass: true, suite: 'frontend-canary' }));
