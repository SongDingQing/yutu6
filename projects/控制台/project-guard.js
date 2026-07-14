'use strict';

// Generic distribution guard. Project names are discovered from projects/*;
// this module only recognizes the explicit "unregistered project" marker and
// system-console keywords. It must never embed a private project's name.
const CLAUSE_SPLIT_RE = /[\r\n;；。！？!?，,]+/;
const UNREGISTERED_PROJECT_RE = /(未注册项目|未登记项目|unregistered\s+project|unknown\s+project)/i;
const EXCLUSION_CONTEXT_RE = new RegExp([
  '(未注册项目|未登记项目|unregistered\\s+project|unknown\\s+project)[^\\r\\n;；。！？!?，,]{0,40}(排除|不处理|不碰|不涉及|无关|停止|停下|out\\s+of\\s+scope|excluded|do\\s+not)',
  '(排除|不处理|不碰|不涉及|无关|停止|停下|out\\s+of\\s+scope|excluded|do\\s+not)[^\\r\\n;；。！？!?，,]{0,40}(未注册项目|未登记项目|unregistered\\s+project|unknown\\s+project)',
].join('|'), 'i');
const ACTION_RE = /(操作|处理|读取|查看|检查|修复|修改|改造|接入|部署|构建|发布|测试|运行|迁移|删除|创建|开发|优化|refactor|fix|repair|modify|edit|deploy|build|release|test|run|delete|create|develop|optimize)/i;

const PROJECT_KEYWORD_RULES = [
  {
    projectId: '控制台',
    re: /控制台|console|workspace|工作区|api 网关|api-gateway|worker|queue|队列|工位|董事长办公室|秘书|ceo/i,
  },
];

function isUnregisteredProjectId(projectId) {
  return UNREGISTERED_PROJECT_RE.test(String(projectId || '').trim());
}

function hasActiveUnregisteredProjectReference(text) {
  return String(text || '')
    .split(CLAUSE_SPLIT_RE)
    .map(line => line.trim())
    .filter(Boolean)
    .some(line => UNREGISTERED_PROJECT_RE.test(line) && !EXCLUSION_CONTEXT_RE.test(line) && ACTION_RE.test(line));
}

function keywordProjectId(text) {
  const haystack = String(text || '');
  const matched = PROJECT_KEYWORD_RULES.find(rule => rule.re.test(haystack));
  return matched ? matched.projectId : null;
}

function registeredProjectFromText(text, projectIds) {
  const haystack = String(text || '').normalize('NFKC').toLowerCase();
  const candidates = (Array.isArray(projectIds) ? projectIds : [])
    .map(id => String(id || '').normalize('NFKC').trim())
    .filter(id => id && !isUnregisteredProjectId(id))
    .sort((a, b) => b.length - a.length);
  return candidates.find(id => haystack.includes(id.toLowerCase())) || null;
}

module.exports = {
  hasActiveUnregisteredProjectReference,
  isUnregisteredProjectId,
  keywordProjectId,
  registeredProjectFromText,
};
