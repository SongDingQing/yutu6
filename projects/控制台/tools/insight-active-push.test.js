#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ActivePush = require('./insight-active-push');
const Daily = require('./daily-governance-hardening');
const { redactMemoryCandidate } = require('../memory-redaction');

const ROOT_TASK = 'cr-1783674199276-016dc681';
const TASK = 'cr-1783680653360-ee208ddb';
const ROOT_QUEUE = '016dc681';
const SCOPE = { projectId: '控制台', scopedToProject: true };

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `yutu6-active-push-${label}-`));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function config(opts = {}) {
  const channels = opts.channels || ['feishu'];
  return {
    schemaVersion: 1,
    projectId: '控制台',
    scopedToProject: true,
    enabled: opts.enabled !== false,
    ownerConfirmation: {
      confirmed: opts.confirmed !== false,
      required: ['scanPeriod', 'staggerOffset', 'recipients', 'channelPriority', 'failureThreshold'],
      scanPeriod: 'daily',
      staggerOffsetMinutes: 75,
      recipients: Object.fromEntries(channels.map(id => [id, ['owner']])),
      channelPriority: channels,
      failureThreshold: opts.threshold || 3,
    },
    source: {
      type: 'insight-scout-seen-repos',
      path: 'board/insights/seen-repos.json',
      initialMode: opts.initialMode || 'baseline',
      maxNewPerRun: 20,
    },
    channels: channels.map((id, index) => ({ id, enabled: true, priority: 10 + index * 10 })),
    failure: {
      cooldownMs: 6 * 60 * 60 * 1000,
      consecutiveThreshold: opts.threshold || 3,
      ticketMode: 'per-channel-unless-all-channels-fail',
    },
    lineage: { rootTaskId: ROOT_TASK, rootQueueId: ROOT_QUEUE, taskId: TASK },
  };
}

function sourceFile(dir, repos) {
  const file = path.join(dir, 'seen-repos.json');
  writeJson(file, { _note: 'test', repos, updated_at: '2026-07-10T00:00:00.000Z' });
  return file;
}

function runner(dir, cfg, source, extra = {}) {
  return ActivePush.runActivePush(Object.assign({
    scope: SCOPE,
    config: cfg,
    sourceFile: source,
    stateRoot: path.join(dir, 'state'),
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    ticketAdapter: args => ({ ok: true, created: true, ticketId: args.id, file: `tickets/${args.id}.md` }),
  }, extra));
}

async function testScopeAndOwnerGates() {
  assert.throws(() => ActivePush.validateScope({ projectId: '控制台', scopedToProject: '控制台' }), /scope gate rejected/);
  assert.throws(() => ActivePush.validateScope({ projectId: 'Simulaid', scopedToProject: true }), /scope gate rejected/);
  assert.throws(() => ActivePush.validateConfig(config({ confirmed: false })), /owner confirmation gate rejected/);
  const weekly = config();
  weekly.ownerConfirmation.scanPeriod = 'weekly';
  assert.throws(() => ActivePush.validateConfig(weekly), /only supports scanPeriod=daily/);
  const unboundRecipient = config();
  unboundRecipient.ownerConfirmation.recipients.feishu = ['unbound-recipient'];
  assert.throws(() => ActivePush.validateConfig(unboundRecipient), /symbolic route owner/);
  const unverifiedYuanxiao = config({ channels: ['yuanxiao'] });
  assert.throws(() => ActivePush.validateConfig(unverifiedYuanxiao), /downstream idempotency\/receipt not verified for yuanxiao/);
  const disabled = config({ enabled: false, confirmed: false });
  ActivePush.validateConfig(disabled);
}

