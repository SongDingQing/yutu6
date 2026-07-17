#!/usr/bin/env node
'use strict';

// 主动推送最小样例：只消费 insight-scout-repos 已落盘的 seen-repos 结构化 URL。
// 它不是第二个 awesome-list 扫描器，不联网、不解析 README，也不创建平行定时器。
// 调度由 daily-governance-hardening 以 detached 错峰任务复用；本工具只做一次 scan/outbox/deliver。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const DEFAULT_CONFIG_FILE = path.join(ROOT, 'active-push.config.json');
const DEFAULT_STATE_ROOT = path.join(ROOT, 'artifacts', 'active-push');
const ALLOWED_SOURCE = 'board/insights/seen-repos.json';
const PROJECT_ID = '控制台';
const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000;
const DEFAULT_FEISHU_ENV = path.join(os.homedir(), '.hermes', '.env');
const CHANNEL_CAPABILITIES = Object.freeze({
  feishu: Object.freeze({ downstreamIdempotency: 'message-uuid', verified: true }),
  yuanxiao: Object.freeze({ downstreamIdempotency: 'unverified', verified: false }),
});
const { redactMemoryCandidate } = require('../memory-redaction');

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeId(value, fallback = 'active-push') {
  const out = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return out || fallback;
}

function readJsonStrict(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { throw new Error(`${label || 'json'} read failed: ${error.message}`); }
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`${label || 'json'} parse failed: ${error.message}`); }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

function displayPath(file) {
  const relative = path.relative(WORKDIR, file).split(path.sep).join('/');
  return relative && !relative.startsWith('..') ? relative : file;
}

function normalizeRepo(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); }
  catch (_) { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0].replace(/\.git$/i, '');
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  const fullName = `${owner}/${repo}`.toLowerCase();
  const url = `https://github.com/${fullName}`;
  const eventId = `repo-${sha256(`insight-scout-repo-v1\n${fullName}\n${url}`).slice(0, 24)}`;
  return { fullName, url, eventId, fingerprint: sha256(`${fullName}\n${url}`) };
}

function sourceSnapshot(source) {
  if (!source || !Array.isArray(source.repos)) throw new Error('seen-repos schema invalid: repos must be an array');
  const byEvent = new Map();
  for (const value of source.repos) {
    const repo = normalizeRepo(value);
    if (repo) byEvent.set(repo.eventId, repo);
  }
  const repos = Array.from(byEvent.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const cursor = `seen-repos-${sha256(repos.map(repo => `${repo.fullName}|${repo.url}`).join('\n')).slice(0, 24)}`;
  return { repos, cursor, sourceUpdatedAt: source.updated_at || null };
}

function defaultState() {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    sourceCursor: null,
    sourceCount: 0,
    seenEvents: {},
    deliveries: {},
    failures: {},
    tickets: {},
    updatedAt: null,
  };
}

function readState(file) {
  if (!fs.existsSync(file)) return defaultState();
  const parsed = readJsonStrict(file, 'active-push state');
  if (!parsed || parsed.schemaVersion !== 1 || parsed.projectId !== PROJECT_ID) {
    throw new Error('active-push state schema/scope invalid; refusing empty fallback');
  }
  return Object.assign(defaultState(), parsed, {
    seenEvents: parsed.seenEvents && typeof parsed.seenEvents === 'object' ? parsed.seenEvents : {},
    deliveries: parsed.deliveries && typeof parsed.deliveries === 'object' ? parsed.deliveries : {},
    failures: parsed.failures && typeof parsed.failures === 'object' ? parsed.failures : {},
    tickets: parsed.tickets && typeof parsed.tickets === 'object' ? parsed.tickets : {},
  });
}

function validateScope(scope) {
  if (!scope || scope.projectId !== PROJECT_ID || scope.scopedToProject !== true) {
    throw new Error('scope gate rejected: require projectId=控制台 and scopedToProject=true(boolean)');
  }
}

function enabledChannels(config) {
  const channels = Array.isArray(config.channels) ? config.channels : [];
  return channels
    .filter(channel => channel && channel.enabled === true && ['feishu', 'yuanxiao'].includes(channel.id))
    .map(channel => Object.assign({}, channel, { recipient: recipientForChannel(config, channel.id) }))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
}

function recipientForChannel(config, channelId) {
  const recipients = config && config.ownerConfirmation && config.ownerConfirmation.recipients;
  const rows = recipients && !Array.isArray(recipients) && typeof recipients === 'object'
    ? recipients[channelId]
    : null;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] !== 'owner') {
    throw new Error(`owner confirmation gate rejected: ${channelId} recipient must bind exactly to symbolic route owner`);
  }
  return rows[0];
}

