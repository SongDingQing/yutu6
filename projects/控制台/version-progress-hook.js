'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DoneGate = require('../../shared/engine/done-gate');
const VersionManager = require('./tools/version-manager');

const HOOK_ID = 'console.version_progress';
const PROJECT_ID = '控制台';
const AUDIT_REL = path.join('logs', 'version-bumps.jsonl');
const AUDIT_RECOVERY_REL = path.join('logs', 'version-bumps.recovery.jsonl');
const ERROR_LOG_REL = path.join('logs', 'error.log');
const LOCK_REL = path.join('logs', '.version-bump.lock');
// 时间窗必须满足:WAIT > 最坏 push 时间(否则并发 true_done 误判超时回滚真完成);
// STALE > push 超时(否则 push 期间持锁被偷锁 → git index 损坏)。push 单独设较短超时。
const LOCK_WAIT_MS = 90000;
const LOCK_STALE_MS = 120000;
const PUSH_TIMEOUT_MS = 45000;
const RELEASE_IMPACTS = new Set(['fix', 'minor', 'major', 'manual', 'none']);

function nowIso() {
  return new Date().toISOString();
}

function repoRoot(opts = {}) {
  return path.resolve(opts.root || process.env.YUTU6_WORKDIR || path.resolve(__dirname, '../..'));
}

function versionFile(root) {
  return path.join(root, 'VERSION.json');
}

function auditFile(root, opts = {}) {
  return path.resolve(opts.auditFile || path.join(root, AUDIT_REL));
}

function recoveryAuditFile(root, opts = {}) {
  return path.resolve(opts.recoveryAuditFile || path.join(root, AUDIT_RECOVERY_REL));
}

function errorLogFile(root, opts = {}) {
  return path.resolve(opts.errorLogFile || path.join(root, ERROR_LOG_REL));
}

