'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DecisionToken = require('./decision-token');
const BoardContextRef = require('./board-context-ref');
const BoardEvidenceMerge = require('./board-evidence-merge');
const InteractionTrace = require('../../shared/engine/interaction-trace');

const DEFAULT_MAX_ROUNDS = 1;
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_ARTIFACTS_ROOT = path.join(__dirname, 'artifacts');
const BOARD_AUTH_COOLDOWN_MS = Math.max(60 * 1000, parseInt(process.env.BOARD_AUTH_COOLDOWN_MS || String(24 * 60 * 60 * 1000), 10) || (24 * 60 * 60 * 1000));
const BOARD_QUOTA_COOLDOWN_MS = Math.max(60 * 1000, parseInt(process.env.BOARD_QUOTA_COOLDOWN_MS || String(6 * 60 * 60 * 1000), 10) || (6 * 60 * 60 * 1000));
const BOARD_BUSY_COOLDOWN_MS = Math.max(60 * 1000, parseInt(process.env.BOARD_BUSY_COOLDOWN_MS || String(30 * 60 * 1000), 10) || (30 * 60 * 1000));

const DIRECTORS = [
  {
    id: 'board_deepseek',
    role: 'board_deepseek',
    name: 'DeepSeek 董事',
    model: 'DeepSeek(官方直连)',
    runner: 'deepseek-board-direct',
  },
  {
    id: 'board_glm52',
    role: 'board_glm52',
    name: 'GLM-5.2 董事',
    model: 'GLM-5.2(Coding Plan 直连)',
    runner: 'zhipu-board-direct',
  },
  {
    id: 'board_kimi',
    role: 'board_kimi',
    name: 'Kimi K3 董事',
    model: 'Kimi K3(Coding Plan 直连)',
    runner: 'kimi-k2',
  },
  {
    id: 'board_opus48',
    role: 'board_opus48',
    name: 'GPT-5.6-Sol 最终董事',
    model: 'GPT-5.6-Sol(codex)',
    runner: 'codex',
    final: true,
  },
];

// 拍板 Q11 分级评审:命中这些核心域=高危,全体董事评审;其余普通架构任务只派轮值+终审 2 席。
const HIGH_RISK_TIER_AREAS = ['engine', 'queue', 'routing', 'concurrency'];

const IMPORTANT_AREAS = [
  { key: 'engine', label: '引擎', re: /(核心引擎|引擎|engine|review-loop|flowId|flow|runner\s*引擎|cli-runner|taskstore|事件日志)/i },
  { key: 'queue', label: '队列', re: /(队列(?:引擎|机制|系统|调度|锁|租约|状态机|持久化)|shared\/engine\/queue(?:\.js)?|queue\.js.{0,20}(?:机制|引擎|原子|锁|并发|lease|claim|heartbeat)|(?:机制|引擎|原子|锁|并发|lease|claim|heartbeat).{0,20}queue\.js|claim\s*\/?\s*lease|lease\s*(?:机制|锁|心跳|超时)|heartbeat\s*(?:机制|锁|超时)|worker\s*(?:调度|心跳|锁|lease))/i },
  { key: 'routing', label: '路由', re: /(路由(?:系统|引擎|机制|规则|层|表|重构|改造)?|project-route|model-routing|runners\.yaml|runner\s*注册|分流规则|派单链路)/i },
  { key: 'agent', label: 'agent体系', re: /(agent\s*(?:体系|系统|注册|编排|角色|routing)|智能体体系|智能体编排|shared\/agents|agent\.json|roleRouting|角色路由|董事会(?:评议|触发|流程|规则|机制)|多模型评议|秘书钩子|主管实例|总管编排|orchestrator)/i },
  { key: 'data', label: '数据架构', re: /(数据架构|schema|存储|memory\/|decisions\.md|taskstore|持久化|状态机)/i },
  { key: 'release', label: '版本发布', re: /(版本发布|release|上线|发布|回滚|rollback|Gitee|远端同步)/i },
  { key: 'performance', label: '性能与资源', re: /(性能|资源占用|资源争用|吞吐|延迟|卡顿|内存|CPU|cpu|memory|latency|throughput|performance|perf|bottleneck|瓶颈|轮询|渲染性能|热点)/i },
  { key: 'concurrency', label: '并发与锁', re: /(并发|读写锁|资源域锁|锁|lock|mutex|semaphore|串行|serial|race|竞态|冲突仲裁)/i },
];

const CLAUSE_SPLIT_RE = /[\r\n;；。！？!?]+/;
const ARCH_ACTION_CN_RE = /(改|修|重构|重写|落地|接入|新增|添加|加|删除|移除|替换|升级|调整|优化|收紧|放开|启用|禁用|合并|拆分|迁移|发布|上线|设计|实现|建设|治理|加固|钩子|版本|沉淀)/i;
const ARCH_ACTION_EN_TERMS = [
  'build', 'implement', 'refactor', 'route', 'release', 'design', 'deploy',
  'migrate', 'enable', 'disable', 'upgrade', 'optimize', 'replace', 'remove', 'delete',
  'add', 'merge', 'split', 'harden', 'govern', 'hook',
];
const ARCH_ACTION_EN_RE = new RegExp(
  `(^|[^A-Za-z0-9_])(?:${ARCH_ACTION_EN_TERMS.join('|')})(?=$|[^A-Za-z0-9_])`,
  'i',
);
const NEGATED_ARCH_ACTION_RE = /(不|无需|不要|不再|未|非).{0,8}(改|修|重构|重写|落地|接入|新增|添加|加|删除|移除|替换|升级|调整|优化|收紧|放开|启用|禁用|合并|拆分|迁移|发布|上线|设计|实现|建设|治理|加固|钩子|版本|沉淀)|\b(?:do\s+not|don't|not|no|without)\b.{0,24}(?:build|implement|refactor|route|release|design|deploy|migrate|enable|disable|upgrade|optimize|replace|remove|delete|add|merge|split|harden|govern|hook)/i;
const EXPLICIT_BOARD_RE = /(重要架构|董事会(?:评议|触发|流程|规则|机制)|多模型评议|最终决策者|Codex|Opus-4\.8|架构决策)/i;
const UI_SMALL_CHANGE_RE = /(?:纯\s*)?(?:UI|界面|视觉|文案|显示|样式|布局|按钮|颜色|图标|文字|copy|css|html|前端|任务板|运行时长|输入时长|头像|滚动条|卡片|字号|间距|排版|截图|素材|办公室视觉).{0,40}(?:改|修|调整|优化|精修|小改|显示|变更|缩短|更换)|(?:改|修|调整|优化|精修|小改|变更|缩短|更换).{0,40}(?:UI|界面|视觉|文案|显示|样式|布局|按钮|颜色|图标|文字|copy|css|html|前端|任务板|运行时长|输入时长|头像|滚动条|卡片|字号|间距|排版|截图|素材|办公室视觉)|单文件前端|前端微调|纯\s*UI\s*小改/i;
const UI_ONLY_ARCHITECTURE_CONTEXT_RE = /(显示|展示|渲染|文案|样式|布局|按钮|颜色|图标|头像|任务板|办公室|workspace\.html|html|css|前端|UI|界面|视觉)/i;
const STRONG_ARCHITECTURE_CONTEXT_RE = /(核心引擎|队列引擎|队列机制|队列系统|路由(?:系统|机制|规则)|agent\s*体系|智能体体系|数据架构|状态机|持久化|版本发布|性能|资源占用|吞吐|延迟|内存|CPU|cpu|performance|perf|bottleneck|瓶颈|并发|锁|lease|heartbeat|schema|shared\/engine|queue\.js|engine-runner|ceo-worker|watchdog|resource-lock)/i;
const STRUCTURED_ARCH_ACTION_RE = /^(?:change|modify|edit|implement|build|refactor|rewrite|migrate|deploy|release|enable|disable|upgrade|optimize|replace|remove|delete|add|harden|govern|hook|改|修改|修复|实现|重构|重写|迁移|部署|发布|启用|禁用|升级|优化|替换|删除|新增|加固|治理)$/i;
const STRUCTURED_MENTION_ACTION_RE = /^(?:mention|reference|quote|describe|summarize|exclude|ignore|display|show|copy|style|提及|引用|复述|说明|排除|忽略|展示|显示|文案|样式)$/i;
const STRUCTURED_UI_RE = /^(?:ui|frontend|front-end|visual|display|copy|style|docs|document|界面|前端|视觉|显示|文案|样式|文档)$/i;
const STRUCTURED_AREA_ALIASES = {
  engine: 'engine',
  'core-engine': 'engine',
  '核心引擎': 'engine',
  '引擎': 'engine',
  queue: 'queue',
  'queue-engine': 'queue',
  '队列': 'queue',
  '队列引擎': 'queue',
  routing: 'routing',
  route: 'routing',
  '路由': 'routing',
  agent: 'agent',
  agents: 'agent',
  'agent-system': 'agent',
  'agent体系': 'agent',
  '智能体体系': 'agent',
  data: 'data',
  schema: 'data',
  storage: 'data',
  '数据架构': 'data',
  release: 'release',
  version: 'release',
  '版本发布': 'release',
  performance: 'performance',
  perf: 'performance',
  latency: 'performance',
  memory: 'performance',
  cpu: 'performance',
  '性能': 'performance',
  '资源': 'performance',
  '性能与资源': 'performance',
  concurrency: 'concurrency',
  lock: 'concurrency',
  locks: 'concurrency',
  lease: 'concurrency',
  '并发': 'concurrency',
  '锁': 'concurrency',
  ui: 'ui',
  frontend: 'ui',
  visual: 'ui',
  display: 'ui',
  copy: 'ui',
  style: 'ui',
  docs: 'ui',
  '前端': 'ui',
  '界面': 'ui',
  '视觉': 'ui',
  '显示': 'ui',
  '文案': 'ui',
  '样式': 'ui',
  '文档': 'ui',
};

function compact(text, max = 500) {
  const s = InteractionTrace.redact(String(text || ''))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:NEW_API_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function safeBoardText(value, max = 500) {
  return compact(InteractionTrace.redact(String(value || '')), max);
}

function shortTask(text, max = 42) {
  let s = compact(text, 240);
  const original = s.match(/(?:原始目标|original goal)[:：]\s*(.+)$/i);
  if (original) s = original[1];
  s = s.replace(/^项目主管(?:\([^)]*\))?执行\s*CEO\s*brief[。.:：\s]*/i, '');
  const stop = s.search(/[。；;!?？！]/);
  if (stop > 0) s = s.slice(0, stop);
  return compact(s, max) || '重要架构任务';
}

function splitClauses(text) {
  return String(text || '')
    .split(CLAUSE_SPLIT_RE)
    .map(s => s.trim())
    .filter(Boolean);
}

function hasArchAction(text) {
  const s = String(text || '');
  return ARCH_ACTION_CN_RE.test(s) || ARCH_ACTION_EN_RE.test(s);
}

function isUiOnlyArchitectureMention(text) {
  const s = String(text || '');
  return UI_SMALL_CHANGE_RE.test(s)
    && UI_ONLY_ARCHITECTURE_CONTEXT_RE.test(s)
    && !STRONG_ARCHITECTURE_CONTEXT_RE.test(s);
}

function archEvidenceForClause(clause) {
  const text = String(clause || '');
  if (!text.trim() || NEGATED_ARCH_ACTION_RE.test(text)) return null;
  if (isUiOnlyArchitectureMention(text)) return null;
  const matches = IMPORTANT_AREAS.filter(a => a.re.test(text));
  if (!matches.length) return null;
  const explicit = EXPLICIT_BOARD_RE.test(text);
  const action = hasArchAction(text);
  if (!explicit && !action) return null;
  return {
    explicit,
    action,
    matches: matches.map(m => m.key),
    labels: matches.map(m => m.label),
    clause: compact(text, 180),
  };
}

function collectStructuredValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(collectStructuredValues);
  if (typeof value === 'object') {
    return [
      ...collectStructuredValues(value.areas),
      ...collectStructuredValues(value.area),
      ...collectStructuredValues(value.impactAreas),
      ...collectStructuredValues(value.affectedAreas),
      ...collectStructuredValues(value.domains),
      ...collectStructuredValues(value.domain),
      ...collectStructuredValues(value.scope),
    ];
  }
  return String(value).split(/[,/|，、\s]+/).map(s => s.trim()).filter(Boolean);
}

