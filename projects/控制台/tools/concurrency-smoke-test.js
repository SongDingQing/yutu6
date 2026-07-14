#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const Q = require(path.join(WORKDIR, 'shared/engine/queue'));

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const runRoot = path.join(ROOT, 'artifacts', 'concurrency-smoke', stamp);
const artifactsDir = path.join(runRoot, 'artifacts');
const projectsDir = path.join(runRoot, 'projects');
const boardRollup = path.join(runRoot, 'board', 'status-rollup.md');
const configPath = path.join(runRoot, 'config.json');
const mockRunnerPath = path.join(runRoot, 'mock-runner.js');
const eventsPath = path.join(artifactsDir, 'engine-events.jsonl');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readEvents() {
  try {
    return fs.readFileSync(eventsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function mockRunnerSource() {
  return `
'use strict';
const prompt = process.argv.slice(2).join('\\n');
const isImplement = /# 任务:implement/.test(prompt);
const delay = isImplement ? 500 : 60;
let payload;
if (/# 任务:review/.test(prompt)) {
  payload = { review: { pass: true, severity: 'low', notes: 'concurrency smoke review ok; concurrency smoke command evidence exit 0', verification: { verdict: 'true', checked: ['implementation.logic_chain', 'concurrency smoke evidence'], evidence: [{ kind: 'test', command: 'node projects/控制台/tools/concurrency-smoke-test.js', exit_code: 0, summary: 'concurrency smoke verified' }] } } };
} else if (isImplement) {
  payload = { implementation: { done: true, summary: 'concurrency smoke implementation ok', changed_files: [], logic_chain: { summary: 'concurrency smoke implementation ok', current_status: 'done', actions: ['ran concurrency smoke fixture'], evidence: [{ kind: 'test', command: 'node projects/控制台/tools/concurrency-smoke-test.js', exit_code: 0, summary: 'concurrency smoke fixture evidence' }], tests: [{ command: 'node projects/控制台/tools/concurrency-smoke-test.js', exit_code: 0, summary: 'concurrency smoke fixture' }], conclusion: 'concurrency smoke complete' } } };
} else {
  payload = { orchestrator: { projectId: '控制台', summary: 'concurrency smoke route ok', acceptance: 'ok' } };
}
setTimeout(() => {
  process.stdout.write('concurrency smoke ok\\n\\n\\\`\\\`\\\`json\\n' + JSON.stringify(payload) + '\\n\\\`\\\`\\\`\\n');
}, delay);
`;
}

function writeHarnessFiles() {
  fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
  fs.mkdirSync(path.dirname(boardRollup), { recursive: true });
  fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# concurrency smoke brief\n');
  fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# concurrency smoke status\n');
  fs.writeFileSync(boardRollup, '# concurrency smoke rollup\n');
  fs.writeFileSync(mockRunnerPath, mockRunnerSource());
  writeJson(configPath, {
    roleRouting: {
      supervisor: { runner: 'mock' },
      worker_code: { runner: 'mock' },
      repair: { runner: 'mock' },
    },
    runners: {
      mock: {
        label: 'Concurrency Smoke Mock',
        cmd: [process.execPath, mockRunnerPath],
        promptVia: 'arg',
      },
    },
  });
}

function spawnWorker(agent) {
  const log = fs.openSync(path.join(runRoot, `${agent}.log`), 'a');
  return spawn(process.execPath, [path.join(ROOT, 'ceo-worker.js'), '--agent', agent], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: artifactsDir,
      CONSOLE_CONFIG_PATH: configPath,
      CONSOLE_PROJECTS_DIR: projectsDir,
      CONSOLE_BOARD_ROLLUP: boardRollup,
      ENGINE_MAX_CONCURRENCY: '3',
      QUEUE_WORKER_MAX_IN_FLIGHT: '3',
      RUNNER_SINGLEFLIGHT: '',
      AUTO_REPAIR_ENABLED: '0',
      RUNNING_SWEEP_MS: '500',
      RESOURCE_DOMAIN_LOCKS_ENABLED: '1',
    }),
    stdio: ['ignore', log, log],
  });
}

