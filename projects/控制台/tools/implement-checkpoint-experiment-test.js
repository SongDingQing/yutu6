#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Checkpoint = require('../implement-checkpoint');

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.strictEqual(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function createRepo(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `console-checkpoint-${label}-`));
  const project = path.join(root, 'projects', '控制台');
  write(path.join(project, 'sample.js'), `'use strict';\nmodule.exports = 1;\n`);
  write(path.join(project, 'status.md'), '# status\n');
  run(root, 'git', ['init', '-q']);
  run(root, 'git', ['add', '.']);
  run(root, 'git', ['-c', 'user.name=Checkpoint Test', '-c', 'user.email=checkpoint@example.invalid', 'commit', '-qm', 'fixture']);
  return { root, project, artifacts: path.join(root, 'runtime-artifacts') };
}

function acceptance() {
  return [
    '验收表协议: structured-acceptance@2',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置 | 备注 |',
    '|---|---|---|---|',
    '| 任务验收: 续跑不覆盖并发变更； | 未完成 | | |',
    '| 任务验收: password=hunter2 必须脱敏； | 未完成 | | |',
    '| 视觉/UI证据: not_applicable | not_applicable | task-envelope:visual_acceptance | source=task_type |',
  ].join('\n');
}

function baseConfig(taskId) {
  return {
    schema: Checkpoint.EXPERIMENT_SCHEMA,
    enabled: true,
    allowAllExperimentTasks: false,
    taskAllowlist: [taskId],
    projectAllowlist: ['控制台'],
    roleAllowlist: ['worker_code'],
    nodeAllowlist: ['implement'],
    maxResume: 1,
    fullRerunFallback: true,
    sampleIntervalMs: 250,
    intervalMs: 1000,
    changeBytesThreshold: 1,
    checkpointTtlMs: 60000,
    lockLeaseMs: 30000,
    maxCumulativeTokens: 180000,
    resumeTokenReserve: 1000,
  };
}

function fixture(label) {
  const repo = createRepo(label);
  const taskId = `task-${label}`;
  const spec = {
    taskId,
    projectId: '控制台',
    spec_fingerprint: `fingerprint-${label}`,
    implementCheckpointExperiment: true,
  };
  const node = { id: 'implement', agent_role: 'worker_code' };
  const ctx = {
    taskId,
    projectId: '控制台',
    scopedToProject: true,
    spec_fingerprint: spec.spec_fingerprint,
    workspaceRoot: repo.root,
    goal: 'long implement Authorization: Basic dXNlcjpwYXNzd29yZA== token=plain-secret-value',
    bounds: '仅修改 projects/控制台；密钥不回显。',
    acceptance: acceptance(),
    inputs: [],
    visual_acceptance: {
      schema: 'visual-acceptance@1',
      acceptance_protocol: 'structured-acceptance@2',
      required: false,
    },
  };
  return {
    repo, taskId, spec, node, ctx,
    opts: {
      config: baseConfig(taskId),
      spec,
      env: {},
      workspaceRoot: repo.root,
      artifactsRoot: repo.artifacts,
      projectRel: 'projects/控制台',
      monitor: false,
    },
  };
}

function readAudit(repo, taskId) {
  const paths = Checkpoint.checkpointPaths(repo.artifacts, taskId);
  return fs.readFileSync(paths.audit, 'utf8').trim().split(/\n/).filter(Boolean).map(line => JSON.parse(line));
}

function readLatestCheckpoint(repo, taskId) {
  const paths = Checkpoint.checkpointPaths(repo.artifacts, taskId);
  const stat = fs.lstatSync(paths.checkpoint);
  const pointer = stat.isSymbolicLink() ? null : JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
  const checkpointPath = stat.isSymbolicLink()
    ? fs.realpathSync(paths.checkpoint)
    : path.resolve(repo.root, pointer.checkpoint_version_path);
  const raw = fs.readFileSync(checkpointPath, 'utf8');
  return { paths, pointer, checkpointPath, raw, checkpoint: JSON.parse(raw) };
}

function cleanup(item) {
  fs.rmSync(item.repo.root, { recursive: true, force: true });
}

