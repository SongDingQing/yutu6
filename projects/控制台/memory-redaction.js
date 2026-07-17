'use strict';

// 记忆候选进入 memory/ 或教训图谱前共用的最小脱敏规则。
// 保持调用方只拿到脱敏文本，避免在审计日志、实体名或 evidence_excerpt 中回显凭据。
function redactMemoryCandidate(text, max = 4000) {
  return String(text || '')
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\bhttps?:\/\/[^\s'\"]*(?:webhook|hooks?)[^\s'\"]*/ig, '[REDACTED WEBHOOK URL]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|token|secret|signature|sig)=)[^&#\s'\"]+/ig, '$1[REDACTED]')
    .replace(/\b(?:ssh:\/\/)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\b/gi, '[REDACTED SSH TARGET]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|cookie|authorization|session|otp|验证码)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[REDACTED]')
    .slice(0, max);
}

module.exports = { redactMemoryCandidate };
