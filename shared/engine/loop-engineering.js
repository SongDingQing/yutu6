'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DoneGate = require('./done-gate');
const AcceptanceContract = require('./acceptance-contract');

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_TARGET_SCORE = 0.85;
const DEFAULT_MIN_IMPROVEMENT = 0.03;
const LOOP_TRUE_DONE_HOOK_ID = 'engine.loop_engineering_convergence';
const MAX_SNAPSHOT_FILENAME_BYTES = 140;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function safeSegment(value, fallback = 'x') {
  const s = String(value || fallback)
    .replace(/[^A-Za-z0-9_.\-\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

function truncateUtf8(value, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of String(value || '')) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
}

function snapshotFileName(rel) {
  const normalized = String(rel || '').split(/[\\/]+/).join('/');
  const base = safeSegment(path.basename(normalized), 'file');
  return truncateUtf8(`${sha256(normalized).slice(0, 16)}__${base}`, MAX_SNAPSHOT_FILENAME_BYTES) || sha256(normalized).slice(0, 16);
}

function relPath(file, root) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file);
  const rel = path.relative(root, resolved).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

function isRecursiveLoopArtifact(rel) {
  const normalized = String(rel || '').split(/[\\/]+/).join('/');
  return /(^|\/)artifacts\/loop-engineering\//.test(normalized)
    || /(^|\/)artifacts\/review-loop-fixture\/[^/]+\/loop-engineering\//.test(normalized);
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function collectText(value, out = [], depth = 0) {
  if (depth > 6 || value == null || out.length > 160) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectText(item, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach(item => collectText(item, out, depth + 1));
  return out;
}

function deriveStandards(ctx) {
  let contractRows = [];
  if (ctx && ctx.acceptance_contract && ctx.acceptance_contract.schema === 'acceptance-contract@1') {
    try {
      const validation = AcceptanceContract.validateConsumerRows(
        ctx.acceptance_contract,
        ctx.requiredRows,
        { textDiagnostic: false },
      );
      if (validation.ok) contractRows = AcceptanceContract.acceptanceRows(ctx.acceptance_contract);
    } catch (_) {
      contractRows = [];
    }
  }
  if (contractRows.length) {
    return contractRows.map((row, idx) => ({
      id: `S${idx + 1}`,
      acceptance_id: row.acceptance_id,
      source_hash: row.source_hash,
      text: row.text,
      weight: Number((1 / contractRows.length).toFixed(6)),
    }));
  }
  const raw = String(ctx && ctx.acceptance || ctx && ctx.goal || '').trim();
  const structuredRows = DoneGate.hasStructuredAcceptanceTable(raw)
    ? DoneGate.parseStructuredAcceptanceRows(raw)
      .map(row => String(row && row.point || '').replace(/^任务验收\s*[:：]\s*/i, '').trim())
      .filter(Boolean)
    : [];
  const parts = (structuredRows.length ? structuredRows : raw
    .split(/\n|;|；|。|\.|、|,|，/)
    .map(s => s.replace(/^[-*\d.、\s]+/, '').trim())
    .filter(item => item
      && !/^(?:结构化验收表|模板:|验收表协议:|\|?---)/.test(item)
      && !/^\|.*\|$/.test(item)))
    .slice(0, 6);
  const standards = parts.length ? parts : ['产出必须有可验证证据', '复审必须逐项核实验收标准'];
  return standards.map((text, idx) => ({
    id: `S${idx + 1}`,
    text,
    weight: Number((1 / standards.length).toFixed(4)),
  }));
}

function existingLoop(ctx) {
  return isPlainObject(ctx && ctx.loop_engineering) ? ctx.loop_engineering : null;
}

function numberInUnitRange(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function scoreFromReview(review) {
  if (!isPlainObject(review)) return null;
  const direct = numberInUnitRange(review.score);
  if (direct != null) return direct;
  const evaluation = isPlainObject(review.evaluation) ? review.evaluation : null;
  if (evaluation) {
    const rawEvalScore = evaluation.score != null ? evaluation.score
      : (evaluation.total != null ? evaluation.total : evaluation.overall);
    const evalScore = numberInUnitRange(rawEvalScore);
    if (evalScore != null) return evalScore;
    if (Array.isArray(evaluation.criteria_scores) && evaluation.criteria_scores.length) {
      const scores = evaluation.criteria_scores
        .map(item => numberInUnitRange(isPlainObject(item) ? (item.score || item.value) : item))
        .filter(v => v != null);
      if (scores.length) return scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }
  const verification = isPlainObject(review.verification) ? review.verification : null;
  if (verification) {
    const verifiedScore = numberInUnitRange(verification.score);
    if (verifiedScore != null) return verifiedScore;
  }
  return null;
}

function critiqueFromReview(review) {
  const evaluation = isPlainObject(review && review.evaluation) ? review.evaluation : {};
  const values = [
    review && review.notes,
    evaluation.gaps,
    evaluation.critique,
    evaluation.improvement_points,
    evaluation.next_actions,
    review && review.improvement_points,
  ];
  const text = collectText(values).join('; ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 1200);
}

function changedFilesFromCtx(ctx) {
  const files = ctx && ctx.implementation && Array.isArray(ctx.implementation.changed_files)
    ? ctx.implementation.changed_files
    : [];
  return files.filter(file => typeof file === 'string' && file.trim());
}

// 单文件快照上限与日志类排除(2026-07-03 架构审视):曾有单轮把 35MB 的 engine-events.jsonl
// 整拷进快照(声明它为 changed_file 本身即病态),快照目录因此膨胀到 593MB。事件日志/日志类
// 文件回滚无意义,跳过并在快照清单记 skipped 原因;restoreSnapshots 对无 snapshot 字段的项天然忽略。
const SNAPSHOT_MAX_BYTES = Math.max(64 * 1024, parseInt(process.env.YUTU6_SNAPSHOT_MAX_BYTES || String(2 * 1024 * 1024), 10) || (2 * 1024 * 1024));
const SNAPSHOT_SKIP_RE = /\.(jsonl|log)$/i;

function snapshotFiles(files, workspaceRoot, roundDir) {
  const snapshots = [];
  const filesDir = ensureDir(path.join(roundDir, 'files'));
  for (const file of files) {
    const rel = relPath(file, workspaceRoot);
    if (!rel) continue;
    if (isRecursiveLoopArtifact(rel)) continue;
    const src = path.join(workspaceRoot, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    if (SNAPSHOT_SKIP_RE.test(rel)) {
      snapshots.push({ path: rel, skipped: 'log-like-file' });
      continue;
    }
    const size = fs.statSync(src).size;
    if (size > SNAPSHOT_MAX_BYTES) {
      snapshots.push({ path: rel, skipped: `size ${size} > ${SNAPSHOT_MAX_BYTES}` });
      continue;
    }
    const dst = path.join(filesDir, snapshotFileName(rel));
    fs.copyFileSync(src, dst);
    snapshots.push({
      path: rel,
      snapshot: dst,
      sha256: sha256(fs.readFileSync(src)),
    });
  }
  return snapshots;
}

function restoreSnapshots(snapshots, workspaceRoot) {
  const restored = [];
  for (const snap of snapshots || []) {
    if (!snap || !snap.path || !snap.snapshot || !fs.existsSync(snap.snapshot)) continue;
    const target = path.join(workspaceRoot, snap.path);
    ensureDir(path.dirname(target));
    fs.copyFileSync(snap.snapshot, target);
    restored.push(snap.path);
  }
  return restored;
}

function skillIdFor(ctx) {
  const explicit = ctx && ctx.loop_engineering && ctx.loop_engineering.skill_id;
  if (explicit) return safeSegment(explicit, 'control-plane-loop-engineering');
  const project = ctx && (ctx.projectId || ctx.project_id);
  if (project) return safeSegment(`${project}-loop-engineering`, 'control-plane-loop-engineering');
  return 'control-plane-loop-engineering';
}

function ensureSkillFile(skillFile, ctx) {
  ensureDir(path.dirname(skillFile));
  if (fs.existsSync(skillFile)) return;
  const standards = (existingLoop(ctx) && existingLoop(ctx).standards || deriveStandards(ctx))
    .map(item => `- ${item.id}: ${item.text}`)
    .join('\n');
  fs.writeFileSync(skillFile, [
    '# Loop Engineering Skill',
    '',
    'This skill stores reusable generation improvements learned by the local review-loop.',
    '',
    '## Current Evaluation Standards',
    standards,
    '',
  ].join('\n'));
}

function validateSkillPatchWithDoneGate({ ctx, skillRel, backupRel, rollbackRel, workspaceRoot }) {
  const vars = {
    goal: '沉淀 loop engineering skill 改进',
    acceptance: 'skill patch 必须可回滚、有证据、路径在任务授权范围内',
    implementation: {
      done: true,
      summary: `patched ${skillRel}`,
      changed_files: [skillRel],
      logic_chain: {
        summary: 'loop engineering deterministic skill patch',
        current_status: 'done',
        actions: ['backed up previous skill', 'appended reusable improvement note', 'wrote rollback script'],
        evidence: [
          { kind: 'file', path: skillRel, summary: 'patched SKILL.md' },
          { kind: 'file', path: backupRel, summary: 'backup for rollback' },
          { kind: 'file', path: rollbackRel, summary: 'one-command rollback script' },
        ],
        conclusion: 'skill patch is reversible and locally verifiable',
      },
    },
    review: {
      pass: true,
      severity: 'low',
      notes: `verified skill patch ${skillRel}, backup ${backupRel}, rollback ${rollbackRel}`,
      verification: {
        verdict: 'true',
        checked: ['implementation.logic_chain', 'implementation.changed_files', skillRel, backupRel, rollbackRel],
        evidence: [
          { kind: 'file', path: skillRel, summary: 'SKILL.md exists' },
          { kind: 'file', path: backupRel, summary: 'backup exists' },
          { kind: 'file', path: rollbackRel, summary: 'rollback exists' },
        ],
      },
    },
  };
  return DoneGate.validateReviewLoopCompletion({
    id: `skill-patch-${Date.now()}`,
    flow: 'review-loop',
    state: 'done',
    vars,
    evidence: [],
    visits: { implement: 1, review: 1 },
  }, {
    workspaceRoot,
    requireDeliveryEvidence: true,
  });
}

function patchSkill(ctx, opts, round, critique) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const artifactsRoot = opts.artifactsRoot || path.join(workspaceRoot, 'projects/控制台/artifacts');
  const skillsRoot = opts.skillsRoot || path.join(workspaceRoot, '.agents/skills');
  const taskId = opts.taskId || 'unknown-task';
  const skillId = skillIdFor(ctx);
  const skillFile = path.join(skillsRoot, skillId, 'SKILL.md');
  ensureSkillFile(skillFile, ctx);

  const patchDir = ensureDir(path.join(artifactsRoot, 'loop-engineering', safeSegment(taskId), 'skill-patches'));
  const before = fs.readFileSync(skillFile, 'utf8');
  const backup = path.join(patchDir, `round-${round}-SKILL.before.md`);
  fs.writeFileSync(backup, before);
  const marker = `<!-- loop-engineering:${safeSegment(taskId)}:${round} -->`;
  const note = [
    '',
    marker,
    `## Iteration ${round} Improvement`,
    '',
    `- Task: ${taskId}`,
    `- Standard focus: ${(existingLoop(ctx).standards || []).map(s => s.text).join(' | ') || 'general quality'}`,
    `- Critique: ${critique || 'No critique text supplied; keep outputs evidence-backed and measurable.'}`,
    '- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.',
    '',
  ].join('\n');
  if (!before.includes(marker)) fs.appendFileSync(skillFile, note);

  const rollback = path.join(patchDir, `rollback-round-${round}.sh`);
  fs.writeFileSync(rollback, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cp ${JSON.stringify(backup)} ${JSON.stringify(skillFile)}`,
    '',
  ].join('\n'));
  fs.chmodSync(rollback, 0o700);

  const skillRel = relPath(skillFile, workspaceRoot);
  const backupRel = relPath(backup, workspaceRoot);
  const rollbackRel = relPath(rollback, workspaceRoot);
  const gate = validateSkillPatchWithDoneGate({ ctx, skillRel, backupRel, rollbackRel, workspaceRoot });
  if (!gate.ok) {
    fs.copyFileSync(backup, skillFile);
    return { ok: false, reason: gate.reason, skill: skillRel, backup: backupRel, rollback: rollbackRel };
  }
  return {
    ok: true,
    skill: skillRel,
    backup: backupRel,
    rollback: rollbackRel,
    before_sha256: sha256(before),
    after_sha256: sha256(fs.readFileSync(skillFile, 'utf8')),
  };
}

function createLoopEngineering(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const artifactsRoot = opts.artifactsRoot || path.join(workspaceRoot, 'projects/控制台/artifacts');
  const maxRounds = Math.max(1, Math.min(
    Number(opts.maxRounds || process.env.CONSOLE_LOOP_ENGINEERING_MAX_ROUNDS || DEFAULT_MAX_ROUNDS) || DEFAULT_MAX_ROUNDS,
    DEFAULT_MAX_ROUNDS,
  ));
  const targetScore = numberInUnitRange(opts.targetScore || process.env.CONSOLE_LOOP_ENGINEERING_TARGET_SCORE) || DEFAULT_TARGET_SCORE;
  const minImprovement = numberInUnitRange(opts.minImprovement || process.env.CONSOLE_LOOP_ENGINEERING_MIN_IMPROVEMENT) || DEFAULT_MIN_IMPROVEMENT;
  const enabled = opts.enabled !== false && process.env.CONSOLE_LOOP_ENGINEERING !== '0';

  function init(ctx, context = {}) {
    if (!enabled || !ctx || typeof ctx !== 'object') return null;
    const existing = existingLoop(ctx);
    if (existing && existing.enabled !== false) {
      const contractStandards = deriveStandards(ctx).filter(item => item.acceptance_id);
      if (contractStandards.length) {
        existing.standards = contractStandards;
        existing.standards_source = 'acceptance-contract@1.requiredRows';
      }
      return existing;
    }
    const loop = Object.assign({
      enabled: true,
      version: 1,
      max_rounds: Math.min(maxRounds, Number(ctx.max_loops || maxRounds) || maxRounds),
      target_score: targetScore,
      min_improvement: minImprovement,
      standards: deriveStandards(ctx),
      standards_source: ctx.acceptance_contract && ctx.acceptance_contract.schema === 'acceptance-contract@1'
        ? 'acceptance-contract@1.requiredRows'
        : 'structured-acceptance-or-prose',
      rounds: [],
      best: null,
      converged: false,
      stop_reason: null,
    }, existing || {});
    ctx.loop_engineering = loop;
    if (context.eventlog) {
      context.eventlog.emit('loop.standard.set', {
        task: context.taskId || null,
        standards: loop.standards,
        targetScore: loop.target_score,
        maxRounds: loop.max_rounds,
        projectId: ctx.projectId || null,
      });
    }
    return loop;
  }

  function afterReview(ctx, context = {}) {
    const loop = init(ctx, context);
    if (!loop || loop.enabled === false) return null;
    const review = isPlainObject(ctx.review) ? ctx.review : {};
    const round = Number(context.loop || ctx.loop || (loop.rounds.length + 1)) || (loop.rounds.length + 1);
    const score = scoreFromReview(review);
    const normalizedScore = score != null ? score : (review.pass === true ? Number(loop.target_score || targetScore) : 0);
    const critique = critiqueFromReview(review);
    const roundDir = ensureDir(path.join(artifactsRoot, 'loop-engineering', safeSegment(context.taskId || 'unknown-task'), `round-${round}`));
    const changed = changedFilesFromCtx(ctx);
    const snapshots = snapshotFiles(changed, workspaceRoot, roundDir);
    const previousBest = loop.best && typeof loop.best.score === 'number' ? loop.best : null;
    const improvement = previousBest ? normalizedScore - previousBest.score : normalizedScore;
    const improved = !previousBest || improvement >= Number(loop.min_improvement || minImprovement);
    const degraded = !!previousBest && normalizedScore + Number(loop.min_improvement || minImprovement) < previousBest.score;
    const roundRecord = {
      round,
      score: Number(normalizedScore.toFixed(4)),
      pass: review.pass === true,
      improved,
      degraded,
      improvement: Number(improvement.toFixed(4)),
      changed_files: changed,
      snapshots,
      critique,
      created_at: new Date().toISOString(),
    };

    if (improved) {
      loop.best = {
        round,
        score: roundRecord.score,
        snapshots,
        changed_files: changed,
        artifact: relPath(path.join(roundDir, 'round.json'), workspaceRoot),
      };
    } else if (degraded && previousBest && previousBest.snapshots && previousBest.snapshots.length) {
      roundRecord.restored_files = restoreSnapshots(previousBest.snapshots, workspaceRoot);
      loop.selected_round = previousBest.round;
    }

    loop.rounds = Array.isArray(loop.rounds) ? loop.rounds : [];
    loop.rounds.push(roundRecord);
    writeJson(path.join(roundDir, 'round.json'), roundRecord);

    const reachedTarget = normalizedScore >= Number(loop.target_score || targetScore) && review.pass === true;
    const canContinue = round < Number(loop.max_rounds || maxRounds);
    let decision = 'stop';
    let skillPatch = null;

    if (reachedTarget) {
      loop.converged = true;
      loop.stop_reason = 'target_met';
      loop.selected_round = loop.best && loop.best.round || round;
      decision = 'done';
    } else if (!canContinue) {
      loop.converged = false;
      loop.stop_reason = 'max_rounds';
      loop.selected_round = loop.best && loop.best.round || round;
      review.pass = true;
      review.severity = 'high';
      review.notes = appendNote(review.notes, 'loop engineering reached max rounds below target; completion will be blocked by done gate');
      decision = 'blocked_stop';
    } else if (previousBest && improvement < Number(loop.min_improvement || minImprovement)) {
      loop.converged = false;
      loop.stop_reason = degraded ? 'degraded_rollback' : 'plateau';
      loop.selected_round = loop.best && loop.best.round || previousBest.round;
      review.pass = true;
      review.severity = 'high';
      review.notes = appendNote(review.notes, `loop engineering stopped: ${loop.stop_reason}; best round ${loop.selected_round} retained`);
      decision = 'blocked_stop';
    } else {
      skillPatch = patchSkill(ctx, Object.assign({}, opts, { workspaceRoot, artifactsRoot, taskId: context.taskId }), round, critique);
      if (!skillPatch.ok) {
        loop.converged = false;
        loop.stop_reason = 'skill_patch_failed';
        review.pass = true;
        review.severity = 'high';
        review.notes = appendNote(review.notes, `loop engineering skill patch failed: ${skillPatch.reason}`);
        decision = 'blocked_stop';
      } else {
        roundRecord.skill_patch = skillPatch;
        writeJson(path.join(roundDir, 'round.json'), roundRecord);
        review.pass = false;
        review.severity = 'low';
        review.notes = appendNote(review.notes, `loop engineering iteration ${round} scored ${roundRecord.score}; skill improved via ${skillPatch.skill}; regenerate and compare next round`);
        loop.converged = false;
        loop.stop_reason = null;
        decision = 'iterate';
      }
    }

    if (context.eventlog) {
      context.eventlog.emit('loop.round.evaluated', {
        task: context.taskId || null,
        round,
        score: roundRecord.score,
        improvement: roundRecord.improvement,
        improved,
        degraded,
        decision,
        projectId: ctx.projectId || null,
      });
      if (skillPatch) context.eventlog.emit('loop.skill.patch', Object.assign({
        task: context.taskId || null,
        round,
        projectId: ctx.projectId || null,
      }, skillPatch));
      if (roundRecord.restored_files && roundRecord.restored_files.length) {
        context.eventlog.emit('loop.rollback', {
          task: context.taskId || null,
          round,
          restored: roundRecord.restored_files,
          selectedRound: loop.selected_round || null,
          projectId: ctx.projectId || null,
        });
      }
      context.eventlog.emit(decision === 'iterate' ? 'loop.iterate' : 'loop.converged', {
        task: context.taskId || null,
        round,
        decision,
        stopReason: loop.stop_reason || null,
        selectedRound: loop.selected_round || null,
        projectId: ctx.projectId || null,
      });
    }
    return { ok: true, decision, round: roundRecord, loop };
  }

  return { init, afterReview };
}

function appendNote(base, note) {
  return [base, note].filter(Boolean).join('\n');
}

function validateLoopEngineeringCompletion(vars) {
  const loop = existingLoop(vars || {});
  if (!loop || loop.enabled === false) return { ok: true, skipped: true };
  if (!Array.isArray(loop.standards) || !loop.standards.length) {
    return { ok: false, reason: 'loop_engineering 缺少可度量 standards' };
  }
  if (!Array.isArray(loop.rounds) || !loop.rounds.length) {
    return { ok: false, reason: 'loop_engineering 没有持久化轮次评分' };
  }
  if (!loop.best || typeof loop.best.score !== 'number') {
    return { ok: false, reason: 'loop_engineering 缺少最佳轮次基线' };
  }
  if (loop.converged !== true) {
    return { ok: false, reason: `loop_engineering 未收敛: ${loop.stop_reason || 'unknown'}` };
  }
  if (loop.best.score + 1e-9 < Number(loop.target_score || DEFAULT_TARGET_SCORE)) {
    return { ok: false, reason: `loop_engineering 最佳分 ${loop.best.score} 未达目标 ${loop.target_score}` };
  }
  return { ok: true, loop };
}

function registerLoopEngineeringHooks(registry) {
  registry.register('task.true_done', {
    id: LOOP_TRUE_DONE_HOOK_ID,
    priority: 30,
    timeoutMs: 100,
    failureMode: 'block',
    handler(event) {
      const vars = event && event.ctx || event && event.task && event.task.vars || {};
      return validateLoopEngineeringCompletion(vars);
    },
  });
  return registry;
}

module.exports = {
  LOOP_TRUE_DONE_HOOK_ID,
  createLoopEngineering,
  deriveStandards,
  scoreFromReview,
  validateLoopEngineeringCompletion,
  registerLoopEngineeringHooks,
  _test: {
    snapshotFiles,
    snapshotFileName,
    isRecursiveLoopArtifact,
    restoreSnapshots,
    patchSkill,
  },
};
