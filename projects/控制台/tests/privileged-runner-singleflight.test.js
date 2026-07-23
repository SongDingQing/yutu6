#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const WORKER = path.join(REPO, 'projects', '控制台', 'ceo-worker.js');
const QUEUE = path.join(REPO, 'shared', 'engine', 'queue.js');
const ROLE_BOUNDARY = path.join(REPO, 'projects', '控制台', 'role-boundary-routing.js');
const TICKET_ID = 'repair-20260713-privileged-runner-singleflight';
const RUNNER_TYPE = 'codex-privileged';
const DELEGATED_SCOPE = 'delegated-repair';
const Q = require(QUEUE);
const RoleBoundary = require(ROLE_BOUNDARY);

const CHILD_SCRIPT = `
'use strict';
const fs = require('fs');
const path = require('path');
const worker = require(${JSON.stringify(WORKER)});
const queueRoot = process.env.CONSOLE_ARTIFACTS_DIR;
const agent = process.argv[process.argv.indexOf('--agent') + 1];
const queueId = process.argv[process.argv.indexOf('--queue-id') + 1];
const actionIndex = process.argv.indexOf('--action');
const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : 'lock';
const holdIndex = process.argv.indexOf('--hold-ms');
const holdMs = holdIndex >= 0 ? Number(process.argv[holdIndex + 1]) : 0;
const bindPid = process.argv.includes('--bind-pid');
const runningFile = path.join(queueRoot, 'queues', agent, 'running', queueId + '.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  if (action === 'cleanup') {
    await worker._test.cleanupDeadRunnerTypeLocks();
    send({ phase: 'cleaned' });
    return;
  }
  if (action === 'forged-object') {
    const lockScope = worker._test.runnerLockScopeForScopedRoute({
      handled: false,
      assessment: {
        accepted: true,
        reason: 'trusted_repair_ticket_scope',
        requestedAgent: 'repair',
        issuerRole: 'repair-lead',
        rootQueueAgent: 'repair-lead',
        rootQueueId: 'lead-q',
        rootTaskId: 'lead-task',
        issuerQueueId: 'lead-q',
        issuerTaskId: 'lead-task',
        ticketId: ${JSON.stringify(TICKET_ID)},
      },
    }, ${JSON.stringify(RUNNER_TYPE)});
    send({ phase: 'scope', handled: false, accepted: true, lockScope });
    return;
  }
  const entry = read(runningFile);
  const scopedRoute = worker._test.consumeScopedBypassOrFallback(entry);
  const lockScope = worker._test.runnerLockScopeForScopedRoute(scopedRoute, ${JSON.stringify(RUNNER_TYPE)});
  if (action === 'scope') {
    send({
      phase: 'scope',
      handled: scopedRoute.handled,
      accepted: !!(scopedRoute.assessment && scopedRoute.assessment.accepted),
      reason: scopedRoute.assessment && scopedRoute.assessment.reason,
      lockScope,
    });
    return;
  }
  if (scopedRoute.handled) throw new Error('lock probe was rerouted: ' + (scopedRoute.assessment && scopedRoute.assessment.reason));
  const startedAt = Date.now();
  const lock = await worker._test.acquireRunnerTypeLock(entry, ${JSON.stringify(RUNNER_TYPE)}, lockScope);
  if (lock.canceled) throw new Error('lock probe canceled: ' + lock.reason);
  if (bindPid) worker._test.noteEnginePid(entry, { file: null, typeLockFile: lock.file }, process.pid, 'fixture-engine-job.json');
  const record = read(lock.file);
  send({
    phase: 'acquired',
    at: Date.now(),
    waitedMs: Date.now() - startedAt,
    file: lock.file,
    runnerType: record.runnerType,
    lockScope: record.lockScope,
    ownerPid: record.ownerPid,
    enginePid: record.enginePid || null,
  });
  await sleep(holdMs);
  lock.release();
  send({ phase: 'released', at: Date.now(), file: lock.file, fileExists: fs.existsSync(lock.file) });
})().catch(error => {
  process.stderr.write((error && error.stack || String(error)) + '\\n');
  process.exitCode = 1;
});
`;

