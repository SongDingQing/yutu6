#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GatePolicy = require('../../../shared/engine/gate-policy');
const CliRunner = require('../../../shared/engine/cli-runner');
const TestRunner = require('../../../tests/run');

const ROOT = path.resolve(__dirname, '../../..');
const PROJECT = path.join(ROOT, 'projects/控制台');
const ARTIFACTS = process.env.CONSOLE_ARTIFACTS_DIR || path.join(PROJECT, 'artifacts');
const EVENTS = path.join(ARTIFACTS, 'engine-events.jsonl');
const RUNS = path.join(ARTIFACTS, 'engine-runs');
const PROMPT_BASELINE = Object.freeze({
  captured_at: '2026-07-16T07:55:00.000Z',
  non_visual_estimated_input_tokens: 1771,
  note: 'Pre-compaction implement+review contract audit on the same synthetic non-visual task.',
});

function walk(dir, name, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, name, out);
    else if (entry.name === name) out.push(file);
  }
  return out;
}

function scanResults() {
  const files = walk(RUNS, 'result.md');
  let chars = 0;
  let fullSuiteFiles = 0;
  let fullSuiteMentions = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    chars += text.length;
    const matches = text.match(/node tests\/run\.js(?!\s+--profile)/g) || [];
    if (matches.length) fullSuiteFiles++;
    fullSuiteMentions += matches.length;
  }
  return {
    result_files: files.length,
    total_chars: chars,
    average_chars: files.length ? Math.round(chars / files.length) : 0,
    files_with_unscoped_full_suite: fullSuiteFiles,
    unscoped_full_suite_mentions: fullSuiteMentions,
  };
}

async function scanEvents() {
  const hooks = {};
  const doneGateBlocks = {};
  const loops = { iterates: 0, converged: 0, skipped: 0, extra_model_nodes_estimate: 0 };
  const modelUsage = { samples: 0, reported_tokens: 0, max_tokens: 0, max_task: null, max_node: null };
  const tokenSamples = new Set();
  const tokenValues = [];
  let dedicatedIncidents = 0;
  if (!fs.existsSync(EVENTS)) {
    return {
      hooks,
      done_gate_blocks: doneGateBlocks,
      dedicated_incidents: 0,
      loops,
      model_usage: modelUsage,
    };
  }
  const input = fs.createReadStream(EVENTS, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch (_) { continue; }
    if (event.type === 'hook.executed') {
      const stat = hooks[event.hookId] || {
        runs: 0,
        observed_failures: 0,
        effective_failures: 0,
        total_ms: 0,
        max_ms: 0,
        last_at: null,
      };
      stat.runs++;
      if (event.observedOk === false || (event.observedOk == null && event.ok === false)) stat.observed_failures++;
      if (event.ok === false) stat.effective_failures++;
      stat.total_ms += Number(event.elapsedMs || 0);
      stat.max_ms = Math.max(stat.max_ms, Number(event.elapsedMs || 0));
      stat.last_at = event.ts || stat.last_at;
      hooks[event.hookId] = stat;
    } else if (event.type === 'done_gate.blocked') {
      const reason = String(event.reason || 'unknown').replace(/: .*/, ': *').slice(0, 180);
      doneGateBlocks[reason] = (doneGateBlocks[reason] || 0) + 1;
    } else if (event.type === 'gate.incident') {
      dedicatedIncidents++;
    } else if (event.type === 'loop.iterate') {
      loops.iterates++;
    } else if (event.type === 'loop.converged') {
      loops.converged++;
    } else if (event.type === 'loop.skipped') {
      loops.skipped++;
    } else if (event.type === 'node.output') {
      const match = String(event.text || '').match(/\btokens used\s+([\d,]+)/i);
      const sampleKey = `${event.task || ''}:${event.node || ''}:${event.attempt || ''}`;
      if (match && !tokenSamples.has(sampleKey)) {
        tokenSamples.add(sampleKey);
        const tokens = Number(match[1].replace(/,/g, '')) || 0;
        modelUsage.samples++;
        modelUsage.reported_tokens += tokens;
        tokenValues.push({
          tokens,
          task: event.task || null,
          node: event.node || null,
          at: event.ts || null,
        });
        if (tokens > modelUsage.max_tokens) {
          modelUsage.max_tokens = tokens;
          modelUsage.max_task = event.task || null;
          modelUsage.max_node = event.node || null;
        }
      }
    }
  }
  loops.extra_model_nodes_estimate = loops.iterates * 2;
  tokenValues.sort((a, b) => a.tokens - b.tokens);
  const percentile = p => tokenValues.length
    ? tokenValues[Math.min(tokenValues.length - 1, Math.floor((tokenValues.length - 1) * p))].tokens
    : 0;
  modelUsage.average_tokens = modelUsage.samples
    ? Math.round(modelUsage.reported_tokens / modelUsage.samples)
    : 0;
  modelUsage.median_tokens = percentile(0.5);
  modelUsage.p95_tokens = percentile(0.95);
  modelUsage.over_100k = tokenValues.filter(item => item.tokens >= 100000).length;
  modelUsage.top = tokenValues.slice().sort((a, b) => b.tokens - a.tokens).slice(0, 5);
  for (const stat of Object.values(hooks)) {
    stat.average_ms = stat.runs ? Number((stat.total_ms / stat.runs).toFixed(2)) : 0;
  }
  return {
    hooks,
    done_gate_blocks: doneGateBlocks,
    dedicated_incidents: dedicatedIncidents,
    loops,
    model_usage: modelUsage,
  };
}

