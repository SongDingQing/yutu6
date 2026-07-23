#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const DoneGate = require('../../../shared/engine/done-gate');
const AcceptanceContract = require('../../../shared/engine/acceptance-contract');
const ProtocolGate = require('../../../shared/engine/protocol-gate');
const EventLog = require('../../../shared/engine/eventlog');
const { TaskStore } = require('../../../shared/engine/taskstore');
const { buildEnvelope } = require('../../../shared/engine/cli-runner');
const {
  REVIEW_ROUTING_CONTRACT_FEATURE,
  REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA,
  REVIEW_ROUTING_CONTRACT_APPROVAL_TASK,
  REVIEW_ROUTING_CONTRACT_APPROVAL_REL,
  REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL,
  CONTROL_PLANE_APPROVAL_SCHEMA,
  loadFlow,
  runFlow,
} = require('../../../shared/engine/engine');

process.env.YUTU6_DONE_GATE_EXECUTE = '0';

const PROJECT_ID = '控制台';
const PROJECT_SCOPE = 'project/控制台';
const TEST_COMMAND = 'node projects/控制台/tests/review-negative-routing-contract.test.js';
const IMPLEMENTATION_SOURCE_REL = 'projects/控制台/review-negative-routing-fixture/implementation-source.md';
const IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA = 'implementation-failure-receipt@1';
const SUPERVISOR_REVIEW_BINDING_SCHEMA = 'supervisor-review-binding@1';
const IMPLEMENTATION_OBSERVED = 'observed_route=hard_block_expected_route=rework';
const POST_IMPLEMENTATION_MUTATION_OBSERVED = 'observed_route=forged_after_implement';
const UNRELATED_SOURCE_CLAIM = 'release_calendar_2026_q4';
const UNRELATED_SOURCE_LINE = `fixture_fact=${UNRELATED_SOURCE_CLAIM} owner=operations`;
const REQUIRED_TEXTS = [
  '格式合法且 review.pass=true 的审查结果进入 approve 放行路由。',
  'review.pass=false 且全部硬证据条件成立的审查结果进入 rework 路由。',
  'rework 路由的目标阶段标识明确为 implement。',
  'EVIDENCE_ORIGINAL_SENTINEL_1784236377579 必须与审查证据原文对齐。',
];

function fixtureContract(taskId) {
  return AcceptanceContract.createContract(
    REQUIRED_TEXTS.map(text => ({ text, scope: PROJECT_SCOPE })),
    {
      stage: 'review-negative-routing-fixture',
      projectId: PROJECT_ID,
      rootTaskId: taskId,
      sourceRef: 'fixture:review-negative-routing-contract',
      sourceKind: 'orchestrator',
    },
  );
}

function evidenceRel(name) {
  return `projects/控制台/review-negative-routing-fixture/${name}`;
}

