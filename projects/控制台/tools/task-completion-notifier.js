#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const YuanxiaoMessage = require('./notify-yuanxiao-message');

const SCHEMA = 'yutu6-task-completion-notice@1';
const MAX_TOTAL_CHARS = 300;
const IN_FLIGHT_STALE_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [0, 5000, 30000];

function codePointLength(value) {
  return Array.from(String(value || '')).length;
}

function truncateChars(value, maxLength) {
  const chars = Array.from(String(value || ''));
  if (chars.length <= maxLength) return chars.join('');
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join('').trim()}…`;
}

function redactSensitive(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, '[私钥已隐藏]')
    .replace(/\b(sk|ma_live|ak)-[A-Za-z0-9._-]{12,}\b/g, '$1-[已隐藏]')
    .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=：]\s*[^\s,，;；]+/gi, '$1=[已隐藏]');
}

function oneLine(value) {
  return redactSensitive(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstUsefulLine(value) {
  const lines = redactSensitive(value)
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*#\d.\s]+/, '').trim())
    .filter(Boolean)
    .filter(line => !/^(边界|约束|验收|acceptance|bounds|队列引导消息)/i.test(line));
  const line = lines[0] || '完成主人交办的任务';
  const stop = line.search(/[。！？!?；;]/);
  return stop >= 10 ? line.slice(0, stop + 1) : line;
}

function completionTopic(spec, options = {}) {
  const explicit = oneLine(options.topic || spec && spec.completionTopic);
  if (explicit) return truncateChars(explicit.replace(/^任务完成[-·：:\s]*/u, ''), 8);
  const queueAgent = oneLine(spec && (spec.queueAgent || spec.rootQueueAgent));
  const source = oneLine([
    spec && spec.title,
    spec && spec.shortTitle,
    spec && spec.summary,
    spec && spec.goal,
  ].filter(Boolean).join(' '));
  if (/(^|[-_])repair(?:-lead)?($|[-_])|维修工单|repair[-_ ]?ticket/i.test(`${queueAgent} ${source}`)) return '维修工单';
  if (/(页面|界面|前端|workspace|布局|样式|滚动|按钮|tab|UI)/i.test(source)) return '页面修改';
  if (/(通知|消息|回执|推送|决策卡|审批卡|卡片格式)/i.test(source)) return '通知优化';
  if (/(OTA|发布|上线|版本更新)/i.test(source)) return '版本发布';
  if (/(构建|打包|APK|IPA)/i.test(source)) return '构建任务';
  if (/(测试|回归|验收|冒烟)/i.test(source)) return '测试验证';
  if (/(文档|报告|索引|知识库)/i.test(source)) return '文档整理';
  if (/(模型|智能体|架构|runner|队列|并发|性能|内存|token)/i.test(source)) return '系统优化';
  return '任务处理';
}

function completionBackground(spec, options = {}) {
  let source = redactSensitive(
    options.background
    || spec && (spec.goal || spec.summary || spec.title)
    || ''
  ).replace(/```[\s\S]*?```/g, ' ');
  const labeled = source.match(
    /^(?:维修工单|工单|任务(?:名称)?|需求)\s*[^:：\n]{0,64}[:：]\s*([\s\S]+)$/i
  );
  if (labeled) source = labeled[1];
  source = source
    .replace(/^(?:目标|背景|问题|主人要求|请处理|请修复)\s*[:：]\s*/u, '')
    .replace(/^(?:请|需要|需)\s*/u, '')
    .trim();
  return firstUsefulLine(source);
}

function taskNumber(spec) {
  const value = spec && (spec.rootQueueId || spec.queueId || spec.id || spec.rootTaskId || spec.taskId);
  return truncateChars(String(value || 'unknown').replace(/^cr-\d+-/, ''), 24);
}

function completionIdentity(spec) {
  const value = spec && (spec.rootTaskId || spec.taskId);
  if (value) return String(value);
  return `${spec && (spec.rootQueueAgent || spec.queueAgent) || 'task'}:${taskNumber(spec)}`;
}

function isOwnerVisibleCompletion(spec) {
  if (!spec || spec.suppressCompletionNotice === true) return false;
  const queueId = String(spec.queueId || spec.id || '');
  if (!queueId || spec.parentTaskId) return false;
  const rootQueueId = String(spec.rootQueueId || queueId);
  if (rootQueueId !== queueId) return false;
  return true;
}

function testCount(implementation) {
  const tests = implementation && (
    implementation.tests
    || implementation.test_results
    || implementation.verification
    || implementation.commands
  );
  if (Array.isArray(tests)) return tests.length;
  return oneLine(tests) ? 1 : 0;
}

function reflectionValue(evidence, index) {
  const implementation = evidence && evidence.implementation || {};
  const review = evidence && evidence.review || {};
  const reflections = implementation.reflections && typeof implementation.reflections === 'object'
    ? implementation.reflections
    : {};
  const keys = index === 1
    ? ['reflection_one', 'uncertainty', 'risk']
    : ['reflection_two', 'owner_blind_spot', 'follow_up'];
  for (const key of keys) {
    const value = implementation[key] || reflections[key] || review[key];
    if (oneLine(value)) return oneLine(value);
  }
  return '';
}

function reflectionStatus(evidence, index, value) {
  const implementation = evidence && evidence.implementation || {};
  const review = evidence && evidence.review || {};
  const reflections = implementation.reflections && typeof implementation.reflections === 'object'
    ? implementation.reflections
    : {};
  const keys = index === 1
    ? ['reflection_one_status', 'uncertainty_status', 'risk_status']
    : ['reflection_two_status', 'owner_blind_spot_status', 'follow_up_status'];
  for (const key of keys) {
    const status = implementation[key] || reflections[key] || review[key];
    if (String(status || '').includes('❌') || /^(?:action|required|false)$/i.test(String(status || ''))) return '❌';
    if (String(status || '').includes('✅') || /^(?:info|none|true)$/i.test(String(status || ''))) return '✅';
  }
  return /(需要|需主人|请主人|待主人|拍板|确认|授权|选择|决定)/u.test(oneLine(value)) ? '❌' : '✅';
}

function markdownTableCell(value) {
  return oneLine(value).replace(/\|/g, '／');
}

function handlingMethod(evidence) {
  const implementation = evidence && evidence.implementation || {};
  const changedFiles = Array.isArray(evidence && evidence.changedFiles)
    ? evidence.changedFiles
    : (Array.isArray(implementation.changed_files) ? implementation.changed_files : []);
  const tests = testCount(implementation);
  if (changedFiles.length && tests) return `修改 ${changedFiles.length} 个文件，完成 ${tests} 项验证并经复审`;
  if (changedFiles.length) return `修改 ${changedFiles.length} 个文件并核对实际差异、完成复审`;
  if (tests) return `按验收核对证据，完成 ${tests} 项验证并经复审`;
  return '核对实际证据与验收项，由主管复审后收口';
}

function defaultReflectionOne(evidence) {
  return testCount(evidence && evidence.implementation)
    ? '现有验证未覆盖全部真实环境和长期运行边界'
    : '未发现结构化测试记录，结论主要依赖现有证据与复审';
}

function defaultReflectionTwo(spec, evidence) {
  const completionText = oneLine(evidence && evidence.summary);
  if (/(APK|IPA|安装包|构建包|已构建|构建完成|打包完成|已发布|已部署|已上传)/i.test(completionText)) {
    return '构建完成不等于设备侧已验证，安装与发布状态仍需单独核对';
  }
  const changedFiles = Array.isArray(evidence && evidence.changedFiles) ? evidence.changedFiles : [];
  return changedFiles.length
    ? '本次只覆盖任务约定范围，关联模块不会自动扩大改造'
    : '分析完成不会改变运行状态，若要落地仍需明确执行任务';
}

function buildCompletionNotice(spec, evidence = {}, options = {}) {
  const number = taskNumber(spec);
  const topic = completionTopic(spec, options);
  const title = `任务完成-${topic}`;
  const background = truncateChars(
    completionBackground(spec, options),
    28
  );
  const summary = truncateChars(
    oneLine(options.summary) || oneLine(evidence.summary) || '已按验收完成并通过主管复审',
    32
  );
  const method = truncateChars(
    oneLine(options.method) || handlingMethod(evidence),
    30
  );
  const reflectionOne = truncateChars(
    oneLine(options.reflectionOne) || reflectionValue(evidence, 1) || defaultReflectionOne(evidence),
    16
  );
  const reflectionTwo = truncateChars(
    oneLine(options.reflectionTwo) || reflectionValue(evidence, 2) || defaultReflectionTwo(spec, evidence),
    16
  );
  const reflectionOneStatus = reflectionStatus(evidence, 1, reflectionOne);
  const reflectionTwoStatus = reflectionStatus(evidence, 2, reflectionTwo);
  const body = [
    `# ${title}`,
    '',
    '**背景**',
    background,
    '',
    '**结果**',
    summary,
    '',
    '**处理**',
    method,
    '',
    '| # | 标题 | 内容 | 状态 |',
    '|---|---|---|---|',
    `| 反思一 | 我最没把握的事 | ${markdownTableCell(reflectionOne)} | ${reflectionOneStatus} |`,
    `| 反思二 | 我（主人）没想全面的事 | ${markdownTableCell(reflectionTwo)} | ${reflectionTwoStatus} |`,
  ].join('\n');
  const totalChars = codePointLength(`${title}\n${body}`);
  if (totalChars > MAX_TOTAL_CHARS) {
    throw new Error(`completion notice exceeds ${MAX_TOTAL_CHARS} chars: ${totalChars}`);
  }
  const identity = completionIdentity(spec);
  return {
    schema: SCHEMA,
    title,
    body,
    taskNumber: number,
    identity,
    dedupeKey: `task-complete:${crypto.createHash('sha256').update(identity).digest('hex')}`,
    totalChars,
  };
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, file);
}

