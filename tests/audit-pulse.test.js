'use strict';

const assert = require('assert');
const { AuditPulseLimiter } = require('../shared/engine/audit-pulse');

function main() {
  const limiter = new AuditPulseLimiter({ intervalMs: 60000, maxKeys: 100 });
  assert.strictEqual(limiter.shouldEmit('queue/a', 'engine-alive', 100000), true);
  assert.strictEqual(limiter.shouldEmit('queue/a', 'engine-alive', 105000), false,
    'unchanged keepalive must be suppressed inside the audit interval');
  assert.strictEqual(limiter.shouldEmit('queue/a', 'waiting-downstream', 106000), true,
    'a state transition must be emitted immediately');
  assert.strictEqual(limiter.shouldEmit('queue/a', 'waiting-downstream', 165999), false);
  assert.strictEqual(limiter.shouldEmit('queue/a', 'waiting-downstream', 166000), true,
    'an unchanged state must still leave a low-frequency audit pulse');
  assert.strictEqual(limiter.shouldEmit('queue/b', 'engine-alive', 106001), true,
    'keys must be throttled independently');
  limiter.forget('queue/a');
  assert.strictEqual(limiter.shouldEmit('queue/a', 'waiting-downstream', 106002), true);
  console.log(JSON.stringify({ pass: true, suite: 'audit-pulse' }));
}

main();
