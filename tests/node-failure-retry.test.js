#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const Q = require('../shared/engine/queue');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs = 2000) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readEvents(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function mockRunnerSource(stateFile) {
  return `
'use strict';
const fs = require('fs');
const prompt = process.argv.slice(2).join('\\n');
const stateFile = ${JSON.stringify(stateFile)};
function parseRows(text) {
  const rows = [];
  let inTable = false;
  for (const raw of String(text || '').split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) {
      if (inTable && rows.length) break;
      continue;
    }
    const cells = line.slice(1, -1).split('|').map(s => s.trim());
    if (cells.includes('要点') && cells.some(c => /^完成状态/.test(c))) {
      inTable = true;
      continue;
    }
    if (!inTable || /^:?-{3,}:?$/.test(cells[0] || '')) continue;
    const point = cells[0];
    if (point) rows.push({
      point,
      status: '完成',
      evidence: 'tests/node-failure-retry.test.js:1',
      notes: 'retry fixture filled structured acceptance row',
    });
  }
  return rows;
}
function promptField(text, label) {
  const re = new RegExp('-\\\\s*' + label + '\\\\s*[:：]\\\\s*([^\\\\n]+)');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}
function promptJsonField(text, key) {
  const re = new RegExp('"' + key + '"\\\\s*:\\\\s*"([^"]*)"');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}
function receipt(text) {
  const taskId = promptField(text, 'taskId') || promptJsonField(text, 'taskId');
  const specFingerprint = promptField(text, '规格指纹') || promptJsonField(text, 'specFingerprint');
  return {
    taskId,
    specFingerprint,
    changedFiles: [],
    tests: ['node tests/node-failure-retry.test.js exit 0'],
    artifacts: ['tests/node-failure-retry.test.js:1'],
    verdict: 'done',
    blocked_required_specs: [],
  };
}
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
if (/# 任务:implement/.test(prompt)) {
  const count = Number(state.implement || 0);
  state.implement = count + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  if (count === 0) {
    console.error('transient node shake');
    process.exit(1);
  }
  const acceptance_table = parseRows(prompt);
  const result = { implementation: { done: true, summary: 'retry passed', changed_files: [], receipt: receipt(prompt), acceptance_table, logic_chain: { summary: 'retry passed after one transient failure', current_status: 'done', actions: ['retried implement node'], evidence: [{ kind: 'test', command: 'node tests/node-failure-retry.test.js', exit_code: 0, summary: 'retry fixture evidence' }], tests: [{ command: 'node tests/node-failure-retry.test.js', exit_code: 0, summary: 'retry fixture' }], conclusion: 'retry task is complete' } } };
  process.stdout.write('implementation ok\\n\\n\\\`\\\`\\\`json\\n' + JSON.stringify(result) + '\\n\\\`\\\`\\\`\\n');
} else if (/# 任务:review/.test(prompt)) {
  const acceptance_table = parseRows(prompt);
  const result = { review: { pass: true, severity: 'low', notes: 'retry review ok; node tests/node-failure-retry.test.js exit 0', verification: { verdict: 'true', checked: ['implementation.logic_chain', 'implementation.acceptance_table', 'retry evidence'], acceptance_table, evidence: [{ kind: 'test', command: 'node tests/node-failure-retry.test.js', exit_code: 0, summary: 'review fixture verified retry output' }] } } };
  process.stdout.write('review ok\\n\\n\\\`\\\`\\\`json\\n' + JSON.stringify(result) + '\\n\\\`\\\`\\\`\\n');
} else {
  process.stdout.write('{}\\n');
}
`;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-node-retry-test-'));
  const artifactsDir = path.join(root, 'artifacts');
  const projectsDir = path.join(root, 'projects');
  const configPath = path.join(root, 'config.json');
  const boardRollup = path.join(root, 'board', 'status-rollup.md');
  const runnerPath = path.join(root, 'flaky-runner.js');
  const runnerState = path.join(root, 'flaky-state.json');
  const eventsPath = path.join(artifactsDir, 'engine-events.jsonl');
  let worker = null;

  try {
    fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
    fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# retry brief\n');
    fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# retry status\n');
    fs.mkdirSync(path.dirname(boardRollup), { recursive: true });
    fs.writeFileSync(boardRollup, '# retry rollup\n');
    fs.writeFileSync(runnerPath, mockRunnerSource(runnerState));
    writeJson(configPath, {
      roleRouting: {
        worker_code: { runner: 'flaky' },
        supervisor: { runner: 'flaky' },
      },
      runners: {
        flaky: {
          label: 'Flaky Retry Mock',
          cmd: [process.execPath, runnerPath],
          promptVia: 'arg',
        },
      },
    });

    Q.enqueue(artifactsDir, 'supervisor-控制台', {
      role: 'supervisor',
      flowId: 'review-loop',
      projectId: '控制台',
      scopedToProject: true,
      goal: 'NODE_RETRY_SMOKE 控制台 node_failed 自动重试',
      bounds: 'retry smoke only; Starlaid excluded; no secrets',
      acceptance: 'retry smoke completes',
      useOrchestrator: false,
      autoApproveHuman: true,
      nodeTimeoutSec: 5,
    }, { id: 'retrySmoke', priority: 10 });

    const log = fs.openSync(path.join(root, 'worker.log'), 'a');
    worker = spawn(process.execPath, [path.join(__dirname, '../projects/控制台/ceo-worker.js'), '--agent', 'supervisor-控制台'], {
      cwd: path.resolve(__dirname, '..'),
      env: Object.assign({}, process.env, {
        CONSOLE_ARTIFACTS_DIR: artifactsDir,
        CONSOLE_WORKDIR: root,
        CONSOLE_PROJECTS_DIR: projectsDir,
        CONSOLE_CONFIG_PATH: configPath,
        CONSOLE_BOARD_ROLLUP: boardRollup,
        AUTO_REPAIR_ENABLED: '1',
        NODE_FAILURE_MAX_RETRY: '1',
        ENGINE_MAX_CONCURRENCY: '1',
        RUNNER_SINGLEFLIGHT: '',
        RUNNING_SWEEP_MS: '500',
      }),
      stdio: ['ignore', log, log],
    });

    const deadline = Date.now() + 30000;
    let events = [];
    while (Date.now() < deadline) {
      events = readEvents(eventsPath);
      if (events.some(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.queueId === 'retrySmoke' && e.ok)) break;
      await sleep(200);
    }

    if (!events.some(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.queueId === 'retrySmoke' && e.ok && e.status === 'done')) {
      console.error(JSON.stringify(events.slice(-30), null, 2));
      try { console.error(fs.readFileSync(path.join(root, 'worker.log'), 'utf8').slice(-5000)); } catch (_) {}
    }
    assert(events.some(e => e.type === 'queue.retry' && e.queueAgent === 'supervisor-控制台' && e.queueId === 'retrySmoke' && e.retry === 1), 'missing node retry event');
    assert(events.some(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.queueId === 'retrySmoke' && e.ok && e.status === 'done'), 'retry task did not complete');
    const state = Q.list(artifactsDir, 'supervisor-控制台');
    assert.strictEqual(state.failed, 0, 'retry task should not be in failed');
    assert.strictEqual(state.done, 1, 'retry task should finish done');
    assert(!events.some(e => e.type === 'repair.ticket.created'), 'transient node retry should not create repair ticket before retry budget is exhausted');
    assert(!fs.existsSync(path.join(root, 'board', 'repair-tickets')), 'transient node retry should not write repair tickets');

    console.log(JSON.stringify({ pass: true, suite: 'node-failure-retry' }));
  } finally {
    if (worker) {
      try { worker.kill('SIGTERM'); } catch (_) {}
      await waitForExit(worker);
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