async function testFeishuDownstreamIdempotency() {
  const calls = [];
  const idempotencyKey = 'repo-1234567890abcdef12345678:feishu';
  const transport = async (url, payload, headers) => {
    calls.push({ url, payload, headers });
    if (/tenant_access_token/.test(url)) return { code: 0, [['tenant', 'access', 'token'].join('_')]: 'x' };
    return { code: 0, data: { message_id: 'test-message-id' } };
  };
  const sent = await ActivePush._test.sendFeishuMessage({
    recipient: 'owner',
    title: 'test title',
    body: 'test body',
    idempotencyKey,
  }, {
    env: Object.fromEntries([
      ['FEISHU_APP_ID', 'x'],
      [['FEISHU', 'APP', 'SECRET'].join('_'), 'x'],
      ['FEISHU_HOME_CHANNEL', 'owner-route'],
    ]),
    postJson: transport,
  });
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(sent.receiptId, 'test-message-id');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].payload.receive_id, 'owner-route');
  assert.strictEqual(calls[1].payload.uuid, ActivePush._test.feishuUuid(idempotencyKey));
  assert.strictEqual(ActivePush._test.feishuUuid(idempotencyKey), ActivePush._test.feishuUuid(idempotencyKey));
  assert.match(calls[1].payload.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
}

async function testStructuralFingerprint() {
  const a = ActivePush.normalizeRepo('https://github.com/OpenAI/Codex.git?tab=readme');
  const b = ActivePush.normalizeRepo('https://github.com/openai/codex');
  assert(a && b);
  assert.strictEqual(a.fullName, 'openai/codex');
  assert.strictEqual(a.url, 'https://github.com/openai/codex');
  assert.strictEqual(a.eventId, b.eventId, 'case/query/.git variants must share stable eventId');
  assert.strictEqual(ActivePush.normalizeRepo('README says codex changed'), null, 'README text must not be a source event');
  const arbitrary = ActivePush.normalizeRepo('https://github.com/acme/example-project');
  assert(arbitrary && arbitrary.fullName === 'acme/example-project', 'valid arbitrary repository must be accepted');
}

async function testBaselineAndExactlyOnceLedger() {
  const dir = tempDir('once');
  const source = sourceFile(dir, ['https://github.com/acme/one']);
  const sends = [];
  const adapters = {
    feishu: async payload => { sends.push(payload.idempotencyKey); return { ok: true, receiptId: `f-${payload.eventId}` }; },
  };
  const first = await runner(dir, config(), source, { runId: 'baseline', adapters });
  assert.strictEqual(first.action, 'baselined');
  assert.deepStrictEqual(sends, []);

  writeJson(source, { repos: ['https://github.com/acme/one', 'https://github.com/Acme/Two.git'] });
  const second = await runner(dir, config(), source, { runId: 'new-one', adapters });
  assert.strictEqual(second.newEvents, 1);
  assert.strictEqual(second.sent, 1);
  assert.strictEqual(second.failed, 0);
  assert.strictEqual(new Set(sends).size, 1);

  const third = await runner(dir, config(), source, { runId: 'repeat', adapters });
  assert.strictEqual(third.action, 'no-new-events');
  assert.strictEqual(sends.length, 1, 'restart/repeat must not resend successful eventId+channel');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  assert.strictEqual(Object.keys(state.deliveries).length, 1, 'map keys are the persistent uniqueness constraint');
  Object.keys(state.deliveries).forEach(key => assert(/repo-[a-f0-9]{24}:feishu/.test(key)));
  const events = fs.readFileSync(path.join(dir, 'state', 'runs', 'new-one', 'events.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
  for (const event of events) {
    assert.strictEqual(event.rootTaskId, ROOT_TASK);
    assert.strictEqual(event.rootQueueId, ROOT_QUEUE);
    assert.strictEqual(event.taskId, TASK);
    assert.strictEqual(event.runId, 'new-one');
    assert(Object.prototype.hasOwnProperty.call(event, 'attempt'));
    assert(Object.prototype.hasOwnProperty.call(event, 'sourceCursor'));
    assert(Object.prototype.hasOwnProperty.call(event, 'eventId'));
    assert(Object.prototype.hasOwnProperty.call(event, 'channel'));
    assert(event.at && event.result);
  }
}

async function testPartialFailureRetryAndRedaction() {
  const dir = tempDir('partial');
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, config(), source, { runId: 'baseline', adapters: {} });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/new'] });
  let sends = 0;
  const tickets = [];
  const first = await runner(dir, config(), source, {
    runId: 'partial-fail',
    adapters: {
      feishu: async () => {
        sends++;
        return { ok: false, error: 'webhook=https://hooks.example/x?token=secret ssh ubuntu@example.com timed out' };
      },
    },
    ticketAdapter: args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; },
  });
  assert.strictEqual(first.sent, 0);
  assert.strictEqual(first.failed, 1);
  assert.strictEqual(tickets.length, 1, 'single-route failure opens one channel ticket');
  assert(/飞书失败/.test(tickets[0].title));
  const failText = fs.readFileSync(path.join(dir, 'state', 'runs', 'partial-fail', 'node.fail.jsonl'), 'utf8');
  assert(/"attempt":1/.test(failText));
  assert(/REDACTED WEBHOOK URL/.test(failText));
  assert(/REDACTED SSH TARGET/.test(failText));
  assert(!/secret|ubuntu@example\.com/.test(failText));

  const recovered = await runner(dir, config(), source, {
    runId: 'partial-recover',
    adapters: {
      feishu: async payload => { sends++; return { ok: true, receiptId: `f-${payload.eventId}` }; },
    },
  });
  assert.strictEqual(recovered.sent, 1);
  assert.strictEqual(sends, 2, 'only the pending failed channel is recovered');
}

