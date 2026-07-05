'use strict';
/*
 * control-room:把玉兔6 系统状态聚合成一个只读视图,供控制台 WebUI 一目了然(阶段5)。
 * 读 shared/agents(系统级 agent)、shared/routing(角色+runner+流程)、引擎事件日志。
 * 只读、零依赖;不执行任何动作。WORKDIR = 工作区根(server.js 传入)。
 */
const fs = require('fs');
const path = require('path');
const { extractRoles, extractRunnerIds } = require('../../shared/engine/agents');

function safeRead(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
function safeJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function listAgents(root) {
  const dir = path.join(root, 'shared/agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(id => {
    const a = safeJSON(path.join(dir, id, 'agent.json'));
    return a && { id: a.id, name: a.name, role: a.role, runner: a.runner,
      context_mode: a.context_mode, reads: a.read_paths || [], triggers: a.triggers || [] };
  }).filter(Boolean);
}

function listRunners(root) {
  const text = safeRead(path.join(root, 'shared/routing/runners.yaml'));
  const ids = [...extractRunnerIds(text)];
  // 顺带抽每个 runner 的 role/status 行(脱敏,只取冒号后简短值)
  return ids.map(id => {
    const re = new RegExp(`- id:\\s*${id}[\\s\\S]*?(?=\\n  - id:|\\npolicy:|$)`);
    const block = (text.match(re) || [''])[0];
    const grab = k => ((block.match(new RegExp(`${k}:\\s*([^\\n#]+)`)) || [])[1] || '').trim();
    return { id, role: grab('role'), kind: grab('kind') };
  });
}

function listFlows(root) {
  const dir = path.join(root, 'shared/routing/flows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => {
    const t = safeRead(path.join(dir, f));
    const id = (t.match(/^id:\s*([^\n#]+)/m) || [])[1] || f;
    const nodes = (t.match(/- \{\s*id:/g) || []).length;
    return { file: f, id: id.trim(), nodes };
  });
}

// 找最近的引擎事件日志(JSONL),取尾部 N 条
function recentEvents(root, n = 40) {
  const candidates = [
    path.join(root, 'projects/控制台/artifacts/engine-events.jsonl'),
    path.join(root, 'shared/engine/artifacts/events.jsonl'),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const lines = safeRead(f).trim().split('\n').filter(Boolean);
      return { source: path.relative(root, f), events: lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
    }
  }
  return { source: null, events: [] };
}

function overview(root) {
  const roles = [...extractRoles(safeRead(path.join(root, 'shared/routing/model-routing.yaml')))];
  return {
    generatedAt: new Date().toISOString(),
    agents: listAgents(root),
    roles,
    runners: listRunners(root),
    flows: listFlows(root),
    events: recentEvents(root),
  };
}

module.exports = { overview };