function outboxDir(artifactsRoot) {
  return path.join(path.resolve(artifactsRoot), 'yuanxiao-task-completions');
}

function jobFileFor(artifactsRoot, dedupeKey) {
  const name = crypto.createHash('sha256').update(String(dedupeKey)).digest('hex').slice(0, 32);
  return path.join(outboxDir(artifactsRoot), `${name}.json`);
}

function spawnDelivery(jobFile, options = {}) {
  const spawnFn = options.spawnFn || spawn;
  try {
    const child = spawnFn(options.nodeBinary || process.execPath, [__filename, '--deliver', jobFile], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, options.env || {}),
    });
    if (child && typeof child.once === 'function') child.once('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return { spawned: true, pid: child && child.pid || null };
  } catch (error) {
    return { spawned: false, reason: oneLine(error && error.message || error) };
  }
}

function enqueueCompletion(spec, evidence = {}, options = {}) {
  if (!isOwnerVisibleCompletion(spec)) {
    return { queued: false, skipped: true, reason: 'not-owner-visible-root' };
  }
  const artifactsRoot = options.artifactsRoot;
  if (!artifactsRoot) throw new Error('artifactsRoot is required');
  const notice = buildCompletionNotice(spec, evidence, options);
  const file = jobFileFor(artifactsRoot, notice.dedupeKey);
  const now = Date.now();
  const existing = readJson(file, {});
  const updatedAtMs = Date.parse(existing.updated_at || '') || 0;
  if (existing.status === 'sent') {
    return { queued: false, skipped: true, duplicate: true, status: 'sent', file, notice };
  }
  if (['pending', 'sending'].includes(existing.status) && now - updatedAtMs < IN_FLIGHT_STALE_MS) {
    return { queued: false, skipped: true, duplicate: true, status: existing.status, file, notice };
  }
  const job = {
    schema: SCHEMA,
    status: 'pending',
    created_at: existing.created_at || new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    attempts: Number(existing.attempts || 0),
    task_number: notice.taskNumber,
    task_identity: notice.identity,
    dedupe_key: notice.dedupeKey,
    payload: {
      title: notice.title,
      body: notice.body,
      project: oneLine(spec.projectId) || '玉兔6',
      category: 'task-completion',
      speaker: '任务回执',
      conversation: 'yuanxiao-app',
      source: 'yutu6-task-completion',
      'task-id': notice.identity,
      'dedupe-key': notice.dedupeKey,
    },
  };
  writeJsonAtomic(file, job);
  const delivery = options.spawn === false ? { spawned: false, deferred: true } : spawnDelivery(file, options);
  if (!delivery.spawned && !delivery.deferred) {
    job.status = 'failed';
    job.updated_at = new Date().toISOString();
    job.last_error = truncateChars(delivery.reason || 'delivery process did not start', 240);
    writeJsonAtomic(file, job);
  }
  return { queued: true, file, notice, delivery };
}

