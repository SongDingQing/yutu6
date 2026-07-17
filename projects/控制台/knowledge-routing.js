'use strict';

// 控制台项目级知识路由候选。生产默认关闭；只有配置、主管复核和主人批准
// 三门同时满足时，engine-runner 才会用本模块替代 shared/engine 的旧全文注入。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { redactMemoryCandidate } = require('./memory-redaction');

const DEFAULT_CONFIG = Object.freeze({
  schema: 'console-knowledge-routing@1',
  enabled: false,
  eligibleRoles: [
    'quality_ops', 'worker_code', 'worker_narrow', 'it_engineer',
    'frontend_designer', 'secretary', 'memory_officer', 'insight-scout',
  ],
  excludedNodes: ['review', 'orchestrator-plan'],
  maxInjected: 2,
  maxChars: 600,
  queryTimeoutMs: 4000,
  stats: {
    lockWaitMs: 10000,
    lockPollMs: 5,
    staleLockMs: 30000,
  },
  gate: {
    initialThreshold: 0.55,
    minimumSemanticConfidence: 0.35,
    baselineTopN: 1,
  },
  dynamicRouting: {
    enabled: false,
    minimumHits: 20,
    windowSize: 50,
    adoptionRateThreshold: 0.20,
    noContributionRateThreshold: 0.75,
    recoveryAdoptionRate: 0.45,
    adjustmentStep: 0.05,
    minimumThreshold: 0.35,
    maximumThreshold: 0.80,
    requiredStableWindows: 3,
    cooldownMs: 7 * 24 * 60 * 60 * 1000,
    activationDelayMs: 24 * 60 * 60 * 1000,
  },
  promotionApproval: {
    status: 'pending',
    supervisorReviewed: false,
    ownerApproved: false,
  },
});

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeConfig(input = {}) {
  const source = object(input);
  return Object.assign({}, DEFAULT_CONFIG, source, {
    eligibleRoles: Array.isArray(source.eligibleRoles)
      ? source.eligibleRoles.map(String)
      : DEFAULT_CONFIG.eligibleRoles.slice(),
    excludedNodes: Array.isArray(source.excludedNodes)
      ? source.excludedNodes.map(String)
      : DEFAULT_CONFIG.excludedNodes.slice(),
    gate: Object.assign({}, DEFAULT_CONFIG.gate, object(source.gate)),
    stats: Object.assign({}, DEFAULT_CONFIG.stats, object(source.stats)),
    dynamicRouting: Object.assign({}, DEFAULT_CONFIG.dynamicRouting, object(source.dynamicRouting)),
    promotionApproval: Object.assign({}, DEFAULT_CONFIG.promotionApproval, object(source.promotionApproval)),
  });
}

function activationState(input, env = process.env) {
  const config = normalizeConfig(input);
  if (env && env.CONSOLE_KNOWLEDGE_ROUTING === '0') {
    return { enabled: false, reason: 'environment_kill_switch', config };
  }
  if (config.enabled !== true) return { enabled: false, reason: 'config_disabled', config };
  if (config.promotionApproval.supervisorReviewed !== true) {
    return { enabled: false, reason: 'supervisor_review_missing', config };
  }
  if (config.promotionApproval.ownerApproved !== true) {
    return { enabled: false, reason: 'owner_approval_missing', config };
  }
  if (config.promotionApproval.status !== 'approved') {
    return { enabled: false, reason: 'approval_status_not_approved', config };
  }
  if (config.promotionApproval.approvedBy !== '主人') {
    return { enabled: false, reason: 'owner_approval_identity_missing', config };
  }
  if (!Number.isFinite(Date.parse(String(config.promotionApproval.approvedAt || '')))) {
    return { enabled: false, reason: 'owner_approval_time_missing', config };
  }
  return { enabled: true, reason: 'approved', config };
}

function sha(value, size = 64) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, size);
}

function normalizeProject(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === '*' || /^(?:global|shared|通用)$/.test(raw)) return '*';
  if (/simulaid|模拟纪元/.test(raw)) return 'Simulaid';
  if (/控制台|console/.test(raw)) return '控制台';
  if (/migration|迁移/.test(raw)) return '_迁移';
  return String(value).trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,，;；|]+/).map(v => v.trim()).filter(Boolean);
  return [];
}

const TAG_RULES = [
  ['quality', /quality[_ -]?ops|质量运营|质量审计|挑错|audit/i],
  ['audit', /审计|audit|trace|链路复核/i],
  ['knowledge', /知识|knowledge|检索|片段/i],
  ['routing', /路由|routing|route|门控/i],
  ['queue', /队列|queue|enqueue/i],
  ['migration', /migration|迁移|搬家|旧机|新机/i],
  ['simulaid', /simulaid|模拟纪元|unity|团结引擎/i],
  ['console', /控制台|console|control[- ]?plane/i],
  ['game', /游戏|game|boss|卡牌/i],
  ['template', /模板|template|prompt/i],
  ['release', /发布|构建|build|release|taptap/i],
];

