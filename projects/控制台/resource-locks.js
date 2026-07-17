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
const DEFAULT_WAIT_AUDIT_INTERVAL_MS = 60 * 1000;
const COORDINATOR_STALE_MS = 10 * 1000;

const DOMAIN_DEFS = [
  { id: 'frontend-public', aliases: ['public', 'frontend', 'ui', 'webui'], paths: ['projects/控制台/public/'] },
  { id: 'engine', aliases: ['shared-engine', 'engine-core'], paths: [
    'shared/engine/',
    'projects/控制台/engine-runner.js',
    'projects/控制台/ceo-worker.js',
    'projects/控制台/resource-locks.js',
    'projects/控制台/board-review.js',
    'projects/控制台/watchdog-daemon.js',
  ] },
  { id: 'config', aliases: ['configs', 'routing'], paths: ['projects/控制台/config.json', 'shared/routing/', 'shared/config/'] },
  { id: 'assets', aliases: ['asset', 'artifacts-assets'], paths: ['projects/控制台/public/office-demo-assets/', 'projects/控制台/artifacts/avatars/'] },
  { id: 'agents', aliases: ['agent', 'agent-dirs'], paths: ['shared/agents/'] },
  { id: 'queue-state', aliases: ['queues', 'events', 'runtime'], paths: ['projects/控制台/artifacts/queues/', 'projects/控制台/artifacts/engine-events.jsonl', 'projects/控制台/artifacts/engine-jobs/'] },
  { id: 'brief-status', aliases: ['status', 'brief', 'rollup'], paths: ['projects/控制台/brief.md', 'projects/控制台/status.md', 'board/status-rollup.md'] },
  { id: 'console-backend', aliases: ['server', 'console-server', 'backend'], paths: ['projects/控制台/server.js', 'projects/控制台/control-room.js'] },
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
      const absoluteSuffix = `/${p}`;
      if (raw === p
        || raw.startsWith(`${p}/`)
        || (prefix.endsWith('/') && raw.startsWith(p))
        || raw === absoluteSuffix
        || raw.endsWith(absoluteSuffix)
        || raw.includes(`${absoluteSuffix}/`)) return def.id;
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

const INFERRED_WRITE_DOMAIN_LIMIT = 2;
const WRITE_ACTION_RE = /(修改|修复|重构|重写|新增|添加|删除|移除|替换|迁移|清理|重排|合并|取消|落地|实现|接入|更新|改造|优化|生成|覆盖|\b(?:modify|edit|fix|refactor|rewrite|add|remove|delete|replace|migrate|implement|update|generate)\b)/i;
const READ_ONLY_ACTION_RE = /(只读|读取|查看|检查|核实|审核|分析|对照|\b(?:read|inspect|audit|analy[sz]e|review)\b)/i;

function stripSecretaryBackground(text) {
  const s = String(text || '');
  const marker = s.indexOf('[秘书后台背景包]');
  if (marker === -1) return s;
  const goal = s.indexOf('\n目标:', marker);
  if (goal > marker) return `${s.slice(0, marker)}${s.slice(goal + 1)}`.trim();
  return s.slice(0, marker).trim();
}

function extractPrimaryTaskIntent(text) {
  const s = stripSecretaryBackground(text);
  const originalAt = s.indexOf('原始目标:');
  const searchFrom = originalAt >= 0 ? originalAt + '原始目标:'.length : 0;
  const targetAt = s.indexOf('目标:', searchFrom);
  if (targetAt < 0) return s;
  const start = targetAt + '目标:'.length;
  const tail = s.slice(start);
  const boundaries = [
    /\s项目:/,
    /\s图片附件(?:\(|:)/,
    /\s边界:/,
    /\s验收:/,
    /\n##\s/,
  ];
  let end = tail.length;
  for (const re of boundaries) {
    const match = re.exec(tail);
    if (match && match.index < end) end = match.index;
  }
  const primary = tail.slice(0, end).trim();
  return primary || s;
}

function primaryIntentText(task = {}) {
  return [task.title, task.task, task.summary, task.goal, task.message]
    .filter(Boolean)
    .map(extractPrimaryTaskIntent)
    .join('\n')
    .slice(0, 12000);
}

function intentClauses(text) {
  return String(text || '').split(/[\r\n。；;!?！？]+/).map(s => s.trim()).filter(Boolean);
}

function hasPositiveWriteAction(text, writeRe) {
  const scrubbed = String(text || '')
    .replace(/(?:不|无需|不要|不再|未).{0,6}(?:修改|修复|重构|重写|新增|添加|删除|移除|替换|迁移|清理|重排|合并|取消|落地|实现|接入|更新|改造|优化|生成|覆盖)/gi, '')
    .replace(/\b(?:do\s+not|don't|not|without)\b.{0,16}\b(?:modify|edit|fix|refactor|rewrite|add|remove|delete|replace|migrate|implement|update|generate)\b/gi, '');
  writeRe.lastIndex = 0;
  return writeRe.test(scrubbed);
}

function domainIntentMode(clauses, targetRe, writeRe = WRITE_ACTION_RE) {
  let readMention = false;
  for (const clause of clauses) {
    targetRe.lastIndex = 0;
    if (!targetRe.test(clause)) continue;
    readMention = true;
    if (hasPositiveWriteAction(clause, writeRe) && !(/^仅?(只读|读取|查看|检查|核实|审核|分析|对照)/.test(clause) && READ_ONLY_ACTION_RE.test(clause))) return 'write';
  }
  if (readMention && clauses.some(clause => hasPositiveWriteAction(clause, writeRe))) return 'write';
  return readMention ? 'read' : '';
}

function pushDomainByIntent(read, write, clauses, domain, targetRe, writeRe) {
  const mode = domainIntentMode(clauses, targetRe, writeRe);
  if (mode === 'write') write.push(domain);
  else if (mode === 'read') read.push(domain);
}

function inferResourceDomains(task = {}) {
  const role = String(task.role || task.agentRole || task.queueAgent || '').toLowerCase();
  const intentText = primaryIntentText(task);
  const clauses = intentClauses(intentText);
  const inputPaths = Array.isArray(task.inputs) ? task.inputs : [];
  const changedFiles = [
    ...(Array.isArray(task.changed_files) ? task.changed_files : []),
    ...(Array.isArray(task.changedFiles) ? task.changedFiles : []),
  ];
  const read = [];
  const write = [];

  // project-route 会追加项目 brief,但队列文件、eventlog 与 engine-jobs 都由
  // 控制面自己的原子写负责；不能因为“运行了一个任务”就把 queue-state
  // 作为整段 engine 生命周期的业务写锁，否则任意 supervisor 长任务都会
  // 阻塞所有 CEO 路由。真正清理/迁移队列的任务仍由下面的意图规则命中。
  if (role === 'orchestrator' || task.flowId === 'project-route') write.push('brief-status');
  if (role === 'frontend_designer' || role === 'ui_optimizer') write.push('frontend-public');
  if (role === 'memory_officer') write.push('memory');
  if (role === 'hr_manager' || role === 'hr_specialist') write.push('agents');
  if (role === 'insight-scout') write.push('insights');
  if (role === 'quality_ops' || role === 'governance') read.push('console-project', 'engine', 'config');

  for (const p of inputPaths) read.push(domainForPath(p));

  pushDomainByIntent(read, write, clauses, 'frontend-public', /projects\/控制台\/public\/|workspace\.html|control-room\.html|newapi\.html|前端|webui|任务板|任务卡|工位视图|(?:显示|渲染).{0,30}(?:CEO|主管|程序员|任务|节点|状态)|\b(?:ui|css|html)\b/i);
  pushDomainByIntent(read, write, clauses, 'engine', /shared\/engine\/|engine-runner\.js|ceo-worker\.js|resource-locks\.js|board-review\.js|watchdog-daemon\.js|引擎代码|队列引擎|lease|slot/i);
  pushDomainByIntent(read, write, clauses, 'console-backend', /projects\/控制台\/(?:server|control-room)\.js|控制台后端|API 路由/i);
  pushDomainByIntent(read, write, clauses, 'config', /projects\/控制台\/config\.json|shared\/routing\/|runners\.yaml|角色路由|runner 配置/i);
  pushDomainByIntent(read, write, clauses, 'agents', /shared\/agents\/|agent\.json|(?:注册|创建|修改|更新).{0,20}(?:智能体|角色|agent)/i);
  pushDomainByIntent(read, write, clauses, 'assets', /office-demo-assets|artifacts\/avatars\/|图像素材|头像|\.(?:png|webp)\b/i);
  pushDomainByIntent(read, write, clauses, 'queue-state', /artifacts\/queues\/|engine-events\.jsonl|engine-jobs\/|(?:清理|重排|迁移|合并|取消).{0,20}队列|队列.{0,20}(?:状态文件|清理|重排|迁移|合并|取消)/i);
  pushDomainByIntent(read, write, clauses, 'brief-status', /board\/status-rollup\.md|projects\/控制台\/(?:brief|status)\.md|项目 (?:brief|status)/i);
  pushDomainByIntent(read, write, clauses, 'memory', /(?:^|[\s`'"(])memory\/|记忆库|记忆条目|沉淀案例/i);
  pushDomainByIntent(read, write, clauses, 'insights', /board\/insights\/|artifacts\/bulletin\/|洞察卡|公告板卡/i);
  pushDomainByIntent(read, write, clauses, 'board', /board\/repair-tickets\/|board\/(?:direction|learning-cases|decisions)|维修工单/i);
  pushDomainByIntent(
    read,
    write,
    clauses,
    'tests',
    /(?:^|[\s`'"(])tests\/|回归测试|测试用例/i,
    /(新增|添加|修改|重写|删除|补齐|补充).{0,24}(测试|tests\/)|(测试|tests\/).{0,24}(新增|添加|修改|重写|删除|补齐|补充)|\b(?:add|modify|update|rewrite|remove).{0,24}(?:test|tests\/)\b/i,
  );

  // changed_files 是执行体的硬证据，不做数量截断。只有文本启发式推断才限制写域：
  // 跨多域真任务应由 CEO 显式声明 resourceDomains 或拆分阶段，避免一口气锁死全局。
  for (const f of changedFiles) write.push(domainForPath(f));
  let inferredWrite = uniqSorted(write);
  let source = 'inferred';
  if (!changedFiles.length && inferredWrite.length > INFERRED_WRITE_DOMAIN_LIMIT) {
    const kept = inferredWrite.slice(0, INFERRED_WRITE_DOMAIN_LIMIT);
    for (const domain of inferredWrite.slice(INFERRED_WRITE_DOMAIN_LIMIT)) read.push(domain);
    inferredWrite = kept;
    source = 'inferred-capped';
  }

  if (!read.length && !inferredWrite.length) inferredWrite.push('console-project');
  return { read, write: inferredWrite, source };
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

function requestConflictDomains(left = {}, right = {}) {
  const leftRead = new Set(listFrom(left.read).map(normalizeDomain).filter(Boolean));
  const leftWrite = new Set(listFrom(left.write).map(normalizeDomain).filter(Boolean));
  const rightRead = new Set(listFrom(right.read).map(normalizeDomain).filter(Boolean));
  const rightWrite = new Set(listFrom(right.write).map(normalizeDomain).filter(Boolean));
  const domains = [];
  for (const domain of leftWrite) {
    if (rightWrite.has(domain) || rightRead.has(domain)) domains.push(domain);
  }
  for (const domain of leftRead) {
    if (rightWrite.has(domain)) domains.push(domain);
  }
  return uniqSorted(domains);
}

function waiterPrecedes(waiter, token, requestedAt) {
  const waiterAt = Date.parse(waiter && waiter.requested_at || '') || 0;
  const currentAt = Date.parse(requestedAt || '') || Number.MAX_SAFE_INTEGER;
  if (waiterAt !== currentAt) return waiterAt < currentAt;
  return String(waiter && waiter.token || '') < String(token || '');
}

function conflictWaiters(root, request, token, requestedAt, opts = {}) {
  const conflicts = [];
  for (const waiter of readWaiters(root)) {
    if (!waiter || !waiter.token || waiter.token === token) continue;
    if (lockRecordStale(waiter, opts)) continue;
    if (requestedAt && !waiterPrecedes(waiter, token, requestedAt)) continue;
    for (const domain of requestConflictDomains(request, waiter)) {
      conflicts.push({
        token: waiter.token,
        mode: 'waiter',
        domain,
        queueAgent: waiter.queueAgent || null,
        queueId: waiter.queueId || null,
        taskId: waiter.taskId || null,
        ownerPid: waiter.ownerPid || null,
        requested_at: waiter.requested_at || null,
      });
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
  const previous = readJson(waiterFile(root, token));
  const waiter = {
    token,
    queueAgent: task.queueAgent || task.agent || null,
    queueId: task.queueId || task.id || null,
    taskId: task.taskId || null,
    ownerPid: Number(opts.ownerPid || process.pid),
    // requested_at 是公平排序键，轮询刷新只能更新 heartbeat，不能把老
    // waiter 每 700ms 伪装成新请求。
    requested_at: opts.requestedAt || previous && previous.requested_at || nowIso(),
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
    const probeToken = opts.token || '__scheduler_probe__';
    conflicts = conflictHolders(root, request, probeToken, Object.assign({}, opts, { leaseMs }))
      .concat(conflictWaiters(root, request, probeToken, null, Object.assign({}, opts, { leaseMs })));
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
  const waitAuditIntervalMs = Number(opts.waitAuditIntervalMs || DEFAULT_WAIT_AUDIT_INTERVAL_MS);
  const requestedAt = nowIso();
  let loggedWait = false;
  let lastWaitAuditAt = 0;
  let lastWaitAuditSignature = '';

  while (Date.now() - started <= timeoutMs) {
    let acquired = false;
    let waitPayload = null;
    await withCoordinator(root, async () => {
      sweepStaleResourceLocksInside(root, Object.assign({}, opts, { leaseMs }));
      const holderConflicts = conflictHolders(root, request, token, Object.assign({}, opts, { leaseMs }));
      const queuedConflicts = conflictWaiters(root, request, token, requestedAt, Object.assign({}, opts, { leaseMs }));
      const conflicts = holderConflicts.concat(queuedConflicts);
      if (!conflicts.length) {
        removeWaiter(root, token);
        addLocks(root, task, request, token, Object.assign({}, opts, { leaseMs }));
        appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'acquire', token }, meta, request.resourceDomains));
        acquired = true;
        return;
      }
      const waiter = writeWaiter(root, token, task, request, conflicts, Object.assign({}, opts, { requestedAt }));
      const cycle = detectCircularWait(readWaiters(root));
      waitPayload = Object.assign({}, meta, {
        token,
        read: request.read,
        write: request.write,
        conflicts,
        waitedMs: Date.now() - started,
        deadlockCycle: cycle,
      });
      const waitAuditSignature = JSON.stringify({
        conflicts: conflicts.map(item => [item.token, item.mode, item.domain]).sort(),
        deadlockCycle: cycle || null,
      });
      const auditNow = Date.now();
      if (!lastWaitAuditAt
        || waitAuditSignature !== lastWaitAuditSignature
        || auditNow - lastWaitAuditAt >= waitAuditIntervalMs) {
        appendJsonl(arbitrationFile(root), Object.assign({ ts: nowIso(), action: 'wait', waiter }, waitPayload));
        lastWaitAuditAt = auditNow;
        lastWaitAuditSignature = waitAuditSignature;
      }
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
    conflictWaiters,
    extractPrimaryTaskIntent,
    inferResourceDomains,
    lockRecordStale,
    primaryIntentText,
    processStartMarker,
    readDomainState,
    requestConflictDomains,
    requestConflictsWithHeld,
    waiterPrecedes,
  },
};
