#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { auditPackage } = require('../quality-ops/ahr-26-30/independent-review');

const root = path.resolve(__dirname, '../../..');
const riskRelative = 'projects/控制台/quality-ops/ahr-26-30/blocking-risk-assessment.md';
const baselineRelative = 'projects/控制台/quality-ops/ahr-26-30/production-hook-baseline.json';

const clean = auditPackage();
assert.strictEqual(clean.pass, true, JSON.stringify(clean.checks.filter(check => !check.pass)));
assert.strictEqual(clean.hooks.length, 5);
assert.strictEqual(clean.checks.find(check => check.id === 'current_task_identity_consistent').pass, true);
assert.strictEqual(clean.checks.find(check => check.id === 'real_review_loop_not_old_fixture').pass, true);

const risk = fs.readFileSync(path.join(root, riskRelative), 'utf8');
const invalidStatus = auditPackage({ overrides: { [riskRelative]: risk.replace('| 待主人拍板 |', '| done |') } });
assert.strictEqual(invalidStatus.pass, false);
assert.strictEqual(invalidStatus.checks.find(check => check.id === 'risk_rows_closed_with_allowed_status').pass, false);

const baseline = JSON.parse(fs.readFileSync(path.join(root, baselineRelative), 'utf8'));
baseline.files['shared/engine/hook-registry.js'] = '0'.repeat(64);
const drift = auditPackage({ overrides: { [baselineRelative]: JSON.stringify(baseline) } });
assert.strictEqual(drift.pass, false);
assert.strictEqual(drift.checks.find(check => check.id === 'production_hook_baseline_unchanged').pass, false);

console.log('ahr-26-30 independent review tests: ok');
