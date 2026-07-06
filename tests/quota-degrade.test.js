#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawn } = require('child_process');

const Q = require('../shared/engine/queue');
const QuotaDegrade = require('../projects/控制台/quota-degrade');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-quota-degrade-test-'));
const artifactsDir = path.join(root, 'artifacts');
const projectsDir = path.join(root, 'projects');
const boardRollup = path.join(root, 'board', 'status-rollup.md');
const configPath = path.join(root, 'config.json');

process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
process.env.CONSOLE_PROJECTS_DIR = projectsDir;
process.env.CONSOLE_BOARD_ROLLUP = boardRollup;
process.env.CONSOLE_CONFIG_PATH = configPath;
process.env.QUEUE_AGENT = 'worker_code';
process.env.QUOTA_DEGRADE_DRAIN_MS = '20';
process.env.RUNNER_SINGLEFLIGHT = '';

fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
fs.mkdirSync(path.dirname(boardRollup), { recursive: true });
fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# quota brief\n');
fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# quota status\n');
fs.writeFileSync(boardRollup, '# quota rollup\n');
fs.writeFileSync(configPath, JSON.stringify({
  roleRouting: {
    worker_code: { runner: 'codex' },
    frontend_designer: { runner: 'zhipu-glm' },
  },
  runners: {},
}, null, 2));

const worker = require('../projects/控制台/ceo-worker')._test;