function promptMetrics() {
  const base = {
    taskId: 'audit-task',
    spec_fingerprint: 'audit-fingerprint',
    projectId: '控制台',
    goal: '修复一个非视觉 Node.js 边界问题',
    acceptance: '修复根因并运行相关专项测试',
    bounds: '只处理本任务; 密钥不回显',
    inputs: [],
    visual_acceptance: {
      schema: 'visual-acceptance@1',
      required: false,
      state: 'not_applicable',
      source: 'task_type',
    },
  };
  const implement = CliRunner.buildEnvelope({ id: 'implement', agent_role: 'worker_code' }, base);
  const review = CliRunner.buildEnvelope({ id: 'review', agent_role: 'supervisor' }, base);
  const estimated = Math.round((implement.length + review.length) / 4);
  return {
    non_visual_implement_chars: implement.length,
    non_visual_review_chars: review.length,
    estimated_input_tokens: estimated,
    baseline: PROMPT_BASELINE,
    reduction_tokens: PROMPT_BASELINE.non_visual_estimated_input_tokens - estimated,
    reduction_percent: Number(
      ((1 - estimated / PROMPT_BASELINE.non_visual_estimated_input_tokens) * 100).toFixed(1),
    ),
  };
}

function profileMetrics() {
  const profiles = TestRunner.readProfiles();
  const smoke = TestRunner.profileTests('smoke', profiles);
  const lean = TestRunner.profileTests('lean', profiles);
  return {
    full_files: TestRunner.allTests.length,
    routine_profile: profiles.routine_profile || 'smoke',
    smoke_files: smoke.length,
    lean_files: lean.length,
    dormant_for_routine: TestRunner.allTests.length - smoke.length,
    routine_reduction_percent: Number(((1 - smoke.length / TestRunner.allTests.length) * 100).toFixed(1)),
    smoke,
    lean,
  };
}

function policyMetrics(policy) {
  const entries = Object.entries(policy.gates || {});
  return {
    active: entries.filter(([, gate]) => gate.mode === 'active').map(([id]) => id),
    shadow: entries.filter(([, gate]) => gate.mode === 'shadow').map(([id]) => id),
    dormant: entries.filter(([, gate]) => gate.mode === 'dormant').map(([id]) => id),
    duplicates_dormant: entries
      .filter(([, gate]) => gate.mode === 'dormant' && gate.duplicate_of)
      .map(([id, gate]) => ({ id, duplicate_of: gate.duplicate_of })),
  };
}

