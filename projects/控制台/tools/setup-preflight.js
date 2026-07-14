#!/usr/bin/env node
'use strict';

const path = require('path');
const Setup = require('../setup-service');

async function main() {
  const result = await Setup.initializeLegacyInstallation({
    workspaceRoot: path.resolve(__dirname, '../../..'),
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok !== false,
    completed: !!result.completed,
    migrated: !!result.migrated,
    source: result.source || 'none',
  })}\n`);
}

main().catch(() => {
  process.stderr.write('setup_preflight_failed\n');
  process.exit(1);
});
