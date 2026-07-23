#!/usr/bin/env node
'use strict';

// failover 守卫:让 model-routing.yaml 声明的 prefer 候选链真生效——
// 首选 runner 执行失败(非0/超时/信号)时,按候选顺序降级到下一个 runner 重试,而非整节点失败。
// 把"声明了 prefer 但代码只取单 runner、失败即维修循环"这个设计↔代码脱钩固化进 CI。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Failover = require('../shared/routing/failover');
const { makeCliRunner } = require('../shared/engine/cli-runner');
const QuotaDegrade = require('../projects/控制台/quota-degrade');

// ---- 单元:failover.js ----
function testTokenMap() {
  assert.strictEqual(Failover.preferTokenToRunnerId('subscription.codex'), 'codex');
  assert.strictEqual(Failover.preferTokenToRunnerId('api.zhipu.glm-5.2'), 'zhipu-glm');
  assert.strictEqual(Failover.preferTokenToRunnerId('subscription.claude.sonnet'), null, 'expired Claude subscription must not resolve to a runner');
  assert.strictEqual(Failover.preferTokenToRunnerId('api.deepseek.deepseek-chat'), 'new-api');
  assert.strictEqual(Failover.preferTokenToRunnerId('api.kimi.k3'), 'kimi-k2');
  assert.strictEqual(Failover.preferTokenToRunnerId('api.openai.gpt-5'), null, 'openai 无独立 runner → null');
  assert.strictEqual(Failover.preferTokenToRunnerId('local.ollama.qwen2.5'), null, 'ollama 无 runner → null');
  assert.strictEqual(Failover.preferTokenToRunnerId('garbage'), null);
}

function testParseRolePrefer() {
  const yaml = [
    'providers:',
    '  subscription:',
    '    codex: { via: codex-cli }',
    'roles:',
    '  worker_code:',
    '    tier: exec',
    '    prefer: [subscription.codex, api.zhipu.glm-5.2, api.openai.gpt-5]',
    '  supervisor:',
    '    prefer: [subscription.codex, api.zhipu.glm-5.2]',
    'failover:',
    '  chain: [subscription, api, local]',
  ].join('\n');
  const m = Failover.parseRolePrefer(yaml);
  assert.deepStrictEqual(m.worker_code, ['subscription.codex', 'api.zhipu.glm-5.2', 'api.openai.gpt-5']);
  assert.deepStrictEqual(m.supervisor, ['subscription.codex', 'api.zhipu.glm-5.2']);
  assert(!m.chain, 'failover.chain 不是 role,不应被当成 role 抓进来');
}

function testFailoverCandidates() {
  const runners = { codex: {}, 'zhipu-glm': {} };
  const rolePrefer = { worker_code: ['subscription.codex', 'api.zhipu.glm-5.2', 'api.openai.gpt-5'] };
  // primary=codex(roleMap 不变) + 降级候选 zhipu-glm(openai 跳过)
  const chain = Failover.failoverCandidates('worker_code', { primaryRunnerId: 'codex', runners, rolePrefer });
  assert.deepStrictEqual(chain, ['codex', 'zhipu-glm']);
  // primary 与 prefer[0] 不同(supervisor roleMap=zhipu-glm):primary 仍首选,prefer 给降级
  const chain2 = Failover.failoverCandidates('supervisor', {
    primaryRunnerId: 'zhipu-glm', runners,
    rolePrefer: { supervisor: ['subscription.codex', 'api.zhipu.glm-5.2'] },
  });
  assert.deepStrictEqual(chain2, ['zhipu-glm', 'codex'], 'primary 不变,codex 作降级,重复的 zhipu-glm 去重');
  // 候选不在 config.runners → 跳过
  const chain3 = Failover.failoverCandidates('worker_code', { primaryRunnerId: 'codex', runners: { codex: {} }, rolePrefer });
  assert.deepStrictEqual(chain3, ['codex'], 'zhipu-glm 不在 runners → 仅 primary');
}

