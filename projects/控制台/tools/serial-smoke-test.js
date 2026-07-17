#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const Q = require(path.join(WORKDIR, 'shared/engine/queue'));

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const runRoot = path.join(ROOT, 'artifacts', 'serial-smoke', stamp);
const artifactsDir = path.join(runRoot, 'artifacts');
const projectsDir = path.join(runRoot, 'projects');
const boardRollup = path.join(runRoot, 'board', 'status-rollup.md');
const configPath = path.join(runRoot, 'config.json');
const runtimeSettingsPath = path.join(runRoot, 'console-runtime.json');
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
  const smokeEvidenceRel = path.relative(WORKDIR, path.join(artifactsDir, 'serial-smoke-evidence.md'));
  const visualPeekabooRel = path.relative(WORKDIR, path.join(artifactsDir, 'serial-smoke-peekaboo.png'));
  const codexReportRel = path.relative(WORKDIR, path.join(artifactsDir, 'codex-serial-smoke-review.md'));
  return `
'use strict';
const fs = require('fs');
const prompt = process.argv.slice(2).join('\\n');
const isFirst = /SERIAL_SMOKE_ONE/.test(prompt);
const delay = isFirst ? 250 : 50;
const smokeEvidence = ${JSON.stringify(smokeEvidenceRel)};
const visualPeekaboo = ${JSON.stringify(visualPeekabooRel)};
const codexReport = ${JSON.stringify(codexReportRel)};
function ensureVisualFixture() {
  fs.mkdirSync(require('path').dirname(visualPeekaboo), { recursive: true });
  if (!fs.existsSync(visualPeekaboo)) fs.writeFileSync(visualPeekaboo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAEtAJJXIDTjwAAAABJRU5ErkJggg==', 'base64'));
  if (!fs.existsSync(codexReport)) fs.writeFileSync(codexReport, '# Codex serial smoke review\\n\\nCodex visual evidence fixture.\\n');
}
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
    if (!point) continue;
    const notApplicable = /^\u89c6\u89c9\\\/UI\u8bc1\u636e/.test(point) && (cells[1] === 'not_applicable' || /not_applicable/.test(point));
    if (/^\u89c6\u89c9\\\/UI\u8bc1\u636e/.test(point) && !notApplicable) ensureVisualFixture();
    rows.push({
      point,
      status: notApplicable ? 'not_applicable' : '完成',
      evidence: notApplicable ? 'task-envelope:visual_acceptance' : evidenceForPoint(point),
      notes: notApplicable ? 'non-visual v2 row; no screenshot artifact created' : notesForPoint(point),
    });
  }
  return rows.length ? rows : [{
    point: '任务验收: serial smoke completes',
    status: '完成',
    evidence: smokeEvidence + ':1 / node projects/控制台/tools/serial-smoke-test.js exit 0',
    notes: 'serial smoke fixture default row',
  }];
}
function decisionRef(point) {
  const m = String(point || '').match(/((?:memory\\/|board\\/)?decisions\\.md:\\d+)/i);
  return m && m[1];
}
function evidenceForPoint(point) {
  const p = String(point || '');
  const ref = decisionRef(p);
  if (ref) return ref + ' / ' + smokeEvidence + ':1 / node projects/控制台/tools/serial-smoke-test.js exit 0';
  if (/^视觉\\/UI证据/.test(p)) return visualPeekaboo + ' + ' + codexReport + ' (Codex visual review) / node projects/控制台/tools/serial-smoke-test.js exit 0';
  if (/review-loop/i.test(p)) return smokeEvidence + ':1 / node shared/engine/demo.js exit 0 / review-loop 控制台 scope';
  if (/status\\.md|status-rollup/i.test(p)) return 'projects/控制台/status.md:1 / board/status-rollup.md:1 / ' + smokeEvidence + ':2 / node projects/控制台/tools/serial-smoke-test.js exit 0';
  return smokeEvidence + ':1 / node projects/控制台/tools/serial-smoke-test.js exit 0';
}
function notesForPoint(point) {
  const ref = decisionRef(point);
  if (ref) return 'serial smoke echoes the same design decision line ' + ref;
  if (/^视觉\\/UI证据/.test(String(point || ''))) return 'serial smoke visual row includes peekaboo screenshot path and Codex review pointer';
  return 'serial smoke fixture filled structured acceptance row from prompt';
}
function promptField(text, label) {
  const re = new RegExp('-\\s*' + label + '\\s*[:：]\\s*([^\\n]+)');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}
function promptJsonField(text, key) {
  const re = new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}
function receipt(text) {
  return {
    taskId: promptField(text, 'taskId') || promptJsonField(text, 'taskId'),
    specFingerprint: promptField(text, '规格指纹') || promptJsonField(text, 'specFingerprint'),
    changedFiles: [smokeEvidence],
    tests: ['node projects/控制台/tools/serial-smoke-test.js exit 0'],
    artifacts: [smokeEvidence + ':1'],
    verdict: 'done',
    blocked_required_specs: [],
  };
}
let payload;
if (/# 任务:review/.test(prompt)) {
  const acceptance_table = parseRows(prompt);
  payload = { review: { pass: true, severity: 'low', notes: 'serial smoke review ok; changed_files verified: ' + smokeEvidence + '; serial smoke command evidence exit 0', verification: { verdict: 'true', checked: ['implementation.logic_chain', 'implementation.acceptance_table', 'changed_files: ' + smokeEvidence, 'serial smoke evidence'], acceptance_table, evidence: [{ kind: 'file', path: smokeEvidence, summary: 'serial smoke changed file verified' }, { kind: 'test', command: 'node projects/控制台/tools/serial-smoke-test.js', exit_code: 0, summary: 'serial smoke verified' }] } } };
} else if (/# 任务:implement/.test(prompt)) {
  const acceptance_table = parseRows(prompt);
  payload = { implementation: { done: true, summary: 'serial smoke implementation ok; evidence file written', changed_files: [smokeEvidence], receipt: receipt(prompt), acceptance_table, logic_chain: { summary: 'serial smoke implementation ok', current_status: 'done', actions: ['parsed prompt acceptance rows', 'wrote serial smoke evidence file', 'ran serial smoke fixture'], evidence: [{ kind: 'file', path: smokeEvidence, summary: 'serial smoke fixture evidence file' }, { kind: 'test', command: 'node projects/控制台/tools/serial-smoke-test.js', exit_code: 0, summary: 'serial smoke fixture evidence' }], tests: [{ command: 'node projects/控制台/tools/serial-smoke-test.js', exit_code: 0, summary: 'serial smoke fixture' }], conclusion: 'serial smoke complete' } } };
} else {
  payload = { orchestrator: { projectId: '控制台', summary: 'serial smoke route ok', acceptance: [{ text: 'serial smoke acceptance', scope: 'project/控制台' }] } };
}
setTimeout(() => {
  process.stdout.write('serial smoke ok\\n\\n\\\`\\\`\\\`json\\n' + JSON.stringify(payload) + '\\n\\\`\\\`\\\`\\n');
}, delay);
`;
}

