#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DoneGate = require('../shared/engine/done-gate');
const { loadFlow, runFlow } = require('../shared/engine/engine');
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
  const screenshotPath = path.relative(repoRoot, screenshot).split(path.sep).join('/');
  const screenshotSha = crypto.createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex');
  const images = [{ path: screenshotPath, sha256: screenshotSha }];
  const trace = {
    schema: 'codex-cli-image-trace-v1',
    source: 'runner-spawn-argv',
    tool: 'codex exec --image',
    runner: 'codex',
    images,
  };
  const traceFile = path.join(root, 'visual-input.json');
  const traceBytes = Buffer.from(`${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  fs.writeFileSync(traceFile, traceBytes);
  const runtimeVisualInput = {
    schema: 'codex-cli-image-v1',
    attached: true,
    source: trace.source,
    tool: trace.tool,
    runner: trace.runner,
    trace_path: path.relative(repoRoot, traceFile).split(path.sep).join('/'),
    trace_sha256: crypto.createHash('sha256').update(traceBytes).digest('hex'),
    images,
  };
  try {
    return fn({
      evidence: `${screenshot}; ${codexReport}; node tests/done-gate.test.js exit 0`,
      root,
      screenshot,
      codexReport,
      runtimeVisualInput,
      visualObservations: [{
        path: screenshotPath,
        sha256: screenshotSha,
        observation: '画面可见标题、左侧办公室列表、状态条和舞台边框。',
      }],
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

function negativeStructuredReview(acceptance, status = '部分', verdict = 'partial') {
  const review = structuredReview(acceptance, { status });
  review.pass = false;
  review.severity = 'medium';
  review.notes = '独立复审发现验收未满足并打回；已核 tests/done-gate.test.js，测试证据 exit 0。';
  review.verification.verdict = verdict;
  review.verification.acceptance_table = review.verification.acceptance_table.map(row => Object.assign({}, row, {
    notes: `${row.point} 的负向复审证据已核，当前状态=${status}`,
  }));
  return review;
}

function negativeReviewVars(status = '部分', verdict = 'partial') {
  const goal = '验证负向 review 能进入返工分支';
  const acceptance = structuredAcceptance(goal, '负向复审发现缺陷时必须返回 implement');
  return {
    goal,
    acceptance,
    implementation: structuredImplementation(acceptance),
    review: negativeStructuredReview(acceptance, status, verdict),
  };
}

function testNegativeReviewAcceptanceCanReworkButCannotFinish() {
  for (const status of ['完成', '部分', '未完成']) {
    const vars = negativeReviewVars(status, status === '完成' ? 'false' : 'partial');
    const hardReview = DoneGate.validateReviewHardEvidence(vars, { workspaceRoot: repoRoot });
    assert.strictEqual(hardReview.ok, true, `${status}: ${hardReview.reason}`);

    const finalGate = DoneGate.validateReviewLoopCompletion(reviewLoopTask(vars), {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(finalGate.ok, false, `${status} negative review must never finish the flow`);
    assert.match(finalGate.reason, /review\.pass 未通过/);
  }
}

function testNegativeReviewAcceptanceStillFailsClosed() {
  const cases = [
    {
      label: 'missing row',
      mutate(vars) { vars.review.verification.acceptance_table = []; },
      reason: /缺少结构化验收表逐行填写/,
    },
    {
      label: 'blank evidence',
      mutate(vars) { vars.review.verification.acceptance_table[0].evidence = ''; },
      reason: /证据位置为空/,
    },
    {
      label: 'unverifiable evidence',
      mutate(vars) { vars.review.verification.acceptance_table[0].evidence = 'projects/控制台/__missing_negative_review_evidence__.md:1'; },
      reason: /证据不可核或不存在/,
    },
    {
      label: 'illegal status',
      mutate(vars) { vars.review.verification.acceptance_table[0].status = 'pending'; },
      reason: /未完成/,
    },
    {
      label: 'positive verdict conflict',
      mutate(vars) { vars.review.verification.verdict = 'true'; },
      reason: /verdict 未确认负向\/部分结论/,
    },
  ];

  for (const item of cases) {
    const vars = negativeReviewVars();
    item.mutate(vars);
    const gate = DoneGate.validateReviewHardEvidence(vars, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, `${item.label} must fail closed`);
    assert.match(gate.reason, item.reason, item.label);
  }

  const positive = negativeReviewVars('部分', 'true');
  positive.review.pass = true;
  const positiveGate = DoneGate.validateReviewHardEvidence(positive, { workspaceRoot: repoRoot });
  assert.strictEqual(positiveGate.ok, false, 'positive review must still require every acceptance row completed');
  assert.match(positiveGate.reason, /第1行 未完成/);
}

function testNegativeReviewMayAuditMissingVisualDocumentsWithoutPixelClaims() {
  const point = '任务验收: setup UI 页面必须附可核视觉证据';
  const acceptance = [
    'setup UI 页面调整完成并附视觉证据。',
    '',
    '## 结构化验收表',
    '',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
    '|---|---|---|---|',
    `| ${point} | 未完成 |  |  |`,
  ].join('\n');
  const implementation = baseImplementation(['tests/done-gate.test.js']);
  implementation.acceptance_table = [{
    point,
    status: '完成',
    evidence: 'tests/done-gate.test.js:1',
    notes: `${point} 的实现声明待主管核验`,
  }];
  const review = baseReview(['tests/done-gate.test.js']);
  review.pass = false;
  review.severity = 'medium';
  review.notes = '仅作视觉证据目录缺件审计：未找到截图，未对画面内容作裁决。';
  review.verification.verdict = 'partial';
  review.verification.checked.push('implementation.acceptance_table', 'visual evidence directory listing');
  review.verification.evidence = [{
    kind: 'analysis',
    path: 'tests/done-gate.test.js',
    summary: 'visual_evidence_count=0；证据目录未找到截图，只据缺件事实打回。',
  }];
  review.verification.acceptance_table = [{
    point,
    status: '部分',
    evidence: 'tests/done-gate.test.js:1',
    notes: `${point} 缺少截图，当前只完成文档缺件审计`,
  }];

  const gate = DoneGate.validateReviewHardEvidence({
    goal: 'setup UI 页面调整',
    acceptance,
    implementation,
    review,
  }, { workspaceRoot: repoRoot });
  assert.strictEqual(gate.ok, true, gate.reason);

  review.verification.evidence[0].summary = '复审证据文件存在，未记录图片目录枚举结果。';
  const assertionOnlyGate = DoneGate.validateReviewHardEvidence({
    goal: 'setup UI 页面调整',
    acceptance,
    implementation,
    review,
  }, { workspaceRoot: repoRoot });
  assert.strictEqual(assertionOnlyGate.ok, false, 'notes-only missing-image assertion must not bypass visual review');
  assert.match(assertionOnlyGate.reason, /peekaboo 图片截图/);
}

function testNegativeReviewTakesRealReviewLoopReworkEdge() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-negative-review-flow-'));
  try {
    const events = [];
    const goal = '验证负向 review 通过节点合同后走回 implement';
    const acceptance = structuredAcceptance(goal, '负向复审必须走 review 到 implement 的返工边');
    let reviewCount = 0;
    const result = runFlow({
      flow: loadFlow(path.join(repoRoot, 'shared/routing/flows/review-loop.yaml')),
      taskId: 'negative-review-rework-edge',
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
      workspaceRoot: repoRoot,
      vars: { goal, acceptance, bounds: 'engine regression fixture' },
      runner(node, ctx) {
        if (node.id === 'implement') {
          const implementation = structuredImplementation(acceptance);
          implementation.receipt = {
            taskId: ctx.taskId,
            specFingerprint: ctx.spec_fingerprint,
            changedFiles: implementation.changed_files,
            tests: ['node tests/done-gate.test.js exit 0'],
            artifacts: ['tests/done-gate.test.js:1'],
            verdict: 'done',
            blocked_required_specs: [],
          };
          return { vars: { implementation }, evidence: { type: 'test', path: 'tests/done-gate.test.js' } };
        }
        reviewCount += 1;
        const review = reviewCount === 1
          ? negativeStructuredReview(acceptance, '部分', 'partial')
          : structuredReview(acceptance);
        return { vars: { review }, evidence: { type: 'review', path: 'tests/done-gate.test.js' } };
      },
    });

    assert.strictEqual(result.ok, true, result.reason);
    assert(events.some(event => event.type === 'node.end' && event.node === 'review' && event.loop === 1), 'negative review must emit node.end');
    assert(events.some(event => event.type === 'edge.take' && event.from === 'review' && event.to === 'implement'), 'negative review must take review→implement');
    assert(!events.some(event => event.type === 'done_gate.review_invalid'), 'negative review must not be reclassified as invalid');
    assert(!events.some(event => event.type === 'node.fail'), 'valid negative review loop must not emit node.fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

function testNegativeVisualSemanticsDoNotInjectOrTriggerVisualGate() {
  for (const phrase of ['视觉NA', '视觉 NA', '视觉N/A', '视觉 N/A', '视觉不适用', '视觉 不适用']) {
    assert.strictEqual(
      DoneGate.positiveVisualRequirement(phrase),
      false,
      `${phrase} must be treated as an exact negative visual declaration`,
    );
    const phraseAcceptance = structuredAcceptance('纯引擎契约回归', `契约测试可重复执行；${phrase}`);
    assert(
      !DoneGate.parseStructuredAcceptanceRows(phraseAcceptance).some(row => /^视觉\/UI证据/.test(row.point)),
      `${phrase} must not auto-inject a visual row`,
    );
  }
  assert.strictEqual(
    DoneGate.positiveVisualRequirement('视觉NA但需修改真实 UI 页面布局'),
    true,
    'negative visual metadata must not suppress real UI work in the same sentence',
  );

  const defaultAcceptance = structuredAcceptance(
    '纯引擎事件链回归',
    '事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图',
  );
  assert(
    !DoneGate.parseStructuredAcceptanceRows(defaultAcceptance).some(row => /^视觉\/UI证据/.test(row.point)),
    'default no-visual policy must not auto-inject a visual row',
  );

  const incidentReference = '- 风险/偏差: Claude Fable 5 董事: 绕过 orchestrator 后若任务链元数据(rootQueueId/rootTaskId)不再由 CEO 节点补齐，rollup/董事会审计链会断(参考案例:ui-optimizer 案例事件必须带任务链)';
  assert.strictEqual(
    DoneGate.positiveVisualRequirement(incidentReference),
    false,
    'a ui-optimizer audit reference must not be treated as current UI work',
  );
  assert.strictEqual(
    DoneGate.positiveVisualRequirement('build pipeline 只核事件链与回执'),
    false,
    'the letters ui inside an ordinary English identifier must not trigger the visual gate',
  );
  for (const reference of [
    '参考案例: shared/agents/ui-optimizer/prompt.md:1，仅要求任务链元数据完整',
    '证据路径: projects/控制台/public/workspace.html:120，仅用于历史审计链定位',
  ]) {
    assert.strictEqual(
      DoneGate.positiveVisualRequirement(reference),
      false,
      `${reference} must remain reference-only`,
    );
  }
  const incidentAcceptance = structuredAcceptance(
    `按角色边界裁剪 orchestrator 与维修路由\n${incidentReference}`,
    '自动测试证明普通非维修任务仍保持 secretary→CEO→supervisor 路由。',
  );
  assert(
    !DoneGate.parseStructuredAcceptanceRows(incidentAcceptance).some(row => /^视觉\/UI证据/.test(row.point)),
    'the incident handoff must not inject an unrelated visual acceptance row',
  );
  assert.strictEqual(
    DoneGate.positiveVisualRequirement('参考案例: ui-optimizer；本轮必须提供 Peekaboo 截图'),
    true,
    'an explicit visual evidence request must override reference-only metadata',
  );
  assert.strictEqual(
    DoneGate.positiveVisualRequirement('参考案例: ui-optimizer；本轮修改真实 UI 页面布局'),
    true,
    'real UI modification work must override reference-only metadata',
  );

  const rootGoal = [
    '质量运营先做工具与 hook 清单，监管评估阻塞风险；对 AHR-26..30 产出兼容迁移设计和 contract tests。',
    "- 风险/偏差: 董事: 验收表含'视觉/UI证据: peekaboo截图'行,但本任务无 UI 面;需按规范写 NA+理由。",
    "- 修订建议: 验收表'视觉/UI证据'行明确标 NA 并写理由(纯引擎/测试任务无 UI 面),避免 done gate 误判。",
  ].join('\n');
  const rootAcceptance = [
    '1. contract tests 覆盖兼容路径并给出可重复命令。',
    '2. 视觉/UI证据：NA——本任务仅涉及引擎、hook、兼容设计与自动化测试，无 UI 或视觉验收面，不要求 Peekaboo 截图。',
  ].join('\n');
  const acceptance = structuredAcceptance(rootGoal, rootAcceptance);
  const rows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  assert(rows.some(row => /视觉\/UI证据：NA/.test(row.point)), 'negative orchestrator acceptance item must be preserved');
  assert(!rows.some(row => /^视觉\/UI证据/.test(row.point)), 'negative orchestrator item must not become an explicit visual gate row');
  const gate = DoneGate.validateStructuredAcceptanceTable({
    goal: rootGoal,
    acceptance,
    implementation: structuredImplementation(acceptance),
    review: structuredReview(acceptance),
  }, { workspaceRoot: repoRoot });
  assert.strictEqual(gate.ok, true, gate.reason);

  const explicitVisualAcceptance = [
    '结构化验收表(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
    '|---|---|---|---|',
    '| 视觉/UI证据: N/A | 未完成 |  |  |',
  ].join('\n');
  const explicitGate = DoneGate.validateStructuredAcceptanceTable({
    goal: '纯引擎任务但信封已有显式视觉行',
    acceptance: explicitVisualAcceptance,
    implementation: structuredImplementation(explicitVisualAcceptance),
  }, { workspaceRoot: repoRoot, requireReview: false });
  assert.strictEqual(explicitGate.ok, false, 'an existing explicit visual row must remain fail-closed');
  assert.match(explicitGate.reason, /peekaboo 图片截图/);
}

function testAcceptanceNumberingOnlySplitsAtExplicitBoundaries() {
  const expectedItems = [
    '保留 AHR-26..30、timeoutMs=100、IP=127.0.0.1、浮点数=3.14 和 key=42 原文；这些数字与点都是条目正文，不得切断配置和值。',
    '第二条明确验收保持完整。',
  ];
  const acceptance = structuredAcceptance(
    '纯引擎编号解析回归',
    expectedItems.map((item, index) => `${index + 1}. ${item}`).join(''),
  );
  const taskPoints = DoneGate.parseStructuredAcceptanceRows(acceptance)
    .map(row => row.point)
    .filter(point => /^任务验收: /.test(point));
  assert.deepStrictEqual(
    taskPoints,
    expectedItems.map(item => `任务验收: ${item}`),
    'only explicit numbered item boundaries may split acceptance prose',
  );
}

function testPositiveVisualSemanticsStillInjectAndFailClosed() {
  assert.strictEqual(
    DoneGate.positiveVisualRequirement('修改真实 UI 页面布局；不需要视觉时无需截图'),
    true,
    'a default negative screenshot clause must not suppress real UI modification work',
  );
  const acceptance = structuredAcceptance(
    '优化真实 UI 页面布局和按钮样式',
    '交付页面改动并验证交互',
  );
  assert(
    DoneGate.parseStructuredAcceptanceRows(acceptance).some(row => /^视觉\/UI证据/.test(row.point)),
    'real UI work must still auto-inject the explicit visual row',
  );
  const gate = DoneGate.validateStructuredAcceptanceTable({
    goal: '优化真实 UI 页面布局和按钮样式',
    acceptance,
    implementation: structuredImplementation(acceptance),
  }, { workspaceRoot: repoRoot, requireReview: false });
  assert.strictEqual(gate.ok, false, 'real UI work without images must fail closed');
  assert.match(gate.reason, /peekaboo 图片截图/);
}

function testPlainResearchTaskDoesNotInjectUnrelatedDecisionRows() {
  const goal = [
    '项目主管(控制台)执行 CEO brief。原始目标:',
    '研究 cc-connect 桥接借鉴点(手机元宵端用)',
    '',
    'cc-connect(chenhg5)把 AI 编程 agent 双向桥接到飞书/微信/Telegram/钉钉等消息平台,手机随时随地对话、多数平台无需公网 IP。',
    '研究相对玉兔6(现仅 hermes 单向飞书通知)可借鉴的优点:①双向指令(手机发→玉兔6执行→回复);②手机远程派单/看进度;③无需公网IP的连接方式。',
    '董事会评议:默认执行; 轮次 1/1; 记录见 memory/decisions.md。',
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
  const queueRule = required.find(rule => rule.id === 'queue_merge_integrity');
  assert(queueRule);
  assert.strictEqual(queueRule.mode, 'active');
  assert(String(queueRule.reason || '').trim());
  assert(Array.isArray(queueRule.incident_refs) && queueRule.incident_refs.length > 0);
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

function testTaskMetadataContentDedupDoesNotTriggerQueueMergeRegression() {
  const task = reviewLoopTask({
    goal: [
      '项目主管(控制台)执行 CEO brief。原始目标:董事会背景包去重并按引用复用。',
      '队列引导消息(启动前已注入):',
      '主人明确批准当前控制台重构继续执行。批准范围仅限根任务 903a1c1b / 子任务 17f56b05：董事会背景包去重、context_ref 与 fallback prompt；不授权其他待拍板事项。',
    ].join('\n'),
    acceptance: '稳定背景按有标题边界的完整块去重且仅保留一份；任务目标及角色专属语义完整保留。',
    implementation: baseImplementation([
      'projects/控制台/board-context-ref.js',
      'projects/控制台/tests/board-context-ref.test.js',
      'projects/控制台/status.md',
      'projects/控制台/artifacts/board-context-ref-cr-1784213060660-17f56b05/structured-acceptance.md',
    ]),
    review: baseReview([
      'projects/控制台/board-context-ref.js',
      'projects/控制台/tests/board-context-ref.test.js',
      'projects/控制台/status.md',
      'projects/控制台/artifacts/board-context-ref-cr-1784213060660-17f56b05/structured-acceptance.md',
    ]),
  });
  const required = DoneGate.requiredHardRegressionRules(task.vars);
  assert(
    !required.some(rule => rule.id === 'queue_merge_integrity'),
    'task/root-task metadata next to content dedup must not trigger queue merge hard regression',
  );
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过',
  );
  assert.match(acceptance, /模板: templates\/structured-acceptance-table\.md/);
  assert(DoneGate.parseStructuredAcceptanceRows(acceptance).length >= 1, 'template reference must not break row parsing');
}

function testStructuredAcceptanceTableRejectsBlankEvidence() {
  const acceptance = structuredAcceptance(
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回; 证据对不上打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '结构化验收表机制上线; 填齐才过; 留空打回',
  );
  const taskRows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  const taskRowIndex = taskRows.findIndex(row => /^任务验收:/.test(row.point));
  assert(taskRowIndex >= 0, 'fixture must contain a task acceptance row');
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回',
  );
  const designRowIndex = DoneGate.parseStructuredAcceptanceRows(acceptance)
    .findIndex(row => /^设计对照/.test(row.point));
  assert(designRowIndex >= 0, 'fixture must contain a design row');
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    acceptance,
    implementation: structuredImplementation(acceptance, { index: designRowIndex, evidence: 'tests/done-gate.test.js' }),
    review: structuredReview(acceptance),
  });
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: repoRoot,
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /decisions\.md:289|证据对不上/);
}

function testStructuredAcceptancePlaceholderWordsNeedTokenBoundaries() {
  const acceptance = structuredAcceptance(
    'LiteLLM canary 分析, 对照 memory/decisions.md 第534行',
    '在 控制台 项目 scope 内跑 review-loop',
  );
  const notes = '后续 canary 条件保留; serial smoke pass=true, nodeOverlap=null。';
  const task = reviewLoopTask({
    goal: 'LiteLLM canary 分析, 对照 memory/decisions.md 第534行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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
    '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
    '填齐才过; 留空打回',
  );
  const task = reviewLoopTask({
    goal: '维修工单: done gate 结构化验收表, 对照 memory/decisions.md 第289行',
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

function testStructuredAcceptanceAllowsPlaceholderWordInExplanatoryNotes() {
  const acceptance = structuredAcceptance(
    'LiteLLM canary 分析, 对照 memory/decisions.md 第534行',
    '在 控制台 项目 scope 内跑 review-loop',
  );
  const notes = 'N/A 仅表示该普通行不产生额外视觉产物；专项测试与文件证据仍已提供。';
  const task = reviewLoopTask({
    goal: 'LiteLLM canary 分析, 对照 memory/decisions.md 第534行',
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

function testVisualStructuredAcceptanceAllowsDisclosureStatementNotes() {
  withVisualFixtureEvidence(({ evidence, runtimeVisualInput, visualObservations }) => {
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
    review.verification.runtime_visual_input = runtimeVisualInput;
    review.verification.visual_observations = visualObservations;
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
  withVisualFixtureEvidence(({ evidence, runtimeVisualInput, visualObservations }) => {
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
    review.verification.runtime_visual_input = runtimeVisualInput;
    review.verification.visual_observations = visualObservations;
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
    'UI 页面调整, 对照 memory/decisions.md 第478行, 必须截图自验',
    '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
  );
  const task = reviewLoopTask({
    goal: 'UI 页面调整, 对照 memory/decisions.md 第478行, 必须截图自验',
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

function testVisualImplementationRequiresEvidenceButNotReviewReceipt() {
  withVisualFixtureEvidence(({ evidence, screenshot, codexReport }) => {
    const goal = 'UI implementation 阶段结构化视觉验收';
    const acceptance = structuredAcceptance(
      goal,
      '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
    );
    function makeVars(rowEvidence) {
      const implementation = baseImplementation(['tests/done-gate.test.js']);
      implementation.acceptance_table = filledAcceptanceRowsWithEvidence(
        acceptance,
        rowEvidence,
        'implementation visual evidence fixture',
      );
      return { goal, acceptance, implementation };
    }

    let gate = DoneGate.validateImplementationLogicChain(makeVars(evidence), { workspaceRoot: repoRoot });
    assert.strictEqual(
      gate.ok,
      true,
      `implementation must not require the future review-owned runtime receipt: ${gate.reason}`,
    );

    gate = DoneGate.validateImplementationLogicChain(
      makeVars(`${codexReport}; node tests/done-gate.test.js exit 0`),
      { workspaceRoot: repoRoot },
    );
    assert.strictEqual(gate.ok, false, 'implementation without a real Peekaboo image must fail closed');
    assert.match(gate.reason, /peekaboo 图片截图/);

    gate = DoneGate.validateImplementationLogicChain(
      makeVars(`${screenshot}; node tests/done-gate.test.js exit 0`),
      { workspaceRoot: repoRoot },
    );
    assert.strictEqual(gate.ok, false, 'implementation without a Codex comparison report must fail closed');
    assert.match(gate.reason, /未同时包含.*Codex 复核报告|Codex 对照设计挑错证据/);
  });
}

function testVisualReviewRequiresRunnerOwnedTraceAndPerImageObservation() {
  withVisualFixtureEvidence(({ evidence, root, runtimeVisualInput, visualObservations }) => {
    const goal = 'UI 视觉复审，禁止沿用上轮 critique 代替真实开图';
    const acceptance = structuredAcceptance(
      goal,
      '视觉/UI 类必须 peekaboo 截图 + Codex 对照设计挑错',
    );
    const acceptanceTable = filledAcceptanceRowsWithEvidence(
      acceptance,
      evidence,
      'Codex review fixture with concrete image paths',
    );
    function makeVars() {
      const implementation = baseImplementation(['tests/done-gate.test.js']);
      implementation.acceptance_table = acceptanceTable.map(row => Object.assign({}, row));
      const review = baseReview(['tests/done-gate.test.js']);
      review.verification.checked = review.verification.checked.concat(['implementation.acceptance_table']);
      review.verification.acceptance_table = acceptanceTable.map(row => Object.assign({}, row));
      return { goal, acceptance, implementation, review };
    }

    const unverifiedPass = makeVars();
    let gate = DoneGate.validateReviewHardEvidence(unverifiedPass, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, 'metadata-only/model-only visual pass must fail closed');
    assert.match(gate.reason, /runner 注入.*图片输入回执/);
    gate = DoneGate.validateReviewLoopCompletion(reviewLoopTask(unverifiedPass), {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, false, 'final completion without a trusted visual trace must fail closed');
    assert.match(gate.reason, /runner 注入.*图片输入回执/);

    const unverifiedReject = makeVars();
    unverifiedReject.review.pass = false;
    unverifiedReject.review.verification.verdict = 'false';
    unverifiedReject.review.notes = '沿用上轮 critique 判断图片缺层';
    gate = DoneGate.validateReviewHardEvidence(unverifiedReject, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, 'unverified visual rejection must fail closed too');
    assert.match(gate.reason, /runner 注入.*图片输入回执/);

    const forgedReceipt = makeVars();
    forgedReceipt.review.verification.runtime_visual_input = {
      schema: 'codex-cli-image-v1',
      attached: true,
      source: 'runner-spawn-argv',
      tool: 'codex exec --image',
      runner: 'codex',
      images: runtimeVisualInput.images,
    };
    forgedReceipt.review.verification.visual_observations = visualObservations;
    gate = DoneGate.validateReviewHardEvidence(forgedReceipt, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, 'self-reported receipt without runner trace must fail');
    assert.match(gate.reason, /runner-owned trace 路径或哈希/);

    const unavailableTool = makeVars();
    unavailableTool.review.verification.runtime_visual_input = {
      schema: 'codex-cli-image-v1',
      attached: false,
      source: 'runner-spawn-argv',
      tool: 'codex exec --image',
      reason: 'selected_runner_cannot_expose_verified_image_input',
      images: [],
    };
    gate = DoneGate.validateReviewHardEvidence(unavailableTool, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false);
    assert.match(gate.reason, /必须标 partial\/blocked/);

    const metadataObservation = makeVars();
    metadataObservation.review.verification.runtime_visual_input = runtimeVisualInput;
    metadataObservation.review.verification.visual_observations = visualObservations.map(item => Object.assign({}, item, {
      observation: 'stat、shasum、sips、文件存在、尺寸与哈希均已核实。',
    }));
    gate = DoneGate.validateReviewHardEvidence(metadataObservation, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, 'metadata-only observation must not count as visual inspection');
    assert.match(gate.reason, /逐图具体可见内容观察/);

    const verified = makeVars();
    verified.review.verification.runtime_visual_input = runtimeVisualInput;
    verified.review.verification.visual_observations = visualObservations;
    gate = DoneGate.validateReviewHardEvidence(verified, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, true, gate.reason);
    gate = DoneGate.validateReviewLoopCompletion(reviewLoopTask(verified), {
      workspaceRoot: repoRoot,
      requireDeliveryEvidence: true,
    });
    assert.strictEqual(gate.ok, true, gate.reason);

    const extraConclusionImage = path.join(root, 'peekaboo-reading.png');
    fs.writeFileSync(extraConclusionImage, 'second image used by the review conclusion\n');
    const missingOneImage = makeVars();
    for (const row of missingOneImage.implementation.acceptance_table) row.evidence += `; ${extraConclusionImage}`;
    for (const row of missingOneImage.review.verification.acceptance_table) row.evidence += `; ${extraConclusionImage}`;
    missingOneImage.review.verification.runtime_visual_input = runtimeVisualInput;
    missingOneImage.review.verification.visual_observations = visualObservations;
    gate = DoneGate.validateReviewHardEvidence(missingOneImage, { workspaceRoot: repoRoot });
    assert.strictEqual(gate.ok, false, 'every image used for the conclusion must be in the runtime trace');
    assert.match(gate.reason, /未真实附加给 Codex 评审/);
  });
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
      'UI 页面调整, 对照 memory/decisions.md 第478行, 必须截图自验',
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
      goal: 'UI 页面调整, 对照 memory/decisions.md 第478行, 必须截图自验',
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
testNegativeReviewAcceptanceCanReworkButCannotFinish();
testNegativeReviewAcceptanceStillFailsClosed();
testNegativeReviewMayAuditMissingVisualDocumentsWithoutPixelClaims();
testNegativeReviewTakesRealReviewLoopReworkEdge();
testClaimedMissingFileCannotDone();
testAnalysisTaskCanPassWithEvidenceNoChangedFiles();
testStructuredAcceptanceHeaderDoesNotForceDeliveryEvidence();
testNegativeVisualSemanticsDoNotInjectOrTriggerVisualGate();
testAcceptanceNumberingOnlySplitsAtExplicitBoundaries();
testPositiveVisualSemanticsStillInjectAndFailClosed();
testPlainResearchTaskDoesNotInjectUnrelatedDecisionRows();
testQueueMergeTaskRequiresHardRegressionTests();
testQueueMergeHardRegressionCoveragePasses();
testQueueMergeHardRegressionReadsReferencedEvidenceArtifact();
testLowPriorityPageReviewDoesNotTriggerQueueMergeRegression();
testQueueIdDedupAdviceDoesNotTriggerQueueMergeRegression();
testTaskMetadataContentDedupDoesNotTriggerQueueMergeRegression();
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
testStructuredAcceptanceAllowsPlaceholderWordInExplanatoryNotes();
testVisualStructuredAcceptanceAllowsDisclosureStatementNotes();
testAutoVisualRowDoesNotForceDecisionRows();
testVisualStructuredAcceptanceRequiresPeekabooAndCodex();
testVisualImplementationRequiresEvidenceButNotReviewReceipt();
testVisualReviewRequiresRunnerOwnedTraceAndPerImageObservation();
testVisualStructuredAcceptanceRejectsFailureMarkerPlusUnrelatedImage();

console.log(JSON.stringify({ pass: true, suite: 'done-gate' }));
