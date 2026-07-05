#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 15 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_WAIT_POLL_MS = 700;
const COORDINATOR_STALE_MS = 10 * 1000;

const DOMAIN_DEFS = [
  { id: 'frontend-public', aliases: ['public', 'frontend', 'ui', 'webui'], paths: ['projects/控制台/public/'] },
  { id: 'engine', aliases: ['shared-engine', 'engine-core'], paths: ['shared/engine/'] },
  { id: 'config', aliases: ['configs', 'routing'], paths: ['projects/控制台/config.json', 'shared/routing/', 'shared/config/'] },
  { id: 'assets', aliases: ['asset', 'artifacts-assets'], paths: ['projects/控制台/public/office-demo-assets/', 'projects/控制台/artifacts/avatars/'] },
  { id: 'agents', aliases: ['agent', 'agent-dirs'], paths: ['shared/agents/'] },
  { id: 'queue-state', aliases: ['queues', 'events', 'runtime'], paths: ['projects/控制台/artifacts/queues/', 'projects/控制台/artifacts/engine-events.jsonl', 'projects/控制台/artifacts/engine-jobs/'] },
  { id: 'brief-status', aliases: ['status', 'brief', 'rollup'], paths: ['projects/控制台/brief.md', 'projects/控制台/status.md', 'board/status-rollup.md'] },
  { id: 'console-project', aliases: ['console', 'project-console'], paths: ['projects/控制台/'] },
  { id: 'tests', aliases: ['test'], paths: ['tests/'] },
  { id: 'memory', aliases: ['memories'], paths: ['memory/'] },
  { id: 'insights', aliases: ['insight', 'board-insights'], paths: ['board/insights/', 'projects/控制台/artifacts/bulletin/'] },
  { id: 'board', aliases: ['boards'], paths: ['board/'] },
];

const DOMAIN_ORDER = DOMAIN_DEFS.map(d => d.id);
const DOMAIN_ALIASES = new Map();
for (const def of DOMAIN_DEFS) {
  DOMAIN_ALIASES.set(def.id, def.id);
  for (const alias of def.aliases || []) DOMAIN_ALIASES.set(alias, def.id);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeFileName(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_') || 'unknown';
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

function appendJsonl(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(data) + '\n');
}

function emit(eventlog, type, data) {
  try {
    if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data || {});
  } catch (_) {}
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!n || Number.isNaN(n)) return false;
  try { process.kill(n, 0); return true; }
  catch (_) { return false; }
}

function processStartMarker(pid) {
  const n = Number(pid);
  if (!n || !pidAlive(n)) return null;
  try {
    const out = spawnSync('ps', ['-p', String(n), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 1000,
    });
    return String(out.stdout || '').trim() || null;
  } catch (_) {
    return null;
  }
}

function normalizePathForCompare(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function domainForPath(file) {
  const raw = normalizePathForCompare(file);
  if (!raw) return null;
  for (const def of DOMAIN_DEFS) {
    for (const prefix of def.paths || []) {
      const p = normalizePathForCompare(prefix);
      if (raw === p || raw.startsWith(`${p}/`) || (prefix.endsWith('/') && raw.startsWith(p))) return def.id;
    }
  }
  return null;
}

function normalizeDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/_/g, '-');
  if (DOMAIN_ALIASES.has(key)) return DOMAIN_ALIASES.get(key);
  const byPath = domainForPath(raw);
  if (byPath) return byPath;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(raw) ? key : null;
}