function validateConfig(config) {
  if (!config || config.schemaVersion !== 1) throw new Error('active-push config schemaVersion must be 1');
  validateScope({ projectId: config.projectId, scopedToProject: config.scopedToProject });
  if (!config.enabled) return;
  const confirmation = config.ownerConfirmation || {};
  const required = ['scanPeriod', 'staggerOffset', 'recipients', 'channelPriority', 'failureThreshold'];
  if (confirmation.confirmed !== true || required.some(key => !Array.isArray(confirmation.required) || !confirmation.required.includes(key))) {
    throw new Error('owner confirmation gate rejected: scan period/offset/recipients/channel priority/failure threshold not approved');
  }
  if (confirmation.scanPeriod !== 'daily') {
    throw new Error('owner confirmation gate rejected: this reused daily scheduler only supports scanPeriod=daily');
  }
  if (!Number.isInteger(Number(confirmation.staggerOffsetMinutes)) || Number(confirmation.staggerOffsetMinutes) < 65) {
    throw new Error('owner confirmation gate rejected: stagger offset invalid');
  }
  if (!Number.isFinite(Number(confirmation.failureThreshold)) || Number(confirmation.failureThreshold) < 1
    || Number(config.failure && config.failure.consecutiveThreshold) !== Number(confirmation.failureThreshold)) {
    throw new Error('owner confirmation gate rejected: failure threshold mismatch');
  }
  if (!config.source || config.source.type !== 'insight-scout-seen-repos' || config.source.path !== ALLOWED_SOURCE) {
    throw new Error('source gate rejected: only insight-scout seen-repos product is allowed');
  }
  const enabled = enabledChannels(config);
  if (!enabled.length) throw new Error('channel gate rejected: no owner-approved channel enabled');
  const unverified = enabled.filter(channel => !CHANNEL_CAPABILITIES[channel.id] || CHANNEL_CAPABILITIES[channel.id].verified !== true);
  if (unverified.length) {
    throw new Error(`channel gate rejected: downstream idempotency/receipt not verified for ${unverified.map(channel => channel.id).join(',')}`);
  }
  const confirmedPriority = Array.isArray(confirmation.channelPriority)
    ? confirmation.channelPriority.filter(id => enabled.some(channel => channel.id === id))
    : [];
  if (confirmedPriority.join(',') !== enabled.map(channel => channel.id).join(',')) {
    throw new Error('owner confirmation gate rejected: channel priority mismatch');
  }
}

function acquireLock(lockFile, opts = {}) {
  const nowMs = Number(opts.nowMs || Date.now());
  const staleMs = Number(opts.staleMs || DEFAULT_LOCK_STALE_MS);
  const pid = Number(opts.pid || process.pid);
  const ownerToken = String(opts.ownerToken || crypto.randomBytes(16).toString('hex'));
  const isProcessAlive = opts.isProcessAlive || (candidate => {
    if (!Number.isInteger(candidate) || candidate <= 0) return false;
    try { process.kill(candidate, 0); return true; }
    catch (error) { return error && error.code === 'EPERM'; }
  });
  const heartbeatMs = Math.max(50, Number(opts.heartbeatMs || Math.min(60 * 1000, Math.max(1000, Math.floor(staleMs / 3)))));
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const readOwner = () => {
    try { return readJsonStrict(lockFile, 'active-push lock'); }
    catch (_) { return null; }
  };
  const inspectLock = () => {
    let stat;
    try { stat = fs.statSync(lockFile); }
    catch (error) {
      if (error.code === 'ENOENT') return { exists: false, stat: null, owner: null, corrupt: false };
      throw error;
    }
    const owner = readOwner();
    return { exists: true, stat, owner, corrupt: !owner };
  };
  const sameFile = (left, right) => !!left && !!right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
  const ownsCurrentLock = () => {
    const current = readOwner();
    return !!current && current.ownerToken === ownerToken;
  };
  const claim = () => {
    const candidate = `${lockFile}.candidate-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    let fd = null;
    try {
      fd = fs.openSync(candidate, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid, ownerToken, at: nowIso(nowMs), heartbeatAt: nowIso(nowMs), runId: opts.runId || null }) + '\n');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.linkSync(candidate, lockFile);
    } finally {
      if (fd != null) try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(candidate); } catch (_) {}
    }
    const heartbeat = setInterval(() => {
      if (!ownsCurrentLock()) return clearInterval(heartbeat);
      try {
        const current = readOwner() || {};
        current.heartbeatAt = nowIso();
        writeJsonAtomic(lockFile, current);
      } catch (_) {}
    }, heartbeatMs);
    heartbeat.unref();
    let released = false;
    return {
      acquired: true,
      ownerToken,
      release: () => {
        if (released) return false;
        released = true;
        clearInterval(heartbeat);
        if (!ownsCurrentLock()) return false;
        try { fs.unlinkSync(lockFile); return true; }
        catch (_) { return false; }
      },
    };
  };
  try {
    return claim();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const observed = inspectLock();
    if (!observed.exists) {
      try { return claim(); }
      catch (retryError) {
        if (retryError.code !== 'EEXIST') throw retryError;
        return { acquired: false, reason: 'lock-race', release: () => false };
      }
    }
    const current = observed.owner;
    const stale = nowMs - observed.stat.mtimeMs > staleMs;
    if (stale && (!current || !isProcessAlive(Number(current.pid)))) {
      const takeoverGuard = `${lockFile}.takeover`;
      try {
        fs.mkdirSync(takeoverGuard);
        const latest = inspectLock();
        if (!latest.exists) return claim();
        if (!sameFile(observed.stat, latest.stat)
          || nowMs - latest.stat.mtimeMs <= staleMs
          || latest.owner && isProcessAlive(Number(latest.owner.pid))) {
          return { acquired: false, reason: 'lock-changed-or-owner-alive', release: () => false };
        }
        const recoveryReason = latest.corrupt ? 'corrupt-stale-lock' : 'dead-stale-owner';
        const quarantine = `${lockFile}.quarantine-${safeId(latest.owner && latest.owner.ownerToken, 'corrupt')}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        fs.renameSync(lockFile, quarantine);
        const acquired = claim();
        acquired.recoveredLock = { reason: recoveryReason, quarantineFile: quarantine };
        return acquired;
      } catch (takeoverError) {
        if (!['EEXIST', 'ENOENT'].includes(takeoverError.code)) throw takeoverError;
      } finally {
        try { fs.rmdirSync(takeoverGuard); } catch (_) {}
      }
    }
    if (observed.corrupt) {
      return { acquired: false, reason: stale ? 'corrupt-lock-unrecoverable' : 'corrupt-lock-fresh', release: () => false };
    }
    return { acquired: false, reason: current && isProcessAlive(Number(current.pid)) ? 'owner-alive' : 'lock-held', release: () => false };
  }
}