function testFeatureFlag() {
  const configPath = path.resolve(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')).implementCheckpointExperiment;
  assert.strictEqual(config.enabled, false, 'production/default config must remain disabled');
  assert.strictEqual(config.maxResume, 1);
  assert.strictEqual(config.maxIoOverheadRatio, 0.05);
  assert.match(config.promotionGate, /owner approval/i);
  const node = { id: 'implement', agent_role: 'worker_code' };
  const spec = { taskId: 'scoped', projectId: '控制台', implementCheckpointExperiment: true };
  assert.strictEqual(Checkpoint.experimentDecision(config, spec, node, {}).enabled, false);
  assert.strictEqual(Checkpoint.experimentDecision(config, spec, node, { CONSOLE_IMPLEMENT_CHECKPOINT_EXPERIMENT: '1' }).enabled, true);
  assert.strictEqual(Checkpoint.experimentDecision(Object.assign({}, config, { enabled: true }), spec, node, { CONSOLE_IMPLEMENT_CHECKPOINT_EXPERIMENT: '0' }).enabled, false);
  assert.strictEqual(Checkpoint.experimentDecision(Object.assign({}, config, { enabled: true }), Object.assign({}, spec, { implementCheckpointExperiment: false }), node, {}).enabled, false);
  const unapprovedGlobal = Object.assign({}, config, { enabled: true, allowAllExperimentTasks: true });
  assert.strictEqual(
    Checkpoint.experimentDecision(unapprovedGlobal, Object.assign({}, spec, { implementCheckpointExperiment: false }), node, {}).reason,
    'owner_promotion_approval_required',
  );
  return { default_enabled: false, explicit_scope_required: true, env_rollback: true };
}

function testNormalResume() {
  const item = fixture('normal-resume');
  const calls = [];
  const decisions = [];
  try {
    assert.deepStrictEqual(
      Checkpoint.experimentDecision(item.opts.config, item.spec, item.node, item.opts.env),
      { enabled: true, reason: 'scoped_experiment' },
    );
    const probe = Checkpoint.makeSession(item.opts, item.node, item.ctx);
    assert(probe.ok, `session probe failed: ${JSON.stringify(probe)}`);
    const probeRelease = Checkpoint.releaseWorktreeLease(probe.session.lock_dir, probe.session.lock_lease);
    assert(probeRelease.ok && !fs.existsSync(probe.session.lock_dir), `session probe release failed: ${JSON.stringify(probeRelease)}`);
    const base = (node, ctx, attempt) => {
      calls.push({ role: node.agent_role, ctx, attempt });
      if (calls.length === 1) {
        fs.appendFileSync(path.join(item.repo.project, 'sample.js'), '// first attempt landed\n');
        write(path.join(item.repo.project, 'artifacts', 'worker-deliverable.md'), '# checkpoint deliverable\n');
        return {
          fail: 'codex 运行超时(1800s)',
          vars: {
            implementation: {
              acceptance_table: [{
                point: '任务验收: 续跑不覆盖并发变更；',
                status: '完成',
                evidence: 'node tests/checkpoint-progress.test.js exit 0',
              }],
              logic_chain: {
                tests: [{
                  command: 'node tests/checkpoint-progress.test.js',
                  exit_code: 0,
                  summary: 'first attempt validation passed',
                }],
              },
            },
          },
        };
      }
      assert(ctx.checkpoint_resume, 'second call must be checkpoint resume');
      assert.strictEqual(node.agent_role, 'worker_code');
      assert.strictEqual(ctx.inputs.length, 1);
      assert(!ctx.goal.includes('plain-secret-value'));
      assert.match(ctx.inputs[0], /\/versions\//, 'resume must reference an immutable versioned checkpoint');
      const selectedCheckpointPath = path.resolve(item.repo.root, ctx.inputs[0]);
      const selectedCheckpointBytes = fs.readFileSync(selectedCheckpointPath);
      assert.strictEqual(
        crypto.createHash('sha256').update(selectedCheckpointBytes).digest('hex'),
        ctx.checkpoint_resume.file_sha256,
        'resume file hash must bind the exact immutable checkpoint bytes',
      );
      const progressCheckpoint = JSON.parse(selectedCheckpointBytes.toString('utf8'));
      assert.strictEqual(progressCheckpoint.integrity.digest, ctx.checkpoint_resume.integrity_sha256,
        'resume integrity must match the same checkpoint file read by the runner');
      assert.strictEqual(progressCheckpoint.validations.length, 1, 'first failed attempt validation must be checkpointed');
      assert.strictEqual(progressCheckpoint.validations[0].command, 'node tests/checkpoint-progress.test.js');
      assert(!progressCheckpoint.remaining_acceptance.some(row => row.point === '任务验收: 续跑不覆盖并发变更；'),
        'completed acceptance from first failed attempt must not remain pending');
      return { vars: { implementation: { done: true } }, evidence: { type: 'result', path: 'result.md' } };
    };
    item.opts.onExperimentDecision = value => decisions.push(value);
    const runner = Checkpoint.makeImplementCheckpointRunner(base, item.opts);
    const result = runner(item.node, item.ctx, 1);
    assert(!result.fail, `normal resume failed: calls=${calls.length} decisions=${JSON.stringify(decisions)} ${JSON.stringify(result)}`);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].role, calls[1].role, 'resume must retain agent role');
    const latest = readLatestCheckpoint(item.repo, item.taskId);
    const raw = latest.raw;
    assert(!raw.includes('hunter2'));
    assert(!raw.includes('plain-secret-value'));
    assert(!raw.includes('dXNlcjpwYXNzd29yZA=='));
    const checkpoint = latest.checkpoint;
    assert.strictEqual(checkpoint.schema_version, Checkpoint.CHECKPOINT_SCHEMA);
    assert(checkpoint.changed_files.includes('projects/控制台/sample.js'));
    assert(checkpoint.changed_files.includes('projects/控制台/artifacts/worker-deliverable.md'),
      'project artifact deliverables must remain visible in checkpoint audit metadata');
    assert(checkpoint.content_hashes['projects/控制台/artifacts/worker-deliverable.md'].sha256,
      'project artifact deliverables must participate in per-file content hashing');
    assert.strictEqual(checkpoint.resume.count, 1);
    assert.strictEqual(checkpoint.resume.max_resume, 1);
    assert(checkpoint.content_hashes['projects/控制台/sample.js'].sha256);
    assert(checkpoint.acceptance_snapshot.items.every(entry => entry.id && entry.version_hash));
    assert(checkpoint.lock_lease.lock_id && checkpoint.cumulative_token_budget.limit);
    const audit = readAudit(item.repo, item.taskId);
    assert(audit.some(entry => entry.event === 'resume_decision' && entry.decision === 'resume'));
    assert(audit.some(entry => entry.event === 'checkpoint_write'
      && Array.isArray(entry.changed_files)
      && Array.isArray(entry.validations)
      && Array.isArray(entry.remaining_acceptance)));
    const selectedCheckpointPath = path.resolve(item.repo.root, calls[1].ctx.inputs[0]);
    assert.strictEqual(
      crypto.createHash('sha256').update(fs.readFileSync(selectedCheckpointPath)).digest('hex'),
      calls[1].ctx.checkpoint_resume.file_sha256,
      'later checkpoint writes must not mutate the selected resume version',
    );
    return {
      calls: calls.length,
      role: calls[1].role,
      checkpoint_writes: audit.filter(entry => entry.event === 'checkpoint_write').length,
      audit_events: [...new Set(audit.map(entry => entry.event))].sort(),
      captured_validation_count: checkpoint.validations.length,
      remaining_acceptance_count: checkpoint.remaining_acceptance.length,
      plaintext_secrets_persisted: false,
    };
  } finally {
    cleanup(item);
  }
}