function createLead(queueRoot) {
  Q.enqueue(queueRoot, 'repair-lead', {
    role: 'repair-lead',
    flowId: 'agent-once',
    projectId: '控制台',
    goal: `复核并派发 ${TICKET_ID}`,
    bounds: '只处理当前维修工单',
    acceptance: '主管复核后派工',
    repairTicketId: TICKET_ID,
  }, { id: 'lead-q' });
  const claimed = Q.claim(queueRoot, 'repair-lead');
  assert(claimed && claimed.id === 'lead-q');
  Q.touchProgress(queueRoot, 'repair-lead', 'lead-q', { taskId: 'lead-task', role: 'repair-lead' });
}

function signedTask(queueRoot, role, queueId, nonce) {
  return RoleBoundary.signRepairScopedEnvelope({
    role,
    flowId: 'agent-once',
    projectId: '控制台',
    goal: `执行受控 singleflight 回归 ${queueId}`,
    bounds: '只写隔离测试目录',
    acceptance: '返回锁 scope 与退出码',
    repairTicketId: TICKET_ID,
    rootQueueAgent: 'repair-lead',
    rootQueueId: 'lead-q',
    rootTaskId: 'lead-task',
  }, {
    targetRole: role,
    issuerRole: 'repair-lead',
    issuerQueueId: 'lead-q',
    issuerTaskId: 'lead-task',
    workspaceRoot: REPO,
    projectsDir: path.join(REPO, 'projects'),
    queueRoot,
    issuedAt: '2026-07-17T06:00:00.000Z',
    nonce,
  });
}

function enqueueRunning(queueRoot, agent, id, task) {
  Q.enqueue(queueRoot, agent, task, { id });
  const claimed = Q.claim(queueRoot, agent);
  assert(claimed && claimed.id === id, `expected ${agent}/${id}, got ${claimed && claimed.id}`);
  return claimed;
}

