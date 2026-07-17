'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const Fence = require('../runner-timeout-failover-fence');

const PROJECT = path.resolve(__dirname, '..');
const CONFIG = path.join(PROJECT, 'config.json');
const FLAG = Fence.ENV_FLAG;

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
}

function initDirtyRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'timeout-fence@example.invalid']);
  git(root, ['config', 'user.name', 'Timeout Fence Test']);
  write(path.join(root, 'tracked.txt'), 'committed\n');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '-qm', 'fixture']);
  fs.appendFileSync(path.join(root, 'tracked.txt'), 'dirty-before-timeout\n');
}

function approvedConfig(overrides = {}) {
  return Object.assign({
    schema: Fence.SCHEMA,
    enabled: true,
    envOverride: FLAG,
    terminationGraceMs: 100,
    settleTimeoutMs: 1000,
    settlePollMs: 20,
    postSettleMonitorMs: 40,
    internalTimeoutLeadMs: 40,
    maxUninterruptibleGraceMs: 80,
    dirtyWorktreeMtimeMonitor: true,
    promotionApproval: {
      status: 'approved',
      supervisorReviewed: true,
      ownerApproved: true,
      approvedBy: '主人',
      approvedAt: '2026-07-17T00:00:00.000Z',
    },
  }, overrides);
}

function eventSink(file) {
  const events = [];
  return {
    events,
    sink: {
      file,
      emit(type, detail) {
        const row = Object.assign({ type }, detail || {});
        events.push(row);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
      },
    },
  };
}

function runnerOptions(root, runners, eventlog, taskId, nodeTimeoutSec = 0.35) {
  return {
    runners,
    roleMap: { worker_code: 'primary-runner' },
    roleExecMeta: { worker_code: { requiresWritableRunnerForImplement: true } },
    rolePrefer: { worker_code: ['subscription.codex'] },
    workdir: root,
    runsDir: path.join(root, 'artifacts', 'engine-runs', taskId),
    nodeTimeoutSec,
    eventlog,
    queueRoot: path.join(root, 'artifacts'),
    queueAgent: 'supervisor-控制台',
    queueId: 'timeout-fence-q',
    taskId,
    projectId: '控制台',
  };
}

function writableContext(taskId, graceMs = 500) {
  return {
    taskId,
    goal: '修改 tracked.txt 并交付文件。',
    bounds: 'fixture only',
    acceptance: '必须真实写入文件。',
    workspaceRoot: '.',
    timeout_failover_fence: {
      uninterruptible_steps: [{ node: 'implement', grace_ms: graceMs, reason: 'fixture atomic step' }],
    },
  };
}

function processStillLive(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  return result.status === 0 && String(result.stdout || '').trim() && !/^Z/i.test(String(result.stdout || '').trim());
}

