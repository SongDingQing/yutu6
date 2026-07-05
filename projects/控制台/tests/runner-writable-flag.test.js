// 回归测试:角色级 requiresWritableRunnerForImplement 必须被遵守,
// 不能让 goal 文本里的「评审/报告/只读」把需要落盘的 execute 节点误判为纯文本 runner。
// 复现工单 auto-20260625013315-dc613b9ef8b5260c(frontend_designer 定时评审落在纯文本 GLM,自报 done=false)。
const assert = require('assert');
const { resolveRunnerForNode, nodeNeedsWritableRunner } = require('../../../shared/engine/cli-runner');

const runners = {
  'zhipu-glm': { kind: 'openai_http', cmd: ['__openai_http__'], execution: { canWriteFiles: false, toolHarnessRunner: 'zhipu-glm-tools' } },
  'zhipu-glm-tools': { kind: 'openai_http_tool_harness', cmd: ['__openai_http_tool_harness__'], modelRunner: 'zhipu-glm', executorRunner: 'codex', execution: { canWriteFiles: true } },
};
const roleMap = { frontend_designer: 'zhipu-glm' };
const node = { id: 'execute', agent_role: 'frontend_designer' };
// 评审/巡检类 goal:纯文本启发式判 false(只读/巡检/报告/清单,无落地动作词),
// 但角色实际要跑预检脚本、写报告文件 —— 这就是工单的漏判形态。
const reviewCtx = { goal: '定时巡检,梳理结论清单与建议', acceptance: '输出评审报告', bounds: '只读为主' };

function run() {
  delete process.env.YUTU6_HONOR_WRITABLE_FLAG;

  // 1) 启发式自己会漏判这种评审 goal
  assert.strictEqual(nodeNeedsWritableRunner(node, reviewCtx, null), false, '基线:纯文本启发式对评审 goal 判 false(就是 bug 来源)');

  // 2) 角色声明 requiresWritableRunnerForImplement → 必须判 true 并升级到 harness
  const declared = { frontend_designer: { requiresWritableRunnerForImplement: true } };
  assert.strictEqual(nodeNeedsWritableRunner(node, reviewCtx, declared.frontend_designer), true, '角色声明可写 → needsWritable=true');
  const up = resolveRunnerForNode(node, reviewCtx, roleMap, runners, null, declared);
  assert.strictEqual(up.upgraded, true, '应升级');
  assert.strictEqual(up.runnerId, 'zhipu-glm-tools', '应落到工具 harness 而非纯文本 GLM');

  // 3) 没有声明 → 维持旧行为(评审 goal 不升级,仍是纯文本)
  const noFlag = resolveRunnerForNode(node, reviewCtx, roleMap, runners, null, {});
  assert.strictEqual(noFlag.upgraded, false, '无声明:维持旧行为');
  assert.strictEqual(noFlag.runnerId, 'zhipu-glm', '无声明:仍是纯文本 GLM');

  // 4) 可逆开关:YUTU6_HONOR_WRITABLE_FLAG=0 退回旧行为
  process.env.YUTU6_HONOR_WRITABLE_FLAG = '0';
  assert.strictEqual(nodeNeedsWritableRunner(node, reviewCtx, declared.frontend_designer), false, '开关=0 时不遵守声明');
  delete process.env.YUTU6_HONOR_WRITABLE_FLAG;

  // 5) 非 execute/implement 节点不受影响
  assert.strictEqual(nodeNeedsWritableRunner({ id: 'review', agent_role: 'frontend_designer' }, reviewCtx, declared.frontend_designer), false, 'review 节点保持纯文本');

  console.log('PASS runner-writable-flag.test.js (5 cases)');
}

run();
