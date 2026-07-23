#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const client = require('../shared/tools/a2a/a2a-client');

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}/nb/a2a/demo`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-a2a-test-'));
  const envFile = path.join(temp, 'agent.env');
  fs.writeFileSync(envFile, 'A2A_TEST_TOKEN=local-test-token\n', { mode: 0o600 });
  assert.strictEqual(client.parseEnvFile(envFile).A2A_TEST_TOKEN, 'local-test-token');
  assert.throws(
    () => client.credential({ token: 'raw-value' }),
    /raw --token is forbidden/,
  );

  let messageSeen = false;
  await withServer(async (request, response) => {
    if (request.url.endsWith('/.well-known/agent-card.json')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        name: 'Demo Agent',
        description: 'local fixture',
        url: request.url.replace('/.well-known/agent-card.json', ''),
        protocolVersion: '1.0',
        capabilities: { streaming: false },
        skills: [{ id: 'echo', name: 'Echo' }],
      }));
      return;
    }
    if (request.url.endsWith('/message:send')) {
      assert.strictEqual(request.headers.authorization, 'Bearer local-test-token');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.strictEqual(body.message.role, 'user');
      assert.strictEqual(body.message.content, 'ping');
      messageSeen = true;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        message: {
          role: 'ROLE_AGENT',
          parts: [{ text: 'pong' }],
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  }, async baseUrl => {
    const discovered = await client.discoverAgent(baseUrl, {
      token: 'local-test-token',
      timeoutMs: 3000,
    });
    assert.strictEqual(discovered.name, 'Demo Agent');
    assert.strictEqual(discovered.skills[0].id, 'echo');

    const result = await client.invokeAgent(baseUrl, 'ping', {
      token: 'local-test-token',
      protocol: 'http-json',
      timeoutMs: 3000,
      requestId: 'test-request',
    });
    assert.strictEqual(result.text, 'pong');
    assert.strictEqual(result.request_id, 'test-request');
  });

  assert.strictEqual(messageSeen, true);
  assert.strictEqual(
    client.endpointUrl('http://127.0.0.1:5013/nb/a2a/id/.well-known/agent-card.json', 'jsonrpc'),
    'http://127.0.0.1:5013/nb/a2a/id/v1',
  );
  assert.strictEqual(
    client.extractText({ result: { artifacts: [{ parts: [{ text: 'evidence' }] }] } }),
    'evidence',
  );

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ pass: true, suite: 'a2a-client' }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
