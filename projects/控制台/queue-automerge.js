'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Q = require('../../shared/engine/queue');
const QueueOrganizer = require('../../shared/engine/queue-organizer');

function nowIso() {
  return new Date().toISOString();
}

function enabled(opts) {
  if (opts && opts.autoMerge === false) return false;
  return process.env.AUTO_ENQUEUE_MERGE_ENABLED !== '0';
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function safeAgent(agent) {
  const s = String(agent || '');
  return /^[\p{L}\p{N}_-]+$/u.test(s) ? s : '';
}

function projectIdFor(agent, task, opts) {
  if (opts && opts.projectId) return String(opts.projectId);
  if (task && typeof task === 'object' && !Array.isArray(task) && task.projectId) return String(task.projectId);
  const m = String(agent || '').match(/^supervisor-(.+)$/);
  return m ? m[1] : null;
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
  return null;
}

function taskObject(entry) {
  return entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task) ? entry.task : null;
}

function taskText(entry) {
  const task = taskObject(entry);
  if (task) return String(task.goal || task.message || task.task || task.summary || task.idem || '');
  return String(entry && entry.task || '');
}

function normalizeTaskText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function structuredMergeKey(entry) {
  const task = taskObject(entry) || {};
  const key = task.autoMergeKey || task.queueMergeKey || task.idem || entry && (entry.autoMergeKey || entry.queueMergeKey || entry.idem);
  return key ? String(key).trim() : '';
}

function itemEntry(root, item) {
  const file = entryFile(root, item);
  return file ? readJson(file) : null;
}

function sameStructuredKey(entries) {
  const keys = entries.map(structuredMergeKey).filter(Boolean);
  return keys.length === entries.length && new Set(keys).size === 1;
}

function exactSameTaskText(entries) {
  const fps = entries.map(entry => normalizeTaskText(taskText(entry))).filter(Boolean);
  return fps.length === entries.length && new Set(fps).size === 1;
}

function autoActionableGroup(root, group) {
  const refs = [group.keep, ...(group.cancel || [])].filter(Boolean);
  const entries = refs.map(item => itemEntry(root, item)).filter(Boolean);
  if (entries.length !== refs.length) return { ok: false, reason: 'entry-missing' };
  if (sameStructuredKey(entries)) return { ok: true, reason: 'structured-merge-key' };
  if (group.reason === 'exact-text' || String(group.bucket || '').startsWith('exact:')) {
    return exactSameTaskText(entries) ? { ok: true, reason: 'exact-text' } : { ok: false, reason: 'exact-text-mismatch' };
  }
  if (group.type === 'active-duplicate' && exactSameTaskText(entries)) {
    return { ok: true, reason: 'active-exact-text' };
  }
  return { ok: false, reason: 'similarity-requires-manual-review' };
}

function appendMergeNote(entry, group, stamp) {
  const merged = (group.cancel || []).map(item => ({
    agent: item.agent,
    id: item.id,
    state: item.state,
    summary: item.summary,
  }));
  entry.queue_organize = entry.queue_organize && typeof entry.queue_organize === 'object'
    ? entry.queue_organize
    : {};
  entry.queue_organize.merged_at = stamp;
  entry.queue_organize.merged_by = group.source;
  entry.queue_organize.bucket = group.bucket;
  entry.queue_organize.label = group.label;
  entry.queue_organize.merged_from = [
    ...(Array.isArray(entry.queue_organize.merged_from) ? entry.queue_organize.merged_from : []),
    ...merged,
  ];

  const note = [
    '',
    '',
    `Queue auto-merge note (${stamp}):`,
    ...merged.map(item => `- ${item.agent}/${item.id}: ${item.summary}`),
  ].join('\n');
  const task = taskObject(entry);
  if (task) {
    if (!String(task.goal || '').includes(`Queue auto-merge note (${stamp})`)) {
      task.goal = `${String(task.goal || '').trim()}${note}`;
    }
    task.queueOrganizeMergedFrom = [
      ...(Array.isArray(task.queueOrganizeMergedFrom) ? task.queueOrganizeMergedFrom : []),
      ...merged,
    ];
  } else {
    entry.task = `${String(entry.task || '').trim()}${note}`;
  }
}

function updateCanceledEntry(root, item, group, stamp) {
  const file = path.join(Q.qdir(root, item.agent), 'canceled', `${item.id}.json`);
  const entry = readJson(file);
  if (!entry) return null;
  entry.cancel_reason = `auto-enqueue-merge:${group.label}; merged into ${group.keep.agent}/${group.keep.id}`;
  entry.canceled_by = group.source;
  entry.merged_into = { agent: group.keep.agent, id: group.keep.id, state: group.keep.state };
  entry.queue_organize = Object.assign({}, entry.queue_organize || {}, {
    merged_at: stamp,
    merged_by: group.source,
    bucket: group.bucket,
    label: group.label,
  });
  writeJsonAtomic(file, entry);
  return entry;
}

function touches(group, agent, id) {
  const key = `${agent}:${id}`;
  if (group.keep && `${group.keep.agent}:${group.keep.id}` === key) return true;
  return (group.cancel || []).some(item => `${item.agent}:${item.id}` === key);
}

