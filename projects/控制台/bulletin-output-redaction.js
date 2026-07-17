'use strict';

const SENSITIVE_KEY_RE = /(?:secret|token|password|cookie|authorization|private[_-]?key|api[_-]?key)/i;
const INLINE_SECRET_RE = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[=:]\s*)[^\s,'"}]+/ig;
const URL_TOKEN_RE = /([?&](?:t|token|access_token|refresh_token)=)[^&#\s]+/ig;

function sanitizeString(value) {
  return String(value)
    .replace(URL_TOKEN_RE, '$1[REDACTED]')
    .replace(INLINE_SECRET_RE, '$1[REDACTED]');
}

function sanitize(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeString(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.map(item => sanitize(item, seen));
    seen.delete(value);
    return out;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    out[key] = sanitize(item, seen);
  }
  seen.delete(value);
  return out;
}

module.exports = {
  sanitize,
  sanitizeString,
  _test: { SENSITIVE_KEY_RE },
};