function normalizeStructuredArea(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return STRUCTURED_AREA_ALIASES[key] || STRUCTURED_AREA_ALIASES[String(value || '').trim()] || null;
}

function structuredBoardAssessment(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const structuredFields = [
    spec.changeScope,
    spec.changeScopes,
    spec.impactAreas,
    spec.affectedAreas,
    spec.architectureAreas,
    spec.resourceDomains,
  ];
  const rawAreas = structuredFields.flatMap(collectStructuredValues);
  const action = String(
    spec.changeAction
    || spec.actionType
    || spec.action
    || spec.operation
    || spec.intent
    || spec.changeScope && (spec.changeScope.action || spec.changeScope.type)
    || ''
  ).trim();
  const hasStructuredSignal = rawAreas.length || action || spec.architectureChange != null || spec.uiOnly != null || spec.smallChange != null;
  if (!hasStructuredSignal) return null;
  const areaKeys = [...new Set(rawAreas.map(normalizeStructuredArea).filter(Boolean))];
  const matches = areaKeys.filter(key => IMPORTANT_AREAS.some(area => area.key === key));
  const labels = IMPORTANT_AREAS.filter(area => matches.includes(area.key)).map(area => area.label);
  const uiOnly = spec.uiOnly === true
    || spec.smallChange === true
    || areaKeys.length > 0 && areaKeys.every(key => key === 'ui')
    || STRUCTURED_UI_RE.test(String(spec.changeType || spec.taskType || spec.changeScope && spec.changeScope.type || ''));
  if (uiOnly) return { important: false, reason: 'structured-ui-small-change', matches: [], labels: [] };
  if (!matches.length) return { important: false, reason: 'structured-non-architecture', matches: [], labels: [] };
  if (STRUCTURED_MENTION_ACTION_RE.test(action)) return { important: false, reason: 'structured-mention-only', matches: [], labels: [] };
  if (spec.architectureChange === true || STRUCTURED_ARCH_ACTION_RE.test(action)) {
    return { important: true, reason: 'structured-architecture-signal', matches, labels };
  }
  return { important: false, reason: 'structured-missing-action', matches, labels };
}

function assessTask(text) {
  const hay = String(text || '');
  if (!hay.trim()) return { important: false, reason: 'empty', matches: [] };
  const evidence = splitClauses(hay)
    .map(archEvidenceForClause)
    .filter(Boolean);
  if (evidence.length) {
    const matches = [...new Set(evidence.flatMap(item => item.matches))];
    const labels = [...new Set(evidence.flatMap(item => item.labels))];
    const explicit = evidence.some(item => item.explicit);
    return {
      important: true,
      reason: explicit ? 'explicit-important-architecture' : 'architecture-action-evidence',
      matches,
      labels,
      evidence,
    };
  }
  const uiSmallChange = UI_SMALL_CHANGE_RE.test(hay);
  if (uiSmallChange) {
    return {
      important: false,
      reason: 'ui-small-change-excluded',
      matches: [],
      labels: [],
    };
  }
  return {
    important: false,
    reason: 'ordinary-task',
    matches: [],
    labels: [],
  };
}

function configFile() {
  return process.env.CONSOLE_CONFIG_FILE
    ? path.resolve(process.env.CONSOLE_CONFIG_FILE)
    : DEFAULT_CONFIG_FILE;
}

function readBoardReviewControl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return cfg && cfg.boardReviewControl || {};
  } catch (_) {
    return {};
  }
}

function boardReviewMaxRounds() {
  const control = readBoardReviewControl();
  const raw = Number(control && control.maxRounds);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(3, Math.floor(raw));
  return DEFAULT_MAX_ROUNDS;
}

function boardReviewDisabledResult() {
  const control = readBoardReviewControl();
  if (control && control.enabled === false) {
    return {
      important: false,
      reason: control.reason || 'board-review-disabled',
      matches: [],
      labels: [],
      disabled: true,
      control,
    };
  }
  return null;
}

function shouldRunBoardReview(spec, planText) {
  const existing = spec && spec.boardReview || {};
  const disabled = boardReviewDisabledResult();
  if (disabled) return disabled;
  if (spec && spec.skipBoardReview) return { important: false, reason: 'skipBoardReview', matches: [] };
  if (existing.ownerApproved || existing.approved || existing.completed || existing.skipped) {
    return { important: false, reason: 'already-reviewed', matches: [] };
  }
  if (existing.required === true) {
    return Object.assign({ important: true, reason: existing.reason || 'secretary-required', matches: existing.matches || [] }, existing);
  }
  const structured = structuredBoardAssessment(spec);
  if (structured) return structured;
  return assessTask([spec && spec.originalGoal, spec && spec.goal, planText].filter(Boolean).join('\n'));
}

