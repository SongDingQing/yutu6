'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Q = require('../../shared/engine/queue');
const InsightsMaintenance = require('../../board/insights/scripts/maintain-insights');

const AGENT = 'insight-scout';
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_PRIORITY = 95;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const TOPICS = [
  { id: 'multi-agent-orchestration', label: '多智能体编排 / 任务 DAG / 交接协议' },
  { id: 'agent-harness', label: 'Agent harness / ReAct / Reflexion / SWE-bench / 质量监管' },
  { id: 'queue-engine', label: '任务队列引擎 / 调度可靠性 / 失败处置' },
  { id: 'agent-tools-skills', label: 'AI agent 工具 / skills / 能力库治理' },
  { id: 'llm-gateway', label: 'LLM 网关 / 成本质量路由 / 可观测' },
  { id: 'gui-grounding', label: 'GUI grounding / computer-use / a11y' },
  { id: 'pixel-assets-ui', label: '像素素材生成 / 控制台优秀网页设计' },
  { id: 'unity-simulaid-methods', label: 'Unity/团结工作流方法论(Simulaid 仅作泛化方法,不触碰项目)' },
];

function nowIso() {
  return new Date().toISOString();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function beijingParts(ms) {
  const d = new Date(Number(ms || Date.now()) + BEIJING_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
  };
}

function beijingSlot(nowMs = Date.now(), intervalMs = DEFAULT_INTERVAL_MS) {
  const intervalHours = Math.max(1, Math.round(Number(intervalMs || DEFAULT_INTERVAL_MS) / (60 * 60 * 1000)) || 4);
  const parts = beijingParts(nowMs);
  const bucketHour = Math.floor(parts.hour / intervalHours) * intervalHours;
  const dayKey = `${parts.year}${pad2(parts.month)}${pad2(parts.day)}`;
  const key = `${dayKey}-${pad2(bucketHour)}`;
  const dayStartUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) - BEIJING_OFFSET_MS;
  const slotStartMs = dayStartUtcMs + bucketHour * 60 * 60 * 1000;
  const index = Math.floor((slotStartMs + BEIJING_OFFSET_MS) / Math.max(1, Number(intervalMs || DEFAULT_INTERVAL_MS)));
  return {
    key,
    dayKey,
    hour: bucketHour,
    startAt: new Date(slotStartMs).toISOString(),
    nextAt: new Date(slotStartMs + Number(intervalMs || DEFAULT_INTERVAL_MS)).toISOString(),
    index,
  };
}

function topicForSlot(slot) {
  const index = Math.abs(Number(slot && slot.index) || 0) % TOPICS.length;
  return TOPICS[index];
}

function safeId(s, fallback = '') {
  const id = String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return id || fallback;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

// 文件不存在=正常初始化;文件存在但解析失败=先备份 .corrupt-<ts> 再自愈重建,
// 防 seen-repos 去重库 / 公告卡历史被静默清空(读坏→fallback 空→writeJsonAtomic 覆盖)。
function readJsonWithCorruptBackup(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (_) { return fallback; }
  try { return JSON.parse(raw); }
  catch (_) {
    try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch (_) {}
    return fallback;
  }
}

function jsonBlocks(text) {
  const out = [];
  const re = /```json\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
  return out;
}

function jsonCandidateBlocks(text) {
  const source = String(text || '');
  const out = jsonBlocks(source);
  const unclosed = /```json\s*([\s\S]*)$/i.exec(source);
  if (unclosed) out.push(unclosed[1].trim());
  return out;
}

function parseInsightJsonBlocks(text) {
  const blocks = jsonBlocks(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(blocks[i]);
      const normalized = normalizeInsightOutput(parsed);
      if (normalized) return normalized;
    } catch (_) {}
  }
  return null;
}

function unescapeLooseJsonString(value) {
  return String(value || '')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looseStringField(text, key, nextKeys = []) {
  const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'm');
  const keyMatch = keyRe.exec(String(text || ''));
  if (!keyMatch) return '';
  const rest = String(text || '').slice(keyMatch.index + keyMatch[0].length);
  let end = -1;
  for (const nextKey of nextKeys) {
    const nextRe = new RegExp(`"\\s*,\\s*\\n?\\s*"${escapeRegExp(nextKey)}"\\s*:`, 'm');
    const m = nextRe.exec(rest);
    if (m && (end === -1 || m.index < end)) end = m.index;
  }
  if (end === -1) {
    const closeRe = /"\s*(?:,?\s*\n\s*[}\]]|$)/m;
    const m = closeRe.exec(rest);
    if (m) end = m.index;
  }
  if (end === -1) return unescapeLooseJsonString(rest);
  return unescapeLooseJsonString(rest.slice(0, end));
}

