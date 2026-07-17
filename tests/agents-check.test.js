#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadAgents,
  extractRoles,
  extractRunnerIds,
  validateAgent,
} = require('../shared/engine/agents');

function roleBlock(text, role) {
  const re = new RegExp(`\\n  ${role}:([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:|\\n#|$)`);
  const match = text.match(re);
  return match ? match[1] : '';
}

function main() {
  const root = path.resolve(__dirname, '..');
  const agents = loadAgents(path.join(root, 'shared/agents'));
  const modelRoutingText = fs.readFileSync(path.join(root, 'shared/routing/model-routing.yaml'), 'utf8');
  const roles = extractRoles(modelRoutingText);
  const runners = extractRunnerIds(fs.readFileSync(path.join(root, 'shared/routing/runners.yaml'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'projects/控制台/config.json'), 'utf8'));
  const machine = JSON.parse(fs.readFileSync(path.join(root, 'shared/config/machine.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'shared/capability_registry/registry.json'), 'utf8'));
  const expansionModule = JSON.parse(fs.readFileSync(path.join(root, 'shared/capability_registry/modules/instruction-expansion-router/module.json'), 'utf8'));
  const engineRunner = require('../projects/控制台/engine-runner')._test;
  const ctx = { root, roles, runners };
  // 维修主管已由 Codex 特权接管;当前只有秘书与 Claude 董事席可自动路由 Claude。
  const claudeAutoRoutes = Object.entries(config.roleRouting || {})
    .filter(([, route]) => route && /^claude/.test(String(route.runner || '')))
    .map(([role, route]) => `${role}:${route.runner}`)
    .sort();
  const claudeRunnerDefs = Object.entries(config.runners || {})
    .filter(([id]) => /^claude/.test(id));
  assert.deepStrictEqual(claudeAutoRoutes, ['board_claude:claude-fable-5', 'secretary:claude'], 'only secretary/board_claude may auto-route to Claude runners');
  assert(claudeRunnerDefs.length > 0, 'Claude runner definitions must be registered');
  for (const id of ['claude', 'claude-code']) {
    const def = config.runners[id];
    assert(def && def.hidden !== true && def.deprecated !== true, `${id} runner must be active (not hidden/deprecated)`);
  }
  const fableRunner = config.runners['claude-fable-5'];
  assert(fableRunner, 'Claude Fable 5 board runner must be registered');
  assert(fableRunner.cmd.includes('claude-fable-5'), 'Claude board runner must select the Fable 5 model explicitly');
  assert.strictEqual(fableRunner.execution.canWriteFiles, false, 'Claude board runner must remain read-only');
  assert.strictEqual(fableRunner.execution.canRunCommands, false, 'Claude board runner must not execute shell commands');
  // 其余 claude* runner(如 claude-opus-4-8 历史通道)仍允许保留为兼容记录。
  const claudePreferRoles = ['secretary', 'board_claude'];
  for (const role of claudePreferRoles) {
    assert(/prefer:\s*\[subscription\.claude/.test(roleBlock(modelRoutingText, role)), `${role} must prefer Claude subscription first`);
    assert(/subscription\.codex/.test(roleBlock(modelRoutingText, role)), `${role} must keep Codex as failover candidate`);
  }
  const otherClaudePrefer = (modelRoutingText.match(/prefer:\s*\[[^\]]*subscription\.claude[^\]]*\]/g) || []).length;
  assert.strictEqual(otherClaudePrefer, claudePreferRoles.length, 'only secretary and board_claude prefer chains may include Claude subscription');
  assert.strictEqual(machine.runners.front_door, 'claude', 'machine front door must be Claude Code (secretary)');
  assert.strictEqual(machine.runners['claude-code'].status, 'active', 'Claude repair-lead machine runner must be active');
  assert.strictEqual(expansionModule.binding.front_door_runner, 'claude', 'instruction expansion front door must bind Claude');
  const expander = registry.modules.find(m => m.id === 'instruction-expansion-router');
  assert(expander && /Claude Code CLI/.test(expander.summary), 'capability registry must advertise Claude Code front door');
  assert(!/只绑前门总管 Codex CLI/.test(expander.summary), 'capability registry must not advertise Codex as active front door');

  const frontend = agents.find(a => a.id === 'frontend-designer');
  assert(frontend, 'frontend-designer agent must be registered');
  assert.strictEqual(frontend.name, '前端程序员 Frontend Designer');
  assert.strictEqual(frontend.role, 'frontend_designer');
  assert.strictEqual(frontend.runner, 'zhipu-glm');
  assert.strictEqual(frontend.project_scope, '控制台');
  assert.deepStrictEqual(frontend.writes, ['projects/控制台/public/workspace.html']);
  assert(frontend.read_paths.includes('projects/控制台/artifacts/frontend-handover.md'), 'handover doc must be readable');
  assert(frontend.read_paths.includes('projects/控制台/artifacts/frontend-render-scroll-intake.md'), 'intake doc must be readable');
  assert.deepStrictEqual(validateAgent(frontend, ctx), []);

  const hrManager = agents.find(a => a.id === 'hr-manager');
  const hrSpecialist = agents.find(a => a.id === 'hr-specialist');
  assert(hrManager, 'hr-manager agent must be registered');
  assert(hrSpecialist, 'hr-specialist agent must be registered');
  assert.strictEqual(hrManager.role, 'hr_manager');
  assert.strictEqual(hrManager.runner, 'codex');
  assert.strictEqual(hrManager.department, 'HR');
  assert.strictEqual(hrSpecialist.role, 'hr_specialist');
  assert.strictEqual(hrSpecialist.runner, 'zhipu-glm');
  assert.strictEqual(hrSpecialist.department, 'HR');
  assert(hrManager.read_paths.includes('shared/DATA-MAP.md'), 'HR manager must read data map');
  assert(hrSpecialist.read_paths.includes('shared/knowledge/hr/'), 'HR specialist must read HR shared knowledge');
  assert(hrManager.boundary_statement && hrManager.boundary_statement.does, 'HR manager boundary missing');
  assert(hrSpecialist.boundary_statement && hrSpecialist.boundary_statement.does_not, 'HR specialist boundary missing');
  assert.deepStrictEqual(validateAgent(hrManager, ctx), []);
  assert.deepStrictEqual(validateAgent(hrSpecialist, ctx), []);

  const workerCode = agents.find(a => a.id === 'worker-code');
  assert(workerCode, 'worker-code agent must be registered');
  assert.strictEqual(workerCode.name, '后端程序员 Worker Code');
  assert.strictEqual(workerCode.role, 'worker_code');
  assert.strictEqual(workerCode.runner, 'codex');
  assert(workerCode.read_paths.includes('shared/knowledge/engineering/INDEX.md'), 'worker-code must read engineering handoff index');
  assert(workerCode.read_paths.includes('shared/knowledge/engineering/worker-code-handoff.md'), 'worker-code handoff doc must be readable');
  assert.deepStrictEqual(validateAgent(workerCode, ctx), []);
  assert.strictEqual(config.roleRouting.worker_code.runner, 'codex');
  assert(/prefer:\s*\[subscription\.codex,\s*api\.zhipu\.glm-5\.2/.test(roleBlock(modelRoutingText, 'worker_code')), 'worker_code must prefer Codex before GLM-5.2 for filesystem write tasks');

  const uiRoute = config.roleRouting.ui_optimizer;
  assert.strictEqual(uiRoute.runner, 'codex', 'ui_optimizer must route to Codex runner');
  assert.strictEqual(uiRoute.model, 'codex', 'ui_optimizer model id must be standardized');
  assert.strictEqual(uiRoute.rollout.rollbackRunner, 'codex', 'ui_optimizer must keep codex rollback runner');
  assert(/prefer:\s*\[subscription\.codex,\s*api\.zhipu\.glm-5\.2/.test(roleBlock(modelRoutingText, 'ui_optimizer')), 'ui_optimizer model-routing must prefer Codex without Claude subscription options');
  assert.strictEqual(engineRunner.roleMapFromConfig(config, { taskId: 'ui-default', goal: 'ui review' }).ui_optimizer, 'codex');
  const guiRoute = config.roleRouting.gui_desktop_control;
  const peekabooRunner = config.runners.peekaboo;
  assert.strictEqual(guiRoute.runner, 'codex-privileged', 'gui desktop control must be taken over by privileged Codex');
  assert.strictEqual(guiRoute.model, 'codex', 'desktop visual self-check model must be Codex');
  assert(!peekabooRunner.cmd.join(' ').includes('claude'), 'Peekaboo compatibility runner must not invoke Claude');
  assert(/prefer:\s*\[subscription\.codex/.test(roleBlock(modelRoutingText, 'gui_desktop_control')), 'gui_desktop_control model-routing must prefer Codex');
  const oldDisable = process.env.UI_OPTIMIZER_CODEX_ENABLED;
  try {
    process.env.UI_OPTIMIZER_CODEX_ENABLED = '0';
    assert.strictEqual(engineRunner.roleMapFromConfig(config, { taskId: 'ui-rollback', goal: 'ui review' }).ui_optimizer, 'codex');
  } finally {
    if (oldDisable == null) delete process.env.UI_OPTIMIZER_CODEX_ENABLED;
    else process.env.UI_OPTIMIZER_CODEX_ENABLED = oldDisable;
  }

  const memoryRoute = config.roleRouting.memory_officer;
  assert.strictEqual(memoryRoute.runner, 'codex', 'memory_officer must use Codex as primary runner');
  assert(/prefer:\s*\[subscription\.codex,\s*api\.zhipu\.glm-5\.2/.test(roleBlock(modelRoutingText, 'memory_officer')), 'memory_officer model-routing must prefer Codex');
  assert.strictEqual(engineRunner.roleMapFromConfig(config, { taskId: 'memory-smoke', goal: '维修复盘记忆提炼' }).memory_officer, 'codex');

  const itEngineer = agents.find(a => a.id === 'it-engineer');
  assert(itEngineer, 'it-engineer agent must be registered');
  assert.strictEqual(itEngineer.role, 'it_engineer');
  assert.strictEqual(itEngineer.runner, 'zhipu-glm');
  assert.strictEqual(itEngineer.department, 'IT');
  assert.strictEqual(itEngineer.queueAgent, true);
  assert(itEngineer.read_paths.includes('VERSION.json'), 'IT engineer must read VERSION.json');
  assert(itEngineer.read_paths.includes('projects/控制台/tools/version-manager.js'), 'IT engineer must read version-manager');
  assert(itEngineer.read_paths.includes('shared/knowledge/engineering/it-engineer-handoff.md'), 'IT engineer handoff doc must be readable');
  assert(itEngineer.writes.includes('VERSION.json'), 'IT engineer must write VERSION.json');
  assert(itEngineer.tools.some(t => /version-manager\.js release/.test(t)), 'IT engineer release interface missing');
  assert(itEngineer.tools.some(t => /version-manager\.js rollback/.test(t)), 'IT engineer rollback interface missing');
  assert.deepStrictEqual(validateAgent(itEngineer, ctx), []);
  assert.strictEqual(config.roleRouting.it_engineer.runner, 'zhipu-glm');
  assert(/prefer:\s*\[api\.zhipu\.glm-5\.2,\s*subscription\.codex/.test(roleBlock(modelRoutingText, 'it_engineer')), 'it_engineer must prefer GLM-5.2 before Codex');

  const boardRoutes = Object.entries(config.roleRouting || {}).filter(([role]) => role.startsWith('board_'));
  assert.deepStrictEqual(
    boardRoutes.map(([role]) => role).sort(),
    ['board_claude', 'board_deepseek', 'board_glm52', 'board_opus48'],
    'active board roleRouting must exclude Kimi and must not keep both board_gpt55 and board_opus48',
  );
  assert.strictEqual(
    boardRoutes.filter(([, route]) => route && route.runner === 'codex').length,
    1,
    'active board directors must have exactly one Codex/GPT-5.5 runner seat',
  );
  assert(/board_gpt55:[\s\S]*deprecated:\s*true[\s\S]*alias_of:\s*board_opus48/.test(modelRoutingText), 'board_gpt55 must be marked as a deprecated alias of board_opus48');
  assert(!config.roleRouting.board_kimi, 'board_kimi must not be active in roleRouting');
  assert(!/^\s{2}board_kimi:/m.test(modelRoutingText), 'board_kimi must not be active in model-routing roles');
  assert(runners.has('kimi-k2'), 'kimi-k2 runner must be registered');
  const boardKimi = agents.find(a => a.id === 'board-kimi');
  assert(boardKimi, 'board-kimi archived agent metadata must remain readable');
  assert.strictEqual(boardKimi.role, 'board_kimi');
  assert.strictEqual(boardKimi.runner, 'kimi-k2');
  assert.strictEqual(boardKimi.status, 'disabled_retired_from_board');
  assert.deepStrictEqual(validateAgent(boardKimi, ctx), []);

  const repairLead = agents.find(a => a.id === 'repair-lead');
  const repair = agents.find(a => a.id === 'repair');
  assert(repairLead, 'repair-lead agent must be registered');
  assert(repair, 'repair agent must still be registered');
  assert.strictEqual(repairLead.role, 'repair-lead');
  assert.strictEqual(repairLead.runner, 'codex-privileged');
  assert.strictEqual(repairLead.department, '维修部门');
  assert.strictEqual(repairLead.queueAgent, true);
  assert.strictEqual(repairLead.persistent_worker, true);
  assert.deepStrictEqual(repairLead.supervises, ['repair']);
  assert(repairLead.read_paths.includes('projects/控制台/artifacts/engine-runs/'), 'repair-lead must read engine-runs');
  assert(repairLead.read_paths.includes('projects/控制台/artifacts/queues/'), 'repair-lead must read queue handoff records');
  assert(repairLead.writes.includes('projects/控制台/'), 'repair-lead must be allowed to fix console core when needed');
  assert(repairLead.tools.some(t => /queue-enqueue --agent repair/.test(t)), 'repair-lead must delegate to repair queue');
  assert.deepStrictEqual(validateAgent(repairLead, ctx), []);
  assert.strictEqual(repair.reports_to, 'repair-lead');
  assert.strictEqual(config.roleRouting['repair-lead'].runner, 'codex-privileged');
  assert.strictEqual(config.roleRouting['repair-lead'].execution.delegatesTo, 'repair');
  assert(config.runners['codex-privileged'], 'codex-privileged runner must be registered in console config');
  assert.strictEqual(config.runners['codex-privileged'].cmd[0], 'codex', 'codex-privileged runner must use Codex CLI');
  assert.strictEqual(config.runners['codex-privileged'].execution.privileged, true);
  assert.strictEqual(config.roleRouting.repair.runner, 'codex-privileged', 'repair worker must stay on codex-privileged');
  assert(/prefer:\s*\[subscription\.codex/.test(roleBlock(modelRoutingText, 'repair-lead')), 'repair-lead must prefer Codex');
  assert(!/subscription\.claude/.test(roleBlock(modelRoutingText, 'repair-lead')), 'repair-lead must not depend on Claude');
  assert.strictEqual(engineRunner.roleMapFromConfig(config, { taskId: 'repair-lead-smoke', goal: 'repair ticket' })['repair-lead'], 'codex-privileged');

  // 2026-07-03 弹性编制(拍板 Q1)第一步:闲置角色软归档标记 + INDEX 同步锁。
  const raRoute = config.roleRouting.reasoning_architect;
  assert(raRoute, 'reasoning_architect roleRouting entry must be kept (软归档不删条目,复活成本最低)');
  assert.strictEqual(raRoute.archived, true, 'reasoning_architect must carry archived soft-archive marker');
  assert.strictEqual(raRoute.archivedAt, '2026-07-03', 'reasoning_architect archivedAt must be recorded');
  assert(/弹性编制/.test(String(raRoute.archivedReason || '')), 'reasoning_architect archivedReason must cite elastic roster');
  assert(/文档标记|软归档/.test(String(raRoute.archivedNote || '')), 'archived field must self-declare as doc marker (NR11: no code consumer yet)');
  assert.strictEqual(raRoute.runner, 'codex', 'soft archive must keep runner routing intact');
  assert.strictEqual(
    engineRunner.roleMapFromConfig(config, { taskId: 'elastic-roster-smoke', goal: 'architecture review' }).reasoning_architect,
    'codex',
    'soft archive must not break role routing resolution (硬归档需观察期后另行拍板)',
  );
  assert(!config.roleRouting.zhipu_designer, 'zhipu_designer must stay retired (no roleRouting resurrection)');
  const reasoningArchitectAgent = agents.find(a => a.id === 'reasoning-architect');
  if (reasoningArchitectAgent) {
    assert(
      !/^(disabled|archived|retired)/i.test(String(reasoningArchitectAgent.status || '')),
      'soft archive must not set hard-disable agent.json status (硬归档待质量运营提议+老板拍板)',
    );
  }
  const agentsIndexText = fs.readFileSync(path.join(root, 'shared/agents/INDEX.md'), 'utf8');
  assert(/reasoning-architect[^\n]*已归档-弹性编制/.test(agentsIndexText), 'INDEX table must mark reasoning-architect as archived (elastic roster)');
  assert(/## 弹性编制/.test(agentsIndexText), 'INDEX must contain elastic roster section');
  assert(/归档名单[\s\S]*reasoning_architect/.test(agentsIndexText), 'INDEX elastic roster must list reasoning_architect in archive list');
  assert(/观察名单[\s\S]*worker_narrow[\s\S]*hr_specialist/.test(agentsIndexText), 'INDEX elastic roster must keep worker_narrow/hr_specialist on watch list');
  assert(fs.existsSync(path.join(root, 'board/角色编制-弹性策略-20260703.md')), 'elastic roster policy doc must exist in board/');

  console.log(JSON.stringify({ pass: true, suite: 'agents-check' }));
}

main();
