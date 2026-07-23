#!/usr/bin/env node
'use strict';
// 元宵审批·上行(A 路 MVP):把一张审批卡(标题+五要素+预览图)推进元宵 app inbox,
// 老板手机收到通知+富文本卡,在聊天里回复「采纳 <编号>」/「不采纳 <编号>」由下行脚本回收执行。
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
const { execFileSync } = require('child_process');

const WORKDIR = path.resolve(__dirname, '..', '..', '..');
const APPROVALS_DIR = path.resolve(__dirname, '..', 'artifacts', 'yuanxiao-approvals');
const SEQ_FILE = path.join(APPROVALS_DIR, '.seq');
const SSH_KEY = process.env.YUANXIAO_SSH_KEY || path.join(os.homedir(), '.ssh', 'change.pem');
const SSH_DEST = process.env.YUANXIAO_SSH_DEST || 'ubuntu@49.235.187.125';
const INBOX_ADMIN_URL = process.env.YUANXIAO_INBOX_ADMIN_URL || 'https://localhost/api/inbox/admin';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; a[k] = v; }
  }
  return a;
}

function nextSeq() {
  fs.mkdirSync(APPROVALS_DIR, { recursive: true });
  let n = 0;
  try { n = parseInt(fs.readFileSync(SEQ_FILE, 'utf8'), 10) || 0; } catch (_) {}
  n += 1;
  fs.writeFileSync(SEQ_FILE, String(n));
  return n;
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

function buildBody(seq, args, nativeCardAvailable = false) {
  const L = [];
  L.push(`## 审批 · ${args.title || '(未命名)'}  （编号 ${seq}）`);
  L.push('');
  if (args.cause) L.push(`**起因**：${args.cause}`);
  if (args.source) L.push(`**来源**：${args.source}`);
  if (args.progress) L.push(`**进展**：${args.progress}`);
  if (args.result) L.push(`**结果**：${args.result}`);
  if (args.note) L.push(`**说明**：${args.note}`);
  L.push('');
  L.push(nativeCardAvailable
    ? '**决策项**：请在任务页原生决策卡直接点「同意」或「拒绝」；旧版仍可回复文字。'
    : `**决策项**：回复「采纳 ${seq}」或「不采纳 ${seq}」即可（也可加一句理由）。`);
  return L.join('\n');
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
  const m = out.match(/HTTP:(\d+)\s*$/);
  const code = m ? parseInt(m[1], 10) : 0;
  const body = out.replace(/\nHTTP:\d+\s*$/, '');
  let receiptId = null;
  try {
    const parsed = JSON.parse(body || '{}');
    receiptId = parsed && parsed.message && parsed.message.id ? String(parsed.message.id).slice(0, 160) : null;
  } catch (_) {}
  return { code, ok: code >= 200 && code < 300, raw: body.slice(0, 500), receiptId };
}

function pushToInbox(payload) {
  return pushToYuanxiaoPath('/api/inbox/admin', payload);
}

function buildTypedApprovalPayload(seq, cardId, taskId, args) {
  return {
    card_id: cardId,
    card_type: 'decision',
    task_id: taskId,
    status: 'pending',
    title: String(args.title || '').slice(0, 160),
    summary: String(args.result || args.note || args.cause || '等待主人拍板').slice(0, 500),
    renderer: 'android_native_v2',
    actions: [
      { id: 'approve', label: '同意' },
      { id: 'reject', label: '拒绝' },
    ],
    payload: {
      decision_ref: { kind: 'yutu6_approval', card_id: cardId },
      approval_seq: seq,
      cause: args.cause || '',
      source: args.source || '',
      progress: args.progress || '',
      result: args.result || '',
      note: args.note || '',
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
  if (!task || !task.ok) return { ok: false, stage: 'task', code: task && task.code || 0 };
  const card = sender('/api/v1/cards', buildTypedApprovalPayload(seq, cardId, taskId, args));
  return { ok: Boolean(card && card.ok), stage: 'card', code: card && card.code || 0, receiptId: card && card.receiptId || null };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) { console.error('需要 --title'); process.exit(2); }
  const seq = nextSeq();
  const cardId = `ap-${Date.now()}-${seq}`;
  const taskId = String(args['task-id'] || `yuanxiao-decision-${cardId}`).slice(0, 120);
  const image = buildImageEntry(args.image);
  // 先持久化权威 pending 账本，再对外创建卡；避免极快点击先于本地决策记录落盘。
  const record = {
    seq, cardId, taskId, title: args.title,
    fields: { cause: args.cause || null, source: args.source || null, progress: args.progress || null, result: args.result || null, note: args.note || null },
    image: image && image.skipped ? { skipped: image.note } : (args.image ? { ref: args.image } : null),
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
  fs.mkdirSync(APPROVALS_DIR, { recursive: true });
  fs.writeFileSync(path.join(APPROVALS_DIR, `${seq}.json`), JSON.stringify(record, null, 2));
  let nativeCard = { ok: false, code: 0, stage: 'not-attempted' };
  try { nativeCard = pushTypedApprovalCard(seq, cardId, taskId, args); }
  catch (error) { nativeCard = { ok: false, code: 0, stage: 'transport', error: String(error.message || error).slice(0, 120) }; }
  const body = buildBody(seq, args, nativeCard.ok);

  const payload = {
    text: body,
    speaker: '嫦娥',
    conversation: 'yuanxiao-app',
    format: 'markdown',
    source: 'yutu6-approval',
    approval_required: true,
    approval_card_id: cardId,
    approval_surface: 'yuanxiao_app',
    typed_card_id: cardId,
    task_id: taskId,
    fallback: !nativeCard.ok,
  };
  if (image && !image.skipped) payload.images = [image];

  let push = { ok: false, code: 0 };
  try { push = pushToInbox(payload); } catch (e) { push = { ok: false, code: 0, error: String(e.message || e).slice(0, 200) }; }

  // 回填两条下行通道结果；决策状态仍只由回调或旧文字通道更新。
  const recordFile = path.join(APPROVALS_DIR, `${seq}.json`);
  let latestRecord = record;
  try { latestRecord = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch (_) {}
  latestRecord.pushed = !!push.ok;
  latestRecord.push_code = push.code || null;
  latestRecord.native_card = !!nativeCard.ok;
  latestRecord.native_card_code = nativeCard.code || null;
  latestRecord.native_card_stage = nativeCard.stage || null;
  fs.writeFileSync(recordFile, JSON.stringify(latestRecord, null, 2));

  const result = { ok: !!push.ok, seq, cardId, taskId, nativeCard: !!nativeCard.ok, pushed: !!push.ok, http: push.code || null, ledger: path.join('projects/控制台/artifacts/yuanxiao-approvals', `${seq}.json`) };
  if (args.json) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    if (push.ok) console.error(`✓ 审批卡已推元宵(编号 ${seq}, card ${cardId})。老板可回「采纳 ${seq}」/「不采纳 ${seq}」`);
    else console.error(`✗ 推送失败(HTTP ${push.code || '?'}${push.error ? ', ' + push.error : ''}),已记待审账本 ${seq}.json,可重试`);
  }
  process.exit(push.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { buildBody, buildImageEntry, buildTypedApprovalPayload, parseArgs, pushToInbox, pushToYuanxiaoPath, pushTypedApprovalCard };
