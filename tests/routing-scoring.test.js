'use strict';
// 路由三件套测试:scoreCandidates 健康重排(纯函数、不改正确性)+ routing-replay 聚合口径。
const assert = require('assert');
const path = require('path');
const Failover = require(path.resolve(__dirname, '..', 'shared', 'routing', 'failover.js'));
const Replay = require(path.resolve(__dirname, '..', 'projects', '控制台', 'tools', 'routing-replay.js'));

const tests = {
  'scoreCandidates:全健康时顺序完全不变(对现有正确性零影响)'() {
    const chain = ['codex', 'zhipu-glm', 'new-api'];
    const out = Failover.scoreCandidates(chain, { healthOf: () => ({ blocked: false, strikes: 0 }) });
    assert.deepStrictEqual(out, chain);
  },

  'scoreCandidates:熔断候选沉底、有strike次之、健康在前(稳定分区)'() {
    const health = {
      codex: { blocked: false, strikes: 0 },
      'zhipu-glm': { blocked: true, strikes: 3 },
      'new-api': { blocked: false, strikes: 1 },
    };
    const out = Failover.scoreCandidates(['zhipu-glm', 'codex', 'new-api'], { healthOf: (id) => health[id] || null });
    // codex(健康 penalty0) → new-api(strike penalty1) → zhipu-glm(熔断 penalty2)
    assert.deepStrictEqual(out, ['codex', 'new-api', 'zhipu-glm']);
  },

  'scoreCandidates:只重排不增删(长度与元素守恒)'() {
    const chain = ['a', 'b', 'c', 'd'];
    const out = Failover.scoreCandidates(chain, { healthOf: (id) => (id === 'a' ? { blocked: true, strikes: 5 } : null) });
    assert.strictEqual(out.length, chain.length);
    assert.deepStrictEqual([...out].sort(), [...chain].sort());
  },

  'scoreCandidates:无 healthOf / 单元素 → 原样返回'() {
    assert.deepStrictEqual(Failover.scoreCandidates(['x', 'y'], {}), ['x', 'y']);
    assert.deepStrictEqual(Failover.scoreCandidates(['only'], { healthOf: () => ({ blocked: true }) }), ['only']);
  },

  'scoreCandidates:healthOf 抛异常/返回null 当健康,不误伤顺序'() {
    const out = Failover.scoreCandidates(['p', 'q'], { healthOf: () => { throw new Error('boom'); } });
    assert.deepStrictEqual(out, ['p', 'q']);
  },

  'scoreCandidates:同组保持原相对顺序(稳定性)'() {
    // 三个都有 strike(penalty 都=1)→ 应保持原序
    const out = Failover.scoreCandidates(['c1', 'c2', 'c3'], { healthOf: () => ({ blocked: false, strikes: 2 }) });
    assert.deepStrictEqual(out, ['c1', 'c2', 'c3']);
  },

  'routing-replay:runner.call 聚合成功率与降级率'() {
    const now = Date.now();
    const ev = (o) => Object.assign({ ts: new Date(now).toISOString() }, o);
    const events = [
      ev({ type: 'runner.call', task: 't1', role: 'worker_code', runner: 'codex', ok: true, latency_ms: 1200 }),
      ev({ type: 'runner.call', task: 't1', role: 'worker_code', runner: 'codex', ok: false, latency_ms: 800 }),
      ev({ type: 'runner.call', task: 't2', role: 'worker_code', runner: 'zhipu-glm', ok: true, latency_ms: 2000 }),
      ev({ type: 'runner.failover', task: 't1', role: 'worker_code', from: 'codex', to: 'zhipu-glm' }),
      ev({ type: 'quota.breaker.tripped', task: 't2', role: 'worker_code', runner: 'zhipu-glm' }),
    ];
    const rep = Replay.aggregate(events, { days: 7 });
    const codex = rep.rows.find((r) => r.role === 'worker_code' && r.runner === 'codex');
    const glm = rep.rows.find((r) => r.role === 'worker_code' && r.runner === 'zhipu-glm');
    assert.strictEqual(codex.calls, 2);
    assert.strictEqual(codex.success_rate, 0.5);
    assert.strictEqual(codex.failovers, 1);
    assert.strictEqual(codex.failover_rate, 0.5);
    assert.strictEqual(codex.avg_latency_ms, 1000);
    assert.strictEqual(glm.tripped, 1);
    assert.strictEqual(glm.success_rate, 1);
  },

  'routing-replay:runner.quality 归到 role-quality 桶,算通过率与均分'() {
    const now = Date.now();
    const ev = (o) => Object.assign({ ts: new Date(now).toISOString() }, o);
    const events = [
      ev({ type: 'runner.quality', task: 't1', role: 'reviewer', pass: true, score: 0.9 }),
      ev({ type: 'runner.quality', task: 't2', role: 'reviewer', pass: false, score: 0.4 }),
    ];
    const rep = Replay.aggregate(events, { days: 7 });
    const q = rep.rows.find((r) => r.role === 'reviewer' && r.runner === '(role-quality)');
    assert.strictEqual(q.quality_calls, 2);
    assert.strictEqual(q.quality_pass_rate, 0.5);
    assert.strictEqual(q.avg_score, 0.65);
  },

  'routing-replay:窗口外事件被过滤'() {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const events = [{ type: 'runner.call', task: 't', role: 'r', runner: 'x', ok: true, ts: old }];
    const rep = Replay.aggregate(events, { days: 7 });
    assert.strictEqual(rep.rows.length, 0, '30天前的事件在7天窗口内应被过滤');
  },
};

module.exports = { tests };

if (require.main === module) {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { fn(); console.log('  ✓', name); }
    catch (e) { failed++; console.error('  ✗', name, '\n    ', e.message); }
  }
  process.exit(failed ? 1 : 0);
}