function inferTags(text) {
  const source = String(text || '');
  return TAG_RULES.filter(([, pattern]) => pattern.test(source)).map(([tag]) => tag);
}

function inferProjectFromPath(file) {
  const p = String(file || '').replace(/\\/g, '/');
  if (/^projects\/控制台\//i.test(p) || /console/i.test(p)) return '控制台';
  if (/^projects\/simulaid(?:\/|\.md|$)/i.test(p) || /simulaid/i.test(p)) return 'Simulaid';
  if (/^(?:wiki\/)?migration\//i.test(p) || /迁移/.test(p)) return '_迁移';
  if (/^(?:shared|memory|rules|templates|knowledge\/归档)\//i.test(p)) return '*';
  return null;
}

function candidateMetadata(candidate, rank = 0) {
  const source = object(candidate);
  const file = String(source.path || source.source_path || source.sourcePath || `fragment-${rank + 1}`)
    .replace(/[\r\n]/g, ' ').slice(0, 240);
  const text = String(source.text || source.content || '').replace(/\s+/g, ' ').trim();
  const project = normalizeProject(
    source.project_id || source.projectId || source.project || inferProjectFromPath(file),
  );
  const roles = list(source.roles || source.role);
  const tags = Array.from(new Set([
    ...list(source.task_tags || source.taskTags || source.tags),
    ...inferTags(`${file} ${text.slice(0, 500)}`),
  ].map(v => v.toLowerCase())));
  const rawConfidence = Number(source.confidence != null ? source.confidence : source.score);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : Math.max(0.20, 0.60 - rank * 0.10);
  return {
    id: String(source.fragment_id || source.fragmentId || `kb_${sha(`${file}\0${text}`, 16)}`),
    path: file,
    text,
    project,
    roles,
    tags,
    confidence,
    rank,
  };
}

function contextTags(ctx = {}) {
  const explicit = [
    ...list(ctx.task_tags),
    ...list(ctx.taskTags),
    ...list(ctx.tags),
  ];
  return Array.from(new Set([...explicit, ...inferTags(ctx.goal)].map(v => v.toLowerCase())));
}

function explicitReferences(ctx = {}, candidates = []) {
  const values = [
    ...list(ctx.explicitKnowledgeRefs),
    ...list(ctx.explicit_knowledge_refs),
    ...list(ctx.knowledge_refs),
  ];
  const goal = String(ctx.goal || '');
  for (const candidate of candidates) {
    if (goal.includes(candidate.id) || (candidate.path && goal.includes(candidate.path))) values.push(candidate.id);
  }
  return new Set(values.map(v => v.toLowerCase()));
}

function scoreCandidate(candidate, context) {
  const reasons = [];
  let score = 0;
  const queryProject = normalizeProject(context.projectId);
  const candidateProject = normalizeProject(candidate.project);
  const hardProjectMismatch = !!(
    queryProject && candidateProject && candidateProject !== '*' && candidateProject !== queryProject
  );
  if (hardProjectMismatch) {
    reasons.push(`project_mismatch:${candidateProject}!=${queryProject}`);
    score -= 0.65;
  } else if (queryProject && candidateProject === queryProject) {
    score += 0.45;
  } else if (candidateProject === '*') {
    score += 0.20;
  } else {
    score += 0.05;
  }

  const role = String(context.role || '');
  const roleMatch = !candidate.roles.length || candidate.roles.includes('*') || candidate.roles.includes(role);
  if (!candidate.roles.length || candidate.roles.includes('*')) score += 0.05;
  else if (roleMatch) score += 0.20;
  else {
    score -= 0.40;
    reasons.push(`role_mismatch:${candidate.roles.join('|')}!=${role || '-'}`);
  }

  const queryTags = context.taskTags;
  const overlap = candidate.tags.filter(tag => queryTags.includes(tag));
  if (queryTags.length && candidate.tags.length) {
    score += 0.25 * (overlap.length / Math.max(1, Math.min(queryTags.length, candidate.tags.length)));
    if (!overlap.length) reasons.push('task_tags_no_overlap');
  } else if (!queryTags.length) {
    reasons.push('task_tags_missing');
  } else {
    reasons.push('fragment_tags_missing');
  }
  score += 0.10 * candidate.confidence;
  return { score: Math.max(-1, Math.min(1, score)), reasons, hardProjectMismatch, roleMatch };
}

function fallbackCandidates(decisions, count, reason, allowHardMismatch = false) {
  const safe = decisions
    .filter(item => allowHardMismatch || (!item.hardProjectMismatch && item.roleMatch))
    .sort((a, b) => {
      const ag = a.fragment.project === '*' ? 1 : 0;
      const bg = b.fragment.project === '*' ? 1 : 0;
      return bg - ag || b.fragment.confidence - a.fragment.confidence || a.fragment.rank - b.fragment.rank;
    })
    .slice(0, Math.max(1, count));
  for (const item of safe) {
    item.injected = true;
    item.fallback = true;
    item.reasons = [reason];
  }
  return safe;
}

function routeKnowledgeCandidates(input = {}) {
  const config = normalizeConfig(input.config);
  const ctx = object(input.ctx);
  const node = object(input.node);
  const fragments = (Array.isArray(input.candidates) ? input.candidates : [])
    .map((candidate, rank) => candidateMetadata(candidate, rank));
  const tags = contextTags(ctx);
  const context = { projectId: ctx.projectId, role: node.agent_role || ctx.role, taskTags: tags };
  const refs = explicitReferences(ctx, fragments);
  const threshold = Number.isFinite(Number(input.threshold))
    ? Number(input.threshold)
    : Number(config.gate.initialThreshold);
  const scorer = typeof input.scorer === 'function' ? input.scorer : scoreCandidate;
  let decisions;
  try {
    decisions = fragments.map(fragment => {
      const scored = scorer(fragment, context);
      const explicit = refs.has(fragment.id.toLowerCase()) || refs.has(fragment.path.toLowerCase());
      const injected = explicit || (!scored.hardProjectMismatch && scored.roleMatch && scored.score >= threshold);
      const reasons = explicit
        ? ['explicit_reference_override']
        : injected
          ? ['project_role_tags_gate_passed']
          : (scored.reasons.length ? scored.reasons.slice() : [`below_threshold:${scored.score.toFixed(3)}<${threshold.toFixed(3)}`]);
      if (!injected && scored.score < threshold && !reasons.some(r => r.startsWith('below_threshold:'))) {
        reasons.push(`below_threshold:${scored.score.toFixed(3)}<${threshold.toFixed(3)}`);
      }
      return Object.assign({}, scored, { fragment, explicit, injected, fallback: false, reasons });
    });
  } catch (error) {
    decisions = fragments.map(fragment => ({
      fragment, explicit: false, injected: false, fallback: false,
      score: 0, reasons: ['gate_evaluation_failed'], hardProjectMismatch: false, roleMatch: true,
    }));
    fallbackCandidates(decisions, config.gate.baselineTopN, 'fallback_gate_error', true);
    return finalizeDecision(input, config, context, threshold, decisions, {
      fallback: true,
      fallbackReason: 'gate_evaluation_failed',
      gateError: redactMemoryCandidate(error && error.message || error || 'unknown', 200),
    });
  }

  let fallback = false;
  let fallbackReason = null;
  if (!decisions.some(item => item.explicit && item.injected)) {
    const forceFallback = ctx.knowledgeFallback === true || ctx.knowledge_fallback === true;
    const normalizedProject = normalizeProject(ctx.projectId);
    const coldProject = !normalizedProject
      || !new Set(['控制台', 'Simulaid', '_迁移', '*']).has(normalizedProject);
    const tagsMissing = tags.length === 0;
    const lowConfidence = !fragments.length
      || Math.max(...fragments.map(fragment => fragment.confidence), 0) < Number(config.gate.minimumSemanticConfidence);
    if (forceFallback || coldProject || tagsMissing || lowConfidence) {
      fallback = true;
      fallbackReason = forceFallback
        ? 'on_demand_fallback'
        : coldProject
          ? 'new_project_baseline_fallback'
          : tagsMissing
            ? 'missing_tags_baseline_fallback'
            : 'low_confidence_baseline_fallback';
      // Baseline/on-demand fallback outranks an ordinary score pass. Otherwise a
      // same-project candidate with confidence=0.05 can still clear the weighted
      // project/tag threshold and silently bypass the promised low-confidence
      // remedy. Explicit references remain the only higher-priority route.
      for (const item of decisions) {
        if (!item.explicit) {
          item.injected = false;
          item.fallback = false;
        }
      }
      fallbackCandidates(
        decisions.filter(item => !item.explicit),
        config.gate.baselineTopN,
        fallbackReason,
        false,
      );
    }
  }

  const maxInjected = Math.max(1, Number(config.maxInjected) || 1);
  const selected = decisions.filter(item => item.injected)
    .sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.score - a.score || a.fragment.rank - b.fragment.rank);
  const explicitSelected = selected.filter(item => item.explicit);
  const ordinaryBudget = Math.max(0, maxInjected - explicitSelected.length);
  const ordinaryOverflow = selected.filter(item => !item.explicit).slice(ordinaryBudget);
  for (const item of ordinaryOverflow) {
    item.injected = false;
    item.fallback = false;
    item.reasons = ['injection_budget_exceeded'];
  }
  return finalizeDecision(input, config, context, threshold, decisions, { fallback, fallbackReason });
}

function finalizeDecision(input, config, context, threshold, decisions, extra = {}) {
  const queryId = String(input.queryId || `query-${Date.now()}-${sha(Math.random(), 8)}`);
  const templateId = String(input.templateId || `${input.node && input.node.id || 'node'}:${context.role || '-'}`);
  return Object.assign({
    schema: 'console-knowledge-gate-decision@1',
    queryId,
    queryHash: sha(input.query || input.ctx && input.ctx.goal || ''),
    templateId,
    projectId: normalizeProject(context.projectId),
    role: context.role || null,
    taskTags: context.taskTags,
    threshold,
    decisions,
    injected: decisions.filter(item => item.injected),
    filtered: decisions.filter(item => !item.injected),
    referenceResolution: object(input.referenceResolution),
    configSchema: config.schema,
  }, extra);
}

function renderKnowledgeBlock(decision, configInput) {
  const config = normalizeConfig(configInput);
  if (!decision || (!decision.injected.length && !decision.filtered.length && !decision.fallbackReason)) return '';
  const lines = [
    '# 知识库检索（project_id / role / task tags 门控）',
    `- 查询追踪:${decision.queryId}; template:${decision.templateId}; threshold:${decision.threshold.toFixed(2)}`,
  ];
  if (decision.injected.length) {
    lines.push('## 正文注入');
    for (const item of decision.injected) {
      const text = item.fragment.text.slice(0, Math.max(80, Number(config.maxChars) || 600));
      lines.push(`- [${item.fragment.id} · ${item.fragment.path}] ${text}`);
    }
  } else {
    lines.push('## 正文注入', '- 无安全相关片段；已保留下方按需引用桩。');
  }
  if (decision.filtered.length) {
    lines.push('## 未注入引用桩（可按需回退）');
    for (const item of decision.filtered) {
      lines.push(`- [${item.fragment.id}] path=${item.fragment.path}; reason=${item.reasons.join(',')}; on_demand=显式引用片段标识或路径后重检`);
    }
  }
  const unresolvedRefs = list(decision.referenceResolution && decision.referenceResolution.unresolvedRefs);
  if (unresolvedRefs.length) {
    lines.push('## 未解析显式引用（未静默丢弃）');
    for (const ref of unresolvedRefs) {
      lines.push(`- [${ref.slice(0, 240)}] reason=explicit_reference_not_found; on_demand=核对引用桩中的完整片段标识或路径后重检`);
    }
  }
  if (!decision.injected.length && !decision.filtered.length) {
    lines.push('## 按需补救', '- on_demand=显式引用知识路径或片段标识后重检；检索源不可用时按查询追踪检查 knowledge/query.py。');
  }
  if (decision.fallbackReason) lines.push(`- fallback:${decision.fallbackReason}（优先级高于普通门控）`);
  lines.push('');
  return lines.join('\n');
}

function mergeKnowledgeCandidates(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const candidate of Array.isArray(group) ? group : []) {
      const source = object(candidate);
      const fragmentId = String(source.fragment_id || source.fragmentId || '').trim().toLowerCase();
      const candidatePath = String(source.path || source.source_path || source.sourcePath || '').trim();
      const text = String(source.text || source.content || '').replace(/\s+/g, ' ').trim();
      const key = fragmentId
        ? `id:${fragmentId}`
        : `content:${candidatePath}\0${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}

function fetchExplicitKnowledgeCandidates(ctx, options = {}) {
  const refs = list(ctx.explicitKnowledgeRefs || ctx.explicit_knowledge_refs || ctx.knowledge_refs)
    .slice(0, 20);
  if (!refs.length) {
    return { ok: true, skipped: true, candidates: [], resolvedRefs: [], unresolvedRefs: [] };
  }
  const workspaceRoot = options.workspaceRoot || ctx.workspaceRoot || process.cwd();
  const dbFile = path.join(workspaceRoot, 'knowledge', 'kb.sqlite');
  const queryScript = options.referenceQueryScript
    || path.join(__dirname, 'tools', 'knowledge-reference-query.py');
  if (!fs.existsSync(queryScript) || !fs.existsSync(dbFile)) {
    return {
      ok: false,
      reason: 'explicit_reference_store_unavailable',
      candidates: [],
      resolvedRefs: [],
      unresolvedRefs: refs,
    };
  }
  const res = spawnSync('python3', [queryScript, '--db', dbFile, '--json'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    input: JSON.stringify({ refs, maxHitsPerRef: 6 }),
    timeout: Math.max(100, Number(options.queryTimeoutMs) || DEFAULT_CONFIG.queryTimeoutMs),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || !res.stdout) {
    return {
      ok: false,
      reason: res.error ? 'explicit_reference_spawn_failed' : `explicit_reference_exit_${res.status}`,
      candidates: [],
      resolvedRefs: [],
      unresolvedRefs: refs,
    };
  }
  try {
    const payload = JSON.parse(String(res.stdout).trim().split(/\r?\n/).pop() || '{}');
    if (!payload.ok) {
      return {
        ok: false,
        reason: payload.error || 'explicit_reference_query_failed',
        candidates: [],
        resolvedRefs: [],
        unresolvedRefs: refs,
      };
    }
    return {
      ok: true,
      candidates: Array.isArray(payload.hits) ? payload.hits : [],
      resolvedRefs: list(payload.resolvedRefs),
      unresolvedRefs: list(payload.unresolvedRefs),
    };
  } catch (_) {
    return {
      ok: false,
      reason: 'explicit_reference_json_invalid',
      candidates: [],
      resolvedRefs: [],
      unresolvedRefs: refs,
    };
  }
}

function fetchKnowledgeCandidates(ctx, options = {}) {
  const workspaceRoot = options.workspaceRoot || ctx.workspaceRoot || process.cwd();
  const queryScript = path.join(workspaceRoot, 'knowledge', 'query.py');
  const dbFile = path.join(workspaceRoot, 'knowledge', 'kb.sqlite');
  const goal = String(ctx.goal || '').trim();
  const refs = list(ctx.explicitKnowledgeRefs || ctx.explicit_knowledge_refs || ctx.knowledge_refs);
  const exact = fetchExplicitKnowledgeCandidates(ctx, Object.assign({}, options, { workspaceRoot }));
  const referenceResolution = {
    requestedCount: refs.length,
    resolvedRefs: exact.resolvedRefs || [],
    unresolvedRefs: exact.unresolvedRefs || [],
    resolverReason: exact.ok ? null : exact.reason || 'explicit_reference_query_failed',
  };
  if (!goal && !refs.length) {
    return { ok: false, reason: 'empty_query', candidates: [], referenceResolution };
  }
  if (!fs.existsSync(queryScript) || !fs.existsSync(dbFile) || !goal) {
    if (exact.candidates && exact.candidates.length) {
      return {
        ok: true,
        mode: 'explicit_reference',
        query: refs.join(' ').slice(0, 400),
        candidates: exact.candidates,
        referenceResolution,
      };
    }
    return {
      ok: false,
      reason: !goal ? 'empty_query' : 'knowledge_store_unavailable',
      candidates: [],
      referenceResolution,
    };
  }
  const query = [...refs.slice(0, 3), goal].join(' ').slice(0, 400);
  const res = spawnSync('python3', [queryScript, query, '--json'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    timeout: Math.max(100, Number(options.queryTimeoutMs) || DEFAULT_CONFIG.queryTimeoutMs),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || !res.stdout) {
    if (exact.candidates && exact.candidates.length) {
      return {
        ok: true,
        mode: 'explicit_reference',
        query,
        candidates: exact.candidates,
        referenceResolution,
      };
    }
    return {
      ok: false,
      reason: res.error ? 'query_spawn_failed' : `query_exit_${res.status}`,
      candidates: [],
      referenceResolution,
    };
  }
  try {
    const payload = JSON.parse(String(res.stdout).trim().split(/\r?\n/).pop() || '{}');
    const semantic = payload.ok && Array.isArray(payload.hits) ? payload.hits : [];
    const candidates = mergeKnowledgeCandidates(exact.candidates, semantic);
    if (!payload.ok && !candidates.length) {
      return {
        ok: false,
        reason: payload.error || 'query_failed',
        candidates: [],
        referenceResolution,
      };
    }
    return {
      ok: true,
      mode: exact.candidates && exact.candidates.length
        ? `explicit_reference+${payload.mode || 'none'}`
        : payload.mode || null,
      query,
      candidates,
      referenceResolution,
    };
  } catch (_) {
    if (exact.candidates && exact.candidates.length) {
      return {
        ok: true,
        mode: 'explicit_reference',
        query,
        candidates: exact.candidates,
        referenceResolution,
      };
    }
    return { ok: false, reason: 'query_json_invalid', candidates: [], referenceResolution };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireAppendLock(file, options = {}) {
  const lockDir = `${file}.lock`;
  const ownerFile = path.join(lockDir, 'owner.json');
  const ownerToken = `${process.pid}-${Date.now()}-${sha(Math.random(), 12)}`;
  const waitMs = Math.max(100, Number(options.lockWaitMs) || DEFAULT_CONFIG.stats.lockWaitMs);
  const pollMs = Math.max(1, Number(options.lockPollMs) || DEFAULT_CONFIG.stats.lockPollMs);
  const staleMs = Math.max(waitMs, Number(options.staleLockMs) || DEFAULT_CONFIG.stats.staleLockMs);
  const started = Date.now();
  for (;;) {
    try {
      await fs.promises.mkdir(lockDir);
      await fs.promises.writeFile(ownerFile, JSON.stringify({
        schema: 'console-knowledge-stats-lock@1',
        pid: process.pid,
        token: ownerToken,
        acquiredAt: new Date().toISOString(),
      }), 'utf8');
      return async () => {
        try {
          const owner = JSON.parse(await fs.promises.readFile(ownerFile, 'utf8'));
          if (owner.token !== ownerToken) return;
        } catch (error) {
          if (error && error.code !== 'ENOENT') return;
        }
        await fs.promises.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.promises.stat(lockDir);
        let abandoned = false;
        try {
          const owner = JSON.parse(await fs.promises.readFile(ownerFile, 'utf8'));
          const ownerPid = Number(owner.pid);
          if (Number.isInteger(ownerPid) && ownerPid > 0) {
            try { process.kill(ownerPid, 0); } catch (pidError) {
              abandoned = !!pidError && pidError.code === 'ESRCH';
            }
          }
        } catch (_) {}
        if (abandoned || Date.now() - stat.mtimeMs > staleMs) {
          await fs.promises.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError && statError.code !== 'ENOENT') throw statError;
        continue;
      }
      if (Date.now() - started >= waitMs) {
        const timeout = new Error(`knowledge stats append lock timeout:${path.basename(file)}`);
        timeout.code = 'KNOWLEDGE_STATS_LOCK_TIMEOUT';
        throw timeout;
      }
      await delay(pollMs);
    }
  }
}

async function appendJsonlLocked(file, body, options = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const release = await acquireAppendLock(file, options);
  try {
    const handle = await fs.promises.open(file, 'a');
    try {
      const bytes = Buffer.from(String(body || ''), 'utf8');
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.write(bytes, offset, bytes.length - offset, null);
        if (!result.bytesWritten) throw new Error('knowledge stats append wrote zero bytes');
        offset += result.bytesWritten;
      }
    } finally {
      await handle.close();
    }
  } finally {
    await release();
  }
}

class AsyncStatsLedger {
  constructor(file, options = {}) {
    this.file = file;
    this.queue = [];
    this.scheduled = false;
    this.flushing = null;
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
    this.appendImpl = options.appendImpl
      || (body => appendJsonlLocked(this.file, body, options));
  }

  record(event) {
    this.queue.push(JSON.stringify(event));
    if (!this.scheduled) {
      this.scheduled = true;
      setImmediate(() => {
        this.scheduled = false;
        this.flush().catch(error => { this.onError(error); });
      });
    }
  }

  async flush() {
    if (this.flushing) {
      await this.flushing;
      if (this.queue.length) return this.flush();
      return;
    }
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    this.flushing = Promise.resolve(this.appendImpl(`${batch.join('\n')}\n`));
    try { await this.flushing; } finally { this.flushing = null; }
    if (this.queue.length) return this.flush();
  }
}

function statEvents(decision, at = new Date().toISOString()) {
  return decision.decisions.map(item => ({
    schema: 'console-knowledge-usage-event@1',
    event_id: sha(`${decision.queryId}\0${decision.templateId}\0${item.fragment.id}`),
    query_id: decision.queryId,
    query_hash: decision.queryHash,
    template_id: decision.templateId,
    fragment_id: item.fragment.id,
    fragment_path: item.fragment.path,
    hit: 1,
    adopted: item.injected ? 1 : 0,
    no_contribution: item.injected ? 0 : 1,
    decision_reason: item.reasons,
    at,
  }));
}

function aggregateUsage(events) {
  const seen = new Set();
  const groups = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.schema !== 'console-knowledge-usage-event@1' || !event.event_id) continue;
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const key = `${event.template_id}\0${event.fragment_id}`;
    if (!groups[key]) {
      groups[key] = {
        templateId: event.template_id,
        fragmentId: event.fragment_id,
        fragmentPath: event.fragment_path,
        hitCount: 0,
        adoptionCount: 0,
        noContributionCount: 0,
      };
    }
    groups[key].hitCount += Number(event.hit) || 0;
    groups[key].adoptionCount += Number(event.adopted) || 0;
    groups[key].noContributionCount += Number(event.no_contribution) || 0;
  }
  for (const group of Object.values(groups)) {
    group.adoptionRate = group.hitCount ? group.adoptionCount / group.hitCount : 0;
    group.noContributionRate = group.hitCount ? group.noContributionCount / group.hitCount : 0;
  }
  return { uniqueEventCount: seen.size, groups };
}

function readUsageLedger(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function advanceRouteState(previous = {}, window = {}, inputConfig = {}, nowMs = Date.now()) {
  const config = Object.assign({}, DEFAULT_CONFIG.dynamicRouting, object(inputConfig));
  const state = Object.assign({
    threshold: Number(inputConfig.initialThreshold || DEFAULT_CONFIG.gate.initialThreshold),
    pending: null,
    lastAppliedAt: 0,
    changes: [],
  }, object(previous));
  if (config.enabled !== true) return Object.assign({}, state, { decision: 'dynamic_routing_disabled' });
  if ((Number(window.hitCount) || 0) < Number(config.minimumHits)) {
    return Object.assign({}, state, { pending: null, decision: 'insufficient_window' });
  }
  const adoptionRate = Number(window.adoptionRate) || 0;
  const noContributionRate = Number(window.noContributionRate) || 0;
  let direction = null;
  if (adoptionRate <= Number(config.adoptionRateThreshold)
    && noContributionRate >= Number(config.noContributionRateThreshold)) direction = 'tighten';
  else if (adoptionRate >= Number(config.recoveryAdoptionRate)) direction = 'loosen';
  if (!direction) return Object.assign({}, state, { pending: null, decision: 'hysteresis_hold' });

  const cooldownUntil = Number(state.lastAppliedAt || 0) + Number(config.cooldownMs);
  if (state.lastAppliedAt && nowMs < cooldownUntil) {
    return Object.assign({}, state, { pending: null, decision: 'cooldown_hold', cooldownUntil });
  }
  const priorPending = state.pending && state.pending.direction === direction ? state.pending : null;
  const stableWindows = (priorPending && Number(priorPending.stableWindows) || 0) + 1;
  const required = Math.max(1, Number(config.requiredStableWindows) || 1);
  let pending = {
    direction,
    stableWindows,
    proposedAt: priorPending ? priorPending.proposedAt : nowMs,
    effectiveAt: priorPending ? priorPending.effectiveAt : nowMs + Number(config.activationDelayMs),
  };
  if (stableWindows < required) return Object.assign({}, state, { pending, decision: 'stability_window_pending' });
  if (nowMs < pending.effectiveAt) return Object.assign({}, state, { pending, decision: 'activation_delay_pending' });

  const step = Number(config.adjustmentStep);
  const min = Number(config.minimumThreshold);
  const max = Number(config.maximumThreshold);
  const nextThreshold = Number(Math.max(
    min,
    Math.min(max, Number(state.threshold) + (direction === 'tighten' ? step : -step)),
  ).toFixed(4));
  const change = { direction, from: Number(state.threshold), to: nextThreshold, appliedAt: nowMs };
  return Object.assign({}, state, {
    threshold: nextThreshold,
    pending: null,
    lastAppliedAt: nowMs,
    changes: [...(Array.isArray(state.changes) ? state.changes : []), change].slice(-50),
    decision: nextThreshold === Number(state.threshold) ? 'threshold_boundary_hold' : 'threshold_applied',
  });
}

function readRouteState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { schema: 'console-knowledge-route-state@1', routes: {} }; }
}

function thresholdFor(routeState, templateId, fallback) {
  const route = routeState && routeState.routes && routeState.routes[templateId];
  const value = Number(route && route.threshold);
  return Number.isFinite(value) ? value : Number(fallback);
}

function eligibleNode(config, node) {
  return !!node
    && config.eligibleRoles.includes(String(node.agent_role || ''))
    && !config.excludedNodes.includes(String(node.id || ''));
}

function withKnowledgeBlock(ctx, node, block) {
  if (!block) return ctx;
  const prompts = Object.assign({}, object(ctx.agentPrompts));
  const role = String(node.agent_role || '');
  prompts[role] = [String(prompts[role] || '').trim(), block].filter(Boolean).join('\n\n');
  return Object.assign({}, ctx, { agentPrompts: prompts });
}

function emitDecision(eventlog, decision, ctx) {
  if (!eventlog || typeof eventlog.emit !== 'function') return;
  try {
    eventlog.emit('knowledge.gate.decision', {
      query_id: decision.queryId,
      query_hash: decision.queryHash,
      query_excerpt: redactMemoryCandidate(ctx.goal || '', 200),
      template_id: decision.templateId,
      project_id: decision.projectId,
      role: decision.role,
      task_tags: decision.taskTags,
      threshold: decision.threshold,
      fallback: !!decision.fallback,
      fallback_reason: decision.fallbackReason || null,
      reference_resolution: decision.referenceResolution || null,
      candidates: decision.decisions.map(item => ({
        fragment_id: item.fragment.id,
        path: item.fragment.path,
        adopted: item.injected,
        score: Number(item.score.toFixed(4)),
        reasons: item.reasons,
      })),
    });
  } catch (_) {}
}

function makeKnowledgeRoutingRunner(baseRunner, options = {}) {
  const activation = activationState(options.config, options.env || process.env);
  if (!activation.enabled) return baseRunner;
  const config = activation.config;
  const ledger = options.ledger || new AsyncStatsLedger(
    options.usageLedgerFile || path.join(options.artifactsRoot || path.join(__dirname, 'artifacts'), 'knowledge-routing', 'usage.jsonl'),
    {
      onError(error) {
        if (!options.eventlog || typeof options.eventlog.emit !== 'function') return;
        try {
          options.eventlog.emit('knowledge.stats.write_failed', {
            task: options.taskId || null,
            reason: redactMemoryCandidate(error && error.message || error || 'unknown', 300),
          });
        } catch (_) {}
      },
    },
  );
  const routeState = config.dynamicRouting.enabled === true
    ? (options.routeState || readRouteState(
      options.routeStateFile || path.join(options.artifactsRoot || path.join(__dirname, 'artifacts'), 'knowledge-routing', 'route-state.json'),
    ))
    : { schema: 'console-knowledge-route-state@1', routes: {} };
  const queryFn = options.queryFn || fetchKnowledgeCandidates;

  function prepare(node, ctx, attempt) {
    if (!eligibleNode(config, node)) return ctx;
    const queryId = `${options.taskId || ctx.taskId || 'task'}:${node.id}:${attempt}`;
    const templateId = `${node.id}:${node.agent_role || '-'}`;
    const fetched = queryFn(ctx, {
      workspaceRoot: options.workspaceRoot,
      queryTimeoutMs: config.queryTimeoutMs,
    }) || { ok: false, reason: 'query_unavailable', candidates: [] };
    const decision = routeKnowledgeCandidates({
      ctx,
      node,
      candidates: fetched.candidates,
      query: fetched.query || ctx.goal,
      queryId,
      templateId,
      config,
      threshold: thresholdFor(routeState, templateId, config.gate.initialThreshold),
      referenceResolution: fetched.referenceResolution,
    });
    if (!fetched.ok && !decision.fallbackReason) {
      decision.fallback = true;
      decision.fallbackReason = fetched.reason || 'query_unavailable';
    }
    emitDecision(options.eventlog, decision, ctx);
    for (const event of statEvents(decision)) ledger.record(event);
    return withKnowledgeBlock(ctx, node, renderKnowledgeBlock(decision, config));
  }

  function routedRunner(node, ctx, attempt) {
    return baseRunner(node, prepare(node, ctx, attempt), attempt);
  }
  Object.assign(routedRunner, baseRunner);
  if (typeof baseRunner.runNodeAsync === 'function') {
    routedRunner.runNodeAsync = (node, ctx, attempt) => baseRunner.runNodeAsync(node, prepare(node, ctx, attempt), attempt);
  }
  if (typeof baseRunner.runBoardNodeAsync === 'function') {
    routedRunner.runBoardNodeAsync = (node, ctx, attempt) => baseRunner.runBoardNodeAsync(node, ctx, attempt);
  }
  routedRunner.flushKnowledgeStats = () => ledger.flush();
  process.once('beforeExit', () => {
    ledger.flush().catch(error => {
      if (!options.eventlog || typeof options.eventlog.emit !== 'function') return;
      try {
        options.eventlog.emit('knowledge.stats.write_failed', {
          task: options.taskId || null,
          reason: redactMemoryCandidate(error && error.message || error || 'unknown', 300),
        });
      } catch (_) {}
    });
  });
  return routedRunner;
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeConfig,
  activationState,
  candidateMetadata,
  contextTags,
  scoreCandidate,
  routeKnowledgeCandidates,
  renderKnowledgeBlock,
  mergeKnowledgeCandidates,
  fetchExplicitKnowledgeCandidates,
  fetchKnowledgeCandidates,
  appendJsonlLocked,
  AsyncStatsLedger,
  statEvents,
  aggregateUsage,
  readUsageLedger,
  advanceRouteState,
  readRouteState,
  thresholdFor,
  eligibleNode,
  makeKnowledgeRoutingRunner,
};
