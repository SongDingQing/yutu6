#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 本测试只验证 envelope 结构/runner 行为,关掉知识库注入避免 spawn python + 非确定性内容
process.env.YUTU6_KB_INJECT = '0';
const { makeCliRunner, buildEnvelope, extractJson } = require('../shared/engine/cli-runner');
const EventLog = require('../shared/engine/eventlog');
const Q = require('../shared/engine/queue');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-cli-runner-test-'));
  try {
    const runner = makeCliRunner({
      runners: {
        slow: {
          cmd: [process.execPath, '-e', 'setTimeout(() => {}, 1000)'],
          promptVia: 'arg',
        },
      },
      roleMap: { worker_code: 'slow' },
      workdir: root,
      runsDir: path.join(root, 'runs'),
      nodeTimeoutSec: 0.05,
    });

    const out = runner({ id: 'implement', agent_role: 'worker_code' }, { goal: 'timeout smoke' }, 1);
    assert(out && out.fail, 'expected timeout failure');
    assert.match(out.fail, /slow 运行超时\(0\.05s\)/);
    assert.doesNotMatch(out.fail, /spawn .*失败/);

    const eventlog = new EventLog(path.join(root, 'events.jsonl'));
    Q.enqueue(root, 'repair', {
      role: 'repair',
      flowId: 'agent-once',
      goal: 'stream smoke',
    }, { id: 'stream-queue', priority: 1 });
    const claimed = Q.claim(root, 'repair', { owner: 'test-worker', ownerPid: process.pid });
    assert.strictEqual(claimed && claimed.id, 'stream-queue');
    const streaming = makeCliRunner({
      runners: {
        echo: {
          cmd: [process.execPath, '-e', 'console.log("agent latest stdout"); console.error("agent latest stderr")'],
          promptVia: 'arg',
        },
      },
      roleMap: { repair: 'echo' },
      workdir: root,
      runsDir: path.join(root, 'runs-stream'),
      nodeTimeoutSec: 3,
      eventlog,
      queueRoot: root,
      queueAgent: 'repair',
      queueId: 'stream-queue',
      taskId: 'stream-task',
      projectId: '控制台',
    });
    const streamOut = streaming({ id: 'repair', agent_role: 'repair' }, { goal: 'stream smoke' }, 1);
    assert(!streamOut.fail, streamOut.fail || 'stream runner failed');
    const outputEvents = eventlog.since(0).filter(e => e.type === 'node.output');
    assert(outputEvents.some(e => e.task === 'stream-task' && e.role === 'repair' && e.stream === 'stdout' && /agent latest stdout/.test(e.text)), 'missing stdout node.output event');
    assert(outputEvents.some(e => e.task === 'stream-task' && e.role === 'repair' && e.stream === 'stderr' && /agent latest stderr/.test(e.text)), 'missing stderr node.output event');
    const running = Q.list(root, 'repair').running.find(e => e.id === 'stream-queue');
    assert(running && running.progress_at, 'node.output must refresh queue progress_at');
    assert.strictEqual(running.progress_event, 'node.output');
    assert.strictEqual(running.progress_task, 'stream-task');

    const reviewEnvelope = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, {
      implementation: { changed_files: ['projects/控制台/status.md'] },
    });
    const implementEnvelope = buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, {
      acceptance: '结构化验收表\n| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |\n|---|---|---|---|\n| 任务验收: demo | 未完成 | | |',
    });
    assert.match(implementEnvelope, /implementation\.acceptance_table 必须按表逐行填写/);
    assert.match(implementEnvelope, /验收表模板单一来源:templates\/structured-acceptance-table\.md/);
    assert.match(implementEnvelope, /glm-5\.2 不能作为最终视觉自验替代/);
    assert.match(reviewEnvelope, /每一个 changed_files 路径原样复制到 verification\.checked/);
    assert.match(reviewEnvelope, /verification\.evidence 为每个路径给出 file\/diff\/test 证据/);
    assert.match(reviewEnvelope, /review\.verification\.acceptance_table 必须逐行复核/);
    assert.match(reviewEnvelope, /验收表模板单一来源:templates\/structured-acceptance-table\.md/);
    assert.match(reviewEnvelope, /glm-5\.2 不能作为最终视觉自验替代/);
    assert.match(reviewEnvelope, /不要用简写 JSON 或纯文字总结替代/);
    assert.match(reviewEnvelope, /"verification":\{"verdict":"true"/);
    assert.doesNotMatch(reviewEnvelope, /\{"review": \{"pass": true, "severity": "low"\}\}/);
    assert.doesNotMatch(implementEnvelope, /\{"review": \{"pass": true, "severity": "low"\}\}/);

    // 2026-07-03 架构审视 A-4:信封"上一步结果"剔除 spec_snapshot(goal+验收表全文副本,
    // 进 prompt 即整段重复),但 implementation/review 结论必须整键保留(review 合同要逐项原样核)。
    const dedupEnvelope = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, {
      goal: '真实任务目标',
      spec_snapshot: { goal: 'SPEC_SNAPSHOT_MARKER_不应出现在信封', acceptance: '验收全文副本' },
      attachments: [{ path: 'ATTACHMENT_MARKER_不应出现在信封' }],
      implementation: { changed_files: ['projects/控制台/status.md'], logic_chain: { summary: 'KEEP_IMPL_MARKER' } },
      review: { verification: { verdict: 'true' } },
    });
    assert.doesNotMatch(dedupEnvelope, /SPEC_SNAPSHOT_MARKER_不应出现在信封/, 'spec_snapshot 不得进 prompt(整段重复)');
    assert.doesNotMatch(dedupEnvelope, /ATTACHMENT_MARKER_不应出现在信封/, 'attachments 元数据不得进 prompt');
    assert.match(dedupEnvelope, /KEEP_IMPL_MARKER/, 'implementation 结论必须整键透传');

    // extractJson:严格 JSON 正常解析
    const strict = extractJson('```json\n{"implementation":{"done":true,"logic_chain":{"summary":"ok"}}}\n```');
    assert(strict && strict.implementation && strict.implementation.logic_chain, 'strict JSON must parse');

    // extractJson:尾部多余括号(模型常见 {...}}}}) 应被配平恢复,而非整段判废
    // 复现 cr-1782704710488-b0a0dda5:result.md 因尾部多写 `}}` 被 done gate 误报「缺少逻辑链」
    const recovered = extractJson('```json\n{"implementation":{"done":true,"logic_chain":{"summary":"recovered","current_status":"partial"}}}}}\n```');
    assert(recovered && recovered.implementation && recovered.implementation.logic_chain, 'trailing-brace JSON must recover logic_chain');
    assert.strictEqual(recovered.implementation.logic_chain.current_status, 'partial');

    // 字符串内的括号不应误导配平
    const strInner = extractJson('```json\n{"note":"a } b ] c","ok":true}}\n```');
    assert(strInner && strInner.ok === true && strInner.note === 'a } b ] c', 'braces inside strings must not break balancing');

    // 真正不可恢复(无任何 JSON 值)仍返回 null
    assert.strictEqual(extractJson('```json\nnot json at all\n```'), null, 'unrecoverable output stays null');

    console.log(JSON.stringify({ pass: true, suite: 'cli-runner' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
