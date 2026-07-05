#!/usr/bin/env node
'use strict';

const path = require('path');
const EventLog = require('../../../shared/engine/eventlog');
const QuotaDegrade = require('../quota-degrade');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(ROOT, 'artifacts');

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function scopeFromArgs() {
  const scope = arg('--scope');
  if (scope) return QuotaDegrade.scopeFromKey(scope);
  const runner = arg('--runner');
  if (runner) return QuotaDegrade.runnerScope(runner);
  const bucket = arg('--bucket');
  if (bucket) return QuotaDegrade.bucketScope(bucket);
  return null;
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function usage() {
  console.log([
    'Usage:',
    '  node projects/控制台/tools/quota-degrade-control.js list',
    '  node projects/控制台/tools/quota-degrade-control.js status --scope runner:codex',
    '  node projects/控制台/tools/quota-degrade-control.js restore --scope runner:codex [--reason "..."]',
  ].join('\n'));
}

async function main() {
  const cmd = process.argv[2] || 'help';
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }
  if (cmd === 'list') {
    print({ ok: true, states: QuotaDegrade.listStates(ARTIFACTS_ROOT) });
    return;
  }
  const scope = scopeFromArgs();
  if (!scope) {
    usage();
    process.exit(2);
  }
  if (cmd === 'status') {
    print({ ok: true, scope, state: QuotaDegrade.readState(ARTIFACTS_ROOT, scope) || null });
    return;
  }
  if (cmd === 'restore') {
    const result = await QuotaDegrade.restoreScopeWithLock(ARTIFACTS_ROOT, scope, {
      reason: arg('--reason', 'quota recovered'),
      actor: arg('--actor', 'quota-degrade-control'),
    });
    try {
      const eventlog = new EventLog(path.join(ARTIFACTS_ROOT, 'engine-events.jsonl'));
      eventlog.emit('quota.restore', {
        scope: scope.key,
        ok: !!result.ok,
        status: result.status,
        incidentId: result.state && result.state.incidentId || null,
      });
    } catch (_) {}
    print(result);
    return;
  }
  usage();
  process.exit(2);
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
