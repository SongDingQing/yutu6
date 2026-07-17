'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { HookRegistry } = require('../../../../shared/engine/hook-registry');
const HardeningHooks = require('../../hardening-hooks');
const LoopEngineering = require('../../../../shared/engine/loop-engineering');
const VersionProgressHook = require('../../version-progress-hook');
const Contract = require('./compat-contract');

const workspaceRoot = path.resolve(__dirname, '../../../..');
const packageRelative = 'projects/控制台/quality-ops/ahr-26-30';
const packageRoot = path.join(workspaceRoot, packageRelative);
const currentTaskId = 'cr-1784018284182-397d53ad';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runContractTest() {
  const relative = 'projects/控制台/tests/ahr-26-30-contract.test.js';
  const result = spawnSync(process.execPath, [relative], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  let payload = null;
  try { payload = JSON.parse(String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'null'); }
  catch (_) {}
  return {
    command: `node ${relative}`,
    exit_code: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    payload,
  };
}

function registeredHooks() {
  const registry = new HookRegistry();
  HardeningHooks.registerHardeningHooks(registry, { workspaceRoot });
  LoopEngineering.registerLoopEngineeringHooks(registry);
  VersionProgressHook.registerVersionProgressHook(registry, { root: workspaceRoot, workspaceRoot });
  return registry.list('task.true_done').map(hook => ({
    id: hook.id,
    priority: hook.priority,
    timeoutMs: hook.timeoutMs,
    failureMode: hook.failureMode,
  }));
}

function riskRows(text) {
  return String(text || '').split(/\r?\n/)
    .filter(line => /^\| R\d+ /.test(line))
    .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()));
}

