#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.YUTU6_KB_INJECT = '0';

const DoneGate = require('../shared/engine/done-gate');
const Handoff = require('../shared/engine/handoff');
const { buildEnvelope } = require('../shared/engine/cli-runner');
const engineRunner = require('../projects/控制台/engine-runner')._test;
const ceoWorker = require('../projects/控制台/ceo-worker')._test;

const repoRoot = path.resolve(__dirname, '..');

function classify(input) {
  return DoneGate.classifyVisualAcceptance(Object.assign({
    acceptance: '事件日志可追踪，产物路径清楚',
  }, input));
}

function tableFor(input, classification) {
  return DoneGate.buildStructuredAcceptanceTable(Object.assign({}, input, {
    visual_acceptance: classification,
    workspaceRoot: repoRoot,
  }));
}

function filledRows(acceptance, evidence = 'tests/visual-acceptance.test.js:1') {
  return DoneGate.parseStructuredAcceptanceRows(acceptance).map(row => {
    if (DoneGate.notApplicableVisualRow(row)) {
      return {
        point: row.point,
        status: DoneGate.VISUAL_ACCEPTANCE_NA,
        evidence: 'task-envelope:visual_acceptance',
        notes: 'source=task_type; non-visual fixture creates no screenshot',
      };
    }
    return {
      point: row.point,
      status: '完成',
      evidence,
      notes: `visual acceptance classifier regression evidence for ${row.point}`,
    };
  });
}

function completedLogicChain() {
  return {
    summary: 'verified visual acceptance protocol behavior',
    current_status: 'done',
    actions: ['验证 structured-acceptance@2 非视觉行的顶层 implement 门禁'],
    evidence: [{
      kind: 'test',
      command: 'node tests/visual-acceptance.test.js',
      exit_code: 0,
      summary: 'visual acceptance logic-chain regression evidence',
    }],
    tests: [{
      command: 'node tests/visual-acceptance.test.js',
      exit_code: 0,
      summary: 'visual acceptance logic-chain regression evidence',
    }],
    conclusion: 'non-visual v2 acceptance remains complete without screenshot evidence',
  };
}

function assertNonVisualCase(label, goal) {
  const audit = classify({ goal });
  assert.strictEqual(audit.required, false, `${label} must be non-visual`);
  assert.strictEqual(audit.state, DoneGate.VISUAL_ACCEPTANCE_NA);
  assert.strictEqual(audit.source, 'task_type');
  const acceptance = tableFor({ goal, acceptance: '事件日志可追踪' }, audit);
  assert(DoneGate.structuredAcceptanceProtocolV2(acceptance));
  const rows = DoneGate.parseStructuredAcceptanceRows(acceptance);
  const visual = rows.filter(row => DoneGate.visualAcceptancePoint(row.point));
  assert.strictEqual(visual.length, 1, `${label} must have exactly one visual-decision row`);
  assert(DoneGate.notApplicableVisualRow(visual[0]));
  assert(!acceptance.includes(DoneGate.VISUAL_ACCEPTANCE_POINT), `${label} must not inject Peekaboo+Codex row`);
  return { audit, acceptance };
}

