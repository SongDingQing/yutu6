'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Q = require('../shared/engine/queue');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function eventLine(event) {
  return `${JSON.stringify(event)}\n`;
}

function eventCount(file, type) {
  return fs.readFileSync(file, 'utf8').split(/\n/).filter(Boolean).reduce((count, line) => {
    try { return count + (JSON.parse(line).type === type ? 1 : 0); }
    catch (_) { return count; }
  }, 0);
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceo-runtime-efficiency-'));
  const artifacts = path.join(dir, 'artifacts');
  const events = path.join(artifacts, 'engine-events.jsonl');
  const config = path.join(dir, 'config.json');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(config, '{}\n');

  const initial = [];
  for (let seq = 1; seq <= 4000; seq++) initial.push(eventLine({ seq, type: 'node.output', text: 'noise' }));
  initial.push(eventLine({
    seq: 4001,
    type: 'project.routed',
    task: 'task-root',
    rootQueueAgent: 'ceo',
    rootQueueId: 'root-1',
    queueAgent: 'supervisor-demo',
    queueId: 'child-1',
  }));
  fs.writeFileSync(events, initial.join(''));

  process.env.CONSOLE_ARTIFACTS_DIR = artifacts;
  process.env.CONSOLE_CONFIG_PATH = config;
  process.env.CONSOLE_PROJECTS_DIR = path.join(dir, 'projects');
  process.env.YUTU6_AUDIT_PULSE_MS = '60000';

  const worker = require('../projects/控制台/ceo-worker')._test;
  const root = { rootQueueAgent: 'ceo', rootQueueId: 'root-1', rootTaskId: 'task-root' };
  const spec = { taskId: 'task-root' };
  assert.deepStrictEqual(worker.downstreamRefsFromEvents(spec, root), [
    { agent: 'supervisor-demo', queueId: 'child-1' },
  ]);
  const firstSnapshot = worker.projectRouteEventReaderSnapshot();
  const initialBytes = firstSnapshot.metrics.bytesRead;
  assert.strictEqual(initialBytes, fs.statSync(events).size);

  const appended = eventLine({ seq: 4002, type: 'node.output', text: 'more noise' })
    + eventLine({
      seq: 4003,
      type: 'queue.enqueued',
      sourceTask: 'task-root',
      rootQueueAgent: 'ceo',
      rootQueueId: 'root-1',
      queueAgent: 'supervisor-demo',
      queueId: 'child-2',
    });
  fs.appendFileSync(events, appended);
  assert.strictEqual(worker.downstreamRefsFromEvents(spec, root).length, 2);
  assert.strictEqual(worker.projectRouteEventReaderSnapshot().metrics.bytesRead,
    initialBytes + Buffer.byteLength(appended), 'project-route lookup must only read appended event bytes');

  const supervisorDir = Q.qdir(artifacts, 'supervisor-demo');
  writeJson(path.join(supervisorDir, 'done', 'child-1.json'), {
    id: 'child-1', rootQueueAgent: 'ceo', rootQueueId: 'root-1', rootTaskId: 'task-root',
  });
  const unrelatedDir = Q.qdir(artifacts, 'unrelated-agent');
  writeJson(path.join(unrelatedDir, 'failed', 'historical-match.json'), {
    id: 'historical-match', rootQueueAgent: 'ceo', rootQueueId: 'root-1', rootTaskId: 'task-root',
  });
  const refs = [{ agent: 'supervisor-demo', queueId: 'child-1' }];
  assert.deepStrictEqual(worker.descendantEntriesForRoot(root, { statuses: ['failed'], refs }), [],
    'a resolved direct ref must avoid scanning unrelated historical descendants');
  assert.strictEqual(worker.descendantEntriesForRoot(root, { statuses: ['done'], refs })[0].queueId, 'child-1');

  const payload = { queueAgent: 'ceo', queueId: 'root-1', enginePid: 42, reason: 'engine pid alive' };
  const before = eventCount(events, 'queue.running.keepalive');
  assert.strictEqual(worker.emitRunningKeepalive(payload), true);
  assert.strictEqual(worker.emitRunningKeepalive(Object.assign({}, payload, { heartbeatAgeMs: 5000 })), false,
    'heartbeat age changes must not defeat the audit pulse');
  assert.strictEqual(worker.emitRunningKeepalive(Object.assign({}, payload, { reason: 'waiting downstream' })), true,
    'state changes must remain immediately observable');
  assert.strictEqual(eventCount(events, 'queue.running.keepalive') - before, 2);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ pass: true, suite: 'ceo-runtime-efficiency' }));
}

main();
