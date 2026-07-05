#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const runRoot = path.join(ROOT, 'artifacts', 'visual-action-verify-smoke', stamp);
const artifactsDir = path.join(runRoot, 'artifacts');
const projectsDir = path.join(runRoot, 'projects');
const binDir = path.join(runRoot, 'bin');
const configPath = path.join(runRoot, 'config.json');
const mockRunnerPath = path.join(runRoot, 'mock-gui-runner.js');
const fakePeekabooPath = path.join(binDir, 'peekaboo');
const fakeStatePath = path.join(runRoot, 'peekaboo-image-count.txt');
const taskId = `visual-action-smoke-${stamp}`;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readEvents() {
  const file = path.join(artifactsDir, 'engine-events.jsonl');
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeHarness() {
  fs.mkdirSync(path.join(projectsDir, '控制台'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(projectsDir, '控制台', 'brief.md'), '# visual action verify smoke brief\n');
  fs.writeFileSync(path.join(projectsDir, '控制台', 'status.md'), '# visual action verify smoke status\n');
  fs.writeFileSync(mockRunnerPath, `
'use strict';
const prompt = process.argv.slice(2).join('\\n');
const healed = /执行后截图核验判定上一动作未落地/.test(prompt);
const payload = { gui_action: { ok: true, healed } };
process.stdout.write((healed ? 'heal runner ok' : 'first runner ok') + '\\n\\n\\\`\\\`\\\`json\\n' + JSON.stringify(payload) + '\\n\\\`\\\`\\\`\\n');
`);
  fs.writeFileSync(fakePeekabooPath, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] !== 'image') {
  console.error('fake peekaboo only supports image');
  process.exit(2);
}
const idx = args.indexOf('--path');
const out = idx >= 0 ? args[idx + 1] : null;
if (!out) {
  console.error('missing --path');
  process.exit(2);
}
const state = process.env.PEEKABOO_FAKE_STATE;
let n = 0;
try { n = parseInt(fs.readFileSync(state, 'utf8'), 10) || 0; } catch (_) {}
n += 1;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(state, String(n));
fs.writeFileSync(out, n < 3 ? 'unchanged-screen\\n' : 'changed-screen-after-heal\\n');
`);
  fs.chmodSync(fakePeekabooPath, 0o755);
  writeJson(configPath, {
    roleRouting: {
      gui_desktop_control: { runner: 'mock-gui' },
    },
    runners: {
      'mock-gui': {
        label: 'Mock GUI Action',
        cmd: [process.execPath, mockRunnerPath],
        promptVia: 'arg',
      },
      peekaboo: {
        label: 'Fake Peekaboo Image',
        cmd: ['peekaboo', 'agent'],
        promptVia: 'arg',
      },
    },
  });
}

function runEngine() {
  const specPath = path.join(runRoot, 'spec.json');
  writeJson(specPath, {
    taskId,
    queueAgent: 'supervisor-控制台',
    queueId: 'visualSmoke',
    role: 'gui_desktop_control',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    goal: '点击一个故意不会改变界面的测试按钮,验证未落地后自动纠错。',
    bounds: 'visual action verify smoke only; Starlaid excluded; no secrets',
    inputs: ['projects/控制台/brief.md'],
    acceptance: 'must detect not landed and retry once',
    useOrchestrator: false,
    autoApproveHuman: true,
  });
  return spawnSync(process.execPath, [path.join(ROOT, 'engine-runner.js'), '--spec', specPath], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      CONSOLE_ARTIFACTS_DIR: artifactsDir,
      CONSOLE_CONFIG_PATH: configPath,
      CONSOLE_PROJECTS_DIR: projectsDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      PEEKABOO_FAKE_STATE: fakeStatePath,
      AUTO_REPAIR_ENABLED: '0',
    }),
    encoding: 'utf8',
  });
}

function main() {
  writeHarness();
  const res = runEngine();
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);

  const events = readEvents();
  const verify = events.find(e => e.type === 'action.verify' && e.task === taskId);
  const heal = events.find(e => e.type === 'action.heal' && e.task === taskId);
  const done = events.find(e => e.type === 'task.done' && e.task === taskId);
  assert(verify, 'missing action.verify event');
  assert(heal, 'missing action.heal event');
  assert(done, 'missing task.done event');
  assert.strictEqual(verify.landed, false, 'first verify should detect no landing');
  assert.strictEqual(heal.correction && heal.correction.type, 'retry', 'correction should retry');
  assert.strictEqual(heal.correction && heal.correction.landed, true, 'retry should land');

  const task = readJson(path.join(artifactsDir, 'engine-tasks', `${taskId}.json`));
  const evidence = task.evidence.find(e => e.type === 'computer_use_action_verify');
  assert(evidence, 'missing computer_use_action_verify evidence');
  assert.strictEqual(evidence.correction && evidence.correction.landed, true, 'evidence should record healed landing');

  console.log(JSON.stringify({
    pass: true,
    runRoot,
    verifySeq: verify.seq,
    healSeq: heal.seq,
    beforeScreenshot: evidence.beforeScreenshot,
    afterScreenshot: evidence.afterScreenshot,
    healedScreenshot: evidence.correction.afterScreenshot,
  }, null, 2));
}

main();
