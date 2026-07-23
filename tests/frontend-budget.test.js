#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const controlRoot = path.join(root, 'projects', '控制台');
const publicApp = path.join(controlRoot, 'public', 'app');
const manifest = JSON.parse(fs.readFileSync(path.join(controlRoot, 'frontend', 'quality-gates.json'), 'utf8'));
const budgets = manifest.budgets;
const html = fs.readFileSync(path.join(publicApp, 'index.html'), 'utf8');

function asset(pattern, label) {
  const match = html.match(pattern);
  assert(match, `built index does not reference ${label}`);
  return path.join(publicApp, match[1].replace(/^\/app\//, ''));
}

function gzipBytes(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

const mainJs = asset(/src="(\/app\/assets\/index-[^"]+\.js)"/, 'main JavaScript');
const mainCss = asset(/href="(\/app\/assets\/index-[^"]+\.css)"/, 'main CSS');
const jsGzip = gzipBytes(mainJs);
const cssGzip = gzipBytes(mainCss);

assert(
  jsGzip <= budgets.mainJavaScriptGzipBytes,
  `main JavaScript gzip budget exceeded: ${jsGzip}/${budgets.mainJavaScriptGzipBytes}`,
);
assert(
  cssGzip <= budgets.mainCssGzipBytes,
  `main CSS gzip budget exceeded: ${cssGzip}/${budgets.mainCssGzipBytes}`,
);

console.log(JSON.stringify({
  pass: true,
  suite: 'frontend-budget',
  mainJavaScriptGzipBytes: jsGzip,
  mainCssGzipBytes: cssGzip,
  budgets,
}));
