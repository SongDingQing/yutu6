#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const allTests = [
  'queue.test.js',
  'ceo-queue-control.test.js',
  'queue-organizer.test.js',
  'queue-agent-discovery.test.js',
  'repair-ticket-bulletin.test.js',
  'repair-policy.test.js',
  'repair-department.test.js',
  '../projects/控制台/tests/role-boundary-routing.test.js',
  '../projects/控制台/tests/independent-role-receipts.test.js',
  'repair-report.test.js',
  'board-review.test.js',
  'project-route-board-order.test.js',
  'resource-lock-inference.test.js',
  'agents-check.test.js',
  'action-verify.test.js',
  'front-door-policy.test.js',
  'learning-cases-policy.test.js',
  'ui-optimizer-event-writer.test.js',
  'self-reflection-optimizer.test.js',
  'bulletin-weekly-cleanup.test.js',
  'self-review-rotation.test.js',
  'secretary-context-budget.test.js',
  'hr-agent-onboarding.test.js',
  'version-manager.test.js',
  'version-progress-hook.test.js',
  'it-engineer-interface.test.js',
  'workspace-title.test.js',
  'newapi-a11y.test.js',
  'control-room-llm-gateway.test.js',
  'office-experiment.test.js',
  'office-building-state.test.js',
  'office-image-template.test.js',
  'runtime-settings.test.js',
  'workspace-taskboard.test.js',
  'workspace-settings-api.test.js',
  'workspace-settings-ui.test.js',
  'workspace-task-status-truth.test.js',
  'workspace-render-architecture.test.js',
  'project-routing.test.js',
  'cli-runner.test.js',
  'handoff-shadow.test.js',
  'lesson-injection.test.js',
  'ceo-elastic-depth.test.js',
  'kb-inject.test.js',
  'lesson-graph-canary.test.js',
  'text-tool-harness.test.js',
  'protocol-gate.test.js',
  'done-gate.test.js',
  '../projects/控制台/tests/acceptance-handoff.test.js',
  '../projects/控制台/tests/review-delta-context.test.js',
  '../projects/控制台/tests/review-negative-routing-contract.test.js',
  'review-routing-contract.test.js',
  'visual-acceptance.test.js',
  'done-gate-execute-evidence.test.js',
  'regression-command-policy.test.js',
  'write-audit.test.js',
  'gate-policy.test.js',
  'test-run-profiles.test.js',
  'agent-once-self-report.test.js',
  'runner-failover.test.js',
  'worker-code-reload.test.js',
  'worker-reaper.test.js',
  'incremental-event-reader.test.js',
  'audit-pulse.test.js',
  'ceo-runtime-efficiency.test.js',
  'eventlog-rotate.test.js',
  'loop-engineering.test.js',
  'execution-profile.test.js',
  'context-budget.test.js',
  'prompt-budget.test.js',
  'hardening-hooks.test.js',
  'owner-auto-notify.test.js',
  'notify-severity-tiers.test.js',
  'repair-incident-idempotency.test.js',
  'decision-callback.test.js',
  'meowa-asset-decision.test.js',
  'feishu-notify-rate.test.js',
  'feishu-card-types.test.js',
  'version-history.test.js',
  'task-failure-reason.test.js',
  'node-failure-retry.test.js',
  'quota-degrade.test.js',
  'llm-usage-safety.test.js',
  'locate-anything-service.test.js',
  'auto-schedulers-default-off.test.js',
  'insight-scout-repos.test.js',
  'insight-scout-agent-harness-policy.test.js',
  'insight-workload-audit.test.js',
  'auto-page-review.test.js',
  'ceo-serial-lock.test.js',
  'stale-running-heartbeat.test.js',
  'crash-recovery-idempotency.test.js',
  'watchdog-daemon.test.js',
  'ram-watchdog.test.js',
  'server-async-unblock.test.js',
  'memory-architecture.test.js',
  'console-alias-port.test.js',
  'e2e-canary.test.js',
  'role-performance-report.test.js',
  'secret-hygiene.test.js',
  'routing-scoring.test.js',
  'interaction-trace.test.js',
  'quality-ops-audit.test.js',
  'quality-ops-weekly-report.test.js',
];

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : null;
}

function readProfiles() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'regression-profiles.json'), 'utf8'));
}

function profileTests(name, profiles, seen = new Set()) {
  if (name === 'full') return allTests.slice();
  if (seen.has(name)) throw new Error(`cyclic regression profile: ${name}`);
  const profile = profiles.profiles && profiles.profiles[name];
  if (!profile) throw new Error(`unknown regression profile: ${name}`);
  seen.add(name);
  const selected = [];
  for (const included of profile.include || []) {
    selected.push(...profileTests(included, profiles, seen));
  }
  for (const entry of profile.tests || []) {
    const file = typeof entry === 'string' ? entry : entry && entry.file;
    if (file) selected.push(file);
  }
  seen.delete(name);
  return [...new Set(selected)];
}

function validateSelection(selected) {
  const unknown = selected.filter(file => !allTests.includes(file));
  if (unknown.length) throw new Error(`profile references tests not in run.js: ${unknown.join(', ')}`);
}

function main(argv = process.argv.slice(2)) {
  const profiles = readProfiles();
  const profile = argValue(argv, '--profile')
    || process.env.YUTU6_TEST_PROFILE
    || profiles.default_profile
    || 'full';
  const selected = profileTests(profile, profiles);
  validateSelection(selected);

  if (argv.includes('--list')) {
    console.log(JSON.stringify({
      profile,
      count: selected.length,
      tests: selected,
      dormantForRoutine: profile === 'full'
        ? []
        : allTests.filter(file => !selected.includes(file)),
    }, null, 2));
    return 0;
  }

  let failed = 0;
  const startedAt = Date.now();
  const timings = [];

  for (const name of selected) {
    const file = path.join(__dirname, name);
    const started = Date.now();
    const result = spawnSync(process.execPath, [file], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env),
      encoding: 'utf8',
    });
    const elapsedMs = Date.now() - started;
    timings.push({ file: name, elapsedMs, status: result.status });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status !== 0) {
      failed++;
      console.error(`[FAIL] ${name} exited with ${result.status} (${elapsedMs}ms)`);
      if (argv.includes('--fail-fast')) break;
    } else {
      console.log(`[PASS] ${name} (${elapsedMs}ms)`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  if (failed) {
    console.error(`\n${failed} test file(s) failed in profile=${profile} (${elapsedMs}ms).`);
    return 1;
  }

  console.log(`\nAll tests passed. profile=${profile} files=${timings.length} elapsedMs=${elapsedMs}`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  allTests,
  readProfiles,
  profileTests,
  validateSelection,
  main,
};
