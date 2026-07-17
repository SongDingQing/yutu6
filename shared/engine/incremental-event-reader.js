'use strict';

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

class IncrementalEventReader {
  constructor(file, options = {}) {
    this.file = file;
    this.include = typeof options.include === 'function' ? options.include : (() => true);
    this.retain = Math.max(100, Number(options.retain) || 20000);
    this.chunkBytes = Math.max(4096, Number(options.chunkBytes) || 1024 * 1024);
    this.identity = null;
    this.offset = 0;
    this.fragment = '';
    this.decoder = new StringDecoder('utf8');
    this.events = [];
    this.maxSeq = 0;
    this.metrics = { bytesRead: 0, resets: 0, parsedLines: 0 };
  }

  reset(identity = null) {
    this.identity = identity;
    this.offset = 0;
    this.fragment = '';
    this.decoder = new StringDecoder('utf8');
    this.events = [];
    this.maxSeq = 0;
    this.metrics.resets += 1;
  }

  parseText(text) {
    const parts = (this.fragment + text).split('\n');
    this.fragment = parts.pop() || '';
    for (const line of parts) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }
      this.metrics.parsedLines += 1;
      const seq = Number(event && event.seq) || 0;
      if (seq > this.maxSeq) this.maxSeq = seq;
      if (this.include(event)) this.events.push(event);
    }
    if (this.events.length > this.retain) {
      this.events.splice(0, this.events.length - this.retain);
    }
  }

  refresh() {
    let stat;
    try { stat = fs.statSync(this.file); } catch (_) { return this.snapshot(); }
    const identity = `${stat.dev}:${stat.ino}`;
    if (this.identity !== identity || stat.size < this.offset) this.reset(identity);
    if (stat.size <= this.offset) return this.snapshot();

    const fd = fs.openSync(this.file, 'r');
    try {
      const target = stat.size;
      while (this.offset < target) {
        const length = Math.min(this.chunkBytes, target - this.offset);
        const buffer = Buffer.allocUnsafe(length);
        const read = fs.readSync(fd, buffer, 0, length, this.offset);
        if (!read) break;
        this.offset += read;
        this.metrics.bytesRead += read;
        this.parseText(this.decoder.write(buffer.subarray(0, read)));
      }
    } finally {
      fs.closeSync(fd);
    }
    return this.snapshot();
  }

  currentSeq() {
    this.refresh();
    return this.maxSeq;
  }

  since(afterSeq = 0) {
    this.refresh();
    const cursor = Number(afterSeq) || 0;
    return {
      events: this.events.filter(event => (Number(event && event.seq) || 0) > cursor),
      maxSeq: this.maxSeq,
    };
  }

  matching(predicate) {
    this.refresh();
    if (typeof predicate !== 'function') return this.events.slice();
    return this.events.filter(predicate);
  }

  snapshot() {
    return {
      maxSeq: this.maxSeq,
      retained: this.events.length,
      offset: this.offset,
      metrics: Object.assign({}, this.metrics),
    };
  }
}

module.exports = { IncrementalEventReader };
