#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BoardEvidenceMerge = require('../board-evidence-merge');
const BoardReview = require('../board-review');

function proposalRecords(issues = [], suggestions = []) {
  return [
    ...BoardEvidenceMerge.normalizeProposalRecords(issues, 'issue'),
    ...BoardEvidenceMerge.normalizeProposalRecords(suggestions, 'suggestion'),
  ];
}

function opinion(role, records, extra = {}) {
  return Object.assign({
    director: role,
    proposer_role: role,
    source_task: 'merge-contract-unit',
    source_trace: `projects/控制台/traces/${role}.json:1`,
    source_runner: `${role}-runner`,
    reasoning_source_id: `${role}-reasoning`,
    absent: false,
    proposal_records: records,
  }, extra);
}

function byClaim(contract, claim, stance) {
  return contract.items.find(item => item.claim_key === claim && (!stance || item.stance === stance));
}

function trustedReceipt({ root, receiptId, taskId, item, role, traceRef, command, resultRef }) {
  const sourceTrace = BoardEvidenceMerge.verifyEvidenceRef(traceRef, { workspaceRoot: root });
  const result = BoardEvidenceMerge.verifyEvidenceRef(resultRef, { workspaceRoot: root });
  assert.strictEqual(sourceTrace.verified, true);
  assert.strictEqual(result.verified, true);
  const receipt = {
    schema: BoardEvidenceMerge.REPRODUCTION_RECEIPT_SCHEMA,
    receipt_id: receiptId,
    issuer: BoardEvidenceMerge.REPRODUCTION_RECEIPT_ISSUER,
    execution_id: `exec-${receiptId}`,
    task_id: taskId,
    suggestion_id: item.suggestion_id,
    source_role: BoardEvidenceMerge.canonicalRole(role),
    source_trace_ref: traceRef,
    source_trace_line_sha256: sourceTrace.line_sha256,
    evidence_binding_sha256: item.evidence_binding_sha256,
    command_sha256: BoardEvidenceMerge.reproductionCommandHash(command),
    status: 'reproduced',
    exit_code: 0,
    started_at: '2026-07-17T00:00:00.000Z',
    completed_at: '2026-07-17T00:00:01.000Z',
    result_ref: resultRef,
    result_line_sha256: result.line_sha256,
    integrity_sha256: '',
  };
  receipt.integrity_sha256 = BoardEvidenceMerge.reproductionReceiptIntegrity(receipt);
  return receipt;
}