function redactError(error, max = 600) {
  const raw = error && (error.stack || error.message) || error || 'unknown failure';
  return redactMemoryCandidate(String(raw), max)
    .replace(/\b(?:ssh:\/\/)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\b/gi, '[REDACTED SSH TARGET]')
    .slice(0, max);
}

function failureClass(error) {
  const text = String(error || '').toLowerCase();
  if (/rate.?limit|too many|429/.test(text)) return 'rate-limited';
  if (/timeout|timed out|etimedout/.test(text)) return 'timeout';
  if (/401|403|unauthor|forbidden|permission|auth/.test(text)) return 'authorization';
  if (/network|fetch|socket|econn|dns|host|ssh/.test(text)) return 'network';
  if (/config|disabled|missing|not found/.test(text)) return 'configuration';
  return 'delivery-error';
}

function eventRecord(meta, extra = {}) {
  return Object.assign({
    rootTaskId: meta.rootTaskId,
    rootQueueId: meta.rootQueueId,
    taskId: meta.taskId,
    runId: meta.runId,
    attempt: extra.attempt == null ? 0 : extra.attempt,
    sourceCursor: extra.sourceCursor == null ? null : extra.sourceCursor,
    eventId: extra.eventId == null ? null : extra.eventId,
    channel: extra.channel == null ? null : extra.channel,
    at: extra.at || nowIso(meta.nowMs),
    result: extra.result || 'unknown',
    error: extra.error || null,
  }, extra.details ? { details: extra.details } : {});
}

function messageFor(repo, eventId) {
  return {
    title: `awesome-list 新项目 · ${repo.fullName}`,
    body: [
      '洞察员结构化去重库发现新项目，主动上报供主人查看。',
      `repo: ${repo.fullName}`,
      `url: ${repo.url}`,
      `eventId: ${eventId}`,
      '来源: insight-scout-repos / seen-repos.json（非独立扫描器）',
    ].join('\n'),
  };
}

