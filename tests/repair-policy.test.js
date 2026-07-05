#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RepairPolicy = require('../shared/agents/repair/repair-policy');
const DoneGate = require('../shared/engine/done-gate');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function testDetectsHandoffRequirementOmission() {
  const interactions = [{
    from: '秘书',
    to: 'CEO',
    expected: '必须修复 Peekaboo 截图能力,并验证屏幕录制和辅助功能授权。',
    brief: '处理 Peekaboo 问题。',
    actual: '已重启控制台服务。',
    evidence: 'projects/控制台/artifacts/engine-runs/cr-test/implement-1/task.md',
  }];
  const omissions = RepairPolicy.findHandoffOmissions(interactions);
  assert.strictEqual(omissions.length, 1);
  assert.strictEqual(omissions[0].from, '秘书');
  assert.strictEqual(omissions[0].to, 'CEO');
  assert(omissions[0].missingInBrief.some(s => /屏幕录制|辅助功能|截图/.test(s)), 'must report omitted requirement from brief');
  assert(omissions[0].missingInActual.some(s => /屏幕录制|辅助功能|截图/.test(s)), 'must report omitted requirement from actual result');
}

function testSevereGoesGlobalTrace() {
  const analysis = RepairPolicy.analyzeRepairContext({
    ticketText: '任务反复卡住,多个队列都出现 node_failed,疑似 engine/done gate 交接遗漏。',
    affectedTasks: 3,
    interactions: [{
      from: '秘书',
      to: 'CEO',
      expected: '必须保留老板原始验收: done gate 不通过不得标 done。',
      brief: '让 CEO 处理队列卡住。',
      actual: '已重启 worker。',
    }, {
      from: 'CEO',
      to: '主管',
      expected: '必须核实 done gate 证据。',
      brief: '复查任务。',
      actual: '通过。',
    }],
    records: [
      { text: 'task.failed queue=ceo reason=node_failed' },
      { text: 'task.failed queue=supervisor-控制台 reason=node_failed' },
    ],
  });
  assert.strictEqual(analysis.severity, 'severe');
  assert.strictEqual(analysis.repairDepth, 'global_system_trace');
  assert.strictEqual(analysis.signals.systemic, true);
  assert.strictEqual(analysis.signals.recurring, true);
  assert.strictEqual(analysis.signals.broadImpact, true);
  assert.strictEqual(analysis.signals.handoffOmission, true);
  assert(analysis.requiredInvestigation.includes('reconstruct_full_chain'));
  assert(RepairPolicy.buildRepairChecklist(analysis).some(x => /逐环节/.test(x)));
}

function testSimpleGoesLocalFix() {
  const analysis = RepairPolicy.analyzeRepairContext({
    ticketText: '单个维修工单:按钮文案显示错,只影响一个页面。',
    interactions: [{
      from: '秘书',
      to: 'CEO',
      expected: '按钮文案调整为保存。',
      brief: '按钮文案调整为保存。',
      actual: '按钮文案调整为保存,已截图验证。',
    }],
    records: [{ text: 'one local UI mismatch' }],
  });
  assert.strictEqual(analysis.severity, 'simple');
  assert.strictEqual(analysis.repairDepth, 'local_fix');
  assert.strictEqual(analysis.signals.handoffOmission, false);
  assert(RepairPolicy.buildRepairChecklist(analysis).some(x => /最小局部修复/.test(x)));
}

