import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProviders, providerTargets, providerRequest } from '../packages/model-providers/index.mjs';

const base = () => ({ schema: 1, standalone: true, providers: [{ id: 'demo', baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'DEMO_KEY' }], models: [{ id: 'assistant', provider: 'demo', model: 'actual-model', capabilities: { tools: true, vision: true } }] });
test('provider catalog is portable; no credentials or endpoints in frontend targets', () => {
  const config = validateProviders(base()), targets = providerTargets(config);
  assert.equal(targets[0].id, 'pool:api-assistant'); assert.equal(targets[0].model, 'actual-model');
  assert(!JSON.stringify(targets).includes('example.invalid')); assert(!JSON.stringify(targets).includes('DEMO_KEY'));
  assert.throws(() => validateProviders({ ...base(), providers: [{ ...base().providers[0], apiKey: 'not-allowed' }] }), /内嵌密钥/);
});
test('provider rejects credentials in URL, nonlocal insecure HTTP and undeclared capabilities', async () => {
  for (const url of ['https://user:secret@example.invalid/v1', 'https://example.invalid/v1?key=x', 'http://192.168.1.2/v1', 'file:///private']) {
    assert.throws(() => validateProviders({ ...base(), providers: [{ ...base().providers[0], baseUrl: url }] }));
  }
  const b = base(); b.models[0].capabilities = {};
  await assert.rejects(providerRequest(validateProviders(b), 'assistant', { tools: [{}] }, { env: { DEMO_KEY: 'synthetic-key' } }), /工具/);
  await assert.rejects(providerRequest(validateProviders(b), 'assistant', { messages: [{ content: [{ type: 'image_url' }] }] }, { env: { DEMO_KEY: 'synthetic-key' } }), /视觉/);
});
test('provider reads key at execution, pins model, refuses redirects and sanitizes failures', async () => {
  const config = validateProviders(base()); let request;
  const response = await providerRequest(config, 'assistant', { model: 'spoofed', messages: [], stream: false }, { env: { DEMO_KEY: 'synthetic-key' }, fetchImpl: async (url, options) => {
    request = { url, ...options }; return new Response('{"choices":[]}');
  } });
  assert(response.ok); assert.equal(JSON.parse(request.body).model, 'actual-model'); assert.equal(request.headers.Authorization, 'Bearer synthetic-key'); assert.equal(request.redirect, 'error');
  await assert.rejects(providerRequest(config, 'assistant', {}, { env: {} }), /凭据尚未配置/);
  await assert.rejects(providerRequest(config, 'assistant', {}, { env: { DEMO_KEY: 'synthetic-key' }, fetchImpl: async () => { throw Error('SECRET-key-in-network-error'); } }), error => !error.message.includes('SECRET'));
});
