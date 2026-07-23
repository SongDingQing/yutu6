#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Contract = require('../shared/model-fabric/zhipu-coding-plan');
const CliRunner = require('../shared/engine/cli-runner');
const Failover = require('../shared/routing/failover');
const { providerUrl } = require('../shared/model-fabric/server');
const Tool = require('../projects/控制台/tools/zhipu-coding-plan');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

async function main() {
  const fakeKey = ['test-only', 'not-a-real-key'].join('-');
  assert.strictEqual(Contract.BASE_URL, 'https://open.bigmodel.cn/api/coding/paas/v4');
  assert.strictEqual(Contract.CHAT_COMPLETIONS_URL, 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions');
  assert.strictEqual(Contract.MODEL, 'glm-5.2');
  assert.strictEqual(Contract.TOKEN_KEY, 'ZHIPU_API_KEY');
  assert.strictEqual(Contract.safeErrorClass(429, '', '1305'), 'platform_overload');
  assert.strictEqual(Contract.safeErrorClass(429, '', '1308'), 'quota');
  assert.notStrictEqual(Failover.classifyFailure('[provider_error class=platform_overload code=1305 status=429] busy'), 'quota_exhausted');
  assert.strictEqual(Failover.classifyFailure('[provider_error class=quota_exhausted code=1308 status=429] exhausted'), 'quota_exhausted');

  const config = JSON.parse(read('projects/控制台/config.json'));
  for (const id of ['zhipu-glm', 'zhipu-board-direct']) {
    const runner = config.runners[id];
    assert(runner, `${id} missing`);
    assert.deepStrictEqual(Contract.validateRunner(runner), [], `${id} contract drift`);
  }
  assert(!String(config.runners['zhipu-glm'].baseUrl).includes('127.0.0.1:3000'));
  assert(!String(config.runners['zhipu-glm'].tokenFile).includes('internal-token.env'));

  const previous = process.env.ZHIPU_API_KEY;
  process.env.ZHIPU_API_KEY = fakeKey;
  try {
    const resolved = CliRunner.resolveOpenAiHttpConfig(config.runners['zhipu-glm'], { workdir: ROOT });
    assert.strictEqual(resolved.chatUrl, Contract.CHAT_COMPLETIONS_URL);
    assert.strictEqual(resolved.model, Contract.MODEL);
    assert.strictEqual(resolved.token, fakeKey);
  } finally {
    if (previous == null) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previous;
  }

  const drifted = { ...config.runners['zhipu-glm'], baseUrl: 'http://127.0.0.1:3000/v1' };
  assert.throws(() => Contract.resolveRunner(drifted, 'zhipu-glm'), /contract drift/);

  const runners = read('shared/routing/runners.yaml');
  const block = runners.match(/\n  - id: zhipu-glm\n([\s\S]*?)(?=\n  - id:|$)/);
  assert(block, 'zhipu-glm runners.yaml block missing');
  assert(block[0].includes(`base_url: "${Contract.BASE_URL}"`));
  assert(!block[0].includes('new_api:'));
  assert(!block[0].includes('internal-token.env'));

  const routing = read('shared/routing/model-routing.yaml');
  assert(/zhipu:\s*\{\s*via:\s*coding-plan-direct\b/.test(routing));

  const fabric = JSON.parse(read('projects/控制台/config/model-fabric.json'));
  const provider = fabric.providers.find(item => item.id === 'zhipu-coding-plan');
  assert(provider, 'model-fabric zhipu-coding-plan provider missing');
  assert.deepStrictEqual(Contract.validateFabricProvider(provider), []);
  assert.strictEqual(providerUrl(provider, '/v1/chat/completions'), Contract.CHAT_COMPLETIONS_URL);
  const glm52 = fabric.models.find(item => item.id === 'glm-5.2');
  assert.deepStrictEqual(glm52.deployments.map(item => item.provider), ['zhipu-coding-plan']);

  const proxy = read('projects/控制台/zhipu-coding-proxy.js');
  assert(proxy.includes("require('../../shared/model-fabric/zhipu-coding-plan')"));
  assert(!proxy.includes('ZHIPU_CODING_API_BASE'));
  assert.deepStrictEqual(Tool.staticChecks(), []);

  let calls = 0;
  const retried = await Contract.requestChatCompletion({
    token: fakeKey,
    prompt: 'test',
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async url => {
      calls += 1;
      assert.strictEqual(url, Contract.CHAT_COMPLETIONS_URL);
      if (calls === 1) return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { code: '1305', message: 'busy' } }),
      };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    },
  });
  assert.strictEqual(retried.ok, true);
  assert.strictEqual(retried.attempts, 2);

  console.log('zhipu-coding-plan-contract tests passed');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