function enqueueSupervisor(id, goal, resourceDomains) {
  return Q.enqueue(artifactsDir, 'supervisor-控制台', {
    role: 'supervisor',
    flowId: 'review-loop',
    projectId: '控制台',
    scopedToProject: true,
    goal,
    bounds: 'concurrency smoke only; unregistered projects excluded; no secrets',
    acceptance: 'review-loop completes',
    resourceDomains,
    useOrchestrator: false,
    autoApproveHuman: true,
  }, { id, priority: 50 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDone(ids, deadlineMs = 20000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const events = readEvents();
    const done = ids.every(id => events.some(e => e.type === 'queue.completed'
      && e.queueAgent === 'supervisor-控制台'
      && e.queueId === id
      && e.ok
      && e.status === 'done'));
    if (done) return events;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${ids.join(', ')}`);
}

function taskFor(events, queueId) {
  const ev = events.find(e => e.type === 'task.queued' && e.queueAgent === 'supervisor-控制台' && e.queueId === queueId);
  return ev && ev.task;
}

function implementInterval(events, queueId) {
  const task = taskFor(events, queueId);
  if (!task) return null;
  const start = events.find(e => e.type === 'node.start' && e.task === task && e.node === 'implement');
  const end = events.find(e => (e.type === 'node.end' || e.type === 'node.fail') && e.task === task && e.node === 'implement');
  if (!start || !end) return null;
  return {
    queueId,
    task,
    start: Date.parse(start.ts),
    end: Date.parse(end.ts),
    startSeq: start.seq,
    endSeq: end.seq,
  };
}

function overlaps(a, b) {
  return !!(a && b && a.start < b.end && b.start < a.end);
}

function stopWorkers(workers) {
  for (const child of workers) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
}

async function main() {
  writeHarnessFiles();
  const workers = [spawnWorker('supervisor-控制台')];
  try {
    enqueueSupervisor('parallel-front', 'CONCURRENCY_SMOKE_FRONT 修改 workspace.html', { write: ['frontend-public'] });
    enqueueSupervisor('parallel-engine', 'CONCURRENCY_SMOKE_ENGINE 修改 shared/engine/engine.js', { write: ['engine'] });
    let events = await waitForDone(['parallel-front', 'parallel-engine']);
    const frontParallel = implementInterval(events, 'parallel-front');
    const engineParallel = implementInterval(events, 'parallel-engine');
    const parallelOverlap = overlaps(frontParallel, engineParallel);

    enqueueSupervisor('serial-front-a', 'CONCURRENCY_SMOKE_SAME_A 修改 workspace.html A', { write: ['frontend-public'] });
    enqueueSupervisor('serial-front-b', 'CONCURRENCY_SMOKE_SAME_B 修改 workspace.html B', { write: ['frontend-public'] });
    events = await waitForDone(['serial-front-a', 'serial-front-b']);
    const frontA = implementInterval(events, 'serial-front-a');
    const frontB = implementInterval(events, 'serial-front-b');
    const sameDomainOverlap = overlaps(frontA, frontB);
    const slotEvents = events.filter(e => e.type === 'engine.slot.acquired');

    const report = {
      pass: parallelOverlap && !sameDomainOverlap && slotEvents.some(e => e.maxConcurrency > 1),
      runRoot,
      parallel: {
        front: frontParallel,
        engine: engineParallel,
        overlap: parallelOverlap,
      },
      sameDomain: {
        first: frontA,
        second: frontB,
        overlap: sameDomainOverlap,
      },
      slotMaxConcurrencyValues: slotEvents.map(e => e.maxConcurrency),
    };
    writeJson(path.join(runRoot, 'report.json'), report);
    if (!report.pass) {
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    stopWorkers(workers);
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
