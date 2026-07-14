#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DoneGate = require('../shared/engine/done-gate');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');

const repoRoot = path.resolve(__dirname, '..');

function baseImplementation(changedFiles = []) {
  return {
    done: true,
    summary: 'hard done gate fixture implementation',
    changed_files: changedFiles,
    logic_chain: {
      summary: 'fixture did real work',
      current_status: 'done',
      actions: ['validated done gate behavior'],
      evidence: [{ kind: 'test', command: 'node tests/done-gate.test.js', exit_code: 0, summary: 'done gate regression test' }],
      tests: [{ command: 'node tests/done-gate.test.js', exit_code: 0, summary: 'done gate regression test' }],
      conclusion: 'fixture is complete',
    },
  };
}

function baseReview(changedFiles = []) {
  return {
    pass: true,
    severity: 'low',
    notes: `hard review verified logic_chain and changed_files ${changedFiles.join(', ')}; node tests/done-gate.test.js exit 0`,
    verification: {
      verdict: 'true',
      checked: ['implementation.logic_chain', 'implementation.changed_files', ...changedFiles],
      evidence: [{ kind: 'test', command: 'node tests/done-gate.test.js', exit_code: 0, summary: 'review verified done gate fixture' }],
    },
  };
}

function structuredAcceptance(goal, acceptance) {
  return DoneGate.buildStructuredAcceptanceTable({
    goal,
    acceptance,
    workspaceRoot: repoRoot,
    decisionsFile: path.join(repoRoot, 'memory', 'decisions.md'),
  });
}

function fillAcceptanceRows(acceptance, opts = {}) {
  const rows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  return rows.map((row, index) => ({
    point: row.point,
    status: Object.prototype.hasOwnProperty.call(opts, 'status') && index === (opts.index || 0)
      ? opts.status
      : '完成',
    evidence: Object.prototype.hasOwnProperty.call(opts, 'evidence') && index === (opts.index || 0)
      ? opts.evidence
      : acceptanceEvidenceForRow(row),
    notes: opts.notes || 'fixture row evidence is verifiable',
  }));
}

function acceptanceEvidenceForRow(row) {
  const point = String(row && row.point || '');
  const m = point.match(/decisions\.md:(\d+)/i);
  if (m) return `memory/decisions.md:${m[1]}`;
  return 'tests/done-gate.test.js';
}

function structuredImplementation(acceptance, opts = {}) {
  const implementation = baseImplementation(['tests/done-gate.test.js']);
  implementation.acceptance_table = fillAcceptanceRows(acceptance, opts);
  return implementation;
}

function structuredReview(acceptance, opts = {}) {
  const review = baseReview(['tests/done-gate.test.js']);
  review.verification.checked = review.verification.checked.concat(['implementation.acceptance_table']);
  review.verification.acceptance_table = fillAcceptanceRows(acceptance, opts);
  return review;
}

