#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');

function main() {
  const repo = path.resolve(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-department-'));
  const artifactsDir = path.join(root, 'artifacts');

  try {
    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_EVENTS_FILE = path.join(artifactsDir, 'engine-events.jsonl');

    const Tools = require('../projects/控制台/secretary-tools');
    const repairDir = path.join(root, 'board', 'repair-tickets');
    fs.mkdirSync(repairDir, { recursive: true });

    const autoCases = [
      {
        label: 'english',
        title: 'Readable English repair title',
        slugPattern: /^readable-english-re-[0-9a-f]{12}$/,
      },
      {
        label: 'chinese',
        title: '中文维修工单',
        slugPattern: /^ticket-[0-9a-f]{12}$/,
      },
      {
        label: 'mixed',
        title: 'repair-lead→repair 特权 runner 单飞互锁',
        slugPattern: /^repair-lead-repair-[0-9a-f]{12}$/,
      },
      {
        label: 'symbols',
        title: '→★!!!',
        slugPattern: /^ticket-[0-9a-f]{12}$/,
      },
    ];
    const autoIds = new Map();
    for (const testCase of autoCases) {
      const added = Tools.repairTicketAdd({
        title: testCase.title,
        problem: `${testCase.label} automatic id regression`,
        bulletin: 'false',
      });
      const match = added.ticket.id.match(/^repair-\d{14}-(.+)$/);
      assert(match, `${testCase.label} automatic id must include the timestamp prefix`);
      assert(testCase.slugPattern.test(match[1]), `${testCase.label} automatic slug must be readable, stable ASCII`);
      const expectedHash = crypto.createHash('sha256').update(testCase.title).digest('hex').slice(0, 12);
      assert(match[1].endsWith(`-${expectedHash}`), `${testCase.label} automatic slug hash must be stable for its title`);
      assert(/^[A-Za-z0-9._-]+$/.test(added.ticket.id), `${testCase.label} automatic id must satisfy safeTicketId`);
      const absoluteFile = path.resolve(root, added.ticket.file);
      const relativeFile = path.relative(repairDir, absoluteFile);
      assert(relativeFile && !relativeFile.startsWith('..') && !path.isAbsolute(relativeFile), `${testCase.label} ticket must stay under repair-tickets`);
      assert(fs.existsSync(absoluteFile), `${testCase.label} ticket file must be created`);
      autoIds.set(testCase.label, added.ticket.id);
    }
    assert.notStrictEqual(autoIds.get('chinese'), autoIds.get('symbols'), 'lossy titles must retain distinct stable hashes');

    assert.throws(
      () => Tools.repairTicketAdd({ title: '   ', bulletin: 'false' }),
      /repair-ticket-add requires --title/,
      'blank titles must remain invalid',
    );

    const explicitId = 'Keep.Case_123-ID';
    const explicit = Tools.repairTicketAdd({
      id: explicitId,
      title: 'Explicit safe id',
      bulletin: 'false',
    });
    assert.strictEqual(explicit.ticket.id, explicitId, 'valid explicit ids must be preserved');
    assert.throws(
      () => Tools.repairTicketAdd({ id: explicitId, title: 'Duplicate explicit id', bulletin: 'false' }),
      /repair ticket exists/,
      'duplicate ids must remain rejected',
    );

    const escapedFile = path.join(root, 'board', 'escape.md');
    assert.throws(
      () => Tools.repairTicketAdd({ id: '../escape', title: 'Traversal attempt', bulletin: 'false' }),
      /bad repair ticket id/,
      'unsafe explicit ids must be rejected instead of silently falling back',
    );
    assert.strictEqual(fs.existsSync(escapedFile), false, 'unsafe ids must never create a file outside repair-tickets');

    const created = Tools.repairTicketAdd({
      id: 'dept-smoke',
      title: 'Repair department smoke',
      source: '秘书',
      problem: 'queue failure needs root-cause triage',
      evidence: 'events=projects/控制台/artifacts/engine-events.jsonl',
      expectation: 'repair lead triages before codex repair executes',
    });

    assert.strictEqual(created.bulletinId, 'repair-dept-smoke');
    const cardsFile = path.join(artifactsDir, 'bulletin', 'cards.json');
    const card = JSON.parse(fs.readFileSync(cardsFile, 'utf8')).find(c => c.id === 'repair-dept-smoke');
    assert(card, 'repair bulletin card must exist');
    assert.strictEqual(card.target, 'repair-lead');
    assert.strictEqual(card.payload.role, 'repair-lead');
    assert.strictEqual(card.payload.flowId, 'agent-once');
    assert.strictEqual(card.payload.engineSlotBypass, true);
    assert(card.payload.goal.includes('维修主管'), 'repair-lead payload must explain lead triage');

    const enabled = Tools.bulletinEnable({ id: 'repair-dept-smoke' });
    assert.strictEqual(enabled.ok, true);
    assert.strictEqual(enabled.entry.task.role, 'repair-lead');
    assert.strictEqual(enabled.entry.task.engineSlotBypass, true);
    assert.strictEqual(Q.list(artifactsDir, 'repair-lead').queued.length, 1);
    assert.strictEqual(Q.list(artifactsDir, 'repair').queued.length, 0);

    const leadPrompt = fs.readFileSync(path.join(repo, 'shared/agents/repair-lead/prompt.md'), 'utf8');
    assert(leadPrompt.includes('queue-enqueue --agent repair'), 'repair lead prompt must delegate coding work to repair');
    assert(leadPrompt.includes('复核'), 'repair lead prompt must require review closure');
    assert(leadPrompt.includes('每个维修请求'), 'repair lead prompt must require one ticket per repair request');
    assert(leadPrompt.includes('HTML'), 'repair lead prompt must require fixed HTML completion report');
    const leadAgent = JSON.parse(fs.readFileSync(path.join(repo, 'shared/agents/repair-lead/agent.json'), 'utf8'));
    assert.strictEqual(leadAgent.runner, 'codex-privileged', 'repair lead must not depend on expired Claude runner');

    const repairPrompt = fs.readFileSync(path.join(repo, 'shared/agents/repair/prompt.md'), 'utf8');
    assert(repairPrompt.includes('repair-lead'), 'repair prompt must acknowledge repair-lead supervision');
    assert(repairPrompt.includes('元宵'), 'repair completion protocol must include YuanXiao delivery');

    const workspace = fs.readFileSync(path.join(repo, 'projects/控制台/public/workspace.html'), 'utf8');
    assert(workspace.includes('id="office-repair"'), 'office view must include repair department zone');
    assert(workspace.includes("'repair-lead'"), 'workspace must include repair-lead metadata');

    console.log(JSON.stringify({ pass: true, suite: 'repair-department' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