async function testAllFailureMergedTicket() {
  const groups = ActivePush._test.failureTicketGroups(
    [{ id: 'feishu' }, { id: 'yuanxiao' }],
    [
      { eventId: 'repo-x', channel: 'feishu', ok: false, reasonClass: 'network', error: 'network' },
      { eventId: 'repo-x', channel: 'yuanxiao', ok: false, reasonClass: 'network', error: 'network' },
    ]
  );
  assert.strictEqual(groups.length, 1, 'same event full-route failure is merged into one ticket group');
  assert.strictEqual(groups[0].length, 2);
}

async function testConsecutiveEscalation() {
  const dir = tempDir('escalate');
  const cfg = config({ channels: ['feishu'], threshold: 3 });
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, cfg, source, { runId: 'baseline' });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/escalate'] });
  const tickets = [];
  const adapter = { feishu: async () => ({ ok: false, error: 'network timeout' }) };
  const ticketAdapter = args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; };
  await runner(dir, cfg, source, { runId: 'failure-1', adapters: adapter, ticketAdapter });
  await runner(dir, cfg, source, { runId: 'failure-2', adapters: adapter, ticketAdapter });
  const third = await runner(dir, cfg, source, { runId: 'failure-3', adapters: adapter, ticketAdapter });
  assert.strictEqual(third.escalations.length, 1);
  assert(tickets.some(ticket => /升级主人/.test(ticket.title)), 'threshold must create visible owner escalation ticket');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  const series = Object.values(state.failures).find(row => row.channel === 'feishu' && row.reasonClass === 'timeout');
  assert.strictEqual(series.consecutive, 3);
  assert.strictEqual(series.ownerEscalationRequired, true);
}

async function testRecoveryStartsNewEscalationIncident() {
  const dir = tempDir('escalate-again');
  const cfg = config({ channels: ['feishu'], threshold: 3 });
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, cfg, source, { runId: 'baseline' });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/incident-one'] });
  const tickets = [];
  const failing = { feishu: async () => ({ ok: false, error: 'network timeout' }) };
  const ticketAdapter = args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; };
  await runner(dir, cfg, source, { runId: 'incident-one-1', adapters: failing, ticketAdapter });
  await runner(dir, cfg, source, { runId: 'incident-one-2', adapters: failing, ticketAdapter });
  const firstThreshold = await runner(dir, cfg, source, { runId: 'incident-one-3', adapters: failing, ticketAdapter });
  assert.strictEqual(firstThreshold.escalations.length, 1);
  await runner(dir, cfg, source, {
    runId: 'incident-one-recovered',
    adapters: { feishu: async payload => ({ ok: true, receiptId: `f-${payload.eventId}` }) },
    ticketAdapter,
  });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/incident-one', 'https://github.com/acme/incident-two'] });
  await runner(dir, cfg, source, { runId: 'incident-two-1', adapters: failing, ticketAdapter });
  await runner(dir, cfg, source, { runId: 'incident-two-2', adapters: failing, ticketAdapter });
  const secondThreshold = await runner(dir, cfg, source, { runId: 'incident-two-3', adapters: failing, ticketAdapter });
  assert.strictEqual(secondThreshold.escalations.length, 1, 'a recovered channel must escalate a later independent incident again');
  assert.strictEqual(tickets.filter(ticket => /升级主人/.test(ticket.title)).length, 2);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  const series = Object.values(state.failures).find(row => row.channel === 'feishu' && row.reasonClass === 'timeout');
  assert.strictEqual(series.incidentSequence, 2);
  assert.strictEqual(series.consecutive, 3);
  assert(series.lastClosedIncidentId && series.activeIncidentId !== series.lastClosedIncidentId);
}