// 拍板 Q11:分级评审开关。默认开;YUTU6_BOARD_TIERED=0/false/off 退回全体评审。
function boardTieredEnabled() {
  return !/^(0|false|off)$/i.test(String(process.env.YUTU6_BOARD_TIERED == null ? '1' : process.env.YUTU6_BOARD_TIERED).trim());
}

// 按任务 id 哈希在非终审席中确定性轮值(同一任务 id 永远选同一位轮值董事)。
function rotatingDirectorFor(taskId, directors = DIRECTORS) {
  const pool = directors.filter(d => !d.final);
  if (!pool.length) return null;
  const digest = crypto.createHash('sha1').update(String(taskId || '')).digest();
  return pool[digest.readUInt32BE(0) % pool.length];
}

// 分级判定:
// - full(全体,含终审): 命中高危核心域(engine/queue/routing/concurrency)、老板/秘书显式点名
//   董事会(explicit-important-architecture)、跨项目改动,或 matches 为空无法分类(保守全体)。
// - light(2 席: 轮值+终审): 其余触发董事会的普通架构任务。
function reviewTierFor({ spec, assessment, taskId } = {}) {
  const all = DIRECTORS.slice();
  const full = reason => ({ tier: 'full', tierReason: reason, directors: all });
  if (!boardTieredEnabled()) return full('tiering-disabled');
  const matches = assessment && Array.isArray(assessment.matches) ? assessment.matches : [];
  const highRisk = matches.filter(key => HIGH_RISK_TIER_AREAS.includes(key));
  if (highRisk.length) return full(`high-risk-area:${highRisk.join('/')}`);
  if (String(assessment && assessment.reason || '') === 'explicit-important-architecture') return full('explicit-board-request');
  if (spec && (spec.crossProject === true || (Array.isArray(spec.projects) && spec.projects.length > 1))) return full('cross-project');
  if (!matches.length) return full('unclassified-conservative-full');
  const finalDirector = all.find(d => d.final) || all[all.length - 1];
  const rotating = rotatingDirectorFor(taskId, all);
  const directors = [...new Set([rotating, finalDirector].filter(Boolean))];
  if (directors.length < 2) return full('light-panel-unavailable');
  return { tier: 'light', tierReason: 'ordinary-architecture-rotation', directors };
}

function extractJsonBlocks(text) {
  const out = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    try { out.push(JSON.parse(m[1].trim())); } catch (_) {}
  }
  return out;
}

function readText(file, max = 8000) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return s.length > max ? s.slice(-max) : s;
  } catch (_) {
    return '';
  }
}

function projectEvidenceLineRef(file, workspaceRoot) {
  if (!file) return null;
  const root = path.resolve(workspaceRoot || path.resolve(__dirname, '../..'));
  const projectRoot = path.join(root, 'projects', '控制台');
  const absolute = path.isAbsolute(String(file)) ? path.resolve(String(file)) : path.resolve(root, String(file));
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (_) { return null; }
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  let real;
  let realRoot;
  let realProjectRoot;
  try {
    real = fs.realpathSync(absolute);
    realRoot = fs.realpathSync(root);
    realProjectRoot = fs.realpathSync(projectRoot);
  } catch (_) { return null; }
  const realRelative = path.relative(realProjectRoot, real);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) return null;
  let lines;
  try { lines = fs.readFileSync(real, 'utf8').split(/\r?\n/); } catch (_) { return null; }
  const firstContentLine = lines.findIndex(line => String(line || '').trim());
  if (firstContentLine < 0) return null;
  return `${path.relative(realRoot, real).split(path.sep).join('/')}:${firstContentLine + 1}`;
}

function riskLevel(value) {
  const s = String(value || '').toLowerCase();
  if (/high|高|critical|严重/.test(s)) return 'high';
  if (/medium|中|moderate/.test(s)) return 'medium';
  return 'low';
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  const s = String(value || '').toLowerCase();
  if (/^(true|yes|1|risk|有|是)$/.test(s)) return true;
  if (/^(false|no|0|none|无|否)$/.test(s)) return false;
  return fallback;
}

function normalizeIssues(value) {
  const raw = Array.isArray(value) ? value : (value ? [value] : []);
  return raw.map(item => {
    if (typeof item === 'string') return compact(item, 240);
    if (item && typeof item === 'object') {
      return compact(item.issue || item.risk || item.finding || item.problem || item.summary || JSON.stringify(item), 240);
    }
    return '';
  }).filter(Boolean);
}

function runnerAbsenceSummary(reason) {
  return `董事缺席: runner 调用失败${reason ? `:${safeBoardText(reason, 260)}` : ''}`;
}

function parseOpinion(out, director, round) {
  const fail = out && out.fail ? safeBoardText(out.fail, 360) : '';
  let data = null;
  const vars = out && out.vars || {};
  data = vars.board_review || vars.boardReview || vars.final_decision || null;
  if (!data && out && out.evidence && out.evidence.path) {
    const text = readText(out.evidence.path);
    const blocks = extractJsonBlocks(text);
    for (const block of blocks) {
      if (block && (block.board_review || block.boardReview || block.final_decision)) {
        data = block.board_review || block.boardReview || block.final_decision;
        break;
      }
    }
  }
  data = data && typeof data === 'object' ? data : {};
  const issueRecords = BoardEvidenceMerge.normalizeProposalRecords(
    data.issues || data.risks || data.findings || data.problems,
    'issue',
  );
  const suggestionRecords = BoardEvidenceMerge.normalizeProposalRecords(
    data.suggestions || data.actions || data.fixes,
    'suggestion',
  );
  const issues = issueRecords.map(record => record.text);
  const absent = !!fail;
  const level = absent ? 'high' : riskLevel(data.risk_level || data.risk || 'low');
  // 缺席不是“赞成”。单席缺席可由其他董事继续评议，但这张意见本身绝不能成为放行票。
  const canExecute = absent ? false : boolValue(data.can_execute != null ? data.can_execute : data.safe_to_execute, level === 'low');
  const hardBlock = boolValue(data.hard_block != null ? data.hard_block : data.blocking, false);
  const misjudgmentRisk = boolValue(
    data.misjudgment_risk != null ? data.misjudgment_risk : data.opus_misjudgment_risk,
    false,
  );
  return {
    director: director.id,
    name: director.name,
    model: director.model,
    round,
    risk_level: level,
    can_execute: canExecute,
    hard_block: hardBlock,
    misjudgment_risk: misjudgmentRisk,
    issues,
    suggestions: suggestionRecords.map(record => record.text),
    proposal_records: [...issueRecords, ...suggestionRecords],
    summary: absent ? runnerAbsenceSummary(fail) : safeBoardText(data.summary || data.conclusion || data.reason || (issues[0] || ''), 300),
    failed: false,
    absent,
    runner_failed: absent,
    absence_reason: absent ? fail : '',
  };
}

function makeLegacyDirectorGoal({ director, round, maxRounds, instruction, planText, previousRounds, projectId }) {
  const finalNote = director.final && round === maxRounds
    ? '你是最终放行判断者。本轮结束后必须明确判断 misjudgment_risk: 只有存在红线、越界、密钥/授权、严重队列/路由事故或明确不可执行硬阻断时填 true;普通优化建议、测试补强和可控风险填 false 并允许默认执行。'
    : '本轮重点是事前评审: 找理解偏差、边界漏洞、架构/性能/并发风险和遗漏验收,但区分“建议修订”和“硬阻断”。不要把普通改进建议当成否决。';
  const previous = previousRounds.length
    ? previousRounds.map(r => `第 ${r.round} 轮整合: ${compact(r.summary, 500)}`).join('\n')
    : '无';
  return [
    `董事会事前评审任务 · ${director.name} · 第 ${round}/${maxRounds} 轮`,
    '',
    finalNote,
    '',
    `项目:${projectId || '控制台'}`,
    '',
    '当前待执行指令:',
    String(instruction || '').trim(),
    '',
    'CEO/秘书计划摘要:',
    String(planText || '').trim() || '(无)',
    '',
    '前轮信息:',
    previous,
    '',
    '输出要求:',
    '- 必须列出具体风险或说明为什么无问题并给出可验证依据。',
    '- issues/suggestions 中每项使用对象，保留 text、claim_key、stance、evidence_refs(path:line)、evidence_level；红线另填 redline_type，复现实验另填 reproduction(command/status/exit_code)。',
    '- 合理改动应允许通过:普通建议写进 issues/suggestions,但 can_execute 仍为 true,misjudgment_risk 仍为 false。',
    '- 只有红线、越界、密钥/授权、严重队列/路由事故或明确不可执行硬阻断,才设置 can_execute:false 或 hard_block:true。',
    '- 不要泄露或要求任何密钥/token/登录。',
    '- 只评议这条控制台任务,不扩展到无关项目。',
    '',
    '最后输出 JSON:',
    '```json',
    '{"board_review":{"risk_level":"low|medium|high","can_execute":true,"hard_block":false,"misjudgment_risk":false,"issues":[{"text":"具体问题","claim_key":"稳定主题键","stance":"assert","evidence_refs":["projects/控制台/文件:行"],"evidence_level":"none|claim|trace|reproducible","redline_type":null,"reproduction":null}],"suggestions":[{"text":"具体修订","claim_key":"稳定主题键","stance":"support","evidence_refs":[],"evidence_level":"none"}],"summary":"一句结论"}}',
    '```',
  ].join('\n');
}

