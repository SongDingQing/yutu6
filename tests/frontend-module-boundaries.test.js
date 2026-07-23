#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'projects', '控制台', 'frontend');
const src = path.join(frontend, 'src');
const publicAssets = path.join(root, 'projects', '控制台', 'public', 'app', 'assets');

for (const domain of ['workspace', 'tasks', 'bulletin', 'office', 'flow', 'settings', 'gateway']) {
  assert.equal(fs.statSync(path.join(src, 'features', domain)).isDirectory(), true, `missing feature domain ${domain}`);
}

const appSource = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');
const boundarySource = fs.readFileSync(path.join(src, 'app', 'ErrorBoundary.tsx'), 'utf8');
assert(appSource.includes("lazy(() => import('./features/views/WorkspaceViews'))"));
assert(boundarySource.includes('getDerivedStateFromError'));
assert(boundarySource.includes('/workspace-legacy'));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build'], {
  cwd: frontend,
  env: process.env,
  encoding: 'utf8',
});
if (build.stdout) process.stdout.write(build.stdout);
if (build.stderr) process.stderr.write(build.stderr);
assert.equal(build.status, 0, 'frontend build failed');

const chunks = fs.readdirSync(publicAssets);
assert(chunks.some(name => /^WorkspaceViews-.*\.js$/.test(name)), 'workspace views must be split from the first-screen chunk');
assert(chunks.some(name => /^OfficeView-.*\.js$/.test(name)), 'office must be a lazy chunk');
assert(chunks.some(name => /^FlowView-.*\.js$/.test(name)), 'flow must be a lazy chunk');
assert(chunks.some(name => /^UsageView-.*\.js$/.test(name)), 'usage must be a lazy chunk');
assert(chunks.some(name => /^ControlRoomView-.*\.js$/.test(name)), 'control room must be a lazy chunk');
assert(chunks.some(name => /^GatewayView-.*\.js$/.test(name)), 'gateway must be a lazy chunk');
assert(chunks.some(name => /^SettingsRoute-.*\.js$/.test(name)), 'settings must be a lazy chunk');

console.log(JSON.stringify({
  pass: true,
  suite: 'frontend-module-boundaries',
  lazyChunks: chunks.filter(name => /^(WorkspaceViews|OfficeView|FlowView|UsageView|ControlRoomView|GatewayView|SettingsRoute)-/.test(name)).sort(),
}));
