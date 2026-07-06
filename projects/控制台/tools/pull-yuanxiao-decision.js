#!/usr/bin/env node
'use strict';
// 元宵审批·下行(A 路 MVP):拉老板在元宵 app 里的回复,解析「采纳 N」/「不采纳 N」,回填审批账本。
// 老板回复经 /api/chat 落服务器 chat_history.jsonl(source: yuanxiao-phone)。本脚本(Mac,launchd 定时)
//   ssh 到服务器读 chat_history.jsonl → 增量筛新的手机消息 → 正则解析决策 → 更新 approvals/<N>.json。
// 决策落地由消费方(meowa 任务 agent)轮询账本 status 决定接入/弃用;本脚本另 emit 事件便于观测。
//
// 用法: node pull-yuanxiao-decision.js [--json]   (--once 默认;由 launchd 每 60~90s 调一次)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APPROVALS_DIR = path.resolve(__dirname, '..', 'artifacts', 'yuanxiao-approvals');
const CURSOR_FILE = path.join(APPROVALS_DIR, '.chat-cursor');
const SSH_KEY = process.env.YUANXIAO_SSH_KEY || path.join(os.homedir(), '.ssh', 'change.pem');
const SSH_DEST = process.env.YUANXIAO_SSH_DEST || 'ubuntu@49.235.187.125';
const CHAT_FILE = process.env.YUANXIAO_CHAT_HISTORY_REMOTE || '/opt/yuanxiao/data/chat_history.jsonl';

// 决策解析:支持两种语序(「采纳3」关键词在前 / 「3号采纳」数字在前),reject 先跑先占 seq(因"不采纳"含"采纳")。
// 关键词都要求与数字相邻(中间仅空格/号/第/的),避免误伤普通聊天里的"不要紧/不用了"等(无相邻数字不匹配)。
const REJECT_WORDS = '不采纳|不予采纳|拒绝|驳回|否决|不要|不用|reject';
const APPROVE_WORDS = '采纳|通过|同意|接受|批准|adopt|approve';
// 关键词在前(数字被关键词直接绑定,最可信,先占数字位置);reject 在 approve 前(因"不采纳"含"采纳")。
const KW_FIRST = [
  { verdict: 'rejected', re: new RegExp(`(?:${REJECT_WORDS})\\s*[#第]?\\s*(\\d+)`, 'gi') },
  { verdict: 'approved', re: new RegExp(`(?:${APPROVE_WORDS})\\s*[#第]?\\s*(\\d+)`, 'gi') },
];
// 数字在前(如"3号不采纳"),只认未被 KW_FIRST 占用的数字。
const NUM_FIRST = [
  { verdict: 'rejected', re: new RegExp(`(\\d+)\\s*号?\\s*(?:的)?\\s*(?:${REJECT_WORDS})`, 'gi') },
  { verdict: 'approved', re: new RegExp(`(\\d+)\\s*号?\\s*(?:的)?\\s*(?:${APPROVE_WORDS})`, 'gi') },
];

function parseDecisions(text) {
  const out = [];
  const seen = new Set();
  const claimedPos = new Set(); // 已被关键词绑定的数字子串起始位置,防"采纳3 不采纳4"里 3 被后者抢走
  for (const p of KW_FIRST) {
    p.re.lastIndex = 0; let m;
    while ((m = p.re.exec(text)) !== null) {
      claimedPos.add(m.index + m[0].lastIndexOf(m[1]));
      const s = parseInt(m[1], 10);
      if (!seen.has(s)) { seen.add(s); out.push({ seq: s, verdict: p.verdict, raw: m[0] }); }
    }
  }
  for (const p of NUM_FIRST) {
    p.re.lastIndex = 0; let m;
    while ((m = p.re.exec(text)) !== null) {
      if (claimedPos.has(m.index + m[0].indexOf(m[1]))) continue; // 数字已被关键词绑定,跳过
      const s = parseInt(m[1], 10);
      if (!seen.has(s)) { seen.add(s); out.push({ seq: s, verdict: p.verdict, raw: m[0] }); }
    }
  }
  return out;
}

