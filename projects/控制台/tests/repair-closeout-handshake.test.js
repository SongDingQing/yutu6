#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Q = require('../../../shared/engine/queue');
const EventLog = require('../../../shared/engine/eventlog');
const Handshake = require('../repair-closeout-handshake');
const DecisionToken = require('../decision-token');
const QueueAutoMerge = require('../queue-automerge');
const RepairReport = require('../repair-report');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function ticketStatus(file) {
  const text = fs.readFileSync(file, 'utf8');
  return ((text.match(/^- status:\s*(.+)$/m) || [null, ''])[1] || '').trim();
}

function childTask(ticketId, extra = {}) {
  return Object.assign({
    role: 'repair',
    flowId: 'agent-once',
    projectId: '控制台',
    repairTicketId: ticketId,
    goal: `读取 board/repair-tickets/${ticketId}.md 执行最小维修`,
  }, extra);
}

function auditShapeComplete(state) {
  assert(Array.isArray(state.audit) && state.audit.length > 0, 'handshake audit must exist');
  for (const row of state.audit) {
    for (const key of ['ticketId', 'sourceIncidentId', 'childId', 'originalStatus', 'disposition', 'confirmation', 'ttl', 'ownerDecision', 'finalStatus']) {
      assert(Object.prototype.hasOwnProperty.call(row, key), `audit row must contain ${key}`);
    }
    assert(Object.prototype.hasOwnProperty.call(row.ttl, 'ttlMs'));
    assert(Object.prototype.hasOwnProperty.call(row.ttl, 'expiresAt'));
    if (/^repair\.closeout\.child_/.test(String(row.type || ''))) {
      assert(row.childId, `child audit ${row.type} must identify child`);
      assert(row.originalStatus, `child audit ${row.type} must identify original status`);
      assert(row.disposition, `child audit ${row.type} must identify disposition`);
    }
    if (row.type === 'repair.closeout.closed') assert(row.finalStatus, 'closed audit must record final status');
    if (row.type === 'repair.closeout.owner_decided') assert(row.ownerDecision, 'owner decision audit must record decision');
  }
}

function httpGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: requestPath }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function httpPost(port, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-closeout-handshake-'));
  const artifacts = path.join(root, 'projects', '控制台', 'artifacts');
  const eventsFile = path.join(artifacts, 'engine-events.jsonl');
  let decisionServer = null;
  try {
    process.env.CONSOLE_WORKDIR = root;
    process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
    process.env.CONSOLE_EVENTS_FILE = eventsFile;
    process.env.REPAIR_CLOSEOUT_HANDSHAKE_ENABLED = '1';
    process.env.REPAIR_CLOSEOUT_HANDSHAKE_TTL_MS = '60000';
    process.env.QUEUE_WORKER_DISABLED = '1';
    delete process.env.DECISION_CALLBACK_ENABLED;
    const Tools = require('../secretary-tools');

    // 1) 无子任务:直接结案,握手审计仍然可追踪。
    const noChild = Tools.repairTicketAdd({ id: 'no-child', title: 'no child', bulletin: 'false' });
    const noChildDone = Tools.repairTicketComplete({
      id: 'no-child',
      result: '严重度: low; 根因: fixture; 处理: noop; 验证: pass; 架构判断: isolated',
      notify: 'false',
    });
    assert.strictEqual(noChildDone.ok, true);
    assert.strictEqual(noChildDone.handshake.status, 'closed');
    assert.strictEqual(ticketStatus(path.join(root, noChild.ticket.file)), 'done');

    // 2) queued 精确匹配被取消;无关 ticket/source incident 不受影响;重复结案无副作用。
    Tools.repairTicketAdd({ id: 'queued-ticket', title: 'queued child', bulletin: 'false' });
    Q.enqueue(artifacts, 'repair', childTask('queued-ticket'), { id: 'queued-match' });
    Q.enqueue(artifacts, 'repair', childTask('other-ticket', { sourceIncidentId: 'other-incident' }), { id: 'queued-unrelated' });
    const queuedDone = Tools.repairTicketComplete({
      id: 'queued-ticket',
      result: '严重度: medium; 根因: duplicate; 处理: cancel queued; 验证: pass; 架构判断: scoped',
      notify: 'false',
    });
    assert.strictEqual(queuedDone.ok, true);
    assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'queued-match.json')));
    assert(Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'queued-unrelated'));
    const queuedStateFile = path.join(artifacts, 'repair-closeout-handshakes', 'queued-ticket.json');
    const queuedStateBefore = readJson(queuedStateFile);
    const queuedAuditCount = queuedStateBefore.audit.length;
    const eventCountBeforeRepeat = readEvents(eventsFile).length;
    const repeatedQueuedDone = Tools.repairTicketComplete({
      id: 'queued-ticket',
      result: '同一结案请求重试',
      notify: 'false',
    });
    assert.strictEqual(repeatedQueuedDone.alreadyClosed, true);
    assert.strictEqual(readJson(queuedStateFile).audit.length, queuedAuditCount, 'repeat must not append audit');
    assert.strictEqual(readEvents(eventsFile).length, eventCountBeforeRepeat, 'repeat must not emit events');
    assert.strictEqual(Q.list(artifacts, 'repair').canceled, 1, 'repeat must not cancel twice');

    // queued 扫描后被 worker 抢占的竞态必须转 running steer + 确认屏障，不能签发结案 lease。
    const raceTicket = Tools.repairTicketAdd({ id: 'queue-claim-race-ticket', title: 'queue claim race', bulletin: 'false' });
    Q.enqueue(artifacts, 'repair', childTask('queue-claim-race-ticket'), { id: 'queue-claim-race-child' });
    const originalCancel = Q.cancel;
    let injectedClaim = false;
    Q.cancel = function cancelAfterClaim(rootArg, agent, queueId) {
      if (!injectedClaim && agent === 'repair' && queueId === 'queue-claim-race-child') {
        injectedClaim = true;
        Q.claim(rootArg, agent, { match(entry) { return entry.id === queueId; } });
      }
      return originalCancel(rootArg, agent, queueId);
    };
    let raceBlocked;
    try {
      raceBlocked = Tools.repairTicketComplete({ id: 'queue-claim-race-ticket', result: '竞态期间不得生成报告或结案', notify: 'false' });
    } finally {
      Q.cancel = originalCancel;
    }
    assert.strictEqual(raceBlocked.blocked, true);
    assert.strictEqual(raceBlocked.reason, 'closing_pending_child');
    assert.strictEqual(ticketStatus(path.join(root, raceTicket.ticket.file)), 'closing_pending_child');
    const racedRunning = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'queue-claim-race-child');
    assert(racedRunning, 'claimed child must remain observable as running/canceling');
    assert.strictEqual(racedRunning.cancel_requested, true);
    assert.strictEqual(racedRunning.steer.length, 1);
    assert(racedRunning.steer[0].msg.includes('[MANDATORY REPAIR CLOSEOUT / READ-ONLY NO-OP]'));
    const raceState = readJson(path.join(artifacts, 'repair-closeout-handshakes', 'queue-claim-race-ticket.json'));
    assert.strictEqual(raceState.children['repair:queue-claim-race-child'].originalStatus, 'queued');
    assert.strictEqual(raceState.children['repair:queue-claim-race-child'].observedStatus, 'running');
    assert.strictEqual(raceState.children['repair:queue-claim-race-child'].requiresConfirmation, true);
    assert(!readEvents(eventsFile).some(event => event.type === 'repair.ticket.completed' && event.ticketId === 'queue-claim-race-ticket'));

    // 3) running 子任务:单次 mandatory steer + closing_pending_child;终态且显式确认后才结案。
    const runningTicket = Tools.repairTicketAdd({ id: 'running-ticket', title: 'running child', bulletin: 'false' });
    Q.enqueue(artifacts, 'repair', childTask('running-ticket', { goal: 'token=SHOULD_NOT_APPEAR board/repair-tickets/running-ticket.md' }), { id: 'running-match' });
    Q.claim(artifacts, 'repair', { match(entry) { return entry.id === 'running-match'; } });
    const sentinel = path.join(root, 'protected-output.txt');
    fs.writeFileSync(sentinel, 'unchanged');
    const firstBlocked = Tools.repairTicketComplete({ id: 'running-ticket', result: '暂不应结案', notify: 'false' });
    assert.strictEqual(firstBlocked.blocked, true);
    assert.strictEqual(firstBlocked.reason, 'closing_pending_child');
    assert.strictEqual(ticketStatus(path.join(root, runningTicket.ticket.file)), 'closing_pending_child');
    let runningEntry = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'running-match');
    assert.strictEqual(runningEntry.steer.length, 1);
    assert(runningEntry.steer[0].msg.includes('[MANDATORY REPAIR CLOSEOUT / READ-ONLY NO-OP]'));
    const runningStateFile = path.join(artifacts, 'repair-closeout-handshakes', 'running-ticket.json');
    const runningAuditBeforeRepeat = readJson(runningStateFile).audit.length;
    const secondBlocked = Tools.repairTicketComplete({ id: 'running-ticket', result: '重试仍应阻断', notify: 'false' });
    assert.strictEqual(secondBlocked.blocked, true);
    runningEntry = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'running-match');
    assert.strictEqual(runningEntry.steer.length, 1, 'repeat must not steer twice');
    assert.strictEqual(readJson(runningStateFile).audit.length, runningAuditBeforeRepeat, 'repeat pending call must not append audit');
    assert.throws(() => Tools.repairTicketChildConfirm({
      id: 'running-ticket', agent: 'repair', queueId: 'running-match', mode: 'read-only-no-op-confirmed',
    }), /still running/);
    Q.finish(artifacts, 'repair', 'running-match', 'done', { enginePid: 12345, engine_pid: null });
    const livePidGuard = Handshake.createManager({
      queueRoot: artifacts,
      workdir: root,
      enabled: true,
      engineAlive: record => Number(record && record.enginePid) === 12345,
    });
    assert.throws(() => livePidGuard.confirmChild({
      id: 'running-ticket', agent: 'repair', queueId: 'running-match', mode: 'read-only-no-op-confirmed',
    }), /live engine process/);
    const runningTerminalFile = path.join(Q.qdir(artifacts, 'repair'), 'done', 'running-match.json');
    const runningTerminal = readJson(runningTerminalFile);
    runningTerminal.enginePid = null;
    fs.writeFileSync(runningTerminalFile, JSON.stringify(runningTerminal, null, 2) + '\n');
    assert.throws(() => Tools.repairTicketChildConfirm({
      id: 'running-ticket', agent: 'repair', queueId: 'running-match', mode: 'read-only-no-op-confirmed',
    }), /missing a verifiable engine pid/);
    runningTerminal.enginePid = 99999999;
    fs.writeFileSync(runningTerminalFile, JSON.stringify(runningTerminal, null, 2) + '\n');
    const confirmed = Tools.repairTicketChildConfirm({
      id: 'running-ticket', agent: 'repair', queueId: 'running-match', mode: 'read-only-no-op-confirmed',
    });
    assert.strictEqual(confirmed.child.confirmation.proof, 'terminal_queue_state_and_engine_pid_not_alive');
    assert.deepStrictEqual(confirmed.child.confirmation.processProof, {
      activeQueueEntry: false,
      enginePid: 99999999,
      engineIdentity: 'pid:99999999',
      engineProcessAlive: false,
    });
    assert.deepStrictEqual(confirmed.child.confirmation.guarantees, {
      fileWritesAfterConfirmation: false,
      privilegedChangesAfterConfirmation: false,
      duplicateCodeAfterConfirmation: false,
    });
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
    const runningDone = Tools.repairTicketComplete({
      id: 'running-ticket',
      result: '严重度: high; 根因: running duplicate; 处理: readonly steer; 验证: terminal confirmed; 架构判断: guarded',
      notify: 'false',
    });
    assert.strictEqual(runningDone.ok, true);
    assert.strictEqual(runningDone.handshake.status, 'closed');
    assert(!Q.list(artifacts, 'repair').running.some(entry => entry.id === 'running-match'));
    assert(!JSON.stringify(readJson(runningStateFile)).includes('SHOULD_NOT_APPEAR'), 'audit must not copy task goal or credential-like text');

    // 3b) 已 claim 但仍在 runner singleflight 前等待、从未启动 engine 的 child 可安全取消，
    // 避免 repair-lead 持特权锁等待同票 repair child 的自锁。
    const preEngineTicket = Tools.repairTicketAdd({ id: 'pre-engine-ticket', title: 'pre-engine child', bulletin: 'false' });
    Q.enqueue(artifacts, 'repair', childTask('pre-engine-ticket'), { id: 'pre-engine-match' });
    Q.claim(artifacts, 'repair', { match(entry) { return entry.id === 'pre-engine-match'; } });
    Q.touchLease(artifacts, 'repair', 'pre-engine-match', {
      pre_engine_waiting: true,
      pre_engine_wait_phase: 'pre-engine-lock-wait',
      pre_engine_wait_heartbeat_at: new Date().toISOString(),
      enginePid: null,
    });
    const preEngineBlocked = Tools.repairTicketComplete({ id: 'pre-engine-ticket', result: '等待安全终态', notify: 'false' });
    assert.strictEqual(preEngineBlocked.blocked, true);
    const preEngineRunning = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'pre-engine-match');
    assert.strictEqual(preEngineRunning.cancel_requested, true, 'pre-engine child must receive a safe cancel request');
    assert.strictEqual(preEngineRunning.steer.length, 1);
    const preEngineStateFile = path.join(artifacts, 'repair-closeout-handshakes', 'pre-engine-ticket.json');
    assert.strictEqual(readJson(preEngineStateFile).children['repair:pre-engine-match'].disposition, 'pre_engine_cancel_requested');
    Q.finish(artifacts, 'repair', 'pre-engine-match', 'canceled', {
      pre_engine_waiting: true,
      pre_engine_wait_phase: 'pre-engine-lock-wait',
      pre_engine_cancel_confirmed: true,
      enginePid: null,
    });
    const preEngineConfirmed = Tools.repairTicketChildConfirm({
      id: 'pre-engine-ticket', agent: 'repair', queueId: 'pre-engine-match', mode: 'read-only-no-op-confirmed',
    });
    assert.strictEqual(preEngineConfirmed.child.confirmation.proof, 'terminal_pre_engine_cancel_and_no_engine_started');
    assert.deepStrictEqual(preEngineConfirmed.child.confirmation.processProof, {
      activeQueueEntry: false,
      enginePid: null,
      engineIdentity: 'pre-engine:no-engine',
      engineProcessAlive: false,
    });
    const preEngineDone = Tools.repairTicketComplete({
      id: 'pre-engine-ticket',
      result: '严重度: high; 根因: pre-engine self-lock; 处理: safe cancel; 验证: no engine started; 架构判断: guarded',
      notify: 'false',
    });
    assert.strictEqual(preEngineDone.ok, true);

    // 4) 相同 source incident 即使 ticket 字段不同也应收口。
    Tools.repairTicketAdd({ id: 'incident-ticket', title: 'source incident child', sourceIncidentId: 'incident-123', bulletin: 'false' });
    Q.enqueue(artifacts, 'repair', childTask('legacy-other-ticket', { sourceIncidentId: 'incident-123' }), { id: 'incident-match' });
    const incidentDone = Tools.repairTicketComplete({
      id: 'incident-ticket',
      result: '严重度: medium; 根因: same incident; 处理: canceled; 验证: isolated; 架构判断: scoped',
      notify: 'false',
    });
    assert.strictEqual(incidentDone.ok, true);
    assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'incident-match.json')));
    const incidentState = readJson(path.join(artifacts, 'repair-closeout-handshakes', 'incident-ticket.json'));
    assert.strictEqual(incidentState.sourceIncidentId, 'incident-123');
    assert.throws(() => Tools.repairTicketComplete({
      id: 'incident-ticket', sourceIncidentId: 'different-incident', result: 'mismatch must fail', notify: 'false',
    }), /source incident id mismatch/);

    // 5) TTL 超时只生成主人决策项;未批准不结案;批准强制收口会请求终止并留 warning。
    let clock = 10_000;
    const ttlStateDir = path.join(artifacts, 'repair-closeout-handshakes');
    const ttlEvents = [];
    const ttlManager = Handshake.createManager({
      queueRoot: artifacts,
      workdir: root,
      stateDir: ttlStateDir,
      enabled: true,
      ttlMs: 1000,
      now: () => clock,
      eventlog: (type, payload) => ttlEvents.push({ type, payload }),
    });
    Q.enqueue(artifacts, 'repair', childTask('ttl-ticket'), { id: 'ttl-running' });
    Q.claim(artifacts, 'repair', { match(entry) { return entry.id === 'ttl-running'; } });
    assert.strictEqual(ttlManager.preflight({ ticketId: 'ttl-ticket' }).reason, 'closing_pending_child');
    clock = 11_001;
    const timedOut = ttlManager.preflight({ ticketId: 'ttl-ticket' });
    assert.strictEqual(timedOut.reason, 'owner_decision_required');
    assert.deepStrictEqual(timedOut.state.ownerDecisionRequest.options, ['keep-waiting', 'force-read-only']);
    assert.strictEqual(timedOut.state.ownerDecisionRequest.autoCloseAllowed, false);
    assert.strictEqual(timedOut.state.ownerDecisionRequest.receiptRequired, true);
    assert(timedOut.state.ownerDecisionRequest.cardId);
    assert.strictEqual(Q.list(artifacts, 'repair').running.find(entry => entry.id === 'ttl-running').cancel_requested, undefined);
    const rawBooleanAttempt = ttlManager.preflight({ ticketId: 'ttl-ticket', ownerDecision: 'force-read-only', ownerApproved: true });
    assert.strictEqual(rawBooleanAttempt.blocked, true, 'caller-supplied boolean must not authorize force close');
    assert.strictEqual(rawBooleanAttempt.reason, 'owner_decision_required');
    const decisionCards = readJson(path.join(artifacts, 'bulletin', 'cards.json'));
    const ownerCard = decisionCards.find(card => card.id === timedOut.state.ownerDecisionRequest.cardId);
    assert(ownerCard && Handshake.isOwnerDecisionCard(ownerCard));
    ownerCard.payload.accessToken = ownerCard.decisionSecret;
    ownerCard.payload.callbackUrl = `http://127.0.0.1/decision?t=${ownerCard.decisionSecret}`;
    fs.writeFileSync(path.join(artifacts, 'bulletin', 'cards.json'), JSON.stringify(decisionCards, null, 2) + '\n');
    const Server = require('../server');
    decisionServer = http.createServer(Server.handler);
    await new Promise(resolve => decisionServer.listen(0, '127.0.0.1', resolve));
    const decisionPort = decisionServer.address().port;
    const listedBulletin = await httpGet(decisionPort, '/api/bulletin');
    assert.strictEqual(listedBulletin.status, 200);
    assert(!listedBulletin.body.includes(ownerCard.decisionSecret), 'bulletin API must not expose secret values');
    const listedOwnerCard = JSON.parse(listedBulletin.body).cards.find(card => card.id === ownerCard.id);
    assert(listedOwnerCard && listedOwnerCard.title === ownerCard.title, 'bulletin API must preserve non-sensitive card fields');
    assert(!Object.prototype.hasOwnProperty.call(listedOwnerCard, 'decisionSecret'), 'bulletin API must remove decisionSecret field');
    assert(!Object.prototype.hasOwnProperty.call(listedOwnerCard.payload, 'accessToken'), 'bulletin API must remove nested token fields');
    assert(listedOwnerCard.payload.callbackUrl.includes('[REDACTED]'), 'bulletin API must redact token query values');
    const cliList = spawnSync(process.execPath, [path.join(__dirname, '..', 'secretary-tools.js'), 'bulletin-list'], {
      cwd: path.join(__dirname, '..', '..', '..'),
      env: process.env,
      encoding: 'utf8',
    });
    assert.strictEqual(cliList.status, 0, cliList.stderr || 'bulletin-list failed');
    assert(!cliList.stdout.includes(ownerCard.decisionSecret), 'bulletin CLI must not expose secret values');
    const cliOwnerCard = JSON.parse(cliList.stdout).cards.find(card => card.id === ownerCard.id);
    assert(cliOwnerCard && !Object.prototype.hasOwnProperty.call(cliOwnerCard, 'decisionSecret'));
    assert(!Object.prototype.hasOwnProperty.call(cliOwnerCard.payload, 'accessToken'));
    const invalidDecision = await httpGet(decisionPort, `/api/decision/${ownerCard.id}/approve?t=invalid`);
    assert.strictEqual(invalidDecision.status, 403);
    const decisionToken = DecisionToken.sign(ownerCard.decisionSecret, ownerCard.id, 'approve');
    const approvedDecision = await httpGet(decisionPort, `/api/decision/${ownerCard.id}/approve?t=${decisionToken}`);
    assert.strictEqual(approvedDecision.status, 200);
    assert(approvedDecision.body.includes('已批准强制收口'));
    const decidedState = ttlManager.load('ttl-ticket');
    const decidedAuditCount = decidedState.audit.length;
    const ownerReceiptFile = ttlManager.ownerDecisionReceiptFile(decidedState.ownerDecision.receiptId);
    const ownerReceipt = readJson(ownerReceiptFile);
    assert.strictEqual(ownerReceipt.actor, 'owner');
    assert.strictEqual(ownerReceipt.verification, 'hmac-sha256-decision-card');
    assert(!readJson(path.join(artifacts, 'bulletin', 'cards.json')).some(card => card.id === ownerCard.id));
    const decisionActions = readJson(path.join(artifacts, 'bulletin', 'decision-actions.json'));
    assert.strictEqual(decisionActions[ownerCard.id].receiptId, ownerReceipt.receiptId);
    const repeatedDecision = await httpGet(decisionPort, `/api/decision/${ownerCard.id}/approve?t=${decisionToken}`);
    assert.strictEqual(repeatedDecision.status, 200);
    assert(repeatedDecision.body.includes('已处理过'));
    assert.strictEqual(ttlManager.load('ttl-ticket').audit.length, decidedAuditCount, 'repeat owner callback must not append audit');
    const eventRaw = fs.readFileSync(eventsFile, 'utf8');
    assert(!eventRaw.includes(ownerCard.decisionSecret));
    assert(!eventRaw.includes(decisionToken));
    const forcedActive = ttlManager.preflight({ ticketId: 'ttl-ticket' });
    assert.strictEqual(forcedActive.allowClose, false, 'owner force must not close while the running child is active');
    assert.strictEqual(forcedActive.blocked, true);
    assert.strictEqual(forcedActive.forced, true);
    assert.strictEqual(forcedActive.reason, 'owner_force_child_still_active');
    assert.strictEqual(forcedActive.state.ownerDecisionRequest.status, 'decided');
    assert.strictEqual(forcedActive.state.ownerDecision.receiptId, ownerReceipt.receiptId);
    const canceling = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'ttl-running');
    assert.strictEqual(canceling.cancel_requested, true, 'owner force must request process termination');
    assert(forcedActive.warning.includes('unconfirmed_child_warning:repair:ttl-running'));
    const activePendingAuditCount = ttlManager.load('ttl-ticket').audit.length;
    const forcedActiveRepeat = ttlManager.preflight({ ticketId: 'ttl-ticket' });
    assert.strictEqual(forcedActiveRepeat.reason, 'owner_force_child_still_active');
    assert.strictEqual(ttlManager.load('ttl-ticket').audit.length, activePendingAuditCount, 'repeat forced wait must not duplicate audit');
    Q.finish(artifacts, 'repair', 'ttl-running', 'done', { enginePid: 99999999 });
    const forced = ttlManager.preflight({ ticketId: 'ttl-ticket' });
    assert.strictEqual(forced.allowClose, true, 'forced close is permitted only after the child leaves active queue state');
    assert.strictEqual(forced.forced, true);
    assert(forced.warning.includes('unconfirmed_child_warning:repair:ttl-running'));
    const forcedClosed = ttlManager.markClosed({ ticketId: 'ttl-ticket', completionToken: forced.completionToken, forced: true, receipt: { report: null } });
    assert.strictEqual(forcedClosed.finalStatus, 'forced_closed_with_unconfirmed_warning');
    assert(!Q.list(artifacts, 'repair').running.some(entry => entry.id === 'ttl-running'));
    assert.strictEqual(ttlEvents.filter(event => event.type === 'repair.closeout.owner_decision_required').length, 1);
    assert.strictEqual(readEvents(eventsFile).filter(event => event.type === 'repair.closeout.owner_decision_recorded' && event.receiptId === ownerReceipt.receiptId).length, 1);
    assert.strictEqual(ttlEvents.filter(event => event.type === 'repair.closeout.owner_decided').length, 1);
    auditShapeComplete(forcedClosed);

    // 主人批准也不能绕过 queued 取消未落终态、queued→running 或重复强制调用。
    clock = 20_000;
    Q.enqueue(artifacts, 'repair', childTask('force-queued-race'), { id: 'force-queued-race-child' });
    const originalCancelForForcedQueue = Q.cancel;
    let forcedQueueCancelCalls = 0;
    Q.cancel = function cancelWithoutTerminal(rootArg, agent, queueId) {
      if (queueId === 'force-queued-race-child') {
        forcedQueueCancelCalls += 1;
        return null;
      }
      return originalCancelForForcedQueue(rootArg, agent, queueId);
    };
    try {
      assert.strictEqual(ttlManager.preflight({ ticketId: 'force-queued-race' }).reason, 'closing_pending_child');
      clock = 21_001;
      const queuedTimedOut = ttlManager.preflight({ ticketId: 'force-queued-race' });
      assert.strictEqual(queuedTimedOut.reason, 'owner_decision_required');
      const queuedCards = readJson(path.join(artifacts, 'bulletin', 'cards.json'));
      const queuedOwnerCard = queuedCards.find(card => card.id === queuedTimedOut.state.ownerDecisionRequest.cardId);
      assert(queuedOwnerCard && queuedOwnerCard.decisionSecret);
      const queuedDecisionToken = DecisionToken.sign(queuedOwnerCard.decisionSecret, queuedOwnerCard.id, 'approve');
      const queuedApproved = await httpGet(decisionPort, `/api/decision/${queuedOwnerCard.id}/approve?t=${queuedDecisionToken}`);
      assert.strictEqual(queuedApproved.status, 200);

      const queuedStillActive = ttlManager.preflight({ ticketId: 'force-queued-race' });
      assert.strictEqual(queuedStillActive.reason, 'owner_force_child_still_active');
      assert(Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'force-queued-race-child'));
      assert(queuedStillActive.warning.includes('unconfirmed_child_warning:repair:force-queued-race-child'));
      const forcedQueuedAuditCount = ttlManager.load('force-queued-race').audit.length;
      const queuedStillActiveRepeat = ttlManager.preflight({ ticketId: 'force-queued-race' });
      assert.strictEqual(queuedStillActiveRepeat.reason, 'owner_force_child_still_active');
      assert.strictEqual(ttlManager.load('force-queued-race').audit.length, forcedQueuedAuditCount, 'repeat uncancelable queued force must not duplicate audit');

      Q.claim(artifacts, 'repair', { match(entry) { return entry.id === 'force-queued-race-child'; } });
      const claimedStillActive = ttlManager.preflight({ ticketId: 'force-queued-race' });
      assert.strictEqual(claimedStillActive.reason, 'owner_force_child_still_active');
      const claimedForcedChild = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'force-queued-race-child');
      assert(claimedForcedChild && claimedForcedChild.steer.length === 1, 'queued→running force race must receive one mandatory steer');
      const steerCount = claimedForcedChild.steer.length;
      ttlManager.preflight({ ticketId: 'force-queued-race' });
      assert.strictEqual(Q.list(artifacts, 'repair').running.find(entry => entry.id === 'force-queued-race-child').steer.length, steerCount, 'repeat forced call must not duplicate steer');
    } finally {
      Q.cancel = originalCancelForForcedQueue;
    }
    const cancelRequestedButActive = ttlManager.preflight({ ticketId: 'force-queued-race' });
    assert.strictEqual(cancelRequestedButActive.reason, 'owner_force_child_still_active');
    assert.strictEqual(Q.list(artifacts, 'repair').running.find(entry => entry.id === 'force-queued-race-child').cancel_requested, true);
    Q.finish(artifacts, 'repair', 'force-queued-race-child', 'done', { enginePid: 99999999 });
    const forcedQueuedPermit = ttlManager.preflight({ ticketId: 'force-queued-race' });
    assert.strictEqual(forcedQueuedPermit.allowClose, true);
    assert.strictEqual(forcedQueuedPermit.forced, true);
    const forcedQueuedClosed = ttlManager.markClosed({
      ticketId: 'force-queued-race',
      completionToken: forcedQueuedPermit.completionToken,
      receipt: { report: null },
    });
    assert.strictEqual(forcedQueuedClosed.status, 'forced_closed');
    assert(!Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'force-queued-race-child'));
    assert(!Q.list(artifacts, 'repair').running.some(entry => entry.id === 'force-queued-race-child'));
    const forcedQueuedRepeat = ttlManager.preflight({ ticketId: 'force-queued-race' });
    assert.strictEqual(forcedQueuedRepeat.alreadyClosed, true);
    assert(forcedQueueCancelCalls >= 1, 'forced queued cancellation failure fixture must be exercised');

    // 并发/重入结案用 completion lease 串行化，不会重复进入报告、通知或占槽副作用。
    const leaseManager = Handshake.createManager({
      queueRoot: artifacts,
      workdir: root,
      stateDir: path.join(artifacts, 'lease-handshakes'),
      enabled: true,
      now: () => clock,
    });
    const leaseFirst = leaseManager.preflight({ ticketId: 'lease-ticket' });
    assert.strictEqual(leaseFirst.allowClose, true);
    const leaseRepeat = leaseManager.preflight({ ticketId: 'lease-ticket' });
    assert.strictEqual(leaseRepeat.blocked, true);
    assert.strictEqual(leaseRepeat.reason, 'closing_in_progress');
    leaseManager.releaseCompletion({ ticketId: 'lease-ticket', completionToken: leaseFirst.completionToken });
    const leaseRetry = leaseManager.preflight({ ticketId: 'lease-ticket' });
    assert.strictEqual(leaseRetry.allowClose, true);
    leaseManager.markClosed({ ticketId: 'lease-ticket', completionToken: leaseRetry.completionToken, receipt: { report: null } });

    // completion lease 期间绕过正式入队入口的 late queued 项，markClosed 最终复扫仍必须取消并审计后才结案。
    const lateManager = Handshake.createManager({
      queueRoot: artifacts,
      workdir: root,
      enabled: true,
      now: () => clock,
    });
    const lateLease = lateManager.preflight({ ticketId: 'late-ticket', sourceIncidentId: 'late-incident' });
    assert.strictEqual(lateLease.allowClose, true);
    Q.enqueue(artifacts, 'repair', childTask('late-ticket', { sourceIncidentId: 'late-incident' }), { id: 'late-before-mark' });
    const lateClosed = lateManager.markClosed({
      ticketId: 'late-ticket',
      completionToken: lateLease.completionToken,
      receipt: { report: null },
    });
    assert.strictEqual(lateClosed.status, 'closed');
    assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'late-before-mark.json')));
    const finalRescanAudit = lateClosed.audit.find(row => row.childId === 'repair:late-before-mark');
    assert(finalRescanAudit && finalRescanAudit.originalStatus === 'queued' && finalRescanAudit.disposition === 'late_queued_canceled');

    // closed 状态不得直接 alreadyClosed 跳过 late child：旁路写入由重试复扫取消，正式入队则被 durable fence 拒绝。
    Q.enqueue(artifacts, 'repair', childTask('legacy-late-ticket', { sourceIncidentId: 'late-incident' }), { id: 'late-after-closed-raw' });
    const reconciledClosed = lateManager.preflight({ ticketId: 'late-ticket' });
    assert.strictEqual(reconciledClosed.alreadyClosed, true);
    assert.deepStrictEqual(reconciledClosed.lateChildrenHandled, [
      { queueAgent: 'repair', queueId: 'late-after-closed-raw', originalStatus: 'queued' },
    ]);
    assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'late-after-closed-raw.json')));
    const auditAfterClosedReconcile = reconciledClosed.state.audit.length;
    const closedRepeat = lateManager.preflight({ ticketId: 'late-ticket' });
    assert.strictEqual(closedRepeat.alreadyClosed, true);
    assert.strictEqual(closedRepeat.lateChildrenHandled.length, 0);
    assert.strictEqual(lateManager.load('late-ticket').audit.length, auditAfterClosedReconcile, 'closed repeat must not duplicate reconciliation audit');
    Q.enqueue(artifacts, 'repair', childTask('late-ticket', { sourceIncidentId: 'late-incident' }), { id: 'late-after-closed-raw' });
    const reincarnatedClosed = lateManager.preflight({ ticketId: 'late-ticket' });
    assert.strictEqual(reincarnatedClosed.lateChildrenHandled.length, 1, 'same queue id re-enqueue must be canceled as a new incarnation');
    const auditAfterReincarnation = lateManager.load('late-ticket').audit.length;
    assert(auditAfterReincarnation > auditAfterClosedReconcile, 'same-id new incarnation must leave a distinct audit row');
    lateManager.preflight({ ticketId: 'late-ticket' });
    assert.strictEqual(lateManager.load('late-ticket').audit.length, auditAfterReincarnation, 'repeated closed scan without a new child must stay idempotent');

    let fencedError = null;
    try {
      QueueAutoMerge.enqueue(artifacts, 'repair', childTask('late-ticket', { sourceIncidentId: 'late-incident' }), {
        id: 'late-fenced',
        autoMerge: false,
      });
    } catch (error) {
      fencedError = error;
    }
    assert(fencedError && fencedError.code === 'REPAIR_CLOSEOUT_ENQUEUE_FENCED');
    assert(!Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'late-fenced'));
    assert(!fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'late-fenced.json')));
    const fencedState = lateManager.load('late-ticket');
    const fencedRow = fencedState.audit.find(row => row.childId === 'repair:late-fenced');
    assert(fencedRow && fencedRow.originalStatus === 'not_enqueued' && fencedRow.disposition === 'durable_closeout_fence_rejected_enqueue');
    assert(fencedRow.confirmation && fencedRow.confirmation.proof === 'queue_entry_not_created');
    const auditAfterFence = fencedState.audit.length;
    assert.throws(() => QueueAutoMerge.enqueue(artifacts, 'repair', childTask('late-ticket', { sourceIncidentId: 'late-incident' }), {
      id: 'late-fenced',
      autoMerge: false,
    }), error => error && error.code === 'REPAIR_CLOSEOUT_ENQUEUE_FENCED');
    assert.strictEqual(lateManager.load('late-ticket').audit.length, auditAfterFence, 'repeat fenced enqueue must not duplicate audit');
    const apiFenced = await httpPost(decisionPort, '/api/ceo/queue-control', {
      action: 'enqueue',
      agent: 'repair',
      id: 'late-api-fenced',
      task: childTask('late-ticket', { sourceIncidentId: 'late-incident' }),
      requestedBy: 'repair-closeout-test',
    });
    assert.strictEqual(apiFenced.status, 409);
    assert.strictEqual(JSON.parse(apiFenced.body).code, 'REPAIR_CLOSEOUT_ENQUEUE_FENCED');
    assert(!Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'late-api-fenced'));
    const unrelatedLate = QueueAutoMerge.enqueue(artifacts, 'repair', childTask('late-unrelated-ticket', { sourceIncidentId: 'different-late-incident' }), {
      id: 'late-unrelated',
      autoMerge: false,
    });
    assert.strictEqual(unrelatedLate.status, 'queued');
    auditShapeComplete(lateManager.load('late-ticket'));

    // 报告提交期间出现 late queued/running 时，必须在 ticket/event 等结案副作用前阻断；确认重试后各副作用仅一次。
    const postPermitTicket = Tools.repairTicketAdd({ id: 'post-permit-ticket', title: 'post permit child', bulletin: 'false' });
    const originalCommitReport = RepairReport.commitPreparedRepairReport;
    let injectedPostPermit = false;
    RepairReport.commitPreparedRepairReport = function commitWithPostPermitChildren(report) {
      const committed = originalCommitReport(report);
      if (!injectedPostPermit) {
        injectedPostPermit = true;
        Q.enqueue(artifacts, 'repair', childTask('post-permit-ticket'), { id: 'post-permit-running' });
        Q.enqueue(artifacts, 'repair', childTask('post-permit-ticket'), { id: 'post-permit-queued' });
        Q.claim(artifacts, 'repair', { match(entry) { return entry.id === 'post-permit-running'; } });
      }
      return committed;
    };
    let postPermitError = null;
    try {
      Tools.repairTicketComplete({
        id: 'post-permit-ticket',
        result: '严重度: high; 根因: post permit; 处理: fenced outbox; 验证: deterministic; 架构判断: transaction',
        notify: 'false',
      });
    } catch (error) {
      postPermitError = error;
    } finally {
      RepairReport.commitPreparedRepairReport = originalCommitReport;
    }
    assert(postPermitError && postPermitError.code === 'REPAIR_CLOSEOUT_LATE_CHILD');
    assert.strictEqual(ticketStatus(path.join(root, postPermitTicket.ticket.file)), 'closing_pending_child');
    const postPermitEventsBeforeRetry = readEvents(eventsFile).filter(event => event.ticketId === 'post-permit-ticket');
    assert.strictEqual(postPermitEventsBeforeRetry.filter(event => event.type === 'repair.report.generated').length, 0);
    assert.strictEqual(postPermitEventsBeforeRetry.filter(event => event.type === 'repair.ticket.completed').length, 0);
    const postPermitRunning = Q.list(artifacts, 'repair').running.find(entry => entry.id === 'post-permit-running');
    assert(postPermitRunning && postPermitRunning.steer.length === 1);
    assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', 'post-permit-queued.json')));
    const postPermitStateFile = path.join(artifacts, 'repair-closeout-handshakes', 'post-permit-ticket.json');
    const postPermitBlockedState = readJson(postPermitStateFile);
    assert.strictEqual(postPermitBlockedState.status, 'closing_pending_child');
    assert.strictEqual(postPermitBlockedState.completionOutbox.steps.report_files.status, 'committed');
    assert(postPermitBlockedState.children['repair:post-permit-running']);
    assert(postPermitBlockedState.children['repair:post-permit-queued']);
    Q.finish(artifacts, 'repair', 'post-permit-running', 'done', { enginePid: 99999999 });
    Tools.repairTicketChildConfirm({
      id: 'post-permit-ticket', agent: 'repair', queueId: 'post-permit-running', mode: 'read-only-no-op-confirmed',
    });
    const postPermitRetry = Tools.repairTicketComplete({
      id: 'post-permit-ticket',
      result: '严重度: high; 根因: post permit; 处理: fenced outbox; 验证: deterministic; 架构判断: transaction',
      notify: 'false',
    });
    assert.strictEqual(postPermitRetry.handshake.status, 'closed');
    const postPermitEventsAfterRetry = readEvents(eventsFile).filter(event => event.ticketId === 'post-permit-ticket');
    assert.strictEqual(postPermitEventsAfterRetry.filter(event => event.type === 'repair.report.generated').length, 1);
    assert.strictEqual(postPermitEventsAfterRetry.filter(event => event.type === 'repair.ticket.completed').length, 1);

    // 所有公开结案步骤先 durable stage；任一步骤后的 late queued/running 都必须在零公开完成副作用时阻断。
    const publicStageSteps = [
      'report_event', 'ticket_done', 'completed_event', 'bulletins_removed',
      'memory_review', 'owner_notify', 'yuanxiao_delivery',
    ];
    const createManagerBeforeStageRace = Handshake.createManager;
    for (const stepKey of publicStageSteps) {
      const ticketId = `stage-race-${stepKey.replace(/_/g, '-')}`;
      const created = Tools.repairTicketAdd({ id: ticketId, title: `stage race ${stepKey}`, bulletin: 'true' });
      let injected = false;
      Handshake.createManager = function createStageRaceManager(options) {
        return createManagerBeforeStageRace(Object.assign({}, options, {
          afterStep(info) {
            if (injected || info.ticketId !== ticketId || info.key !== stepKey || info.phase !== 'staged') return;
            injected = true;
            Q.enqueue(artifacts, 'repair', childTask(ticketId), { id: `${ticketId}-running` });
            Q.enqueue(artifacts, 'repair', childTask(ticketId), { id: `${ticketId}-queued` });
            Q.claim(artifacts, 'repair', { match(entry) { return entry.id === `${ticketId}-running`; } });
          },
        }));
      };
      let stageRaceError = null;
      try {
        Tools.repairTicketComplete({
          id: ticketId,
          result: `严重度: high; 根因: late after ${stepKey}; 处理: stage barrier; 验证: zero public effects; 架构判断: fenced`,
          notify: 'false',
        });
      } catch (error) {
        stageRaceError = error;
      } finally {
        Handshake.createManager = createManagerBeforeStageRace;
      }
      assert(injected, `${stepKey} stage-race fixture must inject late children`);
      assert(stageRaceError && stageRaceError.code === 'REPAIR_CLOSEOUT_LATE_CHILD', `${stepKey} late child must block closeout`);
      assert.strictEqual(ticketStatus(path.join(root, created.ticket.file)), 'closing_pending_child', `${stepKey} ticket must not be done`);
      const stageRaceEvents = readEvents(eventsFile).filter(event => event.ticketId === ticketId);
      assert.strictEqual(stageRaceEvents.filter(event => event.type === 'repair.report.generated').length, 0, `${stepKey} report event must stay zero`);
      assert.strictEqual(stageRaceEvents.filter(event => event.type === 'repair.ticket.completed').length, 0, `${stepKey} completed event must stay zero`);
      assert.strictEqual(stageRaceEvents.filter(event => /^repair\.ticket\.notify_/.test(event.type)).length, 0, `${stepKey} owner notify event must stay zero`);
      assert.strictEqual(stageRaceEvents.filter(event => /^repair\.report\.yuanxiao_/.test(event.type)).length, 0, `${stepKey} yuanxiao event must stay zero`);
      const stageRaceState = readJson(path.join(artifacts, 'repair-closeout-handshakes', `${ticketId}.json`));
      assert.strictEqual(stageRaceState.status, 'closing_pending_child');
      assert.strictEqual(stageRaceState.completionOutbox.steps[stepKey].status, 'staged', `${stepKey} must be staged, not committed`);
      const stageRunning = Q.list(artifacts, 'repair').running.find(entry => entry.id === `${ticketId}-running`);
      assert(stageRunning && stageRunning.steer.length === 1, `${stepKey} running child must receive one steer`);
      assert(fs.existsSync(path.join(Q.qdir(artifacts, 'repair'), 'canceled', `${ticketId}-queued.json`)), `${stepKey} queued child must be canceled`);
      const bulletinCardsAfterBlock = readJson(path.join(artifacts, 'bulletin', 'cards.json'));
      assert(bulletinCardsAfterBlock.some(card => card && card.id === `repair-${ticketId}`), `${stepKey} bulletin must not be removed before eligibility`);
    }
    Handshake.createManager = createManagerBeforeStageRace;

    // 事件已 append 后抛错：首轮不得假 done/closed，重试从 durable receipt 恢复且不重复事件。
    const partialTicket = Tools.repairTicketAdd({ id: 'partial-event-ticket', title: 'partial event failure', bulletin: 'false' });
    const originalEmit = EventLog.prototype.emit;
    let injectedEventFailure = false;
    EventLog.prototype.emit = function emitThenFail(type, payload) {
      const emitted = originalEmit.call(this, type, payload);
      if (!injectedEventFailure && type === 'repair.report.generated' && payload && payload.ticketId === 'partial-event-ticket') {
        injectedEventFailure = true;
        throw new Error('injected failure after report event append');
      }
      return emitted;
    };
    let partialError = null;
    try {
      Tools.repairTicketComplete({
        id: 'partial-event-ticket',
        result: '严重度: high; 根因: partial event; 处理: recover receipt; 验证: deterministic; 架构判断: outbox',
        notify: 'false',
      });
    } catch (error) {
      partialError = error;
    } finally {
      EventLog.prototype.emit = originalEmit;
    }
    assert(partialError);
    assert.strictEqual(ticketStatus(path.join(root, partialTicket.ticket.file)), 'closing_pending_commit');
    const partialStateAfterFailure = readJson(path.join(artifacts, 'repair-closeout-handshakes', 'partial-event-ticket.json'));
    assert.notStrictEqual(partialStateAfterFailure.status, 'closed');
    assert.strictEqual(partialStateAfterFailure.completionOutbox.steps.report_event.status, 'started');
    assert.strictEqual(readEvents(eventsFile).filter(event => event.ticketId === 'partial-event-ticket' && event.type === 'repair.report.generated').length, 1);
    assert.strictEqual(readEvents(eventsFile).filter(event => event.ticketId === 'partial-event-ticket' && event.type === 'repair.ticket.completed').length, 0);
    const partialRetry = Tools.repairTicketComplete({
      id: 'partial-event-ticket',
      result: '严重度: high; 根因: partial event; 处理: recover receipt; 验证: deterministic; 架构判断: outbox',
      notify: 'false',
    });
    assert.strictEqual(partialRetry.handshake.status, 'closed');
    const partialFinalState = readJson(path.join(artifacts, 'repair-closeout-handshakes', 'partial-event-ticket.json'));
    assert.strictEqual(partialFinalState.completionOutbox.steps.report_event.recovered, true);
    assert.strictEqual(readEvents(eventsFile).filter(event => event.ticketId === 'partial-event-ticket' && event.type === 'repair.report.generated').length, 1);
    assert.strictEqual(readEvents(eventsFile).filter(event => event.ticketId === 'partial-event-ticket' && event.type === 'repair.ticket.completed').length, 1);

    // 每个 outbox 边界故障后顶层工单不得保持 done；重试按 step receipt 跳过已提交副作用。
    const failpointSteps = [
      'report_files', 'report_event', 'ticket_done', 'completed_event',
      'bulletins_removed', 'memory_review', 'owner_notify', 'yuanxiao_delivery',
    ];
    const originalCreateManager = Handshake.createManager;
    for (const stepKey of failpointSteps) {
      const ticketId = `failpoint-${stepKey.replace(/_/g, '-')}`;
      const created = Tools.repairTicketAdd({ id: ticketId, title: `failpoint ${stepKey}`, bulletin: 'false' });
      let fired = false;
      Handshake.createManager = function createFailpointManager(options) {
        return originalCreateManager(Object.assign({}, options, {
          afterCommit(info) {
            if (!fired && info.ticketId === ticketId && info.key === stepKey) {
              fired = true;
              throw new Error(`injected after ${stepKey}`);
            }
          },
        }));
      };
      let failpointError = null;
      try {
        Tools.repairTicketComplete({
          id: ticketId,
          result: `严重度: medium; 根因: ${stepKey}; 处理: receipt retry; 验证: failpoint; 架构判断: outbox`,
          notify: 'false',
        });
      } catch (error) {
        failpointError = error;
      } finally {
        Handshake.createManager = originalCreateManager;
      }
      assert(failpointError && fired, `${stepKey} failpoint must fire`);
      assert.strictEqual(ticketStatus(path.join(root, created.ticket.file)), 'closing_pending_commit');
      const failedStateFile = path.join(artifacts, 'repair-closeout-handshakes', `${ticketId}.json`);
      const failedState = readJson(failedStateFile);
      assert.notStrictEqual(failedState.status, 'closed');
      assert.strictEqual(failedState.completionOutbox.steps[stepKey].status, 'committed');
      const retried = Tools.repairTicketComplete({
        id: ticketId,
        result: `严重度: medium; 根因: ${stepKey}; 处理: receipt retry; 验证: failpoint; 架构判断: outbox`,
        notify: 'false',
      });
      assert.strictEqual(retried.handshake.status, 'closed');
      const ticketEvents = readEvents(eventsFile).filter(event => event.ticketId === ticketId);
      assert.strictEqual(ticketEvents.filter(event => event.type === 'repair.report.generated').length, 1, `${stepKey} report event exactly once`);
      assert.strictEqual(ticketEvents.filter(event => event.type === 'repair.ticket.completed').length, 1, `${stepKey} completed event exactly once`);
    }
    Handshake.createManager = originalCreateManager;

    // 6) 回滚开关:默认/显式关闭时不读写握手状态,不取消、不 steer。
    Q.enqueue(artifacts, 'repair', childTask('rollback-ticket'), { id: 'rollback-queued' });
    const disabledStateDir = path.join(artifacts, 'disabled-handshakes');
    const disabled = Handshake.createManager({ queueRoot: artifacts, stateDir: disabledStateDir, enabled: false });
    const rolledBack = disabled.preflight({ ticketId: 'rollback-ticket' });
    assert.strictEqual(rolledBack.enabled, false);
    assert.strictEqual(rolledBack.allowClose, true);
    assert(Q.list(artifacts, 'repair').queued.some(entry => entry.id === 'rollback-queued'));
    assert(!fs.existsSync(disabledStateDir));

    const runningFinal = readJson(runningStateFile);
    auditShapeComplete(runningFinal);
    const auditTypes = new Set(runningFinal.audit.map(row => row.type));
    assert(auditTypes.has('repair.closeout.child_disposed'));
    assert(auditTypes.has('repair.closeout.child_confirmed'));
    assert(auditTypes.has('repair.closeout.closed'));
    console.log(JSON.stringify({
      pass: true,
      suite: 'repair-closeout-handshake',
      cases: ['no-child', 'queued', 'queued-claim-race', 'running', 'missing-pid-fail-closed', 'confirmed', 'persisted-source-incident', 'ttl-signed-owner-receipt', 'forced-active-terminal-gate', 'forced-queued-cancel-failure-and-claim-race', 'bulletin-api-cli-secret-redaction', 'repeat-idempotency', 'completion-lease', 'preflight-late-enqueue-final-rescan', 'closed-late-reconcile', 'durable-enqueue-fence', 'unrelated-isolation', 'post-permit-late-running-zero-close-events', 'seven-public-step-stage-races', 'partial-event-recovery-exactly-once', 'eight-side-effect-failpoints', 'rollback-disabled'],
    }));
  } finally {
    if (decisionServer) await new Promise(resolve => decisionServer.close(resolve));
    delete process.env.REPAIR_CLOSEOUT_HANDSHAKE_ENABLED;
    delete process.env.REPAIR_CLOSEOUT_HANDSHAKE_TTL_MS;
    delete process.env.CONSOLE_WORKDIR;
    delete process.env.CONSOLE_ARTIFACTS_DIR;
    delete process.env.CONSOLE_EVENTS_FILE;
    delete process.env.QUEUE_WORKER_DISABLED;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
