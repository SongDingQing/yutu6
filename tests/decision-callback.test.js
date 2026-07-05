#!/usr/bin/env node
'use strict';
// 飞书决策卡真回调(拍板 Q12):GET /api/decision/<cardId>/<approve|reject>?t=<token>
// 覆盖:合法 token approve/reject 生效且幂等;错 token 403 不执行;decision.card.actioned 事件落盘;
// board-review 决策卡带 decisionSecret 且飞书按钮 URL 指向回调端点。

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function readEvents(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function makeCard(id, secret, extra = {}) {
  return Object.assign({
    id,
    title: `决策卡 ${id}`,
    desc: '测试用决策卡',
    target: 'ceo',
    project: '控制台',
    source: '董事会',
    payload: {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: `决策卡 ${id} 的任务`,
    },
    status: 'todo',
    queueId: null,
    decisionSecret: secret,
  }, extra);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-callback-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const eventsFile = path.join(artifactsDir, 'engine-events.jsonl');

  process.env.CONSOLE_WORKDIR = root;
  process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
  process.env.CONSOLE_EVENTS_FILE = eventsFile;
  process.env.QUEUE_WORKER_DISABLED = '1';
  delete process.env.DECISION_CALLBACK_ENABLED; // 默认应为开

  const Server = require('../projects/控制台/server');
  const DecisionToken = require('../projects/控制台/decision-token');

  const cardsFile = path.join(artifactsDir, 'bulletin', 'cards.json');
  const actionsFile = path.join(artifactsDir, 'bulletin', 'decision-actions.json');
  const secretA = DecisionToken.newSecret();
  const secretB = DecisionToken.newSecret();
  writeJson(cardsFile, [
    makeCard('bb-approve-1', secretA),
    makeCard('bb-reject-1', secretB),
  ]);

  const srv = http.createServer(Server.handler);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;

  try {
    // 1) 错 token → 403,不执行(卡还在、队列为空、无事件)
    const bad = await get(port, `/api/decision/bb-approve-1/approve?t=${'0'.repeat(64)}`);
    assert.strictEqual(bad.status, 403);
    assert(bad.body.includes('校验失败'));
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 0);
    let cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    assert.strictEqual(cards.find(c => c.id === 'bb-approve-1').status, 'todo');
    assert(!readEvents(eventsFile).some(e => e.type === 'decision.card.actioned'));

    // 缺 token 同样 403
    const noToken = await get(port, '/api/decision/bb-approve-1/approve');
    assert.strictEqual(noToken.status, 403);

    // 2) 合法 token approve → 启用 + 入队 + 事件落盘
    const approveToken = DecisionToken.sign(secretA, 'bb-approve-1', 'approve');
    const ok = await get(port, `/api/decision/bb-approve-1/approve?t=${approveToken}`);
    assert.strictEqual(ok.status, 200);
    assert(ok.body.includes('已批准'));
    assert(ok.body.includes('决策卡 bb-approve-1'));
    cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    const enabledCard = cards.find(c => c.id === 'bb-approve-1');
    assert.strictEqual(enabledCard.status, 'enabled');
    assert(enabledCard.queueId);
    const queued = Q.list(artifactsDir, 'ceo').queued;
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].id, enabledCard.queueId);
    let events = readEvents(eventsFile);
    const actioned = events.filter(e => e.type === 'decision.card.actioned');
    assert.strictEqual(actioned.length, 1);
    assert.strictEqual(actioned[0].bulletinId, 'bb-approve-1');
    assert.strictEqual(actioned[0].action, 'approve');
    assert.strictEqual(actioned[0].queueId, enabledCard.queueId);
    assert(events.some(e => e.type === 'bulletin.enabled' && e.bulletinId === 'bb-approve-1'));
    // secret/token 不落事件日志
    const eventsRaw = fs.readFileSync(eventsFile, 'utf8');
    assert(!eventsRaw.includes(secretA));
    assert(!eventsRaw.includes(approveToken));
    // 留痕文件存在且记录 approve
    const actions = JSON.parse(fs.readFileSync(actionsFile, 'utf8'));
    assert.strictEqual(actions['bb-approve-1'].action, 'approve');

    // 3) 重复点击 approve → 幂等"已处理过",不重复入队、不重复发事件
    const again = await get(port, `/api/decision/bb-approve-1/approve?t=${approveToken}`);
    assert.strictEqual(again.status, 200);
    assert(again.body.includes('已处理过'));
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 1);
    assert.strictEqual(readEvents(eventsFile).filter(e => e.type === 'decision.card.actioned').length, 1);
    // 已批准后再点驳回按钮 → 同样幂等,不撤销
    const rejectAfter = await get(port, `/api/decision/bb-approve-1/reject?t=${DecisionToken.sign(secretA, 'bb-approve-1', 'reject')}`);
    assert.strictEqual(rejectAfter.status, 200);
    assert(rejectAfter.body.includes('已处理过'));
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 1);

    // 4) 合法 token reject → 卡移除 + 事件落盘 + 幂等
    const rejectToken = DecisionToken.sign(secretB, 'bb-reject-1', 'reject');
    const rej = await get(port, `/api/decision/bb-reject-1/reject?t=${rejectToken}`);
    assert.strictEqual(rej.status, 200);
    assert(rej.body.includes('已驳回'));
    cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    assert(!cards.some(c => c.id === 'bb-reject-1'));
    assert.strictEqual(Q.list(artifactsDir, 'ceo').queued.length, 1); // 未入队
    events = readEvents(eventsFile);
    assert(events.some(e => e.type === 'decision.card.actioned' && e.bulletinId === 'bb-reject-1' && e.action === 'reject'));
    assert(events.some(e => e.type === 'bulletin.removed' && e.bulletinId === 'bb-reject-1' && e.source === 'feishu-decision-reject'));
    const rejAgain = await get(port, `/api/decision/bb-reject-1/reject?t=${rejectToken}`);
    assert.strictEqual(rejAgain.status, 200);
    assert(rejAgain.body.includes('已处理过'));
    // 卡已移除后错 token 仍 403(凭留痕 secret 校验)
    const rejBad = await get(port, `/api/decision/bb-reject-1/reject?t=${'f'.repeat(64)}`);
    assert.strictEqual(rejBad.status, 403);

    // 5) 未签发 secret 的卡 / 不存在的卡 → 403 不执行
    writeJson(cardsFile, JSON.parse(fs.readFileSync(cardsFile, 'utf8')).concat([makeCard('bb-nosecret-1', undefined)]));
    const noSecret = await get(port, `/api/decision/bb-nosecret-1/approve?t=${'a'.repeat(64)}`);
    assert.strictEqual(noSecret.status, 403);
    const ghost = await get(port, `/api/decision/bb-ghost-1/approve?t=${'a'.repeat(64)}`);
    assert.strictEqual(ghost.status, 403);

    // 6) 坏 action 不匹配路由 → 404
    const badAction = await get(port, '/api/decision/bb-approve-1/nuke?t=x');
    assert.strictEqual(badAction.status, 404);

    // 7) board-review 决策卡:带 decisionSecret,飞书 decision 卡两个按钮直指回调端点(baseUrl 可从 config 读)
    const BoardReview = require('../projects/控制台/board-review');
    const notifyCalls = [];
    const made = BoardReview._test.createOwnerDecisionCard({
      spec: { goal: '测试拍板任务', originalGoal: '测试拍板任务', projectId: '控制台' },
      projectId: '控制台',
      taskId: 'task-decision-cb',
      instruction: '测试拍板任务',
      finalOpinion: { summary: '存在硬阻断风险' },
      rounds: [],
      artifactsRoot: artifactsDir,
      notify: (title, body, extra) => { notifyCalls.push({ title, body, extra }); return { attempted: true, sent: true }; },
    });
    assert(made.card.decisionSecret, 'board decision card should carry decisionSecret');
    assert.strictEqual(notifyCalls.length, 1);
    const extra = notifyCalls[0].extra;
    assert.strictEqual(extra.type, 'decision');
    assert.strictEqual(extra.buttons.length, 3);
    const approveBtn = extra.buttons.find(b => b.label === '批准继续');
    const rejectBtn = extra.buttons.find(b => b.label === '驳回取消');
    const expectApprove = `/api/decision/${encodeURIComponent(made.card.id)}/approve?t=${DecisionToken.sign(made.card.decisionSecret, made.card.id, 'approve')}`;
    assert(approveBtn.url.endsWith(expectApprove));
    assert(approveBtn.url.startsWith('http://127.0.0.1:41218'));
    assert(rejectBtn.url.includes(`/api/decision/${encodeURIComponent(made.card.id)}/reject?t=`));
    // 卡片记录里的 secret 能通过服务端校验(端到端闭环)
    const e2e = await get(port, `/api/decision/${encodeURIComponent(made.card.id)}/reject?t=${DecisionToken.sign(made.card.decisionSecret, made.card.id, 'reject')}`);
    assert.strictEqual(e2e.status, 200);
    assert(e2e.body.includes('已驳回'));

    // 8) 反悔开关:DECISION_CALLBACK_ENABLED=0 时决策卡回退旧行为(单个跳转按钮,不签发 secret)
    process.env.DECISION_CALLBACK_ENABLED = '0';
    try {
      const offCalls = [];
      const madeOff = BoardReview._test.createOwnerDecisionCard({
        spec: { goal: '开关关闭时的拍板任务', originalGoal: '开关关闭时的拍板任务', projectId: '控制台' },
        projectId: '控制台',
        taskId: 'task-decision-off',
        instruction: '开关关闭时的拍板任务',
        finalOpinion: { summary: '存在硬阻断风险' },
        rounds: [],
        artifactsRoot: artifactsDir,
        notify: (title, body, extra) => { offCalls.push({ title, body, extra }); return { attempted: true, sent: true }; },
      });
      assert(!madeOff.card.decisionSecret);
      assert.strictEqual(offCalls[0].extra.buttonLabel, '打开决策卡');
      assert(offCalls[0].extra.buttonUrl.includes('/workspace?view=task-board&bulletin='));
      assert(!offCalls[0].extra.buttons);
    } finally {
      delete process.env.DECISION_CALLBACK_ENABLED;
    }

    console.log(JSON.stringify({ pass: true, suite: 'decision-callback' }));
  } finally {
    srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
