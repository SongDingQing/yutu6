#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AcceptanceContract = require('../../../shared/engine/acceptance-contract');
const SemanticLoopEngineering = require('../semantic-loop-engineering');
const EngineRunner = require('../engine-runner');

const CURRENT_TASK_ID = 'cr-1784261743007-abf0c213';
const scenarios = [];
const observations = {};
let currentContractAudit = null;

function scenario(name, fn) {
  fn();
  scenarios.push(name);
}

function makeContract() {
  return AcceptanceContract.createContract([
    { text: '生成 standards 时直接使用 orchestrator/owner 的逐项 acceptance。', source_kind: 'owner', source_ref: 'owner:fixture' },
    { text: '语义原子提取需保存原文。', source_kind: 'orchestrator', source_ref: 'orchestrator:fixture' },
    { text: 'baseline 门未通过时 score 不得为 1。', source_kind: 'risk_gate', source_ref: 'owner:risk_gate:baseline' },
    { text: '样本冻结门未通过时 score 不得为 1。', source_kind: 'risk_gate', source_ref: 'owner:risk_gate:sample_freeze' },
    { text: '独立性门未通过时 score 不得为 1。', source_kind: 'risk_gate', source_ref: 'owner:risk_gate:independence' },
    { text: '业务门未通过时 score 不得为 1。', source_kind: 'risk_gate', source_ref: 'owner:risk_gate:business' },
    { text: 'score=1 不得仅由表格机械完整推出。', source_kind: 'stop_condition', source_ref: 'owner:stop_condition:false_pass' },
    { text: '证据完整并且 verdict 明确。', source_kind: 'orchestrator', source_ref: 'orchestrator:ambiguous-fixture' },
    { text: 'md', source_kind: 'orchestrator', source_ref: 'orchestrator:format-md' },
    { text: '模板: templates/structured-acceptance-table.md', source_kind: 'orchestrator', source_ref: 'orchestrator:format-template' },
    { text: '| 要点 | 完成状态 | 证据位置 | 备注 |', source_kind: 'orchestrator', source_ref: 'orchestrator:format-header' },
    { text: '| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |', source_kind: 'orchestrator', source_ref: 'orchestrator:format-full-header' },
    { text: '|---|---|---|---|', source_kind: 'orchestrator', source_ref: 'orchestrator:format-separator' },
    { text: '任务验收: 实现阶段交付。', source_kind: 'system', source_ref: 'system:delivery' },
    { text: '视觉/UI证据: not_applicable', source_kind: 'system', source_ref: 'system:visual' },
  ], {
    stage: 'supervisor-requiredRows',
    projectId: '控制台',
    rootTaskId: 'semantic-loop-fixture',
    scope: 'project/控制台',
  });
}

function makeCtx(contract) {
  return {
    projectId: '控制台',
    acceptance_contract: contract,
    requiredRows: AcceptanceContract.acceptanceRows(contract),
    implementation: { changed_files: [] },
  };
}

function writeEvidence(root, atoms) {
  const rel = 'projects/控制台/artifacts/semantic-loop-fixture/evidence.md';
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, atoms.map((atom, index) => (
    `${atom.acceptance_id} | ${atom.original_text} | observed: scenario ${index + 1} assertion and source mapping verified by semantic-loop-engineering.test.js exit 0`
  )).join('\n') + '\n');
  return {
    rel,
    refs: new Map(atoms.map((atom, index) => [atom.atom_id, `${rel}:${index + 1}`])),
  };
}

function criteriaFor(atoms, refs) {
  return atoms.map(atom => {
    const criterion = {
      atom_id: atom.atom_id,
      verdict: 'pass',
      evidence: refs.get(atom.atom_id),
    };
    if (atom.atom_kind === 'risk_gate') criterion.gate_verdict = 'pass';
    if (atom.extraction_warnings.length) criterion.ambiguity_verdict = 'clear';
    return criterion;
  });
}

function semanticCtx(root) {
  const contract = makeContract();
  const ctx = makeCtx(contract);
  const atoms = SemanticLoopEngineering.deriveSemanticStandards(ctx);
  ctx.loop_engineering = {
    enabled: true,
    semantic_acceptance_enabled: true,
    standards: atoms,
  };
  const evidence = writeEvidence(root, atoms);
  return { contract, ctx, atoms, evidence };
}

