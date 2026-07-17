#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DoneGate = require('../shared/engine/done-gate');
const EventLog = require('../shared/engine/eventlog');
const {
  REVIEW_ROUTING_CONTRACT_FEATURE,
  REVIEW_ROUTING_CONTRACT_ENV,
  REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA,
  REVIEW_ROUTING_CONTRACT_APPROVAL_TASK,
  REVIEW_ROUTING_CONTRACT_APPROVAL_REL,
  REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL,
  CONTROL_PLANE_APPROVAL_SCHEMA,
  reviewRoutingContractActivation,
  loadFlow,
  runFlow,
} = require('../shared/engine/engine');
const ProtocolGate = require('../shared/engine/protocol-gate');
const { TaskStore } = require('../shared/engine/taskstore');

const repoRoot = path.resolve(__dirname, '..');
process.env.YUTU6_DONE_GATE_EXECUTE = '0';
delete process.env[REVIEW_ROUTING_CONTRACT_ENV];
const taskPoints = [
  '任务验收: 主人批准前维持未启用状态',
  '任务验收: 被审能力运行开关保持 UNSET 且不得导致生产启用',
  '任务验收: EVIDENCE_ALIGNMENT_SENTINEL_9417 必须逐行对齐',
];
const visualPoint = '视觉/UI证据: not_applicable';
const visualAcceptance = {
  schema: 'visual-acceptance@1',
  acceptance_protocol: 'structured-acceptance@2',
  state: 'not_applicable',
  required: false,
  source: 'task_type',
  priority: 4,
  explicit_visual_requirement: false,
  human_gate_forced: false,
  path_matches: [],
  task_type_positive: false,
  reason: 'review routing contract is a non-visual engine test',
};

function acceptanceText() {
  return [
    '结构化验收表(执行 agent 必须逐行填; done gate 只认表)',
    '验收表协议: structured-acceptance@2',
    '模板: templates/structured-acceptance-table.md',
    '|要点|完成状态(完成/部分/未完成)|证据位置(文件:行 / git diff / 截图路径)|备注|',
    '|---|---|---|---|',
    `|${taskPoints[0]}|未完成|||`,
    `|${taskPoints[1]}|未完成|||`,
    `|${taskPoints[2]}|未完成|||`,
    `|${visualPoint}|not_applicable|task-envelope:visual_acceptance|source=task_type|`,
  ].join('\n');
}

function relEvidence(name) {
  return `projects/控制台/review-routing-fixture/${name}`;
}

function writeEvidence(root, name, content) {
  const rel = relEvidence(name);
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content}\n`);
  return rel;
}

function acceptanceRows(evidence, pass, aligned) {
  const rows = taskPoints.map(point => ({
    point,
    status: pass ? '完成' : '部分',
    evidence,
    notes: aligned ? `${point} 已独立核对` : '项目 fixture 证据已读取',
  }));
  rows.push({
    point: visualPoint,
    status: 'not_applicable',
    evidence: 'task-envelope:visual_acceptance',
    notes: 'source=task_type; non-visual engine fixture',
  });
  return rows;
}

function approvedRoutingContract() {
  const approvalRecordId = `${REVIEW_ROUTING_CONTRACT_FEATURE}:${REVIEW_ROUTING_CONTRACT_APPROVAL_TASK}`;
  return {
    schema: REVIEW_ROUTING_CONTRACT_APPROVAL_SCHEMA,
    feature: REVIEW_ROUTING_CONTRACT_FEATURE,
    status: 'approved',
    ownerApproved: true,
    approvedBy: '主人',
    approvedAt: '2026-07-16T00:00:00.000Z',
    taskId: REVIEW_ROUTING_CONTRACT_APPROVAL_TASK,
    approvedScope: [REVIEW_ROUTING_CONTRACT_FEATURE],
    rollbackPlan: `Set ${REVIEW_ROUTING_CONTRACT_ENV}=0 and restart console workers.`,
    approvalSource: REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL,
    approvalRecordId,
  };
}

function enabledRoutingOptions(root) {
  const approvalFile = path.join(root, REVIEW_ROUTING_CONTRACT_APPROVAL_REL);
  fs.mkdirSync(path.dirname(approvalFile), { recursive: true });
  const approval = approvedRoutingContract();
  fs.writeFileSync(approvalFile, `${JSON.stringify(approval, null, 2)}\n`);
  const trustedFile = path.join(root, REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL);
  fs.mkdirSync(path.dirname(trustedFile), { recursive: true });
  const trustedRecord = {
    schema: CONTROL_PLANE_APPROVAL_SCHEMA,
    recordId: approval.approvalRecordId,
    decision: 'approved',
    approvedBy: approval.approvedBy,
    projectId: '控制台',
    taskId: approval.taskId,
    feature: approval.feature,
    approvedScope: approval.approvedScope,
    approvedAt: approval.approvedAt,
    rollbackPlan: approval.rollbackPlan,
  };
  fs.writeFileSync(
    trustedFile,
    `# Control-plane approvals\n\n<!-- control-plane-approval@1 ${JSON.stringify(trustedRecord)} -->\n`,
  );
  return {
    reviewRoutingContractEnabled: true,
  };
}