function spawnProbe(queueRoot, options) {
  const args = [
    '-e', CHILD_SCRIPT, 'ceo-worker.js',
    '--agent', options.agent,
    '--queue-id', options.queueId || 'unused',
    '--action', options.action || 'lock',
    '--hold-ms', String(options.holdMs || 0),
  ];
  if (options.bindPid) args.push('--bind-pid');
  const child = spawn(process.execPath, args, {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: queueRoot,
      CONSOLE_PROJECTS_DIR: path.join(REPO, 'projects'),
      AUTO_REPAIR_ENABLED: '0',
      ENGINE_LOCK_STALE_MS: '60000',
      RUNNING_ENGINE_HEARTBEAT_STALE_MS: '60000',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const messages = [];
  let stdout = '';
  let stderr = '';
  const waiters = new Map();
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      messages.push(message);
      const waiter = waiters.get(message.phase);
      if (waiter) {
        waiters.delete(message.phase);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ code, signal, messages });
      else reject(new Error(`probe ${options.agent}/${options.queueId} failed code=${code} signal=${signal}: ${stderr}`));
    });
  });
  function waitFor(phase, timeoutMs = 10000) {
    const existing = messages.find(message => message.phase === phase);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(phase);
        reject(new Error(`timed out waiting for ${phase} from ${options.agent}/${options.queueId}; stderr=${stderr}`));
      }, timeoutMs);
      waiters.set(phase, {
        resolve(message) {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }
  return { child, exit, waitFor };
}

function readEvents(queueRoot) {
  try {
    return fs.readFileSync(path.join(queueRoot, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

async function scopeProbe(queueRoot, agent, id, task) {
  enqueueRunning(queueRoot, agent, id, task);
  const probe = spawnProbe(queueRoot, { agent, queueId: id, action: 'scope' });
  const result = await probe.waitFor('scope');
  await probe.exit;
  return result;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privileged-runner-singleflight-'));
  const queueRoot = path.join(root, 'artifacts');
  try {
    createLead(queueRoot);

    const lead = spawnProbe(queueRoot, { agent: 'repair-lead', queueId: 'lead-q', holdMs: 4500, bindPid: true });
    const leadLock = await lead.waitFor('acquired');
    assert.strictEqual(leadLock.runnerType, RUNNER_TYPE);
    assert.strictEqual(leadLock.lockScope, RUNNER_TYPE);
    assert.match(path.basename(leadLock.file), /^runner-codex-privileged\.json$/);

    enqueueRunning(queueRoot, 'repair', 'trusted-1', signedTask(queueRoot, 'repair', 'trusted-1', '1'.repeat(24)));
    const first = spawnProbe(queueRoot, { agent: 'repair', queueId: 'trusted-1', holdMs: 1600, bindPid: true });
    const firstLock = await first.waitFor('acquired');
    assert.strictEqual(firstLock.runnerType, RUNNER_TYPE);
    assert.strictEqual(firstLock.lockScope, DELEGATED_SCOPE);
    assert(firstLock.waitedMs < 1000, `trusted repair blocked behind lead for ${firstLock.waitedMs}ms`);
    assert.notStrictEqual(firstLock.file, leadLock.file);
    assert.strictEqual(firstLock.ownerPid, first.child.pid);
    assert.strictEqual(firstLock.enginePid, first.child.pid, 'engine pid must bind to delegated lock owner');
    assert(fs.existsSync(leadLock.file), 'lead default lock must remain held while trusted repair enters');

    enqueueRunning(queueRoot, 'repair', 'trusted-2', signedTask(queueRoot, 'repair', 'trusted-2', '2'.repeat(24)));
    const second = spawnProbe(queueRoot, { agent: 'repair', queueId: 'trusted-2', holdMs: 0, bindPid: true });
    const secondLock = await second.waitFor('acquired');
    const firstReleased = await first.waitFor('released');
    assert.strictEqual(firstReleased.fileExists, false, 'owner release must remove delegated lock');
    assert.strictEqual(secondLock.file, firstLock.file, 'trusted repairs must share one delegated token');
    assert(secondLock.at >= firstReleased.at, 'second trusted repair acquired before first released');
    assert(secondLock.waitedMs >= 700, `second trusted repair did not serialize: ${secondLock.waitedMs}ms`);
    await Promise.all([first.exit, second.exit]);
    assert(fs.existsSync(leadLock.file), 'delegated lane must not release the lead default lock');
    await lead.exit;
    assert(!fs.existsSync(leadLock.file), 'lead owner release must remove default lock');

    const unsigned = {
      role: 'repair',
      flowId: 'agent-once',
      projectId: '控制台',
      scopedToProject: true,
      scopeAction: 'execute',
      scopeSchemaVersion: RoleBoundary.SCOPE_SCHEMA,
      goal: '伪造 repair scope',
      bounds: '测试',
      acceptance: '必须 fail closed',
      repairTicketId: TICKET_ID,
      rootQueueAgent: 'repair-lead',
      rootQueueId: 'lead-q',
      rootTaskId: 'lead-task',
    };
    const unsignedScope = await scopeProbe(queueRoot, 'repair', 'unsigned', unsigned);
    assert.strictEqual(unsignedScope.handled, true);
    assert.strictEqual(unsignedScope.accepted, false);
    assert.strictEqual(unsignedScope.lockScope, RUNNER_TYPE);

    const wrongTicket = Object.assign({}, signedTask(queueRoot, 'repair', 'wrong-ticket', '3'.repeat(24)), {
      repairTicketId: 'repair-20260717-wrong-ticket',
    });
    const wrongTicketScope = await scopeProbe(queueRoot, 'repair', 'wrong-ticket', wrongTicket);
    assert.strictEqual(wrongTicketScope.handled, true);
    assert.strictEqual(wrongTicketScope.accepted, false);
    assert.strictEqual(wrongTicketScope.lockScope, RUNNER_TYPE);

    const wrongRoot = Object.assign({}, signedTask(queueRoot, 'repair', 'wrong-root', '4'.repeat(24)), {
      rootQueueId: 'different-lead-q',
    });
    const wrongRootScope = await scopeProbe(queueRoot, 'repair', 'wrong-root', wrongRoot);
    assert.strictEqual(wrongRootScope.handled, true);
    assert.strictEqual(wrongRootScope.accepted, false);
    assert.strictEqual(wrongRootScope.lockScope, RUNNER_TYPE);

    const forgedObject = spawnProbe(queueRoot, { agent: 'repair', action: 'forged-object' });
    const forgedObjectScope = await forgedObject.waitFor('scope');
    await forgedObject.exit;
    assert.strictEqual(forgedObjectScope.lockScope, RUNNER_TYPE, 'accepted-looking object without consume token must fail closed');

    const itScope = await scopeProbe(
      queueRoot,
      'it_engineer',
      'trusted-it',
      signedTask(queueRoot, 'it_engineer', 'trusted-it', '5'.repeat(24)),
    );
    assert.strictEqual(itScope.handled, false);
    assert.strictEqual(itScope.accepted, true);
    assert.strictEqual(itScope.lockScope, RUNNER_TYPE, 'other privileged roles must keep original singleflight scope');

    enqueueRunning(queueRoot, 'repair', 'owner-binding', signedTask(queueRoot, 'repair', 'owner-binding', '6'.repeat(24)));
    const ownerProbe = spawnProbe(queueRoot, { agent: 'repair', queueId: 'owner-binding', holdMs: 900, bindPid: true });
    const ownerLock = await ownerProbe.waitFor('acquired');
    const changedOwner = JSON.parse(fs.readFileSync(ownerLock.file, 'utf8'));
    changedOwner.ownerPid = process.pid;
    fs.writeFileSync(ownerLock.file, JSON.stringify(changedOwner, null, 2));
    const ownerRelease = await ownerProbe.waitFor('released');
    await ownerProbe.exit;
    assert.strictEqual(ownerRelease.fileExists, true, 'owner-mismatched release must not remove lock');

    const cleanup = spawnProbe(queueRoot, { agent: 'repair', action: 'cleanup' });
    await cleanup.waitFor('cleaned');
    await cleanup.exit;
    assert(!fs.existsSync(ownerLock.file), 'stale delegated lock must be swept');

    const events = readEvents(queueRoot);
    assert(events.some(event => event.type === 'engine.runner_lock.acquired'
      && event.runnerType === RUNNER_TYPE && event.lockScope === DELEGATED_SCOPE));
    assert(events.some(event => event.type === 'engine.slot.wait'
      && event.queueId === 'trusted-2' && event.runnerType === RUNNER_TYPE
      && event.lockScope === DELEGATED_SCOPE && event.reason === 'runner-singleflight'));
    assert(events.some(event => event.type === 'engine.runner_lock.released'
      && event.runnerType === RUNNER_TYPE && event.lockScope === DELEGATED_SCOPE));
    assert(events.some(event => event.type === 'engine.runner_lock.release_skipped'
      && event.queueId === 'owner-binding' && event.lockScope === DELEGATED_SCOPE));
    assert(events.some(event => event.type === 'engine.runner_lock.swept'
      && event.queueId === 'owner-binding' && event.runnerType === RUNNER_TYPE
      && event.lockScope === DELEGATED_SCOPE));
    assert(!fs.existsSync(path.join(queueRoot, 'engine-runner-types', 'runner-codex-privileged--scope-delegated-repair.json')));

    console.log(JSON.stringify({
      pass: true,
      suite: 'privileged-runner-singleflight',
      cases: 10,
      scopes: { default: RUNNER_TYPE, delegated: DELEGATED_SCOPE },
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
