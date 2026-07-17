'use strict';

// P0-A 守卫:证明 done gate 在 executeEvidence/gitVerify 开启时"真执行、真比对",
// 自报 exit_code:0 但命令真跑失败 → 必须打回;声明已改但 git 无改动 → 必须打回。
// 这把"假完成可绕过真实执行"的反例固化进 CI(对应根因诊断 §P0-A / §5)。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const DoneGate = require('../shared/engine/done-gate');

function makeExecTmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-exec-'));
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'pass.fixture.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(root, 'tests', 'fail.fixture.js'), 'process.exit(1);\n');
  return root;
}

function varsWithCommand(command) {
  return { implementation: { logic_chain: { evidence: [{ command, exit_code: 0 }] } } };
}

// 1) 自报 exit_code:0 但命令真跑失败 → executeEvidence 当场堵住
function testExecutedFailureIsCaught() {
  const root = makeExecTmp();
  try {
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('node tests/fail.fixture.js'),
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, false, '真跑失败但自报 exit0 必须被打回');
    assert(/退出码|无法执行/.test(res.reason || ''), `reason 应说明真实退出码: ${res.reason}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 2) 命令真跑通过 → 放行
function testExecutedPassIsOk() {
  const root = makeExecTmp();
  try {
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('node tests/pass.fixture.js'),
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, true, res.reason);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 3) 默认关闭(不传 executeEvidence)→ 不跑命令、向后兼容放行
function testDisabledByDefaultIsNoop() {
  const root = makeExecTmp();
  try {
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('node tests/fail.fixture.js'),
      { workspaceRoot: root },
    );
    assert.strictEqual(res.ok, true, '未开启 executeEvidence 时必须是 no-op');
    assert.strictEqual(res.skipped, 'disabled');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 4) 非白名单命令不被执行(防命令注入/任意执行)
function testNonWhitelistedNotExecuted() {
  const root = makeExecTmp();
  try {
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('rm -rf /tmp/should-not-run && node tests/fail.fixture.js'),
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, true, '非白名单/含串联符的命令不应被执行,也不阻断');
    assert(res.executed.some(e => e.ran === false && e.reason === 'unsafe_shell_syntax'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeGitTmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-git-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.writeFileSync(path.join(root, 'a.js'), 'console.log(1);\n');
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

// 5) gitVerify:声明已改但 git 显示无改动 → 打回
function testGitVerifyUnchangedIsCaught() {
  const root = makeGitTmp();
  try {
    const res = DoneGate.validateChangedFiles(
      { changed_files: ['a.js'] },
      { workspaceRoot: root, gitVerify: true },
    );
    assert.strictEqual(res.ok, false, '存在但 git 无改动的 changed_files 必须被打回');
    assert(/无改动/.test(res.reason || ''), `reason 应说明 git 无改动: ${res.reason}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 6) gitVerify:确有改动 → 放行
function testGitVerifyChangedIsOk() {
  const root = makeGitTmp();
  try {
    fs.writeFileSync(path.join(root, 'a.js'), 'console.log(2); // changed\n');
    const res = DoneGate.validateChangedFiles(
      { changed_files: ['a.js'] },
      { workspaceRoot: root, gitVerify: true },
    );
    assert.strictEqual(res.ok, true, res.reason);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 7) 生产开关:环境变量控制启用(server 注入 '1' 开,测试不注入则关)
function testEnvSwitch() {
  const prev = process.env.YUTU6_DONE_GATE_EXECUTE;
  try {
    delete process.env.YUTU6_DONE_GATE_EXECUTE;
    assert.strictEqual(DoneGate.executeEvidenceEnabledFromEnv(), false, '未设环境变量 → 关(测试默认)');
    process.env.YUTU6_DONE_GATE_EXECUTE = '1';
    assert.strictEqual(DoneGate.executeEvidenceEnabledFromEnv(), true, '=1 → 开(生产)');
    process.env.YUTU6_DONE_GATE_EXECUTE = '0';
    assert.strictEqual(DoneGate.executeEvidenceEnabledFromEnv(), false, '=0 → 关(显式关闭)');
  } finally {
    if (prev === undefined) delete process.env.YUTU6_DONE_GATE_EXECUTE;
    else process.env.YUTU6_DONE_GATE_EXECUTE = prev;
  }
}

// 8) 防递归:执行证据命令时,子进程里的开关被强制置 '0'(否则"证据命令是测试套件"会无限递归)
function testChildEnvDisablesRecursion() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-recur-'));
  const prev = process.env.YUTU6_DONE_GATE_EXECUTE;
  try {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'echo-env.fixture.js'),
      'process.exit(process.env.YUTU6_DONE_GATE_EXECUTE === "1" ? 1 : 0);\n');
    process.env.YUTU6_DONE_GATE_EXECUTE = '1'; // 父进程开关开
    const res = DoneGate.verifyExecutableEvidence(
      { implementation: { logic_chain: { evidence: [{ command: 'node tests/echo-env.fixture.js', exit_code: 0 }] } } },
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, true, '子进程开关应被强制置0 → fixture 退0 → 无递归');
  } finally {
    if (prev === undefined) delete process.env.YUTU6_DONE_GATE_EXECUTE;
    else process.env.YUTU6_DONE_GATE_EXECUTE = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 9) 裸全量套件没有显式范围:收尾阶段不偷偷二次执行
function testUnscopedFullSuiteSleeps() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-full-sleep-'));
  try {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'run.js'), 'process.exit(1);\n');
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('node tests/run.js'),
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, true, '未分档全量套件不应在 DoneGate 收尾阶段二次执行');
    assert(res.executed.some(entry => entry.ran === false && entry.reason === 'unscoped_full_suite'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 10) 显式 profile 仍属于可核范围
function testExplicitProfileRuns() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'done-gate-profile-'));
  try {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tests', 'run.js'),
      'process.exit(process.argv.includes("--profile") && process.argv.includes("lean") ? 0 : 1);\n',
    );
    const res = DoneGate.verifyExecutableEvidence(
      varsWithCommand('node tests/run.js --profile lean'),
      { workspaceRoot: root, executeEvidence: true },
    );
    assert.strictEqual(res.ok, true, res.reason);
    assert(res.executed.some(entry => entry.cmd === 'node tests/run.js --profile lean' && entry.status === 0));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  testExecutedFailureIsCaught();
  testExecutedPassIsOk();
  testDisabledByDefaultIsNoop();
  testNonWhitelistedNotExecuted();
  testGitVerifyUnchangedIsCaught();
  testGitVerifyChangedIsOk();
  testEnvSwitch();
  testChildEnvDisablesRecursion();
  testUnscopedFullSuiteSleeps();
  testExplicitProfileRuns();
  console.log(JSON.stringify({ pass: true, suite: 'done-gate-execute-evidence' }));
}

main();
