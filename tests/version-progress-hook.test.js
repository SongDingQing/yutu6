#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const VersionProgressHook = require('../projects/控制台/version-progress-hook');
const VersionManager = require('../projects/控制台/tools/version-manager');
const DoneGate = require('../shared/engine/done-gate');
const { HookRegistry } = require('../shared/engine/hook-registry');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function initRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-progress-hook-'));
  write(path.join(root, 'VERSION.json'), JSON.stringify({
    schema_version: 1,
    owner_agent: 'it-engineer',
    version: '0.0.0.0',
    updated_at: '2026-06-21T18:53:58.882Z',
    last_change: null,
    parts: VersionManager.PART_LABELS,
  }, null, 2) + '\n');
  return root;
}

function completionReceipt(ctx, changedFiles = []) {
  if (!ctx || !ctx.taskId || !ctx.specFingerprint) return null;
  return {
    taskId: ctx.taskId,
    specFingerprint: ctx.specFingerprint,
    changedFiles,
    tests: ['node tests/version-progress-hook.test.js exit 0'],
    artifacts: changedFiles.length ? changedFiles : ['tests/version-progress-hook.test.js'],
    verdict: 'done',
    blocked_required_specs: [],
  };
}

function implementation(changedFiles = [], ctx = null) {
  const out = {
    done: true,
    summary: 'version hook fixture implementation',
    changed_files: changedFiles,
    logic_chain: {
      summary: 'fixture did real work',
      current_status: 'done',
      actions: ['validated version hook behavior'],
      evidence: changedFiles.map(file => ({ kind: 'file', path: file, summary: 'version hook fixture file exists' })),
      tests: [],
      conclusion: 'fixture complete',
    },
  };
  const receipt = completionReceipt(ctx, changedFiles);
  if (receipt) out.receipt = receipt;
  return out;
}

function review(changedFiles = []) {
  return {
    pass: true,
    severity: 'low',
    reviewer: 'supervisor-控制台',
    notes: `verified version hook fixture ${changedFiles.join(', ')}`,
    verification: {
      verdict: 'true',
      checked: ['implementation.logic_chain', 'implementation.changed_files', ...changedFiles],
      evidence: changedFiles.map(file => ({ kind: 'file', path: file, summary: 'review verified version hook fixture file' })),
    },
  };
}

function task(root, id, releaseImpact, opts = {}) {
  const changed = opts.changedFile || `changed-${id}.txt`;
  if (opts.writeChanged !== false) write(path.join(root, changed), `${id}\n`);
  const versionProgress = {};
  if (releaseImpact != null) versionProgress.releaseImpact = releaseImpact;
  if (opts.majorApproved) versionProgress.major_approved = true;
  if (opts.sourceHook) versionProgress.sourceHook = opts.sourceHook;
  return {
    id,
    flow: 'review-loop',
    state: 'done',
    vars: {
      projectId: opts.projectId || '控制台',
      goal: opts.goal || '修复控制台源码',
      acceptance: opts.acceptance || '必须有 changed_files 与测试证据',
      releaseImpact: opts.releaseImpactField,
      version_progress: versionProgress,
      implementation: opts.implementation || implementation([changed]),
      review: opts.review || review([changed]),
    },
    evidence: [{ type: 'result', path: changed }],
    visits: { implement: 1, review: 1 },
    completed_steps: ['implement#1', 'review#1'],
    last_completed_node: 'review',
    steps: {},
  };
}

function gateFor(root, t) {
  return VersionProgressHook.isTaskTrulyComplete(t, { root, workspaceRoot: root });
}

function auditEntries(root) {
  const file = path.join(root, VersionProgressHook.AUDIT_REL);
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function recoveryAuditEntries(root) {
  const file = path.join(root, VersionProgressHook.AUDIT_RECOVERY_REL);
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function errorLogEntries(root) {
  const file = path.join(root, VersionProgressHook.ERROR_LOG_REL);
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function bump(root, t, opts = {}) {
  const event = Object.assign({
    task: t,
    taskId: t.id,
    projectId: t.vars.projectId,
    completionEventId: opts.completionEventId || `evt-${t.id}`,
    gate: opts.gate === undefined ? gateFor(root, t) : opts.gate,
  }, opts.event || {});
  const hookOpts = Object.assign({
    root,
    workspaceRoot: root,
  }, opts.hookOpts || {});
  if (opts.publisher) hookOpts.publisher = opts.publisher;
  if (opts.auditWriter) hookOpts.auditWriter = opts.auditWriter;
  return VersionProgressHook.handleTrueDone(event, hookOpts);
}

async function spawnHook(root, taskFile) {
  const code = `
const fs = require('fs');
const hook = require(${JSON.stringify(path.join(repoRoot, 'projects/控制台/version-progress-hook'))});
const task = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const root = process.argv[2];
const gate = hook.isTaskTrulyComplete(task, { root, workspaceRoot: root });
const result = hook.handleTrueDone({
  task,
  taskId: task.id,
  projectId: task.vars.projectId,
  completionEventId: 'evt-' + task.id,
  gate,
}, { root, workspaceRoot: root });
if (!result.ok) { console.error(JSON.stringify(result)); process.exit(2); }
`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, taskFile, root], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `hook child exited ${code}`));
    });
  });
}

