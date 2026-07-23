#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ModelFabric, providerUrl } = require('../shared/model-fabric/server');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function address(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  assert.strictEqual(
    providerUrl({ base_url: 'http://127.0.0.1:3000/v1' }, '/v1/chat/completions'),
    'http://127.0.0.1:3000/v1/chat/completions',
  );
  assert.strictEqual(
    providerUrl({ base_url: 'http://127.0.0.1:3000' }, '/v1/chat/completions'),
    'http://127.0.0.1:3000/v1/chat/completions',
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-model-fabric-'));
  fs.mkdirSync(path.join(root, 'agents', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'demo', 'agent.json'), JSON.stringify({
    id: 'demo',
    name: 'Demo Agent',
    role: 'demo',
    runner: 'codex',
    queueAgent: true,
    boundary_statement: { does: 'test dispatch', does_not: 'nothing else' },
  }));
  fs.writeFileSync(path.join(root, 'capabilities.json'), JSON.stringify({
    modules: [{ id: 'demo-capability', status: 'active', summary: 'fixture' }],
  }));
  fs.writeFileSync(path.join(root, 'platforms.json'), JSON.stringify({
    platforms: [{ id: 'native', credential: { value: 'must-not-leak' } }],
  }));
  fs.writeFileSync(path.join(root, 'primary.env'), 'TOKEN=primary-token\n', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'fallback.env'), 'TOKEN=fallback-token\n', { mode: 0o600 });

  let primaryCalls = 0;
  const primary = await listen(async (request, response) => {
    primaryCalls++;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'fixture unavailable' } }));
  });
  let fallbackBody = null;
  const fallback = await listen(async (request, response) => {
    if (request.url === '/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'upstream-demo' }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    fallbackBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.strictEqual(request.headers.authorization, 'Bearer fallback-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'fixture-response',
      model: 'upstream-demo',
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }));
  });
  let dispatched = null;
  const consoleServer = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    dispatched = {
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, entry: { id: 'queue-fixture' } }));
  });

  const config = {
    schema: 'yutu6-model-fabric@1',
    name: 'Fixture Fabric',
    version: '0.1.0',
    mode: 'shadow_front_door',
    server: { host: '127.0.0.1', port: 39020 },
    storage: { root: 'artifacts' },
    routing: {
      max_attempts: 2,
      failure_threshold: 3,
      cooldown_ms: 90000,
      request_timeout_ms: 5000,
      health_timeout_ms: 1000,
      health_interval_ms: 3600000,
    },
    control_plane: {
      console_base_url: address(consoleServer),
      agent_root: 'agents',
      capability_registry: 'capabilities.json',
      platform_catalog: 'platforms.json',
      allow_privileged_dispatch: false,
      privileged_agents: ['repair'],
    },
    migration: {
      phase: 'fixture',
      front_door: 'fixture',
      compatibility_upstream: 'primary',
      rollback: 'fixture rollback',
    },
    providers: [
      {
        id: 'primary',
        kind: 'openai_compatible',
        enabled: true,
        base_url: address(primary),
        priority: 10,
        credential: { file: 'primary.env', key: 'TOKEN' },
      },
      {
        id: 'fallback',
        kind: 'openai_compatible',
        enabled: true,
        base_url: address(fallback),
        priority: 20,
        credential: { file: 'fallback.env', key: 'TOKEN' },
      },
    ],
    models: [{
      id: 'demo',
      aliases: ['demo-alias'],
      modalities: ['text'],
      capabilities: ['chat'],
      deployments: [
        { provider: 'primary', model: 'upstream-primary', priority: 10 },
        { provider: 'fallback', model: 'upstream-demo', priority: 20 },
      ],
    }],
  };
  const configFile = path.join(root, 'model-fabric.json');
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  const fabric = new ModelFabric({ configFile, workspaceRoot: root, port: 0 });
  await fabric.start();
  const base = address(fabric.server);
  try {
    const overview = await fetch(`${base}/api/fabric/overview`).then(response => response.json());
    assert.strictEqual(overview.ok, true);
    assert.strictEqual(overview.metrics.agents, 1);
    assert.strictEqual(overview.metrics.capabilities, 1);
    assert.strictEqual(overview.platforms[0].credential.value, undefined);

    const diagnostics = await fetch(`${base}/api/fabric/diagnostics`).then(response => response.json());
    assert.strictEqual(diagnostics.ok, true);
    assert.strictEqual(diagnostics.privacy.prompt_logging, false);
    assert.strictEqual(diagnostics.coverage.logical_models, 1);
    const ready = await fetch(`${base}/api/fabric/ready`).then(response => response.json());
    assert.strictEqual(ready.state, 'unavailable');

    const models = await fetch(`${base}/v1/models`).then(response => response.json());
    assert.strictEqual(models.data[0].id, 'demo');

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer client-token-must-not-forward',
        'x-yutu-task-id': 'task-fixture',
      },
      body: JSON.stringify({
        model: 'demo-alias',
        messages: [{ role: 'user', content: 'private prompt must not enter ledger' }],
      }),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-yutu-fabric-provider'), 'fallback');
    const body = await response.json();
    assert.strictEqual(body.choices[0].message.content, 'pong');
    assert.strictEqual(fallbackBody.model, 'upstream-demo');
    assert.strictEqual(primaryCalls, 1);

    const usage = await fetch(`${base}/api/fabric/usage?days=1`).then(response => response.json());
    assert.strictEqual(usage.usage.totals.calls, 2);
    assert.strictEqual(usage.usage.totals.successful_calls, 1);
    assert.strictEqual(usage.usage.totals.failed_calls, 1);
    assert.strictEqual(usage.usage.totals.total_tokens, 4);
    assert.strictEqual(usage.usage.totals.failovers, 1);
    const ledgerText = fs.readFileSync(path.join(root, 'artifacts', 'ledger', 'usage.jsonl'), 'utf8');
    assert(!ledgerText.includes('private prompt'));
    assert(!ledgerText.includes('client-token'));
    assert(!ledgerText.includes('primary-token'));
    assert(!ledgerText.includes('fallback-token'));

    const card = await fetch(`${base}/a2a/agents/demo/.well-known/agent-card.json`).then(response => response.json());
    assert.strictEqual(card.name, 'Demo Agent');
    const invalidRun = await fetch(`${base}/api/fabric/agents/demo/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    assert.strictEqual(invalidRun.status, 400);
    assert.strictEqual((await invalidRun.json()).error, 'invalid JSON request body');
    const run = await fetch(`${base}/a2a/agents/demo/message:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { role: 'ROLE_USER', parts: [{ text: 'run fixture' }] } }),
    });
    assert.strictEqual(run.status, 202);
    const runBody = await run.json();
    assert.strictEqual(runBody.task.id, 'queue-fixture');
    assert.strictEqual(dispatched.path, '/api/queue/demo');
    assert.strictEqual(dispatched.body.task.goal, 'run fixture');
  } finally {
    await fabric.close();
    await close(primary);
    await close(fallback);
    await close(consoleServer);
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ pass: true, suite: 'model-fabric' }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
