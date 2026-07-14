#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EventLog = require('../shared/engine/eventlog');
const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function seedReviewLoopTask(artifactsDir, taskId, opts = {}) {
  const changedFiles = opts.changedFiles || [];
  const implementation = Object.assign({
    done: true,
    summary: 'review-loop test implementation',
    changed_files: changedFiles,
    logic_chain: {
      summary: 'review-loop fixture did the requested work',
      current_status: 'done',
      actions: ['seeded review-loop completion fixture'],
      evidence: changedFiles.length
        ? changedFiles.map(file => ({ kind: 'file', path: file, summary: `verified ${file}` }))
        : [{ kind: 'analysis', summary: 'non-delivery fixture evidence: node tests/ceo-serial-lock.test.js exits 0', command: 'node tests/ceo-serial-lock.test.js', exit_code: 0 }],
      tests: [{ command: 'node tests/ceo-serial-lock.test.js', exit_code: 0, summary: 'fixture test path' }],
      conclusion: 'fixture completion is real for this test case',
    },
  }, opts.implementation || {});
  const review = Object.assign({
    pass: true,
    severity: 'low',
    notes: 'review-loop test review passed',
    verification: {
      verdict: 'true',
      checked: ['implementation.logic_chain', 'implementation.changed_files', ...changedFiles],
      evidence: changedFiles.length
        ? changedFiles.map(file => ({ kind: 'file', path: file, summary: `changed_files contains and file exists: ${file}` }))
        : [{ kind: 'test', command: 'node tests/ceo-serial-lock.test.js', exit_code: 0, summary: 'non-delivery fixture has command evidence' }],
    },
  }, opts.review || {});
  const evidence = opts.evidence || [
    { type: 'result', path: `/tmp/${taskId}/implement-1/result.md` },
    { type: 'result', path: `/tmp/${taskId}/review-1/result.md` },
  ];
  writeJson(path.join(artifactsDir, 'engine-tasks', `${taskId}.json`), {
    id: taskId,
    flow: 'review-loop',
    state: 'done',
    node: 'done',
    vars: {
      goal: opts.goal || 'review-loop child task',
      acceptance: opts.acceptance || 'test acceptance',
      implementation,
      review,
    },
    evidence,
    visits: { implement: 1, review: 1 },
    steps: {
      'implement#1': {
        key: 'implement#1',
        node: 'implement',
        status: 'done',
        vars: { implementation },
        evidence: evidence[0],
      },
      'review#1': {
        key: 'review#1',
        node: 'review',
        status: 'done',
        vars: { review },
        evidence: evidence[1],
      },
    },
    completed_steps: ['implement#1', 'review#1'],
    last_completed_node: 'review',
    history: [],
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-ceo-lock-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const projectsDir = path.join(root, 'projects');
  const configPath = path.join(root, 'config.json');
  const lockFile = path.join(artifactsDir, 'active-ceo-task.lock.json');

  try {
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    writeJson(configPath, { runners: {}, roleRouting: {} });

    process.env.CONSOLE_ARTIFACTS_DIR = artifactsDir;
    process.env.CONSOLE_PROJECTS_DIR = projectsDir;
    process.env.CONSOLE_CONFIG_PATH = configPath;
    process.env.CONSOLE_BOARD_ROLLUP = path.join(root, 'board', 'status-rollup.md');
    process.env.AUTO_REPAIR_ENABLED = '0';
    process.env.QUEUE_AGENT = 'ceo';
    process.env.RUNNING_ENGINE_HEARTBEAT_STALE_MS = '50';
    process.env.ORPHAN_ENGINE_TERM_GRACE_MS = '10';
    process.env.RUNNING_SWEEP_MS = '50';
    process.env.PROJECT_ROUTE_CHILD_DISCOVERY_MS = '100';
    process.env.PROJECT_ROUTE_KNOWN_CHILD_MISSING_MS = '100';
    process.env.PROJECT_ROUTE_EVENT_WAKE_ENABLED = '1';
    process.env.PROJECT_ROUTE_ACTIVE_FALLBACK_MS = '1200';
    process.env.PROJECT_ROUTE_DISCOVERY_FALLBACK_MS = '100';
    process.env.YUTU6_DONE_GATE_EXECUTE = '0';

    const { _test } = require('../projects/控制台/ceo-worker');
    const resumedSpec = _test.makeSpec({
      id: 'resumeExisting',
      taskId: 'task-existing-review-loop',
      resumed_at: new Date().toISOString(),
      task: {
        role: 'orchestrator',
        flowId: 'project-route',
        projectId: '控制台',
        goal: 'resumed queue item must keep its taskstore id',
      },
    });
    assert.strictEqual(resumedSpec.taskId, 'task-existing-review-loop', 'resumed queue item must resume existing taskId');

    const queuedRootLock = _test.acquireActiveCeoTask({ id: 'rootQueued' }, {
      taskId: 'taskQueued',
      projectId: '控制台',
    });
    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root requeued after retry must not block later CEO tasks',
    }, { id: 'rootQueued', priority: 50 });
    assert.deepStrictEqual(
      _test.activeRootEntries(queuedRootLock).map(e => `${e.agent}:${e.queueId}:${e.status}`),
      [],
      'a root entry that is only queued again must not count as an active CEO task',
    );
    await Promise.race([
      _test.waitForCeoActiveTaskTurn({ id: 'nextAfterQueuedRoot' }),
      sleep(1000).then(() => { throw new Error('queued root lock blocked the next CEO task'); }),
    ]);
    assert.strictEqual(fs.existsSync(lockFile), false, 'queued root lock should be swept before next CEO task');
    Q.cancel(artifactsDir, 'ceo', 'rootQueued');

    const lock = _test.acquireActiveCeoTask({ id: 'rootA' }, {
      taskId: 'taskA',
      projectId: '控制台',
    });
    assert.strictEqual(lock.rootQueueAgent, 'ceo');
    assert.strictEqual(lock.rootQueueId, 'rootA');
    assert(fs.existsSync(lockFile), 'CEO active task lock was not written');

    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      goal: 'child task',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootA',
      rootTaskId: 'taskA',
    }, { id: 'childA', priority: 50 });

    const active = _test.activeRootEntries(lock);
    assert.deepStrictEqual(active.map(e => `${e.agent}:${e.queueId}:${e.status}`), [
      'supervisor-控制台:childA:queued',
    ]);

    let waitResolved = false;
    const wait = _test.waitForCeoActiveTaskTurn({ id: 'rootB' })
      .then(() => { waitResolved = true; });

    await sleep(120);
    assert.strictEqual(waitResolved, false, 'second CEO task should wait while descendant is active');

    const claimed = Q.claim(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(claimed.id, 'childA');
    seedReviewLoopTask(artifactsDir, 'childTaskA');
    Q.finish(artifactsDir, 'supervisor-控制台', 'childA', 'done', { result: 'ok' });

    await Promise.race([
      wait,
      sleep(2500).then(() => { throw new Error('timed out waiting for CEO lock release'); }),
    ]);
    assert.strictEqual(waitResolved, true);
    assert.strictEqual(fs.existsSync(lockFile), false, 'completed root lock should be swept');

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root should fail from child',
    }, { id: 'rootC', priority: 50 });
    const parent = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(parent.id, 'rootC');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      goal: 'child failure',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootC',
      rootTaskId: 'taskC',
    }, { id: 'childFail', priority: 50 });
    const failingChild = Q.claim(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(failingChild.id, 'childFail');
    Q.finish(artifactsDir, 'supervisor-控制台', 'childFail', 'failed', {
      taskId: 'childTask',
      error: 'child failed for propagation test',
    });
    const parentSpec = {
      taskId: 'taskC',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootC',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootC',
      rootTaskId: 'taskC',
      projectId: '控制台',
    };
    const downstream = await _test.waitForProjectRouteDownstream(parentSpec, parent);
    assert.strictEqual(downstream.status, 'failed');
    assert(/child failed/.test(downstream.reason), downstream.reason);
    _test.emitProjectRouteFinal(parentSpec, downstream);
    const propagationEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.task === 'taskC');
    assert(propagationEvents.some(e => e.type === 'task.failed' && e.downstreamQueueId === 'childFail'));
    assert(!propagationEvents.some(e => e.type === 'task.done'), 'failed child must not produce parent task.done');
    Q.finish(artifactsDir, 'ceo', 'rootC', 'failed', { error: downstream.reason });

    const missingRoot = await _test.waitForProjectRouteDownstream({
      taskId: 'taskMissingRoot',
      flowId: 'project-route',
      queueAgent: 'worker_code',
      queueId: 'missingRoot',
      projectId: '控制台',
    }, { id: 'missingRoot' });
    assert.strictEqual(missingRoot.status, 'failed');
    assert.match(missingRoot.reason, /缺少 rootQueue/);

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root should not match wrong-root child',
    }, { id: 'rootMismatch', priority: 50 });
    const rootMismatch = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootMismatch.id, 'rootMismatch');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      goal: 'wrong root child',
      rootQueueAgent: 'ceo',
      rootQueueId: 'otherRoot',
      rootTaskId: 'otherTask',
    }, { id: 'childWrongRoot', priority: 50 });
    const wrongChild = Q.claim(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(wrongChild.id, 'childWrongRoot');
    const mismatchSpec = {
      taskId: 'taskMismatch',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootMismatch',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootMismatch',
      rootTaskId: 'taskMismatch',
      projectId: '控制台',
    };
    const mismatch = await _test.waitForProjectRouteDownstream(mismatchSpec, rootMismatch);
    assert.strictEqual(mismatch.status, 'failed');
    assert.match(mismatch.reason, /未创建下游队列|root 关联无法匹配/);
    assert(!/childWrongRoot/.test(mismatch.reason), 'wrong-root child must not be reported as this root downstream');
    seedReviewLoopTask(artifactsDir, 'childWrongRootTask');
    Q.finish(artifactsDir, 'supervisor-控制台', 'childWrongRoot', 'done', { result: 'wrong root done' });
    Q.finish(artifactsDir, 'ceo', 'rootMismatch', 'failed', { error: mismatch.reason });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root must reject direct agent-once fake done',
    }, { id: 'rootDirectFake', priority: 50 });
    const rootDirectFake = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootDirectFake.id, 'rootDirectFake');
    Q.enqueue(artifactsDir, 'frontend_designer', {
      role: 'frontend_designer',
      flowId: 'agent-once',
      projectId: '控制台',
      goal: '修复 workspace.html 布局但绕过主管复审',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootDirectFake',
      rootTaskId: 'taskDirectFake',
    }, { id: 'directFakeChild', priority: 50 });
    Q.claim(artifactsDir, 'frontend_designer');
    Q.finish(artifactsDir, 'frontend_designer', 'directFakeChild', 'done', {
      taskId: 'taskDirectFakeChild',
      result: 'agent-once fake done',
    });
    const directFake = await _test.waitForProjectRouteDownstream({
      taskId: 'taskDirectFake',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootDirectFake',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootDirectFake',
      rootTaskId: 'taskDirectFake',
      projectId: '控制台',
    }, rootDirectFake);
    assert.strictEqual(directFake.status, 'failed');
    assert.match(directFake.reason, /不是主管队列|review-loop/);
    Q.finish(artifactsDir, 'ceo', 'rootDirectFake', 'failed', { error: directFake.reason });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root must reject review-loop done without delivery evidence',
    }, { id: 'rootNoEvidence', priority: 50 });
    const rootNoEvidence = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootNoEvidence.id, 'rootNoEvidence');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: '修复 workspace.html 布局',
      acceptance: '必须有 changed_files 或截图证据',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootNoEvidence',
      rootTaskId: 'taskNoEvidence',
    }, { id: 'noEvidenceChild', priority: 50 });
    Q.claim(artifactsDir, 'supervisor-控制台');
    seedReviewLoopTask(artifactsDir, 'taskNoEvidenceChild', {
      goal: '修复 workspace.html 布局',
      acceptance: '必须有 changed_files 或截图证据',
      changedFiles: [],
    });
    Q.finish(artifactsDir, 'supervisor-控制台', 'noEvidenceChild', 'done', {
      taskId: 'taskNoEvidenceChild',
      result: 'fake review-loop done without evidence',
    });
    const noEvidence = await _test.waitForProjectRouteDownstream({
      taskId: 'taskNoEvidence',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootNoEvidence',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootNoEvidence',
      rootTaskId: 'taskNoEvidence',
      projectId: '控制台',
    }, rootNoEvidence);
    assert.strictEqual(noEvidence.status, 'failed');
    assert.match(noEvidence.reason, /缺少 changed_files|交付证据/);
    Q.finish(artifactsDir, 'ceo', 'rootNoEvidence', 'failed', { error: noEvidence.reason });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root must reject report wrapper with delivery merge injection',
    }, { id: 'rootMergeInjected', priority: 50 });
    const rootMergeInjected = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootMergeInjected.id, 'rootMergeInjected');
    const injectedGoal = [
      '质量审查报告: 外层是只读审查,但合并块里是必须落地的实现内容。',
      '',
      '———(合并:merged-ui-fix)———',
      '',
      '修复 workspace.html 布局,新增办公室页面,并用 Peekaboo 截图逐项验收。',
    ].join('\n');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: injectedGoal,
      acceptance: '外层报告不应绕过合并块交付门;合并块必须有 changed_files 或截图证据',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootMergeInjected',
      rootTaskId: 'taskMergeInjected',
    }, { id: 'mergeInjectedChild', priority: 50 });
    Q.claim(artifactsDir, 'supervisor-控制台');
    seedReviewLoopTask(artifactsDir, 'taskMergeInjectedChild', {
      goal: injectedGoal,
      acceptance: '外层报告不应绕过合并块交付门;合并块必须有 changed_files 或截图证据',
      changedFiles: [],
    });
    Q.finish(artifactsDir, 'supervisor-控制台', 'mergeInjectedChild', 'done', {
      taskId: 'taskMergeInjectedChild',
      result: 'fake review-loop done without merged delivery evidence',
    });
    const mergeInjected = await _test.waitForProjectRouteDownstream({
      taskId: 'taskMergeInjected',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootMergeInjected',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootMergeInjected',
      rootTaskId: 'taskMergeInjected',
      projectId: '控制台',
    }, rootMergeInjected);
    assert.strictEqual(mergeInjected.status, 'failed');
    assert.match(mergeInjected.reason, /缺少 changed_files|交付证据/);
    Q.finish(artifactsDir, 'ceo', 'rootMergeInjected', 'failed', { error: mergeInjected.reason });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root must reject review pass false fake done',
    }, { id: 'rootReviewFalse', priority: 50 });
    const rootReviewFalse = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootReviewFalse.id, 'rootReviewFalse');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: '修复 shared/engine 假完成门禁',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootReviewFalse',
      rootTaskId: 'taskReviewFalse',
    }, { id: 'reviewFalseChild', priority: 50 });
    Q.claim(artifactsDir, 'supervisor-控制台');
    seedReviewLoopTask(artifactsDir, 'taskReviewFalseChild', {
      goal: '修复 shared/engine 假完成门禁',
      changedFiles: ['projects/控制台/ceo-worker.js'],
      review: { pass: false, severity: 'medium', notes: '目标未达成' },
    });
    Q.finish(artifactsDir, 'supervisor-控制台', 'reviewFalseChild', 'done', {
      taskId: 'taskReviewFalseChild',
      result: 'fake review false done',
    });
    const reviewFalse = await _test.waitForProjectRouteDownstream({
      taskId: 'taskReviewFalse',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootReviewFalse',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootReviewFalse',
      rootTaskId: 'taskReviewFalse',
      projectId: '控制台',
    }, rootReviewFalse);
    assert.strictEqual(reviewFalse.status, 'failed');
    assert.match(reviewFalse.reason, /review\.pass 未通过/);
    Q.finish(artifactsDir, 'ceo', 'rootReviewFalse', 'failed', { error: reviewFalse.reason });

    Q.enqueue(artifactsDir, 'ceo', {
      role: 'orchestrator',
      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root waits for long running child',
    }, { id: 'rootLong', priority: 50 });
    const rootLong = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootLong.id, 'rootLong');
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'long child with top-level root fields only',
    }, { id: 'childLong', priority: 50 });
    const childLong = Q.claim(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(childLong.id, 'childLong');
    const childLongFile = path.join(artifactsDir, 'queues', 'supervisor-控制台', 'running', 'childLong.json');
    const childLongEntry = JSON.parse(fs.readFileSync(childLongFile, 'utf8'));
    Object.assign(childLongEntry, {
      taskId: 'taskChildLong',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootLong',
      rootTaskId: 'taskLong',
      engine_started_at: new Date().toISOString(),
      engine_heartbeat_at: new Date().toISOString(),
    });
    writeJson(childLongFile, childLongEntry);
    const longSpec = {
      taskId: 'taskLong',
      flowId: 'project-route',
      queueAgent: 'ceo',
      queueId: 'rootLong',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootLong',
      rootTaskId: 'taskLong',
      projectId: '控制台',
    };
    let longResolved = false;
    const longWait = _test.waitForProjectRouteDownstream(longSpec, rootLong)
      .then(result => {
        longResolved = true;
        return result;
      });
    await sleep(150);
    assert.strictEqual(longResolved, false, 'project-route parent must keep waiting while downstream is still running');
    seedReviewLoopTask(artifactsDir, 'taskChildLong');
    const finishedAt = Date.now();
    Q.finish(artifactsDir, 'supervisor-控制台', 'childLong', 'done', {
      taskId: 'taskChildLong',
      result: 'ok',
    });
    new EventLog(path.join(artifactsDir, 'engine-events.jsonl')).emit('queue.completed', {
      queueAgent: 'supervisor-控制台',
      queueId: 'childLong',
      task: 'taskChildLong',
      ok: true,
      status: 'done',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootLong',
      rootTaskId: 'taskLong',
    });
    const longDownstream = await Promise.race([
      longWait,
      sleep(2500).then(() => { throw new Error('timed out waiting for long downstream result'); }),
    ]);
    assert.strictEqual(longDownstream.status, 'done');
    assert.strictEqual(longDownstream.entries[0].queueId, 'childLong');
    const eventWakeElapsedMs = Date.now() - finishedAt;
    const waitSummaryEvents = fs.readFileSync(path.join(artifactsDir, 'engine-events.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(e => e.type === 'project.route.wait.summary' && e.rootQueueId === 'rootLong');
    assert(waitSummaryEvents.some(e => e.eventWakeCount >= 1), 'project-route wait summary must record event wakeups');
    assert(
      eventWakeElapsedMs < 1100,
      `project-route downstream event wake took ${eventWakeElapsedMs}ms and did not beat the 1200ms fallback poll`,
    );
    Q.finish(artifactsDir, 'ceo', 'rootLong', 'done', { downstream: { downstreamQueueId: 'childLong' } });

    let fakeEngine = null;
    try {
      fakeEngine = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'engine-runner.js'], {
        stdio: 'ignore',
      });
      await sleep(80);

      Q.enqueue(artifactsDir, 'ceo', {
        role: 'orchestrator',
        flowId: 'review-loop',
        projectId: '控制台',
        goal: 'stale heartbeat with alive-looking engine pid',
      }, { id: 'stalePidAlive', priority: 10 });
      const stale = Q.claim(artifactsDir, 'ceo');
      assert.strictEqual(stale.id, 'stalePidAlive');
      const staleFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'stalePidAlive.json');
      const staleEntry = JSON.parse(fs.readFileSync(staleFile, 'utf8'));
      const old = new Date(Date.now() - 60 * 1000).toISOString();
      staleEntry.enginePid = fakeEngine.pid;
      staleEntry.engine_started_at = old;
      staleEntry.engine_heartbeat_at = old;
      writeJson(staleFile, staleEntry);

      await _test.sweepStaleRunning();
      const staleList = Q.list(artifactsDir, 'ceo');
      assert(!staleList.running.some(e => e.id === 'stalePidAlive'), 'heartbeat-stale task should leave running');
      const requeuedStale = staleList.queued.find(e => e.id === 'stalePidAlive');
      assert(requeuedStale, 'heartbeat-stale task should be requeued');
      assert.strictEqual(requeuedStale.retry, 1);
      assert.match(requeuedStale.recovered_reason, /engine_heartbeat_at/);
      Q.cancel(artifactsDir, 'ceo', 'stalePidAlive');
	    } finally {
	      if (fakeEngine && fakeEngine.pid) {
	        try { process.kill(fakeEngine.pid, 'SIGKILL'); } catch (_) {}
	      }
	    }

	    Q.enqueue(artifactsDir, 'ceo', {
	      role: 'orchestrator',
	      flowId: 'project-route',
	      projectId: '控制台',
	      goal: 'stale parent should wait for active downstream',
	    }, { id: 'rootWait', priority: 10 });
	    const rootWait = Q.claim(artifactsDir, 'ceo');
	    assert.strictEqual(rootWait.id, 'rootWait');
	    const rootWaitFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'rootWait.json');
	    const rootWaitEntry = JSON.parse(fs.readFileSync(rootWaitFile, 'utf8'));
	    const staleParentHeartbeat = new Date(Date.now() - 60 * 1000).toISOString();
	    Object.assign(rootWaitEntry, {
	      taskId: 'taskWait',
	      flowId: 'project-route',
	      rootQueueAgent: 'ceo',
	      rootQueueId: 'rootWait',
	      rootTaskId: 'taskWait',
	      engine_heartbeat_at: staleParentHeartbeat,
	    });
	    delete rootWaitEntry.waiting_downstream;
	    writeJson(rootWaitFile, rootWaitEntry);
	    Q.enqueue(artifactsDir, 'supervisor-控制台', {
	      role: 'supervisor',
	      flowId: 'review-loop',
	      projectId: '控制台',
	      goal: 'active downstream child',
	      rootQueueAgent: 'ceo',
	      rootQueueId: 'rootWait',
	      rootTaskId: 'taskWait',
	    }, { id: 'childActive', priority: 50 });
	    const activeChild = Q.claim(artifactsDir, 'supervisor-控制台');
	    assert.strictEqual(activeChild.id, 'childActive');
	    const activeChildFile = path.join(artifactsDir, 'queues', 'supervisor-控制台', 'running', 'childActive.json');
	    const activeChildEntry = JSON.parse(fs.readFileSync(activeChildFile, 'utf8'));
	    Object.assign(activeChildEntry, {
	      taskId: 'childActiveTask',
	      engine_started_at: new Date().toISOString(),
	      engine_heartbeat_at: new Date(Date.now() + 10 * 1000).toISOString(),
	    });
	    writeJson(activeChildFile, activeChildEntry);

	    await _test.sweepStaleRunning();
	    let waitState = Q.list(artifactsDir, 'ceo');
	    assert(waitState.running.some(e => e.id === 'rootWait'), 'waiting parent with active downstream should remain running');
	    assert(!waitState.queued.some(e => e.id === 'rootWait'), 'waiting parent with active downstream must not be requeued');
	    const touchedWaitEntry = JSON.parse(fs.readFileSync(rootWaitFile, 'utf8'));
	    assert.strictEqual(touchedWaitEntry.waiting_downstream, true, 'sweep should restore waiting_downstream marker');
	    assert(Date.parse(touchedWaitEntry.engine_heartbeat_at) > Date.parse(staleParentHeartbeat), 'waiting parent heartbeat should be renewed');
	    assert.strictEqual(touchedWaitEntry.downstream_inflight_count, 1);

	    seedReviewLoopTask(artifactsDir, 'childActiveTask');
	    Q.finish(artifactsDir, 'supervisor-控制台', 'childActive', 'done', {
	      taskId: 'childActiveTask',
	      result: 'ok',
	    });
	    await _test.sweepStaleRunning();
	    waitState = Q.list(artifactsDir, 'ceo');
	    assert(!waitState.running.some(e => e.id === 'rootWait'), 'waiting parent should leave running after downstream done');
	    assert(!waitState.queued.some(e => e.id === 'rootWait'), 'waiting parent should not be requeued after downstream done');
	    assert(fs.existsSync(path.join(artifactsDir, 'queues', 'ceo', 'done', 'rootWait.json')), 'waiting parent should finish done after downstream done');

	    Q.enqueue(artifactsDir, 'ceo', {
	      role: 'orchestrator',
	      flowId: 'project-route',
      projectId: '控制台',
      goal: 'root already has terminal downstream',
    }, { id: 'rootDone', priority: 10 });
    const rootDone = Q.claim(artifactsDir, 'ceo');
    assert.strictEqual(rootDone.id, 'rootDone');
    const rootDoneFile = path.join(artifactsDir, 'queues', 'ceo', 'running', 'rootDone.json');
    const rootDoneEntry = JSON.parse(fs.readFileSync(rootDoneFile, 'utf8'));
    Object.assign(rootDoneEntry, {
      taskId: 'taskDone',
      flowId: 'project-route',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootDone',
      rootTaskId: 'taskDone',
      waiting_downstream: true,
      engine_heartbeat_at: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    writeJson(rootDoneFile, rootDoneEntry);
    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      goal: 'already terminal child',
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootDone',
      rootTaskId: 'taskDone',
    }, { id: 'childDone', priority: 50 });
    Q.claim(artifactsDir, 'supervisor-控制台');
    seedReviewLoopTask(artifactsDir, 'childDoneTask');
    Q.finish(artifactsDir, 'supervisor-控制台', 'childDone', 'done', {
      taskId: 'childDoneTask',
      result: 'ok',
    });
    _test.acquireActiveCeoTask({ id: 'rootDone' }, {
      taskId: 'taskDone',
      projectId: '控制台',
    });

    await Promise.race([
      _test.waitForCeoActiveTaskTurn({ id: 'afterRootDone' }),
      sleep(1500).then(() => { throw new Error('timed out waiting for stale project-route parent sweep'); }),
    ]);
    assert.strictEqual(fs.existsSync(lockFile), false, 'stale project-route parent lock should be released');
    assert(!Q.list(artifactsDir, 'ceo').running.some(e => e.id === 'rootDone'), 'stale project-route parent should leave running');
    assert(fs.existsSync(path.join(artifactsDir, 'queues', 'ceo', 'done', 'rootDone.json')), 'stale project-route parent should be finished done');

    const nextLock = _test.acquireActiveCeoTask({ id: 'rootB' }, {
      taskId: 'taskB',
      projectId: '控制台',
    });
    assert.strictEqual(nextLock.rootQueueId, 'rootB');
    assert.strictEqual(_test.sameActiveRoot(nextLock, {
      rootQueueAgent: 'ceo',
      rootQueueId: 'rootB',
    }), true);

    console.log(JSON.stringify({ pass: true, suite: 'ceo-serial-lock' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