function uniqSorted(values) {
  const set = new Set(values.filter(Boolean));
  return [...set].sort((a, b) => {
    const ai = DOMAIN_ORDER.indexOf(a);
    const bi = DOMAIN_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function listFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

function declaredResourceObject(task) {
  if (!task || typeof task !== 'object') return null;
  for (const key of ['resourceDomains', 'resource_domains', 'resources', 'resourceLocks', 'resource_locks']) {
    if (task[key] && typeof task[key] === 'object') return task[key];
  }
  return null;
}

function isPrivilegedTask(task = {}) {
  const role = String(task.role || task.agentRole || task.agent || task.queueAgent || '').toLowerCase();
  const runnerType = String(task.runnerType || task.runner || '').toLowerCase();
  return role === 'repair'
    || role === 'cleanup'
    || task.privileged === true
    || task.engineSlotBypass === true
    || task.bypassEngineSlot === true
    || task.resourceLockBypass === true
    || task.bypassResourceLocks === true
    || runnerType === 'repair-bypass'
    || runnerType === 'codex-privileged';
}

function inferResourceDomains(task = {}) {
  const role = String(task.role || task.agentRole || task.queueAgent || '').toLowerCase();
  const intentText = [
    task.goal,
    task.message,
    task.task,
    task.title,
    task.summary,
    ...(Array.isArray(task.changed_files) ? task.changed_files : []),
  ].filter(Boolean).join('\n');
  const inputPaths = Array.isArray(task.inputs) ? task.inputs : [];
  const read = [];
  const write = [];

  if (role === 'orchestrator' || task.flowId === 'project-route') write.push('brief-status', 'queue-state');
  if (role === 'frontend_designer' || role === 'ui_optimizer') write.push('frontend-public');
  if (role === 'quality_ops' || role === 'governance') read.push('console-project', 'engine', 'config');

  for (const p of inputPaths) read.push(domainForPath(p));

  if (/projects\/控制台\/public\/|workspace\.html|前端|webui|ui|css|html/i.test(intentText)) write.push('frontend-public');
  if (/shared\/engine\/|engine-runner|ceo-worker|queue|队列|调度|并发|锁|slot|lease/i.test(intentText)) write.push('engine', 'queue-state');
  if (/config\.json|shared\/routing\/|配置|runner|路由/i.test(intentText)) write.push('config');
  if (/shared\/agents\/|agent\.json|prompt\.md|智能体|agent/i.test(intentText)) write.push('agents');
  if (/assets|素材|头像|office-demo-assets|png|webp/i.test(intentText)) write.push('assets');
  if (/memory\/|记忆|沉淀/i.test(intentText)) write.push('memory');
  if (/board\/|公告板|工单|rollup|status\.md|brief\.md/i.test(intentText)) write.push('board', 'brief-status');
  if (/tests\/|测试|回归|smoke/i.test(intentText)) write.push('tests');
  for (const f of Array.isArray(task.changed_files) ? task.changed_files : []) write.push(domainForPath(f));

  if (!read.length && !write.length) write.push('console-project');
  return { read, write, source: 'inferred' };
}

function normalizeResourceRequest(task = {}, opts = {}) {
  const effective = Object.assign({}, task || {}, opts.taskPatch || {});
  const declared = declaredResourceObject(effective);
  let source = 'declared';
  let read = [];
  let write = [];
  if (declared) {
    read = read.concat(
      listFrom(declared.read),
      listFrom(declared.reads),
      listFrom(declared.readDomains),
      listFrom(declared.read_domains),
    );
    write = write.concat(
      listFrom(declared.write),
      listFrom(declared.writes),
      listFrom(declared.writeDomains),
      listFrom(declared.write_domains),
    );
    for (const p of listFrom(declared.readPaths || declared.read_paths)) read.push(domainForPath(p));
    for (const p of listFrom(declared.writePaths || declared.write_paths)) write.push(domainForPath(p));
  } else {
    const inferred = inferResourceDomains(effective);
    read = inferred.read;
    write = inferred.write;
    source = inferred.source;
  }

  write = uniqSorted(write.map(normalizeDomain));
  const writeSet = new Set(write);
  read = uniqSorted(read.map(normalizeDomain).filter(d => d && !writeSet.has(d)));
  return {
    read,
    write,
    domains: uniqSorted(read.concat(write)),
    privileged: isPrivilegedTask(effective),
    source,
    resourceDomains: { read, write, source },
  };
}

function domainFile(root, domain) {
  return path.join(root, 'domains', `${safeFileName(domain)}.json`);
}

function waiterFile(root, token) {
  return path.join(root, 'waiters', `${safeFileName(token)}.json`);
}

function coordinatorFile(root) {
  return path.join(root, '.coordinator.lock.json');
}

function arbitrationFile(root) {
  return path.join(root, 'arbitration.jsonl');
}

function emptyDomainState(domain) {
  return { domain, readers: [], writer: null, updated_at: nowIso() };
}

function lockRecordAlive(record, opts = {}) {
  if (!record || !record.ownerPid) return false;
  if (!pidAlive(record.ownerPid)) return false;
  if (record.ownerStart && opts.checkStart !== false) {
    const cur = processStartMarker(record.ownerPid);
    if (cur && cur !== record.ownerStart) return false;
  }
  return true;
}

function lockRecordStale(record, opts = {}) {
  if (!record) return true;
  if (!lockRecordAlive(record, opts)) return true;
  const leaseMs = Number(record.leaseMs || opts.leaseMs || DEFAULT_LEASE_MS);
  const t = Date.parse(record.heartbeat_at || record.started_at || '');
  if (!t) return true;
  return Date.now() - t > leaseMs;
}

function cleanDomainState(state, opts = {}) {
  const beforeReaders = Array.isArray(state.readers) ? state.readers : [];
  const readers = beforeReaders.filter(r => !lockRecordStale(r, opts));
  const swept = beforeReaders.filter(r => lockRecordStale(r, opts)).map(r => ({
    token: r.token,
    mode: 'read',
    queueAgent: r.queueAgent || null,
    queueId: r.queueId || null,
  }));
  let writer = state.writer || null;
  if (writer && lockRecordStale(writer, opts)) {
    swept.push({
      token: writer.token,
      mode: 'write',
      queueAgent: writer.queueAgent || null,
      queueId: writer.queueId || null,
    });
    writer = null;
  }
  return {
    state: Object.assign({}, state, { readers, writer, updated_at: nowIso() }),
    swept,
  };
}

function readDomainState(root, domain) {
  return readJson(domainFile(root, domain)) || emptyDomainState(domain);
}

function writeDomainState(root, state) {
  writeJsonAtomic(domainFile(root, state.domain), state);
}

function holderSummary(record, mode, domain) {
  return {
    token: record.token,
    mode,
    domain,
    queueAgent: record.queueAgent || null,
    queueId: record.queueId || null,
    taskId: record.taskId || null,
    ownerPid: record.ownerPid || null,
  };
}

function conflictHolders(root, request, token, opts = {}) {
  const conflicts = [];
  for (const domain of request.domains) {
    const state = cleanDomainState(readDomainState(root, domain), opts).state;
    if (request.write.includes(domain)) {
      if (state.writer && state.writer.token !== token) conflicts.push(holderSummary(state.writer, 'write', domain));
      for (const r of state.readers || []) if (r.token !== token) conflicts.push(holderSummary(r, 'read', domain));
    } else if (request.read.includes(domain)) {
      if (state.writer && state.writer.token !== token) conflicts.push(holderSummary(state.writer, 'write', domain));
    }
  }
  return conflicts;
}

function currentOwnerRecord(task, token, opts = {}) {
  return {
    token,
    ownerPid: Number(opts.ownerPid || process.pid),
    ownerStart: opts.ownerStart || processStartMarker(Number(opts.ownerPid || process.pid)),
    owner: opts.owner || `pid:${Number(opts.ownerPid || process.pid)}`,
    queueAgent: task.queueAgent || task.agent || null,
    queueId: task.queueId || task.id || null,
    taskId: task.taskId || null,
    role: task.role || null,
    projectId: task.projectId || null,
    started_at: nowIso(),
    heartbeat_at: nowIso(),
    leaseMs: Number(opts.leaseMs || DEFAULT_LEASE_MS),
  };
}

async function acquireCoordinator(root, opts = {}) {
  fs.mkdirSync(root, { recursive: true });
  const file = coordinatorFile(root);
  const timeoutMs = Number(opts.coordinatorTimeoutMs || 5000);
  const deadline = Date.now() + timeoutMs;
  const record = {
    token: crypto.randomBytes(8).toString('hex'),
    ownerPid: process.pid,
    ownerStart: processStartMarker(process.pid),
    started_at: nowIso(),
  };
  while (true) {
    try {
      fs.writeFileSync(file, JSON.stringify(record) + '\n', { flag: 'wx' });
      return {
        release() {
          try {
            const cur = readJson(file);
            if (cur && cur.token === record.token) fs.unlinkSync(file);
          } catch (_) {}
        },
      };
    } catch (_) {
      const cur = readJson(file);
      const t = Date.parse(cur && cur.started_at || '') || 0;
      const stale = !cur || !lockRecordAlive(cur, { checkStart: true }) || (t && Date.now() - t > COORDINATOR_STALE_MS);
      if (stale) {
        try { fs.unlinkSync(file); } catch (_) {}
      } else if (Date.now() > deadline) {
        throw new Error('resource lock coordinator timeout');
      } else {
        await sleep(80);
      }
    }
  }
}

async function withCoordinator(root, fn, opts = {}) {
  const lease = await acquireCoordinator(root, opts);
  try {
    return await fn();
  } finally {
    lease.release();
  }
}

function readWaiters(root) {
  const dir = path.join(root, 'waiters');
  try {
    return fs.readdirSync(dir)
      .filter(f => /\.json$/.test(f))
      .map(f => readJson(path.join(dir, f)))
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function detectCircularWait(waiters) {
  const byToken = new Map((waiters || []).filter(w => w && w.token).map(w => [w.token, w]));
  const graph = new Map();
  for (const waiter of byToken.values()) {
    graph.set(waiter.token, (waiter.waitsFor || []).map(x => x && x.token).filter(t => t && byToken.has(t)));
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function dfs(token) {
    if (visiting.has(token)) {
      const i = stack.indexOf(token);
      return stack.slice(i).concat(token);
    }
    if (visited.has(token)) return null;
    visiting.add(token);
    stack.push(token);
    for (const next of graph.get(token) || []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(token);
    visited.add(token);
    return null;
  }
  for (const token of graph.keys()) {
    const cycle = dfs(token);
    if (cycle) return cycle;
  }
  return null;
}

function writeWaiter(root, token, task, request, conflicts, opts = {}) {
  const waiter = {
    token,
    queueAgent: task.queueAgent || task.agent || null,
    queueId: task.queueId || task.id || null,
    taskId: task.taskId || null,
    ownerPid: Number(opts.ownerPid || process.pid),
    requested_at: opts.requestedAt || nowIso(),
    heartbeat_at: nowIso(),
    read: request.read,
    write: request.write,
    waitsFor: conflicts,
  };
  writeJsonAtomic(waiterFile(root, token), waiter);
  return waiter;
}

function removeWaiter(root, token) {
  try { fs.unlinkSync(waiterFile(root, token)); } catch (_) {}
}

function addLocks(root, task, request, token, opts = {}) {
  const owner = currentOwnerRecord(task, token, opts);
  for (const domain of request.domains) {
    const cleaned = cleanDomainState(readDomainState(root, domain), opts).state;
    if (request.write.includes(domain)) {
      cleaned.writer = Object.assign({}, owner, { mode: 'write', domain });
      cleaned.readers = (cleaned.readers || []).filter(r => r.token !== token);
    } else {
      cleaned.readers = (cleaned.readers || []).filter(r => r.token !== token);
      cleaned.readers.push(Object.assign({}, owner, { mode: 'read', domain }));
    }
    cleaned.updated_at = nowIso();
    writeDomainState(root, cleaned);
  }
}

function touchLocks(root, token, opts = {}) {
  const at = nowIso();
  return withCoordinator(root, async () => {
    let touched = 0;
    for (const domain of opts.domains || []) {
      const state = readDomainState(root, domain);
      let changed = false;
      if (state.writer && state.writer.token === token) {
        state.writer.heartbeat_at = at;
        changed = true;
      }
      for (const reader of state.readers || []) {
        if (reader.token === token) {
          reader.heartbeat_at = at;
          changed = true;
        }
      }
      if (changed) {
        state.updated_at = at;
        writeDomainState(root, state);
        touched++;
      }
    }
    return touched;
  }, { coordinatorTimeoutMs: 1000 }).catch(() => 0);
}

async function releaseLocks(root, token, request, eventlog, meta = {}) {
  await withCoordinator(root, async () => {
    for (const domain of request.domains || []) {
      const state = readDomainState(root, domain);
      let changed = false;
      if (state.writer && state.writer.token === token) {
        state.writer = null;
        changed = true;
      }
      const readers = (state.readers || []).filter(r => {
        if (r.token === token) {
          changed = true;
          return false;
        }
        return true;
      });
      if (changed) {
        state.readers = readers;
        state.updated_at = nowIso();
        writeDomainState(root, state);
      }
    }
    removeWaiter(root, token);
    appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'release', token }, meta));
  });
  emit(eventlog, 'resource.lock.released', Object.assign({ token, read: request.read, write: request.write }, meta));
}

async function sweepStaleResourceLocks(root, opts = {}) {
  const sweptAll = [];
  await withCoordinator(root, async () => {
    sweptAll.push(...sweepStaleResourceLocksInside(root, opts));
  }, opts);
  return sweptAll;
}

async function currentResourceConflicts(task = {}, opts = {}) {
  const root = opts.root || opts.locksRoot;
  if (!root) throw new Error('missing resource lock root');
  const request = normalizeResourceRequest(task, opts);
  if (!request.domains.length || request.privileged) {
    return { available: true, request, conflicts: [] };
  }
  const leaseMs = Number(opts.leaseMs || DEFAULT_LEASE_MS);
  let conflicts = [];
  await withCoordinator(root, async () => {
    sweepStaleResourceLocksInside(root, Object.assign({}, opts, { leaseMs }));
    conflicts = conflictHolders(root, request, opts.token || '__scheduler_probe__', Object.assign({}, opts, { leaseMs }));
  }, { coordinatorTimeoutMs: Number(opts.coordinatorTimeoutMs || 1000) });
  return {
    available: conflicts.length === 0,
    request,
    conflicts,
  };
}

function sweepStaleResourceLocksInside(root, opts = {}) {
  const sweptAll = [];
  fs.mkdirSync(path.join(root, 'domains'), { recursive: true });
  for (const file of fs.readdirSync(path.join(root, 'domains')).filter(f => /\.json$/.test(f))) {
    const state = readJson(path.join(root, 'domains', file));
    if (!state || !state.domain) continue;
    const cleaned = cleanDomainState(state, opts);
    if (!cleaned.swept.length) continue;
    writeDomainState(root, cleaned.state);
    for (const swept of cleaned.swept) {
      const record = Object.assign({ domain: state.domain }, swept);
      sweptAll.push(record);
      emit(opts.eventlog, 'resource.lock.swept', record);
      appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'sweep' }, record));
    }
  }
  for (const waiter of readWaiters(root)) {
    if (lockRecordStale(waiter, opts)) removeWaiter(root, waiter.token);
  }
  return sweptAll;
}

async function acquireResourceLease(task = {}, opts = {}) {
  const root = opts.root || opts.locksRoot;
  if (!root) throw new Error('missing resource lock root');
  const request = normalizeResourceRequest(task, opts);
  const meta = {
    queueAgent: task.queueAgent || task.agent || null,
    queueId: task.queueId || task.id || null,
    taskId: task.taskId || null,
    role: task.role || null,
    projectId: task.projectId || null,
  };
  if (!request.domains.length) {
    return { token: null, request, bypassed: false, release() {} };
  }
  if (request.privileged) {
    emit(opts.eventlog, 'resource.lock.bypassed', Object.assign({}, meta, {
      read: request.read,
      write: request.write,
      reason: 'privileged-maintenance-channel',
    }));
    appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'bypass' }, meta, request.resourceDomains));
    return {
      token: null,
      request,
      bypassed: true,
      release() {
        emit(opts.eventlog, 'resource.lock.bypass_released', meta);
      },
    };
  }

  const token = crypto.randomBytes(8).toString('hex');
  const started = Date.now();
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS);
  const pollMs = Number(opts.pollMs || DEFAULT_WAIT_POLL_MS);
  const leaseMs = Number(opts.leaseMs || DEFAULT_LEASE_MS);
  const heartbeatMs = Number(opts.heartbeatMs || Math.min(DEFAULT_HEARTBEAT_MS, Math.max(1000, Math.floor(leaseMs / 3))));
  let loggedWait = false;

  while (Date.now() - started <= timeoutMs) {
    let acquired = false;
    let waitPayload = null;
    await withCoordinator(root, async () => {
      sweepStaleResourceLocksInside(root, Object.assign({}, opts, { leaseMs }));
      const conflicts = conflictHolders(root, request, token, Object.assign({}, opts, { leaseMs }));
      if (!conflicts.length) {
        removeWaiter(root, token);
        addLocks(root, task, request, token, Object.assign({}, opts, { leaseMs }));
        appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'acquire', token }, meta, request.resourceDomains));
        acquired = true;
        return;
      }
      const waiter = writeWaiter(root, token, task, request, conflicts, opts);
      const cycle = detectCircularWait(readWaiters(root));
      waitPayload = Object.assign({}, meta, {
        token,
        read: request.read,
        write: request.write,
        conflicts,
        waitedMs: Date.now() - started,
        deadlockCycle: cycle,
      });
      appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'wait', waiter }, waitPayload));
    }, opts);

    if (acquired) {
      emit(opts.eventlog, 'resource.lock.acquired', Object.assign({}, meta, {
        token,
        read: request.read,
        write: request.write,
        source: request.source,
      }));
      let released = false;
      const heartbeat = setInterval(() => {
        touchLocks(root, token, { domains: request.domains });
      }, heartbeatMs);
      if (heartbeat.unref) heartbeat.unref();
      return {
        token,
        request,
        bypassed: false,
        release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          return releaseLocks(root, token, request, opts.eventlog, meta);
        },
      };
    }

    if (!loggedWait && waitPayload) {
      loggedWait = true;
      emit(opts.eventlog, 'resource.lock.wait', waitPayload);
      if (waitPayload.deadlockCycle) emit(opts.eventlog, 'resource.lock.deadlock_detected', waitPayload);
    }
    await sleep(pollMs);
  }

  await withCoordinator(root, async () => {
    removeWaiter(root, token);
    appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'timeout', token }, meta, request.resourceDomains));
  }, opts).catch(() => {});
  emit(opts.eventlog, 'resource.lock.timeout', Object.assign({}, meta, {
    token,
    read: request.read,
    write: request.write,
    timeoutMs,
  }));
  throw new Error(`resource lock wait timeout after ${timeoutMs}ms`);
}

