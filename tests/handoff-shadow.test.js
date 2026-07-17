#!/usr/bin/env node
'use strict';
/*
 * 交接文件夹机制 shadow 阶段回归(拍板①②修正版):
 * 1) auto(默认)写三件套,长 CLI 目标指针化;shadow 显式保持全文;
 * 2) on 模式 CLI runner 信封含指针(路径+指纹+先读指令),体积显著小于全文,验收表仍完整内联;
 * 3) 指纹不符回退全文 + handoff.fallback 事件;
 * 4) openai_http 不受影响(全文,且不发 fallback);
 * 5) off 完全无动作;board_* 角色排除。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 信封结构测试:关掉知识库注入,避免 spawn python + 非确定性内容
process.env.YUTU6_KB_INJECT = '0';
delete process.env.YUTU6_HANDOFF_MODE;

const Handoff = require('../shared/engine/handoff');
const { buildEnvelope } = require('../shared/engine/cli-runner');
const EventLog = require('../shared/engine/eventlog');
const engineRunnerTest = require('../projects/控制台/engine-runner.js')._test;

const CLI_RUNNER = { cmd: ['codex', 'exec'], promptVia: 'arg' };
const HTTP_RUNNER = { kind: 'openai_http', baseUrl: 'http://127.0.0.1:1', model: 'glm-5.2' };
const NODE = { id: 'implement', agent_role: 'worker_code' };

function mkCtx(overrides) {
  return Object.assign({
    goal: [
      '优化工作区渲染:首行一句话意图',
      '细节说明:' + 'x'.repeat(20000),
    ].join('\n'),
    bounds: '只处理本任务; 密钥不回显; 高危操作先确认',
    acceptance: [
      '结构化验收表',
      '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |',
      '|---|---|---|---|',
      '| 任务验收: handoff-shadow-demo-要点-逐字锚点 | 未完成 | | |',
    ].join('\n'),
    taskId: 'handoff-task-1',
    projectId: '控制台',
    spec_fingerprint: 'task-protocol-spec-1',
    visual_acceptance: {
      schema: 'visual-acceptance@1',
      acceptance_protocol: 'structured-acceptance@2',
      state: 'not_applicable',
      required: false,
      source: 'task_type',
    },
  }, overrides || {});
}

function withHandoffMode(value, fn) {
  const prev = process.env.YUTU6_HANDOFF_MODE;
  if (value == null) delete process.env.YUTU6_HANDOFF_MODE;
  else process.env.YUTU6_HANDOFF_MODE = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.YUTU6_HANDOFF_MODE;
    else process.env.YUTU6_HANDOFF_MODE = prev;
  }
}

function eventsOf(eventlog, type) {
  return eventlog.since(0).filter(e => e.type === type);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-shadow-test-'));
  try {
    // ---- 开关语义 ----
    assert.strictEqual(Handoff.mode({}), 'auto', '默认应为 auto');
    assert.strictEqual(Handoff.mode({ YUTU6_HANDOFF_MODE: 'auto' }), 'auto');
    assert.strictEqual(Handoff.mode({ YUTU6_HANDOFF_MODE: 'on' }), 'on');
    assert.strictEqual(Handoff.mode({ YUTU6_HANDOFF_MODE: 'off' }), 'off');
    assert.strictEqual(Handoff.mode({ YUTU6_HANDOFF_MODE: 'weird' }), 'auto', '非法值回落 auto');
    assert.strictEqual(Handoff.isEnabled({ YUTU6_HANDOFF_MODE: 'off' }), false);
    assert.strictEqual(Handoff.isEnabled({}), true);

    // ---- 1) shadow:写三件套且信封不变 ----
    const runsDir1 = path.join(root, 'engine-runs', 'handoff-task-1');
    fs.mkdirSync(runsDir1, { recursive: true });
    const eventlog1 = new EventLog(path.join(root, 'events-shadow.jsonl'));
    const ctx1 = mkCtx();
    const spec1 = {
      taskId: 'handoff-task-1',
      queueAgent: 'supervisor-控制台',
      queueId: 'q-1',
      rootQueueAgent: 'ceo',
      role: 'supervisor',
      projectId: '控制台',
    };
    const doc1 = withHandoffMode(null, () => engineRunnerTest.writeHandoffShadow({
      spec: spec1, ctx: ctx1, runsDir: runsDir1, eventlog: eventlog1, taskId: 'handoff-task-1',
    }));
    assert(doc1 && doc1.fingerprint, 'shadow 应写任务稿并返回指纹');
    const taskDoc = fs.readFileSync(path.join(runsDir1, 'task.md'), 'utf8');
    assert.match(taskDoc, /## 目标/);
    assert(taskDoc.includes(ctx1.goal), '任务稿必须含 goal 全文');
    assert(taskDoc.includes(ctx1.bounds), '任务稿必须含 bounds');
    assert(taskDoc.includes(ctx1.acceptance), '任务稿必须含验收(含结构化验收表)');
    assert.match(taskDoc, /## 视觉验收分类审计/);
    assert.match(taskDoc, /"state": "not_applicable"/);
    const meta1 = JSON.parse(fs.readFileSync(path.join(runsDir1, 'meta.json'), 'utf8'));
    assert.strictEqual(meta1.taskId, 'handoff-task-1');
    assert.strictEqual(meta1.queueAgent, 'supervisor-控制台');
    assert.strictEqual(meta1.queueId, 'q-1');
    assert.strictEqual(meta1.from, 'ceo');
    assert.strictEqual(meta1.to, 'supervisor-控制台');
    assert.strictEqual(meta1.spec_fingerprint, ctx1.spec_fingerprint);
    assert.strictEqual(meta1.task_document_fingerprint, doc1.fingerprint);
    assert.deepStrictEqual(meta1.visual_acceptance, ctx1.visual_acceptance);
    assert(Array.isArray(meta1.attempts), 'meta.attempts 必须是数组');
    const written = eventsOf(eventlog1, 'handoff.shadow.written');
    assert.strictEqual(written.length, 1, '应 emit handoff.shadow.written');
    assert.strictEqual(written[0].fingerprint, doc1.fingerprint);
    assert.strictEqual(written[0].mode, 'auto');
    // readTaskDoc 指纹校验通过
    const read1 = Handoff.readTaskDoc(runsDir1, { spec_fingerprint: ctx1.spec_fingerprint });
    assert(read1.ok, `readTaskDoc 应通过: ${read1.reason || ''}`);
    assert.strictEqual(read1.fingerprint, doc1.fingerprint);
    // shadow 模式信封与不带 handoff 参数的信封逐字一致(信封不变)
    const plainEnvelope = buildEnvelope(NODE, ctx1);
    const shadowEnvelope = withHandoffMode('shadow', () => buildEnvelope(NODE, ctx1, {
      runner: CLI_RUNNER, runsDir: runsDir1, eventlog: eventlog1, taskId: 'handoff-task-1',
    }));
    assert.strictEqual(shadowEnvelope, plainEnvelope, 'shadow 模式信封必须与现状全文信封一致');
    assert(shadowEnvelope.includes(ctx1.goal), 'shadow 信封含 goal 全文');
    assert(!shadowEnvelope.includes('任务稿指针'), 'shadow 信封不得含指针');

    const autoEnvelope = withHandoffMode(null, () => buildEnvelope(NODE, ctx1, {
      runner: CLI_RUNNER, runsDir: runsDir1, eventlog: eventlog1, taskId: 'handoff-task-1',
    }));
    assert(autoEnvelope.includes('任务稿指针'), 'auto 模式应指针化长 CLI 目标');
    const shortCtx = mkCtx({ goal: '短任务目标' });
    const shortDoc = Handoff.writeTaskDoc(runsDir1, shortCtx);
    Handoff.writeMeta(runsDir1, {
      taskId: shortCtx.taskId,
      spec_fingerprint: shortCtx.spec_fingerprint,
      task_document_fingerprint: shortDoc.fingerprint,
    });
    const autoShortEnvelope = withHandoffMode(null, () => buildEnvelope(NODE, shortCtx, {
      runner: CLI_RUNNER, runsDir: runsDir1, eventlog: eventlog1, taskId: shortCtx.taskId,
    }));
    assert(!autoShortEnvelope.includes('任务稿指针'), 'auto 模式短目标保持全文');
    assert(autoShortEnvelope.includes('短任务目标'));
    const restoredDoc = Handoff.writeTaskDoc(runsDir1, ctx1);
    Handoff.writeMeta(runsDir1, {
      taskId: ctx1.taskId,
      spec_fingerprint: ctx1.spec_fingerprint,
      task_document_fingerprint: restoredDoc.fingerprint,
    });

    // ---- 2) on 模式 CLI runner:指针信封,体积显著小于全文 ----
    const eventlog2 = new EventLog(path.join(root, 'events-on.jsonl'));
    const onEnvelope = withHandoffMode('on', () => buildEnvelope(NODE, ctx1, {
      runner: CLI_RUNNER, runsDir: runsDir1, eventlog: eventlog2, taskId: 'handoff-task-1',
    }));
    assert(onEnvelope.includes('任务稿指针'), 'on 信封必须含指针');
    assert(onEnvelope.includes(path.join(runsDir1, 'task.md')), '指针必须是完整路径');
    assert(onEnvelope.includes(restoredDoc.fingerprint), '指针必须带 fingerprint');
    assert.match(onEnvelope, /先完整读取.*task\.md/, '必须有「先读该文件再执行」指令');
    assert(onEnvelope.includes('优化工作区渲染:首行一句话意图'), '必须保留一句话意图(goal 首行)');
    assert(!onEnvelope.includes('x'.repeat(2000)), 'goal 长正文不得内联');
    assert(onEnvelope.includes(ctx1.acceptance), '验收表必须仍完整内联(done-gate 逐字锚点)');
    assert(onEnvelope.length < plainEnvelope.length * 0.5,
      `on 信封应显著小于全文: on=${onEnvelope.length} full=${plainEnvelope.length}`);
    assert.strictEqual(eventsOf(eventlog2, 'handoff.fallback').length, 0, '成功指针化不应 emit fallback');
    // ctx 本体不受指针化影响(done-gate/资源锁/路由文本判据)
    assert(ctx1.goal.includes('x'.repeat(2000)), 'ctx.goal 必须保留全文');

    // ---- 3) 指纹不符:回退全文 + handoff.fallback 事件 ----
    const runsDir3 = path.join(root, 'engine-runs', 'handoff-task-3');
    const ctx3 = mkCtx({ taskId: 'handoff-task-3' });
    const doc3 = Handoff.writeTaskDoc(runsDir3, ctx3);
    Handoff.writeMeta(runsDir3, {
      taskId: 'handoff-task-3',
      spec_fingerprint: ctx3.spec_fingerprint,
      task_document_fingerprint: doc3.fingerprint,
    });
    fs.appendFileSync(path.join(runsDir3, 'task.md'), '\n被篡改的尾巴\n');
    const badRead = Handoff.readTaskDoc(runsDir3);
    assert(!badRead.ok && /fingerprint_mismatch/.test(badRead.reason), '篡改后 readTaskDoc 必须报指纹不符');
    const eventlog3 = new EventLog(path.join(root, 'events-mismatch.jsonl'));
    const mismatchEnvelope = withHandoffMode('on', () => buildEnvelope(NODE, ctx3, {
      runner: CLI_RUNNER, runsDir: runsDir3, eventlog: eventlog3, taskId: 'handoff-task-3',
    }));
    assert(mismatchEnvelope.includes(ctx3.goal), '指纹不符必须回退全文');
    assert(!mismatchEnvelope.includes('任务稿指针'), '指纹不符不得指针化');
    const fallbacks = eventsOf(eventlog3, 'handoff.fallback');
    assert.strictEqual(fallbacks.length, 1, '指纹不符必须 emit handoff.fallback');
    assert.match(fallbacks[0].reason, /fingerprint_mismatch/);
    assert.strictEqual(fallbacks[0].stage, 'envelope');

    // task.md 缺失(读失败)同样回退全文 + fallback
    const runsDirMissing = path.join(root, 'engine-runs', 'handoff-task-missing');
    fs.mkdirSync(runsDirMissing, { recursive: true });
    const eventlogMissing = new EventLog(path.join(root, 'events-missing.jsonl'));
    const missingEnvelope = withHandoffMode('on', () => buildEnvelope(NODE, ctx3, {
      runner: CLI_RUNNER, runsDir: runsDirMissing, eventlog: eventlogMissing, taskId: 'handoff-task-3',
    }));
    assert(missingEnvelope.includes(ctx3.goal), 'task.md 缺失必须回退全文');
    assert.strictEqual(eventsOf(eventlogMissing, 'handoff.fallback').length, 1, 'task.md 缺失必须 emit fallback');

    // ---- 4) openai_http / tool-harness 不受影响 ----
    const eventlog4 = new EventLog(path.join(root, 'events-http.jsonl'));
    const httpEnvelope = withHandoffMode('on', () => buildEnvelope(NODE, ctx1, {
      runner: HTTP_RUNNER, runsDir: runsDir1, eventlog: eventlog4, taskId: 'handoff-task-1',
    }));
    assert.strictEqual(httpEnvelope, plainEnvelope, 'openai_http 一律走现状全文');
    const harnessEnvelope = withHandoffMode('on', () => buildEnvelope(NODE, ctx1, {
      runner: { kind: 'openai_http_tool_harness', modelRunner: 'glm', executorRunner: 'codex' },
      runsDir: runsDir1, eventlog: eventlog4, taskId: 'handoff-task-1',
    }));
    assert.strictEqual(harnessEnvelope, plainEnvelope, 'tool-harness 一律走现状全文');
    assert.strictEqual(eventsOf(eventlog4, 'handoff.fallback').length, 0, '非 CLI runner 不发 fallback');

    // ---- 5) off:完全无动作;board_* 排除 ----
    const runsDir5 = path.join(root, 'engine-runs', 'handoff-task-5');
    fs.mkdirSync(runsDir5, { recursive: true });
    const eventlog5 = new EventLog(path.join(root, 'events-off.jsonl'));
    const off = withHandoffMode('off', () => engineRunnerTest.writeHandoffShadow({
      spec: { taskId: 't5', role: 'supervisor' }, ctx: mkCtx(), runsDir: runsDir5, eventlog: eventlog5, taskId: 't5',
    }));
    assert.strictEqual(off, null, 'off 模式不写任务稿');
    assert(!fs.existsSync(path.join(runsDir5, 'task.md')), 'off 模式无 task.md');
    assert(!fs.existsSync(path.join(runsDir5, 'meta.json')), 'off 模式无 meta.json');
    assert.strictEqual(eventlog5.since(0).length, 0, 'off 模式无事件');
    const offEnvelope = withHandoffMode('off', () => buildEnvelope(NODE, ctx1, {
      runner: CLI_RUNNER, runsDir: runsDir1, eventlog: eventlog5, taskId: 'handoff-task-1',
    }));
    assert.strictEqual(offEnvelope, plainEnvelope, 'off 模式信封为现状全文');

    assert.strictEqual(engineRunnerTest.isBoardRole('board_opus48'), true);
    assert.strictEqual(engineRunnerTest.isBoardRole('board-glm52'), true);
    assert.strictEqual(engineRunnerTest.isBoardRole('supervisor'), false);
    const boardOut = withHandoffMode('shadow', () => engineRunnerTest.writeHandoffShadow({
      spec: { taskId: 'tb', role: 'board_opus48' }, ctx: mkCtx(), runsDir: runsDir5, eventlog: eventlog5, taskId: 'tb',
    }));
    assert.strictEqual(boardOut, null, 'board_* 角色排除');
    assert(!fs.existsSync(path.join(runsDir5, 'task.md')), 'board_* 不写任务稿');

    // ---- 写失败静默降级:emit handoff.fallback,不抛异常 ----
    const eventlog6 = new EventLog(path.join(root, 'events-writefail.jsonl'));
    const fileAsDir = path.join(root, 'not-a-dir');
    fs.writeFileSync(fileAsDir, 'occupied');
    const failed = withHandoffMode('shadow', () => engineRunnerTest.writeHandoffShadow({
      spec: { taskId: 't6', role: 'supervisor' },
      ctx: mkCtx(),
      runsDir: path.join(fileAsDir, 'sub'), // mkdir 会失败(父路径是文件)
      eventlog: eventlog6,
      taskId: 't6',
    }));
    assert.strictEqual(failed, null, '写失败必须静默降级');
    const writeFallbacks = eventsOf(eventlog6, 'handoff.fallback');
    assert.strictEqual(writeFallbacks.length, 1, '写失败必须 emit handoff.fallback');
    assert.strictEqual(writeFallbacks[0].stage, 'write');

    console.log(JSON.stringify({ pass: true, suite: 'handoff-shadow' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
