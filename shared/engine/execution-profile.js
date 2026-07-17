'use strict';

const ITERATIVE_TASK_RE = [
  /(?:自省|反思|自动)?优化|迭代|挑刺|对比(?:前后|方案)|多轮|三轮|收敛/i,
  /(?:UI|视觉|界面|页面|版式|交互|像素|动画|生图|素材|设计稿|设计系统)/i,
  /(?:架构|多智能体|agent|skill|prompt|提示词|hook|门禁|done[-_ ]?gate|路由|并发|调度|协议迁移)/i,
];

function automaticSource(spec = {}) {
  const explicit = spec.autoSource || spec.auto_source || spec.rootAutoSource || spec.root_auto_source;
  const text = [
    explicit,
    spec.queueAgent,
    spec.role,
    spec.flowId,
    spec.goal,
    spec.bounds,
    spec.title,
  ].filter(Boolean).join('\n');
  if (/洞察员|insight[-_ ]?scout|insight-/i.test(text)) return 'insight-scout';
  if (/ui[_-]?optimizer|界面自优化|ui\s*自优化|自省优化|self[-_ ]?reflection/i.test(text)) return 'optimizer';
  if (/scheduled|cron|定时|自动巡检|自动洞察/i.test(text)) return 'scheduled';
  return null;
}

function loopEngineeringDecision(spec = {}, env = process.env) {
  if (spec.loopEngineering === true) return { enabled: true, reason: 'explicit_on' };
  if (spec.loopEngineering === false) return { enabled: false, reason: 'explicit_off' };
  const retryCount = Number(
    spec.nodeRetry != null ? spec.nodeRetry
      : spec.engineRetry != null ? spec.engineRetry
        : spec.retryCount != null ? spec.retryCount
          : spec.retry,
  ) || 0;
  if (retryCount > 0) return { enabled: false, reason: 'retry_single_pass' };
  if (env.CONSOLE_LOOP_ENGINEERING_AUTOMATION === '1') {
    return { enabled: true, reason: 'automation_override' };
  }
  const source = automaticSource(spec);
  if (source) return { enabled: false, reason: `automatic_lightweight:${source}` };
  const text = [
    spec.goal,
    spec.acceptance,
    spec.bounds,
    spec.title,
    spec.taskType,
    spec.task_type,
  ].filter(Boolean).join('\n');
  const matched = ITERATIVE_TASK_RE.find(re => re.test(text));
  if (matched) return { enabled: true, reason: 'iterative_task_signal' };
  return { enabled: false, reason: 'routine_single_pass' };
}

module.exports = {
  ITERATIVE_TASK_RE,
  automaticSource,
  loopEngineeringDecision,
};
