'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ProtocolGate = require('./protocol-gate');
const RegressionCommandPolicy = require('./regression-command-policy');
const WriteAudit = require('./write-audit');
const AcceptanceContract = require('./acceptance-contract');

const DELIVERY_NO_CHANGE_RE = /(不改任何文件|无需改文件|不用改文件|不要改任何文件|只读|调研|复盘|报告|评估|清单|说明|确认|冒烟|验证|审查)/i;
const DELIVERY_ACTION_RE = /(修复|修改|改造|实现|新增|接入|落地|合入|调整|重做|重构|代码|源码|文件|页面|布局|前端|UI|HTML|CSS|JS|workspace|server\.js|ceo-worker|shared\/engine|截图|Peekaboo)/i;
const STRUCTURED_ACCEPTANCE_MARKER = '结构化验收表';
const STRUCTURED_ACCEPTANCE_PROTOCOL = 'structured-acceptance@2';
const STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER = `验收表协议: ${STRUCTURED_ACCEPTANCE_PROTOCOL}`;
const STRUCTURED_ACCEPTANCE_COLUMNS = ['要点', '完成状态(完成/部分/未完成)', '证据位置(文件:行 / git diff / 截图路径)', '备注'];
const STRUCTURED_ACCEPTANCE_HEADER_METADATA_RE = /证据位置\s*\(\s*文件\s*[:：]\s*行\s*\/\s*git\s+diff\s*\/\s*截图路径\s*\)/gi;
const STRUCTURED_ACCEPTANCE_TEMPLATE_REL = 'templates/structured-acceptance-table.md';
const ACCEPTANCE_DONE_STATUS = '完成';
const ACCEPTANCE_NOT_APPLICABLE_STATUS = 'not_applicable';
const ACCEPTANCE_NOT_DONE_STATUSES = new Set(['部分', '未完成', 'pending', 'partial', 'todo', '']);
const NEGATIVE_REVIEW_ACCEPTANCE_STATUSES = new Set(['完成', '部分', '未完成']);
const NEGATIVE_REVIEW_VERDICTS = new Set([
  'false', 'fail', 'failed', 'reject', 'rejected', 'partial', 'blocked',
  '假', '失败', '未通过', '不通过', '部分', '打回',
]);
const IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA = 'implementation-failure-receipt@1';
const SUPERVISOR_REVIEW_BINDING_SCHEMA = 'supervisor-review-binding@1';
const REVIEW_SEVERITIES = new Set(['low', 'medium', 'high']);
const DESIGN_GATE_RE = /(decisions\.md|memory\/decisions|board\/decisions|设计(?:文件|记忆|条目|决策|对照)|按设计|对照设计|设计稿)/i;
// A generic audit pointer such as "董事会记录见 memory/decisions.md" must not turn
// every historical decision into a task acceptance row. Implicit lookup is reserved
// for task text that explicitly asks to follow or compare a design source. Exact
// decisions.md line references remain authoritative via explicitDecisionLines().
const IMPLICIT_DECISION_LOOKUP_RE = /(?:按|对照|参考|参照|依据|读取).{0,20}(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md)|设计(?:对照|规范|方案|稿)/i;
const DIRECTED_DECISION_LOOKUP_RE = /(?:按|对照|参考|参照|依据|读取).{0,20}(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md)/i;
const NEGATED_DECISION_DIRECTION_RE = /(?:不(?:需要|需|必须|必|用|要|应该|应|该|可以|可|能|得)?|无(?:需|须)|不用|禁止|避免)\s*(?:再)?\s*(?:按|对照|参考|参照|依据|读取).{0,20}(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md)/gi;
const NEGATED_DECISION_PLACEHOLDER_RE = /(?:(?:不(?:得|能|应该?|可以?|需要)?|不可|禁止|避免|拒绝)\s*(?:仅|只)?\s*(?:以|把|将|用|拿|靠)\s*(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md).{0,20}(?:代替|替代|冒充|充当|当作|视为|作为).{0,12}(?:实现|代码|交付|完成|证据|产物|验收)|(?:不得|不能|不可|禁止|避免|拒绝)\s*(?:仅|只)\s*(?:交|提交|提供|输出|产出|交付)?\s*(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md)(?:.{0,12}(?:自述|声明))?(?:.{0,8}(?:完成|交付))?)/gi;
const POST_NEGATED_DECISION_PLACEHOLDER_RE = /(?:设计(?:文件|记忆|条目|决策|规范|方案|稿)|(?:memory\/|board\/)?decisions\.md).{0,12}(?:不能|不得|不可|不应|不该|不可以|并非|不是)\s*(?:用来|用于)?\s*(?:代替|替代|冒充|充当|作为|当作|视为).{0,12}(?:实现|代码|交付|完成|证据|产物|验收)/gi;
const VISUAL_DESIGN_REVIEW_PHRASE_RE = /(?:Codex|GPT[-_. ]?5[-_. ]?Codex)\s*对照设计挑错/gi;
// UI must be a standalone token (or touch non-ASCII text). Without boundaries,
// ordinary identifiers such as `build` and audit references such as
// `ui-optimizer` are mistaken for real visual work.
const VISUAL_TERM_SOURCE = '(?:视觉|(?<![A-Za-z0-9_-])UI(?![A-Za-z0-9_-])|界面|前端|页面|布局|样式|截图|截屏|Peekaboo|screenshot|workspace\\.html|html|css|sprite|tile|地块|办公室|图标|按钮|颜色|动效)';
const VISUAL_UI_RE = new RegExp(VISUAL_TERM_SOURCE, 'i');
const VISUAL_REFERENCE_ONLY_LINE_RE = /(?:参考(?:案例|资料|文件)?|参照(?:案例|资料|文件)?|证据(?:路径|来源)?|记录见|依据(?:文件|案例)?)\s*[:：]/i;
const EXPLICIT_VISUAL_EVIDENCE_REQUEST_RE = /(?:必须|需要|要求|须|应|提供|提交|附上?|包含).{0,20}(?:截图|截屏|Peekaboo|视觉证据|UI证据)|(?:截图|截屏|Peekaboo|视觉证据|UI证据).{0,20}(?:必须|需要|要求|须|应|提供|提交|附上?|包含)/i;
const VISUAL_NA_EVIDENCE_RE = /(?:视觉\s*\/\s*UI|UI\s*\/\s*视觉|视觉|UI)\s*(?:证据|验收)?\s*(?:[:：]\s*)?(?:N\s*\/\s*A|NA|不适用|无需|不用|没有|无|none|null)(?=$|[\s,，;；。!！?？—-]|但|同时|且|仍|还|并)/gi;
const NEGATED_VISUAL_TERM_RE = new RegExp(
  `(?:本任务|该任务|当前任务)?\\s*(?:不(?:需要|需|用|涉及|包含|改|修改|处理|触碰|要求)|无需|不用|排除|跳过|非|不是|并非|没有|无)\\s*(?:任何)?\\s*${VISUAL_TERM_SOURCE}(?:\\s*(?:或|和|及|、|\\/)?\\s*${VISUAL_TERM_SOURCE})*(?:\\s*(?:需求|证据|验收|面|工作|改动|内容|产物))?`,
  'gi',
);
const EXPLICIT_NO_VISUAL_SURFACE_RE = /(?:视觉\s*\/\s*UI|UI\s*\/\s*视觉|视觉|UI).{0,16}(?:证据|验收).{0,16}(?:N\s*\/\s*A|NA|不适用)|(?:本任务|该任务|当前任务).{0,16}(?:不涉及|不是|并非|没有|无|非)\s*(?:UI|视觉|界面|页面)|(?:没有|无|非)\s*(?:UI|视觉)(?:验收)?(?:面|需求|工作|改动|内容|产物)|(?:没有|无|非)\s*UI\s*(?:或|和|及|、|\/)\s*视觉(?:验收)?面|(?:纯引擎|仅涉及引擎).{0,32}(?:没有|无|不需要|不涉及)\s*(?:UI|视觉)/i;
const VISUAL_WORK_ACTION_RE = new RegExp(
  `(?:修改|优化|实现|新增|调整|重做|重构|修复|制作|生成|替换|美化|改造|开发|交付|适配).{0,24}${VISUAL_TERM_SOURCE}|${VISUAL_TERM_SOURCE}.{0,24}(?:修改|优化|实现|新增|调整|重做|重构|修复|制作|生成|替换|美化|改造|开发|交付|适配)`,
  'i',
);
const VISUAL_SURFACE_WORK_ACTION_RE = /(?:修改|优化|实现|新增|调整|重做|重构|修复|制作|生成|替换|美化|改造|开发|交付|适配).{0,24}(?:UI|界面|前端|页面|布局|样式|workspace\.html|html|css|sprite|tile|地块|办公室|图标|按钮|颜色|动效)|(?:UI|界面|前端|页面|布局|样式|workspace\.html|html|css|sprite|tile|地块|办公室|图标|按钮|颜色|动效).{0,24}(?:修改|优化|实现|新增|调整|重做|重构|修复|制作|生成|替换|美化|改造|开发|交付|适配)/i;
// Policy, protocol and fixture descriptions routinely quote the exact words that
// should trigger a real visual task. Keep these clauses inside the shared signal
// source so the classifier and done gate cannot drift or self-trigger on their own
// acceptance policy. A concrete surface-change action in the same clause still wins.
const VISUAL_POLICY_META_CLAUSE_RE = /(?:not_applicable|positiveVisualRequirement|visual[_ -]?acceptance|human\s*gate|条件化注入|视觉行|分类(?:器|逻辑|结果|协议)?|判定(?:顺序|优先级|规则)?|优先级(?:链|翻转)?|门禁测试|正向用例|负向用例|混合标签|mock\s*runner|runner\s*prompt|fixture|协议变更|memory_officer|repair\s*no-op|非\s*(?:UI|视觉)\s*(?:PoC|任务)|待补视觉状态|预期收益|风险\/偏差|修订建议|已知漏判|漏判空间|截图污染|真实性校验|间接影响\s*UI|节省.{0,20}(?:视觉|截图)|证明.{0,24}(?:不再|没有|无).{0,12}(?:截图|视觉)|显式(?:用户|视觉)要求.{0,20}(?:始终保留|优先)|(?:注入|保留|拿到|生成).{0,20}(?:Peekaboo\s*\+?\s*Codex|视觉(?:判定)?行))/i;
const VISUAL_POLICY_STRONG_META_CLAUSE_RE = /(?:非\s*(?:UI|视觉)\s*任务|待补视觉状态|预期收益|风险\/偏差|修订建议|已知漏判|漏判空间|截图污染|真实性校验|间接影响\s*UI|节省.{0,20}(?:视觉|截图)|证明.{0,24}(?:不再|没有|无).{0,12}(?:截图|视觉))/i;
const VISUAL_ACCEPTANCE_SCHEMA = 'visual-acceptance@1';
const VISUAL_ACCEPTANCE_PENDING = 'pending_visual_evidence';
const VISUAL_ACCEPTANCE_NA = ACCEPTANCE_NOT_APPLICABLE_STATUS;
const VISUAL_ACCEPTANCE_POINT = '视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告';
const VISUAL_ACCEPTANCE_NA_POINT = '视觉/UI证据: not_applicable';
const VISUAL_FRONTEND_FILE_RE = /\.(?:html?|css|scss|sass|less|vue|svelte|jsx|tsx)$/i;
const VISUAL_COMPONENT_STYLE_DIR_RE = /(?:^|\/)(?:components?|styles?|styling|theme|ui|views?|pages?)(?:\/|$)/i;
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
const BAD_ACCEPTANCE_NOTES_RE = /自验收已归档|自验收|无证据|待补|稍后补|只写声明|仅写声明|口头声明/i;
const ACCEPTANCE_NO_EVIDENCE_POLICY_RE = /(?:无证据(?:建议|提议|意见|机制|候选)|(?:建议|提议|意见|机制|候选).{0,16}无证据)/gi;
const IMAGE_PATH_RE = /\.(?:png|jpe?g|webp|gif)\b/i;
const VISUAL_EVIDENCE_MISSING_AUDIT_RE = /(?:visual[_ ]?evidence[_ ]?count\s*[:=]\s*0|(?:截图|截屏|图片|图像|视觉(?:\s*\/\s*UI)?证据).{0,24}(?:数量|count).{0,8}(?:为|[:=])?\s*0|(?:缺少|未找到|找不到|不存在|没有|未提供|未附|未提交).{0,24}(?:截图|截屏|图片|图像|视觉(?:\s*\/\s*UI)?证据)|(?:截图|截屏|图片|图像|视觉(?:\s*\/\s*UI)?证据).{0,24}(?:缺失|缺件|未找到|不存在|没有|未提供|未附|未提交))/i;

