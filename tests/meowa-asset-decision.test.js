#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Q = require('../shared/engine/queue');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readEvents(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function parseDryRun(stdout) {
  const line = String(stdout || '').split(/\r?\n/).find(l => l.startsWith('DRY_RUN '));
  assert(line, `expected DRY_RUN stdout, got: ${stdout}`);
  const outer = JSON.parse(line.slice('DRY_RUN '.length));
  return { msg_type: outer.msg_type, content: JSON.parse(outer.content) };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meowa-asset-decision-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const eventsFile = path.join(artifactsDir, 'engine-events.jsonl');
  const pendingDir = path.join(root, 'pending');
  const approvedDir = path.join(root, 'approved');
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(path.join(pendingDir, 'hero.png'), 'hero-v1\n');
  fs.writeFileSync(path.join(pendingDir, 'monster.png'), 'monster-v1\n');

  process.env.CONSOLE_WORKDIR = root;
  process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
  process.env.CONSOLE_EVENTS_FILE = eventsFile;
  process.env.QUEUE_WORKER_DISABLED = '1';
  delete process.env.DECISION_CALLBACK_ENABLED;

  const Meowa = require('../projects/控制台/meowa-asset-decisions');
  const DecisionToken = require('../projects/控制台/decision-token');
  const Server = require('../projects/控制台/server');

  const notifyCalls = [];
  const registered = Meowa.registerAssetDecision({
    assetId: 'hero-idle-v1',
    title: '英雄 idle 动画 v1',
    cause: '新增英雄待接入,Meowa 生成后必须先给主人逐个审核。',
    source: 'Meowa pixel animate-run job workflow-hero-idle-v1',
    progress: 'PNG 已写入 pending 目录,尚未进入正式目录。',
    result: '自检通过: 文件存在,等待采纳。',
    decisionItem: '采纳后复制到 approved/hero.png; 不采纳则保留 pending 并重做。',
    generatedPaths: [path.join(pendingDir, 'hero.png')],
    approvedOutputs: [{ from: path.join(pendingDir, 'hero.png'), to: path.join(approvedDir, 'hero.png') }],
    baseUrl: 'http://127.0.0.1:41218',
  }, {
    artifactsRoot: artifactsDir,
    notify: (title, body, extra) => {
      notifyCalls.push({ title, body, extra });
      return { attempted: true, sent: true };
    },
  });

  assert.strictEqual(registered.asset.status, 'pending');
  assert.strictEqual(registered.card.source, Meowa.SOURCE);
  assert.strictEqual(registered.card.decisionKind, Meowa.KIND);
  assert.strictEqual(registered.card.assetId, 'hero-idle-v1');
  assert.strictEqual(notifyCalls.length, 1);
  assert.strictEqual(notifyCalls[0].extra.type, 'decision');
  assert.deepStrictEqual(notifyCalls[0].extra.buttons.map(b => b.label), ['采纳', '不采纳']);
  assert(notifyCalls[0].extra.buttons[0].url.includes(`/api/decision/${registered.card.id}/approve?t=`));
  assert(notifyCalls[0].extra.buttons[1].url.includes(`/api/decision/${registered.card.id}/reject?t=`));
  for (const label of ['标题:', '起因:', '来源:', '进展:', '结果:', '决策项:']) {
    assert(notifyCalls[0].body.includes(label), `missing five-part field ${label}`);
  }
  assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 0, 'register must not enqueue generic task');

  const dry = spawnSync('bash', [
    path.resolve(__dirname, '../shared/agents/ui-optimizer/notify-feishu.sh'),
    '--type', 'decision',
    '--title', 'Meowa dry-run',
    '--body', notifyCalls[0].body,
    '--buttons', `采纳|${notifyCalls[0].extra.buttons[0].url};;不采纳|${notifyCalls[0].extra.buttons[1].url}`,
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, { FEISHU_DRY_RUN: '1' }),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.strictEqual(dry.status, 0);
  const dryPayload = parseDryRun(dry.stdout);
  assert.strictEqual(dryPayload.msg_type, 'interactive');
  const dryAction = dryPayload.content.elements.find(e => e.tag === 'action');
  assert(dryAction);
  assert.deepStrictEqual(dryAction.actions.map(a => a.text.content), ['采纳', '不采纳']);
  assert(dryAction.actions[0].url.includes(`/api/decision/${registered.card.id}/approve?t=`));

  const srv = http.createServer(Server.handler);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;

  try {
    const bad = await get(port, `/api/decision/${registered.card.id}/approve?t=${'0'.repeat(64)}`);
    assert.strictEqual(bad.status, 403);
    assert.strictEqual(readJson(Meowa.ledgerPath(artifactsDir)).assets['hero-idle-v1'].status, 'pending');
    assert(!fs.existsSync(path.join(approvedDir, 'hero.png')));

    const approveToken = DecisionToken.sign(registered.card.decisionSecret, registered.card.id, 'approve');
    const approve = await get(port, `/api/decision/${registered.card.id}/approve?t=${approveToken}`);
    assert.strictEqual(approve.status, 200);
    assert(approve.body.includes('已采纳'));
    let ledger = readJson(Meowa.ledgerPath(artifactsDir));
    assert.strictEqual(ledger.assets['hero-idle-v1'].status, 'approved');
    assert.strictEqual(ledger.assets['hero-idle-v1'].processingResult, 'approved_and_integrated');
    assert.strictEqual(fs.readFileSync(path.join(approvedDir, 'hero.png'), 'utf8'), 'hero-v1\n');
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 0, 'approve must integrate asset, not enqueue bulletin task');

    const approveAgain = await get(port, `/api/decision/${registered.card.id}/approve?t=${approveToken}`);
    assert.strictEqual(approveAgain.status, 200);
    assert(approveAgain.body.includes('已处理过'));
    let events = readEvents(eventsFile);
    assert.strictEqual(events.filter(e => e.type === 'meowa.asset.decision' && e.assetId === 'hero-idle-v1').length, 1);
    assert.strictEqual(events.filter(e => e.type === 'decision.card.actioned' && e.assetId === 'hero-idle-v1').length, 1);

    const rejectRegistered = Meowa.registerAssetDecision({
      assetId: 'monster-idle-v1',
      title: '怪物 idle 动画 v1',
      cause: '新增怪物待审核。',
      source: 'Meowa pixel animate-run job workflow-monster-idle-v1',
      progress: 'PNG 已写入 pending 目录。',
      result: '等待老板审核。',
      decisionItem: '不采纳时不得复制到正式目录。',
      generatedPaths: [path.join(pendingDir, 'monster.png')],
      approvedOutputs: [{ from: path.join(pendingDir, 'monster.png'), to: path.join(approvedDir, 'monster.png') }],
      baseUrl: 'http://127.0.0.1:41218',
    }, {
      artifactsRoot: artifactsDir,
      notify: () => ({ attempted: true, sent: true }),
    });
    const rejectToken = DecisionToken.sign(rejectRegistered.card.decisionSecret, rejectRegistered.card.id, 'reject');
    const reject = await get(port, `/api/decision/${rejectRegistered.card.id}/reject?t=${rejectToken}`);
    assert.strictEqual(reject.status, 200);
    assert(reject.body.includes('已不采纳'));
    ledger = readJson(Meowa.ledgerPath(artifactsDir));
    assert.strictEqual(ledger.assets['monster-idle-v1'].status, 'rejected');
    assert.strictEqual(ledger.assets['monster-idle-v1'].processingResult, 'rejected_not_integrated');
    assert(!fs.existsSync(path.join(approvedDir, 'monster.png')));
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 0);

    events = readEvents(eventsFile);
    assert(events.some(e => e.type === 'meowa.asset.decision' && e.assetId === 'monster-idle-v1' && e.action === 'reject'));
    const rawEvents = fs.readFileSync(eventsFile, 'utf8');
    assert(!rawEvents.includes(registered.card.decisionSecret), 'decision secret must not be written to events');
    assert(!rawEvents.includes(approveToken), 'decision token must not be written to events');
  } finally {
    srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ pass: true, suite: 'meowa-asset-decision' }));
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