function looseStringArray(text, key) {
  const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\[`, 'm');
  const keyMatch = keyRe.exec(String(text || ''));
  if (!keyMatch) return [];
  const rest = String(text || '').slice(keyMatch.index + keyMatch[0].length);
  const end = rest.indexOf(']');
  if (end < 0) return [];
  const raw = rest.slice(0, end);
  const out = [];
  const valueRe = /"([^"\n\r]*)"/g;
  let m;
  while ((m = valueRe.exec(raw))) out.push(unescapeLooseJsonString(m[1]));
  return out.filter(Boolean);
}

function firstObjectInArray(text, key) {
  const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\[\\s*\\{`, 'm');
  const keyMatch = keyRe.exec(String(text || ''));
  if (!keyMatch) return '';
  const rest = String(text || '').slice(keyMatch.index + keyMatch[0].length);
  const end = rest.search(/\}\s*\]/m);
  return end < 0 ? '' : rest.slice(0, end);
}

function looseInsightScoutBlock(block) {
  const text = String(block || '');
  if (!/"insight_scout"\s*:/.test(text)) return null;
  const output = {
    done: !/"done"\s*:\s*false/i.test(text),
    slot: looseStringField(text, 'slot', ['topic']),
    topic: looseStringField(text, 'topic', ['network_status', 'networkStatus']),
    network_status: looseStringField(text, 'network_status', ['analysis_markdown', 'analysisMarkdown'])
      || looseStringField(text, 'networkStatus', ['analysis_markdown', 'analysisMarkdown']),
    analysis_markdown: looseStringField(text, 'analysis_markdown', ['seen_repos', 'seenRepos'])
      || looseStringField(text, 'analysisMarkdown', ['seen_repos', 'seenRepos']),
    seen_repos: looseStringArray(text, 'seen_repos').concat(looseStringArray(text, 'seenRepos')),
    bulletin_cards: [],
  };
  const card = firstObjectInArray(text, 'bulletin_cards') || firstObjectInArray(text, 'bulletinCards');
  if (card) {
    output.bulletin_cards.push({
      title: looseStringField(card, 'title', ['desc', 'description']),
      desc: looseStringField(card, 'desc', ['target', 'project', 'goal'])
        || looseStringField(card, 'description', ['target', 'project', 'goal']),
      target: looseStringField(card, 'target', ['project', 'goal']) || 'ceo',
      project: looseStringField(card, 'project', ['goal']) || '控制台',
      goal: looseStringField(card, 'goal', []),
    });
  }
  return output.analysis_markdown || output.seen_repos.length || output.bulletin_cards.length ? output : null;
}

function extractInsightScoutOutputFromText(text) {
  const parsed = parseInsightJsonBlocks(text);
  if (parsed) return parsed;
  const blocks = jsonCandidateBlocks(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const loose = looseInsightScoutBlock(blocks[i]);
    if (loose) return loose;
  }
  return null;
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function rel(workspaceRoot, file) {
  const r = path.relative(workspaceRoot, file).split(path.sep).join('/');
  return r && !r.startsWith('..') ? r : file;
}

function queueEntryHit(queueRoot, agent, id) {
  const d = Q.qdir(queueRoot, agent);
  const suffix = `-${id}.json`;
  for (const sub of ['', 'running', 'paused', 'done', 'failed', 'canceled']) {
    const dir = path.join(d, sub);
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) {}
    const hit = files.find(file => sub ? file === `${id}.json` : file.endsWith(suffix));
    if (hit) return { state: sub || 'queued', file: path.join(dir, hit) };
  }
  return null;
}

function activeItems(queueRoot, agent = AGENT) {
  const listed = Q.list(queueRoot, agent);
  return []
    .concat((listed.queued || []).map(entry => ({ id: entry.id, state: 'queued', goal: taskText(entry.task) })))
    .concat((listed.running || []).map(entry => ({ id: entry.id, state: 'running', goal: taskText(entry.task) })))
    .concat((listed.paused || []).map(entry => ({ id: entry.id, state: 'paused', goal: taskText(entry.task) })));
}

function taskText(task) {
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    return String(task.title || task.goal || task.message || task.task || task.idem || '').slice(0, 240);
  }
  return String(task || '').slice(0, 240);
}

