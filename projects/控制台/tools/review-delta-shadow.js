#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ReviewDeltaContext = require('../review-delta-context');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const PROJECT_ROOT = path.join(WORKSPACE_ROOT, 'projects/控制台');
const DEFAULT_TASK_ID = 'cr-1784171154971-19856f34';
const NODE_DIRS = ['implement-1', 'review-2', 'implement-3', 'review-4', 'implement-5', 'review-6'];

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseResult(text) {
  const matches = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(matches[index][1].trim()); } catch (_) {}
  }
  return {};
}

function taskSpecFingerprint(text) {
  const match = String(text).match(/^- 规格指纹:([^\r\n]+)$/m);
  return match ? match[1].trim() : null;
}

function taskGoal(text) {
  const source = String(text || '');
  const marker = '- 目标:';
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const boundary = source.indexOf('\n- 边界:', valueStart);
  if (boundary < 0) return null;
  return source.slice(valueStart, boundary);
}

function structuredRows(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\|\s*(任务验收:[^|]+|视觉\/UI证据:[^|]+)\s*\|/.exec(line);
    if (!match) continue;
    const point = match[1].trim();
    const machineText = point.replace(/^任务验收:\s*/, '');
    const sourceHash = sha256(`shadow-row-v1\0${machineText}`);
    rows.push({
      point,
      text: machineText,
      acceptance_id: `acc_${sourceHash.slice(0, 24)}`,
      source_hash: sourceHash,
      scope: 'project/控制台',
    });
  }
  return rows;
}

function previousLine(text) {
  return String(text).split(/\r?\n/).find(line => line.startsWith('- 上一步结果(供参考):')) || '';
}

function tokenProxy(text) {
  return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 4);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rel(file) {
  return path.relative(WORKSPACE_ROOT, file).split(path.sep).join('/');
}

function refFor(file, kind) {
  return { kind, path: rel(file), sha256: sha256(fs.readFileSync(file)) };
}

function changedFiles(result, prior) {
  const files = result && result.implementation && result.implementation.changed_files;
  if (!Array.isArray(files)) return prior;
  return files.map(file => {
    const absolute = path.resolve(WORKSPACE_ROOT, file);
    return {
      path: String(file),
      sha256: fs.existsSync(absolute) && fs.statSync(absolute).isFile()
        ? sha256(fs.readFileSync(absolute))
        : sha256(`historical-ref:${file}`),
      historical_snapshot_available: fs.existsSync(absolute),
    };
  });
}

function failedRows(review, requiredRows) {
  const table = review && review.verification && review.verification.acceptance_table;
  if (!Array.isArray(table)) return [];
  return table.filter(row => !['完成', 'not_applicable'].includes(String(row.status || ''))).map(row => {
    const canonical = requiredRows.find(item => item.point === row.point || item.text === row.text);
    return Object.assign({}, canonical || {
      point: String(row.point || ''),
      text: String(row.text || row.point || ''),
      acceptance_id: `acc_${sha256(String(row.point || '')).slice(0, 24)}`,
      source_hash: sha256(String(row.point || '')),
      scope: 'project/控制台',
    }, { status: String(row.status || '') });
  });
}