async function defaultOffAndLeaseContract(root) {
  const production = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).runnerTimeoutFailoverFence;
  const disabled = Fence.activationState(production, { [FLAG]: '1' });
  assert.strictEqual(disabled.enabled, false, 'production config must remain disabled even if env is set');
  assert.strictEqual(disabled.reason, 'config_disabled');
  const approvalMissing = Fence.activationState(Object.assign({}, approvedConfig(), {
    promotionApproval: { status: 'pending', supervisorReviewed: true, ownerApproved: false },
  }), { [FLAG]: '1' });
  assert.strictEqual(approvalMissing.enabled, false, 'environment must not bypass owner approval');
  assert.strictEqual(Fence.activationState(approvedConfig(), { [FLAG]: '1' }).enabled, true);

  const leaseRoot = path.join(root, 'lease-contract');
  const first = Fence._test.acquireTaskWriteLease(leaseRoot, { taskId: 'task-one', node: 'implement', runner: 'primary' });
  assert.strictEqual(first.ok, true);
  const second = Fence._test.acquireTaskWriteLease(leaseRoot, { taskId: 'task-one', node: 'implement', runner: 'fallback' });
  assert.strictEqual(second.ok, false, 'same taskId must have only one writer');
  assert.strictEqual(second.reason, 'task_write_lease_held');
  const blockedRelease = Fence._test.releaseTaskWriteLease(leaseRoot, first, {
    timeout: true,
    treeExited: false,
    evidence: 'fixture:unconfirmed',
  });
  assert.strictEqual(blockedRelease.released, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(first.file, 'utf8')).state, 'blocked_unconfirmed');

  const other = Fence._test.acquireTaskWriteLease(leaseRoot, { taskId: 'task-two', node: 'implement', runner: 'primary' });
  assert.strictEqual(other.ok, true, 'different taskId has an independent lease');
  assert.strictEqual(Fence._test.releaseTaskWriteLease(leaseRoot, other, { reason: 'fixture-complete' }).released, true);
  const markerlessReceipt = Fence._test.validatedSettlement({
    schema: Fence.RECEIPT_SCHEMA,
    task_id: 'task-one',
    node_id: 'implement',
    runner_id: 'primary',
    timeout: { timed_out: true },
    termination: {},
    settle: { tree_exited: true, process_observation_available: true, survivors: [], survivor_process_groups: [] },
  }, { taskId: 'task-one', nodeId: 'implement', resolved: { runnerId: 'primary' } });
  assert.strictEqual(markerlessReceipt.treeExited, false,
    'a legacy receipt without detached-descendant marker observation must fail closed');
  return {
    production_enabled: disabled.enabled,
    owner_gate_bypass_rejected: approvalMissing.enabled === false,
    same_task_second_writer_blocked: second.reason === 'task_write_lease_held',
    unconfirmed_release_state: JSON.parse(fs.readFileSync(first.file, 'utf8')).state,
    markerless_receipt_rejected: markerlessReceipt.treeExited === false,
  };
}

