'use strict';

const DEFAULTS = Object.freeze({
  kbHits: 1,
  kbChars: 280,
  lessonHits: 2,
  lessonChars: 700,
});

const REVIEW_LIKE_NODES = new Set([
  'review',
  'orchestrator-plan',
]);

function intEnv(env, name, fallback, min = 0, max = 10000) {
  const parsed = Number.parseInt(env && env[name], 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function knowledgeInjectionEnabled(node = {}) {
  if (REVIEW_LIKE_NODES.has(String(node.id || ''))) return false;
  if (/^(?:supervisor|board_|quality_ops)/i.test(String(node.agent_role || ''))) return false;
  return true;
}

function policyForNode(node = {}, env = process.env) {
  const enabled = knowledgeInjectionEnabled(node)
    && (!env || env.YUTU6_CONTEXT_INJECT !== '0');
  return {
    enabled,
    reason: enabled ? 'generation_or_execution_node' : 'review_or_planning_node',
    kbHits: intEnv(env, 'YUTU6_KB_INJECT_MAX_HITS', DEFAULTS.kbHits, 0, 8),
    kbChars: intEnv(env, 'YUTU6_KB_INJECT_MAX_CHARS', DEFAULTS.kbChars, 80, 2000),
    lessonHits: intEnv(env, 'YUTU6_LESSON_MAX_HITS', DEFAULTS.lessonHits, 0, 8),
    lessonChars: intEnv(env, 'YUTU6_LESSON_MAX_CHARS', DEFAULTS.lessonChars, 120, 3000),
  };
}

module.exports = {
  DEFAULTS,
  REVIEW_LIKE_NODES,
  intEnv,
  knowledgeInjectionEnabled,
  policyForNode,
};
