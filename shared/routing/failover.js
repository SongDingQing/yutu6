'use strict';

// runner failover 支撑:把 model-routing.yaml 的 roles.*.prefer 候选链,落成可执行的 runnerId 降级序列。
// 设计要点(低风险):当前 roleMap 选的 runner 仍是【首选、行为不变】;prefer 解析出的候选只在【首选失败后】降级。
// yaml-lite 不解析嵌套 map/inline 数组,故这里对 prefer 行做定向扫描,不改动 yaml-lite(影响面太大)。

const fs = require('fs');
const path = require('path');

const DEFAULT_ROUTING_FILE = path.resolve(__dirname, 'model-routing.yaml');

// prefer token 的 "provider.sub" → config.json runnerId。
// 来源:model-routing.yaml providers 段(via/env)。无对应本地 runner 的置 null(降级时跳过)。
const PROVIDER_RUNNER = {
  'subscription.claude': 'claude', // 2026-07-03 复活:秘书/维修主管由 Claude Code 接管(06-30 的 401 已恢复)
  'subscription.codex': 'codex',
  'api.zhipu': 'zhipu-glm',
  'api.deepseek': 'new-api',
  'api.kimi': 'kimi-k2',
  'api.openai': null,     // 无独立 openai runner → 跳过
  'api.anthropic': null,  // deprecated:不再作为自动降级候选
  'local.ollama': null,   // 无本地 ollama runner → 跳过
};

// token 形如 "subscription.codex" 或 "api.zhipu.glm-5.2";按前两段定 provider.sub。
function preferTokenToRunnerId(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length < 2) return null;
  const key = parts[0] + '.' + parts[1];
  return Object.prototype.hasOwnProperty.call(PROVIDER_RUNNER, key) ? PROVIDER_RUNNER[key] : null;
}

// 从 model-routing.yaml 文本抽每个 role 的 prefer 顺序(定向扫描,容忍注释/空行)。
function parseRolePrefer(yamlText) {
  const out = {};
  const lines = String(yamlText || '').split(/\r?\n/);
  let inRoles = false;
  let curRole = null;
  for (const raw of lines) {
    if (/^[^\s#]/.test(raw)) {                 // 顶层 key(列0)
      inRoles = /^roles\s*:/.test(raw);
      curRole = null;
      continue;
    }
    if (!inRoles) continue;
    const roleM = raw.match(/^ {2}([A-Za-z][\w-]*)\s*:/);  // 2 空格缩进 = 一个 role
    if (roleM) { curRole = roleM[1]; continue; }
    if (!curRole) continue;
    const prefM = raw.match(/^\s{4,}prefer\s*:\s*\[(.*)\]\s*$/);
    if (prefM) out[curRole] = prefM[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

let _cache = null;
function loadRolePrefer(file) {
  const f = file || DEFAULT_ROUTING_FILE;
  if (!file && _cache) return _cache;
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (_) { return {}; }
  const parsed = parseRolePrefer(text);
  if (!file) _cache = parsed;
  return parsed;
}

// 有序候选 runnerId 列表:[primary(现 roleMap,不变), ...prefer 降级候选]。
// 降级候选:去重、排除 primary、过滤 config.runners 里不存在的、过滤无法映射的。
function failoverCandidates(role, opts = {}) {
  const primary = opts.primaryRunnerId || null;
  const runners = opts.runners || {};
  const prefer = (opts.rolePrefer || loadRolePrefer(opts.routingFile))[role] || [];
  const chain = [];
  if (primary) chain.push(primary);
  for (const tok of prefer) {
    const id = preferTokenToRunnerId(tok);
    if (!id) continue;
    if (!runners[id]) continue;
    if (chain.includes(id)) continue;
    chain.push(id);
  }
  return chain;
}

// 失败原因分类:只给 runner.failover 事件标 reason 类型,不决定是否降级(exec 级失败一律降级)。
function classifyFailure(failText) {
  const s = String(failText || '');
  if (/(invalid authentication|unauthorized|forbidden|\b401\b|\b403\b|认证失败|鉴权失败|api key|apikey|token 无效|token失效)/i.test(s)) return 'auth';
  if (/(余额不足|额度不足|剩余额度|预扣费(?:额度)?失败|insufficient[_\s-]*(?:balance|quota)|quota[_\s-]*exhausted|exceeded\s+(?:your\s+)?(?:current\s+)?quota|(?:额度|配额)[^。\n]{0,20}(?:耗尽|用光|用完|已用尽)|payment required|billing)/i.test(s)) return 'quota_exhausted';
  if (/超时|timeout|ETIMEDOUT|\b124\b/i.test(s)) return 'timeout';
  if (/\b429\b|rate.?limit|配额不足|quota|访问量过大|请求(?:过于)?频繁|限流|频率限制|稍后再试/i.test(s)) return 'http_429';
  if (/\b5\d\d\b|server error|internal error/i.test(s)) return 'http_5xx';
  if (/no available channel|model_unavailable|无可用通道|unavailable|模型(?:繁忙|忙碌|不可用)|服务(?:繁忙|不可用)/i.test(s)) return 'model_unavailable';
  return 'runner_error';
}

module.exports = {
  PROVIDER_RUNNER,
  preferTokenToRunnerId,
  parseRolePrefer,
  loadRolePrefer,
  failoverCandidates,
  classifyFailure,
};