function makeDirectorGoal({ director, round, maxRounds, instruction, planText, previousRounds, projectId, boardContext }) {
  if (!boardContext || boardContext.enabled !== true) {
    return makeLegacyDirectorGoal({ director, round, maxRounds, instruction, planText, previousRounds, projectId });
  }
  const finalNote = director.final && round === maxRounds
    ? '你是最终放行判断者。本轮结束后必须明确判断 misjudgment_risk: 只有存在红线、越界、密钥/授权、严重队列/路由事故或明确不可执行硬阻断时填 true;普通优化建议、测试补强和可控风险填 false 并允许默认执行。'
    : '本轮重点是事前评审: 找理解偏差、边界漏洞、架构/性能/并发风险和遗漏验收,但区分“建议修订”和“硬阻断”。不要把普通改进建议当成否决。';
  const previous = previousRounds.length
    ? previousRounds.map(r => `第 ${r.round} 轮整合: ${compact(r.summary, 500)}`).join('\n')
    : '无';
  const current = BoardContextRef.splitSecretaryContextPack(instruction);
  const taskInstruction = current.taskText || boardContext.instruction.taskText || String(instruction || '').trim();
  const planTask = boardContext.plan.taskText || BoardContextRef.splitSecretaryContextPack(planText).taskText;
  const taskHash = BoardContextRef.sha256(taskInstruction);
  const planHash = BoardContextRef.sha256(planTask);
  const planSection = planTask && planHash === taskHash
    ? `task_goal_ref:sha256:${taskHash}（与“当前待执行指令”逐字相同，仅复用内容；CEO/秘书计划摘要这一语义标签仍保留）`
    : (planTask || '(无)');
  const inlineFragments = [
    (current.preamble || boardContext.instruction.preamble)
      ? `当前指令未去重片段（无标题边界，按安全规则原样保留）:\n${current.preamble || boardContext.instruction.preamble}`
      : '',
    boardContext.plan.preamble ? `计划摘要未去重片段（无标题边界，按安全规则原样保留）:\n${boardContext.plan.preamble}` : '',
  ].filter(Boolean);
  return [
    `董事会事前评审任务 · ${director.name} · 第 ${round}/${maxRounds} 轮`,
    '',
    finalNote,
    '',
    `项目:${projectId || '控制台'}`,
    '',
    '共享背景（同一只读 context_ref，禁止改写）:',
    `context_ref:${boardContext.ref}`,
    `context_sha256:${boardContext.sha256}`,
    `context_manifest:${boardContext.manifest}`,
    '读取规则:需要稳定背景时只读 context_ref；其中每段均按完整 Markdown 标题块做 SHA-256 校验。无法确认标题边界的片段已保留在本信封，不得自行猜测或删除。',
    '',
    '当前待执行指令:',
    taskInstruction,
    '',
    'CEO/秘书计划摘要:',
    planSection,
    '',
    ...inlineFragments.flatMap(fragment => [fragment, '']),
    '前轮信息:',
    previous,
    '',
    '输出要求:',
    '- 必须列出具体风险或说明为什么无问题并给出可验证依据。',
    '- issues/suggestions 中每项使用对象，保留 text、claim_key、stance、evidence_refs(path:line)、evidence_level；红线另填 redline_type，复现实验另填 reproduction(command/status/exit_code)。',
    '- 合理改动应允许通过:普通建议写进 issues/suggestions,但 can_execute 仍为 true,misjudgment_risk 仍为 false。',
    '- 只有红线、越界、密钥/授权、严重队列/路由事故或明确不可执行硬阻断,才设置 can_execute:false 或 hard_block:true。',
    '- 不要泄露或要求任何密钥/token/登录。',
    '- 只评议这条控制台任务,不扩展到无关项目。',
    '',
    '最后输出 JSON:',
    '```json',
    '{"board_review":{"risk_level":"low|medium|high","can_execute":true,"hard_block":false,"misjudgment_risk":false,"issues":[{"text":"具体问题","claim_key":"稳定主题键","stance":"assert","evidence_refs":["projects/控制台/文件:行"],"evidence_level":"none|claim|trace|reproducible","redline_type":null,"reproduction":null}],"suggestions":[{"text":"具体修订","claim_key":"稳定主题键","stance":"support","evidence_refs":[],"evidence_level":"none"}],"summary":"一句结论"}}',
    '```',
  ].join('\n');
}

function opinionNeedsMoreRounds(op) {
  if (!op) return true;
  if (op.absent) return false;
  if (op.failed) return true;
  if (op.hard_block === true) return true;
  if (op.can_execute === false) return true;
  return op.risk_level === 'high' || op.risk_level === 'medium';
}

// 2026-07-03 架构审视 A-5:压缩前先按显式标记剥离秘书背景包(不用正则启发式——项目守卫
// 误杀教训)。旧格式包在"目标:"之前,剥 [marker, 目标行);新格式包在末尾,剥 [marker, 结尾)。
// 否则 compact(base,5000) 保头截尾会保住 12KB 背景包、截丢老板任务正文(实证事故)。
function stripSecretaryContextPack(text) {
  const s = String(text || '');
  const start = s.indexOf('[秘书后台背景包]');
  if (start === -1) return s;
  const goalIdx = s.indexOf('\n目标:', start);
  if (goalIdx > start) return (s.slice(0, start) + s.slice(goalIdx + 1)).trim();
  return s.slice(0, start).trim();
}

function buildRevisedInstruction(base, opinions, round, opts = {}) {
  if (opts.active === true && opts.mergeContract) {
    return BoardEvidenceMerge.renderActiveRevision(
      compact(stripSecretaryContextPack(base), 5000),
      opts.mergeContract,
      round,
    );
  }
  const issues = [];
  const suggestions = [];
  const absent = [];
  for (const op of opinions) {
    if (op.absent) {
      absent.push(`${op.name}: ${op.absence_reason || op.summary || 'runner 调用失败'}`);
      continue;
    }
    for (const i of op.issues || []) issues.push(`${op.name}: ${i}`);
    for (const s of op.suggestions || []) suggestions.push(`${op.name}: ${s}`);
  }
  const additions = [
    `董事会第 ${round} 轮整合修订:`,
    ...issues.slice(0, 8).map(x => `- 风险/偏差: ${compact(x, 220)}`),
    ...suggestions.slice(0, 8).map(x => `- 修订建议: ${compact(x, 220)}`),
    ...absent.slice(0, 4).map(x => `- 董事缺席: ${compact(x, 220)}`),
  ];
  return [
    compact(stripSecretaryContextPack(base), 5000),
    '',
    additions.join('\n'),
  ].filter(Boolean).join('\n');
}

function integrateRound(instruction, opinions, round, maxRounds, opts = {}) {
  const present = opinions.filter(op => !op.absent);
  const absentCount = opinions.length - present.length;
  const absenceMajority = opinions.length > 0 && absentCount > opinions.length / 2;
  const issueCount = present.reduce((n, op) => n + (op.issues || []).length, 0);
  const risky = opinions.filter(opinionNeedsMoreRounds);
  const revisedInstruction = buildRevisedInstruction(instruction, opinions, round, opts);
  const summaryParts = [
    `${risky.length ? `${risky.length} 位董事仍要求修订` : `${present.length} 位董事未阻断执行`}`,
    absentCount ? `${absentCount} 位董事缺席` : '',
    `issue=${issueCount}`,
  ].filter(Boolean);
  const summary = summaryParts.join('; ');
  return {
    issueCount,
    absentCount,
    presentCount: present.length,
    directorCount: opinions.length,
    absenceMajority,
    riskyCount: risky.length,
    shouldContinue: !absenceMajority && risky.length > 0 && round < maxRounds,
    revisedInstruction,
    summary,
  };
}