async function testTicketCreationFailureIsNotCooledAway() {
  const dir = tempDir('ticket-retry');
  const cfg = config({ channels: ['feishu'], threshold: 5 });
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, cfg, source, { runId: 'baseline' });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/ticket-retry'] });
  let ticketAttempts = 0;
  const adapters = { feishu: async () => ({ ok: false, error: 'network timeout' }) };
  const first = await runner(dir, cfg, source, {
    runId: 'ticket-failure-1',
    adapters,
    ticketAdapter: args => { ticketAttempts++; return { ok: false, created: false, ticketId: args.id, error: 'ticket store unavailable' }; },
  });
  assert.strictEqual(first.tickets[0].ok, false);
  const second = await runner(dir, cfg, source, {
    runId: 'ticket-failure-2',
    adapters,
    ticketAdapter: args => { ticketAttempts++; return { ok: true, created: true, ticketId: args.id }; },
  });
  assert.strictEqual(ticketAttempts, 2, 'failed ticket creation must retry instead of entering cooldown suppression');
  assert.strictEqual(second.tickets[0].created, true);
}

async function testClosedTicketGetsNewIncidentTicket() {
  const state = ActivePush._test.defaultState();
  const cfg = config({ channels: ['feishu'], threshold: 3 });
  const meta = {
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    runId: 'closed-ticket-new-incident',
    runDir: tempDir('closed-ticket-new-incident'),
  };
  const stored = new Map();
  const secretaryTools = {
    repairTicketAdd: args => {
      if (stored.has(args.id)) throw new Error(`repair ticket exists: ${args.id}`);
      const ticket = { id: args.id, file: `tickets/${args.id}.md`, status: 'todo' };
      stored.set(args.id, ticket);
      return { ticket };
    },
  };
  const ticketAdapter = args => ActivePush._test.defaultTicketAdapter(args, { secretaryTools });
  const first = ActivePush._test.createTicketOnce({
    state,
    config: cfg,
    meta,
    failures: [{ channel: 'feishu', reasonClass: 'timeout', eventId: 'repo-same', incidentId: 'incident-one', error: 'timeout' }],
    ticketAdapter,
    escalation: false,
  });
  assert.strictEqual(first.created, true);
  stored.get(first.ticketId).status = 'done';
  const second = ActivePush._test.createTicketOnce({
    state,
    config: cfg,
    meta,
    failures: [{ channel: 'feishu', reasonClass: 'timeout', eventId: 'repo-same', incidentId: 'incident-two', error: 'timeout' }],
    ticketAdapter,
    escalation: false,
  });
  assert.strictEqual(second.created, true, 'a later incident must not be hidden by a closed ordinary ticket');
  assert.notStrictEqual(second.ticketId, first.ticketId, 'ordinary ticket identity must include incidentId');
  assert.strictEqual(stored.size, 2, 'the default adapter must create a visible ticket for the new incident');
}

