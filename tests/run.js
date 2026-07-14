#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const tests = [
  'setup-service.test.js',
  'project-departments.test.js',
  'setup-gate.test.js',
  'generic-distribution.test.js',
  'queue.test.js',
  'ceo-queue-control.test.js',
  'queue-organizer.test.js',
  'queue-agent-discovery.test.js',
  'repair-ticket-bulletin.test.js',
  'repair-policy.test.js',
  'repair-department.test.js',
  'board-review.test.js',
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
  'office-image-template.test.js',
  'workspace-taskboard.test.js',
  'workspace-render-architecture.test.js',
  'project-routing.test.js',
  'cli-runner.test.js',
  'handoff-shadow.test.js',
  'lesson-injection.test.js',
  'ceo-elastic-depth.test.js',
  'kb-inject.test.js',
  'text-tool-harness.test.js',
  'protocol-gate.test.js',
  'done-gate.test.js',
  'done-gate-execute-evidence.test.js',
  'write-audit.test.js',
  'agent-once-self-report.test.js',
  'runner-failover.test.js',
  'worker-code-reload.test.js',
  'worker-reaper.test.js',
  'eventlog-rotate.test.js',
  'loop-engineering.test.js',
  'hardening-hooks.test.js',
  'owner-auto-notify.test.js',
  'notify-severity-tiers.test.js',
  'decision-callback.test.js',
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
  'auto-page-review.test.js',
  'ceo-serial-lock.test.js',
  'stale-running-heartbeat.test.js',
  'crash-recovery-idempotency.test.js',
  'watchdog-daemon.test.js',
  'ram-watchdog.test.js',
  'server-async-unblock.test.js',
  'e2e-canary.test.js',
  'role-performance-report.test.js',
  'secret-hygiene.test.js',
  'routing-scoring.test.js',
];

let failed = 0;

for (const name of tests) {
  const file = path.join(__dirname, name);
  const result = spawnSync(process.execPath, [file], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env),
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    failed++;
    console.error(`[FAIL] ${name} exited with ${result.status}`);
  } else {
    console.log(`[PASS] ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} test file(s) failed.`);
  process.exit(1);
}

console.log('\nAll tests passed.');
