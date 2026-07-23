#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const Runner = require('./run');

const root = path.resolve(__dirname, '..');

function main() {
  const profiles = Runner.readProfiles();
  const smoke = Runner.profileTests('smoke', profiles);
  const lean = Runner.profileTests('lean', profiles);
  const frontendFast = Runner.profileTests('frontend-fast', profiles);
  const frontendRelease = Runner.profileTests('frontend-release', profiles);
  Runner.validateSelection(smoke);
  Runner.validateSelection(lean);
  Runner.validateSelection(frontendFast);
  Runner.validateSelection(frontendRelease);
  assert.strictEqual(profiles.routine_profile, 'smoke');
  assert(smoke.includes('done-gate.test.js'));
  assert(smoke.includes('prompt-budget.test.js'));
  assert(!smoke.includes('secret-hygiene.test.js'));
  assert(smoke.length < lean.length);
  assert(lean.includes('done-gate.test.js'));
  assert(lean.includes('secret-hygiene.test.js'));
  assert(lean.includes('stale-running-heartbeat.test.js'));
  assert(!lean.includes('office-experiment.test.js'));
  assert(lean.length < Runner.allTests.length / 2, `lean profile is too large: ${lean.length}/${Runner.allTests.length}`);
  assert(frontendFast.includes('frontend-contracts.test.js'));
  assert(frontendFast.includes('frontend-budget.test.js'));
  assert(!frontendFast.includes('e2e-canary.test.js'));
  assert(frontendRelease.includes('e2e-canary.test.js'));
  assert(frontendFast.length < frontendRelease.length);

  const provenance = new Map();
  for (const profile of Object.values(profiles.profiles || {})) {
    for (const entry of profile.tests || []) {
      if (!entry || typeof entry !== 'object') continue;
      provenance.set(entry.file, entry);
    }
  }
  for (const file of [...new Set([...smoke, ...lean, ...frontendFast, ...frontendRelease])]) {
    const entry = provenance.get(file);
    assert(entry, `${file} lacks a provenance entry`);
    assert(String(entry.reason || '').trim(), `${file} lacks a reason`);
    assert(Array.isArray(entry.incident_refs) && entry.incident_refs.length, `${file} lacks incident_refs`);
  }

  const listed = spawnSync(process.execPath, ['tests/run.js', '--profile', 'lean', '--list'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.strictEqual(listed.status, 0, listed.stderr);
  const payload = JSON.parse(listed.stdout);
  assert.strictEqual(payload.profile, 'lean');
  assert.strictEqual(payload.count, lean.length);
  assert(payload.dormantForRoutine.includes('office-experiment.test.js'));

  const smokeListed = spawnSync(process.execPath, ['tests/run.js', '--profile', 'smoke', '--list'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.strictEqual(smokeListed.status, 0, smokeListed.stderr);
  const smokePayload = JSON.parse(smokeListed.stdout);
  assert.strictEqual(smokePayload.profile, 'smoke');
  assert.strictEqual(smokePayload.count, smoke.length);

  const frontendListed = spawnSync(process.execPath, ['tests/run.js', '--profile', 'frontend-fast', '--list'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.strictEqual(frontendListed.status, 0, frontendListed.stderr);
  const frontendPayload = JSON.parse(frontendListed.stdout);
  assert.strictEqual(frontendPayload.profile, 'frontend-fast');
  assert.strictEqual(frontendPayload.count, frontendFast.length);
  assert(frontendPayload.dormantForRoutine.includes('e2e-canary.test.js'));

  assert.throws(
    () => Runner.profileTests('missing-profile', profiles),
    /unknown regression profile/,
  );
  console.log(JSON.stringify({
    pass: true,
    suite: 'test-run-profiles',
    smoke: smoke.length,
    lean: lean.length,
    frontendFast: frontendFast.length,
    frontendRelease: frontendRelease.length,
    full: Runner.allTests.length,
  }));
}

main();
