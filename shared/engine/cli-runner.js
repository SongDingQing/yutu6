'use strict';
/*
 * cli-runner:信封运行时(蓝图 §3/§4)。把一个 agent 节点变成一次真实 CLI 执行——
 * 写 task.md 信封 → 按角色 spawn 对应 CLI(codex/new-api/peekaboo…)→ 收 stdout 写 result.md →
 * 从 result 里抽结构化结果(```json 块)合并回上下文。以信封 I/O 为权威(§10 best-effort runner)。
 *
 * 默认用 spawnSync:引擎大多数节点是顺序编排。少数扇出节点(如董事会并行评审)
 * 可调用 cliRunner.runNodeAsync 并发执行同一信封契约。
 * 角色→runner 映射默认参照 model-routing.yaml 的 roles;可在 roleMap 覆盖。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const EventLog = require('./eventlog');
const DoneGate = require('./done-gate');
const Handoff = require('./handoff');
const LessonIndex = require('./lesson-index');
const Failover = require('../routing/failover');
const DEFAULT_QUEUE_MODULE = path.resolve(__dirname, 'queue.js');

const DEFAULT_NODE_TIMEOUT_SEC = 600;
const OUTPUT_EVENT_MAX_CHARS = 1000;

const DEFAULT_ROLE_MAP = {
  orchestrator: 'codex',
  secretary: 'codex',
  supervisor:   'codex',
  reasoning_architect: 'codex',
  worker_code:  'codex',
  worker_narrow: 'codex',
  'insight-scout': 'codex',
  quality_ops: 'codex',
  memory_officer: 'codex',
  hr_manager: 'codex',
  hr_specialist: 'codex',
  it_engineer: 'codex',
  frontend_designer: 'codex',
  'repair-lead': 'codex-privileged',
  repair: 'codex-privileged',
  gui_desktop_control: 'peekaboo',   // 需点击/原生 App/无 API 网页 → Peekaboo(见 runners.yaml)
};

// 知识库检索注入(知识库打通):envelope 组装前 spawnSync query.py --json 取 top-k,
// 拼成"# 知识库检索(只读)"块注入信封。对所有 runner(含纯文本)生效,因为是预取而非让 agent 自己调。
// 安全:任何失败/超时/无内容都静默返空,绝不阻断信封组装。env YUTU6_KB_INJECT=0 可关。
const KB_INJECT_MAX_HITS = 3;
const KB_INJECT_TIMEOUT_MS = 4000;
// 进程级缓存:同一任务内 goal 跨节点/attempt/failover 候选不变,检索结果只取一次。
// 此前每个节点、每次 attempt、每个 failover 候选都各自阻塞跑一次 python+sqlite(4s 上限)。
// engine-runner 每任务 fresh spawn,进程即任务边界,Map 不会跨任务泄漏。
const kbContextCache = new Map();
function fetchKbContext(ctx) {
  if (process.env.YUTU6_KB_INJECT === '0') return '';  // 关断开关优先于缓存,保证随时可关
  const cacheKey = String((ctx && ctx.goal) || '').slice(0, 200);
  if (cacheKey && kbContextCache.has(cacheKey)) return kbContextCache.get(cacheKey);
  const result = fetchKbContextUncached(ctx);
  if (cacheKey) kbContextCache.set(cacheKey, result);
  return result;
}
function fetchKbContextUncached(ctx) {
  try {
    const root = (ctx && ctx.workspaceRoot) || process.cwd();
    const dbFile = path.join(root, 'knowledge', 'kb.sqlite');
    const queryScript = path.join(root, 'knowledge', 'query.py');
    if (!fs.existsSync(dbFile) || !fs.existsSync(queryScript)) return '';
    const goal = String((ctx && ctx.goal) || '').trim();
    if (!goal) return '';
    const res = spawnSync('python3', [queryScript, goal.slice(0, 200), '--json'], {
      cwd: root, encoding: 'utf8', timeout: KB_INJECT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
    });
    if (res.error || res.status !== 0 || !res.stdout) return '';
    let data = null;
    try { data = JSON.parse(res.stdout.trim().split(/\r?\n/).pop() || '{}'); } catch (_) { return ''; }
    if (!data || !data.ok || !Array.isArray(data.hits) || !data.hits.length) return '';
    const lines = ['# 知识库检索(只读参考:可能含提示词模板/品牌准则/历史优秀案例;按需采用,与本任务无关可忽略)'];
    for (const h of data.hits.slice(0, KB_INJECT_MAX_HITS)) {
      const p = String(h.path || '').slice(0, 140);
      const t = String(h.text || '').replace(/\s+/g, ' ').trim().slice(0, 420);
      if (t) lines.push(`- [${p}] ${t}`);
    }
    if (Array.isArray(data.entities) && data.entities.length) {
      lines.push(`- 相关实体: ${data.entities.slice(0, 8).map(e => e && e.name).filter(Boolean).join('、')}`);
    }
    lines.push('');
    return lines.length > 2 ? lines.join('\n') : '';
  } catch (_) { return ''; }
}

// 历史教训结构化注入(拍板 Q9):goal 命中六域领域词(队列/门禁/路由/通知/视觉/进程)时,
// 从 shared/reference/lesson-index.json 取 top3 同域教训,在知识库注入块附近拼
// "# 历史教训(自动注入,与本任务同域的既往坑)" 块,总预算 ≤1200 字。
// 安全:无命中/索引缺失/任何异常=静默空串,绝不阻断信封;env YUTU6_LESSON_INJECT=0 关闭(默认开)。
function fetchLessonContext(ctx) {
  try {
    return LessonIndex.lessonContextBlock(String((ctx && ctx.goal) || ''), {
      workspaceRoot: (ctx && ctx.workspaceRoot) || process.cwd(),
    });
  } catch (_) { return ''; }
}

// 交接机制 shadow 阶段(拍板①②修正版):指针化只发生在这一层。
// envOpts(可选,第三参,向后兼容):{ runner, runsDir, eventlog, taskId, projectId, env }
// 仅当 YUTU6_HANDOFF_MODE=on 且 runner 是 CLI 族(非 openai_http/tool-harness)且
// engine-runs/<taskId>/task.md 存在且指纹匹配时,goal 段替换为「一句话意图+完整路径指针+指纹+先读指令」;
// 验收表仍完整内联(done-gate 逐字锚点需要);任何读失败回退全文并 emit handoff.fallback。
function emitHandoffFallback(envOpts, node, reason) {
  const eventlog = envOpts && envOpts.eventlog;
  if (!eventlog) return;
  try {
    eventlog.emit('handoff.fallback', {
      task: envOpts.taskId || null,
      node: node && node.id || null,
      role: node && node.agent_role || null,
      stage: 'envelope',
      reason: String(reason || '').slice(0, 300),
      projectId: envOpts.projectId || null,
    });
  } catch (_) {}
}

function envelopeGoalSection(node, ctx, envOpts) {
  const fullGoal = [`- 目标:${ctx.goal || '(见上下文)'}`];
  if (!envOpts) return fullGoal;
  let decision = null;
  try {
    decision = Handoff.envelopeGoalPointer({
      runDir: envOpts.runsDir,
      ctx,
      runner: envOpts.runner,
      env: envOpts.env,
    });
  } catch (e) {
    decision = { fallback: `handoff_error: ${e && e.message || e}` };
  }
  if (!decision) return fullGoal;
  if (!decision.pointer) {
    emitHandoffFallback(envOpts, node, decision.fallback || 'handoff_pointer_unavailable');
    return fullGoal;
  }
  const p = decision.pointer;
  return [
    `- 目标(一句话意图):${p.intent}`,
    `- 任务稿指针:${p.file}`,
    `- 任务稿指纹:${p.fingerprint}`,
    `- 指令:先完整读取上面「任务稿指针」指向的 task.md(目标/边界/验收全文在该文件),核对指纹一致后再执行;下方验收表为逐字锚点,已完整内联。`,
  ];
}

function buildEnvelope(node, ctx, envOpts) {
  const rolePrompt = ctx.agentPrompts && ctx.agentPrompts[node.agent_role]
    ? [`# 角色提示词`, ctx.agentPrompts[node.agent_role], ``]
    : [];
  const acceptanceTemplateRef = DoneGate.structuredAcceptanceTemplateReference({
    workspaceRoot: ctx.workspaceRoot || process.cwd(),
  });
  const outputContract = [];
  if (node.id === 'orchestrator-plan') {
    outputContract.push(
      `# 结构化输出要求`,
      `请判断任务 projectId(如 控制台 或一个已注册项目部门 id),并在最后输出 \`\`\`json 代码块: {"orchestrator":{"projectId":"控制台","summary":"...","acceptance":"..."}}。`,
      `如果目标项目尚未注册,停止并说明需要先创建项目部门。`,
      ``,
    );
  } else if (node.id === 'implement') {
    outputContract.push(
      `# 结构化输出要求`,
      `请在最后输出 \`\`\`json 代码块: {"implementation":{"done":true,"summary":"...","changed_files":[],"receipt":{"taskId":"${ctx.taskId || ctx.id || ''}","specFingerprint":"${ctx.spec_fingerprint || ''}","changedFiles":[],"tests":["node tests/run.js exit 0 或说明未运行原因"],"artifacts":["文件:行 / 截图 / 报告路径"],"verdict":"done","blocked_required_specs":[]},"acceptance_table":[{"point":"逐字复制验收表要点","status":"完成|部分|未完成","evidence":"文件:行 / git diff + 文件 / 截图路径 / 命令 exit 0","notes":"..."}],"logic_chain":{"summary":"...","current_status":"done|blocked|partial","actions":["做了什么"],"evidence":[{"kind":"file|command|test|analysis","path":"...","command":"...","exit_code":0,"summary":"..."}],"tests":[{"command":"node tests/run.js","exit_code":0,"summary":"..."}],"conclusion":"..."}}}。`,
      `receipt 是硬性协议回执:必须带 taskId、specFingerprint、changedFiles、tests、artifacts、verdict; changedFiles 必须覆盖 implementation.changed_files。必做规格不能达成时,必须事前写 blocked_required_specs 并有主人批准,否则 done gate 打回。`,
      `验收表模板单一来源:${acceptanceTemplateRef};按模板字段逐行填写,不得改成段落声明。`,
      `如果任务验收里有结构化验收表,implementation.acceptance_table 必须按表逐行填写:要点逐字复制,状态只能填 完成/部分/未完成;留空、跨过、无证据、证据路径不存在都视为未完成。`,
      `每行证据必须对得上本行要点;设计对照行必须在 evidence 或 notes 指回同一个 decisions.md:行号,不能所有行复用同一个泛化证据。`,
      `视觉/UI 类要点必须填可核 peekaboo 图片截图路径(.png/.jpg/.webp/.gif),并填 Codex 对照设计挑错证据;failure.json/截图失败标记只能作为阻塞或降级说明,不能把该行标为 完成;不接受"自验收已归档"这类声明。`,
      `视觉/UI 截图挑错默认由 Codex 复核;glm-5.2 不能作为最终视觉自验替代。`,
      `logic_chain 是硬性 done gate:必须写清做了什么、当前状态、证据在哪;实现类列 changed_files 并给 diff/test/文件证据,分析类给结论+依据。`,
      ctx.loop_engineering && ctx.loop_engineering.standards ? `loop engineering 标准: ${JSON.stringify(ctx.loop_engineering.standards)}; 如果上轮 review 给出 critique/skill 改进,本轮必须按该方法重新生成并在 logic_chain.actions 说明。` : null,
      `证据必须是可核指针,如文件路径/行号、命令和退出码、测试输出摘要、截图路径或分析依据文件;只写"已完成"无效。`,
      `如果任务明确要求不改文件, changed_files 必须为空。`,
      ``,
    );
  } else if (node.id === 'review') {
    outputContract.push(
      `# 结构化输出要求`,
      `请审查上一步结果,并在最后输出 \`\`\`json 代码块: {"review":{"pass":true,"severity":"low","notes":"...","verification":{"verdict":"true|false|partial","checked":["核实了哪些"],"acceptance_table":[{"point":"逐字复制验收表要点","status":"完成|部分|未完成","evidence":"复核证据位置","notes":"..."}],"evidence":[{"kind":"file|diff|command|test|analysis","path":"...","command":"...","exit_code":0,"summary":"..."}]}}}。`,
      `验收表模板单一来源:${acceptanceTemplateRef};review.verification.acceptance_table 必须按同一模板逐行复核,不得用总结声明代替。`,
      `loop engineering 评估必须补充 review.evaluation: {"score":0.0到1.0,"criteria_scores":[{"id":"S1","score":0.0到1.0,"evidence":"..."}],"gaps":["差距"],"improvement_points":["下一轮具体改进点"]}; score 必须按验收标准逐项核实,不能主观给分。`,
      `pass 必须是布尔值; severity 用 low/medium/high。`,
      `如果任务验收里有结构化验收表,review.verification.acceptance_table 必须逐行复核 implementation.acceptance_table;任一行不是 完成、证据为空、证据不可核、证据对不上,必须 pass=false。`,
      `设计对照行必须核实 evidence 或 notes 指回同一个 decisions.md:行号;普通行必须核实证据/备注/文件片段能对上本行要点,不能接受一条证据套所有行。`,
      `review.verification.acceptance_table 每行 evidence 必须是 done gate 可核指针:用从仓库根可解析的工作区相对完整路径(如 projects/控制台/artifacts/architecture/xxx.md:行),设计对照行须含对应 decisions.md:行号;禁止裸文件名(如 status.md:6、xxx-rfc.md:10)和"git status 确认…"这类纯文字断言——done gate 按完整路径解析存在性,裸名/纯文字一律判证据不可核打回。最稳做法:直接复用 implementation.acceptance_table 同一行已核实通过的完整路径证据。`,
      `视觉/UI 类必须核实 peekaboo 图片截图路径(.png/.jpg/.webp/.gif)存在,且有 Codex 对照设计挑错证据;failure.json/截图失败标记只能证明截图尝试失败,不能作为该行 完成 证据;不接受"自验收已归档"声明。`,
      `视觉/UI 截图挑错默认由 Codex 复核;glm-5.2 不能作为最终视觉自验替代。`,
      `主管复审必须硬核实:对照 implementation.logic_chain 与实际文件/命令/测试;声称改了 X 就核实 X 的文件/diff;声称跑测试就核实测试存在且通过;分析类核实结论是否有依据。`,
      `如果上一步 implementation.changed_files 非空,必须把每一个 changed_files 路径原样复制到 verification.checked,并在 verification.evidence 为每个路径给出 file/diff/test 证据;目录、日志和生成产物也要逐项写明,不能只写"已核实改动"。`,
      `只有在目标验收项已逐项达成、implementation.done=true、逻辑链完整、必要的 changed_files/diff/截图/验收证据齐全,且 verification.evidence 可核时,才能 pass=true。`,
      `如果目标未达成、证据不足、只是方案草案、无法写盘或需要返工,必须 pass=false 并在 notes 写明打回原因。`,
      ``,
    );
  }
  const example = structuredOutputExample(node);
  const kbContext = fetchKbContext(ctx);
  const lessonContext = fetchLessonContext(ctx);
  return [
    `# 任务:${node.id}`,
    ctx.taskId ? `- taskId:${ctx.taskId}` : null,
    `- 角色:${node.agent_role || '-'}`,
    ctx.spec_fingerprint ? `- 规格指纹:${ctx.spec_fingerprint}` : null,
    ctx.projectId ? `- 项目:${ctx.projectId}${ctx.scopedToProject ? ' (scoped_to_project)' : ''}` : null,
    ...envelopeGoalSection(node, ctx, envOpts),
    `- 边界:${ctx.bounds || '不要碰未点名的文件;未注册项目一律不操作'}`,
    `- 输入:${(ctx.inputs || []).join(', ') || '(无)'}`,
    `- 验收:${ctx.acceptance || '产出可验证;带视觉产物须附截图并对照用户证据'}`,
    ctx.orchestrator_plan ? `- 总管拆解:${ctx.orchestrator_plan}` : null,
    `- 上一步结果(供参考):${JSON.stringify(pickPrev(ctx))}`,
    ``,
    ...rolePrompt,
    ...(kbContext ? [kbContext] : []),
    ...(lessonContext ? [lessonContext] : []),
    ...outputContract,
    `请完成上述任务。最后只能把符合本节点合同的结构化结论放在一个 \`\`\`json 代码块里;不要用简写 JSON 或纯文字总结替代。示例:`,
    '```json',
    JSON.stringify(example),
    '```',
  ].filter(x => x != null).join('\n');
}

function structuredOutputExample(node) {
  if (node.id === 'orchestrator-plan') {
    return { orchestrator: { projectId: '控制台', summary: '...', acceptance: '...' } };
  }
  if (node.id === 'implement') {
    return {
      implementation: {
        done: true,
        summary: '...',
        changed_files: [],
        receipt: {
          taskId: '...',
          specFingerprint: '...',
          changedFiles: [],
          tests: ['node tests/run.js exit 0'],
          artifacts: ['projects/控制台/status.md:1'],
          verdict: 'done',
          blocked_required_specs: [],
        },
        acceptance_table: [
          {
            point: '逐字复制验收表要点',
            status: '完成',
            evidence: 'node tests/run.js exit 0',
            notes: '...',
          },
        ],
        logic_chain: {
          summary: '...',
          current_status: 'done',
          actions: ['做了什么'],
          evidence: [
            {
              kind: 'test',
              command: 'node tests/run.js',
              exit_code: 0,
              summary: '...',
            },
          ],
          tests: [
            {
              command: 'node tests/run.js',
              exit_code: 0,
              summary: '...',
            },
          ],
          conclusion: '...',
        },
      },
    };
  }
  if (node.id === 'review') {
    return {
      review: {
        pass: true,
        severity: 'low',
        notes: '...',
        verification: {
          verdict: 'true',
          checked: ['implementation.done', 'implementation.logic_chain', 'implementation.acceptance_table'],
          acceptance_table: [
            {
              point: '逐字复制验收表要点',
              status: '完成',
              evidence: '复核证据位置',
              notes: '...',
            },
          ],
          evidence: [
            {
              kind: 'test',
              command: 'node tests/run.js',
              exit_code: 0,
              summary: '...',
            },
          ],
        },
      },
    };
  }
  return {
    result: {
      done: true,
      summary: '...',
      evidence: [
        {
          kind: 'file',
          path: 'projects/控制台/status.md',
          summary: '...',
        },
      ],
    },
  };
}
// 信封"上一步结果"排除名单扩容(2026-07-03 架构审视 A-4,对抗评审修正版):
// 新剔除 spec_snapshot——protocol-gate 校验用的规格快照,内容=goal+验收表全文副本,
// 进 prompt 即把任务规格在同一信封里重复第二遍(实测单信封 40-56% 为逐字重复的最大来源)。
// done-gate/protocol-gate 读的是 ctx 本体不经 pickPrev,拦截能力不受影响。
// implementation/review 等结论键保持整键透传不做摘要(review 合同要求逐项原样核对,摘要会被门禁正确打回)。
function pickPrev(ctx) {
  const {
    goal, bounds, inputs, acceptance, loop, max_loops, agentPrompts, workspaceRoot,
    spec_snapshot, attachments,
    ...rest
  } = ctx;
  return rest;
}

// 从首个 { / [ 起按括号配对(尊重字符串/转义)切出第一段完整 JSON 值,丢弃尾部多余字符。
// 用于容忍模型输出常见的「闭合括号多写」(如 {...}}}})等尾部噪声,避免整段结构化产物
// 因尾部一两个多余字符被 JSON.parse 整体判废、进而被 done gate 误报「缺少逻辑链」。
function extractFirstBalancedJson(text) {
  const s = String(text || '');
  const n = s.length;
  let i = 0;
  for (; i < n; i++) { const c = s[i]; if (c === '{' || c === '[') break; }
  if (i >= n) return null;
  const open = s[i];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < n; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}

function extractJson(text) {
  const matches = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || '')))) matches.push(m[1]);
  for (let i = matches.length - 1; i >= 0; i--) {
    const body = matches[i].trim();
    try { return JSON.parse(body); } catch (_) {}
    // 严格解析失败:尝试切出首段配平 JSON 再解析,容忍尾部多余括号/噪声。
    const balanced = extractFirstBalancedJson(body);
    if (balanced && balanced !== body) {
      try { return JSON.parse(balanced); } catch (_) {}
    }
  }
  return null;
}

function readEnvFile(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch (_) {}
  return env;
}

function resolveConfigPath(baseDir, file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(baseDir, file);
}

function attachmentImagePaths(ctx) {
  return (ctx && Array.isArray(ctx.attachments) ? ctx.attachments : [])
    .map(a => a && a.path)
    .filter(Boolean);
}

function imageMimeFromPath(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return null;
}

function resolveInputPath(file, opts) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve((opts && opts.workdir) || process.cwd(), file);
}

function buildOpenAiUserContent(prompt, ctx, opts) {
  const blocks = [{ type: 'text', text: prompt }];
  for (const file of attachmentImagePaths(ctx)) {
    const mime = imageMimeFromPath(file);
    if (!mime) continue;
    let bytes;
    try { bytes = fs.readFileSync(resolveInputPath(file, opts)); } catch (_) { continue; }
    blocks.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
    });
  }
  return blocks.length === 1 ? prompt : blocks;
}

function buildRunnerEnv(r, opts) {
  const cfgDir = opts.configDir || opts.workdir;
  const env = Object.assign({}, process.env);
  const envFile = resolveConfigPath(cfgDir, r.envFile || r.tokenFile);
  const fileEnv = envFile ? readEnvFile(envFile) : {};
  if (r.envFromFile && typeof r.envFromFile === 'object') {
    for (const [targetKey, sourceKey] of Object.entries(r.envFromFile)) {
      if (fileEnv[sourceKey] != null) env[targetKey] = fileEnv[sourceKey];
    }
  } else {
    Object.assign(env, fileEnv);
  }
  if (r.env && typeof r.env === 'object') {
    Object.assign(env, r.env);
  }
  return env;
}

function runOpenAiHttpSync(r, prompt, opts, ctx) {
  const cfgDir = opts.configDir || opts.workdir;
  const envFile = resolveConfigPath(cfgDir, r.tokenFile || r.envFile);
  const env = envFile ? readEnvFile(envFile) : {};
  const baseUrl = String((r.baseUrlEnv && process.env[r.baseUrlEnv]) || r.baseUrl || env.NEW_API_BASE_URL || '').replace(/\/+$/, '');
  const token = (r.tokenEnv && process.env[r.tokenEnv]) || env[r.tokenKey || 'NEW_API_TOKEN'] || r.token || '';
  const model = (r.modelEnv && process.env[r.modelEnv]) || r.model || env.NEW_API_MODEL || 'glm-5.2';
  if (!baseUrl || !token) return { status: 1, stdout: '', stderr: 'openai_http 缺 baseUrl 或 token' };
  const userContent = buildOpenAiUserContent(prompt, ctx, opts);
  const script = `
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const res = await fetch(payload.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + payload.token },
    body: JSON.stringify(payload.body)
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!res.ok || body.error) {
    const msg = (body.error && body.error.message) || body.message || body.raw || ('HTTP ' + res.status);
    console.error(String(msg).slice(0, 1000));
    process.exit(1);
  }
  const msg = (body.choices && body.choices[0] && body.choices[0].message) || {};
  process.stdout.write(msg.content || msg.reasoning_content || '');
})().catch(e => { console.error(e.message); process.exit(1); });
`;
  const input = JSON.stringify({
    url: `${baseUrl}/chat/completions`,
    token,
    body: {
      model,
      messages: r.systemPrompt ? [{ role: 'system', content: r.systemPrompt }, { role: 'user', content: userContent }] : [{ role: 'user', content: userContent }],
      temperature: r.temperature == null ? 0.3 : r.temperature,
      max_tokens: r.maxTokens || 2048,
    },
  });
  return spawnSync(process.execPath, ['-e', script], {
    cwd: opts.workdir,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: nodeTimeoutSec(opts) * 1000,
  });
}

function spawnBuffered(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let killedForTimeout = false;
    let timer = null;
    const maxBuffer = opts.maxBuffer || 64 * 1024 * 1024;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(Object.assign({ stdout, stderr }, result));
    };
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env || process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      finish({ status: 127, error: e, stderr: e.message });
      return;
    }
    timer = opts.timeoutMs
      ? setTimeout(() => {
        killedForTimeout = true;
        try { child.kill('SIGTERM'); } catch (_) {}
        setTimeout(() => {
          try { if (!child.killed) child.kill('SIGKILL'); } catch (_) {}
        }, 1600).unref();
      }, Math.max(1, Number(opts.timeoutMs)))
      : null;
    child.stdout.on('data', chunk => {
      const s = chunk.toString();
      if (stdout.length < maxBuffer) stdout += s;
      if (typeof opts.onStdout === 'function') opts.onStdout(s);
    });
    child.stderr.on('data', chunk => {
      const s = chunk.toString();
      if (stderr.length < maxBuffer) stderr += s;
      if (typeof opts.onStderr === 'function') opts.onStderr(s);
    });
    child.on('error', e => finish({ status: 127, error: e, stderr: stderr || e.message }));
    child.on('close', (code, signal) => {
      if (killedForTimeout) finish({ status: 124, signal: signal || null });
      else finish({ status: code == null ? 1 : code, signal: signal || null });
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

async function runOpenAiHttpAsync(r, prompt, opts, ctx) {
  const cfgDir = opts.configDir || opts.workdir;
  const envFile = resolveConfigPath(cfgDir, r.tokenFile || r.envFile);
  const env = envFile ? readEnvFile(envFile) : {};
  const baseUrl = String((r.baseUrlEnv && process.env[r.baseUrlEnv]) || r.baseUrl || env.NEW_API_BASE_URL || '').replace(/\/+$/, '');
  const token = (r.tokenEnv && process.env[r.tokenEnv]) || env[r.tokenKey || 'NEW_API_TOKEN'] || r.token || '';
  const model = (r.modelEnv && process.env[r.modelEnv]) || r.model || env.NEW_API_MODEL || 'glm-5.2';
  if (!baseUrl || !token) return { status: 1, stdout: '', stderr: 'openai_http 缺 baseUrl 或 token' };
  const userContent = buildOpenAiUserContent(prompt, ctx, opts);
  const script = `
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const res = await fetch(payload.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + payload.token },
    body: JSON.stringify(payload.body)
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!res.ok || body.error) {
    const msg = (body.error && body.error.message) || body.message || body.raw || ('HTTP ' + res.status);
    console.error(String(msg).slice(0, 1000));
    process.exit(1);
  }
  const msg = (body.choices && body.choices[0] && body.choices[0].message) || {};
  process.stdout.write(msg.content || msg.reasoning_content || '');
})().catch(e => { console.error(e.message); process.exit(1); });
`;
  return spawnBuffered(process.execPath, ['-e', script], {
    cwd: opts.workdir,
    input: JSON.stringify({
      url: `${baseUrl}/chat/completions`,
      token,
      body: {
        model,
        messages: r.systemPrompt ? [{ role: 'system', content: r.systemPrompt }, { role: 'user', content: userContent }] : [{ role: 'user', content: userContent }],
        temperature: r.temperature == null ? 0.3 : r.temperature,
        max_tokens: r.maxTokens || 2048,
      },
    }),
    timeoutMs: nodeTimeoutSec(opts) * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function anthropicSettings(r, opts) {
  const cfgDir = opts.configDir || opts.workdir;
  const envFile = resolveConfigPath(cfgDir, r.tokenFile || r.envFile);
  const env = envFile ? readEnvFile(envFile) : {};
  return {
    baseUrl: String((r.baseUrlEnv && process.env[r.baseUrlEnv]) || r.baseUrl || '').replace(/\/+$/, ''),
    token: (r.tokenEnv && process.env[r.tokenEnv]) || env[r.tokenKey || 'ANTHROPIC_API_KEY'] || r.token || '',
    model: (r.modelEnv && process.env[r.modelEnv]) || r.model || '',
  };
}

function anthropicChildScript() {
  return `
const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const res = await fetch(payload.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': payload.token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload.body)
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!res.ok || body.error) {
    const msg = (body.error && body.error.message) || body.message || body.raw || ('HTTP ' + res.status);
    console.error(String(msg).slice(0, 1000));
    process.exit(1);
  }
  const content = Array.isArray(body.content) ? body.content : [];
  process.stdout.write(content.map(part => part && part.text || '').filter(Boolean).join('\\n'));
})().catch(e => { console.error(e.message); process.exit(1); });
`;
}

function anthropicInput(r, prompt, opts) {
  const settings = anthropicSettings(r, opts);
  if (!settings.baseUrl || !settings.token || !settings.model) return null;
  return JSON.stringify({
    url: `${settings.baseUrl}/v1/messages`,
    token: settings.token,
    body: {
      model: settings.model,
      system: r.systemPrompt || undefined,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: r.maxTokens || 2048,
      temperature: r.temperature == null ? 0.3 : r.temperature,
    },
  });
}

function runAnthropicHttpSync(r, prompt, opts) {
  const input = anthropicInput(r, prompt, opts);
  if (!input) return { status: 1, stdout: '', stderr: 'anthropic_http 缺 baseUrl、model 或 token' };
  return spawnSync(process.execPath, ['-e', anthropicChildScript()], {
    cwd: opts.workdir,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: nodeTimeoutSec(opts) * 1000,
  });
}

function runAnthropicHttpAsync(r, prompt, opts) {
  const input = anthropicInput(r, prompt, opts);
  if (!input) return Promise.resolve({ status: 1, stdout: '', stderr: 'anthropic_http 缺 baseUrl、model 或 token' });
  return spawnBuffered(process.execPath, ['-e', anthropicChildScript()], {
    cwd: opts.workdir,
    input,
    timeoutMs: nodeTimeoutSec(opts) * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runnerExecution(r) {
  const exec = r && r.execution && typeof r.execution === 'object' ? r.execution : {};
  const capabilities = Array.isArray(r && r.capabilities) ? r.capabilities : [];
  const hasCapability = name => capabilities.includes(name);
  const explicitCanWrite = exec.canWriteFiles != null ? exec.canWriteFiles : exec.writeFiles;
  const explicitCanShell = exec.canRunCommands != null ? exec.canRunCommands : exec.shell;
  const kind = r && r.kind;
  const cmd0 = r && Array.isArray(r.cmd) ? r.cmd[0] : '';
  const isTextOnly = kind === 'openai_http' || kind === 'anthropic_http';
  const isHarness = kind === 'openai_http_tool_harness';
  const defaultCanWrite = isHarness || (!isTextOnly && cmd0 !== '__mock__');
  const defaultCanShell = isHarness || (!isTextOnly && cmd0 !== '__mock__');
  return {
    canWriteFiles: explicitCanWrite != null ? explicitCanWrite === true : (defaultCanWrite || hasCapability('local_file_edits')),
    canRunCommands: explicitCanShell != null ? explicitCanShell === true : (defaultCanShell || hasCapability('tests_builds')),
    toolHarnessRunner: r && (r.toolHarnessRunner || exec.toolHarnessRunner || exec.tool_runner || exec.fallbackToolRunner) || null,
  };
}

// 交付/工具型工作节点都可能需要落盘/跑命令/截图:
//  - multi-step flow 的 implement 节点
//  - agent-once flow 的 execute 节点(前端评审、it_engineer、hr 等都走这里)
// orchestrator-plan / review 等规划复审节点保持纯文本即可,不在此列。
const WRITABLE_WORK_NODE_IDS = new Set(['implement', 'execute']);

// 角色级声明优先于文本启发式:config 里 role.execution.requiresWritableRunnerForImplement===true
// 表示该角色的 execute/implement 节点恒需可落盘 runner(交付文件/跑命令/截图),
// 不能让 goal 文本里的「评审/报告/只读」等词把它误判为纯文本即可。
// 可逆开关:YUTU6_HONOR_WRITABLE_FLAG=0 时退回旧的纯启发式行为。
function roleDeclaresWritable(roleExec) {
  if (process.env.YUTU6_HONOR_WRITABLE_FLAG === '0') return false;
  return !!(roleExec && roleExec.requiresWritableRunnerForImplement === true);
}

function nodeNeedsWritableRunner(node, ctx, roleExec) {
  if (!node || !WRITABLE_WORK_NODE_IDS.has(node.id)) return false;
  if (roleDeclaresWritable(roleExec)) return true;
  return DoneGate.deliveryEvidenceRequiredFromText(
    ctx && ctx.goal,
    ctx && ctx.acceptance,
    ctx && ctx.bounds,
    ctx && ctx.orchestrator_plan,
  );
}

function resolveRunnerForNode(node, ctx, roleMap, runners, overrideRunnerId, roleExecMeta) {
  const requestedRunnerId = overrideRunnerId || roleMap[node.agent_role] || 'codex';
  const requested = runners[requestedRunnerId];
  if (!requested) return { fail: `无 runner 映射: role=${node.agent_role} → ${requestedRunnerId}` };
  const roleExec = roleExecMeta && node && node.agent_role ? roleExecMeta[node.agent_role] : null;
  const needsWritable = nodeNeedsWritableRunner(node, ctx, roleExec);
  const requestedExec = runnerExecution(requested);
  if (!needsWritable || requestedExec.canWriteFiles) {
    return { runnerId: requestedRunnerId, runner: requested, requestedRunnerId, upgraded: false, needsWritable };
  }
  const harnessId = requestedExec.toolHarnessRunner;
  const harness = harnessId && runners[harnessId];
  if (harness && runnerExecution(harness).canWriteFiles) {
    return { runnerId: harnessId, runner: harness, requestedRunnerId, upgraded: true, needsWritable };
  }
  return {
    fail: `runner=${requestedRunnerId} 是纯文本 runner,但 ${node.id} 任务需要落盘/交付; 请配置 execution.toolHarnessRunner 或改派有 canWriteFiles 的 runner`,
  };
}

function nodeTimeoutSec(opts) {
  const n = Number(opts && opts.nodeTimeoutSec);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NODE_TIMEOUT_SEC;
}

function timeoutFail(runnerId, timeoutSec, dir) {
  const rel = path.relative(process.cwd(), dir).split(path.sep).join('/');
  const where = rel && !rel.startsWith('..') ? `; run=${rel}` : '';
  return `${runnerId} 运行超时(${timeoutSec}s): CLI 已启动但未在节点时限内完成${where}`;
}

function redactOutput(text) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:NEW_API_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]');
}

function compactOutput(text, max = OUTPUT_EVENT_MAX_CHARS) {
  const s = redactOutput(text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(Math.max(0, s.length - max)) : s;
}

function emitNodeOutput(opts, node, attempt, stream, text) {
  const body = compactOutput(text);
  const eventlog = opts.eventlog || (opts.eventlogFile ? new EventLog(opts.eventlogFile) : null);
  if (!eventlog || !body) return;
  try {
    eventlog.emit('node.output', {
      task: opts.taskId || null,
      node: node && node.id || null,
      attempt,
      role: node && node.agent_role || null,
      stream,
      text: body,
      projectId: opts.projectId || null,
    });
  } catch (_) {}
}

function runCommandWithOutputEvents(r, prompt, opts, node, attempt, runnerId) {
  const args = [...r.cmd.slice(1)];
  const promptVia = r.promptVia || 'arg';
  if (promptVia === 'arg') args.push(prompt);
  const timeoutMs = nodeTimeoutSec(opts) * 1000;
  const payload = {
    cmd: r.cmd[0],
    args,
    cwd: opts.workdir,
    env: buildRunnerEnv(r, opts),
    input: promptVia === 'stdin' ? prompt : null,
    timeoutMs,
    eventlogFile: opts.eventlogFile || (opts.eventlog && opts.eventlog.file) || null,
    eventlogModule: path.resolve(__dirname, 'eventlog.js'),
    queueRoot: opts.queueRoot || null,
    queueAgent: opts.queueAgent || null,
    queueId: opts.queueId || null,
    queueModule: opts.queueModule || DEFAULT_QUEUE_MODULE,
    taskId: opts.taskId || null,
    projectId: opts.projectId || null,
    nodeId: node && node.id || null,
    role: node && node.agent_role || null,
    attempt,
  };
  const script = `
const fs = require('fs');
const { spawn } = require('child_process');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
let EventLog = null;
try { EventLog = payload.eventlogFile && require(payload.eventlogModule); } catch (_) {}
const eventlog = EventLog ? new EventLog(payload.eventlogFile) : null;
let Queue = null;
try { Queue = payload.queueModule && require(payload.queueModule); } catch (_) {}
function redact(text) {
  return String(text || '')
    .replace(/(Bearer\\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:NEW_API_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\\s*)[^\\s,'"}]+/ig, '$1[redacted]');
}

function compact(text) {
  const s = redact(text).replace(/\\s+/g, ' ').trim();
  return s.length > ${OUTPUT_EVENT_MAX_CHARS} ? s.slice(Math.max(0, s.length - ${OUTPUT_EVENT_MAX_CHARS})) : s;
}
const pending = { stdout: '', stderr: '' };
let lastEmit = 0;
function emit(stream, force) {
  if (!eventlog || !pending[stream]) return;
  const now = Date.now();
  if (!force && now - lastEmit < 900 && pending[stream].length < 360 && !pending[stream].includes('\\n')) return;
  const text = compact(pending[stream]);
  pending[stream] = '';
  lastEmit = now;
  if (!text) return;
  try {
    eventlog.emit('node.output', {
      task: payload.taskId,
      node: payload.nodeId,
      attempt: payload.attempt,
      role: payload.role,
      stream,
      text,
      projectId: payload.projectId || null,
    });
  } catch (_) {}
  if (Queue && payload.queueRoot && payload.queueAgent && payload.queueId) {
    try {
      const at = new Date().toISOString();
      Queue.touchProgress(payload.queueRoot, payload.queueAgent, payload.queueId, {
        progress_at: at,
        node_event_at: at,
        progress_event: 'node.output',
        progress_node: payload.nodeId || null,
        progress_task: payload.taskId || null,
      });
    } catch (_) {}
  }
}
let child = null;
let killedForTimeout = false;
function killChild(signal) {
  if (!child || child.killed) return;
  try { child.kill(signal); } catch (_) {}
}
process.on('SIGTERM', () => { killChild('SIGTERM'); setTimeout(() => process.exit(143), 1200).unref(); });
process.on('SIGINT', () => { killChild('SIGINT'); setTimeout(() => process.exit(130), 1200).unref(); });
try {
  child = spawn(payload.cmd, payload.args, { cwd: payload.cwd, env: Object.assign({}, process.env, payload.env || {}), stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  console.error(e.message);
  process.exit(127);
}
if (payload.input != null) child.stdin.end(payload.input);
else child.stdin.end();
const timeout = setTimeout(() => {
  killedForTimeout = true;
  killChild('SIGTERM');
  setTimeout(() => killChild('SIGKILL'), 1600).unref();
}, Math.max(1, Number(payload.timeoutMs || 0)));
child.stdout.on('data', d => {
  const s = d.toString();
  process.stdout.write(s);
  pending.stdout += s;
  emit('stdout', false);
});
child.stderr.on('data', d => {
  const s = d.toString();
  process.stderr.write(s);
  pending.stderr += s;
  emit('stderr', false);
});
child.on('error', e => {
  clearTimeout(timeout);
  console.error(e.message);
  process.exit(127);
});
child.on('close', (code, signal) => {
  clearTimeout(timeout);
  emit('stdout', true);
  emit('stderr', true);
  if (killedForTimeout) process.exit(124);
  if (signal) {
    console.error('signal ' + signal);
    process.exit(128);
  }
  process.exit(code == null ? 1 : code);
});
`;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: opts.workdir,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs + 6000,
  });
}

function runRunnerOnceSync(r, prompt, opts, ctx, node, attempt, runnerId, runners) {
  if (r.kind === 'openai_http') return runOpenAiHttpSync(r, prompt, opts, ctx);
  if (r.kind === 'anthropic_http') return runAnthropicHttpSync(r, prompt, opts, ctx);
  if (r.kind === 'openai_http_tool_harness') {
    return runOpenAiToolHarnessSync(r, prompt, opts, ctx, node, attempt, runnerId, runners);
  }
  return runCommandWithOutputEvents(r, prompt, opts, node, attempt, runnerId);
}

function runCommandWithOutputEventsAsync(r, prompt, opts, node, attempt, runnerId) {
  const args = [...r.cmd.slice(1)];
  const promptVia = r.promptVia || 'arg';
  if (promptVia === 'arg') args.push(prompt);
  return spawnBuffered(r.cmd[0], args, {
    cwd: opts.workdir,
    env: buildRunnerEnv(r, opts),
    input: promptVia === 'stdin' ? prompt : null,
    timeoutMs: nodeTimeoutSec(opts) * 1000,
    maxBuffer: 64 * 1024 * 1024,
    onStdout: text => emitNodeOutput(opts, node, attempt, 'stdout', text),
    onStderr: text => emitNodeOutput(opts, node, attempt, 'stderr', text),
  });
}

async function runRunnerOnceAsync(r, prompt, opts, ctx, node, attempt, runnerId, runners) {
  if (r.kind === 'openai_http') return runOpenAiHttpAsync(r, prompt, opts, ctx);
  if (r.kind === 'anthropic_http') return runAnthropicHttpAsync(r, prompt, opts, ctx);
  if (r.kind === 'openai_http_tool_harness') {
    return runOpenAiToolHarnessAsync(r, prompt, opts, ctx, node, attempt, runnerId, runners);
  }
  return runCommandWithOutputEventsAsync(r, prompt, opts, node, attempt, runnerId);
}

async function runOpenAiToolHarnessAsync(r, prompt, opts, ctx, node, attempt, runnerId, runners) {
  const plannerId = r.modelRunner || r.plannerRunner || r.textRunner;
  const executorId = r.executorRunner || r.toolExecutorRunner || 'codex';
  const planner = plannerId && runners[plannerId];
  const executor = executorId && runners[executorId];
  if (!planner) return { status: 1, stdout: '', stderr: 'tool harness 缺少文本模型 runner: ' + (plannerId || '(未配置)') };
  if (!executor) return { status: 1, stdout: '', stderr: 'tool harness 缺少执行 runner: ' + (executorId || '(未配置)') };
  const plannerPrompt = [
    prompt,
    '',
    '# 文本模型规划阶段',
    '你是低成本文本模型。请先给出可执行方案和需要修改/验证的文件清单。',
    '注意:本阶段没有文件系统工具,不要声称已经落盘;最终落盘由工具执行 harness 完成。',
  ].join('\n');
  const plannerRes = await runRunnerOnceAsync(planner, plannerPrompt, opts, ctx, node, attempt, runnerId + ':planner', runners);
  const plannerStdout = plannerRes.stdout || '';
  const plannerStderr = plannerRes.stderr || '';
  if (plannerRes.error) return plannerRes;
  if (plannerRes.status !== 0 || plannerRes.signal) {
    return {
      status: plannerRes.status || 1,
      signal: plannerRes.signal,
      stdout: plannerStdout,
      stderr: plannerStderr || (runnerId + ' planner 阶段失败'),
      error: plannerRes.error,
    };
  }
  const executorPrompt = [
    prompt,
    '',
    '# 文本模型草案(只作意图参考,不是完成证明)',
    plannerStdout || '(文本模型无输出)',
    '',
    '# 工具执行阶段',
    '你是 ' + runnerId + ' 的真实工具执行 harness,底层执行 runner=' + executorId + '。',
    '必须在本地真实读写文件/运行必要命令;不能只给草案。',
    '如果需要改文件,请直接落盘;最后按原任务的 JSON 合同输出 implementation/review。',
    'implementation.changed_files 必须列真实已存在路径;logic_chain.evidence 必须包含文件/命令/测试证据。',
  ].join('\n');
  const executorRes = await runRunnerOnceAsync(executor, executorPrompt, opts, ctx, node, attempt, runnerId + ':executor', runners);
  const executorStdout = executorRes.stdout || '';
  const executorStderr = executorRes.stderr || '';
  const draftStdout = plannerStdout.replace(/```json/gi, '```json-draft');
  return Object.assign({}, executorRes, {
    stdout: [
      '# text-model-draft runner=' + plannerId,
      draftStdout,
      '',
      '---',
      '# tool-executor-result runner=' + executorId,
      executorStdout,
    ].join('\n'),
    stderr: [plannerStderr, executorStderr].filter(Boolean).join('\n'),
  });
}

function resultFromRunnerResponse(res, { r, opts, node, attempt, runnerId, dir, timeoutSec }) {
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  fs.writeFileSync(path.join(dir, 'result.md'), stdout);
  if (stderr) fs.writeFileSync(path.join(dir, 'process.log'), stderr);
  if (r.kind === 'openai_http' || r.kind === 'anthropic_http' || r.kind === 'openai_http_tool_harness') {
    emitNodeOutput(opts, node, attempt, 'stdout', stdout);
    emitNodeOutput(opts, node, attempt, 'stderr', stderr);
  }

  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return { fail: timeoutFail(runnerId, timeoutSec, dir) };
    const why = res.error.message;
    return { fail: `spawn ${r.cmd && r.cmd[0] || runnerId} 失败: ${why}` };
  }
  if (res.status === 124) return { fail: timeoutFail(runnerId, timeoutSec, dir) };
  if (res.signal) return { fail: `${runnerId} 被信号中断 ${res.signal}(疑似超时/被杀;并发或资源不足时常见)` };
  if (res.status !== 0) {
    const detail = (stderr.trim() || stdout.trim().slice(-500) || '(runner 无任何输出,疑似并发/登录/配额)');
    return { fail: `${runnerId} 退出码 ${res.status}: ${detail.slice(0, 500)}` };
  }

  const structured = extractJson(stdout) || {};
  return {
    vars: structured,
    evidence: { type: 'result', runner: runnerId, path: path.join(dir, 'result.md') },
  };
}

function runOpenAiToolHarnessSync(r, prompt, opts, ctx, node, attempt, runnerId, runners) {
  const plannerId = r.modelRunner || r.plannerRunner || r.textRunner;
  const executorId = r.executorRunner || r.toolExecutorRunner || 'codex';
  const planner = plannerId && runners[plannerId];
  const executor = executorId && runners[executorId];
  if (!planner) return { status: 1, stdout: '', stderr: 'tool harness 缺少文本模型 runner: ' + (plannerId || '(未配置)') };
  if (!executor) return { status: 1, stdout: '', stderr: 'tool harness 缺少执行 runner: ' + (executorId || '(未配置)') };

  const plannerPrompt = [
    prompt,
    '',
    '# 文本模型规划阶段',
    '你是低成本文本模型。请先给出可执行方案和需要修改/验证的文件清单。',
    '注意:本阶段没有文件系统工具,不要声称已经落盘;最终落盘由工具执行 harness 完成。',
  ].join('\n');
  const plannerRes = runRunnerOnceSync(planner, plannerPrompt, opts, ctx, node, attempt, runnerId + ':planner', runners);
  const plannerStdout = plannerRes.stdout || '';
  const plannerStderr = plannerRes.stderr || '';
  if (plannerRes.error) return plannerRes;
  if (plannerRes.status !== 0 || plannerRes.signal) {
    return {
      status: plannerRes.status || 1,
      signal: plannerRes.signal,
      stdout: plannerStdout,
      stderr: plannerStderr || (runnerId + ' planner 阶段失败'),
      error: plannerRes.error,
    };
  }

  const executorPrompt = [
    prompt,
    '',
    '# 文本模型草案(只作意图参考,不是完成证明)',
    plannerStdout || '(文本模型无输出)',
    '',
    '# 工具执行阶段',
    '你是 ' + runnerId + ' 的真实工具执行 harness,底层执行 runner=' + executorId + '。',
    '必须在本地真实读写文件/运行必要命令;不能只给草案。',
    '如果需要改文件,请直接落盘;最后按原任务的 JSON 合同输出 implementation/review。',
    'implementation.changed_files 必须列真实已存在路径;logic_chain.evidence 必须包含文件/命令/测试证据。',
  ].join('\n');
  const executorRes = runRunnerOnceSync(executor, executorPrompt, opts, ctx, node, attempt, runnerId + ':executor', runners);
  const executorStdout = executorRes.stdout || '';
  const executorStderr = executorRes.stderr || '';
  const draftStdout = plannerStdout.replace(/```json/gi, '```json-draft');
  return Object.assign({}, executorRes, {
    stdout: [
      '# text-model-draft runner=' + plannerId,
      draftStdout,
      '',
      '---',
      '# tool-executor-result runner=' + executorId,
      executorStdout,
    ].join('\n'),
    stderr: [plannerStderr, executorStderr].filter(Boolean).join('\n'),
  });
}

// 额度熔断(拍板④ 2026-07-03):quota-degrade 状态机住在控制台项目里(与 ceo-worker 共用同一份状态文件)。
// shared 引擎对它做可选依赖:模块缺失/加载失败 → 熔断不可用,退回旧行为,绝不因此崩节点。
// 测试/外部编排可用 opts.quotaBreakerModule 注入等价实现。
function loadQuotaBreakerModule(opts) {
  if (opts && opts.quotaBreakerModule) return opts.quotaBreakerModule;
  try {
    const mod = require('../../projects/控制台/quota-degrade');
    return mod && typeof mod.claimBreakerProbe === 'function' && typeof mod.tripQuotaBreaker === 'function' ? mod : null;
  } catch (_) {
    return null;
  }
}

/* 造一个信封运行时 runner。
 * opts: { runners: {id:{cmd:[...],promptVia:'arg'}}, roleMap?, workdir, runsDir }
 */