function withVisualFixtureEvidence(fn) {
  const root = fs.mkdtempSync(path.join(repoRoot, '.tmp-done-gate-visual-'));
  const screenshot = path.join(root, 'peekaboo-current.png');
  const codexReport = path.join(root, 'codex-scope-review.md');
  fs.writeFileSync(screenshot, 'fixture image placeholder\n');
  fs.writeFileSync(codexReport, 'codex fixture review\n');
  try {
    return fn({
      evidence: `${screenshot}; ${codexReport}; node tests/done-gate.test.js exit 0`,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function filledAcceptanceRowsWithEvidence(acceptance, evidence, notes) {
  return DoneGate.parseStructuredAcceptanceRows(acceptance).map(row => ({
    point: row.point,
    status: '完成',
    evidence: /decisions\.md:\d+/i.test(row.point)
      ? `${acceptanceEvidenceForRow(row)}; ${evidence}`
      : evidence,
    notes,
  }));
}

function reviewLoopTask(vars) {
  return {
    id: 'fixture-task',
    flow: 'review-loop',
    state: 'done',
    vars,
    evidence: [{ type: 'result', path: path.join(repoRoot, 'tests', 'done-gate.test.js') }],
    visits: { implement: 1, review: 1 },
    completed_steps: ['implement#1', 'review#1'],
    last_completed_node: 'review',
    steps: {},
  };
}

function testNoLogicChainCannotReachReview() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-flow-'));
  try {
    const events = [];
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
    const visited = [];
    const result = runFlow({
      flow,
      taskId: 'no-logic-chain',
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
      workspaceRoot: repoRoot,
      vars: { goal: '只读分析任务', acceptance: '不改任何文件' },
      runner(node) {
        visited.push(node.id);
        if (node.id === 'implement') {
          return { vars: { implementation: { done: true, summary: 'fake done', changed_files: [] } } };
        }
        return { vars: { review: baseReview() } };
      },
    });
    assert.strictEqual(result.ok, false, 'missing logic chain must fail');
    assert.deepStrictEqual(visited, ['implement'], 'missing logic chain must not enter review');
    assert(events.some(e => e.type === 'done_gate.logic_chain_missing'), 'missing logic-chain gate event');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testReviewFailCannotDone() {
  const task = reviewLoopTask({
    goal: '只读分析任务',
    acceptance: '不改任何文件',
    implementation: baseImplementation(),
    review: Object.assign(baseReview(), { pass: false, severity: 'high', notes: 'verified false' }),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: false,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /review\.pass 未通过/);
}

function testClaimedMissingFileCannotDone() {
  const missing = 'projects/控制台/__missing_done_gate_fixture__.js';
  const task = reviewLoopTask({
    goal: '修复控制台源码',
    acceptance: '必须有 changed_files',
    implementation: baseImplementation([missing]),
    review: baseReview([missing]),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /声明文件不存在/);
}

function testAnalysisTaskCanPassWithEvidenceNoChangedFiles() {
  const task = reviewLoopTask({
    goal: '只读分析任务',
    acceptance: '不改任何文件,给结论和依据',
    implementation: baseImplementation(),
    review: baseReview(),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: false,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testStructuredAcceptanceHeaderDoesNotForceDeliveryEvidence() {
  const acceptance = structuredAcceptance(
    '只读重试机制烟测',
    'retry smoke completes',
  );
  assert.strictEqual(
    DoneGate.deliveryEvidenceRequiredFromText('只读重试机制烟测', acceptance),
    false,
    'structured table header must not make analysis/smoke tasks look like delivery work',
  );
}

function testPlainResearchTaskDoesNotInjectUnrelatedDecisionRows() {
  const goal = [
    '项目主管(控制台)执行 CEO brief。原始目标:',
    '研究 cc-connect 桥接借鉴点(通用手机客户端用)',
    '',
    'cc-connect(chenhg5)把 AI 编程 agent 双向桥接到飞书/微信/Telegram/钉钉等消息平台,手机随时随地对话、多数平台无需公网 IP。',
    '研究相对玉兔6(现仅 hermes 单向飞书通知)可借鉴的优点:①双向指令(手机发→玉兔6执行→回复);②手机远程派单/看进度;③无需公网IP的连接方式。',
  ].join('\n');
  const acceptance = structuredAcceptance(
    goal,
    '在 控制台 项目 scope 内跑 review-loop; 完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。',
  );
  const rows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  assert.strictEqual(
    rows.some(row => /^设计对照/.test(row.point)),
    false,
    'plain research tasks must not auto-inject unrelated decisions.md rows',
  );
  assert(!acceptance.includes('memory/decisions.md:504'), 'must not inject old agent-infra board-review memory row');
  assert(rows.some(row => row.point.includes('在 控制台 项目 scope 内跑 review-loop')));
  assert(rows.some(row => row.point.includes('更新 projects/控制台/status.md')));
}

function queueMergeImplementation() {
  const impl = baseImplementation(['tests/queue-organizer.test.js']);
  impl.logic_chain.actions = ['ran CEO queue merge hard regression'];
  impl.logic_chain.evidence = [
    {
      kind: 'analysis',
      command: 'node tests/queue-organizer.test.js',
      exit_code: 0,
      summary: 'queue_organize merged_from/reviewChecklist preserved requirements; planned_cancel reduced queued_after; running 只读不动; apply is 幂等',
    },
  ];
  impl.logic_chain.tests = [
    { command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'PASS queue merge integrity, state migration, idempotency, running read-only' },
    { command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'PASS secretary path goes through CEO queue-control and direct writes are rejected' },
  ];
  return impl;
}

function queueMergeReview() {
  const review = baseReview(['tests/queue-organizer.test.js']);
  review.verification.checked = [
    'node tests/queue-organizer.test.js',
    'node tests/ceo-queue-control.test.js',
    'queue_organize merged_from/reviewChecklist',
    'planned_cancel and queued_after prove task count decreased',
  ];
  review.verification.evidence = [
    { kind: 'test', command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'PASS preserved requirements, 状态迁移, 幂等, running 只读' },
    { kind: 'test', command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'PASS secretary no direct queue write and CEO control audit' },
  ];
  return review;
}

function testQueueMergeTaskRequiresHardRegressionTests() {
  const task = reviewLoopTask({
    goal: 'CEO 队列整理: 合并同类任务, 确保合并后任务数减少且被合并需求保留',
    acceptance: '必须通过 queue-organizer/queue-control 硬测试',
    implementation: baseImplementation(['tests/queue-organizer.test.js']),
    review: baseReview(['tests/queue-organizer.test.js']),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /硬回归测试覆盖不足/);
}

function testQueueMergeHardRegressionCoveragePasses() {
  const task = reviewLoopTask({
    goal: 'CEO 队列整理: 合并同类任务, 确保合并后任务数减少且被合并需求保留',
    acceptance: '必须通过 queue-organizer/queue-control 硬测试',
    implementation: queueMergeImplementation(),
    review: queueMergeReview(),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(required.some(rule => rule.id === 'queue_merge_integrity'));
}

function testQueueMergeHardRegressionReadsReferencedEvidenceArtifact() {
  const root = fs.mkdtempSync(path.join(repoRoot, '.tmp-done-gate-hard-regression-'));
  try {
    const artifact = path.join(root, 'queue-merge-evidence.md');
    fs.writeFileSync(artifact, [
      '# Queue Merge Integrity Evidence',
      '',
      '- `queue_organize` writes `merged_from` and `reviewChecklist` for merged requirements.',
      '- `planned_cancel=1` and `queued_after=before-1` prove task count reduction.',
      '- 被合并需求保留, canceled/paused 状态迁移, repeated apply is 幂等, and running 只读不动.',
    ].join('\n'));
    const relArtifact = path.relative(repoRoot, artifact).split(path.sep).join('/');

    const implementation = baseImplementation(['tests/done-gate.test.js']);
    implementation.logic_chain.evidence = [
      { kind: 'file', path: relArtifact, summary: 'hard regression artifact contains queue merge integrity details' },
    ];
    implementation.logic_chain.tests = [
      { command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'queue organizer hard regression passed' },
      { command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'ceo queue control hard regression passed' },
    ];

    const review = baseReview(['tests/done-gate.test.js']);
    review.verification.checked = [
      relArtifact,
      'node tests/queue-organizer.test.js',
      'node tests/ceo-queue-control.test.js',
    ];
    review.verification.evidence = [
      { kind: 'file', path: relArtifact, summary: 'review checked the referenced queue merge artifact' },
      { kind: 'test', command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: 'pass' },
      { kind: 'test', command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: 'pass' },
    ];

    const task = reviewLoopTask({
      goal: 'CEO 队列整理: 合并同类任务, 确保合并后任务数减少且被合并需求保留',
      acceptance: '必须通过 queue-organizer/queue-control 硬测试',
      implementation,
      review,
    });
    const gate = DoneGate.validateReviewLoopCompletion(task, {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, true, gate.reason);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testLowPriorityPageReviewDoesNotTriggerQueueMergeRegression() {
  const task = reviewLoopTask({
    goal: '定时页面评审: 当没有任务运行时, 让设计师 + 自优化工程师低优先级入队; 评审任务为低优先级, 可被用户任务抢占。',
    acceptance: '完成后更新 projects/控制台/status.md',
    implementation: baseImplementation(['projects/控制台/status.md']),
    review: baseReview(['projects/控制台/status.md']),
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'ordinary low-priority page review must not trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testQueueIdDedupAdviceDoesNotTriggerQueueMergeRegression() {
  const task = reviewLoopTask({
    goal: [
      'workspace-ui-a11y 自省优化: 任务进展行、running bar、模型用量额度窗口要有完整状态结构。',
      '轻微风险: 队列概览中已有 secretary running 的同目标 self-reflect 任务，应由主管执行前按 rootTaskId cr-1782936393940-067d2b90 / queueId 067d2b90 去重核对，避免同一案例重复入队或重复写 learning_case.appended。',
      '事件日志建议记录 source case title、module=workspace-ui-a11y、rootTaskId/rootQueueId，便于后续董事会和秘书追踪去重。',
    ].join('\n'),
    acceptance: '在 控制台 项目 scope 内跑 review-loop;完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。',
    implementation: baseImplementation(['projects/控制台/status.md', 'board/status-rollup.md']),
    review: baseReview(['projects/控制台/status.md', 'board/status-rollup.md']),
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'queueId/rootQueueId dedup advice must not trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testCeoRankingAdviceDoesNotTriggerQueueMergeRegression() {
  const task = reviewLoopTask({
    goal: [
      '研究开源项目 agent-infra + 对比玉兔6 + 吸收优秀设计',
      "GLM-5.2 董事: 对比表增加'迁移成本/时间线(短期/中长期)'列,辅助 CEO 排吸收优先级",
      '只读研究,不强行照搬,保稳定',
    ].join('\n'),
    acceptance: '在 board/ 下产出研究文档,完成后更新 projects/控制台/status.md',
    implementation: baseImplementation(['projects/控制台/status.md']),
    review: baseReview(['projects/控制台/status.md']),
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'CEO ranking advice must not trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testFrontendReviewChecklistDoesNotTriggerQueueMergeRegression() {
  const implementation = baseImplementation(['projects/控制台/status.md']);
  implementation.summary = '核验控制台 MERGE-2 前端渲染架构治理已落盘并通过回归';
  implementation.logic_chain.actions = [
    '核验前端 reviewChecklist、根因报告、多轮优化日志和 e1340f1e 引用区',
    '更新 projects/控制台/status.md',
  ];
  implementation.logic_chain.evidence = [
    {
      kind: 'file',
      path: 'projects/控制台/artifacts/architecture/frontend-render-reviewChecklist-20260623.md',
      summary: '前端质量 reviewChecklist, frontend-only artifact',
    },
  ];
  implementation.logic_chain.tests = [
    { command: 'node tests/workspace-render-architecture.test.js', exit_code: 0, summary: 'PASS frontend render architecture' },
  ];
  const review = baseReview(['projects/控制台/status.md']);
  review.notes = 'MERGE-2 前端渲染架构治理复验收口通过, reviewChecklist 只用于前端质量证据收拢';
  review.verification.checked = [
    'projects/控制台/status.md',
    'projects/控制台/artifacts/architecture/frontend-render-reviewChecklist-20260623.md',
  ];
  review.verification.evidence = [
    {
      kind: 'file',
      path: 'projects/控制台/artifacts/architecture/frontend-render-reviewChecklist-20260623.md',
      summary: '前端复审清单存在',
    },
    { kind: 'test', command: 'node tests/workspace-render-architecture.test.js', exit_code: 0, summary: 'PASS' },
  ];
  const task = reviewLoopTask({
    goal: [
      '系统性架构检查 + 网页反复出问题的根因',
      'Queue organization merge note: MERGE-2 前端渲染架构根因治理吸收链路图与图标回归需求',
      'Queue organization preserved requirements: reviewChecklist 固定包含三方证据区、e1340f1e 发现引用区、根因报告、性能基线、测试命令输出、回滚说明',
    ].join('\n'),
    acceptance: '链路图不闪、无遮挡、模块折叠; 完成后更新 projects/控制台/status.md',
    implementation,
    review,
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'frontend reviewChecklist metadata must not trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testExtraQueueRegressionTestsDoNotSelfTriggerQueueMergeRegression() {
  const implementation = baseImplementation(['projects/控制台/status.md']);
  implementation.summary = '洞察员自动研究链路复核完成,zhipu-glm 质量继续观察中';
  implementation.logic_chain.summary = '补跑 done-gate 点名缺失的队列相关测试,并完成 review-loop/全量/serial smoke 验证';
  implementation.logic_chain.actions = [
    '复核 seen-repos.json 去重状态、insights 文件节拍、engine-events 中 insight_scout 事件',
    '补跑 queue-organizer 与 ceo-queue-control 测试作为额外回归',
  ];
  implementation.logic_chain.evidence = [
    { kind: 'file', path: 'projects/控制台/status.md', summary: '新增洞察员链路复核记录' },
  ];
  implementation.logic_chain.tests = [
    { command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: '{"pass":true,"suite":"queue-organizer"}' },
    { command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: '{"pass":true,"suite":"ceo-queue-control"}' },
  ];

  const review = baseReview(['projects/控制台/status.md']);
  review.notes = '洞察员自动研究链路复核通过;queue-organizer 与 ceo-queue-control 只是额外测试核验,不是队列合并任务';
  review.verification.evidence = [
    { kind: 'file', path: 'projects/控制台/status.md', summary: '记录存在' },
    { kind: 'test', command: 'node tests/queue-organizer.test.js', exit_code: 0, summary: '{pass:true}' },
    { kind: 'test', command: 'node tests/ceo-queue-control.test.js', exit_code: 0, summary: '{pass:true}' },
  ];

  const task = reviewLoopTask({
    goal: [
      '复核洞察员每 4 小时自动研究链路已经恢复',
      '后续观察真实 zhipu-glm 运行质量',
      '明确 seen-repos 去重逻辑和样本抽检口径',
    ].join('\n'),
    acceptance: '在 控制台 项目 scope 内跑 review-loop;完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。',
    implementation,
    review,
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'extra queue regression commands must not self-trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testRoleQueueLifecycleProposalDoesNotTriggerQueueMergeRegression() {
  const task = reviewLoopTask({
    goal: [
      '待拍板: 角色边界与空转队列归档策略',
      '自省发现: config 注册 22 个角色,但 reasoning_architect / worker_narrow / hr_specialist 当前无真实完成记录; zhipu_designer、board_gpt55、secretary-smoke、memory_officer 属历史/别名队列; memory-officer 与 memory_officer 命名并存。',
      '建议拍板: 1) 保留为预留工位; 2) 归档/隐藏历史队列; 3) 合并命名别名并保留只读历史。影响: UI 展示和队列发现语义,需主人确认。',
      '要求统一状态枚举(active/reserved/archived/hidden)及 UI、发现、搜索三维度可见性矩阵。',
    ].join('\n'),
    acceptance: '完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。',
    implementation: baseImplementation(['projects/控制台/status.md', 'board/status-rollup.md']),
    review: baseReview(['projects/控制台/status.md', 'board/status-rollup.md']),
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(!required.some(rule => rule.id === 'queue_merge_integrity'), 'proposal-only role/queue lifecycle policy must not trigger queue merge hard regression');
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testStructuredAcceptanceTablePassesWhenFilled() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testStructuredAcceptanceUsesTemplateReference() {
  const template = DoneGate.readStructuredAcceptanceTemplate({ workspaceRoot: repoRoot });
  assert.match(template, /\| 要点 \| 完成状态\(完成\/部分\/未完成\) \| 证据位置/);
  assert.strictEqual(
    DoneGate.structuredAcceptanceTemplateReference({ workspaceRoot: repoRoot }),
    'templates/structured-acceptance-table.md',
  );
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过',
  );
  assert.match(acceptance, /模板: templates\/structured-acceptance-table\.md/);
  assert(DoneGate.parseStructuredAcceptanceRows(acceptance).length >= 1, 'template reference must not break row parsing');
}

function testStructuredAcceptanceTableRejectsBlankEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { evidence: '' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /证据位置为空|证据不可核/);
}

function testStructuredAcceptanceTableRejectsMismatchedEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { evidence: 'projects/控制台/__missing_done_gate_evidence__.png' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /证据不可核|不存在/);
}

function testStructuredAcceptanceTableRejectsExistingUnrelatedEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '结构化验收表机制上线; 填齐才过; 留空打回',
  );
  const taskRows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  const taskRowIndex = taskRows.findIndex(row => /^任务验收:/.test(row.point));
  assert(taskRowIndex >= 0, 'fixture must contain a task acceptance row');
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { index: taskRowIndex, evidence: 'shared/engine/queue.js' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /证据对不上/);
}

function testStructuredAcceptanceTableRejectsDesignRowWithoutDecisionLineEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回',
  );
  const designRowIndex = DoneGate.parseStructuredAcceptanceRows(acceptance)
    .findIndex(row => /^设计对照/.test(row.point));
  assert(designRowIndex >= 0, 'fixture must contain a design row');
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { index: designRowIndex, evidence: 'tests/done-gate.test.js' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /decisions\.md:1|证据对不上/);
}

function testStructuredAcceptancePlaceholderWordsNeedTokenBoundaries() {
  const acceptance = structuredAcceptance(
    'LiteLLM canary 分析, 对照 memory/decisions.md 第1行',
    '在 控制台 项目 scope 内跑 review-loop',
  );
  const notes = '后续 canary 条件保留; serial smoke pass=true, nodeOverlap=null。';
  const task = reviewLoopTask({
    goal: 'LiteLLM canary 分析, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { notes }),
    review: structuredReview(acceptance, { notes }),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

function testStructuredAcceptanceRejectsStandalonePlaceholderEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { evidence: 'null' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /使用不可核声明作证据|证据不可核/);
}

function testStructuredAcceptanceRejectsOnlyStatementNotes() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    '填齐才过; 留空打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第1行',
    acceptance,
    implementation: structuredImplementation(acceptance, { notes: '只写声明' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /使用不可核声明作证据/);
}

function testVisualStructuredAcceptanceAllowsDisclosureStatementNotes() {
  withVisualFixtureEvidence(({ evidence }) => {
    const acceptance = structuredAcceptance(
      'UI 只读评估',
      '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
    );
    const notes = '本轮声明未改运行代码、未新采集截图、未下载权重；复用既有离线样本策略。';
    const acceptanceTable = filledAcceptanceRowsWithEvidence(acceptance, evidence, notes);
    const implementation = baseImplementation(['tests/done-gate.test.js']);
    implementation.acceptance_table = acceptanceTable;
    const review = baseReview(['tests/done-gate.test.js']);
    review.verification.checked = review.verification.checked.concat(['implementation.acceptance_table']);
    review.verification.acceptance_table = acceptanceTable;
    const task = reviewLoopTask({
      goal: 'UI 只读评估',
      acceptance,
      implementation,
      review,
    });
    const gate = DoneGate.validateReviewLoopCompletion(task, {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, true, gate.reason);
  });
}

function testAutoVisualRowDoesNotForceDecisionRows() {
  withVisualFixtureEvidence(({ evidence }) => {
    const goal = [
      '项目主管(控制台)执行 CEO brief。原始目标:',
      '请 CEO/主管判断是否起草《控制台 a11y 组件行为清单 v0》：从 WAI-ARIA APG 与 React Aria 提炼按钮、菜单、tabs、combobox、dialog 等高频控件的 role/name/state/focus/keyboard 验收项，作为控制台前端人工自查和 computer-use grounding 门禁。',
    ].join('\n');
    const acceptance = structuredAcceptance(
      goal,
      '在 控制台 项目 scope 内跑 review-loop; 完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。',
    );
    assert(!acceptance.includes('decisions.md:'), 'auto visual row alone must not inject decisions.md rows');
    assert(acceptance.includes('视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告'));

    const acceptanceTable = DoneGate.parseStructuredAcceptanceRows(acceptance).map(row => {
      const point = String(row.point || '');
      if (/review-loop/.test(point)) {
        return {
          point,
          status: '完成',
          evidence: 'tests/done-gate.test.js; node tests/done-gate.test.js exit 0',
          notes: '控制台 scope review-loop fixture PASS',
        };
      }
      if (/status\.md|status-rollup/.test(point)) {
        return {
          point,
          status: '完成',
          evidence: 'projects/控制台/status.md; board/status-rollup.md; tests/done-gate.test.js',
          notes: 'status.md and board/status-rollup.md evidence pointers are present',
        };
      }
      return {
        point,
        status: '完成',
        evidence,
        notes: 'peekaboo screenshot and Codex review report are present',
      };
    });
    const implementation = baseImplementation(['tests/done-gate.test.js']);
    implementation.acceptance_table = acceptanceTable;
    const review = baseReview(['tests/done-gate.test.js']);
    review.verification.checked = review.verification.checked.concat(['implementation.acceptance_table']);
    review.verification.acceptance_table = acceptanceTable;
    const task = reviewLoopTask({
      goal,
      acceptance,
      implementation,
      review,
    });
    const gate = DoneGate.validateReviewLoopCompletion(task, {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, true, gate.reason);
  });
}

function testVisualStructuredAcceptanceRequiresPeekabooAndCodex() {
  const acceptance = structuredAcceptance(
    'UI 页面调整, 对照 memory/decisions.md 第1行, 必须截图自验',
    '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
  );
  const task = reviewLoopTask({
    goal: 'UI 页面调整, 对照 memory/decisions.md 第1行, 必须截图自验',
    acceptance,
    implementation: structuredImplementation(acceptance),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /peekaboo 截图|Codex/);
}

function testVisualStructuredAcceptanceRejectsFailureMarkerPlusUnrelatedImage() {
  const root = fs.mkdtempSync(path.join(repoRoot, '.tmp-done-gate-visual-failure-'));
  const failureMarker = path.join(root, 'peekaboo-current-failure.json');
  const unrelatedImage = path.join(root, 'workspace-after.png');
  const codexReport = path.join(root, 'codex-scope-review.md');
  fs.writeFileSync(failureMarker, JSON.stringify({
    ok: false,
    error: { code: 'CAPTURE_FAILED', message: 'No displays available for capture' },
  }, null, 2));
  fs.writeFileSync(unrelatedImage, 'fixture unrelated image placeholder\n');
  fs.writeFileSync(codexReport, 'codex fixture review\n');
  try {
    const acceptance = structuredAcceptance(
      'UI 页面调整, 对照 memory/decisions.md 第1行, 必须截图自验',
      '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
    );
    const evidence = [
      `peekaboo screenshot path: ${failureMarker}`,
      `visual reference: ${unrelatedImage}`,
      `Codex report: ${codexReport}`,
      'node tests/done-gate.test.js exit 0',
    ].join('; ');
    const acceptanceTable = filledAcceptanceRowsWithEvidence(acceptance, evidence, 'failure marker is diagnostic only');
    const implementation = baseImplementation(['tests/done-gate.test.js']);
    implementation.acceptance_table = acceptanceTable;
    const review = baseReview(['tests/done-gate.test.js']);
    review.verification.checked = review.verification.checked.concat(['implementation.acceptance_table']);
    review.verification.acceptance_table = acceptanceTable;
    const task = reviewLoopTask({
      goal: 'UI 页面调整, 对照 memory/decisions.md 第1行, 必须截图自验',
      acceptance,
      implementation,
      review,
    });
    const gate = DoneGate.validateReviewLoopCompletion(task, {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, false);
    assert.match(gate.reason, /failure\.json|截图失败标记|peekaboo 图片截图/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testNoLogicChainCannotReachReview();
testReviewFailCannotDone();
testClaimedMissingFileCannotDone();
testAnalysisTaskCanPassWithEvidenceNoChangedFiles();
testStructuredAcceptanceHeaderDoesNotForceDeliveryEvidence();
testPlainResearchTaskDoesNotInjectUnrelatedDecisionRows();
testQueueMergeTaskRequiresHardRegressionTests();
testQueueMergeHardRegressionCoveragePasses();
testQueueMergeHardRegressionReadsReferencedEvidenceArtifact();
testLowPriorityPageReviewDoesNotTriggerQueueMergeRegression();
testQueueIdDedupAdviceDoesNotTriggerQueueMergeRegression();
testCeoRankingAdviceDoesNotTriggerQueueMergeRegression();
testFrontendReviewChecklistDoesNotTriggerQueueMergeRegression();
testExtraQueueRegressionTestsDoNotSelfTriggerQueueMergeRegression();
testRoleQueueLifecycleProposalDoesNotTriggerQueueMergeRegression();
testStructuredAcceptanceUsesTemplateReference();
testStructuredAcceptanceTablePassesWhenFilled();
testStructuredAcceptanceTableRejectsBlankEvidence();
testStructuredAcceptanceTableRejectsMismatchedEvidence();
testStructuredAcceptanceTableRejectsExistingUnrelatedEvidence();
testStructuredAcceptanceTableRejectsDesignRowWithoutDecisionLineEvidence();
testStructuredAcceptancePlaceholderWordsNeedTokenBoundaries();
testStructuredAcceptanceRejectsStandalonePlaceholderEvidence();
testStructuredAcceptanceRejectsOnlyStatementNotes();
testVisualStructuredAcceptanceAllowsDisclosureStatementNotes();
testAutoVisualRowDoesNotForceDecisionRows();
testVisualStructuredAcceptanceRequiresPeekabooAndCodex();
testVisualStructuredAcceptanceRejectsFailureMarkerPlusUnrelatedImage();

console.log(JSON.stringify({ pass: true, suite: 'done-gate' }));