function applyPlannedGroup(root, group, stamp) {
  const source = group.source || 'auto-enqueue-merge';
  const applied = Object.assign({}, group, { source });
  const changes = [];
  const skips = [];

  if (applied.type !== 'active-duplicate') {
    const keepFile = entryFile(root, applied.keep);
    const keepEntry = keepFile ? readJson(keepFile) : null;
    if (!keepEntry || !['queued', 'paused'].includes(keepEntry.status)) {
      return {
        group: applied,
        changes,
        skips: [{ agent: applied.keep.agent, id: applied.keep.id, action: 'keep_missing_or_changed' }],
      };
    }
    appendMergeNote(keepEntry, applied, stamp);
    writeJsonAtomic(keepFile, keepEntry);
    changes.push({ agent: applied.keep.agent, id: applied.keep.id, action: 'updated_keep' });
  }

  for (const item of applied.cancel || []) {
    const before = entryFile(root, item);
    if (!before || !['queued', 'paused'].includes(item.state)) {
      skips.push({ agent: item.agent, id: item.id, action: 'not_actionable', state: item.state });
      continue;
    }
    const canceled = Q.cancel(root, item.agent, item.id);
    if (!canceled || canceled.status === 'canceling') {
      skips.push({ agent: item.agent, id: item.id, action: 'not_canceled' });
      continue;
    }
    updateCanceledEntry(root, item, applied, stamp);
    changes.push({ agent: item.agent, id: item.id, action: 'canceled', mergedInto: `${applied.keep.agent}/${applied.keep.id}` });
  }

  return { group: applied, changes, skips };
}

function emit(eventlog, type, data) {
  try {
    if (eventlog && typeof eventlog.emit === 'function') eventlog.emit(type, data);
  } catch (_) {}
}

function autoMergeAfterEnqueue(root, agent, entry, opts = {}) {
  if (!enabled(opts)) return { applied: false, reason: 'disabled' };
  if (!safeAgent(agent) || /starlaid/i.test(agent)) return { applied: false, reason: 'excluded-agent' };

  const projectId = projectIdFor(agent, entry && entry.task, opts);
  if (/starlaid/i.test(String(projectId || ''))) return { applied: false, reason: 'excluded-project' };

  const plan = QueueOrganizer.makePlan(root, {
    agents: [agent],
    includePaused: true,
    mergeIntoActive: true,
    apply: false,
    projectId,
    source: opts.source || 'auto-enqueue-merge',
  });
  const groups = (plan.groups || [])
    .filter(group => touches(group, agent, entry.id))
    .map(group => Object.assign({}, group, { source: opts.source || 'auto-enqueue-merge' }));
  if (!groups.length) return { applied: false, reason: 'no-duplicate', plannedGroups: plan.summary && plan.summary.planned_groups || 0 };
  const safety = groups.map(group => ({ group, safety: autoActionableGroup(root, group) }));
  const actionableGroups = safety
    .filter(item => item.safety.ok)
    .map(item => Object.assign({}, item.group, { autoMergeSafety: item.safety.reason }));
  const unsafeGroups = safety
    .filter(item => !item.safety.ok)
    .map(item => ({
      type: item.group.type,
      reason: item.group.reason,
      bucket: item.group.bucket,
      label: item.group.label,
      safetyReason: item.safety.reason,
      keep: item.group.keep,
      cancel: item.group.cancel,
    }));
  if (!actionableGroups.length) {
    emit(opts.eventlog, 'queue.auto_merge_skipped', {
      queueAgent: agent,
      queueId: entry.id,
      projectId,
      groupCount: groups.length,
      changed: 0,
      skipped: unsafeGroups.length,
      groups: unsafeGroups,
      reason: 'similarity-requires-manual-review',
    });
    return {
      applied: false,
      reason: 'similarity-requires-manual-review',
      projectId,
      groups: unsafeGroups,
      plannedGroups: plan.summary && plan.summary.planned_groups || 0,
    };
  }

  const stamp = nowIso();
  const appliedGroups = [];
  const changes = [];
  const skips = [];
  for (const group of actionableGroups) {
    const applied = applyPlannedGroup(root, group, stamp);
    appliedGroups.push(applied.group);
    changes.push(...applied.changes);
    skips.push(...applied.skips);
  }
  const result = {
    applied: changes.length > 0,
    applied_at: stamp,
    projectId,
    groups: appliedGroups,
    changes,
    skips: skips.concat(unsafeGroups.map(group => ({ action: 'skipped_unsafe_similarity', group }))),
  };
  emit(opts.eventlog, result.applied ? 'queue.auto_merged' : 'queue.auto_merge_skipped', {
    queueAgent: agent,
    queueId: entry.id,
    projectId,
    groupCount: appliedGroups.length,
    changed: changes.length,
    skipped: result.skips.length,
    groups: appliedGroups.map(group => ({
      type: group.type,
      reason: group.reason,
      label: group.label,
      keep: group.keep,
      cancel: group.cancel,
    })),
  });
  return result;
}

function enqueue(root, agent, task, opts = {}) {
  const entry = Q.enqueue(root, agent, task, opts);
  entry.autoMerge = autoMergeAfterEnqueue(root, agent, entry, opts);
  return entry;
}

module.exports = {
  enqueue,
  autoMergeAfterEnqueue,
  _test: {
    enabled,
    projectIdFor,
    touches,
  },
};
