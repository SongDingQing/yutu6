'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CliRunner = require('../../shared/engine/cli-runner');
const RunnerFailover = require('../../shared/routing/failover');
const InteractionTrace = require('../../shared/engine/interaction-trace');

const SCHEMA = 'console-runner-timeout-failover-fence@1';
const RECEIPT_SCHEMA = 'runner-timeout-settlement@1';
const ENV_FLAG = 'YUTU6_RUNNER_TIMEOUT_FAILOVER_FENCE';
const SHIM = path.join(__dirname, 'tools', 'runner-process-fence-shim.js');
const CODEX_SHIM = path.join(__dirname, 'tools', 'timeout-fence-bin', 'codex');

function nowIso() {
  return new Date().toISOString();
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 96) || 'unknown';
}

function emit(eventlog, type, detail) {
  try { if (eventlog) eventlog.emit(type, detail); } catch (_) {}
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function activationState(config = {}, env = process.env) {
  const approval = config.promotionApproval && typeof config.promotionApproval === 'object'
    ? config.promotionApproval
    : {};
  const configured = config.schema === SCHEMA && config.enabled === true;
  const supervisorReviewed = approval.supervisorReviewed === true;
  const approvedAt = Date.parse(String(approval.approvedAt || ''));
  const ownerApproved = approval.status === 'approved'
    && approval.ownerApproved === true
    && approval.approvedBy === '主人'
    && Number.isFinite(approvedAt);
  const envName = String(config.envOverride || ENV_FLAG);
  const envEnabled = String(env && env[envName] || '') === '1';
  let reason = 'active';
  if (!configured) reason = 'config_disabled';
  else if (!supervisorReviewed) reason = 'supervisor_review_missing';
  else if (!ownerApproved) reason = 'owner_approval_missing';
  else if (!envEnabled) reason = 'environment_gate_disabled';
  return {
    schema: SCHEMA,
    enabled: configured && supervisorReviewed && ownerApproved && envEnabled,
    configured,
    supervisorReviewed,
    ownerApproved,
    envEnabled,
    envName,
    reason,
  };
}

function normalizedConfig(config = {}) {
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
  };
  return {
    terminationGraceMs: number(config.terminationGraceMs, 750, 50, 1500),
    settleTimeoutMs: number(config.settleTimeoutMs, 1500, 100, 2500),
    settlePollMs: number(config.settlePollMs, 50, 10, 500),
    postSettleMonitorMs: number(config.postSettleMonitorMs, 200, 0, 500),
    internalTimeoutLeadMs: number(config.internalTimeoutLeadMs, 100, 10, 500),
    maxUninterruptibleGraceMs: number(config.maxUninterruptibleGraceMs, 1000, 0, 1000),
    dirtyWorktreeMtimeMonitor: config.dirtyWorktreeMtimeMonitor !== false,
  };
}

function fenceRoot(opts) {
  return path.join(path.resolve(opts.artifactsRoot || path.join(__dirname, 'artifacts')), 'runner-timeout-failover');
}

function leaseFile(root, taskId) {
  const hash = crypto.createHash('sha256').update(String(taskId || '')).digest('hex').slice(0, 24);
  return path.join(root, 'leases', `${hash}.json`);
}

function leaseAudit(root, detail) {
  appendJsonl(path.join(root, 'lease-events.jsonl'), Object.assign({ ts: nowIso() }, detail));
}

function acquireTaskWriteLease(root, meta = {}) {
  const taskId = String(meta.taskId || '').trim();
  if (!taskId) return { ok: false, reason: 'task_id_missing' };
  const file = leaseFile(root, taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomUUID();
  const record = {
    schema: 'task-write-lease@1',
    task_id: taskId,
    token,
    state: 'active',
    holder: {
      engine_pid: process.pid,
      queue_agent: meta.queueAgent || null,
      queue_id: meta.queueId || null,
      node: meta.node || null,
      runner: meta.runner || null,
      candidate_index: Number(meta.candidateIndex || 0),
    },
    acquired_at: nowIso(),
  };
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fs.closeSync(fd);
  } catch (error) {
    try { if (fd != null) fs.closeSync(fd); } catch (_) {}
    const holder = readJson(file);
    leaseAudit(root, {
      action: 'acquire_blocked',
      task_id: taskId,
      node: meta.node || null,
      runner: meta.runner || null,
      candidate_index: Number(meta.candidateIndex || 0),
      holder_state: holder && holder.state || null,
      holder_runner: holder && holder.holder && holder.holder.runner || null,
    });
    return { ok: false, reason: 'task_write_lease_held', file, holder };
  }
  leaseAudit(root, {
    action: 'acquired',
    task_id: taskId,
    token_sha256: crypto.createHash('sha256').update(token).digest('hex'),
    node: meta.node || null,
    runner: meta.runner || null,
    candidate_index: Number(meta.candidateIndex || 0),
  });
  return { ok: true, file, token, record };
}