function testCliReadsLocalArtifacts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-policy-cli-'));
  try {
    write(path.join(root, 'board', 'repair-tickets', 'ticket-a.md'), [
      '- status: open',
      '问题: 任务反复卡住。',
      '期望: 全局排查队列链路。',
    ].join('\n'));
    write(path.join(root, 'projects', '控制台', 'artifacts', 'engine-events.jsonl'), [
      JSON.stringify({ type: 'task.failed', task: 'task-a', ticket: 'ticket-a', reason: 'node_failed in queue ceo' }),
      JSON.stringify({ type: 'task.failed', task: 'task-b', ticket: 'ticket-a', reason: 'node_failed in queue supervisor' }),
    ].join('\n') + '\n');
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'projects', '控制台', 'tools', 'repair-policy-check.js'),
      '--workdir', root,
      '--ticket', 'ticket-a',
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.ticketId, 'ticket-a');
    assert.strictEqual(out.analysis.evidenceSummary.recordCount, 2);
    assert(out.checklist.some(x => /链路交互记录/.test(x)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 注:本用例不传 executeEvidence,是 done gate 的"向后兼容(只校验结构,不真跑命令)"路径。
// 真实执行的守卫见下方 testExecuteEvidenceRejectsFakePass 与 done-gate-execute-evidence.test.js。
function testRepairPolicyChangePassesDoneGateFixture() {
  const changed = [
    'shared/agents/repair/prompt.md',
    'shared/agents/repair/agent.json',
    'shared/agents/repair/repair-policy.js',
    'projects/控制台/tools/repair-policy-check.js',
    'tests/repair-policy.test.js',
    'tests/run.js',
  ];
  const task = {
    id: 'repair-policy-self-gate',
    flow: 'review-loop',
    state: 'done',
    vars: {
      goal: '升级维修员维修逻辑: 链路交互记录判断需求遗漏 + 分级维修',
      acceptance: '必须有链路记录证据要求、严重/小问题分级、回归测试和可核证据。',
      implementation: {
        done: true,
        summary: '维修员 prompt/agent 元数据/策略模块/CLI/测试已落盘。',
        changed_files: changed,
        logic_chain: {
          summary: '落地链路证据优先和分级维修机制。',
          current_status: 'done',
          actions: [
            '更新 repair prompt 的核心工作准则和工单流程。',
            '新增 repair-policy.js 识别交接遗漏并分级。',
            '新增 repair-policy-check.js CLI 和 repair-policy.test.js。',
          ],
          evidence: [
            { file: 'shared/agents/repair/prompt.md', summary: '核心工作准则包含链路证据和分级维修。' },
            { file: 'shared/agents/repair/repair-policy.js', summary: '策略模块实现 handoff omission 和 severity。' },
            { command: 'node tests/repair-policy.test.js', exit_code: 0, summary: '新增回归测试通过。' },
          ],
          tests: [{ command: 'node tests/repair-policy.test.js', exit_code: 0 }],
          conclusion: '维修逻辑升级可核验。',
        },
      },
      review: {
        pass: true,
        verified: true,
        notes: `核实 changed_files: ${changed.join(', ')}; node tests/repair-policy.test.js exit 0`,
        verification: {
          verdict: 'true',
          checked: ['implementation.logic_chain', '链路证据要求', '严重度分级', ...changed],
          evidence: [
            { file: 'shared/agents/repair/prompt.md', summary: '已核实输出要求包含链路证据/需求传递判断/严重度。' },
            { file: 'tests/repair-policy.test.js', summary: '已核实三类回归测试。' },
            { command: 'node tests/repair-policy.test.js', exit_code: 0, summary: '测试通过。' },
          ],
        },
      },
    },
    evidence: [{ type: 'test', path: 'tests/repair-policy.test.js' }],
    visits: { implement: 1, review: 1 },
  };
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: path.resolve(__dirname, '..'),
    requireDeliveryEvidence: true,
  });
  assert.strictEqual(gate.ok, true, gate.reason);
}

// §5 守卫:历史上本文件用"自报 exit_code:0 + 命令从未执行"断言 gate.ok===true,
// 等于把"假完成可绕过真实执行"固化进 CI。这里反转成守卫——开启 executeEvidence 后,
// 自报通过但真跑失败的命令必须被 done gate 打回。
function testExecuteEvidenceRejectsFakePass() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-policy-exec-'));
  try {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'boom.fixture.js'), 'process.exit(1);\n');
    const res = DoneGate.verifyExecutableEvidence(
      { implementation: { logic_chain: { evidence: [{ command: 'node tests/boom.fixture.js', exit_code: 0 }] } } },
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, false, '自报 exit_code:0 但命令真跑失败必须被 done gate 打回(防假完成)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  testDetectsHandoffRequirementOmission();
  testSevereGoesGlobalTrace();
  testSimpleGoesLocalFix();
  testCliReadsLocalArtifacts();
  testRepairPolicyChangePassesDoneGateFixture();
  testExecuteEvidenceRejectsFakePass();
  console.log(JSON.stringify({ pass: true, suite: 'repair-policy' }));
}

main();
