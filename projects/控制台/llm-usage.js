'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_USAGE_FILES = Math.max(10, parseInt(process.env.LLM_USAGE_MAX_FILES || '30', 10) || 30);
const MAX_USAGE_FILE_BYTES = Math.max(256 * 1024, parseInt(process.env.LLM_USAGE_MAX_FILE_BYTES || String(1024 * 1024), 10) || (1024 * 1024));
const MAX_USAGE_READ_BYTES = Math.max(32 * 1024, parseInt(process.env.LLM_USAGE_MAX_READ_BYTES || String(96 * 1024), 10) || (96 * 1024));
const MAX_USAGE_JSON_PARSE_BYTES = Math.max(16 * 1024, parseInt(process.env.LLM_USAGE_MAX_JSON_PARSE_BYTES || String(64 * 1024), 10) || (64 * 1024));
const MAX_USAGE_DEPTH = Math.max(1, parseInt(process.env.LLM_USAGE_MAX_DEPTH || '7', 10) || 7);
// 旧 Claude 日志只在显式诊断历史用量时展示，绝不代表活跃路由。
const INCLUDE_DEPRECATED_CLAUDE_USAGE = /^(1|true|yes|on)$/i.test(String(process.env.INCLUDE_DEPRECATED_CLAUDE_USAGE || ''));

const LOCAL_LOG_SCHEMA = {
  schemaVersion: 'yt6.llm_gateway_observation.v1',
  recordType: 'llm_gateway_observation',
  retention: 'local-only; prompt/response bodies are intentionally excluded from the dashboard API',
  fields: [
    'event_id',
    'session_id',
    'trace_id',
    'span_id',
    'parent_span_id',
    'ts',
    'agent_id',
    'queue_agent',
    'project_id',
    'runner',
    'provider',
    'model',
    'source',
    'request_id',
    'status',
    'http_status',
    'start_time',
    'end_time',
    'duration_ms',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'quota',
    'estimated_cost_usd',
    'billing_mode',
    'limit_window',
    'next_refresh_at',
    'tags',
    'metadata'
  ],
  notes: [
    'session_id/trace_id/span_id model multi-step agent flows.',
    'provider/model/request_id/status/duration/tokens/cost fields support gateway-style request logs.',
    'Secrets, request bodies, response bodies, cookies, and raw keys are not part of this schema.'
  ]
};

function toIso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTime(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : 0;
  }
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return parseTime(Number(raw));
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function compactPath(file) {
  const home = os.homedir();
  if (file && home && file.startsWith(home + path.sep)) return '~/' + path.relative(home, file).split(path.sep).join('/');
  return file || '';
}

function readTailUtf8(file, size, maxBytes) {
  const bytes = Math.min(Math.max(0, size || 0), Math.max(1, maxBytes || MAX_USAGE_READ_BYTES));
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const start = Math.max(0, (size || 0) - bytes);
    const read = fs.readSync(fd, buf, 0, bytes, start);
    let text = buf.slice(0, read).toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      if (newline >= 0) text = text.slice(newline + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function usageRoot(kind) {
  const envName = kind === 'claude' ? 'CLAUDE_USAGE_LOG_ROOT' : 'CODEX_USAGE_LOG_ROOT';
  if (process.env[envName]) return path.resolve(process.env[envName]);
  const home = os.homedir();
  if (kind === 'claude') {
    const projects = path.join(home, '.claude', 'projects');
    return fs.existsSync(projects) ? projects : path.join(home, '.claude');
  }
  const sessions = path.join(home, '.codex', 'sessions');
  return fs.existsSync(sessions) ? sessions : path.join(home, '.codex');
}

function usageFileCandidate(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.jsonl' || ext === '.json' || ext === '.log' || ext === '.ndjson';
}

function walkUsageFiles(root, sinceMs) {
  const out = [];
  const minMtime = sinceMs ? sinceMs - 24 * 60 * 60 * 1000 : 0;
  function walk(dir, depth) {
    if (depth < 0 || out.length >= MAX_USAGE_FILES * 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'cache') continue;
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(fp, depth - 1);
      } else if (ent.isFile() && usageFileCandidate(ent.name)) {
        try {
          const st = fs.statSync(fp);
          if (minMtime && st.mtimeMs < minMtime) continue;
          out.push({ file: fp, mtimeMs: st.mtimeMs, size: st.size, tooLarge: st.size > MAX_USAGE_FILE_BYTES });
        } catch (_) {}
      }
    }
  }
  walk(root, MAX_USAGE_DEPTH);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_USAGE_FILES);
}