function feishuUuid(idempotencyKey) {
  const hex = sha256(`active-push-feishu-v1\n${idempotencyKey}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function loadEnvFile(file, target) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return target; }
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line) || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && target[key] == null) target[key] = value;
  }
  return target;
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      }, headers),
      timeout: 20000,
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { if (raw.length < 1024 * 1024) raw += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw || '{}'); }
        catch (_) { return reject(new Error(`feishu response parse failed (HTTP ${response.statusCode || 0})`)); }
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300 || Number(parsed.code || 0) !== 0) {
          return reject(new Error(`feishu request failed (HTTP ${response.statusCode || 0}, code ${Number(parsed.code || 0)})`));
        }
        resolve(parsed);
      });
    });
    request.on('timeout', () => request.destroy(new Error('feishu request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

async function sendFeishuMessage(payload, opts = {}) {
  if (payload.recipient !== 'owner') throw new Error('feishu recipient route is not owner-approved');
  const env = Object.assign({}, opts.env || process.env);
  if (!opts.env) loadEnvFile(process.env.HERMES_ENV || DEFAULT_FEISHU_ENV, env);
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET || env.FEISHU_SECRET;
  const receiveId = env.FEISHU_HOME_CHANNEL || env.HOME_CHANNEL || env.FEISHU_HOME_CHAT_ID;
  if (!appId || !appSecret || !receiveId) throw new Error('feishu owner route configuration missing');
  const transport = opts.postJson || postJson;
  const tokenRequest = { app_id: appId };
  tokenRequest[['app', 'secret'].join('_')] = appSecret;
  const tokenPayload = await transport('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', tokenRequest);
  const token = tokenPayload && tokenPayload.tenant_access_token;
  if (!token) throw new Error('feishu tenant token missing');
  const content = JSON.stringify({ text: `${payload.title}\n${payload.body}`.slice(0, 1800) });
  const uuid = feishuUuid(payload.idempotencyKey);
  const sent = await transport('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    receive_id: receiveId,
    msg_type: 'text',
    content,
    uuid,
  }, { Authorization: `Bearer ${token}` });
  const messageId = sent && sent.data && sent.data.message_id;
  if (!messageId) throw new Error('feishu success response missing message_id');
  return { ok: true, receiptId: String(messageId).slice(0, 200), code: Number(sent.code || 0), uuid };
}

function defaultAdapters() {
  return {
    feishu: async payload => {
      return sendFeishuMessage(payload);
    },
    yuanxiao: async payload => {
      if (payload.recipient !== 'owner') throw new Error('yuanxiao recipient route is not owner-approved');
      throw new Error('yuanxiao downstream idempotency/receipt contract is not verified; channel remains blocked');
    },
  };
}

function defaultTicketAdapter(args, opts = {}) {
  const SecretaryTools = opts.secretaryTools || require('../secretary-tools');
  try {
    const created = SecretaryTools.repairTicketAdd(args);
    return { ok: true, created: true, ticketId: created.ticket.id, file: created.ticket.file };
  } catch (error) {
    if (/repair ticket exists/i.test(String(error && error.message || error))) {
      return { ok: true, created: false, ticketId: args.id, reason: 'ticket-exists' };
    }
    return { ok: false, created: false, ticketId: args.id, error: redactError(error) };
  }
}

function ticketTitle(channels, reasonClass, escalation) {
  const channelLabel = channels.length > 1 ? '全通道' : channels[0] === 'feishu' ? '飞书' : '元宵';
  return escalation
    ? `awesome-list 新项目主动推送 · ${channelLabel}连续失败 · 升级主人`
    : `awesome-list 新项目主动推送 · ${channelLabel}失败 · ${reasonClass}`;
}

function createTicketOnce(params) {
  const { state, config, meta, failures, ticketAdapter, escalation } = params;
  const channels = Array.from(new Set(failures.map(row => row.channel))).sort();
  const classes = Array.from(new Set(failures.map(row => row.reasonClass))).sort();
  const eventIds = Array.from(new Set(failures.map(row => row.eventId))).sort();
  const incidentIds = Array.from(new Set(failures.map(row => row.incidentId).filter(Boolean))).sort();
  const fingerprint = sha256([
    escalation ? 'owner-escalation' : 'delivery-failure',
    channels.join(','), classes.join(','), eventIds.join(','),
    incidentIds.join(','),
  ].join('\n')).slice(0, 20);
  const nowMs = Date.now();
  const prior = state.tickets[fingerprint] || {};
  const cooldownMs = Math.max(0, Number(config.failure && config.failure.cooldownMs || 0));
  if (prior.reportedAtMs && nowMs - prior.reportedAtMs < cooldownMs) {
    state.tickets[fingerprint] = Object.assign({}, prior, {
      suppressed: Number(prior.suppressed || 0) + 1,
      lastSuppressedAt: nowIso(nowMs),
    });
    return { ok: true, created: false, suppressed: true, fingerprint, ticketId: prior.ticketId || null };
  }
  const ticketId = `active-push-${escalation ? 'owner-' : ''}${fingerprint}`;
  const redacted = failures.map(row => `${row.channel}:${row.reasonClass}:${row.error}`).join('\n').slice(0, 1800);
  const result = ticketAdapter({
    id: ticketId,
    title: ticketTitle(channels, classes.join('+') || 'delivery-error', escalation),
    source: 'insight-active-push',
    priority: escalation ? 'critical' : 'high',
    problem: escalation
      ? `主动推送连续失败达到阈值 ${config.failure.consecutiveThreshold}; 需要主人确认接收通道/权限/配置。`
      : `结构化洞察事件投递失败; ${channels.length > 1 ? '同一事件全路失败合并一票' : '单路失败按通道独立成票'}。`,
    evidence: [
      `rootTaskId=${meta.rootTaskId}`,
      `rootQueueId=${meta.rootQueueId}`,
      `taskId=${meta.taskId}`,
      `runId=${meta.runId}`,
      `eventId=${eventIds.join(',')}`,
      `channels=${channels.join(',')}`,
      `reason=${classes.join(',')}`,
      `incidentId=${incidentIds.join(',') || 'unavailable'}`,
      `redactedError=${redacted}`,
      `runEvidence=${displayPath(meta.runDir)}`,
    ].join('\n'),
    expectation: '核对通道配置与权限，恢复后重跑未成功 channel；不得清除 outbox、游标或审计证据。',
    redlines: '密钥/token/cookie/SSH 目标不回显;登录/OAuth/扫码/2FA交主人手动;禁止因工单通知失败递归开票。',
    skipBulletin: escalation ? 'false' : 'true',
  });
  state.tickets[fingerprint] = {
    fingerprint,
    ticketId: result.ticketId || ticketId,
    created: !!result.created,
    reportedAtMs: result.ok ? nowMs : null,
    reportedAt: result.ok ? nowIso(nowMs) : null,
    lastAttemptAt: nowIso(nowMs),
    lastError: result.ok ? null : redactError(result.error || 'ticket creation failed'),
    suppressed: Number(prior.suppressed || 0),
    escalation: !!escalation,
  };
  return Object.assign({ fingerprint, ticketId }, result);
}

function recordFailureSeries(state, channel, reasonClass, success, at) {
  const key = `${channel}:${reasonClass}`;
  if (success) {
    for (const existing of Object.keys(state.failures)) {
      if (!existing.startsWith(`${channel}:`)) continue;
      const prior = state.failures[existing] || {};
      state.failures[existing] = Object.assign({}, prior, {
        consecutive: 0,
        recoveredAt: at,
        firstFailedAt: null,
        activeIncidentId: null,
        escalatedAt: null,
        ownerEscalationRequired: false,
        lastClosedIncidentId: prior.activeIncidentId || prior.lastClosedIncidentId || null,
      });
    }
    return { key, consecutive: 0 };
  }
  const prior = state.failures[key] || {};
  const startsIncident = Number(prior.consecutive || 0) === 0;
  const incidentSequence = startsIncident ? Number(prior.incidentSequence || 0) + 1 : Number(prior.incidentSequence || 1);
  const activeIncidentId = startsIncident
    ? `incident-${sha256(`${channel}\n${reasonClass}\n${at}\n${incidentSequence}`).slice(0, 20)}`
    : prior.activeIncidentId;
  state.failures[key] = {
    channel,
    reasonClass,
    consecutive: Number(prior.consecutive || 0) + 1,
    firstFailedAt: startsIncident ? at : (prior.firstFailedAt || at),
    lastFailedAt: at,
    incidentSequence,
    activeIncidentId,
    escalatedAt: startsIncident ? null : (prior.escalatedAt || null),
    ownerEscalationRequired: startsIncident ? false : !!prior.ownerEscalationRequired,
    recoveredAt: prior.recoveredAt || null,
    lastClosedIncidentId: prior.lastClosedIncidentId || null,
  };
  return { key, consecutive: state.failures[key].consecutive, incidentId: activeIncidentId };
}

function failureTicketGroups(channels, rows) {
  const failed = rows.filter(row => !row.ok);
  if (!failed.length) return [];
  const attemptedChannels = rows.map(row => row.channel);
  const allFailed = channels.length > 1
    && channels.every(channel => attemptedChannels.includes(channel.id))
    && rows.every(row => !row.ok);
  return allFailed ? [failed] : failed.map(row => [row]);
}

function reportRunFailureTicket(meta, error, ticketAdapter, phase) {
  const redacted = redactError(error);
  const reasonClass = failureClass(redacted);
  const fingerprint = sha256(['active-push-run-failure', meta.rootTaskId, meta.taskId, phase, reasonClass].join('\n')).slice(0, 20);
  const ticketId = `active-push-run-${fingerprint}`;
  try {
    return Object.assign({ fingerprint, ticketId }, ticketAdapter({
      id: ticketId,
      title: `awesome-list 新项目主动推送 · 运行失败 · ${reasonClass}`,
      source: 'insight-active-push',
      priority: 'high',
      problem: `启用态主动推送在 ${phase} 阶段失败，本次未静默跳过。`,
      evidence: [
        `rootTaskId=${meta.rootTaskId || 'unavailable'}`,
        `rootQueueId=${meta.rootQueueId || 'unavailable'}`,
        `taskId=${meta.taskId || 'unavailable'}`,
        `runId=${meta.runId}`,
        `phase=${phase}`,
        `reason=${reasonClass}`,
        `redactedError=${redacted}`,
        `runEvidence=${displayPath(meta.runDir)}`,
      ].join('\n'),
      expectation: '核对已确认配置、来源产物或通道运行状态；修复后使用同一幂等键重试，不得删除 run/outbox/游标证据。',
      redlines: '密钥/token/cookie/SSH 目标不回显;登录/OAuth/扫码/2FA交主人手动;禁止因工单失败递归开票。',
      skipBulletin: 'true',
    }));
  } catch (ticketError) {
    return { ok: false, created: false, fingerprint, ticketId, error: redactError(ticketError) };
  }
}

async function runActivePush(opts = {}) {
  const configFile = opts.configFile || DEFAULT_CONFIG_FILE;
  const stateRoot = opts.stateRoot || DEFAULT_STATE_ROOT;
  const stateFile = path.join(stateRoot, 'state.json');
  const runId = safeId(opts.runId || `active-push-${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
  const runDir = path.join(stateRoot, 'runs', runId);
  const meta = {
    rootTaskId: String(opts.rootTaskId || ''),
    rootQueueId: String(opts.rootQueueId || ''),
    taskId: String(opts.taskId || ''),
    runId,
    runDir,
    nowMs: Number(opts.nowMs || Date.now()),
  };
  fs.mkdirSync(runDir, { recursive: true });
  const eventsFile = path.join(runDir, 'events.jsonl');
  const failFile = path.join(runDir, 'node.fail.jsonl');
  const ticketAdapter = opts.ticketAdapter || defaultTicketAdapter;
  let lock = null;
  let config = null;
  let activeDeliveryContext = null;
  try {
    config = opts.config || readJsonStrict(configFile, 'active-push config');
    meta.rootTaskId = String(opts.rootTaskId || config.lineage && config.lineage.rootTaskId || '');
    meta.rootQueueId = String(opts.rootQueueId || config.lineage && config.lineage.rootQueueId || '');
    meta.taskId = String(opts.taskId || config.lineage && config.lineage.taskId || '');
    validateScope(opts.scope);
    validateConfig(config);
    if (!config.enabled) {
      if (opts.activationRequested === true) throw new Error('active-push activation requested while config.enabled=false');
      return { ok: true, action: 'disabled', reason: 'config-disabled' };
    }
    if (!meta.rootTaskId || !meta.rootQueueId || !meta.taskId) throw new Error('lineage gate rejected: rootTaskId/rootQueueId/taskId required');
    const approvedDelayMs = Number(config.ownerConfirmation.staggerOffsetMinutes) * 60 * 1000;
    if (opts.delayMs != null && Number(opts.delayMs) !== approvedDelayMs) {
      throw new Error(`owner confirmation gate rejected: actual delay ${Number(opts.delayMs)}ms differs from approved ${approvedDelayMs}ms`);
    }
    if (Number(opts.delayMs || 0) > 0) await new Promise(resolve => setTimeout(resolve, Number(opts.delayMs)));
    const channels = enabledChannels(config);
    lock = acquireLock(path.join(stateRoot, 'active-push.lock'), {
      runId,
      nowMs: meta.nowMs,
      staleMs: opts.lockStaleMs,
      heartbeatMs: opts.lockHeartbeatMs,
      isProcessAlive: opts.isProcessAlive,
    });
    if (!lock.acquired) {
      if (/^corrupt-lock-/.test(lock.reason || '')) {
        throw Object.assign(new Error(`active-push lock recovery failed: ${lock.reason}`), { activePushPhase: 'lock-recovery' });
      }
      const record = eventRecord(meta, { result: 'skipped-lock-held', details: { type: 'scan.skipped', reason: lock.reason || 'lock-held' } });
      appendJsonLine(eventsFile, record);
      return { ok: true, action: 'skipped', reason: lock.reason || 'lock-held', runId, eventsFile: displayPath(eventsFile) };
    }
    if (lock.recoveredLock) {
      appendJsonLine(eventsFile, eventRecord(meta, {
        result: 'recovered-lock',
        details: {
          type: 'lock.recovered',
          reason: lock.recoveredLock.reason,
          quarantineFile: displayPath(lock.recoveredLock.quarantineFile),
        },
      }));
    }
    const state = readState(stateFile);
    const sourceFile = opts.sourceFile || path.join(WORKDIR, ALLOWED_SOURCE);
    const snapshot = sourceSnapshot(readJsonStrict(sourceFile, 'insight-scout seen-repos'));
    const sourceCursor = state.sourceCursor;
    const isBaseline = !state.sourceCursor && String(config.source.initialMode || 'baseline') === 'baseline';
    const unseen = snapshot.repos.filter(repo => !state.seenEvents[repo.eventId]);
    const maxNew = Math.max(1, Number(config.source.maxNewPerRun || 20));
    if (!isBaseline && unseen.length > maxNew) {
      throw new Error(`source anomaly: ${unseen.length} new repos exceeds maxNewPerRun=${maxNew}`);
    }
    const scanSnapshot = {
      schemaVersion: 1,
      projectId: PROJECT_ID,
      rootTaskId: meta.rootTaskId,
      rootQueueId: meta.rootQueueId,
      taskId: meta.taskId,
      runId,
      attempt: 1,
      source: 'insight-scout-seen-repos',
      sourceCursor,
      nextSourceCursor: snapshot.cursor,
      eventId: unseen.length === 1 ? unseen[0].eventId : null,
      channel: null,
      at: nowIso(meta.nowMs),
      result: isBaseline ? 'baseline' : unseen.length ? 'new-events' : 'no-new-events',
      repos: (isBaseline ? [] : unseen).map(repo => ({ fullName: repo.fullName, url: repo.url, fingerprint: repo.fingerprint, eventId: repo.eventId })),
      sourceCount: snapshot.repos.length,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
    };
    const snapshotFile = path.join(runDir, 'scan-snapshot.json');
    writeJsonAtomic(snapshotFile, scanSnapshot); // 1. 扫描快照先落盘。
    appendJsonLine(eventsFile, eventRecord(meta, {
      attempt: 1,
      sourceCursor,
      eventId: scanSnapshot.eventId,
      result: scanSnapshot.result,
      details: { type: 'scan.completed', nextSourceCursor: snapshot.cursor, count: scanSnapshot.repos.length },
    }));

    if (isBaseline) {
      for (const repo of snapshot.repos) {
        state.seenEvents[repo.eventId] = { fullName: repo.fullName, url: repo.url, fingerprint: repo.fingerprint, status: 'baseline', firstSeenAt: nowIso(meta.nowMs) };
      }
      state.sourceCursor = snapshot.cursor;
      state.sourceCount = snapshot.repos.length;
      state.updatedAt = nowIso(meta.nowMs);
      writeJsonAtomic(stateFile, state);
      return { ok: true, action: 'baselined', runId, sourceCount: snapshot.repos.length, snapshotFile: displayPath(snapshotFile), stateFile: displayPath(stateFile) };
    }

    // 2. 先 upsert eventId+channel 待投递记录并原子落盘；Map-shaped JSON 提供唯一键。
    for (const repo of unseen) {
      for (const channel of channels) {
        const key = `${repo.eventId}:${channel.id}`;
        if (!state.deliveries[key]) {
          state.deliveries[key] = {
            idempotencyKey: key,
            eventId: repo.eventId,
            channel: channel.id,
            recipient: channel.recipient,
            status: 'pending',
            attempt: 0,
            repo: { fullName: repo.fullName, url: repo.url, fingerprint: repo.fingerprint },
            sourceCursor,
            createdAt: nowIso(meta.nowMs),
            attempts: [],
            lastError: null,
            receiptId: null,
          };
        }
      }
    }
    state.updatedAt = nowIso(meta.nowMs);
    writeJsonAtomic(stateFile, state);

    // 3. outbox 已持久化后才推进消费游标；崩溃重跑会按相同 eventId/channel upsert。
    for (const repo of unseen) {
      state.seenEvents[repo.eventId] = { fullName: repo.fullName, url: repo.url, fingerprint: repo.fingerprint, status: 'outbox-persisted', firstSeenAt: nowIso(meta.nowMs) };
    }
    state.sourceCursor = snapshot.cursor;
    state.sourceCount = snapshot.repos.length;
    state.updatedAt = nowIso(meta.nowMs);
    writeJsonAtomic(stateFile, state);

    if (opts.afterCursor) await opts.afterCursor({ stateFile, state, meta });

    const adapters = Object.assign(defaultAdapters(), opts.adapters || {});
    const attemptsByEvent = {};
    const pending = Object.values(state.deliveries)
      .filter(row => row && row.status !== 'sent' && channels.some(channel => channel.id === row.channel))
      .map(row => {
        const approved = channels.find(channel => channel.id === row.channel);
        if (row.recipient && row.recipient !== approved.recipient) {
          throw new Error(`outbox recipient mismatch for ${row.idempotencyKey}; refusing retarget`);
        }
        row.recipient = approved.recipient;
        return row;
      })
      .sort((a, b) => {
        const pa = channels.find(channel => channel.id === a.channel);
        const pb = channels.find(channel => channel.id === b.channel);
        return Number(pa && pa.priority || 100) - Number(pb && pb.priority || 100);
      });

    // 4. 各通道独立投递；attempt 先落盘，成功回执到手后才标 sent。
    for (const delivery of pending) {
      const key = delivery.idempotencyKey;
      const attempt = Number(delivery.attempt || 0) + 1;
      const startedAt = nowIso();
      const attemptRecord = eventRecord(meta, {
        attempt,
        sourceCursor: delivery.sourceCursor,
        eventId: delivery.eventId,
        channel: delivery.channel,
        at: startedAt,
        result: 'attempting',
        error: null,
        details: { type: 'delivery.attempt', idempotencyKey: key },
      });
      activeDeliveryContext = {
        attempt,
        sourceCursor: delivery.sourceCursor,
        eventId: delivery.eventId,
        channel: delivery.channel,
        idempotencyKey: key,
      };
      delivery.attempt = attempt;
      delivery.status = 'attempting';
      delivery.lastAttemptAt = startedAt;
      delivery.rootTaskId = meta.rootTaskId;
      delivery.rootQueueId = meta.rootQueueId;
      delivery.taskId = meta.taskId;
      delivery.runId = meta.runId;
      delivery.at = startedAt;
      delivery.result = 'attempting';
      delivery.error = null;
      delivery.attempts = (Array.isArray(delivery.attempts) ? delivery.attempts : []).concat(attemptRecord);
      state.deliveries[key] = delivery;
      writeJsonAtomic(stateFile, state);
      appendJsonLine(eventsFile, attemptRecord);
      let result;
      try {
        const message = messageFor(delivery.repo, delivery.eventId);
        result = await adapters[delivery.channel](Object.assign(message, {
          eventId: delivery.eventId,
          channel: delivery.channel,
          recipient: delivery.recipient,
          idempotencyKey: key,
          attempt,
          lineage: meta,
        }));
      } catch (error) {
        result = { ok: false, error };
      }
      const at = nowIso();
      attemptsByEvent[delivery.eventId] = attemptsByEvent[delivery.eventId] || [];
      if (result && result.ok && result.receiptId) {
        if (opts.afterReceipt) {
          await opts.afterReceipt({ delivery, result, stateFile, meta });
        }
        delivery.status = 'sent';
        delivery.sentAt = at;
        delivery.receiptId = String(result.receiptId).slice(0, 200);
        delivery.lastError = null;
        delivery.at = at;
        delivery.result = 'sent';
        delivery.error = null;
        recordFailureSeries(state, delivery.channel, 'delivery-error', true, at);
        appendJsonLine(eventsFile, eventRecord(meta, {
          attempt,
          sourceCursor: delivery.sourceCursor,
          eventId: delivery.eventId,
          channel: delivery.channel,
          at,
          result: 'sent',
          details: { type: 'delivery.sent', idempotencyKey: key, receiptId: delivery.receiptId, code: result.code == null ? null : result.code },
        }));
        attemptsByEvent[delivery.eventId].push({ eventId: delivery.eventId, channel: delivery.channel, ok: true });
      } else {
        const error = redactError(result && (result.error || result.reason) || 'delivery returned no receipt');
        const reasonClass = failureClass(error);
        delivery.status = 'pending';
        delivery.lastError = error;
        delivery.lastFailedAt = at;
        delivery.at = at;
        delivery.result = 'failed';
        delivery.error = error;
        const series = recordFailureSeries(state, delivery.channel, reasonClass, false, at);
        const fail = eventRecord(meta, {
          attempt,
          sourceCursor: delivery.sourceCursor,
          eventId: delivery.eventId,
          channel: delivery.channel,
          at,
          result: 'failed',
          error,
          details: { type: 'node.fail', idempotencyKey: key, reasonClass, consecutive: series.consecutive },
        });
        appendJsonLine(eventsFile, fail);
        appendJsonLine(failFile, fail);
        attemptsByEvent[delivery.eventId].push({ eventId: delivery.eventId, channel: delivery.channel, ok: false, error, reasonClass, consecutive: series.consecutive, seriesKey: series.key, incidentId: series.incidentId });
      }
      state.deliveries[key] = delivery;
      state.updatedAt = at;
      writeJsonAtomic(stateFile, state);
      activeDeliveryContext = null;
    }

    const tickets = [];
    const escalations = [];
    for (const [eventId, rows] of Object.entries(attemptsByEvent)) {
      const failed = rows.filter(row => !row.ok);
      if (!failed.length) continue;
      for (const group of failureTicketGroups(channels, rows)) {
        tickets.push(createTicketOnce({ state, config, meta, failures: group, ticketAdapter, escalation: false }));
      }
      const threshold = Math.max(1, Number(config.failure.consecutiveThreshold || 3));
      for (const row of failed) {
        const series = state.failures[row.seriesKey];
        if (!series || series.consecutive < threshold || series.escalatedAt) continue;
        const escalation = createTicketOnce({ state, config, meta, failures: [row], ticketAdapter, escalation: true });
        if (escalation.ok) {
          series.escalatedAt = nowIso();
          series.ownerEscalationRequired = true;
        }
        state.failures[row.seriesKey] = series;
        escalations.push(escalation);
      }
    }
    state.updatedAt = nowIso();
    writeJsonAtomic(stateFile, state);
    const sent = Object.values(attemptsByEvent).flat().filter(row => row.ok).length;
    const failed = Object.values(attemptsByEvent).flat().filter(row => !row.ok).length;
    const summary = {
      ok: failed === 0,
      action: unseen.length ? 'processed-new-events' : pending.length ? 'retried-pending' : 'no-new-events',
      runId,
      sourceCursor: state.sourceCursor,
      newEvents: unseen.length,
      attempted: sent + failed,
      sent,
      failed,
      tickets,
      escalations,
      snapshotFile: displayPath(snapshotFile),
      stateFile: displayPath(stateFile),
      eventsFile: displayPath(eventsFile),
      nodeFailFile: fs.existsSync(failFile) ? displayPath(failFile) : null,
    };
    writeJsonAtomic(path.join(runDir, 'summary.json'), summary);
    return summary;
  } catch (error) {
    const redacted = redactError(error);
    const phase = error && error.activePushPhase || (config && config.enabled ? 'preflight-or-scan-or-commit-or-delivery' : 'preflight');
    const deliveryContext = activeDeliveryContext || {};
    const fail = eventRecord(meta, {
      attempt: deliveryContext.attempt == null ? 1 : deliveryContext.attempt,
      sourceCursor: deliveryContext.sourceCursor,
      eventId: deliveryContext.eventId,
      channel: deliveryContext.channel,
      result: 'failed',
      error: redacted,
      details: {
        type: 'node.fail',
        phase,
        idempotencyKey: deliveryContext.idempotencyKey || null,
      },
    });
    appendJsonLine(eventsFile, fail);
    appendJsonLine(failFile, fail);
    const ticket = (opts.activationRequested === true || config && config.enabled)
      ? reportRunFailureTicket(meta, error, ticketAdapter, phase)
      : null;
    throw Object.assign(new Error(redacted), { runId, runDir, evidence: displayPath(failFile), ticket });
  } finally {
    if (lock && lock.acquired) lock.release();
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const delayMs = Math.max(0, Number(args['delay-ms'] || 0));
  const scope = {
    projectId: String(args['project-id'] || ''),
    scopedToProject: args['scoped-to-project'] === 'true',
  };
  const result = await runActivePush({
    scope,
    configFile: args.config ? path.resolve(args.config) : DEFAULT_CONFIG_FILE,
    stateRoot: args['state-root'] ? path.resolve(args['state-root']) : DEFAULT_STATE_ROOT,
    rootTaskId: args['root-task-id'],
    rootQueueId: args['root-queue-id'],
    taskId: args['task-id'],
    runId: args['run-id'],
    delayMs,
    activationRequested: args['activation-requested'] === 'true',
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result && result.ok === false) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ ok: false, error: redactError(error), runId: error.runId || null, evidence: error.evidence || null }) + '\n');
    process.exit(1);
  });
}

module.exports = {
  PROJECT_ID,
  normalizeRepo,
  sourceSnapshot,
  validateScope,
  validateConfig,
  enabledChannels,
  recipientForChannel,
  runActivePush,
  failureClass,
  redactError,
  acquireLock,
  CHANNEL_CAPABILITIES,
  _test: {
    defaultState,
    defaultTicketAdapter,
    createTicketOnce,
    recordFailureSeries,
    messageFor,
    feishuUuid,
    sendFeishuMessage,
    reportRunFailureTicket,
    failureTicketGroups,
  },
};
