import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officialQuotaLabel, usageMetric } from '../src/features/usage/model.js';
import type { LlmUsageModel } from '../src/types.js';

test('missing usage is explicitly unmeasured instead of zero', () => {
  const model: LlmUsageModel = {
    id: 'missing',
    billingMode: 'subscription_quota',
    sourceStatus: 'unavailable',
    currentUsage: {},
  };
  const metric = usageMetric(model, 'total_tokens');
  assert.equal(metric.value, '未计量');
  assert.equal(metric.measured, false);
  assert.equal(officialQuotaLabel(model), '官方剩余额度未计量');
});

test('measured zero stays zero and carries its local observation label', () => {
  const model: LlmUsageModel = {
    id: 'measured',
    billingMode: 'paid_buyout',
    sourceStatus: 'ok',
    source: 'new-api local-db',
    currentUsage: { calls: 0 },
  };
  const metric = usageMetric(model, 'calls');
  assert.equal(metric.value, '0');
  assert.equal(metric.measured, true);
  assert.match(metric.note, /网关计量/);
});
