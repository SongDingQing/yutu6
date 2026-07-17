'use strict';

// Direct-execute 人工完成覆盖的可信入口。
// owner 点击已有 HMAC 决策卡后，server 用仅自身持有的 Ed25519 私钥签发 queue-bound receipt，
// 再只把 receipt id 放进任务；ceo-worker 在 taskId 确定后同时核验签名与已落盘 decision action，
// 最后生成 runFlow 认识的 task-bound receipt。
// 普通 queue payload 里的 actor/source/approved 自称不构成 owner 决策。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DecisionToken = require('./decision-token');

const DECISION_KIND = 'direct_completion_override';
const QUEUE_RECEIPT_SCHEMA = 'yutu6-direct-completion-queue-override@2';
const DIRECT_RECEIPT_SCHEMA = 'yutu6-direct-completion-override@1';
const VERIFICATION = 'hmac-owner-action+ed25519-server-receipt';
const SIGNATURE_ALGORITHM = 'ed25519';
const AUTHORITY_PUBLIC_KEY_ENV = 'YUTU6_DIRECT_COMPLETION_OVERRIDE_PUBLIC_KEY_B64';
const AUTHORITY_PRIVATE_KEY_ENV = 'YUTU6_DIRECT_COMPLETION_OVERRIDE_SIGNING_PRIVATE_KEY_B64';
const SIGNED_RECEIPT_FIELDS = [
  'schema',
  'receiptId',
  'approved',
  'actor',
  'source',
  'verification',
  'signatureAlgorithm',
  'authorityId',
  'decisionCardId',
  'queueAgent',
  'queueId',
  'taskId',
  'reason',
  'approved_at',
];
const DIRECT_OVERRIDE_FIELDS = [
  'schema',
  'approved',
  'actor',
  'source',
  'taskId',
  'reason',
  'approved_at',
  'receiptId',
  'verification',
  'signatureAlgorithm',
  'authorityId',
  'signature',
  'decisionCardId',
  'queueAgent',
  'queueId',
];

function safeId(value) {
  const text = String(value || '').trim();
  return /^[\p{L}\p{N}_.:-]+$/u.test(text) ? text : '';
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw error;
  }
}

function receiptDir(artifactsRoot) {
  return path.join(path.resolve(artifactsRoot), 'direct-completion-overrides');
}

function receiptFile(artifactsRoot, receiptId) {
  const id = safeId(receiptId);
  return id ? path.join(receiptDir(artifactsRoot), `${id}.json`) : null;
}

function requestForCard(card) {
  if (!card || card.decisionKind !== DECISION_KIND) return null;
  const request = card.manualCompletionOverrideRequest
    || card.manual_completion_override_request
    || card.payload && (card.payload.manualCompletionOverrideRequest || card.payload.manual_completion_override_request);
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const reason = String(request.reason || '').trim();
  if (!reason) return null;
  return {
    reason: reason.slice(0, 500),
    taskId: safeId(request.taskId || request.task_id) || null,
  };
}

