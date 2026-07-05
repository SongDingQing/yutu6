#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Server = require('../projects/控制台/server');

function runWorkspaceBlock(startNeedle, endNeedle, seed = {}) {
  const file = path.resolve(__dirname, '../projects/控制台/public/workspace.html');
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf(startNeedle);
  const end = html.indexOf(endNeedle, start);
  assert(start > 0 && end > start, `workspace block not found: ${startNeedle}`);
  const ctx = Object.assign({}, seed);
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
}

function main() {
  const workspaceFile = path.resolve(__dirname, '../projects/控制台/public/workspace.html');
  const workspaceHtml = fs.readFileSync(workspaceFile, 'utf8');
  assert(
    workspaceHtml.includes('.task-board.mode-active{grid-template-rows:auto minmax(104px,.62fr) minmax(260px,2.8fr)}') ||
    workspaceHtml.includes('.task-board.mode-running{grid-template-rows:auto minmax(0,1fr)}'),
    'running task board layout must reserve visible height for running section',
  );
  assert(workspaceHtml.includes('const TASK_BOARD_ACTIVE_LIMIT=20'), 'active task board must cap rendered waiting/candidate cards for large queues');
  assert(workspaceHtml.includes('const remaining=Math.max(0,TASK_BOARD_ACTIVE_LIMIT-runningShown.length)'), 'running cards must have priority over waiting cards before active render capping');
  assert(workspaceHtml.includes('const hiddenActive=Math.max(0,activeTotal-activeShown)'), 'large active queues must expose a hidden-count note instead of rendering every node');
  assert(workspaceHtml.includes('.tb-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;'), 'all task-board lists must be vertical scroll containers with contained wheel overscroll');
  assert(workspaceHtml.includes('.tb-card.selected'), 'task cards must expose a visible selected state');
  assert(workspaceHtml.includes('.tb-ceo-card.selected,.tb-queue-card.selected,.tb-running-card.selected'), 'selected task cards must override running/queued status colors visibly');
  assert(workspaceHtml.includes('.tb-node.waiting,.tb-node.paused'), 'paused flow nodes must have a visible waiting-style state');
  assert(workspaceHtml.includes('.tb-node.rework'), 'review rework nodes must have a distinct visible state');
  assert(workspaceHtml.includes('.tb-node.absent'), 'board runner absence nodes must have a distinct neutral state');
  assert(workspaceHtml.includes('function isBoardRunnerAbsenceEvent'), 'workspace must classify board runner failures as absent');
  assert(workspaceHtml.includes("ev.type==='node.absent'||isBoardRunnerAbsenceEvent(ev)"), 'workspace progress must render board runner failure as absent');
  assert(workspaceHtml.includes('.tb-card.tb-rework-card:not(.tb-repair-card)'), 'rework task cards must expose an independent yellow card frame without overriding repair red');
  assert(workspaceHtml.includes('.tb-progress-timer'), 'running progress must expose an independent second-level timer chip');
  assert(workspaceHtml.includes('@keyframes tbProgressRun'), 'running progress must expose a visible motion effect');
  assert(workspaceHtml.includes('updateTaskBoardProgressTimers(document)'), 'progress timers must tick without full task-board rerender');
  assert(workspaceHtml.includes('function collapseWaitingTaskCards'), 'task board must collapse non-running waiting cards on outside click');
  assert(workspaceHtml.includes('taskBoardIsRunningCard(card)'), 'outside collapse must skip running cards');
  assert(workspaceHtml.includes('const ceoRunningTasks=useCeoTasks?ceoTasks.filter'), 'CEO running tasks must be split from queued tasks');
  assert(workspaceHtml.includes('const ceoWaitingTasks=useCeoTasks?ceoTasks.filter'), 'CEO queued tasks must stay in waiting/backlog instead of crowding running');
  assert(workspaceHtml.includes("const ceoWaitingTasks=useCeoTasks?ceoTasks.filter(card=>['queued','paused'].includes(card&&card.status)"), 'CEO queue tab must only include queued/paused CEO tasks');
  assert(workspaceHtml.includes('const queueCount=waitCount+candidateAll.length'), 'queue tab count must include queued/paused tasks plus bulletin candidates');
  assert(workspaceHtml.includes('const pastShown=queueHistory.slice(0,TASK_BOARD_HISTORY_LIMIT)'), 'past tab must be driven by terminal queue history');
  assert(workspaceHtml.includes('function taskBoardEnableFeedback'), 'bulletin enable must build explicit queued/running feedback');
  assert(workspaceHtml.includes("if(status&&status.status==='queued') return `已入队:"), 'bulletin enable feedback must say queued instead of silently staying on running tab');
  assert(workspaceHtml.includes('function taskBoardSetModeForQueueStatus'), 'bulletin enable must switch task-board mode based on queue status');
  assert(workspaceHtml.includes('taskBoardSetModeForQueueStatus(status);'), 'enable click handler must use the returned/live queue status to switch tabs');
  assert(workspaceHtml.includes('const live=taskBoardFindQueueStatus'), 'enable click handler must re-check live queue state after polling');
  assert(!workspaceHtml.includes('tb-mode-tabs'), 'task board must not keep the duplicate right-side mode tab group');
  assert(!workspaceHtml.includes('tb-mode-tab'), 'task board mode switching must live on the colored count chips only');
  assert(workspaceHtml.includes('<div class="qsum" role="tablist" aria-label="任务板切换">'), 'colored count chip group must own the task-board tablist role');
  assert(workspaceHtml.includes("class=\"qchip run ${mode==='running'?'on':''}\" type=\"button\" data-tb-mode=\"running\" role=\"tab\""), 'running count chip must switch to running mode');
  assert(workspaceHtml.includes("class=\"qchip wait ${mode==='queue'?'on':''}\" type=\"button\" data-tb-mode=\"queue\" role=\"tab\""), 'queue count chip must switch to queue mode');
  assert(workspaceHtml.includes("class=\"qchip past ${mode==='past'?'on':''}\" type=\"button\" data-tb-mode=\"past\" role=\"tab\""), 'past count chip must switch to past mode');
  assert(workspaceHtml.includes('<div class="qtools"><button data-q-bulk="cancel-waiting"'), 'cancel queue button must remain outside the mode chip group');
  assert(workspaceHtml.includes('<button class="tb-refresh" data-q-bulk="refresh">刷新</button>'), 'refresh button must remain available after tab merge');
  assert(workspaceHtml.includes("document.querySelectorAll('#queue button[data-tb-mode]').forEach(btn=>"), 'colored count chips must be wired as the only task-board mode controls');
  assert(workspaceHtml.includes("localStorage.setItem('yt6-task-board-mode',mode)"), 'task-board mode chip clicks must persist the selected mode');
  assert(workspaceHtml.includes("if(act==='refresh') await pollQueue()"), 'refresh button must still refresh queue data');
  assert(workspaceHtml.includes("}else if(act==='cancel-waiting') await cancelWaitingQueue()"), 'cancel queue button must still invoke bulk waiting cancellation');
  assert(!workspaceHtml.includes('return `<article class="tb-card tb-ceo-card qitem ${esc(status)}${selectedClass}"'), 'running CEO cards must render as open details, not a collapsed article');
  const officeStatusRule = workspaceHtml.match(/(?:^|})\s*\.office-status\{[^}]+\}/);
  assert(officeStatusRule && officeStatusRule[0].includes('overflow:visible'), 'office status bubble must keep overflow visible so its arrow is not clipped');
  assert(!/overflow:hidden/.test(officeStatusRule[0]), 'office status bubble must not clip the ::after arrow');
  assert(workspaceHtml.includes('.office-agent.working:not([data-office-gate="1"]) .office-status::before'), 'working shimmer must be scoped to working office agents and exclude gate alerts');
  assert(workspaceHtml.includes('.office-agent[data-office-gate="1"] .office-status::before{content:none;animation:none}'), 'gate alerts must suppress the working shimmer');
  assert(workspaceHtml.includes('@media(prefers-reduced-motion: reduce)'), 'working shimmer must provide a reduced-motion fallback');
  const shimmerStart = workspaceHtml.indexOf('@keyframes officeStatusShimmer');
  const shimmerEnd = workspaceHtml.indexOf('@media(prefers-reduced-motion: reduce)', shimmerStart);
  assert(shimmerStart > 0 && shimmerEnd > shimmerStart, 'office shimmer keyframes must be present before the reduced-motion fallback');
  const shimmerBlock = workspaceHtml.slice(shimmerStart, shimmerEnd);
  assert(/transform:/.test(shimmerBlock) && /opacity:/.test(shimmerBlock), 'office shimmer must animate transform and opacity');
  assert(!/background-position|box-shadow/.test(shimmerBlock), 'office shimmer must not animate repaint-heavy background-position or box-shadow');
  assert(!workspaceHtml.includes('.office-agent.done .office-status::before'), 'done status must not receive shimmer');
  assert(!workspaceHtml.includes('.office-agent.fail .office-status::before'), 'fail status must not receive shimmer');
  assert(workspaceHtml.includes('data-testid="office-view"'), 'office view must expose a stable test/screenshot target');
  assert(workspaceHtml.includes("const WORKSPACE_VIEWS=['office','desks','flow'];"), 'workspace view memory must enumerate valid stage views');
  assert(workspaceHtml.includes("function loadCurrentView()"), 'workspace view memory must have an initialization read path');
  assert(workspaceHtml.includes('if(isWorkspaceView(q)) return q;'), 'workspace URL view must win when it is valid');
  assert(workspaceHtml.includes("return normalizeWorkspaceView(localStorage.getItem('yt6-ws-view'));"), 'workspace must read a saved valid stage view during initialization');
  assert(workspaceHtml.includes('function normalizeSideView'), 'side-panel memory must reject stale invalid localStorage values');
  assert(workspaceHtml.includes('let currentSideView=loadCurrentSideView();'), 'side-panel memory must use the normalized initialization read path');
  assert(!workspaceHtml.includes("new URLSearchParams(location.search).get('view')||localStorage.getItem('yt6-ws-view')"), 'office default must not be overridden by old localStorage view state');
  assert(workspaceHtml.includes('class="vtab on" type="button" role="tab" id="vtab-office"'), 'office stage tab must have a static selected fallback before polling completes');
  assert(workspaceHtml.includes('id="view-office" class="view on" role="tabpanel"'), 'office panel must have a static visible fallback before polling completes');
  assert(workspaceHtml.includes('id="view-desks" class="view" role="tabpanel"') && workspaceHtml.includes('aria-hidden="true" hidden data-scroll-key="view:desks"'), 'inactive desks panel must be hidden until JS selects it');
  assert(workspaceHtml.includes('id="view-flow" class="view" role="tabpanel"') && workspaceHtml.includes('aria-hidden="true" hidden data-scroll-key="view:flow"'), 'inactive flow panel must be hidden until JS selects it');
  assert(workspaceHtml.includes('.office-people{position:relative;z-index:3;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));'), 'office rows must use a five-column grid instead of flex-wrap');
  assert(workspaceHtml.includes('.chairman-suite{order:1}.office-boardroom{order:2') && workspaceHtml.includes('.office-common{order:3'), 'boardroom must be the second office row directly after chairman suite');
  assert(workspaceHtml.includes("if(boardSection) boardSection.style.display='flex';"), 'boardroom must remain visible instead of only rendering when board review is disabled');
  assert(workspaceHtml.includes("if(ob) ob.innerHTML=BOARD_DIRECTOR_IDS.map(officeActorHtml).join('');"), 'boardroom must always render the board directors');
  assert(workspaceHtml.includes("frontend_designer:{label:'前端程序员',runner:'zhipu-glm'}"), 'office frontend agent metadata must show 前端程序员');
  assert(workspaceHtml.includes('label:`后端程序员 · ${p}`'), 'office worker_code project desks must show 后端程序员');
  assert(workspaceHtml.includes("label:'前端程序员',group:'project'"), 'console office must show the frontend programmer station');
  assert(workspaceHtml.includes("'后端程序员':'worker_code'"), 'office aliases must include the new backend programmer label');
  assert(workspaceHtml.includes("'前端程序员':'frontend_designer'"), 'office aliases must include the new frontend programmer label');
  assert(!workspaceHtml.includes("frontend_designer:{label:'前端设计师'"), 'old frontend display label must not remain in office metadata');
  assert(!workspaceHtml.includes('label:`程序员 · ${p}`'), 'old bare programmer desk label must not remain in office metadata');
  assert(!workspaceHtml.includes("if(r==='worker_code') return '程序员';"), 'task-board progress role must not return the old bare programmer label');
  const initBlock = workspaceHtml.slice(workspaceHtml.indexOf('async function init'), workspaceHtml.indexOf('function agentRunner'));
  assert(initBlock.indexOf('setView(currentView)') > 0 && initBlock.indexOf('setView(currentView)') < initBlock.indexOf('await pollVersion()'), 'office view must be activated before slow polling awaits');
  const officeNameRule = workspaceHtml.match(/(?:^|})\s*\.office-name\{[^}]+\}/);
  assert(officeNameRule && officeNameRule[0].includes('white-space:normal') && officeNameRule[0].includes('overflow-wrap:anywhere'), 'office names must wrap instead of truncating');
  assert(officeNameRule && !/text-overflow:ellipsis/.test(officeNameRule[0]) && !/overflow:hidden/.test(officeNameRule[0]), 'office names must not use ellipsis clipping');
  assert(workspaceHtml.includes('--sprite-size:clamp(58px,72%,82px)'), 'office agents must be scaled near the chairman visible sprite size');

  const flowCtx = runWorkspaceBlock('function edgeKey', 'function queueCacheKey', {
    GRAPH_POS: {
      orchestrator: { x: 30, y: 32 },
      ui_optimizer: { x: 75, y: 31 },
      gui_desktop_control: { x: 91, y: 31 },
      dev_worker: { x: 75, y: 48 },
      hermes: { x: 91, y: 48 },
    },
  });
  const peekabooIn = flowCtx.edgePorts('ui_optimizer', 'gui_desktop_control', 1000, 600);
  const peekabooOut = flowCtx.edgePorts('gui_desktop_control', 'ui_optimizer', 1000, 600);
  assert.strictEqual(peekabooIn.mode, 'horizontal', 'Peekaboo incoming edge should stay horizontal');
  assert.strictEqual(peekabooOut.mode, 'horizontal', 'Peekaboo outgoing edge should stay horizontal');
  assert(peekabooIn.y2 < peekabooOut.y1, 'Peekaboo left-side incoming arrow and outgoing line must use separated ports');
  assert(peekabooOut.y1 - peekabooIn.y2 >= 42, 'Peekaboo left-side ports must be visually separated enough to avoid arrow overlap');
  assert(flowCtx.splitLeftPortLane('ui_optimizer', 'gui_desktop_control', 1) < 0, 'Peekaboo incoming edge must bend away from its outgoing line');
  assert(flowCtx.splitLeftPortLane('gui_desktop_control', 'ui_optimizer', -1) > 0, 'Peekaboo outgoing edge must bend away from its incoming arrow');
  const hermesIn = flowCtx.edgePorts('dev_worker', 'hermes', 1000, 600);
  const hermesOut = flowCtx.edgePorts('hermes', 'orchestrator', 1000, 600);
  assert.strictEqual(hermesIn.mode, 'horizontal', 'Hermes incoming edge should stay horizontal');
  assert.strictEqual(hermesOut.mode, 'horizontal', 'Hermes report edge should stay horizontal');
  assert(hermesIn.y2 < hermesOut.y1, 'Hermes left-side incoming arrow and outgoing line must use separated ports');
  assert(hermesOut.y1 - hermesIn.y2 >= 42, 'Hermes left-side ports must be visually separated enough to avoid arrow overlap');
  assert(flowCtx.splitLeftPortLane('dev_worker', 'hermes', 1) < 0, 'Hermes incoming edge must bend away from its outgoing report line');
  assert(flowCtx.splitLeftPortLane('hermes', 'orchestrator', -1) > 0, 'Hermes outgoing report edge must bend away from its incoming arrow');

  const activeCtx = runWorkspaceBlock('function taskBoardCeoQueueKeys', 'function taskBoardSourceLabel');
  const rows = activeCtx.taskBoardExtraRunningRows([
    { agent: { id: 'repair' }, item: { id: 'repair-run', task: { goal: '维修员正在处理卡死工单' } } },
    { agent: { id: 'worker_code' }, item: { id: 'worker-run', task: { goal: '普通实现任务' } } },
  ], [
    { downstream: { agent: 'repair', queueId: 'repair-run' } },
  ]);
  assert.strictEqual(rows.length, 1, 'repair running row must be shown even when CEO card has it as downstream');
  assert.strictEqual(rows[0].item.id, 'repair-run');

  const guardCtx = runWorkspaceBlock('function queueEntryTaskId', 'function queueCounts', {
    queueState: {
      repair: {
        running: [
          { id: 'repair-run', taskId: 'current-repair-task', task: { goal: '当前维修任务' } },
        ],
      },
    },
    normalizeRole: role => role,
    unscopedRole: role => String(role || '').replace(/-(Simulaid|控制台|[^-]+)$/, ''),
  });
  assert.strictEqual(guardCtx.roleHasDifferentRunningQueue('repair', 'old-done-task'), true, 'historical done task must not override current repair running state');
  assert.strictEqual(guardCtx.roleHasDifferentRunningQueue('repair', 'current-repair-task'), false, 'current running task may still receive its own terminal event');
  assert.strictEqual(guardCtx.isQueueGuardedTerminal({ type: 'node.end' }), true, 'node.end is guarded against initial done flash');

  const progress = Server._test.taskBoardProgressForEvent({
    type: 'node.output',
    role: 'repair',
    node: 'repair',
    stream: 'stderr',
    text: 'node -e "console.log(process.env.SECRET)"',
  }, '维修任务');
  assert(progress && /维修/.test(progress.text) && /跑脚本中/.test(progress.text), 'node.output must become simplified task-board progress text');
  assert(!/process\.env|SECRET|console\.log/.test(progress.text), 'node.output progress must not expose script details');

  const durationCtx = runWorkspaceBlock('function queueElapsedLabel', 'function updateTaskBoardHint', {
    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  });
  const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
  const tenSecondsAgo = new Date(Date.now() - 10 * 1000).toISOString();
  assert.strictEqual(durationCtx.taskBoardElapsedFrom(ninetySecondsAgo), '1 分钟', 'running elapsed must be minute-granular');
  assert.strictEqual(durationCtx.taskBoardElapsedFrom(tenSecondsAgo), '刚开始', 'sub-minute running elapsed should avoid seconds');
  assert(!/秒/.test(durationCtx.taskBoardElapsedFrom(ninetySecondsAgo)), 'running elapsed must never show seconds');
  assert.strictEqual(durationCtx.taskBoardFormatElapsedSeconds(10), '00:10', 'progress timer must format seconds as mm:ss');
  const progressTimerHtml = durationCtx.taskBoardProgressTimerHtml({ state: 'run', stepStartedAt: tenSecondsAgo }, '', 'running');
  assert(progressTimerHtml.includes('class="tb-progress-timer"'), 'running progress must render a standalone timer');
  assert(/00:1[0-2]/.test(progressTimerHtml), 'running progress timer must show second-level elapsed time');
  assert.strictEqual(durationCtx.taskBoardProgressTimerHtml({ state: 'done', stepStartedAt: tenSecondsAgo }, '', 'running'), '', 'done progress must stop showing a live timer');
  const runningWithoutStart = durationCtx.taskBoardDurationHtml('2026-01-01T00:00:00.000Z', '', 'running');
  assert(runningWithoutStart.includes('<b>运行</b>') && runningWithoutStart.includes('运行中'), 'running duration chip must remain visible without started_at');
  assert(!/data-duration-at=""/.test(runningWithoutStart), 'invalid running start must not become an empty ticking duration source');

  const scriptProgressCtx = runWorkspaceBlock('function taskBoardOutputText', 'function taskBoardCeoBrief', {
    taskBoardProgressActor: () => '后端程序员',
  });
  const parsedScriptProgress = scriptProgressCtx.taskBoardOutputProgress({
    type: 'node.output',
    stream: 'stderr',
    text: 'Running script 3/50: node tests/foo.js',
  });
  assert.strictEqual(parsedScriptProgress.scriptProgress.current, 3, 'workspace should parse script current progress from output text');
  assert.strictEqual(parsedScriptProgress.scriptProgress.total, 50, 'workspace should parse script total progress from output text');
  assert.strictEqual(scriptProgressCtx.taskBoardProgressLine(parsedScriptProgress), '正在运行第 3 个脚本(共 50 个)', 'script progress line should show current script index and total');
  const structuredScriptProgress = scriptProgressCtx.taskBoardOutputProgress({
    type: 'node.output',
    stream: 'stderr',
    text: 'exec_command node tests/foo.js',
    scriptIndex: 4,
    scriptTotal: 10,
  });
  assert.strictEqual(scriptProgressCtx.taskBoardProgressLine(structuredScriptProgress), '正在运行第 4 个脚本(共 10 个)', 'workspace should prefer structured script progress fields when present');

  const boardProgress = Server._test.taskBoardProgressForEvent({
    type: 'board.review.round.start',
    round: 1,
    maxRounds: 1,
  }, '重要架构任务');
  assert(boardProgress && boardProgress.text === '董事会评议中(第 1/1 轮)', 'server board review progress text mismatch');
  assert.strictEqual(Server._test.taskBoardStatusLabel('rework'), '↩打回', 'server must label review rework without a done checkmark');

  const baseReworkEvents = [
    { seq: 1, type: 'task.queued', task: 'root-rework', queueAgent: 'ceo', queueId: 'rootq', flow: 'project-route', goal: 'root task' },
    { seq: 2, type: 'project.routed', task: 'root-rework', rootTaskId: 'root-rework', rootQueueAgent: 'ceo', rootQueueId: 'rootq', queueAgent: 'supervisor-控制台', queueId: 'childq' },
    { seq: 3, type: 'task.queued', task: 'child-rework', queueAgent: 'supervisor-控制台', queueId: 'childq', rootTaskId: 'root-rework', rootQueueAgent: 'ceo', rootQueueId: 'rootq', flow: 'review-loop', goal: 'child task' },
    { seq: 4, type: 'task.created', task: 'child-rework' },
    { seq: 5, type: 'node.start', task: 'child-rework', node: 'implement', role: 'worker_code' },
    { seq: 6, type: 'node.end', task: 'child-rework', node: 'implement', role: 'worker_code' },
    { seq: 7, type: 'edge.take', task: 'child-rework', from: 'implement', to: 'review' },
    { seq: 8, type: 'node.start', task: 'child-rework', node: 'review', role: 'supervisor' },
    { seq: 9, type: 'node.end', task: 'child-rework', node: 'review', role: 'supervisor' },
  ];
  const reworkIndex = Server._test.buildTaskBoardIndex(baseReworkEvents.concat([
    { seq: 10, type: 'edge.take', task: 'child-rework', from: 'review', to: 'implement' },
    { seq: 11, type: 'node.start', task: 'child-rework', node: 'implement', role: 'worker_code' },
  ]));
  const reworkRoot = { taskId: 'root-rework', queueAgent: 'ceo', queueId: 'rootq' };
  const reworkAction = { agent: 'supervisor-控制台', id: 'childq', taskId: 'child-rework', item: { task: { goal: '返工任务' } } };
  const reworkNodes = Server._test.buildCeoNodeChain(reworkRoot, 'running', reworkIndex, reworkAction);
  const reworkImplement = reworkNodes.find(n => n.id === 'implement');
  const reworkReview = reworkNodes.find(n => n.id === 'review');
  assert(reworkImplement && reworkImplement.status === 'running' && /重做/.test(reworkImplement.statusText), 'review-returned tasks must show programmer rework instead of plain running');
  assert(reworkReview && reworkReview.status === 'rework' && /打回/.test(reworkReview.statusText), 'review->implement return edge must render review as returned, not done');
  const reworkCard = Server._test.buildCeoTaskCard(reworkRoot, 'running', reworkIndex, reworkAction);
  assert.strictEqual(reworkCard.rework, true, 'CEO task card must carry rework flag for yellow frame');
  assert.strictEqual(reworkCard.statusText, '退回重做', 'running returned task must summarize as rework');

  const approvedIndex = Server._test.buildTaskBoardIndex(baseReworkEvents.concat([
    { seq: 10, type: 'edge.take', task: 'child-rework', from: 'review', to: 'done' },
  ]));
  const approvedNodes = Server._test.buildCeoNodeChain(reworkRoot, 'running', approvedIndex, reworkAction);
  const approvedReview = approvedNodes.find(n => n.id === 'review');
  assert(approvedReview && approvedReview.status === 'done' && approvedReview.statusText === '✅完成', 'approved review must remain green done');

  const progressCtx = runWorkspaceBlock('function taskBoardProgressFromEvent', 'function taskBoardFallbackStep', {
    taskBoardOutputText: text => String(text || ''),
    taskBoardProgressActor: () => '董事',
    taskBoardNodeProgressPhrase: () => '节点处理中',
    taskBoardProgressRoleLabel: role => role,
    FLOW_NODE_ROLE: {},
    taskBoardProgressShort: text => String(text || ''),
    isWaitingDownstreamEvent: () => false,
  });
  const uiBoardProgress = progressCtx.taskBoardProgressFromEvent({
    type: 'board.review.round.start',
    round: 1,
    maxRounds: 1,
  }, '重要架构任务');
  assert(uiBoardProgress && uiBoardProgress.text === '董事会评议中(第 1/1 轮)', 'workspace board review progress text mismatch');

	  const nodeChainCtx = runWorkspaceBlock('function taskBoardNormalizeNodeChain', 'function taskBoardCeoActions', {
	    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
	  });
 const downstreamStartedChainHtml = nodeChainCtx.taskBoardNodeChain([
	    { label: 'CEO规划', status: 'pending', statusText: '⚪待开始', taskId: 'root', node: 'orchestrator-plan' },
	    { label: '主管', status: 'done', statusText: '✅完成', taskId: 'child', node: 'supervisor' },
	    { label: '后端程序员', status: 'running', statusText: '🔵运行中', taskId: 'child', node: 'implement' },
	  ]);
	  assert(downstreamStartedChainHtml.includes('<b>CEO规划</b><em>✅完成</em>'), 'CEO planning must be inferred done once downstream nodes have started');
	  assert(!downstreamStartedChainHtml.includes('<b>CEO规划</b><em>⚪待开始</em>'), 'CEO planning must not stay pending while downstream nodes are active');
	  const allPendingChainHtml = nodeChainCtx.taskBoardNodeChain([
	    { label: 'CEO规划', status: 'pending', statusText: '⚪待开始', taskId: 'root', node: 'orchestrator-plan' },
	    { label: '主管', status: 'pending', statusText: '⚪待开始', taskId: 'child', node: 'supervisor' },
	  ]);
	  assert(allPendingChainHtml.includes('<b>CEO规划</b><em>⚪待开始</em>'), 'truly unstarted chains must still show CEO planning as pending');
	  const failedCeoChainHtml = nodeChainCtx.taskBoardNodeChain([
	    { label: 'CEO规划', status: 'fail', statusText: '❌失败', taskId: 'root', node: 'orchestrator-plan' },
	    { label: '后端程序员', status: 'running', statusText: '🔵运行中', taskId: 'child', node: 'implement' },
	  ]);
	  assert(failedCeoChainHtml.includes('<b>CEO规划</b><em>❌失败</em>'), 'explicit CEO planning failure must not be overwritten by inferred completion');
	  const reworkChainHtml = nodeChainCtx.taskBoardNodeChain([
	    { label: '后端程序员', status: 'running', statusText: '🔵重做中', taskId: 'child-rework', node: 'implement' },
	    { label: '复审', status: 'rework', statusText: '↩打回', taskId: 'child-rework', node: 'review' },
  ]);
  assert(reworkChainHtml.includes('class="tb-node rework"') && reworkChainHtml.includes('↩打回'), 'workspace node chain must render a returned review chip');
  assert(!reworkChainHtml.includes('<b>复审</b><em>✅完成</em>'), 'returned review chip must not claim completion');

  const queueCardCtx = runWorkspaceBlock('function taskBoardQueueCard', 'function taskBoardBulletinCard', {
    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    queueTaskText: task => typeof task === 'string' ? task : (task && (task.goal || task.title)) || '',
    taskBoardQuestionText: text => String(text || '').slice(0, 72),
    taskBoardBrief: text => String(text || '').slice(0, 72),
    queueStatusLabel: status => ({ queued: '排队中', paused: '暂停等待', canceling: '取消中' }[status] || status),
    queueItemMeta: () => '控制台',
    taskBoardDurationHtml: () => '<span class="tb-durations"></span>',
    avatarHtml: agent => `<span>${agent}</span>`,
    taskBoardIdStateRow: (id, text, cls, extra) => `<span class="${cls}">${id}:${text}${extra || ''}</span>`,
    taskBoardQaHtml: (q, a) => `<span class="tb-qa"><span>问 ${q}</span><span>解 ${a}</span></span>`,
    taskBoardQueueActions: () => '<div class="tb-actions"></div>',
    queueRememberAttr: (key, open) => `data-qopen="${key}"${open ? ' open' : ''}`,
    taskBoardScrollAttrs: key => `data-scroll-key="${key}"`,
    taskBoardCardKey: (...parts) => parts.filter(Boolean).join(':'),
    taskBoardCardAttrs: (key, status) => `data-tb-card-key="${key}" data-tb-card-status="${status}"`,
    taskBoardCardSelectedClass: () => '',
    queueAgentLabel: id => id,
  });
  const queueCardHtml = queueCardCtx.taskBoardQueueCard({
    status: 'queued',
    agent: { id: 'worker_code', label: '后端程序员' },
    item: { id: 'q-1', task: { goal: '修进行中任务区交互' }, enqueued_at: '2026-06-22T00:00:00.000Z' },
  });
  assert(queueCardHtml.trim().startsWith('<details class="tb-card tb-queue-card qitem queued"'), 'queued non-running cards must render as collapsible details');
  assert(queueCardHtml.includes('<summary class="tb-ceo-summary"'), 'queued cards must expose the two-line Q/A summary as collapsed face');
  assert(queueCardHtml.includes('data-tb-card-key="queue-waiting:worker_code:q-1"'), 'queued cards must have a stable selectable key');
  assert(queueCardHtml.includes('data-scroll-key="queue-full:worker_code:q-1"'), 'queued card detail must keep its own scroll key');

  const runningCardCtx = runWorkspaceBlock('function taskBoardRunningCard', 'function taskBoardQueueCard', {
    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    queueTaskText: task => typeof task === 'string' ? task : (task && (task.goal || task.title)) || '',
    taskBoardRunningBrief: text => String(text || '').slice(0, 72),
    taskBoardBrief: text => String(text || '').slice(0, 72),
    taskBoardProgress: () => ({ text: '后端程序员处理中', state: 'run' }),
    taskBoardDisplayProgress: (task, progress) => progress,
    taskBoardProgressLine: progress => progress.text,
    taskBoardProgressElapsed: () => '',
    taskBoardProgressHtml: (progress, line) => `<div class="tb-progress-row"><div class="tb-progress">${line}</div></div>`,
    taskBoardCardKey: (...parts) => parts.filter(Boolean).join(':'),
    taskBoardCardAttrs: (key, status) => `data-tb-card-key="${key}" data-tb-card-status="${status}"`,
    taskBoardSelectedKey: 'queue-waiting:worker_code:q-1',
    taskBoardIsRepairRow: () => false,
    queueItemMeta: () => '控制台',
    taskBoardDurationHtml: () => '<span class="tb-durations"></span>',
    taskBoardScrollAttrs: key => `data-scroll-key="${key}"`,
    queueRememberAttr: (key, open) => `data-qopen="${key}"${open ? ' open' : ''}`,
    avatarHtml: agent => `<span>${agent}</span>`,
    queueAgentLabel: id => id,
    taskBoardQaHtml: (q, a) => `<span class="tb-qa"><span>问 ${q}</span><span>解 ${a}</span></span>`,
    taskBoardIdStateRow: (id, text, cls, extra) => `<span class="${cls}">${id}:${text}${extra || ''}</span>`,
    taskBoardQueueActions: () => '<div class="tb-actions"></div>',
  });
  const runningCardHtml = runningCardCtx.taskBoardRunningCard({
    status: 'running',
    agent: { id: 'worker_code', label: '后端程序员' },
    item: { id: 'q-1', task: { goal: '修进行中任务区交互' }, started_at: '2026-06-22T00:00:00.000Z' },
  });
  assert(runningCardHtml.trim().startsWith('<details class="tb-card tb-running-card qitem running selected"'), 'queued->running status changes must keep selected visual state for the same agent/id');
  assert(runningCardHtml.includes('data-tb-card-key="queue-running:worker_code:q-1"'), 'running cards must still publish a running-specific key after migration');

  function fakeCard({ running = false, open = false, key }) {
    const classes = new Set(['tb-card', 'qitem']);
    if (running) classes.add('running');
    if (key === 'old') classes.add('selected');
    return {
      tagName: 'DETAILS',
      open,
      dataset: { qopen: `open:${key}`, tbCardKey: key, tbCardStatus: running ? 'running' : 'queued' },
      classList: {
        contains: c => classes.has(c),
        add: c => classes.add(c),
        remove: c => classes.delete(c),
      },
      querySelector: () => null,
      _classes: classes,
    };
  }
  const runningCard = fakeCard({ running: true, open: true, key: 'running' });
  const oldQueued = fakeCard({ open: true, key: 'old' });
  const nextQueued = fakeCard({ open: false, key: 'next' });
  let documentClickHandler = null;
  const selectCtx = runWorkspaceBlock('function taskBoardCardKey', 'function trackedScrollElements', {
    esc: s => String(s == null ? '' : s),
    queueOpenState: {},
    taskBoardSelectedKey: 'old',
    taskBoardOutsideCollapseBound: false,
    restoreTaskBoardScrollElement: () => {},
    $: selector => selector === '#queue' ? {} : null,
    document: {
      querySelectorAll(selector) {
        if (selector === '#queue details.qitem') return [runningCard, oldQueued, nextQueued];
        if (selector === '#queue .tb-card.selected') return [runningCard, oldQueued, nextQueued].filter(card => card._classes.has('selected'));
        return [];
      },
      addEventListener: (event, handler) => {
        if (event === 'click') documentClickHandler = handler;
      },
    },
  });
  selectCtx.taskBoardSelectCard(nextQueued);
  assert.strictEqual(runningCard.open, true, 'selecting another task must not collapse running cards');
  assert.strictEqual(oldQueued.open, false, 'selecting another task must collapse previous non-running details');
  assert.strictEqual(nextQueued.open, true, 'selected queued task must open its details');
  assert(nextQueued._classes.has('selected'), 'selected queued task must receive selected class');
  selectCtx.ensureTaskBoardOutsideCollapseBound();
  assert(documentClickHandler, 'outside-click collapse handler must be registered');
  documentClickHandler({ target: { closest: () => ({}) } });
  assert.strictEqual(nextQueued.open, true, 'clicking inside a task card/control must not collapse the selected queued task');
  documentClickHandler({ target: { closest: () => null } });
  assert.strictEqual(runningCard.open, true, 'outside clicks must not collapse running cards');
  assert.strictEqual(nextQueued.open, false, 'outside clicks must collapse selected non-running queued task');
  assert(!nextQueued._classes.has('selected'), 'outside clicks must clear selected class from queued tasks');
  assert.strictEqual(selectCtx.taskBoardSelectedKey, '', 'outside clicks must clear selected key');

  const officeCtx = runWorkspaceBlock('function projectLaneXs', 'function bindViews');
  assert.deepStrictEqual(
    Array.from(officeCtx.projectOfficeAgentIds('控制台')),
    ['supervisor-控制台', 'worker_code-控制台', 'worker_narrow-控制台', 'frontend_designer'],
    'system office must include frontend_designer station',
  );
  assert.deepStrictEqual(
    Array.from(officeCtx.projectOfficeAgentIds('Simulaid')),
    ['supervisor-Simulaid', 'worker_code-Simulaid', 'worker_narrow-Simulaid'],
    'non-console project office must not include frontend_designer',
  );
  assert.deepStrictEqual(
    Array.from(officeCtx.hrOfficeAgentIds()),
    ['hr_manager', 'hr_specialist'],
    'office must include HR manager and specialist stations',
  );
  assert.deepStrictEqual(
    Array.from(officeCtx.repairOfficeAgentIds()),
    ['repair-lead', 'repair'],
    'office must include repair lead and repair executor stations',
  );
  const officeOrderCtx = runWorkspaceBlock('function projectOfficeOrder', 'function renderOffice');
  assert.strictEqual(officeOrderCtx.projectOfficeOrder('控制台'), 4, 'console project row must come after chairman, boardroom, and common rows');
  assert.strictEqual(officeOrderCtx.projectOfficeOrder('Simulaid'), 5, 'other project rows must not jump ahead of the boardroom');

  console.log(JSON.stringify({ pass: true, suite: 'workspace-taskboard' }));
}

main();
