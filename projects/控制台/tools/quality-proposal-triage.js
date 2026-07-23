#!/usr/bin/env node
'use strict';

/*
 * Deterministically settles quality-ops proposal cards without spawning models.
 * Cards are archived, never deleted. The original file is backed up before an
 * apply, and every decision remains reversible from cards.json metadata.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '../..');
const DEFAULT_CARDS = path.join(PROJECT_ROOT, 'artifacts', 'bulletin', 'cards.json');
const DEFAULT_EVENTS = path.join(PROJECT_ROOT, 'artifacts', 'engine-events.jsonl');
const DEFAULT_REPORT_ROOT = path.join(PROJECT_ROOT, 'artifacts', 'quality-proposal-triage');
const SOURCE = '质量运营';
const DECISION_SCHEMA = 'yutu6-quality-proposal-decision@1';
const ACTIVE_STATUSES = new Set(['todo', '待拍板']);

const VERIFIED_CURRENT = new Map([
  ['qops-7c661eb85f3cc065', {
    reason: 'memory_officer 已被收窄为只写 memory 资源域，且有专项回归。',
    evidence: ['tests/repair-ticket-bulletin.test.js'],
  }],
]);

const THEME_RULES = [
  ['security-release', /发布|外部推送|github/i],
  ['runner-resilience', /runner|usage-limit|fetch failed|capability probe|健康路由|transport|熔断/i],
  ['visual-classification', /视觉|非视觉|not_applicable/i],
  ['repair-lifecycle', /repair|维修|memory|hard-block|no-op|worker 版本|settlement|关闭票/i],
  ['completion-integrity', /acceptance|验收|done-gate|score=1|result\.done|终态|规格指纹|board_review|review runner|负向返工|评审 provenance/i],
  ['process-contract', /process contract|process-summary|过程合同|receipt|收据|trace|根链|谱系|脱敏/i],
  ['role-boundary', /proposal_only|role|orchestrator|ceo|董事|项目归属|编排层|职责/i],
  ['offline-tooling', /脚本|测试|属性|failpoint|preflight|索引/i],
  ['context-efficiency', /node\.output|commonmark|checkpoint|幂等键|差量|背景引用|重复/i],
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(tmp, file);
}

function dateStamp(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replace(/-/g, '');
}

function canonicalTheme(card) {
  const text = `${card && card.title || ''}\n${card && card.desc || ''}`;
  const hit = THEME_RULES.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : 'governance-other';
}

function dispositionFor(card) {
  const verified = VERIFIED_CURRENT.get(String(card && card.id || ''));
  if (verified) {
    return {
      disposition: 'already_satisfied',
      reason: verified.reason,
      evidence: verified.evidence,
    };
  }
  const title = String(card && card.title || '');
  if (/发布|外部推送/i.test(title)) {
    return {
      disposition: 'foundational_policy',
      reason: '外部副作用仍需主管通过与主人授权；沿用既有安全基线，不新增常驻重门。',
      evidence: ['projects/控制台/config/gate-policy.json'],
    };
  }
  if (/脚本|测试|属性|failpoint|preflight|索引/i.test(title)) {
    return {
      disposition: 'offline_candidate',
      reason: '保留为事故发生后的专项脚本或回归候选，不加入例行任务热路径。',
      evidence: ['tests/regression-profiles.json'],
    };
  }
  return {
    disposition: 'dormant_candidate',
    reason: '当前没有独立事故与最小回归映射，按 owner 策略休眠；真实问题复现后再升 shadow。',
    evidence: ['projects/控制台/config/gate-policy.json'],
  };
}

function buildPlan(cards, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const decisions = [];
  for (const card of cards) {
    if (!card || card.source !== SOURCE || !ACTIVE_STATUSES.has(card.status)) continue;
    const decision = dispositionFor(card);
    decisions.push({
      id: String(card.id || ''),
      title: String(card.title || '').slice(0, 180),
      theme: canonicalTheme(card),
      disposition: decision.disposition,
      reason: decision.reason,
      evidence: decision.evidence,
    });
  }
  decisions.sort((a, b) => a.id.localeCompare(b.id));
  const counts = {};
  const themes = {};
  for (const item of decisions) {
    counts[item.disposition] = (counts[item.disposition] || 0) + 1;
    themes[item.theme] = (themes[item.theme] || 0) + 1;
  }
  return {
    schema: 'yutu6-quality-proposal-triage@1',
    generated_at: now.toISOString(),
    date: dateStamp(now),
    source: SOURCE,
    total: decisions.length,
    counts,
    themes,
    decisions,
  };
}

function reportMarkdown(plan, extra = {}) {
  const lines = [
    `# 质量运营提案轻量清算 · ${plan.date}`,
    '',
    '> 本报告由确定性本地脚本生成，不调用模型。归档不是删除，原卡及完整 payload 仍保留在 cards.json。',
    '',
    '## 结论',
    '',
    `- 清算提案：${plan.total} 张`,
    `- 已由现状满足：${plan.counts.already_satisfied || 0} 张`,
    `- 信息安全/外部副作用沿用既有底线：${plan.counts.foundational_policy || 0} 张`,
    `- 离线脚本/测试候选：${plan.counts.offline_candidate || 0} 张`,
    `- 休眠候选：${plan.counts.dormant_candidate || 0} 张`,
    extra.backup ? `- 原始卡片备份：${extra.backup}` : null,
    '',
    '## 运行策略',
    '',
    '1. 密钥、认证、权限边界和外部副作用授权保持常开，但不得调用模型或网络来完成门禁本身。',
    '2. 其他新门默认 dormant；发生真实事故后，先写最小回归，再 dormant → shadow → active。',
    '3. 重型扫描、全量测试、属性测试和报告脚本只在线下或发布档运行，不进入普通任务热路径。',
    '4. 每个 active blocking gate 必须同时登记 incident_refs 与 regression_tests。',
    '',
    '## 主题汇总',
    '',
    '| 主题 | 数量 |',
    '|---|---:|',
    ...Object.entries(plan.themes).sort((a, b) => b[1] - a[1]).map(([theme, count]) => `| ${theme} | ${count} |`),
    '',
    '## 决策明细',
    '',
    '| ID | 处置 | 主题 | 标题 |',
    '|---|---|---|---|',
    ...plan.decisions.map(item => `| ${item.id} | ${item.disposition} | ${item.theme} | ${item.title.replace(/\|/g, '\\|')} |`),
    '',
  ].filter(line => line != null);
  return `${lines.join('\n')}\n`;
}

function applyPlan(cards, plan, opts = {}) {
  const cardsFile = path.resolve(opts.cardsFile || DEFAULT_CARDS);
  const reportRoot = path.resolve(opts.reportRoot || DEFAULT_REPORT_ROOT);
  const eventsFile = path.resolve(opts.eventsFile || DEFAULT_EVENTS);
  const decisionById = new Map(plan.decisions.map(item => [item.id, item]));
  const timestamp = plan.generated_at.replace(/[-:.TZ]/g, '').slice(0, 14);
  const backup = `${cardsFile}.bak-triage-${timestamp}`;
  fs.copyFileSync(cardsFile, backup, fs.constants.COPYFILE_EXCL);

  const decidedAt = plan.generated_at;
  const next = cards.map(card => {
    const decision = decisionById.get(String(card && card.id || ''));
    if (!decision) return card;
    return Object.assign({}, card, {
      status: 'archived',
      archived_at: decidedAt,
      archivedReason: 'owner-delegated-lightweight-gate-triage',
      governanceDecision: {
        schema: DECISION_SCHEMA,
        decided_at: decidedAt,
        decided_by: 'owner-delegated-codex',
        disposition: decision.disposition,
        canonical_theme: decision.theme,
        reason: decision.reason,
        evidence: decision.evidence,
        activation_path: 'real incident -> minimal regression -> shadow -> active',
      },
    });
  });
  writeJsonAtomic(cardsFile, next);

  const reportDir = path.join(reportRoot, plan.date);
  fs.mkdirSync(reportDir, { recursive: true });
  const backupRel = path.relative(WORKSPACE_ROOT, backup);
  const reportJson = path.join(reportDir, 'report.json');
  const reportMd = path.join(reportDir, 'report.md');
  writeJsonAtomic(reportJson, Object.assign({}, plan, { backup: backupRel }));
  fs.writeFileSync(reportMd, reportMarkdown(plan, { backup: backupRel }));
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.appendFileSync(eventsFile, `${JSON.stringify({
    ts: decidedAt,
    type: 'quality_proposal.triaged',
    count: plan.total,
    counts: plan.counts,
    themes: plan.themes,
    report: path.relative(WORKSPACE_ROOT, reportMd),
  })}\n`);
  return {
    cardsFile,
    backup,
    reportJson,
    reportMd,
    archived: plan.total,
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cardsFile = path.resolve(args['cards-file'] || DEFAULT_CARDS);
  const cards = readJson(cardsFile);
  if (!Array.isArray(cards)) throw new Error('bulletin cards must be an array');
  const plan = buildPlan(cards);
  if (!args.apply) {
    console.log(JSON.stringify(Object.assign({ dryRun: true }, plan), null, args.json ? 0 : 2));
    return 0;
  }
  const result = applyPlan(cards, plan, {
    cardsFile,
    reportRoot: args['report-root'],
    eventsFile: args['events-file'],
  });
  console.log(JSON.stringify({
    ok: true,
    archived: result.archived,
    backup: path.relative(WORKSPACE_ROOT, result.backup),
    report: path.relative(WORKSPACE_ROOT, result.reportMd),
  }));
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error && error.stack || error);
    process.exit(1);
  }
}

module.exports = {
  SOURCE,
  canonicalTheme,
  dispositionFor,
  buildPlan,
  applyPlan,
  reportMarkdown,
  main,
};
