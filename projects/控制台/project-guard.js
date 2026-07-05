'use strict';

const STARLAID_PROJECT_RE = /(starlaid|星桥)/i;
const CLAUSE_SPLIT_RE = /[\r\n;；。！？!?，,]+/;
const CODE_IDENTIFIER_WITH_STARLAID_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:Starlaid|starlaid)[A-Za-z0-9_$]*\b/g;

const STARLAID_EXCLUSION_CONTEXT_RE = new RegExp([
  '(starlaid|星桥)[^\\r\\n;；。！？!?，,]{0,40}(排除|除外|不处理|不碰|不触碰|不涉及|硬排除|一律排除|全程硬排除|无关|未涉及|不相关|不含|不用管|不要管|停止|停下|out\\s+of\\s+scope|excluded|exclude|not\\s+involved|not\\s+related)',
  '(排除|除外|不处理|不碰|不触碰|不涉及|硬排除|一律排除|全程硬排除|无|没有|不是|并非|不含|未涉及|无关|不相关|不用管|不要管|exclude|excluded|without|no|not\\s+a|not\\s+an|not\\s+involved|not\\s+related|out\\s+of\\s+scope)[^\\r\\n;；。！？!?，,]{0,40}(starlaid|星桥)',
  '(非主动操作|非主动处理|非主动触碰|非\\s*active\\s*(operate|operation|process|touch))[^\\r\\n;；。！？!?，,]{0,40}(starlaid|星桥)',
  '(红线|边界|禁区|硬失败)[^\\r\\n;；。！？!?，,]{0,40}(starlaid|星桥)',
  '(starlaid|星桥)[^\\r\\n;；。！？!?，,]{0,40}(红线|边界|禁区|硬失败)',
  'no\\s+starlaid(\\s+(involvement|scope|reference|content|related))?',
  'without\\s+starlaid',
  '(starlaid|星桥)\\s+(excluded|exclude|out\\s+of\\s+scope)',
  'exclude\\s+starlaid',
  '(如果|若|if)[^\\r\\n;；。！？!?，,]{0,80}(starlaid|星桥)[^\\r\\n;；。！？!?，,]{0,80}(停止|停下|不处理|stop|do\\s+not\\s+process)',
].join('|'), 'i');

const STARLAID_ACTION_CN_RE = new RegExp([
  '操作', '处理', '触碰', '读取', '查看', '检查', '审查', '评估', '调研',
  '修', '修复', '维修', '修改', '改动', '改造', '接入', '集成', '部署',
  '构建', '打包', '发布', '测试', '验证', '运行', '启动', '重启', '迁移',
  '清理', '删除', '创建', '新增', '实现', '开发', '优化', '重构', '维护',
].join('|'), 'i');

const STARLAID_ACTION_EN_TERMS = [
  'fix', 'repair', 'modify', 'change', 'edit', 'touch', 'operate', 'process',
  'read', 'inspect', 'review', 'audit', 'evaluate', 'research', 'integrate',
  'deploy', 'build', 'package', 'release', 'test', 'verify', 'run', 'start',
  'restart', 'rebuild', 'migrate', 'clean', 'delete', 'create', 'add', 'implement',
  'develop', 'optimize', 'refactor', 'maintain',
];

const STARLAID_ACTION_EN_RE = new RegExp(
  `(^|[^A-Za-z0-9_])(?:${STARLAID_ACTION_EN_TERMS.join('|')})(?=$|[^A-Za-z0-9_])`,
  'i',
);

const PROJECT_KEYWORD_RULES = [
  {
    projectId: 'Simulaid',
    re: /simulaid|模拟纪元|团结|unity|tuanjie/i,
  },
  {
    projectId: '控制台',
    re: /控制台|console|workspace|工作区|new-api|api 网关|api-gateway|worker|queue|队列|工位|董事长办公室|秘书|ceo/i,
  },
];

function isStarlaidProjectId(projectId) {
  return STARLAID_PROJECT_RE.test(String(projectId || '').trim());
}

function isStarlaidExclusionContext(line) {
  return STARLAID_EXCLUSION_CONTEXT_RE.test(String(line || ''));
}

function hasStarlaidAction(line) {
  const text = String(line || '');
  return STARLAID_ACTION_CN_RE.test(text) || STARLAID_ACTION_EN_RE.test(text);
}

function stripStarlaidCodeIdentifiers(line) {
  return String(line || '').replace(CODE_IDENTIFIER_WITH_STARLAID_RE, token => {
    return /^starlaid$/i.test(token) ? token : ' ';
  });
}

function hasActiveStarlaidReference(text) {
  return String(text || '')
    .split(CLAUSE_SPLIT_RE)
    .map(line => line.trim())
    .filter(Boolean)
    .some(line => {
      const actionableText = stripStarlaidCodeIdentifiers(line);
      if (!STARLAID_PROJECT_RE.test(actionableText)) return false;
      if (isStarlaidExclusionContext(actionableText)) return false;
      return hasStarlaidAction(actionableText);
    });
}

function keywordProjectId(text) {
  const haystack = String(text || '');
  const matched = PROJECT_KEYWORD_RULES.find(rule => rule.re.test(haystack));
  return matched ? matched.projectId : null;
}

module.exports = {
  hasActiveStarlaidReference,
  isStarlaidProjectId,
  keywordProjectId,
  _test: {
    hasStarlaidAction,
    isStarlaidExclusionContext,
    stripStarlaidCodeIdentifiers,
  },
};