function absenceMajorityOpinion(opinions, integrated) {
  const absent = (opinions || []).filter(op => op && op.absent);
  const count = integrated && integrated.absentCount != null ? integrated.absentCount : absent.length;
  const total = integrated && integrated.directorCount != null ? integrated.directorCount : (opinions || []).length;
  return {
    director: 'board_quorum',
    name: '董事会法定席位',
    model: 'system-gate',
    risk_level: 'high',
    can_execute: false,
    hard_block: true,
    misjudgment_risk: true,
    absent: false,
    failed: false,
    issues: [
      `本轮 ${count}/${total} 位董事缺席，已超过半数，无法形成有效事前评审。`,
      ...absent.map(op => `${op.name}: ${op.absence_reason || op.summary || 'runner 调用失败'}`).slice(0, 4),
    ],
    suggestions: ['恢复足够董事 runner 后重试，或由主人在决策卡中明确拍板。'],
    summary: `董事缺席过半(${count}/${total})，本轮不得自动放行。`,
  };
}

function appendDecisionMemory(file, record) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '',
    `## 董事会评议 ${record.stamp}`,
    `- 任务:${compact(record.task, 160)}`,
    `- 触发:${record.reason || '重要架构'}${record.labels && record.labels.length ? ` (${record.labels.join('/')})` : ''}`,
    `- 轮次:${record.rounds}/${record.maxRounds || DEFAULT_MAX_ROUNDS}`,
    `- 结论:${record.status}`,
    `- 理由:${compact(record.summary, 260)}`,
  ];
  if (record.decisionId) lines.push(`- 决策卡:${record.decisionId}`);
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function healthFileFor(artifactsRoot) {
  return path.join(artifactsRoot || DEFAULT_ARTIFACTS_ROOT, 'board-review-runner-health.json');
}

function readHealthState(file) {
  const state = readJson(file, {});
  return state && typeof state === 'object' ? state : {};
}

function classifyRunnerHealthFailure(reason) {
  const s = String(reason || '');
  if (/(invalid authentication|unauthorized|forbidden|\b401\b|\b403\b|认证失败|鉴权失败|api key|apikey|token 无效|token失效)/i.test(s)) {
    return { kind: 'auth', cooldownMs: BOARD_AUTH_COOLDOWN_MS };
  }
  if (/(余额不足|额度不足|剩余额度|预扣费额度失败|quota|insufficient balance|payment required|billing)/i.test(s)) {
    return { kind: 'quota', cooldownMs: BOARD_QUOTA_COOLDOWN_MS };
  }
  if (/(访问量过大|稍后再试|rate.?limit|\b429\b|too many requests|模型(?:繁忙|忙碌)|服务(?:繁忙|不可用))/i.test(s)) {
    return { kind: 'busy', cooldownMs: BOARD_BUSY_COOLDOWN_MS };
  }
  return null;
}

function directorCooldownReason(director, artifactsRoot, now = Date.now()) {
  const file = healthFileFor(artifactsRoot);
  const state = readHealthState(file);
  const row = state[director.id];
  if (!row || !row.untilMs || row.untilMs <= now) {
    if (row && row.untilMs && row.untilMs <= now) {
      delete state[director.id];
      writeJsonAtomic(file, state);
    }
    return '';
  }
  return `runner health cooldown(${row.kind || 'unknown'} until ${row.until || new Date(row.untilMs).toISOString()}): ${compact(row.reason || 'previous runner failure', 220)}`;
}

function markDirectorCooldown(director, reason, artifactsRoot, eventlog) {
  const classified = classifyRunnerHealthFailure(reason);
  if (!classified) return null;
  const safeReason = safeBoardText(reason, 300);
  const now = Date.now();
  const untilMs = now + classified.cooldownMs;
  const file = healthFileFor(artifactsRoot);
  const state = readHealthState(file);
  state[director.id] = {
    director: director.id,
    runner: director.runner,
    kind: classified.kind,
    reason: safeReason,
    atMs: now,
    at: new Date(now).toISOString(),
    untilMs,
    until: new Date(untilMs).toISOString(),
  };
  writeJsonAtomic(file, state);
  eventlog && eventlog.emit('board.review.director.cooldown', {
    director: director.id,
    role: director.role,
    runner: director.runner,
    kind: classified.kind,
    until: state[director.id].until,
    reason: compact(safeReason, 220),
  });
  return state[director.id];
}

function safeStateId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'unknown';
}

function settlementFileFor(artifactsRoot, taskId, round) {
  return path.join(
    artifactsRoot || path.join(__dirname, 'artifacts'),
    'board-review-settlements',
    `${safeStateId(taskId)}-r${Number(round) || 1}.json`,
  );
}

function sleepSync(ms) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, Math.max(1, Number(ms) || 1));
}

function withFileLock(lockFile, fn, opts = {}) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 5000;
  const pollMs = Number.isFinite(Number(opts.pollMs)) ? Number(opts.pollMs) : 20;
  const started = Date.now();
  let fd = null;
  while (fd == null) {
    try {
      fd = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`board review settlement lock timeout: ${lockFile}`);
      }
      sleepSync(pollMs);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

function settleDirectorOpinion(opts) {
  const file = opts.file || settlementFileFor(opts.artifactsRoot, opts.taskId, opts.round);
  const opinion = opts.opinion || {};
  const director = opinion.director || opts.director;
  if (!director) throw new Error('settleDirectorOpinion requires director');
  const expectedDirectors = Math.max(1, Number(opts.directorCount || opts.expectedDirectors || DIRECTORS.length) || DIRECTORS.length);
  const eventlog = opts.eventlog || null;
  const result = withFileLock(`${file}.lock`, () => {
    const state = readJson(file, {
      taskId: opts.taskId || null,
      round: Number(opts.round) || 1,
      expectedDirectors,
      opinions: {},
      settled: false,
      createdAt: new Date().toISOString(),
    });
    state.taskId = state.taskId || opts.taskId || null;
    state.round = state.round || Number(opts.round) || 1;
    state.expectedDirectors = expectedDirectors;
    state.opinions = state.opinions && typeof state.opinions === 'object' ? state.opinions : {};
    const duplicate = !!state.opinions[director];
    state.opinions[director] = Object.assign({}, opinion, {
      director,
      submittedAt: opinion.submittedAt || new Date().toISOString(),
    });
    const submittedDirectors = Object.keys(state.opinions).sort();
    state.submittedCount = submittedDirectors.length;
    state.allSubmitted = state.submittedCount >= expectedDirectors;
    state.updatedAt = new Date().toISOString();
    const justSettled = state.allSubmitted && !state.settled;
    if (justSettled) {
      state.settled = true;
      state.settledAt = state.updatedAt;
      state.status = 'all_submitted';
    } else {
      state.status = state.settled ? 'all_submitted' : 'waiting';
    }
    writeJsonAtomic(file, state);
    return {
      file,
      duplicate,
      justSettled,
      settled: !!state.settled,
      allSubmitted: !!state.allSubmitted,
      submittedCount: state.submittedCount,
      expectedDirectors,
      submittedDirectors,
      state,
    };
  }, opts.lock || {});
  if (eventlog) {
    eventlog.emit('board.review.settlement.check', {
      task: opts.taskId || null,
      projectId: opts.projectId || null,
      round: Number(opts.round) || 1,
      director,
      submittedCount: result.submittedCount,
      expectedDirectors: result.expectedDirectors,
      allSubmitted: result.allSubmitted,
      duplicate: result.duplicate,
      file,
    });
    if (result.justSettled) {
      eventlog.emit('board.review.settled', {
        task: opts.taskId || null,
        projectId: opts.projectId || null,
        round: Number(opts.round) || 1,
        submittedCount: result.submittedCount,
        expectedDirectors: result.expectedDirectors,
        status: 'all_submitted',
        file,
      });
    }
  }
  return result;
}

function decisionIdFor(taskId, text) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const hash = crypto.createHash('sha1').update(`${taskId || ''}\n${text || ''}`).digest('hex').slice(0, 8);
  return `board-${stamp}-${hash}`;
}

function defaultNotify(title, body, extra = {}) {
  try {
    const SecretaryTools = require('./secretary-tools');
    return SecretaryTools.notify(Object.assign({ title, body, source: 'board-review', log: false }, extra));
  } catch (e) {
    return { attempted: true, sent: false, stderr: e.message };
  }
}