function readCursor() { try { return fs.readFileSync(CURSOR_FILE, 'utf8').trim(); } catch (_) { return ''; } }
function writeCursor(id) { try { fs.mkdirSync(APPROVALS_DIR, { recursive: true }); fs.writeFileSync(CURSOR_FILE, String(id || '')); } catch (_) {} }

function fetchChatLines() {
  const sshBase = ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  // 直接读文件(比 API 少依赖 conversation 参数);文件小(仅老板聊天)。
  const out = execFileSync('ssh', [...sshBase, SSH_DEST, `sudo cat ${CHAT_FILE} 2>/dev/null || cat ${CHAT_FILE} 2>/dev/null`], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function applyVerdict(seq, verdict, raw) {
  const f = path.join(APPROVALS_DIR, `${seq}.json`);
  let rec;
  try { rec = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return { seq, applied: false, reason: 'no_such_card' }; }
  if (rec.status !== 'pending') return { seq, applied: false, reason: `already_${rec.status}` }; // 幂等:已决不覆盖
  rec.status = verdict;
  rec.verdict = verdict;
  rec.decided_at = new Date().toISOString();
  rec.decided_raw = String(raw).slice(0, 120);
  fs.writeFileSync(f, JSON.stringify(rec, null, 2));
  return { seq, applied: true, verdict, title: rec.title, cardId: rec.cardId };
}

function emitEvent(data) {
  try {
    const EventLog = require('../../../shared/engine/eventlog');
    const EVENTS = path.resolve(__dirname, '..', 'artifacts', 'engine-events.jsonl');
    new EventLog(EVENTS).emit('yuanxiao.approval.decided', data);
  } catch (_) { /* 事件仅观测,失败不影响主流程 */ }
}

function main() {
  const json = process.argv.includes('--json');
  const cursor = readCursor();
  let lines;
  try { lines = fetchChatLines(); } catch (e) {
    const r = { ok: false, error: String(e.message || e).slice(0, 200) };
    if (json) process.stdout.write(JSON.stringify(r) + '\n'); else console.error('✗ 拉取聊天失败:', r.error);
    process.exit(1);
  }
  // 只看老板手机端消息;增量:cursor 之后的
  const phoneMsgs = lines.filter((m) => String(m.source || '').includes('phone') || String(m.speaker || '') === '主人' || String(m.role || '') === 'user');
  let startIdx = 0;
  if (cursor) { const i = phoneMsgs.findIndex((m) => String(m.id) === cursor); if (i >= 0) startIdx = i + 1; }
  const fresh = phoneMsgs.slice(startIdx);

  const applied = [];
  for (const m of fresh) {
    const text = String(m.text || m.content || '');
    for (const d of parseDecisions(text)) {
      const res = applyVerdict(d.seq, d.verdict, d.raw);
      applied.push(res);
      if (res.applied) emitEvent({ seq: res.seq, cardId: res.cardId, verdict: res.verdict, title: res.title, source: 'yuanxiao-app', at: new Date().toISOString() });
    }
  }
  if (fresh.length) writeCursor(String(fresh[fresh.length - 1].id || cursor));

  const result = { ok: true, scanned_phone_msgs: fresh.length, decisions: applied.filter((a) => a.applied), skipped: applied.filter((a) => !a.applied) };
  if (json) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    if (result.decisions.length) for (const d of result.decisions) console.error(`✓ 决策落地:编号 ${d.seq} → ${d.verdict}(${d.title})`);
    else console.error(`(无新决策;扫描 ${fresh.length} 条手机消息)`);
  }
  process.exit(0);
}

if (require.main === module) main();
module.exports = { parseDecisions, applyVerdict };
