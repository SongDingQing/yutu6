#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'projects', '控制台', 'frontend', 'src');
const app = fs.readFileSync(path.join(frontend, 'App.tsx'), 'utf8');
const header = fs.readFileSync(path.join(frontend, 'features', 'workspace', 'AppHeader.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(frontend, 'features', 'settings', 'SettingsRoute.tsx'), 'utf8');
const api = fs.readFileSync(path.join(frontend, 'lib', 'api.ts'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'projects', '控制台', 'public', 'workspace.html'), 'utf8');

assert(app.includes("lazy(() => import('./features/settings/SettingsRoute'))"));
assert(app.includes("view === 'settings'"));
assert(header.includes('?view=settings'));
assert(settings.includes('低内存'));
assert(settings.includes('均衡'));
assert(settings.includes('高效率'));
assert(settings.includes('全速'));
assert(settings.includes('预计内存'));
assert(settings.includes('已保存'));
assert(settings.includes('未保存'));
assert(settings.includes('简洁 UI'));
assert(settings.includes('复杂 UI'));
assert(settings.includes('fetchFrontendRoute'));
assert(settings.includes('saveFrontendRoute'));
assert(settings.includes('saveRuntimeSettings'));
assert(settings.includes('restartConsole'));
assert(api.includes("'/api/settings/runtime'"));
assert(api.includes("'/api/console/restart'"));
assert(api.includes("'/api/frontend/route'"));
assert(api.includes("'X-Console-CSRF': token"));
assert(legacy.includes('data-settings-ui-target="react"'));
assert(legacy.includes('data-settings-ui-target="legacy"'));
assert(legacy.includes("settingsPost('/api/frontend/route'"));
assert(!settings.includes('API_KEY'));
assert(!settings.includes('SECRET'));

console.log(JSON.stringify({ pass: true, suite: 'react-settings' }));