async function testCrashWindowAndOverlapLock() {
  const dir = tempDir('crash');
  const cfg = config();
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, cfg, source, { runId: 'baseline' });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/crash'] });
  let called = 0;
  await assert.rejects(() => runner(dir, cfg, source, {
    runId: 'crash-after-cursor',
    adapters: {
      feishu: async () => { called++; return { ok: true, receiptId: 'bad' }; },
    },
    afterCursor: async () => { throw new Error('simulated crash after durable outbox'); },
  }), /simulated crash/);
  assert.strictEqual(called, 0);
  const crashState = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  assert.strictEqual(Object.keys(crashState.deliveries).length, 1, 'outbox must survive crash after cursor');
  const recovered = await runner(dir, cfg, source, {
    runId: 'crash-recover',
    adapters: {
      feishu: async payload => ({ ok: true, receiptId: `f-${payload.eventId}` }),
    },
  });
  assert.strictEqual(recovered.sent, 1);

  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/crash', 'https://github.com/acme/overlap'] });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = runner(dir, cfg, source, {
    runId: 'overlap-first',
    adapters: {
      feishu: async payload => { await gate; return { ok: true, receiptId: `f-${payload.eventId}` }; },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  const second = await runner(dir, cfg, source, { runId: 'overlap-second' });
  assert(['owner-alive', 'lock-held'].includes(second.reason));
  release();
  const firstResult = await first;
  assert.strictEqual(firstResult.sent, 1);
}

async function testLeaseLockSafety() {
  const dir = tempDir('lease-lock');
  const lockFile = path.join(dir, 'active-push.lock');
  const now = Date.now();
  const first = ActivePush.acquireLock(lockFile, {
    runId: 'owner-a',
    ownerToken: 'owner-a-token',
    pid: 111,
    staleMs: 100,
    heartbeatMs: 60000,
    isProcessAlive: pid => pid === 111,
  });
  assert.strictEqual(first.acquired, true);
  fs.utimesSync(lockFile, new Date(now - 1000), new Date(now - 1000));
  const blocked = ActivePush.acquireLock(lockFile, {
    runId: 'owner-b',
    ownerToken: 'owner-b-token',
    pid: 222,
    nowMs: now,
    staleMs: 100,
    heartbeatMs: 60000,
    isProcessAlive: pid => pid === 111,
  });
  assert.strictEqual(blocked.acquired, false, 'a live owner must not be stolen merely because mtime looks stale');
  assert.strictEqual(blocked.reason, 'owner-alive');

  writeJson(lockFile, { pid: 222, ownerToken: 'owner-b-token', runId: 'owner-b', at: new Date(now).toISOString() });
  assert.strictEqual(first.release(), false, 'old owner release must compare token before deleting');
  assert.strictEqual(JSON.parse(fs.readFileSync(lockFile, 'utf8')).ownerToken, 'owner-b-token');
  fs.unlinkSync(lockFile);

  writeJson(lockFile, { pid: 333, ownerToken: 'dead-token', runId: 'dead-owner', at: new Date(now - 2000).toISOString() });
  fs.utimesSync(lockFile, new Date(now - 2000), new Date(now - 2000));
  const takeover = ActivePush.acquireLock(lockFile, {
    runId: 'takeover',
    ownerToken: 'takeover-token',
    pid: 444,
    nowMs: now,
    staleMs: 100,
    heartbeatMs: 60000,
    isProcessAlive: () => false,
  });
  assert.strictEqual(takeover.acquired, true, 'dead stale owner may be taken over under serialized guard');
  assert.strictEqual(takeover.release(), true);

  fs.writeFileSync(lockFile, '{broken-lock');
  fs.utimesSync(lockFile, new Date(now - 2000), new Date(now - 2000));
  const corruptTakeover = ActivePush.acquireLock(lockFile, {
    runId: 'corrupt-takeover',
    ownerToken: 'corrupt-takeover-token',
    pid: 555,
    nowMs: now,
    staleMs: 100,
    heartbeatMs: 60000,
    isProcessAlive: () => false,
  });
  assert.strictEqual(corruptTakeover.acquired, true, 'a corrupt but unchanged stale lock must be quarantined and recovered');
  assert.strictEqual(corruptTakeover.recoveredLock.reason, 'corrupt-stale-lock');
  assert(fs.existsSync(corruptTakeover.recoveredLock.quarantineFile));
  assert.strictEqual(corruptTakeover.release(), true);
}