function lockDir(root, opts = {}) {
  return path.resolve(opts.lockDir || path.join(root, LOCK_REL));
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function appendJsonl(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function appendAudit(root, opts, entry) {
  const file = auditFile(root, opts);
  if (typeof opts.auditWriter === 'function') return opts.auditWriter(file, entry);
  return appendJsonl(file, entry);
}

function appendRecoveryAudit(root, opts, entry) {
  try {
    appendJsonl(recoveryAuditFile(root, opts), entry);
  } catch (_) {}
}

function appendErrorLog(root, opts, entry) {
  try {
    appendJsonl(errorLogFile(root, opts), Object.assign({
      at: nowIso(),
      subsystem: HOOK_ID,
    }, entry));
  } catch (_) {}
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function readAuditEntries(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function syncSleep(ms) {
  const wait = Math.max(1, Number(ms) || 1);
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, wait);
}

function acquireVersionLock(root, opts = {}) {
  const dir = lockDir(root, opts);
  const waitMs = Math.max(0, Number(opts.lockWaitMs || LOCK_WAIT_MS));
  const staleMs = Math.max(1000, Number(opts.lockStaleMs || LOCK_STALE_MS));
  const deadline = Date.now() + waitMs;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(dir, { recursive: false });
      try {
        writeJsonAtomic(path.join(dir, 'owner.json'), {
          pid: process.pid,
          acquired_at: nowIso(),
          stale_ms: staleMs,
        });
      } catch (e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        if (Date.now() >= deadline) throw e;
        syncSleep(10);
        continue;
      }
      return () => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      };
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e;
      const owner = readJson(path.join(dir, 'owner.json'), null);
      const acquiredAt = owner && Date.parse(owner.acquired_at || '');
      let lockAgeMs = acquiredAt ? Date.now() - acquiredAt : 0;
      if (!acquiredAt) {
        try {
          lockAgeMs = Date.now() - fs.statSync(dir).mtimeMs;
        } catch (_) {
          lockAgeMs = 0;
        }
      }
      if (lockAgeMs > staleMs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        continue;
      }
      if (Date.now() >= deadline) throw new Error('version bump lock timeout');
      syncSleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

function normalizedTaskForGate(task, event = {}) {
  const t = Object.assign({}, task || {});
  t.id = t.id || event.taskId || event.task || null;
  t.flow = t.flow || event.flow || 'review-loop';
  t.state = t.state || 'done';
  t.vars = t.vars && typeof t.vars === 'object' ? t.vars : {};
  t.evidence = Array.isArray(t.evidence) ? t.evidence : [];
  t.visits = t.visits && typeof t.visits === 'object' ? t.visits : {};
  t.completed_steps = Array.isArray(t.completed_steps) ? t.completed_steps : [];
  t.steps = t.steps && typeof t.steps === 'object' ? t.steps : {};
  return t;
}

function isTaskTrulyComplete(task, opts = {}) {
  const normalized = normalizedTaskForGate(task, opts.event || {});
  const vars = normalized.vars || {};
  const requireDeliveryEvidence = opts.requireDeliveryEvidence != null
    ? !!opts.requireDeliveryEvidence
    : DoneGate.deliveryEvidenceRequiredFromText(vars.goal, vars.acceptance);
  return DoneGate.validateReviewLoopCompletion(normalized, {
    workspaceRoot: opts.workspaceRoot || opts.root || process.cwd(),
    requireDeliveryEvidence,
  });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null && value !== '') return value;
  }
  return null;
}

function assertDoneGateContract(opts = {}) {
  if (!DoneGate || typeof DoneGate.validateReviewLoopCompletion !== 'function') {
    throw new Error('version progress hook requires DoneGate.validateReviewLoopCompletion()');
  }
  const probe = DoneGate.validateReviewLoopCompletion({
    id: '__version_hook_done_gate_probe__',
    flow: 'review-loop',
    state: 'pending',
    vars: {},
  }, {
    workspaceRoot: opts.workspaceRoot || opts.root || process.cwd(),
    requireDeliveryEvidence: false,
  });
  if (!probe || typeof probe.ok !== 'boolean') {
    throw new Error('DoneGate.validateReviewLoopCompletion() must return an object with boolean ok');
  }
  return { ok: true, probeOk: probe.ok === true };
}

function versionProgressVars(task) {
  const vars = task && task.vars || {};
  return {
    vars,
    progress: vars.version_progress && typeof vars.version_progress === 'object' ? vars.version_progress : {},
    camelProgress: vars.versionProgress && typeof vars.versionProgress === 'object' ? vars.versionProgress : {},
    implementation: vars.implementation && typeof vars.implementation === 'object' ? vars.implementation : {},
  };
}

function normalizeReleaseImpact(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, reason: 'missing_release_impact' };
  let part;
  try { part = VersionManager.normalizePart(value); }
  catch (_) {
    part = value.toLowerCase();
  }
  if (!RELEASE_IMPACTS.has(part)) return { ok: false, reason: `invalid_release_impact:${value}`, releaseImpact: value };
  if (part === 'none') return { ok: false, reason: 'release_impact_none', releaseImpact: part };
  if (part === 'manual') return { ok: false, reason: 'manual_release_required', releaseImpact: part };
  return { ok: true, releaseImpact: part, part };
}

function extractReleaseImpact(task, event = {}) {
  const { vars, progress, camelProgress, implementation } = versionProgressVars(task);
  const raw = firstValue(
    event.releaseImpact,
    event.release_impact,
    progress.releaseImpact,
    progress.release_impact,
    camelProgress.releaseImpact,
    camelProgress.release_impact,
    vars.releaseImpact,
    vars.release_impact,
    implementation.releaseImpact,
    implementation.release_impact,
    progress.part,
    progress.granularity,
    camelProgress.part,
    camelProgress.granularity,
    vars.version_part,
    vars.versionPart,
    vars.granularity,
    implementation.version_part,
    implementation.versionPart,
    implementation.granularity,
  );
  const normalized = normalizeReleaseImpact(raw);
  if (normalized.ok) {
    normalized.source = raw === event.releaseImpact || raw === event.release_impact
      ? 'completion_event'
      : 'task_vars';
  }
  return normalized;
}

