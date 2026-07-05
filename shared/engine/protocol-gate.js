'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROTOCOL_SCHEMA_VERSION = 1;
const DEFAULT_LOCK_LEASE_MS = 120000;
const DEFAULT_LOCK_WAIT_MS = 10000;

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function specPayload(input = {}) {
  return {
    schema_version: PROTOCOL_SCHEMA_VERSION,
    projectId: normalizeText(input.projectId || input.project_id || ''),
    flow: normalizeText(input.flow || input.flowId || input.flow_id || ''),
    goal: normalizeText(input.goal || ''),
    acceptance: normalizeText(input.acceptance || ''),
    bounds: normalizeText(input.bounds || ''),
  };
}

function computeSpecFingerprint(input = {}) {
  return sha256(JSON.stringify(stable(specPayload(input))));
}

function ensureTaskProtocol(ctx = {}, meta = {}) {
  if (!isPlainObject(ctx)) return ctx;
  if (!ctx.spec_snapshot || !isPlainObject(ctx.spec_snapshot)) {
    const snapshot = Object.assign(specPayload({
      projectId: meta.projectId || ctx.projectId || ctx.project_id,
      flow: meta.flow || meta.flowId || ctx.flow || ctx.flowId,
      goal: ctx.goal,
      acceptance: ctx.acceptance,
      bounds: ctx.bounds,
    }), {
      taskId: meta.taskId || ctx.taskId || ctx.task_id || null,
      captured_at: nowIso(),
    });
    snapshot.fingerprint = computeSpecFingerprint(snapshot);
    ctx.spec_snapshot = snapshot;
  }
  ctx.spec_fingerprint = ctx.spec_fingerprint || ctx.spec_snapshot.fingerprint;
  return ctx;
}

function currentSpecForVars(vars = {}, fallback = {}) {
  return specPayload({
    projectId: vars.projectId || vars.project_id || fallback.projectId,
    flow: vars.flow || vars.flowId || fallback.flow,
    goal: vars.goal,
    acceptance: vars.acceptance,
    bounds: vars.bounds,
  });
}

function expectedSpecFingerprint(vars = {}) {
  if (vars.spec_snapshot && isPlainObject(vars.spec_snapshot) && vars.spec_snapshot.fingerprint) {
    return String(vars.spec_snapshot.fingerprint);
  }
  if (vars.spec_fingerprint) return String(vars.spec_fingerprint);
  if (vars.specFingerprint) return String(vars.specFingerprint);
  return '';
}

function protocolRequired(vars = {}) {
  return !!expectedSpecFingerprint(vars) || !!(vars.spec_snapshot && isPlainObject(vars.spec_snapshot));
}

function validateSpecFingerprint(task = {}, opts = {}) {
  const vars = task.vars || {};
  if (!protocolRequired(vars)) return { ok: true, skipped: true, reason: null };
  const expected = expectedSpecFingerprint(vars);
  if (!expected) return { ok: false, reason: '缺少 spec_fingerprint' };
  const current = currentSpecForVars(vars, {
    projectId: opts.projectId || task.projectId || task.project_id,
    flow: task.flow,
  });
  const actual = computeSpecFingerprint(current);
  if (actual !== expected) {
    return {
      ok: false,
      reason: '规格指纹不一致: brief/acceptance/bounds 已变更,必须新 taskId',
      expected,
      actual,
    };
  }
  return { ok: true, reason: null, expected, actual };
}

function implementationFrom(task = {}) {
  const vars = task.vars || {};
  return isPlainObject(vars.implementation) ? vars.implementation : {};
}

function receiptFrom(task = {}) {
  const vars = task.vars || {};
  const impl = implementationFrom(task);
  return firstObject(
    impl.receipt,
    impl.structured_receipt,
    impl.completion_receipt,
    vars.receipt,
    vars.structured_receipt,
    vars.completion_receipt,
  );
}

function firstObject(...values) {
  return values.find(isPlainObject) || null;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(v => v != null && String(v).trim()).map(v => String(v).trim());
  return [String(value).trim()].filter(Boolean);
}

function normalizeVerdict(value) {
  if (value === true) return 'done';
  return String(value == null ? '' : value).trim().toLowerCase();
}

