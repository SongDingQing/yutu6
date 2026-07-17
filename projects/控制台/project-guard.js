'use strict';

// Generic keyword fallback used only when a task did not provide a valid
// projectId. Project availability itself is decided by the projects directory.
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

function keywordProjectId(text) {
  const haystack = String(text || '');
  const matched = PROJECT_KEYWORD_RULES.find(rule => rule.re.test(haystack));
  return matched ? matched.projectId : null;
}

module.exports = { keywordProjectId };
