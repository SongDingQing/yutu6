#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const workspaceFile = path.join(repoRoot, 'projects/控制台/public/workspace.html');
const publicRoot = path.join(repoRoot, 'projects/控制台/public');
const html = fs.readFileSync(workspaceFile, 'utf8');

function runBlock(startNeedle, endNeedle, seed) {
  const start = html.indexOf(startNeedle);
  const end = html.indexOf(endNeedle, start);
  assert(start > 0 && end > start, `workspace block not found: ${startNeedle}`);
  const ctx = Object.assign({}, seed || {});
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
}

function extractConstObject(name) {
  const match = html.match(new RegExp(`const ${name}=([\\s\\S]*?);\\n`));
  assert(match, `${name} not found`);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`result=${match[1]}`, ctx);
  return ctx.result;
}

function assertFileExistsFromPublicUrl(url, message) {
  assert(url.startsWith('/public/'), message || `${url} must use /public prefix`);
  const file = path.join(publicRoot, url.replace(/^\/public\//, ''));
  assert(fs.existsSync(file), `${url} must exist at ${file}`);
}

function graphRect(node, width, height) {
  const NODE_W = 126;
  const NODE_H = 90;
  return {
    id: node.id,
    group: node.flowGroup,
    x: (node.x / 100) * width - NODE_W / 2,
    y: (node.y / 100) * height - NODE_H / 2,
    w: NODE_W,
    h: NODE_H,
  };
}

function overlaps(a, b, pad = 8) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

function assertNoOverlap(nodes, label) {
  const rects = nodes.map(n => graphRect(n, 1120, 900));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert(!overlaps(rects[i], rects[j]), `${label}: ${rects[i].id} overlaps ${rects[j].id}`);
    }
  }
}

function main() {
  assert(html.includes('const FLOW_GROUP_DEFS='), 'flow graph must define module groups');
  assert(html.includes('flowCollapsedGroups=loadFlowCollapsedGroups()'), 'flow graph must persist collapsed module state');
  assert(html.includes('flowShowAllEdges='), 'flow graph must support all-edge expansion');
  assert(html.includes('signature===flowRenderKey'), 'flow graph must skip no-op DOM rebuilds');
  assert(html.includes('function scheduleGraphRender'), 'flow graph must coalesce event/poll renders through a scheduler');
  assert(html.includes('data-flow-group'), 'flow nodes must carry module group metadata');
  assert(html.includes('handleAvatarError(this)'), 'avatar images must have runtime error fallback');
  assert(html.includes('handleOfficeSpriteError(this)'), 'office sprites must have runtime error fallback');
  assert(html.includes('function officeActorDomId'), 'office actor DOM ids must use a dedicated helper');
  assert(html.includes('id="${esc(officeActorDomId(id))}"'), 'office actors must not reuse section container ids');
  assert(html.includes('getElementById(officeActorDomId(role))'), 'office incremental render must target actor ids, not section ids');
  assert(html.includes('.office-repair .office-people{display:grid;grid-template-columns:repeat(2'), 'repair department must keep lead and worker in one bounded row');
  assert(!html.includes('id="office-${esc(id)}"'), 'office actor ids must not collide with office section container ids');

  const avatarFiles = extractConstObject('AVATAR_FILES');
  Object.values(avatarFiles).forEach(file => assertFileExistsFromPublicUrl(`/public/assets/avatars/${file}`, `avatar file ${file} must exist`));
  const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'assets/avatars/manifest.json'), 'utf8'));
  manifest.forEach(item => assertFileExistsFromPublicUrl(item.file, `manifest entry ${item.id} must use served path`));

  const ctx = runBlock('function projectLaneXs', 'function bindViews', {
    queueAgents: [{ projectId: '控制台' }],
    uniq: xs => [...new Set((xs || []).filter(Boolean))],
    Object,
  });
  ctx.rebuildTopology();
  const nodes = ctx.AGENT_META;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  ['ui_optimizer', 'dev_worker', 'hermes', 'quality_ops'].forEach(id => assert(byId[id], `${id} node missing`));
  assert(byId.dev_worker.y > byId.ui_optimizer.y, 'dev_worker must sit below ui_optimizer');
  assert(byId.quality_ops.y > byId.hermes.y, 'quality_ops must sit below Hermes with clear spacing');

  const defaultVisible = nodes.filter(n => !['ops', 'hr'].includes(n.flowGroup));
  assertNoOverlap(defaultVisible, 'default visible modules');
  assertNoOverlap(nodes, 'all expanded modules');

  const visibleDefaultIds = new Set(defaultVisible.map(n => n.id));
  const defaultEdges = ctx.BASE_EDGES.filter(e => visibleDefaultIds.has(e.from) && visibleDefaultIds.has(e.to) && e.tier !== 'secondary');
  const allVisibleEdges = ctx.BASE_EDGES.filter(e => visibleDefaultIds.has(e.from) && visibleDefaultIds.has(e.to));
  assert(defaultEdges.length < allVisibleEdges.length, 'default flow view must hide secondary lines until expanded');
  assert(ctx.BASE_EDGES.some(e => e.tier === 'secondary'), 'base graph must mark secondary/reporting lines');

  console.log(JSON.stringify({ pass: true, suite: 'workspace-render-architecture', nodes: nodes.length, defaultEdges: defaultEdges.length, allVisibleEdges: allVisibleEdges.length }));
}

main();