function testArtifactConflictFallback() {
  const item = fixture('artifact-conflict');
  const calls = [];
  try {
    item.opts.beforeResumeValidation = () => {
      write(path.join(item.repo.project, 'artifacts', 'concurrent-deliverable.md'), '# concurrent artifact change\n');
    };
    const base = (node, ctx) => {
      calls.push(ctx);
      if (calls.length === 1) {
        fs.appendFileSync(path.join(item.repo.project, 'sample.js'), '// first attempt\n');
        return { fail: 'spawn codex failed: ENOBUFS' };
      }
      assert(ctx.checkpoint_full_rerun, 'concurrent artifact change must force a full rerun');
      assert(!ctx.checkpoint_resume, 'concurrent artifact change must never resume');
      assert(fs.existsSync(path.join(item.repo.project, 'artifacts', 'concurrent-deliverable.md')),
        'full rerun must preserve the concurrent artifact change');
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail, `artifact-conflict fallback failed: ${JSON.stringify(result)}`);
    assert.strictEqual(calls.length, 2);
    const rollback = readAudit(item.repo, item.taskId).find(entry => entry.event === 'rollback_decision');
    assert(rollback && rollback.decision === 'full_rerun');
    assert.strictEqual(rollback.reason, 'worktree_state_mismatch');
    return { fallback: rollback.reason, concurrent_artifact_preserved: true, restored_files: 0 };
  } finally {
    cleanup(item);
  }
}

function testStaleConflictFallback() {
  const item = fixture('stale-conflict');
  const calls = [];
  try {
    item.opts.beforeResumeValidation = session => {
      fs.appendFileSync(path.join(item.repo.project, 'sample.js'), '// external concurrent change\n');
      session.concurrent_probe = true;
    };
    const base = (node, ctx, attempt) => {
      calls.push({ ctx, attempt });
      if (calls.length === 1) {
        fs.appendFileSync(path.join(item.repo.project, 'sample.js'), '// first attempt\n');
        return { fail: 'spawn codex failed: ENOBUFS' };
      }
      assert(ctx.checkpoint_full_rerun, 'stale checkpoint must select full rerun');
      assert(!ctx.checkpoint_resume, 'stale checkpoint must not resume');
      assert(fs.readFileSync(path.join(item.repo.project, 'sample.js'), 'utf8').includes('external concurrent change'));
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail, `runtime-error fallback failed: ${JSON.stringify(result)}`);
    assert.strictEqual(calls.length, 2);
    const audit = readAudit(item.repo, item.taskId);
    const rollback = audit.find(entry => entry.event === 'rollback_decision');
    assert(rollback && rollback.decision === 'full_rerun');
    assert.strictEqual(rollback.reason, 'worktree_state_mismatch');
    assert.strictEqual(rollback.checkpoint_restored_files, 0);
    return { fallback: rollback.reason, concurrent_change_preserved: true, restored_files: 0 };
  } finally {
    cleanup(item);
  }
}