const HARD_REGRESSION_RULES = [
  {
    id: 'queue_merge_integrity',
    label: '队列合并/整理硬回归',
    mode: 'active',
    reason: 'Queue merge work previously reported completion without reducing or safely migrating the real queue.',
    incident_refs: [
      'board/repair-tickets/auto-20260623020730-e485207314349a23.md',
      'board/repair-tickets/auto-20260623034045-e485207314349a23.md',
      'board/repair-tickets/auto-20260623041248-e485207314349a23.md',
    ],
    triggers: [
      /queue[-_\s]*(organize|merge|control)/i,
      /(队列|queue(?![-_]?(?:id|agent)\b)|排队).{0,24}(整理|合并|去重|清理重复|插队|优先级)/i,
      /(CEO|ceo).{0,24}(队列|queue(?![-_]?(?:id|agent)\b)).{0,24}(整理|合并|去重|清理重复|插队|优先级)/i,
      /(整理|合并|去重|清理重复|插队|优先级).{0,24}(队列|queue(?![-_]?(?:id|agent)\b)|排队)/i,
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
  return path.isAbsolute(raw) ? raw : path.resolve(workspaceRoot || process.cwd(), raw);
}

function pathExists(file, workspaceRoot) {
  const resolved = workspacePath(file, workspaceRoot);
  return !!resolved && fs.existsSync(resolved);
}

function extractPathPointers(text) {
  const out = [];
  const re = /((?:\/Users\/[^\s'"`，,。；;:)#]+)|(?:[A-Za-z0-9_\-.\u3400-\u9fff]+\/[A-Za-z0-9_\-./\u3400-\u9fff]+))(?:[:#]\d+)?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[1].replace(/[)\]}.,;，。；]+$/g, '');
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

function extractPathPointerDetails(text) {
  const out = [];
  const re = /((?:\/Users\/[^\s'"`，,。；;:)#]+)|(?:[A-Za-z0-9_\-.\u3400-\u9fff]+\/[A-Za-z0-9_\-./\u3400-\u9fff]+))(?:[:#]L?(\d+))?/g;
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
      text: normalizePoint(row.text || row.machine_text || row.machineText),
      status: normalizePoint(status),
      evidence: normalizePoint(evidence),
      notes: normalizePoint(notes),
      acceptance_id: normalizePoint(row.acceptance_id || row.acceptanceId),
      source_hash: normalizePoint(row.source_hash || row.sourceHash),
      scope: normalizePoint(row.scope || row.scope_tag || row.scopeTag),
      source_ref: normalizePoint(row.source_ref || row.sourceRef),
      source_kind: normalizePoint(row.source_kind || row.sourceKind),
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
  const contract = vars && (vars.acceptance_contract || vars.acceptanceContract);
  if (contract) {
    try { return AcceptanceContract.acceptanceRows(contract); } catch (_) { return []; }
  }
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
  return !!(vars && (vars.acceptance_contract || vars.acceptanceContract))
    || hasStructuredAcceptanceTable(vars && vars.acceptance)
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

function evidenceFileContainsExactRequiredPointResult(required, row, opts = {}) {
  const point = normalizePoint(required && required.point);
  if (!point) return false;
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const evidenceText = [row && row.evidence, row && row.notes].filter(Boolean).join('\n');
  for (const pointer of extractPathPointerDetails(evidenceText)) {
    if (!pointerExists(pointer, workspaceRoot)) continue;
    const resolved = workspacePath(pointer.path, workspaceRoot);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!normalizePoint(lines[index]).includes(point)) continue;
        // A result on another row can belong to another acceptance point. Keep the
        // downgrade deliberately narrow: the exact required point and its concrete
        // outcome must share one durable evidence record (for example one table row).
        const localResult = lines[index];
        const withoutPoint = normalizePoint(localResult).replace(point, ' ');
        const explicitResult = /(?:(?:核对|执行|验收|验证|检查)(?:结果|状态|结论)|status|result|outcome|evidence[_\s-]?summary)\s*[:=：]\s*(?:完成|部分|未完成|通过|未通过|不通过|失败|阻塞|pass(?:ed)?|fail(?:ed)?|partial|blocked|reject(?:ed)?|rework|checked|verified)(?=$|[\s|;；,，。])/i.test(withoutPoint);
        const structuredRowResult = /\|\s*(?:完成|部分|未完成|not_applicable)\s*\|/i.test(lines[index]);
        if (explicitResult || structuredRowResult) return true;
      }
    } catch (_) {}
  }
  return false;
}

function reviewAlignmentFailureDisposition(vars, hard, opts = {}) {
  const reason = String(hard && hard.reason || '');
  if (!/证据与本行要点缺少可核对齐信息/.test(reason)) {
    return { warning: false, category: null, misalignedRows: [] };
  }
  const failures = [];
  const filledRows = reviewAcceptanceRows(vars);
  for (const required of taskRequiredAcceptanceRows(vars)) {
    const row = findAcceptanceRow(required, filledRows);
    if (!row || (visualAcceptancePoint(required.point)
      && normalizePoint(row.status) === ACCEPTANCE_NOT_APPLICABLE_STATUS)) continue;
    const alignment = validateAcceptanceEvidenceAlignment(required, row, opts);
    if (!alignment.ok) failures.push({ required, row, reason: alignment.reason });
  }
  const nonSubstantive = failures.length > 0
    && failures.every(failure => failure.reason === '证据与本行要点缺少可核对齐信息'
      && evidenceFileContainsExactRequiredPointResult(failure.required, failure.row, opts));
  return {
    warning: nonSubstantive,
    category: nonSubstantive
      ? 'non_substantive_local_pointer_heuristic'
      : 'substantive_evidence_misalignment',
    misalignedRows: failures.map(failure => normalizePoint(failure.required.point)),
  };
}

function findAcceptanceRow(required, filledRows) {
  const requiredAcceptanceId = normalizePoint(required && (required.acceptance_id || required.acceptanceId));
  if (requiredAcceptanceId) {
    return filledRows.find(row => normalizePoint(row && (row.acceptance_id || row.acceptanceId)) === requiredAcceptanceId) || null;
  }
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

function acceptanceEvidenceUsesUnverifiableClaim(evidence) {
  // Commands can legitimately serialize an absent optional value (for example
  // `reason:r.reason||null`). Do not mistake that source-code token for an
  // evidence placeholder; a bare `null` remains blocked by the original regex.
  const commandAwareEvidence = normalizePoint(evidence)
    .replace(/\|\|\s*(?:none|null)\b/gi, ' logical-fallback-value ');
  return BAD_ACCEPTANCE_EVIDENCE_RE.test(commandAwareEvidence);
}

function acceptanceNotesUseUnverifiableClaim(notes) {
  const text = normalizePoint(notes);
  // Notes may describe the policy under test (for example an "无证据建议"
  // being kept as an experiment). Concrete evidence is still required and
  // verified independently below; mask only the policy phrase so another real
  // placeholder in the same notes (such as "待补") still fails closed.
  const policyAwareNotes = text.replace(ACCEPTANCE_NO_EVIDENCE_POLICY_RE, ' evidence-policy ');
  return BAD_ACCEPTANCE_NOTES_RE.test(policyAwareNotes);
}

function validateFilledAcceptanceRows(requiredRows, filledRows, opts = {}) {
  const label = opts.label || 'implementation.acceptance_table';
  const allowedStatuses = opts.allowedStatuses instanceof Set
    ? opts.allowedStatuses
    : new Set([ACCEPTANCE_DONE_STATUS]);
  const protocolV2 = opts.acceptanceProtocolV2 === true;
  if (!filledRows.length) return { ok: false, reason: `${label} 缺少结构化验收表逐行填写` };
  if (opts.acceptanceContract) {
    const identity = AcceptanceContract.validateConsumerRows(opts.acceptanceContract, filledRows, {
      textDiagnostic: opts.acceptanceTextDiagnostic === true,
    });
    if (!identity.ok) {
      return { ok: false, reason: `${label} 机器验收身份不一致: ${identity.reason}`, acceptance_contract_errors: identity.errors };
    }
  }
  for (let i = 0; i < requiredRows.length; i += 1) {
    const required = requiredRows[i];
    const row = findAcceptanceRow(required, filledRows);
    const rowLabel = `${label} 第${i + 1}行`;
    if (!row) return { ok: false, reason: `${rowLabel} 缺少要点: ${required.point}` };
    if (!row.point) return { ok: false, reason: `${rowLabel} 要点为空` };
    const status = normalizePoint(row.status);
    const requiredNotApplicable = protocolV2 && visualAcceptancePoint(required.point)
      && (notApplicableVisualRow(required)
        || !!(opts.visualAcceptance && opts.visualAcceptance.required === false));
    if (requiredNotApplicable) {
      if (status !== ACCEPTANCE_NOT_APPLICABLE_STATUS) {
        return { ok: false, reason: `${rowLabel} 非视觉行必须使用单一 not_applicable 状态,禁止“完成+不适用”混填: ${required.point}` };
      }
      const audit = opts.visualAcceptance;
      if (!audit || audit.schema !== VISUAL_ACCEPTANCE_SCHEMA || audit.required !== false
        || audit.state !== VISUAL_ACCEPTANCE_NA) {
        return { ok: false, reason: `${rowLabel} not_applicable 与任务信封 visual_acceptance 审计不一致: ${required.point}` };
      }
      const evidence = normalizePoint(row.evidence);
      if (!/task-envelope:visual_acceptance/i.test(evidence)) {
        return { ok: false, reason: `${rowLabel} not_applicable 缺少 task-envelope:visual_acceptance 审计指针: ${required.point}` };
      }
      continue;
    }
    if (protocolV2 && status === ACCEPTANCE_NOT_APPLICABLE_STATUS) {
      return { ok: false, reason: `${rowLabel} 仅非视觉判定行可使用 not_applicable: ${required.point}` };
    }
    if (!allowedStatuses.has(status)) {
      const suffix = ACCEPTANCE_NOT_DONE_STATUSES.has(status) ? '未完成' : `状态=${status || '空'}`;
      return { ok: false, reason: `${rowLabel} ${suffix}: ${required.point}` };
    }
    const evidence = normalizePoint(row.evidence);
    const notes = normalizePoint(row.notes);
    if (!evidence) return { ok: false, reason: `${rowLabel} 证据位置为空: ${required.point}` };
    if (protocolV2 && visualAcceptancePoint(row.point) && status === ACCEPTANCE_DONE_STATUS
      && /(?:not_applicable|N\s*\/\s*A|不适用)/i.test(`${evidence}\n${notes}`)) {
      return { ok: false, reason: `${rowLabel} 禁止“完成+不适用”混填: ${required.point}` };
    }
    if (acceptanceEvidenceUsesUnverifiableClaim(evidence) || acceptanceNotesUseUnverifiableClaim(notes)) {
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

function fileSha256(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (_) { return null; }
}

function visualObservationHasSpecificContent(value) {
  const text = String(value || '').trim();
  if (text.length < 8) return false;
  const residue = text
    .replace(/\b(?:stat|shasum|sips|sha-?256|hash|checksum|file\s+exists?|dimensions?|width|height)\b/gi, ' ')
    .replace(/(?:文件|路径)(?:存在|可读|已找到)|哈希|校验和|尺寸|分辨率|沿用(?:上轮|上一轮)(?:\s*critique|结论|报告)?|(?:逐张|已经|已)?(?:打开|查看|检查)(?:原图|图片|截图)?|(?:均已|已经|已)?核实|完整(?:打开|查看)?/gi, ' ')
    .replace(/[a-f0-9]{16,}/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return residue.length >= 4;
}

function validateRuntimeVisualReviewReceipt(vars, evidenceImages, workspaceRoot) {
  const verification = reviewVerificationFromVars(vars) || {};
  const receipt = verification.runtime_visual_input;
  if (!receipt || receipt.schema !== 'codex-cli-image-v1') {
    return { ok: false, reason: '视觉/UI 类验收缺少 runner 注入的 Codex CLI 图片输入回执' };
  }
  if (receipt.attached !== true) {
    return { ok: false, reason: `视觉/UI 图片查看工具轨迹不可用,review 必须标 partial/blocked: ${receipt.reason || 'runtime visual input unavailable'}` };
  }
  if (receipt.source !== 'runner-spawn-argv' || receipt.tool !== 'codex exec --image'
    || !Array.isArray(receipt.images) || !receipt.images.length) {
    return { ok: false, reason: '视觉/UI 图片输入回执不是可核验的 runner 启动轨迹' };
  }
  const tracePath = String(receipt.trace_path || '');
  const traceSha = String(receipt.trace_sha256 || '').toLowerCase();
  if (!tracePath || path.isAbsolute(tracePath) || !/^[a-f0-9]{64}$/.test(traceSha)) {
    return { ok: false, reason: '视觉/UI 图片输入回执缺少 runner-owned trace 路径或哈希' };
  }
  const absoluteTracePath = workspacePath(tracePath, workspaceRoot);
  if (!absoluteTracePath || !fs.existsSync(absoluteTracePath) || fileSha256(absoluteTracePath) !== traceSha) {
    return { ok: false, reason: `视觉/UI runner-owned trace 不存在或哈希不一致: ${tracePath}` };
  }
  let trace;
  try { trace = JSON.parse(fs.readFileSync(absoluteTracePath, 'utf8')); } catch (_) { trace = null; }
  const receiptImages = receipt.images.map(image => ({
    path: image && String(image.path || ''),
    sha256: image && String(image.sha256 || '').toLowerCase(),
  }));
  if (!trace || trace.schema !== 'codex-cli-image-trace-v1'
    || trace.source !== receipt.source || trace.tool !== receipt.tool
    || String(trace.runner || '') !== String(receipt.runner || '')
    || JSON.stringify(trace.images || []) !== JSON.stringify(receiptImages)) {
    return { ok: false, reason: `视觉/UI runner-owned trace 内容与回执不一致: ${tracePath}` };
  }
  const receiptByAbsolutePath = new Map();
  for (const image of receiptImages) {
    const imagePath = image && String(image.path || '');
    const expectedSha = image && String(image.sha256 || '').toLowerCase();
    if (!imagePath || path.isAbsolute(imagePath) || !/^[a-f0-9]{64}$/.test(expectedSha)) {
      return { ok: false, reason: '视觉/UI 图片输入回执格式不合法' };
    }
    const absolutePath = workspacePath(imagePath, workspaceRoot);
    if (!absolutePath || !fs.existsSync(absolutePath) || fileSha256(absolutePath) !== expectedSha) {
      return { ok: false, reason: `视觉/UI 图片输入回执的路径或哈希不一致: ${imagePath}` };
    }
    if (receiptByAbsolutePath.has(path.resolve(absolutePath))) {
      return { ok: false, reason: `视觉/UI 图片输入回执包含重复图片: ${imagePath}` };
    }
    receiptByAbsolutePath.set(path.resolve(absolutePath), { path: imagePath, sha256: expectedSha });
  }
  for (const evidenceImage of evidenceImages) {
    const absolutePath = workspacePath(evidenceImage, workspaceRoot);
    if (!absolutePath || !receiptByAbsolutePath.has(path.resolve(absolutePath))) {
      return { ok: false, reason: `视觉/UI 证据图未真实附加给 Codex 评审: ${evidenceImage}` };
    }
  }
  const observations = Array.isArray(verification.visual_observations)
    ? verification.visual_observations : [];
  const observedPaths = new Set();
  for (const item of observations) {
    const itemPath = item && String(item.path || '');
    const absolutePath = workspacePath(itemPath, workspaceRoot);
    const receiptImage = absolutePath && receiptByAbsolutePath.get(path.resolve(absolutePath));
    if (!receiptImage || String(item.sha256 || '').toLowerCase() !== receiptImage.sha256) {
      return { ok: false, reason: `视觉/UI 逐图观察引用了未附加或哈希不匹配的图片: ${itemPath || '(空路径)'}` };
    }
    if (observedPaths.has(path.resolve(absolutePath))) {
      return { ok: false, reason: `视觉/UI 逐图观察包含重复图片: ${itemPath}` };
    }
    observedPaths.add(path.resolve(absolutePath));
  }
  for (const image of receiptImages) {
    const observation = observations.find(item => item
      && String(item.path || '') === String(image.path || '')
      && String(item.sha256 || '').toLowerCase() === String(image.sha256 || '').toLowerCase()
      && visualObservationHasSpecificContent(item.observation));
    if (!observation) {
      return { ok: false, reason: `视觉/UI 评审缺少逐图具体可见内容观察;stat/尺寸/哈希/文件存在/旧 critique 不算看图: ${image.path}` };
    }
  }
  return { ok: true, reason: null };
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
  if (acceptanceNotesUseUnverifiableClaim(hay)) {
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
  // The trusted CLI image trace is produced by the review runner. Implementation
  // still needs real Peekaboo/Codex evidence, but cannot require future review state.
  if (opts.requireReview !== false) {
    const runtimeVisual = validateRuntimeVisualReviewReceipt(vars, images, workspaceRoot);
    if (!runtimeVisual.ok) return runtimeVisual;
  }
  return { ok: true, reason: null };
}

function negativeReviewDocumentsMissingVisualEvidence(vars, implementationRows, reviewRows, opts = {}) {
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars) || {};
  if (review.pass !== false || !reviewVerdictIsNegative(verification)) return false;
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const hay = collectText([
    review.notes,
    verification.checked,
    verification.evidence,
    acceptanceRowsEvidenceText(implementationRows),
    acceptanceRowsEvidenceText(reviewRows),
  ]).join('\n');
  // Missing-document audits do not inspect pixels. Once any real image is cited,
  // the ordinary runner-owned trace/SHA/per-image observation gate remains mandatory.
  if (visualEvidenceImagePaths(hay, workspaceRoot).length > 0) return false;
  const observations = Array.isArray(verification.visual_observations)
    ? verification.visual_observations : [];
  if (observations.length > 0) return false;
  return evidenceEntries(verification.evidence).some(entry => {
    const auditText = entryText(entry);
    return VISUAL_EVIDENCE_MISSING_AUDIT_RE.test(auditText)
      && evidencePointerIsVerifiable([entry], opts);
  });
}

function validateVisualAcceptanceProtocol(vars, requiredRows) {
  const audit = vars && (vars.visual_acceptance || vars.visualAcceptance);
  const tableMarkedV2 = structuredAcceptanceProtocolV2(vars && vars.acceptance);
  // In-flight compatibility: some tasks received the versioned audit field just
  // before their already-built acceptance body was refreshed. The audit protocol
  // is an equally explicit version marker; tasks with neither marker stay legacy.
  const protocolV2 = tableMarkedV2 || !!(audit
    && audit.schema === VISUAL_ACCEPTANCE_SCHEMA
    && audit.acceptance_protocol === STRUCTURED_ACCEPTANCE_PROTOCOL);
  if (!protocolV2) {
    return {
      ok: true,
      protocolV2: false,
      visualRequired: positiveVisualRequirement(collectText([
        vars && vars.goal,
        vars && vars.bounds,
      ]).join('\n')) || requiredRows.some(row => visualAcceptancePoint(row.point)),
    };
  }
  const visualRows = requiredRows.filter(row => visualAcceptancePoint(row.point));
  if (visualRows.length !== 1) {
    return { ok: false, reason: `structured-acceptance@2 必须且只能有一行视觉判定,实际=${visualRows.length}` };
  }
  if (!audit || audit.schema !== VISUAL_ACCEPTANCE_SCHEMA
    || audit.acceptance_protocol !== STRUCTURED_ACCEPTANCE_PROTOCOL) {
    return { ok: false, reason: 'structured-acceptance@2 缺少任务信封 visual_acceptance 分类审计' };
  }
  const auditRequired = audit.required === true;
  const auditPositiveSignal = audit.explicit_visual_requirement === true
    || audit.human_gate_forced === true
    || (Array.isArray(audit.path_matches) && audit.path_matches.length > 0)
    || audit.task_type_positive === true;
  if (!auditRequired && auditPositiveSignal) {
    return { ok: false, reason: 'visual_acceptance 审计自相矛盾:显式要求、human gate、变更路径或正向任务类型已命中却标为 not_applicable' };
  }
  const implementation = implementationFromVars(vars) || {};
  const runtimePathMatches = auditRequired ? [] : visualChangePathMatches({
    changedFiles: implementation.changed_files,
  });
  if (runtimePathMatches.length) {
    return {
      ok: false,
      reason: `visual_acceptance 审计已过期:实际 changed_files 命中视觉变更路径,not_applicable 必须重判 (${runtimePathMatches.join(', ')})`,
    };
  }
  const auditPathMatches = Array.isArray(audit.path_matches) ? audit.path_matches : [];
  const classificationInput = Object.assign({}, vars, {
    acceptance: requiredRows
      .filter(row => !visualAcceptancePoint(row.point))
      .map(row => row.point).join('\n'),
    visual_acceptance: null,
    visualAcceptance: null,
    explicitVisualRequirement: audit.explicit_visual_requirement === true
      || vars && (vars.explicitVisualRequirement === true || vars.explicit_visual_requirement === true),
    visualAcceptanceHumanGate: visualAcceptanceHumanGateForced(vars),
    changePaths: declaredVisualChangePaths(vars).concat(auditPathMatches),
    taskType: audit.task_type_positive === true
      ? [vars && vars.taskType, vars && vars.task_type, 'UI'].filter(Boolean).join('\n')
      : vars && (vars.taskType || vars.task_type),
  });
  const expected = classifyVisualAcceptance(classificationInput);
  const auditStateValid = audit.state === (auditRequired ? VISUAL_ACCEPTANCE_PENDING : VISUAL_ACCEPTANCE_NA);
  if (!auditStateValid || expected.required !== auditRequired) {
    return {
      ok: false,
      reason: `visual_acceptance 审计与任务需求不一致: expected=${expected.state}, envelope=${audit.state || 'missing'}`,
    };
  }
  if (audit.source && audit.source !== expected.source) {
    return {
      ok: false,
      reason: `visual_acceptance 审计优先级来源不一致: expected=${expected.source}, envelope=${audit.source}`,
    };
  }
  if (audit.priority != null && Number(audit.priority) !== expected.priority) {
    return {
      ok: false,
      reason: `visual_acceptance 审计优先级序号不一致: expected=${expected.priority}, envelope=${audit.priority}`,
    };
  }
  const rowNotApplicable = notApplicableVisualRow(visualRows[0]);
  if (auditRequired && rowNotApplicable) {
    return { ok: false, reason: '显式视觉要求、human gate、视觉变更路径或正向视觉任务不得标 not_applicable' };
  }
  if (!auditRequired && !rowNotApplicable && tableMarkedV2) {
    return { ok: false, reason: '非视觉 structured-acceptance@2 必须使用单一 not_applicable 行' };
  }
  return {
    ok: true,
    protocolV2: true,
    visualRequired: auditRequired,
    audit,
    expected,
    inFlightTableUpgrade: !tableMarkedV2,
  };
}

function validateStructuredAcceptanceTable(vars, opts = {}) {
  if (!structuredAcceptanceRequired(vars, opts)) return { ok: true, reason: null, skipped: true };
  const acceptanceContract = vars && (vars.acceptance_contract || vars.acceptanceContract) || null;
  if (acceptanceContract) {
    try { AcceptanceContract.normalizeContract(acceptanceContract); } catch (error) {
      return { ok: false, reason: `acceptance-contract@1 无效: ${String(error && error.message || error)}` };
    }
  }
  const requiredRows = taskRequiredAcceptanceRows(vars);
  if (!requiredRows.length) return { ok: false, reason: '任务缺少结构化验收表要点' };
  const visualProtocol = validateVisualAcceptanceProtocol(vars, requiredRows);
  if (!visualProtocol.ok) return visualProtocol;
  const acceptancePrefix = String(vars && vars.acceptance || '').split(STRUCTURED_ACCEPTANCE_MARKER)[0];
  const taskText = collectText([
    vars && vars.goal,
    acceptancePrefix,
    vars && vars.bounds,
  ]).join('\n');
  const designRows = requiredRows.filter(row => !/^视觉\/UI证据/i.test(normalizePoint(row && row.point)));
  const designText = collectText([taskText, designRows]).join('\n');
  const requiresDecisionRow = explicitDecisionLines(designText).length > 0
    || implicitDecisionLookupRequested(designText);
  if (requiresDecisionRow && !requiredRows.some(row => /(?:memory\/|board\/)?decisions\.md:\d+/i.test(row.point))) {
    return { ok: false, reason: '对照设计门缺少 decisions.md:行号 要点' };
  }
  const implementationRows = implementationAcceptanceRows(vars);
  const implCheck = validateFilledAcceptanceRows(requiredRows, implementationRows, Object.assign({}, opts, {
    label: 'implementation.acceptance_table',
    acceptanceProtocolV2: visualProtocol.protocolV2,
    visualAcceptance: visualProtocol.audit,
    acceptanceContract,
  }));
  if (!implCheck.ok) return implCheck;
  const requireReview = opts.requireReview !== false;
  const reviewRows = reviewAcceptanceRows(vars);
  if (requireReview) {
    const reviewRowOpts = Object.assign({}, opts, {
      label: 'review.verification.acceptance_table',
      acceptanceProtocolV2: visualProtocol.protocolV2,
      visualAcceptance: visualProtocol.audit,
      acceptanceContract,
    });
    if (reviewFromVars(vars).pass === false) {
      reviewRowOpts.allowedStatuses = NEGATIVE_REVIEW_ACCEPTANCE_STATUSES;
    }
    const reviewCheck = validateFilledAcceptanceRows(requiredRows, reviewRows, reviewRowOpts);
    if (!reviewCheck.ok) return reviewCheck;
  }
  if (visualProtocol.visualRequired) {
    const missingEvidenceAudit = requireReview
      && negativeReviewDocumentsMissingVisualEvidence(vars, implementationRows, reviewRows, opts);
    if (!missingEvidenceAudit) {
      const visual = validateVisualAcceptanceEvidence(vars, implementationRows, reviewRows, opts);
      if (!visual.ok) return visual;
    }
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
    const numberedPrefix = /^(?:\d{1,3}\s*[.)]\s+|\d{1,3}\s*、\s*)/;
    const hasNumberedItems = numberedPrefix.test(line);
    // Keep ASCII dots out of the boundary token: AHR-26..30, IPv4 and decimals
    // can otherwise look like a following "30、" or "1、" list marker.
    const numbered = hasNumberedItems
      ? line.replace(/([。！？!?；;])\s*(?=(?:\d{1,3}\s*[.)]\s+|\d{1,3}\s*、\s*))/g, '$1\n')
        .split('\n').map(s => s.trim()).filter(Boolean)
      : [line];
    for (const part of numbered) {
      const cleaned = part.replace(numberedPrefix, '').trim();
      // Numbered rows already define their own boundaries. Splitting their prose
      // again on semicolons corrupts long acceptance items and configuration text.
      const pieces = hasNumberedItems
        ? [cleaned]
        : (cleaned.length > 90 ? cleaned.split(/[;；]/).map(s => s.trim()).filter(Boolean) : [cleaned]);
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

function implicitDecisionLookupRequested(text) {
  const normalized = String(text || '')
    .replace(VISUAL_DESIGN_REVIEW_PHRASE_RE, ' ')
    .replace(NEGATED_DECISION_DIRECTION_RE, ' ')
    .replace(NEGATED_DECISION_PLACEHOLDER_RE, ' ');
  // A directed positive instruction remains authoritative even when followed by
  // an anti-placeholder qualifier, e.g. "参考设计稿，但设计稿不能代替实现".
  if (DIRECTED_DECISION_LOOKUP_RE.test(normalized)) return true;
  return IMPLICIT_DECISION_LOOKUP_RE.test(
    normalized.replace(POST_NEGATED_DECISION_PLACEHOLDER_RE, ' '),
  );
}

// The classifier and the done gate intentionally share this single text signal
// source. Do not add a second visual keyword family elsewhere: historical tasks
// have already shown that parallel regexes drift and self-trigger on evidence text.
function visualRequirementSignals(text) {
  let explicit = false;
  let positive = false;
  // Completed-task summaries may embed the canonical structured-acceptance
  // header inside a later non-visual goal. Mask only that fixed metadata cell;
  // table-body UI work and explicit screenshot requirements remain visible.
  const intentText = String(text || '')
    .replace(STRUCTURED_ACCEPTANCE_HEADER_METADATA_RE, ' structured-acceptance evidence column ');
  for (const line of intentText.split(/\r?\n/)) {
    const explicitRequest = EXPLICIT_VISUAL_EVIDENCE_REQUEST_RE.test(line);
    // Provenance/audit lines may cite a UI agent or an HTML/CSS file without
    // making that historical reference part of the current delivery surface.
    // Real modification work and explicit visual-evidence requests still win.
    if (VISUAL_REFERENCE_ONLY_LINE_RE.test(line)
      && !VISUAL_WORK_ACTION_RE.test(line)
      && !explicitRequest) continue;
    // Board/acceptance meta-discussion often quotes the visual row and then
    // explicitly says this task has no UI surface. Let that strong line-level
    // absence override the quote, unless the same line also asks for real visual
    // modification work or explicitly demands visual evidence.
    if (EXPLICIT_NO_VISUAL_SURFACE_RE.test(line)
      && !VISUAL_WORK_ACTION_RE.test(line)
      && !explicitRequest) continue;
    let lineExplicit = false;
    const linePositive = line.split(/[,，;；。!！?？]+/).some(rawClause => {
      if (!VISUAL_UI_RE.test(rawClause)) return false;
      const concreteSurfaceWork = VISUAL_SURFACE_WORK_ACTION_RE.test(rawClause);
      if (VISUAL_POLICY_META_CLAUSE_RE.test(rawClause)
        && (!concreteSurfaceWork || VISUAL_POLICY_STRONG_META_CLAUSE_RE.test(rawClause))) return false;
      const clauseExplicit = EXPLICIT_VISUAL_EVIDENCE_REQUEST_RE.test(rawClause);
      const positiveRemainder = rawClause
        .replace(VISUAL_NA_EVIDENCE_RE, ' ')
        .replace(NEGATED_VISUAL_TERM_RE, ' ');
      const clausePositive = VISUAL_UI_RE.test(positiveRemainder);
      if (clauseExplicit && clausePositive) lineExplicit = true;
      return clausePositive;
    });
    if (lineExplicit || (explicitRequest && linePositive
      && !VISUAL_POLICY_META_CLAUSE_RE.test(line))) explicit = true;
    if (linePositive) positive = true;
  }
  return { explicit, positive };
}

// Only positive visual work should auto-enable the visual evidence gate. Task
// envelopes routinely carry negative policy text such as "无需截图" or
// "视觉/UI证据: NA"; those references describe the absence of a visual surface,
// not a requirement to fabricate screenshots.
function positiveVisualRequirement(text) {
  return visualRequirementSignals(text).positive;
}

function structuredAcceptanceProtocolV2(text) {
  return String(text || '').includes(STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER);
}

function visualAcceptancePoint(point) {
  return /^\s*视觉\/UI证据/i.test(normalizePoint(point));
}

function notApplicableVisualRow(row) {
  if (!row || !visualAcceptancePoint(row.point)) return false;
  return normalizePoint(row.status).toLowerCase() === ACCEPTANCE_NOT_APPLICABLE_STATUS
    || /(?:^|[:：]\s*)not_applicable\s*$/i.test(normalizePoint(row.point));
}

function visualAcceptanceHumanGateForced(input = {}) {
  const audit = input.visual_acceptance || input.visualAcceptance;
  return input.visualAcceptanceHumanGate === true
    || input.visual_acceptance_human_gate === true
    || input.forceVisualAcceptance === true
    || input.force_visual_acceptance === true
    || input.humanGateVisual === true
    || input.human_gate_visual === true
    || input.visualEvidenceRequired === true
    || input.visual_evidence_required === true
    || !!(audit && audit.human_gate_forced === true);
}

function visualAcceptanceSourceText(input = {}) {
  const acceptance = String(input.acceptance || '');
  const acceptancePrefix = acceptance.split(STRUCTURED_ACCEPTANCE_MARKER)[0];
  // Structured task labels are fed through the same visualRequirementSignals
  // source as prose. This keeps task-type routing and positiveVisualRequirement
  // on one vocabulary instead of growing a second UI keyword family.
  const taskTypeLabels = [
    input.taskType,
    input.task_type,
    input.changeType,
    input.change_type,
    input.category,
    input.changeScope && input.changeScope.type,
  ];
  return taskTypeLabels.concat([input.goal, input.message, input.task, acceptancePrefix])
    .filter(Boolean).join('\n');
}

function normalizeVisualPath(value) {
  return String(value || '')
    .trim()
    .replace(/^[`'"(<\[]+|[`'">)\],;；，。]+$/g, '')
    .replace(/:\d+(?::\d+)?$/, '')
    .replace(/\\/g, '/');
}

function declaredVisualChangePaths(input = {}, text = '') {
  const declared = collectText([
    input.changePaths,
    input.change_paths,
    input.changedFiles,
    input.changed_files,
    input.targetPaths,
    input.target_paths,
    input.affectedFiles,
    input.affected_files,
  ]);
  const extracted = extractPathPointers(text).filter(pointer => {
    const normalized = normalizeVisualPath(pointer);
    return !/[\u3400-\u9fff]/.test(normalized)
      && (VISUAL_FRONTEND_FILE_RE.test(normalized.split(/[?#]/)[0])
        || /^(?:\.{0,2}\/|\/|(?:src|web|public|app|client|assets|components?|styles?|styling|theme|ui|views?|pages?)\/)/i.test(normalized));
  });
  const paths = declared.concat(extracted);
  return Array.from(new Set(paths.map(normalizeVisualPath).filter(Boolean)));
}

function visualChangePathMatches(input = {}, text = '') {
  return declaredVisualChangePaths(input, text).filter(file => {
    const withoutQuery = file.split(/[?#]/)[0];
    return VISUAL_FRONTEND_FILE_RE.test(withoutQuery)
      || VISUAL_COMPONENT_STYLE_DIR_RE.test(withoutQuery);
  });
}

// Fixed priority: explicit user requirement > human gate > change path > task
// type/text. Every result is serializable and stable so it can be copied into the
// task envelope and handoff audit trail.
function classifyVisualAcceptance(input = {}) {
  const text = visualAcceptanceSourceText(input);
  const signals = visualRequirementSignals(text);
  const explicit = input.explicitVisualRequirement === true
    || input.explicit_visual_requirement === true
    || signals.explicit;
  const humanGate = visualAcceptanceHumanGateForced(input);
  const pathMatches = visualChangePathMatches(input, text);
  const taskTypePositive = signals.positive;
  let source = 'task_type';
  let required = false;
  if (explicit) {
    source = 'explicit_user_requirement';
    required = true;
  } else if (humanGate) {
    source = 'human_gate';
    required = true;
  } else if (pathMatches.length) {
    source = 'change_path';
    required = true;
  } else if (taskTypePositive) {
    source = 'task_type';
    required = true;
  }
  return {
    schema: VISUAL_ACCEPTANCE_SCHEMA,
    acceptance_protocol: STRUCTURED_ACCEPTANCE_PROTOCOL,
    state: required ? VISUAL_ACCEPTANCE_PENDING : VISUAL_ACCEPTANCE_NA,
    required,
    source,
    priority: source === 'explicit_user_requirement' ? 1
      : source === 'human_gate' ? 2
        : source === 'change_path' ? 3 : 4,
    explicit_visual_requirement: explicit,
    human_gate_forced: humanGate,
    path_matches: pathMatches,
    task_type_positive: taskTypePositive,
    reason: required
      ? `${source} requires Peekaboo+Codex visual evidence`
      : 'no positive visual requirement after explicit/human-gate/path/task-type evaluation',
  };
}

function visualAcceptanceRequired(value) {
  if (value && value.visual_acceptance && value.visual_acceptance.schema === VISUAL_ACCEPTANCE_SCHEMA) {
    return value.visual_acceptance.required === true;
  }
  if (value && value.visualAcceptance && value.visualAcceptance.schema === VISUAL_ACCEPTANCE_SCHEMA) {
    return value.visualAcceptance.required === true;
  }
  const rows = value && typeof value === 'object'
    ? implementationAcceptanceRows(value)
    : acceptanceRowsFromValue(value);
  return rows.some(row => visualAcceptancePoint(row.point) && !notApplicableVisualRow(row));
}

function visualAcceptanceMarkdownRow(classification) {
  if (classification && classification.required === true) {
    return `| ${markdownCell(VISUAL_ACCEPTANCE_POINT)} | 未完成 |  |  |`;
  }
  const source = classification && classification.source || 'task_type';
  const reason = classification && classification.reason || 'no positive visual requirement';
  return `| ${markdownCell(VISUAL_ACCEPTANCE_NA_POINT)} | ${ACCEPTANCE_NOT_APPLICABLE_STATUS} | task-envelope:visual_acceptance | source=${markdownCell(source)}; ${markdownCell(reason)} |`;
}

function ensureStructuredAcceptanceProtocolV2(acceptance) {
  const source = String(acceptance || '');
  if (structuredAcceptanceProtocolV2(source)) return source;
  const lines = source.split(/\r?\n/);
  const markerIndex = lines.findIndex(line => line.includes(STRUCTURED_ACCEPTANCE_MARKER));
  if (markerIndex >= 0) {
    lines.splice(markerIndex + 1, 0, STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER);
  } else {
    const templateIndex = lines.findIndex(line => /^\s*模板\s*[:：]/.test(line));
    lines.splice(templateIndex >= 0 ? templateIndex : 0, 0, STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER);
  }
  return lines.join('\n');
}

function refreshStructuredAcceptanceVisualState(acceptance, classification) {
  const source = String(acceptance || '');
  if (!structuredAcceptanceProtocolV2(source)) return source;
  const desired = visualAcceptanceMarkdownRow(classification);
  const lines = source.split(/\r?\n/);
  const out = [];
  let inTable = false;
  let inserted = false;
  for (const line of lines) {
    const cells = splitMarkdownRow(line);
    if (cells && cells.some(cell => cell === '要点') && cells.some(cell => /^完成状态/.test(cell))) {
      inTable = true;
      out.push(line);
      continue;
    }
    if (inTable && cells && visualAcceptancePoint(cells[0])) {
      if (!inserted) {
        out.push(desired);
        inserted = true;
      }
      continue;
    }
    if (inTable && !cells) {
      if (!inserted) {
        out.push(desired);
        inserted = true;
      }
      inTable = false;
    }
    out.push(line);
  }
  if (inTable && !inserted) out.push(desired);
  return out.join('\n');
}

function refreshVisualAcceptanceContext(ctx = {}, overrides = {}) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const previousAudit = ctx.visual_acceptance || ctx.visualAcceptance;
  const protocolV2Enabled = structuredAcceptanceProtocolV2(ctx.acceptance)
    || !!(previousAudit && previousAudit.schema === VISUAL_ACCEPTANCE_SCHEMA
      && previousAudit.acceptance_protocol === STRUCTURED_ACCEPTANCE_PROTOCOL);
  const input = Object.assign({}, ctx, overrides, {
    goal: Object.prototype.hasOwnProperty.call(overrides, 'goal') ? overrides.goal : ctx.goal,
    acceptance: ctx.acceptance,
  });
  const classification = classifyVisualAcceptance(input);
  ctx.visual_acceptance = classification;
  if (protocolV2Enabled) {
    ctx.acceptance = refreshStructuredAcceptanceVisualState(
      ensureStructuredAcceptanceProtocolV2(ctx.acceptance),
      classification,
    );
  }
  return ctx;
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
  if (!implicitDecisionLookupRequested(text)) return out.slice(0, opts.maxDecisionItems || 6);
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
  const suppliedClassification = input.visual_acceptance || input.visualAcceptance;
  const protocolV2Enabled = !!(suppliedClassification && suppliedClassification.schema === VISUAL_ACCEPTANCE_SCHEMA)
    || input.acceptanceProtocol === STRUCTURED_ACCEPTANCE_PROTOCOL
    || input.acceptance_protocol === STRUCTURED_ACCEPTANCE_PROTOCOL;
  const classification = suppliedClassification && suppliedClassification.schema === VISUAL_ACCEPTANCE_SCHEMA
    ? suppliedClassification
    : classifyVisualAcceptance(input);
  if (hasStructuredAcceptanceTable(acceptance)) {
    const versionedAcceptance = protocolV2Enabled
      ? ensureStructuredAcceptanceProtocolV2(acceptance)
      : acceptance;
    return structuredAcceptanceProtocolV2(versionedAcceptance)
      ? refreshStructuredAcceptanceVisualState(versionedAcceptance, classification)
      : versionedAcceptance;
  }
  const templateOpts = Object.assign({}, opts, input);
  const templateRef = structuredAcceptanceTemplateReference(templateOpts);
  const taskItems = splitAcceptanceItems(acceptance)
    .filter(item => !protocolV2Enabled || !visualAcceptancePoint(item))
    .map(item => `任务验收: ${item}`);
  if (!taskItems.length && goal) taskItems.push(`任务目标: ${goal.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0].slice(0, 180)}`);
  const designItems = extractDecisionItems(goal, acceptance, Object.assign({}, opts, input));
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
  if (!protocolV2Enabled && positiveVisualRequirement([goal, acceptance].join('\n'))) {
    if (!seen.has(pointKey(VISUAL_ACCEPTANCE_POINT))) rows.push(VISUAL_ACCEPTANCE_POINT);
  }
  if (!rows.length) rows.push('任务验收: 产出可验证证据并说明完成情况');
  const table = [
    `${STRUCTURED_ACCEPTANCE_MARKER}(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)`,
    protocolV2Enabled ? STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER : null,
    `模板: ${templateRef}`,
    `| ${STRUCTURED_ACCEPTANCE_COLUMNS.join(' | ')} |`,
    '|---|---|---|---|',
    ...rows.map(point => `| ${markdownCell(point)} | 未完成 |  |  |`),
    protocolV2Enabled ? visualAcceptanceMarkdownRow(classification) : null,
  ].filter(line => line != null).join('\n');
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
  return HARD_REGRESSION_RULES.filter(rule => rule.mode === 'active').filter(rule => {
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
  for (const file of changed) {
    if (!pathExists(file, workspaceRoot)) missing.push(file);
  }
  if (missing.length) {
    return { ok: false, reason: `changed_files 声明文件不存在: ${missing.slice(0, 5).join(', ')}`, changed, missing, blocked: [] };
  }
  if (opts.gitVerify === true) {
    // P0-A:不只查文件存在,还要 git 真有改动;明确无改动(false)才打回,无法判定(null)放行
    const unchanged = [];
    for (const file of changed) {
      if (gitFileHasChange(file, workspaceRoot) === false) unchanged.push(file);
    }
    if (unchanged.length) {
      return { ok: false, reason: `changed_files 声明已改但 git 显示无改动: ${unchanged.slice(0, 5).join(', ')}`, changed, missing, blocked: [], unchanged };
    }
  }
  return { ok: true, reason: null, changed, missing, blocked: [] };
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

function normalizedReviewVerdict(verification) {
  return String((verification && (verification.verdict || verification.result || verification.judgement)) || '')
    .trim()
    .toLowerCase();
}

function reviewVerdictIsPositive(review, verification) {
  if (review.verified === true || review.hard_verified === true) return true;
  const verdict = normalizedReviewVerdict(verification);
  return ['true', 'pass', 'passed', 'ok', 'real', 'verified', '真', '通过'].includes(verdict);
}

function reviewVerdictIsNegative(verification) {
  return NEGATIVE_REVIEW_VERDICTS.has(normalizedReviewVerdict(verification));
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

function explicitReviewLifecycle(review) {
  if (!review || typeof review !== 'object') return { explicit: false, status: 'submitted' };
  for (const key of ['lifecycle_status', 'lifecycleStatus', 'review_lifecycle', 'reviewLifecycle', 'lifecycle']) {
    if (!Object.prototype.hasOwnProperty.call(review, key)) continue;
    const raw = String(review[key] == null ? '' : review[key]).trim();
    return { explicit: true, status: raw || 'UNSET' };
  }
  // Legacy reviews predate the lifecycle field. A concrete boolean verdict is their
  // durable submitted signal; only an explicitly supplied UNSET/draft value is held.
  return { explicit: false, status: typeof review.pass === 'boolean' ? 'submitted' : 'UNSET' };
}

function normalizedLifecycleStatus(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function reviewLifecycleRoutingState(review) {
  const lifecycle = explicitReviewLifecycle(review);
  const normalized = normalizedLifecycleStatus(lifecycle.status);
  if (['submitted', 'approved', '已提交', '已批准'].includes(normalized)) {
    return Object.assign({}, lifecycle, { routable: true, normalized });
  }
  return Object.assign({}, lifecycle, { routable: false, normalized: normalized || 'unset' });
}

function exactReviewAcceptanceRows(requiredRows, filledRows) {
  const filled = Array.isArray(filledRows) ? filledRows : [];
  const missing = [];
  const expectedKeys = new Set();
  for (const required of requiredRows || []) {
    const acceptanceId = normalizePoint(required && (required.acceptance_id || required.acceptanceId));
    if (acceptanceId) {
      expectedKeys.add(`id:${acceptanceId}`);
      const match = filled.find(row => normalizePoint(row && (row.acceptance_id || row.acceptanceId)) === acceptanceId);
      if (!match
        || normalizePoint(match.source_hash || match.sourceHash) !== normalizePoint(required.source_hash || required.sourceHash)
        || normalizePoint(match.scope) !== normalizePoint(required.scope)
        || normalizePoint(match.text || match.machine_text || match.machineText) !== normalizePoint(required.text)) {
        missing.push(`${acceptanceId}:${normalizePoint(required && required.point) || '<empty>'}`);
      }
      continue;
    }
    const point = normalizePoint(required && required.point);
    expectedKeys.add(`point:${point}`);
    if (!point || !filled.some(row => normalizePoint(row && row.point) === point)) missing.push(point || '<empty>');
  }
  const unexpected = [];
  for (const row of filled) {
    const acceptanceId = normalizePoint(row && (row.acceptance_id || row.acceptanceId));
    const point = normalizePoint(row && row.point);
    const key = acceptanceId ? `id:${acceptanceId}` : `point:${point}`;
    if (!expectedKeys.has(key)) unexpected.push(acceptanceId || point || '<empty>');
  }
  const expectedCount = Array.isArray(requiredRows) ? requiredRows.length : 0;
  return {
    ok: missing.length === 0 && unexpected.length === 0 && filled.length === expectedCount,
    missing,
    unexpected,
    expected_count: expectedCount,
    actual_count: filled.length,
  };
}

function reviewIssueContract(review) {
  const hasExplicitIssues = Object.prototype.hasOwnProperty.call(review || {}, 'issues');
  let source;
  if (hasExplicitIssues) {
    source = review.issues;
  } else if (review && review.critique != null) {
    source = review.critique;
  } else {
    const evaluation = review && review.evaluation && typeof review.evaluation === 'object'
      ? review.evaluation : {};
    source = [evaluation.gaps, evaluation.improvement_points]
      .flatMap(value => Array.isArray(value) ? value : (value == null ? [] : [value]));
  }
  const values = Array.isArray(source) ? source : (source == null ? [] : [source]);
  const issues = values.map(value => {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return String(value.issue || value.message || value.summary || value.description || '').trim();
  });
  if (!issues.length) {
    return {
      ok: false,
      reason: 'review.pass=false 缺少非空 issues/critique/evaluation.gaps/improvement_points',
      issues: [],
    };
  }
  if (issues.some(issue => !issue)) {
    return { ok: false, reason: 'review.pass=false 的每个 issue 必须是非空内容', issues };
  }
  return { ok: true, reason: null, issues };
}

function reviewIssueEvidenceRequired(vars) {
  const contract = vars && (vars.acceptance_contract || vars.acceptanceContract);
  return !!(contract && contract.schema === 'acceptance-contract@1');
}

function projectScopedEvidencePointer(pointer, projectId, opts = {}) {
  if (!pointer || !pointer.lineNo || !pointerExists(pointer, opts.workspaceRoot)) return false;
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const resolved = workspacePath(pointer.path, workspaceRoot);
  if (!resolved) return false;
  const rel = path.relative(workspaceRoot, resolved).split(path.sep).join('/');
  const expected = `projects/${projectId}/`;
  return rel.startsWith(expected);
}

function exactEvidencePointerLine(pointer, opts = {}) {
  if (!pointer || !pointer.lineNo || !pointerExists(pointer, opts.workspaceRoot)) return '';
  const resolved = workspacePath(pointer.path, opts.workspaceRoot || process.cwd());
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 1024 * 1024) return '';
    return fs.readFileSync(resolved, 'utf8').split(/\r?\n/)[pointer.lineNo - 1] || '';
  } catch (_) {
    return '';
  }
}

function reviewBindingLineSupportsRequiredRow(line, expected = {}) {
  const normalizedLine = normalizePoint(line);
  if (!normalizedLine) return false;

  let parsed;
  let parsedAsJson = false;
  try {
    parsed = JSON.parse(normalizedLine);
    parsedAsJson = true;
  } catch (_) {
    // A JSON-looking binding must not fall back to substring matching when its
    // JSON is malformed. Legacy compatibility is reserved for the historical
    // non-JSON text receipt format.
    if (/^[\[{]/.test(normalizedLine)) return false;
  }

  if (parsedAsJson) {
    if (!isPlainObject(parsed) || parsed.schema !== SUPERVISOR_REVIEW_BINDING_SCHEMA) return false;
    const requiredStringFields = ['issue', 'acceptance_id', 'source_hash', 'required_row_point', '核对结果'];
    if (requiredStringFields.some(field => typeof parsed[field] !== 'string')) return false;
    const expectedSourceHash = normalizePoint(expected.sourceHash).toLowerCase();
    return normalizePoint(parsed.issue) === normalizePoint(expected.issue)
      && normalizePoint(parsed.acceptance_id) === normalizePoint(expected.acceptanceId)
      && !!expectedSourceHash
      && normalizePoint(parsed.source_hash).toLowerCase() === expectedSourceHash
      && normalizePoint(parsed.required_row_point) === normalizePoint(expected.requiredPoint)
      && normalizePoint(parsed['核对结果']) === normalizePoint(expected.status);
  }

  const expectedIssue = normalizePoint(expected.issue);
  const acceptanceId = normalizePoint(expected.acceptanceId);
  const requiredPoint = normalizePoint(expected.requiredPoint);
  const status = normalizePoint(expected.status);
  return normalizedLine.includes(expectedIssue)
    && normalizedLine.includes(acceptanceId)
    && normalizedLine.includes(requiredPoint)
    && !!status
    && normalizedLine.includes(normalizePoint(`核对结果=${status}`));
}

function realWorkspaceFile(pointer, opts = {}) {
  if (!pointer || !pointerExists(pointer, opts.workspaceRoot)) return null;
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const resolved = workspacePath(pointer.path, workspaceRoot);
  if (!resolved) return null;
  try {
    const realRoot = fs.realpathSync(workspaceRoot);
    const realFile = fs.realpathSync(resolved);
    const relative = path.relative(realRoot, realFile);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      return realFile;
    }
  } catch (_) {}
  return null;
}

function implementationDeclaredEvidenceFiles(vars, opts = {}) {
  const implementation = implementationFromVars(vars);
  const logic = logicChainFromVars(vars) || {};
  const receipt = implementation.receipt && typeof implementation.receipt === 'object'
    ? implementation.receipt : {};
  const rows = implementationAcceptanceRows(vars);
  const values = [
    implementation.changed_files,
    implementation.changedFiles,
    implementation.evidence,
    implementation.tests,
    implementation.commands,
    receipt.changedFiles,
    receipt.artifacts,
    receipt.tests,
    rows.map(row => row && row.evidence),
    logic.evidence,
    logic.tests,
    logic.commands,
    logic.proof,
    logic.basis,
  ];
  const files = new Set();
  for (const value of values) {
    for (const text of collectText(value)) {
      for (const pointer of extractPathPointerDetails(text)) {
        const realFile = realWorkspaceFile(pointer, opts);
        if (realFile) files.add(realFile);
      }
    }
  }
  return files;
}

function implementationFailureReceipts(vars) {
  const implementation = implementationFromVars(vars);
  const values = implementation && (implementation.failure_receipts || implementation.failureReceipts);
  if (!Array.isArray(values)) return [];
  return values.filter(value => value && typeof value === 'object' && !Array.isArray(value)).map(value => ({
    schema: normalizePoint(value.schema),
    acceptance_id: normalizePoint(value.acceptance_id || value.acceptanceId),
    source_hash: normalizePoint(value.source_hash || value.sourceHash).toLowerCase(),
    expected: typeof value.expected === 'string' ? normalizePoint(value.expected) : '',
    observed: typeof value.observed === 'string' ? normalizePoint(value.observed) : '',
    verdict: typeof value.verdict === 'string' ? normalizePoint(value.verdict).toLowerCase() : '',
    evidence: normalizePoint(value.evidence || value.pointer),
  }));
}

function validateReviewIssueEvidenceContract(vars, opts = {}) {
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars) || {};
  const issueContract = reviewIssueContract(review);
  if (!issueContract.ok) return issueContract;

  const mappings = verification.issue_evidence;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return {
      ok: false,
      reason: 'acceptance-contract@1 负向审查缺少 verification.issue_evidence[] 结构化映射',
      issues: issueContract.issues,
      bindings: [],
    };
  }

  const requiredRows = taskRequiredAcceptanceRows(vars);
  const filledRows = reviewAcceptanceRows(vars);
  const requiredById = new Map(requiredRows.map(required => [
    normalizePoint(required && (required.acceptance_id || required.acceptanceId)),
    required,
  ]).filter(([acceptanceId]) => acceptanceId));
  const projectId = String(vars && (vars.projectId || vars.project_id) || '').trim();
  const declaredEvidencePointers = extractPathPointerDetails(collectText([
    verification.evidence,
    verification.proof,
    verification.files,
    filledRows.map(row => row && row.evidence),
  ]).join('\n'));
  const implementationEvidenceFiles = implementationDeclaredEvidenceFiles(vars, opts);
  const frozenFailureReceipts = implementationFailureReceipts(vars);
  const bindings = [];

  for (let mappingIndex = 0; mappingIndex < mappings.length; mappingIndex += 1) {
    const mapping = mappings[mappingIndex];
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}] 必须是对象`, issues: issueContract.issues, bindings };
    }
    const issueIndex = mapping.issue_index;
    if (!Number.isInteger(issueIndex) || issueIndex < 0 || issueIndex >= issueContract.issues.length) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}].issue_index 越界或非整数`, issues: issueContract.issues, bindings };
    }
    const issue = normalizePoint(mapping.issue);
    const expectedIssue = normalizePoint(issueContract.issues[issueIndex]);
    if (!issue || issue !== expectedIssue) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}].issue 与 issues[${issueIndex}] 原文不一致`, issues: issueContract.issues, bindings };
    }
    const acceptanceId = normalizePoint(mapping.acceptance_id || mapping.acceptanceId);
    const required = requiredById.get(acceptanceId);
    if (!acceptanceId || !required) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}] 缺少合同内有效 acceptance_id`, issues: issueContract.issues, bindings };
    }
    if (visualAcceptancePoint(required.point)) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}] 不得绑定视觉 not_applicable 验收行`, issues: issueContract.issues, bindings };
    }
    const filledRow = findAcceptanceRow(required, filledRows);
    const status = normalizePoint(filledRow && filledRow.status);
    const pointerText = normalizePoint(mapping.evidence);
    const pointers = extractPathPointerDetails(pointerText).filter(pointer => pointer.lineNo);
    if (!pointerText || pointers.length !== 1) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}].evidence 必须是单一可解析 path:line`, issues: issueContract.issues, bindings };
    }
    const pointer = pointers[0];
    if (!projectId || !projectScopedEvidencePointer(pointer, projectId, opts)) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}].evidence 不是项目范围内有效 path:line`, issues: issueContract.issues, bindings };
    }
    const resolvedPointer = workspacePath(pointer.path, opts.workspaceRoot || process.cwd());
    const declared = declaredEvidencePointers.some(candidate => {
      const resolvedCandidate = workspacePath(candidate.path, opts.workspaceRoot || process.cwd());
      return resolvedCandidate && resolvedCandidate === resolvedPointer;
    });
    if (!declared) {
      return { ok: false, reason: `verification.issue_evidence[${mappingIndex}].evidence 未在 review evidence/验收行中申明`, issues: issueContract.issues, bindings };
    }
    const line = normalizePoint(exactEvidencePointerLine(pointer, opts));
    const requiredPoint = normalizePoint(required.point);
    const bindingSourceHash = normalizePoint(required.source_hash || required.sourceHash).toLowerCase();
    if (!reviewBindingLineSupportsRequiredRow(line, {
      issue: expectedIssue,
      acceptanceId,
      sourceHash: bindingSourceHash,
      requiredPoint,
      status,
    })) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}] 指向行未同时支持 issue、acceptance_id、requiredRows 原文和行状态`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const sourcePointerText = normalizePoint(mapping.source_evidence || mapping.sourceEvidence);
    const sourcePointers = extractPathPointerDetails(sourcePointerText).filter(candidate => candidate.lineNo);
    if (!sourcePointerText || sourcePointers.length !== 1) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 必须是单一可解析 path:line`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const sourcePointer = sourcePointers[0];
    const realSourceFile = realWorkspaceFile(sourcePointer, opts);
    const realBindingFile = realWorkspaceFile(pointer, opts);
    if (!realSourceFile || !implementationEvidenceFiles.has(realSourceFile)) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 未引用 review 前 implementation 已声明的工作区证据`,
        issues: issueContract.issues,
        bindings,
      };
    }
    if (realBindingFile && realSourceFile === realBindingFile) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 不得与审查方绑定回执使用同一文件`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const sourceLine = normalizePoint(exactEvidencePointerLine(sourcePointer, opts));
    const sourceExcerpt = normalizePoint(mapping.source_excerpt || mapping.sourceExcerpt);
    if (!sourceLine || !sourceExcerpt || sourceLine !== sourceExcerpt) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_excerpt 与 source_evidence 指向原文不一致`,
        issues: issueContract.issues,
        bindings,
      };
    }
    let sourceReceipt;
    try {
      sourceReceipt = JSON.parse(sourceLine);
    } catch (_) {
      sourceReceipt = null;
    }
    if (!sourceReceipt || typeof sourceReceipt !== 'object' || Array.isArray(sourceReceipt)
      || sourceReceipt.schema !== IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 必须指向 ${IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA} JSON 行`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const receiptAcceptanceId = normalizePoint(sourceReceipt.acceptance_id || sourceReceipt.acceptanceId);
    const receiptSourceHash = normalizePoint(sourceReceipt.source_hash || sourceReceipt.sourceHash).toLowerCase();
    const receiptExpected = typeof sourceReceipt.expected === 'string'
      ? normalizePoint(sourceReceipt.expected) : '';
    const receiptObserved = typeof sourceReceipt.observed === 'string'
      ? normalizePoint(sourceReceipt.observed) : '';
    const receiptVerdict = typeof sourceReceipt.verdict === 'string'
      ? normalizePoint(sourceReceipt.verdict).toLowerCase() : '';
    const canonicalSourcePointer = `${sourcePointer.path}:${sourcePointer.lineNo}`;
    const frozenReceipt = frozenFailureReceipts.find(candidate => candidate.evidence === canonicalSourcePointer
      && candidate.schema === sourceReceipt.schema
      && candidate.acceptance_id === receiptAcceptanceId
      && candidate.source_hash === receiptSourceHash
      && candidate.expected === receiptExpected
      && candidate.observed === receiptObserved
      && candidate.verdict === receiptVerdict);
    if (!frozenReceipt) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 未与 implementation.failure_receipts[] 的 implement-time 冻结回执逐字段一致`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const requiredSourceHash = normalizePoint(required.source_hash || required.sourceHash).toLowerCase();
    const requiredText = normalizePoint(required.text);
    if (receiptAcceptanceId !== acceptanceId || !requiredSourceHash
      || receiptSourceHash !== requiredSourceHash) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 回执未绑定 requiredRows acceptance_id/source_hash`,
        issues: issueContract.issues,
        bindings,
      };
    }
    if (!requiredText || receiptExpected !== requiredText) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 回执 expected 与 requiredRows text 原文不一致`,
        issues: issueContract.issues,
        bindings,
      };
    }
    const observedSignalLength = receiptObserved.replace(/[^\p{L}\p{N}]+/gu, '').length;
    if (!receiptObserved || observedSignalLength < 8 || receiptObserved === receiptExpected) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 回执 observed 必须是与 expected 不同的具体负向结果`,
        issues: issueContract.issues,
        bindings,
      };
    }
    if (!NEGATIVE_REVIEW_VERDICTS.has(receiptVerdict)) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 回执 verdict 必须是负向枚举`,
        issues: issueContract.issues,
        bindings,
      };
    }
    if (!expectedIssue.includes(receiptObserved)) {
      return {
        ok: false,
        reason: `verification.issue_evidence[${mappingIndex}].source_evidence 回执 observed 未逐字绑定对应 issue`,
        issues: issueContract.issues,
        bindings,
      };
    }
    bindings.push({
      issue_index: issueIndex,
      issue: expectedIssue,
      acceptance_id: acceptanceId,
      evidence: `${pointer.path}:${pointer.lineNo}`,
      source_evidence: `${sourcePointer.path}:${sourcePointer.lineNo}`,
      source_excerpt: sourceLine,
      source_receipt: {
        schema: IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA,
        acceptance_id: receiptAcceptanceId,
        source_hash: receiptSourceHash,
        expected: receiptExpected,
        observed: receiptObserved,
        verdict: receiptVerdict,
      },
      status,
      incomplete: status === '部分' || status === '未完成',
    });
  }

  const missingIssueIndexes = issueContract.issues
    .map((_, index) => index)
    .filter(index => !bindings.some(binding => binding.issue_index === index));
  if (missingIssueIndexes.length > 0) {
    return {
      ok: false,
      reason: `verification.issue_evidence 未覆盖每个 issue: missing_indexes=${missingIssueIndexes.join(',')}`,
      issues: issueContract.issues,
      bindings,
    };
  }
  return {
    ok: true,
    reason: null,
    issues: issueContract.issues,
    bindings,
    has_incomplete_binding: bindings.some(binding => binding.incomplete),
  };
}