function extractGranularity(task) {
  const impact = extractReleaseImpact(task);
  if (!impact.ok) {
    const reason = impact.reason === 'missing_release_impact' ? 'missing_granularity' : impact.reason.replace('release_impact', 'granularity');
    return Object.assign({}, impact, { reason });
  }
  return { ok: true, part: impact.part };
}

function majorApproved(task) {
  const { vars, progress, camelProgress, implementation } = versionProgressVars(task);
  return progress.major_approved === true
    || progress.majorApproved === true
    || camelProgress.major_approved === true
    || camelProgress.majorApproved === true
    || vars.version_major_approved === true
    || vars.versionMajorApproved === true
    || implementation.version_major_approved === true
    || implementation.versionMajorApproved === true;
}

function projectIdFor(task, event = {}) {
  const vars = task && task.vars || {};
  return event.projectId || event.project_id || vars.projectId || vars.project_id || task.projectId || task.project_id || null;
}

function reviewerFor(task, event = {}) {
  const vars = task && task.vars || {};
  const review = vars.review && typeof vars.review === 'object' ? vars.review : {};
  const verification = review.verification && typeof review.verification === 'object' ? review.verification : {};
  return firstString(
    event.reviewer,
    event.reviewedBy,
    event.reviewed_by,
    review.reviewer,
    review.reviewedBy,
    review.reviewed_by,
    review.agent,
    review.role,
    verification.reviewer,
    verification.reviewedBy,
    verification.agent,
  ) || null;
}

