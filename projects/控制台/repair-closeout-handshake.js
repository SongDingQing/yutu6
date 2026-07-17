#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Q = require('../../shared/engine/queue');
const Runtime = require('./engine-runtime');
const DecisionToken = require('./decision-token');

const SCHEMA_VERSION = 1;
const CHILD_AGENT = 'repair';
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_COMPLETION_LEASE_MS = 5 * 60 * 1000;
const FORCE_DECISION = 'force-read-only';
const KEEP_WAITING_DECISION = 'keep-waiting';
const REQUIRED_CONFIRMATION = 'read-only-no-op-confirmed';
const OWNER_DECISION_KIND = 'repair_closeout';
const MANDATORY_STEER = [
  '[MANDATORY REPAIR CLOSEOUT / READ-ONLY NO-OP]',
  '同源维修已进入结案收口。立即停止写文件、特权变更、重复落码、重复派工和调用 repair-ticket-complete。',
  '只允许读取工单与已有结果做 no-op 复核；结束后由收口握手记录 read-only/no-op 确认。',
].join('\n');

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value == null ? '' : value));
}

function safeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

function nowIso(nowMs) {
  return new Date(nowMs).toISOString();
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function relativeOrAbsolute(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

function taskPayload(entry) {
  return entry && entry.task && typeof entry.task === 'object' && !Array.isArray(entry.task)
    ? entry.task
    : {};
}

function taskGoal(entry) {
  const task = taskPayload(entry);
  return String(task.goal || task.message || task.task || entry && entry.task || '');
}

function entryTicketId(entry) {
  const task = taskPayload(entry);
  for (const value of [task.repairTicketId, task.parentRepairTicketId, task.ticketId]) {
    const id = safeId(value);
    if (id) return id;
  }
  const goal = taskGoal(entry);
  const byPath = goal.match(/board\/repair-tickets\/([A-Za-z0-9._-]+)\.md/);
  if (byPath) return safeId(byPath[1]);
  const byTitle = goal.match(/维修工单\s+([A-Za-z0-9._-]+)/);
  return byTitle ? safeId(byTitle[1]) : '';
}

function entrySourceIncidentId(entry) {
  const task = taskPayload(entry);
  return safeId(task.sourceIncidentId || task.source_incident_id || '');
}

function matchesCloseout(entry, ticketId, sourceIncidentId) {
  const childTicket = entryTicketId(entry);
  const childIncident = entrySourceIncidentId(entry);
  return childTicket === ticketId || !!(sourceIncidentId && childIncident === sourceIncidentId);
}

function isOwnerDecisionCard(card) {
  return !!(card && (
    card.decisionKind === OWNER_DECISION_KIND
    || (card.payload && card.payload.decisionKind === OWNER_DECISION_KIND)
  ));
}

function terminalSnapshot(queueRoot, agent, queueId) {
  const dir = Q.qdir(queueRoot, agent);
  for (const status of ['canceled', 'done', 'failed']) {
    const file = path.join(dir, status, `${queueId}.json`);
    const entry = readJson(file, null);
    if (entry) return { status, file, entry };
  }
  return null;
}

function activeSnapshot(queueRoot, agent, queueId) {
  const state = Q.list(queueRoot, agent);
  for (const status of ['running', 'queued', 'paused']) {
    const entry = (state[status] || []).find(item => String(item && item.id || '') === queueId);
    if (entry) return { status, entry };
  }
  return null;
}

function preEngineCancelableChild(entry) {
  return !!(entry
    && entry.pre_engine_waiting === true
    && !entry.engine_started_at
    && !Runtime.enginePidFromRecord(entry));
}

function resolveIncidentId(queueRoot, ticketId, explicit) {
  const direct = safeId(explicit);
  if (direct) return direct;
  const index = readJson(path.join(queueRoot, 'repair-auto', 'index.json'), {});
  for (const [fingerprint, row] of Object.entries(index && typeof index === 'object' ? index : {})) {
    if (row && row.ticketId === ticketId) return safeId(row.incidentFingerprint || fingerprint);
  }
  return '';
}

function auditRow(state, key, type, nowMs, detail = {}) {
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  if (state.audit.some(row => row && row.key === key)) return false;
  state.audit.push(Object.assign({
    key,
    type,
    at: nowIso(nowMs),
    ticketId: state.ticketId,
    sourceIncidentId: state.sourceIncidentId || null,
    childId: null,
    originalStatus: null,
    disposition: null,
    confirmation: null,
    ttl: {
      ttlMs: state.ttlMs,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt,
    },
    ownerDecision: state.ownerDecision || null,
    finalStatus: state.finalStatus || null,
  }, detail));
  return true;
}

function emitNew(eventlog, emitted, type, state, detail = {}) {
  if (!emitted || typeof eventlog !== 'function') return;
  try {
    eventlog(type, Object.assign({
      ticketId: state.ticketId,
      sourceIncidentId: state.sourceIncidentId || null,
      handshakeId: state.handshakeId,
      status: state.status,
    }, detail));
  } catch (_) {}
}

function jsonClone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function createManager(options = {}) {
  const queueRoot = path.resolve(options.queueRoot || options.artifactsRoot || path.join(__dirname, 'artifacts'));
  const workdir = path.resolve(options.workdir || path.join(__dirname, '../..'));
  const stateDir = path.resolve(options.stateDir || path.join(queueRoot, 'repair-closeout-handshakes'));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const eventlog = typeof options.eventlog === 'function' ? options.eventlog : null;
  const afterStep = typeof options.afterStep === 'function' ? options.afterStep : null;
  const afterCommit = typeof options.afterCommit === 'function' ? options.afterCommit : null;
  const engineAlive = typeof options.engineAlive === 'function' ? options.engineAlive : record => { const pid = Runtime.enginePidFromRecord(record); return !!pid && Runtime.pidAlive(pid); };
  const ttlMs = Math.max(1000, Number(options.ttlMs || process.env.REPAIR_CLOSEOUT_HANDSHAKE_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);
  const completionLeaseMs = Math.max(10_000, Number(options.completionLeaseMs || DEFAULT_COMPLETION_LEASE_MS) || DEFAULT_COMPLETION_LEASE_MS);
  const enabled = options.enabled == null ? truthy(process.env.REPAIR_CLOSEOUT_HANDSHAKE_ENABLED) : !!options.enabled;
  const lockWaitArray = new Int32Array(new SharedArrayBuffer(4));
  const completionCommitAuthority = Symbol('repair-closeout-completion-commit');

  function stateFile(ticketId) {
    const id = safeId(ticketId);
    if (!id) throw new Error('bad repair ticket id');
    return path.join(stateDir, `${id}.json`);
  }

  function ownerDecisionReceiptFile(receiptId) {
    const id = safeId(receiptId);
    if (!id) throw new Error('bad repair closeout owner decision receipt id');
    return path.join(stateDir, 'owner-decisions', `${id}.json`);
  }

  function load(ticketId) {
    return readJson(stateFile(ticketId), null);
  }

  function withExclusiveFileLock(lockFile, busyMessage, fn) {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    let fd = null;
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        fd = fs.openSync(lockFile, 'wx', 0o600);
        fs.writeFileSync(fd, `${process.pid}\n`);
        break;
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        try {
          const stat = fs.statSync(lockFile);
          if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch (_) {}
        Atomics.wait(lockWaitArray, 0, 0, 10);
      }
    }
    if (fd == null) throw new Error(busyMessage);
    try { return fn(); }
    finally {
      try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(lockFile); } catch (_) {}
    }
  }

  function withStateLock(ticketId, fn) {
    return withExclusiveFileLock(`${stateFile(ticketId)}.lock`, 'repair closeout handshake state lock busy', fn);
  }

  function withEnqueueFenceLock(fn) {
    return withExclusiveFileLock(
      path.join(stateDir, '.repair-enqueue-fence.lock'),
      'repair closeout enqueue fence lock busy',
      fn,
    );
  }

  function save(state) {
    state.updatedAt = nowIso(now());
    writeJsonAtomic(stateFile(state.ticketId), state);
    return state;
  }

  function initialState(ticketId, sourceIncidentId, nowMs) {
    const incidentId = resolveIncidentId(queueRoot, ticketId, sourceIncidentId);
    const startedAt = nowIso(nowMs);
    const expiresAt = nowIso(nowMs + ttlMs);
    return {
      schemaVersion: SCHEMA_VERSION,
      handshakeId: crypto.createHash('sha256').update(`repair-closeout-v1\n${ticketId}\n${incidentId}`).digest('hex').slice(0, 20),
      ticketId,
      sourceIncidentId: incidentId || null,
      enabled: true,
      status: 'checking_children',
      startedAt,
      updatedAt: startedAt,
      ttlMs,
      expiresAt,
      children: {},
      ownerDecision: null,
      ownerDecisionRequest: null,
      warnings: [],
      finalStatus: null,
      completionReceipt: null,
      completion: null,
      audit: [],
    };
  }

  function ensureOwnerDecisionCard(state, nowMs) {
    const bulletinFile = path.join(queueRoot, 'bulletin', 'cards.json');
    const cards = readJson(bulletinFile, []);
    if (!Array.isArray(cards)) throw new Error('repair closeout owner decision bulletin is invalid');
    const cardId = `repair-closeout-${state.handshakeId}`;
    const existing = cards.find(card => card && card.id === cardId);
    if (existing) {
      if (!isOwnerDecisionCard(existing)
        || safeId(existing.ticketId || existing.payload && existing.payload.ticketId) !== state.ticketId
        || safeId(existing.handshakeId || existing.payload && existing.payload.handshakeId) !== state.handshakeId) {
        throw new Error('repair closeout owner decision card identity conflict');
      }
      return { cardId, created: false };
    }
    const card = {
      id: cardId,
      kind: 'bulletin',
      title: `维修结案待拍板: ${state.ticketId}`,
      desc: '下游 repair 子任务确认超时。批准仅强制转只读并保留 warning；驳回则继续等待。',
      target: 'ceo',
      project: '控制台',
      source: 'repair-closeout',
      decisionKind: OWNER_DECISION_KIND,
      ticketId: state.ticketId,
      handshakeId: state.handshakeId,
      payload: {
        role: 'orchestrator',
        flowId: 'repair-closeout-owner-decision',
        projectId: '控制台',
        decisionKind: OWNER_DECISION_KIND,
        ticketId: state.ticketId,
        sourceIncidentId: state.sourceIncidentId || null,
        handshakeId: state.handshakeId,
        decision: FORCE_DECISION,
      },
      status: 'todo',
      created_at: nowIso(nowMs),
      enabled_at: null,
      queueId: null,
      decisionSecret: DecisionToken.newSecret(),
    };
    cards.unshift(card);
    writeJsonAtomic(bulletinFile, cards);
    return { cardId, created: true };
  }

  function validOwnerDecisionReceipt(state) {
    const decision = state && state.ownerDecision;
    const receiptId = safeId(decision && decision.receiptId);
    if (!receiptId || decision.decision !== FORCE_DECISION || !decision.approved) return null;
    const receipt = readJson(ownerDecisionReceiptFile(receiptId), null);
    if (!receipt
      || receipt.receiptId !== receiptId
      || receipt.ticketId !== state.ticketId
      || receipt.handshakeId !== state.handshakeId
      || receipt.cardId !== (state.ownerDecisionRequest && state.ownerDecisionRequest.cardId)
      || receipt.decision !== FORCE_DECISION
      || receipt.approved !== true
      || receipt.actor !== 'owner'
      || receipt.verification !== 'hmac-sha256-decision-card') return null;
    return receipt;
  }

  function listActiveChildren(ticketId, sourceIncidentId) {
    const state = Q.list(queueRoot, CHILD_AGENT);
    const out = [];
    for (const status of ['queued', 'running']) {
      for (const entry of state[status] || []) {
        if (!entry || !safeId(entry.id) || !matchesCloseout(entry, ticketId, sourceIncidentId)) continue;
        out.push({ queueAgent: CHILD_AGENT, queueId: entry.id, status, entry });
      }
    }
    return out;
  }

  function disposeActiveChildren(state, active, nowMs, options = {}) {
    let changed = false;
    const terminateRunning = options.terminateRunning === true;
    const latePhase = String(options.phase || '') === 'late';
    for (const child of active) {
      const key = `${child.queueAgent}:${child.queueId}`;
      const known = state.children[key];
      if (child.status === 'queued') {
        const canceled = Q.cancel(queueRoot, child.queueAgent, child.queueId);
        if (!canceled || canceled.status !== 'canceled') {
          const live = activeSnapshot(queueRoot, child.queueAgent, child.queueId);
          const terminal = live ? null : terminalSnapshot(queueRoot, child.queueAgent, child.queueId);
          if (live && live.status === 'queued') {
            state.children[key] = Object.assign({}, known || {}, {
              queueAgent: child.queueAgent,
              queueId: child.queueId,
              originalStatus: 'queued',
              observedStatus: 'queued',
              disposition: 'queued_disposition_pending',
              actionAt: known && known.actionAt || nowIso(nowMs),
              requiresConfirmation: true,
              confirmed: false,
              confirmation: null,
            });
            changed = true;
            continue;
          }
          if (live && live.status === 'running') {
            const steered = Q.steer(queueRoot, child.queueAgent, child.queueId, MANDATORY_STEER);
            if (terminateRunning && !live.entry.cancel_requested) Q.cancel(queueRoot, child.queueAgent, child.queueId);
            const row = Object.assign({}, known || {}, {
              queueAgent: child.queueAgent,
              queueId: child.queueId,
              originalStatus: 'queued',
              observedStatus: 'running',
              disposition: terminateRunning
                ? 'owner_forced_termination_requested'
                : (steered ? 'running_steered_after_queue_claim' : 'running_steer_pending_after_queue_claim'),
              actionAt: known && known.actionAt || nowIso(nowMs),
              steerSha256: steered ? crypto.createHash('sha256').update(MANDATORY_STEER).digest('hex') : null,
              requiresConfirmation: true,
              confirmed: false,
              confirmation: null,
            });
            state.children[key] = row;
            if (terminateRunning) {
              const warning = `unconfirmed_child_warning:${child.queueAgent}:${child.queueId}`;
              if (!state.warnings.includes(warning)) state.warnings.push(warning);
            }
            const added = auditRow(state, `child:${key}:queued_claimed_running`, 'repair.closeout.child_disposed', nowMs, {
              childId: key,
              originalStatus: 'queued',
              disposition: terminateRunning
                ? 'mandatory_read_only_noop_steered_and_termination_requested_after_queue_claim'
                : (steered ? 'mandatory_read_only_noop_steered_after_queue_claim' : 'mandatory_read_only_noop_steer_pending_after_queue_claim'),
            });
            changed = added || changed;
            emitNew(eventlog, added, 'repair.closeout.child_disposed', state, row);
            continue;
          }
          const wasClaimed = !!(terminal && terminal.entry && (terminal.entry.claimed_at || terminal.entry.started_at));
          const row = Object.assign({}, known || {}, {
            queueAgent: child.queueAgent,
            queueId: child.queueId,
            originalStatus: 'queued',
            observedStatus: terminal && terminal.status || 'missing',
            disposition: wasClaimed ? 'terminal_after_queue_claim_pending_confirmation' : 'queued_disposition_uncertain',
            actionAt: known && known.actionAt || nowIso(nowMs),
            requiresConfirmation: true,
            confirmed: false,
            confirmation: null,
          });
          state.children[key] = row;
          const added = auditRow(state, `child:${key}:queued_disposition_uncertain`, 'repair.closeout.child_disposed', nowMs, {
            childId: key,
            originalStatus: 'queued',
            disposition: row.disposition,
          });
          changed = added || changed;
          emitNew(eventlog, added, 'repair.closeout.child_disposed', state, row);
          continue;
        }
        const row = {
          queueAgent: child.queueAgent,
          queueId: child.queueId,
          originalStatus: 'queued',
          disposition: 'queued_canceled',
          actionAt: nowIso(nowMs),
          requiresConfirmation: false,
          confirmed: true,
          confirmation: {
            mode: 'queue_cancel_terminal',
            at: nowIso(nowMs),
            proof: latePhase ? 'late_enqueue_canceled_queue_state' : 'canceled_queue_state',
          },
        };
        state.children[key] = row;
        const enqueueIncarnation = crypto.createHash('sha256').update([
          child.entry && child.entry.enqueued_at || '',
          child.entry && child.entry.seq || '',
        ].join('\n')).digest('hex').slice(0, 12);
        const auditKey = known && known.disposition === 'queued_canceled'
          ? `child:${key}:queued_recanceled:${enqueueIncarnation}`
          : `child:${key}:queued_canceled`;
        const added = auditRow(state, auditKey, 'repair.closeout.child_disposed', nowMs, {
          childId: key,
          originalStatus: 'queued',
          disposition: latePhase ? 'late_queued_canceled' : 'queued_canceled',
          confirmation: row.confirmation,
        });
        changed = added || changed;
        emitNew(eventlog, added, 'repair.closeout.child_disposed', state, row);
        continue;
      }

      const safePreEngineCancel = preEngineCancelableChild(child.entry);
      if (known && ['running_steered', 'running_steered_after_queue_claim', 'pre_engine_cancel_requested', 'owner_forced_termination_requested'].includes(known.disposition)) {
        if ((terminateRunning || safePreEngineCancel) && !child.entry.cancel_requested) {
          Q.cancel(queueRoot, child.queueAgent, child.queueId);
          known.disposition = safePreEngineCancel ? 'pre_engine_cancel_requested' : 'owner_forced_termination_requested';
          if (terminateRunning) {
            known.forcedAt = known.forcedAt || nowIso(nowMs);
            const warning = `unconfirmed_child_warning:${child.queueAgent}:${child.queueId}`;
            if (!state.warnings.includes(warning)) state.warnings.push(warning);
          }
          changed = true;
        }
        continue;
      }
      const steered = Q.steer(queueRoot, child.queueAgent, child.queueId, MANDATORY_STEER);
      if ((terminateRunning || safePreEngineCancel) && !child.entry.cancel_requested) Q.cancel(queueRoot, child.queueAgent, child.queueId);
      const row = Object.assign({}, known || {}, {
        queueAgent: child.queueAgent,
        queueId: child.queueId,
        originalStatus: known && known.originalStatus || 'running',
        observedStatus: 'running',
        disposition: safePreEngineCancel
          ? 'pre_engine_cancel_requested'
          : (terminateRunning
            ? 'owner_forced_termination_requested'
            : (steered ? 'running_steered' : 'running_steer_pending')),
        actionAt: known && known.actionAt || nowIso(nowMs),
        steerSha256: steered ? crypto.createHash('sha256').update(MANDATORY_STEER).digest('hex') : null,
        requiresConfirmation: true,
        confirmed: false,
        confirmation: null,
      });
      state.children[key] = row;
      if (terminateRunning) {
        row.forcedAt = nowIso(nowMs);
        const warning = `unconfirmed_child_warning:${child.queueAgent}:${child.queueId}`;
        if (!state.warnings.includes(warning)) state.warnings.push(warning);
      }
      const added = auditRow(state, `child:${key}:running_steered`, 'repair.closeout.child_disposed', nowMs, {
        childId: key,
        originalStatus: 'running',
        disposition: safePreEngineCancel
          ? 'mandatory_read_only_noop_steered_and_pre_engine_cancel_requested'
          : (terminateRunning
            ? 'mandatory_read_only_noop_steered_and_termination_requested'
            : (steered ? 'mandatory_read_only_noop_steered' : 'mandatory_read_only_noop_steer_pending')),
      });
      changed = added || changed;
      emitNew(eventlog, added, 'repair.closeout.child_disposed', state, row);
    }
    return { changed };
  }

  function preflightUnlocked(input = {}) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('repair closeout preflight requires ticketId');
    if (!enabled) return { enabled: false, allowClose: true, blocked: false, reason: 'proposal_only_feature_disabled', state: null };
    const nowMs = now();
    let state = load(ticketId) || initialState(ticketId, input.sourceIncidentId, nowMs);
    let preflightChanged = false;
    if (state.status === 'closed' || state.status === 'forced_closed') {
      const lateActive = listActiveChildren(ticketId, state.sourceIncidentId);
      const late = disposeActiveChildren(state, lateActive, nowMs, { terminateRunning: true, phase: 'late' });
      if (late.changed) {
        const added = auditRow(state, `handshake:closed_late_reconcile:${lateActive.map(child => child.queueId).sort().join(',')}`, 'repair.closeout.closed_late_children_reconciled', nowMs, {
          disposition: 'closed_fence_canceled_or_terminated_late_children',
          finalStatus: state.finalStatus,
        });
        emitNew(eventlog, added, 'repair.closeout.closed_late_children_reconciled', state, { childCount: lateActive.length });
        save(state);
      }
      return {
        enabled: true,
        allowClose: false,
        blocked: false,
        alreadyClosed: true,
        lateChildrenHandled: lateActive.map(child => ({ queueAgent: child.queueAgent, queueId: child.queueId, originalStatus: child.status })),
        state,
      };
    }
    if (state.status === 'closing_in_progress' && state.completion) {
      if (nowMs < Date.parse(state.completion.expiresAt || '')) {
        return { enabled: true, allowClose: false, blocked: true, reason: 'closing_in_progress', waitingChildren: [], state };
      }
      const expiredToken = state.completion.token;
      const wasForced = !!state.completion.forced;
      state.status = wasForced ? 'ready_to_close_forced' : 'ready_to_close';
      state.completion = null;
      auditRow(state, `completion:${expiredToken}:lease_expired`, 'repair.closeout.completion_lease_expired', nowMs, {
        disposition: 'completion_lease_released_for_retry',
      });
      preflightChanged = true;
    }

    const active = listActiveChildren(ticketId, state.sourceIncidentId);
    const ownerReceiptAtStart = nowMs >= Date.parse(state.expiresAt || '')
      ? validOwnerDecisionReceipt(state)
      : null;
    let changed = preflightChanged || auditRow(state, 'handshake:started', 'repair.closeout.handshake_started', nowMs, {
      disposition: 'scan_active_repair_children',
    });

    const disposed = disposeActiveChildren(state, active, nowMs, {
      terminateRunning: !!ownerReceiptAtStart,
    });
    changed = disposed.changed || changed;

    const residualActive = listActiveChildren(ticketId, state.sourceIncidentId);
    for (const child of residualActive) {
      const key = `${child.queueAgent}:${child.queueId}`;
      if (state.children[key]) continue;
      state.children[key] = {
        queueAgent: child.queueAgent,
        queueId: child.queueId,
        originalStatus: child.status,
        observedStatus: child.status,
        disposition: 'active_child_reconciliation_pending',
        actionAt: nowIso(nowMs),
        requiresConfirmation: true,
        confirmed: false,
        confirmation: null,
      };
      changed = true;
    }

    const waiting = Object.values(state.children).filter(child => child && child.requiresConfirmation && !child.confirmed);
    if (waiting.length) {
      const expired = nowMs >= Date.parse(state.expiresAt || '');
      if (!expired) {
        state.status = 'closing_pending_child';
      } else {
        state.status = 'awaiting_owner_decision';
        if (!state.ownerDecisionRequest) {
          state.ownerDecisionRequest = {
            status: 'pending',
            createdAt: nowIso(nowMs),
            reason: 'repair_child_confirmation_ttl_expired',
            options: [KEEP_WAITING_DECISION, FORCE_DECISION],
            autoCloseAllowed: false,
            receiptRequired: true,
          };
        }
        if (!state.ownerDecision && state.ownerDecisionRequest.status === 'pending') {
          const decisionCard = ensureOwnerDecisionCard(state, nowMs);
          state.ownerDecisionRequest.cardId = decisionCard.cardId;
          state.ownerDecisionRequest.decisionKind = OWNER_DECISION_KIND;
          const cardAuditAdded = auditRow(state, `owner:decision_card:${decisionCard.cardId}`, 'repair.closeout.owner_decision_card_created', nowMs, {
            disposition: 'signed_owner_decision_required',
            ownerDecision: { cardId: decisionCard.cardId, receiptRequired: true },
          });
          changed = cardAuditAdded || decisionCard.created || changed;
          emitNew(eventlog, cardAuditAdded, 'repair.closeout.owner_decision_card_created', state, { cardId: decisionCard.cardId });
        }
        const added = auditRow(state, 'ttl:owner_decision_required', 'repair.closeout.owner_decision_required', nowMs, {
          disposition: 'ttl_expired_no_auto_close',
        });
        changed = added || changed;
        emitNew(eventlog, added, 'repair.closeout.owner_decision_required', state, { waitingChildren: waiting.map(c => `${c.queueAgent}:${c.queueId}`) });
      }

      const ownerReceipt = expired ? ownerReceiptAtStart : null;
      if (ownerReceipt) {
        state.ownerDecisionRequest = Object.assign({}, state.ownerDecisionRequest || {}, {
          status: 'decided',
          decidedAt: ownerReceipt.verifiedAt,
          decision: FORCE_DECISION,
          receiptId: ownerReceipt.receiptId,
        });
        for (const child of waiting) {
          const activeChild = activeSnapshot(queueRoot, child.queueAgent, child.queueId);
          child.disposition = activeChild
            ? (activeChild.status === 'queued' ? 'owner_forced_queued_cancel_pending' : 'owner_forced_termination_requested')
            : 'owner_forced_terminal_unconfirmed_warning';
          child.forcedAt = nowIso(nowMs);
          const warning = `unconfirmed_child_warning:${child.queueAgent}:${child.queueId}`;
          if (!state.warnings.includes(warning)) state.warnings.push(warning);
        }
        const added = auditRow(state, 'owner:force-read-only', 'repair.closeout.owner_decided', nowMs, {
          disposition: 'forced_read_only_termination_requested',
          ownerDecision: state.ownerDecision,
          ownerDecisionReceiptId: ownerReceipt.receiptId,
        });
        changed = added || changed;
        emitNew(eventlog, added, 'repair.closeout.owner_decided', state, { ownerDecision: state.ownerDecision, warnings: state.warnings });
        const forcedResidualActive = listActiveChildren(ticketId, state.sourceIncidentId);
        if (forcedResidualActive.length) {
          state.status = 'closing_pending_child';
          state.completion = null;
          const pendingAdded = auditRow(state, 'owner:force-read-only:active-child-pending', 'repair.closeout.owner_force_active_child_pending', nowMs, {
            disposition: 'owner_approved_but_active_child_not_terminal',
          });
          changed = pendingAdded || changed;
          emitNew(eventlog, pendingAdded, 'repair.closeout.owner_force_active_child_pending', state, {
            waitingChildren: forcedResidualActive.map(child => `${child.queueAgent}:${child.queueId}`),
          });
          save(state);
          return {
            enabled: true,
            allowClose: false,
            blocked: true,
            forced: true,
            reason: 'owner_force_child_still_active',
            waitingChildren: forcedResidualActive.map(child => ({ queueAgent: child.queueAgent, queueId: child.queueId })),
            warning: state.warnings.slice(),
            state,
          };
        }
        state.status = 'closing_in_progress';
        state.completion = {
          token: crypto.randomBytes(16).toString('hex'),
          forced: true,
          startedAt: nowIso(nowMs),
          expiresAt: nowIso(nowMs + completionLeaseMs),
        };
        save(state);
        return { enabled: true, allowClose: true, blocked: false, forced: true, completionToken: state.completion.token, warning: state.warnings.slice(), state };
      }

      if (changed || !fs.existsSync(stateFile(ticketId))) save(state);
      return {
        enabled: true,
        allowClose: false,
        blocked: true,
        reason: expired ? 'owner_decision_required' : 'closing_pending_child',
        waitingChildren: waiting.map(child => ({ queueAgent: child.queueAgent, queueId: child.queueId })),
        state,
      };
    }

    state.status = 'closing_in_progress';
    state.completion = {
      token: crypto.randomBytes(16).toString('hex'),
      forced: false,
      startedAt: nowIso(nowMs),
      expiresAt: nowIso(nowMs + completionLeaseMs),
    };
    const added = auditRow(state, 'handshake:ready', 'repair.closeout.ready', nowMs, {
      disposition: Object.keys(state.children).length ? 'all_children_disposed_or_confirmed' : 'no_matching_children',
    });
    emitNew(eventlog, added, 'repair.closeout.ready', state, { childCount: Object.keys(state.children).length });
    save(state);
    return { enabled: true, allowClose: true, blocked: false, completionToken: state.completion.token, state };
  }

  function confirmChildUnlocked(input = {}) {
    if (!enabled) throw new Error('repair closeout handshake is disabled');
    const ticketId = safeId(input.ticketId || input.id);
    const agent = safeId(input.agent || CHILD_AGENT);
    const queueId = safeId(input.queueId || input.childId);
    if (!ticketId || agent !== CHILD_AGENT || !queueId) throw new Error('child confirmation requires ticketId, repair agent, and queueId');
    if (String(input.confirmation || input.mode || '') !== REQUIRED_CONFIRMATION) throw new Error(`child confirmation must be ${REQUIRED_CONFIRMATION}`);
    const state = load(ticketId);
    if (!state) throw new Error('repair closeout handshake not found');
    const key = `${agent}:${queueId}`;
    const child = state.children && state.children[key];
    if (!child || !child.requiresConfirmation) throw new Error('repair child requiring confirmation is not registered in handshake');
    if (child.confirmed) return { ok: true, alreadyConfirmed: true, state, child };
    const active = activeSnapshot(queueRoot, agent, queueId);
    if (active) throw new Error(`repair child is still ${active.status}; terminal state required before confirmation`);
    const terminal = terminalSnapshot(queueRoot, agent, queueId);
    if (!terminal) throw new Error('repair child terminal receipt not found');
    const enginePid = Runtime.enginePidFromRecord(terminal.entry);
    const preEngineProof = terminal.status === 'canceled'
      && terminal.entry.pre_engine_cancel_confirmed === true
      && terminal.entry.pre_engine_waiting === true
      && !terminal.entry.engine_started_at
      && !enginePid;
    if (!preEngineProof && (!Number.isInteger(enginePid) || enginePid <= 0)) {
      throw new Error('repair child terminal receipt is missing a verifiable engine pid');
    }
    if (!preEngineProof && engineAlive(terminal.entry)) throw new Error('repair child terminal receipt still references a live engine process');
    const nowMs = now();
    child.confirmed = true;
    child.confirmation = {
      mode: REQUIRED_CONFIRMATION,
      at: nowIso(nowMs),
      terminalStatus: terminal.status,
      proof: preEngineProof
        ? 'terminal_pre_engine_cancel_and_no_engine_started'
        : 'terminal_queue_state_and_engine_pid_not_alive',
      processProof: {
        activeQueueEntry: false,
        enginePid: enginePid || null,
        engineIdentity: preEngineProof ? 'pre-engine:no-engine' : `pid:${enginePid}`,
        engineProcessAlive: false,
      },
      guarantees: {
        fileWritesAfterConfirmation: false,
        privilegedChangesAfterConfirmation: false,
        duplicateCodeAfterConfirmation: false,
      },
      terminalFile: relativeOrAbsolute(workdir, terminal.file),
    };
    child.disposition = 'running_confirmed_read_only_noop';
    const added = auditRow(state, `child:${key}:confirmed`, 'repair.closeout.child_confirmed', nowMs, {
      childId: key,
      originalStatus: child.originalStatus,
      disposition: child.disposition,
      confirmation: child.confirmation,
    });
    emitNew(eventlog, added, 'repair.closeout.child_confirmed', state, child);
    if (Object.values(state.children).every(item => item.confirmed)) state.status = 'ready_to_close';
    save(state);
    return { ok: true, alreadyConfirmed: false, state, child };
  }

  function reconcileCompletionChildren(state, nowMs, phase = 'final') {
    const forced = !!(state.completion && state.completion.forced);
    const lateActive = listActiveChildren(state.ticketId, state.sourceIncidentId);
    const late = disposeActiveChildren(state, lateActive, nowMs, { terminateRunning: forced, phase: 'late' });
    const residualActive = listActiveChildren(state.ticketId, state.sourceIncidentId);
    const waiting = Object.values(state.children).filter(child => child && child.requiresConfirmation && !child.confirmed);
    const blockedChildren = forced ? residualActive : waiting;
    if (blockedChildren.length) {
      const completionToken = state.completion && state.completion.token;
      state.status = 'closing_pending_child';
      state.completion = null;
      if (state.completionOutbox) {
        state.completionOutbox.status = 'blocked_by_child';
        state.completionOutbox.updatedAt = nowIso(nowMs);
      }
      const added = auditRow(state, `completion:${completionToken}:${phase}:late_child_blocked`, 'repair.closeout.completion_blocked_by_late_child', nowMs, {
        disposition: `${phase}_rescan_found_unconfirmed_child`,
      });
      emitNew(eventlog, added, 'repair.closeout.completion_blocked_by_late_child', state, {
        phase,
        forced,
        waitingChildren: blockedChildren.map(child => `${child.queueAgent}:${child.queueId}`),
      });
      save(state);
      const error = new Error(forced
        ? `repair closeout ${phase} rescan found an active child after forced termination request`
        : `repair closeout ${phase} rescan found an unconfirmed child`);
      error.code = 'REPAIR_CLOSEOUT_LATE_CHILD';
      error.waitingChildren = blockedChildren.map(child => ({ queueAgent: child.queueAgent, queueId: child.queueId }));
      throw error;
    }
    if (late.changed) {
      const token = state.completion && state.completion.token || 'forced';
      const added = auditRow(state, `completion:${token}:${phase}:late_children_reconciled`, 'repair.closeout.completion_late_children_reconciled', nowMs, {
        disposition: forced ? 'forced_close_terminated_late_children' : 'late_queued_children_canceled_before_close',
      });
      emitNew(eventlog, added, 'repair.closeout.completion_late_children_reconciled', state, { phase, childCount: lateActive.length });
      save(state);
    }
    return { forced, lateActive, changed: late.changed };
  }

  function runCompletionUnlocked(input = {}, executor) {
    if (typeof executor !== 'function') throw new Error('repair closeout completion executor is required');
    const ticketId = safeId(input.ticketId || input.id);
    const state = load(ticketId);
    if (!state) throw new Error('repair closeout handshake not found');
    if (state.status === 'closed' || state.status === 'forced_closed') {
      return { alreadyClosed: true, state, result: state.completionReceipt || null };
    }
    if (state.status !== 'closing_in_progress' || !state.completion) throw new Error(`repair closeout handshake is not ready: ${state.status}`);
    if (!input.completionToken || input.completionToken !== state.completion.token) throw new Error('repair closeout completion token mismatch');
    const requestHash = String(input.requestHash || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(requestHash)) throw new Error('repair closeout completion request hash is required');
    const nowMs = now();
    let existingOutbox = state.completionOutbox;
    if (existingOutbox && existingOutbox.requestHash && existingOutbox.requestHash !== requestHash) {
      const committedSteps = Object.values(existingOutbox.steps || {})
        .filter(step => step && step.status === 'committed')
        .map(step => step.key);
      const replaceableAfterChildBlock = existingOutbox.status === 'blocked_by_child'
        && committedSteps.every(key => key === 'report_files');
      if (!replaceableAfterChildBlock) {
        const error = new Error('repair closeout completion retry request conflicts with durable outbox');
        error.code = 'REPAIR_CLOSEOUT_REQUEST_CONFLICT';
        throw error;
      }
      const added = auditRow(state, `completion_outbox:${existingOutbox.requestHash}:superseded`, 'repair.closeout.completion_outbox_superseded', nowMs, {
        disposition: 'pre_completion_report_replaced_after_child_confirmation',
      });
      emitNew(eventlog, added, 'repair.closeout.completion_outbox_superseded', state, {});
      existingOutbox = null;
      state.completionOutbox = null;
    }
    state.completionOutbox = Object.assign({
      schemaVersion: 1,
      requestHash,
      completedAt: String(input.completedAt || nowIso(nowMs)),
      createdAt: nowIso(nowMs),
      steps: {},
      receipt: null,
    }, existingOutbox || {}, {
      requestHash,
      status: 'committing',
      updatedAt: nowIso(nowMs),
    });
    state.completionOutbox.steps = state.completionOutbox.steps && typeof state.completionOutbox.steps === 'object'
      ? state.completionOutbox.steps
      : {};
    save(state);
    reconcileCompletionChildren(state, now(), 'before_side_effects');

    const deferredSteps = [];

    function ensureStepRecord(stepKey, options) {
      let record = state.completionOutbox.steps[stepKey];
      if (!record) {
        record = {
          key: stepKey,
          status: 'pending',
          attempts: 0,
          plan: jsonClone(options.plan),
          result: null,
          stagedAt: null,
          startedAt: null,
          committedAt: null,
          recovered: false,
          lastFailure: null,
        };
        state.completionOutbox.steps[stepKey] = record;
      }
      return record;
    }

    function publishCommittedResult(options, result) {
      if (typeof options.onCommitted === 'function') options.onCommitted(jsonClone(result));
      return jsonClone(result);
    }

    function commitStep(stepKey, record, options) {
      if (record.status === 'committed') return publishCommittedResult(options, record.result);
      if (record.status === 'started' && typeof options.recover === 'function') {
        const recovered = options.recover(jsonClone(record.plan), jsonClone(record));
        if (recovered && recovered.committed === true) {
          const recoveredAt = now();
          record.status = 'committed';
          record.recovered = true;
          record.result = jsonClone(recovered.result);
          record.committedAt = nowIso(recoveredAt);
          record.lastFailure = null;
          const added = auditRow(state, `completion_step:${stepKey}`, 'repair.closeout.completion_step_committed', recoveredAt, {
            disposition: `outbox_step_recovered:${stepKey}`,
          });
          emitNew(eventlog, added, 'repair.closeout.completion_step_committed', state, { step: stepKey, recovered: true });
          save(state);
          return publishCommittedResult(options, record.result);
        }
      }
      const startedAt = now();
      record.status = 'started';
      record.attempts = Number(record.attempts || 0) + 1;
      record.startedAt = record.startedAt || nowIso(startedAt);
      record.lastAttemptAt = nowIso(startedAt);
      record.lastFailure = null;
      save(state);
      try {
        const committedResult = options.commit(jsonClone(record.plan), jsonClone(record));
        const committedAt = now();
        record.status = 'committed';
        record.result = jsonClone(committedResult);
        record.committedAt = nowIso(committedAt);
        record.lastFailure = null;
        const added = auditRow(state, `completion_step:${stepKey}`, 'repair.closeout.completion_step_committed', committedAt, {
          disposition: `outbox_step_committed:${stepKey}`,
        });
        emitNew(eventlog, added, 'repair.closeout.completion_step_committed', state, { step: stepKey, recovered: false });
        save(state);
        const published = publishCommittedResult(options, record.result);
        if (afterCommit) afterCommit({ key: stepKey, phase: 'committed', ticketId: state.ticketId, result: published });
        return published;
      } catch (error) {
        record.lastFailure = {
          at: nowIso(now()),
          code: safeId(error && error.code) || null,
          reason: 'side_effect_failed_before_durable_step_receipt',
        };
        state.completionOutbox.status = 'retry_required';
        state.completionOutbox.updatedAt = nowIso(now());
        save(state);
        throw error;
      }
    }

    function step(key, options = {}) {
      const stepKey = safeId(key);
      if (!stepKey) throw new Error('repair closeout outbox step key is invalid');
      if (typeof options.commit !== 'function') throw new Error(`repair closeout outbox step ${stepKey} requires commit`);
      const record = ensureStepRecord(stepKey, options);
      if (options.defer === true) {
        if (record.status === 'committed') return publishCommittedResult(options, record.result);
        if (record.status === 'pending') {
          record.status = 'staged';
          record.stagedAt = nowIso(now());
          save(state);
        }
        deferredSteps.push({ key: stepKey, record, options });
        if (afterStep) afterStep({ key: stepKey, phase: 'staged', ticketId: state.ticketId, plan: jsonClone(record.plan) });
        reconcileCompletionChildren(state, now(), `after_${stepKey}_stage`);
        return jsonClone(options.preview === undefined ? record.result : options.preview);
      }
      const committed = commitStep(stepKey, record, options);
      if (afterStep) afterStep({ key: stepKey, phase: 'committed', ticketId: state.ticketId, result: committed });
      reconcileCompletionChildren(state, now(), `after_${stepKey}`);
      return committed;
    }

    const pendingResult = executor({
      state,
      outbox: state.completionOutbox,
      step,
    });
    reconcileCompletionChildren(state, now(), 'before_public_commit');
    state.completionOutbox.status = 'eligibility_locked';
    state.completionOutbox.eligibilityLockedAt = nowIso(now());
    save(state);
    for (const deferred of deferredSteps) {
      commitStep(deferred.key, deferred.record, deferred.options);
    }
    const result = pendingResult && typeof pendingResult.finalize === 'function'
      ? pendingResult.finalize()
      : pendingResult;
    state.completionOutbox.status = 'steps_committed';
    state.completionOutbox.receipt = jsonClone(result && result.receipt || result || null);
    state.completionOutbox.updatedAt = nowIso(now());
    save(state);
    const closed = markClosedUnlocked({
      ticketId,
      completionToken: input.completionToken,
      receipt: state.completionOutbox.receipt,
      commitAuthority: completionCommitAuthority,
    });
    closed.completionOutbox.status = 'closed';
    closed.completionOutbox.updatedAt = nowIso(now());
    save(closed);
    return { alreadyClosed: false, state: closed, result };
  }

  function markClosedUnlocked(input = {}) {
    if (!enabled) return null;
    const ticketId = safeId(input.ticketId || input.id);
    const state = load(ticketId);
    if (!state) throw new Error('repair closeout handshake not found');
    if (state.status === 'closed' || state.status === 'forced_closed') return state;
    if (state.status !== 'closing_in_progress' || !state.completion) throw new Error(`repair closeout handshake is not ready: ${state.status}`);
    if (!input.completionToken || input.completionToken !== state.completion.token) throw new Error('repair closeout completion token mismatch');
    const nowMs = now();
    const forced = !!state.completion.forced;
    if (input.commitAuthority !== completionCommitAuthority) reconcileCompletionChildren(state, nowMs, 'final');
    state.finalStatus = forced ? 'forced_closed_with_unconfirmed_warning' : 'closed';
    state.status = forced ? 'forced_closed' : 'closed';
    state.closedAt = nowIso(nowMs);
    state.completionReceipt = input.receipt || null;
    state.completion = null;
    const added = auditRow(state, 'handshake:closed', 'repair.closeout.closed', nowMs, {
      disposition: forced ? 'owner_forced_close_with_warning' : 'normal_close',
      ownerDecision: state.ownerDecision,
      finalStatus: state.finalStatus,
      warnings: state.warnings.slice(),
    });
    emitNew(eventlog, added, 'repair.closeout.closed', state, { finalStatus: state.finalStatus, warnings: state.warnings });
    save(state);
    return state;
  }

  function releaseCompletionUnlocked(input = {}) {
    if (!enabled) return null;
    const ticketId = safeId(input.ticketId || input.id);
    const state = load(ticketId);
    if (!state || state.status !== 'closing_in_progress' || !state.completion) return state;
    if (!input.completionToken || input.completionToken !== state.completion.token) return state;
    const token = state.completion.token;
    const forced = !!state.completion.forced;
    state.status = forced ? 'ready_to_close_forced' : 'ready_to_close';
    state.completion = null;
    const nowMs = now();
    const added = auditRow(state, `completion:${token}:released`, 'repair.closeout.completion_released', nowMs, {
      disposition: 'completion_failed_safe_retry',
    });
    emitNew(eventlog, added, 'repair.closeout.completion_released', state, {});
    save(state);
    return state;
  }

  function recordOwnerDecisionUnlocked(input = {}) {
    if (!enabled) throw new Error('repair closeout handshake is disabled');
    const card = input.card;
    const action = String(input.action || '');
    if (!isOwnerDecisionCard(card) || !['approve', 'reject'].includes(action)) throw new Error('bad repair closeout owner decision card');
    if (!DecisionToken.verify(card.decisionSecret, card.id, action, input.token)) throw new Error('repair closeout owner decision token invalid');
    const ticketId = safeId(card.ticketId || card.payload && card.payload.ticketId);
    const handshakeId = safeId(card.handshakeId || card.payload && card.payload.handshakeId);
    const state = load(ticketId);
    if (!state || state.handshakeId !== handshakeId) throw new Error('repair closeout owner decision handshake mismatch');
    if (!state.ownerDecisionRequest || state.ownerDecisionRequest.cardId !== card.id) throw new Error('repair closeout owner decision request mismatch');
    const decision = action === 'approve' ? FORCE_DECISION : KEEP_WAITING_DECISION;
    const receiptId = `repair-closeout-${crypto.createHash('sha256').update(`${state.handshakeId}\n${card.id}\n${action}`).digest('hex').slice(0, 24)}`;
    const verifiedAt = nowIso(now());
    const receipt = {
      schemaVersion: SCHEMA_VERSION,
      receiptId,
      ticketId: state.ticketId,
      sourceIncidentId: state.sourceIncidentId || null,
      handshakeId: state.handshakeId,
      cardId: card.id,
      action,
      decision,
      approved: true,
      actor: 'owner',
      verification: 'hmac-sha256-decision-card',
      verifiedAt,
    };
    const receiptFile = ownerDecisionReceiptFile(receiptId);
    const existing = readJson(receiptFile, null);
    if (existing
      && state.ownerDecision && state.ownerDecision.receiptId === receiptId
      && state.ownerDecision.decision === decision
      && Array.isArray(state.audit) && state.audit.some(row => row && row.key === `owner:receipt:${receiptId}`)) {
      return { ok: true, already: true, receipt: existing, receiptFile, state };
    }
    if (existing && JSON.stringify(existing) !== JSON.stringify(receipt)) {
      if (existing.ticketId !== receipt.ticketId || existing.handshakeId !== receipt.handshakeId || existing.decision !== receipt.decision) {
        throw new Error('repair closeout owner decision receipt conflict');
      }
      receipt.verifiedAt = existing.verifiedAt;
    } else if (!existing) {
      writeJsonAtomic(receiptFile, receipt);
    }
    state.ownerDecision = {
      decision,
      approved: true,
      decidedAt: receipt.verifiedAt,
      actor: 'owner',
      receiptId,
      cardId: card.id,
      verification: receipt.verification,
    };
    state.ownerDecisionRequest = Object.assign({}, state.ownerDecisionRequest, {
      status: 'decided',
      decidedAt: receipt.verifiedAt,
      decision,
      receiptId,
    });
    const nowMs = now();
    const added = auditRow(state, `owner:receipt:${receiptId}`, 'repair.closeout.owner_decision_recorded', nowMs, {
      disposition: decision === FORCE_DECISION ? 'owner_approved_force_read_only' : 'owner_decided_keep_waiting',
      ownerDecision: state.ownerDecision,
    });
    emitNew(eventlog, added, 'repair.closeout.owner_decision_recorded', state, { receiptId, decision, cardId: card.id });
    save(state);
    return { ok: true, already: !added, receipt, receiptFile, state };
  }

  function matchingHandshakeStates(ticketId, sourceIncidentId) {
    if (!fs.existsSync(stateDir)) return [];
    const states = [];
    for (const name of fs.readdirSync(stateDir).filter(item => /^[A-Za-z0-9._-]+\.json$/.test(item)).sort()) {
      const state = readJson(path.join(stateDir, name), null);
      if (!state || !safeId(state.ticketId)) continue;
      const ticketMatch = !!ticketId && state.ticketId === ticketId;
      const incidentMatch = !!sourceIncidentId && safeId(state.sourceIncidentId) === sourceIncidentId;
      if (ticketMatch || incidentMatch) states.push({ state, ticketMatch });
    }
    states.sort((a, b) => Number(b.ticketMatch) - Number(a.ticketMatch) || a.state.ticketId.localeCompare(b.state.ticketId));
    return states;
  }

  function enqueueWithFence(input = {}, enqueueFn) {
    if (typeof enqueueFn !== 'function') throw new Error('repair closeout enqueue fence requires enqueue callback');
    const agent = safeId(input.agent);
    if (!enabled || agent !== CHILD_AGENT) return enqueueFn();
    const candidate = { task: input.task };
    const ticketId = entryTicketId(candidate);
    const sourceIncidentId = entrySourceIncidentId(candidate);
    if (!ticketId && !sourceIncidentId) return enqueueFn();
    const queueId = safeId(input.queueId || input.id);
    if (!queueId) throw new Error('repair closeout enqueue fence requires queue id');
    return withEnqueueFenceLock(() => {
      const matches = matchingHandshakeStates(ticketId, sourceIncidentId);
      if (!matches.length) return enqueueFn();
      const matchedTicketId = matches[0].state.ticketId;
      return withStateLock(matchedTicketId, () => {
        const state = load(matchedTicketId);
        if (!state || !matchesCloseout(candidate, state.ticketId, state.sourceIncidentId)) return enqueueFn();
        const nowMs = now();
        const key = `${agent}:${queueId}`;
        if (!state.children[key]) {
          state.children[key] = {
            queueAgent: agent,
            queueId,
            originalStatus: 'not_enqueued',
            observedStatus: 'rejected',
            disposition: 'enqueue_rejected_closeout_fence',
            actionAt: nowIso(nowMs),
            requiresConfirmation: false,
            confirmed: true,
            confirmation: {
              mode: 'durable_enqueue_fence',
              at: nowIso(nowMs),
              proof: 'queue_entry_not_created',
            },
          };
        }
        const added = auditRow(state, `child:${key}:enqueue_rejected`, 'repair.closeout.child_enqueue_rejected', nowMs, {
          childId: key,
          originalStatus: 'not_enqueued',
          disposition: 'durable_closeout_fence_rejected_enqueue',
          confirmation: state.children[key].confirmation,
          finalStatus: state.finalStatus,
        });
        emitNew(eventlog, added, 'repair.closeout.child_enqueue_rejected', state, {
          childId: key,
          handshakeStatus: state.status,
        });
        if (added) save(state);
        const error = new Error(`repair enqueue rejected by closeout fence for ticket ${state.ticketId}`);
        error.code = 'REPAIR_CLOSEOUT_ENQUEUE_FENCED';
        error.ticketId = state.ticketId;
        error.sourceIncidentId = state.sourceIncidentId || null;
        error.queueId = queueId;
        error.handshakeStatus = state.status;
        throw error;
      });
    });
  }

  function preflight(input = {}) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('repair closeout preflight requires ticketId');
    if (!enabled) return { enabled: false, allowClose: true, blocked: false, reason: 'proposal_only_feature_disabled', state: null };
    return withEnqueueFenceLock(() => withStateLock(ticketId, () => preflightUnlocked(input)));
  }

  function confirmChild(input = {}) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('child confirmation requires ticketId');
    if (!enabled) throw new Error('repair closeout handshake is disabled');
    return withStateLock(ticketId, () => confirmChildUnlocked(input));
  }

  function markClosed(input = {}) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('repair closeout close requires ticketId');
    if (!enabled) return null;
    return withEnqueueFenceLock(() => withStateLock(ticketId, () => markClosedUnlocked(input)));
  }

  function runCompletion(input = {}, executor) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('repair closeout completion requires ticketId');
    if (!enabled) {
      const pendingResult = executor({
        state: null,
        outbox: null,
        step(_key, options) {
          const committed = options.commit(options.plan, null);
          if (typeof options.onCommitted === 'function') options.onCommitted(committed);
          return committed;
        },
      });
      return {
        disabled: true,
        result: pendingResult && typeof pendingResult.finalize === 'function'
          ? pendingResult.finalize()
          : pendingResult,
      };
    }
    return withEnqueueFenceLock(() => withStateLock(ticketId, () => runCompletionUnlocked(input, executor)));
  }

  function releaseCompletion(input = {}) {
    const ticketId = safeId(input.ticketId || input.id);
    if (!ticketId) throw new Error('repair closeout release requires ticketId');
    if (!enabled) return null;
    return withStateLock(ticketId, () => releaseCompletionUnlocked(input));
  }

  function recordOwnerDecision(input = {}) {
    const card = input.card;
    const ticketId = safeId(card && (card.ticketId || card.payload && card.payload.ticketId));
    if (!ticketId) throw new Error('repair closeout owner decision requires ticketId');
    if (!enabled) throw new Error('repair closeout handshake is disabled');
    return withStateLock(ticketId, () => recordOwnerDecisionUnlocked(input));
  }

  return {
    enabled,
    queueRoot,
    stateDir,
    preflight,
    confirmChild,
    markClosed,
    runCompletion,
    releaseCompletion,
    recordOwnerDecision,
    enqueueWithFence,
    load,
    stateFile,
    ownerDecisionReceiptFile,
  };
}

function applyOwnerDecisionCard(options = {}) {
  const manager = createManager({
    queueRoot: options.queueRoot,
    workdir: options.workdir,
    stateDir: options.stateDir,
    enabled: true,
    now: options.now,
    eventlog: options.eventlog,
  });
  return manager.recordOwnerDecision({ card: options.card, action: options.action, token: options.token });
}

module.exports = {
  CHILD_AGENT,
  DEFAULT_TTL_MS,
  FORCE_DECISION,
  KEEP_WAITING_DECISION,
  REQUIRED_CONFIRMATION,
  OWNER_DECISION_KIND,
  MANDATORY_STEER,
  createManager,
  isOwnerDecisionCard,
  applyOwnerDecisionCard,
  entryTicketId,
  entrySourceIncidentId,
  matchesCloseout,
};
