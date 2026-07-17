'use strict';
/*
 * taskstore:任务状态机 + attempt(蓝图 §10)。
 * 状态:queued → running → awaiting_verify → done | failed | paused | awaiting_human
 * 任务与「运行尝试 attempt」分离:重试/换 runner/兜底各算一次 attempt,失败原因挂 attempt。
 * 单写:一个任务记录一个 JSON 文件,只由引擎写。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATES = ['queued', 'running', 'awaiting_human', 'awaiting_verify', 'done', 'failed', 'paused', 'canceled'];
const TERMINAL_STATES = new Set(['done', 'failed', 'canceled']);

function fsyncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
    // Directory fsync is best-effort across platforms; the temp-file rename is still atomic.
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    fsyncDir(dir);
  } catch (err) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

class TaskStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  _file(id) { return path.join(this.dir, id + '.json'); }
  exists(id) { return fs.existsSync(this._file(id)); }
  create(id, flow, vars = {}) {
    const t = { id, flow, state: 'queued', node: null, attempt: 0, loop: 0,
      vars, evidence: [], cursor: null, visits: {}, steps: {}, completed_steps: [],
      last_completed_node: null, created: new Date().toISOString(), updated: null, history: [] };
    this._write(t); return t;
  }
  get(id) { return this._normalize(JSON.parse(fs.readFileSync(this._file(id), 'utf8'))); }
  start(id, flow, vars = {}) {
    if (!this.exists(id)) {
      const created = this.create(id, flow, vars);
      Object.defineProperty(created, '_resumed', { value: false, enumerable: false });
      return created;
    }
    const t = this.get(id);
    t.flow = t.flow || flow;
    t.vars = Object.assign({}, vars || {}, t.vars || {});
    if (!TERMINAL_STATES.has(t.state)) {
      t.history.push({ at: new Date().toISOString(), from: t.state, to: 'running', node: t.node, resume: true });
      t.state = 'running';
    }
    this._write(t);
    Object.defineProperty(t, '_resumed', { value: true, enumerable: false });
    return t;
  }
  _normalize(t) {
    t.vars = t.vars && typeof t.vars === 'object' ? t.vars : {};
    t.evidence = Array.isArray(t.evidence) ? t.evidence : [];
    t.history = Array.isArray(t.history) ? t.history : [];
    t.steps = t.steps && typeof t.steps === 'object' ? t.steps : {};
    t.completed_steps = Array.isArray(t.completed_steps) ? t.completed_steps : Object.keys(t.steps || {});
    t.visits = t.visits && typeof t.visits === 'object' ? t.visits : {};
    if (!('cursor' in t)) t.cursor = null;
    if (!('last_completed_node' in t)) t.last_completed_node = null;
    if (!('completed_pending_edge' in t)) t.completed_pending_edge = null;
    return t;
  }
  _write(t) {
    this._normalize(t);
    t.updated = new Date().toISOString();
    const out = Object.assign({}, t);
    delete out._resumed;
    writeFileAtomic(this._file(t.id), JSON.stringify(out, null, 2));
  }
  setState(t, state) {
    if (!STATES.includes(state)) throw new Error('未知状态: ' + state);
    t.history.push({ at: new Date().toISOString(), from: t.state, to: state, node: t.node });
    t.state = state; this._write(t); return t;
  }
  update(t, patch) { Object.assign(t, patch); this._write(t); return t; }
  step(t, key) {
    this._normalize(t);
    return t.steps[key] || null;
  }
  recordStep(t, key, node, result = {}) {
    this._normalize(t);
    const rec = {
      key,
      node: node && node.id || node || null,
      status: result.status || 'done',
      attempt: result.attempt || null,
      vars: result.vars && typeof result.vars === 'object' ? result.vars : {},
      evidence: result.evidence || null,
      completed_at: new Date().toISOString(),
    };
    t.steps[key] = rec;
    if (!t.completed_steps.includes(key)) t.completed_steps.push(key);
    t.last_completed_node = rec.node;
    this._write(t);
    return rec;
  }
  list(state = null) {
    const files = fs.readdirSync(this.dir).filter(f => /\.json$/.test(f));
    return files.map(f => {
      try { return this.get(f.replace(/\.json$/, '')); } catch (_) { return null; }
    }).filter(t => t && (!state || t.state === state));
  }
  sweepStaleRunning(opts = {}) {
    const staleMs = Number(opts.staleMs || opts.stale_ms || 0);
    if (!staleMs) return [];
    const now = opts.now != null ? Number(opts.now) : Date.now();
    const out = [];
    for (const t of this.list('running')) {
      const updated = Date.parse(t.updated || t.created || '');
      const ageMs = updated ? now - updated : Infinity;
      if (ageMs <= staleMs) continue;
      if (typeof opts.isLeaseFresh === 'function' && opts.isLeaseFresh(t)) continue;
      const reason = opts.reason || `taskstore running state stale after ${Math.max(0, Math.round((ageMs || 0) / 1000))}s`;
      t.recovered_reason = reason;
      t.recovered_at = new Date(now).toISOString();
      t.history.push({ at: t.recovered_at, from: t.state, to: 'paused', node: t.node, reason });
      t.state = 'paused';
      this._write(t);
      out.push({ id: t.id, state: t.state, reason, ageMs, task: t });
    }
    return out;
  }
}
module.exports = { TaskStore, STATES, TERMINAL_STATES };