function blockTaskWriteLease(root, lease, reason, evidence) {
  const current = lease && readJson(lease.file);
  if (!current || current.token !== lease.token) return { ok: false, reason: 'lease_ownership_mismatch' };
  current.state = 'blocked_unconfirmed';
  current.blocked_at = nowIso();
  current.blocked_reason = reason;
  current.settlement_evidence = evidence || null;
  atomicJson(lease.file, current);
  leaseAudit(root, {
    action: 'blocked_unconfirmed',
    task_id: current.task_id,
    node: current.holder && current.holder.node || null,
    runner: current.holder && current.holder.runner || null,
    reason,
    evidence: evidence || null,
  });
  return { ok: true, file: lease.file };
}

function releaseTaskWriteLease(root, lease, opts = {}) {
  const current = lease && readJson(lease.file);
  if (!current || current.token !== lease.token) return { released: false, reason: 'lease_ownership_mismatch' };
  if (opts.timeout === true && opts.treeExited !== true) {
    blockTaskWriteLease(root, lease, 'timeout_process_tree_unconfirmed', opts.evidence || null);
    return { released: false, reason: 'process_tree_unconfirmed' };
  }
  try { fs.unlinkSync(lease.file); } catch (_) { return { released: false, reason: 'lease_unlink_failed' }; }
  leaseAudit(root, {
    action: 'released',
    task_id: current.task_id,
    node: current.holder && current.holder.node || null,
    runner: current.holder && current.holder.runner || null,
    reason: opts.reason || 'candidate_settled',
    tree_exited: opts.treeExited == null ? null : !!opts.treeExited,
    evidence: opts.evidence || null,
  });
  return { released: true };
}

function runnerExecution(runner) {
  const execution = runner && runner.execution && typeof runner.execution === 'object' ? runner.execution : {};
  const explicit = execution.canWriteFiles != null ? execution.canWriteFiles : execution.writeFiles;
  if (explicit != null) return { canWriteFiles: explicit === true };
  const kind = runner && runner.kind;
  const cmd0 = runner && Array.isArray(runner.cmd) ? runner.cmd[0] : null;
  return { canWriteFiles: kind === 'openai_http_tool_harness' || (kind !== 'openai_http' && cmd0 !== '__mock__') };
}

function uninterruptibleDeclaration(node, ctx, config) {
  const source = ctx && ctx.timeout_failover_fence;
  const steps = source && Array.isArray(source.uninterruptible_steps) ? source.uninterruptible_steps : [];
  const item = steps.find(step => step && String(step.node || '') === String(node && node.id || ''));
  if (!item || !String(item.reason || '').trim()) return null;
  const requested = Math.max(0, Number(item.grace_ms || item.graceMs) || 0);
  if (!requested) return null;
  return {
    node: String(node.id),
    reason: String(item.reason).replace(/\s+/g, ' ').trim().slice(0, 240),
    requested_grace_ms: requested,
    bounded_grace_ms: Math.min(requested, config.maxUninterruptibleGraceMs),
  };
}

function isCodexRunner(runner) {
  return Boolean(runner && Array.isArray(runner.cmd) && runner.cmd.length
    && /(?:^|\/)codex$/.test(String(runner.cmd[0]))
    && runner.cmd.some(arg => String(arg) === 'exec'));
}