function completionHash(task, gate) {
  const vars = task && task.vars || {};
  const payload = {
    id: task && task.id,
    flow: task && task.flow,
    state: task && task.state,
    implementation: vars.implementation || null,
    review: vars.review || null,
    gate: gate && { ok: gate.ok, reason: gate.reason || null },
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function completionEventIdFor(event = {}, task = {}, hash = null) {
  return firstString(
    event.completionEventId,
    event.completion_event_id,
    event.eventId,
    event.event_id,
    event.id,
    event.gate && event.gate.completionEventId,
    event.trueCompletionVerdict && event.trueCompletionVerdict.completionEventId,
  ) || `task:${task && task.id || 'unknown'}:${hash || 'nohash'}`;
}

function evidenceRefsFor(task, event = {}, gate = {}) {
  const vars = task && task.vars || {};
  const implementation = vars.implementation && typeof vars.implementation === 'object' ? vars.implementation : {};
  const review = vars.review && typeof vars.review === 'object' ? vars.review : {};
  const refs = [];
  if (Array.isArray(implementation.changed_files)) {
    for (const file of implementation.changed_files) refs.push({ type: 'changed_file', ref: file });
  }
  if (implementation.logic_chain) refs.push({ type: 'logic_chain', ref: 'vars.implementation.logic_chain' });
  if (review.verification) refs.push({ type: 'review_verification', ref: 'vars.review.verification' });
  if (Array.isArray(event.evidenceRefs)) refs.push(...event.evidenceRefs);
  if (Array.isArray(gate.changed_files)) {
    for (const file of gate.changed_files) refs.push({ type: 'done_gate_changed_file', ref: file });
  }
  return refs;
}

function trueCompletionVerdictFor(event, task, opts = {}) {
  const root = repoRoot(opts);
  const eventGate = event && event.gate || null;
  const eventVerdict = event && event.trueCompletionVerdict || null;
  const engineGateOk = !!(eventGate && eventGate.ok === true);
  const explicitVerdictOk = !!(eventVerdict
    && eventVerdict.ok === true
    && String(eventVerdict.source || '').includes('engine.done_gate'));
  const recheck = isTaskTrulyComplete(task, {
    root,
    workspaceRoot: opts.workspaceRoot || root,
    event,
  });
  const hash = completionHash(task, recheck);
  const completionEventId = completionEventIdFor(event, task, hash);
  const evidenceRefs = evidenceRefsFor(task, event, recheck);
  if (!engineGateOk && !explicitVerdictOk) {
    return {
      ok: false,
      source: 'missing_or_false_engine_done_gate',
      readOnlyDoneGateRecheck: true,
      reason: recheck.ok ? 'missing_true_completion_verdict' : `not_true_done:${recheck.reason}`,
      completionEventId,
      eventGateOk: false,
      recheckOk: !!recheck.ok,
      recheckReason: recheck.reason || null,
      completionHash: hash,
      evidenceRefs,
    };
  }
  if (!recheck.ok) {
    return {
      ok: false,
      source: 'engine.done_gate+version_hook.recheck',
      readOnlyDoneGateRecheck: true,
      reason: `not_true_done:${recheck.reason}`,
      completionEventId,
      eventGateOk: true,
      recheckOk: false,
      recheckReason: recheck.reason || null,
      completionHash: hash,
      evidenceRefs,
    };
  }
  return {
    ok: true,
    source: 'engine.done_gate+version_hook.recheck',
    readOnlyDoneGateRecheck: true,
    reason: null,
    completionEventId,
    eventGateOk: true,
    recheckOk: true,
    recheckReason: null,
    completionHash: hash,
    changedFiles: recheck.changed_files || [],
    evidenceRefs,
  };
}

function isSelfTriggered(task, event = {}) {
  const { vars, progress, camelProgress, implementation } = versionProgressVars(task);
  return event.hook === HOOK_ID
    || event.sourceHook === HOOK_ID
    || event.source_hook === HOOK_ID
    || progress.sourceHook === HOOK_ID
    || progress.source_hook === HOOK_ID
    || camelProgress.sourceHook === HOOK_ID
    || camelProgress.source_hook === HOOK_ID
    || implementation.sourceHook === HOOK_ID
    || implementation.source_hook === HOOK_ID
    || vars.sourceHook === HOOK_ID
    || vars.source_hook === HOOK_ID
    || progress.self_trigger === true
    || progress.selfTrigger === true
    || vars.version_hook_self_trigger === true;
}

function versionStateWithPatch(prev, patch) {
  return Object.assign({}, prev, patch, {
    schema_version: 1,
    owner_agent: 'it-engineer',
    updated_at: nowIso(),
    remote: {
      name: 'gitee',
      web_url: VersionManager.GITEE_WEB_URL,
      push_url: VersionManager.GITEE_SSH_URL,
    },
    parts: Object.assign({}, VersionManager.PART_LABELS),
  });
}

function publishPlan(releaseImpact, nextVersion, task) {
  return {
    ok: true,
    mode: 'deferred_it_engineer',
    remote: 'gitee',
    web_url: VersionManager.GITEE_WEB_URL,
    reason: 'hook writes VERSION.json atomically; IT engineer remains owner of the actual Gitee push lane',
    version: nextVersion,
    releaseImpact,
    taskId: task && task.id || null,
  };
}

function normalizePublishResult(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw !== 'object') return Object.assign({}, fallback, { detail: raw });
  return Object.assign({}, fallback, raw, { ok: raw.ok !== false });
}

function alreadyBumped(entries, taskId, completionEventId, hash) {
  return entries.find(entry => entry && entry.decision === 'bump' && (
    (completionEventId && entry.completionEventId === completionEventId)
    || (hash && (entry.completionHash === hash || entry.completion_hash === hash))
    || (taskId && entry.taskId === taskId)
  ));
}

function skip(root, opts, entry) {
  const timestamp = nowIso();
  const auditEntry = Object.assign({
    at: timestamp,
    timestamp,
    hook: HOOK_ID,
    hook_framework: 'shared/engine/hook-registry',
    decision: 'skip',
    eventId: entry && (entry.eventId || entry.completionEventId) || null,
    reviewer: entry && entry.reviewer || null,
  }, entry);
  appendAudit(root, opts, auditEntry);
  return Object.assign({ ok: true, decision: 'skip' }, entry);
}

function rollbackPublishFailure(root, opts, prev, entry) {
  writeJsonAtomic(versionFile(root), prev);
  appendErrorLog(root, opts, {
    level: 'error',
    decision: entry && entry.decision || 'rollback',
    reason: entry && entry.reason || 'version_progress_hook_failure',
    taskId: entry && entry.taskId || null,
    eventId: entry && (entry.eventId || entry.completionEventId) || null,
    oldVersion: entry && entry.oldVersion || null,
    newVersion: entry && entry.newVersion || null,
    error: entry && entry.error || null,
  });
  try {
    appendAudit(root, opts, entry);
  } catch (e) {
    appendRecoveryAudit(root, opts, Object.assign({}, entry, {
      recovery_reason: 'audit_write_failed_during_publish_rollback',
      audit_error: e && e.message || String(e),
    }));
  }
  return Object.assign({ ok: false }, entry);
}

// ===== P0-B:真完成 → 真 commit + 真 push gitee(只提交声明文件、过密钥扫描、绝不 git add -A)=====
// 治根因诊断 §2 第三层"完成不落地":VERSION.json 与 git 脱钩(0.0.1.3 vs HEAD v0.0.0.3)。
// 安全闸:① 只 add 声明的 changed_files + VERSION.json;② 提交前扫描暂存区密钥,命中即撤销拒提;
// ③ 非 git 仓库(测试/非仓库)退回 deferred 计划,不做任何 git 动作。
const SECRET_PATH_RE = /(\.meow_art\/|secrets?-consolidate|(^|\/)\.env(\.|$)|\.venv\/|id_(rsa|ed25519)|\.ssh-stage\/|MacMini-Secrets|kb\.sqlite)/i;
const SECRET_CONTENT_RE = /(BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|xox[bap]-[A-Za-z0-9]{10}|AKIA[0-9A-Z]{16}|"?(?:api[_-]?key|dev_key|secret|token|password|bearer)"?\s*[:=]\s*"?[A-Za-z0-9_\-]{16,})/;

function runGit(args, root, timeoutMs) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: timeoutMs || 60000, maxBuffer: 16 * 1024 * 1024 });
}