async function confirmedTreeSettlementAllowsFallback(root) {
  const workdir = path.join(root, 'confirmed-worktree');
  initDirtyRepo(workdir);
  const primaryScript = path.join(root, 'primary-timeout.js');
  const fallbackScript = path.join(root, 'fallback.js');
  const fallbackMarker = path.join(root, 'fallback-started.json');
  const pidFile = path.join(root, 'primary-pids.json');
  write(primaryScript, [
    "'use strict';",
    "const fs=require('fs');",
    "const {spawn}=require('child_process');",
    "const tracked=process.argv[2], pidFile=process.argv[3];",
    "const grand=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});",
    "fs.writeFileSync(pidFile,JSON.stringify({parent:process.pid,grandchild:grand.pid}));",
    "process.stdout.write('partial output Bearer TEST_ONLY_TIMEOUT_SECRET\\n');",
    "let wrote=false;process.on('SIGTERM',()=>{if(!wrote){wrote=true;fs.appendFileSync(tracked,'changed-after-timeout\\n');}});",
    "setInterval(()=>{},1000);",
  ].join('\n'));
  write(fallbackScript, [
    "'use strict';",
    "const fs=require('fs');",
    "fs.writeFileSync(process.argv[2],JSON.stringify({started_at:new Date().toISOString(),pid:process.pid}));",
    "process.stdout.write('```json\\n{\"implementation\":{\"done\":true,\"summary\":\"fallback completed\",\"changed_files\":[]}}\\n```\\n');",
  ].join('\n'));
  const taskId = 'task-confirmed-tree';
  const events = eventSink(path.join(root, 'confirmed-events.jsonl'));
  const runners = {
    'primary-runner': {
      cmd: [process.execPath, primaryScript, path.join(workdir, 'tracked.txt'), pidFile],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
    codex: {
      cmd: [process.execPath, fallbackScript, fallbackMarker],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
  };
  const opts = runnerOptions(workdir, runners, events.sink, taskId, 0.35);
  const runner = Fence.makeCliRunner(opts, {
    config: approvedConfig(),
    env: { [FLAG]: '1' },
    artifactsRoot: path.join(workdir, 'artifacts'),
  });
  const result = runner({ id: 'implement', agent_role: 'worker_code' }, writableContext(taskId), 1);
  assert(!result.fail, result.fail);
  assert(fs.existsSync(fallbackMarker), 'confirmed timeout must permit the fallback after lease transfer');

  const runDir = path.join(opts.runsDir, 'implement-1');
  const receipt = JSON.parse(fs.readFileSync(path.join(runDir, 'process-settlement.json'), 'utf8'));
  assert.strictEqual(receipt.timeout.timed_out, true);
  assert.strictEqual(receipt.timeout.uninterruptible_grace_ms, 80, 'explicit grace must be capped by policy');
  assert.strictEqual(receipt.settle.tree_exited, true);
  assert.deepStrictEqual(receipt.settle.survivors, []);
  assert(receipt.termination.observed_tree_pids.length >= 2, 'old CLI and grandchild must both be observed');
  assert(receipt.termination.attempts.some(item => item.signal === 'SIGTERM'));
  assert(receipt.termination.attempts.some(item => item.signal === 'SIGKILL'), 'TERM-resistant fixture must exercise KILL');
  assert(receipt.dirty_worktree.mtime_changes.some(item => item.path === 'tracked.txt'), 'post-timeout dirty worktree change must be attributed');
  const observedPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.strictEqual(processStillLive(observedPids.parent), false, 'primary CLI must be gone before fallback');
  assert.strictEqual(processStillLive(observedPids.grandchild), false, 'primary grandchild must be gone before fallback');

  const redacted = fs.readFileSync(path.join(runDir, 'timeout-output.redacted.log'), 'utf8');
  assert(!redacted.includes('TEST_ONLY_TIMEOUT_SECRET'));
  assert(/REDACTED|redacted/.test(redacted));
  const fallbackStarted = Date.parse(JSON.parse(fs.readFileSync(fallbackMarker, 'utf8')).started_at);
  assert(fallbackStarted >= Date.parse(receipt.settle.confirmed_at), 'writable fallback must start after settle confirmation');
  assert(events.events.some(event => event.type === 'runner.timeout.worktree_mtime_warning' && event.taskId === taskId));
  assert(events.events.some(event => event.type === 'runner.timeout.write_lease.released'));
  const failover = events.events.find(event => event.type === 'runner.failover' && event.reason === 'timeout');
  assert(failover && failover.timeout_settlement_evidence, 'timeout failover must cite settlement evidence');
  const leaseDir = path.join(workdir, 'artifacts', 'runner-timeout-failover', 'leases');
  assert(!fs.existsSync(leaseDir) || fs.readdirSync(leaseDir).length === 0, 'fallback completion must release the task lease');
  return {
    tree_exited: receipt.settle.tree_exited,
    observed_tree_count: receipt.termination.observed_tree_pids.length,
    signals: Array.from(new Set(receipt.termination.attempts.map(item => item.signal))),
    mtime_changed_paths: receipt.dirty_worktree.mtime_changes.map(item => item.path),
    uninterruptible_grace_ms: receipt.timeout.uninterruptible_grace_ms,
    fallback_started_after_settle: fallbackStarted >= Date.parse(receipt.settle.confirmed_at),
    observable_output_redacted: !redacted.includes('TEST_ONLY_TIMEOUT_SECRET'),
    lease_released: !fs.existsSync(leaseDir) || fs.readdirSync(leaseDir).length === 0,
  };
}

async function detachedHistoricalDescendantIsSettled(root) {
  const workdir = path.join(root, 'detached-worktree');
  initDirtyRepo(workdir);
  const daemonScript = path.join(root, 'detached-daemon.js');
  const launcherScript = path.join(root, 'short-lived-launcher.js');
  const primaryScript = path.join(root, 'detached-primary.js');
  const fallbackScript = path.join(root, 'detached-fallback.js');
  const daemonPidFile = path.join(root, 'detached-daemon.pid');
  const primaryPidFile = path.join(root, 'detached-primary.pid');
  const fallbackMarker = path.join(root, 'detached-fallback.json');
  write(daemonScript, [
    "'use strict';",
    "const fs=require('fs');",
    "const pidFile=process.argv[2],tracked=process.argv[3];",
    "fs.writeFileSync(pidFile,String(process.pid));",
    "let wrote=false;process.on('SIGTERM',()=>{if(!wrote){wrote=true;fs.appendFileSync(tracked,'detached-changed-after-timeout\\n');}});",
    "setInterval(()=>{},1000);",
  ].join('\n'));
  write(launcherScript, [
    "'use strict';",
    "const {spawn}=require('child_process');",
    "spawn(process.execPath,[process.argv[2],process.argv[3],process.argv[4]],{detached:true,stdio:'ignore'}).unref();",
  ].join('\n'));
  write(primaryScript, [
    "'use strict';",
    "const fs=require('fs');const {spawn}=require('child_process');",
    "fs.writeFileSync(process.argv[2],String(process.pid));",
    "spawn(process.execPath,[process.argv[3],process.argv[4],process.argv[5],process.argv[6]],{stdio:'ignore'});",
    "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);",
  ].join('\n'));
  write(fallbackScript, [
    "'use strict';",
    "const fs=require('fs');",
    "fs.writeFileSync(process.argv[2],JSON.stringify({started_at:new Date().toISOString()}));",
    "process.stdout.write('```json\\n{\"implementation\":{\"done\":true,\"summary\":\"detached fallback completed\",\"changed_files\":[]}}\\n```\\n');",
  ].join('\n'));

  const taskId = 'task-detached-historical-descendant';
  const events = eventSink(path.join(root, 'detached-events.jsonl'));
  const runners = {
    'primary-runner': {
      cmd: [process.execPath, primaryScript, primaryPidFile, launcherScript, daemonScript, daemonPidFile, path.join(workdir, 'tracked.txt')],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
    codex: {
      cmd: [process.execPath, fallbackScript, fallbackMarker],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
  };
  const opts = runnerOptions(workdir, runners, events.sink, taskId, 0.5);
  let daemonPid = 0;
  let primaryPid = 0;
  try {
    const runner = Fence.makeCliRunner(opts, {
      config: approvedConfig({ maxUninterruptibleGraceMs: 0 }),
      env: { [FLAG]: '1' },
      artifactsRoot: path.join(workdir, 'artifacts'),
    });
    const result = runner({ id: 'implement', agent_role: 'worker_code' }, writableContext(taskId, 0), 1);
    assert(!result.fail, result.fail);
    assert(fs.existsSync(daemonPidFile), 'detached daemon must start before timeout');
    daemonPid = Number(fs.readFileSync(daemonPidFile, 'utf8'));
    primaryPid = Number(fs.readFileSync(primaryPidFile, 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(path.join(opts.runsDir, 'implement-1', 'process-settlement.json'), 'utf8'));
    assert.strictEqual(receipt.settle.tree_exited, true);
    assert.deepStrictEqual(receipt.settle.survivors, []);
    assert.strictEqual(receipt.termination.marker_tracking_required, true);
    assert.strictEqual(receipt.termination.marker_observation_available, true);
    assert(receipt.termination.marker_observed_pids.includes(daemonPid), 'marker scan must recover the reparented detached descendant');
    assert(receipt.termination.observed_tree_pids.includes(daemonPid), 'detached descendant must enter the settlement set');
    assert.strictEqual(processStillLive(primaryPid), false);
    assert.strictEqual(processStillLive(daemonPid), false, 'reparented detached descendant must be gone before fallback');
    assert(fs.existsSync(fallbackMarker));
    const fallbackStarted = Date.parse(JSON.parse(fs.readFileSync(fallbackMarker, 'utf8')).started_at);
    assert(fallbackStarted >= Date.parse(receipt.settle.confirmed_at));
    assert(receipt.dirty_worktree.mtime_changes.some(item => item.path === 'tracked.txt'),
      'detached descendant post-timeout write must be attributed before settlement');
    return {
      tree_exited: receipt.settle.tree_exited,
      marker_observation_available: receipt.termination.marker_observation_available,
      detached_pid_observed: receipt.termination.marker_observed_pids.includes(daemonPid),
      detached_descendant_live_after_settle: processStillLive(daemonPid),
      fallback_started_after_settle: fallbackStarted >= Date.parse(receipt.settle.confirmed_at),
      mtime_changed_paths: receipt.dirty_worktree.mtime_changes.map(item => item.path),
    };
  } finally {
    for (const pid of [daemonPid, primaryPid]) {
      if (!pid) continue;
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    }
  }
}

async function unconfirmedTreeBlocksWritableFallback(root) {
  const workdir = path.join(root, 'unconfirmed-worktree');
  initDirtyRepo(workdir);
  const fallbackMarker = path.join(root, 'forbidden-fallback-marker');
  const fallbackScript = path.join(root, 'forbidden-fallback.js');
  write(fallbackScript, `require('fs').writeFileSync(process.argv[2],'started');\n`);

  const sockets = new Set();
  const server = http.createServer((_req, _res) => {});
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const taskId = 'task-unconfirmed-tree';
  const events = eventSink(path.join(root, 'unconfirmed-events.jsonl'));
  const runners = {
    'primary-runner': {
      kind: 'openai_http',
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: 'fixture-token-not-logged',
      model: 'fixture-model',
      execution: { canWriteFiles: true, canRunCommands: false },
    },
    codex: {
      cmd: [process.execPath, fallbackScript, fallbackMarker],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
  };
  const opts = runnerOptions(workdir, runners, events.sink, taskId, 0.15);
  const runner = Fence.makeCliRunner(opts, {
    config: approvedConfig({ maxUninterruptibleGraceMs: 0 }),
    env: { [FLAG]: '1' },
    artifactsRoot: path.join(workdir, 'artifacts'),
  });
  const result = await runner.runNodeAsync(
    { id: 'implement', agent_role: 'worker_code' },
    writableContext(taskId, 0),
    1,
  );
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  assert(result.fail && result.fail.includes('writable fallback blocked'), JSON.stringify({ result, events: events.events }));
  assert.strictEqual(fs.existsSync(fallbackMarker), false, 'writable fallback must not start without a settlement receipt');
  assert(events.events.some(event => event.type === 'runner.failover.blocked'
    && event.reason === 'process_tree_unconfirmed'
    && event.allowed_actions.includes('read_only_diagnostic')));
  const leaseDir = path.join(workdir, 'artifacts', 'runner-timeout-failover', 'leases');
  const leaseFiles = fs.readdirSync(leaseDir);
  assert.strictEqual(leaseFiles.length, 1, 'unconfirmed writer lease must remain as a fence');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(leaseDir, leaseFiles[0]), 'utf8')).state, 'blocked_unconfirmed');
  const evidence = JSON.parse(fs.readFileSync(path.join(opts.runsDir, 'implement-1', 'timeout-fence-evidence.json'), 'utf8'));
  assert.strictEqual(evidence.tree_exited, false);
  assert.strictEqual(evidence.child_receipt, null);
  const directAcquire = Fence._test.acquireTaskWriteLease(
    path.join(workdir, 'artifacts', 'runner-timeout-failover'),
    { taskId, node: 'implement', runner: 'retry-writer' },
  );
  assert.strictEqual(directAcquire.ok, false, 'a later writable retry must also be fenced');
  return {
    tree_exited: evidence.tree_exited,
    settlement_receipt_present: evidence.child_receipt != null,
    writable_fallback_started: fs.existsSync(fallbackMarker),
    retained_lease_state: JSON.parse(fs.readFileSync(path.join(leaseDir, leaseFiles[0]), 'utf8')).state,
    later_writer_acquire_blocked: directAcquire.reason === 'task_write_lease_held',
    allowed_actions: events.events.find(event => event.type === 'runner.failover.blocked').allowed_actions,
  };
}

async function unconfirmedReadOnlyPrimaryStillBlocksWritableFallback(root) {
  const workdir = path.join(root, 'readonly-unconfirmed-worktree');
  initDirtyRepo(workdir);
  const fallbackMarker = path.join(root, 'readonly-forbidden-fallback-marker');
  const fallbackScript = path.join(root, 'readonly-forbidden-fallback.js');
  write(fallbackScript, `require('fs').writeFileSync(process.argv[2],'started');\n`);
  const sockets = new Set();
  const server = http.createServer((_req, _res) => {});
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const taskId = 'task-readonly-unconfirmed-tree';
  const events = eventSink(path.join(root, 'readonly-unconfirmed-events.jsonl'));
  const runners = {
    'primary-runner': {
      kind: 'openai_http',
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: 'fixture-token-not-logged',
      model: 'fixture-model',
      execution: { canWriteFiles: false, canRunCommands: false },
    },
    codex: {
      cmd: [process.execPath, fallbackScript, fallbackMarker],
      promptVia: 'stdin',
      execution: { canWriteFiles: true, canRunCommands: true },
    },
  };
  const opts = runnerOptions(workdir, runners, events.sink, taskId, 0.15);
  opts.roleExecMeta = {};
  const runner = Fence.makeCliRunner(opts, {
    config: approvedConfig({ maxUninterruptibleGraceMs: 0 }),
    env: { [FLAG]: '1' },
    artifactsRoot: path.join(workdir, 'artifacts'),
  });
  const result = await runner.runNodeAsync({ id: 'implement', agent_role: 'worker_code' }, {
    taskId,
    goal: '查看 runner 状态。',
    bounds: '只读查看。',
    acceptance: '回答状态。',
    workspaceRoot: '.',
  }, 1);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  assert(result.fail && result.fail.includes('writable fallback blocked'), JSON.stringify({ result, events: events.events }));
  assert.strictEqual(fs.existsSync(fallbackMarker), false,
    'an unconfirmed read-only primary must not be followed by a writable fallback');
  assert(events.events.some(event => event.type === 'runner.failover.blocked'
    && event.reason === 'process_tree_unconfirmed'));
  return {
    primary_write_access: false,
    writable_fallback_started: fs.existsSync(fallbackMarker),
    blocked_reason: events.events.find(event => event.type === 'runner.failover.blocked').reason,
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-timeout-fence-'));
  try {
    const results = {
      lease_and_activation: await defaultOffAndLeaseContract(root),
      confirmed_timeout: await confirmedTreeSettlementAllowsFallback(root),
      detached_historical_descendant: await detachedHistoricalDescendantIsSettled(root),
      unconfirmed_timeout: await unconfirmedTreeBlocksWritableFallback(root),
      readonly_unconfirmed_timeout: await unconfirmedReadOnlyPrimaryStillBlocksWritableFallback(root),
    };
    const engineSource = fs.readFileSync(path.join(PROJECT, 'engine-runner.js'), 'utf8');
    const workerSource = fs.readFileSync(path.join(PROJECT, 'ceo-worker.js'), 'utf8');
    assert(engineSource.includes('RunnerTimeoutFailoverFence.makeCliRunner'));
    assert(workerSource.includes('timeoutFailoverFence: payload.timeoutFailoverFence || payload.timeout_failover_fence || null'));
    const report = {
      schema: 'runner-timeout-failover-fence-test@1',
      ok: true,
      scenarios: [
        'default-off-owner-gate',
        'taskId-single-writer-lease',
        'markerless-settlement-receipt-fails-closed',
        'process-tree-term-kill-settle',
        'detached-reparented-descendant-marker-settle',
        'observable-output-redaction',
        'dirty-worktree-mtime-warning',
        'bounded-uninterruptible-grace',
        'confirmed-lease-transfer-before-fallback',
        'unconfirmed-tree-blocks-writable-fallback',
        'unconfirmed-readonly-primary-blocks-writable-fallback',
      ],
      results,
    };
    const reportIndex = process.argv.indexOf('--report');
    if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
      const reportFile = path.resolve(process.argv[reportIndex + 1]);
      write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
      report.report = reportFile;
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exit(1);
});