function makeImplementation(root, taskId, specFingerprint) {
  const evidence = writeEvidence(root, 'implementation.md', taskPoints.join('\n'));
  return {
    done: true,
    summary: '已建立 review routing contract fixture',
    changed_files: [evidence],
    receipt: {
      taskId,
      specFingerprint,
      changedFiles: [evidence],
      tests: ['node tests/review-routing-contract.test.js exit 0'],
      artifacts: [`${evidence}:1`],
      verdict: 'done',
      blocked_required_specs: [],
    },
    acceptance_table: acceptanceRows(evidence, true, true),
    logic_chain: {
      summary: '构造可核实的项目内 fixture',
      current_status: 'done',
      actions: ['写入项目内证据并保持生产未启用'],
      evidence: [{ kind: 'file', path: evidence, summary: '含 requiredRows 原文' }],
      tests: [{ command: 'node tests/review-routing-contract.test.js', exit_code: 0, summary: 'review routing fixture' }],
      conclusion: '实现节点 fixture 完成',
    },
  };
}

function makeReview(root, options = {}) {
  const pass = options.pass === true;
  const aligned = options.aligned !== false;
  const expectedDirection = pass ? 'pass' : 'fail';
  const summaryDirection = options.summaryDirection || expectedDirection;
  const fileBody = aligned
    ? `${taskPoints.join('\n')}\nreview_verdict=${summaryDirection}`
    : options.unrelatedEvidence === true
      ? `review routing fixture record\nreview_verdict=${summaryDirection}`
      : options.requirementOnlyEvidence === true
        ? [
          'review routing requirement-only record',
          ...Array.from({ length: 20 }, (_, index) => `requirement-only padding ${index + 1}`),
          ...taskPoints,
        ].join('\n')
      : [
        `review routing localized pointer record; review_verdict=${summaryDirection}`,
        ...Array.from({ length: 20 }, (_, index) => `localized pointer padding ${index + 1}`),
        ...taskPoints.map(point => `${point} | 核对结果=部分 | evidence_summary=项目 fixture 已核对`),
      ].join('\n');
  const evidence = writeEvidence(root, options.evidenceName || 'review.md', fileBody);
  const rowEvidence = aligned ? evidence : `${evidence}:1`;
  const review = {
    pass,
    severity: options.severity || 'low',
    critique: options.critique || (pass ? '验收全部满足' : '需继续补强合同证据'),
    notes: `已核对项目证据 ${evidence}; node tests/review-routing-contract.test.js exit 0`,
    verification: {
      verdict: options.verdict || expectedDirection,
      checked: ['implementation.logic_chain', 'implementation.acceptance_table', relEvidence('implementation.md'), ...taskPoints],
      evidence: [{
        kind: 'file',
        path: evidence,
        summary: options.evidenceSummary || `review_verdict=${summaryDirection}; 项目证据已核对`,
      }],
      acceptance_table: acceptanceRows(rowEvidence, pass, aligned),
    },
  };
  if (Object.prototype.hasOwnProperty.call(options, 'lifecycle')) review.lifecycle_status = options.lifecycle;
  return review;
}

