#!/usr/bin/env node
'use strict';

// 拍板⑤:特权 runner 写路径白名单-告警模式。
// 固化四条行为:允许区内不告警;区外文件 → privileged.write.outside 事件 + 回执告警且【不失败】;
// 任意合法项目名一视同仁;YUTU6_WRITE_AUDIT=0 → 无动作。
// 基线脏保护:只核【changed_files 声明 ∩ git status 实际改动/新增】,任务前就脏但未声明的文件不误报。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WriteAudit = require('../shared/engine/write-audit');
const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');

const ALLOWED = ['shared/', 'board/'];

function makeGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-audit-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shared', 'mod.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k1\n');
  fs.writeFileSync(path.join(root, 'baseline.txt'), 'b1\n');
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

function withCleanEnv(fn) {
  const prev = process.env.YUTU6_WRITE_AUDIT;
  delete process.env.YUTU6_WRITE_AUDIT;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.YUTU6_WRITE_AUDIT;
    else process.env.YUTU6_WRITE_AUDIT = prev;
  }
}

// ---- 单元:auditChangedFiles ----

// 1) 允许区内的真实改动 → 不告警
function testInsideAllowedNoWarn() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'shared', 'mod.js'), 'module.exports = 2;\n');
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(['shared/mod.js'], ALLOWED, { workspaceRoot: root }));
    assert.strictEqual(res.ok, true, res.reason);
    assert.strictEqual(res.warn, false, '允许区内不得告警');
    assert.deepStrictEqual(res.outside, []);
    assert.deepStrictEqual(res.audited, ['shared/mod.js'], '声明∩git 应命中该文件');
    assert.strictEqual(res.mode, 'intersect');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 2) 允许区外的真实改动 → 告警但不失败(告警模式核心)
function testOutsideAllowedWarnsButOk() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(['secrets/key.txt'], ALLOWED, {
      workspaceRoot: root, runner: 'codex-privileged',
    }));
    assert.strictEqual(res.ok, true, '告警模式:区外写不打回');
    assert.strictEqual(res.warn, true);
    assert.deepStrictEqual(res.outside, ['secrets/key.txt']);
    assert.strictEqual(res.runner, 'codex-privileged');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 3) 基线脏不误报:git 有改动但未声明 → 不进审计集;声明了但 git 无改动 → 也不进
function testBaselineDirtyNotFlagged() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'baseline.txt'), 'b2 dirty before task\n'); // 基线脏(区外)但未声明
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');             // 声明+真改(区外)
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(
      ['secrets/key.txt', 'shared/mod.js'], // shared/mod.js 声明了但 git 干净 → 不进审计集
      ALLOWED,
      { workspaceRoot: root },
    ));
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.outside, ['secrets/key.txt'], '基线脏未声明文件不得误报');
    assert.deepStrictEqual(res.audited, ['secrets/key.txt'], '声明但 git 无改动的文件不进审计集');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 4) 未跟踪目录下新增文件:porcelain 显示 `?? dir/` → 目录前缀也算命中