function improvementPoints(review) {
  const points = review && review.evaluation && review.evaluation.improvement_points;
  return Array.isArray(points) ? points.map(String) : [];
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function main(argv = process.argv.slice(2)) {
  const taskId = argv[0] || DEFAULT_TASK_ID;
  const output = argv[1]
    ? path.resolve(WORKSPACE_ROOT, argv[1])
    : path.join(PROJECT_ROOT, 'artifacts', `review-delta-shadow-${taskId}.json`);
  const runRoot = path.join(PROJECT_ROOT, 'artifacts/engine-runs', taskId);
  if (!fs.existsSync(runRoot)) throw new Error(`historical run not found: ${rel(runRoot)}`);
  const taskRecords = NODE_DIRS.map(dir => {
    const nodeRoot = path.join(runRoot, dir);
    const taskFile = path.join(nodeRoot, 'task.redacted.md');
    const resultFile = path.join(nodeRoot, 'result.redacted.md');
    const traceFile = path.join(nodeRoot, 'interaction-trace.json');
    if (![taskFile, resultFile, traceFile].every(fs.existsSync)) throw new Error(`incomplete node artifact: ${dir}`);
    return {
      dir,
      node: dir.replace(/-\d+$/, ''),
      taskFile,
      resultFile,
      taskText: read(taskFile),
      result: parseResult(read(resultFile)),
      trace: JSON.parse(read(traceFile)),
    };
  });
  const requiredRows = structuredRows(taskRecords[0].taskText);
  if (!requiredRows.length) throw new Error('structured required rows were not found in the historical redacted prompt');
  const specFingerprint = taskSpecFingerprint(taskRecords[0].taskText);
  if (!specFingerprint) throw new Error('spec fingerprint missing from historical prompt');
  const redactedGoal = taskGoal(taskRecords[0].taskText);
  if (redactedGoal == null) throw new Error('goal block missing from historical redacted prompt');
  const goalSha256 = sha256(redactedGoal);
  let latestChangedFiles = [];
  let previousFailedRows = [];
  let points = [];
  let reviewHistoryRefs = [];
  const perNode = [];
  const validationRefs = [];

  taskRecords.forEach((record, index) => {
    const baselinePrevious = previousLine(record.taskText);
    const legacyBytes = Buffer.byteLength(record.taskText);
    let projectedText = record.taskText;
    let deltaValue = null;
    if (index > 0) {
      const previous = taskRecords[index - 1];
      const latestRefs = [
        refFor(previous.taskFile, 'task_redacted'),
        refFor(previous.resultFile, 'result_redacted'),
        ...reviewHistoryRefs,
      ];
      validationRefs.push(...latestRefs);
      deltaValue = {
        goal_sha256: goalSha256,
        spec_fingerprint: specFingerprint,
        requiredRows,
        previous_failed_rows: previousFailedRows,
        improvement_points: points,
        changed_files: latestChangedFiles,
        artifact_refs: latestRefs,
      };
      const replacement = `- 上一步差量上下文(供参考):${JSON.stringify(deltaValue)}`;
      projectedText = record.taskText.replace(baselinePrevious, replacement);
      if (!projectedText.includes(`- 不可变目标哈希:${goalSha256}`)) {
        projectedText = projectedText.replace(
          `- 规格指纹:${specFingerprint}`,
          `- 规格指纹:${specFingerprint}\n- 不可变目标哈希:${goalSha256}`,
        );
      }
    }
    const projectedBytes = Buffer.byteLength(projectedText);
    perNode.push({
      node_dir: record.dir,
      legacy: {
        prompt_chars_observed: Number(record.trace.prompt && record.trace.prompt.chars || record.taskText.length),
        prompt_bytes_observed: legacyBytes,
        input_token_proxy: tokenProxy(record.taskText),
        previous_context_bytes: Buffer.byteLength(baselinePrevious),
        latency_ms_observed: Number(record.trace.latency_ms || 0),
      },
      shadow_delta: {
        prompt_chars_projected: projectedText.length,
        prompt_bytes_projected: projectedBytes,
        input_token_proxy: tokenProxy(projectedText),
        previous_context_bytes: deltaValue ? Buffer.byteLength(JSON.stringify(deltaValue)) : Buffer.byteLength(baselinePrevious),
        required_row_count: requiredRows.length,
        failed_row_count: previousFailedRows.length,
        mode: index === 0 ? 'initial_legacy_no_previous_version' : 'delta_projection',
      },
    });

    latestChangedFiles = changedFiles(record.result, latestChangedFiles);
    if (record.result.review) {
      previousFailedRows = failedRows(record.result.review, requiredRows);
      points = improvementPoints(record.result.review);
      reviewHistoryRefs = reviewHistoryRefs.concat(refFor(record.resultFile, 'review_history_result_redacted'));
    }
  });

  const validationSamplesMs = [];
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const started = process.hrtime.bigint();
    for (const ref of validationRefs) {
      const checked = ReviewDeltaContext.validateArtifactRef(ref, { workspaceRoot: WORKSPACE_ROOT, projectRoot: PROJECT_ROOT });
      if (!checked.ok) throw new Error(`shadow ref preflight failed: ${checked.reason}`);
    }
    validationSamplesMs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }

  const reviewRecords = taskRecords.filter(record => record.node === 'review');
  const legacyReviewRows = reviewRecords.reduce((sum, record) => {
    const table = record.result.review && record.result.review.verification && record.result.review.verification.acceptance_table;
    return sum + (Array.isArray(table) ? table.length : 0);
  }, 0);
  const requiredReviewRows = reviewRecords.length * requiredRows.length;
  const legacyBytes = perNode.reduce((sum, item) => sum + item.legacy.prompt_bytes_observed, 0);
  const projectedBytes = perNode.reduce((sum, item) => sum + item.shadow_delta.prompt_bytes_projected, 0);
  const legacyTokens = perNode.reduce((sum, item) => sum + item.legacy.input_token_proxy, 0);
  const projectedTokens = perNode.reduce((sum, item) => sum + item.shadow_delta.input_token_proxy, 0);
  const observedPasses = reviewRecords.filter(record => record.result.review && record.result.review.pass === true).length;
  const report = {
    schema: 'console-review-delta-shadow-report@1',
    generated_at: new Date().toISOString(),
    task_id: taskId,
    source_run: rel(runRoot),
    mode: 'offline_same_task_shadow_projection',
    feature_activation: 'disabled_pending_owner_approval',
    methodology: {
      input: 'Only historical *.redacted.md and interaction-trace.json artifacts were read.',
      immutable_goal: 'goal_sha256 is computed from the exact goal block in the first task.redacted.md; unredacted task.md is never read.',
      token_estimator: 'ceil(UTF-8 bytes / 4), a deterministic local proxy applied identically to both arms.',
      delta_projection: 'Replace only the prior-result prompt line with the specified delta object and add immutable goal hash; first node remains legacy because no prior version exists.',
      latency: 'Legacy model latency is observed. Shadow model latency was not rerun while the flag is disabled; only local hashed-ref preflight overhead is measured.',
      behavioral_metrics: 'Review round count, pass outcomes and row coverage are held from the same historical run; no behavioral improvement is claimed.',
    },
    comparison: {
      same_task: true,
      input: {
        legacy_prompt_bytes_observed: legacyBytes,
        shadow_prompt_bytes_projected: projectedBytes,
        byte_reduction: legacyBytes - projectedBytes,
        byte_reduction_ratio: Number(((legacyBytes - projectedBytes) / legacyBytes).toFixed(6)),
        legacy_input_token_proxy: legacyTokens,
        shadow_input_token_proxy: projectedTokens,
        token_proxy_reduction: legacyTokens - projectedTokens,
        token_proxy_reduction_ratio: Number(((legacyTokens - projectedTokens) / legacyTokens).toFixed(6)),
      },
      latency: {
        legacy_model_latency_ms_observed_total: perNode.reduce((sum, item) => sum + item.legacy.latency_ms_observed, 0),
        shadow_model_latency_ms: null,
        shadow_model_latency_status: 'not_measured_flag_disabled',
        delta_preflight_samples: validationSamplesMs.length,
        delta_preflight_ms_p50: Number(percentile(validationSamplesMs, 0.5).toFixed(6)),
        delta_preflight_ms_p95: Number(percentile(validationSamplesMs, 0.95).toFixed(6)),
      },
      review_rounds: {
        legacy_observed: reviewRecords.length,
        shadow_held_constant: reviewRecords.length,
      },
      pass_rate: {
        legacy_observed: reviewRecords.length ? observedPasses / reviewRecords.length : 0,
        shadow_held_constant: reviewRecords.length ? observedPasses / reviewRecords.length : 0,
      },
      required_row_coverage: {
        required_rows_per_review: requiredRows.length,
        legacy_rows_observed: legacyReviewRows,
        legacy_rows_expected: requiredReviewRows,
        legacy_ratio: requiredReviewRows ? legacyReviewRows / requiredReviewRows : 1,
        shadow_rows_projected: requiredReviewRows,
        shadow_rows_expected: requiredReviewRows,
        shadow_ratio: 1,
        passed_rows_retained_for_regression_review: true,
      },
    },
    per_node: perNode,
    conclusion: {
      context_overhead_lower: projectedBytes < legacyBytes && projectedTokens < legacyTokens,
      required_row_coverage_not_lower: requiredReviewRows === legacyReviewRows,
      review_outcome_not_regressed_in_shadow_model: 'held_constant_not_reexecuted',
      promotion_recommendation: 'keep disabled until supervisor review and explicit owner approval; then run a live canary for end-to-end latency and outcome comparison',
    },
  };
  atomicWrite(output, report);
  process.stdout.write(`${JSON.stringify({
    pass: report.conclusion.context_overhead_lower && report.conclusion.required_row_coverage_not_lower,
    output: rel(output),
    byte_reduction_ratio: report.comparison.input.byte_reduction_ratio,
    token_proxy_reduction_ratio: report.comparison.input.token_proxy_reduction_ratio,
    coverage: report.comparison.required_row_coverage.shadow_ratio,
    preflight_p95_ms: report.comparison.latency.delta_preflight_ms_p95,
  })}\n`);
}

main();
