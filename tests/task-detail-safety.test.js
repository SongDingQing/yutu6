#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TaskDetail = require('../projects/控制台/task-detail');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-task-detail-'));
const workdir = path.join(root, 'workspace');
const engineRuns = path.join(workdir, 'projects', '控制台', 'artifacts', 'engine-runs');
const taskId = 'task-safe-1';
const runDir = path.join(engineRuns, taskId, 'implement-1');
const fakeApiValue = ['hidden', 'value'].join('-');
const fakeBearer = ['abcd', 'efgh', 'ijkl', 'mnop'].join('');
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'result.md'), `验证完成\nAPI_KEY=${fakeApiValue}\n`);
fs.writeFileSync(path.join(runDir, 'interaction-trace.json'), '{"prompt":"private chain"}\n');
fs.writeFileSync(path.join(root, 'outside.md'), 'outside\n');

const detail = TaskDetail.buildTaskDetail({
  entry: {
    id: 'queue-1',
    status: 'failed',
    taskId,
    role: 'worker_code',
    task: {
      goal: '修复任务',
      acceptance: '测试通过',
    },
    error: `Bearer ${fakeBearer}`,
    run_attempt: 2,
  },
  agent: 'supervisor-console',
  queueId: 'queue-1',
  cfg: {
    roleRouting: { worker_code: { runner: 'codex' } },
    runners: { codex: { model: 'gpt-test', provider: 'local-cli' } },
  },
  events: [
    { seq: 1, ts: '2026-07-17T00:00:00Z', type: 'node.start', task: taskId, node: 'implement', role: 'worker_code', text: 'private hidden reasoning' },
    { seq: 2, ts: '2026-07-17T00:00:01Z', type: 'node.fail', task: taskId, node: 'implement', role: 'worker_code', reason: 'token=private-token' },
  ],
});

assert.equal(detail.ok, true);
assert.equal(detail.task.runner, 'codex');
assert.equal(detail.task.model, 'gpt-test');
assert.equal(detail.task.retryCount, 2);
assert.equal(detail.task.events.length, 2);
assert(!JSON.stringify(detail).includes('private hidden reasoning'));
assert(!JSON.stringify(detail).includes('private-token'));
assert(JSON.stringify(detail).includes('[redacted]'));

const artifacts = TaskDetail.listTaskArtifacts({ workdir, engineRuns, taskIds: [taskId] });
assert.equal(artifacts.length, 1);
assert.equal(artifacts[0].name, 'result.md');
assert(!artifacts.some(item => item.name === 'interaction-trace.json'));

const allowed = TaskDetail.resolveArtifactPath(workdir, [engineRuns], artifacts[0].path);
assert.equal(allowed, path.join(runDir, 'result.md'));
assert.equal(TaskDetail.resolveArtifactPath(workdir, [engineRuns], path.relative(workdir, path.join(root, 'outside.md'))), null);
assert.equal(TaskDetail.resolveArtifactPath(workdir, [engineRuns], path.relative(workdir, path.join(runDir, 'interaction-trace.json'))), null);
assert(!TaskDetail.redactSensitive(`Authorization: Bearer ${fakeBearer}`).includes(fakeBearer));

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ pass: true, suite: 'task-detail-safety' }));
