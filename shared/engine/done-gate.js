'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ProtocolGate = require('./protocol-gate');
const WriteAudit = require('./write-audit');

const DELIVERY_NO_CHANGE_RE = /(不改任何文件|无需改文件|不用改文件|不要改任何文件|只读|调研|复盘|报告|评估|清单|说明|确认|冒烟|验证|审查)/i;
const DELIVERY_ACTION_RE = /(修复|修改|改造|实现|新增|接入|落地|合入|调整|重做|重构|代码|源码|文件|页面|布局|前端|UI|HTML|CSS|JS|workspace|server\.js|ceo-worker|shared\/engine|截图|Peekaboo)/i;
const STRUCTURED_ACCEPTANCE_MARKER = '结构化验收表';
const STRUCTURED_ACCEPTANCE_COLUMNS = ['要点', '完成状态(完成/部分/未完成)', '证据位置(文件:行 / git diff / 截图路径)', '备注'];
const STRUCTURED_ACCEPTANCE_TEMPLATE_REL = 'templates/structured-acceptance-table.md';
const ACCEPTANCE_DONE_STATUS = '完成';
const ACCEPTANCE_NOT_DONE_STATUSES = new Set(['部分', '未完成', 'pending', 'partial', 'todo', '']);
const DESIGN_GATE_RE = /(decisions\.md|memory\/decisions|board\/decisions|设计(?:文件|记忆|条目|决策|对照)|按设计|对照设计|设计稿)/i;
const VISUAL_UI_RE = /(视觉|UI|界面|前端|页面|布局|样式|截图|截屏|Peekaboo|screenshot|workspace\.html|html|css|sprite|tile|地块|办公室|图标|按钮|颜色|动效)/i;
const ACCEPTANCE_PLACEHOLDER_BOUNDARY = String.raw`(?:^|[\s|,;，；、:：()（）\[\]{}<>《》` + "`" + String.raw`"'“”‘’])`;
const ACCEPTANCE_PLACEHOLDER_END = String.raw`(?=$|[\s|,;，；、:：.!?。！？()（）\[\]{}<>《》` + "`" + String.raw`"'“”‘’])`;
const BAD_ACCEPTANCE_EVIDENCE_RE = new RegExp([
  '自验收已归档',
  '自验收',
  '无证据',
  '待补',
  '稍后补',
  '只写声明',
  '仅写声明',
  '口头声明',
  `${ACCEPTANCE_PLACEHOLDER_BOUNDARY}(?:见上|同上|略|N\\/A|NA|none|null)${ACCEPTANCE_PLACEHOLDER_END}`,
].join('|'), 'i');
const IMAGE_PATH_RE = /\.(?:png|jpe?g|webp|gif)\b/i;

const HARD_REGRESSION_RULES = [
  {
    id: 'queue_merge_integrity',
    label: '队列合并/整理硬回归',
    triggers: [
      /queue[-_\s]*(organize|merge|control)/i,
      /(队列|queue(?![-_]?(?:id|agent)\b)|排队).{0,24}(整理|合并|去重|清理重复|插队|优先级)/i,
      /(CEO|ceo).{0,24}(队列|queue(?![-_]?(?:id|agent)\b)).{0,24}(整理|合并|去重|清理重复|插队|优先级)/i,
      /(CEO|ceo).{0,24}(整理|合并|去重|清理重复|插队)/i,
      /任务.{0,24}(整理|合并|去重|清理重复|插队)/i,
      /(整理|合并|去重|清理重复).{0,24}(队列|任务|CEO|ceo)/i,
      /(merged_from|queue_organize|planned_cancel|queued_after|被合并需求|任务数减少)/i,
    ],
    requiredCommands: [
      {
        id: 'queue-organizer',
        pattern: /node\s+tests\/queue-organizer\.test\.js/i,
        label: 'node tests/queue-organizer.test.js',
      },
      {
        id: 'ceo-queue-control',
        pattern: /node\s+tests\/ceo-queue-control\.test\.js/i,
        label: 'node tests/ceo-queue-control.test.js',
      },
    ],
    evidencePattern: /(merged_from|queue_organize|planned_cancel|queued_after|任务数.{0,12}(减少|变少)|被合并需求.{0,20}(保留|完整)|状态迁移|幂等|running.{0,20}(只读|不动))/i,
  },
];

const QUEUE_RUNTIME_CHANGE_RE = /(^|\/)(secretary-tools|ceo-worker|engine-runner|server|hardening-hooks)\.js$|(^|\/)config\.json$|shared\/engine\/|tests\/(queue-organizer|ceo-queue-control)\.test\.js/i;
const QUEUE_LIFECYCLE_POLICY_RE = /(角色边界|空转队列|预留工位|生命周期状态|命名别名|规范命名|只读历史|可见性矩阵|历史数据追溯|agent\s*发现|发现层不可路由)/i;
const POLICY_DECISION_ONLY_RE = /(待拍板|建议拍板|需主人确认|主人后续.*批准|proposal-only|本轮未改运行时|未改运行时|未改运行配置|未改.*队列目录)/i;

function changedFilesTouchQueueRuntime(vars) {
  const implementation = implementationFromVars(vars);
  const changed = Array.isArray(implementation && implementation.changed_files)
    ? implementation.changed_files
    : [];
  return changed.some(file => QUEUE_RUNTIME_CHANGE_RE.test(String(file || '')));
}

function isQueueLifecyclePolicyOnlyTask(vars, text) {
  if (changedFilesTouchQueueRuntime(vars)) return false;
  return QUEUE_LIFECYCLE_POLICY_RE.test(text) && POLICY_DECISION_ONLY_RE.test(text);
}

function collectText(value, out = [], depth = 0) {
  if (depth > 6 || value == null || out.length > 160) return out;
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, out, depth + 1);
  }
  return out;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstObject(...values) {
  return values.find(isPlainObject) || null;
}

function structuredAcceptanceTemplatePath(opts = {}) {
  if (opts.templatePath) {
    return path.isAbsolute(opts.templatePath)
      ? opts.templatePath
      : path.resolve(opts.workspaceRoot || process.cwd(), opts.templatePath);
  }
  return path.resolve(opts.workspaceRoot || process.cwd(), STRUCTURED_ACCEPTANCE_TEMPLATE_REL);
}

function structuredAcceptanceTemplateReference(opts = {}) {
  const file = structuredAcceptanceTemplatePath(opts);
  const root = opts.workspaceRoot || process.cwd();
  const rel = path.relative(root, file).split(path.sep).join('/');
  return rel && !rel.startsWith('..') ? rel : STRUCTURED_ACCEPTANCE_TEMPLATE_REL;
}

