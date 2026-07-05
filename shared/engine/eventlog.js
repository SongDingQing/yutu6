'use strict';
/*
 * eventlog:append-only 事件日志(JSONL)+ 单调 seq + cursor 增量读。
 * 蓝图 §10(审计/恢复)、§18.6(pub/sub 源)。展示层订阅这条流即同步,不动引擎。
 */
const fs = require('fs');
const path = require('path');

class EventLog {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
    this.seq = 0;
    this.lastSize = 0;
    // 轮转:按大小封顶(默认 64MB)+ 保留 N 份归档,治"engine-events.jsonl 无限增长"(架构审核 P0-2)
    this.maxBytes = Math.max(0, parseInt(process.env.EVENTLOG_MAX_BYTES || '', 10) || 64 * 1024 * 1024);
    this.keepArchives = Math.max(1, parseInt(process.env.EVENTLOG_KEEP_ARCHIVES || '', 10) || 6);
    this._refreshLastSeq();
    this.subs = [];
  }
  _readTail(bytes) {
    const st = fs.statSync(this.file);
    if (!st.size) return { text: '', start: 0, size: 0 };
    const len = Math.min(st.size, Math.max(1024, Number(bytes) || 0));
    const start = st.size - len;
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, start);
      return { text: buf.slice(0, n).toString('utf8'), start, size: st.size };
    } finally {
      fs.closeSync(fd);
    }
  }
  _lastSeq() {
    try {
      const st = fs.statSync(this.file);
      if (!st.size) return 0;
      for (const bytes of [256 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
        const tail = this._readTail(bytes);
        let lines = tail.text.split('\n').filter(Boolean);
        if (tail.start > 0) lines = lines.slice(1);
        for (let i = lines.length - 1; i >= 0; i--) {
          let ev; try { ev = JSON.parse(lines[i]); } catch (_) { continue; }
          const seq = Number(ev && ev.seq) || 0;
          if (seq) return seq;
        }
        if (tail.start === 0) break;
      }
      return 0;
    } catch (_) { return 0; }
  }
  _refreshLastSeq() {
    try {
      const st = fs.statSync(this.file);
      if (st.size !== this.lastSize) {
        this.seq = Math.max(this.seq, this._lastSeq());
        this.lastSize = st.size;
      }
    } catch (_) {}
    return this.seq;
  }
  emit(type, data = {}) {
    this._refreshLastSeq();
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), type, ...data };
    const line = JSON.stringify(ev) + '\n';
    fs.appendFileSync(this.file, line);
    this.lastSize += Buffer.byteLength(line);
    this._maybeRotate();
    for (const fn of this.subs) { try { fn(ev); } catch (_) {} }
    return ev;
  }
  subscribe(fn) { this.subs.push(fn); }
  _maybeRotate() {
    if (!this.maxBytes || this.lastSize < this.maxBytes) return;
    try {
      const st = fs.statSync(this.file);
      if (st.size < this.maxBytes) { this.lastSize = st.size; return; } // 别的进程已轮转
      const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
      const archived = this.file.replace(/\.jsonl$/i, '') + `.${stamp}-${process.pid}.jsonl`;
      fs.renameSync(this.file, archived);
      fs.writeFileSync(this.file, '');
      this.lastSize = 0;
      this._pruneArchives();
    } catch (_) {
      try { this.lastSize = fs.statSync(this.file).size; } catch (_) {}
    }
  }
  _pruneArchives() {
    try {
      const dir = path.dirname(this.file);
      const base = path.basename(this.file).replace(/\.jsonl$/i, '');
      const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.[0-9-]+\\.jsonl$');
      const archives = fs.readdirSync(dir).filter(f => re.test(f))
        .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
      for (const old of archives.slice(this.keepArchives)) { try { fs.unlinkSync(path.join(dir, old.f)); } catch (_) {} }
    } catch (_) {}
  }
  // cursor 增量:返回 seq > afterSeq 的事件(坏行容错,不因单条坏行抛)
  since(afterSeq = 0) {
    const out = [];
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (_) { return out; }
    for (const l of text.trim().split('\n').filter(Boolean)) {
      let ev; try { ev = JSON.parse(l); } catch (_) { continue; }
      if (ev && ev.seq > afterSeq) out.push(ev);
    }
    return out;
  }
}
module.exports = EventLog;