function negativeReviewAcceptanceSemantics(requiredRows, filledRows) {
  const rows = (requiredRows || [])
    .filter(required => !visualAcceptancePoint(required && required.point))
    .map(required => ({
      point: normalizePoint(required && required.point),
      status: normalizePoint((findAcceptanceRow(required, filledRows) || {}).status),
    }));
  const incompleteRows = rows.filter(row => row.status === '部分' || row.status === '未完成');
  return {
    ok: incompleteRows.length > 0,
    row_statuses: rows.map(row => row.status),
    incomplete_rows: incompleteRows.map(row => row.point),
  };
}

function projectEvidencePointers(vars, opts = {}) {
  const projectId = String(vars && (vars.projectId || vars.project_id) || '').trim();
  if (!projectId) return [];
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const expected = `projects/${projectId}/`;
  const verification = reviewVerificationFromVars(vars) || {};
  const rows = reviewAcceptanceRows(vars);
  const values = [
    verification.evidence,
    verification.proof,
    verification.files,
    rows.map(row => row && row.evidence),
  ];
  const out = [];
  for (const text of collectText(values)) {
    for (const pointer of extractPathPointerDetails(text)) {
      if (!pointerExists(pointer, workspaceRoot)) continue;
      const resolved = workspacePath(pointer.path, workspaceRoot);
      if (!resolved) continue;
      const rel = path.relative(workspaceRoot, resolved).split(path.sep).join('/');
      if (rel === expected.slice(0, -1) || rel.startsWith(expected)) {
        if (!out.some(item => item.path === pointer.path && item.lineNo === pointer.lineNo)) out.push(pointer);
      }
    }
  }
  return out;
}