function firstObject(value, fields) {
  if (!value || typeof value !== 'object') return null;
  let cur = value;
  for (const field of fields) {
    cur = cur && cur[field];
    if (cur == null) return null;
  }
  return cur && typeof cur === 'object' ? cur : null;
}

function valueAt(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null) return obj[key];
  }
  return null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = asNumber(valueAt(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens']))
    + asNumber(valueAt(usage, ['cache_creation_input_tokens', 'cacheCreationInputTokens']))
    + asNumber(valueAt(usage, ['cache_read_input_tokens', 'cacheReadInputTokens']));
  const output = asNumber(valueAt(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens']));
  const total = asNumber(valueAt(usage, ['total_tokens', 'totalTokens', 'tokens'])) || input + output;
  if (total <= 0 && input <= 0 && output <= 0) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total || input + output,
  };
}

function recursiveUsage(obj, depth, seen) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  const direct = normalizeUsage(obj);
  if (direct) return direct;
  for (const value of Object.values(obj)) {
    const found = recursiveUsage(value, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function extractUsage(obj) {
  const candidates = [
    obj && obj.usage,
    firstObject(obj, ['message', 'usage']),
    firstObject(obj, ['response', 'usage']),
    firstObject(obj, ['result', 'usage']),
    firstObject(obj, ['data', 'usage']),
    firstObject(obj, ['event', 'usage']),
  ];
  for (const candidate of candidates) {
    const usage = normalizeUsage(candidate);
    if (usage) return usage;
  }
  return recursiveUsage(obj, 0, new Set());
}

function extractTimestamp(obj, fallbackMs) {
  const candidates = [
    obj && obj.timestamp,
    obj && obj.ts,
    obj && obj.created_at,
    obj && obj.createdAt,
    obj && obj.time,
    obj && obj.started_at,
    obj && obj.startedAt,
    obj && obj.completed_at,
    firstObject(obj, ['message']) && firstObject(obj, ['message']).timestamp,
    firstObject(obj, ['response']) && firstObject(obj, ['response']).created_at,
    firstObject(obj, ['usage']) && firstObject(obj, ['usage']).created_at,
  ];
  for (const candidate of candidates) {
    const t = parseTime(candidate);
    if (t) return t;
  }
  return fallbackMs || 0;
}

function extractAgent(obj) {
  const metadata = obj && (obj.metadata || obj.meta || obj.extra || {});
  const task = obj && obj.task && typeof obj.task === 'object' ? obj.task : {};
  return String(
    obj && (obj.agent_id || obj.agent || obj.role || obj.queueAgent || obj.queue_agent)
    || metadata.agent_id || metadata.agent || metadata.role || metadata.queueAgent || metadata.queue_agent
    || task.agent || task.role || task.queueAgent || ''
  ).trim();
}

function extractRequestId(obj, file, lineNo) {
  const metadata = obj && (obj.metadata || obj.meta || {});
  return String(
    obj && (obj.request_id || obj.requestId || obj.id || obj.message_id)
    || metadata.request_id || metadata.requestId
    || `${file}:${lineNo}`
  );
}

function readUsageEvents(kind, nowMs) {
  const root = usageRoot(kind);
  const sinceMs = nowMs - WEEK_MS;
  const source = {
    root: compactPath(root),
    status: 'missing',
    filesRead: 0,
    filesSkipped: 0,
    eventsRead: 0,
    error: '',
  };
  if (!fs.existsSync(root)) return { source, events: [] };
  const files = walkUsageFiles(root, sinceMs);
  source.status = files.length ? 'ok' : 'empty';
  const events = [];
  for (const item of files) {
    if (item.tooLarge) {
      source.filesSkipped++;
      continue;
    }
    let text = '';
    try {
      text = item.size > MAX_USAGE_READ_BYTES
        ? readTailUtf8(item.file, item.size, MAX_USAGE_READ_BYTES)
        : fs.readFileSync(item.file, 'utf8');
    } catch (e) {
        source.error = e.message;
        continue;
    }
    source.filesRead++;
    const trimmed = text.trim();
    const rows = [];
    if (path.extname(item.file).toLowerCase() === '.json' && item.size <= MAX_USAGE_JSON_PARSE_BYTES && /^[\[{]/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rows.push(...parsed);
        else rows.push(parsed);
      } catch (_) {}
    }
    if (!rows.length) {
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach(line => {
        try { rows.push(JSON.parse(line)); } catch (_) {}
      });
    }
    rows.forEach((obj, idx) => {
      const usage = extractUsage(obj);
      if (!usage) return;
      const tsMs = extractTimestamp(obj, item.mtimeMs);
      if (tsMs < sinceMs) return;
      events.push({
        event_id: extractRequestId(obj, item.file, idx + 1),
        tsMs,
        agent_id: extractAgent(obj),
        runner: kind,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
      });
    });
  }
  source.eventsRead = events.length;
  if (source.status === 'ok' && !events.length) source.status = 'empty';
  return { source, events };
}

function sumRows(rows) {
  const out = { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, quota: 0, estimated_cost_usd: 0, last_at: 0 };
  for (const row of rows || []) {
    out.calls += asNumber(row.calls) || 1;
    out.input_tokens += asNumber(row.prompt_tokens || row.input_tokens);
    out.output_tokens += asNumber(row.completion_tokens || row.output_tokens);
    out.total_tokens += asNumber(row.total_tokens);
    out.quota += asNumber(row.quota);
    out.estimated_cost_usd += asNumber(row.estimated_cost_usd);
    out.last_at = Math.max(out.last_at, asNumber(row.last_at || row.created_at));
  }
  return out;
}

function isGlm52(model) {
  return /(^|[^a-z0-9])glm[-_.\s]*5[._-]?2([^a-z0-9]|$)/i.test(String(model || ''));
}

function windowStats(events, windowMs, nowMs) {
  const since = nowMs - windowMs;
  const rows = (events || []).filter(e => e.tsMs >= since && e.tsMs <= nowMs + 60 * 1000);
  const stats = {
    calls: rows.length,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    windowMs,
    currentWindowStartedAt: null,
    nextRefreshAt: null,
    refreshCountdownMs: null,
  };
  let oldest = Infinity;
  for (const row of rows) {
    stats.input_tokens += asNumber(row.input_tokens);
    stats.output_tokens += asNumber(row.output_tokens);
    stats.total_tokens += asNumber(row.total_tokens);
    oldest = Math.min(oldest, row.tsMs);
  }
  if (Number.isFinite(oldest)) {
    const refresh = oldest + windowMs;
    stats.currentWindowStartedAt = toIso(oldest);
    stats.nextRefreshAt = toIso(refresh);
    stats.refreshCountdownMs = Math.max(0, refresh - nowMs);
  }
  return stats;
}

function byAgent(events) {
  const map = new Map();
  for (const row of events || []) {
    const agent = row.agent_id || 'unknown';
    if (!map.has(agent)) map.set(agent, { agent, calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    const cur = map.get(agent);
    cur.calls++;
    cur.input_tokens += asNumber(row.input_tokens);
    cur.output_tokens += asNumber(row.output_tokens);
    cur.total_tokens += asNumber(row.total_tokens);
  }
  return [...map.values()].sort((a, b) => b.total_tokens - a.total_tokens || b.calls - a.calls).slice(0, 12);
}

function roleLabel(cfg, role) {
  if (role === 'ceo') return 'CEO';
  const routed = (cfg.roleRouting || {})[role];
  return routed && routed.label || role;
}

function addAgent(map, cfg, modelId, role, runner, note, scenes) {
  if (!role) return;
  const key = `${modelId}:${role}`;
  if (map.has(key)) {
    const cur = map.get(key);
    cur.notes = [...new Set([...(cur.notes || []), note].filter(Boolean))];
    cur.scenes = [...new Set([...(cur.scenes || []), ...(scenes || [])].filter(Boolean))];
    return;
  }
  map.set(key, {
    id: role,
    label: roleLabel(cfg, role),
    runner,
    notes: note ? [note] : [],
    scenes: scenes || [],
  });
}

function buildAgentMap(cfg, queueAgents) {
  const map = new Map();
  const roles = cfg.roleRouting || {};
  for (const [role, route] of Object.entries(roles)) {
    const runner = route && route.runner || '';
    if (runner === 'zhipu-glm') addAgent(map, cfg, 'glm-5.2', role, runner, '已路由', []);
    else if (/^claude/.test(runner) && INCLUDE_DEPRECATED_CLAUDE_USAGE) addAgent(map, cfg, 'claude-code', role, runner, '秘书/维修主管路径', []);
    else if (/^codex/.test(runner)) addAgent(map, cfg, 'codex', role, runner, '主力路径', []);
  }
  const plan = cfg.glm52Delegation || {};
  for (const item of plan.routedRoles || []) {
    addAgent(map, cfg, 'glm-5.2', item.role, plan.runner || 'zhipu-glm', item.reason || 'GLM 分担', item.scenes || []);
  }
  const peekaboo = cfg.runners && cfg.runners.peekaboo;
  if (peekaboo && isGlm52([peekaboo.model, ...(peekaboo.cmd || []), peekaboo.env && peekaboo.env.NEW_API_MODEL].join(' '))) {
    addAgent(map, cfg, 'glm-5.2', 'gui_desktop_control', 'peekaboo', '视觉/桌面控制走 GLM-5.2 provider', ['截图定位', '点击冒烟', '桌面控制']);
  }
  for (const agent of queueAgents || []) {
    if (!agent || !agent.id || agent.id === 'ceo') continue;
    if (agent.role === 'supervisor' || /^supervisor-/.test(agent.id)) {
      addAgent(map, cfg, 'codex', agent.id, 'codex', '项目主管默认继承 Codex', []);
    }
  }
  return {
    'glm-5.2': [...map.entries()].filter(([k]) => k.startsWith('glm-5.2:')).map(([, v]) => v),
    'claude-code': [...map.entries()].filter(([k]) => k.startsWith('claude-code:')).map(([, v]) => v),
    codex: [...map.entries()].filter(([k]) => k.startsWith('codex:')).map(([, v]) => v),
  };
}

function buildGlmModel(newApiUsage, agents, days) {
  const rows = ((newApiUsage && newApiUsage.byModel) || []).filter(row => isGlm52(row.model));
  const totals = sumRows(rows);
  return {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    provider: 'Zhipu / new-api',
    billingMode: 'paid_buyout',
    billingLabel: '已付费·买断额度',
    chargingLabel: '不按调用扣钱',
    source: newApiUsage ? 'new-api local-db' : 'new-api local-db missing',
    sourceStatus: newApiUsage ? 'ok' : 'missing',
    currentUsage: {
      windowLabel: `近 ${days} 天`,
      calls: totals.calls,
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      quota: totals.quota,
      estimated_cost_usd: 0, // codeplan 买断,边际成本为 0(老板 2026-06-25:GLM-5.2 已完成付费,不按调用扣钱)
      gateway_quota: totals.quota, // 网关计量保留(仅观测,不折算费用)
      last_at: totals.last_at,
      costTreatment: 'codeplan 买断额度,调用不再扣费(展示 0 元)'
    },
    quotaWindows: [],
    agents: agents['glm-5.2'] || [],
    strategy: '低风险执行、日志整理、视觉/桌面控制优先消耗 GLM-5.2 买断额度。',
  };
}

function buildCliModel(id, label, provider, kind, agents, nowMs) {
  const { source, events } = readUsageEvents(kind, nowMs);
  return {
    id,
    label,
    provider,
    billingMode: 'subscription_quota',
    billingLabel: '订阅/免费额度',
    chargingLabel: '额度窗口',
    source: source.root,
    sourceStatus: source.status,
    sourceDetail: source,
    currentUsage: {
      windowLabel: '近 7 天本机自累计',
      calls: events.length,
      input_tokens: events.reduce((n, x) => n + asNumber(x.input_tokens), 0),
      output_tokens: events.reduce((n, x) => n + asNumber(x.output_tokens), 0),
      total_tokens: events.reduce((n, x) => n + asNumber(x.total_tokens), 0),
      byAgent: byAgent(events),
      costTreatment: 'CLI 订阅额度; 本面板不折算扣费'
    },
    quotaWindows: [
      Object.assign(windowStats(events, FIVE_HOUR_MS, nowMs), {
        id: '5h',
        label: '5小时额度',
        quotaLabel: '官方额度待接入',
        refreshKind: 'local_rolling_window_estimate',
      }),
      Object.assign(windowStats(events, WEEK_MS, nowMs), {
        id: 'week',
        label: '周额度',
        quotaLabel: '官方额度待接入',
        refreshKind: 'local_rolling_window_estimate',
      }),
    ],
    agents: agents[id] || [],
    strategy: id === 'codex'
      ? '保留给核心写码、维修和复杂根因; 窗口宽裕时优先补验证任务。'
      : '已停用兼容观测; 不参与新任务自动路由。',
  };
}

function buildStrategy(models) {
  const byId = Object.fromEntries((models || []).map(m => [m.id, m]));
  const tips = [
    'GLM-5.2 是已付费买断额度,低风险任务优先分担给 worker_narrow / quality_ops / frontend_designer / insight-scout / Peekaboo。',
    'Codex 的官方 5小时/周额度仍待交互抓取接入; 当前显示本机日志自累计和滚动窗口刷新估算。',
    '订阅窗口临近刷新且余量宽时,可优先消耗在验证、整理、轻量修复; 余量紧时保留给主管裁决、核心写码和维修。',
  ];
  const claudeFive = byId['claude-code'] && (byId['claude-code'].quotaWindows || [])[0];
  const codexFive = byId.codex && (byId.codex.quotaWindows || [])[0];
  if (claudeFive && claudeFive.total_tokens > codexFive?.total_tokens) tips.push('当前 Claude Code 本机 5小时消耗高于 Codex,后续轻量执行更适合转 GLM-5.2。');
  if (codexFive && codexFive.total_tokens > claudeFive?.total_tokens) tips.push('当前 Codex 本机 5小时消耗较高,核心写码以外任务应转 GLM-5.2 或排到刷新后。');
  return tips;
}

function buildOverview(opts) {
  const nowMs = opts && opts.nowMs || Date.now();
  const cfg = opts && opts.cfg || {};
  const days = Math.max(1, Math.min(Number(opts && opts.days || 7) || 7, 90));
  const agents = buildAgentMap(cfg, opts && opts.queueAgents || []);
  const newApiUsage = opts && opts.newApiUsage || null;
  const models = [
    buildGlmModel(newApiUsage, agents, days),
    buildCliModel('codex', 'Codex', 'OpenAI Codex CLI', 'codex', agents, nowMs),
  ];
  if (INCLUDE_DEPRECATED_CLAUDE_USAGE) {
    models.splice(1, 0, buildCliModel('claude-code', 'Claude Code(秘书+维修主管)', 'Anthropic CLI', 'claude', agents, nowMs));
  }
  return {
    generated_at: toIso(nowMs),
    schema: LOCAL_LOG_SCHEMA,
    models,
    strategy: buildStrategy(models),
    caveats: [
      'Codex 额度可能与你在其他客户端的使用共享; 本机自累计不等于官方总消耗。',
      'Claude Code 已从默认架构停用; 只有设置 INCLUDE_DEPRECATED_CLAUDE_USAGE=1 时才显示旧日志观测。',
      '官方 /usage 和 /status 非交互抓取未接入前,quotaLabel 保持待接入,不伪造剩余额度。',
      '所有密钥、prompt、response 正文都不从该 API 返回。'
    ],
  };
}

module.exports = {
  LOCAL_LOG_SCHEMA,
  buildOverview,
  _internal: {
    extractUsage,
    parseTime,
    windowStats,
    isGlm52,
  },
};