async function testReceiptCrashAtLeastOnceAndCorruptInputs() {
  const dir = tempDir('receipt-crash');
  const cfg = config({ channels: ['feishu'] });
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  await runner(dir, cfg, source, { runId: 'baseline' });
  writeJson(source, { repos: ['https://github.com/acme/base', 'https://github.com/acme/receipt-crash'] });
  const keys = [];
  await assert.rejects(() => runner(dir, cfg, source, {
    runId: 'receipt-crash',
    adapters: {
      feishu: async payload => { keys.push(payload.idempotencyKey); return { ok: true, receiptId: 'external-accepted' }; },
    },
    afterReceipt: async () => { throw Object.assign(new Error('simulated crash after external receipt'), { activePushPhase: 'after-receipt-before-ledger' }); },
  }), /simulated crash/);
  const crashedState = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  const crashedDelivery = Object.values(crashedState.deliveries)[0];
  assert.strictEqual(crashedDelivery.rootTaskId, ROOT_TASK);
  assert.strictEqual(crashedDelivery.rootQueueId, ROOT_QUEUE);
  assert.strictEqual(crashedDelivery.taskId, TASK);
  assert.strictEqual(crashedDelivery.runId, 'receipt-crash');
  assert.strictEqual(crashedDelivery.attempts.length, 1);
  const persistedAttempt = crashedDelivery.attempts[0];
  assert.deepStrictEqual({
    rootTaskId: persistedAttempt.rootTaskId,
    rootQueueId: persistedAttempt.rootQueueId,
    taskId: persistedAttempt.taskId,
    runId: persistedAttempt.runId,
    attempt: persistedAttempt.attempt,
    sourceCursor: persistedAttempt.sourceCursor,
    eventId: persistedAttempt.eventId,
    channel: persistedAttempt.channel,
    result: persistedAttempt.result,
    error: persistedAttempt.error,
  }, {
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    runId: 'receipt-crash',
    attempt: 1,
    sourceCursor: crashedDelivery.sourceCursor,
    eventId: crashedDelivery.eventId,
    channel: 'feishu',
    result: 'attempting',
    error: null,
  });
  assert(persistedAttempt.at, 'pre-send attempt must persist its timestamp before external delivery');
  const crashFail = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'runs', 'receipt-crash', 'node.fail.jsonl'), 'utf8').trim());
  assert.deepStrictEqual({
    rootTaskId: crashFail.rootTaskId,
    rootQueueId: crashFail.rootQueueId,
    taskId: crashFail.taskId,
    runId: crashFail.runId,
    attempt: crashFail.attempt,
    sourceCursor: crashFail.sourceCursor,
    eventId: crashFail.eventId,
    channel: crashFail.channel,
  }, {
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    runId: 'receipt-crash',
    attempt: 1,
    sourceCursor: crashedDelivery.sourceCursor,
    eventId: crashedDelivery.eventId,
    channel: 'feishu',
  }, 'afterReceipt crash evidence must retain complete delivery context');
  const attemptEvents = fs.readFileSync(path.join(dir, 'state', 'runs', 'receipt-crash', 'events.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(line => JSON.parse(line))
    .filter(row => row.details && row.details.type === 'delivery.attempt');
  assert.strictEqual(attemptEvents.length, 1, 'each external call must have a durable pre-send attempt event');
  const recovered = await runner(dir, cfg, source, {
    runId: 'receipt-recover',
    adapters: {
      feishu: async payload => { keys.push(payload.idempotencyKey); return { ok: true, receiptId: 'external-accepted-again' }; },
    },
  });
  assert.strictEqual(recovered.sent, 1);
  assert.strictEqual(keys.length, 2, 'receipt/ledger crash window is explicitly at-least-once');
  assert.strictEqual(keys[0], keys[1], 'replay must retain stable eventId+channel idempotency key');
  const recoveredState = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'state.json'), 'utf8'));
  const recoveredDelivery = Object.values(recoveredState.deliveries)[0];
  assert.strictEqual(recoveredDelivery.attempts.length, 2);
  assert.strictEqual(recoveredDelivery.attempts[1].runId, 'receipt-recover');
  assert.strictEqual(recoveredDelivery.attempts[1].attempt, 2);
  assert.strictEqual(recoveredDelivery.attempts[0].details.idempotencyKey, recoveredDelivery.attempts[1].details.idempotencyKey);

  const stateFile = path.join(dir, 'state', 'state.json');
  fs.writeFileSync(stateFile, '{broken-state');
  await assert.rejects(() => runner(dir, cfg, source, { runId: 'corrupt-state' }), /state parse failed/);
  assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), '{broken-state', 'corrupt cursor/state must never be replaced by empty fallback');
  assert(fs.existsSync(path.join(dir, 'state', 'runs', 'corrupt-state', 'node.fail.jsonl')));

  const badDir = tempDir('bad-source');
  const badSource = path.join(badDir, 'seen-repos.json');
  fs.writeFileSync(badSource, '{broken-source');
  await assert.rejects(() => runner(badDir, cfg, badSource, { runId: 'corrupt-source' }), /seen-repos parse failed/);
  assert(!fs.existsSync(path.join(badDir, 'state', 'state.json')), 'bad source must not advance or create a cursor');
  assert(fs.existsSync(path.join(badDir, 'state', 'runs', 'corrupt-source', 'node.fail.jsonl')));
}