function makeTask(slot, opts = {}) {
  const topic = opts.topic || topicForSlot(slot);
  const agentHarnessTopic = topic.id === 'agent-harness';
  const id = safeId(opts.id || `insight-scout-repos-${slot.key}`, `insight-${slot.key}`);
  const goal = [
    `你是洞察员 insight-scout 的每 4 小时自动借鉴扫描任务。slot=${slot.key}, 北京时间窗口起点=${slot.startAt}, 主题=${topic.label}。`,
    '',
    '必须遵守:',
    '- 不登录、不处理 OAuth/扫码/2FA/token,不回显密钥。',
    '- 不安装依赖、不改运行代码;洞察员只产出借鉴分析和公告板候选。',
    '',
    '工作步骤:',
    '1. 先依据 `board/insights/seen-repos.json` 的 repos URL 列表、`board/insights/borrowed-libs.md`、`board/insights/insights.md` 热区做去重,避免重复推荐相同 URL。',
    '   - `insights.md` 只保留最近 4 个批次;不要把 `references/archive-*.md` 整卷读入上下文。',
    '   - 只有需要核对旧仓库/旧 slot/旧标题时,才用 `rg "<URL或仓库名>" board/insights/references/` 定位命中归档并只读相关小节。',
    '2. 围绕本轮主题找 2-3 个公开优秀案例,记录 URL、许可证/授权不确定项、可借鉴点和迁移边界。',
    ...(agentHarnessTopic ? [
      '   - 本轮为 agent harness 轻扫:先读 `.agents/skills/agent-harness-research/SKILL.md`,优先复看指定的教程/论文/官方仓库;仍遵守 2-3 个案例上限。',
      '   - 只有主人点名“深研/全面”时才切换 15-50 条候选模式,避免定时扫描放大 token 消耗。',
    ] : []),
    '3. 如果当前 runner 没有联网/WebSearch 能力,必须明确 `network_status=unavailable` 或 `limited`,不要虚构实时 star、commit 或 release;可基于既有 watch 清单做复看/整理建议。',
    '4. 输出内容应沉淀为 `board/insights/insights.md` 的一节;只有分析出明确、低风险、该进入 CEO 取舍的行动时,才生成公告板卡。',
    '5. 最终只输出一个 `json` 代码块;不要在 JSON 外另写正文、结构化验收表、预览或总结,避免输出过长导致 JSON 截断。',
    '6. `analysis_markdown` 控制在 1600 个中文字符以内;每个案例最多 4 条短句。必须先填 `seen_repos` 和 `bulletin_cards`,再填 `analysis_markdown`。',
    '',
    '最后必须输出 JSON 代码块,由引擎自动落盘:',
    '```json',
    JSON.stringify({
      insight_scout: {
        done: true,
        slot: slot.key,
        topic: topic.id,
        network_status: 'available|limited|unavailable',
        seen_repos: ['https://github.com/example/repo'],
        bulletin_cards: [{
          title: '可选:一句话行动标题',
          desc: '可选:为什么值得 CEO/主管考虑',
          target: 'ceo',
          project: '控制台',
          goal: '可选:给 CEO 的完整待办说明',
        }],
        analysis_markdown: '## <标题>\\n### <repo>\\n- 是什么:...\\n- 值得借鉴:...\\n- 迁移边界/许可证不确定项:...\\n- URL: https://...',
      },
    }, null, 2),
    '```',
  ].join('\n');
  return {
    id,
    agent: AGENT,
    priority: opts.priority == null ? DEFAULT_PRIORITY : opts.priority,
    task: {
      role: 'insight-scout',
      flowId: 'agent-once',
      projectId: '控制台',
      scopedToProject: false,
      title: `洞察员定时扫描 ${slot.key} · ${topic.label}`,
      idem: `insight-scout-repos:${slot.key}`,
      useOrchestrator: false,
      autoApproveHuman: true,
      nodeTimeoutSec: 1800,
      structuredAcceptance: false,
      insightScoutRepos: {
        slot: slot.key,
        topic: topic.id,
        topicLabel: topic.label,
        source: 'insight-scout-repos',
      },
      bounds: '洞察员定时研究; 密钥不回显; 不登录不授权; 不安装依赖不改运行代码; 只写 board/insights 与公告板候选。',
      inputs: [
        'board/insights/seen-repos.json',
        'board/insights/borrowed-libs.md',
        'board/insights/insights.md',
        'board/insights/references/archive-index.md(按需)',
        ...(agentHarnessTopic ? ['.agents/skills/agent-harness-research/SKILL.md'] : []),
      ],
      resourceDomains: {
        read: ['insights'],
        write: ['insights'],
      },
      acceptance: '输出 insight_scout JSON; 引擎自动将 analysis_markdown 追加到 board/insights/insights.md,将 bulletin_cards 写入 artifacts/bulletin/cards.json(source=洞察员),并更新 seen-repos 去重库。',
      goal,
    },
    slot,
    topic,
  };
}

