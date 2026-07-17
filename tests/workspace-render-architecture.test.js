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
  const NODE_W = 138;
  const NODE_H = 88;
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

function assertNoOverlapAt(nodes, width, height, nodeWidth, nodeHeight, label) {
  const rects = nodes.map(node => ({
    id: node.id,
    x: (node.x / 100) * width - nodeWidth / 2,
    y: (node.y / 100) * height - nodeHeight / 2,
    w: nodeWidth,
    h: nodeHeight,
  }));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert(!overlaps(rects[i], rects[j], 6), `${label}: ${rects[i].id} overlaps ${rects[j].id}`);
    }
  }
}

function assertInsideViewport(nodes, width, height, nodeWidth, nodeHeight, label) {
  nodes.map(node => ({
    id: node.id,
    x: (node.x / 100) * width - nodeWidth / 2,
    y: (node.y / 100) * height - nodeHeight / 2,
    w: nodeWidth,
    h: nodeHeight,
  })).forEach(rect => {
    assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height, `${label}: ${rect.id} must stay inside ${width}x${height}`);
  });
}

function assertGroupsInsideLanes(nodes, lanes, groups, width, height, nodeWidth, nodeHeight, label) {
  const laneById = Object.fromEntries(lanes.map(lane => [lane.id, lane]));
  nodes.filter(node => groups.includes(node.flowGroup)).forEach(node => {
    const lane = laneById[node.flowGroup];
    assert(lane, `${label}: ${node.flowGroup} lane missing`);
    const rect = {
      x: (node.x / 100) * width - nodeWidth / 2,
      y: (node.y / 100) * height - nodeHeight / 2,
      w: nodeWidth,
      h: nodeHeight,
    };
    const bounds = {x: lane.left / 100 * width, y: lane.top / 100 * height, w: lane.width / 100 * width, h: lane.height / 100 * height};
    assert(rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.w <= bounds.x + bounds.w && rect.y + rect.h <= bounds.y + bounds.h, `${label}: ${node.id} must stay inside ${node.flowGroup} lane`);
  });
}