function auditPackage(options = {}) {
  const overrides = options.overrides || {};
  const read = relative => Object.prototype.hasOwnProperty.call(overrides, relative)
    ? String(overrides[relative])
    : fs.readFileSync(path.join(workspaceRoot, relative), 'utf8');
  const checks = [];
  const add = (id, pass, evidence) => checks.push({ id, pass: Boolean(pass), evidence });

  const inventoryPath = `${packageRelative}/tool-hook-inventory.md`;
  const riskPath = `${packageRelative}/blocking-risk-assessment.md`;
  const designPath = `${packageRelative}/migration-design.md`;
  const approvalPath = `${packageRelative}/approval-state.json`;
  const baselinePath = `${packageRelative}/production-hook-baseline.json`;
  const evidencePath = `${packageRelative}/contract-test-evidence.json`;
  const acceptancePath = `${packageRelative}/structured-acceptance.md`;
  const currentRunPath = `${packageRelative}/current-run-reverification.md`;
  const testSummaryPath = `${packageRelative}/test-summary.json`;
  const engineTaskPath = `projects/控制台/artifacts/engine-tasks/${currentTaskId}.json`;
  const inventory = read(inventoryPath);
  const risk = read(riskPath);
  const design = read(designPath);
  const approval = JSON.parse(read(approvalPath));
  const baseline = JSON.parse(read(baselinePath));
  const recordedEvidence = JSON.parse(read(evidencePath));
  const structuredAcceptance = read(acceptancePath);
  const currentRun = read(currentRunPath);
  const testSummary = JSON.parse(read(testSummaryPath));
  const engineTask = JSON.parse(read(engineTaskPath));

  const hooks = registeredHooks();
  const expectedHooks = [
    ['console.done_gate_meta', 10, 50, 'block'],
    ['console.protocol_gate', 15, 100, 'block'],
    ['console.hard_regression_coverage', 20, 100, 'block'],
    ['engine.loop_engineering_convergence', 30, 100, 'block'],
    ['console.version_progress', 50, 95000, 'block'],
  ];
  const hookShapeMatches = hooks.length === expectedHooks.length && expectedHooks.every((expected, index) => {
    const actual = hooks[index];
    return actual && actual.id === expected[0] && actual.priority === expected[1] &&
      actual.timeoutMs === expected[2] && actual.failureMode === expected[3];
  });
  add('inventory_all_runtime_hooks', hookShapeMatches && hooks.every(hook => inventory.includes(`\`${hook.id}\``)), JSON.stringify(hooks));

  const requiredInventoryFields = ['触发条件', '调用方与旧名依赖脚本', 'priority', 'failureMode', 'timeoutMs', '当前状态', '唯一 owner'];
  add('inventory_acceptance_fields', requiredInventoryFields.every(field => inventory.includes(field)), requiredInventoryFields.join(','));
  const inventoryRows = inventory.split(/\r?\n/).filter(line => /^\| (?:`|绝对 artifact path)/.test(line));
  add('inventory_single_accountable_owner', inventoryRows.length === 15 && inventoryRows.every(line => {
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
    return /^`(?:worker_code|quality_ops|it_engineer)`$/.test(cells[cells.length - 1] || '');
  }), `${inventoryRows.length} rows`);
  add('inventory_legacy_consumers', [
    'shared/engine/cli-runner.js:704-765',
    'projects/控制台/public/workspace.html:629-636',
    'projects/控制台/server.js:3150-3159',
  ].every(pointer => inventory.includes(pointer)), 'legacy config and tool-name consumers listed');

  const rows = riskRows(risk);
  const allowedStatuses = new Set(['已缓解', '待验证', '待主人拍板', '接受风险']);
  add('risk_rows_closed_with_allowed_status', rows.length === 11 && rows.every((row, index) => row[0].startsWith(`R${index + 1} `) && allowedStatuses.has(row[3])), `${rows.length} rows`);
  add('risk_rows_have_rollback_and_single_owner', rows.length === 11 && rows.every(row => {
    const owners = row[4].match(/owner=`[^`]+`/g) || [];
    return /回滚=/.test(row[4]) && owners.length === 1 && !/[+/]/.test(owners[0]);
  }), `${rows.length} rows`);
  add('risk_timeout_injection_recorded', risk.includes('预算 5ms') && risk.includes('实际阻塞 40ms') &&
    recordedEvidence.timeoutInjection && recordedEvidence.timeoutInjection.interruptCapability === false,
  JSON.stringify(recordedEvidence.timeoutInjection));
  add('risk_local_deadlock_precedent', risk.includes('d17077d86c88bfe017ee7da54a71c012f81fe3c7') && risk.includes('degraded'), '2026-07-06 incident cited');

  add('migration_covers_ahr_26_30', [26, 27, 28, 29, 30].every(id => design.includes(`AHR-${id}`)), 'AHR-26..30 sections');
  add('migration_alias_before_retire', design.includes('先 alias，再退役') && design.includes('连续 14 天旧名命中为 0'), 'alias compatibility and retirement gate');
  add('migration_pre_post_separation', design.includes('pre/post 职责分离') && design.includes('shadow 期不得执行双份工具副作用'), 'phase and dual-path rules');
  add('migration_schema_fields', ['schemaVersion', 'requestId', 'taskId', 'toolCallId', 'outcome'].every(field => design.includes(field)), 'v1 correlation fields');
  add('migration_timeout_not_claimed_implemented', design.includes('不能中断死循环或阻塞 I/O') && design.includes('本轮不实施'), 'timeout limitation and isolation plan');
  add('visual_ui_explicit_na', design.includes('NA（不适用）') && design.includes('不要求 Peekaboo 截图'), 'engine/test-only task');
  const filledAcceptanceRows = structuredAcceptance.split(/\r?\n/).filter(line => /^\| (?:设计对照|任务验收|视觉\/UI证据)/.test(line));
  const designAcceptanceRow = filledAcceptanceRows.find(line => /^\| 设计对照/.test(line)) || '';
  const taskAcceptanceRow = filledAcceptanceRows.find(line => /^\| 任务验收/.test(line)) || '';
  const visualAcceptanceRow = filledAcceptanceRows.find(line => /视觉\/UI证据/.test(line)) || '';
  add('structured_acceptance_records_non_ui_gate_conflict', filledAcceptanceRows.length === 3 &&
    /\| 完成 \|/.test(designAcceptanceRow) &&
    /\| 部分 \|/.test(taskAcceptanceRow) && taskAcceptanceRow.includes('主管 review 是下一真实节点') &&
    /\| 未完成 \|/.test(visualAcceptanceRow) && /不适用/.test(visualAcceptanceRow) &&
    structuredAcceptance.includes('等待主人修复 DoneGate 非 UI 语义或重签 acceptance'),
  'design complete; real review pending; incompatible visual row honestly blocked');
  add('current_task_identity_consistent', [inventory, risk, design, structuredAcceptance, currentRun]
    .every(text => text.includes(currentTaskId)) &&
    approval.implementationTaskId === currentTaskId &&
    recordedEvidence.taskId === currentTaskId &&
    testSummary.taskId === currentTaskId,
  currentTaskId);
  add('real_review_loop_not_old_fixture', !structuredAcceptance.includes('review-loop-fixture/') &&
    engineTask.id === currentTaskId && engineTask.flow === 'review-loop' &&
    engineTask.vars && engineTask.vars.projectId === '控制台' &&
    engineTask.state === 'running' && ['implement', 'review'].includes(engineTask.node),
  `${engineTask.id}:${engineTask.state}:${engineTask.node}`);

  const contract = runContractTest();
  add('contract_test_exit_zero', contract.exit_code === 0 && contract.payload && contract.payload.timeoutInjection &&
    contract.payload.timeoutInjection.interruptCapability === false, contract.command);

  const baselineMatches = Object.entries(baseline.files).every(([relative, expected]) =>
    sha256File(path.join(workspaceRoot, relative)) === expected
  );
  add('production_hook_baseline_unchanged', baselineMatches, Object.keys(baseline.files).join(','));

  add('owner_approval_absent_no_wait_deadlock', approval.status === 'not_authorized' &&
    !Contract.approvalAllowsGlobalSwitch(approval, 'cr-1784014332008-34ff7914') &&
    design.includes('准备任务在无批准时以 `not_authorized` 正常收口'), approval.status);
  add('approval_contract_binds_scope_and_rollback', design.includes('root taskId `cr-1784014332008-34ff7914`') &&
    design.includes('approvedScope') && design.includes('rollbackPlan'), 'task/scope/rollback required');

  return {
    pass: checks.every(check => check.pass),
    score: checks.filter(check => check.pass).length / checks.length,
    checks,
    hooks,
    contract,
    conclusion: checks.every(check => check.pass)
      ? 'AHR-26..30 preparation package passed; real review-loop completion remains blocked by the non-UI acceptance conflict and runtime switch remains unauthorized.'
      : 'Preparation package failed independent checks; runtime switch remains unauthorized.',
  };
}

if (require.main === module) {
  const result = auditPackage();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.pass ? 0 : 1);
}

module.exports = { auditPackage, registeredHooks, riskRows, runContractTest };