async function testScheduleAndPendingTicketStats() {
  const disabled = Daily.triggerActivePush('20260710', { enabled: false, delayMs: 75 * 60000, dryRun: true });
  assert.strictEqual(disabled.action, 'skipped');
  const cfg = config();
  const dry = Daily.triggerActivePush('20260710', { enabled: true, config: cfg, delayMs: 75 * 60000, dryRun: true, configFile: '/tmp/active-push-test-config.json' });
  assert.strictEqual(dry.action, 'would-trigger');
  assert.strictEqual(dry.schedule.plannedBeijingTime, '06:15');
  assert(/--project-id 控制台 --scoped-to-project true/.test(dry.command));
  assert(dry.command.includes(`--task-id ${TASK}`));
  const mismatch = Daily.triggerActivePush('20260710', { enabled: true, config: cfg, delayMs: 0, dryRun: true });
  assert.strictEqual(mismatch.action, 'would-trigger');
  assert.match(mismatch.preflightExpectedError, /differs from owner-approved/);
  assert(/--delay-ms 0/.test(mismatch.command), 'runner must receive the mismatched value and emit run evidence instead of scheduler black-box exit');
  const activationMismatch = Daily.triggerActivePush('20260710', { enabled: true, config: config({ enabled: false, confirmed: false }), dryRun: true });
  assert.match(activationMismatch.preflightExpectedError, /config.enabled must be true/);

  const dir = tempDir('tickets');
  fs.writeFileSync(path.join(dir, 'active-push-a.md'), '# ticket\n- status: todo\n- created_at: 2026-07-09T00:00:00.000Z\n- source: insight-active-push\n');
  fs.writeFileSync(path.join(dir, 'closed.md'), '# ticket\n- status: done\n- created_at: 2026-07-08T00:00:00.000Z\n');
  const stats = Daily.pendingRepairTicketSummary({ repairDir: dir, nowMs: Date.parse('2026-07-10T00:00:00.000Z') });
  assert.strictEqual(stats.todo, 1);
  assert.strictEqual(stats.activePushTodo, 1);
  assert.strictEqual(stats.oldest.id, 'active-push-a');
  assert.strictEqual(stats.oldest.ageHours, 24);
}

