'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Q = require('./queue');

const TERMINAL_STATES = ['done', 'failed', 'canceled'];

function nowIso() {
  return new Date().toISOString();
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

function sha1(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function normalizeForHash(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();
}

function integrityHash(text) {
  return sha1(normalizeForHash(text));
}

function safeAgent(agent) {
  const s = String(agent || '');
  return /^[\p{L}\p{N}_-]+$/u.test(s) ? s : '';
}

function listAgents(root) {
  const qroot = path.join(root, 'queues');
  try {
    return fs.readdirSync(qroot).filter(safeAgent).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) {
    return [];
  }
}

function parseAgentList(value, root) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  const agents = raw.map(safeAgent).filter(Boolean);
  if (!agents.length || agents.includes('all')) return listAgents(root);
  return [...new Set(agents)];
}

function taskObject(entry) {
  return entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task) ? entry.task : null;
}

function taskText(entry) {
  const task = taskObject(entry);
  if (task) return String(task.goal || task.message || task.task || task.summary || task.idem || JSON.stringify(task));
  return String(entry && entry.task || '');
}

function shortText(entry, max = 180) {
  return taskText(entry).replace(/\s+/g, ' ').trim().slice(0, max);
}

function projectOf(entry, agent) {
  const task = taskObject(entry);
  if (task && task.projectId) return String(task.projectId);
  if (entry && entry.projectId) return String(entry.projectId);
  const m = String(agent || '').match(/^supervisor-(.+)$/);
  if (m) return m[1];
  return '';
}

