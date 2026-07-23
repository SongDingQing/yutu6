#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTROL_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(CONTROL_ROOT, '..', '..');
const FRONTEND_ROOT = path.join(CONTROL_ROOT, 'frontend');
const MANIFEST_FILE = path.join(FRONTEND_ROOT, 'quality-gates.json');
const REPORT_DIR = path.join(CONTROL_ROOT, 'artifacts', 'ai-fe-upgrade', 'quality-gates');

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function runStep(name, command, args, cwd, env = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: Object.assign({}, process.env, env),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return {
    name,
    command: [command, ...args].join(' '),
    elapsedMs: Date.now() - started,
    status: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
  };
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(REPORT_DIR, `${stamp}-${report.mode}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const mode = option('--mode', 'fast');
  if (mode === 'list') {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  if (!['fast', 'visual', 'release'].includes(mode)) {
    console.error(`unknown frontend quality gate: ${mode}`);
    process.exitCode = 64;
    return;
  }

  const startedAt = new Date();
  const steps = [];
  if (mode === 'visual') {
    const uiChanged = process.argv.includes('--ui-changed') || process.env.UI_CHANGED === '1';
    const screenshots = path.join(CONTROL_ROOT, 'artifacts', 'ai-fe-upgrade', 'screenshots');
    const files = fs.existsSync(screenshots)
      ? fs.readdirSync(screenshots).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).sort()
      : [];
    const report = {
      schema: 'yutu6-frontend-quality-gate-report@1',
      mode,
      ok: !uiChanged || files.length > 0,
      skipped: !uiChanged,
      reason: uiChanged ? 'UI changed; browser evidence is required.' : 'No UI change was declared.',
      screenshots: files,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt.getTime(),
    };
    const file = writeReport(report);
    console.log(JSON.stringify({ ...report, reportFile: path.relative(WORKSPACE_ROOT, file) }, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  steps.push(runStep('typecheck', 'npm', ['run', 'typecheck'], FRONTEND_ROOT));
  if (steps.at(-1).status === 0) {
    steps.push(runStep(
      mode === 'release' ? 'frontend-release-profile' : 'frontend-fast-profile',
      process.execPath,
      ['tests/run.js', '--profile', mode === 'release' ? 'frontend-release' : 'frontend-fast', '--fail-fast'],
      WORKSPACE_ROOT,
    ));
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  const budgetMs = Number(manifest.budgets && manifest.budgets.routineTotalMs) || 120000;
  const ok = steps.every(step => step.status === 0) && (mode !== 'fast' || elapsedMs <= budgetMs);
  const report = {
    schema: 'yutu6-frontend-quality-gate-report@1',
    mode,
    ok,
    budgetMs: mode === 'fast' ? budgetMs : null,
    withinBudget: mode !== 'fast' || elapsedMs <= budgetMs,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs,
    steps,
  };
  const file = writeReport(report);
  console.log(JSON.stringify({ ...report, reportFile: path.relative(WORKSPACE_ROOT, file) }, null, 2));
  if (!ok) process.exitCode = 1;
}

main();