function testUiOptimizerCurrentConfigUsesCodex() {
  const config = require('../projects/控制台/config.json');
  const ui = config.roleRouting && config.roleRouting.ui_optimizer;
  assert(ui, '当前配置应定义 roleRouting.ui_optimizer');
  assert.strictEqual(ui.runner, 'codex', 'ui_optimizer primary runner 应为 Codex');
  assert.strictEqual(ui.rollout && ui.rollout.rollbackRunner, 'codex', 'ui_optimizer rollbackRunner 应为 codex');

  const rolePrefer = Failover.loadRolePrefer(path.resolve(__dirname, '../shared/routing/model-routing.yaml'));
  assert(rolePrefer.ui_optimizer, 'model-routing.yaml 应定义 roles.ui_optimizer.prefer');
  assert.strictEqual(rolePrefer.ui_optimizer[0], 'subscription.codex', 'subscription.codex 应为首选');

  const chain = Failover.failoverCandidates('ui_optimizer', {
    primaryRunnerId: ui.runner,
    runners: config.runners,
    rolePrefer,
  });
  assert(chain.includes('codex'), 'ui_optimizer failoverCandidates 应包含 codex: ' + JSON.stringify(chain));
}

function testMemoryOfficerCurrentConfigUsesCodex() {
  const config = require('../projects/控制台/config.json');
  const memory = config.roleRouting && config.roleRouting.memory_officer;
  assert(memory, '当前配置应定义 roleRouting.memory_officer');
  assert.strictEqual(memory.runner, 'codex', 'memory_officer primary runner 应为 codex');

  const rolePrefer = Failover.loadRolePrefer(path.resolve(__dirname, '../shared/routing/model-routing.yaml'));
  assert(rolePrefer.memory_officer, 'model-routing.yaml 应定义 roles.memory_officer.prefer');
  assert.strictEqual(rolePrefer.memory_officer[0], 'subscription.codex', 'memory_officer 应以 subscription.codex 作为首选');

  const chain = Failover.failoverCandidates('memory_officer', {
    primaryRunnerId: memory.runner,
    runners: config.runners,
    rolePrefer,
  });
  assert.deepStrictEqual(chain, ['codex', 'zhipu-glm'], 'memory_officer failover chain 应从 codex 降级到 zhipu-glm: ' + JSON.stringify(chain));
}

function testFrontendDesignerCurrentConfigHasCodexFallback() {
  const config = require('../projects/控制台/config.json');
  const frontend = config.roleRouting && config.roleRouting.frontend_designer;
  assert(frontend, '当前配置应定义 roleRouting.frontend_designer');
  assert.strictEqual(frontend.runner, 'zhipu-glm', 'frontend_designer primary runner 应为 GLM-5.2');

  const rolePrefer = Failover.loadRolePrefer(path.resolve(__dirname, '../shared/routing/model-routing.yaml'));
  assert(rolePrefer.frontend_designer, 'model-routing.yaml 应定义 roles.frontend_designer.prefer');
  assert.deepStrictEqual(
    rolePrefer.frontend_designer,
    ['api.zhipu.glm-5.2', 'subscription.codex'],
    'frontend_designer 应在 GLM 繁忙/限流后降级到 Codex',
  );

  const chain = Failover.failoverCandidates('frontend_designer', {
    primaryRunnerId: frontend.runner,
    runners: config.runners,
    rolePrefer,
  });
  assert.deepStrictEqual(chain, ['zhipu-glm', 'codex'], 'frontend_designer failover chain 应为 GLM→Codex: ' + JSON.stringify(chain));
}