function testCorruptCheckpointFallback() {
  const item = fixture('corrupt-checkpoint');
  const calls = [];
  try {
    item.opts.beforeResumeValidation = session => {
      const selected = session.latest_checkpoint_version_path || session.paths.checkpoint;
      try { fs.chmodSync(selected, 0o600); } catch (_) {}
      fs.writeFileSync(selected, '{"half":');
    };
    const base = (node, ctx) => {
      calls.push(ctx);
      if (calls.length === 1) return { fail: 'codex timeout' };
      assert(ctx.checkpoint_full_rerun);
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail);
    assert.strictEqual(calls.length, 2);
    const rollback = readAudit(item.repo, item.taskId).find(entry => entry.event === 'rollback_decision');
    assert.strictEqual(rollback.reason, 'checkpoint_corrupt_or_half_written');
    return { fallback: rollback.reason };
  } finally {
    cleanup(item);
  }
}

function testSelectedCheckpointTamperFallback() {
  const item = fixture('selected-checkpoint-tamper');
  const calls = [];
  try {
    item.opts.beforeResumeDispatch = (session, validation) => {
      const tampered = Object.assign({}, validation.checkpoint, { unexpected_mutation: true });
      fs.chmodSync(validation.checkpoint_path, 0o600);
      fs.writeFileSync(validation.checkpoint_path, `${JSON.stringify(tampered)}\n`);
    };
    const base = (node, ctx) => {
      calls.push(ctx);
      if (calls.length === 1) return { fail: 'spawn codex failed: ENOBUFS' };
      assert(ctx.checkpoint_full_rerun, 'dispatch-time checkpoint mutation must force full rerun');
      assert(!ctx.checkpoint_resume, 'mutated selected checkpoint must not reach resume runner');
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail, `selected checkpoint tamper fallback failed: ${JSON.stringify(result)}`);
    assert.strictEqual(calls.length, 2);
    const rollback = readAudit(item.repo, item.taskId).find(entry => entry.event === 'rollback_decision');
    assert(rollback && rollback.reason === 'checkpoint_selected_file_digest_mismatch');
    return { fallback: rollback.reason, resume_runner_calls: 0, restored_files: 0 };
  } finally {
    cleanup(item);
  }
}

function testRuntimeErrorFallbackRenewsLease() {
  const item = fixture('runtime-error-fallback-lease');
  const calls = [];
  let contenderAcquired = false;
  try {
    item.opts.monitor = true;
    item.opts.config.lockLeaseMs = 3000;
    item.opts.config.sampleIntervalMs = 250;
    item.opts.beforeResumeValidation = () => {
      throw new Error('forced checkpoint runtime failure');
    };
    const base = (node, ctx) => {
      calls.push(ctx);
      if (calls.length === 1) return { fail: 'codex timeout' };
      assert(ctx.checkpoint_full_rerun, 'runtime error must enter the full-rerun fallback');
      sleepSync(4200);
      const contender = Checkpoint.acquireWorktreeLease({
        locksRoot: path.join(item.repo.artifacts, 'implement-checkpoints', 'locks'),
        identity: Checkpoint._test.worktreeIdentity(item.repo.root),
        taskId: `${item.taskId}-contender`,
        role: 'worker_code',
        ttlMs: 30000,
      });
      contenderAcquired = contender.ok;
      if (contender.ok) Checkpoint.releaseWorktreeLease(contender.lock_dir, contender.lease);
      assert.strictEqual(contender.ok, false,
        'runtime-error fallback must keep renewing the task-worktree lease while the runner is active');
      assert.strictEqual(contender.reason, 'worktree_lock_conflict');
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail, `runtime-error fallback failed: ${JSON.stringify(result)}`);
    assert.strictEqual(calls.length, 2);
    const audit = readAudit(item.repo, item.taskId);
    assert(audit.some(entry => entry.event === 'rollback_decision'
      && String(entry.reason).startsWith('checkpoint_runtime_error:')));
    return { runner_calls: calls.length, contender_acquired_while_fallback_running: contenderAcquired };
  } finally {
    cleanup(item);
  }
}