// 控制台 baseUrl:优先 env 覆盖,其次 config.json 的 baseUrl,兜底 127.0.0.1:41218。
// 以后换 LAN/桥接地址时改 config.json 的 baseUrl 即可,不用改代码。
function consoleBaseUrl() {
  const envBase = process.env.CONSOLE_DECISION_BASE || process.env.CONSOLE_API_BASE || '';
  if (envBase) return String(envBase).replace(/\/+$/, '');
  try {
    const cfg = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_FILE, 'utf8'));
    if (cfg && cfg.baseUrl) return String(cfg.baseUrl).replace(/\/+$/, '');
  } catch (_) {}
  return 'http://127.0.0.1:41218';
}

function consoleDecisionUrl(cardId) {
  return `${consoleBaseUrl()}/workspace?view=task-board&bulletin=${encodeURIComponent(cardId || '')}`;
}

function createOwnerDecisionCard({ spec, projectId, taskId, instruction, finalOpinion, rounds, artifactsRoot, notify }) {
  const id = decisionIdFor(taskId, instruction);
  const dir = path.join(artifactsRoot, 'board-decisions');
  const file = path.join(dir, `${id}.json`);
  const resumeTask = Object.assign({}, spec, {
    role: 'orchestrator',
    flowId: 'project-route',
    projectId: projectId || spec.projectId || '控制台',
    goal: instruction,
    boardReview: {
      ownerApproved: true,
      decisionId: id,
      approvedReason: 'owner decision card approved',
    },
    // 董事会现在位于 CEO 拆解之前；主人批准后仍须继续 CEO 规划。
    useOrchestrator: spec.useOrchestrator !== false,
    autoApproveHuman: spec.autoApproveHuman !== false,
  });
  // 飞书决策卡真回调(拍板 Q12):每卡随机 secret,存进卡片记录;secret/token 不回显日志。
  // DECISION_CALLBACK_ENABLED=0 时回退旧行为(单个"打开决策卡"链接按钮)。
  const decisionCallbackEnabled = process.env.DECISION_CALLBACK_ENABLED !== '0';
  const card = {
    id: `board-decision-${id}`,
    title: `董事会需拍板: ${shortTask(spec.originalGoal || spec.goal)}`,
    desc: '事前评审未满足自动放行条件。点击启用=批准继续进入 CEO 规划。',
    target: 'ceo',
    project: projectId || spec.projectId || '控制台',
    source: '董事会',
    payload: resumeTask,
    status: 'todo',
    created_at: new Date().toISOString(),
    enabled_at: null,
    queueId: null,
    decisionId: id,
  };
  if (decisionCallbackEnabled) card.decisionSecret = DecisionToken.newSecret();
  const bulletinFile = path.join(artifactsRoot, 'bulletin', 'cards.json');
  const cards = readJson(bulletinFile, []);
  const existing = cards.find(c => c && c.id === card.id);
  if (!existing) {
    cards.unshift(card);
    writeJsonAtomic(bulletinFile, cards);
  } else if (decisionCallbackEnabled) {
    // 同一决策卡重复创建:复用已存 secret,保证此前发出的按钮 token 仍有效;老卡没有 secret 则补上
    if (existing.decisionSecret) card.decisionSecret = existing.decisionSecret;
    else {
      existing.decisionSecret = card.decisionSecret;
      writeJsonAtomic(bulletinFile, cards);
    }
  }
  const payload = {
    id,
    status: 'pending',
    projectId: card.project,
    taskId,
    queueAgent: spec.queueAgent || null,
    queueId: spec.queueId || null,
    finalOpinion,
    rounds,
    resumeTask,
    bulletinId: card.id,
    created_at: card.created_at,
  };
  writeJsonAtomic(file, payload);
  const decisionUrl = consoleDecisionUrl(card.id);
  // 飞书原生 value 回调由 Hermes 长连接接收，再在本机调用 /api/decision。
  // 卡片只携带非敏感 card_id/action；每卡 secret 和 HMAC token 始终留在本机。
  const secret = card.decisionSecret || '';
  const notifyExtra = (decisionCallbackEnabled && secret)
    ? {
        type: 'decision',
        actions: [
          {
            label: '批准继续',
            type: 'primary',
            value: { yutu6_decision_action: 'approve', card_id: card.id },
          },
          {
            label: '驳回取消',
            type: 'danger',
            value: { yutu6_decision_action: 'reject', card_id: card.id },
          },
          { label: '打开控制台', type: 'default', url: decisionUrl },
        ],
      }
    : {
        buttonLabel: '打开决策卡',
        buttonUrl: decisionUrl,
      };
  const notifyResult = (notify || defaultNotify)(
    `【需拍板】董事会事前评审未放行: ${shortTask(spec.originalGoal || spec.goal, 24)}`,
    [
      `任务: ${shortTask(spec.originalGoal || spec.goal, 32)}`,
      `风险: ${compact(finalOpinion && (finalOpinion.summary || (finalOpinion.issues || [])[0]) || '单轮事前评审仍判硬阻断/误判风险', 80)}`,
      (decisionCallbackEnabled && secret)
        ? `操作: 在飞书内点「批准继续」=启用执行,点「驳回取消」=取消该任务;无需打开浏览器。`
        : `操作: 点击卡片按钮打开控制台待办 ${card.id}，点启用才继续。`,
    ].join('\n'),
    notifyExtra,
  );
  return { id, file, card, notifyResult };
}

async function runDirectorOpinion({ director, round, maxRounds, instruction, previousRounds, boardContext, opts, taskId, projectId, settlementFile, expectedDirectors }) {
  const eventlog = opts.eventlog;
  const cliRunner = opts.cliRunner;
  const node = { id: `board-${director.id}-r${round}`, agent_role: director.role };
  const dctx = Object.assign({}, opts.ctx || {}, {
    goal: makeDirectorGoal({ director, round, maxRounds, instruction, planText: opts.planText || '', previousRounds, projectId, boardContext }),
    boardLegacyGoal: makeLegacyDirectorGoal({ director, round, maxRounds, instruction, planText: opts.planText || '', previousRounds, projectId }),
    boardContextRef: boardContext,
    acceptance: '输出董事会挑刺 JSON; 不改文件; 不回显密钥。',
    projectId,
    boardReviewRound: round,
    boardReviewDirector: director.id,
  });
  const startedAt = Date.now();
  eventlog && eventlog.emit('node.start', { task: taskId, node: node.id, attempt: round, role: director.role, projectId });
  let out;
  const cooldown = directorCooldownReason(director, opts.artifactsRoot, startedAt);
  if (cooldown) {
    out = { fail: cooldown, skipped: true };
  } else {
    try {
      if (cliRunner && typeof cliRunner.runBoardNodeAsync === 'function') out = await cliRunner.runBoardNodeAsync(node, dctx, round);
      else if (cliRunner && typeof cliRunner.runNodeAsync === 'function') out = await cliRunner.runNodeAsync(node, dctx, round);
      else out = await Promise.resolve(cliRunner(node, dctx, round));
      out = out || {};
    } catch (e) {
      out = { fail: e && e.message || String(e) };
    }
    if (out && out.fail) out = Object.assign({}, out, { fail: safeBoardText(out.fail, 500) });
    if (out && out.fail) markDirectorCooldown(director, out.fail, opts.artifactsRoot, eventlog);
  }
  const finishedAt = Date.now();
  const attempts = out && out.board_failover && Array.isArray(out.board_failover.attempts)
    ? out.board_failover.attempts
    : [];
  const selectedAttempt = attempts.find(row => row && row.ok) || attempts[attempts.length - 1] || null;
  const sourceRunner = selectedAttempt && selectedAttempt.runner || director.runner;
  const opinion = Object.assign(parseOpinion(out, director, round), {
    proposer_role: director.role,
    canonical_role: BoardEvidenceMerge.canonicalRole(director.role),
    source_task: taskId,
    source_trace: projectEvidenceLineRef(
      out && out.evidence && out.evidence.path,
      opts.ctx && opts.ctx.workspaceRoot,
    ),
    source_runner: sourceRunner,
    reasoning_source_id: `${director.role}:${sourceRunner}`,
    transport_fallback_used: !!(out && out.board_failover && out.board_failover.used_fallback),
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(finishedAt).toISOString(),
    duration_ms: Math.max(0, finishedAt - startedAt),
  });
  if (opinion.absent) {
    eventlog && eventlog.emit('node.absent', { task: taskId, node: node.id, attempt: round, role: director.role, reason: opinion.absence_reason, projectId });
    eventlog && eventlog.emit('board.review.director.absent', { task: taskId, projectId, round, director: director.id, role: director.role, reason: opinion.absence_reason });
  } else if (out.fail) eventlog && eventlog.emit('node.fail', { task: taskId, node: node.id, attempt: round, role: director.role, reason: out.fail, projectId });
  else eventlog && eventlog.emit('node.end', { task: taskId, node: node.id, attempt: round, role: director.role, projectId });
  eventlog && eventlog.emit('board.review.director.done', {
    task: taskId,
    projectId,
    round,
    director: director.id,
    role: director.role,
    failed: opinion.failed,
    absent: opinion.absent,
    startedAt: opinion.started_at,
    finishedAt: opinion.finished_at,
    durationMs: opinion.duration_ms,
  });
  eventlog && eventlog.emit('board.review.opinion', {
    task: taskId,
    projectId,
    round,
    director: director.id,
    riskLevel: opinion.risk_level,
    canExecute: opinion.can_execute,
    misjudgmentRisk: opinion.misjudgment_risk,
    hardBlock: opinion.hard_block,
    absent: opinion.absent,
    issueCount: opinion.issues.length,
  });
  settleDirectorOpinion({
    file: settlementFile,
    taskId,
    projectId,
    round,
    // 拍板 Q11 ③:expectedDirectors 按本次实际派席数计算,不再定值 DIRECTORS.length。
    directorCount: Math.max(1, Number(expectedDirectors) || DIRECTORS.length),
    opinion,
    eventlog,
  });
  return opinion;
}