function wrapCommandRunners(runners, meta, config) {
  const out = {};
  for (const [id, source] of Object.entries(runners || {})) {
    const runner = Object.assign({}, source || {});
    if (!Array.isArray(runner.cmd) || !runner.cmd.length || runner.cmd[0] === '__mock__') {
      out[id] = runner;
      continue;
    }
    const original = runner.cmd.slice();
    runner.env = Object.assign({}, runner.env || {}, {
      YUTU6_TIMEOUT_FENCE_ORIGINAL_EXECUTABLE: String(original[0]),
      YUTU6_TIMEOUT_FENCE_RECEIPT: meta.receiptPath,
      YUTU6_TIMEOUT_FENCE_TASK_ID: meta.taskId,
      YUTU6_TIMEOUT_FENCE_NODE_ID: meta.nodeId,
      YUTU6_TIMEOUT_FENCE_RUNNER_ID: id,
      YUTU6_TIMEOUT_FENCE_WORKDIR: meta.workdir,
      YUTU6_TIMEOUT_FENCE_TIMEOUT_MS: String(meta.timeoutMs),
      YUTU6_TIMEOUT_FENCE_INTERNAL_LEAD_MS: String(config.internalTimeoutLeadMs),
      YUTU6_TIMEOUT_FENCE_TERM_GRACE_MS: String(config.terminationGraceMs),
      YUTU6_TIMEOUT_FENCE_SETTLE_TIMEOUT_MS: String(config.settleTimeoutMs),
      YUTU6_TIMEOUT_FENCE_SETTLE_POLL_MS: String(config.settlePollMs),
      YUTU6_TIMEOUT_FENCE_POST_SETTLE_MONITOR_MS: String(config.postSettleMonitorMs),
      YUTU6_TIMEOUT_FENCE_UNINTERRUPTIBLE_GRACE_MS: String(meta.declaration && meta.declaration.bounded_grace_ms || 0),
      YUTU6_TIMEOUT_FENCE_DIRTY_MONITOR: config.dirtyWorktreeMtimeMonitor ? '1' : '0',
    });
    runner.cmd = isCodexRunner(source)
      ? [CODEX_SHIM, ...original.slice(1)]
      : [process.execPath, SHIM, ...original.slice(1)];
    out[id] = runner;
  }
  return out;
}

function redactedObservableOutput(runDir) {
  const sources = ['result.md', 'process.log'];
  const chunks = [];
  for (const name of sources) {
    const file = path.join(runDir, name);
    let body = '';
    try { body = fs.readFileSync(file, 'utf8'); } catch (_) {}
    if (body) chunks.push(`[${name}]\n${body}`);
  }
  let safe = InteractionTrace.redact(chunks.join('\n\n'));
  if (!safe) safe = '[no observable output captured]';
  if (safe.length > 32768) safe = `${safe.slice(0, 16350)}\n...[truncated]...\n${safe.slice(-16350)}`;
  const file = path.join(runDir, 'timeout-output.redacted.log');
  fs.writeFileSync(file, `${safe}\n`, { mode: 0o600 });
  return {
    path: file,
    redacted: true,
    bytes: Buffer.byteLength(`${safe}\n`),
    sources: sources.map(name => ({ path: path.join(runDir, name), exists: fs.existsSync(path.join(runDir, name)) })),
  };
}

function validatedSettlement(receipt, meta) {
  const validIdentity = !!(receipt
    && receipt.schema === RECEIPT_SCHEMA
    && receipt.task_id === meta.taskId
    && receipt.node_id === meta.nodeId
    && receipt.runner_id === meta.resolved.runnerId
    && receipt.timeout && receipt.timeout.timed_out === true);
  const survivors = validIdentity && receipt.settle && Array.isArray(receipt.settle.survivors)
    ? receipt.settle.survivors
    : [];
  const survivorGroups = validIdentity && receipt.settle && Array.isArray(receipt.settle.survivor_process_groups)
    ? receipt.settle.survivor_process_groups
    : [];
  const markerObservationValid = !!(validIdentity
    && receipt.termination
    && receipt.termination.marker_tracking_required === true
    && receipt.termination.marker_observation_available === true
    && Array.isArray(receipt.termination.marker_observed_pids));
  const treeExited = !!(validIdentity
    && receipt.settle
    && receipt.settle.tree_exited === true
    && receipt.settle.process_observation_available === true
    && markerObservationValid
    && survivors.length === 0
    && survivorGroups.length === 0);
  return {
    validIdentity,
    treeExited,
    survivors,
    survivorGroups,
    markerObservationValid,
    mtimeChanges: validIdentity && receipt.dirty_worktree && Array.isArray(receipt.dirty_worktree.mtime_changes)
      ? receipt.dirty_worktree.mtime_changes
      : [],
  };
}

function persistFenceEvidence(runDir, detail) {
  const file = path.join(runDir, 'timeout-fence-evidence.json');
  atomicJson(file, Object.assign({ schema: 'runner-timeout-fence-evidence@1', recorded_at: nowIso() }, detail));
  return file;
}

function failureKind(result) {
  return result && result.fail ? RunnerFailover.classifyFailure(result.fail) : null;
}