function baseVars(root, taskId = 'contract-unit') {
  const vars = {
    projectId: '控制台',
    goal: '验证 review 结构合同与业务 verdict 分层',
    acceptance: acceptanceText(),
    visual_acceptance: Object.assign({}, visualAcceptance),
  };
  ProtocolGate.ensureTaskProtocol(vars, { taskId, flow: 'review-loop', projectId: '控制台' });
  vars.implementation = makeImplementation(root, taskId, vars.spec_fingerprint);
  return vars;
}

function readEvents(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function runContractClassificationCases() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-unit-'));
  try {
    let vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: false, lifecycle: 'submitted' });
    let result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'rework');
    assert.strictEqual(result.warnings.length, 1, 'negative non-substantive alignment error must be a warning');
    assert.strictEqual(result.warnings[0].category, 'non_substantive_local_pointer_heuristic');
    assert.deepStrictEqual(result.warnings[0].misaligned_required_rows, taskPoints);

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: false,
      aligned: false,
      unrelatedEvidence: true,
      lifecycle: 'submitted',
      evidenceName: 'negative-unrelated.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block', 'unrelated evidence must never be downgraded to warning');
    assert.match(result.reason, /证据对不上/);

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: false,
      aligned: false,
      requirementOnlyEvidence: true,
      lifecycle: 'submitted',
      evidenceName: 'negative-requirement-only.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block', 'a requirement restatement without a local result must remain a hard block');
    assert.match(result.reason, /证据对不上/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: true, aligned: true, lifecycle: 'approved', evidenceName: 'positive.md' });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'approve');
    assert.deepStrictEqual(result.warnings, []);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: true, aligned: false, lifecycle: 'approved', evidenceName: 'positive-misaligned.md' });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block', 'positive review alignment errors must remain a hard gate');
    assert.match(result.reason, /证据对不上/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: 'submitted', summaryDirection: 'pass', evidenceName: 'conflict.md' });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'manual_review');
    assert.match(result.reason, /证据摘要.*方向矛盾/);

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: false,
      aligned: true,
      lifecycle: 'submitted',
      evidenceSummary: '所有验收均已通过，证据完整',
      evidenceName: 'natural-positive-summary-conflict.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'manual_review', 'natural positive evidence summary must conflict with pass=false');
    assert.match(result.reason, /证据摘要.*方向矛盾/);

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: true,
      aligned: true,
      lifecycle: 'approved',
      evidenceSummary: '验收存在阻断，未通过',
      evidenceName: 'natural-negative-summary-conflict.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'manual_review', 'negated natural evidence summary must conflict with pass=true');
    assert.match(result.reason, /证据摘要.*方向矛盾/);

    for (const fixture of [
      {
        name: 'negative-quantifier-summary',
        summary: '验收没有全部通过，仍需返工',
      },
      {
        name: 'negative-review-completed-fix-summary',
        summary: '验收未通过，修复已完成，仍需返工',
      },
    ]) {
      vars = baseVars(root);
      vars.review = makeReview(root, {
        pass: false,
        aligned: true,
        lifecycle: 'submitted',
        evidenceSummary: fixture.summary,
        evidenceName: `${fixture.name}.md`,
      });
      result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
      assert.strictEqual(result.ok, true, result.reason);
      assert.strictEqual(result.route, 'rework', `${fixture.name} is a valid negative review, not a direction conflict`);
    }

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: true,
      aligned: true,
      lifecycle: 'approved',
      evidenceSummary: '已验证“验收存在阻断，未通过”会进入人工门路径，证据完整',
      evidenceName: 'quoted-negative-route-example.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'approve', 'a quoted negative route example is not the evidence verdict');

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: false,
      aligned: true,
      lifecycle: 'UNSET',
      summaryDirection: 'pass',
      evidenceName: 'lifecycle-unset-conflict.md',
    });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'hold', 'UNSET lifecycle must precede semantic direction routing');
    assert.match(result.reason, /lifecycle UNSET/);

    vars = baseVars(root);
    vars.review = makeReview(root, {
      pass: false,
      aligned: true,
      lifecycle: 'submitted',
      summaryDirection: 'pass',
      evidenceName: 'missing-row-evidence-conflict.md',
    });
    vars.review.verification.acceptance_table[0].evidence = '';
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block', 'missing required-row evidence must precede semantic direction routing');
    assert.match(result.reason, /证据位置为空/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: 'UNSET', evidenceName: 'lifecycle-unset.md' });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'hold');
    assert.match(result.reason, /lifecycle UNSET/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: '已提交', evidenceName: 'runtime-switch-unset.md' });
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.route, 'rework', 'runtime switch UNSET in requiredRows must not become lifecycle UNSET');

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: 'submitted', evidenceName: 'missing-verdict.md' });
    delete vars.review.verification.verdict;
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block');
    assert.match(result.reason, /verification\.verdict/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: 'submitted', evidenceName: 'short-row.md' });
    vars.review.verification.acceptance_table[0].point = '任务验收: 主人批准前未启用';
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block');
    assert.match(result.reason, /requiredRows/);

    vars = baseVars(root);
    vars.review = makeReview(root, { pass: false, aligned: true, lifecycle: 'submitted', evidenceName: 'outside-project-source.md' });
    const outside = path.join(root, 'shared', 'outside.md');
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, 'review_verdict=fail\n');
    vars.review.verification.evidence = [{ kind: 'file', path: 'shared/outside.md', summary: 'review_verdict=fail' }];
    for (const row of vars.review.verification.acceptance_table) {
      if (row.status !== 'not_applicable') row.evidence = 'shared/outside.md';
    }
    result = DoneGate.validateReviewRoutingContract(vars, { workspaceRoot: root });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.route, 'hard_block');
    assert.match(result.reason, /项目证据路径/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runContinuityCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-continuity-'));
  try {
    const taskId = 'same-task-review-loop';
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const eventlog = new EventLog(eventsFile);
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    const vars = baseVars(root, taskId);
    let implementCount = 0;
    let reviewCount = 0;
    const critiques = ['第一轮 critique 需保持', '第二轮 critique 继续追加'];
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore,
      eventlog,
      workspaceRoot: root,
      ...enabledRoutingOptions(root),
      vars,
      runner(node, ctx) {
        assert.strictEqual(ctx.taskId, taskId, 'taskId must remain stable at every node');
        if (node.id === 'implement') {
          implementCount += 1;
          if (implementCount > 1) {
            assert.strictEqual(ctx.review_loop_history.length, implementCount - 1);
            assert.strictEqual(ctx.review_loop_history[implementCount - 2].critique, critiques[implementCount - 2]);
            assert.strictEqual(ctx.review_critique, critiques[implementCount - 2]);
          }
          return {
            vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) },
            evidence: { type: 'file', path: relEvidence('implementation.md') },
          };
        }
        reviewCount += 1;
        const pass = reviewCount === 3;
        return {
          vars: {
            review: makeReview(root, {
              pass,
              aligned: pass,
              lifecycle: pass ? 'approved' : 'submitted',
              severity: reviewCount === 1 ? 'high' : 'low',
              critique: pass ? '验收全部满足' : critiques[reviewCount - 1],
              evidenceName: `review-${reviewCount}.md`,
            }),
          },
          evidence: { type: 'file', path: relEvidence(`review-${reviewCount}.md`) },
        };
      },
    });

    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(implementCount, 3);
    assert.strictEqual(reviewCount, 3);
    const stored = taskstore.get(taskId);
    assert.strictEqual(stored.id, taskId);
    assert.strictEqual(stored.review_loop_history.length, 3);
    assert.deepStrictEqual(stored.review_loop_history.slice(0, 2).map(item => item.critique), critiques);
    assert.deepStrictEqual(
      { critique: stored.review_loop_history[2].critique, routing: stored.review_loop_history[2].routing, pass: stored.review_loop_history[2].pass },
      { critique: '验收全部满足', routing: 'approve', pass: true },
    );
    assert.deepStrictEqual(stored.visits, { implement: 3, review: 3 });
    const events = readEvents(eventsFile);
    assert(events.every((event, index) => event.seq === index + 1), 'engine-events seq must append continuously');
    assert(events.filter(event => event.task).every(event => event.task === taskId), 'every task event must retain the same taskId');
    assert.strictEqual(events.filter(event => event.type === 'done_gate.review_alignment_warning').length, 2);
    assert.strictEqual(events.filter(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement').length, 2);
    assert(!events.some(event => event.type === 'node.fail' || event.type === 'queue.retry'));
    assert(events.some(event => event.type === 'task.done' && event.task === taskId));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runPausedRouteCase(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `review-contract-${kind}-`));
  try {
    const taskId = `review-contract-${kind}`;
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const eventlog = new EventLog(eventsFile);
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    const vars = baseVars(root, taskId);
    let reviewCount = 0;
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore,
      eventlog,
      workspaceRoot: root,
      ...enabledRoutingOptions(root),
      vars,
      runner(node, ctx) {
        if (node.id === 'implement') return { vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) } };
        reviewCount += 1;
        const review = makeReview(root, {
          pass: false,
          aligned: kind !== 'hard_block_alignment',
          unrelatedEvidence: kind === 'hard_block_alignment',
          lifecycle: kind === 'lifecycle' ? 'UNSET' : 'submitted',
          summaryDirection: kind === 'manual' ? 'pass' : 'fail',
          critique: `${kind} critique`,
          evidenceName: `${kind}-${reviewCount}.md`,
        });
        if (kind === 'hard_block') delete review.verification.verdict;
        return { vars: { review } };
      },
    });
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, false);
    assert(!events.some(event => event.type === 'node.fail' || event.type === 'queue.retry'));
    if (kind === 'hard_block' || kind === 'hard_block_alignment') {
      assert.strictEqual(result.reason, 'review_hard_block');
      assert.strictEqual(result.task.state, 'paused');
      assert(events.some(event => event.type === 'done_gate.review_hard_block'));
    } else if (kind === 'lifecycle') {
      assert.strictEqual(result.reason, 'review_lifecycle_hold');
      assert.strictEqual(result.task.state, 'awaiting_human');
      assert(events.some(event => event.type === 'done_gate.review_lifecycle_hold'));
      assert(!events.some(event => event.type === 'edge.take' && event.from === 'review'));
    } else {
      assert.strictEqual(result.reason, 'awaiting_human');
      assert.strictEqual(result.task.state, 'awaiting_human');
      assert(events.some(event => event.type === 'done_gate.review_manual_required'));
      assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runLoopLimitCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-limit-'));
  try {
    const taskId = 'review-contract-loop-limit';
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    let reviews = 0;
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore,
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      ...enabledRoutingOptions(root),
      vars: baseVars(root, taskId),
      runner(node, ctx) {
        if (node.id === 'implement') return { vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) } };
        reviews += 1;
        return { vars: { review: makeReview(root, {
          pass: false,
          aligned: true,
          lifecycle: 'submitted',
          critique: `limit critique ${reviews}`,
          evidenceName: `limit-${reviews}.md`,
        }) } };
      },
    });
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'awaiting_human');
    assert.strictEqual(reviews, 3, 'max_loops=3 must stop the fourth review');
    assert.strictEqual(taskstore.get(taskId).review_loop_history.length, 3);
    assert(events.some(event => event.type === 'done_gate.review_loop_limit' && event.loop === 3 && event.maxLoops === 3));
    assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
    assert(!events.some(event => event.type === 'node.fail' || event.type === 'queue.retry'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runManualRoutePrecedenceCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-manual-precedence-'));
  try {
    const taskId = 'review-contract-manual-precedence';
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore,
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      ...enabledRoutingOptions(root),
      vars: baseVars(root, taskId),
      loopEngineering: {
        init() {},
        afterReview() {
          return { decision: 'iterate', round: { round: 1, score: 0.1 } };
        },
      },
      runner(node, ctx) {
        if (node.id === 'implement') return { vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) } };
        return { vars: { review: makeReview(root, {
          pass: false,
          aligned: true,
          lifecycle: 'submitted',
          summaryDirection: 'pass',
          critique: '证据方向矛盾必须人工审核',
          evidenceName: 'manual-precedence.md',
        }) } };
      },
    });
    const stored = taskstore.get(taskId);
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'awaiting_human');
    assert.strictEqual(stored.vars.review.routing, 'manual_review');
    assert.strictEqual(stored.review_loop_history[0].routing, 'manual_review');
    assert(events.some(event => event.type === 'done_gate.review_manual_required'));
    assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
    assert(!events.some(event => event.type === 'review.contract.adjusted'));
    assert(!events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runNaturalLanguageSummaryConflictFlowCases() {
  const cases = [
    {
      name: 'positive-summary-negative-verdict',
      pass: false,
      lifecycle: 'submitted',
      summary: '所有验收均已通过，证据完整',
    },
    {
      name: 'negative-summary-positive-verdict',
      pass: true,
      lifecycle: 'approved',
      summary: '验收存在阻断，未通过',
    },
  ];
  for (const fixture of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `review-contract-natural-${fixture.name}-`));
    try {
      const taskId = `review-contract-natural-${fixture.name}`;
      const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
      const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
      const result = runFlow({
        flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
        taskId,
        taskstore,
        eventlog: new EventLog(eventsFile),
        workspaceRoot: root,
        ...enabledRoutingOptions(root),
        vars: baseVars(root, taskId),
        runner(node, ctx) {
          if (node.id === 'implement') {
            return { vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) } };
          }
          return { vars: { review: makeReview(root, {
            pass: fixture.pass,
            aligned: true,
            lifecycle: fixture.lifecycle,
            evidenceSummary: fixture.summary,
            critique: `${fixture.name} 必须进入人工审核`,
            evidenceName: `${fixture.name}.md`,
          }) } };
        },
      });
      const stored = taskstore.get(taskId);
      const events = readEvents(eventsFile);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'awaiting_human');
      assert.strictEqual(stored.id, taskId);
      assert.strictEqual(stored.vars.review.routing, 'manual_review');
      assert.strictEqual(stored.review_loop_history[0].routing, 'manual_review');
      assert(events.every((event, index) => event.seq === index + 1), 'natural-summary flow events must append continuously');
      assert(events.filter(event => event.task).every(event => event.task === taskId), 'natural-summary flow must retain one taskId');
      assert(events.some(event => event.type === 'done_gate.review_manual_required'));
      assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
      assert(!events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement'));
      assert(!events.some(event => event.type === 'node.fail' || event.type === 'queue.retry'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function runValidNaturalLanguageNegativeFlowCases() {
  const cases = [
    {
      name: 'negative-quantifier-summary',
      summary: '验收没有全部通过，仍需返工',
    },
    {
      name: 'negative-review-completed-fix-summary',
      summary: '验收未通过，修复已完成，仍需返工',
    },
  ];
  for (const fixture of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `review-contract-valid-natural-${fixture.name}-`));
    try {
      const taskId = `review-contract-valid-natural-${fixture.name}`;
      const critique = `${fixture.name} critique 必须连续保存`;
      const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
      const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
      let implementCount = 0;
      let reviewCount = 0;
      const result = runFlow({
        flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
        taskId,
        taskstore,
        eventlog: new EventLog(eventsFile),
        workspaceRoot: root,
        ...enabledRoutingOptions(root),
        vars: baseVars(root, taskId),
        runner(node, ctx) {
          assert.strictEqual(ctx.taskId, taskId, 'valid natural negative flow must keep one taskId');
          if (node.id === 'implement') {
            implementCount += 1;
            if (implementCount === 2) {
              assert.strictEqual(ctx.review_loop_history.length, 1);
              assert.strictEqual(ctx.review_loop_history[0].critique, critique);
              assert.strictEqual(ctx.review_loop_history[0].routing, 'rework');
              assert.strictEqual(ctx.review_critique, critique);
            }
            return {
              vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) },
              evidence: { type: 'file', path: relEvidence('implementation.md') },
            };
          }
          reviewCount += 1;
          const pass = reviewCount === 2;
          const evidenceName = `${fixture.name}-${reviewCount}.md`;
          const review = makeReview(root, {
            pass,
            aligned: true,
            lifecycle: pass ? 'approved' : 'submitted',
            evidenceSummary: pass ? '所有验收均已通过，证据完整' : fixture.summary,
            critique: pass ? '合法负向摘要返工后验收通过' : critique,
            evidenceName,
          });
          return {
            vars: { review },
            evidence: { type: 'file', path: relEvidence(evidenceName) },
          };
        },
      });
      const stored = taskstore.get(taskId);
      const events = readEvents(eventsFile);
      assert.strictEqual(result.ok, true, result.reason);
      assert.strictEqual(stored.id, taskId);
      assert.strictEqual(implementCount, 2);
      assert.strictEqual(reviewCount, 2);
      assert.strictEqual(stored.review_loop_history.length, 2);
      assert.deepStrictEqual(
        stored.review_loop_history.map(item => ({ critique: item.critique, routing: item.routing })),
        [
          { critique, routing: 'rework' },
          { critique: '合法负向摘要返工后验收通过', routing: 'approve' },
        ],
      );
      assert(events.every((event, index) => event.seq === index + 1), 'valid natural negative events must append continuously');
      assert(events.filter(event => event.task).every(event => event.task === taskId), 'valid natural negative events must keep one taskId');
      assert.strictEqual(events.filter(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement').length, 1);
      assert(!events.some(event => event.type === 'done_gate.review_manual_required'));
      assert(!events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
      assert(!events.some(event => event.type === 'node.fail' || event.type === 'queue.retry'));
      assert(events.some(event => event.type === 'task.done' && event.task === taskId));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function runDefaultOffLoopLimitCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-default-off-limit-'));
  try {
    const taskId = 'review-contract-default-off-limit';
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const taskstore = new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks'));
    let reviews = 0;
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore,
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      vars: baseVars(root, taskId),
      runner(node, ctx) {
        if (node.id === 'implement') {
          return { vars: { implementation: makeImplementation(root, taskId, ctx.spec_fingerprint) } };
        }
        reviews += 1;
        return { vars: { review: makeReview(root, {
          pass: false,
          aligned: true,
          lifecycle: 'submitted',
          critique: `default-off limit critique ${reviews}`,
          evidenceName: `default-off-limit-${reviews}.md`,
        }) } };
      },
    });
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'awaiting_human');
    assert.strictEqual(reviews, 3, 'inactive contract must retain the finite legacy loop limit');
    assert(events.some(event => event.type === 'done_gate.review_loop_limit'
      && event.loop === 3
      && event.maxLoops === 3
      && event.contractActive === false));
    assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'human'));
    assert(!events.some(event => event.type === 'node.no_edge' || event.type === 'node.fail' || event.type === 'queue.retry'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runActivationGateCase() {
  const ctx = { projectId: '控制台' };
  let activation = reviewRoutingContractActivation({ workspaceRoot: repoRoot }, ctx);
  assert.deepStrictEqual(
    { enabled: activation.enabled, reason: activation.reason },
    { enabled: false, reason: 'feature_flag_disabled' },
    'UNSET feature flag must keep the new routing contract disabled',
  );

  activation = reviewRoutingContractActivation({
    workspaceRoot: repoRoot,
    reviewRoutingContractEnabled: true,
  }, ctx);
  assert.deepStrictEqual(
    { enabled: activation.enabled, reason: activation.reason },
    { enabled: false, reason: 'owner_approval_required' },
    'feature flag alone must not bypass the durable owner approval record',
  );

  const selfDeclaredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-self-declared-'));
  try {
    const approvalFile = path.join(selfDeclaredRoot, REVIEW_ROUTING_CONTRACT_APPROVAL_REL);
    fs.mkdirSync(path.dirname(approvalFile), { recursive: true });
    fs.writeFileSync(approvalFile, `${JSON.stringify(approvedRoutingContract(), null, 2)}\n`);
    activation = reviewRoutingContractActivation({
      workspaceRoot: selfDeclaredRoot,
      reviewRoutingContractEnabled: true,
    }, ctx);
    assert.deepStrictEqual(
      { enabled: activation.enabled, reason: activation.reason },
      { enabled: false, reason: 'owner_approval_required' },
      'a project-owned self-declared approval JSON must not enable the contract without the trusted control-plane record',
    );
  } finally {
    fs.rmSync(selfDeclaredRoot, { recursive: true, force: true });
  }

  const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-approved-gate-'));
  try {
    activation = reviewRoutingContractActivation({
      workspaceRoot: approvedRoot,
      ...enabledRoutingOptions(approvedRoot),
    }, ctx);
    assert.strictEqual(activation.enabled, true, activation.reason);
    assert.strictEqual(activation.approvalSource, REVIEW_ROUTING_CONTRACT_TRUSTED_APPROVAL_REL);
    assert.strictEqual(activation.approvalRecordId, approvedRoutingContract().approvalRecordId);
  } finally {
    fs.rmSync(approvedRoot, { recursive: true, force: true });
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-default-off-'));
  try {
    const taskId = 'review-contract-default-off';
    const eventsFile = path.join(root, 'projects/控制台/artifacts/engine-events.jsonl');
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId,
      taskstore: new TaskStore(path.join(root, 'projects/控制台/artifacts/engine-tasks')),
      eventlog: new EventLog(eventsFile),
      workspaceRoot: root,
      vars: baseVars(root, taskId),
      runner(node, current) {
        if (node.id === 'implement') {
          return { vars: { implementation: makeImplementation(root, taskId, current.spec_fingerprint) } };
        }
        return { vars: { review: makeReview(root, {
          pass: false,
          aligned: false,
          lifecycle: 'submitted',
          evidenceName: 'default-off-localized.md',
        }) } };
      },
    });
    const events = readEvents(eventsFile);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'node_failed', 'inactive contract must preserve the legacy review gate');
    assert(events.some(event => event.type === 'review.contract.inactive'
      && event.reason === 'feature_flag_disabled'
      && event.featureFlag === false
      && event.ownerApproved === false));
    assert(events.some(event => event.type === 'done_gate.review_invalid'));
    assert(!events.some(event => event.type === 'review.contract'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runContractClassificationCases();
runContinuityCase();
runPausedRouteCase('hard_block');
runPausedRouteCase('hard_block_alignment');
runPausedRouteCase('lifecycle');
runPausedRouteCase('manual');
runLoopLimitCase();
runManualRoutePrecedenceCase();
runNaturalLanguageSummaryConflictFlowCases();
runValidNaturalLanguageNegativeFlowCases();
runDefaultOffLoopLimitCase();
runActivationGateCase();

console.log(JSON.stringify({ pass: true, suite: 'review-routing-contract', scenarios: 32 }));
