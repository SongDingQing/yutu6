#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'it-engineer-interface-'));
process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
process.env.CONSOLE_EVENTS_FILE = path.join(artifacts, 'events.jsonl');

const SecretaryTools = require('../projects/控制台/secretary-tools');

function main() {
  try {
    const release = SecretaryTools.itReleaseRequest({
      part: 'fix',
      message: '接口测试发布',
      path: 'VERSION.json',
      idem: 'it-interface-release',
    });
    assert.strictEqual(release.ok, true);
    assert.strictEqual(release.queueAgent, 'it_engineer');
    assert(/version-manager\.js release/.test(release.command));
    assert(/--push/.test(release.command));
    assert.strictEqual(release.entry.task.role, 'it_engineer');
    assert.strictEqual(release.entry.task.autoApproveHuman, true);
    assert(release.entry.task.inputs.includes('VERSION.json'));
    assert(/不读\/写密钥/.test(release.entry.task.bounds));

    const rollback = SecretaryTools.itRollbackRequest({
      target: '0.0.0.1',
      reason: '接口测试回滚',
      idem: 'it-interface-rollback',
    });
    assert.strictEqual(rollback.ok, true);
    assert.strictEqual(rollback.queueAgent, 'it_engineer');
    assert(/--dry-run/.test(rollback.dryRunCommand));
    assert(/--confirm/.test(rollback.confirmCommand));
    assert.strictEqual(rollback.entry.task.role, 'it_engineer');
    assert.strictEqual(rollback.entry.task.autoApproveHuman, false);
    assert(/未经主人确认不得执行 --confirm/.test(rollback.entry.task.bounds));

    const queueDir = path.join(artifacts, 'queues', 'it_engineer');
    const queued = fs.readdirSync(queueDir).filter(name => name.endsWith('.json'));
    assert(queued.length >= 2, 'IT engineer queue entries were not created');

    console.log(JSON.stringify({ pass: true, suite: 'it-engineer-interface' }));
  } finally {
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
}

main();