function makeCliRunner(opts) {
  const runners = opts.runners;
  const roleMap = Object.assign({}, DEFAULT_ROLE_MAP, opts.roleMap || {});
  const roleExecMeta = opts.roleExecMeta || {};
  const runsDir = opts.runsDir;
  // failover:默认开;YUTU6_RUNNER_FAILOVER=0 或 opts.failover===false 时关(退回单 runner 旧行为)。
  const failoverEnabled = opts.failover !== false && process.env.YUTU6_RUNNER_FAILOVER !== '0';
  const rolePrefer = opts.rolePrefer || (failoverEnabled ? Failover.loadRolePrefer(opts.routingFile) : {});
  // 额度熔断:默认开;YUTU6_QUOTA_BREAKER=0 或 opts.quotaBreaker===false 退回旧行为(候选不过滤、失败不熔断)。
  // 状态根目录 = quotaStateRoot(显式)或 queueRoot(engine-runner 传的 artifacts 根);两者都没有 → 熔断不可用。
  const quotaBreakerEnabled = opts.quotaBreaker !== false && process.env.YUTU6_QUOTA_BREAKER !== '0';
  const quotaRoot = opts.quotaStateRoot || opts.queueRoot || null;
  const quotaBreaker = quotaBreakerEnabled && quotaRoot ? loadQuotaBreakerModule(opts) : null;
  // runner.call/runner.quality 增量观测事件:默认开(纯 emit,不改决策);YUTU6_RUNNER_EVENTS=0 关(防事件流膨胀)。
  const runnerEventsEnabled = process.env.YUTU6_RUNNER_EVENTS !== '0';
  // 健康加权路由(洞察#1):off=不算;shadow=算但不改路由、只 emit route.score 观测(默认,先观察);on=实际重排候选。
  const routeScoreMode = String(process.env.YUTU6_ROUTE_SCORE || 'shadow').toLowerCase();

  // 只读健康查询(喂 scoreCandidates):熔断/退避中→blocked;有 strike 未熔断→strikes>0。无副作用。
  function runnerHealth(candidateId) {
    if (!quotaBreaker) return null;
    try {
      const state = quotaBreaker.readState(quotaRoot, quotaBreaker.runnerScope(candidateId));
      if (!state) return null; // 无状态记录 = 健康
      const dec = quotaBreaker.breakerDecision(state);
      return { blocked: !!dec.blocked, strikes: (state.breaker && state.breaker.strikes) || 0 };
    } catch (_) { return null; }
  }

  function emitQuotaEvent(type, node, attempt, data) {
    if (!opts.eventlog) return;
    try {
      opts.eventlog.emit(type, Object.assign({
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        attempt,
        projectId: opts.projectId || null,
        queueId: opts.queueId || null,
      }, data || {}));
    } catch (_) {}
  }

  // 候选闸门:未熔断 → 放行;熔断期内且未到 retry_after → 跳过(只跳过,不重排);
  // retry_after 到点 → 占位放行一次小流量试探。熔断器自身读写异常 → 保守放行(不因熔断器故障拒跑任务)。
  function quotaGateFor(node, attempt, candidateId) {
    if (!quotaBreaker) return { allowed: true, probe: false };
    let gate;
    try {
      gate = quotaBreaker.claimBreakerProbe(quotaRoot, quotaBreaker.runnerScope(candidateId));
    } catch (_) {
      return { allowed: true, probe: false };
    }
    if (!gate.allowed) {
      emitQuotaEvent('quota.breaker.skip', node, attempt, {
        runner: candidateId,
        reason: gate.reason || 'breaker_open',
        retry_after: gate.retryAfter || null,
      });
    } else if (gate.probe) {
      emitQuotaEvent('quota.breaker.probe', node, attempt, { runner: candidateId, retry_after: gate.retryAfter || null });
    }
    return gate;
  }

  // 候选结果回写:试探成功 → restored(strikes 清零);试探失败或额度类失败 → 熔断/退避翻倍(1h→2h→4h,封顶 24h)。
  function noteQuotaOutcome(node, attempt, candidateId, gate, result) {
    if (!quotaBreaker) return;
    try {
      const scope = quotaBreaker.runnerScope(candidateId);
      if (!result.fail) {
        if (gate.probe) {
          quotaBreaker.resolveQuotaBreaker(quotaRoot, scope, { restoredBy: 'cli-runner-probe' });
          emitQuotaEvent('quota.breaker.restored', node, attempt, { runner: candidateId });
        }
        return;
      }
      const reason = Failover.classifyFailure(result.fail);
      if (gate.probe || reason === 'quota_exhausted') {
        const state = quotaBreaker.tripQuotaBreaker(quotaRoot, scope, {
          runnerType: candidateId,
          taskId: opts.taskId || null,
          queueId: opts.queueId || null,
          queueAgent: opts.queueAgent || null,
          reason: String(result.fail).slice(0, 500),
          confidence: reason === 'quota_exhausted' ? 'high' : 'probe_failed',
        });
        emitQuotaEvent('quota.breaker.tripped', node, attempt, {
          runner: candidateId,
          probe: !!gate.probe,
          strikes: state && state.breaker && state.breaker.strikes || null,
          retry_after: state && state.breaker && state.breaker.retry_after || null,
          reason,
        });
      }
    } catch (_) {}
  }

  // 硬性约束(不留裁量):候选池被全部熔断 → 一个 runner 都不试,发 quota.pool_exhausted 升级告警;
  // fail 文案带 quota_exhausted 标记,让 ceo-worker 的额度信号分类命中 → 任务回队列等待而不是判 failed。
  function poolExhaustedResult(node, attempt, candidates, skipped) {
    emitQuotaEvent('quota.pool_exhausted', node, attempt, {
      candidates,
      skipped,
      reason: 'all_candidates_quota_breaker_open',
    });
    return {
      fail: `quota_exhausted: 候选池全部熔断(quota circuit breaker), 任务留队列等待额度恢复; candidates=${candidates.join(',')}`,
    };
  }

  // dirTag:首选用规范目录 node-attempt;降级候选用 node-attempt-foN,保留各候选的 result.md 便于诊断。
  function resolveAndPrepare(node, ctx, attempt, overrideRunnerId, dirTag) {
    const resolved = resolveRunnerForNode(node, ctx, roleMap, runners, overrideRunnerId, roleExecMeta);
    if (resolved.fail) return { fail: resolved.fail };
    const runnerId = resolved.runnerId;
    const r = resolved.runner;
    if (resolved.upgraded && opts.eventlog) {
      try {
        opts.eventlog.emit('runner.tool_harness.upgrade', {
          task: opts.taskId || null,
          node: node && node.id || null,
          role: node && node.agent_role || null,
          from: resolved.requestedRunnerId,
          to: runnerId,
          reason: 'implement_requires_file_write',
          projectId: opts.projectId || null,
        });
      } catch (_) {}
    }

    const dir = path.join(runsDir, `${node.id}-${attempt}${dirTag || ''}`);
    fs.mkdirSync(dir, { recursive: true });
    // 交接机制:runsDir 根即 engine-runs/<taskId>/,handoff task.md/meta.json 寄生在这里;
    // 只影响 prompt 层(YUTU6_HANDOFF_MODE=on 且 CLI runner 时 goal 指针化),ctx 不动。
    const prompt = buildEnvelope(node, ctx, {
      runner: r,
      runnerId,
      runsDir,
      eventlog: opts.eventlog || null,
      taskId: opts.taskId || null,
      projectId: opts.projectId || null,
    });
    fs.writeFileSync(path.join(dir, 'task.md'), prompt);
    return { resolved, runnerId, r, dir, prompt };
  }

  // 候选 runnerId 序列:首选(roleMap,不变)+ prefer 降级候选;再按健康信号做稳定重排(受 routeScoreMode 门控)。
  function candidatesFor(node, attempt) {
    const role = node && node.agent_role;
    const primary = roleMap[role] || 'codex';
    if (!failoverEnabled) return [primary];
    const chain = Failover.failoverCandidates(role, { primaryRunnerId: primary, runners, rolePrefer });
    const base = chain.length ? chain : [primary];
    if (routeScoreMode === 'off' || base.length <= 1) return base;
    const reordered = Failover.scoreCandidates(base, { healthOf: runnerHealth });
    const changed = reordered.length === base.length && reordered.some((id, i) => id !== base[i]);
    if (changed && opts.eventlog) {
      try {
        opts.eventlog.emit('route.score', {
          task: opts.taskId || null, node: node && node.id || null, role, attempt,
          mode: routeScoreMode, original: base, reordered,
          applied: routeScoreMode === 'on', projectId: opts.projectId || null,
        });
      } catch (_) {}
    }
    return routeScoreMode === 'on' ? reordered : base; // shadow:算并观测,但不改实际路由
  }

  // runner.call:每次 runner 调用后 emit(role×runner 调用账本地基;洞察#2/#4/#6)。纯观测,不改决策。
  function emitRunnerCall(node, attempt, runnerId, candidateIndex, latencyMs, res, result) {
    if (!runnerEventsEnabled || !opts.eventlog) return;
    try {
      opts.eventlog.emit('runner.call', {
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        attempt,
        runner: runnerId,
        candidate_index: candidateIndex,
        failover: candidateIndex > 0,
        ok: !result.fail,
        fail: result.fail ? Failover.classifyFailure(result.fail) : null,
        status: res && typeof res.status === 'number' ? res.status : null,
        signal: (res && res.signal) || null,
        latency_ms: latencyMs,
        span: `${node && node.id}-${attempt}${candidateIndex > 0 ? '-fo' + candidateIndex : ''}`,
        trace_id: process.env.YUTU6_TRACE_ID || opts.taskId || null,
        projectId: opts.projectId || null,
        queueId: opts.queueId || null,
      });
    } catch (_) {}
  }

  function emitFailover(node, attempt, from, to, fail) {
    if (!opts.eventlog) return;
    try {
      opts.eventlog.emit('runner.failover', {
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        from,
        to,
        reason: Failover.classifyFailure(fail),
        detail: String(fail || '').slice(0, 300),
        attempt,
        projectId: opts.projectId || null,
      });
    } catch (_) {}
  }

  function cliRunner(node, ctx, attempt) {
    const candidates = candidatesFor(node, attempt);
    const timeoutSec = nodeTimeoutSec(opts);
    let lastFail = null;
    let executed = 0;
    let quotaSkipped = 0;
    for (let i = 0; i < candidates.length; i++) {
      const gate = quotaGateFor(node, attempt, candidates[i]);
      if (!gate.allowed) { quotaSkipped++; continue; }             // 熔断期内候选:只跳过,不重排
      const prepared = resolveAndPrepare(node, ctx, attempt, candidates[i], i === 0 ? '' : `-fo${i}`);
      if (prepared.fail) { lastFail = prepared.fail; continue; }   // 该候选不可用(如纯文本无 harness)→ 跳下一个
      const { runnerId, r, dir, prompt } = prepared;
      executed++;
      const t0 = Date.now();
      const res = runRunnerOnceSync(r, prompt, opts, ctx, node, attempt, runnerId, runners);
      const result = resultFromRunnerResponse(res, { r, opts, node, attempt, runnerId, dir, timeoutSec });
      emitRunnerCall(node, attempt, runnerId, i, Date.now() - t0, res, result);
      noteQuotaOutcome(node, attempt, candidates[i], gate, result);
      if (!result.fail) return result;
      lastFail = result.fail;
      if (i < candidates.length - 1) emitFailover(node, attempt, runnerId, candidates[i + 1], result.fail);
    }
    if (!executed && quotaSkipped > 0) return poolExhaustedResult(node, attempt, candidates, quotaSkipped);
    return { fail: lastFail || `所有候选 runner 均不可用: ${candidates.join(',')}` };
  }
  cliRunner.runNodeAsync = async function runNodeAsync(node, ctx, attempt) {
    const candidates = candidatesFor(node, attempt);
    const timeoutSec = nodeTimeoutSec(opts);
    let lastFail = null;
    let executed = 0;
    let quotaSkipped = 0;
    for (let i = 0; i < candidates.length; i++) {
      const gate = quotaGateFor(node, attempt, candidates[i]);
      if (!gate.allowed) { quotaSkipped++; continue; }
      const prepared = resolveAndPrepare(node, ctx, attempt, candidates[i], i === 0 ? '' : `-fo${i}`);
      if (prepared.fail) { lastFail = prepared.fail; continue; }
      const { runnerId, r, dir, prompt } = prepared;
      executed++;
      const t0 = Date.now();
      const res = await runRunnerOnceAsync(r, prompt, opts, ctx, node, attempt, runnerId, runners);
      const result = resultFromRunnerResponse(res, { r, opts, node, attempt, runnerId, dir, timeoutSec });
      emitRunnerCall(node, attempt, runnerId, i, Date.now() - t0, res, result);
      noteQuotaOutcome(node, attempt, candidates[i], gate, result);
      if (!result.fail) return result;
      lastFail = result.fail;
      if (i < candidates.length - 1) emitFailover(node, attempt, runnerId, candidates[i + 1], result.fail);
    }
    if (!executed && quotaSkipped > 0) return poolExhaustedResult(node, attempt, candidates, quotaSkipped);
    return { fail: lastFail || `所有候选 runner 均不可用: ${candidates.join(',')}` };
  };
  return cliRunner;
}

module.exports = { makeCliRunner, buildEnvelope, extractJson, fetchKbContext, fetchLessonContext, resolveRunnerForNode, nodeNeedsWritableRunner };