function testUntrackedDirPrefixHit() {
  const root = makeGitRoot();
  try {
    fs.mkdirSync(path.join(root, 'newzone'), { recursive: true });
    fs.writeFileSync(path.join(root, 'newzone', 'file.js'), 'x\n');
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(['newzone/file.js'], ALLOWED, { workspaceRoot: root }));
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.outside, ['newzone/file.js'], '未跟踪目录下新增文件应被审计并告警');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 5) 项目名称不进入底层策略；项目目录仍按通用允许路径规则审计
function testProjectNamesUseGenericPolicy() {
  const root = makeGitRoot();
  try {
    fs.mkdirSync(path.join(root, 'projects', 'demo-app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'demo-app', 'README.md'), '# demo\n');
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(
      ['projects/demo-app/README.md'],
      ['projects/demo-app/'],
      { workspaceRoot: root },
    ));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.warn, false, '合法项目目录应由 allowedWritePaths 通用放行');
    assert.deepStrictEqual(res.audited, ['projects/demo-app/README.md']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 6) 开关:YUTU6_WRITE_AUDIT=0 → 无动作;默认(未设)→ 开
function testEnvSwitch() {
  const prev = process.env.YUTU6_WRITE_AUDIT;
  try {
    delete process.env.YUTU6_WRITE_AUDIT;
    assert.strictEqual(WriteAudit.writeAuditEnabledFromEnv(), true, '默认开');
    process.env.YUTU6_WRITE_AUDIT = '0';
    assert.strictEqual(WriteAudit.writeAuditEnabledFromEnv(), false, '=0 关');
    const res = WriteAudit.auditChangedFiles(['secrets/key.txt', 'projects/demo-app/x.js'], ALLOWED, { workspaceRoot: '/nonexistent' });
    assert.strictEqual(res.ok, true, '关闭时无动作');
    assert.strictEqual(res.enabled, false);
    assert.strictEqual(res.skipped, 'disabled');
    assert.deepStrictEqual(res.outside, []);
  } finally {
    if (prev === undefined) delete process.env.YUTU6_WRITE_AUDIT;
    else process.env.YUTU6_WRITE_AUDIT = prev;
  }
}

// 7) git 不可用 → 降级只核声明文件,mode=declared_only 并写明局限
function testDeclaredOnlyFallback() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-audit-nogit-'));
  try {
    fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k\n');
    const res = withCleanEnv(() => WriteAudit.auditChangedFiles(['secrets/key.txt'], ALLOWED, {
      workspaceRoot: root,
      gitStatus: undefined,
    }));
    // 非 git 目录下 git status 失败 → declared_only(注意:mkdtemp 目录理论上可能在某个上层 git 仓库内,
    // 此时会走 intersect;两种模式下该文件都应被判区外)
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.outside, ['secrets/key.txt']);
    if (res.mode === 'declared_only') assert(res.limitation, 'declared_only 必须写明局限');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- 单元:auditPrivilegedTaskWrites(runner 归因 + 保守默认)----

function fakeTask(runner, changedFiles) {
  return {
    flow: 'review-loop',
    state: 'done',
    evidence: [{ type: 'result', runner, path: '/tmp/result.md' }],
    steps: {},
    vars: { implementation: { done: true, changed_files: changedFiles } },
  };
}

const RUNNERS_CONFIG = {
  'codex-privileged': { execution: { privileged: true, allowedWritePaths: ALLOWED } },
  'claude-code': { execution: { privileged: true, allowedWritePaths: ALLOWED } },
  codex: { execution: { canWriteFiles: true } },
};

// 8) 非特权 runner 的任务 → 跳过;无 runnersConfig → 跳过(保守默认,零行为变化)
function testSkipConditions() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');
    const nonPriv = withCleanEnv(() => WriteAudit.auditPrivilegedTaskWrites(
      fakeTask('codex', ['secrets/key.txt']),
      { workspaceRoot: root, runnersConfig: RUNNERS_CONFIG },
    ));
    assert.strictEqual(nonPriv.ok, true);
    assert.strictEqual(nonPriv.skipped, 'no_privileged_runner', '非特权 runner 不审计');
    const noCfg = withCleanEnv(() => WriteAudit.auditPrivilegedTaskWrites(
      fakeTask('codex-privileged', ['secrets/key.txt']),
      { workspaceRoot: root },
    ));
    assert.strictEqual(noCfg.ok, true);
    assert.strictEqual(noCfg.skipped, 'no_runner_config', '未注入 runnersConfig 零行为变化');
    const priv = withCleanEnv(() => WriteAudit.auditPrivilegedTaskWrites(
      fakeTask('codex-privileged', ['secrets/key.txt']),
      { workspaceRoot: root, runnersConfig: RUNNERS_CONFIG },
    ));
    assert.strictEqual(priv.ok, true);
    assert.strictEqual(priv.warn, true);
    assert.deepStrictEqual(priv.outside, ['secrets/key.txt']);
    assert.strictEqual(priv.runner, 'codex-privileged');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- 集成:runFlow(review-loop)收口处 → 事件 + 回执告警 + 不打回 ----

function reviewLoopFlow() {
  return {
    id: 'review-loop',
    nodes: [
      { id: 'implement', agent_role: 'worker_code' },
      { id: 'review', agent_role: 'supervisor' },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { from: 'implement', to: 'review' },
      { from: 'review', to: 'done' },
    ],
    guards: { validate_before_run: false, max_loops: 3 },
  };
}

function passingNodeVars(changedFile) {
  return {
    implement: {
      implementation: {
        done: true,
        summary: '修复完成',
        changed_files: [changedFile],
        logic_chain: {
          summary: '修复完成',
          current_status: 'done',
          actions: ['修改文件'],
          evidence: [{ kind: 'file', path: changedFile, summary: '已修改并落盘' }],
          conclusion: '完成',
        },
      },
    },
    review: {
      review: {
        pass: true,
        verified: true,
        notes: `已核实 ${changedFile}`,
        verification: {
          verdict: 'pass',
          checked: [changedFile],
          evidence: [{ path: changedFile, summary: '文件存在且有改动' }],
        },
      },
    },
  };
}

function runReviewLoop(root, changedFile, runnerId) {
  const events = [];
  const nodeVars = passingNodeVars(changedFile);
  const taskId = 'write-audit-' + path.basename(changedFile).replace(/[^A-Za-z0-9]+/g, '-') + '-' + (runnerId || 'x');
  const result = runFlow({
    flow: reviewLoopFlow(),
    taskId,
    taskstore: new TaskStore(path.join(root, '.tasks')),
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
    workspaceRoot: root,
    runnersConfig: RUNNERS_CONFIG,
    vars: { goal: '修复引擎模块', acceptance: '产出可验证证据' },
    runner(node, ctx) {
      // 主工作区 done-gate 带协议门(结构化回执):implement 节点须按 ctx 里的规格指纹产出 receipt
      const vars = nodeVars[node.id] ? JSON.parse(JSON.stringify(nodeVars[node.id])) : {};
      if (node.id === 'implement' && vars.implementation) {
        vars.implementation.receipt = {
          taskId,
          specFingerprint: (ctx && ctx.spec_fingerprint) || '',
          changedFiles: vars.implementation.changed_files || [],
          tests: ['node tests/write-audit.test.js exit 0'],
          artifacts: [changedFile + ':1'],
          verdict: 'done',
          blocked_required_specs: [],
        };
      }
      return {
        vars,
        evidence: { type: 'result', runner: runnerId, path: path.join(root, 'result.md') },
      };
    },
  });
  return { result, events };
}

// 9) 特权 runner 写到允许区外 → privileged.write.outside 事件 + done_gate.write_audit 回执告警 + 任务仍 done
function testIntegOutsideWarnsButTaskDone() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');
    const { result, events } = withCleanEnv(() => runReviewLoop(root, 'secrets/key.txt', 'codex-privileged'));
    assert.strictEqual(result.ok, true, `告警模式不得打回: ${result.reason || ''}`);
    assert.strictEqual(result.task.state, 'done');
    const ev = events.find(e => e.type === 'privileged.write.outside');
    assert(ev, '必须发 privileged.write.outside 事件');
    assert.strictEqual(ev.runner, 'codex-privileged');
    assert.deepStrictEqual(ev.files, ['secrets/key.txt']);
    const audit = result.task.done_gate && result.task.done_gate.write_audit;
    assert(audit && audit.warn === true, '完成回执必须附 write_audit 告警字段');
    assert.deepStrictEqual(audit.outside, ['secrets/key.txt']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 10) 特权 runner 写在允许区内 → 无事件、回执 outside 为空
function testIntegInsideNoEvent() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'shared', 'mod.js'), 'module.exports = 2;\n');
    const { result, events } = withCleanEnv(() => runReviewLoop(root, 'shared/mod.js', 'codex-privileged'));
    assert.strictEqual(result.ok, true, result.reason);
    assert(!events.some(e => e.type === 'privileged.write.outside'), '允许区内不得发告警事件');
    const audit = result.task.done_gate && result.task.done_gate.write_audit;
    assert(audit, '特权 runner 任务回执应带审计结果');
    assert.deepStrictEqual(audit.outside, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 11) 开关关闭 → 区外也无事件、回执无告警字段
