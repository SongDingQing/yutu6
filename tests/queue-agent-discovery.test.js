#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const root = path.resolve(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-queue-agent-discovery-'));
  const qroot = path.join(tmp, 'queues');
  mkdirp(path.join(qroot, '_organize-idempotency'));
  mkdirp(path.join(qroot, 'queues'));
  mkdirp(path.join(qroot, 'memory-officer'));
  mkdirp(path.join(qroot, 'secretary-smoke'));

  const oldArtifacts = process.env.CONSOLE_ARTIFACTS_DIR;
  process.env.CONSOLE_ARTIFACTS_DIR = tmp;
  try {
    const serverPath = path.join(root, 'projects/控制台/server.js');
    delete require.cache[require.resolve(serverPath)];
    const server = require(serverPath);
    const agents = server.configuredQueueAgents();
    const ids = agents.map(a => a.id);

    assert(!ids.includes('_organize-idempotency'), 'internal idempotency dir must not be exposed as a queue agent');
    assert(!ids.includes('queues'), 'nested queues dir must not be exposed as a queue agent');
    assert(ids.includes('memory-officer'), 'legacy memory-officer queue alias should remain visible for history/compat');
    assert.strictEqual(
      agents.find(a => a.id === 'memory-officer').role,
      'memory_officer',
      'memory-officer queue alias must resolve to memory_officer role',
    );
    assert(ids.includes('secretary-smoke'), 'ordinary historical queue dirs should remain visible');

    const ceoWorker = require(path.join(root, 'projects/控制台/ceo-worker.js'))._test;
    assert.strictEqual(ceoWorker.isQueueAgentDirName('_organize-idempotency'), false);
    assert.strictEqual(ceoWorker.isQueueAgentDirName('queues'), false);
    assert.strictEqual(ceoWorker.isQueueAgentDirName('memory-officer'), true);
  } finally {
    if (oldArtifacts == null) delete process.env.CONSOLE_ARTIFACTS_DIR;
    else process.env.CONSOLE_ARTIFACTS_DIR = oldArtifacts;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ pass: true, suite: 'queue-agent-discovery' }));
}

main();