function testAtomicTmpAndIntegrity() {
  const item = fixture('atomic-integrity');
  let session = null;
  try {
    const made = Checkpoint.makeSession(item.opts, item.node, item.ctx);
    assert(made.ok);
    session = made.session;
    Checkpoint.writeCheckpoint(session, 'test');
    write(`${session.paths.checkpoint}.partial.tmp`, '{broken');
    const orphanValidation = Checkpoint.validateCheckpoint(session);
    assert.strictEqual(orphanValidation.ok, true,
      `orphan tmp must not affect atomic final file: ${JSON.stringify(orphanValidation)}`);
    let latest = readLatestCheckpoint(item.repo, item.taskId);
    let checkpoint = latest.checkpoint;
    delete checkpoint.content_hashes;
    checkpoint.integrity.digest = crypto.createHash('sha256')
      .update(Checkpoint._test.canonical(Checkpoint._test.checkpointWithoutIntegrity(checkpoint)))
      .digest('hex');
    fs.chmodSync(latest.checkpointPath, 0o600);
    fs.writeFileSync(latest.checkpointPath, JSON.stringify(checkpoint));
    assert.strictEqual(
      Checkpoint.validateCheckpoint(session, { checkpointPath: latest.checkpointPath }).reason,
      'checkpoint_required_field_missing:content_hashes',
      'missing required content_hashes must fail closed even when integrity is recomputed',
    );
    Checkpoint.writeCheckpoint(session, 'restore-valid');
    latest = readLatestCheckpoint(item.repo, item.taskId);
    checkpoint = latest.checkpoint;
    checkpoint.changed_files.push('projects/控制台/injected.js');
    fs.chmodSync(latest.checkpointPath, 0o600);
    fs.writeFileSync(latest.checkpointPath, JSON.stringify(checkpoint));
    assert.strictEqual(
      Checkpoint.validateCheckpoint(session, { checkpointPath: latest.checkpointPath }).reason,
      'checkpoint_integrity_mismatch',
    );
    return { orphan_tmp_ignored: true, missing_required_field_rejected: true, tamper_rejected: true };
  } finally {
    if (session) Checkpoint.releaseWorktreeLease(session.lock_dir, session.lock_lease);
    cleanup(item);
  }
}

function testLiveLockConflictRejectsRunner() {
  const item = fixture('live-lock-conflict');
  let ownerSession = null;
  try {
    const owner = Checkpoint.makeSession(item.opts, item.node, item.ctx);
    assert(owner.ok);
    ownerSession = owner.session;
    const contenderTaskId = `${item.taskId}-contender`;
    const contenderSpec = Object.assign({}, item.spec, { taskId: contenderTaskId });
    const contenderCtx = Object.assign({}, item.ctx, { taskId: contenderTaskId });
    const contenderOpts = Object.assign({}, item.opts, {
      spec: contenderSpec,
      config: Object.assign({}, item.opts.config, {
        taskAllowlist: [contenderTaskId],
        lockWaitMs: 50,
        lockPollMs: 10,
      }),
    });
    let runnerCalls = 0;
    const result = Checkpoint.makeImplementCheckpointRunner(() => {
      runnerCalls += 1;
      return { vars: { implementation: { done: true } } };
    }, contenderOpts)(item.node, contenderCtx, 1);
    assert(result.fail, 'contender must defer instead of running without the worktree lease');
    assert.strictEqual(runnerCalls, 0, 'base runner must not run while another live lease owns the worktree');
    assert.strictEqual(Checkpoint.validateWorktreeLease(ownerSession.lock_dir, ownerSession.lock_lease).ok, true);
    const audit = readAudit(item.repo, contenderTaskId);
    assert(audit.some(entry => entry.event === 'rollback_decision'
      && entry.decision === 'defer_full_rerun'
      && entry.reason === 'worktree_lock_conflict'));
    return { contender_runner_calls: runnerCalls, owner_lease_preserved: true, decision: 'defer_full_rerun' };
  } finally {
    if (ownerSession) Checkpoint.releaseWorktreeLease(ownerSession.lock_dir, ownerSession.lock_lease);
    cleanup(item);
  }
}

