'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LOCK_WAIT_MS = 5000;
const DEFAULT_LOCK_STALE_MS = 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeId(value) {
  const raw = String(value || 'unknown');
  const clean = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 10);
  return `${clean}-${hash}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function paths(artifactsRoot) {
  const root = path.join(artifactsRoot, 'quota-degrade');
  return {
    root,
    states: path.join(root, 'states'),
    locks: path.join(root, 'locks'),
    snapshots: path.join(root, 'snapshots'),
  };
}

function scopeFromKey(key) {
  const raw = String(key || '').trim();
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const type = raw.slice(0, idx);
    const value = raw.slice(idx + 1);
    return { type, value, key: `${type}:${value}` };
  }
  return { type: 'runner', value: raw, key: `runner:${raw}` };
}

function runnerScope(runnerType) {
  const value = String(runnerType || 'unknown').trim() || 'unknown';
  return { type: 'runner', value, runnerType: value, key: `runner:${value}` };
}

function bucketScope(bucket, runnerType) {
  const value = String(bucket || runnerType || 'unknown').trim() || 'unknown';
  const type = bucket ? 'quota_bucket' : 'runner';
  return Object.assign({ type, value, key: `${type}:${value}` }, runnerType ? { runnerType } : {});
}

function stateFile(artifactsRoot, scope) {
  return path.join(paths(artifactsRoot).states, `${safeId(scope.key || scope)}.json`);
}

function lockFile(artifactsRoot, scope) {
  return path.join(paths(artifactsRoot).locks, `${safeId(scope.key || scope)}.lock.json`);
}

function snapshotFile(artifactsRoot, incidentId) {
  return path.join(paths(artifactsRoot).snapshots, `${safeId(incidentId)}.json`);
}

function readState(artifactsRoot, scope) {
  return readJson(stateFile(artifactsRoot, scope));
}

function statePaused(state) {
  return !!(state && (state.status === 'degraded' || state.status === 'restoring'));
}

async function withScopeLock(artifactsRoot, scope, fn, opts = {}) {
  const file = lockFile(artifactsRoot, scope);
  const waitMs = Number(opts.waitMs || DEFAULT_LOCK_WAIT_MS);
  const staleMs = Number(opts.staleMs || DEFAULT_LOCK_STALE_MS);
  const deadline = Date.now() + waitMs;
  const token = crypto.randomBytes(8).toString('hex');
  const payload = {
    token,
    pid: process.pid,
    scope: scope.key || String(scope || ''),
    created_at: nowIso(),
  };
  while (true) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
      break;
    } catch (e) {
      const cur = readJson(file);
      const created = cur && Date.parse(cur.created_at || cur.ts || '');
      if (!cur || (created && Date.now() - created > staleMs)) {
        try { fs.unlinkSync(file); } catch (_) {}
      } else if (Date.now() >= deadline) {
        throw new Error(`quota degrade lock timeout: ${scope.key || scope}`);
      } else {
        await sleep(50);
      }
    }
  }
  try {
    return await fn();
  } finally {
    try {
      const cur = readJson(file);
      if (cur && cur.token === token) fs.unlinkSync(file);
    } catch (_) {}
  }
}

function normalizeTrigger(trigger = {}) {
  return {
    at: trigger.at || nowIso(),
    queueAgent: trigger.queueAgent || null,
    queueId: trigger.queueId || null,
    taskId: trigger.taskId || null,
    runnerType: trigger.runnerType || null,
    code: trigger.code == null ? null : trigger.code,
    signal: trigger.signal || null,
    reason: String(trigger.reason || '').slice(0, 1000),
    confidence: trigger.confidence || null,
    rawReason: String(trigger.rawReason || trigger.reason || '').slice(0, 1000),
  };
}

function beginOrUpdateIncident(artifactsRoot, scope, trigger = {}) {
  const file = stateFile(artifactsRoot, scope);
  const existing = readJson(file);
  const active = statePaused(existing);
  const incidentId = active && existing.incidentId
    ? existing.incidentId
    : `quota-${Date.now()}-${safeId(scope.key || scope).slice(0, 24)}`;
  const triggers = Array.isArray(existing && existing.triggers) ? existing.triggers.slice(-20) : [];
  triggers.push(normalizeTrigger(trigger));
  const state = Object.assign({}, existing || {}, {
    version: 1,
    status: 'degraded',
    scope,
    incidentId,
    degraded_at: existing && existing.degraded_at || nowIso(),
    updated_at: nowIso(),
    trigger_count: Number(existing && existing.trigger_count || 0) + 1,
    triggers,
  });
  writeJsonAtomic(file, state);
  return { state, existing, merged: !!active };
}

function writeSnapshot(artifactsRoot, scope, incidentId, entries, meta = {}) {
  const file = snapshotFile(artifactsRoot, incidentId);
  const previous = readJson(file);
  const revision = Number(previous && previous.revision || 0) + 1;
  const counts = {};
  for (const item of entries || []) {
    const status = item && item.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  const snapshot = {
    version: 1,
    id: incidentId,
    incidentId,
    revision,
    scope,
    created_at: previous && previous.created_at || nowIso(),
    updated_at: nowIso(),
    consistency: 'post-preservation-final-consistent',
    preservation_started_at: meta.preservationStartedAt || null,
    preservation_finished_at: meta.preservationFinishedAt || null,
    drain_timed_out: !!meta.drainTimedOut,
    triggers: meta.triggers || [],
    counts,
    entries: entries || [],
  };
  writeJsonAtomic(file, snapshot);
  return { file, snapshot };
}

function finishIncidentSnapshot(artifactsRoot, scope, incidentId, snapshot) {
  const file = stateFile(artifactsRoot, scope);
  const state = readJson(file) || { version: 1, scope, incidentId };
  const next = Object.assign({}, state, {
    status: 'degraded',
    scope,
    incidentId,
    snapshot: path.relative(artifactsRoot, snapshot.file).split(path.sep).join('/'),
    snapshot_revision: snapshot.snapshot && snapshot.snapshot.revision || null,
    snapshot_counts: snapshot.snapshot && snapshot.snapshot.counts || {},
    last_snapshot_at: nowIso(),
    updated_at: nowIso(),
  });
  writeJsonAtomic(file, next);
  return next;
}

function restoreScope(artifactsRoot, scope, opts = {}) {
  const file = stateFile(artifactsRoot, scope);
  const state = readJson(file);
  if (!state) return { ok: false, status: 'missing', scope };
  if (state.status === 'restored') {
    return { ok: true, status: 'restored', idempotent: true, state };
  }
  const restoring = Object.assign({}, state, {
    status: 'restoring',
    restore_started_at: nowIso(),
    restored_by: opts.restoredBy || opts.actor || 'quota-degrade-control',
    restore_reason: opts.reason || 'quota recovered',
    updated_at: nowIso(),
  });
  writeJsonAtomic(file, restoring);
  const restored = Object.assign({}, state, {
    status: 'restored',
    restored_at: state.restored_at || nowIso(),
    restore_started_at: restoring.restore_started_at,
    restored_by: restoring.restored_by,
    restore_reason: restoring.restore_reason,
    updated_at: nowIso(),
  });
  writeJsonAtomic(file, restored);
  return { ok: true, status: 'restored', state: restored };
}

async function restoreScopeWithLock(artifactsRoot, scope, opts = {}) {
  return withScopeLock(artifactsRoot, scope, async () => restoreScope(artifactsRoot, scope, opts), opts);
}

// ---- 额度熔断(quota circuit breaker,拍板④ 2026-07-03) ----
// 在既有 degraded→restoring→restored 状态机上加 breaker 字段:
//   { strikes, backoff_ms, retry_after, last_failure_at, probe_claimed_at }
// 语义:额度类失败 tripQuotaBreaker → strikes+1,retry_after = now + min(base*2^(strikes-1), max);
// 熔断期内候选选择方直接跳过;retry_after 到点后 claimBreakerProbe 放行一次小流量试探;
// 试探成功 resolveQuotaBreaker → restored + strikes 清零;失败再 trip → 退避翻倍。
// 总开关在调用方(cli-runner)以 YUTU6_QUOTA_BREAKER=0 退回旧行为;本模块函数保持纯粹。
const BREAKER_BASE_MS_DEFAULT = 60 * 60 * 1000;        // 1h
const BREAKER_MAX_MS_DEFAULT = 24 * 60 * 60 * 1000;    // 24h 上限
const BREAKER_PROBE_TTL_MS_DEFAULT = 10 * 60 * 1000;   // 试探占位有效期:期间只放一次

function envMs(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function breakerBackoffMs(strikes) {
  const base = envMs('YUTU6_QUOTA_BREAKER_BASE_MS', BREAKER_BASE_MS_DEFAULT);
  const max = envMs('YUTU6_QUOTA_BREAKER_MAX_MS', BREAKER_MAX_MS_DEFAULT);
  const n = Math.max(1, Math.floor(Number(strikes) || 1));
  // 指数上溢保护:超过 2^40 一律封顶
  const factor = n - 1 >= 40 ? Infinity : Math.pow(2, n - 1);
  return Math.min(base * factor, max);
}

// 额度类失败 → 熔断/退避翻倍。复用 beginOrUpdateIncident(degraded 状态 + 事故合并),再补 breaker 字段。
function tripQuotaBreaker(artifactsRoot, scope, trigger = {}) {
  const existing = readState(artifactsRoot, scope);
  const prevStrikes = statePaused(existing) && existing.breaker
    ? Number(existing.breaker.strikes || 0)
    : 0; // restored/无状态 → 新一轮熔断从 1 计
  const begun = beginOrUpdateIncident(artifactsRoot, scope, trigger);
  const strikes = prevStrikes + 1;
  const backoffMs = breakerBackoffMs(strikes);
  const file = stateFile(artifactsRoot, scope);
  const next = Object.assign({}, readJson(file) || begun.state, {
    breaker: {
      strikes,
      backoff_ms: backoffMs,
      retry_after: new Date(Date.now() + backoffMs).toISOString(),
      last_failure_at: nowIso(),
      probe_claimed_at: null,
    },
    updated_at: nowIso(),
  });
  writeJsonAtomic(file, next);
  return next;
}

// 只读判定:blocked=熔断期内(或人工 degraded 无 retry_after);probe=retry_after 已到,可试探。
function breakerDecision(state, nowMs = Date.now()) {
  if (!statePaused(state)) return { blocked: false, probe: false, state: state || null };
  const breaker = state.breaker && typeof state.breaker === 'object' ? state.breaker : null;
  const retryAfterMs = breaker ? Date.parse(breaker.retry_after || '') : NaN;
  if (!breaker || !Number.isFinite(retryAfterMs)) {
    // 人工/旧式 degraded:无 retry_after → 一直跳过,等人工 restore(保守,不静默硬试)
    return { blocked: true, probe: false, reason: 'degraded_no_retry_after', state };
  }
  if (nowMs < retryAfterMs) {
    return { blocked: true, probe: false, reason: 'breaker_open', retryAfter: breaker.retry_after, state };
  }
  return { blocked: false, probe: true, retryAfter: breaker.retry_after, state };
}

// 试探占位:retry_after 到点后只放行一次(probe_claimed_at + TTL 内其余请求继续跳过)。
// 返回 { allowed, probe, blocked, reason, state }。allowed=true 且 probe=false 表示该 scope 根本没被熔断。
function claimBreakerProbe(artifactsRoot, scope, opts = {}) {
  const nowMs = Number(opts.now) || Date.now();
  const file = stateFile(artifactsRoot, scope);
  const state = readJson(file);
  const decision = breakerDecision(state, nowMs);
  if (!decision.blocked && !decision.probe) return { allowed: true, probe: false, blocked: false, state };
  if (decision.blocked) {
    return { allowed: false, probe: false, blocked: true, reason: decision.reason, retryAfter: decision.retryAfter || null, state };
  }
  const ttl = envMs('YUTU6_QUOTA_BREAKER_PROBE_TTL_MS', BREAKER_PROBE_TTL_MS_DEFAULT);
  const claimedAt = Date.parse(state.breaker.probe_claimed_at || '');
  if (Number.isFinite(claimedAt) && nowMs - claimedAt < ttl) {
    return { allowed: false, probe: false, blocked: true, reason: 'probe_in_flight', state };
  }
  const next = Object.assign({}, state, {
    breaker: Object.assign({}, state.breaker, { probe_claimed_at: new Date(nowMs).toISOString() }),
    updated_at: nowIso(),
  });
  writeJsonAtomic(file, next);
  return { allowed: true, probe: true, blocked: false, retryAfter: decision.retryAfter || null, state: next };
}

// 试探成功 → 复用 restoreScope 走 restoring→restored,并把 strikes 清零(下轮熔断重新从 1h 起)。
function resolveQuotaBreaker(artifactsRoot, scope, opts = {}) {
  const restored = restoreScope(artifactsRoot, scope, Object.assign({
    restoredBy: opts.restoredBy || 'quota-breaker-probe',
    reason: opts.reason || 'quota breaker probe succeeded',
  }, opts));
  if (!restored.ok) return restored;
  const file = stateFile(artifactsRoot, scope);
  const state = readJson(file);
  if (state && state.breaker) {
    const next = Object.assign({}, state, {
      breaker: Object.assign({}, state.breaker, {
        strikes: 0,
        probe_claimed_at: null,
        recovered_at: nowIso(),
      }),
      updated_at: nowIso(),
    });
    writeJsonAtomic(file, next);
    return { ok: true, status: 'restored', state: next };
  }
  return restored;
}

function listStates(artifactsRoot) {
  const dir = paths(artifactsRoot).states;
  try {
    return fs.readdirSync(dir)
      .filter(f => /\.json$/.test(f))
      .map(f => readJson(path.join(dir, f)))
      .filter(Boolean)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  } catch (_) {
    return [];
  }
}

function redactSignalText(text) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]');
}

function classifyQuotaSignal(reason, result = {}) {
  const raw = [
    reason,
    result && result.error,
    result && result.stderr,
    result && result.stdout,
    result && result.message,
  ].filter(Boolean).join('\n');
  const text = redactSignalText(raw);
  const lower = text.toLowerCase();
  const positive = [
    /quota[_\s-]*exhausted/i,
    /insufficient[_\s-]*quota/i,
    /exceeded\s+(?:your\s+)?(?:current\s+)?quota/i,
    /quota[^.\n]{0,80}(?:exhausted|depleted|used\s*up|insufficient|用光|耗尽|不足|用完)/i,
    /(?:额度|配额)[^。\n]{0,40}(?:用光|耗尽|不足|用完|已用尽|已耗尽)/i,
    /(?:余额|balance|credit|credits)[^.\n。]{0,60}(?:不足|耗尽|用完|insufficient|exhausted|depleted)/i,
    /billing[^.\n]{0,80}(?:quota|credit|balance)/i,
  ];
  const negative = [
    /rate[_\s-]*limit/i,
    /too many requests/i,
    /\b429\b(?![^.\n]{0,100}(?:quota|额度|配额|余额|balance|credit|insufficient))/i,
    /请求(?:过于)?频繁|限流|频率限制/i,
    /timeout|timed out|etimedout|econnreset|socket hang up/i,
    /syntaxerror|typeerror|referenceerror|assertionerror/i,
  ];
  const matchedPositive = positive.find(re => re.test(text));
  const matchedNegative = negative.find(re => re.test(text));
  if (matchedPositive && !matchedNegative) {
    return {
      isQuotaExhausted: true,
      confidence: 'high',
      rawReason: text.slice(0, 1000),
      reason: 'quota_exhausted',
      matched: String(matchedPositive),
    };
  }
  if (matchedPositive && /rate[_\s-]*limit|too many requests|限流|频率限制/i.test(lower)) {
    return {
      isQuotaExhausted: false,
      confidence: 'ambiguous',
      rawReason: text.slice(0, 1000),
      reason: 'ambiguous_rate_limit_quota',
      matched: String(matchedPositive),
      negativeMatched: String(matchedNegative),
    };
  }
  return {
    isQuotaExhausted: false,
    confidence: matchedNegative ? 'negative' : 'none',
    rawReason: text.slice(0, 1000),
    reason: matchedNegative ? 'not_quota_exhausted' : 'no_quota_signal',
    negativeMatched: matchedNegative ? String(matchedNegative) : null,
  };
}

module.exports = {
  beginOrUpdateIncident,
  breakerBackoffMs,
  breakerDecision,
  bucketScope,
  claimBreakerProbe,
  classifyQuotaSignal,
  finishIncidentSnapshot,
  listStates,
  paths,
  readState,
  resolveQuotaBreaker,
  restoreScope,
  restoreScopeWithLock,
  runnerScope,
  scopeFromKey,
  stateFile,
  statePaused,
  tripQuotaBreaker,
  withScopeLock,
  writeJsonAtomic,
  writeSnapshot,
};