function writeEvidence(root, name, contract, verdict = 'fail', includeRequiredText = true) {
  const rel = evidenceRel(name);
  const file = path.join(root, rel);
  const required = AcceptanceContract.acceptanceRows(contract).map(row => row.point);
  const content = includeRequiredText
    ? [...required, `review_verdict=${verdict}`, '核对结果=已记录'].join('\n')
    : `无关记录\nreview_verdict=${verdict}\n核对结果=已记录`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content}\n`);
  return rel;
}

function filledRows(contract, evidence, pass, aligned = true, statusOverride = null) {
  return AcceptanceContract.acceptanceRows(contract).map((row, index) => {
    const fallbackStatus = pass ? '完成' : '部分';
    const status = Array.isArray(statusOverride)
      ? (statusOverride[index] || fallbackStatus)
      : (statusOverride || fallbackStatus);
    return Object.assign({}, row, {
      status,
      evidence,
      notes: aligned ? `${row.point} 核对结果=${status}` : '记录已读取',
    });
  });
}

function reviewIssueValues(review) {
  let source;
  if (Object.prototype.hasOwnProperty.call(review || {}, 'issues')) {
    source = review.issues;
  } else if (review && review.critique != null) {
    source = review.critique;
  } else {
    const evaluation = review && review.evaluation && typeof review.evaluation === 'object'
      ? review.evaluation : {};
    source = [evaluation.gaps, evaluation.improvement_points]
      .flatMap(value => Array.isArray(value) ? value : (value == null ? [] : [value]));
  }
  const values = Array.isArray(source) ? source : (source == null ? [] : [source]);
  return values.map(value => String(value == null ? '' : value).trim());
}

function attachIssueEvidence(root, evidence, review, options = {}) {
  if (review.pass !== false || options.omitIssueEvidence === true) return;
  const issues = reviewIssueValues(review);
  if (!issues.length) return;
  const rows = review.verification.acceptance_table;
  const issueEvidence = `${evidence}.issue-evidence.${options.canonicalJsonBinding === true ? 'jsonl' : 'md'}`;
  const issueEvidenceFile = path.join(root, issueEvidence);
  const evidenceLines = [];
  let sourceEvidence = IMPLEMENTATION_SOURCE_REL;
  const implementationSourceLines = fs.readFileSync(path.join(root, IMPLEMENTATION_SOURCE_REL), 'utf8')
    .split(/\r?\n/);
  let sourceExcerpt = implementationSourceLines[0];
  let sourceLineNo = 1;
  if (options.selfAuthoredSourceEvidence === true) {
    sourceEvidence = `${evidence}.review-authored-source.md`;
    sourceExcerpt = 'reviewer_claimed_fact=unverified_self_authored_statement';
    const sourceFile = path.join(root, sourceEvidence);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, `${sourceExcerpt}\n`);
    if (Array.isArray(review.verification.evidence)) {
      review.verification.evidence.push({
        kind: 'file',
        path: sourceEvidence,
        summary: '审查方临时新增的自述来源，不得获得独立来源资格',
      });
    }
  } else if (options.predeclaredUnrelatedSourceEvidence === true) {
    sourceExcerpt = UNRELATED_SOURCE_LINE;
    sourceLineNo = rows.length + 1;
  }
  review.verification.issue_evidence = issues.map((issue, issueIndex) => {
    const requestedIndex = Number.isInteger(options.issueAcceptanceIndex)
      ? options.issueAcceptanceIndex : issueIndex;
    const rowIndex = Math.min(Math.max(requestedIndex, 0), rows.length - 1);
    const row = rows[rowIndex];
    if (options.selfAuthoredSourceEvidence !== true
      && options.predeclaredUnrelatedSourceEvidence !== true) {
      sourceLineNo = rowIndex + 1;
      sourceExcerpt = implementationSourceLines[sourceLineNo - 1];
    }
    const recordedIssue = options.omitIssueFromEvidence === true
      ? `UNRELATED_EVIDENCE_FOR_ISSUE_${issueIndex}` : issue;
    const legacyEvidenceLine = [
      `issue=${recordedIssue}`,
      `acceptance_id=${row.acceptance_id}`,
      row.point,
      `核对结果=${row.status}`,
    ].join(' | ');
    let evidenceLine = legacyEvidenceLine;
    if (options.canonicalJsonBinding === true) {
      const bindingReceipt = {
        schema: SUPERVISOR_REVIEW_BINDING_SCHEMA,
        issue: recordedIssue,
        acceptance_id: row.acceptance_id,
        source_hash: row.source_hash,
        required_row_point: row.point,
        '核对结果': row.status,
      };
      if (issueIndex === 0) {
        if (options.canonicalBindingIssueMismatch === true) {
          bindingReceipt.issue = `MISMATCHED_ISSUE_${issueIndex}`;
        }
        if (options.canonicalBindingAcceptanceMismatch === true) {
          bindingReceipt.acceptance_id = 'acc_000000000000000000000000';
        }
        if (options.canonicalBindingHashMismatch === true) {
          bindingReceipt.source_hash = `sha256:${'0'.repeat(64)}`;
        }
        if (options.canonicalBindingPointMismatch === true) {
          bindingReceipt.required_row_point = '任务验收: 与合同无关的验收原文。';
        }
        if (options.canonicalBindingStatusMismatch === true) {
          bindingReceipt['核对结果'] = row.status === '部分' ? '完成' : '部分';
        }
        if (options.canonicalBindingIncludeLegacyDecoy === true) {
          bindingReceipt.legacy_compatibility_decoy = legacyEvidenceLine;
        }
        if (options.canonicalBindingSchemaMismatch === true) {
          bindingReceipt.schema = 'supervisor-review-binding@0';
        }
      }
      evidenceLine = JSON.stringify(bindingReceipt);
      if (issueIndex === 0 && options.canonicalBindingMalformed === true) {
        evidenceLine = evidenceLine.slice(0, -1);
      }
    }
    evidenceLines.push(evidenceLine);
    const mapping = {
      issue_index: issueIndex,
      issue,
      acceptance_id: row.acceptance_id,
      evidence: `${issueEvidence}:${issueIndex + 1}`,
      source_evidence: `${sourceEvidence}:${sourceLineNo}`,
      source_excerpt: sourceExcerpt,
    };
    return mapping;
  });
  fs.mkdirSync(path.dirname(issueEvidenceFile), { recursive: true });
  fs.writeFileSync(issueEvidenceFile, `${evidenceLines.join('\n')}\n`);
  if (Array.isArray(review.verification.evidence)) {
    review.verification.evidence.push({
      kind: 'file',
      path: issueEvidence,
      summary: 'issue_evidence 逐项绑定 issue、acceptance_id 和 requiredRows 行状态',
    });
  }
  if (options.invalidIssueAcceptanceId === true) {
    review.verification.issue_evidence[0].acceptance_id = 'acc_000000000000000000000000';
  }
  if (options.omitSourceExcerpt === true) {
    delete review.verification.issue_evidence[0].source_excerpt;
  }
}

function implementationFailureReceipt(row, options = {}, index = 0) {
  const receipt = {
    schema: IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA,
    acceptance_id: row.acceptance_id,
    source_hash: row.source_hash,
    expected: row.text,
    observed: IMPLEMENTATION_OBSERVED,
    verdict: 'fail',
  };
  if (index === 0) {
    if (options.sourceReceiptSchemaBroken) receipt.schema = 'broken-receipt@0';
    if (options.sourceReceiptAcceptanceMismatch) receipt.acceptance_id = 'acc_000000000000000000000000';
    if (options.sourceReceiptHashMismatch) receipt.source_hash = '0'.repeat(64);
    if (options.sourceReceiptExpectedMismatch) receipt.expected = 'unrelated expected text';
    if (options.sourceReceiptObservedMissing) delete receipt.observed;
    if (options.sourceReceiptPositiveVerdict) receipt.verdict = 'pass';
  }
  return receipt;
}

function makeImplementation(root, taskId, vars, options = {}) {
  const evidence = writeEvidence(root, 'implementation.md', vars.acceptance_contract, 'pass', true);
  const sourceFile = path.join(root, IMPLEMENTATION_SOURCE_REL);
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  const failureReceipts = AcceptanceContract.acceptanceRows(vars.acceptance_contract)
    .map((row, index) => implementationFailureReceipt(row, options, index));
  const sourceLines = failureReceipts.map(receipt => JSON.stringify(receipt));
  fs.writeFileSync(sourceFile, `${sourceLines.concat(UNRELATED_SOURCE_LINE).join('\n')}\n`);
  return {
    done: true,
    summary: 'review routing contract 集成 fixture 已准备',
    changed_files: [evidence, IMPLEMENTATION_SOURCE_REL],
    failure_receipts: options.omitImplementationFailureReceipts === true ? [] : failureReceipts.map((receipt, index) => Object.assign({}, receipt, {
      evidence: `${IMPLEMENTATION_SOURCE_REL}:${index + 1}`,
    })),
    receipt: {
      taskId,
      specFingerprint: vars.spec_fingerprint,
      changedFiles: [evidence, IMPLEMENTATION_SOURCE_REL],
      tests: [`${TEST_COMMAND} exit 0`],
      artifacts: [`${evidence}:1`, `${IMPLEMENTATION_SOURCE_REL}:1`],
      verdict: 'done',
      blocked_required_specs: [],
    },
    acceptance_table: filledRows(vars.acceptance_contract, evidence, true, true),
    logic_chain: {
      summary: '写入可核项目证据并构造机器验收行',
      current_status: 'done',
      actions: ['核实 review routing contract 的实现输入'],
      evidence: [
        { kind: 'file', path: evidence, summary: 'implementation fixture 与 requiredRows 原文一致' },
        { kind: 'file', path: IMPLEMENTATION_SOURCE_REL, summary: 'review 前已由 implementation 声明的独立事实来源' },
      ],
      tests: [{ command: TEST_COMMAND, exit_code: 0, summary: '专项集成回归' }],
      conclusion: '实现 fixture 可供 review 节点核验',
    },
  };
}

function baseVars(root, taskId = 'review-negative-routing-unit', implementationOptions = {}) {
  const vars = {
    projectId: PROJECT_ID,
    goal: '验证合法负向 review 返工路由与伪造/损坏审查失败关闭',
    acceptance: '机器验收合同由 acceptance-contract@1 提供。',
    acceptance_contract: fixtureContract(taskId),
  };
  ProtocolGate.ensureTaskProtocol(vars, { taskId, flow: 'review-loop', projectId: PROJECT_ID });
  vars.implementation = makeImplementation(root, taskId, vars, implementationOptions);
  return vars;
}

function makeReview(root, vars, options = {}) {
  const pass = options.pass === true;
  const verdict = Object.prototype.hasOwnProperty.call(options, 'verdict')
    ? options.verdict
    : (pass ? 'pass' : 'fail');
  if (options.postImplementationSourceMutation === true) {
    const sourceFile = path.join(root, IMPLEMENTATION_SOURCE_REL);
    const lines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);
    const forgedReceipt = JSON.parse(lines[0]);
    forgedReceipt.observed = POST_IMPLEMENTATION_MUTATION_OBSERVED;
    lines[0] = JSON.stringify(forgedReceipt);
    fs.writeFileSync(sourceFile, lines.join('\n'));
  }
  const evidence = options.invalidEvidence
    ? evidenceRel('missing-review-evidence.md')
    : writeEvidence(
      root,
      options.evidenceName || `review-${options.name || (pass ? 'approve' : 'rework')}.md`,
      vars.acceptance_contract,
      verdict || 'unknown',
      options.misalignedEvidence !== true,
    );
  const review = {
    pass,
    severity: options.severity || (pass ? 'low' : 'high'),
    issues: pass ? [] : (options.issues || [`${IMPLEMENTATION_OBSERVED}：验收仍有未满足项，需回到 implement 修复。`]),
    critique: pass ? '全部验收通过' : '验收仍有未满足项，需回到 implement 修复。',
    notes: `核实 changed_files ${evidenceRel('implementation.md')}、${IMPLEMENTATION_SOURCE_REL}; ${TEST_COMMAND} exit 0`,
    lifecycle_status: pass ? 'approved' : 'submitted',
    verification: {
      verdict,
      checked: [
        'implementation.logic_chain',
        'implementation.acceptance_table',
        evidenceRel('implementation.md'),
        IMPLEMENTATION_SOURCE_REL,
      ],
      evidence: [{
        kind: 'file',
        path: evidence,
        summary: `review_verdict=${verdict || 'empty'}; requiredRows 已逐项核对`,
      }],
      acceptance_table: filledRows(
        vars.acceptance_contract,
        evidence,
        pass,
        options.misalignedEvidence !== true,
        options.acceptanceStatuses || options.acceptanceStatus || null,
      ),
    },
  };
  if (options.schemaBroken) review.pass = 'false';
  if (options.omitSeverity) delete review.severity;
  if (options.omitVerdict) delete review.verification.verdict;
  if (options.missingEvidence) delete review.verification.evidence;
  if (options.legacyNotesOnly) {
    delete review.issues;
    delete review.critique;
  }
  if (options.evaluationIssuesOnly) {
    delete review.issues;
    delete review.critique;
    review.evaluation = {
      gaps: [`${IMPLEMENTATION_OBSERVED}：验收仍有未满足项。`],
      improvement_points: [`${IMPLEMENTATION_OBSERVED}：回到 implement 修复该未满足项。`],
    };
  }
  if (options.extraRow) {
    review.verification.acceptance_table.push({
      point: '任务验收: 伪造旁支',
      text: '伪造旁支',
      acceptance_id: 'acc_000000000000000000000000',
      source_hash: '0'.repeat(64),
      scope: PROJECT_SCOPE,
      status: '部分',
      evidence,
      notes: '不得进入 requiredRows',
    });
  }
  if (options.machineTextDrift) {
    review.verification.acceptance_table[0].text = '格式合法但机器原文已被替换。';
  }
  attachIssueEvidence(root, evidence, review, options);
  return review;
}

function classify(root, options) {
  const vars = baseVars(root, `classification-${options.name || 'case'}`, options);
  vars.review = makeReview(root, vars, options);
  return {
    vars,
    result: DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root }),
  };
}

function assertHardBlock(result, reasonPattern) {
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.route, 'hard_block');
  if (reasonPattern) assert.match(result.reason, reasonPattern);
}

function approvedRoutingOptions(root) {
  const approval = {
    schema: REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA,
    feature: REVIEW_ROUTING_CONTRACT_FEATURE,
    status: 'approved',
    ownerApproved: true,
    approvedBy: '主人',
    approvedAt: '2026-07-17T00:00:00.000Z',
    taskId: REVIEW_ROUTING_CONTRACT_APPROVAL_TASK,
    approvedScope: [REVIEW_ROUTING_CONTRACT_FEATURE],
    rollbackPlan: 'fixture only',
    approvalSource: REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL,
    approvalRecordId: `${REVIEW_ROUTING_CONTRACT_FEATURE}:${REVIEW_ROUTING_CONTRACT_APPROVAL_TASK}`,
  };
  const approvalFile = path.join(root, REVIEW_ROUTING_CONTRACT_APPROVAL_REL);
  fs.mkdirSync(path.dirname(approvalFile), { recursive: true });
  fs.writeFileSync(approvalFile, `${JSON.stringify(approval, null, 2)}\n`);
  const trustedFile = path.join(root, REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL);
  fs.mkdirSync(path.dirname(trustedFile), { recursive: true });
  const trusted = {
    schema: CONTROL_PLANE_APPROVAL_SCHEMA,
    recordId: approval.approvalRecordId,
    decision: 'approved',
    approvedBy: approval.approvedBy,
    projectId: PROJECT_ID,
    taskId: approval.taskId,
    feature: approval.feature,
    approvedScope: approval.approvedScope,
    approvedAt: approval.approvedAt,
    rollbackPlan: approval.rollbackPlan,
  };
  fs.writeFileSync(trustedFile, `# Fixture approval\n\n<!-- control-plane-approval@1 ${JSON.stringify(trusted)} -->\n`);
  return { reviewRoutingContractEnabled: true };
}

