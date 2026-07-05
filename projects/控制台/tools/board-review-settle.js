#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const BoardReview = require('../board-review');
const EventLog = require('../../../shared/engine/eventlog');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function usage() {
  return [
    'Usage:',
    '  node projects/控制台/tools/board-review-settle.js --file <state.json> --task <taskId> --round <n> --director-count <n> --opinion <opinion.json> [--eventlog <events.jsonl>]',
    '',
    'This script only settles all_submitted state. Pass/fail policy remains in board-review.js integration logic.',
  ].join('\n');
}

function main() {
  const file = arg('file');
  const taskId = arg('task');
  const round = Number(arg('round', '1')) || 1;
  const directorCount = Number(arg('director-count', String(BoardReview.DIRECTORS.length))) || BoardReview.DIRECTORS.length;
  const opinionFile = arg('opinion');
  if (!file || !opinionFile) {
    console.error(usage());
    process.exit(2);
  }
  const opinion = JSON.parse(fs.readFileSync(path.resolve(opinionFile), 'utf8'));
  const eventlogFile = arg('eventlog');
  const eventlog = eventlogFile ? new EventLog(path.resolve(eventlogFile)) : null;
  const result = BoardReview.settleDirectorOpinion({
    file: path.resolve(file),
    taskId,
    round,
    directorCount,
    opinion,
    eventlog,
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    file: result.file,
    allSubmitted: result.allSubmitted,
    settled: result.settled,
    justSettled: result.justSettled,
    submittedCount: result.submittedCount,
    expectedDirectors: result.expectedDirectors,
    submittedDirectors: result.submittedDirectors,
  }, null, 2) + '\n');
}

if (require.main === module) main();