function enqueueDue(opts = {}) {
  const queueRoot = opts.queueRoot;
  if (!queueRoot) throw new Error('queueRoot required');
  const intervalMs = Number(opts.intervalMs || DEFAULT_INTERVAL_MS);
  const slot = opts.slot || beijingSlot(opts.nowMs == null ? Date.now() : opts.nowMs, intervalMs);
  const job = makeTask(slot, { priority: opts.priority == null ? DEFAULT_PRIORITY : opts.priority, topic: opts.topic, id: opts.id });
  const existing = queueEntryHit(queueRoot, AGENT, job.id);
  if (existing) {
    return { ok: true, action: 'skip', reason: `already-${existing.state}`, agent: AGENT, id: job.id, slot, existing };
  }
  const active = activeItems(queueRoot, AGENT).filter(item => item.id !== job.id);
  if (active.length && !opts.allowConcurrent) {
    return { ok: true, action: 'skip', reason: 'already-active', agent: AGENT, id: job.id, slot, active };
  }
  if (opts.dryRun) return { ok: true, action: 'would-enqueue', agent: AGENT, id: job.id, slot, topic: job.topic, priority: job.priority };
  const entry = Q.enqueue(queueRoot, AGENT, job.task, {
    id: job.id,
    priority: job.priority,
    idem: job.task.idem,
  });
  if (opts.eventlog && typeof opts.eventlog.emit === 'function') {
    opts.eventlog.emit('insight_scout.repos.enqueued', {
      queueAgent: AGENT,
      queueId: entry.id,
      slot: slot.key,
      topic: job.topic.id,
      intervalMs,
      priority: entry.priority,
      source: opts.source || 'insight-scout-repos',
    });
    opts.eventlog.emit('queue.enqueued', {
      queueAgent: AGENT,
      queueId: entry.id,
      priority: entry.priority,
      goal: taskText(entry.task),
      source: opts.source || 'insight-scout-repos',
    });
  }
  return { ok: true, action: 'enqueued', agent: AGENT, entry, slot, topic: job.topic, nextAt: slot.nextAt };
}

function normalizeInsightOutput(output) {
  const hasWrapper = !!(output && (output.insight_scout || output.insightScout));
  const raw = output && (output.insight_scout || output.insightScout || output);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hasPayload = hasWrapper
    || typeof raw.analysis_markdown === 'string'
    || typeof raw.analysisMarkdown === 'string'
    || Array.isArray(raw.seen_repos)
    || Array.isArray(raw.seenRepos)
    || Array.isArray(raw.bulletin_cards)
    || Array.isArray(raw.bulletinCards);
  if (!hasPayload) return null;
  return raw;
}

function normalizeRepoUrl(url) {
  const s = String(url || '').trim();
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s#?]+/i.test(s)) return '';
  return s.replace(/\.git$/i, '').replace(/\/+$/, '');
}

function githubUrlsFromText(text) {
  const urls = [];
  // 只收 GitHub 合法名字符(含 .),不含反斜杠——防字面量 \n 被吞进 URL(治 seen-repos 脏条目);
  // 带点 repo 名(socket.io/next.js)完整保留,句末英文句点再单独剥掉。
  const re = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const url = normalizeRepoUrl(m[0].replace(/\.+$/, ''));
    if (url) urls.push(url);
  }
  return Array.from(new Set(urls));
}

function updateSeenRepos(file, urls) {
  const clean = Array.from(new Set((urls || []).map(normalizeRepoUrl).filter(Boolean)));
  const data = readJsonWithCorruptBackup(file, {});
  const slim = InsightsMaintenance.slimSeenReposData(data, { urlsToAdd: clean, nowIso: nowIso() });
  if (!slim.changed) return { updated: false, added: [] };
  writeJsonAtomic(file, slim.data);
  return { updated: true, added: slim.added };
}

