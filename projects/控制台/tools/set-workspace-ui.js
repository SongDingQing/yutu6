#!/usr/bin/env node
'use strict';

const path = require('path');
const FrontendRoute = require('../frontend-route');

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !FrontendRoute.TARGETS.has(String(args[0]).toLowerCase())) {
    console.error('usage: node projects/控制台/tools/set-workspace-ui.js <react|legacy>');
    process.exitCode = 64;
    return;
  }
  const controlRoot = path.resolve(__dirname, '..');
  const artifactsRoot = process.env.CONSOLE_ARTIFACTS_DIR
    ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
    : path.join(controlRoot, 'artifacts');
  const result = FrontendRoute.writeTarget(artifactsRoot, args[0], {
    reason: 'workspace UI route switch',
  });
  console.log(JSON.stringify({
    ok: true,
    target: result.target,
    routeFile: path.relative(controlRoot, result.file),
    workspace: '/workspace',
    rollback: 'node projects/控制台/tools/set-workspace-ui.js legacy',
  }));
}

main();
