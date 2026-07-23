#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Audit = require('../../../shared/engine/quality-ops-audit');
const InteractionTrace = require('../../../shared/engine/interaction-trace');
const QualityProposalTriage = require('./quality-proposal-triage');
const Q = require('../../../shared/engine/queue');
const ProcessReceiptHook = require('../process-receipt-hook');
const ChainTerminal = require('../quality-ops-chain-terminal');

const CONSOLE_ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(CONSOLE_ROOT, '../..');
const ARTIFACTS = process.env.CONSOLE_ARTIFACTS_DIR
  ? path.resolve(process.env.CONSOLE_ARTIFACTS_DIR)
  : path.join(CONSOLE_ROOT, 'artifacts');
const QOPS_ROOT = path.join(ARTIFACTS, 'quality-ops');
const TRACE_INDEX = path.join(QOPS_ROOT, 'traces', 'index.jsonl');
const POLICY_FILE = path.join(QOPS_ROOT, 'policy.json');
const REVIEW_LEDGER = path.join(QOPS_ROOT, 'review-ledger.json');
const PROPOSAL_LEDGER = path.join(QOPS_ROOT, 'proposal-ledger.json');
const AUDITS_ROOT = path.join(QOPS_ROOT, 'audits');
const SECRETARY_TOOLS = path.join(CONSOLE_ROOT, 'secretary-tools.js');
const REPORT_SCRIPT = path.join(__dirname, 'quality-ops-weekly-report.py');
const DEFAULT_REPORT_DIR = path.join('/Users/yutu6/Documents', '玉兔质量运营报告');

function engineEventFiles() {
  let names = [];
  try { names = fs.readdirSync(ARTIFACTS); } catch (_) {}
  return names
    .filter(name => /^engine-events(?:\..+)?\.jsonl$/.test(name))
    .map(name => path.join(ARTIFACTS, name));
}

