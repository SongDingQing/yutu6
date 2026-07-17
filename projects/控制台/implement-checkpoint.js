#!/usr/bin/env node
'use strict';

/*
 * Long implement checkpoint experiment (project-local, default off).
 *
 * Checkpoints contain metadata and hashes only. They never contain file bodies or
 * patches, so a resume decision cannot restore/overwrite a concurrent edit.
 * The synchronous CLI runner is observed by a small child process which renews a
 * task-worktree lease and writes atomic checkpoints while the parent is blocked.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const InteractionTrace = require('../../shared/engine/interaction-trace');

const CHECKPOINT_SCHEMA = 'yutu6-implement-checkpoint@2';
const CHECKPOINT_LATEST_SCHEMA = 'yutu6-implement-checkpoint-latest@1';
const EXPERIMENT_SCHEMA = 'implement-checkpoint-experiment@1';
const AUDIT_SCHEMA = 'implement-checkpoint-audit@1';
const METRICS_SCHEMA = 'implement-checkpoint-io-metrics@1';
const MONITOR_SCHEMA = 'implement-checkpoint-monitor@1';
const DEFAULT_PROJECT_REL = 'projects/控制台';
const SECRET_KEYS = /(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|credential|otp|密码|密钥|验证码)/i;
const RETRYABLE_FAILURE_RE = /(?:ENOBUFS|ETIMEDOUT|timed\s*out|\btimeout\b|运行超时|maxBuffer|output\s+limit|输出上限)/i;

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value == null ? '' : value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

function canonical(value) {
  return JSON.stringify(stableValue(value));
}

function redactString(value, max = 8000) {
  return InteractionTrace.redact(String(value == null ? '' : value)).slice(0, max);
}

function sanitize(value, key = '') {
  if (SECRET_KEYS.test(String(key || ''))) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 500).map(item => sanitize(item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) out[childKey] = sanitize(childValue, childKey);
  return out;
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120) || 'unknown';
}

function fsyncDirectory(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (_) {
    // Some filesystems do not allow fsync on directories. Rename is still atomic.
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
  }
}

function atomicWrite(file, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const started = process.hrtime.bigint();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
  return {
    bytes: body.length,
    duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

function atomicWriteImmutable(file, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const started = process.hrtime.bigint();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (!existing.equals(body)) throw new Error('immutable_checkpoint_collision');
    return { bytes: 0, duration_ms: Number(process.hrtime.bigint() - started) / 1e6, reused: true };
  }
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(tmp, 0o400);
    try {
      fs.linkSync(tmp, file);
    } catch (error) {
      if (error.code !== 'EEXIST' || !fs.readFileSync(file).equals(body)) throw error;
    }
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
  return { bytes: body.length, duration_ms: Number(process.hrtime.bigint() - started) / 1e6, reused: false };
}

function atomicUpdateSymlink(file, target) {
  const started = process.hrtime.bigint();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    fs.symlinkSync(path.relative(path.dirname(file), target), tmp);
    fs.renameSync(tmp, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    try { if (fs.existsSync(tmp) || fs.lstatSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
  return { bytes: 0, duration_ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

function atomicWriteJson(file, value) {
  return atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = Buffer.from(`${JSON.stringify(sanitize(value))}\n`, 'utf8');
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeSync(fd, body, 0, body.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return body.length;
}

function readJson(file, maxBytes = 4 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function pidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch (_) { return false; }
}

function git(root, args, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: null,
    timeout: 15000,
    maxBuffer,
  });
  if (result.status !== 0 || result.error) {
    const detail = redactString(result.error && result.error.message || Buffer.from(result.stderr || '').toString('utf8'), 500);
    throw new Error(`git ${args[0]} failed: ${detail || result.status}`);
  }
  return Buffer.from(result.stdout || '');
}

function repoRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function worktreeIdentity(workspaceRoot) {
  const top = fs.realpathSync(git(workspaceRoot, ['rev-parse', '--show-toplevel']).toString('utf8').trim());
  const gitDirRaw = git(workspaceRoot, ['rev-parse', '--git-dir']).toString('utf8').trim();
  const gitDir = fs.realpathSync(path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(top, gitDirRaw));
  return {
    top,
    git_dir_hash: sha256(gitDir),
    worktree_id: sha256(`${top}\n${gitDir}`),
  };
}

function snapshotIgnorePaths(workspaceRoot, values = []) {
  const ignored = [];
  for (const value of values) {
    if (!value) continue;
    const relative = repoRelative(workspaceRoot, path.resolve(value)).replace(/\/+$/, '');
    if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) continue;
    ignored.push(relative);
  }
  return [...new Set(ignored)].sort();
}

function excludedStatusPath(file, projectRel, ignoredPaths = []) {
  const normalized = String(file || '').replace(/\\/g, '/');
  const project = String(projectRel || DEFAULT_PROJECT_REL).replace(/\/+$/, '');
  if (!(normalized === project || normalized.startsWith(`${project}/`))) return true;
  return ignoredPaths.some(value => normalized === value || normalized.startsWith(`${value}/`));
}

function statusEntries(workspaceRoot, projectRel = DEFAULT_PROJECT_REL, ignoredPaths = []) {
  const raw = git(workspaceRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', projectRel,
  ]);
  const parts = raw.toString('utf8').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const record = parts[i];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    let file = record.slice(3);
    let original = null;
    if (/[RC]/.test(status) && parts[i + 1]) original = parts[++i];
    file = file.replace(/\\/g, '/');
    if (excludedStatusPath(file, projectRel, ignoredPaths)) continue;
    entries.push({ status, path: file, original_path: original ? original.replace(/\\/g, '/') : null });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function fileFingerprint(workspaceRoot, entry, previous = null, scanStats = null) {
  const absolute = path.resolve(workspaceRoot, entry.path);
  const relative = repoRelative(workspaceRoot, absolute);
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`status path escaped workspace: ${entry.path}`);
  let stat = null;
  try { stat = fs.lstatSync(absolute, { bigint: true }); } catch (_) {}
  if (!stat) {
    if (scanStats) scanStats.reused_hash_count += previous && previous.deleted === true ? 1 : 0;
    return {
      status: entry.status,
      sha256: null,
      bytes: 0,
      mtime: null,
      deleted: true,
      original_path: entry.original_path || null,
    };
  }
  const kind = stat.isSymbolicLink() ? 'symlink'
    : stat.isFile() ? 'file'
      : stat.isDirectory() ? 'directory' : 'special';
  const metadata = {
    status: entry.status,
    bytes: kind === 'file' ? Number(stat.size) : 0,
    mtime: new Date(Number(stat.mtimeNs / 1000000n)).toISOString(),
    mtime_ns: String(stat.mtimeNs),
    ctime_ns: String(stat.ctimeNs),
    inode: String(stat.ino),
    device: String(stat.dev),
    deleted: false,
    mode: Number(stat.mode & 0o777n),
    kind,
    original_path: entry.original_path || null,
  };
  const reusable = previous && previous.deleted === false
    && previous.status === metadata.status
    && Number(previous.bytes || 0) === metadata.bytes
    && previous.mtime_ns === metadata.mtime_ns
    && previous.ctime_ns === metadata.ctime_ns
    && String(previous.inode || '') === metadata.inode
    && String(previous.device || '') === metadata.device
    && Number(previous.mode || 0) === metadata.mode
    && previous.kind === metadata.kind
    && (previous.original_path || null) === metadata.original_path
    && typeof previous.sha256 === 'string';
  if (reusable) {
    if (scanStats) scanStats.reused_hash_count += 1;
    return Object.assign({}, metadata, { sha256: previous.sha256 });
  }
  let bytes;
  if (kind === 'symlink') bytes = Buffer.from(fs.readlinkSync(absolute), 'utf8');
  else if (kind === 'file') bytes = fs.readFileSync(absolute);
  else bytes = Buffer.from(`[${kind}]`, 'utf8');
  if (scanStats) {
    scanStats.hashed_file_count += 1;
    scanStats.hashed_bytes += bytes.length;
  }
  return Object.assign({}, metadata, {
    sha256: sha256(bytes),
    bytes: bytes.length,
  });
}

function workspaceSnapshot(options = {}) {
  const workspaceRoot = options.workspaceRoot || options.workspace_root;
  const projectRel = options.projectRel || options.project_rel || DEFAULT_PROJECT_REL;
  const ignoredPaths = Array.isArray(options.snapshot_ignore_paths) ? options.snapshot_ignore_paths : [];
  const previous = options.current_snapshot || options.previous_snapshot || options.baseline || null;
  if (!workspaceRoot) throw new Error('workspaceSnapshot requires workspaceRoot');
  const started = process.hrtime.bigint();
  let head = 'UNBORN';
  try { head = git(workspaceRoot, ['rev-parse', 'HEAD']).toString('utf8').trim(); } catch (_) {}
  const files = {};
  const scanStats = { hashed_file_count: 0, reused_hash_count: 0, hashed_bytes: 0 };
  for (const entry of statusEntries(workspaceRoot, projectRel, ignoredPaths)) {
    files[entry.path] = fileFingerprint(workspaceRoot, entry, previous && previous.files && previous.files[entry.path], scanStats);
  }
  const worktree_hash = sha256(canonical({ head, files }));
  return {
    head,
    project_path: projectRel,
    worktree_hash,
    files,
    ignored_paths: ignoredPaths,
    hashed_file_count: scanStats.hashed_file_count,
    reused_hash_count: scanStats.reused_hash_count,
    hashed_bytes: scanStats.hashed_bytes,
    scanned_at: nowIso(),
    scan_duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

function changedSinceBaseline(baseline, current) {
  const paths = [...new Set(Object.keys(baseline.files || {}).concat(Object.keys(current.files || {})))].sort();
  const changed = [];
  for (const file of paths) {
    const before = baseline.files && baseline.files[file] || null;
    const after = current.files && current.files[file] || null;
    if (canonical(before) === canonical(after)) continue;
    changed.push({
      path: file,
      status: after && after.status || 'deleted_or_cleaned',
      before_sha256: before && before.sha256 || null,
      after_sha256: after && after.sha256 || null,
      before_bytes: before && Number(before.bytes || 0) || 0,
      after_bytes: after && Number(after.bytes || 0) || 0,
      bytes_delta: (after && Number(after.bytes || 0) || 0) - (before && Number(before.bytes || 0) || 0),
      modified_at: after && after.mtime || nowIso(),
    });
  }
  return changed;
}

function acceptancePoints(text) {
  const points = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    const point = cells[0] || '';
    if (!point || /^(?:要点|-+|:?---+)/.test(point)) continue;
    if (!/^(?:任务验收:|视觉\/UI证据:|设计对照\s)/.test(point)) continue;
    points.push(redactString(point, 6000));
  }
  if (!points.length) {
    for (const item of String(text || '').split(/(?:\r?\n|\d+\.\s+)/).map(value => value.trim()).filter(Boolean)) {
      if (item.length < 8) continue;
      points.push(redactString(item, 6000));
      if (points.length >= 100) break;
    }
  }
  return [...new Set(points)];
}

function acceptanceSnapshot(ctx = {}) {
  const points = acceptancePoints(ctx.acceptance || '');
  const items = points.map((point, index) => ({
    id: `acceptance-${String(index + 1).padStart(2, '0')}-${sha256(point).slice(0, 12)}`,
    version_hash: sha256(point),
    point,
  }));
  return {
    protocol: 'structured-acceptance@2',
    items,
    snapshot_hash: sha256(canonical(items.map(item => ({ id: item.id, version_hash: item.version_hash })))),
  };
}

function completedAcceptancePoints(ctx = {}) {
  const rows = ctx.implementation && Array.isArray(ctx.implementation.acceptance_table)
    ? ctx.implementation.acceptance_table
    : [];
  return new Set(rows
    .filter(row => row && (row.status === '完成' || row.status === 'not_applicable'))
    .map(row => String(row.point || '').trim()));
}

function completedValidations(ctx = {}) {
  const tests = ctx.implementation && ctx.implementation.logic_chain
    && Array.isArray(ctx.implementation.logic_chain.tests)
    ? ctx.implementation.logic_chain.tests
    : [];
  return tests
    .filter(test => test && Number(test.exit_code) === 0 && test.command)
    .map(test => ({
      command: redactString(test.command, 1000),
      exit_code: 0,
      summary: redactString(test.summary || '', 2000),
    }));
}

function implementationFromResult(result) {
  const candidates = [
    result && result.vars && result.vars.implementation,
    result && result.implementation,
    result && result.result && result.result.implementation,
  ];
  return candidates.find(value => value && typeof value === 'object' && !Array.isArray(value)) || null;
}

function refreshSessionProgress(session, ctx, result) {
  const completed = new Set(session.completed_acceptance_points || []);
  const validations = Array.isArray(session.validations) ? session.validations.slice() : [];
  const progressContexts = [ctx];
  const resultImplementation = implementationFromResult(result);
  if (resultImplementation) progressContexts.push({ implementation: resultImplementation });
  for (const source of progressContexts) {
    for (const point of completedAcceptancePoints(source)) completed.add(point);
    validations.push(...completedValidations(source));
  }
  session.completed_acceptance_points = [...completed];
  const unique = new Map();
  for (const validation of validations) {
    const safe = sanitize(validation);
    unique.set(canonical(safe), safe);
  }
  session.validations = [...unique.values()];
  return {
    completed_acceptance_count: session.completed_acceptance_points.length,
    validation_count: session.validations.length,
  };
}

function tokenBudget(config = {}, spec = {}, ctx = {}) {
  const limit = Math.max(1, Number(config.maxCumulativeTokens || 180000));
  const explicit = Number(
    spec.cumulativeTokenUsage != null ? spec.cumulativeTokenUsage
      : ctx.cumulative_token_usage != null ? ctx.cumulative_token_usage
        : 0,
  );
  const promptChars = [ctx.goal, ctx.bounds, ctx.acceptance].filter(Boolean).join('\n').length;
  const estimatedPromptTokens = Math.ceil(promptChars / 4);
  const consumed = Math.max(0, Number.isFinite(explicit) ? explicit : 0) + estimatedPromptTokens;
  const reserve = Math.max(1, Number(config.resumeTokenReserve || 60000));
  return {
    limit,
    consumed,
    resume_reserve: reserve,
    remaining: Math.max(0, limit - consumed),
    within_limit: consumed + reserve <= limit,
    measurement: explicit > 0 ? 'reported_plus_prompt_estimate' : 'prompt_char_estimate',
    prompt_chars: promptChars,
  };
}

function leaseFile(lockDir) {
  return path.join(lockDir, 'lease.json');
}

function leaseExpired(lease, now = Date.now()) {
  return !lease || !Number.isFinite(Date.parse(lease.expires_at)) || Date.parse(lease.expires_at) <= now;
}

function acquireWorktreeLease({ locksRoot, identity, taskId, role, ttlMs = 120000, now = Date.now(), holderPid = process.pid }) {
  fs.mkdirSync(locksRoot, { recursive: true, mode: 0o700 });
  const lockDir = path.join(locksRoot, `${identity.worktree_id}.lease`);
  const swept = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      const lease = {
        schema: 'task-worktree-lock-lease@1',
        lock_id: crypto.randomUUID(),
        granularity: 'task_worktree',
        order: 'single_task_worktree_lock',
        worktree_id: identity.worktree_id,
        owner_task_id: String(taskId || ''),
        owner_role: String(role || ''),
        holder_pid: holderPid,
        acquired_at: nowIso(now),
        renewed_at: nowIso(now),
        expires_at: nowIso(now + ttlMs),
        ttl_ms: ttlMs,
      };
      atomicWriteJson(leaseFile(lockDir), lease);
      return { ok: true, lock_dir: lockDir, lease, swept };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readJson(leaseFile(lockDir));
      const stale = leaseExpired(existing, now) || (existing && !pidAlive(existing.holder_pid));
      if (!stale) return { ok: false, reason: 'worktree_lock_conflict', existing };
      const staleDir = `${lockDir}.stale.${process.pid}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
      try {
        fs.renameSync(lockDir, staleDir);
        swept.push({
          lock_id: existing && existing.lock_id || null,
          owner_task_id: existing && existing.owner_task_id || null,
          expired_at: existing && existing.expires_at || null,
          swept_at: nowIso(now),
          reason: leaseExpired(existing, now) ? 'lease_expired' : 'holder_dead',
        });
        fs.rmSync(staleDir, { recursive: true, force: true });
      } catch (renameError) {
        if (renameError.code !== 'ENOENT') return { ok: false, reason: 'worktree_lock_sweep_conflict' };
      }
    }
  }
  return { ok: false, reason: 'worktree_lock_acquire_retries_exhausted' };
}

function renewWorktreeLease(lockDir, expectedLease, now = Date.now()) {
  const current = readJson(leaseFile(lockDir));
  if (!current || current.lock_id !== expectedLease.lock_id) return { ok: false, reason: 'lock_lease_mismatch' };
  if (leaseExpired(current, now)) return { ok: false, reason: 'lock_lease_expired' };
  const renewed = Object.assign({}, current, {
    renewed_at: nowIso(now),
    expires_at: nowIso(now + Number(current.ttl_ms || expectedLease.ttl_ms || 0)),
  });
  atomicWriteJson(leaseFile(lockDir), renewed);
  return { ok: true, lease: renewed };
}

function validateWorktreeLease(lockDir, expectedLease, now = Date.now()) {
  const current = readJson(leaseFile(lockDir));
  if (!current) return { ok: false, reason: 'lock_lease_missing' };
  if (current.lock_id !== expectedLease.lock_id) return { ok: false, reason: 'lock_lease_mismatch' };
  if (leaseExpired(current, now)) return { ok: false, reason: 'lock_lease_expired' };
  if (!pidAlive(current.holder_pid)) return { ok: false, reason: 'lock_holder_dead' };
  return { ok: true, lease: current };
}

function releaseWorktreeLease(lockDir, expectedLease) {
  const current = readJson(leaseFile(lockDir));
  if (!current) return { ok: true, released: false, reason: 'already_missing' };
  if (current.lock_id !== expectedLease.lock_id) return { ok: false, released: false, reason: 'lock_lease_mismatch' };
  fs.rmSync(lockDir, { recursive: true, force: true });
  return { ok: true, released: true };
}

function checkpointPaths(artifactsRoot, taskId) {
  const dir = path.join(artifactsRoot, 'implement-checkpoints', safeName(taskId));
  return {
    dir,
    checkpoint: path.join(dir, 'checkpoint.json'),
    versions: path.join(dir, 'versions'),
    audit: path.join(dir, 'process-summary.redacted.log'),
    metrics: path.join(dir, 'io-metrics.json'),
    monitor: path.join(dir, 'monitor-session.json'),
  };
}

function contentHashesFromSnapshot(snapshot) {
  return Object.fromEntries(Object.entries(snapshot.files || {}).map(([file, item]) => [file, {
    sha256: item && item.sha256 || null,
    bytes: item && Number(item.bytes || 0) || 0,
    modified_at: item && item.mtime || null,
    mtime_ns: item && item.mtime_ns || null,
    ctime_ns: item && item.ctime_ns || null,
    inode: item && item.inode || null,
    device: item && item.device || null,
    mode: item && Number(item.mode || 0) || 0,
    kind: item && item.kind || null,
    status: item && item.status || null,
    deleted: !!(item && item.deleted),
  }]));
}

function emitAudit(session, event, detail = {}) {
  const record = Object.assign({
    schema: AUDIT_SCHEMA,
    event,
    at: nowIso(),
    task_id: session.task_id,
    node_id: session.node_id,
    agent_role: session.agent_role,
    checkpoint_path: repoRelative(session.workspace_root, session.paths.checkpoint),
  }, sanitize(detail));
  appendJsonl(session.paths.audit, record);
  if (session.eventlog && typeof session.eventlog.emit === 'function') {
    try { session.eventlog.emit(event, record); } catch (_) {}
  }
  return record;
}

function readMetrics(file) {
  const metrics = readJson(file) || {
    schema: METRICS_SCHEMA,
    write_count: 0,
    total_write_bytes: 0,
    total_write_duration_ms: 0,
    max_write_duration_ms: 0,
    scan_count: 0,
    total_scan_duration_ms: 0,
    total_hashed_bytes: 0,
    total_hashed_files: 0,
    total_reused_hashes: 0,
    snapshot_scan_count: 0,
    no_write_sample_count: 0,
    session_setup_scan_count: 0,
    total_sample_decision_duration_ms: 0,
    reasons: {},
  };
  metrics.schema = METRICS_SCHEMA;
  metrics.write_count = Number(metrics.write_count || 0);
  metrics.total_write_bytes = Number(metrics.total_write_bytes || 0);
  metrics.total_write_duration_ms = Number(metrics.total_write_duration_ms || 0);
  metrics.max_write_duration_ms = Number(metrics.max_write_duration_ms || 0);
  metrics.scan_count = Number(metrics.scan_count || 0);
  metrics.snapshot_scan_count = Number(metrics.snapshot_scan_count || metrics.scan_count || 0);
  metrics.no_write_sample_count = Number(metrics.no_write_sample_count || 0);
  metrics.session_setup_scan_count = Number(metrics.session_setup_scan_count || 0);
  metrics.total_scan_duration_ms = Number(metrics.total_scan_duration_ms || 0);
  metrics.total_hashed_bytes = Number(metrics.total_hashed_bytes || 0);
  metrics.total_hashed_files = Number(metrics.total_hashed_files || 0);
  metrics.total_reused_hashes = Number(metrics.total_reused_hashes || 0);
  metrics.max_scan_duration_ms = Number(metrics.max_scan_duration_ms || 0);
  metrics.total_sample_decision_duration_ms = Number(metrics.total_sample_decision_duration_ms || 0);
  metrics.reasons = metrics.reasons || {};
  return metrics;
}

function recordSnapshotScan(metrics, snapshot) {
  const duration = Number(snapshot && snapshot.scan_duration_ms || 0);
  metrics.snapshot_scan_count = Number(metrics.snapshot_scan_count || 0) + 1;
  metrics.scan_count = metrics.snapshot_scan_count;
  metrics.total_scan_duration_ms = Number(metrics.total_scan_duration_ms || 0) + duration;
  metrics.max_scan_duration_ms = Math.max(Number(metrics.max_scan_duration_ms || 0), duration);
  metrics.last_scan_duration_ms = duration;
  metrics.total_hashed_bytes = Number(metrics.total_hashed_bytes || 0) + Number(snapshot && snapshot.hashed_bytes || 0);
  metrics.total_hashed_files = Number(metrics.total_hashed_files || 0) + Number(snapshot && snapshot.hashed_file_count || 0);
  metrics.total_reused_hashes = Number(metrics.total_reused_hashes || 0) + Number(snapshot && snapshot.reused_hash_count || 0);
}

function recordSessionSetupScan(metrics, session) {
  if (metrics.session_setup_scan_count > 0) return;
  recordSnapshotScan(metrics, session.baseline);
  metrics.session_setup_scan_count = 1;
  metrics.session_setup_scan_duration_ms = Number(session.baseline && session.baseline.scan_duration_ms || 0);
  metrics.session_setup_hashed_bytes = Number(session.baseline && session.baseline.hashed_bytes || 0);
  metrics.session_setup_hashed_files = Number(session.baseline && session.baseline.hashed_file_count || 0);
}

function tuneSampleInterval(session, measuredCostMs) {
  const target = Math.min(0.25, Math.max(0.005, Number(session.target_io_overhead_ratio || 0.05)));
  const configured = Math.max(250, Number(session.configured_sample_interval_ms || session.sample_interval_ms || 5000));
  const recommended = Math.ceil(Math.max(0, Number(measuredCostMs || 0)) / (target * 0.8));
  session.sample_interval_ms = Math.max(configured, recommended);
  return session.sample_interval_ms;
}

function writeCheckpoint(session, reason = 'interval', suppliedSnapshot = null) {
  const leaseResult = renewWorktreeLease(session.lock_dir, session.lock_lease);
  if (!leaseResult.ok) throw new Error(leaseResult.reason);
  session.lock_lease = leaseResult.lease;
  const current = suppliedSnapshot || workspaceSnapshot(session);
  const changed = changedSinceBaseline(session.baseline, current);
  const completed = new Set(session.completed_acceptance_points || []);
  const remaining = session.acceptance_snapshot.items
    .filter(item => !completed.has(item.point))
    .map(item => ({ id: item.id, version_hash: item.version_hash, point: item.point }));
  const previousMetrics = readMetrics(session.paths.metrics);
  recordSessionSetupScan(previousMetrics, session);
  const checkpoint = {
    schema_version: CHECKPOINT_SCHEMA,
    checkpoint_id: session.checkpoint_id,
    task_id: session.task_id,
    node_id: session.node_id,
    agent_role: session.agent_role,
    spec_fingerprint: session.spec_fingerprint,
    created_at: session.created_at,
    updated_at: nowIso(),
    trigger_failure: session.trigger_failure || null,
    code: {
      head: current.head,
      git_dir_hash: session.identity.git_dir_hash,
      worktree_id: session.identity.worktree_id,
      project_path: session.project_rel,
    },
    worktree: {
      baseline_hash: session.baseline.worktree_hash,
      current_hash: current.worktree_hash,
      dirty_file_count: Object.keys(current.files || {}).length,
    },
    // Bind every currently dirty project file, not only this node's delta.
    // changed_files remains the node-relative audit list; content_hashes is the
    // stronger concurrent-change invariant over the whole scoped worktree.
    content_hashes: contentHashesFromSnapshot(current),
    changed_files: changed.map(item => item.path),
    diff_summary: changed,
    validations: sanitize(session.validations || []),
    remaining_acceptance: sanitize(remaining),
    acceptance_snapshot: session.acceptance_snapshot,
    lock_lease: sanitize(session.lock_lease),
    cumulative_token_budget: session.cumulative_token_budget,
    resume: {
      count: Number(session.resume_count || 0),
      max_resume: Number(session.max_resume || 1),
    },
    checkpoint_io: {
      policy: 'change_threshold_or_interval',
      reason,
      interval_ms: session.interval_ms,
      change_bytes_threshold: session.change_bytes_threshold,
      prior_write_count: Number(previousMetrics.write_count || 0),
      prior_total_write_bytes: Number(previousMetrics.total_write_bytes || 0),
      prior_total_write_duration_ms: Number(previousMetrics.total_write_duration_ms || 0),
    snapshot_scan_duration_ms: Number(current.scan_duration_ms || 0),
      snapshot_hashed_bytes: Number(current.hashed_bytes || 0),
      snapshot_reused_hashes: Number(current.reused_hash_count || 0),
    },
    redaction: {
      policy: 'secret_values_only',
      implementation: 'shared/engine/interaction-trace.js#redact',
      redacts: ['passwords', 'api keys', 'tokens', 'cookies', 'authorization credentials', 'private keys'],
      preserves: ['repository-relative file paths', 'timestamps', 'content hashes', 'diff metadata', 'validation metadata', 'acceptance IDs and version hashes'],
      raw_secret_mapping_persisted: false,
    },
  };
  checkpoint.integrity = {
    algorithm: 'sha256',
    digest: sha256(canonical(checkpoint)),
  };
  const body = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  const versionPath = path.join(session.paths.versions, `${checkpoint.integrity.digest}.json`);
  const versionWrite = atomicWriteImmutable(versionPath, body);
  const fileSha256 = sha256(body);
  const latestWrite = atomicUpdateSymlink(session.paths.checkpoint, versionPath);
  const write = {
    bytes: versionWrite.bytes + latestWrite.bytes,
    duration_ms: versionWrite.duration_ms + latestWrite.duration_ms,
    immutable_bytes: versionWrite.bytes,
    latest_bytes: latestWrite.bytes,
  };
  const metrics = previousMetrics;
  metrics.write_count = Number(metrics.write_count || 0) + 1;
  metrics.total_write_bytes = Number(metrics.total_write_bytes || 0) + write.bytes;
  metrics.total_write_duration_ms = Number(metrics.total_write_duration_ms || 0) + write.duration_ms;
  metrics.max_write_duration_ms = Math.max(Number(metrics.max_write_duration_ms || 0), write.duration_ms);
  recordSnapshotScan(metrics, current);
  metrics.reasons = metrics.reasons || {};
  metrics.reasons[reason] = Number(metrics.reasons[reason] || 0) + 1;
  metrics.last_write_at = checkpoint.updated_at;
  metrics.last_write_duration_ms = write.duration_ms;
  metrics.target_io_overhead_ratio = Number(session.target_io_overhead_ratio || 0.05);
  metrics.effective_sample_interval_ms = tuneSampleInterval(
    session,
    Number(current.scan_duration_ms || 0) + Number(write.duration_ms || 0),
  );
  metrics.total_measured_io_duration_ms = metrics.total_write_duration_ms + metrics.total_scan_duration_ms;
  atomicWriteJson(session.paths.metrics, metrics);
  emitAudit(session, 'checkpoint_write', {
    reason,
    checkpoint_id: checkpoint.checkpoint_id,
    checkpoint_version_path: repoRelative(session.workspace_root, versionPath),
    checkpoint_file_sha256: fileSha256,
    changed_files: checkpoint.changed_files,
    diff_summary: checkpoint.diff_summary,
    validations: checkpoint.validations,
    remaining_acceptance: checkpoint.remaining_acceptance,
    write_count: metrics.write_count,
    write_bytes: write.bytes,
    write_duration_ms: write.duration_ms,
    snapshot_scan_duration_ms: current.scan_duration_ms,
    snapshot_hashed_bytes: Number(current.hashed_bytes || 0),
    snapshot_reused_hashes: Number(current.reused_hash_count || 0),
    cumulative_write_bytes: metrics.total_write_bytes,
    cumulative_write_duration_ms: metrics.total_write_duration_ms,
    effective_sample_interval_ms: session.sample_interval_ms,
    target_io_overhead_ratio: session.target_io_overhead_ratio,
  });
  session.current_snapshot = current;
  session.latest_checkpoint_version_path = versionPath;
  session.latest_checkpoint_file_sha256 = fileSha256;
  return { checkpoint, checkpoint_path: versionPath, file_sha256: session.latest_checkpoint_file_sha256, write, metrics };
}

function checkpointWithoutIntegrity(checkpoint) {
  const copy = Object.assign({}, checkpoint);
  delete copy.integrity;
  return copy;
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateCheckpointShape(checkpoint) {
  const required = [
    'schema_version', 'checkpoint_id', 'task_id', 'node_id', 'agent_role', 'spec_fingerprint',
    'created_at', 'updated_at', 'code', 'worktree', 'content_hashes', 'changed_files',
    'diff_summary', 'validations', 'remaining_acceptance', 'acceptance_snapshot', 'lock_lease',
    'cumulative_token_budget', 'resume', 'checkpoint_io', 'redaction', 'integrity',
  ];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(checkpoint, field)) {
      return { ok: false, reason: `checkpoint_required_field_missing:${field}` };
    }
  }
  const objectFields = [
    'code', 'worktree', 'content_hashes', 'acceptance_snapshot', 'lock_lease',
    'cumulative_token_budget', 'resume', 'checkpoint_io', 'redaction', 'integrity',
  ];
  for (const field of objectFields) {
    if (!plainObject(checkpoint[field])) return { ok: false, reason: `checkpoint_field_type_invalid:${field}` };
  }
  for (const field of ['changed_files', 'diff_summary', 'validations', 'remaining_acceptance']) {
    if (!Array.isArray(checkpoint[field])) return { ok: false, reason: `checkpoint_field_type_invalid:${field}` };
  }
  const nestedRequired = {
    code: ['head', 'git_dir_hash', 'worktree_id', 'project_path'],
    worktree: ['baseline_hash', 'current_hash', 'dirty_file_count'],
    acceptance_snapshot: ['protocol', 'items', 'snapshot_hash'],
    lock_lease: ['schema', 'lock_id', 'worktree_id', 'owner_task_id', 'owner_role', 'holder_pid', 'expires_at', 'ttl_ms'],
    cumulative_token_budget: ['limit', 'consumed', 'resume_reserve', 'remaining', 'within_limit', 'measurement'],
    resume: ['count', 'max_resume'],
  };
  for (const [parent, fields] of Object.entries(nestedRequired)) {
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(checkpoint[parent], field)) {
        return { ok: false, reason: `checkpoint_required_field_missing:${parent}.${field}` };
      }
    }
  }
  if (!Array.isArray(checkpoint.acceptance_snapshot.items)) {
    return { ok: false, reason: 'checkpoint_field_type_invalid:acceptance_snapshot.items' };
  }
  for (const [file, fingerprint] of Object.entries(checkpoint.content_hashes)) {
    if (!file || !plainObject(fingerprint)
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'sha256')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'bytes')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'modified_at')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'mtime_ns')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'ctime_ns')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'inode')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'device')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'mode')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'kind')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'status')
      || !Object.prototype.hasOwnProperty.call(fingerprint, 'deleted')) {
      return { ok: false, reason: 'checkpoint_content_hash_entry_invalid', file: file || null };
    }
  }
  return { ok: true };
}

function validateCheckpoint(session, opts = {}) {
  let checkpoint;
  let checkpointPath = path.resolve(opts.checkpointPath || session.paths.checkpoint);
  const latestPath = path.resolve(session.paths.checkpoint);
  const versionsRoot = `${path.resolve(session.paths.versions)}${path.sep}`;
  let versionsRealRoot = versionsRoot;
  try { versionsRealRoot = `${fs.realpathSync(session.paths.versions)}${path.sep}`; } catch (_) {}
  if (checkpointPath !== latestPath
    && !checkpointPath.startsWith(versionsRoot)
    && !checkpointPath.startsWith(versionsRealRoot)) {
    return { ok: false, reason: 'checkpoint_path_outside_session' };
  }
  let expectedFileDigest = opts.expectedDigest || null;
  let expectedIntegrityDigest = null;
  if (checkpointPath === latestPath) {
    let latestStat = null;
    try { latestStat = fs.lstatSync(latestPath); } catch (_) {}
    if (latestStat && latestStat.isSymbolicLink()) {
      let selected;
      try { selected = fs.realpathSync(latestPath); } catch (_) {
        return { ok: false, reason: 'checkpoint_latest_path_invalid' };
      }
      if (!selected.startsWith(versionsRealRoot)) return { ok: false, reason: 'checkpoint_latest_path_invalid' };
      checkpointPath = selected;
    } else {
      const latest = readJson(latestPath, 64 * 1024);
      if (latest && latest.schema === CHECKPOINT_LATEST_SCHEMA) {
        const selected = path.resolve(session.workspace_root, String(latest.checkpoint_version_path || ''));
        let selectedReal = selected;
        try { selectedReal = fs.realpathSync(selected); } catch (_) {}
        if (!selectedReal.startsWith(versionsRealRoot)) return { ok: false, reason: 'checkpoint_latest_path_invalid' };
        checkpointPath = selectedReal;
        expectedFileDigest = expectedFileDigest || latest.checkpoint_file_sha256;
        expectedIntegrityDigest = latest.checkpoint_integrity_sha256;
      }
    }
  }
  let checkpointBytes;
  try {
    const stat = fs.statSync(checkpointPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 32 * 1024 * 1024) return { ok: false, reason: 'checkpoint_size_invalid' };
    checkpointBytes = fs.readFileSync(checkpointPath);
    checkpoint = JSON.parse(checkpointBytes.toString('utf8'));
  } catch (_) {
    return { ok: false, reason: 'checkpoint_corrupt_or_half_written' };
  }
  const fileSha256 = sha256(checkpointBytes);
  if (expectedFileDigest && String(expectedFileDigest) !== fileSha256) {
    return { ok: false, reason: 'checkpoint_selected_file_digest_mismatch' };
  }
  if (checkpoint.schema_version !== CHECKPOINT_SCHEMA) return { ok: false, reason: 'checkpoint_schema_mismatch' };
  if (!checkpoint.integrity || checkpoint.integrity.algorithm !== 'sha256'
    || checkpoint.integrity.digest !== sha256(canonical(checkpointWithoutIntegrity(checkpoint)))) {
    return { ok: false, reason: 'checkpoint_integrity_mismatch' };
  }
  if (expectedIntegrityDigest && expectedIntegrityDigest !== checkpoint.integrity.digest) {
    return { ok: false, reason: 'checkpoint_latest_integrity_mismatch' };
  }
  const shape = validateCheckpointShape(checkpoint);
  if (!shape.ok) return shape;
  const expected = [
    ['task_id', session.task_id],
    ['node_id', session.node_id],
    ['agent_role', session.agent_role],
    ['spec_fingerprint', session.spec_fingerprint],
  ];
  for (const [key, value] of expected) if (String(checkpoint[key] || '') !== String(value || '')) return { ok: false, reason: `${key}_mismatch` };
  if (!checkpoint.code || checkpoint.code.worktree_id !== session.identity.worktree_id
    || checkpoint.code.git_dir_hash !== session.identity.git_dir_hash) return { ok: false, reason: 'worktree_identity_mismatch' };
  if (!checkpoint.acceptance_snapshot
    || !Array.isArray(checkpoint.acceptance_snapshot.items)
    || checkpoint.acceptance_snapshot.items.length === 0
    || checkpoint.acceptance_snapshot.snapshot_hash !== session.acceptance_snapshot.snapshot_hash
    || canonical(checkpoint.acceptance_snapshot.items) !== canonical(session.acceptance_snapshot.items)) {
    return { ok: false, reason: 'acceptance_snapshot_mismatch' };
  }
  const lease = validateWorktreeLease(session.lock_dir, session.lock_lease);
  if (!lease.ok) return lease;
  if (!checkpoint.lock_lease || checkpoint.lock_lease.lock_id !== lease.lease.lock_id
    || checkpoint.lock_lease.worktree_id !== lease.lease.worktree_id) return { ok: false, reason: 'checkpoint_lock_lease_mismatch' };
  const ttlMs = Number(opts.checkpointTtlMs || session.checkpoint_ttl_ms || 2 * 60 * 60 * 1000);
  if (!Number.isFinite(Date.parse(checkpoint.updated_at)) || Date.now() - Date.parse(checkpoint.updated_at) > ttlMs) {
    return { ok: false, reason: 'checkpoint_expired' };
  }
  const current = workspaceSnapshot(session);
  if (current.head !== checkpoint.code.head) return { ok: false, reason: 'head_mismatch' };
  if (!checkpoint.worktree || current.worktree_hash !== checkpoint.worktree.current_hash) return { ok: false, reason: 'worktree_state_mismatch' };
  const checkpointFiles = Object.keys(checkpoint.content_hashes).sort();
  const currentFiles = Object.keys(current.files || {}).sort();
  if (canonical(checkpointFiles) !== canonical(currentFiles)) return { ok: false, reason: 'content_hash_file_set_mismatch' };
  const currentContentHashes = contentHashesFromSnapshot(current);
  for (const [file, expectedHash] of Object.entries(checkpoint.content_hashes || {})) {
    if (canonical(currentContentHashes[file]) !== canonical(expectedHash)) {
      return { ok: false, reason: 'content_hash_mismatch', file };
    }
  }
  const budget = checkpoint.cumulative_token_budget;
  if (!budget || !Number.isFinite(Number(budget.limit)) || !Number.isFinite(Number(budget.consumed))
    || Number(budget.consumed) + Number(budget.resume_reserve || 0) > Number(budget.limit)) {
    return { ok: false, reason: 'cumulative_token_budget_exceeded' };
  }
  if (!checkpoint.resume || Number(checkpoint.resume.count || 0) >= Number(checkpoint.resume.max_resume || 1)) {
    return { ok: false, reason: 'max_resume_reached' };
  }
  return {
    ok: true,
    checkpoint,
    checkpoint_path: checkpointPath,
    file_sha256: fileSha256,
    integrity_sha256: checkpoint.integrity.digest,
    current,
    lease: lease.lease,
  };
}

function experimentDecision(config = {}, spec = {}, node = {}, env = process.env) {
  if (env.CONSOLE_IMPLEMENT_CHECKPOINT_EXPERIMENT === '0') return { enabled: false, reason: 'env_rollback' };
  if (!config || config.schema !== EXPERIMENT_SCHEMA) return { enabled: false, reason: 'config_missing' };
  const featureEnabled = config.enabled === true || env.CONSOLE_IMPLEMENT_CHECKPOINT_EXPERIMENT === '1';
  if (!featureEnabled) return { enabled: false, reason: 'feature_flag_disabled' };
  const projects = Array.isArray(config.projectAllowlist) ? config.projectAllowlist : ['控制台'];
  const roles = Array.isArray(config.roleAllowlist) ? config.roleAllowlist : ['worker_code'];
  const nodes = Array.isArray(config.nodeAllowlist) ? config.nodeAllowlist : ['implement'];
  if (!projects.includes(String(spec.projectId || ''))) return { enabled: false, reason: 'project_scope_mismatch' };
  if (!roles.includes(String(node.agent_role || ''))) return { enabled: false, reason: 'role_scope_mismatch' };
  if (!nodes.includes(String(node.id || ''))) return { enabled: false, reason: 'node_scope_mismatch' };
  const taskAllowlist = Array.isArray(config.taskAllowlist) ? config.taskAllowlist.map(String) : [];
  const explicitlySelected = spec.implementCheckpointExperiment === true
    || taskAllowlist.includes(String(spec.taskId || ''));
  const approval = config.promotionApproval || {};
  const approvedAt = Date.parse(String(approval.approvedAt || ''));
  const globalPromotionApproved = approval.status === 'approved'
    && approval.supervisorReviewed === true
    && approval.ownerApproved === true
    && approval.approvedBy === '主人'
    && Number.isFinite(approvedAt);
  if (!explicitlySelected && config.allowAllExperimentTasks === true && !globalPromotionApproved) {
    return { enabled: false, reason: 'owner_promotion_approval_required' };
  }
  const selected = explicitlySelected || (config.allowAllExperimentTasks === true && globalPromotionApproved);
  if (!selected) return { enabled: false, reason: 'task_not_in_experiment_scope' };
  return { enabled: true, reason: explicitlySelected ? 'scoped_experiment' : 'owner_approved_promotion' };
}

function makeSession(opts, node, ctx) {
  const config = opts.config || {};
  const spec = opts.spec || {};
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const identity = worktreeIdentity(workspaceRoot);
  const paths = checkpointPaths(opts.artifactsRoot, spec.taskId);
  const lock = acquireWorktreeLease({
    locksRoot: path.join(opts.artifactsRoot, 'implement-checkpoints', 'locks'),
    identity,
    taskId: spec.taskId,
    role: node.agent_role,
    ttlMs: Number(config.lockLeaseMs || 120000),
  });
  if (!lock.ok) return lock;
  const snapshotIgnore = snapshotIgnorePaths(workspaceRoot, [paths.dir, lock.lock_dir]);
  const baseline = workspaceSnapshot({
    workspaceRoot,
    projectRel: opts.projectRel || DEFAULT_PROJECT_REL,
    snapshot_ignore_paths: snapshotIgnore,
  });
  const acceptance = acceptanceSnapshot(ctx);
  const completed = completedAcceptancePoints(ctx);
  const configuredSampleIntervalMs = Math.max(250, Number(config.sampleIntervalMs || 5000));
  const targetIoOverheadRatio = Math.min(0.25, Math.max(0.005, Number(config.maxIoOverheadRatio || 0.05)));
  const session = {
    schema: MONITOR_SCHEMA,
    workspace_root: workspaceRoot,
    artifacts_root: path.resolve(opts.artifactsRoot),
    project_rel: opts.projectRel || DEFAULT_PROJECT_REL,
    task_id: String(spec.taskId || ctx.taskId || ''),
    node_id: String(node.id || ''),
    agent_role: String(node.agent_role || ''),
    spec_fingerprint: String(spec.spec_fingerprint || ctx.spec_fingerprint || ''),
    checkpoint_id: crypto.randomUUID(),
    created_at: nowIso(),
    identity,
    baseline,
    current_snapshot: baseline,
    snapshot_ignore_paths: snapshotIgnore,
    acceptance_snapshot: acceptance,
    completed_acceptance_points: [...completed],
    validations: completedValidations(ctx),
    cumulative_token_budget: tokenBudget(config, spec, ctx),
    resume_count: Math.max(0, Number(spec.checkpointResumeCount || 0)),
    max_resume: Math.min(1, Math.max(0, Number(config.maxResume == null ? 1 : config.maxResume))),
    checkpoint_ttl_ms: Number(config.checkpointTtlMs || 2 * 60 * 60 * 1000),
    interval_ms: Math.max(1000, Number(config.intervalMs || 60000)),
    configured_sample_interval_ms: configuredSampleIntervalMs,
    sample_interval_ms: configuredSampleIntervalMs,
    target_io_overhead_ratio: targetIoOverheadRatio,
    change_bytes_threshold: Math.max(1, Number(config.changeBytesThreshold || 65536)),
    lock_dir: lock.lock_dir,
    lock_lease: lock.lease,
    paths,
    eventlog: opts.eventlog || null,
  };
  tuneSampleInterval(session, baseline.scan_duration_ms);
  for (const swept of lock.swept || []) emitAudit(session, 'lock_lease_swept', swept);
  return { ok: true, session };
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms)); } catch (_) {}
}

function makeSessionWithWait(opts, node, ctx) {
  const config = opts.config || {};
  const waitMs = Math.max(0, Number(config.lockWaitMs == null ? 5000 : config.lockWaitMs));
  const pollMs = Math.max(10, Number(config.lockPollMs || 100));
  const started = Date.now();
  let made = makeSession(opts, node, ctx);
  while (!made.ok
    && made.reason === 'worktree_lock_conflict'
    && Date.now() - started < waitMs) {
    sleepSync(Math.min(pollMs, Math.max(1, waitMs - (Date.now() - started))));
    made = makeSession(opts, node, ctx);
  }
  if (!made.ok) made.waited_ms = Date.now() - started;
  return made;
}

function emitPreSessionAudit(opts, node, event, detail = {}) {
  const spec = opts.spec || {};
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const paths = checkpointPaths(opts.artifactsRoot, spec.taskId);
  const record = Object.assign({
    schema: AUDIT_SCHEMA,
    event,
    at: nowIso(),
    task_id: String(spec.taskId || ''),
    node_id: String(node && node.id || ''),
    agent_role: String(node && node.agent_role || ''),
    checkpoint_path: repoRelative(workspaceRoot, paths.checkpoint),
  }, sanitize(detail));
  appendJsonl(paths.audit, record);
  if (opts.eventlog && typeof opts.eventlog.emit === 'function') {
    try { opts.eventlog.emit(event, record); } catch (_) {}
  }
  return record;
}

function monitorSerializable(session) {
  const out = Object.assign({}, session);
  delete out.eventlog;
  return out;
}

function startMonitor(session, opts = {}) {
  if (opts.monitor === false) return null;
  atomicWriteJson(session.paths.monitor, monitorSerializable(session));
  const child = spawn(process.execPath, [__filename, '--monitor', session.paths.monitor], {
    cwd: session.workspace_root,
    stdio: 'ignore',
  });
  if (child.unref) child.unref();
  return child;
}

function waitForExit(pid, maxMs = 1500) {
  const deadline = Date.now() + maxMs;
  while (pidAlive(pid) && Date.now() < deadline) {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); } catch (_) {}
  }
  return !pidAlive(pid);
}

function stopMonitor(child) {
  if (!child || !child.pid) return;
  try { process.kill(child.pid, 'SIGTERM'); } catch (_) {}
  if (!waitForExit(child.pid, 1200)) {
    try { process.kill(child.pid, 'SIGKILL'); } catch (_) {}
    waitForExit(child.pid, 300);
  }
}

function checkpointRelative(session, checkpointPath = session.paths.checkpoint) {
  return repoRelative(session.workspace_root, checkpointPath);
}

function resumeContext(ctx, session, checkpoint, checkpointPath, fileSha256) {
  const rel = checkpointRelative(session, checkpointPath);
  return {
    taskId: ctx.taskId,
    spec_fingerprint: ctx.spec_fingerprint,
    projectId: ctx.projectId,
    scopedToProject: ctx.scopedToProject,
    visual_acceptance: ctx.visual_acceptance,
    workspaceRoot: ctx.workspaceRoot,
    agentPrompts: ctx.agentPrompts,
    loop_engineering: ctx.loop_engineering,
    goal: [
      `从已校验的脱敏 checkpoint 续跑当前 implement 节点:${rel}。`,
      '先读 checkpoint 中 changed_files、validations、remaining_acceptance 和 diff_summary；当前工作树是权威状态，不恢复、不回滚、不重做已有改动。',
      '本次只补齐剩余验收项并返回原 implementation JSON 合同。',
    ].join('\n'),
    bounds: redactString(ctx.bounds || '仅处理原任务范围；密钥不回显。', 4000),
    inputs: [rel],
    acceptance: `逐项读取 ${rel} 的 acceptance_snapshot/remaining_acceptance，保持原 ID+版本哈希与结构化验收合同。`,
    checkpoint_resume: {
      schema_version: checkpoint.schema_version,
      checkpoint_path: rel,
      checkpoint_id: checkpoint.checkpoint_id,
      integrity_sha256: checkpoint.integrity.digest,
      file_sha256: fileSha256,
      resume_count: Number(checkpoint.resume.count || 0) + 1,
    },
  };
}

function fullRerunContext(ctx, reason) {
  return Object.assign({}, ctx, {
    checkpoint_full_rerun: {
      mode: 'full_rerun',
      reason: redactString(reason, 500),
      policy: 'current_worktree_is_authoritative; checkpoint_content_is_never_restored',
    },
  });
}

function retryableFailure(result) {
  return !!(result && result.fail && RETRYABLE_FAILURE_RE.test(String(result.fail)));
}

function deferFullRerun(session, reason, detail = {}) {
  emitAudit(session, 'rollback_decision', Object.assign({
    decision: 'defer_full_rerun',
    reason: String(reason || 'worktree_lock_unavailable'),
    checkpoint_restored_files: 0,
  }, detail));
  return {
    fail: `implement checkpoint ${reason || 'worktree_lock_unavailable'}; full rerun deferred until the task-worktree lease is available`,
    checkpoint_deferred: true,
  };
}

function runWithMonitor(baseRunner, node, ctx, attempt, session, monitorOpts, phase) {
  const lease = validateWorktreeLease(session.lock_dir, session.lock_lease);
  if (!lease.ok) {
    const error = new Error(lease.reason);
    error.code = 'CHECKPOINT_LEASE_UNAVAILABLE';
    throw error;
  }
  session.lock_lease = lease.lease;
  const child = startMonitor(session, monitorOpts);
  let result;
  try {
    result = baseRunner(node, ctx, attempt) || {};
  } finally {
    stopMonitor(child);
  }
  refreshSessionProgress(session, ctx, result);
  writeCheckpoint(session, `${phase}_final`);
  return result;
}

function makeImplementCheckpointRunner(baseRunner, opts = {}) {
  function wrapped(node, ctx, attempt) {
    const decision = experimentDecision(opts.config, opts.spec, node, opts.env || process.env);
    if (typeof opts.onExperimentDecision === 'function') opts.onExperimentDecision({ phase: 'activation', decision });
    if (!decision.enabled) return baseRunner(node, ctx, attempt);
    const made = makeSessionWithWait(opts, node, ctx);
    if (typeof opts.onExperimentDecision === 'function') opts.onExperimentDecision({ phase: 'session', decision: made });
    if (!made.ok) {
      emitPreSessionAudit(opts, node, 'rollback_decision', {
        decision: 'defer_full_rerun',
        reason: made.reason || 'worktree_lock_unavailable',
        waited_ms: Number(made.waited_ms || 0),
        conflicting_task_id: made.existing && made.existing.owner_task_id || null,
        conflicting_role: made.existing && made.existing.owner_role || null,
        conflicting_lease_expires_at: made.existing && made.existing.expires_at || null,
        checkpoint_restored_files: 0,
      });
      return {
        fail: `implement checkpoint ${made.reason || 'worktree_lock_unavailable'}; full rerun deferred until the task-worktree lease is available`,
        checkpoint_deferred: true,
      };
    }
    const session = made.session;
    try {
      writeCheckpoint(session, 'initial');
      const first = runWithMonitor(baseRunner, node, ctx, attempt, session, opts, 'initial_run');
      const retryable = retryableFailure(first);
      if (typeof opts.onExperimentDecision === 'function') opts.onExperimentDecision({ phase: 'failure_classification', retryable, fail: first && first.fail });
      if (!retryable) return first;
      session.trigger_failure = redactString(first.fail, 1000);
      if (typeof opts.beforeResumeValidation === 'function') opts.beforeResumeValidation(session, first);
      let validation = validateCheckpoint(session, {
        checkpointPath: session.latest_checkpoint_version_path || session.paths.checkpoint,
      });
      let rollbackReason = validation.reason || 'checkpoint_validation_failed';
      if (validation.ok) {
        session.resume_count = Number(session.resume_count || 0) + 1;
        const budget = session.cumulative_token_budget;
        budget.consumed = Math.min(Number(budget.limit), Number(budget.consumed) + Number(budget.resume_reserve || 0));
        budget.remaining = Math.max(0, Number(budget.limit) - Number(budget.consumed));
        budget.spent_resume_reserve = Number(budget.resume_reserve || 0);
        budget.resume_reserve = 0;
        budget.within_limit = Number(budget.consumed) <= Number(budget.limit);
        writeCheckpoint(session, 'resume_selected');
        if (typeof opts.beforeResumeDispatch === 'function') opts.beforeResumeDispatch(session, validation);
        const dispatchValidation = validateCheckpoint(session, {
          checkpointPath: validation.checkpoint_path,
          expectedDigest: validation.file_sha256,
        });
        if (dispatchValidation.ok
          && dispatchValidation.integrity_sha256 === validation.integrity_sha256) {
          emitAudit(session, 'resume_decision', {
            decision: 'resume',
            reason: 'all_invariants_valid',
            trigger_failure: session.trigger_failure,
            same_role: node.agent_role,
            resume_count: session.resume_count,
            max_resume: session.max_resume,
            checkpoint_version_path: checkpointRelative(session, dispatchValidation.checkpoint_path),
            checkpoint_file_sha256: dispatchValidation.file_sha256,
            checkpoint_integrity_sha256: dispatchValidation.integrity_sha256,
          });
          const resumed = runWithMonitor(
            baseRunner,
            node,
            resumeContext(
              ctx,
              session,
              dispatchValidation.checkpoint,
              dispatchValidation.checkpoint_path,
              dispatchValidation.file_sha256,
            ),
            `${attempt}-resume-${session.resume_count}`,
            session,
            opts,
            'resume_run',
          );
          if (!resumed.fail) return resumed;
          rollbackReason = 'resume_failed';
          emitAudit(session, 'rollback_decision', {
            decision: 'full_rerun',
            reason: rollbackReason,
            resume_failure: redactString(resumed.fail, 1000),
            checkpoint_restored_files: 0,
          });
        } else {
          validation = dispatchValidation.ok
            ? { ok: false, reason: 'checkpoint_selected_integrity_changed' }
            : dispatchValidation;
          rollbackReason = validation.reason;
          emitAudit(session, 'rollback_decision', {
            decision: 'full_rerun',
            reason: rollbackReason,
            conflict_file: validation.file || null,
            checkpoint_restored_files: 0,
          });
        }
      } else {
        rollbackReason = validation.reason;
        emitAudit(session, 'rollback_decision', {
          decision: 'full_rerun',
          reason: validation.reason,
          conflict_file: validation.file || null,
          checkpoint_restored_files: 0,
        });
      }
      if (opts.config && opts.config.fullRerunFallback === false) return first;
      const fallbackLease = validateWorktreeLease(session.lock_dir, session.lock_lease);
      if (!fallbackLease.ok) {
        return deferFullRerun(session, fallbackLease.reason, {
          original_rollback_reason: rollbackReason,
        });
      }
      session.lock_lease = fallbackLease.lease;
      return runWithMonitor(
        baseRunner,
        node,
        fullRerunContext(ctx, rollbackReason),
        `${attempt}-full-rerun-1`,
        session,
        opts,
        'full_rerun',
      );
    } catch (error) {
      if (typeof opts.onExperimentDecision === 'function') opts.onExperimentDecision({ phase: 'runtime_error', error: String(error && error.stack || error) });
      emitAudit(session, 'rollback_decision', {
        decision: 'full_rerun',
        reason: `checkpoint_runtime_error:${redactString(error && error.message || error, 500)}`,
        checkpoint_restored_files: 0,
      });
      const fallbackLease = validateWorktreeLease(session.lock_dir, session.lock_lease);
      if (!fallbackLease.ok) {
        return deferFullRerun(session, fallbackLease.reason, {
          original_rollback_reason: 'checkpoint_runtime_error',
        });
      }
      session.lock_lease = fallbackLease.lease;
      return runWithMonitor(
        baseRunner,
        node,
        fullRerunContext(ctx, 'checkpoint_runtime_error'),
        `${attempt}-full-rerun-error`,
        session,
        opts,
        'runtime_error_full_rerun',
      );
    } finally {
      const released = releaseWorktreeLease(session.lock_dir, session.lock_lease);
      emitAudit(session, 'lock_lease_release', released);
    }
  }
  // Board/project-route uses its own async entrypoint. Preserve it verbatim;
  // this experiment is deliberately limited to synchronous implement nodes.
  if (typeof baseRunner.runBoardNodeAsync === 'function') {
    wrapped.runBoardNodeAsync = (...args) => baseRunner.runBoardNodeAsync(...args);
  }
  if (typeof baseRunner.runNodeAsync === 'function') {
    wrapped.runNodeAsync = (...args) => baseRunner.runNodeAsync(...args);
  }
  return wrapped;
}

function monitorOnce(session, state) {
  const sampleStarted = process.hrtime.bigint();
  const snapshot = workspaceSnapshot(session);
  const changed = changedSinceBaseline(session.baseline, snapshot);
  const changedBytes = changed.reduce((sum, item) => sum + Math.abs(Number(item.bytes_delta || 0)), 0);
  const now = Date.now();
  const elapsed = now - state.last_write_at;
  const delta = Math.abs(changedBytes - state.last_changed_bytes);
  const dueInterval = elapsed >= session.interval_ms;
  const dueChange = delta >= session.change_bytes_threshold;
  if (dueInterval || dueChange) {
    const written = writeCheckpoint(session, dueChange ? 'change_threshold' : 'interval', snapshot);
    state.last_write_at = now;
    state.last_changed_bytes = changedBytes;
    return { wrote: true, reason: dueChange ? 'change_threshold' : 'interval', metrics: written.metrics };
  } else {
    const renewed = renewWorktreeLease(session.lock_dir, session.lock_lease);
    if (!renewed.ok) throw new Error(renewed.reason);
    session.lock_lease = renewed.lease;
    const metrics = readMetrics(session.paths.metrics);
    recordSessionSetupScan(metrics, session);
    recordSnapshotScan(metrics, snapshot);
    metrics.no_write_sample_count = Number(metrics.no_write_sample_count || 0) + 1;
    const sampleDurationMs = Number(process.hrtime.bigint() - sampleStarted) / 1e6;
    metrics.total_sample_decision_duration_ms = Number(metrics.total_sample_decision_duration_ms || 0)
      + Math.max(0, sampleDurationMs - Number(snapshot.scan_duration_ms || 0));
    metrics.last_sample_at = nowIso(now);
    metrics.last_sample_wrote_checkpoint = false;
    metrics.target_io_overhead_ratio = Number(session.target_io_overhead_ratio || 0.05);
    metrics.effective_sample_interval_ms = tuneSampleInterval(session, sampleDurationMs);
    metrics.total_measured_io_duration_ms = metrics.total_write_duration_ms + metrics.total_scan_duration_ms;
    atomicWriteJson(session.paths.metrics, metrics);
    session.current_snapshot = snapshot;
    return { wrote: false, reason: 'below_threshold', metrics };
  }
}

function runMonitor(file) {
  const session = readJson(file, 64 * 1024 * 1024);
  if (!session || session.schema !== MONITOR_SCHEMA) process.exit(2);
  const state = { last_write_at: Date.now(), last_changed_bytes: 0 };
  let timer = null;
  const heartbeatMs = Math.max(250, Math.min(
    5000,
    Number(session.sample_interval_ms || 5000),
    Math.max(250, Math.floor(Number(session.lock_lease && session.lock_lease.ttl_ms || 120000) / 3)),
  ));
  const heartbeat = setInterval(() => {
    try {
      const renewed = renewWorktreeLease(session.lock_dir, session.lock_lease);
      if (!renewed.ok) process.exit(3);
      session.lock_lease = renewed.lease;
    } catch (_) { process.exit(3); }
  }, heartbeatMs);
  const schedule = () => {
    timer = setTimeout(() => {
      try {
        monitorOnce(session, state);
        schedule();
      } catch (_) { process.exit(3); }
    }, Math.max(250, Number(session.sample_interval_ms || 5000)));
  };
  schedule();
  process.on('SIGTERM', () => { clearInterval(heartbeat); clearTimeout(timer); process.exit(0); });
  process.on('SIGINT', () => { clearInterval(heartbeat); clearTimeout(timer); process.exit(0); });
}

if (require.main === module) {
  const index = process.argv.indexOf('--monitor');
  if (index >= 0 && process.argv[index + 1]) runMonitor(path.resolve(process.argv[index + 1]));
}

module.exports = {
  CHECKPOINT_SCHEMA,
  EXPERIMENT_SCHEMA,
  AUDIT_SCHEMA,
  METRICS_SCHEMA,
  RETRYABLE_FAILURE_RE,
  acceptanceSnapshot,
  acquireWorktreeLease,
  atomicWrite,
  changedSinceBaseline,
  checkpointPaths,
  experimentDecision,
  makeImplementCheckpointRunner,
  makeSession,
  monitorOnce,
  startMonitor,
  stopMonitor,
  readJson,
  redactString,
  releaseWorktreeLease,
  renewWorktreeLease,
  retryableFailure,
  tokenBudget,
  validateCheckpoint,
  validateCheckpointShape,
  validateWorktreeLease,
  workspaceSnapshot,
  writeCheckpoint,
  _test: {
    canonical,
    checkpointWithoutIntegrity,
    completedAcceptancePoints,
    completedValidations,
    implementationFromResult,
    refreshSessionProgress,
    excludedStatusPath,
    fileFingerprint,
    leaseExpired,
    pidAlive,
    resumeContext,
    sanitize,
    stableValue,
    statusEntries,
    worktreeIdentity,
  },
};