function evaluate(root, ctx, criteria, declaredScore) {
  ctx.review = {
    pass: true,
    severity: 'low',
    notes: 'semantic fixture review',
    evaluation: {
      criteria_scores: criteria,
    },
  };
  if (declaredScore !== undefined) ctx.review.evaluation.score = declaredScore;
  return SemanticLoopEngineering.evaluateSemanticReview(ctx, { workspaceRoot: root });
}

scenario('contract rows become source-preserving semantic atoms while formatting/system rows are excluded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-derive-'));
  try {
    const { atoms } = semanticCtx(root);
    assert.strictEqual(atoms.length, 8);
    assert(!atoms.some(atom => ['md', '|---|---|---|---|'].includes(atom.text)));
    assert(!atoms.some(atom => atom.text.startsWith('模板: templates/')));
    assert(!atoms.some(atom => atom.text.includes('完成状态(完成/部分/未完成)')));
    assert(!atoms.some(atom => atom.source_kind === 'system'));
    assert.strictEqual(SemanticLoopEngineering._test.isFormatFragment('生成 standards 时过滤“模板、md、表头、分隔线”等格式碎片。'), false);
    assert.strictEqual(atoms.filter(atom => atom.atom_kind === 'risk_gate').length, 4);
    assert.strictEqual(atoms.filter(atom => atom.atom_kind === 'stop_condition').length, 1);
    for (const atom of atoms) {
      assert.strictEqual(atom.text, atom.original_text);
      assert.match(atom.original_sha256, /^[a-f0-9]{64}$/);
      assert.strictEqual(atom.atom_id, atom.acceptance_id);
      assert.strictEqual(atom.split_mapping.strategy, 'orchestrator_item_identity');
      assert.strictEqual(atom.split_mapping.end, atom.original_text.length);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('mechanical score=1 without atom verdicts/evidence is rejected and independently recomputed to zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-mechanical-'));
  try {
    const { ctx } = semanticCtx(root);
    const result = evaluate(root, ctx, [], 1);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.recomputed_score, 0);
    assert.strictEqual(result.eligible_for_convergence, false);
    assert(result.errors.some(error => error.code === 'missing_atom_criterion'));
    assert(result.errors.some(error => error.code === 'declared_score_mismatch'));
    observations.mechanical_score_one = {
      declared_score: 1,
      recomputed_score: result.recomputed_score,
      valid: result.valid,
      eligible_for_convergence: result.eligible_for_convergence,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('mirrored acceptance id/original text table is not substantive evidence for score=1', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-mirror-'));
  try {
    const { ctx, atoms, evidence } = semanticCtx(root);
    fs.writeFileSync(
      path.join(root, evidence.rel),
      atoms.map(atom => `${atom.acceptance_id} | ${atom.original_text}`).join('\n') + '\n',
    );
    const result = evaluate(root, ctx, criteriaFor(atoms, evidence.refs), 1);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.covered_atom_count, 0);
    assert.strictEqual(result.recomputed_score, 0);
    assert.strictEqual(result.eligible_for_convergence, false);
    assert(result.errors.some(error => error.code === 'atom_evidence_mechanical_mirror'));
    observations.mechanical_mirror = {
      valid: result.valid,
      covered_atom_count: result.covered_atom_count,
      recomputed_score: result.recomputed_score,
      eligible_for_convergence: result.eligible_for_convergence,
      error: 'atom_evidence_mechanical_mirror',
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('every atom requires a parseable evidence line bound to original text or acceptance id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-evidence-'));
  try {
    const { ctx, atoms, evidence } = semanticCtx(root);
    const criteria = criteriaFor(atoms, evidence.refs);
    criteria[0].evidence = `${evidence.rel}:999`;
    const result = evaluate(root, ctx, criteria);
    assert.strictEqual(result.valid, false);
    assert(result.errors.some(error => error.code === 'evidence_line_missing'));

    const unbound = path.join(root, evidence.rel);
    const lines = fs.readFileSync(unbound, 'utf8').split(/\r?\n/);
    lines[0] = 'generic table complete';
    fs.writeFileSync(unbound, lines.join('\n'));
    criteria[0].evidence = `${evidence.rel}:1`;
    const bindingResult = evaluate(root, ctx, criteria);
    assert.strictEqual(bindingResult.valid, false);
    assert(bindingResult.errors.some(error => error.code === 'atom_evidence_not_bound_to_source'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('all atom verdicts and evidence produce score=1 only after independent recomputation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-pass-'));
  try {
    const { ctx, atoms, evidence } = semanticCtx(root);
    const result = evaluate(root, ctx, criteriaFor(atoms, evidence.refs), 1);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.covered_atom_count, atoms.length);
    assert.strictEqual(result.recomputed_score, 1);
    assert.strictEqual(result.all_passed, true);
    assert.strictEqual(result.eligible_for_convergence, true);
    observations.full_semantic_coverage = {
      atom_count: result.atom_count,
      covered_atom_count: result.covered_atom_count,
      recomputed_score: result.recomputed_score,
      eligible_for_convergence: result.eligible_for_convergence,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const gateText of ['baseline', '样本冻结', '独立性', '业务']) {
  scenario(`${gateText} gate failure prevents score=1 and convergence`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-gate-'));
    try {
      const { ctx, atoms, evidence } = semanticCtx(root);
      const criteria = criteriaFor(atoms, evidence.refs);
      const target = atoms.find(atom => atom.atom_kind === 'risk_gate' && atom.original_text.includes(gateText));
      const criterion = criteria.find(item => item.atom_id === target.atom_id);
      criterion.gate_verdict = 'fail';
      const result = evaluate(root, ctx, criteria);
      assert.strictEqual(result.valid, true);
      assert(result.recomputed_score < 1);
      assert.strictEqual(result.eligible_for_convergence, false);
      assert.deepStrictEqual(result.hard_gate_failures, [target.atom_id]);
      observations.risk_gates = observations.risk_gates || {};
      observations.risk_gates[gateText] = {
        recomputed_score: result.recomputed_score,
        hard_gate_failures: result.hard_gate_failures,
        eligible_for_convergence: result.eligible_for_convergence,
      };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

scenario('reviewer ambiguity warning remains auditable and blocks score=1', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-warning-'));
  try {
    const { ctx, atoms, evidence } = semanticCtx(root);
    const criteria = criteriaFor(atoms, evidence.refs);
    const atom = atoms.find(item => item.extraction_warnings.includes('ambiguous_logical_conjunction'));
    const criterion = criteria.find(item => item.atom_id === atom.atom_id);
    criterion.verdict = 'warning';
    criterion.ambiguity_verdict = 'warning';
    const result = evaluate(root, ctx, criteria);
    assert.strictEqual(result.valid, true);
    assert(result.recomputed_score < 1);
    assert.deepStrictEqual(result.unresolved_warnings, [atom.atom_id]);
    assert.strictEqual(result.eligible_for_convergence, false);
    observations.reviewer_warning = {
      atom_id: atom.atom_id,
      recomputed_score: result.recomputed_score,
      unresolved_warnings: result.unresolved_warnings,
      eligible_for_convergence: result.eligible_for_convergence,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('declared evaluation score cannot override independently recomputed atom score', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-score-'));
  try {
    const { ctx, atoms, evidence } = semanticCtx(root);
    const result = evaluate(root, ctx, criteriaFor(atoms, evidence.refs), 0.9);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.recomputed_score, 1);
    assert(result.errors.some(error => error.code === 'declared_score_mismatch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('strict project loop persists atoms/review, emits events and passes completion only for full semantic coverage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-integration-'));
  try {
    const contract = makeContract();
    const ctx = makeCtx(contract);
    const events = [];
    const eventlog = { emit(type, data) { events.push(Object.assign({ type }, data || {})); } };
    const loop = SemanticLoopEngineering.createLoopEngineering({
      enabled: true,
      semanticAtomsEnabled: true,
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'projects/控制台/artifacts'),
      skillsRoot: path.join(root, '.agents/skills'),
      taskId: 'semantic-integration',
    });
    const initialized = loop.init(ctx, { taskId: 'semantic-integration', eventlog });
    const evidence = writeEvidence(root, initialized.standards);
    ctx.review = {
      pass: true,
      severity: 'low',
      notes: 'all semantic atoms independently verified',
      evaluation: {
        score: 1,
        criteria_scores: criteriaFor(initialized.standards, evidence.refs),
      },
    };
    const result = loop.afterReview(ctx, { taskId: 'semantic-integration', loop: 1, eventlog });
    assert.strictEqual(result.decision, 'done');
    assert.strictEqual(result.loop.converged, true);
    assert.strictEqual(result.loop.standards_source, 'acceptance-contract@1.semantic-atoms');
    assert(result.loop.standards.every(atom => atom.schema === SemanticLoopEngineering.SEMANTIC_ATOM_SCHEMA));
    assert.strictEqual(result.round.semantic_evaluation.eligible_for_convergence, true);
    assert(fs.existsSync(path.join(root, result.loop.semantic_atoms_artifact)));
    assert(fs.existsSync(path.join(root, result.round.semantic_review_artifact)));
    assert(events.some(event => event.type === 'loop.semantic_atoms.set'));
    assert(events.some(event => event.type === 'loop.semantic_review.evaluated' && event.recomputedScore === 1));
    const completion = SemanticLoopEngineering.validateLoopEngineeringCompletion(ctx, { workspaceRoot: root });
    assert.strictEqual(completion.ok, true, completion.reason);

    const canonicalStandards = result.loop.standards;
    result.loop.standards = canonicalStandards.filter(atom => atom.atom_kind !== 'risk_gate');
    const missingRiskGates = SemanticLoopEngineering.validateLoopEngineeringCompletion(ctx, { workspaceRoot: root });
    assert.strictEqual(missingRiskGates.ok, false);
    assert.strictEqual(missingRiskGates.reason, 'semantic_acceptance_standards_drift');
    assert.strictEqual(missingRiskGates.expected_risk_gate_count, 4);
    assert.strictEqual(missingRiskGates.observed_risk_gate_count, 0);
    observations.completion_contract_drift = {
      reason: missingRiskGates.reason,
      expected_atom_count: missingRiskGates.expected_atom_count,
      observed_atom_count: missingRiskGates.observed_atom_count,
      expected_risk_gate_count: missingRiskGates.expected_risk_gate_count,
      observed_risk_gate_count: missingRiskGates.observed_risk_gate_count,
    };
    result.loop.standards = canonicalStandards;

    const recordedCriteria = result.round.semantic_evaluation.criteria;
    result.round.semantic_evaluation.criteria = [];
    const missingCriteria = SemanticLoopEngineering.validateLoopEngineeringCompletion(ctx, { workspaceRoot: root });
    assert.strictEqual(missingCriteria.ok, false);
    assert.strictEqual(missingCriteria.reason, 'semantic_acceptance_review_revalidation_failed');
    assert(missingCriteria.errors.some(error => error.code === 'missing_atom_criterion'));
    result.round.semantic_evaluation.criteria = recordedCriteria;

    fs.unlinkSync(path.join(root, evidence.rel));
    const missingEvidence = SemanticLoopEngineering.validateLoopEngineeringCompletion(ctx, { workspaceRoot: root });
    assert.strictEqual(missingEvidence.ok, false);
    assert.strictEqual(missingEvidence.reason, 'semantic_acceptance_review_revalidation_failed');
    assert(missingEvidence.errors.some(error => error.code === 'evidence_file_missing'));
    observations.completion_revalidation = {
      cached_valid_remained_true: result.round.semantic_evaluation.valid,
      missing_criteria_reason: missingCriteria.reason,
      missing_criteria_covered_atom_count: missingCriteria.covered_atom_count,
      deleted_evidence_reason: missingEvidence.reason,
      deleted_evidence_covered_atom_count: missingEvidence.covered_atom_count,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('production semantic atom promotion remains disabled and owner-gated', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  assert.strictEqual(config.semanticAcceptanceAtoms.enabled, false);
  assert.strictEqual(config.semanticAcceptanceAtoms.promotionApproval.ownerApproved, false);
  assert.strictEqual(config.semanticAcceptanceAtoms.promotionApproval.supervisorReviewed, false);
  const decision = EngineRunner._test.semanticAcceptanceAtomsDecision(true);
  assert.deepStrictEqual(decision, { enabled: false, reason: 'feature_disabled' });
});

scenario('legacy in-flight loops are deferred instead of changing standards between rounds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-loop-legacy-'));
  try {
    const contract = makeContract();
    const ctx = makeCtx(contract);
    ctx.loop_engineering = {
      enabled: true,
      version: 1,
      standards: [{ id: 'S1', text: 'legacy standard', weight: 1 }],
      rounds: [{ round: 1, score: 0.6 }],
      best: { round: 1, score: 0.6 },
      converged: false,
      target_score: 0.85,
    };
    const events = [];
    const loop = SemanticLoopEngineering.createLoopEngineering({
      enabled: true,
      semanticAtomsEnabled: true,
      workspaceRoot: root,
      artifactsRoot: path.join(root, 'projects/控制台/artifacts'),
      skillsRoot: path.join(root, '.agents/skills'),
      taskId: 'legacy-in-flight',
    });
    const initialized = loop.init(ctx, {
      taskId: 'legacy-in-flight',
      eventlog: { emit(type, data) { events.push(Object.assign({ type }, data || {})); } },
    });
    assert.strictEqual(initialized.semantic_acceptance_enabled, undefined);
    assert.strictEqual(initialized.standards_source, 'acceptance-contract@1.requiredRows');
    assert.strictEqual(initialized.semantic_acceptance_deferred.reason, 'legacy_rounds_present');
    assert(events.some(event => event.type === 'loop.semantic_atoms.deferred'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario('review prompt explicitly requires per-atom verdict/evidence and risk-gate verdicts', () => {
  const ctx = { agentPrompts: { supervisor: 'existing supervisor prompt' } };
  SemanticLoopEngineering.attachReviewPrompt(ctx);
  assert.match(ctx.agentPrompts.supervisor, /criteria_scores.*atom_id.*一一对应/);
  assert.match(ctx.agentPrompts.supervisor, /verdict,evidence/);
  assert.match(ctx.agentPrompts.supervisor, /镜像验收表不构成证据/);
  assert.match(ctx.agentPrompts.supervisor, /gate_verdict/);
  assert.match(ctx.agentPrompts.supervisor, /baseline、样本冻结、独立性或业务门/);
});

scenario('current rework task contract deterministically yields 19 orchestrator atoms and excludes both system rows', () => {
  const task = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '..',
    'artifacts',
    'engine-tasks',
    `${CURRENT_TASK_ID}.json`,
  ), 'utf8'));
  const ctx = {
    acceptance_contract: task.vars.acceptance_contract,
    requiredRows: task.vars.requiredRows,
  };
  const atoms = SemanticLoopEngineering.deriveSemanticStandards(ctx);
  assert.strictEqual(atoms.length, 19);
  assert.strictEqual(atoms.filter(atom => atom.atom_kind === 'risk_gate').length, 4);
  assert.strictEqual(atoms.filter(atom => atom.atom_kind === 'stop_condition').length, 1);
  assert(!atoms.some(atom => atom.source_kind === 'system'));
  assert(!atoms.some(atom => SemanticLoopEngineering._test.isFormatFragment(atom.original_text)));
  assert(atoms.some(atom => atom.acceptance_id === 'acc_8bca424e9ebfc0a8b5f1c236'
    && atom.original_text === '生成 standards 时过滤“模板、md、表头、分隔线”等格式碎片。'));
  assert(atoms.every(atom => atom.source_hash === task.vars.requiredRows
    .find(row => row.acceptance_id === atom.acceptance_id).source_hash));
  currentContractAudit = {
    contract_id: task.vars.acceptance_contract.contract_id,
    source_row_count: task.vars.requiredRows.length,
    semantic_atom_count: atoms.length,
    risk_gate_count: atoms.filter(atom => atom.atom_kind === 'risk_gate').length,
    stop_condition_count: atoms.filter(atom => atom.atom_kind === 'stop_condition').length,
    excluded_system_count: task.vars.requiredRows.filter(row => row.source_kind === 'system').length,
    atoms: atoms.map(atom => ({
      atom_id: atom.atom_id,
      source_hash: atom.source_hash,
      source_ref: atom.source_ref,
      source_kind: atom.source_kind,
      atom_kind: atom.atom_kind,
      original_text: atom.original_text,
      original_sha256: atom.original_sha256,
      split_mapping: atom.split_mapping,
    })),
  };
});

const report = {
  schema: 'semantic-loop-engineering-test-report@1',
  pass: true,
  scenario_count: scenarios.length,
  scenarios,
  observations,
  current_contract_audit: currentContractAudit,
  assertions: {
    format_fragments_filtered: true,
    mechanical_mirror_evidence_rejected: true,
    source_original_hash_mapping_preserved: true,
    per_atom_verdict_and_evidence_required: true,
    score_independently_recomputed: true,
    baseline_sample_independence_business_gates_block_score_one: true,
    reviewer_warning_supported: true,
    event_log_and_artifact_paths_emitted: true,
    completion_rederives_full_contract_atom_set: true,
    completion_revalidates_current_atom_evidence_and_verdicts: true,
    production_default_off: true,
  },
};

const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
  const reportFile = path.resolve(process.argv[reportIndex + 1]);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report));