function explicitEvidenceVerdictDirections(verification) {
  const directions = new Set();
  const positive = new Set(['true', 'pass', 'passed', 'ok', 'verified', '通过']);
  const negative = NEGATIVE_REVIEW_VERDICTS;
  const add = value => {
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (positive.has(normalized)) directions.add('positive');
    if (negative.has(normalized)) directions.add('negative');
  };
  const naturalSummaryDirections = value => {
    // Evidence summaries often use prose instead of a labelled verdict. Keep this
    // deliberately scoped to review/acceptance subjects, and ignore quoted route
    // examples so "verified the `not passed -> rework` path" is not a verdict.
    const prose = String(value == null ? '' : value)
      .replace(/`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|「[^」]*」|『[^』]*』/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!prose) return;
    const reviewSubjectRe = /(?:所有|全部|各项|逐项|整体)?\s*(?:验收|复审|审核|审查)(?:项|要点|要求|结果|结论|状态)?/i;
    const negativeConclusionRe = /(?:未(?:能|予以)?\s*(?:全部|完全|均|都)?\s*(?:通过|完成|满足)|不(?:予)?\s*(?:全部|完全|均|都)?\s*(?:通过|完成|满足)|没有\s*(?:全部|完全|均|都)?\s*(?:通过|完成|满足)|(?:并非|不是)\s*(?:全部|完全|均|都)?\s*(?:通过|完成|满足)|失败|打回|返工|不可放行|不能放行)/i;
    const positiveConclusionRe = /(?:全部|均|都)?\s*(?:已经|已)?\s*(?:通过|完成|满足|无阻断|不存在(?:任何)?\s*阻断|可以放行|可放行)/i;
    for (const clause of prose.split(/[\n。！？!?；;，,]+/).map(item => item.trim()).filter(Boolean)) {
      const subject = reviewSubjectRe.exec(clause);
      if (!subject) continue;
      const conclusion = clause.slice(subject.index + subject[0].length);
      const noBlocker = /(?:无|没有|不存在)(?:任何)?\s*阻断/i.test(conclusion);
      const negative = negativeConclusionRe.test(conclusion) || (!noBlocker && /阻断/i.test(conclusion));
      if (negative) {
        directions.add('negative');
        continue;
      }
      if (positiveConclusionRe.test(conclusion)) directions.add('positive');
    }
  };
  const evidence = evidenceEntries(verification && (
    verification.evidence || verification.proof || verification.commands || verification.tests || verification.files
  ));
  for (const entry of evidence) {
    if (entry && typeof entry === 'object') {
      for (const key of ['verdict', 'direction', 'outcome', 'acceptance_result', 'review_verdict']) {
        if (Object.prototype.hasOwnProperty.call(entry, key)) add(entry[key]);
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'pass')) add(entry.pass === true ? 'pass' : 'fail');
    }
    const text = entryText(entry);
    const re = /(?:review[_\s-]?verdict|acceptance[_\s-]?result|验收(?:结论|结果)|复审(?:结论|结果))\s*[:=：]\s*(true|false|pass(?:ed)?|fail(?:ed)?|partial|blocked|reject(?:ed)?|通过|未通过|不通过|部分|打回)/gi;
    let match;
    while ((match = re.exec(text))) add(match[1]);
    if (typeof entry === 'string') {
      naturalSummaryDirections(entry);
    } else if (entry && typeof entry === 'object') {
      for (const key of ['summary', 'evidence_summary', 'evidenceSummary', 'result_summary', 'resultSummary', 'conclusion']) {
        if (Object.prototype.hasOwnProperty.call(entry, key)) naturalSummaryDirections(entry[key]);
      }
    }
  }
  return directions;
}

function reviewStructureContract(vars, opts = {}) {
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars);
  if (!verification) {
    return { ok: false, route: 'hard_block', reason: '主管复审缺少 hard verification 结构' };
  }
  if (typeof review.pass !== 'boolean') {
    return { ok: false, route: 'hard_block', reason: 'review.pass 必须是布尔值' };
  }
  const severity = String(review.severity == null ? '' : review.severity).trim().toLowerCase();
  if (!severity) {
    return { ok: false, route: 'hard_block', reason: '主管复审缺少 severity 字段' };
  }
  if (!REVIEW_SEVERITIES.has(severity)) {
    return { ok: false, route: 'hard_block', reason: `review.severity 不在有效枚举 low/medium/high: ${severity}` };
  }
  if (review.pass === false) {
    const issueContract = reviewIssueContract(review);
    if (!issueContract.ok) return { ok: false, route: 'hard_block', reason: issueContract.reason };
  }
  if (!Object.prototype.hasOwnProperty.call(verification, 'verdict')) {
    return { ok: false, route: 'hard_block', reason: '主管复审缺少 verification.verdict 字段' };
  }
  const verdict = String(verification.verdict == null ? '' : verification.verdict).trim().toLowerCase();
  const recognized = !verdict || reviewVerdictIsPositive({}, { verdict }) || reviewVerdictIsNegative({ verdict });
  if (!recognized) {
    return { ok: false, route: 'hard_block', reason: `verification.verdict 语义不可识别: ${verdict}` };
  }

  const requiredRows = taskRequiredAcceptanceRows(vars);
  if (structuredAcceptanceRequired(vars, opts)) {
    if (!requiredRows.length) {
      return { ok: false, route: 'hard_block', reason: '任务缺少结构化验收表要点' };
    }
    const exactRows = exactReviewAcceptanceRows(requiredRows, reviewAcceptanceRows(vars));
    if (!exactRows.ok) {
      return {
        ok: false,
        route: 'hard_block',
        reason: `review.verification.acceptance_table 与 requiredRows 数量/原文不一致: expected=${exactRows.expected_count}, actual=${exactRows.actual_count}; missing=${exactRows.missing.join(' | ') || 'none'}; unexpected=${exactRows.unexpected.join(' | ') || 'none'}`,
        missing_required_rows: exactRows.missing,
        unexpected_review_rows: exactRows.unexpected,
      };
    }
    const projectId = String(vars && (vars.projectId || vars.project_id) || '').trim();
    if (projectId && projectEvidencePointers(vars, opts).length === 0) {
      return {
        ok: false,
        route: 'hard_block',
        reason: `主管复审缺少存在的项目证据路径: projects/${projectId}/`,
      };
    }
  }
  return { ok: true, route: null, reason: null, verification, requiredRows };
}

function validateReviewRoutingContract(vars, opts = {}) {
  const review = reviewFromVars(vars);
  const structure = reviewStructureContract(vars, opts);
  if (!structure.ok) return Object.assign({ warnings: [] }, structure);

  const verification = structure.verification;
  // Contract precedence is deliberate: required evidence gaps are hard blocks;
  // an explicitly non-routable lifecycle is held; only a submitted review may
  // reach semantic direction checks and be escalated for manual judgment.
  const hard = validateReviewHardEvidence(vars, Object.assign({}, opts, {
    skipReviewVerdictDirection: true,
  }));
  const alignment = review.pass === false && !hard.ok
    ? reviewAlignmentFailureDisposition(vars, hard, opts)
    : { warning: false, category: null, misalignedRows: [] };
  const alignmentWarning = alignment.warning === true;
  if (!hard.ok && !alignmentWarning) {
    return {
      ok: false,
      route: 'hard_block',
      reason: hard.reason,
      warnings: [],
      verification,
    };
  }
  const warnings = alignmentWarning ? [{
    type: 'done_gate.review_alignment_warning',
    reason: hard.reason,
    category: alignment.category,
    misaligned_required_rows: alignment.misalignedRows,
  }] : [];

  let issueEvidenceContract = hard.issue_evidence_contract || null;
  if (review.pass === false && reviewIssueEvidenceRequired(vars) && !issueEvidenceContract) {
    issueEvidenceContract = validateReviewIssueEvidenceContract(vars, opts);
  }
  if (issueEvidenceContract && !issueEvidenceContract.ok) {
    return {
      ok: false,
      route: 'hard_block',
      reason: issueEvidenceContract.reason,
      warnings: [],
      verification,
      issue_evidence_contract: issueEvidenceContract,
    };
  }

  const lifecycle = reviewLifecycleRoutingState(review);
  if (!lifecycle.routable) {
    return {
      ok: true,
      route: 'hold',
      reason: `review lifecycle ${lifecycle.status || 'UNSET'} 不参与自动路由`,
      warnings,
      lifecycle,
      verification,
    };
  }

  const verdictPositive = reviewVerdictIsPositive({}, verification);
  const verdictNegative = reviewVerdictIsNegative(verification);
  if ((review.pass === true && !verdictPositive) || (review.pass === false && !verdictNegative)) {
    return {
      ok: true,
      route: 'manual_review',
      reason: 'review.pass 与 verification.verdict 方向矛盾',
      warnings,
      lifecycle,
      verification,
    };
  }

  if (review.pass === false && structure.requiredRows.length > 0) {
    const acceptanceSemantics = negativeReviewAcceptanceSemantics(
      structure.requiredRows,
      reviewAcceptanceRows(vars),
    );
    if (!acceptanceSemantics.ok) {
      return {
        ok: true,
        route: 'manual_review',
        reason: 'review.pass=false 但非视觉验收行均为完成，方向矛盾',
        warnings,
        lifecycle,
        verification,
        acceptance_semantics: acceptanceSemantics,
      };
    }
    if (issueEvidenceContract && !issueEvidenceContract.has_incomplete_binding) {
      return {
        ok: false,
        route: 'hard_block',
        reason: 'verification.issue_evidence 未将任一 issue 绑定到“部分/未完成”非视觉验收行',
        warnings: [],
        lifecycle,
        verification,
        acceptance_semantics: acceptanceSemantics,
        issue_evidence_contract: issueEvidenceContract,
      };
    }
  }

  const evidenceDirections = explicitEvidenceVerdictDirections(verification);
  const directionConflict = evidenceDirections.size > 1
    || (review.pass === true && evidenceDirections.has('negative'))
    || (review.pass === false && evidenceDirections.has('positive'));
  if (directionConflict) {
    return {
      ok: true,
      route: 'manual_review',
      reason: '证据摘要与 review verdict 方向矛盾',
      warnings,
      lifecycle,
      verification,
    };
  }
  return {
    ok: true,
    route: review.pass === true ? 'approve' : 'rework',
    reason: null,
    warnings,
    lifecycle,
    verification,
  };
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
  if (!opts.skipReviewVerdictDirection && review.pass === true && !reviewVerdictIsPositive(review, verification)) {
    return { ok: false, reason: 'review.pass=true 但 verification verdict 未确认真完成', verification };
  }
  if (!opts.skipReviewVerdictDirection && review.pass === false && !reviewVerdictIsNegative(verification)) {
    return { ok: false, reason: 'review.pass=false 但 verification verdict 未确认负向/部分结论', verification };
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
  let issueEvidenceContract = null;
  if (review.pass === false && reviewIssueEvidenceRequired(vars)) {
    issueEvidenceContract = validateReviewIssueEvidenceContract(vars, opts);
    if (!issueEvidenceContract.ok) {
      return {
        ok: false,
        reason: issueEvidenceContract.reason,
        verification,
        issue_evidence_contract: issueEvidenceContract,
      };
    }
  }
  return {
    ok: true,
    reason: null,
    verification,
    issue_evidence_contract: issueEvidenceContract,
  };
}

// ===== P0-A:让验收真执行(executeEvidence)+ 真比对改动(gitVerify)=====
// 根因(玉兔6-根因诊断 §2 第二层):done gate 历来零进程执行,只校验 agent 自报的
// exit_code/PASS 文本 → 假完成被盖章。下面在 opts.executeEvidence===true 时实际 spawn
// 白名单命令、用真实退出码覆盖自报;真实非0 直接判 false。默认关闭、向后兼容。
// 生产开关:仅当环境变量为 '1' 时启用真执行(server 给 worker 注入 '1';测试不注入 → 默认关、行为不变)
const EXECUTE_EVIDENCE_ENV = 'YUTU6_DONE_GATE_EXECUTE';
function executeEvidenceEnabledFromEnv() {
  return process.env[EXECUTE_EVIDENCE_ENV] === '1';
}

function isWhitelistedEvidenceCommand(cmd) {
  return RegressionCommandPolicy.autoExecutionDecision(cmd).allowed;
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
    const commandPolicy = RegressionCommandPolicy.autoExecutionDecision(cmd);
    if (!commandPolicy.allowed) {
      executed.push({ cmd, ran: false, reason: commandPolicy.reason });
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

const DIRECT_COMPLETION_OVERRIDE_SCHEMA = 'yutu6-direct-completion-override@1';
const DIRECT_INCOMPLETE_STATUS_RE = /^(?:部分|未完成|partial|incomplete|blocked|failed)$/i;

function directResultFromVars(vars) {
  return isPlainObject(vars && vars.result) ? vars.result : {};
}

function directAcceptanceRows(vars) {
  const result = directResultFromVars(vars);
  const implementation = implementationFromVars(vars);
  const review = reviewFromVars(vars);
  const verification = reviewVerificationFromVars(vars) || {};
  const candidates = [
    result.acceptance_table,
    result.acceptanceTable,
    result.structured_acceptance,
    result.structuredAcceptance,
    implementation.acceptance_table,
    implementation.acceptanceTable,
    implementation.structured_acceptance,
    implementation.structuredAcceptance,
    review.acceptance_table,
    review.acceptanceTable,
    review.structured_acceptance,
    review.structuredAcceptance,
    verification.acceptance_table,
    verification.acceptanceTable,
    vars && vars.acceptance_table,
    vars && vars.acceptanceTable,
  ];
  const rows = [];
  for (const candidate of candidates) rows.push(...acceptanceRowsFromValue(candidate));
  return rows;
}

function directCompletionContract(vars, opts = {}) {
  const result = directResultFromVars(vars);
  const implementation = implementationFromVars(vars);
  const review = reviewFromVars(vars);
  const signals = [];
  const conflicts = [];
  const negatives = [];
  function booleanSignal(object, key, field) {
    if (!object || !Object.prototype.hasOwnProperty.call(object, key)) return;
    const value = object[key];
    if (typeof value !== 'boolean') {
      conflicts.push(`${field} 应为布尔值,实际=${typeof value}`);
      return;
    }
    signals.push({ field, value });
    if (value === false) negatives.push(`${field}=false`);
  }
  booleanSignal(result, 'done', 'result.done');
  booleanSignal(implementation, 'done', 'implementation.done');
  booleanSignal(review, 'pass', 'review.pass');

  const logic = logicChainFromVars(vars);
  const logicStatus = normalizePoint(logic && (logic.current_status || logic.currentStatus));
  if (DIRECT_INCOMPLETE_STATUS_RE.test(logicStatus)) {
    negatives.push(`logic_chain.current_status=${logicStatus}`);
  }
  const incompleteRows = directAcceptanceRows(vars).filter(row => {
    const status = normalizePoint(row && row.status);
    return status !== ACCEPTANCE_NOT_APPLICABLE_STATUS && DIRECT_INCOMPLETE_STATUS_RE.test(status);
  });
  for (const row of incompleteRows) {
    negatives.push(`structured_acceptance=${normalizePoint(row.status)}:${normalizePoint(row.point)}`);
  }

  const positiveSignals = signals.filter(signal => signal.value === true);
  const negativeSignals = signals.filter(signal => signal.value === false);
  if (positiveSignals.length && (negativeSignals.length || incompleteRows.length || DIRECT_INCOMPLETE_STATUS_RE.test(logicStatus))) {
    conflicts.push(`正向与负向完成信号冲突:${positiveSignals.map(x => x.field).join(',')} vs ${negatives.join(',')}`);
  }
  const conflictMode = ['active', 'shadow'].includes(opts.conflictMode) ? opts.conflictMode : 'shadow';
  const conflictBlocked = conflictMode === 'active' && conflicts.length > 0;
  const incomplete = negatives.length > 0 || conflictBlocked;
  return {
    incomplete,
    reason: incomplete
      ? (negatives[0] || `direct completion schema conflict: ${conflicts[0]}`)
      : null,
    signals,
    negatives,
    conflicts,
    conflict_mode: conflictMode,
    conflict_blocked: conflictBlocked,
    acceptance_incomplete_rows: incompleteRows.map(row => ({
      point: normalizePoint(row.point),
      status: normalizePoint(row.status),
    })),
  };
}

function validateDirectCompletionOverride(value, taskId, opts = {}) {
  if (!isPlainObject(value)) return { ok: false, reason: '缺少人工覆盖回执' };
  if (opts.finalConsumerVerified !== true) {
    return { ok: false, reason: '人工覆盖缺少最终消费点的签名与 decision action 复核' };
  }
  if (value.schema !== DIRECT_COMPLETION_OVERRIDE_SCHEMA) {
    return { ok: false, reason: `schema 必须为 ${DIRECT_COMPLETION_OVERRIDE_SCHEMA}` };
  }
  if (value.approved !== true || value.actor !== 'owner' || value.source !== 'owner_decision') {
    return { ok: false, reason: '人工覆盖必须由 owner_decision 显式批准' };
  }
  if (String(value.taskId || value.task_id || '') !== String(taskId || '')) {
    return { ok: false, reason: '人工覆盖 taskId 与当前任务不一致' };
  }
  if (!String(value.reason || '').trim()) return { ok: false, reason: '人工覆盖缺少 reason' };
  if (!Number.isFinite(Date.parse(value.approved_at || ''))) return { ok: false, reason: '人工覆盖缺少有效 approved_at' };
  if (!String(value.receiptId || '').trim()
    || !String(value.verification || '').trim()
    || value.signatureAlgorithm !== 'ed25519'
    || !String(value.authorityId || '').trim()
    || !String(value.signature || '').trim()
    || !String(value.decisionCardId || '').trim()
    || !String(value.queueAgent || '').trim()
    || !String(value.queueId || '').trim()) {
    return { ok: false, reason: '人工覆盖缺少最终验签所需的 receipt/authority/queue 证明' };
  }
  return {
    ok: true,
    receipt: {
      schema: value.schema,
      taskId: value.taskId || value.task_id,
      actor: value.actor,
      source: value.source,
      reason: String(value.reason).slice(0, 500),
      approved_at: value.approved_at,
      receiptId: value.receiptId,
      verification: value.verification,
      signatureAlgorithm: value.signatureAlgorithm,
      authorityId: value.authorityId,
      decisionCardId: value.decisionCardId,
      queueAgent: value.queueAgent,
      queueId: value.queueId,
    },
  };
}

// agent-once/direct execute 兼容 result/implementation/review 三类合同。
// 缺字段继续放行;显式负向信号硬拦;字段类型/合同冲突先 shadow 留审计。
function selfReportedIncomplete(vars, opts = {}) {
  return directCompletionContract(vars, opts);
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
  // 允许区外只在回执附 write_audit 告警字段、不打回。
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
  STRUCTURED_ACCEPTANCE_PROTOCOL,
  STRUCTURED_ACCEPTANCE_PROTOCOL_MARKER,
  VISUAL_ACCEPTANCE_SCHEMA,
  VISUAL_ACCEPTANCE_PENDING,
  VISUAL_ACCEPTANCE_NA,
  VISUAL_ACCEPTANCE_POINT,
  VISUAL_ACCEPTANCE_NA_POINT,
  collectText,
  deliveryEvidenceRequiredFromText,
  readStructuredAcceptanceTemplate,
  structuredAcceptanceTemplatePath,
  structuredAcceptanceTemplateReference,
  hasStructuredAcceptanceTable,
  structuredAcceptanceProtocolV2,
  visualRequirementSignals,
  positiveVisualRequirement,
  classifyVisualAcceptance,
  visualChangePathMatches,
  visualAcceptancePoint,
  notApplicableVisualRow,
  visualAcceptanceRequired,
  ensureStructuredAcceptanceProtocolV2,
  refreshStructuredAcceptanceVisualState,
  refreshVisualAcceptanceContext,
  buildStructuredAcceptanceTable,
  parseStructuredAcceptanceRows,
  findAcceptanceRow,
  taskRequiredAcceptanceRows,
  implementationAcceptanceRows,
  reviewAcceptanceRows,
  visualEvidenceImagePaths,
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
  validateReviewRoutingContract,
  validateReviewHardEvidence,
  validateReviewLoopCompletion,
  IMPLEMENTATION_FAILURE_RECEIPT_SCHEMA,
  implementationFailureReceipts,
  DIRECT_COMPLETION_OVERRIDE_SCHEMA,
  directAcceptanceRows,
  directCompletionContract,
  validateDirectCompletionOverride,
  selfReportedIncomplete,
};
