#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(PROJECT_ROOT, '../..');
const ARTIFACTS_DIR = process.env.CONSOLE_ARTIFACTS_DIR || path.join(PROJECT_ROOT, 'artifacts');
const QUEUES_DIR = path.join(ARTIFACTS_DIR, 'queues');
const ENGINE_TASKS_DIR = path.join(ARTIFACTS_DIR, 'engine-tasks');
const STATUS_PATH = path.join(PROJECT_ROOT, 'status.md');
const REPORT_DATE = process.env.AUDIT_DATE || localDateStamp(new Date());
const REPORT_PATH = path.join(ARTIFACTS_DIR, `history-false-done-audit-${REPORT_DATE}.md`);
const JSON_PATH = path.join(ARTIFACTS_DIR, `history-false-done-audit-${REPORT_DATE}.json`);
const PROJECT_ID = '控制台';
const WINDOW_DAYS = 180;

const DELIVERY_NO_CHANGE_RE = /(不改任何文件|无需改文件|不用改文件|不要改任何文件|只读|调研|复盘|报告|评估|清单|说明|确认|冒烟|验证|审查)/i;
const DELIVERY_ACTION_RE = /(修复|修改|改造|实现|新增|接入|落地|合入|调整|重做|重构|代码|源码|文件|页面|布局|前端|UI|HTML|CSS|JS|workspace|server\.js|ceo-worker|shared\/engine|截图|Peekaboo|meowa|生成|素材)/i;
const NEGATIVE_DELIVERY_RESULT_RE = /(不在.*职责|不属于.*范围|退回|改派|无法写盘|不能写盘|patch\s*草案|方案草案|未实际落盘|没有实际落盘|未改 UI|未改文件|没有改文件|没有最终结构化|输出不完整|仍需.*落地|请.*落地)/i;
const KNOWN_CONFIRMED_FALSE_DONE = new Set(['baa22827', 'ffeca834', '96dfd0cb']);

function localDateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isoForReportDate(stamp) {
  const y = stamp.slice(0, 4);
  const m = stamp.slice(4, 6);
  const d = stamp.slice(6, 8);
  return `${y}-${m}-${d}T00:00:00+08:00`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (_) { return ''; }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function listJsonFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => path.join(dir, name));
  } catch (_) {
    return [];
  }
}

function payloadFrom(entry) {
  if (entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)) return entry.task;
  return { goal: String(entry && entry.task || '') };
}

function entryText(entry) {
  const payload = payloadFrom(entry || {});
  const steer = Array.isArray(entry && entry.steer)
    ? entry.steer.map(item => item && item.msg).filter(Boolean).join('\n')
    : '';
  return [
    payload.goal,
    payload.acceptance,
    payload.bounds,
    payload.title,
    steer,
  ].filter(Boolean).join('\n');
}

function queueMetaFromPath(file) {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf('queues');
  if (idx < 0) return null;
  const agent = parts[idx + 1];
  const maybeState = parts[idx + 2];
  const states = new Set(['running', 'paused', 'done', 'failed', 'canceled']);
  const state = states.has(maybeState) ? maybeState : 'queued';
  return { agent, state };
}

function collectEntries() {
  const out = [];
  let agents = [];
  try { agents = fs.readdirSync(QUEUES_DIR).filter(name => !name.startsWith('.')); } catch (_) {}
  for (const agent of agents) {
    const dir = path.join(QUEUES_DIR, agent);
    for (const file of listJsonFiles(dir)) {
      const entry = readJson(file);
      if (entry && entry.id) out.push(entryRef(file, agent, 'queued', entry));
    }
    for (const state of ['running', 'paused', 'done', 'failed', 'canceled']) {
      const stateDir = path.join(dir, state);
      for (const file of listJsonFiles(stateDir)) {
        const entry = readJson(file);
        if (entry && entry.id) out.push(entryRef(file, agent, state, entry));
      }
    }
  }
  return out;
}

