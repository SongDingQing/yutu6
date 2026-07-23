'use strict';

const fs = require('fs');
const path = require('path');

const TEXT_ARTIFACT_EXTENSIONS = new Set(['.md', '.txt', '.log', '.json']);
const IMAGE_ARTIFACT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const BLOCKED_ARTIFACT_NAME = /(^|[._-])(prompt|interaction-trace|request|response|raw|secret|token|cookie|auth|private|credential|key)([._-]|$)|^\.env/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const MAX_TEXT_LENGTH = 6000;

function redactSensitive(value) {
  return String(value == null ? '' : value)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|cookie|authorization)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]')
    .replace(/\b(?:sk|ma_live|cli)_[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
}

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (value != null) {
    try { text = JSON.stringify(value, null, 2); }
    catch (_) { text = String(value); }
  }
  text = redactSensitive(text).trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function taskObject(entry) {
  return entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)
    ? entry.task
    : {};
}

function taskText(entry, field, fallback = '') {
  const task = taskObject(entry);
  if (task[field] != null) return safeText(task[field]);
  if (entry && entry[field] != null) return safeText(entry[field]);
  return safeText(fallback);
}

function taskIdCandidates(entry, explicitTaskId) {
  const task = taskObject(entry);
  return [...new Set([
    explicitTaskId,
    entry && entry.taskId,
    entry && entry.rootTaskId,
    entry && entry.parentTaskId,
    task.taskId,
    task.rootTaskId,
    task.parentTaskId,
  ].map(value => String(value || '').trim()).filter(value => SAFE_IDENTIFIER.test(value)))];
}

function relatedEvents(events, options = {}) {
  const agent = String(options.agent || '');
  const queueId = String(options.queueId || '');
  const ids = new Set((options.taskIds || []).filter(Boolean));
  const source = Array.isArray(events) ? events : [];
  for (const event of source) {
    if (!event || typeof event !== 'object') continue;
    const queueMatch = queueId && (
      String(event.queueId || '') === queueId
      || String(event.rootQueueId || '') === queueId
      || String(event.downstreamQueueId || '') === queueId
    );
    const agentMatch = !agent || [
      event.queueAgent,
      event.rootQueueAgent,
      event.downstreamQueueAgent,
      event.supervisorQueue,
    ].some(value => String(value || '') === agent);
    if (queueMatch && agentMatch) {
      for (const key of ['task', 'taskId', 'rootTaskId', 'sourceTask', 'parentTaskId']) {
        const value = String(event[key] || '');
        if (SAFE_IDENTIFIER.test(value)) ids.add(value);
      }
    }
  }
  const matched = source.filter(event => {
    if (!event || typeof event !== 'object') return false;
    const eventIds = ['task', 'taskId', 'rootTaskId', 'sourceTask', 'parentTaskId']
      .map(key => String(event[key] || ''))
      .filter(Boolean);
    if (eventIds.some(id => ids.has(id))) return true;
    const queueMatch = queueId && (
      String(event.queueId || '') === queueId
      || String(event.rootQueueId || '') === queueId
      || String(event.downstreamQueueId || '') === queueId
    );
    if (!queueMatch) return false;
    return !agent || [
      event.queueAgent,
      event.rootQueueAgent,
      event.downstreamQueueAgent,
      event.supervisorQueue,
    ].some(value => String(value || '') === agent);
  });
  return {
    taskIds: [...ids],
    events: matched.slice(-160).map(summarizeEvent),
  };
}

