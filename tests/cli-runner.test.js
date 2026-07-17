#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
    const machineReviewEnvelope = buildEnvelope({ id: 'review', agent_role: 'supervisor' }, {
      projectId: '控制台',
      acceptance_contract: { schema: 'acceptance-contract@1', records: [] },
      implementation: {
        changed_files: ['projects/控制台/status.md'],
        receipt: { artifacts: ['projects/控制台/status.md:1'] },
      },
    });
    const implementEnvelope = buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, {
      acceptance: '结构化验收表\n| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |\n|---|---|---|---|\n| 任务验收: demo | 未完成 | | |',
    });
    const machineImplementEnvelope = buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, {
      projectId: '控制台',
      acceptance_contract: { schema: 'acceptance-contract@1', records: [] },
      acceptance: '结构化验收表\n| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |\n|---|---|---|---|\n| 任务验收: demo | 未完成 | | |',
    });
    assert.match(implementEnvelope, /implementation\.acceptance_table 必须按表逐行填写/);
    assert.match(implementEnvelope, /验收表模板单一来源:templates\/structured-acceptance-table\.md/);
    assert.match(implementEnvelope, /evidence\/notes 或所引文件的附近片段必须含与本行要点可核对齐的具体术语/);
    assert.match(implementEnvelope, /源码\/测试标识与验收行语言不一致.*包含该要点与结果的持久证据行.*不能只堆代码行号/);
    assert.match(implementEnvelope, /glm-5\.2 不能作为最终视觉自验替代/);
    assert.match(reviewEnvelope, /每一个 changed_files 路径原样复制到 verification\.checked/);
    assert.match(reviewEnvelope, /verification\.evidence 为每个路径给出 file\/diff\/test 证据/);
    assert.match(reviewEnvelope, /review\.verification\.acceptance_table 必须逐行复核/);
    assert.match(reviewEnvelope, /验收表模板单一来源:templates\/structured-acceptance-table\.md/);
    assert.match(reviewEnvelope, /glm-5\.2 不能作为最终视觉自验替代/);
    assert.match(reviewEnvelope, /不要用简写 JSON 或纯文字总结替代/);
    assert.match(reviewEnvelope, /"verification":\{"verdict":"true"/);
    assert.match(machineReviewEnvelope, /"pass":false,"severity":"medium","issues":\[/);
    const machineReviewShape = machineReviewEnvelope.match(/请审查上一步结果,并在最后输出 ```json 代码块: (\{.*\})。/);
    assert(machineReviewShape, 'machine review output shape must be present');
    assert.doesNotThrow(() => JSON.parse(machineReviewShape[1]), 'machine review output shape must be valid JSON');
    assert.match(machineReviewEnvelope, /"issue_evidence":\[/);
    assert.match(machineReviewEnvelope, /"source_evidence":/);
    assert.match(machineReviewEnvelope, /"source_excerpt":/);
    assert.match(machineReviewEnvelope, /implementation-failure-receipt@1/);
    assert.match(machineReviewEnvelope, /acceptance_id.*source_hash.*expected.*observed.*verdict/s);
    assert.match(machineReviewEnvelope, /projects\/控制台\/artifacts\/ 下落一个 review 绑定回执文件/);
    assert.match(machineReviewEnvelope, /每个 issue 独占一行.*acceptance_id.*requiredRows point.*核对结果/);
    assert.match(machineReviewEnvelope, /普通源码 token、无关前置行、review 临时复述/);
    assert.match(machineReviewEnvelope, /implementation\.failure_receipts\[\].*implement-time 冻结副本/);
    assert.match(machineReviewEnvelope, /review 后改写前置文件/);
    assert.match(machineReviewEnvelope, /observed 必须是与 expected 不同且逐字出现在 issue 中/);
    assert.match(machineReviewEnvelope, /具体且可由实现期失败回执核实的问题/);
    assert.match(machineReviewEnvelope, /observed_route=hard_block_expected_route=rework.*implementation-failure-receipt@1/s);
    const machineReviewExample = machineReviewEnvelope.match(/示例:\n```json\n(\{"review":.*\})\n```/);
    assert(machineReviewExample, 'machine review example must be present');
    const parsedMachineReviewExample = JSON.parse(machineReviewExample[1]);
    assert.strictEqual(
      parsedMachineReviewExample.review.issues[0],
      parsedMachineReviewExample.review.verification.issue_evidence[0].issue,
      'machine review example issue_evidence.issue must exactly match issues[0]',
    );
    assert.match(machineImplementEnvelope, /若 implement 阶段真实观察到某条 requiredRow 的失败\/部分结果/);
    assert.match(machineImplementEnvelope, /implementation\.failure_receipts\[\].*evidence=该 path:line/);
    assert.doesNotMatch(reviewEnvelope, /\{"review": \{"pass": true, "severity": "low"\}\}/);
    assert.doesNotMatch(implementEnvelope, /\{"review": \{"pass": true, "severity": "low"\}\}/);

    // cr-1783935705532:视觉 review 只信 runner 自己的 Codex CLI --image argv 轨迹。
    // 模型自报 runtime_visual_input 会被覆盖;非视觉 review 不附图;缺图必须显式失败关闭。
    const fakeBin = path.join(root, 'bin');
    const fakeCodex = path.join(fakeBin, 'codex');
    const fakeArgsFile = path.join(root, 'fake-codex-args.json');
    const fakeStdinFile = path.join(root, 'fake-codex-stdin.txt');
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(fakeCodex, [
      '#!/usr/bin/env node',
      "'use strict';",
      "const crypto = require('crypto');",
      "const fs = require('fs');",
      "const path = require('path');",
      'const args = process.argv.slice(2);',
      'fs.writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(args));',
      "const stdin = fs.readFileSync(0, 'utf8');",
      "if (process.env.FAKE_CODEX_STDIN_FILE) fs.writeFileSync(process.env.FAKE_CODEX_STDIN_FILE, stdin);",
      'const imagePaths = [];',
      "for (let i = 0; i < args.length; i++) if (args[i] === '--image' && args[i + 1]) imagePaths.push(args[++i]);",
      'const observations = imagePaths.map(file => ({',
      "  path: path.relative(process.env.FAKE_CODEX_ROOT, file).split(path.sep).join('/'),",
      "  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),",
      "  observation: '画面可见标题、左侧办公室列表、状态条与舞台边框。',",
      '}));',
      'const result = { review: { pass: true, severity: "low", notes: "fixture", verification: {',
      '  verdict: "true", checked: ["fixture"], evidence: [{ kind: "test", command: "fixture", exit_code: 0, summary: "fixture" }],',
      '  visual_observations: observations,',
      '  runtime_visual_input: { schema: "forged-by-model", attached: true },',
      '} } };',
      'process.stdout.write("```json\\n" + JSON.stringify(result) + "\\n```\\n");',
      '',
    ].join('\n'));
    fs.chmodSync(fakeCodex, 0o755);
    const visualAssets = path.join(root, 'visual-assets');
    fs.mkdirSync(visualAssets, { recursive: true });
    const visualEvidenceImage = path.join(visualAssets, 'peekaboo-current.png');
    const visualAttachmentImage = path.join(visualAssets, 'user-reference.png');
    fs.writeFileSync(visualEvidenceImage, 'visual evidence bytes\n');
    fs.writeFileSync(visualAttachmentImage, 'visual attachment bytes\n');
    const oldFakeArgsFile = process.env.FAKE_CODEX_ARGS_FILE;
    const oldFakeStdinFile = process.env.FAKE_CODEX_STDIN_FILE;
    const oldFakeRoot = process.env.FAKE_CODEX_ROOT;
    process.env.FAKE_CODEX_ARGS_FILE = fakeArgsFile;
    process.env.FAKE_CODEX_STDIN_FILE = fakeStdinFile;
    process.env.FAKE_CODEX_ROOT = root;
    try {
      const visualEvents = new EventLog(path.join(root, 'visual-events.jsonl'));
      const visualRunner = makeCliRunner({
        runners: { codex: { cmd: [fakeCodex, 'exec'], promptVia: 'arg' } },
        roleMap: { supervisor: 'codex' },
        workdir: root,
        runsDir: path.join(root, 'runs-visual'),
        nodeTimeoutSec: 3,
        failover: false,
        eventlog: visualEvents,
        taskId: 'visual-review-task',
        projectId: '控制台',
      });
      const visualCtx = {
        implementation: {
          acceptance_table: [{
            point: '视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告',
            status: '完成',
            evidence: 'visual-assets/peekaboo-current.png; codex-review.md',
            notes: 'fixture',
          }],
        },
        attachments: [{ path: 'visual-assets/user-reference.png' }],
      };
      const visualOut = visualRunner({ id: 'review', agent_role: 'supervisor' }, visualCtx, 1);
      assert(!visualOut.fail, visualOut.fail || 'visual runner failed');
      const receipt = visualOut.vars.review.verification.runtime_visual_input;
      assert(receipt && receipt.attached === true, 'runner must inject attached visual receipt');
      assert.strictEqual(receipt.schema, 'codex-cli-image-v1');
      assert.strictEqual(receipt.source, 'runner-spawn-argv');
      assert.strictEqual(receipt.tool, 'codex exec --image');
      assert.notStrictEqual(receipt.schema, 'forged-by-model', 'model-authored receipt must be replaced');
      assert.deepStrictEqual(receipt.images.map(item => item.path), [
        'visual-assets/peekaboo-current.png',
        'visual-assets/user-reference.png',
      ]);
      const args = JSON.parse(fs.readFileSync(fakeArgsFile, 'utf8'));
      assert.deepStrictEqual(args.slice(0, 5), [
        'exec', '--image', visualEvidenceImage, '--image', visualAttachmentImage,
      ], 'visual evidence then user attachment must be passed in stable --image order');
      assert.strictEqual(args.length, 5, 'visual prompt must not be appended after variadic --image arguments');
      assert.match(fs.readFileSync(fakeStdinFile, 'utf8'), /# 任务:review/, 'visual prompt must be delivered through stdin');
      const traceFile = path.join(root, receipt.trace_path);
      assert(fs.existsSync(traceFile), 'runner-owned visual input trace must exist');
      assert.strictEqual(
        crypto.createHash('sha256').update(fs.readFileSync(traceFile)).digest('hex'),
        receipt.trace_sha256,
        'trace hash must bind the runner-owned artifact',
      );
      const visualEventRows = visualEvents.since(0);
      assert(visualEventRows.some(event => event.type === 'runner.visual_input'
        && event.trace_path === receipt.trace_path && event.trace_sha256 === receipt.trace_sha256));
      assert(visualEventRows.some(event => event.type === 'runner.call'
        && event.visual_input && event.visual_input.attached === true));

      const nonVisualOut = visualRunner({ id: 'review', agent_role: 'supervisor' }, {
        visual_acceptance: {
          schema: 'visual-acceptance@1',
          acceptance_protocol: 'structured-acceptance@2',
          state: 'not_applicable',
          required: false,
          source: 'task_type',
        },
        implementation: { acceptance_table: [{ point: '视觉/UI证据: not_applicable', status: 'not_applicable', evidence: 'task-envelope:visual_acceptance' }] },
      }, 2);
      assert(!nonVisualOut.fail, nonVisualOut.fail || 'non-visual runner failed');
      assert.strictEqual(
        nonVisualOut.vars.review.verification.runtime_visual_input,
        undefined,
        'non-visual review must not retain a model-forged or runner visual receipt',
      );
      const nonVisualArgs = JSON.parse(fs.readFileSync(fakeArgsFile, 'utf8'));
      assert(!nonVisualArgs.includes('--image'), 'non-visual review must not receive image args');
      assert.strictEqual(fs.readFileSync(fakeStdinFile, 'utf8'), '', 'non-visual arg prompt must not also be duplicated on stdin');
      assert(!fs.existsSync(path.join(root, 'runs-visual', 'review-2', 'visual-input.json')));

      const missingVisualOut = visualRunner({ id: 'review', agent_role: 'supervisor' }, {
        implementation: {
          acceptance_table: [{
            point: '视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告',
            status: '完成',
            evidence: 'visual-assets/peekaboo-missing.png; codex-review.md',
          }],
        },
      }, 3);
      assert(!missingVisualOut.fail, missingVisualOut.fail || 'missing-image runner invocation failed unexpectedly');
      const unavailable = missingVisualOut.vars.review.verification.runtime_visual_input;
      assert(unavailable && unavailable.attached === false, 'missing image must produce runner-owned unavailable receipt');
      assert.strictEqual(unavailable.reason, 'no_valid_workspace_visual_evidence_images');
      assert(!JSON.parse(fs.readFileSync(fakeArgsFile, 'utf8')).includes('--image'));
      assert.match(
        fs.readFileSync(path.join(root, 'runs-visual', 'review-3', 'task.md'), 'utf8'),
        /pass=false.*verification\.verdict=partial.*runtime visual tool trace unavailable/,
      );
      assert(visualEvents.since(0).some(event => event.type === 'runner.visual_input.unavailable'
        && event.attached === false));
    } finally {
      if (oldFakeArgsFile === undefined) delete process.env.FAKE_CODEX_ARGS_FILE;
      else process.env.FAKE_CODEX_ARGS_FILE = oldFakeArgsFile;
      if (oldFakeStdinFile === undefined) delete process.env.FAKE_CODEX_STDIN_FILE;
      else process.env.FAKE_CODEX_STDIN_FILE = oldFakeStdinFile;
      if (oldFakeRoot === undefined) delete process.env.FAKE_CODEX_ROOT;
      else process.env.FAKE_CODEX_ROOT = oldFakeRoot;
    }

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
