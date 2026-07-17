#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = process.argv[2];
if (!input) fail('usage: validate-report.js <report.md>');
const file = path.resolve(process.cwd(), input);
if (!fs.existsSync(file)) fail(`report not found: ${file}`);

const text = fs.readFileSync(file, 'utf8');
for (const heading of ['## 来源清单', '## Open-source teardown 证据', '### 质量运营检查', '### 监管检查']) {
  if (!text.includes(heading)) fail(`missing required section: ${heading}`);
}
if (!/^##\s+(?:\d+\s*条\s*)?候选账本\s*$/m.test(text)) {
  fail('missing required section: ## 候选账本');
}

const lines = text.split(/\r?\n/).filter(line => /^\| AHR-\d{2} \|/.test(line));
if (lines.length < 15 || lines.length > 50) fail(`recommendation count must be 15-50, got ${lines.length}`);
const ids = lines.map(line => line.split('|')[1].trim());
if (new Set(ids).size !== ids.length) fail('recommendation IDs must be unique');

for (const line of lines) {
  const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
  if (cells.length !== 6 || cells.some(cell => !cell)) fail(`incomplete recommendation row: ${cells[0] || 'unknown'}`);
  if (!['recommend', 'experiment', 'defer', 'reject'].includes(cells[5])) {
    fail(`invalid decision for ${cells[0]}: ${cells[5]}`);
  }
}

const sourceUrls = new Set(Array.from(text.matchAll(/https:\/\/[^)\s|]+/g), match => match[0]));
if (sourceUrls.size < 8) fail(`deep report needs at least 8 source URLs, got ${sourceUrls.size}`);
if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail('secret hygiene: private key material detected');

process.stdout.write(JSON.stringify({
  ok: true,
  report: path.relative(process.cwd(), file),
  recommendations: lines.length,
  sources: sourceUrls.size,
}) + '\n');
