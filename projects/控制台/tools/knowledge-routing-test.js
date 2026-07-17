#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Routing = require('../knowledge-routing');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '../..');
const FIXTURES = [
  'projects/控制台/artifacts/engine-runs/cr-1784088134705-qops-20260715-batch-02/execute-1-fo1/task.redacted.md',
  'projects/控制台/artifacts/engine-runs/cr-1784088134590-qops-20260715-batch-01/execute-1-fo1/task.redacted.md',
];

function approvedConfig(overrides = {}) {
  return Routing.normalizeConfig(Object.assign({
    enabled: true,
    promotionApproval: {
      status: 'approved',
      supervisorReviewed: true,
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
    },
  }, overrides));
}

function extractKnowledgeCandidates(relativeFile) {
  const source = fs.readFileSync(path.join(WORKSPACE, relativeFile), 'utf8');
  const block = source.match(/# 知识库检索[^\n]*\n([\s\S]*?)(?=\n# |\n请完成|$)/);
  assert(block, `fixture knowledge block missing: ${relativeFile}`);
  return block[1].split(/\r?\n/).map(line => {
    const hit = line.match(/^- \[([^\]]+)\]\s+(.+)$/);
    return hit ? { path: hit[1], text: hit[2] } : null;
  }).filter(Boolean);
}

function bodyOnly(rendered) {
  const match = rendered.match(/## 正文注入\n([\s\S]*?)(?=\n## 未注入引用桩|$)/);
  return match ? match[1] : '';
}

function testRealQualityOpsReplay() {
  const reports = [];
  for (const fixture of FIXTURES) {
    const candidates = extractKnowledgeCandidates(fixture);
    assert(candidates.length >= 3, '真实信封应至少复现三段污染候选');
    const decision = Routing.routeKnowledgeCandidates({
      ctx: {
        projectId: '控制台',
        goal: '质量运营官做完整交互链路审计，检查知识路由和无效上下文',
        taskTags: ['quality', 'audit', 'knowledge'],
      },
      node: { id: 'execute', agent_role: 'quality_ops' },
      candidates,
      queryId: `replay:${path.basename(path.dirname(fixture))}`,
      templateId: 'execute:quality_ops',
      config: approvedConfig(),
    });
    const rendered = Routing.renderKnowledgeBlock(decision, approvedConfig());
    const body = bodyOnly(rendered);
    assert(!/玉兔搬家|旧机用户名|Simulaid\(项目档案\)|Unity \/ 团结引擎/.test(body), '无关 migration/Simulaid 内容不得进入正文');
    assert(decision.filtered.length >= 3, '真实污染候选必须被门控并保留引用桩');
    for (const item of decision.filtered) {
      assert(item.fragment.id, '引用桩必须有片段标识');
      assert(item.reasons.length, '引用桩必须有过滤原因');
      assert(rendered.includes(`[${item.fragment.id}]`), '每个过滤片段都必须渲染引用桩');
      assert(rendered.includes('on_demand='), '引用桩必须说明按需回退入口');
    }
    reports.push({ fixture, candidates: candidates.length, injected: decision.injected.length, stubs: decision.filtered.length });
  }
  return reports;
}

function testExplicitReferencePriority() {
  const candidates = [
    { path: 'projects/simulaid.md', text: 'Simulaid 专属 Unity 构建知识' },
    { path: 'migration/migration-notes.md', text: '迁移专属知识' },
    { path: 'projects/控制台/audit.md', text: '控制台质量审计知识' },
  ];
  const first = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '控制台', goal: '质量审计', taskTags: ['quality', 'audit'] },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates,
    queryId: 'explicit-before',
    config: approvedConfig(),
  });
  const simulaid = first.decisions.find(item => item.fragment.path === 'projects/simulaid.md');
  const migration = first.decisions.find(item => item.fragment.path === 'migration/migration-notes.md');
  assert(simulaid && !simulaid.injected, '项目冲突片段默认必须过滤');
  assert(migration && !migration.injected, '第二个项目冲突片段默认必须过滤');
  const forced = Routing.routeKnowledgeCandidates({
    ctx: {
      projectId: '控制台',
      goal: `质量审计；用户显式引用 ${simulaid.fragment.id} 和 ${migration.fragment.id}`,
      taskTags: ['quality', 'audit'],
      explicitKnowledgeRefs: [simulaid.fragment.id, migration.fragment.id],
    },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates,
    queryId: 'explicit-after',
    config: approvedConfig({ maxInjected: 1 }),
  });
  const adopted = forced.decisions.find(item => item.fragment.id === simulaid.fragment.id);
  assert(adopted.injected, '用户显式引用必须优先于项目门控');
  assert.deepStrictEqual(adopted.reasons, ['explicit_reference_override']);
  assert(forced.decisions.find(item => item.fragment.id === migration.fragment.id).injected,
    '多条显式引用不得被普通正文预算截断');
}

function makeReferenceWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-reference-'));
  const knowledgeDir = path.join(root, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(path.join(knowledgeDir, 'query.py'), [
    'import json',
    'print(json.dumps({"ok": True, "hits": [], "mode": "fts"}))',
  ].join('\n'));
  const dbFile = path.join(knowledgeDir, 'kb.sqlite');
  const setup = spawnSync('python3', ['-c', [
    'import sqlite3,sys',
    'db=sqlite3.connect(sys.argv[1])',
    'db.executescript("CREATE TABLE documents(id INTEGER PRIMARY KEY,path TEXT); CREATE TABLE chunks(id INTEGER PRIMARY KEY,doc_id INTEGER,ord INTEGER,text TEXT);")',
    'db.execute("INSERT INTO documents(id,path) VALUES(1,?)", ("migration/migration-notes.md",))',
    'db.execute("INSERT INTO chunks(id,doc_id,ord,text) VALUES(1,1,0,?)", ("迁移专属知识 第一段",))',
    'db.execute("INSERT INTO chunks(id,doc_id,ord,text) VALUES(2,1,1,?)", ("迁移专属知识   第二段",))',
    'db.commit()',
  ].join(';'), dbFile], { encoding: 'utf8' });
  assert.strictEqual(setup.status, 0, setup.stderr);
  return root;
}