async function testEnabledPreflightFailureEvidenceAndTicket() {
  const dir = tempDir('preflight-failure');
  const source = sourceFile(dir, ['https://github.com/acme/base']);
  const tickets = [];
  await assert.rejects(() => runner(dir, config({ confirmed: false }), source, {
    runId: 'preflight-failure',
    ticketAdapter: args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; },
  }), /owner confirmation gate rejected/);
  const failFile = path.join(dir, 'state', 'runs', 'preflight-failure', 'node.fail.jsonl');
  assert(fs.existsSync(failFile), 'enabled preflight rejection must leave node.fail in its run directory');
  assert.strictEqual(tickets.length, 1, 'enabled preflight rejection must open one stable independent ticket');
  assert(/awesome-list 新项目主动推送/.test(tickets[0].title));
  assert(/runId=preflight-failure/.test(tickets[0].evidence));

  await assert.rejects(() => runner(dir, config({ enabled: false, confirmed: false }), source, {
    runId: 'activation-mismatch',
    activationRequested: true,
    ticketAdapter: args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; },
  }), /activation requested while config.enabled=false/);
  assert(fs.existsSync(path.join(dir, 'state', 'runs', 'activation-mismatch', 'node.fail.jsonl')));

  const malformedConfig = path.join(dir, 'malformed-config.json');
  fs.writeFileSync(malformedConfig, '{broken-config');
  await assert.rejects(() => ActivePush.runActivePush({
    scope: SCOPE,
    configFile: malformedConfig,
    sourceFile: source,
    stateRoot: path.join(dir, 'malformed-state'),
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    runId: 'malformed-activation',
    activationRequested: true,
    ticketAdapter: args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; },
  }), /config parse failed/);
  assert(fs.existsSync(path.join(dir, 'malformed-state', 'runs', 'malformed-activation', 'node.fail.jsonl')));
  assert.strictEqual(tickets.length, 3, 'scheduler activation mismatch and malformed config must also open stable independent tickets');

  const lockStateRoot = path.join(dir, 'fresh-corrupt-lock-state');
  fs.mkdirSync(lockStateRoot, { recursive: true });
  fs.writeFileSync(path.join(lockStateRoot, 'active-push.lock'), '{broken-lock');
  await assert.rejects(() => ActivePush.runActivePush({
    scope: SCOPE,
    config: config(),
    sourceFile: source,
    stateRoot: lockStateRoot,
    rootTaskId: ROOT_TASK,
    rootQueueId: ROOT_QUEUE,
    taskId: TASK,
    runId: 'fresh-corrupt-lock',
    lockStaleMs: 60 * 1000,
    ticketAdapter: args => { tickets.push(args); return { ok: true, created: true, ticketId: args.id }; },
  }), /corrupt-lock-fresh/);
  assert(fs.existsSync(path.join(lockStateRoot, 'runs', 'fresh-corrupt-lock', 'node.fail.jsonl')));
  assert.strictEqual(tickets.length, 4, 'unrecoverable fresh corrupt lock must produce a visible independent ticket');
}

async function testSharedRedaction() {
  const redacted = redactMemoryCandidate('https://hooks.example/a?token=abc ubuntu@example.com Bearer xyz');
  assert(/REDACTED WEBHOOK URL/.test(redacted));
  assert(/REDACTED SSH TARGET/.test(redacted));
  assert(/Bearer \[REDACTED\]/.test(redacted));
  assert(!/abc|ubuntu@example\.com|Bearer xyz/.test(redacted));
}

async function main() {
  await testScopeAndOwnerGates();
  await testFeishuDownstreamIdempotency();
  await testStructuralFingerprint();
  await testBaselineAndExactlyOnceLedger();
  await testPartialFailureRetryAndRedaction();
  await testAllFailureMergedTicket();
  await testConsecutiveEscalation();
  await testRecoveryStartsNewEscalationIncident();
  await testTicketCreationFailureIsNotCooledAway();
  await testClosedTicketGetsNewIncidentTicket();
  await testCrashWindowAndOverlapLock();
  await testLeaseLockSafety();
  await testReceiptCrashAtLeastOnceAndCorruptInputs();
  await testScheduleAndPendingTicketStats();
  await testEnabledPreflightFailureEvidenceAndTicket();
  await testSharedRedaction();
  process.stdout.write('insight active push tests: PASS\n');
}

main().catch(error => {
  process.stderr.write((error && error.stack || String(error)) + '\n');
  process.exit(1);
});