function validateBlockedRequiredSpecs(receipt) {
  const blocked = Array.isArray(receipt && receipt.blocked_required_specs)
    ? receipt.blocked_required_specs
    : Array.isArray(receipt && receipt.blockedRequiredSpecs)
      ? receipt.blockedRequiredSpecs
      : [];
  const unapproved = blocked.filter(item => {
    if (!item) return true;
    if (typeof item === 'string') return true;
    const status = String(item.status || item.decision || '').toLowerCase();
    return !(item.owner_approved === true
      || item.approved_by_owner === true
      || item.ownerApproved === true
      || /approved|owner-approved|deferred_by_owner|waived_by_owner/.test(status));
  });
  if (unapproved.length) {
    return { ok: false, reason: '存在未事前获主人批准的 blocked_required_specs 降级项' };
  }
  return { ok: true, reason: null };
}

function validateStructuredReceipt(task = {}, opts = {}) {
  const vars = task.vars || {};
  if (!protocolRequired(vars)) return { ok: true, skipped: true, reason: null };
  const receipt = receiptFrom(task);
  if (!receipt) return { ok: false, reason: '缺少结构化回执 receipt' };
  const taskId = String(receipt.taskId || receipt.task_id || '');
  if (task.id && taskId && taskId !== String(task.id)) {
    return { ok: false, reason: `receipt.taskId 与任务不一致: ${taskId} != ${task.id}` };
  }
  if (!taskId && opts.requireReceiptTaskId !== false) {
    return { ok: false, reason: 'receipt 缺少 taskId' };
  }
  const spec = String(receipt.specFingerprint || receipt.spec_fingerprint || '');
  const expected = expectedSpecFingerprint(vars);
  if (!spec) return { ok: false, reason: 'receipt 缺少 specFingerprint' };
  if (expected && spec !== expected) {
    return { ok: false, reason: 'receipt.specFingerprint 与任务 spec_fingerprint 不一致' };
  }
  const impl = implementationFrom(task);
  const receiptChanged = normalizeArray(receipt.changedFiles || receipt.changed_files);
  const implChanged = normalizeArray(impl.changed_files);
  const missingChanged = implChanged.filter(file => !receiptChanged.includes(file));
  if (missingChanged.length) {
    return { ok: false, reason: `receipt.changedFiles 未覆盖 implementation.changed_files: ${missingChanged.slice(0, 5).join(', ')}` };
  }
  const tests = normalizeArray(receipt.tests);
  const artifacts = normalizeArray(receipt.artifacts || receipt.evidenceRefs || receipt.evidence_refs);
  if (!receiptChanged.length && !tests.length && !artifacts.length) {
    return { ok: false, reason: 'receipt 缺少 changedFiles/tests/artifacts 证据索引' };
  }
  const verdict = normalizeVerdict(receipt.verdict);
  if (!['done', 'true', 'pass', 'passed', 'complete', 'completed'].includes(verdict)) {
    return { ok: false, reason: `receipt.verdict 未确认完成: ${receipt.verdict == null ? '(missing)' : receipt.verdict}` };
  }
  const blocked = validateBlockedRequiredSpecs(receipt);
  if (!blocked.ok) return blocked;
  return { ok: true, reason: null, receipt };
}