function testExactReferenceResolution() {
  const root = makeReferenceWorkspace();
  try {
    const byPath = Routing.fetchKnowledgeCandidates({
      workspaceRoot: root,
      projectId: '控制台',
      goal: '控制台质量审计，语义召回固定为空',
      taskTags: ['quality', 'audit'],
      explicitKnowledgeRefs: ['migration/migration-notes.md'],
    }, { workspaceRoot: root });
    assert(byPath.ok, '显式路径必须在普通语义召回为空时仍可精确取回');
    assert.strictEqual(byPath.referenceResolution.unresolvedRefs.length, 0);
    assert(byPath.candidates.length >= 2, '显式路径应取回对应文档片段');
    const firstId = byPath.candidates[0].fragment_id;
    assert(/^kb_[0-9a-f]{16}$/.test(firstId), '精确解析必须返回可再次查询的稳定片段 ID');

    const byId = Routing.fetchKnowledgeCandidates({
      workspaceRoot: root,
      projectId: '控制台',
      goal: '控制台质量审计，语义召回固定为空',
      taskTags: ['quality', 'audit'],
      explicitKnowledgeRefs: [firstId],
    }, { workspaceRoot: root });
    assert(byId.ok, '引用桩片段 ID 必须可在下一次真实检索中反向解析');
    assert.strictEqual(byId.candidates.length, 1);
    assert.strictEqual(byId.candidates[0].fragment_id, firstId);
    const decision = Routing.routeKnowledgeCandidates({
      ctx: {
        projectId: '控制台',
        goal: `用户显式引用 ${firstId}`,
        taskTags: ['quality', 'audit'],
        explicitKnowledgeRefs: [firstId],
      },
      node: { id: 'execute', agent_role: 'quality_ops' },
      candidates: byId.candidates,
      referenceResolution: byId.referenceResolution,
      queryId: 'exact-ref-id',
      config: approvedConfig(),
    });
    assert.strictEqual(decision.injected.length, 1);
    assert.deepStrictEqual(decision.injected[0].reasons, ['explicit_reference_override']);

    const missingId = 'kb_deadbeefdeadbeef';
    const missing = Routing.fetchKnowledgeCandidates({
      workspaceRoot: root,
      projectId: '控制台',
      goal: '控制台质量审计，语义召回固定为空',
      taskTags: ['quality', 'audit'],
      explicitKnowledgeRefs: [missingId],
    }, { workspaceRoot: root });
    const missingDecision = Routing.routeKnowledgeCandidates({
      ctx: {
        projectId: '控制台', goal: '控制台质量审计', taskTags: ['quality', 'audit'],
        explicitKnowledgeRefs: [missingId],
      },
      node: { id: 'execute', agent_role: 'quality_ops' },
      candidates: missing.candidates,
      referenceResolution: missing.referenceResolution,
      queryId: 'missing-exact-ref-id',
      config: approvedConfig(),
    });
    const missingRendered = Routing.renderKnowledgeBlock(missingDecision, approvedConfig());
    assert(missingRendered.includes(missingId), '未解析显式引用必须保留原标识');
    assert(missingRendered.includes('explicit_reference_not_found'), '未解析显式引用必须显示原因');
    return {
      pathHits: byPath.candidates.length,
      fragmentId: firstId,
      idHits: byId.candidates.length,
      unresolvedVisible: true,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testColdStartAndLowConfidenceFallback() {
  const candidates = [
    { path: 'shared/reference/audit-baseline.md', text: '通用证据核对基线', confidence: 0.10 },
    { path: 'projects/simulaid.md', text: 'Simulaid 专属知识', confidence: 0.95 },
  ];
  const cold = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '新项目A', goal: '新项目首次任务' },
    node: { id: 'execute', agent_role: 'worker_code' },
    candidates,
    queryId: 'cold-start',
    config: approvedConfig(),
  });
  assert(cold.fallback, '新项目/标签缺失必须触发 baseline fallback');
  assert(cold.injected.some(item => item.fragment.path.startsWith('shared/')), 'fallback 必须优先通用知识');

  const missingTags = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '控制台', goal: '首次处理没有既有任务标签的主题' },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates: [
      { path: 'projects/控制台/general.md', text: '控制台同项目候选', confidence: 0.90 },
      { path: 'shared/reference/general-baseline.md', text: '通用基础知识', confidence: 0.80 },
    ],
    queryId: 'missing-tags',
    config: approvedConfig(),
  });
  assert.strictEqual(missingTags.fallbackReason, 'missing_tags_baseline_fallback');
  assert.strictEqual(missingTags.injected.length, 1);
  assert(missingTags.injected[0].fragment.path.startsWith('shared/'),
    '标签缺失必须优先通用 baseline，不能被同项目普通得分短路');

  const low = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '控制台', goal: '质量审计知识检索', taskTags: ['quality', 'audit'] },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates: [{ path: 'shared/reference/baseline.md', text: '通用基线', confidence: 0.05 }],
    queryId: 'low-confidence',
    config: approvedConfig(),
  });
  assert.strictEqual(low.fallbackReason, 'low_confidence_baseline_fallback');
  assert.strictEqual(low.injected.length, 1);

  const lowSameProject = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '控制台', goal: '质量审计知识检索', taskTags: ['quality', 'audit'] },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates: [
      { path: 'projects/控制台/audit.md', text: '控制台质量审计低置信候选', confidence: 0.05 },
      { path: 'shared/reference/audit-baseline.md', text: '通用审计基础知识', confidence: 0.02 },
    ],
    queryId: 'low-confidence-same-project',
    config: approvedConfig(),
  });
  assert.strictEqual(lowSameProject.fallbackReason, 'low_confidence_baseline_fallback');
  assert(lowSameProject.injected[0].fragment.path.startsWith('shared/'),
    '低置信同项目候选即使普通得分过线，也必须让基础回退优先');
  return {
    newProjectReason: cold.fallbackReason,
    missingTagsReason: missingTags.fallbackReason,
    missingTagsSelectedPath: missingTags.injected[0].fragment.path,
    lowConfidenceReason: lowSameProject.fallbackReason,
    lowConfidenceSelectedPath: lowSameProject.injected[0].fragment.path,
  };
}

