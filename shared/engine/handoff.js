'use strict';
/*
 * handoff:交接文件夹机制 shadow 阶段(拍板①②修正版,来自对抗评审)。
 *
 * 设计约束(必须遵守):
 * - 不建新目录树:任务稿(task.md)/元数据(meta.json)寄生在 engine-runs/<taskId>/ 根,
 *   该目录 engine-runner 本就创建、轮转现成;pair 关系写 meta 字段,不建 pair 文件夹。
 * - 指针化只发生在 prompt 层(cli-runner buildEnvelope):queue entry 与 ctx 永远保留全文,
 *   done-gate/资源锁/路由的文本判据不受影响。
 * - 生命周期绑队列终态(目录轮转);board_* 角色(纯文本 runner)由调用方排除。
 *
 * 开关 YUTU6_HANDOFF_MODE:
 *   shadow(默认)= 只写 task.md/meta.json,不改信封;
 *   on           = CLI runner(codex/claude 族)信封 goal 段指针化;
 *   off          = 完全关闭,不写文件、不改信封。
 * 任何读/写失败一律回退现状全文,由调用方 emit handoff.fallback,绝不阻断任务。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = new Set(['off', 'shadow', 'on']);
const DEFAULT_MODE = 'shadow';
const INTENT_MAX_CHARS = 200;

function mode(env) {
  const source = env || process.env;
  const raw = String(source.YUTU6_HANDOFF_MODE || '').trim().toLowerCase();
  return MODES.has(raw) ? raw : DEFAULT_MODE;
}

function isEnabled(env) {
  return mode(env) !== 'off';
}

function fingerprintText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function taskDocPath(runDir) {
  return path.join(runDir, 'task.md');
}

function metaPath(runDir) {
  return path.join(runDir, 'meta.json');
}

// 原子写:先写临时文件再 rename,避免并发读者读到半截文档导致指纹永远不匹配。
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// 任务稿正文:goal/bounds/acceptance(含结构化验收表,已在 acceptance 内)写在正文最前。
function buildTaskDocText(ctx) {
  const c = ctx || {};
  return [
    '# 任务交接稿(handoff task doc,shadow 机制)',
    c.taskId ? `- taskId:${c.taskId}` : null,
    c.projectId ? `- 项目:${c.projectId}` : null,
    `- 生成时间:${new Date().toISOString()}`,
    '',
    '## 目标',
    String(c.goal || '(未提供)'),
    '',
    '## 边界',
    String(c.bounds || '(未提供)'),
    '',
    '## 验收(含结构化验收表)',
    String(c.acceptance || '(未提供)'),
    '',
  ].filter(x => x != null).join('\n');
}

function writeTaskDoc(runDir, ctx) {
  if (!runDir) throw new Error('writeTaskDoc: runDir required');
  const text = buildTaskDocText(ctx);
  const file = taskDocPath(runDir);
  atomicWrite(file, text);
  return { file, fingerprint: fingerprintText(text) };
}

// meta.json:pair 关系(from/to)与队列坐标全走字段,不建 pair 文件夹。
function writeMeta(runDir, meta) {
  if (!runDir) throw new Error('writeMeta: runDir required');
  const body = Object.assign({
    schema: 'handoff-meta@1',
    taskId: null,
    queueAgent: null,
    queueId: null,
    from: null,
    to: null,
    spec_fingerprint: null,
    attempts: [],
    written_at: new Date().toISOString(),
  }, meta || {});
  if (!Array.isArray(body.attempts)) body.attempts = [];
  const file = metaPath(runDir);
  atomicWrite(file, JSON.stringify(body, null, 2) + '\n');
  return { file, meta: body };
}

/* 读任务稿并校验指纹。opts.fingerprint(如 ctx.spec_fingerprint)优先于 meta.spec_fingerprint。
 * 返回 { ok:true, file, text, meta, fingerprint } 或 { ok:false, reason, file }。 */
function readTaskDoc(runDir, opts) {
  const file = taskDocPath(runDir || '');
  if (!runDir) return { ok: false, reason: 'run_dir_missing', file };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, reason: `task_doc_unreadable: ${e.message}`, file };
  }
  if (!String(text).trim()) return { ok: false, reason: 'task_doc_empty', file };
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(runDir), 'utf8'));
  } catch (e) {
    return { ok: false, reason: `meta_unreadable: ${e.message}`, file };
  }
  const expected = (opts && opts.fingerprint) || (meta && meta.spec_fingerprint) || null;
  if (!expected) return { ok: false, reason: 'fingerprint_missing', file };
  const actual = fingerprintText(text);
  if (actual !== expected) {
    return {
      ok: false,
      reason: `fingerprint_mismatch: expected=${String(expected).slice(0, 12)} actual=${actual.slice(0, 12)}`,
      file,
    };
  }
  return { ok: true, file, text, meta, fingerprint: actual };
}

function intentLine(goal, max = INTENT_MAX_CHARS) {
  const first = String(goal || '').trim().split(/\r?\n/)[0] || '(见任务稿)';
  return first.length > max ? first.slice(0, max) : first;
}

// 指针化范围:CLI 族 runner(codex/claude/peekaboo 等,有 cmd);
// openai_http(纯文本)/openai_http_tool_harness 一律走现状全文。
function isCliRunner(runner) {
  if (!runner) return false;
  const kind = runner.kind || 'cli';
  if (kind === 'openai_http' || kind === 'openai_http_tool_harness') return false;
  return Array.isArray(runner.cmd) && runner.cmd.length > 0;
}

/* 信封 goal 段决策(只在 prompt 层调用):
 * - null:不适用(off/shadow 模式、非 CLI runner、没给 runDir)→ 用现状全文,不发事件;
 * - { fallback: reason }:on 模式本该指针化但读失败/指纹不符 → 回退全文,调用方 emit handoff.fallback;
 * - { pointer: { intent, file, fingerprint } }:指针化信封。 */
function envelopeGoalPointer({ runDir, ctx, runner, env } = {}) {
  if (mode(env) !== 'on') return null;
  if (!isCliRunner(runner)) return null;
  if (!runDir) return null;
  const doc = readTaskDoc(runDir, { fingerprint: ctx && ctx.spec_fingerprint });
  if (!doc.ok) return { fallback: doc.reason };
  return {
    pointer: {
      intent: intentLine(ctx && ctx.goal),
      file: doc.file,
      fingerprint: doc.fingerprint,
    },
  };
}

module.exports = {
  mode,
  isEnabled,
  fingerprintText,
  taskDocPath,
  metaPath,
  buildTaskDocText,
  writeTaskDoc,
  writeMeta,
  readTaskDoc,
  intentLine,
  isCliRunner,
  envelopeGoalPointer,
};