function candidatesFor(node, opts) {
  const role = node && node.agent_role;
  const primary = opts.roleMap && opts.roleMap[role] || 'codex';
  const rolePrefer = opts.rolePrefer || RunnerFailover.loadRolePrefer(opts.routingFile);
  const chain = RunnerFailover.failoverCandidates(role, {
    primaryRunnerId: primary,
    runners: opts.runners,
    rolePrefer,
  });
  return chain.length ? chain : [primary];
}

function prepareCandidate(node, ctx, attempt, candidate, index, opts, state) {
  const role = node && node.agent_role;
  const roleMap = Object.assign({}, opts.roleMap || {}, { [role]: candidate });
  const resolved = CliRunner.resolveRunnerForNode(node, ctx, roleMap, opts.runners, candidate, opts.roleExecMeta || {});
  if (resolved.fail) return { fail: resolved.fail, candidate, index };
  const candidateRunsDir = index === 0
    ? opts.runsDir
    : path.join(opts.runsDir, 'timeout-failover', `candidate-${index}-${safeName(candidate)}`);
  const runDir = path.join(candidateRunsDir, `${node.id}-${attempt}`);
  fs.mkdirSync(runDir, { recursive: true });
  const receiptPath = path.join(runDir, 'process-settlement.json');
  const declaration = uninterruptibleDeclaration(node, ctx, state.config);
  const timeoutMs = Math.max(1, Number(opts.nodeTimeoutSec || 600) * 1000);
  const wrappedRunners = wrapCommandRunners(opts.runners, {
    receiptPath,
    taskId: String(opts.taskId || ctx && ctx.taskId || ''),
    nodeId: String(node.id || ''),
    workdir: path.resolve(opts.workdir || process.cwd()),
    timeoutMs,
    declaration,
  }, state.config);
  const single = CliRunner.makeCliRunner(Object.assign({}, opts, {
    runners: wrappedRunners,
    roleMap,
    runsDir: candidateRunsDir,
    failover: false,
  }));
  const writable = CliRunner.nodeNeedsWritableRunner(node, ctx, opts.roleExecMeta && opts.roleExecMeta[role])
    || (['implement', 'execute'].includes(String(node && node.id || ''))
      && runnerExecution(resolved.runner).canWriteFiles);
  if (declaration) {
    emit(opts.eventlog, 'runner.timeout.uninterruptible_grace.declared', {
      task: opts.taskId || null,
      node: node.id,
      role,
      runner: resolved.runnerId,
      candidate_index: index,
      reason: declaration.reason,
      requested_grace_ms: declaration.requested_grace_ms,
      bounded_grace_ms: declaration.bounded_grace_ms,
      projectId: opts.projectId || null,
    });
  }
  return {
    candidate,
    index,
    role,
    resolved,
    single,
    runDir,
    receiptPath,
    declaration,
    writable,
    taskId: String(opts.taskId || ctx && ctx.taskId || ''),
    nodeId: String(node.id || ''),
  };
}

function acquireCandidateLease(prepared, opts, state) {
  if (!prepared.writable) return null;
  const lease = acquireTaskWriteLease(state.root, {
    taskId: prepared.taskId,
    queueAgent: opts.queueAgent || null,
    queueId: opts.queueId || null,
    node: prepared.nodeId,
    runner: prepared.resolved.runnerId,
    candidateIndex: prepared.index,
  });
  if (!lease.ok) {
    emit(opts.eventlog, 'runner.timeout.write_lease.blocked', {
      task: prepared.taskId,
      node: prepared.nodeId,
      runner: prepared.resolved.runnerId,
      candidate_index: prepared.index,
      reason: lease.reason,
      projectId: opts.projectId || null,
    });
  } else {
    emit(opts.eventlog, 'runner.timeout.write_lease.acquired', {
      task: prepared.taskId,
      node: prepared.nodeId,
      runner: prepared.resolved.runnerId,
      candidate_index: prepared.index,
      lease: lease.file,
      projectId: opts.projectId || null,
    });
  }
  return lease;
}

