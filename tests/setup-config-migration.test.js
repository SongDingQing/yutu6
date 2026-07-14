#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const Setup = require('../projects/控制台/setup-service');

function fakeSpawn(stdoutText, code = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end(stdoutText);
      child.stderr.end();
      child.emit('close', code);
    });
    return child;
  };
}

function writePrivate(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode });
}

function apiInput(credential, baseUrl = 'https://example.invalid/v1', model = 'fixture-model') {
  return { apiKey: credential, baseUrl, model };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-setup-migration-'));
  try {
    const legacyCredential = ['legacy', 'credential', 'fixture'].join('-');
    const legacyRoot = path.join(root, 'legacy-case');
    const legacyDir = path.join(legacyRoot, 'yutu6-secrets');
    const managedDir = path.join(legacyRoot, 'yutu6');
    writePrivate(path.join(legacyDir, 'secrets.env'), [
      `OPENAI_API_KEY=${legacyCredential}`,
      'OPENAI_BASE_URL=https://example.invalid/v1',
      'OPENAI_MODEL=fixture-model',
      'UNRELATED_PRIVATE_VALUE=must-not-be-copied',
      '',
    ].join('\n'));

    const legacyOpts = { configDir: managedDir, legacyConfigDir: legacyDir, workspaceRoot: legacyRoot };
    assert.strictEqual(Setup.legacyInstallationDetected(legacyOpts), true);
    const migrated = Setup.migrateLegacyConfig(legacyOpts);
    assert.deepStrictEqual(
      { completed: migrated.completed, migrated: migrated.migrated, source: migrated.source },
      { completed: true, migrated: true, source: 'legacy-private-config' },
    );
    const managedEnv = fs.readFileSync(Setup.files(legacyOpts).env, 'utf8');
    assert(managedEnv.includes(`OPENAI_COMPAT_API_KEY=${legacyCredential}`));
    assert(!managedEnv.includes('UNRELATED_PRIVATE_VALUE'));
    assert.strictEqual(fs.statSync(Setup.files(legacyOpts).env).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(Setup.files(legacyOpts).state).mode & 0o777, 0o600);
    assert.strictEqual(Setup.status(legacyOpts).completed, true);
    assert.strictEqual(Setup.status(legacyOpts).mode, 'legacy-compatible');
    assert(!JSON.stringify(Setup.status(legacyOpts)).includes(legacyCredential), 'migration status leaked a credential');

    const orderRoot = path.join(root, 'source-order');
    const orderManaged = path.join(orderRoot, 'yutu6');
    const orderLegacy = path.join(orderRoot, 'yutu6-secrets');
    const managedCredential = ['managed', 'credential', 'fixture'].join('-');
    const ignoredLegacyCredential = ['ignored', 'legacy', 'fixture'].join('-');
    writePrivate(path.join(orderManaged, 'providers.env'), [
      `DEEPSEEK_API_KEY=${managedCredential}`,
      'DEEPSEEK_BASE_URL=https://example.invalid/v1',
      'DEEPSEEK_MODEL=fixture-model',
      '',
    ].join('\n'));
    writePrivate(path.join(orderLegacy, 'secrets.env'), [
      `ZHIPU_API_KEY=${ignoredLegacyCredential}`,
      'ZHIPU_BASE_URL=https://example.invalid/v1',
      'ZHIPU_MODEL=fixture-model',
      '',
    ].join('\n'));
    const orderOpts = { configDir: orderManaged, legacyConfigDir: orderLegacy, workspaceRoot: orderRoot };
    const adopted = Setup.migrateLegacyConfig(orderOpts);
    assert.strictEqual(adopted.source, 'managed-private-config');
    const orderedEnv = fs.readFileSync(Setup.files(orderOpts).env, 'utf8');
    assert(orderedEnv.includes(managedCredential));
    assert(!orderedEnv.includes(ignoredLegacyCredential), 'legacy source overrode managed source');

    const codexRoot = path.join(root, 'codex-case');
    const codexOpts = {
      configDir: path.join(codexRoot, 'yutu6'),
      legacyConfigDir: path.join(codexRoot, 'yutu6-secrets'),
      workspaceRoot: codexRoot,
      spawn: fakeSpawn('Logged in using ChatGPT\n'),
    };
    const codex = await Setup.initializeLegacyInstallation(codexOpts);
    assert.strictEqual(codex.completed, true);
    assert.strictEqual(codex.source, 'codex-cli-login');
    assert.strictEqual(Setup.status(codexOpts).requirements.executorReady, true);

    const rollbackRoot = path.join(root, 'rollback-case');
    const rollbackDir = path.join(rollbackRoot, 'yutu6');
    const originalCredential = ['original', 'credential', 'fixture'].join('-');
    const rejectedCredential = ['replacement', 'credential', 'fixture'].join('-');
    const originalText = [
      `ZHIPU_API_KEY=${originalCredential}`,
      'ZHIPU_BASE_URL=https://example.invalid/v1',
      'ZHIPU_MODEL=fixture-model',
      '',
    ].join('\n');
    writePrivate(path.join(rollbackDir, 'providers.env'), originalText);
    await assert.rejects(
      Setup.configureProvider('zhipu', apiInput(rejectedCredential), {
        configDir: rollbackDir,
        workspaceRoot: rollbackRoot,
        loadIntoProcess: false,
        fetch: async () => ({ ok: true, status: 200 }),
        transactionHook(phase) {
          if (phase === 'after-env-write') throw new Error('fixture_write_failure');
        },
      }),
      /fixture_write_failure/,
    );
    assert.strictEqual(fs.readFileSync(path.join(rollbackDir, 'providers.env'), 'utf8'), originalText);
    assert(!fs.readFileSync(path.join(rollbackDir, 'providers.env'), 'utf8').includes(rejectedCredential));
    const backups = fs.readdirSync(path.join(rollbackDir, 'backups'));
    assert(backups.length >= 1, 'configuration backup was not created');
    assert.strictEqual(fs.statSync(path.join(rollbackDir, 'backups', backups[0])).mode & 0o777, 0o700);

    console.log(JSON.stringify({ pass: true, suite: 'setup-config-migration' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
