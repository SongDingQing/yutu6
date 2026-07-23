'use strict';

const fs = require('fs');
const path = require('path');

const TARGETS = new Set(['react', 'legacy']);
const DEFAULT_TARGET = 'legacy';

function routeFile(artifactsRoot) {
  return path.join(path.resolve(artifactsRoot), 'frontend-ui-route.json');
}

function normalizeTarget(value, fallback = DEFAULT_TARGET) {
  const target = String(value || '').trim().toLowerCase();
  return TARGETS.has(target) ? target : fallback;
}

function readTarget(artifactsRoot, fallback = DEFAULT_TARGET) {
  try {
    const value = JSON.parse(fs.readFileSync(routeFile(artifactsRoot), 'utf8'));
    return normalizeTarget(value && value.target, fallback);
  } catch (_) {
    return fallback;
  }
}

function writeTarget(artifactsRoot, target, opts = {}) {
  const normalized = normalizeTarget(target, '');
  if (!normalized) throw new Error('frontend target must be react or legacy');
  const file = routeFile(artifactsRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const document = {
    schema: 'yutu6-frontend-route@1',
    target: normalized,
    updatedAt: new Date(opts.now || Date.now()).toISOString(),
    reason: String(opts.reason || 'manual switch').slice(0, 240),
  };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
  return { file, ...document };
}

function workspaceStaticFile(target) {
  return normalizeTarget(target) === 'react' ? 'app/index.html' : 'workspace.html';
}

module.exports = {
  DEFAULT_TARGET,
  TARGETS,
  routeFile,
  normalizeTarget,
  readTarget,
  writeTarget,
  workspaceStaticFile,
};