function finalizeCandidate(prepared, result, lease, candidates, opts, state, threw) {
  const receipt = readJson(prepared.receiptPath);
  const timedOut = failureKind(result) === 'timeout' || !!(receipt && receipt.timeout && receipt.timeout.timed_out);
  if (!timedOut) {
    if (threw && prepared.writable) {
      if (lease && lease.ok) blockTaskWriteLease(state.root, lease, 'candidate_exception_process_state_unknown', null);
      return { done: true, result: { fail: 'runner execution state unknown; manual intervention required before writable fallback' } };
    }
    if (lease && lease.ok) releaseTaskWriteLease(state.root, lease, { reason: 'candidate_completed' });
    if (!result.fail) return { done: true, result };
    return { done: false, result };
  }

  const output = redactedObservableOutput(prepared.runDir);
  const settlement = validatedSettlement(receipt, prepared);
  const evidenceFile = persistFenceEvidence(prepared.runDir, {
    task_id: prepared.taskId,
    node_id: prepared.nodeId,
    role: prepared.role,
    runner: prepared.resolved.runnerId,
    candidate_index: prepared.index,
    write_access: prepared.writable,
    child_receipt: fs.existsSync(prepared.receiptPath) ? prepared.receiptPath : null,
    receipt_identity_valid: settlement.validIdentity,
    marker_observation_valid: settlement.markerObservationValid,
    tree_exited: settlement.treeExited,
    survivors: settlement.survivors,
    survivor_process_groups: settlement.survivorGroups,
    observable_output: output,
    dirty_worktree_mtime_changes: settlement.mtimeChanges,
    uninterruptible_declaration: prepared.declaration,
  });
  emit(opts.eventlog, 'runner.timeout.detected', {
    task: prepared.taskId,
    node: prepared.nodeId,
    runner: prepared.resolved.runnerId,
    candidate_index: prepared.index,
    write_access: prepared.writable,
    evidence: evidenceFile,
    projectId: opts.projectId || null,
  });
  emit(opts.eventlog, 'runner.timeout.settled', {
    task: prepared.taskId,
    node: prepared.nodeId,
    runner: prepared.resolved.runnerId,
    candidate_index: prepared.index,
    tree_exited: settlement.treeExited,
    receipt_identity_valid: settlement.validIdentity,
    marker_observation_valid: settlement.markerObservationValid,
    survivor_count: settlement.survivors.length,
    evidence: evidenceFile,
    projectId: opts.projectId || null,
  });
  if (settlement.mtimeChanges.length) {
    emit(opts.eventlog, 'runner.timeout.worktree_mtime_warning', {
      task: prepared.taskId,
      taskId: prepared.taskId,
      node: prepared.nodeId,
      runner: prepared.resolved.runnerId,
      candidate_index: prepared.index,
      changed_count: settlement.mtimeChanges.length,
      changed_paths: settlement.mtimeChanges.slice(0, 100).map(item => item.path),
      evidence: evidenceFile,
      projectId: opts.projectId || null,
    });
  }

  if (!settlement.treeExited) {
    if (prepared.writable && lease && lease.ok) {
      releaseTaskWriteLease(state.root, lease, {
        timeout: true,
        treeExited: false,
        evidence: evidenceFile,
      });
    }
    emit(opts.eventlog, 'runner.failover.blocked', {
      task: prepared.taskId,
      node: prepared.nodeId,
      runner: prepared.resolved.runnerId,
      candidate_index: prepared.index,
      reason: 'process_tree_unconfirmed',
      allowed_actions: ['manual_intervention', 'read_only_diagnostic'],
      evidence: evidenceFile,
      projectId: opts.projectId || null,
    });
    return {
      done: true,
      result: {
        fail: 'timeout process tree unconfirmed; writable fallback blocked; manual intervention or read-only diagnostic only',
        timeout_fence: {
          blocked: true,
          reason: 'process_tree_unconfirmed',
          evidence: evidenceFile,
        },
      },
    };
  }

  if (prepared.writable) {
    const released = lease && lease.ok
      ? releaseTaskWriteLease(state.root, lease, {
        timeout: true,
        treeExited: settlement.treeExited,
        reason: 'timeout_tree_confirmed',
        evidence: evidenceFile,
      })
      : { released: false, reason: lease && lease.reason || 'write_lease_missing' };
    if (!released.released) {
      emit(opts.eventlog, 'runner.failover.blocked', {
        task: prepared.taskId,
        node: prepared.nodeId,
        runner: prepared.resolved.runnerId,
        candidate_index: prepared.index,
        reason: released.reason,
        allowed_actions: ['manual_intervention', 'read_only_diagnostic'],
        evidence: evidenceFile,
        projectId: opts.projectId || null,
      });
      return {
        done: true,
        result: {
          fail: 'timeout process tree unconfirmed; writable fallback blocked; manual intervention or read-only diagnostic only',
          timeout_fence: {
            blocked: true,
            reason: released.reason,
            evidence: evidenceFile,
          },
        },
      };
    }
    emit(opts.eventlog, 'runner.timeout.write_lease.released', {
      task: prepared.taskId,
      node: prepared.nodeId,
      runner: prepared.resolved.runnerId,
      candidate_index: prepared.index,
      reason: 'timeout_tree_confirmed',
      evidence: evidenceFile,
      projectId: opts.projectId || null,
    });
  }
  return { done: false, result, timeoutEvidence: evidenceFile };
}