function validateCompletionProtocol(task = {}, opts = {}) {
  const spec = validateSpecFingerprint(task, opts);
  if (!spec.ok) return spec;
  const receipt = validateStructuredReceipt(task, opts);
  if (!receipt.ok) return receipt;
  return {
    ok: true,
    reason: null,
    spec,
    receipt: receipt.receipt || null,
    skipped: !!(spec.skipped && receipt.skipped),
  };
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function git(root, args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 10000,
    maxBuffer: opts.maxBuffer || 4 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function fileHash(root, rel) {
  const file = path.resolve(root, rel);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile()) return null;
  return sha256(fs.readFileSync(file));
}

function defaultBaselineFiles() {
  return [
    'VERSION.json',
    'projects/控制台/server.js',
    'projects/控制台/ceo-worker.js',
    'projects/控制台/hardening-hooks.js',
    'projects/控制台/tools/gate-closeout.js',
    'shared/engine/engine.js',
    'shared/engine/cli-runner.js',
    'shared/engine/done-gate.js',
    'shared/engine/queue.js',
    'shared/engine/protocol-gate.js',
  ];
}

function captureRuntimeBaseline(root, opts = {}) {
  const files = opts.files || defaultBaselineFiles();
  const version = readJson(path.join(root, 'VERSION.json'), null);
  const branch = git(root, ['branch', '--show-current']);
  const commit = git(root, ['rev-parse', '--short=12', 'HEAD']);
  const status = git(root, ['status', '--porcelain', '--', ...files], { timeout: 20000 });
  return {
    schema_version: PROTOCOL_SCHEMA_VERSION,
    captured_at: nowIso(),
    root,
    git: {
      branch: branch.ok ? branch.stdout.trim() : null,
      commit: commit.ok ? commit.stdout.trim() : null,
      status_hash: sha256(status.stdout || ''),
      status_count: (status.stdout || '').split(/\r?\n/).filter(Boolean).length,
    },
    version: version && version.version || null,
    service: Object.assign({
      port: 41218,
      pid: readPid(path.join(root, 'projects/控制台/artifacts/server.pid')),
    }, opts.service || {}),
    files: Object.fromEntries(files.map(rel => [rel, fileHash(root, rel)])),
  };
}

function readPid(file) {
  try {
    const n = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function baselinePath(root, opts = {}) {
  return path.resolve(opts.baselinePath || path.join(root, 'projects/控制台/artifacts/runtime-baseline.json'));
}

function writeRuntimeBaseline(root, opts = {}) {
  const baseline = captureRuntimeBaseline(root, opts);
  writeJsonAtomic(baselinePath(root, opts), baseline);
  return baseline;
}

function compareRuntimeBaseline(root, baseline, opts = {}) {
  if (!baseline) return { ok: false, reason: 'missing_runtime_baseline' };
  const current = captureRuntimeBaseline(root, opts);
  const mismatches = [];
  for (const [rel, hash] of Object.entries(baseline.files || {})) {
    if ((current.files || {})[rel] !== hash) mismatches.push(rel);
  }
  if (baseline.version && current.version !== baseline.version) mismatches.push('VERSION.json:version');
  if (mismatches.length) {
    return { ok: false, reason: `runtime baseline mismatch: ${mismatches.slice(0, 8).join(', ')}`, current, baseline, mismatches };
  }
  return { ok: true, reason: null, current, baseline };
}

function lockRoot(root, opts = {}) {
  return path.resolve(opts.lockRoot || path.join(root, 'projects/控制台/artifacts/resource-locks'));
}

function lockDir(root, name, opts = {}) {
  const safe = String(name || 'default').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80) || 'default';
  return path.join(lockRoot(root, opts), `${safe}.lock`);
}

function sleepSync(ms) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, Math.max(1, Number(ms) || 1));
}

function readLockOwner(dir) {
  return readJson(path.join(dir, 'owner.json'), null);
}

function lockExpired(owner, dir, leaseMs) {
  const heartbeat = owner && Date.parse(owner.heartbeat_at || owner.acquired_at || '');
  if (heartbeat) return Date.now() - heartbeat > leaseMs;
  try { return Date.now() - fs.statSync(dir).mtimeMs > leaseMs; } catch (_) { return true; }
}

function acquireEditLock(root, name, opts = {}) {
  const dir = lockDir(root, name, opts);
  const waitMs = Math.max(0, Number(opts.waitMs || opts.wait_ms || DEFAULT_LOCK_WAIT_MS));
  const leaseMs = Math.max(1000, Number(opts.leaseMs || opts.lease_ms || DEFAULT_LOCK_LEASE_MS));
  const owner = String(opts.owner || `pid:${process.pid}`);
  const deadline = Date.now() + waitMs;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(dir);
      const payload = {
        schema_version: PROTOCOL_SCHEMA_VERSION,
        name,
        owner,
        pid: process.pid,
        acquired_at: nowIso(),
        heartbeat_at: nowIso(),
        lease_ms: leaseMs,
        paths: normalizeArray(opts.paths),
      };
      writeJsonAtomic(path.join(dir, 'owner.json'), payload);
      return {
        ok: true,
        dir,
        owner: payload,
        renew() {
          const current = readLockOwner(dir);
          if (!current || current.owner !== owner) return false;
          current.heartbeat_at = nowIso();
          writeJsonAtomic(path.join(dir, 'owner.json'), current);
          return true;
        },
        release() {
          const current = readLockOwner(dir);
          if (!current || current.owner === owner) fs.rmSync(dir, { recursive: true, force: true });
        },
      };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      const current = readLockOwner(dir);
      if (lockExpired(current, dir, leaseMs)) {
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        return { ok: false, reason: 'edit_lock_busy', dir, owner: current };
      }
      sleepSync(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
}

module.exports = {
  PROTOCOL_SCHEMA_VERSION,
  computeSpecFingerprint,
  ensureTaskProtocol,
  validateSpecFingerprint,
  validateStructuredReceipt,
  validateCompletionProtocol,
  captureRuntimeBaseline,
  writeRuntimeBaseline,
  compareRuntimeBaseline,
  baselinePath,
  acquireEditLock,
  lockDir,
};
