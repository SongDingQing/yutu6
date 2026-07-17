'use strict';

class AuditPulseLimiter {
  constructor(options = {}) {
    this.intervalMs = Math.max(1000, Number(options.intervalMs) || 60000);
    this.maxKeys = Math.max(100, Number(options.maxKeys) || 5000);
    this.state = new Map();
  }

  shouldEmit(key, signature, now = Date.now()) {
    const normalizedKey = String(key || 'default');
    const normalizedSignature = String(signature || '');
    const previous = this.state.get(normalizedKey);
    const due = !previous
      || previous.signature !== normalizedSignature
      || Number(now) - previous.emittedAt >= this.intervalMs;
    if (!due) return false;
    this.state.set(normalizedKey, { signature: normalizedSignature, emittedAt: Number(now) });
    if (this.state.size > this.maxKeys) {
      const oldest = [...this.state.entries()]
        .sort((a, b) => a[1].emittedAt - b[1].emittedAt)
        .slice(0, this.state.size - this.maxKeys);
      for (const [oldKey] of oldest) this.state.delete(oldKey);
    }
    return true;
  }

  forget(key) {
    this.state.delete(String(key || 'default'));
  }
}

module.exports = { AuditPulseLimiter };
