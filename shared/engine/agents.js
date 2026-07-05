'use strict';
/*
 * agents:加载 shared/agents/<id>/agent.json,并对路由/runner/读/写路径做 dry-run 校验。
 * 与引擎同源的"可拆解 + 可验证"保证(模块化原则 §4)。零依赖。
 * 不做完整 YAML 解析——只从 model-routing/runners 里抽出 role 名集合与 runner id 集合。
 */
const fs = require('fs');
const path = require('path');

function loadAgents(agentsDir) {
  const out = [];
  for (const id of fs.readdirSync(agentsDir)) {
    const f = path.join(agentsDir, id, 'agent.json');
    if (fs.existsSync(f)) out.push(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return out;
}

// 抽 model-routing.yaml 的 roles: 块下 2 空格缩进的角色名
function extractRoles(text) {
  const lines = text.split('\n');
  const roles = new Set();
  let inRoles = false;
  for (const l of lines) {
    if (/^roles:\s*$/.test(l)) { inRoles = true; continue; }
    if (inRoles) {
      if (/^[A-Za-z_]/.test(l)) break;                          // 下一个 0 缩进键 = roles 块结束(注释/空行不算)
      const m = l.match(/^ {2}([A-Za-z_][\w-]*):\s*(#.*)?$/);   // 2 空格缩进的键(可带行内注释)= 角色
      if (m) roles.add(m[1]);
    }
  }
  return roles;
}

// 抽 runners.yaml 里的 - id: X
function extractRunnerIds(text) {
  const ids = new Set();
  for (const l of text.split('\n')) {
    const m = l.match(/^\s*-\s*id:\s*([A-Za-z0-9_-]+)/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// 路径白名单:取第一个通配/<self> 之前的基目录,检查存在
function readPathBase(p) {
  const cut = p.search(/[*<]/);
  let base = cut === -1 ? p : p.slice(0, cut);
  base = base.replace(/\/+$/, '');
  const idx = base.lastIndexOf('/');
  return idx === -1 ? base : base.slice(0, idx + 1) || base;
}

function validateAgent(agent, ctx) {
  const errors = [];
  const disabled = /^(disabled|archived|retired)/i.test(String(agent.status || ''));
  if (!disabled && !ctx.roles.has(agent.role)) errors.push(`role 不在 model-routing: ${agent.role}`);
  if (!ctx.runners.has(agent.runner)) errors.push(`runner 不在 runners.yaml: ${agent.runner}`);
  for (const rp of agent.read_paths || []) {
    const base = readPathBase(rp);
    if (!fs.existsSync(path.join(ctx.root, base))) errors.push(`read_path 基目录不存在: ${base}  (来自 ${rp})`);
  }
  for (const wp of agent.writes || []) {
    const base = readPathBase(wp);
    if (!fs.existsSync(path.join(ctx.root, base))) errors.push(`write_path 基目录不存在: ${base}  (来自 ${wp})`);
  }
  if (!agent.prompt || !fs.existsSync(path.join(ctx.root, 'shared/agents', agent.id, agent.prompt)))
    errors.push(`prompt 文件缺失: ${agent.prompt}`);
  return errors;
}

module.exports = { loadAgents, extractRoles, extractRunnerIds, validateAgent, readPathBase };
