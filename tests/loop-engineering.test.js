#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runFlow } = require('../shared/engine/engine');
const { TaskStore } = require('../shared/engine/taskstore');
const LoopEngineering = require('../shared/engine/loop-engineering');

function reviewLoopFlow() {
  return {
    id: 'review-loop',
    nodes: [
      { id: 'implement', agent_role: 'worker_code' },
      { id: 'review', agent_role: 'supervisor' },
      { id: 'human', type: 'human_gate' },
      { id: 'done', type: 'end' },
    ],
    edges: [
      { from: 'implement', to: 'review' },
      { from: 'review', to: 'implement', when: '{{ review.pass == false and loop < max_loops }}' },
      { from: 'review', to: 'human', when: "{{ review.severity == 'high' or loop >= max_loops }}" },
      { from: 'review', to: 'done', when: '{{ review.pass == true }}' },
      { from: 'human', to: 'implement', when: "{{ human.decision == 'revise' }}" },
      { from: 'human', to: 'done', when: "{{ human.decision == 'approve' }}" },
    ],
    guards: { validate_before_run: false, max_loops: 3 },
    acceptance: { require_evidence: false },
  };
}

function eventlog(events) {
  return {
    emit(type, data) {
      events.push(Object.assign({ type }, data || {}));
    },
  };
}

function implementationVars(file, rel, content, label, taskId, specFingerprint) {
  fs.writeFileSync(file, content);
  return {
    implementation: {
      done: true,
      summary: `${label} wrote ${rel}`,
      changed_files: [rel],
      receipt: {
        taskId,
        specFingerprint,
        changedFiles: [rel],
        tests: [],
        artifacts: [`${rel}:1`],
        verdict: 'done',
        blocked_required_specs: [],
      },
      logic_chain: {
        summary: `${label} implementation`,
        current_status: 'done',
        actions: [`wrote ${rel}`],
        evidence: [
          { kind: 'file', path: rel, summary: `${rel} contains ${content.trim()}` },
        ],
        tests: [],
        conclusion: `${label} complete`,
      },
    },
  };
}

function reviewVars(rel, score, pass, note) {
  return {
    review: {
      pass,
      severity: 'low',
      notes: note,
      evaluation: {
        score,
        criteria_scores: [{ id: 'S1', score, evidence: `${rel} content scored ${score}` }],
        gaps: score >= 0.85 ? [] : ['output has not reached excellent threshold'],
        improvement_points: ['make generated output explicitly excellent and keep file evidence'],
      },
      verification: {
        verdict: pass ? 'true' : 'partial',
        checked: ['implementation.logic_chain', 'implementation.changed_files', rel],
        evidence: [
          { kind: 'file', path: rel, summary: `review inspected ${rel}` },
        ],
      },
    },
  };
}

function makeLoop(root, taskId) {
  return LoopEngineering.createLoopEngineering({
    workspaceRoot: root,
    artifactsRoot: path.join(root, 'projects/控制台/artifacts'),
    skillsRoot: path.join(root, '.agents/skills'),
    taskId,
    maxRounds: 3,
    targetScore: 0.85,
    minImprovement: 0.03,
  });
}

function runConvergingCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-engineering-pass-'));
  try {
    const events = [];
    const taskId = 'loop-pass';
    const rel = 'target.txt';
    const file = path.join(root, rel);
    const result = runFlow({
      flow: reviewLoopFlow(),
      taskId,
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: eventlog(events),
      workspaceRoot: root,
      loopEngineering: makeLoop(root, taskId),
      humanGate: () => ({ human: { decision: 'approve' } }),
      vars: {
        projectId: '控制台',
        goal: '修改 target.txt,持续优化直到内容达到 excellent',
        acceptance: 'target.txt 必须包含 excellent,review score >= 0.85',
      },
      runner(node, ctx) {
        if (node.id === 'implement') {
          const patched = fs.existsSync(path.join(root, '.agents/skills/控制台-loop-engineering/SKILL.md'));
          return {
            vars: implementationVars(file, rel, patched ? 'excellent second round\n' : 'basic first round\n', patched ? 'second' : 'first', taskId, ctx.spec_fingerprint),
          };
        }
        const content = fs.readFileSync(file, 'utf8');
        const score = /excellent/.test(content) ? 0.92 : 0.5;
        return { vars: reviewVars(rel, score, true, `score ${score}`) };
      },
    });
    assert.strictEqual(result.ok, true, result.reason || 'converging loop failed');
    assert.match(fs.readFileSync(file, 'utf8'), /excellent second round/);
    const loop = result.ctx.loop_engineering;
    assert.strictEqual(loop.converged, true);
    assert.strictEqual(loop.stop_reason, 'target_met');
    assert.strictEqual(loop.rounds.length, 2);
    assert.strictEqual(loop.best.round, 2);
    assert(events.some(e => e.type === 'loop.standard.set'), 'missing standards event');
    assert(events.some(e => e.type === 'loop.skill.patch' && e.ok === true), 'missing skill patch event');
    assert(events.some(e => e.type === 'loop.iterate'), 'missing iterate event');
    assert(events.some(e => e.type === 'loop.converged' && e.decision === 'done'), 'missing converged event');
    assert(fs.existsSync(path.join(root, '.agents/skills/控制台-loop-engineering/SKILL.md')), 'skill patch must exist');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runRegressionRollbackCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-engineering-rollback-'));
  try {
    const events = [];
    const taskId = 'loop-rollback';
    const rel = 'target.txt';
    const file = path.join(root, rel);
    const result = runFlow({
      flow: reviewLoopFlow(),
      taskId,
      taskstore: new TaskStore(path.join(root, 'tasks')),
      eventlog: eventlog(events),
      workspaceRoot: root,
      loopEngineering: makeLoop(root, taskId),
      humanGate: () => ({ human: { decision: 'approve' } }),
      vars: {
        projectId: '控制台',
        goal: '修改 target.txt,若下一轮退化必须回退最佳版本',
        acceptance: 'target.txt 必须 score >= 0.85;退化时不能保留坏版本',
      },
      runner(node, ctx) {
        if (node.id === 'implement') {
          const round = Number(ctx.loop || 1);
          return {
            vars: implementationVars(file, rel, round >= 2 ? 'bad regressed round\n' : 'solid first round\n', `round-${round}`, taskId, ctx.spec_fingerprint),
          };
        }
        const content = fs.readFileSync(file, 'utf8');
        const score = /bad/.test(content) ? 0.3 : 0.8;
        return { vars: reviewVars(rel, score, true, `score ${score}`) };
      },
    });
    assert.strictEqual(result.ok, false, 'below-target degraded loop must not be marked done');
    assert.match(result.reason, /done_gate_failed|loop_engineering/);
    assert.match(fs.readFileSync(file, 'utf8'), /solid first round/, 'best snapshot must be restored after regression');
    assert(events.some(e => e.type === 'loop.rollback' && e.restored.includes(rel)), 'missing rollback event');
    assert(events.some(e => e.type === 'done_gate.blocked' && /loop_engineering/.test(e.reason)), 'done gate must block non-converged loop');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testCompletionValidator() {
  const ok = LoopEngineering.validateLoopEngineeringCompletion({
    loop_engineering: {
      enabled: true,
      standards: [{ id: 'S1', text: 'score target', weight: 1 }],
      rounds: [{ round: 1, score: 0.9 }],
      best: { round: 1, score: 0.9 },
      target_score: 0.85,
      converged: true,
    },
  });
  assert.strictEqual(ok.ok, true);
  const bad = LoopEngineering.validateLoopEngineeringCompletion({
    loop_engineering: {
      enabled: true,
      standards: [{ id: 'S1', text: 'score target', weight: 1 }],
      rounds: [{ round: 1, score: 0.5 }],
      best: { round: 1, score: 0.5 },
      target_score: 0.85,
      converged: false,
      stop_reason: 'plateau',
    },
  });
  assert.strictEqual(bad.ok, false);
}

function writeFixtureFile(root, rel, content = 'snapshot source\n') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function testSnapshotFilesAvoidPathExpansion() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-engineering-snapshot-'));
  try {
    const longRel = [
      'projects/控制台/artifacts/self-reflection-optimizer',
      'segment-'.repeat(8),
      'nested-'.repeat(8),
      'codex-visual-review-ui-optimizer-self-reflection-a41a1743-current-3746116-20260701.md',
    ].join('/');
    const recursiveRel = [
      'projects/控制台/artifacts/review-loop-fixture/cr-1782883746116-a41a1743',
      'loop-engineering/cr-1782883746116-a41a1743/round-1/files',
      'projects__控制台__artifacts__self-reflection-optimizer__codex-visual-review-ui-optimizer-self-reflection-a41a1743-current-3746116-20260701.md',
    ].join('/');
    writeFixtureFile(root, longRel);
    writeFixtureFile(root, recursiveRel);

    const roundDir = path.join(root, 'projects/控制台/artifacts/loop-engineering/task/round-1');
    const snapshots = LoopEngineering._test.snapshotFiles([longRel, recursiveRel], root, roundDir);

    assert.strictEqual(snapshots.length, 1, 'recursive loop artifacts must not be snapshotted again');
    assert.strictEqual(snapshots[0].path, longRel);
    assert(fs.existsSync(snapshots[0].snapshot), 'bounded snapshot file must exist');
    assert(Buffer.byteLength(path.basename(snapshots[0].snapshot)) <= 140, 'snapshot filename must stay below filesystem segment limits');
    assert(!snapshots[0].snapshot.includes('review-loop-fixture'), 'snapshot name must not re-embed nested artifact paths');
    assert.strictEqual(LoopEngineering._test.isRecursiveLoopArtifact(recursiveRel), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 2026-07-03 架构审视:快照跳过日志类文件与超上限大文件(曾单轮整拷 35MB engine-events.jsonl),
// 跳过项记 skipped 原因且无 snapshot 字段,restoreSnapshots 对其天然忽略。
function testSnapshotSkipsLogsAndOversized() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-engineering-snapshot-skip-'));
  try {
    const jsonlRel = 'projects/控制台/artifacts/engine-events.jsonl';
    const normalRel = 'projects/控制台/status.md';
    writeFixtureFile(root, jsonlRel, '{"seq":1}\n');
    writeFixtureFile(root, normalRel, 'normal content\n');
    const roundDir = path.join(root, 'projects/控制台/artifacts/loop-engineering/task/round-1');
    const snapshots = LoopEngineering._test.snapshotFiles([jsonlRel, normalRel], root, roundDir);
    const jsonlSnap = snapshots.find(s => s.path === jsonlRel);
    const normalSnap = snapshots.find(s => s.path === normalRel);
    assert(jsonlSnap && jsonlSnap.skipped && !jsonlSnap.snapshot, 'jsonl 文件必须跳过快照并记 skipped');
    assert(normalSnap && normalSnap.snapshot && fs.existsSync(normalSnap.snapshot), '普通文件仍正常快照');
    const restored = LoopEngineering._test.restoreSnapshots
      ? LoopEngineering._test.restoreSnapshots(snapshots, root)
      : null;
    if (restored) assert(!restored.includes(jsonlRel), 'skipped 项不得被 restore');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runConvergingCase();
runRegressionRollbackCase();
testCompletionValidator();
testSnapshotFilesAvoidPathExpansion();
testSnapshotSkipsLogsAndOversized();

console.log(JSON.stringify({ pass: true, suite: 'loop-engineering' }));
