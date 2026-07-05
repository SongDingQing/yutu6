#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(PROJECT_ROOT, '../..');
const ARTIFACTS_DIR = process.env.CONSOLE_ARTIFACTS_DIR || path.join(PROJECT_ROOT, 'artifacts');
const QUEUES_DIR = path.join(ARTIFACTS_DIR, 'queues');
const ENGINE_TASKS_DIR = path.join(ARTIFACTS_DIR, 'engine-tasks');
const DoneGate = require('../../../shared/engine/done-gate');

const args = new Set(process.argv.slice(2));
const DATE = valueArg('--date') || '2026-06-22';
const APPLY = args.has('--apply');
const TZ = 'Asia/Shanghai';

function valueArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function localDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function queueAgents() {
  try { return fs.readdirSync(QUEUES_DIR).filter(name => !name.startsWith('.')); } catch (_) { return []; }
}

function doneRefsForDate(date) {
  const out = [];
  for (const agent of queueAgents()) {
    const dir = path.join(QUEUES_DIR, agent, 'done');
    let files = [];
    try { files = fs.readdirSync(dir).filter(name => name.endsWith('.json')); } catch (_) {}
    for (const file of files) {
      const full = path.join(dir, file);
      const entry = readJson(full);
      if (!entry || !entry.id) continue;
      const stat = fs.statSync(full);
      const stamp = localDate(entry.finished_at || entry.updated_at || entry.enqueued_at || stat.mtime);
      if (stamp !== date) continue;
      out.push({ agent, id: entry.id, file: full, entry });
    }
  }
  return out.sort((a, b) => `${a.agent}/${a.id}`.localeCompare(`${b.agent}/${b.id}`));
}

function payloadFrom(entry) {
  if (entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)) return entry.task;
  return {};
}

function taskIdOf(ref) {
  const payload = payloadFrom(ref.entry);
  return ref.entry.taskId || payload.taskId || null;
}

function flowIdOf(ref) {
  const payload = payloadFrom(ref.entry);
  return ref.entry.flowId || payload.flowId || null;
}

function taskRecord(taskId) {
  if (!taskId) return null;
  return readJson(path.join(ENGINE_TASKS_DIR, `${taskId}.json`));
}

function taskText(ref, task) {
  const payload = payloadFrom(ref.entry);
  const vars = task && task.vars || {};
  return [
    payload.goal,
    payload.acceptance,
    payload.bounds,
    vars.goal,
    vars.acceptance,
  ].filter(Boolean).join('\n');
}

function deliveryRequired(ref, task) {
  return DoneGate.deliveryEvidenceRequiredFromText(taskText(ref, task));
}

function downstreamRefFor(root, refsByKey) {
  const ds = root.entry && root.entry.downstream || {};
  if (ds.downstreamQueueAgent && ds.downstreamQueueId) {
    return refsByKey.get(`${ds.downstreamQueueAgent}/${ds.downstreamQueueId}`) || null;
  }
  const rootAgent = root.entry.rootQueueAgent || root.agent;
  const rootId = root.entry.rootQueueId || root.id;
  for (const ref of refsByKey.values()) {
    if (ref.agent === root.agent && ref.id === root.id) continue;
    if (ref.entry.rootQueueAgent === rootAgent && ref.entry.rootQueueId === rootId) return ref;
  }
  return null;
}

function isLegacyFormatOnly(reason) {
  return /缺少逻辑链|缺少 hard verification|缺少核实了哪些|缺少核实证据|verification verdict/.test(String(reason || ''));
}

function classifyReviewLoop(ref, task) {
  if (!task) return { status: 'needs_revalidation', reason: '缺少 engine-tasks 记录' };
  if (task.flow !== 'review-loop') return { status: 'false_done', reason: `task.flow=${task.flow || 'unknown'} 不是 review-loop` };
  if (task.state !== 'done') return { status: 'false_done', reason: `task.state=${task.state || 'unknown'} 不是 done` };
  const gate = DoneGate.validateReviewLoopCompletion(task, {
    workspaceRoot: WORKDIR,
    requireDeliveryEvidence: deliveryRequired(ref, task),
  });
  if (gate.ok) return { status: 'true_done', reason: 'done gate 通过' };
  const vars = task.vars || {};
  const implementation = vars.implementation || {};
  const review = vars.review || {};
  if (implementation.done !== true || review.pass !== true) {
    return { status: 'false_done', reason: gate.reason };
  }
  if (/声明文件不存在|交付型任务缺少|changed_files 涉及排除范围/.test(gate.reason)) {
    return { status: 'false_done', reason: gate.reason };
  }
  if (isLegacyFormatOnly(gate.reason)) {
    return { status: 'needs_revalidation', reason: gate.reason };
  }
  return { status: 'false_done', reason: gate.reason };
}

