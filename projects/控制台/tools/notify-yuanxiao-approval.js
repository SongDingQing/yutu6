#!/usr/bin/env node
'use strict';
// 元宵审批·上行:把一张简洁审批卡推进元宵 app inbox。
// 新版直接点「同意 / 否决」,旧版仍可回复「采纳 <编号> / 不采纳 <编号>」。
//
// 通道:复用现有 SSH(~/.ssh/change.pem → ubuntu@49.235.187.125),ssh 到服务器本机
//   curl POST https://localhost/api/inbox/admin(loopback 免 token,已验证)。零公网暴露、零 bridge。
// 账本:每张卡在 artifacts/yuanxiao-approvals/<seq>.json 记 pending,下行脚本据此回填决策。
//
// 用法:
//   node notify-yuanxiao-approval.js --title "黑莲花·循环动画" \
//     --cause "任务1:把现有立绘改成循环动画" --source "talent_art_role_black_lotus.png + meowa animate" \
//     --progress "已生成 8 帧循环" --result "预览见图,接入后战斗界面待机动画" \
//     [--image <本地png或url>] [--note "该不该采纳的补充说明"] [--json]
//   → 返回 { ok, seq, cardId }。老板回「采纳 3」即采纳 3 号。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const WORKDIR = path.resolve(__dirname, '..', '..', '..');
const APPROVALS_DIR = path.resolve(__dirname, '..', 'artifacts', 'yuanxiao-approvals');
const SSH_KEY = process.env.YUANXIAO_SSH_KEY || path.join(os.homedir(), '.ssh', 'change.pem');
const SSH_DEST = process.env.YUANXIAO_SSH_DEST || 'ubuntu@49.235.187.125';
const INBOX_ADMIN_URL = process.env.YUANXIAO_INBOX_ADMIN_URL || 'https://localhost/api/inbox/admin';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      if (k === 'image') {
        if (!Array.isArray(a.image)) a.image = a.image ? [a.image] : [];
        a.image.push(v);
      } else {
        a[k] = v;
      }
    }
  }
  return a;
}

function nextSeq(approvalsDir = APPROVALS_DIR) {
  fs.mkdirSync(approvalsDir, { recursive: true });
  const seqFile = path.join(approvalsDir, '.seq');
  let n = 0;
  try { n = parseInt(fs.readFileSync(seqFile, 'utf8'), 10) || 0; } catch (_) {}
  n += 1;
  fs.writeFileSync(seqFile, String(n));
  return n;
}

function findApprovalRecord(approvalsDir, cardId) {
  if (!cardId || !fs.existsSync(approvalsDir)) return null;
  for (const name of fs.readdirSync(approvalsDir)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(approvalsDir, name);
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (String(record.cardId || '') === cardId) return { file, record };
    } catch (_) {}
  }
  return null;
}

function normalizeExecutionPlan(value) {
  if (!value) return null;
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); }
    catch (_) { throw new Error('execution 必须是合法 JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('execution 必须是对象');
  }
  const queueAgent = String(input.queueAgent || input.queue_agent || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(queueAgent)) {
    throw new Error('execution.queueAgent 非法');
  }
  const task = input.task && typeof input.task === 'object' && !Array.isArray(input.task)
    ? JSON.parse(JSON.stringify(input.task))
    : null;
  if (!task || !String(task.goal || task.message || '').trim()) {
    throw new Error('execution.task.goal 不能为空');
  }
  const serializedTask = JSON.stringify(task);
  if (serializedTask.length > 20000) throw new Error('execution.task 过大');
  const priorityValue = Number(input.priority);
  const priority = Number.isFinite(priorityValue)
    ? Math.max(0, Math.min(99, Math.floor(priorityValue)))
    : 40;
  const queueId = String(input.queueId || input.queue_id || '').trim();
  if (queueId && !/^[A-Za-z0-9_-]{1,120}$/.test(queueId)) {
    throw new Error('execution.queueId 非法');
  }
  const idem = String(input.idem || '').trim().slice(0, 180);
  const normalized = {
    schema: 'yutu6-approval-execution@1',
    queue_agent: queueAgent,
    queue_id: queueId || null,
    priority,
    idem: idem || null,
    task,
  };
  normalized.fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
  return normalized;
}