function isGitRepo(root) {
  const res = runGit(['rev-parse', '--is-inside-work-tree'], root);
  return !res.error && res.status === 0 && String(res.stdout || '').trim() === 'true';
}

function currentBranch(root) {
  const res = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const b = (!res.error && res.status === 0) ? String(res.stdout || '').trim() : '';
  return b && b !== 'HEAD' ? b : 'main';
}

function declaredChangedFiles(task, gate) {
  const vars = task && task.vars || {};
  const impl = vars.implementation && typeof vars.implementation === 'object' ? vars.implementation : {};
  const raw = [];
  if (Array.isArray(impl.changed_files)) raw.push(...impl.changed_files);
  if (gate && Array.isArray(gate.changed_files)) raw.push(...gate.changed_files);
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (typeof f !== 'string' || !f.trim()) continue;
    const file = f.trim();
    if (seen.has(file)) continue;
    seen.add(file);
    if (/Starlaid|星桥/i.test(file)) continue; // 红线:排除范围不提交
    if (SECRET_PATH_RE.test(file)) continue;   // 红线:密钥路径不提交
    out.push(file);
  }
  return out;
}

// 软约束(逻辑链层):真完成自动提交前扫描暂存区密钥。
// 优先委托统一扫描引擎 security/secret-scan.js(指纹 + 熵 + 多形态,与钩子/测试/CI 同源);
// 引擎不可用(路径缺失/异常)时退回内置正则快扫,保证兜底永不裸奔。
const SECRET_SCANNER = path.join(__dirname, '..', '..', 'security', 'secret-scan.js');
function secretScanStaged(root) {
  // 首选:统一引擎扫暂存区
  try {
    if (fs.existsSync(SECRET_SCANNER)) {
      const res = spawnSync(process.execPath, [SECRET_SCANNER, '--staged', '--json', '--quiet'], {
        cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
      });
      const out = String(res.stdout || '').trim();
      if (out) {
        const parsed = JSON.parse(out);
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          const e = parsed.errors[0];
          return `${e.rule} ${e.file}:${e.line}`.slice(0, 60);
        }
        return null; // 引擎正常且无 error
      }
      // 引擎有 error 会以退出码 1 退出但仍打印 JSON;上面已处理。无 stdout 才落到回退。
    }
  } catch (_) { /* 落到内置回退 */ }
  // 回退:内置正则快扫 staged diff
  const res = runGit(['diff', '--cached'], root);
  if (res.error || res.status !== 0) return null;
  for (const line of String(res.stdout || '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++') && SECRET_CONTENT_RE.test(line)) {
      return line.slice(0, 60);
    }
  }
  return null;
}

