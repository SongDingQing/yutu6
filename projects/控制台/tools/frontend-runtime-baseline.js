#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const FrontendRoute = require('../frontend-route');

const CONTROL_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(CONTROL_ROOT, '..', '..');
const ARTIFACTS_ROOT = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(CONTROL_ROOT, 'artifacts');
const OUTPUT = path.join(ARTIFACTS_ROOT, 'ai-fe-upgrade', 'runtime-baseline.json');
const PUBLIC_APP = path.join(CONTROL_ROOT, 'public', 'app');

function command(args) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildFiles() {
  const files = [];
  if (!fs.existsSync(PUBLIC_APP)) return files;
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push({
        path: path.relative(CONTROL_ROOT, file),
        bytes: fs.statSync(file).size,
        sha256: hash(file),
      });
    }
  };
  walk(PUBLIC_APP);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function fetchState(base) {
  const read = async pathname => {
    const response = await fetch(`${base}${pathname}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
    return response.json();
  };
  const [health, snapshot, route] = await Promise.all([
    read('/api/health'),
    read('/api/workspace/snapshot'),
    read('/api/frontend/route'),
  ]);
  return {
    health: {
      pid: health.pid,
      uptimeSec: health.uptimeSec,
      memory: health.memory,
    },
    snapshot: {
      revision: snapshot.revision,
      lastSeq: snapshot.lastSeq,
      generatedAt: snapshot.generatedAt,
    },
    route,
  };
}

async function main() {
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8799;
  const versionFile = path.join(WORKSPACE_ROOT, 'VERSION.json');
  const state = await fetchState(`http://127.0.0.1:${port}`);
  const baseline = {
    schema: 'yutu6-frontend-runtime-baseline@1',
    recordedAt: new Date().toISOString(),
    git: {
      branch: command(['git', 'branch', '--show-current']),
      commit: command(['git', 'rev-parse', 'HEAD']),
    },
    version: fs.existsSync(versionFile) ? JSON.parse(fs.readFileSync(versionFile, 'utf8')) : null,
    frontend: {
      target: FrontendRoute.readTarget(ARTIFACTS_ROOT),
      files: buildFiles(),
    },
    runtime: state,
    routes: {
      default: '/workspace',
      explicitReact: '/workspace-next',
      legacy: '/workspace-legacy',
    },
    rollbackCommand: 'node projects/控制台/tools/set-workspace-ui.js legacy',
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(WORKSPACE_ROOT, OUTPUT),
    target: baseline.frontend.target,
    buildFiles: baseline.frontend.files.length,
    pid: baseline.runtime.health.pid,
    revision: baseline.runtime.snapshot.revision,
  }));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