function main() {
  assert(html.includes('const FLOW_GROUP_DEFS='), 'flow graph must define module groups');
	  assert(html.includes('flowCollapsedGroups=loadFlowCollapsedGroups()'), 'flow graph must persist collapsed module state');
		  assert(html.includes("const FLOW_VIEW_STATE_VERSION='2026-07-14-main-chain-v3'"), 'flow graph must version its default-density migration');
	  assert(html.includes("localStorage.getItem(FLOW_VIEW_STATE_VERSION_KEY)!==FLOW_VIEW_STATE_VERSION"), 'old all-expanded preferences must migrate once to the new main-chain default');
  assert(html.includes('flowShowAllEdges='), 'flow graph must support all-edge expansion');
  assert(html.includes('const FLOW_BOARD_DIRECTOR_IDS=BOARD_DIRECTOR_IDS;'), 'flow board layer must derive directly from BOARD_DIRECTOR_IDS');
	  assert(html.includes("board_claude:{label:'董事 Claude Fable 5',runner:'claude-fable-5'}"), 'Claude Fable director must be visible in workspace topology');
	  assert(!html.includes('function carpetFloorTilesHtml'), 'office floor must not recreate overlapping thick carpet tiles');
	  assert(!html.includes('office-tile carpet'), 'office floor must use one continuous surface instead of toothed tile rows');
  assert(html.includes('function fitFlowView') && html.includes('function resetFlowView'), 'flow graph must expose fit and reset operations');
  assert(html.includes('data-flow-action="fit"') && html.includes('data-flow-action="reset"'), 'flow toolbar must render fit and reset buttons');
  assert(html.includes('>完整关系</button>') && html.includes('显示全部连线与完整关系'), 'flow toolbar must retain an explicit full-relationship mode');
  assert(html.includes('class="flow-legend"') && html.includes('主链') && html.includes('支撑支线') && html.includes('回路线'), 'flow graph must render a visible line/state legend');
	  assert(html.includes('@media(max-width:640px)') && html.includes("wrap.dataset.flowLayout=layout.narrow?'narrow':(flowFitView?'fit':(layout.compact?'compact'"), 'flow graph must keep narrow stacking while allowing fit mode to override the medium-width compact canvas');
	  assert(html.includes('主链顺序：入口、董事会事前评议、CEO、项目主管与执行层；公共支撑与维修按需展开'), 'flow map aggregate name must describe the default hierarchy and optional groups');
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

  const boardDirectorIds = extractConstObject('BOARD_DIRECTOR_IDS');
  const ctx = runBlock('function projectLaneXs', 'function bindViews', {
    queueAgents: [{ projectId: '控制台' }],
    uniq: xs => [...new Set((xs || []).filter(Boolean))],
    FLOW_BOARD_DIRECTOR_IDS: boardDirectorIds,
    EXTRA_AGENTS: extractConstObject('EXTRA_AGENTS'),
    roleLabel: id => id,
    Object,
  });
  ctx.rebuildTopology();
  const nodes = ctx.AGENT_META;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  [...boardDirectorIds, 'ui_optimizer', 'dev_worker', 'hermes', 'quality_ops'].forEach(id => assert(byId[id], `${id} node missing`));
  assert.deepStrictEqual(Array.from(new Set(ctx.FLOW_BOARD_DIRECTOR_IDS)), Array.from(boardDirectorIds), 'flow board layer must stay identical to BOARD_DIRECTOR_IDS');
  assert(byId.dev_worker.y > byId.ui_optimizer.y, 'dev_worker must sit below ui_optimizer');
  assert(byId.quality_ops.y > byId.hermes.y, 'quality_ops must sit below Hermes with clear spacing');

	  const defaultVisible = nodes.filter(n => !['support', 'repair'].includes(n.flowGroup));
	  assert(nodes.every(n => ['entry', 'review', 'core', 'project', 'support', 'repair'].includes(n.flowGroup)), 'every flow node must belong to one of the six hierarchy groups');
	  assertNoOverlap(nodes, 'all expanded modules');
	  assert(defaultVisible.length < nodes.length, 'default flow view must reduce density by hiding optional support and repair groups');

  const visibleDefaultIds = new Set(defaultVisible.map(n => n.id));
  const defaultEdges = ctx.BASE_EDGES.filter(e => visibleDefaultIds.has(e.from) && visibleDefaultIds.has(e.to) && e.tier !== 'secondary');
  const allVisibleEdges = ctx.BASE_EDGES.filter(e => visibleDefaultIds.has(e.from) && visibleDefaultIds.has(e.to));
  assert(defaultEdges.length < allVisibleEdges.length, 'default flow view must hide secondary lines until expanded');
  assert(ctx.BASE_EDGES.some(e => e.tier === 'secondary'), 'base graph must mark secondary/reporting lines');
  ['spine', 'review', 'project', 'support', 'repair'].forEach(category => assert(ctx.BASE_EDGES.some(e => e.category === category), `flow edges must classify ${category} lines`));
	  [['chairman', 'secretary'], ['secretary', 'orchestrator'], ['orchestrator', 'supervisor-控制台'], ['supervisor-控制台', 'worker_code-控制台'], ['repair-lead', 'repair']].forEach(([from, to]) => {
	    assert(ctx.BASE_EDGES.some(e => e.from === from && e.to === to), `existing real edge ${from}>${to} must keep its direction`);
	  });
	  assert(ctx.BASE_EDGES.some(e => e.from === 'secretary' && e.to === 'orchestrator' && e.tier === 'secondary'), 'normal secretary-to-CEO shortcut must stay available in full-relationship mode without cluttering the default board path');
	  ctx.FLOW_BOARD_DIRECTOR_IDS.forEach(id => {
	    assert(ctx.BASE_EDGES.some(e => e.from === 'secretary' && e.to === id && e.category === 'review'), `secretary must send the original goal to ${id} before CEO planning`);
	    assert(ctx.BASE_EDGES.some(e => e.from === id && e.to === 'orchestrator' && e.tier === 'primary'), `${id} must pass an approved opinion into CEO planning`);
	    assert(!ctx.BASE_EDGES.some(e => e.from === 'orchestrator' && e.to === id), `CEO must not appear before ${id} in preflight review`);
	  });

	  const flowGroupDefs = extractConstObject('FLOW_GROUP_DEFS');
	  assert.strictEqual(flowGroupDefs.find(group => group.id === 'support').defaultOpen, false, 'support group must be collapsed by default');
	  assert.strictEqual(flowGroupDefs.find(group => group.id === 'repair').defaultOpen, false, 'repair group must be collapsed by default');
	  const flowStorage = new Map([
	    ['yt6-flow-state-version', 'old-density'],
	    ['yt6-flow-collapsed-groups', JSON.stringify({ support: false, repair: false })],
	    ['yt6-flow-show-all-edges', '1'],
	  ]);
	  const migrationCtx = runBlock('function defaultFlowCollapsedGroups', 'let PROJECTS', {
	    FLOW_GROUP_DEFS: flowGroupDefs,
		    FLOW_VIEW_STATE_VERSION: '2026-07-14-main-chain-v3',
	    FLOW_VIEW_STATE_VERSION_KEY: 'yt6-flow-state-version',
	    localStorage: {
	      getItem: key => flowStorage.has(key) ? flowStorage.get(key) : null,
	      setItem: (key, value) => flowStorage.set(key, String(value)),
	    },
	    JSON,
	    Object,
	  });
	  assert.deepStrictEqual(JSON.parse(JSON.stringify(migrationCtx.loadFlowCollapsedGroups())), { support: true, repair: true }, 'density migration must collapse both optional groups');
	  assert.strictEqual(flowStorage.get('yt6-flow-show-all-edges'), '0', 'density migration must restore main-chain edge mode');
		  assert.strictEqual(flowStorage.get('yt6-flow-state-version'), '2026-07-14-main-chain-v3', 'density migration must persist its version');
	  const narrowCtx = runBlock('function flowNodeMetrics', 'function bezierPoint', {
    flowFitView: false,
    FLOW_GROUP_DEFS: flowGroupDefs,
    flowGroupOf: id => byId[id].flowGroup,
    flowGroupDef: id => flowGroupDefs.find(group => group.id === id) || null,
    Object,
  });
  const narrow = narrowCtx.flowLayout(ctx.GRAPH_NODES, 390, 2200);
  assert.strictEqual(narrow.narrow, true, '390px flow viewport must use the narrow stacked topology');
  assert.strictEqual(narrow.lanes.length, 6, 'narrow topology must retain all six hierarchy groups');
  assertNoOverlapAt(narrow.nodes, 390, 2200, 132, 88, 'narrow topology');

  const compact = narrowCtx.flowLayout(ctx.GRAPH_NODES, 676, 718);
  assert.strictEqual(compact.compact, true, '676px flow viewport must use the bounded compact topology');
  assert.strictEqual(compact.lanes.length, 6, 'compact topology must retain all six hierarchy groups');
	  assertNoOverlapAt(compact.nodes, 676, 718, 132, 76, '676px compact topology');
	  assertInsideViewport(compact.nodes, 676, 718, 132, 76, '676px compact topology');
	  assertGroupsInsideLanes(compact.nodes.map(node => Object.assign({flowGroup: byId[node.id].flowGroup}, node)), compact.lanes, ['support', 'repair'], 676, 718, 132, 76, '676px compact topology');

	  const compactDefault = narrowCtx.flowLayout(defaultVisible.map(({id, label, x, y}) => ({id, label, x, y})), 676, 718);
	  assert.strictEqual(compactDefault.lanes.length, 4, 'default compact topology must render only the four main-chain groups');
	  assert(compactDefault.lanes.every(lane => lane.width === 98), 'default compact topology must use the full graph width');
	  assertNoOverlapAt(compactDefault.nodes, 676, 718, 132, 76, '676px default main-chain topology');
	  assertInsideViewport(compactDefault.nodes, 676, 718, 132, 76, '676px default main-chain topology');

  const twoProjectNodes = ctx.GRAPH_NODES.concat([
    { id: 'supervisor-Simulaid', flowGroup: 'project' },
    { id: 'worker_code-Simulaid', flowGroup: 'project' },
    { id: 'worker_insight-Simulaid', flowGroup: 'project' },
  ]);
  const twoProjectGroups = Object.assign({}, byId, Object.fromEntries(twoProjectNodes.map(node => [node.id, node])));
  const twoProjectCtx = runBlock('function flowNodeMetrics', 'function bezierPoint', {
    flowFitView: false,
    FLOW_GROUP_DEFS: flowGroupDefs,
    flowGroupOf: id => twoProjectGroups[id].flowGroup,
    flowGroupDef: id => flowGroupDefs.find(group => group.id === id) || null,
    Object,
  });
  const twoProjectCompact = twoProjectCtx.flowLayout(twoProjectNodes, 676, 900);
	  assertNoOverlapAt(twoProjectCompact.nodes, 676, 900, 132, 76, '676px two-project compact topology');
	  assertInsideViewport(twoProjectCompact.nodes, 676, 900, 132, 76, '676px two-project compact topology');
	  assertGroupsInsideLanes(twoProjectCompact.nodes.map(node => Object.assign({flowGroup: twoProjectGroups[node.id].flowGroup}, node)), twoProjectCompact.lanes, ['support', 'repair'], 676, 900, 132, 76, '676px two-project compact topology');

  const interactionCalls = [];
  const interactionCtx = runBlock('function fitFlowView', 'function renderFlowControls', {
    flowFitView: false,
    flowCollapsedGroups: { support: true },
    flowShowAllEdges: true,
	    defaultFlowCollapsedGroups: () => ({ support: true, repair: true }),
    invalidateFlowRender: () => interactionCalls.push('invalidate'),
    renderFlowControls: () => interactionCalls.push('controls'),
    renderGraph: options => interactionCalls.push(`graph:${Boolean(options && options.force)}`),
    focusFlowOrigin: () => interactionCalls.push('focus'),
    announceFlow: text => interactionCalls.push(`announce:${text}`),
    saveFlowState: () => interactionCalls.push('save'),
  });
  interactionCtx.fitFlowView();
  assert.strictEqual(interactionCtx.flowFitView, true, 'fit action must enable compact view');
  assert(interactionCalls.includes('graph:true') && interactionCalls.some(v => v.startsWith('announce:已适配')), 'fit action must force-render and announce feedback');
  interactionCalls.length = 0;
  interactionCtx.resetFlowView();
  assert.strictEqual(interactionCtx.flowFitView, false, 'reset action must leave fit mode');
  assert.strictEqual(interactionCtx.flowShowAllEdges, false, 'reset action must restore secondary-line default');
	  assert.deepStrictEqual(JSON.parse(JSON.stringify(interactionCtx.flowCollapsedGroups)), { support: true, repair: true }, 'reset action must restore the main-chain-first group visibility');
  assert(interactionCalls.includes('save') && interactionCalls.includes('graph:true') && interactionCalls.some(v => v.startsWith('announce:链路图已复位')), 'reset action must persist, force-render and announce feedback');

  console.log(JSON.stringify({ pass: true, suite: 'workspace-render-architecture', nodes: nodes.length, defaultEdges: defaultEdges.length, allVisibleEdges: allVisibleEdges.length }));
}

main();