async function main() {
  const receiptSchema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'config', 'board-reproduction-receipt.schema.json'),
    'utf8',
  ));
  assert.strictEqual(receiptSchema.$id, BoardEvidenceMerge.REPRODUCTION_RECEIPT_SCHEMA);
  assert.strictEqual(receiptSchema.additionalProperties, false);
  assert(receiptSchema.required.includes('integrity_sha256'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-evidence-merge-'));
  try {
    const projectRoot = path.join(root, 'projects', '控制台');
    fs.mkdirSync(path.join(projectRoot, 'traces'), { recursive: true });
    const evidenceFile = path.join(projectRoot, 'evidence.md');
    fs.writeFileSync(evidenceFile, [
      '# Merge evidence',
      'reproduced severe routing accident with the deterministic project-local harness',
      'normal mechanism reproduced with exit zero and stable semantic output',
      'reproduced secret leak in final failure, event, and cooldown paths',
      'trace-only observation without a reproduction command',
    ].join('\n'));
    for (const role of ['board_deepseek', 'deepseek_board', 'board_glm52', 'board_claude', 'board_opus48']) {
      fs.writeFileSync(path.join(projectRoot, 'traces', `${role}.json`), '{}\n');
    }

    const production = BoardEvidenceMerge.activationState({
      approvalFile: BoardEvidenceMerge.DEFAULT_APPROVAL_FILE,
      env: {},
    });
    assert.strictEqual(production.active, false);
    assert.strictEqual(production.feature_flag, false);
    assert.strictEqual(production.owner_approved, false);
    assert.strictEqual(production.shadow_enabled, true);

    const approvedRecord = {
      schema: BoardEvidenceMerge.APPROVAL_SCHEMA,
      status: 'approved',
      shadowEnabled: true,
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
      scope: BoardEvidenceMerge.FEATURE_SCOPE,
      rollback: 'unset the feature flag',
    };
    assert.strictEqual(BoardEvidenceMerge.activationState({ record: approvedRecord, env: {} }).active, false,
      'owner approval without the feature flag must stay inactive');
    assert.strictEqual(BoardEvidenceMerge.activationState({
      record: { schema: BoardEvidenceMerge.APPROVAL_SCHEMA, status: 'not_authorized', ownerApproved: false },
      env: { [BoardEvidenceMerge.FEATURE_FLAG]: '1' },
    }).active, false, 'feature flag without durable owner approval must stay inactive');
    assert.strictEqual(BoardEvidenceMerge.activationState({
      record: approvedRecord,
      env: { [BoardEvidenceMerge.FEATURE_FLAG]: '1' },
    }).active, true, 'both independent activation gates are required');

    const validEvidence = BoardEvidenceMerge.verifyEvidenceRef('projects/控制台/evidence.md:2', { workspaceRoot: root });
    assert.strictEqual(validEvidence.verified, true);
    assert.strictEqual(validEvidence.line, 2);
    assert.strictEqual(validEvidence.line_sha256.length, 64);
    assert.strictEqual(BoardEvidenceMerge.verifyEvidenceRef('projects/控制台/missing.md:1', { workspaceRoot: root }).verified, false);
    assert.strictEqual(BoardEvidenceMerge.verifyEvidenceRef('shared/engine/queue.js:1', { workspaceRoot: root }).verified, false);
    const link = path.join(projectRoot, 'linked-evidence.md');
    fs.symlinkSync(evidenceFile, link);
    assert.strictEqual(BoardEvidenceMerge.verifyEvidenceRef('projects/控制台/linked-evidence.md:1', { workspaceRoot: root }).verified, false,
      'symlink evidence must fail closed');

    const sharedClaimRows = [
      opinion('board_deepseek', proposalRecords([], [{
        text: 'introduce an event bus mechanism', claim_key: 'event-bus', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:5'], reasoning_source_id: 'source-A',
        classification: 'acceptance',
      }])),
      opinion('deepseek_board', proposalRecords([], [{
        text: 'introduce an event bus mechanism', claim_key: 'event-bus', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:5'], reasoning_source_id: 'source-alias',
      }]), { canonical_role: 'board_deepseek' }),
      opinion('board_glm52', proposalRecords([], [{
        text: 'introduce an event bus mechanism', claim_key: 'event-bus', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:5'], reasoning_source_id: 'source-A',
      }])),
      opinion('board_claude', proposalRecords([], [{
        text: 'introduce an event bus mechanism', claim_key: 'event-bus', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:5'], reasoning_source_id: 'source-C',
        is_fallback_duplicate: true,
      }])),
      opinion('board_opus48', proposalRecords([], [{
        text: 'introduce an event bus mechanism', claim_key: 'event-bus', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:5'], reasoning_source_id: 'source-final',
      }])),
    ];

    const reproductionCommand = 'node projects/控制台/tests/board-evidence-merge.test.js';
    const matrixOpinions = [
      ...sharedClaimRows,
      opinion('board_deepseek', proposalRecords([], [{
        text: 'single unsupported scope signature mechanism', claim_key: 'scope-signature', stance: 'support',
        classification: 'acceptance', evidence_refs: [],
      }])),
      opinion('board_glm52', proposalRecords([{ text: 'enable shared context architecture', claim_key: 'architecture-assumption', stance: 'enable' }])),
      opinion('board_opus48', proposalRecords([{ text: 'disable shared context architecture', claim_key: 'architecture-assumption', stance: 'disable' }])),
      opinion('board_deepseek', proposalRecords([], [{
        text: 'normal mechanism has reproducible evidence', claim_key: 'normal-evidenced', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-normal-deepseek', command: reproductionCommand, status: 'passed', exit_code: 0 },
      }])),
      opinion('board_opus48', proposalRecords([], [{
        text: 'normal mechanism has reproducible evidence', claim_key: 'normal-evidenced', stance: 'support',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-normal-final', command: reproductionCommand, status: 'passed', exit_code: 0 },
      }])),
      opinion('board_claude', proposalRecords([{ text: 'single normal mechanism with reproduction', claim_key: 'single-evidenced', stance: 'assert',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-single', command: reproductionCommand, status: 'passed', exit_code: 0 } }])),
      opinion('board_glm52', proposalRecords([{ text: 'severe routing accident is reproducible', claim_key: 'routing-redline', stance: 'assert',
        redline_type: 'severe_routing', classification: 'hard_block', evidence_refs: ['projects/控制台/evidence.md:2'],
        reproduction: { receipt_id: 'rr-routing', command: reproductionCommand, status: 'reproduced', exit_code: 0 } }])),
      opinion('board_glm52', proposalRecords([{ text: 'self-reported scope escape was never executed', claim_key: 'self-report-redline', stance: 'assert',
        redline_type: 'scope_escape', classification: 'hard_block', evidence_refs: ['projects/控制台/evidence.md:2'],
        reproduction: { command: 'node projects/控制台/tests/never-executed-redline.js', status: 'reproduced', exit_code: 0 } }])),
      opinion('board_claude', proposalRecords([{ text: 'possible deadlock without process evidence', claim_key: 'deadlock-redline', stance: 'assert',
        redline_type: 'deadlock', classification: 'hard_block', evidence_refs: [] }])),
      opinion('board_opus48', proposalRecords([{ text: 'claimed secret leak with a ghost reference', claim_key: 'ghost-redline', stance: 'assert',
        redline_type: 'secret_leak', classification: 'hard_block', evidence_refs: ['projects/控制台/missing.md:99'],
        reproduction: { receipt_id: 'rr-ghost', command: 'node missing.js', status: 'passed', exit_code: 0 } }])),
      opinion('board_deepseek', proposalRecords([{ text: 'unverified secret leak shares a topic with a normal trace', claim_key: 'redline-evidence-binding', stance: 'assert',
        redline_type: 'secret_leak', classification: 'hard_block', evidence_refs: [] }])),
      opinion('board_glm52', proposalRecords([{ text: 'normal reproducible observation on the shared topic', claim_key: 'redline-evidence-binding', stance: 'assert',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-bound-normal', command: reproductionCommand, status: 'passed', exit_code: 0 } }])),
    ];

    const untrustedContract = BoardEvidenceMerge.buildMergeContract(matrixOpinions, {
      taskId: 'merge-contract-unit', round: 1, active: false, workspaceRoot: root,
    });
    const selfReported = byClaim(untrustedContract, 'self-report-redline');
    assert.strictEqual(selfReported.classification, 'owner_decision',
      'model-reported reproduction status/exit code must not prove command execution');
    assert.strictEqual(selfReported.evidence_level, 'trace');
    assert.strictEqual(selfReported.promotion_rule, 'MERGE-R3-UNVERIFIED-REDLINE-ARBITRATION');
    assert.strictEqual(selfReported.sources[0].reproduction_verification.verified, false);
    assert.strictEqual(selfReported.sources[0].reproduction_verification.reason, 'trusted_receipt_id_missing');
    const untrustedRouting = byClaim(untrustedContract, 'routing-redline');
    assert.strictEqual(untrustedRouting.classification, 'owner_decision',
      'even a claimed receipt id is inert unless the trusted executor channel supplies it');
    assert.strictEqual(untrustedRouting.sources[0].reproduction_verification.reason, 'trusted_receipt_channel_disabled');

    const trustedReceipts = [
      trustedReceipt({ root, receiptId: 'rr-normal-deepseek', taskId: 'merge-contract-unit',
        item: byClaim(untrustedContract, 'normal-evidenced'), role: 'board_deepseek',
        traceRef: 'projects/控制台/traces/board_deepseek.json:1', command: reproductionCommand,
        resultRef: 'projects/控制台/evidence.md:3' }),
      trustedReceipt({ root, receiptId: 'rr-normal-final', taskId: 'merge-contract-unit',
        item: byClaim(untrustedContract, 'normal-evidenced'), role: 'board_opus48',
        traceRef: 'projects/控制台/traces/board_opus48.json:1', command: reproductionCommand,
        resultRef: 'projects/控制台/evidence.md:3' }),
      trustedReceipt({ root, receiptId: 'rr-single', taskId: 'merge-contract-unit',
        item: byClaim(untrustedContract, 'single-evidenced'), role: 'board_claude',
        traceRef: 'projects/控制台/traces/board_claude.json:1', command: reproductionCommand,
        resultRef: 'projects/控制台/evidence.md:3' }),
      trustedReceipt({ root, receiptId: 'rr-routing', taskId: 'merge-contract-unit',
        item: byClaim(untrustedContract, 'routing-redline'), role: 'board_glm52',
        traceRef: 'projects/控制台/traces/board_glm52.json:1', command: reproductionCommand,
        resultRef: 'projects/控制台/evidence.md:2' }),
      trustedReceipt({ root, receiptId: 'rr-bound-normal', taskId: 'merge-contract-unit',
        item: byClaim(untrustedContract, 'redline-evidence-binding'), role: 'board_glm52',
        traceRef: 'projects/控制台/traces/board_glm52.json:1', command: reproductionCommand,
        resultRef: 'projects/控制台/evidence.md:3' }),
    ];
    const contract = BoardEvidenceMerge.buildMergeContract(matrixOpinions, {
      taskId: 'merge-contract-unit', round: 1, active: false, workspaceRoot: root,
      reproductionReceipts: trustedReceipts,
      reproductionReceiptsTrusted: true,
    });
    assert.strictEqual(contract.schema, BoardEvidenceMerge.CONTRACT_SCHEMA);
    assert.strictEqual(contract.mode, 'shadow_only');
    assert.strictEqual(contract.policy.consensus_is_auxiliary, true);
    assert.strictEqual(contract.policy.model_reproduction_claim_is_not_execution_evidence, true);

    const eventBus = byClaim(contract, 'event-bus');
    assert(eventBus);
    assert.strictEqual(eventBus.classification, 'experiment', 'trace-only consensus must not become acceptance');
    assert.strictEqual(eventBus.independent_consensus_count, 2);
    assert.deepStrictEqual(eventBus.independent_consensus_roles.sort(), ['board_deepseek', 'board_final']);
    assert(eventBus.consensus_ledger.some(row => row.exclusion_reason === 'role_alias_or_duplicate'));
    assert(eventBus.consensus_ledger.some(row => row.exclusion_reason === 'shared_reasoning_source'));
    assert(eventBus.consensus_ledger.some(row => row.exclusion_reason === 'fallback_duplicate'));
    assert.strictEqual(eventBus.sources.length, 5, 'excluded votes must retain their provenance instead of disappearing');

    const unsupported = byClaim(contract, 'scope-signature');
    assert.strictEqual(unsupported.classification, 'experiment');
    assert.strictEqual(unsupported.evidence_level, 'none');
    assert.strictEqual(unsupported.independent_consensus_count, 1);
    assert.strictEqual(unsupported.promotion_rule, 'MERGE-R1-NO-PARSEABLE-EVIDENCE');
    assert.strictEqual(unsupported.sources[0].requested_classification, 'acceptance',
      'the original request stays auditable even when the effective class is downgraded');

    const opposing = contract.items.filter(item => item.claim_key === 'architecture-assumption');
    assert.strictEqual(opposing.length, 2, 'mutually exclusive role assumptions must not collapse by shared claim key');
    assert.deepStrictEqual(opposing.map(item => item.stance).sort(), ['disable', 'enable']);

    const normal = byClaim(contract, 'normal-evidenced');
    assert.strictEqual(normal.classification, 'acceptance');
    assert.strictEqual(normal.evidence_level, 'reproducible');
    assert.strictEqual(normal.independent_consensus_count, 2);
    assert.strictEqual(normal.promotion_rule, 'MERGE-R2-INDEPENDENT-EVIDENCED-CONSENSUS');

    const singleEvidenced = byClaim(contract, 'single-evidenced');
    assert.strictEqual(singleEvidenced.classification, 'owner_decision');
    assert.strictEqual(singleEvidenced.promotion_rule, 'MERGE-R6-SINGLE-EVIDENCED-NON-REDLINE');

    const routingRedline = byClaim(contract, 'routing-redline');
    assert.strictEqual(routingRedline.classification, 'hard_block');
    assert.strictEqual(routingRedline.independent_consensus_count, 1);
    assert.strictEqual(routingRedline.promotion_rule, 'MERGE-R4-REPRODUCIBLE-REDLINE');
    assert(routingRedline.evidence_refs.every(ref => ref.verified));
    assert.strictEqual(routingRedline.sources[0].reproduction_verification.reason, 'trusted_execution_receipt_verified');
    assert.strictEqual(routingRedline.sources[0].reproduction_receipt.issuer,
      BoardEvidenceMerge.REPRODUCTION_RECEIPT_ISSUER);

    const corruptReceipt = Object.assign({}, trustedReceipts.find(row => row.receipt_id === 'rr-routing'), {
      result_line_sha256: '0'.repeat(64),
    });
    corruptReceipt.integrity_sha256 = BoardEvidenceMerge.reproductionReceiptIntegrity(corruptReceipt);
    const corruptContract = BoardEvidenceMerge.buildMergeContract(matrixOpinions, {
      taskId: 'merge-contract-unit', round: 1, active: false, workspaceRoot: root,
      reproductionReceipts: trustedReceipts.filter(row => row.receipt_id !== 'rr-routing').concat(corruptReceipt),
      reproductionReceiptsTrusted: true,
    });
    assert.strictEqual(byClaim(corruptContract, 'routing-redline').classification, 'owner_decision');
    assert.strictEqual(byClaim(corruptContract, 'routing-redline').sources[0].reproduction_verification.reason,
      'trusted_receipt_result_invalid');

    const deadlock = byClaim(contract, 'deadlock-redline');
    assert.strictEqual(deadlock.classification, 'owner_decision');
    assert.strictEqual(deadlock.promotion_rule, 'MERGE-R3-UNVERIFIED-REDLINE-ARBITRATION');
    const ghost = byClaim(contract, 'ghost-redline');
    assert.strictEqual(ghost.classification, 'owner_decision');
    assert.strictEqual(ghost.evidence_level, 'claim');
    assert(ghost.evidence_refs.every(ref => ref.verified === false));

    const boundRedline = byClaim(contract, 'redline-evidence-binding');
    assert.strictEqual(boundRedline.classification, 'owner_decision',
      'an unverified redline must not borrow a non-redline row\'s reproducible evidence');
    assert.strictEqual(boundRedline.evidence_level, 'none');
    assert.strictEqual(boundRedline.promotion_rule, 'MERGE-R3-UNVERIFIED-REDLINE-ARBITRATION');

    const featureApprovalMustNotPromote = BoardEvidenceMerge.buildMergeContract([
      opinion('board_claude', proposalRecords([{ text: 'single normal mechanism with reproduction', claim_key: 'single-evidenced', stance: 'assert',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-single', command: reproductionCommand, status: 'passed', exit_code: 0 } }])),
    ], {
      taskId: 'merge-contract-unit', round: 1, active: true, workspaceRoot: root,
      ownerApproval: approvedRecord,
      reproductionReceipts: trustedReceipts,
      reproductionReceiptsTrusted: true,
    });
    assert.strictEqual(byClaim(featureApprovalMustNotPromote, 'single-evidenced').classification, 'owner_decision',
      'feature activation approval is not an item-level owner decision');

    const approvalCandidate = byClaim(featureApprovalMustNotPromote, 'single-evidenced');
    const itemApproval = {
      schema: BoardEvidenceMerge.SUGGESTION_APPROVAL_SCHEMA,
      status: 'approved',
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
      task_id: 'merge-contract-unit',
      suggestion_id: approvalCandidate.suggestion_id,
      evidence_binding_sha256: approvalCandidate.evidence_binding_sha256,
      promotion_rule: 'MERGE-R5-OWNER-APPROVED-EVIDENCE',
      decision_ref: 'projects/控制台/evidence.md:4',
    };
    const itemApprovedContract = BoardEvidenceMerge.buildMergeContract([
      opinion('board_claude', proposalRecords([{ text: 'single normal mechanism with reproduction', claim_key: 'single-evidenced', stance: 'assert',
        evidence_refs: ['projects/控制台/evidence.md:3'],
        reproduction: { receipt_id: 'rr-single', command: reproductionCommand, status: 'passed', exit_code: 0 } }])),
    ], {
      taskId: 'merge-contract-unit', round: 1, active: true, workspaceRoot: root,
      suggestionApprovals: [itemApproval],
      reproductionReceipts: trustedReceipts,
      reproductionReceiptsTrusted: true,
    });
    const itemApproved = byClaim(itemApprovedContract, 'single-evidenced');
    assert.strictEqual(itemApproved.classification, 'acceptance');
    assert.strictEqual(itemApproved.promotion_rule, 'MERGE-R5-OWNER-APPROVED-EVIDENCE');
    assert.strictEqual(itemApproved.owner_approval.evidence_binding_sha256, approvalCandidate.evidence_binding_sha256);

    for (const item of contract.items) {
      for (const field of [
        'suggestion_id', 'proposer_role', 'source_task', 'source_trace', 'evidence_refs',
        'evidence_level', 'independent_consensus_count', 'classification', 'promotion_reason',
      ]) assert(Object.prototype.hasOwnProperty.call(item, field), `merged item missing ${field}`);
      assert(Array.isArray(item.sources) && item.sources.length > 0);
    }

    const shadowFile = BoardEvidenceMerge.writeMergeContract(contract, {
      artifactsRoot: path.join(projectRoot, 'artifacts'), taskId: 'merge-contract-unit', round: 1,
    });
    assert(fs.existsSync(shadowFile));
    assert.strictEqual(JSON.parse(fs.readFileSync(shadowFile, 'utf8')).item_count, contract.item_count);

    const legacy = BoardReview._test.buildRevisedInstruction('base instruction', matrixOpinions, 1, {
      active: false, mergeContract: contract,
    });
    assert(legacy.includes('董事会第 1 轮整合修订'));
    assert(!legacy.includes(BoardEvidenceMerge.CONTRACT_SCHEMA), 'shadow mode must not alter the production prompt');
    const active = BoardReview._test.buildRevisedInstruction('base instruction', matrixOpinions, 1, {
      active: true,
      mergeContract: Object.assign({}, contract, { mode: 'active_owner_approved' }),
    });
    assert(active.includes(BoardEvidenceMerge.CONTRACT_SCHEMA));
    assert(active.includes(routingRedline.suggestion_id));
    assert(active.includes('promotion_reason'));

    const structuredOpinion = BoardReview._test.parseOpinion({ vars: { board_review: {
      risk_level: 'medium', can_execute: true, hard_block: false, misjudgment_risk: false,
      issues: [{ text: 'structured traceable issue', claim_key: 'structured', stance: 'assert', evidence_refs: ['projects/控制台/evidence.md:5'] }],
      suggestions: [], summary: 'structured',
    } } }, { id: 'board_glm52', name: 'GLM', model: 'glm' }, 1);
    assert.strictEqual(structuredOpinion.proposal_records[0].claim_key, 'structured');
    assert.deepStrictEqual(structuredOpinion.proposal_records[0].evidence_refs, ['projects/控制台/evidence.md:5']);

    const disabledSeen = [];
    const disabledInstruction = [
      '目标:验证生产双门关闭。',
      '[秘书后台背景包]',
      '## Stable board background',
      'this complete block must remain inline while production activation is disabled',
    ].join('\n');
    const liveTraceRef = 'projects/控制台/traces/live-board_glm52.json:1';
    const liveTracePath = path.join(projectRoot, 'traces', 'live-board_glm52.json');
    fs.writeFileSync(liveTracePath, '{"runner":"controlled-test"}\n');
    const liveReceiptId = 'rr-live-routing';
    const liveReceiptCommand = 'node projects/控制台/tests/board-evidence-merge.test.js';
    const livePreflight = BoardEvidenceMerge.buildMergeContract([
      opinion('board_glm52', proposalRecords([{
        text: 'trusted live severe routing reproduction',
        claim_key: 'trusted-live-redline',
        stance: 'assert',
        redline_type: 'severe_routing',
        evidence_refs: ['projects/控制台/evidence.md:2'],
        reproduction: { receipt_id: liveReceiptId, command: liveReceiptCommand },
      }]), {
        source_task: 'production-disabled-unit',
        source_trace: liveTraceRef,
      }),
    ], {
      taskId: 'production-disabled-unit', round: 1, active: false, workspaceRoot: root,
    });
    const liveReceipt = trustedReceipt({
      root,
      receiptId: liveReceiptId,
      taskId: 'production-disabled-unit',
      item: byClaim(livePreflight, 'trusted-live-redline'),
      role: 'board_glm52',
      traceRef: liveTraceRef,
      command: liveReceiptCommand,
      resultRef: 'projects/控制台/evidence.md:2',
    });
    const disabledReview = await BoardReview.runBoardReview({
      spec: { taskId: 'production-disabled-unit', projectId: '控制台', goal: disabledInstruction, originalGoal: '重构 board runner 路由。' },
      ctx: { workspaceRoot: root },
      projectId: '控制台',
      planText: disabledInstruction,
      assessment: BoardReview.assessTask('重构 board runner 路由。'),
      artifactsRoot: path.join(projectRoot, 'disabled-artifacts'),
      memoryFile: path.join(projectRoot, 'disabled-decisions.md'),
      env: {},
      boardReproductionReceipts: [liveReceipt],
      boardReproductionReceiptsTrusted: true,
      cliRunner: {
        async runBoardNodeAsync(node, ctx) {
          disabledSeen.push(ctx.goal);
          const resultPath = path.join(projectRoot, 'traces', `live-${node.agent_role}.json`);
          fs.writeFileSync(resultPath, '{"runner":"controlled-test"}\n');
          return { evidence: { path: resultPath }, vars: { board_review: {
            risk_level: 'low', can_execute: true, hard_block: false, misjudgment_risk: false,
            issues: node.agent_role === 'board_glm52' ? [
              {
                text: 'self-reported severe routing reproduction must stay in arbitration',
                claim_key: 'disabled-self-report-redline',
                stance: 'assert',
                redline_type: 'severe_routing',
                evidence_refs: ['projects/控制台/evidence.md:2'],
                reproduction: {
                  command: 'node projects/控制台/tests/never-executed-redline.js',
                  status: 'reproduced',
                  exit_code: 0,
                },
              },
              {
                text: 'trusted live severe routing reproduction',
                claim_key: 'trusted-live-redline',
                stance: 'assert',
                redline_type: 'severe_routing',
                evidence_refs: ['projects/控制台/evidence.md:2'],
                reproduction: { receipt_id: liveReceiptId, command: liveReceiptCommand },
              },
            ] : [],
            suggestions: [], summary: `${node.agent_role} disabled gate ok`,
          } } };
        },
      },
      notify() { return { attempted: false, sent: false, test: true }; },
    });
    assert.strictEqual(disabledReview.ok, true);
    assert(disabledSeen.length >= 2);
    assert(disabledSeen.every(goal => !goal.includes('context_ref:')),
      'production prompts must remain legacy until both owner and feature gates pass');
    assert(disabledSeen.every(goal => goal.includes('this complete block must remain inline')));
    assert(disabledReview.rounds[0].evidence_merge_contract);
    assert.strictEqual(disabledReview.rounds[0].evidence_merge_contract.mode, 'shadow_only');
    const disabledSelfReport = byClaim(disabledReview.rounds[0].evidence_merge_contract,
      'disabled-self-report-redline');
    assert.strictEqual(disabledSelfReport.classification, 'owner_decision');
    assert.strictEqual(disabledSelfReport.promotion_rule, 'MERGE-R3-UNVERIFIED-REDLINE-ARBITRATION');
    assert.strictEqual(disabledSelfReport.sources[0].reproduction_verification.reason,
      'trusted_receipt_id_missing');
    assert.match(disabledSelfReport.source_trace,
      /^projects\/控制台\/traces\/live-board_glm52\.json:1$/);
    const trustedLive = byClaim(disabledReview.rounds[0].evidence_merge_contract,
      'trusted-live-redline');
    assert.strictEqual(trustedLive.classification, 'hard_block');
    assert.strictEqual(trustedLive.promotion_rule, 'MERGE-R4-REPRODUCIBLE-REDLINE');
    assert.strictEqual(trustedLive.sources[0].reproduction_verification.reason,
      'trusted_execution_receipt_verified');
    assert.strictEqual(disabledReview.rounds[0].evidence_merge_activation.active, false);
    assert(!disabledReview.revisedGoal.includes(BoardEvidenceMerge.CONTRACT_SCHEMA),
      'shadow merge evidence must not rewrite the existing production acceptance prompt');

    const terminalSentinels = ['cooldown-userinfo-secret', 'cooldown-query-secret', 'cooldown-bearer-secret'];
    const terminalReason = `HTTP 429 https://alice:${terminalSentinels[0]}@example.invalid/v1?access_token=${terminalSentinels[1]} Bearer ${terminalSentinels[2]}`;
    const cooldownEvents = [];
    const cooldownRoot = path.join(projectRoot, 'cooldown');
    BoardReview._test.markDirectorCooldown(
      { id: 'board_glm52', role: 'board_glm52', runner: 'runner' },
      terminalReason,
      cooldownRoot,
      { emit(type, data) { cooldownEvents.push({ type, ...data }); } },
    );
    const cooldownText = fs.readFileSync(path.join(cooldownRoot, 'board-review-runner-health.json'), 'utf8');
    const cooldownEventText = JSON.stringify(cooldownEvents);
    for (const sentinel of terminalSentinels) {
      assert(!cooldownText.includes(sentinel));
      assert(!cooldownEventText.includes(sentinel));
    }
    assert(cooldownText.includes('[REDACTED]'));

    console.log(JSON.stringify({
      pass: true,
      suite: 'board-evidence-merge',
      scenarios: 26,
      item_count: contract.item_count,
      classifications: contract.items.reduce((out, item) => {
        out[item.classification] = (out[item.classification] || 0) + 1;
        return out;
      }, {}),
      independent_event_bus_consensus: eventBus.independent_consensus_count,
      production_activation: production,
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
