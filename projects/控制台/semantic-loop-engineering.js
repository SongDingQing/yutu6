'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AcceptanceContract = require('../../shared/engine/acceptance-contract');
const BaseLoopEngineering = require('../../shared/engine/loop-engineering');

const SEMANTIC_ATOM_SCHEMA = 'semantic-acceptance-atom@1';
const SEMANTIC_REVIEW_SCHEMA = 'semantic-acceptance-review@1';
const REVIEW_CONTRACT_SCHEMA = 'semantic-acceptance-review-contract@1';
const EXTRACTOR_VERSION = 'contract-identity-v1';
const ALLOWED_SOURCE_KINDS = new Set(['orchestrator', 'owner', 'risk_gate', 'stop_condition']);
const VERDICTS = new Set(['pass', 'fail', 'warning', 'blocked']);
const GATE_VERDICTS = new Set(['pass', 'fail', 'warning', 'blocked', 'not_run']);
const FORMAT_FRAGMENT_PATTERNS = [
  /^md$/i,
  /^markdown$/i,
  /^模板\s*[:：]?(?:\s*(?:templates?[\\/].*|[^。！？|]+\.md))?\s*$/i,
  /^验收表协议\s*[:：]?(?:\s*structured-acceptance@\d+)?\s*$/i,
  /^\|?\s*要点\s*\|\s*完成状态(?:\([^|]*\))?\s*\|\s*证据位置(?:\([^|]*\))?\s*\|\s*备注\s*\|?$/i,
  /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/,
];
const AMBIGUOUS_CONJUNCTION_RE = /(?:并且|同时|以及|或者|\s且\s)/;
const RISK_GATE_RE = /(?:baseline|基线|样本冻结|独立性|业务)\s*门/i;
const STOP_CONDITION_RE = /(?:score\s*=\s*1\s*不得仅|不得进入\s*done|不得收敛)/i;
const MECHANICAL_TABLE_STATUS_RE = /^\|.*\|\s*(?:完成|通过|pass|passed|true|done)\s*\|.*\|?$/i;
const SUBSTANTIVE_EVIDENCE_RE = /(?:exit\s*0|command|test|assert|observed|recomputed|artifact|source|hash|event|file|line|path|scenario|gate|probe|fixture|测试|断言|实测|复现|重算|产物|日志|报告|记录|路径|源码|代码|样本|基线|独立复核|业务指标|门禁|拒绝|过滤|保留|映射|警告|绑定|存在|缺失)/i;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeSegment(value) {
  return String(value || 'unknown-task')
    .replace(/[^A-Za-z0-9_.\-\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'unknown-task';
}

function relativePath(file, workspaceRoot) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join('/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function isFormatFragment(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return !normalized || FORMAT_FRAGMENT_PATTERNS.some(pattern => pattern.test(normalized));
}

function atomKind(row) {
  const sourceKind = String(row && row.source_kind || '').toLowerCase();
  const sourceRef = String(row && row.source_ref || '').toLowerCase();
  const text = String(row && row.text || '');
  if (sourceKind === 'risk_gate' || /(?:^|:)risk[_-]?gate(?:$|:)/.test(sourceRef) || RISK_GATE_RE.test(text)) {
    return 'risk_gate';
  }
  if (sourceKind === 'stop_condition' || /(?:^|:)stop[_-]?condition(?:$|:)/.test(sourceRef) || STOP_CONDITION_RE.test(text)) {
    return 'stop_condition';
  }
  return 'acceptance';
}

function atomFromRow(row, ordinal, total) {
  const originalText = String(row.text || '').trim();
  const atomId = row.acceptance_id;
  const extractionWarnings = [];
  if (AMBIGUOUS_CONJUNCTION_RE.test(originalText)) {
    extractionWarnings.push('ambiguous_logical_conjunction');
  }
  return {
    schema: SEMANTIC_ATOM_SCHEMA,
    id: `S${ordinal + 1}`,
    atom_id: atomId,
    acceptance_id: row.acceptance_id,
    source_hash: row.source_hash,
    source_ref: row.source_ref,
    source_kind: row.source_kind,
    scope: row.scope,
    atom_kind: atomKind(row),
    text: originalText,
    original_text: originalText,
    original_sha256: sha256(originalText),
    ordinal: ordinal + 1,
    split_mapping: {
      strategy: 'orchestrator_item_identity',
      source_acceptance_id: row.acceptance_id,
      source_ordinal: ordinal + 1,
      atom_ordinal: 1,
      start: 0,
      end: originalText.length,
    },
    extractor_version: EXTRACTOR_VERSION,
    extraction_warnings: extractionWarnings,
    weight: total > 0 ? 1 / total : 0,
  };
}

function contractRows(ctx) {
  if (!ctx || !ctx.acceptance_contract || ctx.acceptance_contract.schema !== 'acceptance-contract@1') return [];
  try {
    const validation = AcceptanceContract.validateConsumerRows(
      ctx.acceptance_contract,
      ctx.requiredRows,
      { textDiagnostic: false },
    );
    if (!validation.ok) return [];
    return AcceptanceContract.acceptanceRows(ctx.acceptance_contract);
  } catch (_) {
    return [];
  }
}

function deriveSemanticStandards(ctx) {
  const rows = contractRows(ctx).filter(row => {
    const sourceKind = String(row.source_kind || '').toLowerCase();
    return ALLOWED_SOURCE_KINDS.has(sourceKind) && !isFormatFragment(row.text);
  });
  return rows.map((row, index) => atomFromRow(row, index, rows.length));
}

function normalizeEvidenceRefs(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap(item => {
    if (typeof item === 'string') return [item.trim()].filter(Boolean);
    if (!isPlainObject(item)) return [];
    if (typeof item.ref === 'string') return [item.ref.trim()].filter(Boolean);
    if (typeof item.path === 'string' && Number.isInteger(Number(item.line))) {
      return [`${item.path.trim()}:${Number(item.line)}`];
    }
    return [];
  });
}

function parseEvidenceRef(ref, workspaceRoot) {
  const match = String(ref || '').match(/^(.+):(\d+)$/);
  if (!match) return { ok: false, reason: 'evidence_ref_not_path_line', ref };
  const rel = match[1].replace(/\\/g, '/').replace(/^\.\//, '');
  const line = Number(match[2]);
  if (!rel || rel.startsWith('../') || path.isAbsolute(rel) || !Number.isInteger(line) || line < 1) {
    return { ok: false, reason: 'evidence_ref_outside_workspace', ref };
  }
  const file = path.resolve(workspaceRoot, rel);
  const expectedRoot = `${path.resolve(workspaceRoot)}${path.sep}`;
  if (!file.startsWith(expectedRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return { ok: false, reason: 'evidence_file_missing', ref };
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  if (line > lines.length) return { ok: false, reason: 'evidence_line_missing', ref };
  return { ok: true, ref: `${rel}:${line}`, excerpt: lines[line - 1] };
}

function validateAtomEvidence(atom, criterion, workspaceRoot) {
  const refs = normalizeEvidenceRefs(criterion && criterion.evidence);
  if (!refs.length) return { ok: false, reason: 'atom_evidence_missing', refs: [] };
  const checked = refs.map(ref => parseEvidenceRef(ref, workspaceRoot));
  const invalid = checked.find(item => !item.ok);
  if (invalid) return { ok: false, reason: invalid.reason, refs, checked };
  const bound = checked.filter(item => String(item.excerpt || '').includes(atom.acceptance_id)
    || String(item.excerpt || '').includes(atom.original_text));
  if (!bound.length) return { ok: false, reason: 'atom_evidence_not_bound_to_source', refs, checked };
  const substantive = bound.some(item => {
    const excerpt = String(item.excerpt || '').trim();
    if (MECHANICAL_TABLE_STATUS_RE.test(excerpt)) return false;
    let residue = excerpt;
    for (const copied of [atom.acceptance_id, atom.atom_id, atom.original_text]) {
      if (copied) residue = residue.split(String(copied)).join(' ');
    }
    residue = residue
      .replace(/(?:verdict|gate_verdict|ambiguity_verdict|status|结果|状态)\s*[:=：]\s*(?:pass|clear|true|done|完成|通过)/gi, ' ')
      .replace(/\b(?:pass|passed|true|done|complete|completed)\b/gi, ' ')
      .replace(/(?:已完成|完成|已通过|通过|已核实)/g, ' ')
      .replace(/[\s|`*_:#=;，。；、()[\]{}<>/\\-]+/g, ' ')
      .trim();
    return residue.length >= 8 && SUBSTANTIVE_EVIDENCE_RE.test(residue);
  });
  if (!substantive) {
    return { ok: false, reason: 'atom_evidence_mechanical_mirror', refs, checked };
  }
  return { ok: true, refs: checked.map(item => item.ref), checked };
}

function normalizeDeclaredScore(review) {
  const values = [
    review && review.score,
    review && review.evaluation && review.evaluation.score,
  ].filter(value => value != null);
  if (!values.length) return null;
  const n = Number(values[0]);
  if (!Number.isFinite(n)) return NaN;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function evaluateSemanticReview(ctx, opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const loop = ctx && ctx.loop_engineering || {};
  const standards = Array.isArray(loop.standards)
    ? loop.standards.filter(atom => atom && atom.schema === SEMANTIC_ATOM_SCHEMA)
    : [];
  const review = isPlainObject(ctx && ctx.review) ? ctx.review : {};
  const evaluation = isPlainObject(review.evaluation) ? review.evaluation : {};
  const criteria = Array.isArray(evaluation.criteria_scores) ? evaluation.criteria_scores : [];
  const errors = [];
  const warnings = [];
  const criterionById = new Map();

  for (const criterion of criteria) {
    const atomId = String(criterion && (criterion.atom_id || criterion.acceptance_id || criterion.id) || '');
    if (!atomId) {
      errors.push({ code: 'criterion_atom_id_missing' });
      continue;
    }
    if (criterionById.has(atomId)) {
      errors.push({ code: 'duplicate_atom_criterion', atom_id: atomId });
      continue;
    }
    criterionById.set(atomId, criterion);
  }

  const knownIds = new Set(standards.map(atom => atom.atom_id));
  for (const atomId of criterionById.keys()) {
    if (!knownIds.has(atomId)) errors.push({ code: 'extra_atom_criterion', atom_id: atomId });
  }

  const results = standards.map(atom => {
    const criterion = criterionById.get(atom.atom_id);
    if (!criterion) {
      errors.push({ code: 'missing_atom_criterion', atom_id: atom.atom_id });
      return {
        atom_id: atom.atom_id,
        acceptance_id: atom.acceptance_id,
        atom_kind: atom.atom_kind,
        verdict: 'blocked',
        evidence: [],
        evidence_valid: false,
        passed: false,
      };
    }
    const verdict = String(criterion.verdict || '').toLowerCase();
    if (!VERDICTS.has(verdict)) errors.push({ code: 'atom_verdict_invalid', atom_id: atom.atom_id });
    const evidence = validateAtomEvidence(atom, criterion, workspaceRoot);
    if (!evidence.ok) errors.push({ code: evidence.reason, atom_id: atom.atom_id });

    let gateVerdict = null;
    if (atom.atom_kind === 'risk_gate') {
      gateVerdict = String(criterion.gate_verdict || '').toLowerCase();
      if (!GATE_VERDICTS.has(gateVerdict)) {
        errors.push({ code: 'risk_gate_verdict_missing', atom_id: atom.atom_id });
      }
    }

    let ambiguityVerdict = null;
    if (Array.isArray(atom.extraction_warnings) && atom.extraction_warnings.length) {
      ambiguityVerdict = String(criterion.ambiguity_verdict || '').toLowerCase();
      if (!['clear', 'warning'].includes(ambiguityVerdict)) {
        errors.push({ code: 'ambiguity_verdict_missing', atom_id: atom.atom_id });
      } else if (ambiguityVerdict === 'warning') {
        warnings.push({ code: 'reviewer_semantic_warning', atom_id: atom.atom_id });
      }
    }

    const passed = verdict === 'pass'
      && evidence.ok
      && (atom.atom_kind !== 'risk_gate' || gateVerdict === 'pass')
      && ambiguityVerdict !== 'warning';
    return {
      atom_id: atom.atom_id,
      acceptance_id: atom.acceptance_id,
      atom_kind: atom.atom_kind,
      verdict: VERDICTS.has(verdict) ? verdict : 'blocked',
      gate_verdict: gateVerdict,
      ambiguity_verdict: ambiguityVerdict,
      evidence: evidence.refs || [],
      evidence_valid: evidence.ok,
      passed,
    };
  });

  if (!standards.length) errors.push({ code: 'semantic_atoms_missing' });
  const totalWeight = standards.reduce((sum, atom) => sum + Number(atom.weight || 0), 0) || 1;
  const passedWeight = results.reduce((sum, result, index) => (
    sum + (result.passed ? Number(standards[index].weight || 0) : 0)
  ), 0);
  const recomputedScore = Math.max(0, Math.min(1, passedWeight / totalWeight));
  const declaredScore = normalizeDeclaredScore(review);
  if (Number.isNaN(declaredScore)) {
    errors.push({ code: 'declared_score_invalid' });
  } else if (declaredScore != null && Math.abs(declaredScore - recomputedScore) > 1e-6) {
    errors.push({ code: 'declared_score_mismatch', declared_score: declaredScore, recomputed_score: recomputedScore });
  }
  const hardGateFailures = results
    .filter(result => result.atom_kind === 'risk_gate' && result.gate_verdict !== 'pass')
    .map(result => result.atom_id);
  const unresolvedWarnings = warnings.map(item => item.atom_id);
  const allPassed = standards.length > 0 && results.length === standards.length && results.every(result => result.passed);
  const valid = errors.length === 0;
  return {
    schema: SEMANTIC_REVIEW_SCHEMA,
    valid,
    atom_count: standards.length,
    covered_atom_count: results.filter(result => result.evidence_valid === true).length,
    declared_score: declaredScore,
    recomputed_score: Number(recomputedScore.toFixed(6)),
    all_passed: valid && allPassed,
    eligible_for_convergence: valid && allPassed && hardGateFailures.length === 0 && unresolvedWarnings.length === 0,
    hard_gate_failures: hardGateFailures,
    unresolved_warnings: unresolvedWarnings,
    errors,
    warnings,
    criteria: results,
  };
}

function reviewPrompt() {
  return [
    '语义验收原子评分已启用：review.evaluation.criteria_scores 必须与 loop_engineering.standards 的 atom_id 一一对应，不得缺失、重复或额外。',
    '每项必须输出 {atom_id,verdict,evidence}；verdict 仅限 pass/fail/warning/blocked，evidence 必须是存在的 path:line，且该行含 acceptance_id 或 original_text。',
    'evidence 行还必须包含可核的实测、断言、命令结果、源码或业务记录；只复制 acceptance_id/original_text/完成状态的镜像验收表不构成证据。',
    'risk_gate 原子还必须输出 gate_verdict=pass|fail|warning|blocked|not_run；存在 extraction_warnings 的原子还必须输出 ambiguity_verdict=clear|warning。',
    'evaluation.score 只是声明值，必须等于引擎按全部原子独立重算的分数；任一 baseline、样本冻结、独立性或业务门非 pass，或任一 warning 未解决，都不得 pass/收敛/score=1。',
  ].join('\n');
}

function attachReviewPrompt(ctx) {
  if (!ctx || !isPlainObject(ctx.agentPrompts)) return ctx;
  const current = String(ctx.agentPrompts.supervisor || '');
  const prompt = reviewPrompt();
  if (!current.includes(prompt)) ctx.agentPrompts.supervisor = [current, prompt].filter(Boolean).join('\n\n');
  return ctx;
}

function persistAtoms(loop, opts, context) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const artifactsRoot = opts.artifactsRoot || path.join(workspaceRoot, 'projects/控制台/artifacts');
  const taskId = context.taskId || opts.taskId || 'unknown-task';
  const file = path.join(artifactsRoot, 'loop-engineering', safeSegment(taskId), 'semantic-atoms.json');
  writeJson(file, {
    schema: 'semantic-acceptance-atoms@1',
    task_id: taskId,
    standards_source: loop.standards_source,
    atoms: loop.standards,
  });
  loop.semantic_atoms_artifact = relativePath(file, workspaceRoot);
  return file;
}

function persistReview(semanticReview, result, opts, context) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const artifactsRoot = opts.artifactsRoot || path.join(workspaceRoot, 'projects/控制台/artifacts');
  const taskId = context.taskId || opts.taskId || 'unknown-task';
  const round = result && result.round && result.round.round || context.loop || 1;
  const file = path.join(artifactsRoot, 'loop-engineering', safeSegment(taskId), `semantic-review-round-${round}.json`);
  writeJson(file, semanticReview);
  return relativePath(file, workspaceRoot);
}

function createLoopEngineering(opts = {}) {
  const base = BaseLoopEngineering.createLoopEngineering(opts);
  const semanticEnabled = opts.semanticAtomsEnabled === true;

  function init(ctx, context = {}) {
    const existingBeforeInit = isPlainObject(ctx && ctx.loop_engineering) ? ctx.loop_engineering : null;
    const legacyInProgress = !!(existingBeforeInit
      && existingBeforeInit.semantic_acceptance_enabled !== true
      && Array.isArray(existingBeforeInit.rounds)
      && existingBeforeInit.rounds.length > 0);
    const loop = base.init(ctx, context);
    if (!semanticEnabled || !loop || loop.enabled === false) return loop;
    if (legacyInProgress) {
      loop.semantic_acceptance_deferred = {
        reason: 'legacy_rounds_present',
        legacy_round_count: existingBeforeInit.rounds.length,
        activation: 'next_fresh_loop',
      };
      if (context.eventlog) {
        context.eventlog.emit('loop.semantic_atoms.deferred', {
          task: context.taskId || null,
          reason: loop.semantic_acceptance_deferred.reason,
          legacyRoundCount: loop.semantic_acceptance_deferred.legacy_round_count,
        });
      }
      return loop;
    }
    const standards = deriveSemanticStandards(ctx);
    loop.version = Math.max(2, Number(loop.version || 0));
    loop.semantic_acceptance_enabled = true;
    loop.semantic_atom_schema = SEMANTIC_ATOM_SCHEMA;
    loop.standards_source = 'acceptance-contract@1.semantic-atoms';
    loop.standards = standards;
    loop.review_contract = {
      schema: REVIEW_CONTRACT_SCHEMA,
      criteria_key: 'review.evaluation.criteria_scores',
      identity_key: 'atom_id',
      required_fields: ['atom_id', 'verdict', 'evidence'],
      risk_gate_required_field: 'gate_verdict',
      ambiguity_required_field: 'ambiguity_verdict',
      evidence_policy: 'atom_bound_substantive_non_mirror',
      score_policy: 'independent_weighted_recompute',
    };
    persistAtoms(loop, opts, context);
    if (context.eventlog) {
      context.eventlog.emit('loop.semantic_atoms.set', {
        task: context.taskId || null,
        atomCount: standards.length,
        riskGateCount: standards.filter(atom => atom.atom_kind === 'risk_gate').length,
        stopConditionCount: standards.filter(atom => atom.atom_kind === 'stop_condition').length,
        artifact: loop.semantic_atoms_artifact,
      });
    }
    return loop;
  }

  function afterReview(ctx, context = {}) {
    const loop = init(ctx, context);
    if (!semanticEnabled || !loop || loop.enabled === false || loop.semantic_acceptance_enabled !== true) {
      return base.afterReview(ctx, context);
    }
    const review = isPlainObject(ctx.review) ? ctx.review : (ctx.review = {});
    const declaredPass = review.pass === true;
    const semanticReview = evaluateSemanticReview(ctx, opts);
    review.evaluation = isPlainObject(review.evaluation) ? review.evaluation : {};
    review.evaluation.declared_score = semanticReview.declared_score;
    review.evaluation.score = semanticReview.recomputed_score;
    review.evaluation.semantic_acceptance = semanticReview;
    review.pass = declaredPass && semanticReview.eligible_for_convergence;
    if (!semanticReview.eligible_for_convergence) {
      review.notes = [review.notes, `semantic acceptance blocked convergence: ${semanticReview.errors.map(item => item.code).concat(semanticReview.hard_gate_failures, semanticReview.unresolved_warnings).join(',') || 'not_all_atoms_passed'}`]
        .filter(Boolean).join('\n');
    }

    const semanticStandards = loop.standards.slice();
    const result = base.afterReview(ctx, context);
    // The legacy implementation refreshes an existing loop from all contract
    // rows. Restore the project-local semantic projection after it has handled
    // snapshots/iteration so system delivery and visual rows never re-enter
    // the scoring set.
    if (result && result.loop) {
      result.loop.standards = semanticStandards;
      result.loop.standards_source = 'acceptance-contract@1.semantic-atoms';
      result.loop.semantic_acceptance_enabled = true;
      result.loop.semantic_atom_schema = SEMANTIC_ATOM_SCHEMA;
    }
    if (result && result.round) {
      result.round.semantic_evaluation = semanticReview;
      result.round.semantic_review_artifact = persistReview(semanticReview, result, opts, context);
    }
    if (context.eventlog) {
      context.eventlog.emit('loop.semantic_review.evaluated', {
        task: context.taskId || null,
        round: result && result.round && result.round.round || context.loop || null,
        valid: semanticReview.valid,
        recomputedScore: semanticReview.recomputed_score,
        atomCount: semanticReview.atom_count,
        coveredAtomCount: semanticReview.covered_atom_count,
        hardGateFailures: semanticReview.hard_gate_failures,
        unresolvedWarnings: semanticReview.unresolved_warnings,
        artifact: result && result.round && result.round.semantic_review_artifact || null,
      });
    }
    return result;
  }

  return { init, afterReview };
}

function validateSemanticStandards(standards) {
  if (!Array.isArray(standards) || !standards.length) return { ok: false, reason: 'semantic_acceptance_atoms_missing' };
  const ids = new Set();
  for (const atom of standards) {
    if (!atom || atom.schema !== SEMANTIC_ATOM_SCHEMA || !atom.atom_id || ids.has(atom.atom_id)) {
      return { ok: false, reason: 'semantic_acceptance_atom_identity_invalid' };
    }
    ids.add(atom.atom_id);
    if (!ALLOWED_SOURCE_KINDS.has(String(atom.source_kind || '').toLowerCase()) || isFormatFragment(atom.original_text)) {
      return { ok: false, reason: 'semantic_acceptance_atom_source_invalid' };
    }
    if (atom.text !== atom.original_text || atom.original_sha256 !== sha256(atom.original_text)) {
      return { ok: false, reason: 'semantic_acceptance_atom_original_invalid' };
    }
    const mapping = atom.split_mapping;
    if (!mapping || mapping.strategy !== 'orchestrator_item_identity' || mapping.start !== 0 || mapping.end !== atom.original_text.length) {
      return { ok: false, reason: 'semantic_acceptance_atom_mapping_invalid' };
    }
  }
  return { ok: true };
}

function canonicalAtomProjection(atom) {
  return {
    schema: atom && atom.schema,
    id: atom && atom.id,
    atom_id: atom && atom.atom_id,
    acceptance_id: atom && atom.acceptance_id,
    source_hash: atom && atom.source_hash,
    source_ref: atom && atom.source_ref,
    source_kind: atom && atom.source_kind,
    scope: atom && atom.scope,
    atom_kind: atom && atom.atom_kind,
    text: atom && atom.text,
    original_text: atom && atom.original_text,
    original_sha256: atom && atom.original_sha256,
    ordinal: atom && atom.ordinal,
    split_mapping: atom && atom.split_mapping,
    extractor_version: atom && atom.extractor_version,
    extraction_warnings: atom && atom.extraction_warnings,
    weight: atom && atom.weight,
  };
}

function validateStandardsAgainstContract(ctx, standards) {
  const expected = deriveSemanticStandards(ctx);
  if (!expected.length) {
    return { ok: false, reason: 'semantic_acceptance_source_contract_invalid' };
  }
  if (!Array.isArray(standards) || standards.length !== expected.length) {
    return {
      ok: false,
      reason: 'semantic_acceptance_standards_drift',
      expected_atom_count: expected.length,
      observed_atom_count: Array.isArray(standards) ? standards.length : 0,
      expected_risk_gate_count: expected.filter(atom => atom.atom_kind === 'risk_gate').length,
      observed_risk_gate_count: Array.isArray(standards)
        ? standards.filter(atom => atom && atom.atom_kind === 'risk_gate').length
        : 0,
    };
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedProjection = canonicalAtomProjection(expected[index]);
    const observedProjection = canonicalAtomProjection(standards[index]);
    if (JSON.stringify(observedProjection) !== JSON.stringify(expectedProjection)) {
      return {
        ok: false,
        reason: 'semantic_acceptance_standards_drift',
        drift_index: index,
        expected_atom_id: expected[index].atom_id,
        observed_atom_id: standards[index] && standards[index].atom_id || null,
        expected_atom_sha256: sha256(JSON.stringify(expectedProjection)),
        observed_atom_sha256: sha256(JSON.stringify(observedProjection)),
      };
    }
  }
  return {
    ok: true,
    expected_atom_count: expected.length,
    expected_risk_gate_count: expected.filter(atom => atom.atom_kind === 'risk_gate').length,
    expected_stop_condition_count: expected.filter(atom => atom.atom_kind === 'stop_condition').length,
  };
}

function recordedCriteria(semantic) {
  if (!semantic || !Array.isArray(semantic.criteria)) return [];
  return semantic.criteria.map(item => ({
    atom_id: item && item.atom_id,
    verdict: item && item.verdict,
    evidence: item && item.evidence,
    ...(item && item.atom_kind === 'risk_gate' ? { gate_verdict: item.gate_verdict } : {}),
    ...(item && item.ambiguity_verdict != null ? { ambiguity_verdict: item.ambiguity_verdict } : {}),
  }));
}

function revalidateSemanticRound(vars, round, opts = {}) {
  const semantic = round && round.semantic_evaluation;
  if (!semantic || semantic.schema !== SEMANTIC_REVIEW_SCHEMA || semantic.valid !== true) {
    return { ok: false, reason: 'semantic_acceptance_review_invalid' };
  }
  const reviewCtx = Object.assign({}, vars, {
    review: {
      pass: true,
      evaluation: {
        score: round.score,
        criteria_scores: recordedCriteria(semantic),
      },
    },
  });
  const revalidated = evaluateSemanticReview(reviewCtx, opts);
  if (!revalidated.valid) {
    return {
      ok: false,
      reason: 'semantic_acceptance_review_revalidation_failed',
      round: round.round,
      errors: revalidated.errors,
      covered_atom_count: revalidated.covered_atom_count,
      atom_count: revalidated.atom_count,
    };
  }
  if (Math.abs(Number(round.score) - Number(revalidated.recomputed_score)) > 1e-6) {
    return {
      ok: false,
      reason: 'semantic_acceptance_score_drift',
      round: round.round,
      round_score: Number(round.score),
      recomputed_score: revalidated.recomputed_score,
    };
  }
  return { ok: true, semantic: revalidated };
}

function validateLoopEngineeringCompletion(vars, opts = {}) {
  const base = BaseLoopEngineering.validateLoopEngineeringCompletion(vars);
  if (!base.ok) return base;
  const loop = vars && vars.loop_engineering;
  if (!loop || loop.semantic_acceptance_enabled !== true) return base;
  const standards = validateSemanticStandards(loop.standards);
  if (!standards.ok) return standards;
  const canonical = validateStandardsAgainstContract(vars, loop.standards);
  if (!canonical.ok) return canonical;
  const revalidatedRounds = new Map();
  for (const round of loop.rounds || []) {
    const semantic = round && round.semantic_evaluation;
    if (!semantic || semantic.schema !== SEMANTIC_REVIEW_SCHEMA || semantic.valid !== true) {
      return { ok: false, reason: 'semantic_acceptance_review_invalid' };
    }
    if (Math.abs(Number(round.score) - Number(semantic.recomputed_score)) > 1e-6) {
      return { ok: false, reason: 'semantic_acceptance_score_drift' };
    }
    const revalidated = revalidateSemanticRound(vars, round, opts);
    if (!revalidated.ok) return revalidated;
    revalidatedRounds.set(Number(round.round), revalidated.semantic);
  }
  const selectedRoundNumber = Number(loop.selected_round || loop.best && loop.best.round);
  const selectedRound = (loop.rounds || []).find(round => Number(round && round.round) === selectedRoundNumber);
  const selectedSemantic = selectedRound && revalidatedRounds.get(Number(selectedRound.round));
  if (!selectedSemantic || selectedSemantic.eligible_for_convergence !== true || selectedSemantic.all_passed !== true) {
    return { ok: false, reason: 'semantic_acceptance_not_all_passed' };
  }
  if (selectedSemantic.hard_gate_failures.length || selectedSemantic.unresolved_warnings.length) {
    return { ok: false, reason: 'semantic_acceptance_gate_or_warning_blocked' };
  }
  return { ok: true, loop };
}

function registerLoopEngineeringHooks(registry, opts = {}) {
  if (opts.semanticAtomsEnabled !== true) return BaseLoopEngineering.registerLoopEngineeringHooks(registry);
  registry.register('task.true_done', {
    id: BaseLoopEngineering.LOOP_TRUE_DONE_HOOK_ID,
    priority: 30,
    timeoutMs: 100,
    failureMode: 'block',
    handler(event) {
      const vars = event && event.ctx || event && event.task && event.task.vars || {};
      return validateLoopEngineeringCompletion(vars, opts);
    },
  });
  return registry;
}

module.exports = Object.assign({}, BaseLoopEngineering, {
  SEMANTIC_ATOM_SCHEMA,
  SEMANTIC_REVIEW_SCHEMA,
  REVIEW_CONTRACT_SCHEMA,
  createLoopEngineering,
  deriveSemanticStandards,
  evaluateSemanticReview,
  validateLoopEngineeringCompletion,
  registerLoopEngineeringHooks,
  attachReviewPrompt,
  reviewPrompt,
  _test: Object.assign({}, BaseLoopEngineering._test, {
    isFormatFragment,
    atomKind,
    parseEvidenceRef,
    validateSemanticStandards,
    validateStandardsAgainstContract,
  }),
});