function attachExecutionPlan(record, execution) {
  if (!execution) return record;
  const existing = record.execution;
  if (existing && existing.fingerprint && existing.fingerprint !== execution.fingerprint) {
    throw new Error('同一卡片不得替换为不同执行计划');
  }
  if (existing && ['approved', 'rejected'].includes(String(record.status || ''))) {
    return record;
  }
  record.execution = Object.assign({
    status: 'pending',
    enqueued_at: null,
    queue_entry_id: null,
  }, existing || {}, execution);
  return record;
}

// 本地图片 → data_url(app 支持 base64 内联);url 原样;无则跳过。
function buildImageEntry(image) {
  if (!image || image === true) return null;
  if (/^https?:\/\//i.test(image)) return { url: String(image) };
  try {
    const buf = fs.readFileSync(image);
    if (buf.length > 3 * 1024 * 1024) return { note: '图过大(>3MB)未内联,请改用 url', skipped: true };
    const ext = (path.extname(image).slice(1) || 'png').toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { data_url: `data:image/${mime};base64,${buf.toString('base64')}` };
  } catch (e) { return { note: `图读取失败: ${String(e.message).slice(0, 80)}`, skipped: true }; }
}

function buildImageEntries(images) {
  const input = Array.isArray(images) ? images : (images ? [images] : []);
  return input.map(buildImageEntry).filter(Boolean);
}

function compactOneLine(value, maxLength = 180) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function decisionSummary(args) {
  return compactOneLine(
    args.result || args.note || args.cause || args.progress || '等待主人拍板',
    180
  );
}

function buildBody(seq, args, nativeCardAvailable = false) {
  const title = compactOneLine(args.title || '未命名审批', 80);
  const summary = decisionSummary(args);
  return [
    `## ${title} · #${seq}`,
    summary,
    nativeCardAvailable
      ? '请直接点击「同意」或「否决」。'
      : `旧版操作：回复「采纳 ${seq}」或「不采纳 ${seq}」。`,
  ].join('\n\n');
}

function parsePushResponse(out) {
  const m = String(out || '').match(/HTTP:(\d+)\s*$/);
  const code = m ? parseInt(m[1], 10) : 0;
  const body = String(out || '').replace(/\nHTTP:\d+\s*$/, '');
  let receiptId = null;
  let responseStatus = '';
  let upstreamStatus = null;
  let responseError = '';
  try {
    const parsed = JSON.parse(body || '{}');
    receiptId = parsed && parsed.message && parsed.message.id ? String(parsed.message.id).slice(0, 160) : null;
    responseStatus = String(parsed && parsed.status || '').toLowerCase();
    upstreamStatus = Number.isFinite(Number(parsed && parsed.upstream_status))
      ? Number(parsed.upstream_status)
      : null;
    responseError = String(parsed && (parsed.error || parsed.detail) || '').slice(0, 160);
  } catch (_) {}
  const outerOk = code >= 200 && code < 300;
  const innerOk = responseStatus !== 'error' && (upstreamStatus === null || upstreamStatus < 400);
  return {
    code,
    ok: outerOk && innerOk,
    raw: body.slice(0, 500),
    receiptId,
    responseStatus,
    upstreamStatus,
    error: responseError,
  };
}

function pushToYuanxiaoPath(apiPath, payload) {
  const safePath = String(apiPath || '').trim();
  if (!/^\/api\/[a-zA-Z0-9_/?=&.-]+$/.test(safePath)) throw new Error('invalid YuanXiao API path');
  const json = JSON.stringify(payload);
  const sshBase = ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  // 通过 stdin 传 payload,避免命令行转义/在服务器落临时文件
  const target = safePath === '/api/inbox/admin' ? INBOX_ADMIN_URL : `https://localhost${safePath}`;
  const remoteCmd = `curl -sk --max-time 10 -X POST '${target}' -H 'Content-Type: application/json' --data-binary @- -w '\\nHTTP:%{http_code}'`;
  const out = execFileSync('ssh', [...sshBase, SSH_DEST, remoteCmd], { input: json, encoding: 'utf8', timeout: 30000 });
  return parsePushResponse(out);
}

function pushToInbox(payload) {
  return pushToYuanxiaoPath('/api/inbox/admin', payload);
}

function buildTypedApprovalPayload(seq, cardId, taskId, args) {
  const reportDocumentName = compactOneLine(args['report-document-name'], 160);
  const reportDocumentFolder = compactOneLine(args['report-document-folder'], 120);
  const reportFingerprint = compactOneLine(args['report-fingerprint'], 80);
  return {
    card_id: cardId,
    card_type: 'decision',
    task_id: taskId,
    status: 'pending',
    title: String(args.title || '').slice(0, 160),
    summary: decisionSummary(args),
    renderer: 'android_native_v2',
    actions: [
      { id: 'approve', label: '同意' },
      { id: 'reject', label: '否决' },
    ],
    payload: {
      decision_ref: { kind: 'yutu6_approval', card_id: cardId },
      approval_seq: seq,
      cause: args.cause || '',
      source: args.source || '',
      progress: args.progress || '',
      result: args.result || '',
      note: args.note || '',
      ...(reportDocumentName ? { report_document_name: reportDocumentName } : {}),
      ...(reportDocumentFolder ? { report_document_folder: reportDocumentFolder } : {}),
      ...(reportFingerprint ? { report_fingerprint: reportFingerprint } : {}),
    },
    actor: 'yutu6-approval',
  };
}

function pushTypedApprovalCard(seq, cardId, taskId, args, sender = pushToYuanxiaoPath) {
  const task = sender('/api/v1/tasks', {
    task_id: taskId,
    title: String(args.title || '').slice(0, 160),
    kind: 'decision',
    route: 'yutu6',
    status: 'paused',
    progress: 0,
    project_id: String(args.project || '控制台').slice(0, 120),
    message: String(args.cause || args.result || args.title || '').slice(0, 1200),
  });
  const card = sender('/api/v1/cards', buildTypedApprovalPayload(seq, cardId, taskId, args));
  const cardOk = Boolean(card && card.ok);
  return {
    ok: cardOk,
    stage: cardOk && (!task || !task.ok) ? 'card-without-task-ledger' : 'card',
    code: card && card.code || 0,
    receiptId: card && card.receiptId || null,
    taskOk: Boolean(task && task.ok),
  };
}

function sendApproval(args, options = {}) {
  if (!args || !args.title) throw new Error('需要 --title');
  const approvalsDir = path.resolve(options.approvalsDir || APPROVALS_DIR);
  const inboxSender = options.inboxSender || pushToInbox;
  const typedSender = options.typedSender || pushToYuanxiaoPath;
  fs.mkdirSync(approvalsDir, { recursive: true });

  const requestedCardId = compactOneLine(args['card-id'], 160);
  const existing = requestedCardId ? findApprovalRecord(approvalsDir, requestedCardId) : null;
  const execution = normalizeExecutionPlan(args.execution);
  if (existing && existing.record.pushed && existing.record.native_card) {
    attachExecutionPlan(existing.record, execution);
    fs.writeFileSync(existing.file, JSON.stringify(existing.record, null, 2));
    return {
      ok: true,
      seq: existing.record.seq,
      cardId: existing.record.cardId,
      taskId: existing.record.taskId,
      nativeCard: true,
      pushed: true,
      http: existing.record.push_code || 200,
      ledger: existing.file,
      idempotent: true,
    };
  }

  const seq = existing ? existing.record.seq : nextSeq(approvalsDir);
  const cardId = requestedCardId || `ap-${Date.now()}-${seq}`;
  const taskId = String(args['task-id'] || `yuanxiao-decision-${cardId}`).slice(0, 120);
  const imageInputs = Array.isArray(args.image) ? args.image : (args.image ? [args.image] : []);
  const images = buildImageEntries(imageInputs);
  const sendableImages = images.filter(image => !image.skipped);
  // 先持久化权威 pending 账本，再对外创建卡；避免极快点击先于本地决策记录落盘。
  const record = existing ? existing.record : {
    seq, cardId, taskId, title: args.title,
    fields: { cause: args.cause || null, source: args.source || null, progress: args.progress || null, result: args.result || null, note: args.note || null },
    image: images[0] && images[0].skipped
      ? { skipped: images[0].note }
      : (imageInputs[0] ? { ref: imageInputs[0] } : null),
    images: imageInputs.map((ref, index) => images[index] && images[index].skipped
      ? { ref, skipped: images[index].note }
      : { ref }),
    status: 'pending',
    verdict: null,
    created_at: new Date().toISOString(),
    decided_at: null,
    pushed: false,
    push_code: null,
    native_card: false,
    native_card_code: null,
    native_card_stage: 'not-attempted',
  };
  attachExecutionPlan(record, execution);
  record.report = {
    document_name: compactOneLine(args['report-document-name'], 160) || null,
    document_folder: compactOneLine(args['report-document-folder'], 120) || null,
    fingerprint: compactOneLine(args['report-fingerprint'], 80) || null,
  };
  const recordFile = existing ? existing.file : path.join(approvalsDir, `${seq}.json`);
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
  let nativeCard = { ok: false, code: 0, stage: 'not-attempted' };
  try { nativeCard = pushTypedApprovalCard(seq, cardId, taskId, args, typedSender); }
  catch (error) { nativeCard = { ok: false, code: 0, stage: 'transport', error: String(error.message || error).slice(0, 120) }; }
  const body = buildBody(seq, args, nativeCard.ok);

  const payload = {
    text: body,
    speaker: '嫦娥',
    conversation: 'yuanxiao-app',
    format: 'markdown',
    source: 'yutu6-approval',
    title: String(args.title || '').slice(0, 160),
    approval_required: true,
    approval_seq: seq,
    decision_summary: decisionSummary(args),
    approval_card_id: cardId,
    approval_surface: 'yuanxiao_app',
    typed_card_id: cardId,
    task_id: taskId,
    fallback: !nativeCard.ok,
  };
  if (sendableImages.length) payload.images = sendableImages;

  let push = { ok: false, code: 0 };
  try { push = inboxSender(payload); } catch (e) { push = { ok: false, code: 0, error: String(e.message || e).slice(0, 200) }; }

  // 回填两条下行通道结果；决策状态仍只由回调或旧文字通道更新。
  let latestRecord = record;
  try { latestRecord = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch (_) {}
  latestRecord.pushed = !!push.ok;
  latestRecord.push_code = push.code || null;
  latestRecord.native_card = !!nativeCard.ok;
  latestRecord.native_card_code = nativeCard.code || null;
  latestRecord.native_card_stage = nativeCard.stage || null;
  fs.writeFileSync(recordFile, JSON.stringify(latestRecord, null, 2));

  return {
    ok: !!push.ok,
    seq,
    cardId,
    taskId,
    nativeCard: !!nativeCard.ok,
    pushed: !!push.ok,
    http: push.code || null,
    ledger: recordFile,
    idempotent: false,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = sendApproval(args);
  } catch (error) {
    console.error(String(error && error.message || error));
    process.exit(2);
  }
  if (args.json) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    if (result.ok) console.error(`✓ 审批卡已推元宵(编号 ${result.seq}, card ${result.cardId})。老板可回「采纳 ${result.seq}」/「不采纳 ${result.seq}」`);
    else console.error(`✗ 推送失败(HTTP ${result.http || '?'}),已记待审账本 ${result.seq}.json,可重试`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = {
  buildBody,
  buildImageEntry,
  buildImageEntries,
  buildTypedApprovalPayload,
  compactOneLine,
  decisionSummary,
  parsePushResponse,
  parseArgs,
  pushToInbox,
  pushToYuanxiaoPath,
  pushTypedApprovalCard,
  normalizeExecutionPlan,
  sendApproval,
};