function appendInsights(file, marker, header, markdown) {
  const text = String(markdown || '').trim();
  if (!text) return { appended: false, reason: 'empty' };
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# 洞察员 · 借鉴分析(insights)\n';
  if (current.includes(marker)) return { appended: false, reason: 'already-applied' };
  const block = [
    '',
    '',
    marker,
    header,
    '',
    text,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, block);
  return { appended: true, bytes: Buffer.byteLength(block) };
}

function fingerprintText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。；：、,.!?！？;:()[\]{}"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cardFingerprint(card) {
  if (!card || typeof card !== 'object') return '';
  const payload = card.payload && typeof card.payload === 'object' ? card.payload : {};
  const material = [
    card.target || payload.target || 'ceo',
    card.project || payload.projectId || '控制台',
    card.title,
    payload.goal || card.goal || card.desc || card.description,
  ].map(fingerprintText).join('\n');
  return material.trim()
    ? crypto.createHash('sha256').update(material).digest('hex')
    : '';
}

function normalizeCard(card, defaults = {}) {
  if (!card || typeof card !== 'object') return null;
  const title = String(card.title || '').trim().slice(0, 140);
  if (!title) return null;
  const desc = String(card.desc || card.description || '').trim().slice(0, 1200);
  const target = safeId(card.target || 'ceo', 'ceo');
  const project = String(card.project || '控制台').slice(0, 80);
  const source = '洞察员';
  const goal = String(card.goal || `${title}${desc ? '\n\n' + desc : ''}`).trim();
  const baseId = safeId(card.id || `insight-${crypto.createHash('sha1').update([defaults.slot || '', title, goal].join('\n')).digest('hex').slice(0, 10)}`);
  const normalized = {
    id: baseId,
    title,
    desc,
    target,
    project,
    source,
    payload: {
      role: target === 'ceo' ? 'orchestrator' : target,
      flowId: target === 'ceo' ? 'project-route' : 'agent-once',
      projectId: project,
      goal,
      bounds: '只处理本洞察员公告板候选; 密钥不回显; 登录/授权交主人手动; 是否采纳由 CEO/主管决定。',
      acceptance: '任务有事件日志可追踪; 产物路径清楚; 不需要视觉时无需截图。',
      useOrchestrator: target === 'ceo',
      autoApproveHuman: true,
      // 自动洞察默认只做一次普通生成/复核，不进入多轮 loop engineering。
      // 真正的运行时改造仍由主人启用后走现有 CEO/董事会/主管门禁。
      loopEngineering: false,
      insightWorkload: {
        schemaVersion: 1,
        mode: String(defaults.mode || 'light'),
        proposalOnly: true,
      },
    },
    status: 'todo',
    created_at: nowIso(),
    enabled_at: null,
    queueId: null,
  };
  normalized.insight_fingerprint = cardFingerprint(normalized);
  normalized.payload.insightWorkload.fingerprint = normalized.insight_fingerprint;
  return normalized;
}

function appendBulletinCards(file, cards, defaults = {}) {
  const normalized = (cards || []).map(card => normalizeCard(card, defaults)).filter(Boolean);
  if (!normalized.length) return { added: [], skipped: [] };
  const existing = readJsonWithCorruptBackup(file, []);
  const list = Array.isArray(existing) ? existing : [];
  const ids = new Set(list.map(card => card && card.id).filter(Boolean));
  const fingerprints = new Set(list.map(card => card && (card.insight_fingerprint || cardFingerprint(card))).filter(Boolean));
  const added = [];
  const skipped = [];
  for (const card of normalized) {
    if (ids.has(card.id)) {
      skipped.push({ id: card.id, reason: 'duplicate-id' });
      continue;
    }
    if (card.insight_fingerprint && fingerprints.has(card.insight_fingerprint)) {
      skipped.push({ id: card.id, reason: 'duplicate-content', fingerprint: card.insight_fingerprint });
      continue;
    }
    ids.add(card.id);
    if (card.insight_fingerprint) fingerprints.add(card.insight_fingerprint);
    list.unshift(card);
    added.push(card);
  }
  if (added.length) writeJsonAtomic(file, list);
  return { added, skipped };
}

