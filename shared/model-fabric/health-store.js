'use strict';

const fs = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

class HealthStore {
  constructor(file, policy = {}) {
    this.file = file;
    this.failureThreshold = Math.max(1, Number(policy.failure_threshold || 3));
    this.cooldownMs = Math.max(1000, Number(policy.cooldown_ms || 90000));
    this.state = this.read();
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  save() {
    atomicWrite(this.file, this.state);
  }

  provider(id) {
    return this.state[id] || {
      state: 'unknown',
      consecutive_failures: 0,
      last_checked_at: null,
      last_success_at: null,
      last_failure_at: null,
      cooldown_until: null,
      latency_ms: null,
      reason: null,
    };
  }

  isAvailable(id, at = Date.now()) {
    const current = this.provider(id);
    const cooldownUntil = Date.parse(current.cooldown_until || '');
    return !Number.isFinite(cooldownUntil) || cooldownUntil <= at;
  }

  success(id, latencyMs) {
    const previous = this.provider(id);
    this.state[id] = {
      ...previous,
      state: 'healthy',
      consecutive_failures: 0,
      last_checked_at: nowIso(),
      last_success_at: nowIso(),
      cooldown_until: null,
      latency_ms: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      reason: null,
    };
    this.save();
    return this.state[id];
  }

  failure(id, reason, latencyMs) {
    const previous = this.provider(id);
    const failures = Number(previous.consecutive_failures || 0) + 1;
    const tripped = failures >= this.failureThreshold;
    this.state[id] = {
      ...previous,
      state: tripped ? 'cooldown' : 'degraded',
      consecutive_failures: failures,
      last_checked_at: nowIso(),
      last_failure_at: nowIso(),
      cooldown_until: tripped ? new Date(Date.now() + this.cooldownMs).toISOString() : null,
      latency_ms: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      reason: String(reason || 'provider_failure').slice(0, 160),
    };
    this.save();
    return this.state[id];
  }

  snapshot(providerIds = []) {
    return Object.fromEntries(providerIds.map(id => [id, this.provider(id)]));
  }
}

module.exports = { HealthStore, atomicWrite };