function testClassifyFailure() {
  assert.strictEqual(Failover.classifyFailure('codex 运行超时(1800s)'), 'timeout');
  assert.strictEqual(Failover.classifyFailure('kimi-k2 退出码 1: Invalid Authentication'), 'auth');
  assert.strictEqual(Failover.classifyFailure('预扣费额度失败, 用户剩余额度: 0.4'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('预扣费失败, 余额: 0'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('退出码 1: insufficient_quota'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('You exceeded your current quota, please check your plan'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('zhipu 账户额度耗尽,请充值'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('quota_exhausted: 候选池全部熔断(quota circuit breaker)'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('退出码 1: HTTP 429 rate limit'), 'http_429');
  assert.strictEqual(Failover.classifyFailure('zhipu-glm-tools 退出码 1: 该模型当前访问量过大，请您稍后再试'), 'http_429');
  assert.strictEqual(Failover.classifyFailure('退出码 1: 503 server error'), 'http_5xx');
  assert.strictEqual(Failover.classifyFailure('No available channel'), 'model_unavailable');
  assert.strictEqual(Failover.classifyFailure('退出码 2: 杂项'), 'runner_error');
}

// ---- 集成:makeCliRunner 首选失败 → 降级成功 ----
function writeMockRunner(file, body) {
  fs.writeFileSync(file, "'use strict';\n" + body + '\n');
}

function setupFailoverRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-failover-'));
  const runsDir = path.join(root, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const failScript = path.join(root, 'fail.js');
  const okScript = path.join(root, 'ok.js');
  // 首选:模拟 429 退出 1
  writeMockRunner(failScript, 'process.stderr.write("HTTP 429 rate limit\\n"); process.exit(1);');
  // 降级:输出合法 implementation JSON(```json 围栏,匹配 extractJson),退 0
  writeMockRunner(okScript, 'process.stdout.write("ok\\n\\n```json\\n"+JSON.stringify({implementation:{done:true,summary:"fallback ok"}})+"\\n```\\n"); process.exit(0);');
  const runners = {
    primary: { label: 'primary(fail)', cmd: [process.execPath, failScript], promptVia: 'arg' },
    codex: { label: 'codex(ok)', cmd: [process.execPath, okScript], promptVia: 'arg' },
  };
  const events = [];
  const eventlog = { emit(type, data) { events.push(Object.assign({ type }, data || {})); }, file: null };
  return { root, runsDir, runners, events, eventlog };
}

function testIntegFailoverSucceeds() {
  const { root, runsDir, runners, events, eventlog } = setupFailoverRun();
  try {
    const runner = makeCliRunner({
      runners,
      roleMap: { myrole: 'primary' },
      rolePrefer: { myrole: ['subscription.codex'] }, // → 降级候选 codex
      runsDir,
      eventlog,
      nodeTimeoutSec: 30,
    });
    const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.vars && out.vars.implementation && out.vars.implementation.done === true, '应拿到降级 runner 的成功结果: ' + JSON.stringify(out));
    const fo = events.find(e => e.type === 'runner.failover');
    assert(fo, '应发 runner.failover 事件');
    assert.strictEqual(fo.from, 'primary');
    assert.strictEqual(fo.to, 'codex');
    assert.strictEqual(fo.reason, 'http_429', '429 应被分类: ' + fo.reason);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testIntegDisabledNoFailover() {
  const { root, runsDir, runners, events, eventlog } = setupFailoverRun();
  try {
    const runner = makeCliRunner({
      runners,
      roleMap: { myrole: 'primary' },
      rolePrefer: { myrole: ['subscription.codex'] },
      runsDir,
      eventlog,
      nodeTimeoutSec: 30,
      failover: false, // 关闭 → 只跑首选,失败即 fail
    });
    const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.fail, '关闭 failover 时首选失败应整体 fail');
    assert(!events.some(e => e.type === 'runner.failover'), '关闭时不应有 failover 事件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testIntegAllFail() {
  const { root, runsDir, runners, events, eventlog } = setupFailoverRun();
  try {
    // 把 codex 也换成失败脚本
    const fail2 = path.join(root, 'fail2.js');
    writeMockRunner(fail2, 'process.stderr.write("503 server error\\n"); process.exit(1);');
    runners.codex = { label: 'codex(also fail)', cmd: [process.execPath, fail2], promptVia: 'arg' };
    const runner = makeCliRunner({
      runners, roleMap: { myrole: 'primary' },
      rolePrefer: { myrole: ['subscription.codex'] },
      runsDir, eventlog, nodeTimeoutSec: 30,
    });
    const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.fail, '全候选失败 → 整节点 fail');
    assert(events.some(e => e.type === 'runner.failover'), '降级尝试过 → 应有 failover 事件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testWritableHarnessFailureFallsBackToCodex() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-harness-failover-'));
  const runsDir = path.join(root, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const busyScript = path.join(root, 'busy.js');
  const okScript = path.join(root, 'codex-ok.js');
  writeMockRunner(busyScript, 'process.stderr.write("该模型当前访问量过大，请您稍后再试\\n"); process.exit(1);');
  writeMockRunner(okScript, 'process.stdout.write("ok\\n\\n```json\\n"+JSON.stringify({implementation:{done:true,summary:"codex fallback ok"}})+"\\n```\\n"); process.exit(0);');
  const runners = {
    'zhipu-glm': {
      label: 'GLM text',
      kind: 'openai_http',
      cmd: ['__mock_text_only__'],
      execution: { canWriteFiles: false, toolHarnessRunner: 'zhipu-glm-tools' },
    },
    'zhipu-glm-tools': {
      label: 'GLM tools busy',
      cmd: [process.execPath, busyScript],
      promptVia: 'arg',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
    codex: {
      label: 'codex fallback',
      cmd: [process.execPath, okScript],
      promptVia: 'arg',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
  };
  const events = [];
  const eventlog = { emit(type, data) { events.push(Object.assign({ type }, data || {})); }, file: null };
  try {
    const runner = makeCliRunner({
      runners,
      roleMap: { frontend_designer: 'zhipu-glm' },
      rolePrefer: { frontend_designer: ['api.zhipu.glm-5.2', 'subscription.codex'] },
      roleExecMeta: { frontend_designer: { requiresWritableRunnerForImplement: true } },
      runsDir,
      eventlog,
      nodeTimeoutSec: 30,
    });
    const out = runner({ id: 'execute', agent_role: 'frontend_designer' }, { goal: 'scheduled page review', acceptance: 'write report' }, 1);
    assert(out.vars && out.vars.implementation && out.vars.implementation.done === true, 'Codex fallback 应完成工具型 frontend_designer 节点: ' + JSON.stringify(out));
    assert(events.some(e => e.type === 'runner.tool_harness.upgrade' && e.from === 'zhipu-glm' && e.to === 'zhipu-glm-tools'), '首选 GLM 应先升级到 tool harness');
    const fo = events.find(e => e.type === 'runner.failover');
    assert(fo, 'tool harness 繁忙后应发 runner.failover 事件');
    assert.strictEqual(fo.from, 'zhipu-glm-tools');
    assert.strictEqual(fo.to, 'codex');
    assert.strictEqual(fo.reason, 'http_429');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---- 额度熔断(拍板④ 2026-07-03):熔断期跳过 / retry_after 到点试探 / 池空告警不硬试 / 开关退回 ----
function withEnv(name, value, fn) {
  const old = process.env[name];
  if (value == null) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally {
    if (old == null) delete process.env[name]; else process.env[name] = old;
  }
}

function sleepBusyMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* 等 retry_after 过点(退避被压到 1ms) */ }
}

// primary/codex 都带执行痕迹 marker:证明"跳过"是真没 spawn,而不是失败后被吞。
function setupBreakerRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-quota-breaker-'));
  const runsDir = path.join(root, 'runs');
  const quotaRoot = path.join(root, 'artifacts');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(quotaRoot, { recursive: true });
  const primaryMarker = path.join(root, 'primary-ran.marker');
  const codexMarker = path.join(root, 'codex-ran.marker');
  const quotaFailScript = path.join(root, 'quota-fail.js');
  const okScript = path.join(root, 'ok.js');
  const primaryOkScript = path.join(root, 'primary-ok.js');
  writeMockRunner(quotaFailScript, [
    `require('fs').writeFileSync(${JSON.stringify(primaryMarker)}, 'ran');`,
    'process.stderr.write("预扣费额度失败, 用户剩余额度: 0.0\\n");',
    'process.exit(1);',
  ].join('\n'));
  writeMockRunner(okScript, [
    `require('fs').writeFileSync(${JSON.stringify(codexMarker)}, 'ran');`,
    'process.stdout.write("ok\\n\\n```json\\n"+JSON.stringify({implementation:{done:true,summary:"fallback ok"}})+"\\n```\\n");',
    'process.exit(0);',
  ].join('\n'));
  writeMockRunner(primaryOkScript, [
    `require('fs').writeFileSync(${JSON.stringify(primaryMarker)}, 'ran');`,
    'process.stdout.write("ok\\n\\n```json\\n"+JSON.stringify({implementation:{done:true,summary:"primary ok"}})+"\\n```\\n");',
    'process.exit(0);',
  ].join('\n'));
  const runners = {
    primary: { label: 'primary(quota fail)', cmd: [process.execPath, quotaFailScript], promptVia: 'arg' },
    codex: { label: 'codex(ok)', cmd: [process.execPath, okScript], promptVia: 'arg' },
  };
  const events = [];
  const eventlog = { emit(type, data) { events.push(Object.assign({ type }, data || {})); }, file: null };
  return { root, runsDir, quotaRoot, runners, events, eventlog, primaryMarker, codexMarker, quotaFailScript, okScript, primaryOkScript };
}

function makeBreakerRunner(fx, extra = {}) {
  return makeCliRunner(Object.assign({
    runners: fx.runners,
    roleMap: { myrole: 'primary' },
    rolePrefer: { myrole: ['subscription.codex'] },
    runsDir: fx.runsDir,
    eventlog: fx.eventlog,
    nodeTimeoutSec: 30,
    quotaStateRoot: fx.quotaRoot,
  }, extra));
}

// ① 额度类失败触发熔断;② 熔断期内该候选被直接跳过(不 spawn)
function testQuotaFailureTripsBreakerAndSkips() {
  const fx = setupBreakerRun();
  try {
    const runner = makeBreakerRunner(fx);
    const out1 = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out1.vars && out1.vars.implementation && out1.vars.implementation.done === true, '额度失败后应降级 codex 成功: ' + JSON.stringify(out1));
    assert(fs.existsSync(fx.primaryMarker), '第一次 primary 应真实执行过');
    const state = QuotaDegrade.readState(fx.quotaRoot, QuotaDegrade.runnerScope('primary'));
    assert(state && state.status === 'degraded', '额度失败必须写 quota-degrade 熔断状态');
    assert.strictEqual(state.breaker.strikes, 1);
    assert(Date.parse(state.breaker.retry_after) > Date.now(), 'retry_after 必须在未来');
    assert(fx.events.some(e => e.type === 'quota.breaker.tripped' && e.runner === 'primary'), '应发 quota.breaker.tripped 事件');

    fs.unlinkSync(fx.primaryMarker);
    const out2 = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 2);
    assert(out2.vars && out2.vars.implementation, '熔断期内应直接用 codex 成功');
    assert(!fs.existsSync(fx.primaryMarker), '熔断期内 primary 不得被 spawn(只跳过,不重排)');
    assert(fx.events.some(e => e.type === 'quota.breaker.skip' && e.runner === 'primary'), '应发 quota.breaker.skip 事件');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ③ retry_after 到点 → 放行一次小流量试探,成功即恢复(restored + strikes 清零)
function testBreakerProbeRecoversAfterRetryAfter() {
  const fx = setupBreakerRun();
  try {
    withEnv('YUTU6_QUOTA_BREAKER_BASE_MS', '1', () => {
      QuotaDegrade.tripQuotaBreaker(fx.quotaRoot, QuotaDegrade.runnerScope('primary'), { reason: '预扣费额度失败', runnerType: 'primary' });
    });
    fx.runners.primary = { label: 'primary(recovered)', cmd: [process.execPath, fx.primaryOkScript], promptVia: 'arg' };
    sleepBusyMs(5); // retry_after(1ms 退避)过点
    const runner = makeBreakerRunner(fx);
    const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.vars && out.vars.implementation && out.vars.implementation.summary === 'primary ok', '到点试探应放行 primary 并成功: ' + JSON.stringify(out));
    assert(fs.existsSync(fx.primaryMarker), '试探必须真实执行 primary');
    const state = QuotaDegrade.readState(fx.quotaRoot, QuotaDegrade.runnerScope('primary'));
    assert.strictEqual(state.status, 'restored', '试探成功必须恢复 scope');
    assert.strictEqual(state.breaker.strikes, 0, '恢复后 strikes 清零');
    assert(fx.events.some(e => e.type === 'quota.breaker.probe' && e.runner === 'primary'), '应发 quota.breaker.probe 事件');
    assert(fx.events.some(e => e.type === 'quota.breaker.restored' && e.runner === 'primary'), '应发 quota.breaker.restored 事件');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ③b 试探失败 → 退避翻倍(strikes+1)
function testBreakerProbeFailureDoublesBackoff() {
  const fx = setupBreakerRun();
  try {
    withEnv('YUTU6_QUOTA_BREAKER_BASE_MS', '1', () => {
      QuotaDegrade.tripQuotaBreaker(fx.quotaRoot, QuotaDegrade.runnerScope('primary'), { reason: '预扣费额度失败', runnerType: 'primary' });
      sleepBusyMs(5);
      const runner = makeBreakerRunner(fx); // primary 仍是额度失败脚本
      const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
      assert(out.vars && out.vars.implementation, '试探失败后应降级 codex 成功');
      const state = QuotaDegrade.readState(fx.quotaRoot, QuotaDegrade.runnerScope('primary'));
      assert.strictEqual(state.status, 'degraded');
      assert.strictEqual(state.breaker.strikes, 2, '试探失败必须退避翻倍(strikes 1→2)');
      assert.strictEqual(state.breaker.backoff_ms, 2, 'base=1ms 时第二次退避应为 2ms');
      assert(fx.events.some(e => e.type === 'quota.breaker.tripped' && e.runner === 'primary' && e.probe === true), '试探失败应发 probe:true 的 tripped 事件');
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ④ 候选池全部熔断 → 不 spawn 任何 runner + quota.pool_exhausted 升级告警 + fail 文案带 quota_exhausted(留队列等待)
function testPoolExhaustedEmitsAlertAndNeverRuns() {
  const fx = setupBreakerRun();
  try {
    for (const id of ['primary', 'codex']) {
      QuotaDegrade.tripQuotaBreaker(fx.quotaRoot, QuotaDegrade.runnerScope(id), { reason: '预扣费额度失败', runnerType: id });
    }
    const runner = makeBreakerRunner(fx);
    const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.fail, '池空必须返回 fail(任务留队列等待)');
    assert.match(out.fail, /quota_exhausted/, 'fail 文案必须带 quota_exhausted 让额度信号分类命中');
    assert.match(out.fail, /熔断/, 'fail 文案必须说明是熔断');
    assert(!fs.existsSync(fx.primaryMarker) && !fs.existsSync(fx.codexMarker), '池空时绝不静默硬试任何 runner');
    const alert = fx.events.find(e => e.type === 'quota.pool_exhausted');
    assert(alert, '池空必须发 quota.pool_exhausted 升级告警');
    assert.deepStrictEqual(alert.candidates, ['primary', 'codex']);
    assert(!fx.events.some(e => e.type === 'runner.failover'), '没跑任何候选就不该有 failover 事件');
    // classifyQuotaSignal(ceo-worker 同款分类)必须命中,保证任务回队列而不是判 failed
    const signal = QuotaDegrade.classifyQuotaSignal(out.fail, {});
    assert.strictEqual(signal.isQuotaExhausted, true, '池空 fail 文案必须被额度信号分类命中: ' + JSON.stringify(signal));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ④b 异步路径(runNodeAsync)同样受熔断约束
async function testPoolExhaustedAsyncPath() {
  const fx = setupBreakerRun();
  try {
    for (const id of ['primary', 'codex']) {
      QuotaDegrade.tripQuotaBreaker(fx.quotaRoot, QuotaDegrade.runnerScope(id), { reason: '预扣费额度失败', runnerType: id });
    }
    const runner = makeBreakerRunner(fx);
    const out = await runner.runNodeAsync({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
    assert(out.fail && /quota_exhausted/.test(out.fail), '异步路径池空同样必须 fail+quota_exhausted');
    assert(!fs.existsSync(fx.primaryMarker) && !fs.existsSync(fx.codexMarker), '异步路径池空也不得硬试');
    assert(fx.events.some(e => e.type === 'quota.pool_exhausted'), '异步路径也要发 quota.pool_exhausted');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// 开关:YUTU6_QUOTA_BREAKER=0 退回旧行为(候选不过滤、失败不熔断、无 breaker 事件)
function testBreakerSwitchOffRestoresOldBehavior() {
  const fx = setupBreakerRun();
  try {
    for (const id of ['primary', 'codex']) {
      QuotaDegrade.tripQuotaBreaker(fx.quotaRoot, QuotaDegrade.runnerScope(id), { reason: '预扣费额度失败', runnerType: id });
    }
    withEnv('YUTU6_QUOTA_BREAKER', '0', () => {
      const runner = makeBreakerRunner(fx);
      const out = runner({ id: 'execute', agent_role: 'myrole' }, { goal: 'g', acceptance: 'a' }, 1);
      assert(out.vars && out.vars.implementation, '开关关掉后退回旧行为:primary 失败 → codex 降级成功');
      assert(fs.existsSync(fx.primaryMarker), '开关关掉后 primary 照旧执行(不过滤)');
      assert(fx.events.some(e => e.type === 'runner.failover'), '旧行为的 failover 事件保留');
      assert(!fx.events.some(e => /^quota\.breaker\./.test(e.type) || e.type === 'quota.pool_exhausted'), '开关关掉后不得有任何熔断事件');
      const state = QuotaDegrade.readState(fx.quotaRoot, QuotaDegrade.runnerScope('primary'));
      assert.strictEqual(state.breaker.strikes, 1, '开关关掉后失败不再累计熔断');
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

async function main() {
  testTokenMap();
  testParseRolePrefer();
  testFailoverCandidates();
  testUiOptimizerCurrentConfigUsesCodex();
  testMemoryOfficerCurrentConfigUsesCodex();
  testFrontendDesignerCurrentConfigHasCodexFallback();
  testClassifyFailure();
  testIntegFailoverSucceeds();
  testIntegDisabledNoFailover();
  testIntegAllFail();
  testWritableHarnessFailureFallsBackToCodex();
  testQuotaFailureTripsBreakerAndSkips();
  testBreakerProbeRecoversAfterRetryAfter();
  testBreakerProbeFailureDoublesBackoff();
  testPoolExhaustedEmitsAlertAndNeverRuns();
  await testPoolExhaustedAsyncPath();
  testBreakerSwitchOffRestoresOldBehavior();
  console.log(JSON.stringify({ pass: true, suite: 'runner-failover' }));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