function deliverJobFile(file, sender = YuanxiaoMessage.send) {
  const job = readJson(file);
  if (!job || job.schema !== SCHEMA) return { ok: false, reason: 'invalid-job' };
  if (job.status === 'sent') return { ok: true, duplicate: true, status: 'sent' };
  const started = new Date().toISOString();
  job.status = 'sending';
  job.attempts = Number(job.attempts || 0) + 1;
  job.last_attempt_at = started;
  job.updated_at = started;
  writeJsonAtomic(file, job);
  let result;
  try {
    result = sender(job.payload);
  } catch (error) {
    result = { ok: false, code: 0, error: oneLine(error && error.message || error) };
  }
  const finished = new Date().toISOString();
  job.status = result && result.ok ? 'sent' : 'failed';
  job.updated_at = finished;
  job.sent_at = result && result.ok ? finished : null;
  job.receipt_id = result && result.receiptId || null;
  job.last_code = Number(result && result.code || 0);
  job.last_error = result && result.ok
    ? null
    : truncateChars(oneLine(result && (result.error || result.reason) || 'delivery failed'), 240);
  writeJsonAtomic(file, job);
  return {
    ok: job.status === 'sent',
    status: job.status,
    attempts: job.attempts,
    code: job.last_code,
    receiptId: job.receipt_id,
  };
}