function interactionChains() {
  return ChainTerminal.buildChains(
    Audit.readJsonLines(TRACE_INDEX),
    ChainTerminal.readTerminalEvents(engineEventFiles(), { baseDir: WORKDIR }),
  );
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function safeDate(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function relative(file) {
  const rel = path.relative(WORKDIR, file);
  return rel && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    ? rel.split(path.sep).join('/')
    : file;
}

function alreadyQueued(agent, id) {
  const dir = Q.qdir(ARTIFACTS, agent);
  for (const sub of ['', 'running', 'paused', 'done', 'failed', 'canceled']) {
    const folder = path.join(dir, sub);
    let names = [];
    try { names = fs.readdirSync(folder); } catch (_) {}
    if (names.some(name => name === `${id}.json` || name.endsWith(`-${id}.json`))) return sub || 'queued';
  }
  return null;
}

function batchTask(plan, batch, batchFile, findingsFile) {
  const resultFile = path.join(path.dirname(batchFile), 'results', `${batch.batch_id}.json`);
  return {
    role: 'quality_ops',
    flowId: 'agent-once',
    projectId: '控制台',
    scopedToProject: true,
    title: `质量运营链路抽查 ${plan.audit_id} ${batch.batch_id}`,
    idem: `quality-ops-trace-audit:${plan.audit_id}:${batch.batch_id}`,
    useOrchestrator: false,
    autoApproveHuman: true,
    nodeTimeoutSec: 1800,
    bounds: '只读脱敏 trace 与事件/交接证据;不得读取或回显密钥;不保存隐藏思维链;不得自动启用公告板卡;不直接修改生产代码。',
    acceptance: [
      `逐条覆盖 ${batch.chains.length} 条计划链路,每条含 chain_summary、verdict、evidence_refs。`,
      '顺藤摸瓜核对 prompt→交接角色/runner→实际输出/工具证据→终态,不能只看 result 自述。',
      `结果按 ${Audit.FINDINGS_SCHEMA} 写 ${relative(findingsFile)}。`,
      `运行 node projects/控制台/tools/quality-ops-audit.js ingest --batch-file ${relative(batchFile)} --findings-file ${relative(findingsFile)}；成功后 ${relative(resultFile)} 必须存在，获批启用后还必须返回独立 receipt 路径。`,
      '重复模式、可沉淀 skill/hook/script/知识与职责边界问题均转成 owner_decision proposals；只创建 todo 待拍板卡。',
    ].join('\n'),
    goal: [
      '你是质量运营官，要求带着挑错意识做完整交互链路审计。',
      `先读 .agents/skills/quality-ops-chain-audit/SKILL.md，再读审计批次 ${relative(batchFile)}。`,
      '只读每条 trace_refs 指向的 interaction-trace.json、task.redacted.md、result.redacted.md、process-summary.redacted.log 与 process-summary.contract.redacted.json；v2 合同 unavailable 时不得猜测缺失动作，必要时按 root_task_id 查 engine-events 和 handoff meta 补齐谁派给谁、prompt、期望、实际返回、证据和终态。',
      '不要把模型隐藏思维链当作可采集数据；保存的是显式 prompt、输出、工具/文件证据和你的核实摘要。',
      '逐条找需求在交接中是否漏传、重复推理、无效上下文、职责越界、长期闲置线路、可脚本化/可技能化/可 hook 化模式。证据不足必须写 warning/fail，不能猜。',
      'audit-gate 硬规则：任一 trace 带 observability_warning 时，该 chain 的 verdict 禁止填 pass；必须填 warning/fail，且不能由 done-gate、其他 warning 或结果自述覆盖。',
      '输出 JSON 示例字段:',
      `{"schema":"${Audit.FINDINGS_SCHEMA}","audit_id":"${plan.audit_id}","batch_id":"${batch.batch_id}","chain_reviews":[{"chain_id":"...","chain_summary":"...","verdict":"pass|warning|fail","evidence_refs":["..."],"findings":["..."]}],"proposals":[{"title":"...","desc":"...","category":"script|skill|hook|process|prompt|role_boundary|test|knowledge","benefit":"...","risk":"...","project":"控制台","evidence_refs":["..."]}]}`,
      `把 JSON 写入 ${relative(findingsFile)}，然后执行 ingest 命令。不要直接编辑 cards.json。`,
    ].join('\n\n'),
  };
}

function decoratePlanTerminalFields(plan) {
  for (const batch of plan && plan.batches || []) {
    for (const chain of batch.chains || []) {
      const terminal = chain.terminal || {};
      chain.final_state = terminal.final_state || 'unknown';
      chain.final_state_source = Array.isArray(terminal.final_state_source)
        ? terminal.final_state_source
        : [];
      chain.unknown_reason = terminal.unknown_reason || null;
    }
  }
  return plan;
}

function schedule(args = {}) {
  const now = args.now ? new Date(args.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('bad --now');
  const policy = Audit.ensurePolicy(POLICY_FILE, now);
  const chains = interactionChains();
  const ledger = Audit.normalizeLedger(Audit.readJson(REVIEW_LEDGER, null));
  const selection = Audit.selectChains({ chains, ledger, policy, now, seed: args.seed });
  const date = safeDate(now);
  const auditId = args.auditId || `qops-${date.replace(/-/g, '')}-${selection.strategy}`;
  const auditDir = path.join(AUDITS_ROOT, date, auditId);
  const planFile = path.join(auditDir, 'plan.json');
  const existing = Audit.readJson(planFile, null);
  if (existing && !args.force) {
    const receipt = recordQualityOpsReceipt('quality_ops_schedule', {
      actionId: `${existing.audit_id || auditId}:already-planned`,
      taskId: args.taskId || `quality-ops-${existing.audit_id || auditId}`,
      exitCode: 0,
      finalState: 'completed',
      affectedFiles: [],
      evidenceRefs: [relative(planFile)],
    });
    return Object.assign(
      { ok: true, action: 'already-planned', plan: relative(planFile), selected: existing.selected_count, strategy: existing.strategy },
      receiptResultFields(receipt),
    );
  }
  const batchSize = selection.strategy === 'first_week_full'
    ? policy.first_week_batch_size
    : policy.steady_sample_size;
  const plan = decoratePlanTerminalFields(Audit.makePlan(selection, { now, date, auditId, batchSize }));
  fs.mkdirSync(auditDir, { recursive: true });
  const enqueued = [];
  for (const batch of plan.batches) {
    const batchFile = path.join(auditDir, `${batch.batch_id}.json`);
    const findingsFile = path.join(auditDir, 'drafts', `${batch.batch_id}.json`);
    Audit.atomicWriteJson(batchFile, {
      schema: Audit.PLAN_SCHEMA,
      audit_id: plan.audit_id,
      plan_path: relative(planFile),
      strategy: plan.strategy,
      batch_id: batch.batch_id,
      chains: batch.chains,
      constraints: plan.constraints,
    });
    const queueId = `qops-${date.replace(/-/g, '')}-${batch.batch_id}`;
    const existingState = alreadyQueued('quality_ops', queueId);
    if (existingState) {
      enqueued.push({ batch_id: batch.batch_id, queue_id: queueId, action: 'skipped', state: existingState });
      continue;
    }
    const entry = Q.enqueue(ARTIFACTS, 'quality_ops', batchTask(plan, batch, batchFile, findingsFile), {
      id: queueId,
      priority: 32,
      idem: `quality-ops-trace-audit:${plan.audit_id}:${batch.batch_id}`,
    });
    enqueued.push({ batch_id: batch.batch_id, queue_id: entry.id, action: 'enqueued', count: batch.chains.length });
  }
  plan.enqueued = enqueued;
  plan.policy_path = relative(POLICY_FILE);
  plan.review_ledger_path = relative(REVIEW_LEDGER);
  Audit.atomicWriteJson(planFile, plan);
  Audit.atomicWriteJson(REVIEW_LEDGER, Audit.reservePlan(ledger, plan, now));
  const receipt = recordQualityOpsReceipt('quality_ops_schedule', {
    actionId: plan.audit_id,
    taskId: args.taskId || `quality-ops-${plan.audit_id}`,
    exitCode: 0,
    finalState: 'completed',
    affectedFiles: [relative(planFile), relative(REVIEW_LEDGER)].concat(plan.batches.map(batch => relative(path.join(auditDir, `${batch.batch_id}.json`)))),
    evidenceRefs: [relative(planFile), relative(REVIEW_LEDGER)],
  });
  return Object.assign({
    ok: true,
    action: plan.selected_count ? 'scheduled' : 'no-new-chains',
    strategy: plan.strategy,
    candidates: plan.candidate_count,
    selected: plan.selected_count,
    batches: plan.batches.length,
    plan: relative(planFile),
    enqueued,
  }, receiptResultFields(receipt));
}

function sanitizeObject(value) {
  if (typeof value === 'string') return InteractionTrace.redact(value);
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeObject(item);
    return out;
  }
  return value;
}

function proposalLedger() {
  const raw = Audit.readJson(PROPOSAL_LEDGER, null);
  return raw && Array.isArray(raw.proposals)
    ? raw
    : { schema: 'yutu6-quality-ops-proposal-ledger@1', updated_at: null, proposals: [] };
}

function addBulletin(proposal, fingerprint) {
  const id = `qops-${fingerprint.slice(0, 16)}`;
  const evidence = (proposal.evidence_refs || []).map(String).slice(0, 8);
  const desc = [
    `类别:${proposal.category || 'process'}`,
    proposal.desc ? `问题:${proposal.desc}` : null,
    proposal.benefit ? `预期收益:${proposal.benefit}` : null,
    proposal.risk ? `风险/争议:${proposal.risk}` : '风险/争议:待主人拍板后再评估执行',
    evidence.length ? `证据:${evidence.join('；')}` : null,
    '状态:仅待拍板，未自动启用。',
  ].filter(Boolean).join('\n');
  const child = spawnSync(process.execPath, [
    SECRETARY_TOOLS,
    'bulletin-add',
    '--id', id,
    '--title', String(proposal.title || '').slice(0, 120),
    '--desc', desc.slice(0, 1150),
    '--target', 'ceo',
    '--project', String(proposal.project || '控制台').slice(0, 80),
    '--source', '质量运营',
  ], { cwd: WORKDIR, encoding: 'utf8', timeout: 30000 });
  if (child.status !== 0) {
    const message = InteractionTrace.redact(child.stderr || child.stdout || 'bulletin-add failed');
    if (/bulletin id exists/i.test(message)) return { id, action: 'existing' };
    throw new Error(`bulletin-add failed: ${message.slice(0, 500)}`);
  }
  let card = null;
  try { card = JSON.parse(child.stdout).card; } catch (_) {}
  if (!card || card.status !== 'todo') throw new Error(`quality proposal ${id} was not persisted as todo`);
  return { id, action: 'created' };
}

function proposalDecision(proposal, fingerprint) {
  const text = [
    proposal && proposal.title,
    proposal && proposal.desc,
    proposal && proposal.risk,
  ].filter(Boolean).join('\n');
  const securityOrExternalSideEffect = /密钥|token|私钥|cookie|凭据|认证|授权|权限|删除|上传|外部推送|外部发布|模型发布|github 发布|不可逆/i.test(text);
  if (securityOrExternalSideEffect) {
    return {
      disposition: 'foundational_policy',
      requires_owner_decision: true,
      reason: '信息安全、权限边界或外部副作用必须给主人明确决策。',
      theme: QualityProposalTriage.canonicalTheme(proposal),
    };
  }
  const decision = QualityProposalTriage.dispositionFor({
    id: `qops-${String(fingerprint || '').slice(0, 16)}`,
    title: proposal && proposal.title,
    desc: proposal && proposal.desc,
  });
  return {
    disposition: decision.disposition === 'foundational_policy'
      ? 'dormant_candidate'
      : decision.disposition,
    requires_owner_decision: false,
    reason: decision.reason,
    theme: QualityProposalTriage.canonicalTheme(proposal),
  };
}

function recordQualityOpsReceipt(actionName, input = {}, runtime = {}) {
  return ProcessReceiptHook.writeCriticalActionReceipt({
    workspaceRoot: WORKDIR,
    receiptsRoot: runtime.receiptsRoot || path.join(QOPS_ROOT, 'receipts'),
    config: runtime.config,
    activation: runtime.activation,
    actionName,
    actionKind: 'tool',
    actionId: input.actionId,
    taskId: input.taskId,
    exitCode: input.exitCode,
    finalState: input.finalState,
    affectedFiles: input.affectedFiles,
    evidenceRefs: input.evidenceRefs,
  });
}

function recordIngestReceipt(input = {}, runtime = {}) {
  return recordQualityOpsReceipt('quality_ops_ingest', input, runtime);
}

function receiptResultFields(receipt) {
  return {
    receipt: receipt && receipt.file ? relative(receipt.file) : null,
    receipt_status: receipt && receipt.active ? 'recorded' : 'disabled',
    receipt_reason: receipt && receipt.reason || 'receipt_writer_unavailable',
  };
}

function ingest(args = {}) {
  if (!args.batchFile || !args.findingsFile) throw new Error('ingest requires --batch-file and --findings-file');
  const batchFile = path.resolve(WORKDIR, args.batchFile);
  const findingsFile = path.resolve(WORKDIR, args.findingsFile);
  const batchDoc = Audit.readJson(batchFile, null);
  const findingsRaw = Audit.readJson(findingsFile, null);
  if (!batchDoc || batchDoc.schema !== Audit.PLAN_SCHEMA) throw new Error('invalid batch file');
  if (!findingsRaw) throw new Error('findings file missing or invalid JSON');
  const planFile = path.resolve(WORKDIR, batchDoc.plan_path);
  const plan = Audit.readJson(planFile, null);
  if (!plan || plan.audit_id !== batchDoc.audit_id) throw new Error('plan mismatch');
  const batch = (plan.batches || []).find(x => x.batch_id === batchDoc.batch_id);
  if (!batch) throw new Error('batch not found in plan');
  const findings = sanitizeObject(findingsRaw);
  if (findings.audit_id !== plan.audit_id || findings.batch_id !== batch.batch_id) throw new Error('findings audit/batch mismatch');
  Audit.validateFindings(batch, findings);

  const proposals = proposalLedger();
  const known = new Set(proposals.proposals.map(x => x.fingerprint));
  const bulletin = [];
  const allowedCategories = new Set(['script', 'skill', 'hook', 'process', 'prompt', 'role_boundary', 'test', 'knowledge']);
  for (const proposal of Array.isArray(findings.proposals) ? findings.proposals : []) {
    if (!String(proposal.title || '').trim()) throw new Error('proposal title missing');
    if (!allowedCategories.has(String(proposal.category || ''))) throw new Error(`proposal category not allowed: ${proposal.category}`);
    if (!Array.isArray(proposal.evidence_refs) || !proposal.evidence_refs.filter(Boolean).length) throw new Error(`proposal evidence missing: ${proposal.title}`);
    const fingerprint = Audit.proposalFingerprint(proposal);
    if (known.has(fingerprint)) {
      bulletin.push({ fingerprint, action: 'deduplicated' });
      continue;
    }
    const decision = proposalDecision(proposal, fingerprint);
    const created = decision.requires_owner_decision
      ? addBulletin(proposal, fingerprint)
      : { id: null, action: 'recorded_without_bulletin' };
    proposals.proposals.push({
      fingerprint,
      audit_id: plan.audit_id,
      batch_id: batch.batch_id,
      title: proposal.title,
      category: proposal.category,
      evidence_refs: proposal.evidence_refs,
      bulletin_id: created.id,
      created_at: new Date().toISOString(),
      status: decision.requires_owner_decision ? 'todo_owner_decision' : decision.disposition,
      governance_decision: decision,
    });
    known.add(fingerprint);
    bulletin.push({ fingerprint, ...created });
  }
  proposals.updated_at = new Date().toISOString();
  Audit.atomicWriteJson(PROPOSAL_LEDGER, proposals);

  const resultDir = path.join(path.dirname(planFile), 'results');
  const resultFile = path.join(resultDir, `${batch.batch_id}.json`);
  const result = Object.assign({}, findings, {
    ingested_at: new Date().toISOString(),
    bulletin,
    hidden_chain_of_thought_saved: false,
  });
  Audit.atomicWriteJson(resultFile, result);
  const ledger = Audit.completeBatch(Audit.readJson(REVIEW_LEDGER, null), plan, batch, findings, new Date());
  Audit.atomicWriteJson(REVIEW_LEDGER, ledger);
  const receipt = recordIngestReceipt({
    actionId: `${plan.audit_id}:${batch.batch_id}`,
    taskId: args.taskId || `quality-ops-${plan.audit_id}-${batch.batch_id}`,
    exitCode: 0,
    finalState: 'completed',
    affectedFiles: [relative(resultFile), relative(REVIEW_LEDGER), relative(PROPOSAL_LEDGER)],
    evidenceRefs: [relative(batchFile), relative(findingsFile), relative(resultFile)],
  });
  return Object.assign({
    ok: true,
    audit_id: plan.audit_id,
    batch_id: batch.batch_id,
    reviewed: findings.chain_reviews.length,
    proposals: bulletin,
    result: relative(resultFile),
  }, receiptResultFields(receipt));
}

function pythonBinary() {
  const candidates = [
    process.env.YUTU6_PYTHON,
    '/Users/yutu6/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
    'python3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'python3' || fs.existsSync(candidate)) return candidate;
  }
  return 'python3';
}

function weekly(args = {}) {
  const reportDir = path.resolve(args.outputDir || DEFAULT_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });
  const argv = [REPORT_SCRIPT, '--artifacts', ARTIFACTS, '--output-dir', reportDir];
  if (args.endDate) argv.push('--end-date', args.endDate);
  const child = spawnSync(pythonBinary(), argv, {
    cwd: WORKDIR,
    encoding: 'utf8',
    timeout: 120000,
    env: Object.assign({}, process.env),
  });
  if (child.status !== 0) throw new Error(`weekly report failed: ${InteractionTrace.redact(child.stderr || child.stdout).slice(0, 1000)}`);
  let result;
  try { result = JSON.parse(child.stdout.trim().split(/\r?\n/).pop()); }
  catch (_) { throw new Error(`weekly report returned invalid JSON: ${child.stdout.slice(-500)}`); }
  const receipt = recordQualityOpsReceipt('quality_ops_weekly', {
    actionId: args.endDate || safeDate(new Date()),
    taskId: args.taskId || `quality-ops-weekly-${args.endDate || safeDate(new Date())}`,
    exitCode: 0,
    finalState: 'completed',
    affectedFiles: Object.values(result || {}).filter(value => typeof value === 'string').map(relative),
    evidenceRefs: [relative(POLICY_FILE), relative(REVIEW_LEDGER)],
  });
  return Object.assign({ ok: true }, result, receiptResultFields(receipt));
}

function status() {
  const policy = Audit.readJson(POLICY_FILE, null);
  const ledger = Audit.normalizeLedger(Audit.readJson(REVIEW_LEDGER, null));
  const proposals = proposalLedger();
  const chains = interactionChains();
  const chainStates = chains.reduce((counts, chain) => {
    counts[chain.status] = (counts[chain.status] || 0) + 1;
    return counts;
  }, {});
  return {
    ok: true,
    policy,
    traces: Audit.readJsonLines(TRACE_INDEX).length,
    chains: chains.length,
    chain_states: chainStates,
    reviewed: ledger.reviews.length,
    reserved: ledger.reservations.filter(x => x.status === 'reserved').length,
    proposals: proposals.proposals.length,
    paths: {
      trace_index: relative(TRACE_INDEX),
      review_ledger: relative(REVIEW_LEDGER),
      proposal_ledger: relative(PROPOSAL_LEDGER),
      report_dir: DEFAULT_REPORT_DIR,
    },
  };
}

function main() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let result;
  if (command === 'init') {
    result = { ok: true, policy: Audit.ensurePolicy(POLICY_FILE, args.now ? new Date(args.now) : new Date()), path: relative(POLICY_FILE) };
  } else if (command === 'schedule') result = schedule(args);
  else if (command === 'ingest') result = ingest(args);
  else if (command === 'weekly') result = weekly(args);
  else if (command === 'status') result = status();
  else throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    const [command = 'status', ...rest] = process.argv.slice(2);
    if (['schedule', 'ingest', 'weekly'].includes(command)) {
      try {
        const args = parseArgs(rest);
        const actionName = `quality_ops_${command}`;
        recordQualityOpsReceipt(actionName, {
          actionId: `${args.batchFile || 'unknown'}:${args.findingsFile || 'unknown'}:failed`,
          taskId: args.taskId || `${actionName}-unavailable`,
          exitCode: 1,
          finalState: 'failed',
          affectedFiles: [],
          evidenceRefs: [args.batchFile, args.findingsFile, relative(POLICY_FILE), relative(REVIEW_LEDGER)].filter(Boolean),
        });
      } catch (_) {}
    }
    process.stderr.write(`${InteractionTrace.redact(error && error.message || error)}\n`);
    process.exit(1);
  }
}

module.exports = {
  schedule,
  ingest,
  proposalDecision,
  weekly,
  status,
  batchTask,
  sanitizeObject,
  addBulletin,
  recordQualityOpsReceipt,
  recordIngestReceipt,
  receiptResultFields,
  interactionChains,
  decoratePlanTerminalFields,
  paths: { ARTIFACTS, QOPS_ROOT, TRACE_INDEX, POLICY_FILE, REVIEW_LEDGER, PROPOSAL_LEDGER, AUDITS_ROOT },
};
