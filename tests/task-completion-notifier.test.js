'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Notifier = require('../projects/控制台/tools/task-completion-notifier');

function rootSpec(overrides = {}) {
  return Object.assign({
    queueAgent: 'ceo',
    queueId: 'a1b2c3d4',
    taskId: 'cr-100-a1b2c3d4',
    rootQueueAgent: 'ceo',
    rootQueueId: 'a1b2c3d4',
    rootTaskId: 'cr-100-a1b2c3d4',
    parentTaskId: null,
    projectId: '控制台',
    goal: '修复任务完成通知，让主人能在元宵快速看懂背景、处理方式与风险。',
  }, overrides);
}

function evidence(overrides = {}) {
  return Object.assign({
    implementation: {
      changed_files: ['projects/控制台/ceo-worker.js', 'tests/task-completion-notifier.test.js'],
      tests: ['node tests/task-completion-notifier.test.js'],
    },
    review: { pass: true, notes: '真实文件与测试均已核对。' },
    changedFiles: ['projects/控制台/ceo-worker.js', 'tests/task-completion-notifier.test.js'],
    summary: '已接入真实 done 出口，并增加异步去重投递。',
  }, overrides);
}

function run() {
  const spec = rootSpec();
  const notice = Notifier.buildCompletionNotice(spec, evidence());
  assert.strictEqual(Notifier.isOwnerVisibleCompletion(spec), true);
  assert.strictEqual(notice.taskNumber, 'a1b2c3d4');
  assert.strictEqual(notice.title, '任务完成-通知优化');
  assert.match(notice.body, /^# 任务完成-通知优化\n\n/);
  assert(!notice.body.includes('#a1b2c3d4'), 'internal task number must stay out of owner-visible copy');
  for (const label of [
    '**背景**',
    '**结果**',
    '**处理**',
    '| # | 标题 | 内容 | 状态 |',
    '| 反思一 | 我最没把握的事 |',
    '| 反思二 | 我（主人）没想全面的事 |',
  ]) {
    assert(notice.body.includes(label), `notice must include ${label}`);
  }
  assert(
    notice.body.includes('**背景**\n') && notice.body.includes('\n\n**结果**\n'),
    'summary sections must preserve whitespace for fast mobile scanning'
  );
  assert(
    Notifier.codePointLength(`${notice.title}\n${notice.body}`) <= Notifier.MAX_TOTAL_CHARS,
    'title plus body must stay within 300 characters'
  );

  const repairNotice = Notifier.buildCompletionNotice(
    rootSpec({
      queueAgent: 'repair',
      rootQueueAgent: 'repair',
      goal: '维修工单 auto-20260728-format：修复元宵任务完成摘要，使标题可快速识别且不显示内部编号。',
    }),
    evidence()
  );
  assert.strictEqual(repairNotice.title, '任务完成-维修工单');
  assert(repairNotice.body.includes('修复元宵任务完成摘要'));
  assert(!repairNotice.body.includes('auto-20260728-format'));

  const pageNotice = Notifier.buildCompletionNotice(
    rootSpec({ goal: '调整工作区页面布局，让进行中的任务可以完整滚动显示。' }),
    evidence()
  );
  assert.strictEqual(pageNotice.title, '任务完成-页面修改');

  const child = rootSpec({
    queueAgent: 'supervisor-控制台',
    queueId: 'child-1',
    taskId: 'cr-101-child-1',
    parentTaskId: spec.taskId,
  });
  assert.strictEqual(Notifier.isOwnerVisibleCompletion(child), false, 'downstream nodes must not duplicate the root notice');
  assert.strictEqual(
    Notifier.isOwnerVisibleCompletion(rootSpec({ taskId: 'cr-101-retry', rootTaskId: spec.taskId })),
    true,
    'a retried root task must keep the original root identity without losing its completion notice'
  );

  const fakeSecret = ['should', 'not', 'leak'].join('-');
  const fakeApiAssignment = `${['API', 'KEY'].join('_')}=${fakeSecret}`;
  const longNotice = Notifier.buildCompletionNotice(
    rootSpec({
      goal: `${fakeApiAssignment} ${'很长的背景说明'.repeat(80)}`,
    }),
    evidence({
      summary: `${'很长的任务结果'.repeat(80)} ${['token', fakeSecret].join('=')}`,
    })
  );
  assert(Notifier.codePointLength(`${longNotice.title}\n${longNotice.body}`) <= 300);
  assert(!longNotice.body.includes(fakeSecret), 'notification must redact obvious secret assignments');
  const noBuildNotice = Notifier.buildCompletionNotice(
    rootSpec({ goal: '同步远端主分支；只做代码核对，不构建、不发布。' }),
    evidence({ summary: '已完成代码同步与差异复核。' })
  );
  assert(
    !noBuildNotice.body.includes('构建完成不等于'),
    'a forbidden build mentioned in constraints must not be reported as a completed build'
  );

  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-completion-notifier-'));
  try {
    const queued = Notifier.enqueueCompletion(spec, evidence(), {
      artifactsRoot,
      spawn: false,
    });
    assert.strictEqual(queued.queued, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(queued.file, 'utf8')).status, 'pending');

    let sends = 0;
    const first = Notifier.deliverJobFile(queued.file, payload => {
      sends += 1;
      assert.strictEqual(payload.category, 'task-completion');
      assert.strictEqual(payload['dedupe-key'], queued.notice.dedupeKey);
      return { ok: true, code: 200, receiptId: 'msg_completion_1' };
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(sends, 1);

    const replay = Notifier.deliverJobFile(queued.file, () => {
      sends += 1;
      return { ok: true, code: 200 };
    });
    assert.strictEqual(replay.duplicate, true);
    assert.strictEqual(sends, 1, 'replayed completion must not send twice');

    const enqueueReplay = Notifier.enqueueCompletion(spec, evidence(), {
      artifactsRoot,
      spawn: false,
    });
    assert.strictEqual(enqueueReplay.duplicate, true);
    assert.strictEqual(enqueueReplay.queued, false);

    const retrySpec = rootSpec({
      queueId: 'retry123',
      taskId: 'cr-200-retry123',
      rootQueueId: 'retry123',
      rootTaskId: 'cr-200-retry123',
    });
    const retryJob = Notifier.enqueueCompletion(retrySpec, evidence(), {
      artifactsRoot,
      spawn: false,
    });
    const failed = Notifier.deliverJobFile(retryJob.file, () => {
      throw new Error('temporary connection failure');
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(JSON.parse(fs.readFileSync(retryJob.file, 'utf8')).status, 'failed');
    const recovered = Notifier.deliverJobFile(retryJob.file, () => ({
      ok: true,
      code: 200,
      receiptId: 'msg_completion_retry',
    }));
    assert.strictEqual(recovered.ok, true, 'temporary delivery failure must remain retryable');

    const childQueued = Notifier.enqueueCompletion(child, evidence(), {
      artifactsRoot,
      spawn: false,
    });
    assert.strictEqual(childQueued.skipped, true);
    assert.strictEqual(childQueued.reason, 'not-owner-visible-root');
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }

  console.log('task-completion-notifier: PASS');
}

run();
