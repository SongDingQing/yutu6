#!/usr/bin/env node
'use strict';

const assert = require('assert');
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
    fs.mkdirSync(path.join(root, 'board', 'repair-tickets'), { recursive: true });

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

    const repairPrompt = fs.readFileSync(path.join(repo, 'shared/agents/repair/prompt.md'), 'utf8');
    assert(repairPrompt.includes('repair-lead'), 'repair prompt must acknowledge repair-lead supervision');

    const workspace = fs.readFileSync(path.join(repo, 'projects/控制台/public/workspace.html'), 'utf8');
    assert(workspace.includes('id="office-repair"'), 'office view must include repair department zone');
    assert(workspace.includes("'repair-lead'"), 'workspace must include repair-lead metadata');

    console.log(JSON.stringify({ pass: true, suite: 'repair-department' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
