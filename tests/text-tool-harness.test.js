#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { makeCliRunner } = require('../shared/engine/cli-runner');
const EventLog = require('../shared/engine/eventlog');

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8' });
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu-text-tool-harness-'));
  try {
    const target = path.join(root, 'target.txt');
    fs.writeFileSync(target, 'before\n');
    run('git', ['init'], root);
    run('git', ['add', 'target.txt'], root);
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'commit', '-m', 'init'], root);

    const eventlog = new EventLog(path.join(root, 'events.jsonl'));
    const executorScript = `
const fs = require('fs');
const path = require('path');
const prompt = process.argv.slice(1).join('\\n');
const m = prompt.match(/TARGET_FILE=([^\\n]+)/);
if (!m) { console.error('missing TARGET_FILE'); process.exit(2); }
const file = m[1].trim();
fs.writeFileSync(file, 'after harness\\n');
const rel = 'target.txt';
console.log('executor really wrote ' + rel);
const fence = String.fromCharCode(96).repeat(3);
console.log(fence + 'json');
console.log(JSON.stringify({
  implementation: {
    done: true,
    summary: 'text runner harness wrote target.txt',
    changed_files: [rel],
    logic_chain: {
      summary: 'pure text runner was upgraded to tool harness',
      current_status: 'done',
      actions: ['wrote target.txt through executor runner'],
      evidence: [
        { kind: 'file', path: rel, summary: 'file exists and was overwritten by harness' },
        { kind: 'command', command: 'git status --short target.txt', exit_code: 0, summary: 'git sees modified target.txt' }
      ],
      tests: [
        { command: 'git status --short target.txt', exit_code: 0, summary: 'status contains M target.txt' }
      ],
      conclusion: 'tool harness can land file changes for a text runner'
    }
  }
}));
console.log(fence);
`;

    const runner = makeCliRunner({
      runners: {
        'glm-text': {
          cmd: [process.execPath, '-e', 'console.log("planner draft: edit target.txt")'],
          promptVia: 'arg',
          execution: {
            canWriteFiles: false,
            canRunCommands: false,
            toolHarnessRunner: 'glm-tools',
          },
        },
        'glm-tools': {
          kind: 'openai_http_tool_harness',
          cmd: ['__openai_http_tool_harness__'],
          modelRunner: 'glm-text',
          executorRunner: 'executor',
          execution: { canWriteFiles: true, canRunCommands: true },
        },
        executor: {
          cmd: [process.execPath, '-e', executorScript],
          promptVia: 'arg',
          execution: { canWriteFiles: true, canRunCommands: true },
        },
      },
      roleMap: { worker_narrow: 'glm-text' },
      workdir: root,
      runsDir: path.join(root, 'runs'),
      nodeTimeoutSec: 5,
      eventlog,
      taskId: 'text-tool-harness-test',
      projectId: '控制台',
    });

    const out = runner(
      { id: 'implement', agent_role: 'worker_narrow' },
      {
        goal: `修改文件。TARGET_FILE=${target}`,
        acceptance: 'target.txt 必须被真实写盘,git status 能看到修改',
      },
      1,
    );
    assert(!out.fail, out.fail || 'runner failed');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'after harness\n');
    assert(out.vars && out.vars.implementation && out.vars.implementation.done === true, 'missing implementation JSON');
    assert.deepStrictEqual(out.vars.implementation.changed_files, ['target.txt']);

    const status = run('git', ['status', '--short', 'target.txt'], root);
    assert.strictEqual(status.status, 0, status.stderr);
    assert.match(status.stdout, /M\s+target\.txt/, 'git must see modified file');

    const events = eventlog.since(0);
    assert(events.some(e => e.type === 'runner.tool_harness.upgrade'
      && e.from === 'glm-text'
      && e.to === 'glm-tools'), 'missing tool harness upgrade event');

    // 回归: agent-once 的 execute 工作节点(前端评审/it_engineer/hr 等)若派给纯文本 runner
    // 且任务需要落盘/截图,也必须自动升级到 tool harness,不能静默落到无工具 runner 上被自报跳过。
    // 起因: 维修工单 auto-20260625013315-dc613b9ef8b5260c(frontend_designer/ff194c92):
    // 定时页面评审走 execute 节点,旧门只认 implement,落到纯文本 GLM 上无工具 → self_report_incomplete。
    fs.writeFileSync(target, 'before\n');
    run('git', ['add', 'target.txt'], root);
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'commit', '-m', 'reset target'], root);
    const execEventlog = new EventLog(path.join(root, 'events-execute.jsonl'));
    const execRunner = makeCliRunner({
      runners: {
        'glm-text': {
          cmd: [process.execPath, '-e', 'console.log("planner draft: edit target.txt")'],
          promptVia: 'arg',
          execution: { canWriteFiles: false, canRunCommands: false, toolHarnessRunner: 'glm-tools' },
        },
        'glm-tools': {
          kind: 'openai_http_tool_harness',
          cmd: ['__openai_http_tool_harness__'],
          modelRunner: 'glm-text',
          executorRunner: 'executor',
          execution: { canWriteFiles: true, canRunCommands: true },
        },
        executor: {
          cmd: [process.execPath, '-e', executorScript],
          promptVia: 'arg',
          execution: { canWriteFiles: true, canRunCommands: true },
        },
      },
      roleMap: { frontend_designer: 'glm-text' },
      workdir: root,
      runsDir: path.join(root, 'runs-execute'),
      nodeTimeoutSec: 5,
      eventlog: execEventlog,
      taskId: 'text-tool-harness-execute-test',
      projectId: '控制台',
    });
    const execOut = execRunner(
      { id: 'execute', agent_role: 'frontend_designer' },
      {
        goal: `定时页面评审:截图 workspace 前端页面并写报告。TARGET_FILE=${target}`,
        acceptance: '报告与 issues 必须真实写盘,git status 能看到改动',
      },
      1,
    );
    assert(!execOut.fail, execOut.fail || 'execute-node runner failed');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'after harness\n');
    const execEvents = execEventlog.since(0);
    assert(execEvents.some(e => e.type === 'runner.tool_harness.upgrade'
      && e.from === 'glm-text'
      && e.to === 'glm-tools'), 'execute node must also upgrade text runner to tool harness');

    const blockedRunner = makeCliRunner({
      runners: {
        'pure-text': {
          cmd: [process.execPath, '-e', 'console.log("text only")'],
          promptVia: 'arg',
          execution: { canWriteFiles: false, canRunCommands: false },
        },
      },
      roleMap: { worker_narrow: 'pure-text' },
      workdir: root,
      runsDir: path.join(root, 'runs-blocked'),
      nodeTimeoutSec: 5,
    });
    const blocked = blockedRunner(
      { id: 'implement', agent_role: 'worker_narrow' },
      {
        goal: '修改文件 target.txt',
        acceptance: '必须落盘',
      },
      1,
    );
    assert(blocked.fail, 'pure text runner without harness must be rejected for delivery implement');
    assert.match(blocked.fail, /纯文本 runner/);

    console.log(JSON.stringify({ pass: true, suite: 'text-tool-harness' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