function testIntegSwitchOff() {
  const root = makeGitRoot();
  const prev = process.env.YUTU6_WRITE_AUDIT;
  try {
    process.env.YUTU6_WRITE_AUDIT = '0';
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');
    const { result, events } = runReviewLoop(root, 'secrets/key.txt', 'codex-privileged');
    assert.strictEqual(result.ok, true, result.reason);
    assert(!events.some(e => e.type === 'privileged.write.outside'), '开关关闭必须无动作');
    assert(!(result.task.done_gate && result.task.done_gate.write_audit), '开关关闭回执不带审计字段');
  } finally {
    if (prev === undefined) delete process.env.YUTU6_WRITE_AUDIT;
    else process.env.YUTU6_WRITE_AUDIT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 12) 非特权 runner 走完 review-loop → 不审计、无事件(不影响既有任务)
function testIntegNonPrivilegedUntouched() {
  const root = makeGitRoot();
  try {
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'k2\n');
    const { result, events } = withCleanEnv(() => runReviewLoop(root, 'secrets/key.txt', 'codex'));
    assert.strictEqual(result.ok, true, result.reason);
    assert(!events.some(e => e.type === 'privileged.write.outside'), '非特权 runner 不审计');
    assert(!(result.task.done_gate && result.task.done_gate.write_audit), '非特权 runner 回执不带审计字段');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// 13) 生产 config.json:两个特权 runner 都声明了 allowedWritePaths(声明式消费点存在)
function testProductionConfigDeclares() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../projects/控制台/config.json'), 'utf8'));
  const priv = WriteAudit.privilegedRunnersWithAllowedPaths(cfg.runners);
  for (const id of ['codex-privileged', 'claude-code']) {
    assert(Array.isArray(priv[id]) && priv[id].length, `${id} 必须声明 execution.allowedWritePaths`);
    assert(priv[id].includes('shared/'), `${id} 允许区应含 shared/`);
    assert(priv[id].includes('VERSION.json'), `${id} 允许区应含 VERSION.json`);
  }
}

function main() {
  testInsideAllowedNoWarn();
  testOutsideAllowedWarnsButOk();
  testBaselineDirtyNotFlagged();
  testUntrackedDirPrefixHit();
  testProjectNamesUseGenericPolicy();
  testEnvSwitch();
  testDeclaredOnlyFallback();
  testSkipConditions();
  testIntegOutsideWarnsButTaskDone();
  testIntegInsideNoEvent();
  testIntegSwitchOff();
  testIntegNonPrivilegedUntouched();
  testProductionConfigDeclares();
  console.log(JSON.stringify({ pass: true, suite: 'write-audit' }));
}

main();