function markdown(report) {
  const lines = [
    '# 玉兔6 回归门负载审计',
    '',
    `- generated_at: ${report.generated_at}`,
    `- policy: ${report.policy_file}`,
    `- 主门 active: ${report.policy.active.join(', ') || '(无)'}`,
    `- 重复门 dormant: ${report.policy.duplicates_dormant.map(item => `${item.id} -> ${item.duplicate_of}`).join('; ') || '(无)'}`,
    '',
    '## 回归负载',
    '',
    `- full: ${report.tests.full_files} 个测试文件`,
    `- smoke: ${report.tests.smoke_files} 个测试文件`,
    `- lean: ${report.tests.lean_files} 个测试文件`,
    `- 例行休眠: ${report.tests.dormant_for_routine} 个`,
    `- 例行文件数减少: ${report.tests.routine_reduction_percent}%`,
    '',
    '## 历史信号',
    '',
    `- result.md: ${report.results.result_files} 份`,
    `- 未分档 \`node tests/run.js\` 提及: ${report.results.unscoped_full_suite_mentions} 次 / ${report.results.files_with_unscoped_full_suite} 份文件`,
    `- 平均 result.md 字符: ${report.results.average_chars}`,
    `- 当前非视觉 implement+review 合同估算输入: ${report.prompts.estimated_input_tokens} tokens`,
    `- 合同基线 ${report.prompts.baseline.non_visual_estimated_input_tokens} tokens → 当前减少 ${report.prompts.reduction_tokens} tokens (${report.prompts.reduction_percent}%)`,
    `- 历史 loop 额外迭代: ${report.events.loops.iterates} 次，约增加 ${report.events.loops.extra_model_nodes_estimate} 个模型节点`,
    `- 可解析 token 样本: ${report.events.model_usage.samples} 个，累计 ${report.events.model_usage.reported_tokens}；最大单节点 ${report.events.model_usage.max_tokens} (${report.events.model_usage.max_task || '-'} / ${report.events.model_usage.max_node || '-'})`,
    `- token 分布: 平均 ${report.events.model_usage.average_tokens}，中位 ${report.events.model_usage.median_tokens}，P95 ${report.events.model_usage.p95_tokens}，>=100k 共 ${report.events.model_usage.over_100k} 个`,
    '',
    '## Hook 观测',
    '',
    '| Hook | Runs | Observed Fail | Avg ms | Max ms |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(report.events.hooks)
      .sort((a, b) => b[1].total_ms - a[1].total_ms)
      .map(([id, stat]) => `| ${id} | ${stat.runs} | ${stat.observed_failures} | ${stat.average_ms} | ${stat.max_ms} |`),
    '',
    '## 策略结论',
    '',
    '1. 主 DoneGate 保持 active；完成真实性、规格指纹、密钥卫生和队列恢复不休眠。',
    '2. 已被主 DoneGate 覆盖的协议、硬回归和 loop convergence hook 休眠，避免重复校验。',
    '3. 普通任务运行专项测试或 smoke；核心控制面改动运行 lean；full 仅用于跨引擎、发布、基线刷新与人工全检。',
    '4. 新 gate 若无 incident_refs，不允许以 active+block 注册；shadow 失败自动写 gate.incident。',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const policy = GatePolicy.loadPolicy(ROOT);
  const validation = GatePolicy.validatePolicy(policy, {
    workspaceRoot: ROOT,
    requireExistingRefs: true,
  });
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  const report = {
    schema: 'yutu6-gate-load-audit@1',
    generated_at: new Date().toISOString(),
    policy_file: path.relative(ROOT, policy._file),
    policy: policyMetrics(policy),
    tests: profileMetrics(),
    results: scanResults(),
    prompts: promptMetrics(),
    events: await scanEvents(),
  };
  const dir = path.join(ARTIFACTS, 'gate-load-audit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'latest.md'), `${markdown(report)}\n`);
  console.log(JSON.stringify({
    ok: true,
    json: path.relative(ROOT, path.join(dir, 'latest.json')),
    markdown: path.relative(ROOT, path.join(dir, 'latest.md')),
    smoke: report.tests.smoke_files,
    lean: report.tests.lean_files,
    full: report.tests.full_files,
    reductionPercent: report.tests.routine_reduction_percent,
  }));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