function ids(items) {
  return items.map(item => item.id).sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs = 2000) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readEvents() {
  const file = path.join(artifactsDir, 'engine-events.jsonl');
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

async function main() {
  assert.strictEqual(worker.classifyQuotaExhaustion('codex failed: insufficient_quota account balance exhausted', { code: 1 }).isQuotaExhausted, true);
  assert.strictEqual(worker.classifyQuotaExhaustion('额度用光, 请充值后重试', { code: 1 }).isQuotaExhausted, true);
  assert.strictEqual(worker.classifyQuotaExhaustion('HTTP 429 rate limit: too many requests', { code: 1 }).isQuotaExhausted, false);
  assert.strictEqual(worker.classifyQuotaExhaustion('node_failed timeout ETIMEDOUT', { code: 3 }).isQuotaExhausted, false);
  assert.strictEqual(worker.classifyQuotaExhaustion('TypeError: cannot read properties', { code: 1 }).isQuotaExhausted, false);

  Q.enqueue(artifactsDir, 'worker_code', { role: 'worker_code', goal: 'current quota task' }, { id: 'quotaA', priority: 10 });
  Q.enqueue(artifactsDir, 'worker_code', { role: 'worker_code', goal: 'same runner queued task' }, { id: 'quotaQueued', priority: 20 });
  Q.enqueue(artifactsDir, 'frontend_designer', { role: 'frontend_designer', goal: 'other runner queued task' }, { id: 'frontQueued', priority: 30 });
  const running = Q.claim(artifactsDir, 'worker_code', { owner: 'worker:test', ownerPid: process.pid, leaseMs: 1000 });
  assert.strictEqual(running.id, 'quotaA');
  const slotDir = path.join(artifactsDir, 'engine-slots');
  fs.mkdirSync(slotDir, { recursive: true });
  const slotFile = path.join(slotDir, 'slot-0.json');
  fs.writeFileSync(slotFile, JSON.stringify({
    pid: process.pid,
    ownerPid: process.pid,
    agent: 'worker_code',
    queueId: 'quotaA',
    runnerType: 'codex',
    started_at: new Date().toISOString(),
  }, null, 2));

  const spec = {
    taskId: 'task-quota-a',
    queueAgent: 'worker_code',
    queueId: 'quotaA',
    flowId: 'review-loop',
    role: 'worker_code',
    projectId: '控制台',
  };
  const signal = worker.classifyQuotaExhaustion('codex 退出码 1: insufficient_quota account balance exhausted', { code: 1 });
  const degraded = await worker.handleQuotaDegradation(spec, running, { code: 1 }, signal.rawReason, 'codex', signal);
  assert.strictEqual(degraded.scope.key, 'runner:codex');
  assert.strictEqual(fs.existsSync(slotFile), false, 'quota degradation must release current slot lock');

  const state = QuotaDegrade.readState(artifactsDir, degraded.scope);
  assert.strictEqual(state.status, 'degraded');
  assert.strictEqual(state.incidentId, degraded.incidentId);
  assert.strictEqual(state.trigger_count, 1);
  const snapshotPath = path.join(artifactsDir, state.snapshot);
  assert(fs.existsSync(snapshotPath), 'snapshot file must exist');
  const snapshot = readJson(snapshotPath);
  assert.strictEqual(snapshot.scope.key, 'runner:codex');
  assert(snapshot.counts.queued >= 2, 'snapshot must include requeued current task and queued same-runner task');
  assert(snapshot.entries.some(item => item.queueId === 'quotaA' && item.status === 'queued'));
  assert(snapshot.entries.some(item => item.queueId === 'quotaQueued' && item.status === 'queued'));
  assert(!snapshot.entries.some(item => item.queueId === 'frontQueued'), 'snapshot must not mix unrelated runner scope');

  const listed = Q.list(artifactsDir, 'worker_code');
  assert.strictEqual(listed.running.length, 0);
  assert.deepStrictEqual(ids(listed.queued), ['quotaA', 'quotaQueued']);
  const requeued = listed.queued.find(item => item.id === 'quotaA');
  assert.strictEqual(requeued.lease_owner, undefined);
  assert.strictEqual(requeued.enginePid, undefined);
  assert.strictEqual(requeued.partial_artifacts_possible, true);
  assert.strictEqual(requeued.cleanup_status, 'execution_context_discarded');
  assert.strictEqual(worker.isQuotaScopePausedForEntry('worker_code', requeued).paused, true);

  const claimedWhilePaused = Q.claim(artifactsDir, 'worker_code', {
    match: entry => !worker.isQuotaScopePausedForEntry('worker_code', entry).paused,
  });
  assert.strictEqual(claimedWhilePaused, null, 'scheduler match must skip degraded quota scope');

  const forcedSecond = Q.claim(artifactsDir, 'worker_code', { match: entry => entry.id === 'quotaQueued' });
  const degradedAgain = await worker.handleQuotaDegradation(
    Object.assign({}, spec, { taskId: 'task-quota-b', queueId: 'quotaQueued' }),
    forcedSecond,
    { quotaDegraded: true, code: null },
    'scope already degraded',
    'codex',
    { isQuotaExhausted: true, confidence: 'high', reason: 'quota_degraded_scope_active', rawReason: 'scope already degraded' },
  );
  assert.strictEqual(degradedAgain.incidentId, degraded.incidentId, 'concurrent/repeated triggers should merge into one incident');
  const state2 = QuotaDegrade.readState(artifactsDir, degraded.scope);
  assert.strictEqual(state2.trigger_count, 2);
  assert.strictEqual(state2.snapshot, state.snapshot, 'merged incident should keep one snapshot path');
  const snapshot2 = readJson(path.join(artifactsDir, state2.snapshot));
  assert.strictEqual(snapshot2.revision, 2);

  const restore = await QuotaDegrade.restoreScopeWithLock(artifactsDir, degraded.scope, { actor: 'test', reason: 'quota restored' });
  assert.strictEqual(restore.ok, true);
  assert.strictEqual(worker.isQuotaScopePausedForEntry('worker_code', requeued).paused, false);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '../projects/控制台/tools/quota-degrade-control.js'),
    'status',
    '--scope',
    'runner:codex',
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, { CONSOLE_ARTIFACTS_DIR: artifactsDir }),
    encoding: 'utf8',
  });
  assert.strictEqual(cli.status, 0);
  assert.match(cli.stdout, /"status": "restored"/);

  // ---- 额度熔断 breaker 单元(拍板④ 2026-07-03):指数退避 1h→2h→4h 封顶 24h / 熔断期跳过 / 到点试探 / 成功恢复 ----
  delete process.env.YUTU6_QUOTA_BREAKER_BASE_MS;
  delete process.env.YUTU6_QUOTA_BREAKER_MAX_MS;
  const H = 60 * 60 * 1000;
  assert.strictEqual(QuotaDegrade.breakerBackoffMs(1), H, '第 1 次熔断退避 1h');
  assert.strictEqual(QuotaDegrade.breakerBackoffMs(2), 2 * H, '第 2 次翻倍到 2h');
  assert.strictEqual(QuotaDegrade.breakerBackoffMs(3), 4 * H, '第 3 次翻倍到 4h');
  assert.strictEqual(QuotaDegrade.breakerBackoffMs(6), 24 * H, '2^5*1h=32h 必须封顶 24h');
  assert.strictEqual(QuotaDegrade.breakerBackoffMs(50), 24 * H, '超深 strikes 不得溢出,仍封顶 24h');

  const breakerScope = QuotaDegrade.runnerScope('breakerMock');
  const tripped1 = QuotaDegrade.tripQuotaBreaker(artifactsDir, breakerScope, {
    reason: '预扣费额度失败, 用户剩余额度: 0.1',
    runnerType: 'breakerMock',
  });
  assert.strictEqual(tripped1.status, 'degraded');
  assert.strictEqual(tripped1.breaker.strikes, 1);
  assert.strictEqual(tripped1.breaker.backoff_ms, H);
  assert(Date.parse(tripped1.breaker.retry_after) > Date.now() + 55 * 60 * 1000, 'retry_after 必须在未来约 1h');

  // 熔断期内:blocked,不放试探
  const blockedDecision = QuotaDegrade.breakerDecision(QuotaDegrade.readState(artifactsDir, breakerScope));
  assert.strictEqual(blockedDecision.blocked, true);
  assert.strictEqual(blockedDecision.probe, false);
  const blockedClaim = QuotaDegrade.claimBreakerProbe(artifactsDir, breakerScope);
  assert.strictEqual(blockedClaim.allowed, false);
  assert.strictEqual(blockedClaim.reason, 'breaker_open');

  // 熔断期内再次额度失败 → 退避翻倍,并入同一事故
  const tripped2 = QuotaDegrade.tripQuotaBreaker(artifactsDir, breakerScope, {
    reason: 'quota_exhausted again',
    runnerType: 'breakerMock',
  });
  assert.strictEqual(tripped2.breaker.strikes, 2);
  assert.strictEqual(tripped2.breaker.backoff_ms, 2 * H);
  assert.strictEqual(tripped2.incidentId, tripped1.incidentId, '同一轮熔断必须并入同一事故');

  // retry_after 到点 → 只放一次试探;占位期内其余请求仍被跳过
  const probeNow = Date.parse(tripped2.breaker.retry_after) + 1;
  const probeClaim = QuotaDegrade.claimBreakerProbe(artifactsDir, breakerScope, { now: probeNow });
  assert.strictEqual(probeClaim.allowed, true);
  assert.strictEqual(probeClaim.probe, true);
  const secondClaim = QuotaDegrade.claimBreakerProbe(artifactsDir, breakerScope, { now: probeNow + 1 });
  assert.strictEqual(secondClaim.allowed, false);
  assert.strictEqual(secondClaim.reason, 'probe_in_flight');

  // 死锁回归防护(2026-07-06 停机根因):调度层额度门(ceo-worker isQuotaScopePausedForEntry)以
  // breakerDecision(state).blocked 作 paused 判据。retry_after 过期时 blocked 必须为 false,
  // 否则调度层无限 block、cli-runner 的 probe 永远轮不到 → degraded 永久死锁、all_blocked 空转。
  const gateExpired = QuotaDegrade.breakerDecision(QuotaDegrade.readState(artifactsDir, breakerScope), probeNow);
  assert.strictEqual(gateExpired.blocked, false, 'retry_after 过期后调度门必须放行(paused=false),否则 degraded 死锁');
  assert.strictEqual(gateExpired.probe, true, '过期应标记为可试探(probe)');
  // 退避未到:调度门仍须 block(不误放,避免额度未恢复就狂试)
  const gateBackoff = QuotaDegrade.breakerDecision(QuotaDegrade.readState(artifactsDir, breakerScope), Date.parse(tripped2.breaker.retry_after) - 1000);
  assert.strictEqual(gateBackoff.blocked, true, 'retry_after 未到时调度门必须仍 block');

  // 试探成功 → restored + strikes 清零;scope 不再暂停
  const resolvedBreaker = QuotaDegrade.resolveQuotaBreaker(artifactsDir, breakerScope, { restoredBy: 'unit-test' });
  assert.strictEqual(resolvedBreaker.ok, true);
  assert.strictEqual(resolvedBreaker.state.status, 'restored');
  assert.strictEqual(resolvedBreaker.state.breaker.strikes, 0);
  assert.strictEqual(QuotaDegrade.statePaused(QuotaDegrade.readState(artifactsDir, breakerScope)), false);

  // 恢复后再次额度失败 → 新一轮熔断从 1h 重新起步 + 新事故
  const tripped3 = QuotaDegrade.tripQuotaBreaker(artifactsDir, breakerScope, {
    reason: 'insufficient_quota again',
    runnerType: 'breakerMock',
  });
  assert.strictEqual(tripped3.breaker.strikes, 1);
  assert.strictEqual(tripped3.breaker.backoff_ms, H);
  assert.notStrictEqual(tripped3.incidentId, tripped1.incidentId, 'restored 后再失败必须开新事故');

  // 人工/旧式 degraded(无 retry_after)→ 一直跳过,不自动试探(保守,等人工 restore)
  const manualScope = QuotaDegrade.runnerScope('manualDegrade');
  QuotaDegrade.beginOrUpdateIncident(artifactsDir, manualScope, { reason: 'manual degrade' });
  const manualClaim = QuotaDegrade.claimBreakerProbe(artifactsDir, manualScope);
  assert.strictEqual(manualClaim.allowed, false);
  assert.strictEqual(manualClaim.reason, 'degraded_no_retry_after');

  const runnerPath = path.join(root, 'quota-runner.js');
  fs.writeFileSync(runnerPath, [
    "'use strict';",
    "if (/# 任务:execute/.test(process.argv.join('\\n'))) {",
    "  console.error('insufficient_quota: account balance exhausted');",
    "  process.exit(1);",
    "}",
    "console.log('{}');",
  ].join('\n'));
  fs.writeFileSync(configPath, JSON.stringify({
    roleRouting: {
      worker_code: { runner: 'quotaMock' },
      frontend_designer: { runner: 'zhipu-glm' },
    },
    runners: {
      quotaMock: {
        label: 'Quota Mock',
        cmd: [process.execPath, runnerPath],
        promptVia: 'arg',
      },
    },
  }, null, 2));
  Q.enqueue(artifactsDir, 'worker_code', {
    role: 'worker_code',
    flowId: 'agent-once',
    projectId: '控制台',
    goal: 'worker integration quota exhausted',
    useOrchestrator: false,
    nodeTimeoutSec: 3,
  }, { id: 'quotaWorker', priority: 5 });

  let workerProc = null;
  try {
    const log = fs.openSync(path.join(root, 'quota-worker.log'), 'a');
    workerProc = spawn(process.execPath, [path.join(__dirname, '../projects/控制台/ceo-worker.js'), '--agent', 'worker_code'], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env, {
        CONSOLE_ARTIFACTS_DIR: artifactsDir,
        CONSOLE_PROJECTS_DIR: projectsDir,
        CONSOLE_BOARD_ROLLUP: boardRollup,
        CONSOLE_CONFIG_PATH: configPath,
        QUEUE_AGENT: 'worker_code',
        QUOTA_DEGRADE_DRAIN_MS: '20',
        ENGINE_MAX_CONCURRENCY: '1',
        RUNNER_SINGLEFLIGHT: '',
        AUTO_REPAIR_ENABLED: '0',
        QUEUE_WORKER_MAX_IN_FLIGHT: '1',
        RUNNING_SWEEP_MS: '200',
      }),
      stdio: ['ignore', log, log],
    });
    const deadline = Date.now() + 12000;
    let events = [];
    while (Date.now() < deadline) {
      events = readEvents();
      if (events.some(ev => ev.type === 'queue.quota_degraded' && ev.queueId === 'quotaWorker')) break;
      await sleep(150);
    }
    assert(events.some(ev => ev.type === 'quota.signal.detected' && ev.queueId === 'quotaWorker'), 'worker must detect quota signal from raw node.fail output');
    assert(events.some(ev => ev.type === 'queue.quota_degraded' && ev.queueId === 'quotaWorker'), 'worker must emit quota degraded event');
    const afterWorker = Q.list(artifactsDir, 'worker_code');
    assert(afterWorker.queued.some(item => item.id === 'quotaWorker' && item.quota_degrade_scope === 'runner:quotaMock'));
    assert.strictEqual(afterWorker.failed, 0, 'quota worker task must not be moved to failed');
    const mockState = QuotaDegrade.readState(artifactsDir, QuotaDegrade.runnerScope('quotaMock'));
    assert(mockState && mockState.status === 'degraded', 'worker integration must create degraded state for failing runner');
    assert(fs.existsSync(path.join(artifactsDir, mockState.snapshot)), 'worker integration must write queue snapshot');
  } finally {
    if (workerProc) {
      try { workerProc.kill('SIGTERM'); } catch (_) {}
      await waitForExit(workerProc);
    }
  }

  console.log(JSON.stringify({ pass: true, suite: 'quota-degrade' }));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