function summarizeEvent(event) {
  const type = safeText(event.type || 'event', 100);
  const role = safeText(event.role || event.queueAgent || '', 100);
  const node = safeText(event.node || event.to || event.from || '', 100);
  const reason = safeText(event.reason || event.error || '', 500);
  const status = safeText(event.status || event.state || event.outcome || event.decision || '', 80);
  const subject = [role, node].filter(Boolean).join(' · ');
  let summary = subject ? `${subject} · ${type}` : type;
  if (status) summary += ` · ${status}`;
  if (reason) summary += ` · ${reason}`;
  return {
    seq: Number(event.seq || 0),
    ts: safeText(event.ts || '', 60),
    type,
    taskId: safeText(event.task || event.taskId || '', 120),
    node,
    role,
    runner: safeText(event.runner || '', 100),
    model: safeText(event.model || '', 120),
    provider: safeText(event.provider || '', 120),
    status,
    reason,
    summary: safeText(summary, 700),
    durationMs: finiteOrNull(event.duration_ms != null ? event.duration_ms : event.durationMs),
    inputTokens: finiteOrNull(event.input_tokens != null ? event.input_tokens : event.inputTokens),
    outputTokens: finiteOrNull(event.output_tokens != null ? event.output_tokens : event.outputTokens),
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function runnerMeta(entry, cfg) {
  const task = taskObject(entry);
  const role = String(entry && entry.role || task.role || '');
  const route = cfg && cfg.roleRouting && cfg.roleRouting[role] || {};
  const runner = String(entry && entry.runner || task.runner || route.runner || '');
  const definition = cfg && cfg.runners && cfg.runners[runner] || {};
  return {
    role: safeText(role, 100),
    runner: safeText(runner, 100),
    model: safeText(entry && entry.model || task.model || route.model || definition.model || '', 160),
    provider: safeText(entry && entry.provider || task.provider || definition.provider || definition.type || '', 160),
  };
}

function buildTaskDetail(options) {
  const entry = options.entry || {};
  const related = relatedEvents(options.events, {
    agent: options.agent,
    queueId: options.queueId,
    taskIds: taskIdCandidates(entry, options.taskId),
  });
  const meta = runnerMeta(entry, options.cfg || {});
  const latest = related.events[related.events.length - 1] || null;
  const goal = taskText(entry, 'goal', typeof entry.task === 'string' ? entry.task : '');
  const acceptance = taskText(entry, 'acceptance');
  const reason = safeText(entry.reason || entry.error || entry.last_engine_error || latest && latest.reason || '', 1200);
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments
    : Array.isArray(taskObject(entry).attachments)
      ? taskObject(entry).attachments
      : [];
  return {
    schemaVersion: 1,
    ok: true,
    task: {
      id: safeText(options.queueId || entry.id || related.taskIds[0] || '', 120),
      taskId: safeText(related.taskIds[0] || '', 120),
      relatedTaskIds: related.taskIds,
      agent: safeText(options.agent || entry.target || '', 100),
      role: meta.role,
      status: safeText(entry.status || options.status || 'unknown', 80),
      goal,
      acceptance,
      runner: meta.runner,
      model: meta.model,
      provider: meta.provider,
      retryCount: Math.max(
        0,
        Number(entry.run_attempt || 0),
        Number(entry.nodeRetry || 0),
        Number(entry.engineRetry || 0),
      ),
      reason,
      timestamps: {
        enqueuedAt: safeText(entry.enqueued_at || '', 60),
        startedAt: safeText(entry.engine_started_at || entry.started_at || '', 60),
        updatedAt: safeText(entry.updated_at || entry.progress_at || '', 60),
        finishedAt: safeText(entry.finished_at || '', 60),
      },
      currentStep: latest,
      events: related.events,
      attachments: attachments.slice(0, 6).map(item => ({
        id: safeText(item && item.id || '', 120),
        name: safeText(item && item.name || '', 240),
        mime: safeText(item && (item.mime || item.type) || '', 100),
        size: finiteOrNull(item && item.size),
      })),
    },
  };
}

function isInside(child, root) {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveArtifactPath(workdir, allowedRoots, relativePath) {
  const raw = String(relativePath || '').trim();
  if (!raw || path.isAbsolute(raw) || raw.includes('\0')) return null;
  const absolute = path.resolve(workdir, raw);
  const roots = allowedRoots.map(root => path.resolve(root));
  if (!roots.some(root => isInside(absolute, root))) return null;
  const base = path.basename(absolute);
  const ext = path.extname(base).toLowerCase();
  if (BLOCKED_ARTIFACT_NAME.test(base)) return null;
  if (!TEXT_ARTIFACT_EXTENSIONS.has(ext) && !IMAGE_ARTIFACT_EXTENSIONS.has(ext)) return null;
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { return null; }
  if (!stat.isFile()) return null;
  return absolute;
}

function listTaskArtifacts(options) {
  const workdir = path.resolve(options.workdir);
  const engineRuns = path.resolve(options.engineRuns);
  const maxItems = Math.max(1, Math.min(Number(options.maxItems || 80), 120));
  const out = [];
  const seen = new Set();
  for (const taskId of options.taskIds || []) {
    if (!SAFE_IDENTIFIER.test(String(taskId || ''))) continue;
    const root = path.join(engineRuns, taskId);
    if (!isInside(root, engineRuns)) continue;
    walk(root, 0);
    if (out.length >= maxItems) break;
  }
  return out;

  function walk(directory, depth) {
    if (depth > 2 || out.length >= maxItems) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= maxItems) break;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || BLOCKED_ARTIFACT_NAME.test(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_ARTIFACT_EXTENSIONS.has(ext) && !IMAGE_ARTIFACT_EXTENSIONS.has(ext)) continue;
      const relative = path.relative(workdir, absolute).split(path.sep).join('/');
      if (seen.has(relative)) continue;
      let stat;
      try { stat = fs.statSync(absolute); } catch (_) { continue; }
      seen.add(relative);
      out.push({
        name: entry.name,
        path: relative,
        kind: IMAGE_ARTIFACT_EXTENSIONS.has(ext) ? 'image' : 'text',
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        url: `/api/task-artifact?path=${encodeURIComponent(relative)}`,
      });
    }
  }
}

module.exports = {
  BLOCKED_ARTIFACT_NAME,
  TEXT_ARTIFACT_EXTENSIONS,
  IMAGE_ARTIFACT_EXTENSIONS,
  redactSensitive,
  safeText,
  relatedEvents,
  summarizeEvent,
  buildTaskDetail,
  resolveArtifactPath,
  listTaskArtifacts,
};
