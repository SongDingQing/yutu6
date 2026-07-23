#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const frontend = path.resolve(__dirname, '../projects/控制台/frontend');
const serverFile = path.resolve(__dirname, '../projects/控制台/server.js');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'test:contracts'], {
  cwd: frontend,
  env: process.env,
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

assert.strictEqual(result.status, 0, `frontend contract tests exited with ${result.status}`);
const serverSource = fs.readFileSync(serverFile, 'utf8');
assert(
  serverSource.includes('const FRONTEND_CONTRACT_SCHEMA_VERSION = 1;'),
  'server must publish the frontend contract schema version',
);
assert(
  (serverSource.match(/schemaVersion: FRONTEND_CONTRACT_SCHEMA_VERSION/g) || []).length >= 7,
  'all six contract read endpoints and the version error response must carry schemaVersion',
);
console.log(JSON.stringify({ pass: true, suite: 'frontend-contracts' }));