function testLostLeaseDefersFallback() {
  const item = fixture('lost-lease-defers-fallback');
  const calls = [];
  try {
    item.opts.beforeResumeValidation = session => {
      fs.rmSync(session.lock_dir, { recursive: true, force: true });
    };
    const base = (node, ctx) => {
      calls.push(ctx);
      if (calls.length === 1) return { fail: 'codex timeout' };
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(result.fail && result.checkpoint_deferred,
      'lost lease must defer the fallback instead of running without mutual exclusion');
    assert.strictEqual(calls.length, 1, 'full fallback runner must not start after the lease is lost');
    const audit = readAudit(item.repo, item.taskId);
    assert(audit.some(entry => entry.event === 'rollback_decision'
      && entry.decision === 'defer_full_rerun'
      && entry.reason === 'lock_lease_missing'));
    return { runner_calls: calls.length, decision: 'defer_full_rerun', reason: 'lock_lease_missing' };
  } finally {
    cleanup(item);
  }
}

function testExpiredLockRelease() {
  const item = fixture('expired-lock');
  try {
    const identity = Checkpoint._test.worktreeIdentity(item.repo.root);
    const locksRoot = path.join(item.repo.artifacts, 'locks');
    const baseNow = Date.now();
    const first = Checkpoint.acquireWorktreeLease({
      locksRoot, identity, taskId: 'old', role: 'worker_code', ttlMs: 20, now: baseNow,
    });
    assert(first.ok);
    const second = Checkpoint.acquireWorktreeLease({
      locksRoot, identity, taskId: 'new', role: 'worker_code', ttlMs: 30000, now: baseNow + 1000,
    });
    assert(second.ok);
    assert(second.swept.some(entry => entry.reason === 'lease_expired'));
    assert.strictEqual(second.lease.owner_task_id, 'new');
    Checkpoint.releaseWorktreeLease(second.lock_dir, second.lease);
    return { expired_swept: true, new_owner: second.lease.owner_task_id };
  } finally {
    cleanup(item);
  }
}

function testResumeFailureFullRerun() {
  const item = fixture('resume-failure-full-rerun');
  const calls = [];
  try {
    const base = (node, ctx, attempt) => {
      calls.push({ ctx, attempt });
      if (calls.length === 1) return { fail: 'codex timeout' };
      if (calls.length === 2) {
        assert(ctx.checkpoint_resume);
        return { fail: 'codex timeout during resume' };
      }
      assert(ctx.checkpoint_full_rerun);
      return { vars: { implementation: { done: true } } };
    };
    const result = Checkpoint.makeImplementCheckpointRunner(base, item.opts)(item.node, item.ctx, 1);
    assert(!result.fail);
    assert.strictEqual(calls.length, 3);
    const rollback = readAudit(item.repo, item.taskId).find(entry => entry.event === 'rollback_decision');
    assert(rollback && rollback.reason === 'resume_failed');
    return { initial_runs: 1, resumes: 1, full_reruns: 1 };
  } finally {
    cleanup(item);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function testExternalPeriodicMonitor() {
  const item = fixture('external-monitor');
  let session = null;
  let child = null;
  try {
    const made = Checkpoint.makeSession(item.opts, item.node, item.ctx);
    assert(made.ok);
    session = made.session;
    Checkpoint.writeCheckpoint(session, 'initial');
    child = Checkpoint.startMonitor(session, { monitor: true });
    fs.appendFileSync(path.join(item.repo.project, 'sample.js'), '// monitored change\n');
    sleepSync(900);
    Checkpoint.stopMonitor(child);
    child = null;
    const audit = readAudit(item.repo, item.taskId);
    assert(audit.some(entry => entry.event === 'checkpoint_write' && entry.reason === 'change_threshold'));
    const checkpoint = readLatestCheckpoint(item.repo, item.taskId).checkpoint;
    assert(checkpoint.changed_files.includes('projects/控制台/sample.js'));
    return {
      child_process_checkpoint: true,
      policy: checkpoint.checkpoint_io.policy,
      write_reason: checkpoint.checkpoint_io.reason,
    };
  } finally {
    if (child) Checkpoint.stopMonitor(child);
    if (session) Checkpoint.releaseWorktreeLease(session.lock_dir, session.lock_lease);
    cleanup(item);
  }
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function testIoMetrics() {
  const item = fixture('io-metrics');
  let session = null;
  try {
    const made = Checkpoint.makeSession(item.opts, item.node, item.ctx);
    assert(made.ok);
    session = made.session;
    const durations = [];
    const cycleWallDurations = [];
    let totalBytes = 0;
    for (let i = 0; i < 12; i += 1) {
      fs.appendFileSync(path.join(item.repo.project, 'sample.js'), `// io-${i}\n`);
      const cycleStarted = process.hrtime.bigint();
      const result = Checkpoint.writeCheckpoint(session, i === 0 ? 'initial' : 'change_threshold');
      cycleWallDurations.push(Number(process.hrtime.bigint() - cycleStarted) / 1e6);
      durations.push(result.write.duration_ms);
      totalBytes += result.write.bytes;
    }
    const state = { last_write_at: Date.now(), last_changed_bytes: 0 };
    session.interval_ms = 60000;
    session.change_bytes_threshold = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 3; i += 1) {
      const cycleStarted = process.hrtime.bigint();
      Checkpoint.monitorOnce(session, state);
      cycleWallDurations.push(Number(process.hrtime.bigint() - cycleStarted) / 1e6);
    }
    const metrics = JSON.parse(fs.readFileSync(session.paths.metrics, 'utf8'));
    const p95 = percentile(durations, 0.95);
    const observedCycles = Number(metrics.write_count || 0) + Number(metrics.no_write_sample_count || 0);
    const budgetMs = observedCycles * 1000;
    const measuredOverheadMs = cycleWallDurations.reduce((sum, value) => sum + value, 0);
    const overheadRatio = measuredOverheadMs / budgetMs;
    assert.strictEqual(metrics.write_count, 12);
    assert.strictEqual(metrics.no_write_sample_count, 3, 'no-write monitor samples must be persisted');
    assert.strictEqual(metrics.snapshot_scan_count, 16, 'session baseline plus every write/no-write snapshot scan must be counted');
    assert(p95 < 250, `checkpoint write p95 ${p95}ms exceeded 250ms experiment gate`);
    assert(overheadRatio < 0.05, `checkpoint scan+write overhead ratio ${overheadRatio} exceeded 5%`);
    return {
      writes: metrics.write_count,
      total_bytes: totalBytes,
      median_write_ms: percentile(durations, 0.5),
      p95_write_ms: p95,
      max_write_ms: metrics.max_write_duration_ms,
      p95_full_cycle_wall_ms: percentile(cycleWallDurations, 0.95),
      total_full_cycle_wall_ms: measuredOverheadMs,
      total_write_ms: metrics.total_write_duration_ms,
      total_scan_ms: metrics.total_scan_duration_ms,
      no_write_samples: metrics.no_write_sample_count,
      snapshot_scans: metrics.snapshot_scan_count,
      interval_budget_ms: budgetMs,
      scan_plus_write_overhead_ratio: overheadRatio,
      gate: 'p95 checkpoint write <250ms and full checkpoint/no-write cycles including metrics+audit persistence <5% of cycle budget',
    };
  } finally {
    if (session) Checkpoint.releaseWorktreeLease(session.lock_dir, session.lock_lease);
    cleanup(item);
  }
}

function testRealControlConsoleIo() {
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-checkpoint-real-io-'));
  const taskId = 'real-control-console-io-probe';
  const config = Object.assign({}, baseConfig(taskId), {
    sampleIntervalMs: 5000,
    intervalMs: 60000,
    changeBytesThreshold: Number.MAX_SAFE_INTEGER,
    lockLeaseMs: 120000,
  });
  const spec = {
    taskId,
    projectId: '控制台',
    spec_fingerprint: 'real-control-console-io-probe-v1',
    implementCheckpointExperiment: true,
  };
  const node = { id: 'implement', agent_role: 'worker_code' };
  const ctx = {
    taskId,
    projectId: '控制台',
    spec_fingerprint: spec.spec_fingerprint,
    workspaceRoot,
    goal: '只读真实控制台 dirty worktree I/O 规模探针',
    bounds: '只读项目文件；checkpoint 仅写临时目录。',
    acceptance: acceptance(),
  };
  const opts = {
    config,
    spec,
    env: {},
    workspaceRoot,
    artifactsRoot,
    projectRel: 'projects/控制台',
    monitor: false,
  };
  let session = null;
  try {
    const steadyCycleWallDurations = [];
    const steadyScanDurations = [];
    const effectiveSampleIntervals = [];
    const setupStarted = process.hrtime.bigint();
    const made = Checkpoint.makeSession(opts, node, ctx);
    const setupWallMs = Number(process.hrtime.bigint() - setupStarted) / 1e6;
    assert(made.ok, `real control console I/O session failed: ${JSON.stringify(made)}`);
    session = made.session;
    const writeStarted = process.hrtime.bigint();
    const first = Checkpoint.writeCheckpoint(session, 'real_worktree_probe');
    steadyCycleWallDurations.push(Number(process.hrtime.bigint() - writeStarted) / 1e6);
    steadyScanDurations.push(Number(first.checkpoint.checkpoint_io.snapshot_scan_duration_ms || 0));
    effectiveSampleIntervals.push(Number(session.sample_interval_ms));
    const state = { last_write_at: Date.now(), last_changed_bytes: 0 };
    for (let i = 0; i < 4; i += 1) {
      const sampleStarted = process.hrtime.bigint();
      const sampled = Checkpoint.monitorOnce(session, state);
      steadyCycleWallDurations.push(Number(process.hrtime.bigint() - sampleStarted) / 1e6);
      steadyScanDurations.push(Number(sampled.metrics.last_scan_duration_ms || 0));
      effectiveSampleIntervals.push(Number(session.sample_interval_ms));
      assert.strictEqual(sampled.wrote, false, 'unchanged real-worktree probe should exercise no-write sampling');
    }
    const metrics = JSON.parse(fs.readFileSync(session.paths.metrics, 'utf8'));
    const dirtyFiles = Object.keys(first.checkpoint.content_hashes).length;
    const dirtyBytes = Object.values(first.checkpoint.content_hashes)
      .reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
    const initialLongNodeBudgetMs = 30 * 60 * 1000;
    const initialSetupRatio = setupWallMs / initialLongNodeBudgetMs;
    const intervalBudgetMs = effectiveSampleIntervals.reduce((sum, value) => sum + value, 0);
    const measuredIoMs = steadyCycleWallDurations.reduce((sum, value) => sum + value, 0);
    const overheadRatio = measuredIoMs / intervalBudgetMs;
    assert(dirtyFiles >= 100, `real control console probe unexpectedly small: ${dirtyFiles} dirty files`);
    assert(metrics.no_write_sample_count >= 4);
    assert(setupWallMs < 10000,
      `real control console initial full hash ${setupWallMs}ms exceeded 10000ms gate`);
    assert(initialSetupRatio < 0.01,
      `real control console initial full hash ratio ${initialSetupRatio} exceeded 1% of long-node budget`);
    assert(Math.max(...steadyScanDurations) < 1000,
      `real control console steady-state snapshot max ${Math.max(...steadyScanDurations)}ms exceeded 1000ms gate`);
    assert(overheadRatio < 0.05,
      `real control console scan+write overhead ratio ${overheadRatio} exceeded 5%`);
    return {
      workspace: 'projects/控制台',
      dirty_files: dirtyFiles,
      dirty_bytes: dirtyBytes,
      snapshot_scans: metrics.snapshot_scan_count,
      no_write_samples: metrics.no_write_sample_count,
      checkpoint_writes: metrics.write_count,
      checkpoint_bytes: first.write.bytes,
      initial_setup_wall_ms: setupWallMs,
      initial_setup_hashed_files: session.baseline.hashed_file_count,
      initial_setup_hashed_bytes: session.baseline.hashed_bytes,
      initial_long_node_budget_ms: initialLongNodeBudgetMs,
      initial_setup_overhead_ratio: initialSetupRatio,
      configured_sample_interval_ms: config.sampleIntervalMs,
      effective_sample_interval_ms: session.sample_interval_ms,
      total_scan_ms: metrics.total_scan_duration_ms,
      max_scan_ms: metrics.max_scan_duration_ms,
      max_steady_scan_ms: Math.max(...steadyScanDurations),
      total_checkpoint_write_ms: metrics.total_write_duration_ms,
      p95_full_cycle_wall_ms: percentile(steadyCycleWallDurations, 0.95),
      total_full_cycle_wall_ms: measuredIoMs,
      interval_budget_ms: intervalBudgetMs,
      scan_plus_write_overhead_ratio: overheadRatio,
      gate: 'initial full hash <10000ms and <1% of a 30-minute implement budget; steady cached scans <1000ms and full checkpoint/no-write cycles including metrics+audit persistence <5% of the dynamically tuned sample budget',
    };
  } finally {
    if (session) Checkpoint.releaseWorktreeLease(session.lock_dir, session.lock_lease);
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
}

function reportPath() {
  const index = process.argv.indexOf('--report');
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : null;
}

function main() {
  const started = Date.now();
  const results = {
    schema: 'implement-checkpoint-experiment-report@1',
    generated_at: new Date().toISOString(),
    feature_flag: testFeatureFlag(),
    scenarios: {
      normal_resume: testNormalResume(),
      stale_conflict_fallback: testStaleConflictFallback(),
      artifact_conflict_fallback: testArtifactConflictFallback(),
      corrupt_checkpoint_fallback: testCorruptCheckpointFallback(),
      selected_checkpoint_tamper_fallback: testSelectedCheckpointTamperFallback(),
      atomic_integrity: testAtomicTmpAndIntegrity(),
      expired_lock_release: testExpiredLockRelease(),
      live_lock_conflict_rejects_runner: testLiveLockConflictRejectsRunner(),
      lost_lease_defers_fallback: testLostLeaseDefersFallback(),
      resume_failure_full_rerun: testResumeFailureFullRerun(),
      runtime_error_fallback_renews_lease: testRuntimeErrorFallbackRenewsLease(),
      external_periodic_monitor: testExternalPeriodicMonitor(),
    },
    required_audit_event_types: ['checkpoint_write', 'resume_decision', 'rollback_decision'],
    io_metrics: testIoMetrics(),
    real_control_console_io: testRealControlConsoleIo(),
    duration_ms: Date.now() - started,
    verdict: 'pass',
  };
  const target = reportPath();
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(results, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main();