async function runBoardReview(opts) {
  const spec = opts.spec || {};
  const taskId = opts.taskId || spec.taskId || `board-${Date.now()}`;
  const eventlog = opts.eventlog;
  const cliRunner = opts.cliRunner;
  const projectId = opts.projectId || spec.projectId || null;
  const artifactsRoot = opts.artifactsRoot || path.join(__dirname, 'artifacts');
  const memoryFile = opts.memoryFile;
  const assessment = opts.assessment || shouldRunBoardReview(spec, opts.planText || '');
  if (!assessment.important) return { required: false, ok: true, assessment };
  if (!cliRunner) return { required: true, ok: false, reason: 'missing cliRunner', assessment };
  const maxRounds = opts.maxRounds || boardReviewMaxRounds();

  // 拍板 Q11 分级:高危/显式点名/跨项目=full(全体);普通架构=light(轮值+终审 2 席)。
  const tiering = reviewTierFor({ spec, assessment, taskId });
  const panel = tiering.directors;
  const panelIds = panel.map(d => d.id);

  let instruction = String(spec.goal || opts.ctx && opts.ctx.goal || '').trim();
  const originalInstruction = instruction;
  const previousRounds = [];
  let boardContext = null;
  const mergeActivation = BoardEvidenceMerge.activationState({
    approvalFile: opts.boardEvidenceMergeApprovalFile,
    env: opts.env || process.env,
  });
  if (mergeActivation.active) {
    try {
    const prepared = BoardContextRef.prepareBoardContextRef({
      instruction,
      planText: opts.planText || '',
      taskId,
      artifactsRoot,
      workspaceRoot: opts.ctx && opts.ctx.workspaceRoot || path.resolve(__dirname, '../..'),
    });
    if (prepared.enabled) {
      const legacyPrompts = panel.map(director => makeLegacyDirectorGoal({
        director,
        round: 1,
        maxRounds,
        instruction,
        planText: opts.planText || '',
        previousRounds: [],
        projectId,
      }));
      const materializedPrompts = panel.map((director, index) => {
        const thin = makeDirectorGoal({
          director,
          round: 1,
          maxRounds,
          instruction,
          planText: opts.planText || '',
          previousRounds: [],
          projectId,
          boardContext: prepared,
        });
        const delivered = BoardContextRef.materializeContextOnce(thin, prepared);
        return delivered.ok ? delivered.goal : legacyPrompts[index];
      });
      const measurement = BoardContextRef.measurePromptReduction(legacyPrompts, materializedPrompts);
      if (measurement.lower_input_tokens) {
        const metricsFile = path.join(path.dirname(prepared.contextFile), 'prompt-reduction.json');
        const workspaceRoot = opts.ctx && opts.ctx.workspaceRoot || path.resolve(__dirname, '../..');
        const metricsPathRaw = path.relative(workspaceRoot, metricsFile);
        const metricsPath = metricsPathRaw && !metricsPathRaw.startsWith(`..${path.sep}`) && !path.isAbsolute(metricsPathRaw)
          ? metricsPathRaw.split(path.sep).join('/')
          : metricsFile;
        BoardContextRef.writeJsonAtomic(metricsFile, {
          schema: 'yutu6-board-context-ref-metrics@1',
          task_id: taskId,
          context_ref: prepared.ref,
          context_manifest: prepared.manifest,
          semantic_equivalence: prepared.semanticEquivalent ? 'verified_exact_titled_blocks_and_server_materialization' : 'unverified',
          usage_status: 'pending_provider_response',
          panel: panelIds,
          role_count: panel.length,
          original_block_count: prepared.originalBlockCount,
          unique_block_count: prepared.uniqueBlockCount,
          reused_block_copies: prepared.reusedBlockCopies,
          measurement,
        });
        boardContext = Object.assign({}, prepared, { metrics: metricsPath, measurement });
        eventlog && eventlog.emit('board.review.context_ref.prepared', {
          task: taskId,
          projectId,
          context_ref: prepared.ref,
          context_sha256: prepared.sha256,
          manifest: prepared.manifest,
          metrics: metricsPath,
          semantic_equivalence: true,
          role_count: panel.length,
          original_block_count: prepared.originalBlockCount,
          unique_block_count: prepared.uniqueBlockCount,
          local_estimate_only: true,
          reduced_estimated_input_tokens: measurement.reduced_estimated_input_tokens,
          reduction_ratio: measurement.reduction_ratio,
        });
      } else {
        eventlog && eventlog.emit('board.review.context_ref.skipped', {
          task: taskId,
          projectId,
          reason: 'no_measured_input_token_reduction',
        });
      }
    } else {
      eventlog && eventlog.emit('board.review.context_ref.skipped', {
        task: taskId,
        projectId,
        reason: prepared.reason,
      });
    }
  } catch (error) {
    // Context reuse is an optimization. Any parse/write/verification problem keeps
    // the legacy full prompt so uncertain blocks are never dropped.
    eventlog && eventlog.emit('board.review.context_ref.skipped', {
      task: taskId,
      projectId,
      reason: `context_ref_error:${safeBoardText(error && error.message || error, 240)}`,
    });
    boardContext = null;
    }
  } else {
    eventlog && eventlog.emit('board.review.context_ref.skipped', {
      task: taskId,
      projectId,
      reason: mergeActivation.reason,
      feature_flag: mergeActivation.feature_flag,
      owner_approved: mergeActivation.owner_approved,
    });
  }
  eventlog && eventlog.emit('board.review.required', {
    task: taskId,
    projectId,
    reason: assessment.reason,
    matches: assessment.matches || [],
    labels: assessment.labels || [],
    tier: tiering.tier,
    tierReason: tiering.tierReason,
    directors: panelIds,
    directorCount: panelIds.length,
  });

  for (let round = 1; round <= maxRounds; round++) {
    const settlementFile = settlementFileFor(artifactsRoot, taskId, round);
    eventlog && eventlog.emit('board.review.round.start', { task: taskId, projectId, round, maxRounds, directorCount: panel.length, tier: tiering.tier, directors: panelIds });
    eventlog && eventlog.emit('board.review.parallel.start', { task: taskId, projectId, round, directorCount: panel.length, tier: tiering.tier, directors: panelIds });
    const opinions = await Promise.all(panel.map(director => runDirectorOpinion({
      director,
      round,
      maxRounds,
      instruction,
      previousRounds,
      boardContext,
      opts,
      taskId,
      projectId,
      settlementFile,
      expectedDirectors: panel.length,
    })));
    eventlog && eventlog.emit('board.review.parallel.end', { task: taskId, projectId, round, directorCount: panel.length, tier: tiering.tier, directors: panelIds });
    let mergeContract = null;
    let mergeArtifact = null;
    if (mergeActivation.shadow_enabled || mergeActivation.active) {
      try {
        mergeContract = BoardEvidenceMerge.buildMergeContract(opinions, {
          taskId,
          round,
          active: mergeActivation.active,
          ownerApproval: mergeActivation.approval_record,
          suggestionApprovals: opts.boardSuggestionApprovals || [],
          reproductionReceipts: opts.boardReproductionReceipts || [],
          reproductionReceiptsTrusted: opts.boardReproductionReceiptsTrusted === true,
          workspaceRoot: opts.ctx && opts.ctx.workspaceRoot || path.resolve(__dirname, '../..'),
        });
        mergeArtifact = BoardEvidenceMerge.writeMergeContract(mergeContract, { artifactsRoot, taskId, round });
        eventlog && eventlog.emit(mergeActivation.active
          ? 'board.review.evidence_merge.active'
          : 'board.review.evidence_merge.shadow', {
          task: taskId,
          projectId,
          round,
          artifact: mergeArtifact,
          item_count: mergeContract.item_count,
          classifications: mergeContract.items.reduce((out, item) => {
            out[item.classification] = (out[item.classification] || 0) + 1;
            return out;
          }, {}),
          active: mergeActivation.active,
          owner_approved: mergeActivation.owner_approved,
        });
      } catch (error) {
        eventlog && eventlog.emit('board.review.evidence_merge.failed_closed', {
          task: taskId,
          projectId,
          round,
          reason: safeBoardText(error && error.message || error, 300),
          active: mergeActivation.active,
        });
        mergeContract = null;
        mergeArtifact = null;
      }
    }
    const integrated = integrateRound(instruction, opinions, round, maxRounds, {
      active: mergeActivation.active,
      mergeContract,
    });
    previousRounds.push({
      round,
      opinions,
      summary: integrated.summary,
      revisedInstruction: integrated.revisedInstruction,
      evidence_merge_activation: {
        active: mergeActivation.active,
        feature_flag: mergeActivation.feature_flag,
        owner_approved: mergeActivation.owner_approved,
        reason: mergeActivation.reason,
      },
      evidence_merge_contract: mergeContract,
      evidence_merge_artifact: mergeArtifact,
    });
    eventlog && eventlog.emit('board.review.round.end', {
      task: taskId,
      projectId,
      round,
      maxRounds,
      issueCount: integrated.issueCount,
      absentCount: integrated.absentCount,
      presentCount: integrated.presentCount,
      directorCount: integrated.directorCount,
      absenceMajority: integrated.absenceMajority,
      riskyCount: integrated.riskyCount,
      continue: integrated.shouldContinue,
    });
    instruction = integrated.revisedInstruction;
    if (integrated.absenceMajority) {
      const quorumOpinion = absenceMajorityOpinion(opinions, integrated);
      const card = createOwnerDecisionCard({
        spec,
        projectId,
        taskId,
        instruction,
        finalOpinion: quorumOpinion,
        rounds: previousRounds,
        artifactsRoot,
        notify: opts.notify,
      });
      appendDecisionMemory(memoryFile, {
        stamp: new Date().toISOString(),
        task: spec.originalGoal || originalInstruction,
        reason: assessment.reason,
        labels: assessment.labels || [],
        rounds: round,
        maxRounds,
        status: '等待主人拍板',
        summary: quorumOpinion.summary,
        decisionId: card.id,
      });
      eventlog && eventlog.emit('board.review.quorum_lost', {
        task: taskId,
        projectId,
        round,
        absentCount: integrated.absentCount,
        presentCount: integrated.presentCount,
        directorCount: integrated.directorCount,
        decisionId: card.id,
        bulletinId: card.card && card.card.id,
        tier: tiering.tier,
        directors: panelIds,
      });
      eventlog && eventlog.emit('board.review.await_owner', {
        task: taskId,
        projectId,
        rounds: round,
        maxRounds,
        reason: 'director_absence_majority',
        decisionId: card.id,
        bulletinId: card.card && card.card.id,
        tier: tiering.tier,
        directors: panelIds,
      });
      return {
        required: true,
        ok: false,
        paused: true,
        reason: `董事缺席过半(${integrated.absentCount}/${integrated.directorCount}),已生成决策卡 ${card.card.id}`,
        decisionId: card.id,
        card,
        rounds: previousRounds,
        maxRounds,
        assessment,
        tier: tiering.tier,
        directors: panelIds,
      };
    }
    if (!integrated.shouldContinue) {
      if (integrated.riskyCount > 0 && round >= maxRounds) break;
      appendDecisionMemory(memoryFile, {
        stamp: new Date().toISOString(),
        task: spec.originalGoal || originalInstruction,
        reason: assessment.reason,
        labels: assessment.labels || [],
        rounds: round,
        maxRounds,
        status: '默认执行',
        summary: integrated.summary,
      });
      eventlog && eventlog.emit('board.review.approved', {
        task: taskId,
        projectId,
        rounds: round,
        maxRounds,
        decision: 'default_execute',
        tier: tiering.tier,
        directors: panelIds,
      });
      return { required: true, ok: true, approved: true, paused: false, rounds: previousRounds, maxRounds, revisedGoal: instruction, assessment, tier: tiering.tier, directors: panelIds };
    }
  }

  const last = previousRounds[previousRounds.length - 1] || { opinions: [] };
  const finalDirector = last.opinions.find(op => op.director === 'board_opus48') || last.opinions[last.opinions.length - 1] || null;
  const finalHardBlock = !!(finalDirector && !finalDirector.absent && (finalDirector.failed || finalDirector.hard_block || finalDirector.misjudgment_risk === true));
  if (finalHardBlock) {
    const card = createOwnerDecisionCard({
      spec,
      projectId,
      taskId,
      instruction,
      finalOpinion: finalDirector,
      rounds: previousRounds,
      artifactsRoot,
      notify: opts.notify,
    });
    appendDecisionMemory(memoryFile, {
      stamp: new Date().toISOString(),
      task: spec.originalGoal || originalInstruction,
      reason: assessment.reason,
      labels: assessment.labels || [],
      rounds: maxRounds,
      maxRounds,
      status: '等待主人拍板',
      summary: finalDirector.summary || (finalDirector.issues || [])[0] || '单轮事前评审仍判存在硬阻断/误判风险',
      decisionId: card.id,
    });
    eventlog && eventlog.emit('board.review.await_owner', {
      task: taskId,
      projectId,
      rounds: maxRounds,
      maxRounds,
      decisionId: card.id,
      bulletinId: card.card && card.card.id,
      tier: tiering.tier,
      directors: panelIds,
    });
    return {
      required: true,
      ok: false,
      paused: true,
      reason: `董事会 ${maxRounds} 轮事前评审后仍判有硬阻断/误判风险,已生成决策卡 ${card.card.id}`,
      decisionId: card.id,
      card,
      rounds: previousRounds,
      maxRounds,
      assessment,
      tier: tiering.tier,
      directors: panelIds,
    };
  }

  appendDecisionMemory(memoryFile, {
    stamp: new Date().toISOString(),
    task: spec.originalGoal || originalInstruction,
    reason: assessment.reason,
    labels: assessment.labels || [],
    rounds: maxRounds,
    maxRounds,
    status: '默认执行',
    summary: '单轮事前评审未判硬阻断/误判风险,按方案默认执行。',
  });
  eventlog && eventlog.emit('board.review.approved', {
    task: taskId,
    projectId,
    rounds: maxRounds,
    maxRounds,
    decision: 'default_execute_after_preflight',
    tier: tiering.tier,
    directors: panelIds,
  });
  return { required: true, ok: true, approved: true, paused: false, rounds: previousRounds, maxRounds, revisedGoal: instruction, assessment, tier: tiering.tier, directors: panelIds };
}

module.exports = {
  DIRECTORS,
  MAX_ROUNDS: DEFAULT_MAX_ROUNDS,
  assessTask,
  shouldRunBoardReview,
  runBoardReview,
  settleDirectorOpinion,
  _test: {
    configFile,
    readBoardReviewControl,
    boardReviewMaxRounds,
    parseOpinion,
    projectEvidenceLineRef,
    integrateRound,
    absenceMajorityOpinion,
    opinionNeedsMoreRounds,
    makeDirectorGoal,
    makeLegacyDirectorGoal,
    createOwnerDecisionCard,
    shortTask,
    consoleDecisionUrl,
    structuredBoardAssessment,
    classifyRunnerHealthFailure,
    directorCooldownReason,
    markDirectorCooldown,
    settlementFileFor,
    settleDirectorOpinion,
    stripSecretaryContextPack,
    buildRevisedInstruction,
    boardTieredEnabled,
    rotatingDirectorFor,
    reviewTierFor,
    HIGH_RISK_TIER_AREAS,
    prepareBoardContextRef: BoardContextRef.prepareBoardContextRef,
    measurePromptReduction: BoardContextRef.measurePromptReduction,
  },
};