function entryRef(file, agent, state, entry) {
  const payload = payloadFrom(entry);
  return {
    agent,
    state: entry.status || state,
    file,
    id: String(entry.id),
    entry,
    payload,
    projectId: entry.projectId || payload.projectId || null,
    flowId: entry.flowId || payload.flowId || null,
    taskId: entry.taskId || payload.taskId || null,
    rootQueueAgent: entry.rootQueueAgent || payload.rootQueueAgent || null,
    rootQueueId: entry.rootQueueId || payload.rootQueueId || null,
    rootTaskId: entry.rootTaskId || payload.rootTaskId || null,
    time: entry.finished_at || entry.updated_at || entry.enqueued_at || entry.started_at || null,
    text: entryText(entry),
  };
}

function isControlScope(ref) {
  const hay = `${ref.projectId || ''}\n${ref.agent || ''}\n${ref.text || ''}`;
  const projectAgent = `${ref.projectId || ''}\n${ref.agent || ''}`;
  if (/Simulaid|模拟纪元/i.test(projectAgent)) return false;
  if (ref.projectId === PROJECT_ID) return true;
  if (ref.agent === `supervisor-${PROJECT_ID}`) return true;
  return /(控制台|workspace|工作区|CEO|ceo|queue|队列|new-api|办公室)/i.test(hay);
}

function inWindow(ref, sinceMs) {
  if (!ref.time) return true;
  const ms = Date.parse(ref.time);
  return Number.isNaN(ms) || ms >= sinceMs;
}

function extractManualMergeBlocks(text) {
  const s = String(text || '');
  const re = /(?:^|\n)\s*[—-]{3,}\s*\(合并:([^)]+)\)\s*[—-]{3,}\s*/g;
  const headers = [];
  let m;
  while ((m = re.exec(s))) {
    headers.push({ id: String(m[1] || '').trim(), start: m.index, bodyStart: re.lastIndex });
  }
  return headers.map((header, i) => {
    const next = headers[i + 1];
    return {
      id: header.id,
      text: s.slice(header.bodyStart, next ? next.start : s.length).trim(),
    };
  }).filter(block => block.id || block.text);
}

function appendMergedSummaries(value, out) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = [item.summary, item.goal, item.acceptance, item.bounds].filter(Boolean).join('\n');
    if (text.trim()) out.push(text);
  }
}

function mergedRequirementTexts(ref, task) {
  const vars = task && task.vars || {};
  const texts = [
    ref.payload.goal,
    ref.payload.acceptance,
    vars.goal,
    vars.acceptance,
  ].filter(Boolean);
  const out = [];
  for (const text of texts) {
    for (const block of extractManualMergeBlocks(text)) {
      if (block.text) out.push(block.text);
    }
  }
  appendMergedSummaries(ref.payload.queueOrganizeMergedFrom, out);
  appendMergedSummaries(ref.payload.queue_organize && ref.payload.queue_organize.merged_from, out);
  appendMergedSummaries(ref.entry.queue_organize && ref.entry.queue_organize.merged_from, out);
  return out;
}

function taskRecord(taskId) {
  if (!taskId) return null;
  return readJson(path.join(ENGINE_TASKS_DIR, `${taskId}.json`));
}

function latestResultText(taskId) {
  if (!taskId) return '';
  const dir = path.join(ARTIFACTS_DIR, 'engine-runs', String(taskId));
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return ''; }
  const candidates = names
    .filter(name => /^(execute|implement|review)-\d+$/.test(name))
    .sort((a, b) => {
      const an = Number(a.split('-').pop()) || 0;
      const bn = Number(b.split('-').pop()) || 0;
      return bn - an;
    });
  for (const name of candidates) {
    const text = readText(path.join(dir, name, 'result.md'));
    if (text) return text;
  }
  return '';
}

function deliveryEvidenceRequired(ref, task) {
  const vars = task && task.vars || {};
  const text = [
    ref.payload.goal,
    ref.payload.acceptance,
    vars.goal,
    vars.acceptance,
  ].filter(Boolean).join('\n');
  if (mergedRequirementTexts(ref, task).some(item => DELIVERY_ACTION_RE.test(item))) return true;
  if (DELIVERY_NO_CHANGE_RE.test(text)) return false;
  return DELIVERY_ACTION_RE.test(text);
}

