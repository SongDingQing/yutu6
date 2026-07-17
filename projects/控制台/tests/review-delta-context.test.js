#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.YUTU6_KB_INJECT = '0';
process.env.YUTU6_HANDOFF_MODE = 'off';

const AcceptanceContract = require('../../../shared/engine/acceptance-contract');
const InteractionTrace = require('../../../shared/engine/interaction-trace');
const { makeCliRunner, buildEnvelope } = require('../../../shared/engine/cli-runner');
const ReviewDeltaContext = require('../review-delta-context');

const TASK_ID = 'review-delta-fixture';
const SPEC_FINGERPRINT = '5b317aff06ac23b5df35ef64f395c66d268d61c86316965192eade2d4929162b';

function activeConfig() {
  return {
    enabled: true,
    shadowEnabled: false,
    promotionApproval: {
      status: 'approved',
      supervisorReviewed: true,
      ownerApproved: true,
    },
  };
}

function parsePromptContext(prompt, label) {
  const prefix = `- ${label}:`;
  const line = prompt.split(/\r?\n/).find(item => item.startsWith(prefix));
  assert(line, `missing prompt label ${label}`);
  return JSON.parse(line.slice(prefix.length));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readAudit(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-delta-context-'));
  try {
    const projectRoot = path.join(root, 'projects/控制台');
    const runsDir = path.join(projectRoot, 'artifacts/engine-runs', TASK_ID);
    const proofFile = path.join(projectRoot, 'fixture-proof.txt');
    fs.mkdirSync(path.dirname(proofFile), { recursive: true });
    fs.writeFileSync(proofFile, 'deterministic fixture proof\n');

    const contract = AcceptanceContract.createContract([
      { text: 'artifact ref 失败时必须自动回退脱敏全文。' },
      { text: '每轮 review 必须复核全量验收行。' },
    ], {
      scope: 'project/控制台',
      sourceRef: 'orchestrator:review-delta-fixture',
      projectId: '控制台',
      rootTaskId: TASK_ID,
    });
    const requiredRows = AcceptanceContract.acceptanceRows(contract);
    const rowsFile = path.join(root, 'required-rows.json');
    fs.writeFileSync(rowsFile, JSON.stringify(requiredRows));
    const ctx = {
      workspaceRoot: root,
      taskId: TASK_ID,
      projectId: '控制台',
      scopedToProject: true,
      goal: 'verify differential review context without losing acceptance coverage',
      spec_fingerprint: SPEC_FINGERPRINT,
      acceptance: 'structured fixture acceptance',
      acceptance_contract: contract,
      requiredRows,
      loop_engineering: { enabled: true, standards: requiredRows },
      inputs: [],
    };
    const controller = ReviewDeltaContext.create({
      config: activeConfig(),
      env: {},
      workspaceRoot: root,
      projectRoot,
      runsDir,
      taskId: TASK_ID,
      projectId: '控制台',
    });
    const mock = path.resolve(__dirname, 'fixtures/review-delta-context/mock-runner.js');
    const runner = makeCliRunner({
      runners: {
        mock: {
          cmd: [process.execPath, mock],
          promptVia: 'stdin',
          env: {
            REVIEW_DELTA_ROWS_FILE: rowsFile,
            REVIEW_DELTA_TASK_ID: TASK_ID,
            REVIEW_DELTA_SPEC_FINGERPRINT: SPEC_FINGERPRINT,
          },
        },
      },
      roleMap: { worker_code: 'mock', supervisor: 'mock' },
      workdir: root,
      runsDir,
      nodeTimeoutSec: 5,
      taskId: TASK_ID,
      projectId: '控制台',
      reviewDeltaContext: controller,
    });

    const first = runner({ id: 'implement', agent_role: 'worker_code' }, ctx, 1);
    assert(!first.fail, first.fail || 'first implementation failed');
    assert(ctx.review_delta_state, 'first result must create versioned delta state');

    const review = runner({ id: 'review', agent_role: 'supervisor' }, ctx, 1);
    assert(!review.fail, review.fail || 'review result capture failed');
    assert.strictEqual(review.vars.review.pass, false, 'negative review remains a valid review result');
    const reviewPrompt = fs.readFileSync(path.join(runsDir, 'review-1/task.redacted.md'), 'utf8');
    assert.match(reviewPrompt, /上一步差量上下文\(供参考\)/);
    assert.match(reviewPrompt, /evaluation\.gaps 的每个结构化条目也必须逐项原样进入 improvement_points/);
    const reviewDelta = parsePromptContext(reviewPrompt, '上一步差量上下文(供参考)');
    assert.strictEqual(reviewDelta.requiredRows.length, requiredRows.length, 'review must receive every required row');
    assert.deepStrictEqual(reviewDelta.requiredRows.map(row => row.acceptance_id), requiredRows.map(row => row.acceptance_id));
    assert.strictEqual(reviewDelta.goal_sha256, ReviewDeltaContext.goalHash(ctx));
    assert.strictEqual(reviewDelta.spec_fingerprint, SPEC_FINGERPRINT);

    const second = runner({ id: 'implement', agent_role: 'worker_code' }, ctx, 2);
    assert(!second.fail, second.fail || 'second implementation failed');
    const implementPrompt = fs.readFileSync(path.join(runsDir, 'implement-2/task.redacted.md'), 'utf8');
    const implementDelta = parsePromptContext(implementPrompt, '上一步差量上下文(供参考)');
    assert.deepStrictEqual(Object.keys(implementDelta), [
      'goal_sha256',
      'spec_fingerprint',
      'requiredRows',
      'previous_failed_rows',
      'improvement_points',
      'changed_files',
      'artifact_refs',
    ]);
    assert.strictEqual(implementDelta.requiredRows.length, requiredRows.length, 'passed rows remain in the next full-table review contract');
    assert.strictEqual(implementDelta.previous_failed_rows.length, 1, 'critique context contains only failed rows');
    assert.strictEqual(implementDelta.improvement_points.length, 1);
    assert.strictEqual(implementDelta.changed_files.length, 1);
    assert.match(implementDelta.changed_files[0].sha256, /^[a-f0-9]{64}$/);
    assert(implementDelta.artifact_refs.length >= 3);
    assert(implementDelta.artifact_refs.every(ref => /^[a-f0-9]{64}$/.test(ref.sha256)));
    assert.doesNotMatch(implementPrompt, /review_loop_history/);

    const state = ctx.review_delta_state;
    const immutableRefs = state.artifact_refs.filter(ref => ref.kind === 'task_redacted' || ref.kind === 'result_redacted');
    assert(immutableRefs.length >= 2);
    assert(immutableRefs.every(ref => /\/review-delta\/refs\//.test(ref.path)),
      'mutable task/result paths must be replaced by content-addressed redacted snapshots');
    fs.appendFileSync(path.join(runsDir, 'implement-2/task.redacted.md'), '\npost-capture concurrent rewrite probe\n');
    const afterSourceRewrite = controller.prepareEnvelope({ node: { id: 'review' }, ctx, attempt: 21 });
    assert.strictEqual(afterSourceRewrite.mode, 'delta',
      'rewriting an original trace artifact cannot change the content-addressed ref consumed by the next round');
    assert(state.history_ref, 'review history ref is retained after the next implementation');
    const historyFile = path.resolve(root, state.history_ref.path);
    assert(fs.existsSync(historyFile));
    assert.strictEqual(ReviewDeltaContext.sha256(fs.readFileSync(historyFile)), state.history_ref.sha256);
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    assert.strictEqual(history.entries.length, 1);
    assert.strictEqual(history.entries[0].review.verification.acceptance_table.length, requiredRows.length);

    const redactedReview = fs.readFileSync(path.join(runsDir, 'review-1/result.redacted.md'), 'utf8');
    const fallbackFile = path.resolve(root, state.fallback_ref.path);
    const fallbackContent = fs.readFileSync(fallbackFile, 'utf8');
    assert.doesNotMatch(redactedReview, /TEST_ONLY_REDACTION_VALUE_1234567890/);
    assert.match(redactedReview, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(fallbackContent, /TEST_ONLY_REDACTION_VALUE_1234567890/);
    assert.match(fallbackContent, /Bearer \[REDACTED\]/);
    assert.match(fallbackContent, /latest_implement_task\.redacted\.md/);
    assert.match(fallbackContent, /previous_review_result\.redacted\.md/);

    const artifactMismatchCtx = clone(ctx);
    artifactMismatchCtx.review_delta_state.artifact_refs[0].sha256 = '0'.repeat(64);
    const artifactFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: artifactMismatchCtx, attempt: 3 });
    assert.strictEqual(artifactFallback.mode, 'fallback');
    assert.strictEqual(artifactFallback.value.fallback_full_result.source_version_sha256, state.source_version_sha256);

    const boundaryCtx = clone(ctx);
    boundaryCtx.review_delta_state.artifact_refs[0].path = '../outside-project.md';
    const boundaryFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: boundaryCtx, attempt: 4 });
    assert.strictEqual(boundaryFallback.mode, 'fallback');

    const missingCtx = clone(ctx);
    missingCtx.review_delta_state.artifact_refs[0].path = 'projects/控制台/missing-artifact.md';
    const missingFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: missingCtx, attempt: 5 });
    assert.strictEqual(missingFallback.mode, 'fallback');

    const versionCtx = clone(ctx);
    versionCtx.review_delta_state.artifact_refs[0].version_sha256 = 'f'.repeat(64);
    const versionFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: versionCtx, attempt: 6 });
    assert.strictEqual(versionFallback.mode, 'fallback');

    const missingVersionCtx = clone(ctx);
    delete missingVersionCtx.review_delta_state.artifact_refs[0].version_sha256;
    const missingVersionFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: missingVersionCtx, attempt: 61 });
    assert.strictEqual(missingVersionFallback.mode, 'fallback');

    const emptyRefsCtx = clone(ctx);
    emptyRefsCtx.review_delta_state.artifact_refs = [];
    assert.strictEqual(controller.prepareEnvelope({ node: { id: 'review' }, ctx: emptyRefsCtx, attempt: 62 }).mode, 'fallback');

    const missingFallbackVersionCtx = clone(ctx);
    delete missingFallbackVersionCtx.review_delta_state.fallback_ref.version_sha256;
    assert.strictEqual(controller.prepareEnvelope({ node: { id: 'review' }, ctx: missingFallbackVersionCtx, attempt: 621 }).mode, 'fallback');

    const missingStateIdentityCtx = clone(ctx);
    delete missingStateIdentityCtx.review_delta_state.identity;
    assert.strictEqual(controller.prepareEnvelope({ node: { id: 'review' }, ctx: missingStateIdentityCtx, attempt: 63 }).mode, 'fallback');

    const versionAnchorCtx = clone(ctx);
    const forgedVersion = 'f'.repeat(64);
    versionAnchorCtx.review_delta_state.source_version_sha256 = forgedVersion;
    versionAnchorCtx.review_delta_state.fallback_ref.version_sha256 = forgedVersion;
    versionAnchorCtx.review_delta_state.artifact_refs.forEach(ref => { ref.version_sha256 = forgedVersion; });
    if (versionAnchorCtx.review_delta_state.history_ref) versionAnchorCtx.review_delta_state.history_ref.version_sha256 = forgedVersion;
    if (versionAnchorCtx.review_delta_state.previous_review) {
      versionAnchorCtx.review_delta_state.previous_review.full_result_ref.version_sha256 = forgedVersion;
    }
    const anchoredFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: versionAnchorCtx, attempt: 64 });
    assert.strictEqual(anchoredFallback.mode, 'fallback');
    assert.strictEqual(anchoredFallback.value.fallback_full_result.source_version_sha256, state.source_version_sha256,
      'fallback version is re-anchored to the verified fallback content hash');

    const emptyImprovementCtx = clone(ctx);
    emptyImprovementCtx.review_delta_state.previous_review.improvement_points = [];
    const emptyImprovementFallback = controller.prepareEnvelope({ node: { id: 'implement' }, ctx: emptyImprovementCtx, attempt: 7 });
    assert.strictEqual(emptyImprovementFallback.mode, 'fallback');

    const emptyRowsCtx = clone(ctx);
    emptyRowsCtx.requiredRows = [];
    const emptyRowsFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: emptyRowsCtx, attempt: 8 });
    assert.strictEqual(emptyRowsFallback.mode, 'fallback');
    assert.strictEqual(emptyRowsFallback.value.requiredRows.length, requiredRows.length);

    const rowDriftCtx = clone(ctx);
    rowDriftCtx.requiredRows[0].text = 'drifted row text';
    const rowFallback = controller.prepareEnvelope({ node: { id: 'review' }, ctx: rowDriftCtx, attempt: 9 });
    assert.strictEqual(rowFallback.mode, 'fallback');
    assert.strictEqual(rowFallback.value.requiredRows.length, requiredRows.length, 'fallback restores the prior stable required-row version');

    const identityDriftCtx = clone(ctx);
    identityDriftCtx.spec_fingerprint = 'a'.repeat(64);
    assert.strictEqual(controller.prepareEnvelope({ node: { id: 'review' }, ctx: identityDriftCtx, attempt: 10 }).mode, 'fallback');

    const changedHashCtx = clone(ctx);
    changedHashCtx.review_delta_state.changed_files[0].sha256 = 'f'.repeat(64);
    assert.strictEqual(controller.prepareEnvelope({ node: { id: 'review' }, ctx: changedHashCtx, attempt: 11 }).mode, 'fallback');

    const omittedStructuredGapReview = clone(review.vars.review);
    omittedStructuredGapReview.evaluation.gaps.push('第二条结构化缺口不得从 improvement_points 消失。');
    const omittedGap = ReviewDeltaContext.validateImprovementConsistency(omittedStructuredGapReview);
    assert.strictEqual(omittedGap.ok, false);
    assert.strictEqual(omittedGap.reason, 'structured_gap_missing_from_improvement_points');

    const snapshotFile = path.join(projectRoot, 'snapshot-proof.txt');
    fs.writeFileSync(snapshotFile, 'snapshot before concurrent rewrite\n');
    const snapshotBytes = fs.readFileSync(snapshotFile);
    const snapshotRef = {
      kind: 'snapshot_probe',
      path: path.relative(root, snapshotFile),
      sha256: ReviewDeltaContext.sha256(snapshotBytes),
    };
    const snapshotValidation = ReviewDeltaContext.validateArtifactRef(snapshotRef, { workspaceRoot: root, projectRoot });
    assert.strictEqual(snapshotValidation.ok, true);
    fs.writeFileSync(snapshotFile, 'snapshot after concurrent rewrite\n');
    assert.strictEqual(snapshotValidation.bytes.toString('utf8'), snapshotBytes.toString('utf8'),
      'validated bytes remain the immutable snapshot consumed by fallback/history parsing');

    const wrongIdentityReview = clone(review.vars.review);
    wrongIdentityReview.verification.immutable_context.goal_sha256 = 'f'.repeat(64);
    const rejected = controller.captureResult({
      node: { id: 'review' },
      ctx,
      attempt: 12,
      dir: path.join(runsDir, 'review-1'),
      result: { vars: { review: wrongIdentityReview } },
    });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.reason, /review_immutable_identity_unverified/);

    const audit = readAudit(controller.auditFile);
    assert(audit.some(entry => entry.type === 'review.delta.preflight_ok'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'artifact_ref_artifact_hash_mismatch'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'artifact_ref_path_outside_boundary'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'artifact_ref_artifact_version_sha256_missing_or_invalid'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'artifact_refs_empty'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'source_version_anchor_mismatch'));
    assert(audit.some(entry => entry.type === 'review.delta.fallback' && entry.reason === 'failed_rows_without_improvement_points'));
    assert(audit.some(entry => entry.type === 'review.delta.capture_failed' && /review_immutable_identity_unverified/.test(entry.reason)));

    const projectConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf8')).reviewDeltaContext;
    assert.strictEqual(projectConfig.enabled, false, 'production flag remains disabled before owner approval');
    assert.strictEqual(ReviewDeltaContext.activationState(projectConfig, {}).reason, 'feature_flag_disabled');
    const unapproved = ReviewDeltaContext.activationState({ enabled: true, promotionApproval: { status: 'pending' } }, {});
    assert.strictEqual(unapproved.active, false);
    assert.strictEqual(unapproved.reason, 'owner_approval_required');
    assert.strictEqual(ReviewDeltaContext.activationState(activeConfig(), { CONSOLE_REVIEW_DELTA_CONTEXT: '0' }).reason, 'environment_kill_switch');
    const shadowController = ReviewDeltaContext.create({
      config: { enabled: false, shadowEnabled: true },
      env: {},
      workspaceRoot: root,
      projectRoot,
      runsDir,
      taskId: TASK_ID,
      projectId: '控制台',
    });
    assert.strictEqual(shadowController.prepareEnvelope({ node: { id: 'review' }, ctx, attempt: 13 }).mode, 'legacy');
    assert.strictEqual(shadowController.prepareEnvelope({ node: { id: 'review' }, ctx: artifactMismatchCtx, attempt: 14 }).mode, 'legacy');
    const shadowPrompt = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, ctx, {
      reviewDeltaContext: shadowController,
      attempt: 15,
    });
    assert.match(shadowPrompt, /上一步结果\(供参考\)/);
    assert.doesNotMatch(shadowPrompt, /review_delta_state/);

    console.log(JSON.stringify({
      pass: true,
      suite: 'review-delta-context',
      required_rows: requiredRows.length,
      history_sha256: state.history_ref.sha256,
      fallback_events: audit.filter(entry => entry.type === 'review.delta.fallback').length,
      secret_hygiene: InteractionTrace.redact(['Bearer', 'TEST_ONLY_REDACTION_VALUE_1234567890'].join(' ')) === 'Bearer [REDACTED]',
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