function readStructuredAcceptanceTemplate(opts = {}) {
  const file = structuredAcceptanceTemplatePath(opts);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function implementationFromVars(vars) {
  return isPlainObject(vars && vars.implementation) ? vars.implementation : {};
}

function reviewFromVars(vars) {
  return isPlainObject(vars && vars.review) ? vars.review : {};
}

function logicChainFromVars(vars) {
  const implementation = implementationFromVars(vars);
  return firstObject(
    implementation.logic_chain,
    implementation.logicChain,
    implementation.logic_chain_report,
    implementation.logicChainReport,
    vars && vars.logic_chain,
    vars && vars.logicChain,
  );
}

function reviewVerificationFromVars(vars) {
  const review = reviewFromVars(vars);
  return firstObject(
    review.verification,
    review.hard_verification,
    review.hardVerification,
    review.hard_evidence,
    review.hardEvidence,
    review.review_evidence,
  );
}

function textHasSignal(text) {
  return /(PASS|通过|exit\s*0|退出码\s*0|diff|git|changed_files|截图|screenshot|核实|验证|证据|file|path|行号|测试|node\s+tests|npm\s+test|pytest|rg\s+)/i.test(String(text || ''));
}

function entryText(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  return collectText(entry).join('\n');
}

function evidenceEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(v => v != null && String(entryText(v)).trim());
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'object') return Object.keys(value).length ? [value] : [];
  return [];
}

function workspacePath(file, workspaceRoot) {
  if (!file || typeof file !== 'string') return null;
  const raw = file.trim();
  if (!raw || /(^|\/)\.\.(\/|$)/.test(raw)) return null;
  if (/Starlaid|星桥/i.test(raw)) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(workspaceRoot || process.cwd(), raw);
}

function pathExists(file, workspaceRoot) {
  const resolved = workspacePath(file, workspaceRoot);
  return !!resolved && fs.existsSync(resolved);
}

