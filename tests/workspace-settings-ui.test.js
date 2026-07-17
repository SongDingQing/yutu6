#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'projects', '控制台', 'public', 'workspace.html');
const html = fs.readFileSync(file, 'utf8');

const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
for (const match of scripts) new vm.Script(match[1]);

assert.match(html, /id="settingsButton"[^>]+title="打开设置中心"[^>]+aria-label="打开设置中心"/);
assert.match(html, /id="settingsOverlay"[^>]+aria-hidden="true"/);
assert.match(html, /role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="settingsTitle"/);
assert.match(html, /id="settingsSaveState"[^>]+data-state="loading"[^>]+role="status"/);
assert.match(html, /id="settingsPresets"[^>]+role="tablist"/);
assert.match(html, /data-settings-preset="lean"[^>]+data-concurrency="1"[^>]*>低内存</);
assert.match(html, /data-settings-preset="balanced"[^>]+data-concurrency="2"[^>]*>均衡</);
assert.match(html, /data-settings-preset="productive"[^>]+data-concurrency="3"[^>]*>高效率</);
assert.match(html, /data-settings-preset="full"[^>]+data-concurrency="4"[^>]*>全速</);
assert.match(html, /id="settingsConcurrency"[^>]+type="hidden"/);
assert.match(html, /id="settingsPresetPreview"[^>]+role="tabpanel"/);
assert.match(html, /预计内存/);
assert.match(html, /内存为控制台、worker 与模型 CLI 的保守估算/);
assert.match(html, /settings-save-state\[data-state="saved"\]/);
assert.match(html, /settings-save-state\[data-state="unsaved"\]/);
assert.match(html, /state==='saved'\?'已保存':'未保存'/);
assert(!html.includes('当前生效'), 'the preset UI must not repeat the current value');
assert(!html.includes('已保存待应用'), 'the preset UI must not repeat the pending value');
assert(!html.includes('当前值与已保存值一致'), 'normal saved state belongs in the top status pill only');
assert.match(html, /id="settingsRestart"[^>]*>重启控制台</);
assert.match(html, /restart\.textContent=!saved\?'先保存再重启':runtimeSettingsData\.restartRequired\?'重启以应用':'无需重启'/);
assert.match(html, /const RUNTIME_SETTING_PRESETS=\[/);
assert.match(html, /settingsSelectedConcurrency=Number\(button\.dataset\.concurrency\)/);
assert.match(html, /engineMaxConcurrency:n/);
assert.match(html, /\['ArrowLeft','ArrowRight','Home','End'\]/);
assert.match(html, /syncSettingsSelection\(\);\s*\n\t  };/, 'busy button reset must be followed by settings state synchronization');
assert.match(html, /if\(e\.key==='Escape'\).*closeSettingsCenter/);
assert.match(html, /settingsReturnFocus/);
assert.match(html, /'\/api\/settings\/runtime'/);
assert.match(html, /'\/api\/console\/restart'/);
assert.match(html, /'X-Console-CSRF':token/);

assert.match(html, /data-kind="bulletin" data-status="\$\{esc\(status\)\}"/);
assert.match(html, /data-kind="queue" data-status="\$\{esc\(status\)\}"/);
assert.match(html, /tb-ceo-card[\s\S]{0,280}data-kind="queue" data-status="\$\{esc\(status\)\}"/, 'CEO root queue cards share the queue-only cancel boundary');
assert.match(html, /data-context-action="delete-bulletin"/);
assert.match(html, /'删除待拍板':'取消任务'/);
assert.match(html, /e\.key==='ContextMenu'\|\|\(e\.shiftKey&&e\.key==='F10'\)/);
assert.match(html, /\['ArrowDown','ArrowUp','Home','End'\]/);
assert.match(html, /\/api\/bulletin\/\$\{encodeURIComponent\(target\.id\)\}\/remove/);
assert.match(html, /\/api\/queue\/\$\{encodeURIComponent\(target\.agent\)\}\/\$\{encodeURIComponent\(target\.id\)\}\/cancel/);
assert.match(html, /card\.dataset\.kind==='queue'&&\(card\.dataset\.status==='queued'\|\|card\.dataset\.status==='paused'\)/);
assert(!html.includes("target.action==='delete-queue'"), 'ordinary queue cards must never expose delete semantics');

console.log(JSON.stringify({ pass: true, suite: 'workspace-settings-ui', scripts: scripts.length }));