function collectText(value, out = [], depth = 0) {
  if (depth > 5 || value == null || out.length > 100) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectText(item, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach(item => collectText(item, out, depth + 1));
  return out;
}

function taskEvidence(task) {
  const vars = task && task.vars || {};
  const implementation = vars.implementation || {};
  const review = vars.review || {};
  const changedFiles = Array.isArray(implementation.changed_files) ? implementation.changed_files : [];
  const strings = collectText([implementation, task && task.evidence, task && task.steps]);
  const artifactEvidence = strings.filter(s => /\.(png|jpe?g|webp|gif|pdf|patch|diff)\b/i.test(s)
    || /截图|screenshot|peekaboo|changed_files|git diff|文件已修改|已落盘/i.test(s));
  return {
    changedFiles,
    artifactEvidence,
    implementationDone: implementation.done === true,
    reviewPass: review.pass === true,
    hasEvidence: changedFiles.length > 0 || artifactEvidence.length > 0,
  };
}

function findRef(entries, agent, id) {
  return entries.find(ref => ref.agent === agent && ref.id === id) || null;
}

function downstreamForRoot(entries, root) {
  const ds = root.entry.downstream || {};
  if (ds.downstreamQueueAgent && ds.downstreamQueueId) {
    const ref = findRef(entries, ds.downstreamQueueAgent, ds.downstreamQueueId);
    if (ref) return ref;
  }
  return entries.find(ref => ref.agent !== root.agent
    && ref.rootQueueAgent === root.agent
    && ref.rootQueueId === root.id) || null;
}

function rootFalseDoneVerdict(entries, ref) {
  if (ref.agent !== 'ceo' || ref.state !== 'done' || ref.flowId !== 'project-route') return null;
  const rootTask = taskRecord(ref.taskId);
  const required = deliveryEvidenceRequired(ref, rootTask);
  const child = downstreamForRoot(entries, ref);
  if (!required) return null;
  if (!child) return {
    category: 'candidate',
    severity: 'medium',
    reason: 'delivery-like root done has no downstream entry to validate',
    downstream: null,
  };
  const childTask = taskRecord(child.taskId);
  const evidence = taskEvidence(childTask);
  if (!/^supervisor-/.test(child.agent || '') || child.flowId !== 'review-loop') {
    const childResult = latestResultText(child.taskId);
    const confirmed = KNOWN_CONFIRMED_FALSE_DONE.has(ref.id) || NEGATIVE_DELIVERY_RESULT_RE.test(childResult);
    return {
      category: confirmed ? 'confirmed' : 'candidate',
      severity: confirmed ? 'high' : 'medium',
      reason: `root done depended on ${child.agent}/${child.id} flow=${child.flowId || 'unknown'}, not supervisor review-loop`,
      downstream: `${child.agent}/${child.id}`,
    };
  }
  if (!childTask || childTask.flow !== 'review-loop' || childTask.state !== 'done') {
    const confirmed = KNOWN_CONFIRMED_FALSE_DONE.has(ref.id);
    return {
      category: confirmed ? 'confirmed' : 'candidate',
      severity: confirmed ? 'high' : 'medium',
      reason: `supervisor child lacks completed review-loop taskstore (${child.taskId || 'missing'})`,
      downstream: `${child.agent}/${child.id}`,
    };
  }
  if (!evidence.implementationDone || !evidence.reviewPass) {
    const confirmed = KNOWN_CONFIRMED_FALSE_DONE.has(ref.id);
    return {
      category: confirmed ? 'confirmed' : 'candidate',
      severity: confirmed ? 'high' : 'medium',
      reason: 'supervisor child did not have implementation.done=true and review.pass=true',
      downstream: `${child.agent}/${child.id}`,
    };
  }
  if (!evidence.hasEvidence) {
    const confirmed = KNOWN_CONFIRMED_FALSE_DONE.has(ref.id);
    return {
      category: confirmed ? 'confirmed' : 'candidate',
      severity: confirmed ? 'high' : 'medium',
      reason: 'supervisor review-loop done lacks changed_files/screenshot/diff evidence',
      downstream: `${child.agent}/${child.id}`,
    };
  }
  return null;
}

function short(s, max = 92) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rel(file) {
  return path.relative(WORKDIR, file);
}

function knownRemediation(id) {
  if (id === '623617bb') {
    return '已由后续 ceo/7ca7ef22 系列返工闭合: 进行中任务完整渲染、滚轮、选中、折叠均有 Peekaboo 证据;无需重复落单,只保留为历史假完成样本。';
  }
  if (id === 'baa22827') {
    return '已由 ceo/6472925b + supervisor-控制台/ede415e6 补做“青年总裁坐姿基准图、总裁办公室重做、办公室·实验版”; 原 3b96e471 的全员办公室铺开、员工朝向、桌子方向、完整互动动画仍需单独验收/补做。';
  }
  if (id === 'bcb165b4') {
    return '路由边界后续已部分闭合(直派被 supervisor review-loop 门禁压回);但 workspace 显示名仍有“程序员”残留,需落单复核 worker_code 是否应显示为“后端程序员”。';
  }
  if (id === 'd6e748c5') {
    return '当前 workspace.html 已有运行时长 chip 与 tests/workspace-taskboard.test.js 覆盖“刚开始/分钟粒度/运行中兜底”;需补一条证据复核,不建议重复开发。';
  }
  if (id === 'ffeca834') {
    return '需新落单复核/补做办公室上下布局、紧凑显示、垂直滚动; 先与当前 workspace.html 办公室改动做冲突分析。';
  }
  if (id === '96dfd0cb') {
    return '需新落单复核/补做默认办公室、部门自适应宽、每行 5 个、董事会第二行; 当前 CSS 仍需逐项截图证明。';
  }
  return '列为审计候选: 需主管按原验收逐项打开产物/结果复核后决定是否补做。';
}

function queueEnvelopeRows() {
  return [
    {
      name: '补做 baa22827 / 3b96e471 残余视觉项',
      rootQueueAgent: 'ceo',
      projectId: PROJECT_ID,
      merged_from: ['3b96e471', 'f401c851', 'baa22827'],
      goal: '复核并补齐办公室视觉重做残余项: 全员办公室铺开、桌子方向统一、员工背对屏幕且电脑屏幕朝老板可见、董事长与秘书完整三段交互动画; 已由 6472925b 完成的坐姿基准图/实验版不得重复生成。',
      acceptance: '依赖/冲突分析先确认 6472925b 产物; 每个 merged_from 子项逐项列验收证据; 需要视觉项必须有 Peekaboo 截图或素材路径。',
    },
    {
      name: '补做/复核 ffeca834 办公室紧凑滚动布局',
      rootQueueAgent: 'ceo',
      projectId: PROJECT_ID,
      merged_from: ['ffeca834', 'baa22827:steer:2026-06-21T18:06:44.550Z'],
      goal: '复核并补做办公室上下布局、全部 agent 不出框、空间不足可垂直滚动、整体紧凑。',
      acceptance: '先比较当前 workspace.html 与既有办公室实验页; 如已满足则给 Peekaboo 逐项证据,否则由主管 review-loop 落地 changed_files。',
    },
    {
      name: '补做/复核 96dfd0cb 默认办公室与董事会位置',
      rootQueueAgent: 'ceo',
      projectId: PROJECT_ID,
      merged_from: ['96dfd0cb'],
      goal: '复核并补做默认视图为办公室、部门人数多自适应变宽、每行 5 个 agent、董事会位于第二行。',
      acceptance: '逐项截图/DOM 证据; 若需改 workspace.html, changed_files 必须含该文件并经 review-loop pass。',
    },
    {
      name: '复核 bcb165b4 前后端边界与后端程序员显示名',
      rootQueueAgent: 'ceo',
      projectId: PROJECT_ID,
      merged_from: ['bcb165b4'],
      goal: '复核 UI 任务路由不再直派 agent-once,并清理 workspace/办公室/任务板里 worker_code 显示名“程序员”的残留,需要时改为“后端程序员”。',
      acceptance: '先确认 direct_suppressed/project-route 门禁测试仍通过; 再 grep workspace.html 的显示名残留,如需改动必须 changed_files + review-loop pass。',
    },
  ];
}

function markdownTable(rows, cols) {
  if (!rows.length) return '_无_';
  const header = `| ${cols.map(c => c.label).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${cols.map(c => String(row[c.key] == null ? '' : row[c.key]).replace(/\n/g, '<br>')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function main() {
  const reportBase = new Date(isoForReportDate(REPORT_DATE));
  const sinceMs = reportBase.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const entries = collectEntries()
    .filter(isControlScope)
    .filter(ref => inWindow(ref, sinceMs));
  const done = entries.filter(ref => ref.state === 'done');
  const mergeHeaderEntries = entries
    .map(ref => ({ ref, blocks: extractManualMergeBlocks(ref.text) }))
    .filter(item => item.blocks.length);
  const doneMergeHeaderEntries = mergeHeaderEntries.filter(item => item.ref.state === 'done');
  const rootVerdicts = done
    .map(ref => ({ ref, verdict: rootFalseDoneVerdict(entries, ref) }))
    .filter(item => item.verdict);
  const falseDone = rootVerdicts.filter(item => item.verdict.category === 'confirmed');
  const structuralCandidates = rootVerdicts.filter(item => item.verdict.category !== 'confirmed');
  const deliveryDoneWithoutEvidence = done
    .map(ref => {
      const task = taskRecord(ref.taskId);
      return { ref, task, required: deliveryEvidenceRequired(ref, task), evidence: taskEvidence(task) };
    })
    .filter(item => item.required && !item.evidence.hasEvidence)
    .slice(0, 40);
  const activeRelevant = entries
    .filter(ref => ['queued', 'running', 'paused'].includes(ref.state))
    .filter(ref => /(假完成|漏做|办公室|合并|视觉|实验版|任务历史)/.test(ref.text))
    .map(ref => `${ref.agent}/${ref.id}(${ref.state}) ${short(ref.text, 80)}`);

  const ceoWorkerSource = readText(path.join(PROJECT_ROOT, 'ceo-worker.js'));
  const ceoTestSource = readText(path.join(WORKDIR, 'tests', 'ceo-serial-lock.test.js'));
  const mergeGuardPresent = /extractManualMergeBlocks/.test(ceoWorkerSource) && /rootMergeInjected/.test(ceoTestSource);
  const routeDoneGuardPresent = /validateSupervisorReviewDone/.test(ceoWorkerSource)
    && /rootDirectFake/.test(ceoTestSource)
    && /rootNoEvidence/.test(ceoTestSource)
    && /rootReviewFalse/.test(ceoTestSource);

  const falseRows = falseDone.map(item => ({
    id: `${item.ref.agent}/${item.ref.id}`,
    task: item.ref.taskId || '',
    reason: item.verdict.reason,
    downstream: item.verdict.downstream || '',
    evidence: rel(item.ref.file),
    remediation: knownRemediation(item.ref.id),
  }));
  const candidateRows = structuralCandidates.slice(0, 24).map(item => ({
    id: `${item.ref.agent}/${item.ref.id}`,
    task: item.ref.taskId || '',
    reason: item.verdict.reason,
    downstream: item.verdict.downstream || '',
    evidence: rel(item.ref.file),
    next: '结构性风险候选: 抽查 result.md / taskstore / 产物后再判定是否漏做',
  }));

  const mergeRows = doneMergeHeaderEntries.map(item => ({
    id: `${item.ref.agent}/${item.ref.id}`,
    merged_from: item.blocks.map(block => block.id).join(', '),
    queue_organize: item.ref.entry.queue_organize ? 'yes' : 'no',
    status: item.ref.state,
    note: item.ref.id === 'baa22827' ? 'confirmed historical false done' : 'requires spot-check only if no review/evidence',
  }));

  const envelopeRows = queueEnvelopeRows().map(item => ({
    name: item.name,
    rootQueueAgent: item.rootQueueAgent,
    projectId: item.projectId,
    merged_from: item.merged_from.join(', '),
    goal: short(item.goal, 140),
    acceptance: short(item.acceptance, 140),
  }));

  const summary = {
    generated_at: new Date().toISOString(),
    projectId: PROJECT_ID,
    window_days: WINDOW_DAYS,
    entries_scanned: entries.length,
    done_scanned: done.length,
    merge_header_entries: mergeHeaderEntries.length,
    done_merge_header_entries: doneMergeHeaderEntries.length,
    confirmed_false_done: falseDone.length,
    structural_risk_candidates: structuralCandidates.length,
    delivery_done_without_evidence_candidates: deliveryDoneWithoutEvidence.length,
    merge_guard_present: mergeGuardPresent,
    route_done_guard_present: routeDoneGuardPresent,
    report: REPORT_PATH,
    json: JSON_PATH,
  };

  const report = [
    '# 控制台历史任务漏做/假完成审计',
    '',
    `- 生成时间:${summary.generated_at}`,
    `- 审计范围:${PROJECT_ID} 项目 artifacts/queues + engine-tasks,近 ${WINDOW_DAYS} 天`,
    `- 入口:${rel(QUEUES_DIR)}`,
    '',
    '## 汇总',
    '',
    `- 扫描队列项:${summary.entries_scanned}`,
    `- 扫描 done 项:${summary.done_scanned}`,
    `- goal 含 \`———(合并:...)\` 的队列项:${summary.merge_header_entries};其中 done:${summary.done_merge_header_entries}`,
    `- 确认假完成/漏做根任务:${summary.confirmed_false_done}`,
    `- 结构性风险候选:${summary.structural_risk_candidates}`,
    `- 交付型 done 但缺 changed_files/截图/diff 的候选:${summary.delivery_done_without_evidence_candidates}`,
    '',
    '## 漏做/假完成清单',
    '',
    markdownTable(falseRows, [
      { key: 'id', label: '任务' },
      { key: 'task', label: 'engine task' },
      { key: 'reason', label: '断点' },
      { key: 'downstream', label: '下游' },
      { key: 'evidence', label: '证据文件' },
      { key: 'remediation', label: '补做去向' },
    ]),
    '',
    '## 结构性风险候选',
    '',
    '以下任务暴露旧链路缺 downstream 元数据、缺 taskstore 或绕过主管 review-loop,但本脚本不把它们直接等同为漏做;需质量运营/监管抽查结果与产物后再定性。',
    '',
    markdownTable(candidateRows, [
      { key: 'id', label: '任务' },
      { key: 'task', label: 'engine task' },
      { key: 'reason', label: '风险信号' },
      { key: 'downstream', label: '下游' },
      { key: 'evidence', label: '证据文件' },
      { key: 'next', label: '下一步' },
    ]),
    '',
    '## 合并路径覆盖',
    '',
    markdownTable(mergeRows, [
      { key: 'id', label: 'done/合并任务' },
      { key: 'merged_from', label: 'merged_from' },
      { key: 'queue_organize', label: 'queue_organize 元数据' },
      { key: 'status', label: '状态' },
      { key: 'note', label: '审计口径' },
    ]),
    '',
    '## 根因终判',
    '',
    `- 合并致漏: ${mergeGuardPresent ? '部分铲除' : '未铲除'}。本轮代码门已识别非 queue-organizer 的文本注入式合并块,合并块内只要出现实现/页面/截图/素材等交付型内容,即使外层是报告/审查也必须有 changed_files/截图/diff 证据。历史手工合并任务仍需按本报告逐项补做,所以不把历史语义债务说成自动清零。`,
    `- 路由退回后状态机误判 done: ${routeDoneGuardPresent ? '已铲除到可回归测试覆盖的新路径' : '未铲除'}。CEO 根任务 done 现在必须来自 supervisor review-loop,且 implementation.done=true、review.pass=true、交付型任务有 changed_files/截图/diff;直派 agent-once、无证据、review.pass=false 三类伪 done 均有测试 fixture。`,
    `- 回归风险: ${mergeGuardPresent && routeDoneGuardPresent ? '低到中' : '高'}。低在于最小复现已有自动测试;中在于“每个合并子需求的语义逐项完成”仍需要主管/监管对照验收表,不是正则能完全证明。`,
    '',
    '## 护栏有效性验证记录',
    '',
    '- 新增最小复现:`tests/ceo-serial-lock.test.js` 的 `rootMergeInjected`。构造“外层质量审查报告 + goal 注入 `———(合并:merged-ui-fix)———` + 合并块要求修 workspace/新增页面/Peekaboo 截图”,下游 review-loop done 但 changed_files 为空时必须被 `waitForProjectRouteDownstream()` 判 failed。',
    '- 既有回归:`rootDirectFake` 拦 direct agent-once done;`rootNoEvidence` 拦交付型任务无证据;`rootReviewFalse` 拦 review.pass=false。',
    '- 本脚本扩展扫描:goal 合并头正则 + queue_organize/queueOrganizeMergedFrom 摘要 + done 但交付证据缺失候选。',
    '',
    '## 补做安排',
    '',
    '不在本脚本中自动入队,避免与当前 running 主管任务或已补做任务冲突。下列信封应由 CEO/主管按当前队列状态落单,且验收门必须挂 `merged_from` 清单。',
    '',
    markdownTable(envelopeRows, [
      { key: 'name', label: '建议任务' },
      { key: 'rootQueueAgent', label: 'rootQueueAgent' },
      { key: 'projectId', label: 'projectId' },
      { key: 'merged_from', label: 'merged_from' },
      { key: 'goal', label: '目标' },
      { key: 'acceptance', label: '验收' },
    ]),
    '',
    '## 依赖与冲突分析',
    '',
    '- `baa22827` 的坐姿基准图、总裁办公室背景、办公室·实验版已由 `ceo/6472925b` + `supervisor-控制台/ede415e6` 补做并在 status 中复审 PASS;补做残余时不得重复消耗 Meowa。',
    '- `ffeca834`/`96dfd0cb` 都改 `public/workspace.html`,必须与当前办公室视图改动、进行中任务区交互改动串行或走资源域锁,避免覆盖。',
    `- 当前相关 active 项:${activeRelevant.length ? activeRelevant.join('; ') : '无'}`,
    '- 若落单前发现同目标 queued/running,先合并验收清单,不要重复创建执行任务。',
    '',
  ].join('\n');

  const json = {
    summary,
    false_done: falseDone.map(item => ({
      agent: item.ref.agent,
      id: item.ref.id,
      taskId: item.ref.taskId,
      reason: item.verdict.reason,
      downstream: item.verdict.downstream,
      file: rel(item.ref.file),
      remediation: knownRemediation(item.ref.id),
    })),
    structural_candidates: structuralCandidates.map(item => ({
      agent: item.ref.agent,
      id: item.ref.id,
      taskId: item.ref.taskId,
      reason: item.verdict.reason,
      downstream: item.verdict.downstream,
      file: rel(item.ref.file),
    })),
    done_merge_headers: doneMergeHeaderEntries.map(item => ({
      agent: item.ref.agent,
      id: item.ref.id,
      merged_from: item.blocks.map(block => block.id),
      queue_organize: !!item.ref.entry.queue_organize,
      file: rel(item.ref.file),
    })),
    delivery_without_evidence_candidates: deliveryDoneWithoutEvidence.map(item => ({
      agent: item.ref.agent,
      id: item.ref.id,
      taskId: item.ref.taskId,
      file: rel(item.ref.file),
      goal: short(item.ref.text, 180),
    })),
    remediation_envelopes: queueEnvelopeRows(),
    active_relevant: activeRelevant,
    guards: {
      mergeGuardPresent,
      routeDoneGuardPresent,
    },
  };

  writeText(REPORT_PATH, report);
  writeText(JSON_PATH, `${JSON.stringify(json, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