// 默认发布器:真完成后自动 commit 声明文件 + push gitee。失败语义:
// commit 前任何问题(add 失败/密钥命中/无改动/commit 失败)→ ok:false,交上层回滚版本号;
// push 失败 → 不回滚(commit 已成、本地一致),ok:true + pushWarning,等下次/手动补推。
function giteeCommitPushPublisher(ctx = {}) {
  const root = ctx.root;
  if (!isGitRepo(root)) {
    return publishPlan(ctx.releaseImpact, ctx.nextVersion, ctx.task); // 非 git:退回 deferred(测试/非仓库)
  }
  const remote = ctx.remoteName || 'gitee';
  const branch = currentBranch(root);
  const files = declaredChangedFiles(ctx.task, ctx.gate);
  const addRes = runGit(['add', '--', 'VERSION.json', ...files], root);
  if (addRes.error || addRes.status !== 0) {
    runGit(['reset', '--', 'VERSION.json', ...files], root); // 只解本次暂存,不误伤锁外并发 git 写者
    return { ok: false, mode: 'auto_commit_push', remote, reason: 'git_add_failed', error: String(addRes.stderr || (addRes.error && addRes.error.message) || '').slice(0, 300) };
  }
  const leak = secretScanStaged(root);
  if (leak) {
    runGit(['reset', '--', 'VERSION.json', ...files], root); // 只解本次暂存,不误伤锁外并发 git 写者
    return { ok: false, mode: 'auto_commit_push', remote, reason: 'secret_detected', detail: '暂存区命中疑似密钥,已撤暂存、拒绝提交' };
  }
  if (!String(runGit(['diff', '--cached', '--name-only'], root).stdout || '').trim()) {
    runGit(['reset', '--', 'VERSION.json', ...files], root); // 只解本次暂存,不误伤锁外并发 git 写者
    return { ok: false, mode: 'auto_commit_push', remote, reason: 'nothing_staged', detail: '声明的 changed_files 在 git 中无实际改动' };
  }
  const goal = firstString(ctx.task && ctx.task.vars && ctx.task.vars.goal, '真完成自动提交');
  const summary = `v${ctx.nextVersion} ${String(goal).replace(/\s+/g, ' ').slice(0, 60)}`;
  const commitRes = runGit(['commit', '-m', summary], root);
  if (commitRes.error || commitRes.status !== 0) {
    runGit(['reset', '--', 'VERSION.json', ...files], root); // 只解本次暂存,不误伤锁外并发 git 写者
    return { ok: false, mode: 'auto_commit_push', remote, reason: 'git_commit_failed', error: String(commitRes.stderr || '').slice(0, 300) };
  }
  const sha = String(runGit(['rev-parse', '--short', 'HEAD'], root).stdout || '').trim();
  const pushRes = runGit(['push', remote, branch], root, PUSH_TIMEOUT_MS);
  const pushed = !pushRes.error && pushRes.status === 0;
  return {
    ok: true,
    mode: 'auto_commit_push',
    remote,
    version: ctx.nextVersion,
    commit: sha,
    branch,
    pushed,
    pushWarning: pushed ? null : String(pushRes.stderr || (pushRes.error && pushRes.error.message) || 'push failed').slice(0, 300),
  };
}