function belongsToProject(entry, agent, projectId) {
  const project = String(projectId || '').trim();
  if (!project) return true;
  if (/starlaid/i.test(project)) return false;
  if (projectOf(entry, agent) === project) return true;
  if (agent === `supervisor-${project}`) return true;
  const text = taskText(entry);
  if (project === '控制台' && /(控制台|console|workspace|工作区|new-api|api 网关|queue|队列|CEO|ceo)/i.test(text)) return true;
  return false;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ngrams(text, size = 3) {
  const s = normalizeText(text).replace(/\s+/g, '');
  if (!s) return new Set();
  if (s.length <= size) return new Set([s]);
  const out = new Set();
  for (let i = 0; i <= s.length - size; i++) out.add(s.slice(i, i + size));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function exactFingerprint(entry) {
  const s = normalizeText(taskText(entry));
  return s.length > 280 ? s.slice(0, 280) : s;
}

function structuredMergeKey(entry) {
  const task = taskObject(entry) || {};
  const key = task.queueMergeKey || task.autoMergeKey || task.idem || entry && (entry.queueMergeKey || entry.autoMergeKey || entry.idem);
  return key ? String(key).trim() : '';
}

function classify(entry) {
  const text = taskText(entry);
  const s = normalizeText(text);
  const has = re => re.test(text) || re.test(s);
  if (has(/整理队列|队列整理|queue[-_\s]*organize|队列管理/i) && has(/CEO|ceo|队列|queue/i)) {
    return { bucket: 'queue-organize', label: 'CEO queue organization', mergeable: true, activeMergeable: true };
  }
  if (has(/(模型用量|glm\s*5\.?2|claudecode|codex|LLM|llm|Helicone|Portkey|gateway|网关|trace|session|quota|额度|用量|可观测)/i) &&
      has(/(用量|quota|额度|网关|gateway|可观测|trace|session|日志|面板|panel)/i)) {
    return { bucket: 'llm-usage-observability', label: 'LLM usage and gateway observability', mergeable: true, activeMergeable: false };
  }
  if (has(/(维修工单|自动维修|repair[-_\s]*ticket|repair)/i) &&
      has(/(公告板|公告卡|待办|bulletin|enabled|重复启用|repair[-_\s]*ticket[-_\s]*complete|自动进\s*repair)/i)) {
    return { bucket: 'repair-bulletin-idempotency', label: 'repair ticket bulletin/idempotency cleanup', mergeable: true, activeMergeable: false };
  }
  if (has(/(workspace\.html|public\/workspace|工作区|任务板|队列区|进展区)/i) &&
      has(/(UI|ui|界面|渲染|滚动|卡片|布局|前端|折叠)/i)) {
    return { bucket: 'workspace-ui', label: 'workspace UI work', mergeable: true, activeMergeable: false };
  }
  if (has(/(tasteskill|impeccable)/i)) {
    return { bucket: 'frontend-skill-research', label: 'frontend skill research', mergeable: false, activeMergeable: false };
  }
  return { bucket: `exact:${exactFingerprint(entry)}`, label: 'exact duplicate', mergeable: false, activeMergeable: false };
}

function groupStructuredKey(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = structuredMergeKey(item.entry);
    if (!key) continue;
    const cur = byKey.get(key) || [];
    cur.push(item);
    byKey.set(key, cur);
  }
  return [...byKey.entries()]
    .filter(([, xs]) => xs.length > 1)
    .map(([key, xs]) => ({ bucket: `structured:${key.slice(0, 48)}`, label: 'structured merge key', items: xs, reason: 'structured-key' }));
}

function queuedFile(root, agent, id) {
  const dir = Q.qdir(root, agent);
  try {
    const found = fs.readdirSync(dir)
      .filter(f => /\.json$/.test(f) && f.endsWith(`-${id}.json`))
      .sort()[0];
    return found ? path.join(dir, found) : null;
  } catch (_) {
    return null;
  }
}

function entryFile(root, item) {
  const dir = Q.qdir(root, item.agent);
  if (item.state === 'queued') return queuedFile(root, item.agent, item.id);
  if (item.state === 'paused') {
    const file = path.join(dir, 'paused', `${item.id}.json`);
    return fs.existsSync(file) ? file : null;
  }
  if (item.state === 'running') {
    const file = path.join(dir, 'running', `${item.id}.json`);
    return fs.existsSync(file) ? file : null;
  }
  for (const state of TERMINAL_STATES) {
    const file = path.join(dir, state, `${item.id}.json`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function itemRef(item) {
  return {
    agent: item.agent,
    id: item.id,
    state: item.state,
    priority: item.entry && item.entry.priority,
    seq: item.entry && item.entry.seq,
    projectId: projectOf(item.entry, item.agent) || null,
    summary: shortText(item.entry),
  };
}

function queuedIdFromFile(file, entry) {
  if (entry && entry.id) return String(entry.id);
  const m = String(file || '').match(/-([^-]+)\.json$/);
  return m ? m[1] : String(file || '').replace(/\.json$/, '');
}

function queueSnapshot(root, agents, opts = {}) {
  const states = opts.states || ['queued', 'paused', 'running'];
  const safeAgents = [...new Set((agents || []).map(safeAgent).filter(Boolean))]
    .filter(agent => !/starlaid/i.test(agent))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const entries = [];
  for (const agent of safeAgents) {
    const base = Q.qdir(root, agent);
    for (const state of states) {
      const dir = state === 'queued' ? base : path.join(base, state);
      let files = [];
      try { files = fs.readdirSync(dir).filter(file => /\.json$/.test(file)).sort(); }
      catch (_) { files = []; }
      for (const file of files) {
        const full = path.join(dir, file);
        let stat;
        let content = '';
        try {
          stat = fs.statSync(full);
          content = fs.readFileSync(full, 'utf8');
        } catch (_) {
          continue;
        }
        const entry = (() => { try { return JSON.parse(content); } catch (_) { return null; } })();
        entries.push({
          agent,
          state,
          id: state === 'queued' ? queuedIdFromFile(file, entry) : String(entry && entry.id || file.replace(/\.json$/, '')),
          file,
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
          sha1: sha1(content),
        });
      }
    }
  }
  const idList = entries.map(x => `${x.agent}:${x.state}:${x.id}:${x.file}`).join('\n');
  const mtimeList = entries.map(x => `${x.agent}:${x.state}:${x.id}:${x.file}:${x.mtimeMs}:${x.size}`).join('\n');
  const contentList = entries.map(x => `${x.agent}:${x.state}:${x.id}:${x.file}:${x.sha1}`).join('\n');
  return {
    version: 1,
    created_at: nowIso(),
    agents: safeAgents,
    states,
    entries,
    id_list_hash: sha1(idList),
    mtime_hash: sha1(mtimeList),
    hash: sha1(`${sha1(idList)}\n${sha1(mtimeList)}\n${sha1(contentList)}`),
  };
}

function planComparableGroups(groups) {
  return (groups || []).map(group => ({
    type: group.type,
    reason: group.reason,
    bucket: group.bucket,
    label: group.label,
    keep: group.keep && {
      agent: group.keep.agent,
      id: group.keep.id,
      state: group.keep.state,
    },
    cancel: (group.cancel || []).map(item => ({
      agent: item.agent,
      id: item.id,
      state: item.state,
    })),
  }));
}

function attachPlanVersion(plan) {
  const comparable = {
    projectId: plan.projectId || null,
    agents: plan.agents || [],
    snapshot: plan.snapshot && plan.snapshot.hash || null,
    groups: planComparableGroups(plan.groups),
  };
  const planHash = sha1(stableJson(comparable));
  plan.plan_hash = planHash;
  plan.idempotency_key = `queue-organize:${planHash}`;
  return plan;
}

function idempotencyFile(root, key) {
  const safe = sha1(key).slice(0, 40);
  return path.join(root, 'queue-organize-idempotency', `${safe}.json`);
}

function sortActionable(items) {
  return items.slice().sort((a, b) => {
    const ap = Number(a.entry && a.entry.priority != null ? a.entry.priority : 50);
    const bp = Number(b.entry && b.entry.priority != null ? b.entry.priority : 50);
    if (ap !== bp) return ap - bp;
    const as = Number(a.entry && a.entry.seq != null ? a.entry.seq : 999999999);
    const bs = Number(b.entry && b.entry.seq != null ? b.entry.seq : 999999999);
    if (as !== bs) return as - bs;
    return String(a.entry && a.entry.enqueued_at || '').localeCompare(String(b.entry && b.entry.enqueued_at || ''));
  });
}

function collect(root, opts) {
  const agents = parseAgentList(opts.agents, root).filter(agent => {
    if (/starlaid/i.test(agent)) return false;
    return !(opts.excludeAgents || []).includes(agent);
  });
  const actionable = [];
  const running = [];
  const terminal = [];
  for (const agent of agents) {
    let listed;
    try { listed = Q.list(root, agent); } catch (_) { continue; }
    for (const state of ['queued', 'paused']) {
      if (state === 'paused' && opts.includePaused === false) continue;
      for (const entry of listed[state] || []) {
        if (!entry || !entry.id || !belongsToProject(entry, agent, opts.projectId)) continue;
        const item = { agent, id: String(entry.id), state, entry, classInfo: classify(entry) };
        item.ngrams = ngrams(taskText(entry));
        actionable.push(item);
      }
    }
    for (const entry of listed.running || []) {
      if (!entry || !entry.id || !belongsToProject(entry, agent, opts.projectId)) continue;
      const item = { agent, id: String(entry.id), state: 'running', entry, classInfo: classify(entry) };
      item.ngrams = ngrams(taskText(entry));
      running.push(item);
    }
    if (opts.reportTerminal) {
      const dir = Q.qdir(root, agent);
      for (const state of TERMINAL_STATES) {
        const stateDir = path.join(dir, state);
        let files = [];
        try { files = fs.readdirSync(stateDir).filter(f => /\.json$/.test(f)); } catch (_) {}
        for (const file of files) {
          const entry = readJson(path.join(stateDir, file));
          if (!entry || !entry.id || !belongsToProject(entry, agent, opts.projectId)) continue;
          terminal.push({ agent, id: String(entry.id), state, entry, classInfo: classify(entry) });
        }
      }
    }
  }
  return { agents, actionable, running, terminal };
}

function groupByKnownBucket(items) {
  const byBucket = new Map();
  for (const item of items) {
    if (!item.classInfo.mergeable) continue;
    const cur = byBucket.get(item.classInfo.bucket) || [];
    cur.push(item);
    byBucket.set(item.classInfo.bucket, cur);
  }
  return [...byBucket.entries()]
    .filter(([, xs]) => xs.length > 1)
    .map(([bucket, xs]) => ({ bucket, label: xs[0].classInfo.label, items: xs, reason: 'known-same-class' }));
}

function groupExact(items) {
  const byFp = new Map();
  for (const item of items) {
    const fp = exactFingerprint(item.entry);
    if (fp.length < 24) continue;
    const cur = byFp.get(fp) || [];
    cur.push(item);
    byFp.set(fp, cur);
  }
  return [...byFp.entries()]
    .filter(([, xs]) => xs.length > 1)
    .map(([bucket, xs]) => ({ bucket: `exact:${bucket.slice(0, 48)}`, label: 'exact duplicate', items: xs, reason: 'exact-text' }));
}

function groupNearDuplicates(items) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const sim = jaccard(items[i].ngrams, items[j].ngrams);
      if (sim >= 0.82) {
        group.push(items[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      used.add(i);
      groups.push({ bucket: `near:${items[i].id}`, label: 'near duplicate', items: group, reason: 'near-text' });
    }
  }
  return groups;
}

function activeDuplicateGroups(actionable, running) {
  const out = [];
  for (const active of running) {
    const matches = actionable.filter(item => {
      if (item.classInfo.bucket === active.classInfo.bucket && item.classInfo.activeMergeable) return true;
      return jaccard(item.ngrams, active.ngrams) >= 0.86;
    });
    if (matches.length) {
      out.push({
        bucket: active.classInfo.bucket,
        label: active.classInfo.label,
        active,
        items: matches,
        reason: 'same-as-running',
      });
    }
  }
  return out;
}

function buildCandidateGroups(actionable, allowCrossAgentMerge) {
  if (allowCrossAgentMerge) {
    return uniqueGroups([
      ...groupStructuredKey(actionable),
      ...groupByKnownBucket(actionable),
      ...groupExact(actionable),
      ...groupNearDuplicates(actionable),
    ]);
  }
  const out = [];
  const byAgent = new Map();
  for (const item of actionable) {
    const cur = byAgent.get(item.agent) || [];
    cur.push(item);
    byAgent.set(item.agent, cur);
  }
  for (const items of byAgent.values()) {
    out.push(...uniqueGroups([
      ...groupStructuredKey(items),
      ...groupByKnownBucket(items),
      ...groupExact(items),
      ...groupNearDuplicates(items),
    ]));
  }
  return out;
}

function uniqueGroups(groups) {
  const consumed = new Set();
  const out = [];
  for (const group of groups) {
    const ids = group.items.map(x => `${x.agent}:${x.id}`);
    if (ids.some(id => consumed.has(id))) continue;
    ids.forEach(id => consumed.add(id));
    out.push(group);
  }
  return out;
}

function makePlan(root, opts = {}) {
  if (/starlaid/i.test(String(opts.projectId || opts.project || ''))) {
    return attachPlanVersion({
      ok: true,
      applied: false,
      out_of_band: true,
      excluded: 'starlaid',
      projectId: opts.projectId || opts.project || null,
      agents: [],
      summary: {
        queued_before: 0,
        paused_before: 0,
        running_seen: 0,
        planned_groups: 0,
        planned_cancel: 0,
        queued_after_estimate: 0,
        terminal_reported: 0,
      },
      groups: [],
      snapshot: queueSnapshot(root, [], {}),
    });
  }
  const collected = collect(root, opts);
  const allowCrossAgentMerge = opts.allowCrossAgentMerge === true;
  const groupCandidates = buildCandidateGroups(collected.actionable, allowCrossAgentMerge);
  const activeGroups = opts.mergeIntoActive === false ? [] : activeDuplicateGroups(
    collected.actionable,
    allowCrossAgentMerge ? collected.running : collected.running.filter(active => collected.actionable.some(item => item.agent === active.agent))
  ).map(group => {
    if (allowCrossAgentMerge) return group;
    return Object.assign({}, group, { items: group.items.filter(item => item.agent === group.active.agent) });
  }).filter(group => group.items.length);
  const consumedByActive = new Set();
  const activePlans = activeGroups.map(group => {
    const items = group.items.filter(item => !consumedByActive.has(`${item.agent}:${item.id}`));
    if (!items.length) return null;
    items.forEach(item => consumedByActive.add(`${item.agent}:${item.id}`));
    return {
      type: 'active-duplicate',
      reason: group.reason,
      bucket: group.bucket,
      label: group.label,
      keep: itemRef(group.active),
      cancel: items.map(itemRef),
      note: 'running item kept untouched; queued/paused duplicates can be canceled',
    };
  }).filter(Boolean);

  const mergePlans = groupCandidates
    .map(group => {
      const candidates = group.items.filter(item => !consumedByActive.has(`${item.agent}:${item.id}`));
      if (candidates.length < 2) return null;
      const ordered = sortActionable(candidates);
      const keep = ordered[0];
      const cancel = ordered.slice(1);
      return {
        type: group.reason === 'exact-text' || group.reason === 'near-text' ? 'duplicate' : 'merge',
        reason: group.reason,
        bucket: group.bucket,
        label: group.label,
        keep: itemRef(keep),
        cancel: cancel.map(itemRef),
        note: 'keep item receives merged context; canceled items are queued/paused only',
      };
    })
    .filter(Boolean);

  const beforeQueued = collected.actionable.filter(x => x.state === 'queued').length;
  const beforePaused = collected.actionable.filter(x => x.state === 'paused').length;
  const cancelCount = [...activePlans, ...mergePlans].reduce((n, g) => n + g.cancel.length, 0);
  const queuedCancelCount = [...activePlans, ...mergePlans].reduce((n, g) => n + g.cancel.filter(item => item.state === 'queued').length, 0);
  return attachPlanVersion({
    ok: true,
    applied: false,
    out_of_band: true,
    apply_requires_plan: true,
    projectId: opts.projectId || null,
    agents: collected.agents,
    allowCrossAgentMerge,
    snapshot: queueSnapshot(root, collected.agents, {}),
    summary: {
      queued_before: beforeQueued,
      paused_before: beforePaused,
      running_seen: collected.running.length,
      planned_groups: activePlans.length + mergePlans.length,
      planned_cancel: cancelCount,
      queued_after_estimate: Math.max(0, beforeQueued - queuedCancelCount),
      terminal_reported: collected.terminal.length,
    },
    groups: [...activePlans, ...mergePlans],
  });
}

function textList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(textList);
  if (typeof value === 'object') return [JSON.stringify(value, null, 2)];
  const s = String(value).trim();
  return s ? [s] : [];
}

function collectRequirementAcceptance(entry) {
  const task = taskObject(entry);
  const requirements = [];
  const acceptance = [];
  if (task) {
    requirements.push(...textList(task.goal || task.message || task.task || task.summary));
    requirements.push(...textList(task.requirements || task.requirement || task.req));
    acceptance.push(...textList(task.acceptance || task.acceptanceCriteria || task.acceptance_criteria || task.criteria || task['验收']));
  } else {
    requirements.push(...textList(entry && entry.task));
  }
  if (entry && entry.acceptance) acceptance.push(...textList(entry.acceptance));
  return {
    requirements: [...new Set(requirements)].map(text => ({ text, hash: integrityHash(text) })),
    acceptance: [...new Set(acceptance)].map(text => ({ text, hash: integrityHash(text) })),
  };
}

function ownSource(entry, item) {
  const ra = collectRequirementAcceptance(entry);
  return {
    agent: item.agent,
    id: item.id,
    state: item.state || entry && entry.status || null,
    requirement_hashes: ra.requirements.map(x => x.hash),
    acceptance_hashes: ra.acceptance.map(x => x.hash),
    requirements: ra.requirements,
    acceptance: ra.acceptance,
  };
}

function existingIntegritySources(entry) {
  const sources = entry && entry.queue_organize && entry.queue_organize.integrity && entry.queue_organize.integrity.sources;
  return Array.isArray(sources) ? sources.filter(Boolean) : [];
}

function sourceItemsForEntry(entry, item) {
  const existing = existingIntegritySources(entry);
  if (existing.length) return existing;
  return [ownSource(entry, item)];
}

function sourceKey(source) {
  return `${source.agent || ''}:${source.id || ''}:${[
    ...(source.requirement_hashes || []),
    ...(source.acceptance_hashes || []),
  ].join(',')}`;
}

function dedupeSources(sources) {
  const out = [];
  const seen = new Set();
  for (const source of sources || []) {
    if (!source || !source.id) continue;
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function renderIntegrityBlock(stamp, group, sources) {
  const lines = [
    '',
    '',
    `Queue organization preserved requirements (${stamp}):`,
    `Group: ${group.label || group.bucket || 'queue merge'}`,
  ];
  for (const source of sources) {
    lines.push(`- Source ${source.agent}/${source.id} (${source.state || 'unknown'})`);
    const reqs = source.requirements && source.requirements.length ? source.requirements : [];
    const accs = source.acceptance && source.acceptance.length ? source.acceptance : [];
    reqs.forEach((item, idx) => {
      lines.push(`  Requirement ${idx + 1} sha1:${item.hash}`);
      lines.push('  <<<REQUIREMENT');
      lines.push(item.text);
      lines.push('  REQUIREMENT');
    });
    accs.forEach((item, idx) => {
      lines.push(`  Acceptance ${idx + 1} sha1:${item.hash}`);
      lines.push('  <<<ACCEPTANCE');
      lines.push(item.text);
      lines.push('  ACCEPTANCE');
    });
    if (!reqs.length && !accs.length) lines.push('  (no structured requirement or acceptance text found)');
  }
  return lines.join('\n');
}

function mergedTaskInlineText(entry) {
  const task = taskObject(entry);
  if (!task) return String(entry && entry.task || '');
  return [
    task.goal,
    task.acceptance,
    task.acceptanceCriteria,
    task.acceptance_criteria,
    task.requirements,
  ].flatMap(textList).join('\n');
}

function verifyMergedIntegrity(entry, sources) {
  const inline = mergedTaskInlineText(entry);
  const normalizedInline = normalizeForHash(inline);
  const missing = [];
  const seen = new Set();
  for (const source of sources || []) {
    for (const item of [...(source.requirements || []), ...(source.acceptance || [])]) {
      if (!item || !item.text) continue;
      const hash = item.hash || integrityHash(item.text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      if (!inline.includes(item.text) && !normalizedInline.includes(normalizeForHash(item.text))) {
        missing.push({ source: `${source.agent}/${source.id}`, hash, text: item.text.slice(0, 120) });
      }
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    requirement_hashes: [...new Set((sources || []).flatMap(source => source.requirement_hashes || []))],
    acceptance_hashes: [...new Set((sources || []).flatMap(source => source.acceptance_hashes || []))],
  };
}

function reviewChecklistFromSources(sources) {
  const out = [];
  for (const source of sources || []) {
    (source.requirements || []).forEach((item, index) => {
      out.push({
        source: `${source.agent}/${source.id}`,
        source_agent: source.agent,
        source_id: source.id,
        kind: 'requirement',
        index: index + 1,
        hash: item.hash,
        text: item.text,
        status: 'pending-review',
      });
    });
    (source.acceptance || []).forEach((item, index) => {
      out.push({
        source: `${source.agent}/${source.id}`,
        source_agent: source.agent,
        source_id: source.id,
        kind: 'acceptance',
        index: index + 1,
        hash: item.hash,
        text: item.text,
        status: 'pending-review',
      });
    });
  }
  const seen = new Set();
  return out.filter(item => {
    const key = `${item.source}:${item.kind}:${item.hash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendMergeNote(root, entry, group, keep, canceledItems, stamp) {
  const merged = canceledItems.map(item => ({
    agent: item.agent,
    id: item.id,
    state: item.state,
    summary: item.summary,
  }));
  entry.queue_organize = entry.queue_organize && typeof entry.queue_organize === 'object'
    ? entry.queue_organize
    : {};
  entry.queue_organize.merged_at = stamp;
  entry.queue_organize.merged_by = group.source || 'queue-organizer';
  entry.queue_organize.bucket = group.bucket;
  entry.queue_organize.label = group.label;
  entry.queue_organize.merged_from = [
    ...(Array.isArray(entry.queue_organize.merged_from) ? entry.queue_organize.merged_from : []),
    ...merged,
  ];

  const lines = merged.map(item => `- ${item.agent}/${item.id}: ${item.summary}`);
  const note = `\n\nQueue organization merge note (${stamp}):\n${lines.join('\n')}`;
  const canceledSources = dedupeSources(canceledItems.flatMap(item => {
    const file = entryFile(root, item);
    const sourceEntry = file ? readJson(file) : null;
    return sourceEntry ? sourceItemsForEntry(sourceEntry, item) : [];
  }));
  const keepSources = dedupeSources([
    ...existingIntegritySources(entry),
    ownSource(entry, keep),
  ]);
  const allSources = dedupeSources([...keepSources, ...canceledSources]);
  const integrityBlock = renderIntegrityBlock(stamp, group, canceledSources);
  const reviewChecklist = reviewChecklistFromSources(canceledSources);
  const task = taskObject(entry);
  if (task) {
    if (!String(task.goal || '').includes(`Queue organization merge note (${stamp})`)) {
      task.goal = `${String(task.goal || '').trim()}${note}${integrityBlock}`;
    }
    task.queueOrganizeMergedFrom = [
      ...(Array.isArray(task.queueOrganizeMergedFrom) ? task.queueOrganizeMergedFrom : []),
      ...merged,
    ];
    task.mergedFrom = [
      ...(Array.isArray(task.mergedFrom) ? task.mergedFrom : []),
      ...merged,
    ];
    task.reviewChecklist = [
      ...(Array.isArray(task.reviewChecklist) ? task.reviewChecklist : []),
      ...reviewChecklist,
    ];
    task.queueOrganizeIntegrity = {
      version: 1,
      source_count: allSources.length,
      requirement_hashes: [...new Set(allSources.flatMap(source => source.requirement_hashes || []))],
      acceptance_hashes: [...new Set(allSources.flatMap(source => source.acceptance_hashes || []))],
    };
  } else {
    entry.task = `${String(entry.task || '').trim()}${note}${integrityBlock}`;
  }
  const verification = verifyMergedIntegrity(entry, canceledSources);
  if (!verification.ok) {
    const err = new Error('queue organize integrity check failed');
    err.code = 'queue_organize_integrity_failed';
    err.missing = verification.missing;
    throw err;
  }
  entry.queue_organize.integrity = {
    version: 1,
    verified_at: stamp,
    status: 'verified',
    source_count: allSources.length,
    requirement_hashes: [...new Set(allSources.flatMap(source => source.requirement_hashes || []))],
    acceptance_hashes: [...new Set(allSources.flatMap(source => source.acceptance_hashes || []))],
    immediate_merged_source_count: canceledSources.length,
    review_checklist_count: reviewChecklist.length,
    sources: allSources,
  };
  entry.queue_organize.review_checklist = [
    ...(Array.isArray(entry.queue_organize.review_checklist) ? entry.queue_organize.review_checklist : []),
    ...reviewChecklist,
  ];
  return entry;
}

function updateCanceledEntry(root, item, group, keep, stamp) {
  const file = path.join(Q.qdir(root, item.agent), 'canceled', `${item.id}.json`);
  const entry = readJson(file);
  if (!entry) return null;
  entry.cancel_reason = `queue-organizer:${group.label}; merged into ${keep.agent}/${keep.id}`;
  entry.canceled_by = group.source || 'queue-organizer';
  entry.merged_into = { agent: keep.agent, id: keep.id, state: keep.state };
  entry.queue_organize = Object.assign({}, entry.queue_organize || {}, {
    merged_at: stamp,
    merged_by: group.source || 'queue-organizer',
    bucket: group.bucket,
    label: group.label,
  });
  writeJsonAtomic(file, entry);
  return entry;
}

function cancelActionable(root, item) {
  const live = entryFile(root, item);
  if (!live) return { ok: false, id: item.id, agent: item.agent, action: 'missing', error: 'entry no longer queued/paused' };
  if (item.state !== 'queued' && item.state !== 'paused') {
    return { ok: false, id: item.id, agent: item.agent, action: 'not_actionable', error: `state ${item.state} is not actionable` };
  }
  const cur = readJson(live);
  if (!cur || cur.id !== item.id || !['queued', 'paused'].includes(cur.status)) {
    return { ok: false, id: item.id, agent: item.agent, action: 'changed', error: 'entry changed before organize apply' };
  }
  const result = Q.cancel(root, item.agent, item.id);
  if (!result || result.status === 'canceling') {
    return { ok: false, id: item.id, agent: item.agent, action: 'not_canceled', error: 'entry was not safely cancelable' };
  }
  return { ok: true, id: item.id, agent: item.agent, action: 'canceled', result };
}

function groupContainsPaused(group) {
  return [group.keep, ...(group.cancel || [])].some(item => item && item.state === 'paused');
}

function isStarlaidScope(opts = {}) {
  return /starlaid/i.test(String(opts.projectId || opts.project || ''));
}

function groupAgentSet(group) {
  const agents = new Set();
  if (group && group.keep && group.keep.agent) agents.add(group.keep.agent);
  for (const item of group && group.cancel || []) {
    if (item && item.agent) agents.add(item.agent);
  }
  return agents;
}

function crossAgentGroups(plan) {
  return (plan && plan.groups || []).filter(group => groupAgentSet(group).size > 1);
}

function starlaidAgentsInPlan(plan) {
  const agents = new Set([
    ...(plan && plan.agents || []),
    ...((plan && plan.snapshot && plan.snapshot.agents) || []),
  ]);
  for (const group of plan && plan.groups || []) {
    for (const agent of groupAgentSet(group)) agents.add(agent);
  }
  return Array.from(agents).filter(agent => /starlaid/i.test(String(agent || '')));
}

function exactSameEntries(entries) {
  const fingerprints = entries.map(exactFingerprint).filter(Boolean);
  return fingerprints.length === entries.length && new Set(fingerprints).size === 1;
}

function sameStructuredKey(entries) {
  const keys = entries.map(structuredMergeKey).filter(Boolean);
  return keys.length === entries.length && new Set(keys).size === 1;
}

function itemEntryForApply(root, item) {
  const file = entryFile(root, item);
  return file ? readJson(file) : null;
}

function safeApplyGroup(root, group, opts = {}) {
  if (opts.allowSimilarityApply === true) return { ok: true, reason: 'operator-allowed-similarity' };
  const refs = [group.keep, ...(group.cancel || [])].filter(Boolean);
  const entries = refs.map(item => itemEntryForApply(root, item)).filter(Boolean);
  if (entries.length !== refs.length) return { ok: false, reason: 'entry-missing' };
  if (sameStructuredKey(entries)) return { ok: true, reason: 'structured-key' };
  if (group.reason === 'exact-text' || String(group.bucket || '').startsWith('exact:')) {
    return exactSameEntries(entries) ? { ok: true, reason: 'exact-text' } : { ok: false, reason: 'exact-text-mismatch' };
  }
  if (group.type === 'active-duplicate' && exactSameEntries(entries)) {
    return { ok: true, reason: 'active-exact-text' };
  }
  return { ok: false, reason: 'similarity-requires-manual-review' };
}

function applyGroup(root, planned, opts, stamp) {
  const group = Object.assign({}, planned, { source: opts.source || 'queue-organizer' });
  const changes = [];
  const skips = [];
  if (group.type !== 'active-duplicate') {
    const keepItem = {
      agent: group.keep.agent,
      id: group.keep.id,
      state: group.keep.state,
    };
    const keepFile = entryFile(root, keepItem);
    const keepEntry = keepFile ? readJson(keepFile) : null;
    if (!keepEntry || !['queued', 'paused'].includes(keepEntry.status)) {
      skips.push({ agent: group.keep.agent, id: group.keep.id, action: 'keep_missing_or_changed' });
      return { group, changes, skips };
    }
    appendMergeNote(root, keepEntry, group, group.keep, group.cancel, stamp);
    writeJsonAtomic(keepFile, keepEntry);
    changes.push({ agent: group.keep.agent, id: group.keep.id, action: 'updated_keep' });
    if (groupContainsPaused(group) && group.keep.state === 'queued') {
      const paused = Q.pause(root, group.keep.agent, group.keep.id);
      if (paused) {
        group.keep = Object.assign({}, group.keep, { state: 'paused' });
        changes.push({ agent: group.keep.agent, id: group.keep.id, action: 'paused_keep' });
      } else {
        skips.push({ agent: group.keep.agent, id: group.keep.id, action: 'pause_keep_failed' });
      }
    }
  }

  for (const item of group.cancel) {
    const canceled = cancelActionable(root, item);
    if (!canceled.ok) {
      skips.push(canceled);
      continue;
    }
    updateCanceledEntry(root, item, group, group.keep, stamp);
    changes.push({ agent: item.agent, id: item.id, action: 'canceled', mergedInto: `${group.keep.agent}/${group.keep.id}` });
  }
  return { group, changes, skips };
}

function parsePlanInput(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); }
    catch (_) { return null; }
  }
  return value && typeof value === 'object' ? value : null;
}

function normalizeApplyPlan(plan) {
  if (!plan || !Array.isArray(plan.groups) || !plan.snapshot) return null;
  const out = Object.assign({}, plan, {
    groups: plan.groups.map(group => Object.assign({}, group, {
      cancel: Array.isArray(group.cancel) ? group.cancel : [],
    })),
  });
  const originalHash = plan.plan_hash || null;
  attachPlanVersion(out);
  if (originalHash && originalHash !== out.plan_hash) {
    out.plan_hash_mismatch = { expected: originalHash, actual: out.plan_hash };
  }
  return out;
}

function currentSnapshotForPlan(root, plan) {
  const snapshot = plan && plan.snapshot || {};
  return queueSnapshot(root, snapshot.agents || plan.agents || [], { states: snapshot.states || ['queued', 'paused', 'running'] });
}

function plannedActionCount(plan) {
  return (plan && plan.groups || []).reduce((count, group) => {
    return count + (Array.isArray(group.cancel) ? group.cancel.length : 0);
  }, 0);
}

function noOpApplyResult(applyPlan) {
  const summary = applyPlan.summary || {};
  return Object.assign({}, applyPlan, {
    ok: true,
    applied: true,
    out_of_band: true,
    no_op: true,
    idempotency_written: false,
    summary: Object.assign({}, summary, {
      changed: 0,
      skipped: 0,
      queued_after: summary.queued_before || 0,
      paused_after: summary.paused_before || 0,
    }),
    groups: [],
    changes: [],
    skips: [],
  });
}

function queueFilesForAgents(root, agents) {
  const out = [];
  for (const agent of [...new Set((agents || []).map(safeAgent).filter(Boolean))]) {
    const base = Q.qdir(root, agent);
    const dirs = [base, ...['running', 'paused', 'done', 'failed', 'canceled'].map(state => path.join(base, state))];
    for (const dir of dirs) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(file => /\.json$/.test(file)); }
      catch (_) { files = []; }
      for (const file of files) out.push(path.join(dir, file));
    }
  }
  return out.sort();
}

function captureQueueState(root, agents) {
  const files = queueFilesForAgents(root, agents);
  const content = new Map();
  for (const file of files) {
    try { content.set(file, fs.readFileSync(file, 'utf8')); }
    catch (_) {}
  }
  return { agents: [...new Set((agents || []).map(safeAgent).filter(Boolean))], content };
}

function restoreQueueState(root, snapshot) {
  const beforeFiles = new Set(snapshot.content.keys());
  for (const file of queueFilesForAgents(root, snapshot.agents)) {
    if (!beforeFiles.has(file)) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
  for (const [file, content] of snapshot.content.entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.rollback`);
    fs.writeFileSync(tmp, content, { flag: 'wx' });
    fs.renameSync(tmp, file);
  }
}

function organize(root, opts = {}) {
  const options = Object.assign({
    includePaused: true,
    mergeIntoActive: true,
    reportTerminal: false,
    apply: false,
    projectId: null,
    source: 'queue-organizer',
  }, opts);
  if (isStarlaidScope(options) && options.apply) {
    return {
      ok: false,
      applied: false,
      status: 403,
      code: 'starlaid_excluded',
      error: 'Starlaid is excluded from queue organize apply',
    };
  }
  const plan = makePlan(root, options);
  if (!options.apply) return plan;
  const applyPlan = normalizeApplyPlan(parsePlanInput(options.plan || options.dryRunPlan || options.expectedPlan));
  if (!applyPlan) {
    return {
      ok: false,
      applied: false,
      status: 409,
      code: 'queue_organize_plan_required',
      error: 'organize apply requires a dry-run plan with queue snapshot; rerun dry-run and apply that plan',
    };
  }
  if (applyPlan.plan_hash_mismatch) {
    return {
      ok: false,
      applied: false,
      status: 409,
      code: 'queue_organize_plan_hash_mismatch',
      error: 'organize plan hash mismatch; rerun dry-run',
      planHash: applyPlan.plan_hash_mismatch,
    };
  }
  const starlaidPlanAgents = starlaidAgentsInPlan(applyPlan);
  if (starlaidPlanAgents.length) {
    return {
      ok: false,
      applied: false,
      status: 403,
      code: 'starlaid_excluded',
      error: 'Starlaid is excluded from queue organize apply',
      agents: starlaidPlanAgents,
    };
  }
  const crossAgent = crossAgentGroups(applyPlan);
  if (crossAgent.length && options.allowCrossAgentMerge !== true) {
    return {
      ok: false,
      applied: false,
      status: 409,
      code: 'cross_agent_merge_requires_opt_in',
      error: 'cross-agent queue organize apply requires allowCrossAgentMerge=true',
      groups: crossAgent.map(group => ({
        bucket: group.bucket,
        agents: Array.from(groupAgentSet(group)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      })),
    };
  }
  const plannedActions = plannedActionCount(applyPlan);
  const idemFile = plannedActions > 0 ? idempotencyFile(root, applyPlan.idempotency_key || applyPlan.plan_hash) : null;
  if (idemFile) {
    const previous = readJson(idemFile);
    if (previous && previous.ok !== false) {
      return Object.assign({}, previous, {
        idempotent_replay: true,
        replayed_at: nowIso(),
      });
    }
  }
  const currentSnapshot = currentSnapshotForPlan(root, applyPlan);
  if (!applyPlan.snapshot || currentSnapshot.hash !== applyPlan.snapshot.hash) {
    return {
      ok: false,
      applied: false,
      status: 409,
      code: 'queue_snapshot_mismatch',
      error: 'queue changed since dry-run; rerun organize dry-run before apply',
      expected_snapshot: {
        hash: applyPlan.snapshot && applyPlan.snapshot.hash,
        id_list_hash: applyPlan.snapshot && applyPlan.snapshot.id_list_hash,
        mtime_hash: applyPlan.snapshot && applyPlan.snapshot.mtime_hash,
      },
      current_snapshot: {
        hash: currentSnapshot.hash,
        id_list_hash: currentSnapshot.id_list_hash,
        mtime_hash: currentSnapshot.mtime_hash,
      },
    };
  }
  if (plannedActions === 0) return noOpApplyResult(applyPlan);
  const stamp = nowIso();
  const appliedGroups = [];
  const changes = [];
  const skips = [];
  const rollback = captureQueueState(root, applyPlan.snapshot.agents || applyPlan.agents || []);
  try {
    for (const group of applyPlan.groups) {
      const safety = safeApplyGroup(root, group, options);
      if (!safety.ok) {
        skips.push({
          agent: group.keep && group.keep.agent,
          id: group.keep && group.keep.id,
          action: 'skipped_unsafe_similarity',
          error: safety.reason,
          group,
        });
        continue;
      }
      const applied = applyGroup(root, group, options, stamp);
      appliedGroups.push(applied.group);
      changes.push(...applied.changes);
      skips.push(...applied.skips);
    }
  } catch (err) {
    restoreQueueState(root, rollback);
    return {
      ok: false,
      applied: false,
      status: 500,
      code: err && err.code || 'queue_organize_apply_failed',
      error: err && err.message || String(err),
      missing: err && err.missing || undefined,
      rolled_back: true,
      plan_hash: applyPlan.plan_hash,
    };
  }
  const after = makePlan(root, Object.assign({}, options, { apply: false }));
  const result = Object.assign({}, applyPlan, {
    ok: true,
    applied: true,
    out_of_band: true,
    applied_at: stamp,
    idempotency_key: applyPlan.idempotency_key,
    plan_hash: applyPlan.plan_hash,
    summary: Object.assign({}, applyPlan.summary, {
      changed: changes.length,
      skipped: skips.length,
      queued_after: after.summary.queued_before,
      paused_after: after.summary.paused_before,
    }),
    groups: appliedGroups,
    changes,
    skips,
  });
  writeJsonAtomic(idemFile, result);
  return result;
}

function findActionableItem(root, agent, id) {
  const queued = queuedFile(root, agent, id);
  if (queued) {
    const entry = readJson(queued);
    if (entry) return { agent, id, state: 'queued', entry, classInfo: classify(entry), ngrams: ngrams(taskText(entry)) };
  }
  const paused = path.join(Q.qdir(root, agent), 'paused', `${id}.json`);
  if (fs.existsSync(paused)) {
    const entry = readJson(paused);
    if (entry) return { agent, id, state: 'paused', entry, classInfo: classify(entry), ngrams: ngrams(taskText(entry)) };
  }
  const running = path.join(Q.qdir(root, agent), 'running', `${id}.json`);
  if (fs.existsSync(running)) return { agent, id, state: 'running', entry: readJson(running) || { id }, classInfo: { label: 'running', bucket: 'running' }, ngrams: new Set() };
  for (const state of TERMINAL_STATES) {
    const file = path.join(Q.qdir(root, agent), state, `${id}.json`);
    if (fs.existsSync(file)) return { agent, id, state, entry: readJson(file) || { id }, classInfo: { label: state, bucket: state }, ngrams: new Set() };
  }
  return null;
}

function makeManualMergePlan(root, opts = {}) {
  const agent = safeAgent(opts.agent || '');
  const keepId = String(opts.keepId || opts.keep || '').trim();
  const rawCancel = opts.cancelIds || opts.cancel || [];
  const cancelList = Array.isArray(rawCancel) ? rawCancel : String(rawCancel || '').split(/[,\s]+/);
  const cancelIds = [...new Set(cancelList.map(id => String(id || '').trim()).filter(Boolean))]
    .filter(id => id !== keepId);
  if (!agent || !keepId || !cancelIds.length) {
    return { ok: false, status: 400, error: 'manual merge requires agent, keepId and cancelIds' };
  }
  if (/starlaid/i.test(agent) || /starlaid/i.test(String(opts.projectId || ''))) {
    return { ok: false, status: 403, code: 'starlaid_excluded', error: 'Starlaid is excluded from queue organize' };
  }
  const keep = findActionableItem(root, agent, keepId);
  const cancel = cancelIds.map(id => findActionableItem(root, agent, id));
  const bad = [
    !keep ? { id: keepId, state: 'missing' } : null,
    ...cancel.map((item, index) => item ? null : { id: cancelIds[index], state: 'missing' }),
  ].filter(Boolean);
  if (bad.length) return { ok: false, status: 404, code: 'queue_item_missing', error: 'manual merge item missing', bad };
  const nonActionable = [keep, ...cancel].filter(item => !['queued', 'paused'].includes(item.state));
  if (nonActionable.length) {
    return { ok: false, status: 409, code: 'queue_item_not_actionable', error: 'manual merge only supports queued/paused items', bad: nonActionable.map(itemRef) };
  }
  const group = {
    type: 'merge',
    reason: 'manual',
    bucket: `manual:${agent}:${keepId}`,
    label: opts.reason || 'manual CEO queue merge',
    keep: itemRef(keep),
    cancel: cancel.map(itemRef),
    note: 'manual CEO out-of-band merge; keep receives preserved requirements and acceptance text',
  };
  const actionable = [keep, ...cancel];
  const beforeQueued = actionable.filter(x => x.state === 'queued').length;
  const beforePaused = actionable.filter(x => x.state === 'paused').length;
  return attachPlanVersion({
    ok: true,
    applied: false,
    out_of_band: true,
    apply_requires_plan: true,
    projectId: opts.projectId || null,
    agents: [agent],
    allowCrossAgentMerge: false,
    snapshot: queueSnapshot(root, [agent], {}),
    summary: {
      queued_before: beforeQueued,
      paused_before: beforePaused,
      running_seen: 0,
      planned_groups: 1,
      planned_cancel: cancel.length,
      queued_after_estimate: Math.max(0, beforeQueued - cancel.filter(x => x.state === 'queued').length),
      terminal_reported: 0,
    },
    groups: [group],
  });
}

function mergeByIds(root, opts = {}) {
  const plan = makeManualMergePlan(root, opts);
  if (!plan.ok) return plan;
  return organize(root, Object.assign({}, opts, {
    apply: true,
    plan,
    source: opts.source || 'ceo-queue-control:merge',
    allowSimilarityApply: true,
  }));
}

module.exports = {
  organize,
  makePlan,
  makeManualMergePlan,
  mergeByIds,
  classify,
  taskText,
  parseAgentList,
};
