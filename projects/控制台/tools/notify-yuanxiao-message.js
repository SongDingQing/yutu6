#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { pushToInbox, pushToYuanxiaoPath } = require('./notify-yuanxiao-approval');

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

function compact(value, maxLength) {
  const clean = String(value || '').replace(/\r\n/g, '\n').trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function messageBody(args) {
  if (args['body-file']) return fs.readFileSync(String(args['body-file']), 'utf8').trim();
  return String(args.body || '').trim();
}

function buildPayload(args) {
  const title = compact(args.title, 120);
  const project = compact(args.project || '玉兔6', 80);
  const category = compact(args.category || 'project-update', 80);
  const body = messageBody(args);
  if (!title) throw new Error('需要 --title');
  if (!body) throw new Error('需要 --body 或 --body-file');
  const dedupeKey = compact(
    args['dedupe-key'] || crypto.createHash('sha256').update(`${project}\n${title}\n${body}`).digest('hex'),
    160
  );
  return {
    text: body,
    title,
    project,
    category,
    dedupe_key: dedupeKey,
    speaker: compact(args.speaker || '项目播报', 80),
    conversation: compact(args.conversation || 'yuanxiao-app', 120),
    source: compact(args.source || 'yutu6-project-update', 120),
    ...(args['task-id'] ? { task_id: compact(args['task-id'], 160) } : {}),
    format: 'markdown',
  };
}

function buildTypedCard(args) {
  const cardType = compact(args['card-type'], 40).toLowerCase();
  if (!['progress', 'failure'].includes(cardType)) return null;
  const taskId = compact(args['task-id'], 120);
  if (!taskId) throw new Error('--card-type 需要 --task-id');
  const status = cardType === 'failure' ? 'failed' : compact(args.status || 'running', 40).toLowerCase();
  const progress = Math.max(0, Math.min(100, Number.parseInt(args.progress || (status === 'done' ? '100' : '0'), 10) || 0));
  return {
    task: {
      task_id: taskId,
      title: compact(args.title, 160),
      kind: cardType === 'failure' ? 'task_failure' : 'task_progress',
      route: compact(args.route || 'yutu6', 80),
      status,
      progress,
      project_id: compact(args.project || '玉兔6', 120),
      message: compact(messageBody(args), 1200),
    },
    card: {
      card_id: compact(args['card-id'] || `${cardType}-${taskId}`, 120),
      card_type: cardType,
      task_id: taskId,
      status,
      title: compact(args.title, 160),
      summary: compact(messageBody(args), 500),
      renderer: 'android_native_v2',
      actions: cardType === 'failure'
        ? [{ id: 'retry', label: '重试' }, { id: 'create_repair', label: '转维修' }]
        : [],
      payload: {
        stage: compact(args.stage, 120),
        progress,
        reason: compact(args.reason, 500),
        evidence: compact(args.evidence, 500),
        responsible_party: compact(args.owner, 120),
      },
      actor: 'yutu6-project-update',
    },
  };
}

function send(args, sender = pushToInbox, typedSender = pushToYuanxiaoPath) {
  const payload = buildPayload(args);
  const typed = buildTypedCard(args);
  let nativeCard = false;
  if (typed) {
    const taskResult = typedSender('/api/v1/tasks', typed.task);
    const cardResult = taskResult && taskResult.ok ? typedSender('/api/v1/cards', typed.card) : null;
    nativeCard = Boolean(cardResult && cardResult.ok);
    payload.typed_card_id = typed.card.card_id;
    payload.fallback = !nativeCard;
  }
  const result = sender(payload);
  return {
    ok: Boolean(result && result.ok),
    code: Number(result && result.code || 0),
    receiptId: result && result.receiptId || null,
    project: payload.project,
    title: payload.title,
    category: payload.category,
    dedupeKey: payload.dedupe_key,
    nativeCard,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = send(args);
    if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.ok) console.error(`✓ 已推送到元宵：${result.project} · ${result.title}`);
    else console.error(`✗ 元宵推送失败（HTTP ${result.code || '?'}）`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`✗ ${String(error && error.message || error).slice(0, 240)}`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { parseArgs, buildPayload, buildTypedCard, send };