function emitFailover(prepared, next, result, opts, timeoutEvidence) {
  emit(opts.eventlog, 'runner.failover', {
    task: prepared.taskId,
    node: prepared.nodeId,
    role: prepared.role,
    from: prepared.resolved.runnerId,
    to: next,
    reason: failureKind(result),
    detail: InteractionTrace.redact(String(result && result.fail || '')).slice(0, 300),
    attempt: null,
    timeout_settlement_evidence: timeoutEvidence || null,
    projectId: opts.projectId || null,
  });
}

function makeGuardedCliRunner(opts, state) {
  function runSync(node, ctx, attempt) {
    const candidates = candidatesFor(node, opts);
    let last = { fail: `所有候选 runner 均不可用: ${candidates.join(',')}` };
    for (let index = 0; index < candidates.length; index += 1) {
      const prepared = prepareCandidate(node, ctx, attempt, candidates[index], index, opts, state);
      if (prepared.fail) { last = { fail: prepared.fail }; continue; }
      const lease = acquireCandidateLease(prepared, opts, state);
      if (lease && !lease.ok) return { fail: `task write lease unavailable: ${lease.reason}` };
      let result;
      let threw = false;
      try { result = prepared.single(node, ctx, attempt) || {}; }
      catch (error) { threw = true; result = { fail: InteractionTrace.redact(String(error && error.message || error)) }; }
      const decision = finalizeCandidate(prepared, result, lease, candidates, opts, state, threw);
      if (decision.done) return decision.result;
      last = decision.result;
      if (index < candidates.length - 1) emitFailover(prepared, candidates[index + 1], result, opts, decision.timeoutEvidence);
    }
    return last;
  }
  runSync.runNodeAsync = async function runNodeAsync(node, ctx, attempt) {
    const candidates = candidatesFor(node, opts);
    let last = { fail: `所有候选 runner 均不可用: ${candidates.join(',')}` };
    for (let index = 0; index < candidates.length; index += 1) {
      const prepared = prepareCandidate(node, ctx, attempt, candidates[index], index, opts, state);
      if (prepared.fail) { last = { fail: prepared.fail }; continue; }
      const lease = acquireCandidateLease(prepared, opts, state);
      if (lease && !lease.ok) return { fail: `task write lease unavailable: ${lease.reason}` };
      let result;
      let threw = false;
      try { result = await prepared.single.runNodeAsync(node, ctx, attempt) || {}; }
      catch (error) { threw = true; result = { fail: InteractionTrace.redact(String(error && error.message || error)) }; }
      const decision = finalizeCandidate(prepared, result, lease, candidates, opts, state, threw);
      if (decision.done) return decision.result;
      last = decision.result;
      if (index < candidates.length - 1) emitFailover(prepared, candidates[index + 1], result, opts, decision.timeoutEvidence);
    }
    return last;
  };
  return runSync;
}

function makeCliRunner(opts, fenceOptions = {}) {
  const config = fenceOptions.config || {};
  const activation = activationState(config, fenceOptions.env || process.env);
  emit(opts.eventlog, 'runner.timeout_fence.activation', {
    task: opts.taskId || null,
    enabled: activation.enabled,
    reason: activation.reason,
    supervisor_reviewed: activation.supervisorReviewed,
    owner_approved: activation.ownerApproved,
    environment_gate: activation.envEnabled,
    projectId: opts.projectId || null,
  });
  if (!activation.enabled) return CliRunner.makeCliRunner(opts);
  const state = {
    activation,
    config: normalizedConfig(config),
    root: fenceRoot({ artifactsRoot: fenceOptions.artifactsRoot || opts.queueRoot }),
  };
  return makeGuardedCliRunner(opts, state);
}

module.exports = {
  SCHEMA,
  RECEIPT_SCHEMA,
  ENV_FLAG,
  activationState,
  normalizedConfig,
  makeCliRunner,
  _test: {
    fenceRoot,
    leaseFile,
    acquireTaskWriteLease,
    releaseTaskWriteLease,
    blockTaskWriteLease,
    runnerExecution,
    uninterruptibleDeclaration,
    validatedSettlement,
    wrapCommandRunners,
  },
};