function main() {
  const memoryOfficer = assertNonVisualCase('memory_officer', 'memory_officer 只追加结构化 memory 记录');
  assertNonVisualCase('repair no-op', 'repair no-op：工单已恢复，只记录无操作结果');
  assertNonVisualCase('non-UI PoC', '非 UI PoC：只验证 Node 协议解析与日志');

  // Non-visual classification is pure: it creates neither one-off images nor
  // memory writes. The fixture directory is the observable artifact boundary.
  const pureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-acceptance-pure-'));
  try {
    const memoryFile = path.join(pureRoot, 'memory', 'experience.md');
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(memoryFile, '# memory baseline\n');
    const before = fs.readFileSync(memoryFile, 'utf8');
    tableFor({ goal: 'memory_officer append-only', acceptance: '只记录事件' }, classify({ goal: 'memory_officer append-only' }));
    assert.strictEqual(fs.readFileSync(memoryFile, 'utf8'), before);
    assert.deepStrictEqual(
      fs.readdirSync(pureRoot, { recursive: true }).filter(file => /\.(?:png|jpe?g|webp|gif)$/i.test(String(file))),
      [],
      'non-visual classification must not create one-off screenshots',
    );
  } finally {
    fs.rmSync(pureRoot, { recursive: true, force: true });
  }

  const uiAudit = classify({ goal: '调整真实 UI 页面版式与按钮样式' });
  assert.strictEqual(uiAudit.required, true);
  assert.strictEqual(uiAudit.source, 'task_type');
  const uiAcceptance = tableFor({ goal: '调整真实 UI 页面版式与按钮样式', acceptance: '必须可验证' }, uiAudit);
  assert(uiAcceptance.includes(DoneGate.VISUAL_ACCEPTANCE_POINT));
  assert(!uiAcceptance.includes(DoneGate.VISUAL_ACCEPTANCE_NA_POINT));

  // Classifier-policy and fixture prose may quote every visual trigger without
  // becoming visual work itself. It must also not parse "UI/版式任务..." as a path.
  const policyMetaGoal = [
    '按任务类型条件化注入视觉验收行 类别:hook；非视觉任务用 not_applicable。补 memory_officer、repair no-op、非 UI PoC 门禁测试；真 UI/版式任务必须仍拿到 Peekaboo+Codex 行；显式用户要求视觉证据时始终保留。',
    '预期收益:避免一次性截图污染 memory，并节省非 UI 任务的视觉制作与审查延迟。',
    '风险/偏差:间接影响 UI 的改动存在漏判空间。',
    '修订建议:路径判定至少覆盖前端文件扩展名与组件/样式目录。',
    '分类逻辑不替换已有的视觉证据真实性校验。',
  ].join('\n');
  const policyMetaAudit = classify({ goal: policyMetaGoal });
  assert.strictEqual(policyMetaAudit.required, false);
  assert.deepStrictEqual(policyMetaAudit.path_matches, []);
  const policyMetaAcceptance = tableFor({
    goal: policyMetaGoal,
    acceptance: '显式视觉要求或 human gate 开启时 not_applicable 必须打回；证明非视觉任务不再制造一次性截图；已写入 not_applicable 的任务能刷新为待补视觉状态',
  }, policyMetaAudit);
  const policyMetaGate = DoneGate.validateStructuredAcceptanceTable({
    goal: policyMetaGoal,
    acceptance: policyMetaAcceptance,
    visual_acceptance: policyMetaAudit,
    implementation: {
      acceptance_table: filledRows(policyMetaAcceptance).map((row, index) => ({
        ...row,
        notes: [
          '显式视觉 human gate 拒绝伪造 not_applicable',
          '非视觉任务没有生成一次性截图',
          'not_applicable 重判刷新视觉状态',
          '非视觉判定审计',
        ][index],
      })),
    },
  }, { workspaceRoot: repoRoot, requireReview: false });
  assert.strictEqual(policyMetaGate.ok, true, policyMetaGate.reason);

  // Priority flips: explicit > human gate > change path > task type.
  const taskTypeLabelAudit = classify({
    goal: 'mixed label fixture',
    taskType: 'ui',
    category: 'hook',
  });
  assert.strictEqual(taskTypeLabelAudit.required, true);
  assert.strictEqual(taskTypeLabelAudit.source, 'task_type');
  const pathAudit = classify({
    goal: 'repair no-op',
    changePaths: ['src/components/SharedButton.js'],
  });
  assert.strictEqual(pathAudit.source, 'change_path');
  assert.deepStrictEqual(pathAudit.path_matches, ['src/components/SharedButton.js']);
  const pathOverTaskTypeAudit = classify({
    goal: 'mixed label fixture',
    taskType: 'ui',
    changePaths: ['src/components/SharedButton.js'],
  });
  assert.strictEqual(pathOverTaskTypeAudit.source, 'change_path');
  const extensionAudit = classify({ goal: 'backend task', changePaths: ['web/client.tsx', 'src/theme/tokens.js'] });
  assert.strictEqual(extensionAudit.source, 'change_path');
  assert.deepStrictEqual(extensionAudit.path_matches, ['web/client.tsx', 'src/theme/tokens.js']);
  const humanAudit = classify({
    goal: '修改真实 UI 页面',
    changePaths: ['src/components/SharedButton.js'],
    visualAcceptanceHumanGate: true,
  });
  assert.strictEqual(humanAudit.source, 'human_gate');
  const explicitAudit = classify({
    goal: 'repair no-op',
    acceptance: '用户明确要求必须提供 Peekaboo 截图',
    changePaths: ['src/components/SharedButton.js'],
    visualAcceptanceHumanGate: true,
  });
  assert.strictEqual(explicitAudit.source, 'explicit_user_requirement');
  assert.strictEqual(explicitAudit.priority, 1);

  // Rejudge/reactivation turns an already-written N/A row back into pending.
  const reactivated = {
    goal: 'repair no-op',
    acceptance: memoryOfficer.acceptance,
    visual_acceptance: memoryOfficer.audit,
  };
  DoneGate.refreshVisualAcceptanceContext(reactivated, { visual_acceptance_human_gate: true });
  assert.strictEqual(reactivated.visual_acceptance.required, true);
  assert.strictEqual(reactivated.visual_acceptance.source, 'human_gate');
  assert(reactivated.acceptance.includes(DoneGate.VISUAL_ACCEPTANCE_POINT));
  assert(!reactivated.acceptance.includes(DoneGate.VISUAL_ACCEPTANCE_NA_POINT));

  // The actual implementation path is a second, fail-closed classification
  // source. A task cannot retain its old N/A audit after changing a UI file.
  const stalePathVars = {
    goal: 'repair no-op',
    acceptance: memoryOfficer.acceptance,
    visual_acceptance: memoryOfficer.audit,
    implementation: {
      changed_files: ['projects/控制台/public/workspace.html'],
      acceptance_table: filledRows(memoryOfficer.acceptance),
    },
  };
  const stalePathGate = DoneGate.validateStructuredAcceptanceTable(stalePathVars, {
    workspaceRoot: repoRoot,
    requireReview: false,
  });
  assert.strictEqual(stalePathGate.ok, false);
  assert.match(stalePathGate.reason, /changed_files.*not_applicable.*重判/);
  DoneGate.refreshVisualAcceptanceContext(stalePathVars, {
    changedFiles: stalePathVars.implementation.changed_files,
  });
  assert.strictEqual(stalePathVars.visual_acceptance.source, 'change_path');
  assert(stalePathVars.acceptance.includes(DoneGate.VISUAL_ACCEPTANCE_POINT));

  // A v2 non-visual row passes without image evidence, but only with the frozen
  // task-envelope audit pointer and never as "完成+不适用".
  const naVars = {
    goal: 'memory_officer 只追加 memory',
    acceptance: memoryOfficer.acceptance,
    visual_acceptance: memoryOfficer.audit,
    implementation: { acceptance_table: filledRows(memoryOfficer.acceptance) },
  };
  const naGate = DoneGate.validateStructuredAcceptanceTable(naVars, {
    workspaceRoot: repoRoot,
    requireReview: false,
  });
  assert.strictEqual(naGate.ok, true, naGate.reason);
  const naLogicVars = JSON.parse(JSON.stringify(naVars));
  naLogicVars.implementation.done = true;
  naLogicVars.implementation.logic_chain = completedLogicChain();
  const naLogicGate = DoneGate.validateImplementationLogicChain(naLogicVars, {
    workspaceRoot: repoRoot,
  });
  assert.strictEqual(naLogicGate.ok, true, naLogicGate.reason);
  const mixedVars = JSON.parse(JSON.stringify(naVars));
  const mixedRow = mixedVars.implementation.acceptance_table.find(row => DoneGate.visualAcceptancePoint(row.point));
  mixedRow.status = '完成';
  mixedRow.notes = '不适用';
  const mixedGate = DoneGate.validateStructuredAcceptanceTable(mixedVars, {
    workspaceRoot: repoRoot,
    requireReview: false,
  });
  assert.strictEqual(mixedGate.ok, false);
  assert.match(mixedGate.reason, /单一 not_applicable|完成\+不适用/);

  // Frozen audit metadata is not trusted when it contradicts its N/A state.
  for (const mutation of [
    audit => { audit.explicit_visual_requirement = true; },
    audit => { audit.human_gate_forced = true; },
    audit => { audit.path_matches = ['src/components/Button.js']; },
    audit => { audit.task_type_positive = true; },
  ]) {
    const contradictory = JSON.parse(JSON.stringify(naVars));
    mutation(contradictory.visual_acceptance);
    const contradictoryGate = DoneGate.validateStructuredAcceptanceTable(contradictory, {
      workspaceRoot: repoRoot,
      requireReview: false,
    });
    assert.strictEqual(contradictoryGate.ok, false);
    assert.match(contradictoryGate.reason, /自相矛盾|not_applicable/);
  }

  // A forged N/A row cannot escape an explicit visual requirement.
  const forged = JSON.parse(JSON.stringify(naVars));
  forged.goal = '用户明确要求必须提供 Peekaboo 截图';
  const forgedGate = DoneGate.validateStructuredAcceptanceTable(forged, {
    workspaceRoot: repoRoot,
    requireReview: false,
  });
  assert.strictEqual(forgedGate.ok, false);
  assert.match(forgedGate.reason, /expected=pending_visual_evidence|not_applicable/);

  // Conditional injection never weakens the real-image/Codex evidence hard gate.
  const visualVars = {
    goal: '修改真实 UI 页面布局',
    acceptance: uiAcceptance,
    visual_acceptance: uiAudit,
    implementation: { acceptance_table: filledRows(uiAcceptance) },
  };
  const visualGate = DoneGate.validateStructuredAcceptanceTable(visualVars, {
    workspaceRoot: repoRoot,
    requireReview: false,
  });
  assert.strictEqual(visualGate.ok, false);
  assert.match(visualGate.reason, /peekaboo 图片截图|Codex/);

  // Old tables/fixtures remain on the legacy contract and are not forced into N/A.
  const legacy = DoneGate.buildStructuredAcceptanceTable({
    goal: 'legacy backend fixture',
    acceptance: 'legacy evidence',
    workspaceRoot: repoRoot,
  });
  assert(!DoneGate.structuredAcceptanceProtocolV2(legacy));
  assert(!legacy.includes('not_applicable'));

  // A versioned audit may arrive on an in-flight task whose table body was
  // already built. New builders upgrade it; done-gate also accepts a filled N/A
  // row against the frozen old point so the task is not falsely blocked.
  const preUpgradeTable = [
    '结构化验收表(执行 agent 必须逐行填)',
    '模板: templates/structured-acceptance-table.md',
    '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
    '|---|---|---|---|',
    '| 任务验收: in-flight fixture | 未完成 | | |',
    `| ${DoneGate.VISUAL_ACCEPTANCE_POINT} | 未完成 | | |`,
  ].join('\n');
  const upgradedTable = tableFor({ goal: 'repair no-op', acceptance: preUpgradeTable }, memoryOfficer.audit);
  assert(DoneGate.structuredAcceptanceProtocolV2(upgradedTable));
  assert(upgradedTable.includes(DoneGate.VISUAL_ACCEPTANCE_NA_POINT));
  assert(!upgradedTable.includes(DoneGate.VISUAL_ACCEPTANCE_POINT));
  const inFlightRows = DoneGate.parseStructuredAcceptanceRows(preUpgradeTable).map(row => ({
    point: row.point,
    status: DoneGate.visualAcceptancePoint(row.point) ? DoneGate.VISUAL_ACCEPTANCE_NA : '完成',
    evidence: DoneGate.visualAcceptancePoint(row.point)
      ? 'task-envelope:visual_acceptance' : 'tests/visual-acceptance.test.js:1',
    notes: 'in-flight structured acceptance compatibility fixture',
  }));
  const inFlightGate = DoneGate.validateStructuredAcceptanceTable({
    goal: 'repair no-op',
    acceptance: preUpgradeTable,
    visual_acceptance: memoryOfficer.audit,
    implementation: { acceptance_table: inFlightRows },
  }, { workspaceRoot: repoRoot, requireReview: false });
  assert.strictEqual(inFlightGate.ok, true, inFlightGate.reason);
  const inFlightLogicGate = DoneGate.validateImplementationLogicChain({
    goal: 'repair no-op',
    acceptance: preUpgradeTable,
    visual_acceptance: memoryOfficer.audit,
    implementation: {
      done: true,
      acceptance_table: inFlightRows,
      logic_chain: completedLogicChain(),
    },
  }, { workspaceRoot: repoRoot });
  assert.strictEqual(inFlightLogicGate.ok, true, inFlightLogicGate.reason);
  const refreshedInFlight = {
    goal: 'repair no-op',
    acceptance: preUpgradeTable,
    visual_acceptance: memoryOfficer.audit,
  };
  DoneGate.refreshVisualAcceptanceContext(refreshedInFlight, {
    visual_acceptance_human_gate: true,
  });
  assert(DoneGate.structuredAcceptanceProtocolV2(refreshedInFlight.acceptance));
  assert(refreshedInFlight.acceptance.includes(DoneGate.VISUAL_ACCEPTANCE_POINT));
  assert.strictEqual(refreshedInFlight.visual_acceptance.source, 'human_gate');

  // Production envelope creation persists classification in spec, ctx, handoff,
  // and the runner prompt; the N/A prompt has no visual review requirement.
  const spec = ceoWorker.makeSpec({
    id: 'visual-acceptance-memory-fixture',
    task: {
      projectId: '控制台',
      projectMode: false,
      role: 'memory_officer',
      goal: 'memory_officer 只追加 memory 记录',
      acceptance: '事件日志可追踪',
    },
  });
  assert.strictEqual(spec.visual_acceptance.required, false);
  assert(DoneGate.structuredAcceptanceProtocolV2(spec.acceptance));
  const ctx = engineRunner.makeCtx(spec);
  assert.strictEqual(ctx.visual_acceptance.required, false);
  const prompt = buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, ctx);
  assert.match(prompt, /视觉验收分类:/);
  assert.match(prompt, /task-envelope:visual_acceptance/);
  assert.match(prompt, /显式用户要求 > human gate > 变更路径 > 任务类型/);

  // makeSpec is the producer and makeCtx is the runner consumer. Once the
  // producer records a positive decision, the structured v2 table must not
  // erase the original explicit/task-type signal during runner construction.
  const explicitSpec = ceoWorker.makeSpec({
    id: 'visual-acceptance-explicit-production-fixture',
    task: {
      projectId: '控制台',
      projectMode: false,
      goal: 'repair no-op',
      acceptance: '用户明确要求必须提供 Peekaboo 截图',
    },
  });
  assert.strictEqual(explicitSpec.visual_acceptance.state, DoneGate.VISUAL_ACCEPTANCE_PENDING);
  const explicitCtx = engineRunner.makeCtx(explicitSpec);
  assert.strictEqual(explicitCtx.visual_acceptance.state, DoneGate.VISUAL_ACCEPTANCE_PENDING);
  assert.strictEqual(explicitCtx.visual_acceptance.source, 'explicit_user_requirement');

  const taskTypeSpec = ceoWorker.makeSpec({
    id: 'visual-acceptance-task-type-production-fixture',
    task: {
      projectId: '控制台',
      projectMode: false,
      goal: 'backend fixture',
      taskType: 'ui',
      acceptance: '事件日志可追踪',
    },
  });
  assert.strictEqual(taskTypeSpec.visual_acceptance.state, DoneGate.VISUAL_ACCEPTANCE_PENDING);
  const taskTypeCtx = engineRunner.makeCtx(taskTypeSpec);
  assert.strictEqual(taskTypeCtx.visual_acceptance.state, DoneGate.VISUAL_ACCEPTANCE_PENDING);
  assert.strictEqual(taskTypeCtx.visual_acceptance.source, 'task_type');

  const upgradedCtx = engineRunner.makeCtx(spec, {
    changedFiles: ['projects/控制台/public/workspace.html'],
  });
  assert.strictEqual(upgradedCtx.visual_acceptance.state, DoneGate.VISUAL_ACCEPTANCE_PENDING);
  assert.strictEqual(upgradedCtx.visual_acceptance.source, 'change_path');

  const handoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-acceptance-handoff-'));
  try {
    const doc = Handoff.writeTaskDoc(handoffRoot, ctx);
    assert.match(fs.readFileSync(doc.file, 'utf8'), /## 视觉验收分类审计/);
    assert.match(fs.readFileSync(doc.file, 'utf8'), /"state": "not_applicable"/);
  } finally {
    fs.rmSync(handoffRoot, { recursive: true, force: true });
  }

  console.log('visual acceptance classification tests passed');
}

main();
