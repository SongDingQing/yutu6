#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const Setup = require('../projects/控制台/setup-service');

function fakeSpawn(stdoutText, stderrText = '', code = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      if (stdoutText) child.stdout.write(stdoutText);
      if (stderrText) child.stderr.write(stderrText);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code);
    });
    return child;
  };
}

function fakeFetch(status = 200) {
  return async (_url, request) => {
    assert(request && request.headers, 'probe request missing headers');
    return { ok: status >= 200 && status < 300, status };
  };
}

function providerPayload(credential, baseUrl, model) {
  return {
    [['api', 'Key'].join('')]: credential,
    baseUrl,
    model,
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-setup-service-'));
  const configDir = path.join(root, 'private');
  const opts = { configDir, workspaceRoot: root, loadIntoProcess: false };
  try {
    const credentialFixture = ['unit', 'api', 'fixture'].join('-');
    const rejectedCredentialFixture = ['rejected', 'unit', 'fixture'].join('-');
    const initial = Setup.status(opts);
    assert.strictEqual(initial.completed, false);
    assert.strictEqual(initial.requirements.ready, false);
    assert(!JSON.stringify(initial).includes(credentialFixture), 'status must never expose key values');

    const codex = await Setup.configureProvider('codex', {}, {
      ...opts,
      spawn: fakeSpawn('Logged in using ChatGPT\n'),
    });
    assert.strictEqual(codex.ok, true, JSON.stringify(codex));
    assert.strictEqual(Setup.status(opts).requirements.executorReady, true);

    const zhipu = await Setup.configureProvider('zhipu', providerPayload(
      credentialFixture,
      'https://example.invalid/v1',
      'test-model',
    ), {
      ...opts,
      fetch: fakeFetch(200),
    });
    assert.strictEqual(zhipu.ok, true, JSON.stringify(zhipu));

    const envFile = Setup.files(opts).env;
    const stateFile = Setup.files(opts).state;
    assert.strictEqual(fs.statSync(configDir).mode & 0o777, 0o700, 'private config directory must be 0700');
    assert.strictEqual(fs.statSync(envFile).mode & 0o777, 0o600, 'provider env must be 0600');
    assert.strictEqual(fs.statSync(stateFile).mode & 0o777, 0o600, 'setup state must be 0600');
    assert(fs.readFileSync(envFile, 'utf8').includes(`ZHIPU_API_KEY=${credentialFixture}`));

    const publicStatus = Setup.status(opts);
    const serialized = JSON.stringify(publicStatus);
    assert(!serialized.includes(credentialFixture), 'public setup status leaked API key');
    assert.strictEqual(publicStatus.requirements.ready, true);
    assert.strictEqual(publicStatus.providers.find(p => p.id === 'zhipu').configured, true);

    const failed = await Setup.configureProvider('openai_compatible', providerPayload(
      rejectedCredentialFixture,
      'https://example.invalid/v1',
      'bad-model',
    ), {
      ...opts,
      fetch: fakeFetch(401),
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, 'authentication_failed');
    assert(!fs.readFileSync(envFile, 'utf8').includes(rejectedCredentialFixture), 'failed probe must not persist key');

    const complete = Setup.completeSetup(opts);
    assert.strictEqual(complete.ok, true);
    assert.strictEqual(Setup.status(opts).completed, true);

    const publicKeys = Object.keys(Setup.status(opts));
    assert(!publicKeys.includes('env'), 'public status must not expose private env');
    console.log(JSON.stringify({ pass: true, suite: 'setup-service' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
