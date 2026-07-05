#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const RepairPolicy = require('../../../shared/agents/repair/repair-policy');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function main() {
  const workdir = path.resolve(arg('--workdir', process.env.CONSOLE_WORKDIR || path.resolve(__dirname, '../../..')));
  const ticketId = arg('--ticket', '');
  const ticketFile = arg('--ticket-file', ticketId ? path.join(workdir, 'board', 'repair-tickets', `${ticketId}.md`) : '');
  const taskId = arg('--task', '');
  const queueId = arg('--queue', '');
  const interactionsFile = arg('--interactions', '');
  const records = RepairPolicy.collectInteractionRecords({ workdir, ticketId, taskId, queueId });
  const interactions = interactionsFile ? JSON.parse(readText(interactionsFile) || '[]') : [];
  const analysis = RepairPolicy.analyzeRepairContext({
    ticketText: ticketFile ? readText(ticketFile) : '',
    records,
    interactions,
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    ticketId,
    taskId,
    queueId,
    analysis,
    checklist: RepairPolicy.buildRepairChecklist(analysis),
  }, null, 2) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e && e.message || String(e) }));
    process.exit(1);
  }
}
