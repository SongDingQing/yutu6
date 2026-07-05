#!/usr/bin/env node
'use strict';

// 第5/防假完成续:agent-once 自报未完成门。
// 根因:runner 永远写 result.md 当 evidence,所以 require_evidence 对 agent-once 形同虚设——
//      模型自报 implementation.done=false(如 quality_ops 的 runner_no_fs_or_exec)照样被判 done。
// 本测试把"模型显式自报未完成必须打回、但不破坏正常 agent-once / 不走 implementation 合同的角色"固化进 CI。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DoneGate = require('../shared/engine/done-gate');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');

const repoRoot = path.resolve(__dirname, '..');

// ---- 单元:selfReportedIncomplete 纯函数 ----
function testUnitDoneFalseIncomplete() {
  const r = DoneGate.selfReportedIncomplete({ implementation: { done: false } });
  assert.strictEqual(r.incomplete, true, 'done=false 必须判未完成');
  assert(/done=false/.test(r.reason || ''), r.reason);
}

function testUnitBlockedIncomplete() {
  const r = DoneGate.selfReportedIncomplete({ implementation: { logic_chain: { current_status: 'blocked' } } });
  assert.strictEqual(r.incomplete, true, 'logic_chain.current_status=blocked 必须判未完成');
  assert(/blocked/.test(r.reason || ''), r.reason);
}

function testUnitDoneTrueComplete() {
  const r = DoneGate.selfReportedIncomplete({ implementation: { done: true, logic_chain: { current_status: 'done' } } });
  assert.strictEqual(r.incomplete, false, 'done=true 不拦');
}

function testUnitNoImplementationCompat() {
  // 不走 implementation 合同的角色(纯分析/洞察/GUI):无 implementation 字段 → 不拦(兼容)
  assert.strictEqual(DoneGate.selfReportedIncomplete({ insights: ['x'] }).incomplete, false);
  assert.strictEqual(DoneGate.selfReportedIncomplete({}).incomplete, false);
  assert.strictEqual(DoneGate.selfReportedIncomplete(null).incomplete, false);
}

function testUnitPartialNotBlocked() {
  // done 非显式 false、status=partial → 不在硬拦范围(避免误杀);只拦显式 false / blocked
  assert.strictEqual(
    DoneGate.selfReportedIncomplete({ implementation: { logic_chain: { current_status: 'partial' } } }).incomplete,
    false,
  );
  assert.strictEqual(DoneGate.selfReportedIncomplete({ implementation: { summary: '无 done 字段' } }).incomplete, false);
}

// ---- 集成:runFlow + agent-once 流程 ----
function agentOnceFlow() {
  return {
    id: 'agent-once',
    nodes: [
      { id: 'execute', agent_role: 'quality_ops' },
      { id: 'done', type: 'end' },
    ],
    edges: [{ from: 'execute', to: 'done' }],
    guards: { validate_before_run: false, max_loops: 1 },
    acceptance: { require_evidence: true },
  };
}

function runAgentOnce(vars) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-once-selfrep-'));
  const events = [];
  try {
    const result = runFlow({
      flow: agentOnceFlow(),
      taskId: 'selfrep-' + Object.keys(vars.implementation || {}).join('-'),
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
      workspaceRoot: repoRoot,
      vars: { goal: '质量复核', acceptance: '给结论和依据' },
      // runner 永远落 result.md 当 evidence —— 模拟真实 cli-runner 行为(require_evidence 因此必过)
      runner() {
        return { vars, evidence: { type: 'result', runner: 'fake', path: path.join(root, 'result.md') } };
      },
    });
    return { result, events };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testIntegDoneFalseFails() {
  // 关键反例:模型自报 done=false 但写了 result.md(有 evidence)→ 旧逻辑会判 done,新门必须打回
  const { result, events } = runAgentOnce({ implementation: { done: false, summary: 'runner_no_fs_or_exec', logic_chain: { current_status: 'blocked' } } });
  assert.strictEqual(result.ok, false, '自报 done=false 必须不通过');
  assert(/self_report_incomplete/.test(result.reason || ''), `reason 应为 self_report_incomplete: ${result.reason}`);
  assert.strictEqual(result.task.state, 'failed', '任务必须落 failed,不能假完成');
  assert(events.some(e => e.type === 'done_gate.self_report_incomplete'), '应发 done_gate.self_report_incomplete 事件');
}

function testIntegDoneTruePasses() {
  const { result } = runAgentOnce({ implementation: { done: true, summary: '真做完', logic_chain: { current_status: 'done' } } });
  assert.strictEqual(result.ok, true, '正常 agent-once(done=true)必须照常通过');
  assert.strictEqual(result.task.state, 'done');
}

function testIntegNoImplementationCompat() {
  // 不走 implementation 合同的角色:只产出 evidence,无 implementation → 不被新门误杀
  const { result } = runAgentOnce({ insights: [{ note: '某洞察' }] });
  assert.strictEqual(result.ok, true, '无 implementation 字段的 agent-once 不应被新门拦');
  assert.strictEqual(result.task.state, 'done');
}

function main() {
  testUnitDoneFalseIncomplete();
  testUnitBlockedIncomplete();
  testUnitDoneTrueComplete();
  testUnitNoImplementationCompat();
  testUnitPartialNotBlocked();
  testIntegDoneFalseFails();
  testIntegDoneTruePasses();
  testIntegNoImplementationCompat();
  console.log(JSON.stringify({ pass: true, suite: 'agent-once-self-report' }));
}

main();
