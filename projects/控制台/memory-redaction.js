'use strict';

// 记忆候选进入 memory/ 或教训图谱前共用的最小脱敏规则。
// 保持调用方只拿到脱敏文本，避免在审计日志、实体名或 evidence_excerpt 中回显凭据。
const PUBLIC_ACCEPTANCE_SCHEMA_VERSION_RE = /^(?:structured|visual)-acceptance@[0-9]+$/;

function redactSshTarget(target) {
  // 只放行控制台明确公开的验收 schema 数字版本；其他 user@host 形态继续 fail-safe。
  return PUBLIC_ACCEPTANCE_SCHEMA_VERSION_RE.test(target) ? target : '[REDACTED SSH TARGET]';
}

function redactMemoryCandidate(text, max = 4000) {
  return String(text || '')
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\bhttps?:\/\/[^\s'\"]*(?:webhook|hooks?)[^\s'\"]*/ig, '[REDACTED WEBHOOK URL]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|token|secret|signature|sig)=)[^&#\s'\"]+/ig, '$1[REDACTED]')
    .replace(/\b(?:ssh:\/\/)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\b/gi, redactSshTarget)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|cookie|authorization|session|otp|验证码)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(0, max);
}

module.exports = { redactMemoryCandidate };