function requestConflictsWithHeld(request, held) {
  if (request.privileged) return false;
  for (const item of held || []) {
    const other = item.request || normalizeResourceRequest(item);
    if (other.privileged) continue;
    for (const domain of request.write) {
      if (other.write.includes(domain) || other.read.includes(domain)) return true;
    }
    for (const domain of request.read) {
      if (other.write.includes(domain)) return true;
    }
  }
  return false;
}

function planRunnableTasks(tasks, active = []) {
  const held = active.map(item => ({
    item,
    request: item.request || normalizeResourceRequest(item.task || item),
  }));
  const runnable = [];
  const blocked = [];
  for (const item of tasks || []) {
    const task = item.task || item;
    const request = normalizeResourceRequest(task);
    const conflict = requestConflictsWithHeld(request, held);
    if (conflict) {
      blocked.push(Object.assign({}, item, { resourceDomains: request.resourceDomains, reason: 'resource-write-conflict' }));
      continue;
    }
    runnable.push(Object.assign({}, item, { resourceDomains: request.resourceDomains }));
    held.push({ item, request });
  }
  return { runnable, blocked };
}

module.exports = {
  DOMAIN_DEFS,
  DOMAIN_ORDER,
  acquireResourceLease,
  currentResourceConflicts,
  detectCircularWait,
  domainForPath,
  normalizeDomain,
  normalizeResourceRequest,
  planRunnableTasks,
  sweepStaleResourceLocks,
  _test: {
    cleanDomainState,
    conflictHolders,
    lockRecordStale,
    processStartMarker,
    readDomainState,
    requestConflictsWithHeld,
  },
};
