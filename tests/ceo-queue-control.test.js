#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-ceo-queue-control-test-'));
process.env.CONSOLE_ARTIFACTS_DIR = root;
process.env.AUTO_OPTIMIZER_ENABLED = '';
// 队列管控 API 测试只验证队列文件状态(优先级/合并/取消),不需要真起 worker;
// 禁掉 worker,防止 jump/merge API 触发的 ensureQueueWorker spawn 出 worker 把测试项 claim 走(预存竞态)。
process.env.QUEUE_WORKER_DISABLED = '1';

const Q = require('../shared/engine/queue');
const { handler } = require('../projects/控制台/server');

function cleanupRoot() {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function post(port, apiPath, body) {
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: apiPath,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data || '{}'); }
        catch (e) { return reject(e); }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function runSecretaryProcess(port, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join('projects', '控制台', 'secretary-tools.js'),
      ...args,
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env, {
        CONSOLE_ARTIFACTS_DIR: root,
        SECRETARY_TOOLS_API_BASE: `http://127.0.0.1:${port}`,
      }, extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runSecretary(port, args, extraEnv) {
  const out = await runSecretaryProcess(port, args, extraEnv);
  if (out.code !== 0) throw new Error(`secretary-tools failed: ${out.stderr || out.stdout}`);
  try { return JSON.parse(out.stdout); }
  catch (e) { throw e; }
}

function findQueued(agent, id) {
  return Q.list(root, agent).queued.find(entry => entry.id === id);
}

function findPaused(agent, id) {
  return Q.list(root, agent).paused.find(entry => entry.id === id);
}

function findCanceled(agent, id) {
  const file = path.join(Q.qdir(root, agent), 'canceled', `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function queuedEntryFile(agent, id) {
  const dir = Q.qdir(root, agent);
  const file = fs.readdirSync(dir).find(name => name.endsWith(`-${id}.json`));
  return file ? path.join(dir, file) : null;
}

function idempotencyAuditFiles() {
  const dir = path.join(root, 'queue-organize-idempotency');
  try { return fs.readdirSync(dir).filter(file => /\.json$/.test(file)).sort(); }
  catch (_) { return []; }
}

function assertSecretaryDirectRejected(response) {
  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.body.code, 'secretary_direct_queue_write_rejected');
  assert.match(response.body.error || '', /CEO|queue-control|队列控制/);
}

async function main() {
  const server = http.createServer(handler);
  const port = await listen(server);
  const agent = 'worker_code';

  try {
    const deniedEnqueue = await post(port, `/api/queue/${agent}`, {
      id: 'oldenq',
      goal: 'legacy secretary enqueue must be rejected',
      source: 'secretary-tools',
    });
    assertSecretaryDirectRejected(deniedEnqueue);
    assert.strictEqual(findQueued(agent, 'oldenq'), undefined);

    Q.enqueue(root, agent, { goal: 'old secretary direct write must be rejected' }, { id: 'oldjump', priority: 50 });
    const denied = await post(port, `/api/queue/${agent}/oldjump/jump`, {
      source: 'legacy-client',
      requestedBy: 'secretary-tools',
    });
    assertSecretaryDirectRejected(denied);
    assert.strictEqual(findQueued(agent, 'oldjump').priority, 50);

    Q.enqueue(root, agent, { goal: 'secretary priority direct write must be rejected' }, { id: 'oldpriority', priority: 40 });
    const deniedPriority = await post(port, `/api/queue/${agent}/oldpriority/priority`, {
      priority: 5,
      source: 'Legacy SECRETARY Panel',
    });
    assertSecretaryDirectRejected(deniedPriority);
    assert.strictEqual(findQueued(agent, 'oldpriority').priority, 40);

    Q.enqueue(root, agent, { goal: 'secretary cancel direct write must be rejected' }, { id: 'oldcancel', priority: 41 });
    const deniedCancel = await post(port, `/api/queue/${agent}/oldcancel/cancel`, {
      actor: '秘书',
      reason: 'legacy cancel',
    });
    assertSecretaryDirectRejected(deniedCancel);
    assert(findQueued(agent, 'oldcancel'), 'secretary rejected cancel should leave item queued');
    assert.strictEqual(findCanceled(agent, 'oldcancel'), undefined);

    Q.enqueue(root, agent, { goal: 'secretary batch cancel direct write must be rejected a' }, { id: 'oldbatcha', priority: 42 });
    Q.enqueue(root, agent, { goal: 'secretary batch cancel direct write must be rejected b' }, { id: 'oldbatchb', priority: 43 });
    const deniedBatchCancel = await post(port, `/api/queue/${agent}/batch-cancel`, {
      ids: ['oldbatcha', 'oldbatchb'],
      requested_by: 'secretary-legacy',
    });
    assertSecretaryDirectRejected(deniedBatchCancel);
    assert(findQueued(agent, 'oldbatcha'), 'secretary rejected batch cancel should leave first item queued');
    assert(findQueued(agent, 'oldbatchb'), 'secretary rejected batch cancel should leave second item queued');

    Q.enqueue(root, agent, { goal: 'secretary merge direct write keep' }, { id: 'oldmergekeep', priority: 44 });
    Q.enqueue(root, agent, { goal: 'secretary merge direct write cancel' }, { id: 'oldmergedrop', priority: 45 });
    const deniedMerge = await post(port, `/api/queue/${agent}/merge`, {
      keepId: 'oldmergekeep',
      cancelIds: ['oldmergedrop'],
      requestedBy: '秘书',
    });
    assertSecretaryDirectRejected(deniedMerge);
    assert(findQueued(agent, 'oldmergekeep'), 'secretary rejected merge should leave keep item queued');
    assert(findQueued(agent, 'oldmergedrop'), 'secretary rejected merge should leave cancel item queued');
    assert.strictEqual(findCanceled(agent, 'oldmergedrop'), undefined);

    const localDenied = await runSecretaryProcess(port, [
      'queue-enqueue',
      '--agent', agent,
      '--id', 'localenq',
      '--goal', 'local direct write must be rejected',
    ], { SECRETARY_TOOLS_QUEUE_LOCAL: '1' });
    assert.notStrictEqual(localDenied.code, 0);
    assert.match(localDenied.stderr || localDenied.stdout, /direct queue writes are disabled/);
    assert.strictEqual(findQueued(agent, 'localenq'), undefined);

    const ceoDirectEnqueue = await post(port, `/api/queue/${agent}`, {
      id: 'ceoenq',
      goal: 'direct CEO enqueue should pass',
      source: 'ceo',
    });
    assert.strictEqual(ceoDirectEnqueue.status, 200);
    assert(findQueued(agent, 'ceoenq'), 'CEO enqueue should be queued');

    Q.enqueue(root, agent, { goal: 'direct CEO jump should pass' }, { id: 'ceojump', priority: 52 });
    const ceoDirectJump = await post(port, `/api/queue/${agent}/ceojump/jump`, {
      source: 'ceo',
    });
    assert.strictEqual(ceoDirectJump.status, 200);
    assert.strictEqual(findQueued(agent, 'ceojump').priority, 0);

    Q.enqueue(root, agent, { goal: 'direct CEO priority should pass' }, { id: 'ceopriority', priority: 53 });
    const ceoDirectPriority = await post(port, `/api/queue/${agent}/ceopriority/priority`, {
      priority: 8,
      actor: 'ceo',
    });
    assert.strictEqual(ceoDirectPriority.status, 200);
    assert.strictEqual(findQueued(agent, 'ceopriority').priority, 8);

    Q.enqueue(root, agent, { goal: 'direct CEO cancel should pass' }, { id: 'ceocancel', priority: 54 });
    const ceoDirectCancel = await post(port, `/api/queue/${agent}/ceocancel/cancel`, {
      reason: 'ceo cancel',
      requestedBy: 'ceo',
    });
    assert.strictEqual(ceoDirectCancel.status, 200);
    assert.strictEqual(findCanceled(agent, 'ceocancel').queue_cancel.canceled_by, 'ceo');

    Q.enqueue(root, agent, { projectId: '控制台', goal: 'direct CEO merge keep' }, { id: 'ceomergekeep', priority: 55 });
    Q.enqueue(root, agent, { projectId: '控制台', goal: 'direct CEO merge drop', acceptance: 'manual merge drop acceptance must be preserved' }, { id: 'ceomergedrop', priority: 56 });
    const ceoDirectMerge = await post(port, `/api/queue/${agent}/merge`, {
      keepId: 'ceomergekeep',
      cancelIds: ['ceomergedrop'],
      source: 'ceo',
    });
    assert.strictEqual(ceoDirectMerge.status, 200);
    const manualKeep = findQueued(agent, 'ceomergekeep');
    assert(manualKeep, 'CEO merge should preserve keep item');
    assert.match(manualKeep.task.goal, /manual merge drop acceptance must be preserved/);
    assert.strictEqual(findCanceled(agent, 'ceomergedrop').queue_organize.merged_by, 'console-server:merge');

    const jumped = await runSecretary(port, ['queue-jump', '--agent', agent, '--id', 'oldjump']);
    assert.strictEqual(jumped.ok, true);
    const jumpedEntry = findQueued(agent, 'oldjump');
    assert.strictEqual(jumpedEntry.priority, 0);
    assert.strictEqual(jumpedEntry.queue_control.actor, 'ceo');
    assert.strictEqual(jumpedEntry.queue_control.requested_by, 'secretary-tools');

    const enqueued = await runSecretary(port, ['queue-enqueue', '--agent', agent, '--id', 'enq1', '--goal', 'enqueue through CEO control']);
    assert.strictEqual(enqueued.ok, true);
    const enqueuedEntry = findQueued(agent, 'enq1');
    assert(enqueuedEntry, 'enqueued task should be queued');
    assert.strictEqual(enqueuedEntry.queue_control.actor, 'ceo');
    assert.strictEqual(enqueuedEntry.queue_control.action, 'enqueue');
    assert.strictEqual(enqueuedEntry.queue_control.requested_by, 'secretary-tools');

    Q.enqueue(root, agent, { goal: 'paused priority' }, { id: 'paused1', priority: 60 });
    Q.pause(root, agent, 'paused1');
    const pausedPriority = await post(port, '/api/ceo/queue-control', {
      action: 'priority',
      agent,
      id: 'paused1',
      priority: 7,
      requestedBy: 'secretary-tools',
    });
    assert.strictEqual(pausedPriority.status, 200);
    assert.strictEqual(findPaused(agent, 'paused1').priority, 7);
    assert.strictEqual(findPaused(agent, 'paused1').queue_priority.set_by, 'ceo');

    Q.enqueue(root, agent, { goal: 'running is read only' }, { id: 'running1', priority: 1 });
    Q.claim(root, agent, { match: entry => entry.id === 'running1' });
    const runningCancel = await post(port, '/api/ceo/queue-control', {
      action: 'cancel',
      agent,
      id: 'running1',
      requestedBy: 'secretary-tools',
    });
    assert.strictEqual(runningCancel.status, 409);
    const runningEntry = Q.list(root, agent).running.find(entry => entry.id === 'running1');
    assert(runningEntry, 'running entry should stay running');
    assert.strictEqual(runningEntry.cancel_requested, undefined);

    Q.enqueue(root, agent, { goal: 'queued cancel through CEO' }, { id: 'cancel1', priority: 30 });
    const canceled = await runSecretary(port, ['queue-cancel', '--agent', agent, '--id', 'cancel1', '--reason', 'test cancel']);
    assert.strictEqual(canceled.ok, true);
    const canceledFile = path.join(Q.qdir(root, agent), 'canceled', 'cancel1.json');
    const canceledEntry = JSON.parse(fs.readFileSync(canceledFile, 'utf8'));
    assert.strictEqual(canceledEntry.status, 'canceled');
    assert.strictEqual(canceledEntry.queue_cancel.canceled_by, 'ceo');
    assert.strictEqual(canceledEntry.queue_cancel.requested_by, 'secretary-tools');

    const organizeAgent = 'organizer_agent';
    Q.enqueue(root, organizeAgent, { projectId: '控制台', queueMergeKey: 'secretary-organize', goal: 'secretary organize keep' }, { id: 'orgkeep', priority: 70 });
    Q.enqueue(root, organizeAgent, { projectId: '控制台', queueMergeKey: 'secretary-organize', goal: 'secretary organize cancel', acceptance: 'secretary organize acceptance must survive' }, { id: 'orgdrop', priority: 71 });
    Q.enqueue(root, organizeAgent, { projectId: '控制台', goal: 'secretary organize running item must stay byte-identical' }, { id: 'orgrun', priority: 72 });
    Q.claim(root, organizeAgent, { match: entry => entry.id === 'orgrun' });
    const runningOrganizeFile = path.join(Q.qdir(root, organizeAgent), 'running', 'orgrun.json');
    const runningOrganizeBefore = fs.readFileSync(runningOrganizeFile, 'utf8');
    const auditBeforeOrganize = idempotencyAuditFiles();
    const dryOrganize = await runSecretary(port, ['queue-organize', '--agent', organizeAgent, '--project', '控制台']);
    assert.strictEqual(dryOrganize.ok, true);
    assert.strictEqual(dryOrganize.applied, false);
    assert(dryOrganize.snapshot && dryOrganize.snapshot.hash);
    assert(dryOrganize.plan_hash);
    assert.deepStrictEqual(idempotencyAuditFiles(), auditBeforeOrganize, 'dry-run must not write queue organize idempotency audit files');
    const appliedOrganize = await runSecretary(port, ['queue-organize', '--agent', organizeAgent, '--project', '控制台', '--apply']);
    assert.strictEqual(appliedOrganize.ok, true);
    assert.strictEqual(appliedOrganize.applied, true);
    assert.strictEqual(appliedOrganize.plan_hash, dryOrganize.plan_hash);
    assert.strictEqual(appliedOrganize.summary.changed, 2);
    const auditAfterFirstOrganize = idempotencyAuditFiles();
    assert.strictEqual(auditAfterFirstOrganize.length, auditBeforeOrganize.length + 1);
    assert.strictEqual(fs.existsSync(path.join(root, 'queues', '_organize-idempotency')), false, 'queue organize audits must not create a queue agent directory');
    const organizedKeep = findQueued(organizeAgent, 'orgkeep');
    assert.match(organizedKeep.task.goal, /secretary organize acceptance must survive/);
    assert.strictEqual(findCanceled(organizeAgent, 'orgdrop').merged_into.id, 'orgkeep');
    assert.strictEqual(fs.readFileSync(runningOrganizeFile, 'utf8'), runningOrganizeBefore);

    const organizedKeepFile = queuedEntryFile(organizeAgent, 'orgkeep');
    const organizedKeepBeforeSecond = fs.readFileSync(organizedKeepFile, 'utf8');
    const canceledBeforeSecondOrganize = Q.list(root, organizeAgent).canceled;
    const secondOrganize = await runSecretary(port, ['queue-organize', '--agent', organizeAgent, '--project', '控制台', '--apply']);
    assert.strictEqual(secondOrganize.ok, true);
    assert.strictEqual(secondOrganize.applied, true);
    assert.strictEqual(secondOrganize.no_op, true);
    assert.strictEqual(secondOrganize.summary.planned_groups, 0);
    assert.strictEqual(secondOrganize.summary.changed, 0);
    assert.strictEqual(secondOrganize.summary.skipped, 0);
    assert.deepStrictEqual(idempotencyAuditFiles(), auditAfterFirstOrganize);
    assert.strictEqual(Q.list(root, organizeAgent).canceled, canceledBeforeSecondOrganize);
    assert.strictEqual(fs.readFileSync(organizedKeepFile, 'utf8'), organizedKeepBeforeSecond);
    assert.strictEqual(fs.readFileSync(runningOrganizeFile, 'utf8'), runningOrganizeBefore);

    console.log(JSON.stringify({ pass: true, suite: 'ceo-queue-control' }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    cleanupRoot();
  }
}

main().catch(err => {
  try { cleanupRoot(); } catch (_) {}
  console.error(err && err.stack || err);
  process.exit(1);
});