function applyInsightScoutOutput(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || path.resolve(__dirname, '../..');
  const artifactsRoot = opts.artifactsRoot || path.join(__dirname, 'artifacts');
  const output = normalizeInsightOutput(opts.output);
  if (!output) return { ok: false, reason: 'missing insight_scout JSON' };
  if (output.done === false) return { ok: false, reason: String(output.reason || 'insight_scout.done=false') };
  const taskId = String(opts.taskId || output.taskId || '').trim();
  const queueAgent = opts.queueAgent || AGENT;
  const queueId = opts.queueId || null;
  const slot = String(output.slot || opts.slot || '').trim();
  const topic = String(output.topic || opts.topic || '').trim();
  const markerKey = taskId || `${slot}:${queueAgent}:${queueId || ''}`;
  const marker = `<!-- insight-scout-run:${markerKey} -->`;
  const insightsFile = path.join(workspaceRoot, 'board', 'insights', 'insights.md');
  const seenReposFile = path.join(workspaceRoot, 'board', 'insights', 'seen-repos.json');
  const bulletinFile = path.join(artifactsRoot, 'bulletin', 'cards.json');
  const analysis = String(output.analysis_markdown || output.analysisMarkdown || '').trim();
  const header = [
    `## ${new Date().toISOString().slice(0, 10)} · 自动洞察(${slot || 'manual'}${topic ? ` · ${topic}` : ''})`,
    '',
    `> 来源:洞察员; run=${taskId || '-'}; queue=${queueAgent}${queueId ? '/' + queueId : ''}; network=${output.network_status || output.networkStatus || 'unknown'}`,
  ].join('\n');
  // N4:只拦"完全没联网"(unavailable)的纯 stub —— 不落盘 insights.md / 不写 seen-repos,
  // 防"凭训练知识堆链接"污染语料与去重库;limited(部分联网,可能有真实内容)放行。
  const net = String(output.network_status || output.networkStatus || '').toLowerCase();
  const degraded = net === 'unavailable';
  let insights;
  let repos;
  let maintenance = null;
  if (degraded) {
    insights = { appended: false, reason: `network-${net || 'unknown'}-skipped` };
    repos = { updated: false, added: [], skipped: `network-${net}` };
  } else {
    const locked = InsightsMaintenance.withInsightsLock(path.dirname(insightsFile), () => {
      const nextInsights = appendInsights(insightsFile, marker, header, analysis);
      const nextRepos = updateSeenRepos(seenReposFile, []
        .concat(output.seen_repos || output.seenRepos || [])
        .concat(githubUrlsFromText(analysis)));
      const nextMaintenance = InsightsMaintenance.maintainInsightsLayout({
        workspaceRoot,
        lock: false,
      });
      return { insights: nextInsights, repos: nextRepos, maintenance: nextMaintenance };
    }, { reason: 'insight-scout-append' });
    insights = locked.insights;
    repos = locked.repos;
    maintenance = locked.maintenance;
  }
  const bulletin = appendBulletinCards(bulletinFile, output.bulletin_cards || output.bulletinCards || [], { slot });
  const result = {
    ok: true,
    taskId,
    queueAgent,
    queueId,
    slot,
    topic,
    insights,
    seenRepos: repos,
    bulletin: {
      added: bulletin.added.map(card => ({ id: card.id, title: card.title, target: card.target, source: card.source })),
      skipped: bulletin.skipped,
    },
    maintenance,
    files: {
      insights: rel(workspaceRoot, insightsFile),
      seenRepos: rel(workspaceRoot, seenReposFile),
      bulletin: rel(workspaceRoot, bulletinFile),
    },
  };
  if (opts.eventlog && typeof opts.eventlog.emit === 'function') {
    opts.eventlog.emit('insight_scout.output_applied', {
      task: taskId || null,
      queueAgent,
      queueId,
      slot: slot || null,
      topic: topic || null,
      insightsAppended: !!insights.appended,
      bulletinAdded: result.bulletin.added.length,
      seenReposAdded: repos.added.length,
      archivedBatches: maintenance && maintenance.insights ? maintenance.insights.archived : 0,
      files: result.files,
    });
  }
  return result;
}

module.exports = {
  AGENT,
  DEFAULT_INTERVAL_MS,
  DEFAULT_PRIORITY,
  TOPICS,
  beijingSlot,
  topicForSlot,
  makeTask,
  enqueueDue,
  queueEntryHit,
  activeItems,
  applyInsightScoutOutput,
  extractInsightScoutOutputFromText,
  _test: {
    normalizeCard,
    cardFingerprint,
    appendBulletinCards,
    updateSeenRepos,
    looseInsightScoutBlock,
    githubUrlsFromText,
    readJsonWithCorruptBackup,
  },
};