function readEvents(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function runClassificationCases() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-negative-routing-classification-'));
  try {
    const approved = classify(root, { name: 'approve', pass: true });
    assert.strictEqual(approved.result.ok, true, approved.result.reason);
    assert.strictEqual(approved.result.route, 'approve');

    const rework = classify(root, { name: 'rework', pass: false, severity: 'high' });
    assert.strictEqual(rework.result.ok, true, rework.result.reason);
    assert.strictEqual(rework.result.route, 'rework');
    assert(rework.vars.review.issues.every(issue => typeof issue === 'string' && issue.trim()));
    assert(['low', 'medium', 'high'].includes(rework.vars.review.severity));
    const evidencePath = rework.vars.review.verification.evidence[0].path;
    assert(evidencePath.startsWith('projects/控制台/'));
    assert(fs.existsSync(path.join(root, evidencePath)));
    assert.strictEqual(rework.vars.review.verification.issue_evidence.length, rework.vars.review.issues.length);
    assert(rework.vars.review.verification.issue_evidence.every(binding => /:\d+$/.test(binding.evidence)));
    assert(rework.vars.review.verification.issue_evidence.every(
      binding => binding.source_evidence === `${IMPLEMENTATION_SOURCE_REL}:1`,
    ));
    const sourceReceipt = JSON.parse(rework.vars.review.verification.issue_evidence[0].source_excerpt);
    assert.strictEqual(sourceReceipt.schema, IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA);
    assert.strictEqual(sourceReceipt.acceptance_id, rework.vars.review.verification.acceptance_table[0].acceptance_id);
    assert.strictEqual(sourceReceipt.source_hash, rework.vars.review.verification.acceptance_table[0].source_hash);
    assert.strictEqual(sourceReceipt.expected, rework.vars.review.verification.acceptance_table[0].text);
    assert.strictEqual(sourceReceipt.observed, IMPLEMENTATION_OBSERVED);
    assert.strictEqual(sourceReceipt.verdict, 'fail');
    assert.deepStrictEqual(
      rework.vars.implementation.failure_receipts[0],
      Object.assign({}, sourceReceipt, { evidence: `${IMPLEMENTATION_SOURCE_REL}:1` }),
    );

    const canonicalRework = classify(root, {
      name: 'canonical-jsonl-rework',
      pass: false,
      severity: 'high',
      canonicalJsonBinding: true,
    });
    assert.strictEqual(canonicalRework.result.ok, true, canonicalRework.result.reason);
    assert.strictEqual(canonicalRework.result.route, 'rework');
    const canonicalBindingPointer = canonicalRework.vars.review.verification.issue_evidence[0].evidence;
    const canonicalBindingFile = canonicalBindingPointer.replace(/:\d+$/, '');
    const canonicalBinding = JSON.parse(fs.readFileSync(path.join(root, canonicalBindingFile), 'utf8').trim());
    assert.strictEqual(canonicalBinding.schema, SUPERVISOR_REVIEW_BINDING_SCHEMA);
    assert.strictEqual(canonicalBinding.issue, canonicalRework.vars.review.issues[0]);
    assert.strictEqual(
      canonicalBinding.acceptance_id,
      canonicalRework.vars.review.verification.acceptance_table[0].acceptance_id,
    );
    assert.strictEqual(
      canonicalBinding.source_hash,
      canonicalRework.vars.review.verification.acceptance_table[0].source_hash,
    );
    assert.strictEqual(
      canonicalBinding.required_row_point,
      canonicalRework.vars.review.verification.acceptance_table[0].point,
    );
    assert.strictEqual(
      canonicalBinding['核对结果'],
      canonicalRework.vars.review.verification.acceptance_table[0].status,
    );

    const canonicalBindingMismatchCases = [
      ['issue', 'canonicalBindingIssueMismatch'],
      ['acceptance-id', 'canonicalBindingAcceptanceMismatch'],
      ['source-hash', 'canonicalBindingHashMismatch'],
      ['required-row-point', 'canonicalBindingPointMismatch'],
      ['status', 'canonicalBindingStatusMismatch'],
      ['schema', 'canonicalBindingSchemaMismatch'],
    ];
    for (const [name, option] of canonicalBindingMismatchCases) {
      const mismatch = classify(root, {
        name: `canonical-jsonl-${name}-mismatch`,
        pass: false,
        canonicalJsonBinding: true,
        canonicalBindingIncludeLegacyDecoy: true,
        [option]: true,
      });
      assertHardBlock(mismatch.result, /未同时支持 issue.*acceptance_id.*requiredRows/);
    }

    const malformedCanonicalBinding = classify(root, {
      name: 'canonical-jsonl-malformed-with-legacy-decoy',
      pass: false,
      canonicalJsonBinding: true,
      canonicalBindingIncludeLegacyDecoy: true,
      canonicalBindingMalformed: true,
    });
    assertHardBlock(malformedCanonicalBinding.result, /未同时支持 issue.*acceptance_id.*requiredRows/);

    const realReviewEnvelope = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, rework.vars);
    assert.match(realReviewEnvelope, /"issues":\["observed_route=hard_block_expected_route=rework：每项为非空具体问题"\]/);
    assert.match(realReviewEnvelope, /"issue_evidence":\[/);
    assert.match(realReviewEnvelope, /"source_evidence":/);
    assert.match(realReviewEnvelope, /implementation-failure-receipt@1/);
    assert.match(realReviewEnvelope, /acceptance_id.*source_hash.*expected.*observed.*verdict/s);
    assert.match(realReviewEnvelope, /review 前已由 implementation\.changed_files\/receipt\/acceptance_table\/logic_chain 声明/);

    const legacyNotesOnly = classify(root, { name: 'legacy-notes-only', legacyNotesOnly: true });
    assertHardBlock(legacyNotesOnly.result, /issues\/critique\/evaluation/);

    const evaluationIssuesOnly = classify(root, { name: 'evaluation-issues-only', evaluationIssuesOnly: true });
    assert.strictEqual(evaluationIssuesOnly.result.ok, true, evaluationIssuesOnly.result.reason);
    assert.strictEqual(evaluationIssuesOnly.result.route, 'rework');

    const allCompletedNegative = classify(root, {
      name: 'all-completed-negative',
      acceptanceStatus: '完成',
    });
    assert.strictEqual(allCompletedNegative.result.ok, true, allCompletedNegative.result.reason);
    assert.strictEqual(allCompletedNegative.result.route, 'manual_review');
    assert.match(allCompletedNegative.result.reason, /非视觉验收行均为完成/);

    const normalizedRows = rework.vars.review.verification.acceptance_table;
    const requiredRows = AcceptanceContract.acceptanceRows(rework.vars.acceptance_contract);
    assert.strictEqual(normalizedRows.length, requiredRows.length);
    assert.deepStrictEqual(normalizedRows.map(row => row.text), requiredRows.map(row => row.text));
    assert.deepStrictEqual(normalizedRows.map(row => row.acceptance_id), requiredRows.map(row => row.acceptance_id));

    const schemaBroken = classify(root, { name: 'schema-broken', schemaBroken: true });
    assertHardBlock(schemaBroken.result, /review\.pass.*布尔值/);

    const missingSeverity = classify(root, { name: 'missing-severity', omitSeverity: true });
    assertHardBlock(missingSeverity.result, /缺少 severity/);

    const invalidSeverity = classify(root, { name: 'invalid-severity', severity: 'critical' });
    assertHardBlock(invalidSeverity.result, /有效枚举/);

    const emptyIssue = classify(root, { name: 'empty-issue', issues: [''] });
    assertHardBlock(emptyIssue.result, /每个 issue.*非空/);

    const missingIssueEvidence = classify(root, { name: 'missing-issue-evidence', omitIssueEvidence: true });
    assertHardBlock(missingIssueEvidence.result, /issue_evidence\[\].*结构化映射/);

    const unsupportedIssueEvidence = classify(root, {
      name: 'unsupported-issue-evidence',
      issues: ['UNSUPPORTED_ISSUE_SENTINEL_1784236377579 没有出现在证据行中。'],
      omitIssueFromEvidence: true,
    });
    assertHardBlock(unsupportedIssueEvidence.result, /未同时支持 issue.*acceptance_id.*requiredRows/);

    const selfAuthoredSourceEvidence = classify(root, {
      name: 'self-authored-source-evidence',
      issues: ['SELF_AUTHORED_SOURCE_SENTINEL_1784242098876 不得凭审查方临时复述进入 implement。'],
      selfAuthoredSourceEvidence: true,
    });
    assertHardBlock(selfAuthoredSourceEvidence.result, /review 前 implementation 已声明/);

    const missingSourceExcerpt = classify(root, {
      name: 'missing-source-excerpt',
      omitSourceExcerpt: true,
    });
    assertHardBlock(missingSourceExcerpt.result, /source_excerpt.*原文不一致/);

    const predeclaredUnrelatedSourceEvidence = classify(root, {
      name: 'predeclared-unrelated-source-evidence',
      predeclaredUnrelatedSourceEvidence: true,
    });
    assertHardBlock(predeclaredUnrelatedSourceEvidence.result, /implementation-failure-receipt@1 JSON 行/);

    const tokenOverlapForgery = classify(root, {
      name: 'token-overlap-forgery',
      issues: [`${UNRELATED_SOURCE_CLAIM}：伪造 issue 主动复述无关来源 token。`],
      predeclaredUnrelatedSourceEvidence: true,
    });
    assertHardBlock(tokenOverlapForgery.result, /implementation-failure-receipt@1 JSON 行/);

    const missingFrozenReceipt = classify(root, {
      name: 'missing-frozen-receipt',
      omitImplementationFailureReceipts: true,
    });
    assertHardBlock(missingFrozenReceipt.result, /implementation\.failure_receipts\[\].*implement-time 冻结回执/);

    const postImplementationSourceMutation = classify(root, {
      name: 'post-implementation-source-mutation',
      issues: [`${POST_IMPLEMENTATION_MUTATION_OBSERVED}：review 后改写前置来源不得获得 implement-time 身份。`],
      postImplementationSourceMutation: true,
    });
    assertHardBlock(postImplementationSourceMutation.result, /implementation\.failure_receipts\[\].*逐字段一致/);

    const sourceReceiptSchemaBroken = classify(root, {
      name: 'source-receipt-schema-broken',
      sourceReceiptSchemaBroken: true,
    });
    assertHardBlock(sourceReceiptSchemaBroken.result, /implementation-failure-receipt@1 JSON 行/);

    const sourceReceiptAcceptanceMismatch = classify(root, {
      name: 'source-receipt-acceptance-mismatch',
      sourceReceiptAcceptanceMismatch: true,
    });
    assertHardBlock(sourceReceiptAcceptanceMismatch.result, /acceptance_id\/source_hash/);

    const sourceReceiptHashMismatch = classify(root, {
      name: 'source-receipt-hash-mismatch',
      sourceReceiptHashMismatch: true,
    });
    assertHardBlock(sourceReceiptHashMismatch.result, /acceptance_id\/source_hash/);

    const sourceReceiptExpectedMismatch = classify(root, {
      name: 'source-receipt-expected-mismatch',
      sourceReceiptExpectedMismatch: true,
    });
    assertHardBlock(sourceReceiptExpectedMismatch.result, /expected.*requiredRows text 原文不一致/);

    const sourceReceiptObservedMissing = classify(root, {
      name: 'source-receipt-observed-missing',
      sourceReceiptObservedMissing: true,
    });
    assertHardBlock(sourceReceiptObservedMissing.result, /observed.*具体负向结果/);

    const sourceReceiptPositiveVerdict = classify(root, {
      name: 'source-receipt-positive-verdict',
      sourceReceiptPositiveVerdict: true,
    });
    assertHardBlock(sourceReceiptPositiveVerdict.result, /verdict 必须是负向枚举/);

    const invalidIssueAcceptance = classify(root, {
      name: 'invalid-issue-acceptance',
      invalidIssueAcceptanceId: true,
    });
    assertHardBlock(invalidIssueAcceptance.result, /合同内有效 acceptance_id/);

    const unboundIncomplete = classify(root, {
      name: 'unbound-incomplete',
      acceptanceStatuses: ['完成', '部分', '完成', '完成'],
      issueAcceptanceIndex: 0,
    });
    assertHardBlock(unboundIncomplete.result, /未将任一 issue 绑定到.*部分\/未完成/);

    const missingEvidence = classify(root, { name: 'missing-evidence', missingEvidence: true });
    assertHardBlock(missingEvidence.result, /缺少核实证据/);

    const invalidEvidence = classify(root, { name: 'invalid-evidence', invalidEvidence: true });
    assertHardBlock(invalidEvidence.result, /可核指针|不存在|不可核|项目证据路径/);

    const misalignedEvidence = classify(root, { name: 'misaligned-evidence', misalignedEvidence: true });
    assertHardBlock(misalignedEvidence.result, /证据对不上|缺少可核对齐/);

    const extraRow = classify(root, { name: 'extra-row', extraRow: true });
    assertHardBlock(extraRow.result, /requiredRows 数量\/原文不一致/);

    const machineTextDrift = classify(root, { name: 'machine-text-drift', machineTextDrift: true });
    assertHardBlock(machineTextDrift.result, /requiredRows 数量\/原文不一致/);

    const missingVerdict = classify(root, { name: 'missing-verdict', omitVerdict: true });
    assertHardBlock(missingVerdict.result, /缺少 verification\.verdict 字段/);

    const emptyVerdict = classify(root, { name: 'empty-verdict', verdict: '' });
    assert.strictEqual(emptyVerdict.result.ok, true, emptyVerdict.result.reason);
    assert.strictEqual(emptyVerdict.result.route, 'manual_review');
    assert.match(emptyVerdict.result.reason, /方向矛盾/);

    const positiveVerdict = classify(root, { name: 'positive-verdict', verdict: 'pass' });
    assert.strictEqual(positiveVerdict.result.ok, true, positiveVerdict.result.reason);
    assert.strictEqual(positiveVerdict.result.route, 'manual_review');

    const hardEvidencePass = DoneGate.validateReviewHardEvidence(rework.vars, { workspaceRoot: root });
    assert.strictEqual(hardEvidencePass.ok, true, hardEvidencePass.reason);
    const allCompletedHardEvidence = DoneGate.validateReviewHardEvidence(allCompletedNegative.vars, { workspaceRoot: root });
    assert.strictEqual(allCompletedHardEvidence.ok, true, allCompletedHardEvidence.reason);
    const hardEvidenceReject = DoneGate.validateReviewHardEvidence(missingEvidence.vars, { workspaceRoot: root });
    assert.strictEqual(hardEvidenceReject.ok, false);
    const forgedIssueEvidenceReject = DoneGate.validateReviewHardEvidence(unsupportedIssueEvidence.vars, { workspaceRoot: root });
    assert.strictEqual(forgedIssueEvidenceReject.ok, false);
    const selfAuthoredSourceReject = DoneGate.validateReviewHardEvidence(selfAuthoredSourceEvidence.vars, { workspaceRoot: root });
    assert.strictEqual(selfAuthoredSourceReject.ok, false);
    const tokenOverlapReject = DoneGate.validateReviewHardEvidence(tokenOverlapForgery.vars, { workspaceRoot: root });
    assert.strictEqual(tokenOverlapReject.ok, false);
    const structuredReceiptReject = DoneGate.validateReviewHardEvidence(sourceReceiptHashMismatch.vars, { workspaceRoot: root });
    assert.strictEqual(structuredReceiptReject.ok, false);
    const temporalMutationReject = DoneGate.validateReviewHardEvidence(postImplementationSourceMutation.vars, { workspaceRoot: root });
    assert.strictEqual(temporalMutationReject.ok, false);

    assert.strictEqual(new Set([
      approved.result.route,
      rework.result.route,
      schemaBroken.result.route,
    ]).size, 3, 'approve/rework/hard_block route values must be distinct');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runReworkTargetIntegrationCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-negative-routing-flow-'));
  try {
    const taskId = 'review-negative-routing-flow';
    const vars = baseVars(root, taskId);
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    let implementCount = 0;
    let reviewCount = 0;
    const flow = loadFlow(path.join(workspaceRoot, 'shared/routing/flows/review-loop.yaml'));
    const reworkEdge = flow.edges.find(edge => edge.from === 'review' && edge.to === 'implement');
    assert(reworkEdge, 'review-loop must declare review -> implement rework edge');
    assert.match(reworkEdge.when, /review\.routing == 'rework'/);

    const result = runFlow({
      flow,
      taskId,
      taskstore,
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      ...approvedRoutingOptions(root),
      vars,
      runner(node, ctx) {
        assert.strictEqual(ctx.taskId, taskId);
        if (node.id === 'implement') {
          implementCount += 1;
          return {
            vars: { implementation: makeImplementation(root, taskId, ctx) },
            evidence: { type: 'file', path: evidenceRel('implementation.md') },
          };
        }
        reviewCount += 1;
        const reviewEnvelope = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, ctx);
        assert.match(reviewEnvelope, /"issue_evidence":\[/, 'real review envelope must request issue_evidence');
        assert.match(reviewEnvelope, /"source_evidence":/, 'real review envelope must request independent source evidence');
        assert.match(reviewEnvelope, /implementation-failure-receipt@1/, 'real review envelope must require implementation failure receipt');
        const review = makeReview(root, ctx, {
          pass: reviewCount === 2,
          severity: reviewCount === 1 ? 'high' : 'low',
          evidenceName: `flow-review-${reviewCount}.md`,
        });
        return {
          vars: { review },
          evidence: { type: 'file', path: review.verification.evidence[0].path },
        };
      },
    });
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(implementCount, 2, 'legal negative review must invoke implement again');
    assert.strictEqual(reviewCount, 2);
    assert(events.some(event => event.type === 'review.contract' && event.route === 'rework'));
    assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement'));
    assert(!events.some(event => event.type === 'done_gate.review_hard_block'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runSafetyRouteIntegrationCase(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `review-negative-routing-${kind}-`));
  try {
    const taskId = `review-negative-routing-${kind}`;
    const vars = baseVars(root, taskId);
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const result = runFlow({
      flow: loadFlow(path.join(workspaceRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore: new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks')),
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      ...approvedRoutingOptions(root),
      vars,
      runner(node, ctx) {
        if (node.id === 'implement') return { vars: { implementation: makeImplementation(root, taskId, ctx) } };
        if (kind === 'misaligned') return { vars: { review: makeReview(root, ctx, { misalignedEvidence: true }) } };
        if (kind === 'all-completed') {
          return { vars: { review: makeReview(root, ctx, { acceptanceStatus: '完成' }) } };
        }
        if (kind === 'unsupported-issue') {
          return {
            vars: {
              review: makeReview(root, ctx, {
                issues: ['FLOW_UNSUPPORTED_ISSUE_SENTINEL_1784236377579 不得进入 implement。'],
                omitIssueFromEvidence: true,
              }),
            },
          };
        }
        if (kind === 'self-authored-source') {
          return {
            vars: {
              review: makeReview(root, ctx, {
                issues: ['FLOW_SELF_AUTHORED_SOURCE_SENTINEL_1784242098876 不得进入 implement。'],
                selfAuthoredSourceEvidence: true,
              }),
            },
          };
        }
        if (kind === 'predeclared-unrelated-source') {
          return {
            vars: {
              review: makeReview(root, ctx, {
                predeclaredUnrelatedSourceEvidence: true,
              }),
            },
          };
        }
        if (kind === 'token-overlap') {
          return {
            vars: {
              review: makeReview(root, ctx, {
                issues: [`${UNRELATED_SOURCE_CLAIM}：伪造 issue 主动复述无关来源 token。`],
                predeclaredUnrelatedSourceEvidence: true,
              }),
            },
          };
        }
        return { vars: { review: makeReview(root, ctx, { verdict: kind === 'empty' ? '' : 'pass' }) } };
      },
    });
    const events = readEvents(eventsFile);
    assert(!events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement'));
    if (kind === 'misaligned' || kind === 'unsupported-issue' || kind === 'self-authored-source'
      || kind === 'predeclared-unrelated-source' || kind === 'token-overlap') {
      assert.strictEqual(result.reason, 'review_hard_block');
      assert(events.some(event => event.type === 'done_gate.review_hard_block'));
    } else {
      assert.strictEqual(result.reason, 'awaiting_human');
      assert(events.some(event => event.type === 'done_gate.review_manual_required'));
      assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runClassificationCases();
runReworkTargetIntegrationCase();
runSafetyRouteIntegrationCase('misaligned');
runSafetyRouteIntegrationCase('empty');
runSafetyRouteIntegrationCase('positive');
runSafetyRouteIntegrationCase('all-completed');
runSafetyRouteIntegrationCase('unsupported-issue');
runSafetyRouteIntegrationCase('self-authored-source');
runSafetyRouteIntegrationCase('predeclared-unrelated-source');
runSafetyRouteIntegrationCase('token-overlap');

console.log(JSON.stringify({
  pass: true,
  suite: 'review-negative-routing-contract',
  scenarios: 45,
  routes: ['approve', 'rework', 'hard_block', 'manual_review'],
}));