function createOwnerDecisionCard(options = {}) {
  const artifactsRoot = path.resolve(options.artifactsRoot || '');
  const target = safeId(options.queueAgent || options.target);
  const payload = options.payload && typeof options.payload === 'object' && !Array.isArray(options.payload)
    ? Object.assign({}, options.payload)
    : null;
  const reason = String(options.reason || '').trim();
  if (!target) throw new Error('direct completion override card requires queueAgent');
  if (!payload) throw new Error('direct completion override card requires payload');
  if (!reason) throw new Error('direct completion override card requires reason');
  delete payload.manual_completion_override;
  delete payload.manualCompletionOverride;
  delete payload.manual_completion_override_receipt_id;
  delete payload.manualCompletionOverrideReceiptId;
  const cardId = safeId(options.cardId) || `direct-completion-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const card = {
    kind: 'bulletin',
    decisionKind: DECISION_KIND,
    id: cardId,
    title: String(options.title || '主人确认：人工覆盖 direct-execute 完成门').slice(0, 140),
    desc: String(options.description || `仅在主人已核实交付、确认允许覆盖 done=false 时批准。原因：${reason}`).slice(0, 1200),
    target,
    project: String(options.projectId || payload.projectId || '控制台').slice(0, 80),
    source: 'owner_decision',
    payload,
    manualCompletionOverrideRequest: {
      reason: reason.slice(0, 500),
      taskId: safeId(options.taskId) || null,
    },
    status: 'todo',
    created_at: new Date().toISOString(),
    enabled_at: null,
    queueId: null,
    decisionSecret: DecisionToken.newSecret(),
  };
  const cardsFile = path.join(artifactsRoot, 'bulletin', 'cards.json');
  const cards = readJson(cardsFile, []);
  if (!Array.isArray(cards)) throw new Error('bulletin cards store is invalid');
  if (cards.some(existing => existing && existing.id === card.id)) throw new Error('direct completion override card already exists');
  cards.unshift(card);
  writeJsonAtomic(cardsFile, cards);
  const baseUrl = String(options.baseUrl || 'http://127.0.0.1:41218').replace(/\/+$/, '');
  return {
    card,
    buttons: [
      { label: '批准人工覆盖', url: DecisionToken.buttonUrl(baseUrl, card.id, 'approve', card.decisionSecret) },
      { label: '驳回', url: DecisionToken.buttonUrl(baseUrl, card.id, 'reject', card.decisionSecret) },
    ],
  };
}

function queueReceiptId(queueAgent, queueId, cardId) {
  const digest = crypto.createHash('sha256')
    .update(`${queueAgent}\n${queueId}\n${cardId}`)
    .digest('hex')
    .slice(0, 24);
  return `direct-completion-${digest}`;
}

function publicKeyDer(value) {
  if (!value) return null;
  try {
    const key = value && value.type === 'public'
      ? value
      : crypto.createPublicKey({
        key: Buffer.from(String(value), 'base64'),
        format: 'der',
        type: 'spki',
      });
    return key.export({ format: 'der', type: 'spki' });
  } catch (_) {
    return null;
  }
}

function signingAuthority(privateKeyInput) {
  if (!privateKeyInput) throw new Error('queue-bound override requires server signing key');
  let privateKey;
  try {
    privateKey = privateKeyInput && privateKeyInput.type === 'private'
      ? privateKeyInput
      : crypto.createPrivateKey(privateKeyInput);
  } catch (_) {
    throw new Error('queue-bound override requires valid server signing key');
  }
  const publicDer = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return {
    privateKey,
    authorityId: crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 24),
  };
}

function signedReceiptPayload(receipt) {
  const value = {};
  for (const field of SIGNED_RECEIPT_FIELDS) value[field] = receipt[field] == null ? null : receipt[field];
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function verifyReceiptSignature(receipt, publicKeyInput) {
  const publicDer = publicKeyDer(publicKeyInput);
  if (!publicDer) return { ok: false, reason: '人工覆盖缺少可信服务端验签公钥' };
  const authorityId = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 24);
  if (receipt.signatureAlgorithm !== SIGNATURE_ALGORITHM
    || !safeId(receipt.authorityId)
    || receipt.authorityId !== authorityId
    || !String(receipt.signature || '').trim()) {
    return { ok: false, reason: '人工覆盖服务端签名元数据不可信' };
  }
  try {
    const publicKey = crypto.createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
    const ok = crypto.verify(
      null,
      signedReceiptPayload(receipt),
      publicKey,
      Buffer.from(String(receipt.signature), 'base64url'),
    );
    return ok ? { ok: true } : { ok: false, reason: '人工覆盖服务端签名校验失败' };
  } catch (_) {
    return { ok: false, reason: '人工覆盖服务端签名校验失败' };
  }
}

function matchesCanonicalOverride(expected, canonical) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: '人工覆盖 engine-job 缺少可核验的 canonical override' };
  }
  for (const field of DIRECT_OVERRIDE_FIELDS) {
    if (expected[field] !== canonical[field]) {
      return { ok: false, reason: `人工覆盖 engine-job 字段 ${field} 与持久回执不一致` };
    }
  }
  return { ok: true };
}

function issueQueueBoundReceipt(options = {}) {
  const artifactsRoot = path.resolve(options.artifactsRoot || '');
  const queueAgent = safeId(options.queueAgent);
  const queueId = safeId(options.queueId);
  const card = options.card && typeof options.card === 'object' && !Array.isArray(options.card)
    ? options.card
    : null;
  const decisionCardId = safeId(card && card.id);
  const action = String(options.action || '');
  const token = String(options.decisionToken || options.token || '');
  const request = requestForCard(card);
  const reason = String(request && request.reason || '').trim();
  const taskId = safeId(request && request.taskId) || null;
  const approvedAt = options.approvedAt || new Date().toISOString();
  if (!queueAgent || !queueId || !decisionCardId) throw new Error('queue-bound override requires queueAgent/queueId/decisionCardId');
  if (safeId(card.target) !== queueAgent) throw new Error('queue-bound override card target mismatch');
  if (action !== 'approve'
    || !card.decisionSecret
    || !DecisionToken.verify(card.decisionSecret, decisionCardId, action, token)) {
    throw new Error('queue-bound override requires verified owner HMAC decision');
  }
  if (!reason) throw new Error('queue-bound override requires reason');
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error('queue-bound override requires valid approvedAt');
  const authority = signingAuthority(options.signingPrivateKey);
  const receiptId = queueReceiptId(queueAgent, queueId, decisionCardId);
  const receipt = {
    schema: QUEUE_RECEIPT_SCHEMA,
    receiptId,
    approved: true,
    actor: 'owner',
    source: 'owner_decision',
    verification: VERIFICATION,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    authorityId: authority.authorityId,
    decisionCardId,
    queueAgent,
    queueId,
    taskId,
    reason: reason.slice(0, 500),
    approved_at: approvedAt,
  };
  receipt.signature = crypto.sign(null, signedReceiptPayload(receipt), authority.privateKey).toString('base64url');
  const file = receiptFile(artifactsRoot, receiptId);
  const existing = readJson(file, null);
  if (existing) {
    const stable = SIGNED_RECEIPT_FIELDS.concat(['signature']);
    if (stable.some(key => existing[key] !== receipt[key])) throw new Error('queue-bound override receipt conflict');
    return { receipt: existing, receiptFile: file, already: true };
  }
  writeJsonAtomic(file, receipt);
  return { receipt, receiptFile: file, already: false };
}

function resolveForTask(options = {}) {
  const receiptId = safeId(options.receiptId);
  const queueAgent = safeId(options.queueAgent);
  const queueId = safeId(options.queueId);
  const taskId = safeId(options.taskId);
  if (!receiptId) return { ok: false, reason: '人工覆盖缺少合法 receiptId' };
  if (!queueAgent || !queueId || !taskId) return { ok: false, reason: '人工覆盖缺少当前 queue/task 身份' };
  const file = receiptFile(options.artifactsRoot, receiptId);
  const receipt = file && readJson(file, null);
  if (!receipt) return { ok: false, reason: '人工覆盖持久回执不存在', receiptId };
  if (receipt.schema !== QUEUE_RECEIPT_SCHEMA
    || receipt.approved !== true
    || receipt.actor !== 'owner'
    || receipt.source !== 'owner_decision'
    || receipt.verification !== VERIFICATION) {
    return { ok: false, reason: '人工覆盖持久回执来源不可信', receiptId };
  }
  const signature = verifyReceiptSignature(
    receipt,
    options.authorityPublicKey || process.env[AUTHORITY_PUBLIC_KEY_ENV],
  );
  if (!signature.ok) return { ok: false, reason: signature.reason, receiptId };
  if (receipt.receiptId !== receiptId) return { ok: false, reason: '人工覆盖 receiptId 内容不一致', receiptId };
  if (queueReceiptId(receipt.queueAgent, receipt.queueId, receipt.decisionCardId) !== receiptId) {
    return { ok: false, reason: '人工覆盖 receiptId 与队列绑定摘要不一致', receiptId };
  }
  if (receipt.queueAgent !== queueAgent || receipt.queueId !== queueId) {
    return { ok: false, reason: '人工覆盖回执与当前 queueAgent/queueId 不一致', receiptId };
  }
  if (receipt.taskId && receipt.taskId !== taskId) {
    return { ok: false, reason: '人工覆盖回执 taskId 与当前任务不一致', receiptId };
  }
  if (!safeId(receipt.decisionCardId)) return { ok: false, reason: '人工覆盖回执缺少 decisionCardId', receiptId };
  if (!String(receipt.reason || '').trim()) return { ok: false, reason: '人工覆盖回执缺少 reason', receiptId };
  if (!Number.isFinite(Date.parse(receipt.approved_at || ''))) return { ok: false, reason: '人工覆盖回执缺少有效 approved_at', receiptId };
  const actionsFile = path.join(path.resolve(options.artifactsRoot || ''), 'bulletin', 'decision-actions.json');
  const actions = readJson(actionsFile, {});
  const decision = actions && typeof actions === 'object' && !Array.isArray(actions)
    ? actions[receipt.decisionCardId]
    : null;
  if (!decision
    || decision.action !== 'approve'
    || decision.decisionKind !== DECISION_KIND
    || decision.via !== 'feishu-card'
    || decision.verification !== 'hmac-sha256-decision-card'
    || decision.receiptId !== receiptId
    || decision.queueId !== queueId
    || decision.target !== queueAgent
    || decision.at !== receipt.approved_at
    || decision.receiptAuthorityId !== receipt.authorityId
    || decision.receiptSignature !== receipt.signature) {
    return { ok: false, reason: '人工覆盖缺少匹配的已落盘主人 decision action', receiptId };
  }
  const override = {
    schema: DIRECT_RECEIPT_SCHEMA,
    approved: true,
    actor: 'owner',
    source: 'owner_decision',
    taskId,
    reason: String(receipt.reason).slice(0, 500),
    approved_at: receipt.approved_at,
    receiptId,
    verification: receipt.verification,
    signatureAlgorithm: receipt.signatureAlgorithm,
    authorityId: receipt.authorityId,
    signature: receipt.signature,
    decisionCardId: receipt.decisionCardId,
    queueAgent,
    queueId,
  };
  if (options.expectedOverride) {
    const canonical = matchesCanonicalOverride(options.expectedOverride, override);
    if (!canonical.ok) return { ok: false, reason: canonical.reason, receiptId };
  }
  return { ok: true, receiptId, receiptFile: file, override };
}

module.exports = {
  DECISION_KIND,
  QUEUE_RECEIPT_SCHEMA,
  DIRECT_RECEIPT_SCHEMA,
  VERIFICATION,
  SIGNATURE_ALGORITHM,
  AUTHORITY_PUBLIC_KEY_ENV,
  AUTHORITY_PRIVATE_KEY_ENV,
  createOwnerDecisionCard,
  issueQueueBoundReceipt,
  requestForCard,
  resolveForTask,
  receiptFile,
};
