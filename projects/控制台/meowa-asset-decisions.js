'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const DecisionToken = require('./decision-token');

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ARTIFACTS_ROOT = path.join(__dirname, 'artifacts');
const NOTIFY_SCRIPT = path.resolve(__dirname, '../../shared/agents/ui-optimizer/notify-feishu.sh');
const SOURCE = 'meowa-asset-review';
const KIND = 'meowa_asset';

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data == null ? fallback : data;
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function safeId(value, label = 'id') {
  const raw = String(value || '').trim();
  if (!raw || !/^[A-Za-z0-9_.-]{1,120}$/.test(raw)) {
    throw new Error(`bad ${label}`);
  }
  return raw;
}

function compact(value, limit = 600) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function resolveWorkspacePath(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('path required');
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(WORKSPACE_ROOT, raw));
}

function displayPath(abs) {
  const rel = path.relative(WORKSPACE_ROOT, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs;
}

function ledgerPath(artifactsRoot = DEFAULT_ARTIFACTS_ROOT) {
  return path.join(path.resolve(artifactsRoot), 'meowa', 'asset-decisions', 'ledger.json');
}

function bulletinPath(artifactsRoot = DEFAULT_ARTIFACTS_ROOT) {
  return path.join(path.resolve(artifactsRoot), 'bulletin', 'cards.json');
}

function readLedger(artifactsRoot = DEFAULT_ARTIFACTS_ROOT) {
  const file = ledgerPath(artifactsRoot);
  const ledger = readJson(file, null);
  if (ledger && typeof ledger === 'object' && !Array.isArray(ledger)) {
    if (!ledger.assets || typeof ledger.assets !== 'object' || Array.isArray(ledger.assets)) ledger.assets = {};
    if (!ledger.version) ledger.version = 1;
    return ledger;
  }
  return { version: 1, updated_at: null, assets: {} };
}

function writeLedger(artifactsRoot, ledger) {
  ledger.updated_at = nowIso();
  writeJsonAtomic(ledgerPath(artifactsRoot), ledger);
}

function decisionBaseUrl(baseUrl) {
  return String(baseUrl || process.env.CONSOLE_DECISION_BASE || process.env.CONSOLE_API_BASE || 'http://127.0.0.1:41218').replace(/\/+$/, '');
}

function buildCardId(assetId, explicit) {
  if (explicit) return safeId(explicit, 'cardId');
  return `meowa-${safeId(assetId, 'assetId')}`;
}

function formatFivePartReport(input) {
  const title = compact(input.title || input.assetTitle || input.assetId || 'Meowa 生成物审核', 120);
  const cause = compact(input.cause || input.reason || 'Meowa 生成后进入老板采纳审核,未采纳不得接入。', 500);
  const source = compact(input.source || input.assetSource || 'Meowa 生成产物', 500);
  const progress = compact(input.progress || '生成物已落到 pending/审计路径,等待老板拍板。', 500);
  const result = compact(input.result || '当前状态: pending,尚未接入正式素材目录。', 500);
  const decisionItem = compact(input.decisionItem || '请老板选择: 采纳=接入正式路径; 不采纳=弃用/重做。', 500);
  return [
    `标题: ${title}`,
    `起因: ${cause}`,
    `来源: ${source}`,
    `进展: ${progress}`,
    `结果: ${result}`,
    `决策项: ${decisionItem}`,
  ].join('\n');
}

function normalizeGeneratedPaths(paths) {
  const arr = Array.isArray(paths) ? paths : (paths ? [paths] : []);
  return arr.map(p => {
    const abs = resolveWorkspacePath(p);
    return {
      path: displayPath(abs),
      absPath: abs,
      exists: fs.existsSync(abs),
    };
  });
}

function normalizeApprovedOutputs(outputs) {
  const arr = Array.isArray(outputs) ? outputs : [];
  return arr.map((item, idx) => {
    if (!item || typeof item !== 'object') throw new Error(`approvedOutputs[${idx}] must be object`);
    const fromAbs = resolveWorkspacePath(item.from || item.source || item.path);
    const toAbs = resolveWorkspacePath(item.to || item.dest || item.destination);
    return {
      from: displayPath(fromAbs),
      to: displayPath(toAbs),
      fromAbs,
      toAbs,
      copied: false,
    };
  });
}

function notificationForCard({ cardId, secret, baseUrl, title, body }) {
  const base = decisionBaseUrl(baseUrl);
  return {
    title: `【需拍板】Meowa 生成物审核: ${compact(title || cardId, 36)}`,
    body,
    extra: {
      type: 'decision',
      buttons: [
        { label: '采纳', url: DecisionToken.buttonUrl(base, cardId, 'approve', secret) },
        { label: '不采纳', url: DecisionToken.buttonUrl(base, cardId, 'reject', secret) },
      ],
    },
  };
}

function sendNotifyFeishu({ title, body, extra, dryRun }) {
  const buttons = (extra.buttons || []).map(b => `${b.label}|${b.url}`).join(';;');
  const env = Object.assign({}, process.env);
  if (dryRun) env.FEISHU_DRY_RUN = '1';
  const result = spawnSync('bash', [
    NOTIFY_SCRIPT,
    '--type', 'decision',
    '--title', title,
    '--body', body,
    '--buttons', buttons,
  ], {
    cwd: WORKSPACE_ROOT,
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  return {
    attempted: true,
    sent: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function registerAssetDecision(spec, opts = {}) {
  const artifactsRoot = path.resolve(opts.artifactsRoot || spec.artifactsRoot || DEFAULT_ARTIFACTS_ROOT);
  const assetId = safeId(spec.assetId, 'assetId');
  const cardId = buildCardId(assetId, spec.cardId);
  const title = compact(spec.title || spec.assetTitle || assetId, 120);
  const reportBody = formatFivePartReport(Object.assign({}, spec, { title }));
  const generatedPaths = normalizeGeneratedPaths(spec.generatedPaths || spec.outputPaths || spec.pendingPaths);
  const approvedOutputs = normalizeApprovedOutputs(spec.approvedOutputs || spec.integrations || []);
  const cardsFile = bulletinPath(artifactsRoot);
  const cards = readJson(cardsFile, []);
  const existingCard = cards.find(c => c && c.id === cardId) || null;
  const secret = existingCard && existingCard.decisionSecret ? existingCard.decisionSecret : DecisionToken.newSecret();
  const createdAt = spec.created_at || nowIso();
  const card = Object.assign({}, existingCard || {}, {
    id: cardId,
    title: `Meowa 生成物待审核: ${title}`.slice(0, 140),
    desc: 'Meowa 生成物逐个审核: 采纳才接入正式路径,不采纳则弃用/重做。',
    target: 'ceo',
    project: spec.projectId || '控制台',
    source: SOURCE,
    decisionKind: KIND,
    assetId,
    payload: {
      role: 'orchestrator',
      flowId: 'meowa-asset-decision',
      projectId: spec.projectId || '控制台',
      assetId,
      decisionKind: KIND,
      generatedPaths: generatedPaths.map(p => p.path),
      approvedOutputs: approvedOutputs.map(o => ({ from: o.from, to: o.to })),
      report: {
        title,
        cause: compact(spec.cause || spec.reason || ''),
        source: compact(spec.source || spec.assetSource || ''),
        progress: compact(spec.progress || ''),
        result: compact(spec.result || ''),
        decisionItem: compact(spec.decisionItem || ''),
      },
    },
    status: 'todo',
    created_at: existingCard && existingCard.created_at || createdAt,
    enabled_at: null,
    queueId: null,
    decisionSecret: secret,
  });
  if (existingCard) {
    const idx = cards.findIndex(c => c && c.id === cardId);
    cards[idx] = card;
  } else {
    cards.unshift(card);
  }
  writeJsonAtomic(cardsFile, cards);

  const ledger = readLedger(artifactsRoot);
  const existing = ledger.assets[assetId] || {};
  if (existing.status && existing.status !== 'pending') {
    throw new Error(`asset ${assetId} already ${existing.status}`);
  }
  ledger.assets[assetId] = Object.assign({}, existing, {
    assetId,
    status: 'pending',
    cardId,
    title,
    report: {
      body: reportBody,
      title,
      cause: compact(spec.cause || spec.reason || ''),
      source: compact(spec.source || spec.assetSource || ''),
      progress: compact(spec.progress || ''),
      result: compact(spec.result || ''),
      decisionItem: compact(spec.decisionItem || ''),
    },
    generatedPaths,
    approvedOutputs,
    review: null,
    processingResult: 'pending_owner_decision',
    created_at: existing.created_at || createdAt,
    updated_at: nowIso(),
  });
  writeLedger(artifactsRoot, ledger);

  const notification = notificationForCard({ cardId, secret, baseUrl: opts.baseUrl || spec.baseUrl, title, body: reportBody });
  const notifyResult = opts.notify
    ? opts.notify(notification.title, notification.body, notification.extra)
    : sendNotifyFeishu(Object.assign({}, notification, { dryRun: opts.dryRun || spec.dryRun }));
  return { ok: true, asset: ledger.assets[assetId], card, notification, notifyResult, ledgerFile: ledgerPath(artifactsRoot), bulletinFile: cardsFile };
}

function isMeowaAssetCard(card) {
  return !!(card && (
    card.source === SOURCE ||
    card.decisionKind === KIND ||
    card.assetId ||
    (card.payload && card.payload.decisionKind === KIND)
  ));
}

function findAssetByCard(ledger, card) {
  const direct = card && (card.assetId || (card.payload && card.payload.assetId));
  if (direct && ledger.assets[direct]) return ledger.assets[direct];
  const cardId = card && card.id;
  return Object.values(ledger.assets).find(asset => asset && asset.cardId === cardId) || null;
}

function copyFileAtomic(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`generated asset missing: ${displayPath(src)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

function applyDecision({ artifactsRoot = DEFAULT_ARTIFACTS_ROOT, card, action, eventlog, now = nowIso() }) {
  if (!isMeowaAssetCard(card)) return { ok: false, error: 'not meowa asset card' };
  if (action !== 'approve' && action !== 'reject') return { ok: false, error: 'bad action' };
  const ledger = readLedger(artifactsRoot);
  const asset = findAssetByCard(ledger, card);
  if (!asset) return { ok: false, error: 'asset ledger entry not found' };
  if (asset.status !== 'pending') return { ok: true, already: true, asset };

  let copied = [];
  if (action === 'approve') {
    copied = (asset.approvedOutputs || []).map(output => {
      const fromAbs = resolveWorkspacePath(output.fromAbs || output.from);
      const toAbs = resolveWorkspacePath(output.toAbs || output.to);
      copyFileAtomic(fromAbs, toAbs);
      return { from: displayPath(fromAbs), to: displayPath(toAbs) };
    });
    asset.status = 'approved';
    asset.processingResult = copied.length ? 'approved_and_integrated' : 'approved_no_integration_target';
  } else {
    asset.status = 'rejected';
    asset.processingResult = 'rejected_not_integrated';
  }
  asset.review = {
    action,
    conclusion: action === 'approve' ? '采纳' : '不采纳',
    at: now,
    reason: action === 'approve' ? 'owner_approved_via_feishu_decision_card' : 'owner_rejected_via_feishu_decision_card',
  };
  asset.integration = {
    copied,
    count: copied.length,
    at: action === 'approve' ? now : null,
  };
  asset.updated_at = now;
  ledger.assets[asset.assetId] = asset;
  writeLedger(artifactsRoot, ledger);

  if (eventlog && typeof eventlog.emit === 'function') {
    eventlog.emit('meowa.asset.decision', {
      assetId: asset.assetId,
      cardId: asset.cardId,
      action,
      status: asset.status,
      copied: copied.map(item => item.to),
      processingResult: asset.processingResult,
      via: 'feishu-card',
    });
  }
  return { ok: true, asset, copied };
}

module.exports = {
  SOURCE,
  KIND,
  registerAssetDecision,
  applyDecision,
  isMeowaAssetCard,
  readLedger,
  ledgerPath,
  bulletinPath,
  formatFivePartReport,
  notificationForCard,
  _test: {
    resolveWorkspacePath,
    displayPath,
    normalizeGeneratedPaths,
    normalizeApprovedOutputs,
  },
};
