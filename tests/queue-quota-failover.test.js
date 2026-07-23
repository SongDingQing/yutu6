#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-quota-failover-'));
const artifactsDir = path.join(root, 'artifacts');
const configPath = path.join(root, 'config.json');

fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  roleRouting: {
    quality_ops: { runner: 'zhipu-glm' },
  },
  runners: {
    'zhipu-glm': { cmd: ['__openai_http__'] },
    codex: { cmd: ['codex', 'exec'] },
  },
}, null, 2));

process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
process.env.CONSOLE_CONFIG_PATH = configPath;
process.env.QUEUE_AGENT = 'quality_ops';
process.env.YUTU6_RUNNER_FAILOVER = '1';

const QuotaDegrade = require('../projects/控制台/quota-degrade');
const worker = require('../projects/控制台/ceo-worker')._test;

try {
  const entry = {
    id: 'quality-audit-1',
    task: { role: 'quality_ops', flowId: 'agent-once', goal: 'audit' },
  };

  QuotaDegrade.tripQuotaBreaker(artifactsDir, QuotaDegrade.runnerScope('zhipu-glm'), {
    runnerType: 'zhipu-glm',
    reason: '预扣费额度失败',
  });

  const fallback = worker.isQuotaScopePausedForEntry('quality_ops', entry);
  assert.strictEqual(fallback.paused, false, '首选额度熔断但 Codex 健康时，队列调度器必须放行');
  assert.strictEqual(fallback.primaryRunnerType, 'zhipu-glm');
  assert.strictEqual(fallback.selectedRunnerType, 'codex');
  assert.strictEqual(fallback.fallbackAvailable, true);

  QuotaDegrade.tripQuotaBreaker(artifactsDir, QuotaDegrade.runnerScope('codex'), {
    runnerType: 'codex',
    reason: 'insufficient_quota',
  });
  const exhausted = worker.isQuotaScopePausedForEntry('quality_ops', entry);
  assert.strictEqual(exhausted.paused, true, '所有候选都熔断时必须继续保护性暂停');
  assert.strictEqual(exhausted.selectedRunnerType, null);

  process.env.YUTU6_RUNNER_FAILOVER = '0';
  QuotaDegrade.resolveQuotaBreaker(artifactsDir, QuotaDegrade.runnerScope('codex'), { restoredBy: 'test' });
  const disabled = worker.isQuotaScopePausedForEntry('quality_ops', entry);
  assert.strictEqual(disabled.paused, true, '关闭 failover 开关时应保持首选 runner 的旧暂停语义');

  console.log(JSON.stringify({ pass: true, suite: 'queue-quota-failover' }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