function handleTrueDone(event = {}, opts = {}) {
  const root = repoRoot(opts);
  const task = normalizedTaskForGate(event.task || {}, event);
  const taskId = task.id || event.taskId || event.task || null;
  const projectId = projectIdFor(task, event);
  const reviewer = reviewerFor(task, event);

  if (projectId !== PROJECT_ID) {
    return skip(root, opts, { taskId, projectId, reviewer, reason: 'project_not_console' });
  }
  if (isSelfTriggered(task, event)) {
    return skip(root, opts, { taskId, projectId, reviewer, reason: 'self_triggered_by_version_hook' });
  }

  const trueCompletionVerdict = trueCompletionVerdictFor(event, task, Object.assign({}, opts, { root }));
  const completionEventId = trueCompletionVerdict.completionEventId;
  const hash = trueCompletionVerdict.completionHash;
  if (!trueCompletionVerdict.ok) {
    return skip(root, opts, {
      taskId,
      projectId,
      reviewer,
      completionEventId,
      trueCompletionVerdict,
      reason: trueCompletionVerdict.reason,
      completionHash: hash,
      completion_hash: hash,
      evidenceRefs: trueCompletionVerdict.evidenceRefs,
    });
  }

  const impact = extractReleaseImpact(task, event);
  if (!impact.ok) {
    return skip(root, opts, {
      taskId,
      projectId,
      reviewer,
      completionEventId,
      trueCompletionVerdict,
      reason: impact.reason,
      releaseImpact: impact.releaseImpact || null,
      manualChannel: impact.reason !== 'release_impact_none',
      completionHash: hash,
      completion_hash: hash,
      evidenceRefs: trueCompletionVerdict.evidenceRefs,
    });
  }
  const releaseImpact = impact.releaseImpact;
  if (releaseImpact === 'major' && !majorApproved(task)) {
    return skip(root, opts, {
      taskId,
      projectId,
      reviewer,
      completionEventId,
      trueCompletionVerdict,
      reason: 'major_requires_manual_confirmation',
      releaseImpact,
      completionHash: hash,
      completion_hash: hash,
      evidenceRefs: trueCompletionVerdict.evidenceRefs,
    });
  }

  const release = acquireVersionLock(root, opts);
  try {
    const file = versionFile(root);
    const audit = auditFile(root, opts);
    const prior = alreadyBumped(readAuditEntries(audit), taskId, completionEventId, hash);
    if (prior) {
      return skip(root, opts, {
        taskId,
        projectId,
        reviewer,
        completionEventId,
        eventId: completionEventId,
        trueCompletionVerdict,
        reason: 'idempotent_already_bumped',
        releaseImpact,
        oldVersion: prior.oldVersion || prior.from,
        newVersion: prior.newVersion || prior.to,
        from: prior.from || prior.oldVersion,
        to: prior.to || prior.newVersion,
        completionHash: hash,
        completion_hash: hash,
        evidenceRefs: trueCompletionVerdict.evidenceRefs,
      });
    }

    const prev = VersionManager.readVersionState(root);
    const nextVersion = VersionManager.bumpVersion(prev.version, releaseImpact);
    const next = versionStateWithPatch(prev, {
      version: nextVersion,
      last_change: {
        releaseImpact,
        part: releaseImpact,
        part_label: VersionManager.PART_LABELS[releaseImpact],
        summary: `hook true completion: ${taskId}`,
        task_id: taskId,
        completion_event_id: completionEventId,
        completion_hash: hash,
        at: nowIso(),
      },
    });

    writeJsonAtomic(file, next);
    const defaultPublish = publishPlan(releaseImpact, nextVersion, task);
    // 无显式 publisher → 用默认 gitee 自动 commit+push 发布器(非 git 仓库会退回 deferred)
    const publisher = typeof opts.publisher === 'function' ? opts.publisher : giteeCommitPushPublisher;
    let publishResult = defaultPublish;
    try {
      publishResult = normalizePublishResult(publisher({
        root,
        task,
        gate: event.gate,
        releaseImpact,
        part: releaseImpact,
        previous: prev,
        next,
        nextVersion,
        completionEventId,
        completionHash: hash,
      }), defaultPublish);
    } catch (e) {
      const entry = {
        at: nowIso(),
        hook: HOOK_ID,
        hook_framework: 'shared/engine/hook-registry',
        decision: 'rollback',
        reason: 'gitee_publish_failed',
        error: e && e.message || String(e),
        taskId,
        projectId,
        reviewer,
        completionEventId,
        eventId: completionEventId,
        trueCompletionVerdict,
        releaseImpact,
        oldVersion: prev.version,
        newVersion: nextVersion,
        from: prev.version,
        to: nextVersion,
        completionHash: hash,
        completion_hash: hash,
        evidenceRefs: trueCompletionVerdict.evidenceRefs,
        publishResult: {
          ok: false,
          remote: 'gitee',
          reason: 'gitee_publish_failed',
          error: e && e.message || String(e),
        },
      };
      entry.timestamp = entry.at;
      return rollbackPublishFailure(root, opts, prev, entry);
    }
    if (publishResult && publishResult.ok === false) {
      const entry = {
        at: nowIso(),
        hook: HOOK_ID,
        hook_framework: 'shared/engine/hook-registry',
        decision: 'rollback',
        reason: 'gitee_publish_failed',
        error: publishResult.error || publishResult.reason || 'publisher returned ok=false',
        taskId,
        projectId,
        reviewer,
        completionEventId,
        eventId: completionEventId,
        trueCompletionVerdict,
        releaseImpact,
        oldVersion: prev.version,
        newVersion: nextVersion,
        from: prev.version,
        to: nextVersion,
        completionHash: hash,
        completion_hash: hash,
        evidenceRefs: trueCompletionVerdict.evidenceRefs,
        publishResult,
      };
      entry.timestamp = entry.at;
      return rollbackPublishFailure(root, opts, prev, entry);
    }

    const entry = {
      at: nowIso(),
      hook: HOOK_ID,
      hook_framework: 'shared/engine/hook-registry',
      decision: 'bump',
      taskId,
      projectId,
      reviewer,
      completionEventId,
      eventId: completionEventId,
      trueCompletionVerdict,
      releaseImpact,
      granularity: releaseImpact,
      oldVersion: prev.version,
      newVersion: nextVersion,
      from: prev.version,
      to: nextVersion,
      completionHash: hash,
      completion_hash: hash,
      evidenceRefs: trueCompletionVerdict.evidenceRefs,
      publishResult,
      publish: publishResult,
    };
    entry.timestamp = entry.at;
    try {
      appendAudit(root, opts, entry);
    } catch (e) {
      writeJsonAtomic(file, prev);
      appendErrorLog(root, opts, {
        level: 'error',
        decision: 'rollback',
        reason: 'audit_write_failed',
        taskId,
        eventId: completionEventId,
        oldVersion: prev.version,
        newVersion: nextVersion,
        error: e && e.message || String(e),
      });
      const recovery = Object.assign({}, entry, {
        decision: 'rollback',
        reason: 'audit_write_failed',
        audit_error: e && e.message || String(e),
      });
      appendRecoveryAudit(root, opts, recovery);
      return Object.assign({ ok: false }, recovery);
    }
    return Object.assign({ ok: true }, entry);
  } finally {
    release();
  }
}

function registerVersionProgressHook(registry, opts = {}) {
  assertDoneGateContract(opts);
  registry.register('task.true_done', {
    id: HOOK_ID,
    priority: 50,
    enabled: opts.enabled !== false,
    timeoutMs: opts.timeoutMs || (LOCK_WAIT_MS + 5000),
    failureMode: opts.failureMode || 'block',
    handler(event) {
      return handleTrueDone(event, opts);
    },
  });
  return registry;
}

module.exports = {
  HOOK_ID,
  AUDIT_REL,
  AUDIT_RECOVERY_REL,
  ERROR_LOG_REL,
  assertDoneGateContract,
  isTaskTrulyComplete,
  trueCompletionVerdictFor,
  extractReleaseImpact,
  extractGranularity,
  handleTrueDone,
  giteeCommitPushPublisher,
  registerVersionProgressHook,
};