function testGateFailureFallback() {
  const decision = Routing.routeKnowledgeCandidates({
    ctx: { projectId: '控制台', goal: '质量审计', taskTags: ['quality'] },
    node: { id: 'execute', agent_role: 'quality_ops' },
    candidates: [{ path: 'projects/simulaid.md', text: '可恢复的原始检索结果' }],
    queryId: 'gate-error',
    config: approvedConfig(),
    scorer() { throw new Error('synthetic scorer failure'); },
  });
  assert.strictEqual(decision.fallbackReason, 'gate_evaluation_failed');
  assert.strictEqual(decision.injected.length, 1, '门控失败时必须保留可验证的 legacy 补救结果');
  assert.strictEqual(decision.injected[0].reasons[0], 'fallback_gate_error');
}

function testTraceAndWrapper() {
  const emitted = [];
  const appended = [];
  const ledger = new Routing.AsyncStatsLedger('/unused', {
    appendImpl: async body => { appended.push(body); },
  });
  let receivedCtx = null;
  const base = (_node, ctx) => { receivedCtx = ctx; return { result: { done: true } }; };
  const runner = Routing.makeKnowledgeRoutingRunner(base, {
    config: approvedConfig(),
    env: {},
    taskId: 'wrapper-task',
    workspaceRoot: WORKSPACE,
    ledger,
    eventlog: { emit(type, detail) { emitted.push({ type, detail }); } },
    queryFn() {
      return {
        ok: true,
        query: '质量审计',
        candidates: [
          { path: 'projects/控制台/audit.md', text: '控制台审计正文' },
          { path: 'projects/simulaid.md', text: 'Simulaid 正文' },
        ],
      };
    },
  });
  runner({ id: 'execute', agent_role: 'quality_ops' }, {
    projectId: '控制台', taskId: 'wrapper-task', goal: '质量审计', taskTags: ['quality', 'audit'], agentPrompts: {},
  }, 1);
  assert(receivedCtx.agentPrompts.quality_ops.includes('控制台审计正文'));
  assert(!bodyOnly(receivedCtx.agentPrompts.quality_ops).includes('Simulaid 正文'));
  const event = emitted.find(item => item.type === 'knowledge.gate.decision');
  assert(event, '每次门控决策必须发出可追踪事件');
  assert.strictEqual(event.detail.candidates.length, 2);
  assert(event.detail.candidates.every(item => item.fragment_id && item.reasons.length), '事件应含候选、采用结果和原因');
  return ledger.flush().then(() => {
    assert.strictEqual(appended.length, 1, '旁路统计应批量异步写入');
  });
}

function makeUsageEvent(template, fragment, index, adopted) {
  return {
    schema: 'console-knowledge-usage-event@1',
    event_id: `${template}:${fragment}:${index}`,
    query_id: `${template}:q:${index}`,
    query_hash: `h${index}`,
    template_id: template,
    fragment_id: fragment,
    fragment_path: `shared/${fragment}.md`,
    hit: 1,
    adopted: adopted ? 1 : 0,
    no_contribution: adopted ? 0 : 1,
    decision_reason: adopted ? ['passed'] : ['filtered'],
    at: new Date(1700000000000 + index).toISOString(),
  };
}