function writeHarnessFiles() {
  fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(path.dirname(boardRollup), { recursive: true });
  fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# serial smoke brief\n');
  fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# serial smoke status\n');
  fs.writeFileSync(boardRollup, '# serial smoke rollup\n');
  fs.writeFileSync(path.join(artifactsDir, 'serial-smoke-evidence.md'), [
    '# Serial smoke evidence',
    'review-loop serial smoke completes in 控制台 project scope.',
    'projects/控制台/status.md and board/status-rollup.md pointers are included for status evidence.',
    'peekaboo screenshot and Codex review pointers are included when a visual/UI row is present.',
    '',
  ].join('\n'));
  fs.writeFileSync(mockRunnerPath, mockRunnerSource());
  writeJson(runtimeSettingsPath, { version: 1, engineMaxConcurrency: 1 });
  writeJson(configPath, {
    roleRouting: {
      secretary: { runner: 'mock' },
      orchestrator: { runner: 'mock' },
      supervisor: { runner: 'mock' },
      worker_code: { runner: 'mock' },
      worker_narrow: { runner: 'mock' },
      quality_ops: { runner: 'mock' },
      governance: { runner: 'mock' },
      repair: { runner: 'mock' },
      gui_desktop_control: { runner: 'mock' },
    },
    runners: {
      mock: {
        label: 'Serial Smoke Mock',
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
      ENGINE_MAX_CONCURRENCY: '1',
      CONSOLE_RUNTIME_SETTINGS_TEST_MODE: '1',
      CONSOLE_RUNTIME_SETTINGS_TEST_PATH: runtimeSettingsPath,
      CEO_ACTIVE_TASK_SERIAL_LOCK: '1',
      RUNNER_SINGLEFLIGHT: '',
      AUTO_REPAIR_ENABLED: '0',
      RUNNING_SWEEP_MS: '500',
    }),
    stdio: ['ignore', log, log],
  });
}