function classify(ref, refsByKey, seen = new Set()) {
  const key = `${ref.agent}/${ref.id}`;
  if (seen.has(key)) return { status: 'needs_revalidation', reason: 'downstream cycle detected' };
  seen.add(key);
  const taskId = taskIdOf(ref);
  const task = taskRecord(taskId);
  const flowId = flowIdOf(ref);
  if (/^supervisor-/.test(ref.agent) || flowId === 'review-loop') {
    return classifyReviewLoop(ref, task);
  }
  if (flowId === 'project-route' || ref.agent === 'ceo') {
    const child = downstreamRefFor(ref, refsByKey);
    if (!child) return { status: 'needs_revalidation', reason: 'root done 缺少可定位下游主管任务' };
    const childVerdict = classify(child, refsByKey, seen);
    if (childVerdict.status === 'false_done') {
      return {
        status: 'false_done',
        reason: `下游 ${child.agent}/${child.id} 未通过: ${childVerdict.reason}`,
        downstream: `${child.agent}/${child.id}`,
      };
    }
    if (childVerdict.status === 'true_done') return { status: 'true_done', reason: `下游 ${child.agent}/${child.id} 通过` };
    return {
      status: 'needs_revalidation',
      reason: `下游 ${child.agent}/${child.id} 需复验: ${childVerdict.reason}`,
      downstream: `${child.agent}/${child.id}`,
    };
  }
  return { status: 'needs_revalidation', reason: `非主管/非 project-route done: ${ref.agent}/${ref.id}` };
}

function moveFalseDone(ref, verdict, now) {
  const failedDir = path.join(QUEUES_DIR, ref.agent, 'failed');
  fs.mkdirSync(failedDir, { recursive: true });
  const dst = path.join(failedDir, `${ref.id}.json`);
  if (fs.existsSync(dst)) {
    return { moved: false, reason: `failed 里已存在 ${ref.agent}/${ref.id}` };
  }
  const updated = Object.assign({}, ref.entry, {
    status: 'failed',
    previous_status: 'done',
    done_gate_rejected: true,
    done_gate_rejected_at: now,
    rework_required: true,
    error: verdict.reason,
    reason: verdict.reason,
  });
  writeJson(dst, updated);
  fs.unlinkSync(ref.file);
  return { moved: true, reason: null };
}

function writeReport(results, moves, now) {
  const summary = {
    date: DATE,
    applied: APPLY,
    generated_at: now,
    total_done_checked: results.length,
    true_done: results.filter(r => r.verdict.status === 'true_done').length,
    false_done: results.filter(r => r.verdict.status === 'false_done').length,
    needs_revalidation: results.filter(r => r.verdict.status === 'needs_revalidation').length,
    moved_to_failed: moves.filter(m => m.moved).length,
    move_skipped: moves.filter(m => !m.moved).length,
  };
  const jsonPath = path.join(ARTIFACTS_DIR, `done-gate-audit-${DATE}.json`);
  const mdPath = path.join(ARTIFACTS_DIR, `done-gate-audit-${DATE}.md`);
  writeJson(jsonPath, { summary, results, moves });
  const lines = [
    `# Done Gate Audit ${DATE}`,
    '',
    `- generated_at: ${now}`,
    `- applied: ${APPLY}`,
    `- total_done_checked: ${summary.total_done_checked}`,
    `- true_done: ${summary.true_done}`,
    `- false_done: ${summary.false_done}`,
    `- needs_revalidation: ${summary.needs_revalidation}`,
    `- moved_to_failed: ${summary.moved_to_failed}`,
    '',
    '## 打回待重做清单',
    '',
    '| agent | id | reason | downstream | moved |',
    '|---|---|---|---|---|',
    ...results
      .filter(r => r.verdict.status === 'false_done')
      .map(r => {
        const move = moves.find(m => m.agent === r.agent && m.id === r.id);
        return `| ${r.agent} | ${r.id} | ${String(r.verdict.reason || '').replace(/\|/g, '/')} | ${r.verdict.downstream || ''} | ${move ? move.moved : false} |`;
      }),
    '',
    '## 需人工复验',
    '',
    '| agent | id | reason |',
    '|---|---|---|',
    ...results
      .filter(r => r.verdict.status === 'needs_revalidation')
      .map(r => `| ${r.agent} | ${r.id} | ${String(r.verdict.reason || '').replace(/\|/g, '/')} |`),
    '',
  ];
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  return { summary, jsonPath, mdPath };
}

function main() {
  const refs = doneRefsForDate(DATE);
  const refsByKey = new Map(refs.map(ref => [`${ref.agent}/${ref.id}`, ref]));
  const results = refs.map(ref => ({
    agent: ref.agent,
    id: ref.id,
    file: ref.file,
    taskId: taskIdOf(ref),
    flowId: flowIdOf(ref),
    verdict: classify(ref, refsByKey),
  }));
  const now = new Date().toISOString();
  const moves = [];
  if (APPLY) {
    for (const r of results.filter(item => item.verdict.status === 'false_done')) {
      const ref = refsByKey.get(`${r.agent}/${r.id}`);
      if (!ref) continue;
      const move = moveFalseDone(ref, r.verdict, now);
      moves.push({ agent: r.agent, id: r.id, ...move });
    }
  }
  const report = writeReport(results, moves, now);
  process.stdout.write(JSON.stringify(report.summary, null, 2) + '\n');
  process.stdout.write(`${report.mdPath}\n${report.jsonPath}\n`);
}

main();
