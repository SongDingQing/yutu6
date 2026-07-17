#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const MeowaAssetDecisions = require('../meowa-asset-decisions');

function usage() {
  console.error('usage: node projects/控制台/tools/meowa-asset-decision.js register --spec <spec.json> [--artifacts-root <dir>] [--base-url <url>] [--dry-run]');
}

function argValue(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : '';
}

function redactTokens(value) {
  return String(value || '').replace(/([?&]t=)[A-Fa-f0-9]{16,}/g, '$1<redacted>');
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '';
  if (command !== 'register') {
    usage();
    process.exit(2);
  }
  const specFile = argValue(args, '--spec');
  if (!specFile) {
    usage();
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(specFile), 'utf8'));
  const result = MeowaAssetDecisions.registerAssetDecision(spec, {
    artifactsRoot: argValue(args, '--artifacts-root') || spec.artifactsRoot,
    baseUrl: argValue(args, '--base-url') || spec.baseUrl,
    dryRun: args.includes('--dry-run') || !!process.env.FEISHU_DRY_RUN,
  });
  const output = {
    ok: true,
    assetId: result.asset.assetId,
    status: result.asset.status,
    cardId: result.card.id,
    ledgerFile: result.ledgerFile,
    bulletinFile: result.bulletinFile,
    notify: {
      attempted: !!(result.notifyResult && result.notifyResult.attempted),
      sent: !!(result.notifyResult && result.notifyResult.sent),
      status: result.notifyResult && result.notifyResult.status,
      stdout: redactTokens(result.notifyResult && result.notifyResult.stdout),
      stderr: redactTokens(result.notifyResult && result.notifyResult.stderr),
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (e) {
  console.error(e && e.stack || e);
  process.exit(1);
}