function recoverPending(options = {}) {
  const artifactsRoot = options.artifactsRoot;
  if (!artifactsRoot) return [];
  const dir = outboxDir(artifactsRoot);
  let files;
  try { files = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort(); }
  catch (_) { return []; }
  const now = Date.now();
  const limit = Math.max(1, Number(options.limit || 10));
  const recovered = [];
  for (const name of files) {
    if (recovered.length >= limit) break;
    const file = path.join(dir, name);
    const job = readJson(file);
    if (!job || job.status === 'sent') continue;
    const updatedAtMs = Date.parse(job.updated_at || '') || 0;
    if (['pending', 'sending'].includes(job.status) && now - updatedAtMs < IN_FLIGHT_STALE_MS) continue;
    recovered.push({ file, ...spawnDelivery(file, options) });
  }
  return recovered;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function deliverWithRetry(file) {
  let result = null;
  for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
    if (RETRY_DELAYS_MS[index]) await sleep(RETRY_DELAYS_MS[index]);
    result = deliverJobFile(file);
    if (result.ok) return result;
  }
  return result || { ok: false, reason: 'delivery-not-attempted' };
}

async function main(argv = process.argv.slice(2)) {
  const deliverIndex = argv.indexOf('--deliver');
  const file = deliverIndex >= 0 ? argv[deliverIndex + 1] : '';
  if (!file) throw new Error('用法: task-completion-notifier.js --deliver <job.json>');
  const result = await deliverWithRetry(path.resolve(file));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(() => process.exit(2));
}

module.exports = {
  MAX_TOTAL_CHARS,
  SCHEMA,
  buildCompletionNotice,
  codePointLength,
  completionIdentity,
  deliverJobFile,
  enqueueCompletion,
  isOwnerVisibleCompletion,
  jobFileFor,
  recoverPending,
  redactSensitive,
  taskNumber,
  truncateChars,
};