async function testReleaseImpactAndTrueDone() {
  for (const [releaseImpact, expected, extra] of [
    ['fix', '0.0.0.1', {}],
    ['minor', '0.0.1.0', {}],
    ['major', '0.1.0.0', { majorApproved: true }],
  ]) {
    const root = initRoot();
    try {
      const res = bump(root, task(root, `task-${releaseImpact}`, releaseImpact, extra));
      assert.strictEqual(res.decision, 'bump');
      assert.strictEqual(res.releaseImpact, releaseImpact);
      assert.strictEqual(res.trueCompletionVerdict.ok, true);
      assert.strictEqual(res.completionEventId, `evt-task-${releaseImpact}`);
      assert.strictEqual(VersionManager.readVersionState(root).version, expected);
      const audit = auditEntries(root);
      const last = audit[audit.length - 1];
      assert.strictEqual(last.completionHash.length, 64);
      assert.strictEqual(last.timestamp, last.at);
      assert.strictEqual(last.eventId, `evt-task-${releaseImpact}`);
      assert.strictEqual(last.reviewer, 'supervisor-控制台');
      assert.strictEqual(last.oldVersion, '0.0.0.0');
      assert.strictEqual(last.newVersion, expected);
      assert.strictEqual(last.publishResult.ok, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function testFalseDoneMissingVerdictAndImpactSkip() {
  const root = initRoot();
  try {
    const fake = task(root, 'fake-done', 'fix', {
      review: Object.assign(review(['changed-fake-done.txt']), { pass: false }),
    });
    const fakeRes = bump(root, fake);
    assert.strictEqual(fakeRes.decision, 'skip');
    assert.match(fakeRes.reason, /not_true_done/);
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0');

    const missingVerdict = task(root, 'missing-verdict', 'fix');
    const missingVerdictRes = bump(root, missingVerdict, { gate: null });
    assert.strictEqual(missingVerdictRes.decision, 'skip');
    assert.strictEqual(missingVerdictRes.reason, 'missing_true_completion_verdict');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0');

    const missing = task(root, 'missing-impact', null);
    const missingRes = bump(root, missing);
    assert.strictEqual(missingRes.decision, 'skip');
    assert.strictEqual(missingRes.reason, 'missing_release_impact');
    assert.strictEqual(missingRes.manualChannel, true);

    const manual = task(root, 'manual-impact', 'manual');
    const manualRes = bump(root, manual);
    assert.strictEqual(manualRes.decision, 'skip');
    assert.strictEqual(manualRes.reason, 'manual_release_required');
    assert.strictEqual(manualRes.manualChannel, true);

    const none = task(root, 'none-impact', 'none');
    const noneRes = bump(root, none);
    assert.strictEqual(noneRes.decision, 'skip');
    assert.strictEqual(noneRes.reason, 'release_impact_none');
    assert.strictEqual(noneRes.manualChannel, false);
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testOtherProjectMajorApprovalAndSelfTriggerSkip() {
  const root = initRoot();
  try {
    const otherProject = task(root, 'other-project-task', 'fix', { projectId: 'example-project' });
    const otherProjectRes = bump(root, otherProject);
    assert.strictEqual(otherProjectRes.decision, 'skip');
    assert.strictEqual(otherProjectRes.reason, 'project_not_console');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0');

    const major = task(root, 'major-no-approval', 'major');
    const majorRes = bump(root, major);
    assert.strictEqual(majorRes.decision, 'skip');
    assert.strictEqual(majorRes.reason, 'major_requires_manual_confirmation');

    const selfEvent = task(root, 'self-trigger-event', 'fix');
    const selfEventRes = bump(root, selfEvent, { event: { sourceHook: VersionProgressHook.HOOK_ID } });
    assert.strictEqual(selfEventRes.decision, 'skip');
    assert.strictEqual(selfEventRes.reason, 'self_triggered_by_version_hook');

    const selfVars = task(root, 'self-trigger-vars', 'fix', { sourceHook: VersionProgressHook.HOOK_ID });
    const selfVarsRes = bump(root, selfVars);
    assert.strictEqual(selfVarsRes.decision, 'skip');
    assert.strictEqual(selfVarsRes.reason, 'self_triggered_by_version_hook');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testIdempotencyAndPublishRecovery() {
  const root = initRoot();
  try {
    const once = task(root, 'idem-task', 'fix');
    assert.strictEqual(bump(root, once, { completionEventId: 'completion-1' }).decision, 'bump');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');
    const replay = bump(root, once, { completionEventId: 'completion-1' });
    assert.strictEqual(replay.decision, 'skip');
    assert.strictEqual(replay.reason, 'idempotent_already_bumped');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');

    const failed = task(root, 'publish-fail', 'fix');
    const failedRes = bump(root, failed, {
      publisher() { throw new Error('simulated git remote failure'); },
    });
    assert.strictEqual(failedRes.ok, false);
    assert.strictEqual(failedRes.decision, 'rollback');
    assert.strictEqual(failedRes.reason, 'git_publish_failed');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');

    const returnedFailure = task(root, 'publish-return-false', 'fix');
    const returnedFailureRes = bump(root, returnedFailure, {
      publisher() { return { ok: false, mode: 'simulated_publish', remote: 'origin', reason: 'simulated false result' }; },
    });
    assert.strictEqual(returnedFailureRes.ok, false);
    assert.strictEqual(returnedFailureRes.decision, 'rollback');
    assert.strictEqual(returnedFailureRes.reason, 'git_publish_failed');
    assert.strictEqual(returnedFailureRes.publishResult.ok, false);
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');

    const auditFailure = task(root, 'audit-fail-after-publish', 'fix');
    const auditFailureRes = bump(root, auditFailure, {
      publisher() { return { ok: true, mode: 'simulated_publish', remote: 'origin' }; },
      auditWriter(file, entry) {
        if (entry.decision === 'bump') throw new Error('simulated audit write failure');
        fs.appendFileSync(file, JSON.stringify(entry) + '\n');
      },
    });
    assert.strictEqual(auditFailureRes.ok, false);
    assert.strictEqual(auditFailureRes.decision, 'rollback');
    assert.strictEqual(auditFailureRes.reason, 'audit_write_failed');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');
    const recovery = recoveryAuditEntries(root);
    assert.strictEqual(recovery[recovery.length - 1].taskId, 'audit-fail-after-publish');
    assert.strictEqual(recovery[recovery.length - 1].reason, 'audit_write_failed');
    const errors = errorLogEntries(root);
    assert(errors.some(entry => entry.subsystem === VersionProgressHook.HOOK_ID
      && entry.reason === 'audit_write_failed'
      && entry.eventId === 'evt-audit-fail-after-publish'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testConcurrentBumps() {
  const root = initRoot();
  try {
    const taskFiles = [];
    for (let i = 0; i < 6; i++) {
      const t = task(root, `concurrent-${i}`, 'fix');
      const file = path.join(root, `task-${i}.json`);
      write(file, JSON.stringify(t));
      taskFiles.push(file);
    }
    await Promise.all(taskFiles.map(file => spawnHook(root, file)));
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.6');
    const bumps = auditEntries(root).filter(e => e.decision === 'bump');
    assert.strictEqual(bumps.length, 6);
    assert.deepStrictEqual(bumps.map(e => e.oldVersion), [
      '0.0.0.0',
      '0.0.0.1',
      '0.0.0.2',
      '0.0.0.3',
      '0.0.0.4',
      '0.0.0.5',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRegistryAndEngineIntegration() {
  const root = initRoot();
  try {
    assert.strictEqual(VersionProgressHook.assertDoneGateContract({ root, workspaceRoot: root }).ok, true);
    const registry = new HookRegistry();
    VersionProgressHook.registerVersionProgressHook(registry, { root, workspaceRoot: root });
    const registered = registry.list('task.true_done').find(hook => hook.id === VersionProgressHook.HOOK_ID);
    assert(registered);
    assert.strictEqual(registered.failureMode, 'block');

    write(path.join(root, 'engine-change.txt'), 'engine\n');
    const flow = {
      id: 'review-loop',
      nodes: [
        { id: 'implement', agent_role: 'worker_code' },
        { id: 'review', agent_role: 'supervisor' },
        { id: 'done', type: 'end' },
      ],
      edges: [
        { from: 'implement', to: 'review' },
        { from: 'review', to: 'done', when: '{{ review.pass == true }}' },
      ],
      guards: { validate_before_run: false, max_loops: 1 },
      acceptance: { require_evidence: false },
    };
    const result = runFlow({
      flow,
      taskId: 'engine-hook',
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: { emit() {} },
      workspaceRoot: root,
      hooks: registry,
      vars: {
        projectId: '控制台',
        goal: '只读分析任务',
        acceptance: '不改任何文件',
        version_progress: { releaseImpact: 'fix' },
      },
      runner(node, ctx) {
        if (node.id === 'implement') {
          return {
            vars: {
              implementation: implementation(['engine-change.txt'], {
                taskId: ctx.taskId,
                specFingerprint: ctx.spec_fingerprint,
              }),
            },
          };
        }
        return { vars: { review: review(['engine-change.txt']) } };
      },
    });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');
    const audit = auditEntries(root);
    assert.strictEqual(audit[audit.length - 1].trueCompletionVerdict.source, 'engine.done_gate+version_hook.recheck');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testHookSelfDoneGateFixture() {
  const gate = DoneGate.validateReviewLoopCompletion({
    id: 'version-hook-self-gate',
    flow: 'review-loop',
    state: 'done',
    vars: {
      goal: '落地版本更新 hook',
      acceptance: 'hook 必须绑定 trueCompletionVerdict、releaseImpact、幂等、并发、失败恢复和自触发保护',
      implementation: implementation([
        'projects/控制台/version-progress-hook.js',
        'tests/version-progress-hook.test.js',
      ]),
      review: review([
        'projects/控制台/version-progress-hook.js',
        'tests/version-progress-hook.test.js',
      ]),
    },
    evidence: [{ type: 'test', path: 'tests/version-progress-hook.test.js' }],
    visits: { implement: 1, review: 1 },
  }, { workspaceRoot: repoRoot, requireDeliveryEvidence: true });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function initGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-hook-git-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'version-hook-bare-'));
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '--bare', '-b', 'main'], bare);
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  git(['config', 'commit.gpgsign', 'false'], root);
  git(['remote', 'add', 'origin', bare], root);
  write(path.join(root, 'VERSION.json'), JSON.stringify({
    schema_version: 1,
    owner_agent: 'it-engineer',
    version: '0.0.0.0',
    updated_at: '2026-06-21T18:53:58.882Z',
    last_change: null,
    parts: VersionManager.PART_LABELS,
  }, null, 2) + '\n');
  write(path.join(root, 'README.md'), 'seed\n');
  git(['add', '-A'], root);
  git(['commit', '-qm', 'seed'], root);
  return { root, bare, git };
}

// P0-B 守卫:真完成 → 默认发布器真 commit 声明文件 + 真 push 到已配置 origin
function testAutoCommitPushToOrigin() {
  const { root, bare, git } = initGitRoot();
  try {
    const res = bump(root, task(root, 'auto-commit', 'fix')); // 无 publisher → 走默认 git 发布器
    assert.strictEqual(res.decision, 'bump');
    assert.strictEqual(res.publishResult.mode, 'auto_commit_push');
    assert.strictEqual(res.publishResult.pushed, true, res.publishResult.pushWarning || 'push 应成功');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.1');
    const head = git(['show', '--stat', '--name-only', 'HEAD'], root).stdout;
    assert(/v0\.0\.0\.1/.test(head), `本地 commit 应带版本号: ${head.split('\n')[4] || head}`);
    assert(/VERSION\.json/.test(head) && /changed-auto-commit\.txt/.test(head), '只提交 VERSION.json + 声明文件');
    const bareLog = git(['log', '--oneline', '-1', 'main'], bare).stdout;
    assert(/v0\.0\.0\.1/.test(bareLog), `origin(bare 远端)应收到推送: ${bareLog}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

// P0-B 安全闸:声明文件含密钥 → 拒绝提交/推送,版本号回滚,暂存区清空
function testPublisherSecretGuardRollsBack() {
  const { root, bare, git } = initGitRoot();
  try {
    write(path.join(root, 'leak.txt'), 'aws AKIA1234567890ABCDEF\n');
    const res = bump(root, task(root, 'leak-task', 'fix', { changedFile: 'leak.txt', writeChanged: false }));
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.decision, 'rollback');
    assert.strictEqual(res.publishResult.reason, 'secret_detected');
    assert.strictEqual(VersionManager.readVersionState(root).version, '0.0.0.0', '版本号必须回滚');
    assert.strictEqual(git(['log', '--oneline'], root).stdout.trim().split('\n').length, 1, '只应有 seed commit、不得提交密钥');
    assert.strictEqual(git(['diff', '--cached', '--name-only'], root).stdout.trim(), '', '暂存区应已清空');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

async function main() {
  await testReleaseImpactAndTrueDone();
  testAutoCommitPushToOrigin();
  testPublisherSecretGuardRollsBack();
  testFalseDoneMissingVerdictAndImpactSkip();
  testOtherProjectMajorApprovalAndSelfTriggerSkip();
  testIdempotencyAndPublishRecovery();
  await testConcurrentBumps();
  testRegistryAndEngineIntegration();
  testHookSelfDoneGateFixture();
  console.log(JSON.stringify({ pass: true, suite: 'version-progress-hook' }));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
