'use strict';
/*
 * queue:智能体任务队列核心(文件系统、零依赖、原子)。
 * 依据 shared/routing/任务队列设计.md & 蓝图 §8。每 agent 一条队列。
 * 文件名 = `PP-SSSSSSSSSS-<id>.json`:PP 优先级(00 最急…99 最缓),SSSS 单调序 → 字典序 = 取用顺序。
 * 状态目录:<agent>/ (queued) · running/ · paused/ · done/ · failed/ · canceled/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function qdir(root, agent) {
  const d = path.join(root, 'queues', agent);
  for (const s of ['', 'running', 'paused', 'done', 'failed', 'canceled']) fs.mkdirSync(path.join(d, s), { recursive: true });
  return d;
}
function nextSeq(d) {
  const f = path.join(d, '_seq'); let n = 0;
  try { n = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch (_) {}
  n++; fs.writeFileSync(f, String(n)); return n;
}
const fname = (pri, seq, id) => `${String(pri).padStart(2, '0')}-${String(seq).padStart(10, '0')}-${id}.json`;
const pendFiles = d => fs.readdirSync(d).filter(f => /\.json$/.test(f) && f !== '_seq').sort();
const findPend = (d, id) => pendFiles(d).find(f => f.endsWith(`-${id}.json`));
const findPaused = (d, id) => fs.readdirSync(path.join(d, 'paused')).find(f => f === `${id}.json`);
const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const nowIso = () => new Date().toISOString();
function writeJson(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}
function runningFile(root, agent, id) {
  return path.join(qdir(root, agent), 'running', `${id}.json`);
}
function leaseOwner(opts = {}) {
  return opts.owner || opts.ownerId || opts.leaseOwner || `pid:${process.pid}`;
}
function ownerPid(opts = {}) {
  const pid = opts.ownerPid != null ? opts.ownerPid : (opts.pid != null ? opts.pid : process.pid);
  return Number.isFinite(Number(pid)) ? Number(pid) : null;
}
function leaseMsValue(entry, opts = {}) {
  const raw = opts.leaseMs != null ? opts.leaseMs : (opts.lease_ms != null ? opts.lease_ms : entry && entry.lease_ms);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function applyLease(entry, opts = {}) {
  const at = opts.at || nowIso();
  const owner = leaseOwner(opts);
  const pid = ownerPid(opts);
  entry.owner = owner;
  entry.owner_pid = pid;
  entry.lease_owner = owner;
  entry.lease_owner_pid = pid;
  entry.lease_claimed_at = entry.lease_claimed_at || at;
  entry.lease_heartbeat_at = at;
  entry.heartbeat_at = at;
  entry.updated_at = at;
  const leaseMs = leaseMsValue(entry, opts);
  if (leaseMs) entry.lease_ms = leaseMs;
  return entry;
}
function leaseHeartbeat(entry) {
  if (!entry) return null;
  const fields = [
    entry.lease_heartbeat_at,
    entry.engine_heartbeat_at,
    entry.heartbeat_at,
    entry.updated_at,
    entry.started_at,
    entry.lease_claimed_at,
  ].filter(Boolean);
  let best = null;
  let bestTs = 0;
  for (const value of fields) {
    const ts = Date.parse(value);
    if (ts && ts >= bestTs) {
      best = value;
      bestTs = ts;
    }
  }
  return best;
}
function isLeaseStale(entry, opts = {}) {
  const at = leaseHeartbeat(entry);
  const t = at ? Date.parse(at) : 0;
  const now = opts.now != null ? Number(opts.now) : Date.now();
  const leaseMs = leaseMsValue(entry, opts) || 60 * 1000;
  const ageMs = t ? now - t : Infinity;
  return { stale: !t || ageMs > leaseMs, at, ageMs, leaseMs };
}
function touchLease(root, agent, id, patch = {}) {
  const file = runningFile(root, agent, id);
  if (!fs.existsSync(file)) return null;
  const e = rd(file) || { id, target: agent };
  const expectedOwner = patch.expectedOwner || patch.expected_owner || null;
  if (expectedOwner && e.lease_owner && e.lease_owner !== expectedOwner) return null;
  const {
    expectedOwner: _expectedOwner,
    expected_owner: _expected_owner,
    owner,
    ownerId,
    leaseOwner: _leaseOwner,
    ownerPid: _ownerPid,
    pid,
    leaseMs,
    lease_ms,
    at,
    ...rest
  } = patch;
  Object.assign(e, rest);
  applyLease(e, { owner, ownerId, leaseOwner: _leaseOwner, ownerPid: _ownerPid, pid, leaseMs, lease_ms, at });
  writeJson(file, e);
  return e;
}
function touchProgress(root, agent, id, patch = {}) {
  const file = runningFile(root, agent, id);
  if (!fs.existsSync(file)) return null;
  const e = Object.assign(rd(file) || { id, target: agent }, patch);
  writeJson(file, e);
  return e;
}
function runningEntries(root, agent) {
  const dir = path.join(qdir(root, agent), 'running');
  return fs.readdirSync(dir).filter(f => /\.json$/.test(f)).map(file => {
    const entry = rd(path.join(dir, file));
    return entry ? { id: file.replace(/\.json$/, ''), file: path.join(dir, file), entry } : null;
  }).filter(Boolean);
}

// 入队(叠加,不等待)
function enqueue(root, agent, task, opts = {}) {
  const d = qdir(root, agent);
  const id = opts.id || crypto.randomBytes(4).toString('hex');
  const priority = opts.priority != null ? opts.priority : 50;
  const seq = nextSeq(d);
  const e = { id, target: agent, task, priority, status: 'queued', seq,
    enqueued_at: new Date().toISOString(), steer: [], idem: opts.idem || null };
  writeJson(path.join(d, fname(priority, seq, id)), e);
  return e;
}
// 列表(queued 按取用顺序 + running + 计数)
function list(root, agent) {
  const d = qdir(root, agent);
  const queued = pendFiles(d).map(f => rd(path.join(d, f))).filter(Boolean);
  const running = fs.readdirSync(path.join(d, 'running')).filter(f => /\.json$/.test(f)).map(f => rd(path.join(d, 'running', f))).filter(Boolean);
  const paused = fs.readdirSync(path.join(d, 'paused')).filter(f => /\.json$/.test(f)).map(f => rd(path.join(d, 'paused', f))).filter(Boolean);
  const cnt = s => fs.readdirSync(path.join(d, s)).filter(f => /\.json$/.test(f)).length;
  return { agent, queued, running, paused, done: cnt('done'), failed: cnt('failed'), canceled: cnt('canceled') };
}
// 设优先级 / 插队(jump = 设为最急 00)
function setPriority(root, agent, id, priority) {
  const d = qdir(root, agent); const cur = findPend(d, id); if (!cur) return null;
  const e = rd(path.join(d, cur)); e.priority = priority;
  fs.renameSync(path.join(d, cur), path.join(d, fname(priority, e.seq, id)));
  writeJson(path.join(d, fname(priority, e.seq, id)), e);
  return e;
}
const jump = (root, agent, id) => setPriority(root, agent, id, 0);
function normalizePriority(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(99, Math.floor(n)));
}
// 调换顺序:按给定 id 顺序重排 queued 项。默认保留 priority; strict/normalizePriority
// 用于 UI 拖拽,把 priority 归一后让传入顺序成为真实取用顺序。
function reorder(root, agent, orderedIds, opts = {}) {
  const d = qdir(root, agent);
  const files = pendFiles(d);
  const entries = files.map(file => {
    const entry = rd(path.join(d, file));
    return entry && entry.id ? { file, id: String(entry.id), entry } : null;
  }).filter(Boolean);
  const byId = new Map(entries.map(x => [x.id, x]));
  const seen = new Set();
  const ordered = [];
  for (const raw of orderedIds || []) {
    const id = String(raw || '');
    if (!id || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    ordered.push(byId.get(id));
  }
  for (const x of entries) if (!seen.has(x.id)) ordered.push(x);
  const normalize = opts.normalizePriority === true || opts.strict === true;
  const basePriority = normalizePriority(
    opts.priority,
    entries.reduce((min, x) => Math.min(min, normalizePriority(x.entry.priority, 50)), 99)
  );
  let seq = 1;
  for (const x of ordered) {
    const src = path.join(d, x.file);
    const e = x.entry;
    e.seq = seq++;
    if (normalize) e.priority = basePriority;
    const priority = normalizePriority(e.priority, 50);
    const dst = path.join(d, fname(priority, e.seq, x.id));
    if (src !== dst && fs.existsSync(src)) fs.renameSync(src, dst);
    writeJson(dst, e);
  }
  return list(root, agent).queued;
}
// 引导(steering):给某任务注入引导消息(运行中由 worker 在安全点消费)
function steer(root, agent, id, msg) {
  const d = qdir(root, agent);
  for (const sub of ['', 'running']) {
    const dir = path.join(d, sub);
    const f = sub ? (fs.existsSync(path.join(dir, `${id}.json`)) ? `${id}.json` : null) : findPend(d, id);
    if (f) { const p = path.join(dir, f); const e = rd(p); e.steer = Array.isArray(e.steer) ? e.steer : []; e.steer.push({ at: new Date().toISOString(), msg }); writeJson(p, e); return e; }
  }
  return null;
}
// 暂停/恢复:仅对尚未运行的 queued 项生效,保证不丢任务。
function pause(root, agent, id) {
  const d = qdir(root, agent); const cur = findPend(d, id); if (!cur) return null;
  const src = path.join(d, cur); const e = rd(src); if (!e) return null;
  e.status = 'paused'; e.paused_at = new Date().toISOString();
  writeJson(path.join(d, 'paused', `${id}.json`), e);
  fs.unlinkSync(src);
  return e;
}
function resume(root, agent, id) {
  const d = qdir(root, agent); const cur = findPaused(d, id); if (!cur) return null;
  const src = path.join(d, 'paused', cur); const e = rd(src); if (!e) return null;
  e.status = 'queued'; e.resumed_at = new Date().toISOString(); e.seq = nextSeq(d);
  for (const field of [
    'reason',
    'error',
    'engine_code',
    'engine_signal',
    'enginePid',
    'engine_started_at',
    'engine_heartbeat_at',
    'pre_engine_wait_heartbeat_at',
    'progress_at',
    'node_event_at',
    'progress_event',
    'progress_node',
    'progress_task',
    'started_at',
    'finished_at',
    'paused_at',
    'owner',
    'owner_pid',
    'lease_owner',
    'lease_owner_pid',
    'lease_claimed_at',
    'lease_heartbeat_at',
    'heartbeat_at',
    'cancel_requested',
    'cancel_requested_at',
  ]) delete e[field];
  writeJson(path.join(d, fname(e.priority != null ? e.priority : 50, e.seq, id)), e);
  fs.unlinkSync(src);
  return e;
}
// 恢复 running 项:worker/engine 异常退出后移回 queued,由后续 worker 重试。
function requeue(root, agent, id, patch = {}) {
  const d = qdir(root, agent);
  const src = path.join(d, 'running', `${id}.json`);
  if (!fs.existsSync(src)) return null;
  const e = Object.assign(rd(src) || { id, target: agent }, patch);
  e.status = 'queued';
  e.seq = nextSeq(d);
  e.requeued_at = new Date().toISOString();
  delete e.started_at;
  delete e.finished_at;
  delete e.owner;
  delete e.owner_pid;
  delete e.lease_owner;
  delete e.lease_owner_pid;
  delete e.lease_claimed_at;
  delete e.lease_heartbeat_at;
  delete e.lease_ms;
  delete e.heartbeat_at;
  delete e.engine_started_at;
  delete e.engine_heartbeat_at;
  delete e.pre_engine_wait_heartbeat_at;
  delete e.progress_at;
  delete e.node_event_at;
  delete e.progress_event;
  delete e.progress_node;
  delete e.progress_task;
  delete e.enginePid;
  delete e.engine_pid;
  delete e.engine_code;
  delete e.engine_signal;
  delete e.cancel_requested;
  delete e.cancel_requested_at;
  const priority = e.priority != null ? e.priority : 50;
  writeJson(path.join(d, fname(priority, e.seq, id)), e);
  fs.unlinkSync(src);
  return e;
}
// 取消:queued/paused 直接移到 canceled; running 标记取消请求,由 worker 杀进程并收尾。
function cancel(root, agent, id) {
  const d = qdir(root, agent); const cur = findPend(d, id);
  if (cur) {
    const src = path.join(d, cur); const e = rd(src); if (!e) return null;
    e.status = 'canceled'; e.canceled_at = new Date().toISOString();
    writeJson(path.join(d, 'canceled', `${id}.json`), e);
    fs.unlinkSync(src); return e;
  }
  const paused = findPaused(d, id);
  if (paused) {
    const src = path.join(d, 'paused', paused); const e = rd(src); if (!e) return null;
    e.status = 'canceled'; e.canceled_at = new Date().toISOString();
    writeJson(path.join(d, 'canceled', `${id}.json`), e);
    fs.unlinkSync(src); return e;
  }
  const running = path.join(d, 'running', `${id}.json`);
  if (fs.existsSync(running)) {
    const e = rd(running) || { id, target: agent };
    e.status = 'canceling'; e.cancel_requested = true; e.cancel_requested_at = new Date().toISOString();
    writeJson(running, e);
    return e;
  }
  return null;
}
// 认领(worker 默认取队首; opts.match 存在时取首个匹配项,原子 mv 到 running)
function claim(root, agent, opts = {}) {
  const d = qdir(root, agent); const files = pendFiles(d); if (!files.length) return null;
  const match = typeof opts.match === 'function' ? opts.match : null;
  for (const f of files) {
    const e = rd(path.join(d, f));
    if (!e) continue;
    if (match && !match(e, { file: f })) continue;
    const at = nowIso();
    for (const field of [
      'engine_started_at',
      'engine_heartbeat_at',
      'pre_engine_wait_heartbeat_at',
      'progress_at',
      'node_event_at',
      'progress_event',
      'progress_node',
      'progress_task',
      'enginePid',
      'engine_pid',
      'engine_code',
      'engine_signal',
      'finished_at',
      'cancel_requested',
      'cancel_requested_at',
    ]) delete e[field];
    e.status = 'running';
    e.started_at = at;
    e.claimed_at = at;
    e.run_attempt = Number(e.run_attempt || 0) + 1;
    applyLease(e, Object.assign({}, opts, { at }));
    const dst = path.join(d, 'running', `${e.id}.json`);
    // rename 抢占失败(被并发 worker 先领走)只跳过这一份,继续扫下一个待领取文件;
    // 此前 return null 会让本 worker 放弃整个调度周期(2026-07-03 架构审视 A-2)。
    try { fs.renameSync(path.join(d, f), dst); } catch { continue; }
    writeJson(dst, e); return e;
  }
  return null;
}
function recoverStaleRunning(root, agent, opts = {}) {
  const out = [];
  for (const item of runningEntries(root, agent)) {
    const lease = isLeaseStale(item.entry, opts);
    if (!lease.stale) continue;
    const retryField = opts.retryField || 'retry';
    const retry = opts.incrementRetry === false
      ? Number(item.entry[retryField] || 0)
      : Number(item.entry[retryField] || 0) + 1;
    const reason = opts.reason || `lease ${lease.at || 'missing'} stale after ${Math.max(0, Math.round((lease.ageMs || 0) / 1000))}s`;
    const patch = Object.assign({}, opts.patch || {}, {
      [retryField]: retry,
      recovered_at: nowIso(),
      recovered_reason: reason,
      lease_stale_at: lease.at || null,
      lease_stale_age_ms: lease.ageMs,
      error: null,
    });
    let entry;
    let status;
    if (opts.maxRetry != null && retry > Number(opts.maxRetry)) {
      entry = finish(root, agent, item.id, 'failed', Object.assign({}, item.entry, patch, {
        error: `${reason}; exceeded max retry ${opts.maxRetry}`,
      }));
      status = 'failed';
    } else {
      entry = requeue(root, agent, item.id, patch);
      status = entry ? 'queued' : 'missing';
    }
    out.push({ id: item.id, status, retry, reason, entry, lease });
  }
  return out;
}
// 完成 / 失败 / 取消 / 运行中软暂停
function finish(root, agent, id, status, patch = {}) {
  const d = qdir(root, agent); const src = path.join(d, 'running', `${id}.json`);
  const finalStatus = ['done', 'failed', 'canceled', 'paused'].includes(status) ? status : 'failed';
  const e = Object.assign(rd(src) || { id, target: agent }, patch);
  e.status = finalStatus;
  if (finalStatus === 'paused') e.paused_at = new Date().toISOString();
  else e.finished_at = new Date().toISOString();
  writeJson(path.join(d, finalStatus, `${id}.json`), e);
  try { fs.unlinkSync(src); } catch (_) {}
  return e;
}
function complete(root, agent, id, ok = true, patch = {}) {
  return finish(root, agent, id, ok ? 'done' : 'failed', patch);
}

module.exports = {
  enqueue,
  list,
  setPriority,
  jump,
  reorder,
  steer,
  pause,
  resume,
  requeue,
  cancel,
  claim,
  complete,
  finish,
  qdir,
  touchLease,
  touchProgress,
  isLeaseStale,
  runningEntries,
  recoverStaleRunning,
};
