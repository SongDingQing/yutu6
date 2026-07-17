#!/usr/bin/env node
'use strict';
// 飞书决策卡真回调(拍板 Q12):GET /api/decision/<cardId>/<approve|reject>?t=<token>
// 覆盖:合法 token approve/reject 生效且幂等;错 token 403 不执行;decision.card.actioned 事件落盘;
// board-review 决策卡带 decisionSecret；飞书按钮使用原生 value 回调且不携带 secret/token。

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const Q = require('../shared/engine/queue');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');

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

function agentOnceFlow() {
  return {
    id: 'agent-once',
    nodes: [
      { id: 'execute', agent_role: 'quality_ops' },
      { id: 'done', type: 'end' },
    ],
    edges: [{ from: 'execute', to: 'done' }],
    guards: { validate_before_run: false, max_loops: 1 },
    acceptance: { require_evidence: true },
  };
}

function runManualOverrideFlow(spec, EngineRunner, root, label) {
  const events = [];
  const ctx = EngineRunner._test.makeCtx(spec);
  const result = runFlow({
    flow: agentOnceFlow(),
    taskId: spec.taskId,
    taskstore: new TaskStore(path.join(root, `tasks-${label}`)),
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
    workspaceRoot: path.resolve(__dirname, '..'),
    vars: ctx,
    manualCompletionOverride: ctx.manual_completion_override || null,
    verifyManualCompletionOverride: EngineRunner._test.makeDirectCompletionOverrideVerifier(spec),
    directCompletionConflictMode: 'shadow',
    runner() {
      return {
        vars: { result: { done: false, summary: '等待主人已批准的人工收口' } },
        evidence: { type: 'result', runner: 'fake', path: path.join(root, `${label}-result.md`) },
      };
    },
  });
  return { result, events, ctx };
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
  const DirectCompletionOverride = require('../projects/控制台/direct-completion-override');

  const cardsFile = path.join(artifactsDir, 'bulletin', 'cards.json');
  const actionsFile = path.join(artifactsDir, 'bulletin', 'decision-actions.json');
  const secretA = DecisionToken.newSecret();
  const secretB = DecisionToken.newSecret();
  writeJson(cardsFile, [
    makeCard('bb-approve-1', secretA),
    makeCard('bb-reject-1', secretB),
  ]);
  const manualOverrideCard = DirectCompletionOverride.createOwnerDecisionCard({
    artifactsRoot: artifactsDir,
    queueAgent: 'quality_ops',
    projectId: '控制台',
    cardId: 'direct-completion-owner-1',
    reason: '主人已核实外部交付，允许覆盖本次 direct done=false',
    payload: {
      role: 'quality_ops',
      flowId: 'agent-once',
      projectMode: false,
      projectId: '控制台',
      goal: '主人拍板后的 direct completion 队列入口',
    },
  }).card;

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

    // 7) direct completion 特种决策卡：只有合法 HMAC owner 点击会签发 queue-bound receipt。
    const manualToken = DecisionToken.sign(manualOverrideCard.decisionSecret, manualOverrideCard.id, 'approve');
    assert.throws(() => DirectCompletionOverride.issueQueueBoundReceipt({
      artifactsRoot: artifactsDir,
      queueAgent: 'quality_ops',
      queueId: 'direct-issuer-without-server-key',
      card: manualOverrideCard,
      action: 'approve',
      decisionToken: manualToken,
      approvedAt: '2026-07-16T11:00:00.000Z',
    }), /server signing key/, '即使拿到卡片 HMAC token，直接调用 issuer 也不得拿到 server 私钥签名');
    const manualApproved = await get(port, `/api/decision/${manualOverrideCard.id}/approve?t=${manualToken}`);
    assert.strictEqual(manualApproved.status, 200);
    assert(manualApproved.body.includes('已批准人工覆盖'));
    cards = JSON.parse(fs.readFileSync(cardsFile, 'utf8'));
    const enabledManualCard = cards.find(card => card.id === manualOverrideCard.id);
    assert(enabledManualCard && enabledManualCard.queueId);
    assert(enabledManualCard.manualCompletionOverrideReceiptId);
    const manualQueued = Q.list(artifactsDir, 'quality_ops').queued;
    assert.strictEqual(manualQueued.length, 1);
    assert.strictEqual(manualQueued[0].id, enabledManualCard.queueId);
    assert.strictEqual(
      manualQueued[0].task.manual_completion_override_receipt_id,
      enabledManualCard.manualCompletionOverrideReceiptId,
    );
    assert.strictEqual(manualQueued[0].task.manual_completion_override, undefined, '队列不得携带可伪造的 inline owner receipt');
    assert.strictEqual(manualQueued[0].task.manual_completion_override_request, undefined, 'owner request 已换成持久 receipt id');
    const queueReceiptFile = DirectCompletionOverride.receiptFile(
      artifactsDir,
      enabledManualCard.manualCompletionOverrideReceiptId,
    );
    const queueReceipt = JSON.parse(fs.readFileSync(queueReceiptFile, 'utf8'));
    assert.strictEqual(queueReceipt.queueAgent, 'quality_ops');
    assert.strictEqual(queueReceipt.queueId, enabledManualCard.queueId);
    assert.strictEqual(queueReceipt.verification, DirectCompletionOverride.VERIFICATION);
    assert.strictEqual(queueReceipt.signatureAlgorithm, DirectCompletionOverride.SIGNATURE_ALGORITHM);
    assert(queueReceipt.authorityId);
    assert(queueReceipt.signature);
    const actionsAfterManual = JSON.parse(fs.readFileSync(actionsFile, 'utf8'));
    const manualAction = actionsAfterManual[manualOverrideCard.id];
    assert.strictEqual(manualAction.action, 'approve');
    assert.strictEqual(manualAction.decisionKind, DirectCompletionOverride.DECISION_KIND);
    assert.strictEqual(manualAction.queueId, enabledManualCard.queueId);
    assert.strictEqual(manualAction.receiptId, queueReceipt.receiptId);
    assert.strictEqual(manualAction.receiptAuthorityId, queueReceipt.authorityId);
    assert.strictEqual(manualAction.receiptSignature, queueReceipt.signature);
    assert.strictEqual(manualAction.verification, 'hmac-sha256-decision-card');
    assert.strictEqual(manualAction.via, 'feishu-card');
    assert.strictEqual(manualAction.at, queueReceipt.approved_at);

    // 真正的 HMAC 回调产物必须能走 queue payload → ceo-worker.makeSpec 的生产入口。
    const ceoWorkerPath = require.resolve('../projects/控制台/ceo-worker');
    const engineRunnerPath = require.resolve('../projects/控制台/engine-runner');
    const previousQueueAgent = process.env.QUEUE_AGENT;
    process.env.QUEUE_AGENT = 'quality_ops';
    delete require.cache[ceoWorkerPath];
    delete require.cache[engineRunnerPath];
    try {
      const CeoWorker = require(ceoWorkerPath)._test;
      const claimedManual = Q.claim(artifactsDir, 'quality_ops', {
        match(entry) { return entry.id === enabledManualCard.queueId; },
      });
      assert(claimedManual, '真实 HMAC 回调入队项应能进入 running');
      const trustedSpec = CeoWorker.makeSpec(claimedManual);
      Q.touchLease(artifactsDir, 'quality_ops', claimedManual.id, { taskId: trustedSpec.taskId });
      const EngineRunner = require(engineRunnerPath);
      assert(trustedSpec.manual_completion_override, '真实 HMAC 回调签发的 receipt 应被 makeSpec 接受');
      assert.strictEqual(trustedSpec.manual_completion_override.taskId, trustedSpec.taskId);
      assert.strictEqual(trustedSpec.manual_completion_override.queueAgent, 'quality_ops');
      assert.strictEqual(trustedSpec.manual_completion_override.queueId, enabledManualCard.queueId);
      assert.strictEqual(trustedSpec.manual_completion_override_audit.status, 'accepted');

      const trustedRun = runManualOverrideFlow(trustedSpec, EngineRunner, root, 'trusted');
      assert.strictEqual(trustedRun.result.ok, true, '真实 HMAC 回调必须通过最终验签并允许人工收口');
      assert(trustedRun.events.some(event => event.type === 'done_gate.direct_manual_override'));
      assert(trustedRun.events.some(event => event.type === 'edge.take'
        && event.from === 'execute' && event.to === 'done'));

      const forgedSpec = JSON.parse(JSON.stringify(trustedSpec));
      forgedSpec.manual_completion_override = {
        schema: trustedSpec.manual_completion_override.schema,
        approved: true,
        actor: 'owner',
        source: 'owner_decision',
        taskId: trustedSpec.taskId,
        reason: '伪造的无签名 engine-job override',
        approved_at: trustedSpec.manual_completion_override.approved_at,
      };
      const forgedRun = runManualOverrideFlow(forgedSpec, EngineRunner, root, 'forged');
      assert.strictEqual(forgedRun.result.ok, false, '无签名 engine-job spec 注入必须失败关闭');
      assert(forgedRun.events.some(event => event.type === 'done_gate.direct_manual_override_rejected'
        && /receiptId/.test(event.reason || '')));
      assert(!forgedRun.events.some(event => event.type === 'edge.take' && event.to === 'done'));

      const tamperedSpec = JSON.parse(JSON.stringify(trustedSpec));
      tamperedSpec.manual_completion_override.reason = '篡改后的人工覆盖原因';
      const tamperedRun = runManualOverrideFlow(tamperedSpec, EngineRunner, root, 'tampered');
      assert.strictEqual(tamperedRun.result.ok, false, '已签发 engine-job spec 的字段篡改必须失败关闭');
      assert(tamperedRun.events.some(event => event.type === 'done_gate.direct_manual_override_rejected'
        && /字段 reason/.test(event.reason || '')));
      assert(!tamperedRun.events.some(event => event.type === 'edge.take' && event.to === 'done'));

      const identityTamperedSpec = JSON.parse(JSON.stringify(trustedSpec));
      identityTamperedSpec.taskId = `${trustedSpec.taskId}-tampered`;
      identityTamperedSpec.manual_completion_override.taskId = identityTamperedSpec.taskId;
      const identityTamperedRun = runManualOverrideFlow(identityTamperedSpec, EngineRunner, root, 'identity-tampered');
      assert.strictEqual(identityTamperedRun.result.ok, false, 'engine-job taskId 与 running queue 不一致必须失败关闭');
      assert(identityTamperedRun.events.some(event => event.type === 'done_gate.direct_manual_override_rejected'
        && /running queue\/task 绑定不一致/.test(event.reason || '')));
      assert(!identityTamperedRun.events.some(event => event.type === 'edge.take' && event.to === 'done'));

      const withoutManualAction = Object.assign({}, actionsAfterManual);
      delete withoutManualAction[manualOverrideCard.id];
      writeJson(actionsFile, withoutManualAction);
      const actionRemovedRun = runManualOverrideFlow(trustedSpec, EngineRunner, root, 'action-removed');
      assert.strictEqual(actionRemovedRun.result.ok, false, '最终消费前删除 decision action 必须失败关闭');
      assert(actionRemovedRun.events.some(event => event.type === 'done_gate.direct_manual_override_rejected'
        && /decision action/.test(event.reason || '')));
      assert(!actionRemovedRun.events.some(event => event.type === 'edge.take' && event.to === 'done'));
      const missingActionSpec = CeoWorker.makeSpec(claimedManual);
      assert.strictEqual(missingActionSpec.manual_completion_override, undefined);
      assert.strictEqual(missingActionSpec.manual_completion_override_audit.status, 'rejected');
      assert.match(missingActionSpec.manual_completion_override_audit.reason, /decision action/);
      writeJson(actionsFile, actionsAfterManual);
    } finally {
      delete require.cache[ceoWorkerPath];
      delete require.cache[engineRunnerPath];
      if (previousQueueAgent == null) delete process.env.QUEUE_AGENT;
      else process.env.QUEUE_AGENT = previousQueueAgent;
    }
    events = readEvents(eventsFile);
    assert(events.some(event => event.type === 'done_gate.direct_manual_override_receipt_issued'
      && event.queueAgent === 'quality_ops'
      && event.queueId === enabledManualCard.queueId));
    assert(events.some(event => event.type === 'decision.card.actioned'
      && event.decisionKind === DirectCompletionOverride.DECISION_KIND
      && event.receiptId === enabledManualCard.manualCompletionOverrideReceiptId));

    // 8) board-review 决策卡:带 decisionSecret,飞书批准/驳回使用原生 value 回调。
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
    assert.strictEqual(extra.actions.length, 3);
    const approveBtn = extra.actions.find(b => b.label === '批准继续');
    const rejectBtn = extra.actions.find(b => b.label === '驳回取消');
    const consoleBtn = extra.actions.find(b => b.label === '打开控制台');
    assert.deepStrictEqual(approveBtn.value, {
      yutu6_decision_action: 'approve',
      card_id: made.card.id,
    });
    assert.deepStrictEqual(rejectBtn.value, {
      yutu6_decision_action: 'reject',
      card_id: made.card.id,
    });
    assert.strictEqual(approveBtn.url, undefined, '批准按钮不得打开浏览器');
    assert.strictEqual(rejectBtn.url, undefined, '驳回按钮不得打开浏览器');
    assert(consoleBtn.url.includes('/workspace?view=task-board&bulletin='));
    assert(!JSON.stringify(extra.actions).includes(made.card.decisionSecret), '飞书 action value 不得携带本机 secret');
    assert(!JSON.stringify(extra.actions).includes(DecisionToken.sign(made.card.decisionSecret, made.card.id, 'approve')), '飞书 action value 不得携带 HMAC token');
    // 卡片记录里的 secret 能通过服务端校验(端到端闭环)
    const e2e = await get(port, `/api/decision/${encodeURIComponent(made.card.id)}/reject?t=${DecisionToken.sign(made.card.decisionSecret, made.card.id, 'reject')}`);
    assert.strictEqual(e2e.status, 200);
    assert(e2e.body.includes('已驳回'));

    // 9) 反悔开关:DECISION_CALLBACK_ENABLED=0 时决策卡回退旧行为(单个跳转按钮,不签发 secret)
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
      assert(!offCalls[0].extra.actions);
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