function enqueueCeo(id, goal) {
  return Q.enqueue(artifactsDir, 'ceo', {
    role: 'orchestrator',
    flowId: 'project-route',
    projectId: '控制台',
    goal,
    bounds: 'serial smoke only; no secrets',
    acceptance: 'serial smoke completes',
    useOrchestrator: false,
    autoApproveHuman: true,
  }, { id, priority: 50 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function taskFor(events, queueAgent, queueId) {
  const ev = events.find(e => e.type === 'task.queued' && e.queueAgent === queueAgent && e.queueId === queueId);
  return ev && ev.task;
}

function assertNoNodeOverlap(events) {
  const running = new Map();
  const intervals = [];
  for (const ev of events) {
    if (ev.type === 'node.start') {
      const key = `${ev.task}:${ev.node}:${ev.attempt || 1}`;
      running.set(key, ev);
    } else if (ev.type === 'node.end' || ev.type === 'node.fail') {
      const key = `${ev.task}:${ev.node}:${ev.attempt || 1}`;
      const start = running.get(key);
      if (!start) continue;
      running.delete(key);
      intervals.push({
        key,
        start: Date.parse(start.ts),
        end: Date.parse(ev.ts),
        startSeq: start.seq,
        endSeq: ev.seq,
      });
    }
  }
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (a.start < b.end && b.start < a.end) {
        return { ok: false, overlap: [a, b] };
      }
    }
  }
  return { ok: true, intervals };
}

async function waitForDone() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const events = readEvents();
    const firstDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.rootQueueId === 'serialA' && e.ok);
    const secondDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.rootQueueId === 'serialB' && e.ok);
    const firstRootDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'ceo' && e.queueId === 'serialA' && e.ok && e.status === 'done');
    const secondRootDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'ceo' && e.queueId === 'serialB' && e.ok && e.status === 'done');
    if (firstDone && secondDone && firstRootDone && secondRootDone) return events;
    await sleep(200);
  }
  throw new Error('serial smoke timed out waiting for routed supervisor tasks and parent CEO tasks');
}

function stopWorkers(workers) {
  for (const child of workers) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
}

async function main() {
  writeHarnessFiles();
  enqueueCeo('serialA', 'SERIAL_SMOKE_ONE 控制台 first root task');
  enqueueCeo('serialB', 'SERIAL_SMOKE_TWO 控制台 second root task');
  const workers = [spawnWorker('ceo'), spawnWorker('supervisor-控制台')];
  try {
	    const events = await waitForDone();
	    const firstDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'supervisor-控制台' && e.rootQueueId === 'serialA');
	    const firstRootDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'ceo' && e.queueId === 'serialA');
	    const secondRootDone = events.find(e => e.type === 'queue.completed' && e.queueAgent === 'ceo' && e.queueId === 'serialB');
	    const secondTask = taskFor(events, 'ceo', 'serialB');
		    // Elastic direct-to-supervisor routes may not execute an orchestrator-plan
		    // node. task.queued is the stable CEO-start boundary for both paths.
		    const secondStart = events.find(e => e.type === 'task.queued' && e.task === secondTask && e.queueAgent === 'ceo');
	    const waitEvent = events.find(e => e.type === 'ceo.active_task.wait' && e.waitingQueueId === 'serialB');
	    const slotEvents = events.filter(e => e.type === 'engine.slot.acquired');
	    const overlap = assertNoNodeOverlap(events);
	    const unexpectedVisualArtifacts = fs.readdirSync(runRoot, { recursive: true })
	      .map(String)
	      .filter(file => /(?:\.(?:png|jpe?g|webp|gif)|codex-serial-smoke-review\.md)$/i.test(file));
	    const pass = !!firstDone
	      && !!firstRootDone
	      && !!secondRootDone
	      && !!secondStart
	      && Date.parse(firstRootDone.ts) >= Date.parse(firstDone.ts)
	      && Date.parse(secondStart.ts) >= Date.parse(firstRootDone.ts)
	      && slotEvents.every(e => e.maxConcurrency === 1)
	      && overlap.ok
	      && unexpectedVisualArtifacts.length === 0;
	    const report = {
	      pass,
	      runRoot,
	      firstSupervisorDoneSeq: firstDone && firstDone.seq,
	      firstRootDoneSeq: firstRootDone && firstRootDone.seq,
		      secondCeoStartSeq: secondStart && secondStart.seq,
	      secondRootDoneSeq: secondRootDone && secondRootDone.seq,
	      sawSecondWait: !!waitEvent,
	      slotMaxConcurrencyValues: slotEvents.map(e => e.maxConcurrency),
	      nodeOverlap: overlap.ok ? null : overlap.overlap,
	      unexpectedVisualArtifacts,
    };
    writeJson(path.join(runRoot, 'report.json'), report);
    if (!pass) {
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