function extractPathPointers(text) {
  const out = [];
  const re = /((?:\/Users\/[^\s'"`，,。；;)]+)|(?:[A-Za-z0-9_\-.\u3400-\u9fff]+\/[A-Za-z0-9_\-./\u3400-\u9fff]+))(?:[:#]\d+)?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[1].replace(/[)\]}.,;，。；]+$/g, '');
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

function extractPathPointerDetails(text) {
  const out = [];
  const re = /((?:\/Users\/[^\s'"`，,。；;)]+)|(?:[A-Za-z0-9_\-.\u3400-\u9fff]+\/[A-Za-z0-9_\-./\u3400-\u9fff]+))(?:[:#]L?(\d+))?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[1].replace(/[)\]}.,;，。；]+$/g, '');
    if (!raw) continue;
    const lineNo = m[2] ? Number(m[2]) : null;
    if (!out.some(item => item.path === raw && item.lineNo === lineNo)) {
      out.push({ path: raw, lineNo: Number.isFinite(lineNo) ? lineNo : null });
    }
  }
  return out;
}

function pointerExists(pointer, workspaceRoot) {
  if (!pointer || !pathExists(pointer.path, workspaceRoot)) return false;
  if (!pointer.lineNo) return true;
  const resolved = workspacePath(pointer.path, workspaceRoot);
  try {
    const lineCount = fs.readFileSync(resolved, 'utf8').split(/\r?\n/).length;
    return pointer.lineNo >= 1 && pointer.lineNo <= lineCount;
  } catch (_) {
    return false;
  }
}

function pointerSnippet(pointer, workspaceRoot) {
  if (!pointer || !pointerExists(pointer, workspaceRoot)) return '';
  const resolved = workspacePath(pointer.path, workspaceRoot);
  try {
    const stat = fs.statSync(resolved);
    if (stat.size > 1024 * 1024) return '';
    const text = fs.readFileSync(resolved, 'utf8');
    if (!pointer.lineNo) return text.slice(0, 512 * 1024);
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, pointer.lineNo - 8);
    const end = Math.min(lines.length, pointer.lineNo + 7);
    return lines.slice(start, end).join('\n');
  } catch (_) {
    return '';
  }
}

function hardRegressionPointerSnippets(text, workspaceRoot) {
  const snippets = [];
  for (const pointer of extractPathPointerDetails(text)) {
    const file = String(pointer && pointer.path || '');
    if (!/\.(?:md|json|jsonl|txt)$/i.test(file)) continue;
    if (/(^|\/)tests\//i.test(file)) continue;
    const snippet = pointerSnippet(pointer, workspaceRoot);
    if (snippet && !snippets.includes(snippet)) snippets.push(snippet);
    if (snippets.length >= 12) break;
  }
  return snippets;
}

function hardRegressionEvidenceText(values, opts = {}) {
  const text = collectText(values).join('\n');
  const snippets = hardRegressionPointerSnippets(text, opts.workspaceRoot || process.cwd());
  return [text].concat(snippets).join('\n');
}

function evidenceHasHardPointer(entries, workspaceRoot) {
  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const file = entry.path || entry.file || entry.target || entry.artifact;
      if (file && pathExists(String(file), workspaceRoot)) return true;
      const exitCode = entry.exit_code != null ? entry.exit_code : entry.exitCode;
      if ((exitCode === 0 || exitCode === '0' || entry.passed === true || entry.pass === true)
        && textHasSignal(entryText(entry))) return true;
    }
    const text = entryText(entry);
    for (const pointer of extractPathPointerDetails(text)) {
      if (pointerExists(pointer, workspaceRoot)) return true;
    }
    if (textHasSignal(text)) return true;
  }
  return false;
}

function markdownCell(text) {
  return String(text == null ? '' : text)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function splitMarkdownRow(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('|') || !s.endsWith('|')) return null;
  const cells = [];
  let cur = '';
  let escaping = false;
  for (let i = 1; i < s.length - 1; i += 1) {
    const ch = s[i];
    if (escaping) {
      cur += ch;
      escaping = false;
    } else if (ch === '\\') {
      escaping = true;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function hasStructuredAcceptanceTable(text) {
  const s = String(text || '');
  return s.includes(STRUCTURED_ACCEPTANCE_MARKER)
    && /\|\s*要点\s*\|\s*完成状态/.test(s)
    && /\|\s*证据位置/.test(s);
}

function normalizePoint(text) {
  return String(text || '')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function pointKey(text) {
  return normalizePoint(text)
    .toLowerCase()
    .replace(/[`*_~\s，。；;:：、,.!?？！()[\]【】"'“”‘’<>《》]+/g, '');
}

function parseStructuredAcceptanceRows(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    const cells = splitMarkdownRow(line);
    if (!cells) {
      if (inTable && rows.length) break;
      continue;
    }
    const joined = cells.join('|');
    if (/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/.test(joined)) continue;
    if (cells.some(c => c === '要点') && cells.some(c => /^完成状态/.test(c))) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const point = normalizePoint(cells[0]);
    if (!point) continue;
    rows.push({
      point,
      status: normalizePoint(cells[1]),
      evidence: normalizePoint(cells[2]),
      notes: normalizePoint(cells[3]),
    });
  }
  return rows;
}

function normalizeAcceptanceRow(row) {
  if (!row) return null;
  if (Array.isArray(row)) {
    return {
      point: normalizePoint(row[0]),
      status: normalizePoint(row[1]),
      evidence: normalizePoint(row[2]),
      notes: normalizePoint(row[3]),
    };
  }
  if (typeof row === 'string') {
    const parsed = parseStructuredAcceptanceRows(row);
    return parsed.length === 1 ? parsed[0] : null;
  }
  if (typeof row === 'object') {
    const point = row.point || row.item || row.requirement || row.check || row['要点'];
    const status = row.status || row.state || row.done_status || row.completion_status || row['完成状态'] || row['完成状态(完成/部分/未完成)'];
    const evidence = row.evidence || row.proof || row.location || row.pointer || row['证据位置'] || row['证据位置(文件:行 / git diff / 截图路径)'];
    const notes = row.notes || row.note || row.remark || row.remarks || row['备注'];
    return {
      point: normalizePoint(point),
      status: normalizePoint(status),
      evidence: normalizePoint(evidence),
      notes: normalizePoint(notes),
    };
  }
  return null;
}

function acceptanceRowsFromValue(value) {
  if (!value) return [];
  if (typeof value === 'string') return parseStructuredAcceptanceRows(value);
  if (Array.isArray(value)) return value.map(normalizeAcceptanceRow).filter(row => row && row.point);
  if (typeof value === 'object') {
    for (const key of ['rows', 'items', 'checklist', 'table', 'acceptance_table', 'acceptanceTable']) {
      if (Array.isArray(value[key]) || typeof value[key] === 'string') return acceptanceRowsFromValue(value[key]);
    }
    const row = normalizeAcceptanceRow(value);
    return row && row.point ? [row] : [];
  }
  return [];
}

function taskRequiredAcceptanceRows(vars) {
  const rows = []
    .concat(acceptanceRowsFromValue(vars && vars.acceptance_table))
    .concat(acceptanceRowsFromValue(vars && vars.acceptanceTable))
    .concat(acceptanceRowsFromValue(vars && vars.acceptance));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = pointKey(row.point);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function implementationAcceptanceRows(vars) {
  const implementation = implementationFromVars(vars);
  const logic = logicChainFromVars(vars) || {};
  const candidates = [
    implementation.acceptance_table,
    implementation.acceptanceTable,
    implementation.structured_acceptance,
    implementation.structuredAcceptance,
    implementation.acceptance_checklist,
    implementation.acceptanceChecklist,
    logic.acceptance_table,
    logic.acceptanceTable,
    logic.structured_acceptance,
    logic.acceptance_checklist,
  ];
  for (const value of candidates) {
    const rows = acceptanceRowsFromValue(value);
    if (rows.length) return rows;
  }
  return [];
}

function reviewAcceptanceRows(vars) {
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars) || {};
  const candidates = [
    review.acceptance_table,
    review.acceptanceTable,
    review.structured_acceptance,
    review.acceptance_checklist,
    verification.acceptance_table,
    verification.acceptanceTable,
    verification.structured_acceptance,
    verification.acceptance_checklist,
  ];
  for (const value of candidates) {
    const rows = acceptanceRowsFromValue(value);
    if (rows.length) return rows;
  }
  return [];
}

function structuredAcceptanceRequired(vars, opts = {}) {
  if (opts.requireStructuredAcceptance === false) return false;
  if (opts.requireStructuredAcceptance === true) return true;
  return hasStructuredAcceptanceTable(vars && vars.acceptance)
    || acceptanceRowsFromValue(vars && vars.acceptance_table).length > 0
    || acceptanceRowsFromValue(vars && vars.acceptanceTable).length > 0;
}

function evidencePointerIsVerifiable(evidence, opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const entries = evidenceEntries(evidence);
  for (const entry of entries) {
    const text = entryText(entry);
    if (entry && typeof entry === 'object') {
      const file = entry.path || entry.file || entry.target || entry.artifact || entry.screenshot;
      if (file && pathExists(String(file), workspaceRoot)) return true;
      const exitCode = entry.exit_code != null ? entry.exit_code : entry.exitCode;
      if ((exitCode === 0 || exitCode === '0' || entry.passed === true || entry.pass === true)
        && textHasSignal(text)) return true;
    }
    for (const pointer of extractPathPointerDetails(text)) {
      if (pointerExists(pointer, workspaceRoot)) return true;
    }
    if (/(git\s+diff|diff\s+--git)/i.test(text) && extractPathPointers(text).some(p => pathExists(p, workspaceRoot))) return true;
    if (/\b(node|npm|pnpm|yarn|pytest|python|rg|git)\b/i.test(text)
      && /(exit[_ ]?code\s*[:=]?\s*0|exit\s*0|退出码\s*0|PASS|通过|All tests passed)/i.test(text)) return true;
  }
  return false;
}

function decisionLineRef(text) {
  const s = String(text || '');
  const m = s.match(/(?:memory\/|board\/)?decisions\.md:(\d+)/i)
    || s.match(/decisions\.md[^\d]{0,20}(?:第|line\s*)?(\d+)\s*行?/i);
  return m ? Number(m[1]) : null;
}

function significantPointTokens(point) {
  const stop = new Set([
    '任务', '任务验收', '验收', '设计', '对照', '完成', '状态', '证据', '位置', '文件', '项目', '控制台',
    '老板', '必须', '当前', '执行', '完成后', '未完成', '部分', '要点', '备注', '逐行', '可核', '实现',
    '设计对照', 'memory', 'decisions', 'md',
  ]);
  const text = normalizePoint(point)
    .replace(/^(任务验收|任务目标|设计对照|视觉\/UI证据)[:：]?\s*/i, ' ')
    .replace(/(?:memory\/|board\/)?decisions\.md:\d+/ig, ' ');
  const tokens = [];
  const add = token => {
    const v = String(token || '').trim();
    if (!v || v.length < 2 || stop.has(v)) return;
    if (!tokens.includes(v)) tokens.push(v);
  };
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)) add(m[0].toLowerCase());
  for (const p of extractPathPointers(text)) add(path.basename(p).toLowerCase());
  for (const m of text.matchAll(/[\u3400-\u9fff]{2,24}/g)) {
    const phrase = m[0];
    if (phrase.length <= 6) add(phrase);
    for (let len = 2; len <= Math.min(4, phrase.length); len += 1) {
      for (let i = 0; i <= phrase.length - len; i += 1) add(phrase.slice(i, i + len));
    }
  }
  return tokens.slice(0, 80);
}

function evidenceAlignmentHaystack(row, opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const text = [row && row.evidence, row && row.notes].filter(Boolean).join('\n');
  const snippets = extractPathPointerDetails(text)
    .map(pointer => pointerSnippet(pointer, workspaceRoot))
    .filter(Boolean);
  return [text].concat(snippets).join('\n').toLowerCase();
}

function validateAcceptanceEvidenceAlignment(required, row, opts = {}) {
  const point = normalizePoint((required && required.point) || (row && row.point));
  const evidenceText = [row && row.evidence, row && row.notes].filter(Boolean).join('\n');
  if (/^设计对照/i.test(point) && /decisions\.md:\d+/i.test(point)) {
    const requiredLine = decisionLineRef(point);
    const evidenceLine = decisionLineRef(evidenceText);
    if (!requiredLine || evidenceLine !== requiredLine) {
      return { ok: false, reason: `证据未指回对应 decisions.md:${requiredLine || '?'} 设计条目` };
    }
  }
  if (/^视觉\/UI证据/i.test(point)) {
    const workspaceRoot = opts.workspaceRoot || process.cwd();
    const hasPeekaboo = visualEvidenceImagePaths(evidenceText, workspaceRoot).some(p => /peekaboo/i.test(p));
    const hasCodexReview = /(codex|gpt[-_. ]?5[-_. ]?codex|board_gpt55|board_opus48)/i.test(evidenceText);
    if (!hasPeekaboo || !hasCodexReview) {
      return { ok: false, reason: '视觉/UI 行证据未同时包含可核 peekaboo 图片截图和 Codex 复核报告; failure.json/截图失败标记不能当截图完成证据' };
    }
  }
  const tokens = significantPointTokens(point);
  if (!tokens.length) return { ok: true, reason: null };
  const hay = evidenceAlignmentHaystack(row, opts);
  const aligned = tokens.some(token => hay.includes(String(token).toLowerCase()));
  if (!aligned) {
    return { ok: false, reason: '证据与本行要点缺少可核对齐信息' };
  }
  return { ok: true, reason: null };
}

function findAcceptanceRow(required, filledRows) {
  const requiredPoint = required && required.point;
  const key = pointKey(requiredPoint);
  if (!key) return null;
  const exact = filledRows.find(row => pointKey(row.point) === key)
    || filledRows.find(row => {
      const other = pointKey(row.point);
      return other && (other.includes(key) || key.includes(other));
    });
  if (exact) return exact;
  // 设计对照行的要点文本很长(整条 decisions.md 决策),执行/复核方常用省略号"…"截断重述,
  // 导致按全文 containment 匹配失败被误报"缺少要点"(2026-06-24/06-25 decisions.md:65 连续复发)。
  // decisions.md:行号 是该行的唯一稳定锚点,故按锚点回退匹配;要点正确性由后续
  // status/证据可核/证据对齐(validateAcceptanceEvidenceAlignment 仍用 required 的 token+行号校验)保证,不削弱门禁。
  if (/^设计对照/i.test(normalizePoint(requiredPoint))) {
    const requiredLine = decisionLineRef(requiredPoint);
    if (requiredLine) {
      return filledRows.find(row => /^设计对照/i.test(normalizePoint(row.point))
        && decisionLineRef(row.point) === requiredLine) || null;
    }
  }
  return null;
}

function validateFilledAcceptanceRows(requiredRows, filledRows, opts = {}) {
  const label = opts.label || 'implementation.acceptance_table';
  if (!filledRows.length) return { ok: false, reason: `${label} 缺少结构化验收表逐行填写` };
  for (let i = 0; i < requiredRows.length; i += 1) {
    const required = requiredRows[i];
    const row = findAcceptanceRow(required, filledRows);
    const rowLabel = `${label} 第${i + 1}行`;
    if (!row) return { ok: false, reason: `${rowLabel} 缺少要点: ${required.point}` };
    if (!row.point) return { ok: false, reason: `${rowLabel} 要点为空` };
    const status = normalizePoint(row.status);
    if (status !== ACCEPTANCE_DONE_STATUS) {
      const suffix = ACCEPTANCE_NOT_DONE_STATUSES.has(status) ? '未完成' : `状态=${status || '空'}`;
      return { ok: false, reason: `${rowLabel} ${suffix}: ${required.point}` };
    }
    const evidence = normalizePoint(row.evidence);
    const notes = normalizePoint(row.notes);
    if (!evidence) return { ok: false, reason: `${rowLabel} 证据位置为空: ${required.point}` };
    if (BAD_ACCEPTANCE_EVIDENCE_RE.test(`${evidence}\n${notes}`)) {
      return { ok: false, reason: `${rowLabel} 使用不可核声明作证据: ${required.point}` };
    }
    if (!evidencePointerIsVerifiable([evidence], opts)) {
      return { ok: false, reason: `${rowLabel} 证据不可核或不存在: ${required.point}` };
    }
    const alignment = validateAcceptanceEvidenceAlignment(required, row, opts);
    if (!alignment.ok) {
      return { ok: false, reason: `${rowLabel} 证据对不上: ${alignment.reason}: ${required.point}` };
    }
  }
  return { ok: true, reason: null };
}

function visualEvidenceImagePaths(text, workspaceRoot) {
  return extractPathPointers(text)
    .filter(p => IMAGE_PATH_RE.test(p) && pathExists(p, workspaceRoot));
}

function acceptanceRowsEvidenceText(rows) {
  return (rows || []).map(row => [row && row.evidence, row && row.notes].filter(Boolean).join('\n')).join('\n');
}

function validateVisualAcceptanceEvidence(vars, implementationRows, reviewRows, opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const hay = collectText([
    acceptanceRowsEvidenceText(implementationRows),
    acceptanceRowsEvidenceText(reviewRows),
    logicChainFromVars(vars) && logicChainFromVars(vars).evidence,
    logicChainFromVars(vars) && logicChainFromVars(vars).tests,
    reviewVerificationFromVars(vars) && reviewVerificationFromVars(vars).evidence,
  ]).join('\n');
  if (BAD_ACCEPTANCE_EVIDENCE_RE.test(hay)) {
    return { ok: false, reason: '视觉/UI 验收含不可核自验收声明' };
  }
  const images = visualEvidenceImagePaths(hay, workspaceRoot);
  const hasPeekabooScreenshot = images.some(p => /peekaboo/i.test(p));
  if (!hasPeekabooScreenshot) {
    return { ok: false, reason: '视觉/UI 类验收缺少可核 peekaboo 图片截图路径; failure.json/截图失败标记不能当截图完成证据' };
  }
  if (!/(codex|gpt[-_. ]?5[-_. ]?codex|board_gpt55|board_opus48)/i.test(hay)) {
    return { ok: false, reason: '视觉/UI 类验收缺少 Codex 对照设计挑错证据' };
  }
  return { ok: true, reason: null };
}

function validateStructuredAcceptanceTable(vars, opts = {}) {
  if (!structuredAcceptanceRequired(vars, opts)) return { ok: true, reason: null, skipped: true };
  const requiredRows = taskRequiredAcceptanceRows(vars);
  if (!requiredRows.length) return { ok: false, reason: '任务缺少结构化验收表要点' };
  const acceptancePrefix = String(vars && vars.acceptance || '').split(STRUCTURED_ACCEPTANCE_MARKER)[0];
  const taskText = collectText([
    vars && vars.goal,
    acceptancePrefix,
    vars && vars.bounds,
  ]).join('\n');
  const designRows = requiredRows.filter(row => !/^视觉\/UI证据/i.test(normalizePoint(row && row.point)));
  const designText = collectText([taskText, designRows]).join('\n');
  if (DESIGN_GATE_RE.test(designText) && !requiredRows.some(row => /(?:memory\/|board\/)?decisions\.md:\d+/i.test(row.point))) {
    return { ok: false, reason: '对照设计门缺少 decisions.md:行号 要点' };
  }
  const implementationRows = implementationAcceptanceRows(vars);
  const implCheck = validateFilledAcceptanceRows(requiredRows, implementationRows, Object.assign({}, opts, {
    label: 'implementation.acceptance_table',
  }));
  if (!implCheck.ok) return implCheck;
  const requireReview = opts.requireReview !== false;
  const reviewRows = reviewAcceptanceRows(vars);
  if (requireReview) {
    const reviewCheck = validateFilledAcceptanceRows(requiredRows, reviewRows, Object.assign({}, opts, {
      label: 'review.verification.acceptance_table',
    }));
    if (!reviewCheck.ok) return reviewCheck;
  }
  if (VISUAL_UI_RE.test(taskText) || requiredRows.some(row => /^视觉\/UI证据/.test(row.point))) {
    const visual = validateVisualAcceptanceEvidence(vars, implementationRows, reviewRows, opts);
    if (!visual.ok) return visual;
  }
  return {
    ok: true,
    reason: null,
    requiredRows,
    implementationRows,
    reviewRows,
  };
}

function splitAcceptanceItems(text) {
  if (hasStructuredAcceptanceTable(text)) return parseStructuredAcceptanceRows(text).map(row => row.point);
  const source = String(text || '').replace(/```[\s\S]*?```/g, ' ');
  const out = [];
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(/^[-*+]\s+/, '').replace(/^☐\s*/, '').replace(/^\[[ xX]\]\s*/, '');
    const numbered = line.split(/(?=\s*\d+\s*[).、]\s*)/).map(s => s.trim()).filter(Boolean);
    for (const part of (numbered.length > 1 ? numbered : [line])) {
      const cleaned = part.replace(/^\d+\s*[).、]\s*/, '').trim();
      const pieces = cleaned.length > 90 ? cleaned.split(/[;；]/).map(s => s.trim()).filter(Boolean) : [cleaned];
      for (const item of pieces) {
        const v = item.replace(/^验收(?:标准|要求)?[:：]\s*/i, '').trim();
        if (v && v.length >= 2) out.push(v);
      }
    }
  }
  return out.slice(0, 16);
}

function decisionSources(workspaceRoot, opts = {}) {
  const candidates = [
    opts.decisionsFile,
    path.join(workspaceRoot || process.cwd(), 'memory', 'decisions.md'),
    path.join(workspaceRoot || process.cwd(), 'board', 'decisions.md'),
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const file of candidates) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(workspaceRoot || process.cwd(), file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    const relFile = path.relative(workspaceRoot || process.cwd(), resolved) || resolved;
    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    out.push({ file: relFile, lines });
  }
  return out;
}

function textKeywords(text) {
  const stop = new Set(['任务', '目标', '验收', '要求', '老板', '控制台', '项目', '完成', '证据', '文件', '设计', '实现', '必须', '不改', '边界']);
  const s = String(text || '');
  const terms = [];
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)) terms.push(m[0].toLowerCase());
  for (const m of s.matchAll(/[\u3400-\u9fff]{2,12}/g)) terms.push(m[0]);
  return Array.from(new Set(terms.filter(t => t.length >= 2 && !stop.has(t))));
}

function explicitDecisionLines(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(/decisions\.md[^\d]{0,20}(?:第|line\s*)?(\d+)/gi)) out.push(Number(m[1]));
  if (/decisions\.md|设计记忆|设计文件|设计决策/.test(s)) {
    for (const m of s.matchAll(/第\s*(\d+)\s*行/g)) out.push(Number(m[1]));
  }
  return Array.from(new Set(out.filter(n => Number.isFinite(n) && n > 0)));
}

function extractDecisionItems(goal, acceptance, opts = {}) {
  const text = [goal, acceptance].filter(Boolean).join('\n');
  const sources = decisionSources(opts.workspaceRoot, opts);
  if (!sources.length) return [];
  const out = [];
  const seen = new Set();
  const explicit = explicitDecisionLines(text);
  for (const source of sources) {
    for (const n of explicit) {
      const line = source.lines[n - 1];
      if (!line || !line.trim()) continue;
      const point = `设计对照 ${source.file}:${n} ${line.trim().replace(/^[-*]\s*/, '')}`;
      const key = pointKey(point);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(point);
      }
    }
  }
  if (explicit.length) return out.slice(0, opts.maxDecisionItems || 8);
  const keywords = textKeywords(text);
  if (!DESIGN_GATE_RE.test(text)) return out.slice(0, opts.maxDecisionItems || 6);
  if (!keywords.length) return out.slice(0, opts.maxDecisionItems || 6);
  const scored = [];
  for (const source of sources) {
    source.lines.forEach((line, idx) => {
      const raw = line.trim();
      if (!raw || raw.length < 8) return;
      const lower = raw.toLowerCase();
      const score = keywords.reduce((sum, kw) => sum + (lower.includes(String(kw).toLowerCase()) ? 1 : 0), 0);
      if (score >= 2 || (DESIGN_GATE_RE.test(text) && score >= 1 && /任务:|设计|软约束|验收|hook|Codex|Peekaboo|GLM/i.test(raw))) {
        scored.push({ score, file: source.file, lineNo: idx + 1, raw });
      }
    });
  }
  scored
    .sort((a, b) => b.score - a.score || a.lineNo - b.lineNo)
    .slice(0, opts.maxDecisionItems || 6)
    .forEach(item => {
      const point = `设计对照 ${item.file}:${item.lineNo} ${item.raw.replace(/^[-*]\s*/, '')}`;
      const key = pointKey(point);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(point);
      }
    });
  return out.slice(0, opts.maxDecisionItems || 8);
}

function buildStructuredAcceptanceTable(input = {}, opts = {}) {
  const goal = String(input.goal || '').trim();
  const acceptance = String(input.acceptance || '').trim();
  if (hasStructuredAcceptanceTable(acceptance)) return acceptance;
  const templateOpts = Object.assign({}, opts, input);
  const templateRef = structuredAcceptanceTemplateReference(templateOpts);
  const taskItems = splitAcceptanceItems(acceptance).map(item => `任务验收: ${item}`);
  if (!taskItems.length && goal) taskItems.push(`任务目标: ${goal.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0].slice(0, 180)}`);
  const designItems = extractDecisionItems(goal, acceptance, Object.assign({}, opts, input));
  const text = [goal, acceptance].join('\n');
  const rows = [];
  const seen = new Set();
  for (const item of designItems.concat(taskItems)) {
    const point = normalizePoint(item);
    const key = pointKey(point);
    if (point && !seen.has(key)) {
      seen.add(key);
      rows.push(point);
    }
  }
  if (VISUAL_UI_RE.test(text)) {
    const point = '视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告';
    if (!seen.has(pointKey(point))) rows.push(point);
  }
  if (!rows.length) rows.push('任务验收: 产出可验证证据并说明完成情况');
  const table = [
    `${STRUCTURED_ACCEPTANCE_MARKER}(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)`,
    `模板: ${templateRef}`,
    `| ${STRUCTURED_ACCEPTANCE_COLUMNS.join(' | ')} |`,
    '|---|---|---|---|',
    ...rows.map(point => `| ${markdownCell(point)} | 未完成 |  |  |`),
  ].join('\n');
  return table;
}

function taskHardRegressionText(vars) {
  const implementation = implementationFromVars(vars);
  const logic = logicChainFromVars(vars);
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars);
  const acceptanceText = hasStructuredAcceptanceTable(vars && vars.acceptance)
    ? String(vars.acceptance || '').split(STRUCTURED_ACCEPTANCE_MARKER)[0]
    : vars && vars.acceptance;
  return collectText([
    vars && vars.goal,
    acceptanceText,
    vars && vars.bounds,
    vars && vars.task,
    implementation && implementation.summary,
    logic && logic.summary,
    logic && logic.actions,
    logic && logic.evidence,
    logic && logic.tests,
    logic && logic.commands,
    review && review.notes,
    verification && verification.checked,
    verification && verification.evidence,
  ]).join('\n');
}

function taskHardRegressionTriggerText(vars) {
  const implementation = implementationFromVars(vars);
  const acceptanceText = hasStructuredAcceptanceTable(vars && vars.acceptance)
    ? String(vars.acceptance || '').split(STRUCTURED_ACCEPTANCE_MARKER)[0]
    : vars && vars.acceptance;
  return collectText([
    vars && vars.goal,
    acceptanceText,
    vars && vars.bounds,
    vars && vars.task,
    implementation && implementation.changed_files,
  ]).join('\n');
}

function requiredHardRegressionRules(vars) {
  const text = taskHardRegressionTriggerText(vars || {});
  return HARD_REGRESSION_RULES.filter(rule => {
    if (rule.id === 'queue_merge_integrity' && isQueueLifecyclePolicyOnlyTask(vars || {}, text)) {
      return false;
    }
    return rule.triggers.some(re => re.test(text));
  });
}

function validateHardRegressionCoverage(vars, opts = {}) {
  const required = requiredHardRegressionRules(vars || {});
  if (!required.length) return { ok: true, reason: null, required: [] };
  const implementation = implementationFromVars(vars);
  const logic = logicChainFromVars(vars);
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars);
  const implementationText = hardRegressionEvidenceText([
    implementation && implementation.summary,
    implementation && implementation.receipt,
    implementation && implementation.artifacts,
    implementation && implementation.tests,
    implementation && implementation.commands,
    logic && logic.summary,
    logic && logic.actions,
    logic && logic.evidence,
    logic && logic.tests,
    logic && logic.commands,
  ], opts);
  const reviewText = hardRegressionEvidenceText([
    review && review.notes,
    verification && verification.checked,
    verification && verification.evidence,
    verification && verification.commands,
    verification && verification.tests,
  ], opts);
  const missing = [];
  for (const rule of required) {
    for (const command of rule.requiredCommands || []) {
      if (!command.pattern.test(implementationText)) {
        missing.push(`${rule.id}: implementation 缺少 ${command.label}`);
      }
      if (!command.pattern.test(reviewText)) {
        missing.push(`${rule.id}: review 未核实 ${command.label}`);
      }
    }
    if (rule.evidencePattern && !rule.evidencePattern.test(implementationText)) {
      missing.push(`${rule.id}: implementation 缺少合并后任务数/需求保留/状态迁移/幂等等硬证据摘要`);
    }
    if (rule.evidencePattern && !rule.evidencePattern.test(reviewText)) {
      missing.push(`${rule.id}: review 未逐项核合并完整性硬证据`);
    }
  }
  if (missing.length) {
    return {
      ok: false,
      reason: `硬回归测试覆盖不足: ${missing.slice(0, 4).join('; ')}`,
      required: required.map(rule => ({ id: rule.id, label: rule.label })),
      missing,
    };
  }
  return {
    ok: true,
    reason: null,
    required: required.map(rule => ({ id: rule.id, label: rule.label })),
  };
}

function validateLoopEngineeringEvidence(vars, opts = {}) {
  const loop = vars && vars.loop_engineering;
  if (!loop || typeof loop !== 'object' || loop.enabled === false) {
    return { ok: true, reason: null, skipped: true };
  }
  if (!Array.isArray(loop.standards) || !loop.standards.length) {
    return { ok: false, reason: 'loop_engineering 缺少可度量 standards' };
  }
  if (!Array.isArray(loop.rounds) || !loop.rounds.length) {
    return { ok: false, reason: 'loop_engineering 缺少轮次评分记录' };
  }
  const invalidRound = loop.rounds.find(round => !round || !Number.isFinite(Number(round.score)));
  if (invalidRound) {
    return { ok: false, reason: 'loop_engineering 存在无效评分轮次' };
  }
  if (!loop.best || !Number.isFinite(Number(loop.best.score))) {
    return { ok: false, reason: 'loop_engineering 缺少最佳轮次基线' };
  }
  if (loop.converged !== true) {
    return { ok: false, reason: `loop_engineering 未收敛: ${loop.stop_reason || 'unknown'}` };
  }
  const target = Number(loop.target_score == null ? 0.85 : loop.target_score);
  if (Number.isFinite(target) && Number(loop.best.score) + 1e-9 < target) {
    return { ok: false, reason: `loop_engineering 最佳分 ${loop.best.score} 未达目标 ${target}` };
  }
  return { ok: true, reason: null, loop };
}

function normalizeChangedFiles(implementation) {
  return Array.isArray(implementation && implementation.changed_files)
    ? implementation.changed_files.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim())
    : [];
}

function validateChangedFiles(implementation, opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const changed = normalizeChangedFiles(implementation);
  const missing = [];
  const blocked = [];
  for (const file of changed) {
    if (/Starlaid|星桥/i.test(file)) {
      blocked.push(file);
      continue;
    }
    if (!pathExists(file, workspaceRoot)) missing.push(file);
  }
  if (blocked.length) {
    return { ok: false, reason: `changed_files 涉及排除范围: ${blocked.slice(0, 3).join(', ')}`, changed, missing, blocked };
  }
  if (missing.length) {
    return { ok: false, reason: `changed_files 声明文件不存在: ${missing.slice(0, 5).join(', ')}`, changed, missing, blocked };
  }
  if (opts.gitVerify === true) {
    // P0-A:不只查文件存在,还要 git 真有改动;明确无改动(false)才打回,无法判定(null)放行
    const unchanged = [];
    for (const file of changed) {
      if (gitFileHasChange(file, workspaceRoot) === false) unchanged.push(file);
    }
    if (unchanged.length) {
      return { ok: false, reason: `changed_files 声明已改但 git 显示无改动: ${unchanged.slice(0, 5).join(', ')}`, changed, missing, blocked, unchanged };
    }
  }
  return { ok: true, reason: null, changed, missing, blocked };
}

function deliveryEvidenceRequiredFromText(...values) {
  const text = values.flat().filter(Boolean).map(deliverySignalText).join('\n');
  if (DELIVERY_NO_CHANGE_RE.test(text) && !DELIVERY_ACTION_RE.test(text)) return false;
  return DELIVERY_ACTION_RE.test(text);
}

function deliverySignalText(value) {
  const text = String(value || '');
  if (!hasStructuredAcceptanceTable(text)) return text;
  const prefix = text.split(STRUCTURED_ACCEPTANCE_MARKER)[0] || '';
  const points = parseStructuredAcceptanceRows(text).map(row => row.point).join('\n');
  return [prefix, points].filter(Boolean).join('\n');
}

function validateImplementationLogicChain(vars, opts = {}) {
  const implementation = implementationFromVars(vars);
  const logic = logicChainFromVars(vars);
  if (!logic) {
    return { ok: false, reason: '缺少逻辑链汇报 implementation.logic_chain', logic: null };
  }
  const text = collectText(logic).join('\n');
  const actionEntries = evidenceEntries(logic.actions || logic.steps || logic.did || logic.work);
  const evidence = evidenceEntries(logic.evidence || logic.proof || logic.artifacts || logic.tests || logic.commands || logic.basis);
  const hasStatus = !!(logic.current_status || logic.status || logic.state || logic.summary || implementation.summary);
  const hasConclusion = !!(logic.conclusion || logic.result || logic.summary || implementation.summary);
  if (!hasStatus) return { ok: false, reason: '逻辑链缺少当前状态/summary', logic };
  if (!hasConclusion) return { ok: false, reason: '逻辑链缺少结论/summary', logic };
  if (!actionEntries.length && !/做了|修改|新增|核实|分析|检查|运行|验证|确认|对比/i.test(text)) {
    return { ok: false, reason: '逻辑链缺少做了什么/actions', logic };
  }
  if (!evidence.length) {
    return { ok: false, reason: '逻辑链缺少证据/evidence', logic };
  }
  if (!evidenceHasHardPointer(evidence, opts.workspaceRoot)) {
    return { ok: false, reason: '逻辑链证据缺少可核指针(file/command/test/diff)', logic };
  }
  const acceptance = validateStructuredAcceptanceTable(vars, Object.assign({}, opts, { requireReview: false }));
  if (!acceptance.ok) return acceptance;
  return { ok: true, reason: null, logic };
}

function reviewVerdictIsPositive(review, verification) {
  if (review.verified === true || review.hard_verified === true) return true;
  const verdict = String((verification && (verification.verdict || verification.result || verification.judgement)) || '').toLowerCase();
  return ['true', 'pass', 'passed', 'ok', 'real', 'verified', '真', '通过'].includes(verdict);
}

function reviewMentionsChangedFiles(review, verification, changedFiles) {
  if (!changedFiles.length) return true;
  const hay = collectText([review, verification]).join('\n');
  return changedFiles.every(file => {
    const base = path.basename(file);
    return hay.includes(file) || (base && hay.includes(base));
  });
}

function implementationClaimedTests(vars) {
  const logic = logicChainFromVars(vars);
  const implementation = implementationFromVars(vars);
  const values = [
    logic && logic.tests,
    logic && logic.commands,
    implementation.tests,
    implementation.commands,
  ];
  return values.some(v => evidenceEntries(v).length > 0);
}

function validateReviewHardEvidence(vars, opts = {}) {
  const review = reviewFromVars(vars);
  const implementation = implementationFromVars(vars);
  const verification = reviewVerificationFromVars(vars);
  if (!verification) {
    return { ok: false, reason: '主管复审缺少 hard verification 结构', verification: null };
  }
  const checked = evidenceEntries(verification.checked || verification.checks || verification.verified_items || verification.items);
  const evidence = evidenceEntries(verification.evidence || verification.proof || verification.commands || verification.tests || verification.files);
  if (!checked.length) return { ok: false, reason: '主管复审缺少核实了哪些 checked[]', verification };
  if (!evidence.length) return { ok: false, reason: '主管复审缺少核实证据 evidence[]', verification };
  if (!evidenceHasHardPointer(evidence, opts.workspaceRoot)) {
    return { ok: false, reason: '主管复审证据缺少可核指针(file/command/test/diff)', verification };
  }
  if (review.pass === true && !reviewVerdictIsPositive(review, verification)) {
    return { ok: false, reason: 'review.pass=true 但 verification verdict 未确认真完成', verification };
  }
  const changed = normalizeChangedFiles(implementation);
  if (!reviewMentionsChangedFiles(review, verification, changed)) {
    return { ok: false, reason: '主管复审未逐项提及 changed_files 核实', verification };
  }
  if (implementationClaimedTests(vars)) {
    const text = collectText([review, verification]).join('\n');
    if (!/(test|测试|node\s+tests|npm\s+test|pytest|PASS|通过|exit\s*0|退出码\s*0)/i.test(text)) {
      return { ok: false, reason: '实现声称跑测试,但主管复审未核实测试结果', verification };
    }
  }
  const acceptance = validateStructuredAcceptanceTable(vars, opts);
  if (!acceptance.ok) return acceptance;
  return { ok: true, reason: null, verification };
}

// ===== P0-A:让验收真执行(executeEvidence)+ 真比对改动(gitVerify)=====
// 根因(玉兔6-根因诊断 §2 第二层):done gate 历来零进程执行,只校验 agent 自报的
// exit_code/PASS 文本 → 假完成被盖章。下面在 opts.executeEvidence===true 时实际 spawn
// 白名单命令、用真实退出码覆盖自报;真实非0 直接判 false。默认关闭、向后兼容。
const EXECUTABLE_EVIDENCE_WHITELIST = [
  /^node\s+tests\//i,
  /^node\s+[^\s|;&]*\.test\.js(\s|$)/i,
  /^npm\s+(run\s+)?test(\s|$)/i,
  /^pnpm\s+(run\s+)?test(\s|$)/i,
  /^yarn\s+test(\s|$)/i,
  /^pytest(\s|$)/i,
  /^python3?\s+-m\s+pytest(\s|$)/i,
];

// 生产开关:仅当环境变量为 '1' 时启用真执行(server 给 worker 注入 '1';测试不注入 → 默认关、行为不变)
const EXECUTE_EVIDENCE_ENV = 'YUTU6_DONE_GATE_EXECUTE';
function executeEvidenceEnabledFromEnv() {
  return process.env[EXECUTE_EVIDENCE_ENV] === '1';
}

function isWhitelistedEvidenceCommand(cmd) {
  const s = String(cmd || '').trim();
  if (!s) return false;
  // 禁止命令串联/重定向/插值绕过白名单(只允许单条测试命令真跑)
  if (/[;&|`$><]|\n/.test(s)) return false;
  return EXECUTABLE_EVIDENCE_WHITELIST.some(re => re.test(s));
}

function collectEvidenceCommandEntries(vars) {
  const logic = logicChainFromVars(vars) || {};
  const verification = reviewVerificationFromVars(vars) || {};
  const buckets = [
    logic.evidence, logic.tests, logic.commands, logic.proof, logic.basis,
    verification.evidence, verification.tests, verification.commands,
  ];
  const out = [];
  for (const bucket of buckets) {
    for (const entry of evidenceEntries(bucket)) {
      if (entry && typeof entry === 'object' && typeof entry.command === 'string' && entry.command.trim()) {
        out.push(entry);
      }
    }
  }
  return out;
}

// opts.executeEvidence===true:真跑证据声称的白名单命令,真实退出码为准。
// 任一白名单命令真实非0 → ok:false(当场堵假完成);非白名单命令记录但不阻断。
function verifyExecutableEvidence(vars, opts = {}) {
  if (opts.executeEvidence !== true) return { ok: true, executed: [], skipped: 'disabled' };
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const timeout = opts.evidenceTimeoutMs || 120000;
  const entries = collectEvidenceCommandEntries(vars);
  const executed = [];
  for (const entry of entries) {
    const cmd = String(entry.command).trim();
    const claimed = entry.exit_code != null ? entry.exit_code : entry.exitCode;
    if (!isWhitelistedEvidenceCommand(cmd)) {
      executed.push({ cmd, ran: false, reason: 'not_whitelisted' });
      continue;
    }
    const res = spawnSync(cmd, {
      cwd: workspaceRoot,
      shell: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
      // 子进程里强制关闭真执行开关:防止"证据命令本身是测试套件"时,嵌套 gate 再触发执行造成递归
      env: Object.assign({}, process.env, { [EXECUTE_EVIDENCE_ENV]: '0' }),
    });
    if (res.error) {
      return { ok: false, reason: `证据命令无法执行: ${cmd} (${res.error.code || res.error.message})`, executed };
    }
    const status = res.status;
    executed.push({ cmd, status, claimed });
    if (status !== 0) {
      const fakeNote = (claimed === 0 || claimed === '0') ? '(自报 exit_code:0,实为假完成)' : '';
      return { ok: false, reason: `证据命令实跑失败: ${cmd} → 实际退出码 ${status}${fakeNote}`, executed };
    }
  }
  return { ok: true, executed };
}

// gitVerify:返回 true=该文件在 git 工作区确有改动;false=确无改动;null=无法判定(非 git/出错)
function gitFileHasChange(file, workspaceRoot) {
  const res = spawnSync('git', ['status', '--porcelain', '--', file], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  return String(res.stdout || '').trim().length > 0;
}

// agent-once 自报未完成门(延续 P0-A 防假完成):
// 只在模型【显式】自报失败时拦——implementation.done===false 或 logic_chain.current_status==='blocked'。
// 无 implementation 字段、done 非显式 false(undefined/true)的一律放行,兼容不走 implementation 合同的角色(纯分析/洞察/GUI 等)。
function selfReportedIncomplete(vars) {
  const implementation = implementationFromVars(vars);
  if (implementation.done === false) {
    return { incomplete: true, reason: 'implementation.done=false(模型自报未完成)' };
  }
  const logic = logicChainFromVars(vars);
  if (logic && logic.current_status === 'blocked') {
    return { incomplete: true, reason: 'logic_chain.current_status=blocked(模型自报受阻)' };
  }
  return { incomplete: false, reason: null };
}

function validateReviewLoopCompletion(task, opts = {}) {
  if (!task) return { ok: false, reason: '缺少 taskstore 记录' };
  if (task.flow !== 'review-loop') return { ok: false, reason: `flow=${task.flow || 'unknown'} 不是 review-loop` };
  if (task.state !== 'done') return { ok: false, reason: `task.state=${task.state || 'unknown'} 不是 done` };
  const vars = task.vars || {};
  const implementation = implementationFromVars(vars);
  const review = reviewFromVars(vars);
  if (implementation.done !== true) return { ok: false, reason: 'implementation.done 未通过' };
  const logic = validateImplementationLogicChain(vars, opts);
  if (!logic.ok) return logic;
  if (review.pass !== true) return { ok: false, reason: 'review.pass 未通过' };
  const hardReview = validateReviewHardEvidence(vars, opts);
  if (!hardReview.ok) return hardReview;
  const changed = validateChangedFiles(implementation, opts);
  if (!changed.ok) return changed;
  const hardRegression = validateHardRegressionCoverage(vars, opts);
  if (!hardRegression.ok) return hardRegression;
  const protocol = ProtocolGate.validateCompletionProtocol(task, opts);
  if (!protocol.ok) return protocol;
  const acceptance = validateStructuredAcceptanceTable(vars, opts);
  if (!acceptance.ok) return acceptance;
  const loopEngineering = validateLoopEngineeringEvidence(vars, opts);
  if (!loopEngineering.ok) return loopEngineering;
  // P0-A:最后一道——真跑证据命令(opts.executeEvidence 时),自报 exit_code:0 但真跑失败 → 打回
  const execEvidence = verifyExecutableEvidence(vars, opts);
  if (!execEvidence.ok) return execEvidence;
  if (opts.requireDeliveryEvidence === true && !changed.changed.length) {
    const strings = collectText([implementation, task.evidence, task.steps]);
    const hasArtifact = strings.some(s => /\.(png|jpe?g|webp|gif|pdf|patch|diff)\b/i.test(s)
      || /截图|screenshot|peekaboo|git diff|文件已修改|已落盘/i.test(s));
    if (!hasArtifact) return { ok: false, reason: '交付型任务缺少 changed_files/截图/diff 等交付证据' };
  }
  // 拍板⑤:特权 runner 写路径白名单审计(告警模式)——完成校验链末尾收口。
  // 允许区外只在回执附 write_audit 告警字段、不打回;Starlaid/星桥命中仍硬失败(红线不放宽)。
  // opts.runnersConfig 未注入或 env YUTU6_WRITE_AUDIT=0 时零行为变化(保守默认)。
  const writeAudit = WriteAudit.auditPrivilegedTaskWrites(task, opts);
  if (writeAudit && !writeAudit.ok) {
    return { ok: false, reason: writeAudit.reason, write_audit: writeAudit };
  }
  return {
    ok: true,
    reason: null,
    logic_chain: logic.logic,
    verification: hardReview.verification,
    changed_files: changed.changed,
    write_audit: writeAudit && writeAudit.enabled && !writeAudit.skipped ? writeAudit : null,
    protocol,
  };
}

module.exports = {
  collectText,
  deliveryEvidenceRequiredFromText,
  readStructuredAcceptanceTemplate,
  structuredAcceptanceTemplatePath,
  structuredAcceptanceTemplateReference,
  hasStructuredAcceptanceTable,
  buildStructuredAcceptanceTable,
  parseStructuredAcceptanceRows,
  findAcceptanceRow,
  taskRequiredAcceptanceRows,
  implementationAcceptanceRows,
  reviewAcceptanceRows,
  validateStructuredAcceptanceTable,
  logicChainFromVars,
  reviewVerificationFromVars,
  validateChangedFiles,
  verifyExecutableEvidence,
  executeEvidenceEnabledFromEnv,
  requiredHardRegressionRules,
  validateHardRegressionCoverage,
  validateProtocolCompletion: ProtocolGate.validateCompletionProtocol,
  computeSpecFingerprint: ProtocolGate.computeSpecFingerprint,
  validateLoopEngineeringEvidence,
  validateImplementationLogicChain,
  validateReviewHardEvidence,
  validateReviewLoopCompletion,
  selfReportedIncomplete,
};
