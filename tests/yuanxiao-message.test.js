'use strict';

const assert = require('assert');
const Message = require('../projects/控制台/tools/notify-yuanxiao-message');

function run() {
  const payload = Message.buildPayload({
    project: 'Simulaid',
    title: '改动结果测试',
    body: 'v1.15.18 改动结果',
    'dedupe-key': 'simulaid-v1.15.18-test',
  });
  assert.strictEqual(payload.project, 'Simulaid');
  assert.strictEqual(payload.title, '改动结果测试');
  assert.strictEqual(payload.category, 'project-update');
  assert.strictEqual(payload.dedupe_key, 'simulaid-v1.15.18-test');

  let captured = null;
  const result = Message.send({
    project: 'Simulaid',
    title: '改动结果测试',
    body: '正文',
  }, value => {
    captured = value;
    return { ok: true, code: 200, receiptId: 'msg_test' };
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.receiptId, 'msg_test');
  assert.strictEqual(captured.source, 'yutu6-project-update');
  assert.ok(captured.dedupe_key);

  const progress = Message.buildTypedCard({
    'card-type': 'progress',
    'task-id': 'task-progress-1',
    title: '构建进度',
    body: '正在执行 Android 单元测试',
    stage: '测试',
    progress: '67',
  });
  assert.strictEqual(progress.task.status, 'running');
  assert.strictEqual(progress.card.card_type, 'progress');
  assert.strictEqual(progress.card.payload.progress, 67);

  const failure = Message.buildTypedCard({
    'card-type': 'failure',
    'task-id': 'task-failure-1',
    title: '构建失败',
    body: 'Gradle 构建未完成',
    reason: '依赖下载中断',
    evidence: 'build.log:42',
    owner: '移动端开发',
  });
  assert.strictEqual(failure.task.status, 'failed');
  assert.strictEqual(failure.card.card_type, 'failure');
  assert.deepStrictEqual(failure.card.actions.map(action => action.id), ['retry', 'create_repair']);

  const typedCalls = [];
  const native = Message.send({
    'card-type': 'progress',
    'task-id': 'task-progress-2',
    title: '原生进度卡',
    body: '正在复核',
    progress: '88',
  }, () => ({ ok: true, code: 200, receiptId: 'msg_native' }), (apiPath, value) => {
    typedCalls.push({ apiPath, value });
    return { ok: true, code: 200 };
  });
  assert.strictEqual(native.nativeCard, true);
  assert.deepStrictEqual(typedCalls.map(call => call.apiPath), ['/api/v1/tasks', '/api/v1/cards']);
  console.log('yuanxiao-message: PASS');
}

run();