async function testConcurrentLedgerAndStats() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-routing-ledger-'));
  const file = path.join(dir, 'usage.jsonl');
  try {
    const expectedUnique = 400;
    await Promise.all(Array.from({ length: 8 }, (_, worker) => runLedgerProcess(file, worker)));
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.strictEqual(lines.length, expectedUnique * 2, '并发 append 不得丢行或写坏行');
    const events = lines.map(line => JSON.parse(line));
    const aggregate = Routing.aggregateUsage(events);
    assert.strictEqual(aggregate.uniqueEventCount, expectedUnique, '重复重试不得重复累计');
    const groupA = aggregate.groups['execute:quality_ops\0fragment-a'];
    const groupB = aggregate.groups['execute:quality_ops\0fragment-b'];
    assert(groupA && groupB, '同一模板下的不同片段必须分别聚合');
    assert.deepStrictEqual(
      [groupA.hitCount, groupA.adoptionCount, groupA.noContributionCount, groupA.adoptionRate],
      [200, 100, 100, 0.5],
    );
    assert.deepStrictEqual(
      [groupB.hitCount, groupB.adoptionCount, groupB.noContributionCount, groupB.adoptionRate],
      [200, 0, 200, 0],
    );
    return {
      writers: 8,
      mode: 'multi_process_locked_append',
      rawLines: lines.length,
      uniqueEvents: aggregate.uniqueEventCount,
      groups: {
        'fragment-a': {
          hitCount: groupA.hitCount,
          adoptionCount: groupA.adoptionCount,
          noContributionCount: groupA.noContributionCount,
          adoptionRate: groupA.adoptionRate,
        },
        'fragment-b': {
          hitCount: groupB.hitCount,
          adoptionCount: groupB.adoptionCount,
          noContributionCount: groupB.noContributionCount,
          adoptionRate: groupB.adoptionRate,
        },
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runLedgerProcess(file, worker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--ledger-worker', file, String(worker)], {
      cwd: WORKSPACE,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ledger worker ${worker} exit ${code}: ${stderr}`));
    });
  });
}

async function ledgerWorker(file, worker) {
  const ledger = new Routing.AsyncStatsLedger(file);
  for (let offset = 0; offset < 50; offset++) {
    const index = Number(worker) * 50 + offset;
    const fragment = index % 2 === 0 ? 'fragment-a' : 'fragment-b';
    const event = makeUsageEvent('execute:quality_ops', fragment, index, index % 4 === 0);
    ledger.record(event);
    ledger.record(event); // retry duplicate:原始账本保留，聚合按 event_id 幂等。
  }
  await ledger.flush();
}

async function testStatsMainPathLatency() {
  let writes = 0;
  const ledger = new Routing.AsyncStatsLedger('/unused', {
    appendImpl: async () => { writes++; },
  });
  const started = process.hrtime.bigint();
  for (let i = 0; i < 2500; i++) ledger.record(makeUsageEvent('perf', 'fragment', i, false));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.strictEqual(writes, 0, 'record() 返回前不得执行任何落盘 IO');
  assert(elapsedMs < 100, `旁路入队 2500 次耗时过高:${elapsedMs.toFixed(3)}ms`);
  await ledger.flush();
  assert.strictEqual(writes, 1, '统计应批量一次刷盘');
  return { enqueues: 2500, enqueueMs: Number(elapsedMs.toFixed(3)), synchronousWrites: 0, batchWrites: writes };
}

function testRouteDebounceReplay() {
  const config = Object.assign({}, Routing.DEFAULT_CONFIG.dynamicRouting, {
    enabled: true,
    minimumHits: 20,
    requiredStableWindows: 3,
    activationDelayMs: 100,
    cooldownMs: 500,
  });
  const bad = { hitCount: 50, adoptionRate: 0.10, noContributionRate: 0.90 };
  const good = { hitCount: 50, adoptionRate: 0.60, noContributionRate: 0.40 };
  let state = { threshold: 0.55, pending: null, lastAppliedAt: 0, changes: [] };
  for (let i = 0; i < 20; i++) {
    state = Routing.advanceRouteState(state, i % 2 ? good : bad, config, i * 10);
  }
  assert.strictEqual(state.threshold, 0.55, '短期好坏窗口交替不得往返调整');
  assert.strictEqual(state.changes.length, 0);
  const alternatingChanges = state.changes.length;

  state = { threshold: 0.55, pending: null, lastAppliedAt: 0, changes: [] };
  state = Routing.advanceRouteState(state, bad, config, 0);
  assert.strictEqual(state.decision, 'stability_window_pending');
  state = Routing.advanceRouteState(state, bad, config, 10);
  state = Routing.advanceRouteState(state, bad, config, 20);
  assert.strictEqual(state.decision, 'activation_delay_pending');
  assert.strictEqual(state.threshold, 0.55, '延迟生效前阈值不得变化');
  state = Routing.advanceRouteState(state, bad, config, 120);
  assert.strictEqual(state.threshold, 0.60, '稳定窗口和延迟边界满足后只调整一个步长');
  assert.strictEqual(state.changes.length, 1);
  state = Routing.advanceRouteState(state, good, config, 130);
  assert.strictEqual(state.decision, 'cooldown_hold');
  assert.strictEqual(state.threshold, 0.60, '冷却期内不得反向震荡');
  return {
    alternatingWindows: 20,
    alternatingChanges,
    appliedChangesAfterStableDelay: state.changes.length,
    threshold: state.threshold,
    cooldownDecision: state.decision,
  };
}

function testProductionDisabledAndToolNoop() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).knowledgeRouting;
  const activation = Routing.activationState(config, {});
  assert.strictEqual(activation.enabled, false);
  assert.strictEqual(activation.reason, 'config_disabled');
  const missingOwner = Routing.activationState({
    enabled: true,
    promotionApproval: { supervisorReviewed: true, ownerApproved: false },
  }, {});
  assert.strictEqual(missingOwner.reason, 'owner_approval_missing');
  const pendingStatus = Routing.activationState({
    enabled: true,
    promotionApproval: {
      status: 'pending',
      supervisorReviewed: true,
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
    },
  }, {});
  assert.strictEqual(pendingStatus.reason, 'approval_status_not_approved');
  const approved = Routing.activationState(approvedConfig(), {});
  assert.strictEqual(approved.enabled, true);

  const tool = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'knowledge-routing-recompute.js'), '--dry-run'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
  });
  assert.strictEqual(tool.status, 0, tool.stderr);
  const output = JSON.parse(tool.stdout.trim());
  assert.strictEqual(output.applied, false, '主人批准前旁路重算必须 no-op');
  assert.strictEqual(output.reason, 'config_disabled');

  const engine = fs.readFileSync(path.join(ROOT, 'engine-runner.js'), 'utf8');
  assert(engine.includes("process.env.YUTU6_KB_INJECT = '0'"), '获批 wrapper 必须替代旧注入而不是重复拼接');
  assert(engine.includes('KnowledgeRouting.makeKnowledgeRoutingRunner'), '控制台真实引擎入口必须接入 wrapper');
}

async function main() {
  const realReplay = testRealQualityOpsReplay();
  testExplicitReferencePriority();
  const exactReference = testExactReferenceResolution();
  const fallbackPriority = testColdStartAndLowConfidenceFallback();
  testGateFailureFallback();
  await testTraceAndWrapper();
  const concurrency = await testConcurrentLedgerAndStats();
  const performance = await testStatsMainPathLatency();
  const replay = testRouteDebounceReplay();
  testProductionDisabledAndToolNoop();
  process.stdout.write(`${JSON.stringify({
    pass: true,
    suite: 'console-knowledge-routing',
    scenarios: 17,
    realReplay,
    fallbackPriority,
    exactReference,
    concurrency,
    performance,
    routeReplay: replay,
    productionEnabled: false,
  })}\n`);
}

const selected = process.argv[2] === '--ledger-worker'
  ? ledgerWorker(process.argv[3], process.argv[4])
  : main();
selected.catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
