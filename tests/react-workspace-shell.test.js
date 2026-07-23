#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'projects', '控制台', 'frontend');
const publicApp = path.join(root, 'projects', '控制台', 'public', 'app');

function text(file) {
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const pkg = JSON.parse(text(path.join(frontend, 'package.json')));
  assert.strictEqual(pkg.dependencies.react, '18.3.1');
  assert.strictEqual(pkg.dependencies['react-dom'], '18.3.1');
  assert(pkg.scripts.build.includes('vite build'));

  const vite = text(path.join(frontend, 'vite.config.ts'));
  assert(vite.includes("base: '/app/'"));
  assert(vite.includes("../public/app"));

  const app = text(path.join(frontend, 'src', 'App.tsx'));
  const shell = text(path.join(frontend, 'src', 'app', 'WorkspaceShell.tsx'));
  const api = text(path.join(frontend, 'src', 'lib', 'api.ts'));
  const home = text(path.join(frontend, 'src', 'features', 'workspace', 'WorkspaceHome.tsx'));
  const composer = text(path.join(frontend, 'src', 'features', 'tasks', 'TaskComposer.tsx'));
  const board = text(path.join(frontend, 'src', 'features', 'tasks', 'TaskBoard.tsx'));
  assert(shell.includes('<TaskComposer'));
  assert(home.includes('<TaskBoard'));
  assert(api.includes('/api/queues/overview'));
  assert(api.includes('/api/task-board/ceo'));
  assert(api.includes('/api/queue/'));
  assert(composer.includes("event.key === 'Enter' && !event.shiftKey"));
  assert(composer.includes('localStorage.setItem(DRAFT_KEY'));
  assert(composer.includes('event.clipboardData.items'));
  assert(board.includes('overflow') || text(path.join(frontend, 'src', 'styles', 'app.css')).includes('.task-list'));

  const server = text(path.join(root, 'projects', '控制台', 'server.js'));
  assert(server.includes("u.pathname === '/workspace-next'"));
  assert(server.includes("u.pathname === '/workspace-legacy'"));
  assert(server.includes("u.pathname.startsWith('/app/')"));

  const builtIndex = path.join(publicApp, 'index.html');
  assert(fs.existsSync(builtIndex), 'frontend build output must exist at public/app/index.html');
  assert(text(builtIndex).includes('/app/assets/'));
  console.log(JSON.stringify({ pass: true, suite: 'react-workspace-shell' }));
}

main();
