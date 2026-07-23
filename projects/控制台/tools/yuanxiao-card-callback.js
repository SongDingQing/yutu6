#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_APPROVALS_DIR = path.resolve(__dirname, '..', 'artifacts', 'yuanxiao-approvals');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return args;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function findApprovalFile(approvalsDir, cardId) {
  if (!fs.existsSync(approvalsDir)) return '';
  for (const name of fs.readdirSync(approvalsDir)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(approvalsDir, name);
    const record = readJson(file, null);
    if (record && String(record.cardId || '') === cardId) return file;
  }
  return '';
}

function withCallbackLock(approvalsDir, callback) {
  fs.mkdirSync(approvalsDir, { recursive: true });
  const lockFile = path.join(approvalsDir, '.typed-card-callback.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return { ok: false, error: 'callback_busy', retryable: true };
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch (_) {}
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

function applyCardActionUnlocked({ approvalsDir, cardId, action, idempotencyKey }) {
  const cleanCardId = String(cardId || '').trim().slice(0, 160);
  const cleanAction = String(action || '').trim().toLowerCase();
  const cleanKey = String(idempotencyKey || '').trim().slice(0, 220);
  if (!cleanCardId) return { ok: false, error: 'missing_card_id' };
  if (!['approve', 'reject'].includes(cleanAction)) return { ok: false, error: 'unsupported_action' };
  if (!cleanKey) return { ok: false, error: 'missing_idempotency_key' };

  const receiptsFile = path.join(approvalsDir, 'typed-card-actions.json');
  const receipts = readJson(receiptsFile, { schema: 'yuanxiao-typed-card-actions@1', actions: {} });
  receipts.schema = 'yuanxiao-typed-card-actions@1';
  receipts.actions = receipts.actions && typeof receipts.actions === 'object' ? receipts.actions : {};
  const previous = receipts.actions[cleanKey];
  if (previous) {
    const same = previous.card_id === cleanCardId && previous.action === cleanAction;
    return same
      ? { ok: true, applied: false, idempotentReplay: true, cardId: cleanCardId, verdict: previous.verdict }
      : { ok: false, error: 'idempotency_conflict' };
  }

  const approvalFile = findApprovalFile(approvalsDir, cleanCardId);
  if (!approvalFile) return { ok: false, error: 'approval_card_not_found' };
  const record = readJson(approvalFile, null);
  if (!record) return { ok: false, error: 'approval_record_invalid' };
  const verdict = cleanAction === 'approve' ? 'approved' : 'rejected';
  if (record.status !== 'pending' && record.status !== verdict) {
    return { ok: false, error: 'authoritative_decision_conflict', authoritativeVerdict: record.status };
  }
  const decidedAt = record.decided_at || new Date().toISOString();
  record.status = verdict;
  record.verdict = verdict;
  record.decided_at = decidedAt;
  record.decision_source = 'yuanxiao-native-card';
  record.decision_idempotency_key = cleanKey;
  writeJsonAtomic(approvalFile, record);

  receipts.actions[cleanKey] = {
    card_id: cleanCardId,
    action: cleanAction,
    verdict,
    approval_file: path.basename(approvalFile),
    decided_at: decidedAt,
  };
  writeJsonAtomic(receiptsFile, receipts);
  return { ok: true, applied: true, idempotentReplay: false, cardId: cleanCardId, verdict };
}

function applyCardAction({ approvalsDir = DEFAULT_APPROVALS_DIR, cardId, action, idempotencyKey }) {
  return withCallbackLock(approvalsDir, () => applyCardActionUnlocked({
    approvalsDir,
    cardId,
    action,
    idempotencyKey,
  }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = applyCardAction({
    approvalsDir: process.env.YUANXIAO_APPROVALS_DIR || DEFAULT_APPROVALS_DIR,
    cardId: args['card-id'],
    action: args.action,
    idempotencyKey: args['idempotency-key'],
  });
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stderr.write(`${result.ok ? '✓' : '✗'} ${result.ok ? result.verdict : result.error}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { parseArgs, applyCardAction, findApprovalFile, withCallbackLock };
